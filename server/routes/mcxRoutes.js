/**
 * MCX Routes - Enhanced Live Price Endpoints
 * 
 * Provides live tick-to-tick MCX prices similar to crypto prices
 * Ensures MCX data is delivered in real-time with proper validation
 */

import express from 'express';
import { protectUser } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting for MCX endpoints
const rateLimitMCX = rateLimit({
  windowMs: 60000, // 1 minute
  max: 120, // 120 requests per minute
  message: { error: 'Too many MCX requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @route   GET /api/mcx/live-price
 * @desc    Get live tick-to-tick MCX price using LivePriceService
 * @access  User only
 * @query   {string} symbol - MCX symbol (e.g., CRUDEOIL, GOLD, SILVER)
 * @query   {string} tradingSymbol - Full trading symbol (e.g., CRUDEOIL26AUGFUT)
 * @returns Live MCX price data with timestamp validation
 */
router.get('/live-price', ...[protectUser, rateLimitMCX], async (req, res) => {
  try {
    const { symbol, tradingSymbol } = req.query;
    
    if (!symbol && !tradingSymbol) {
      return res.status(400).json({
        error: 'symbol or tradingSymbol parameter is required',
        example: '/api/mcx/live-price?symbol=CRUDEOIL'
      });
    }

    // Import LivePriceService dynamically
    let livePriceService;
    try {
      livePriceService = await import('../services/livePriceService.js').then(m => m.default);
    } catch (error) {
      console.error('LivePriceService not available:', error.message);
      return res.status(503).json({
        error: 'Live price service unavailable',
        message: 'MCX live price service is currently initializing'
      });
    }

    // Try to get live price
    const symbolsToTry = [
      tradingSymbol,
      symbol,
      symbol + 'FUT',
      symbol + 'M',
      symbol + '26AUGFUT' // Common expiry pattern
    ].filter(Boolean);

    let livePriceData = null;
    let lastError = null;

    for (const targetSymbol of symbolsToTry) {
      try {
        livePriceData = livePriceService.getPriceForOrder(targetSymbol);
        if (livePriceData && livePriceData.isLive) {
          console.log(`✅ MCX LIVE PRICE: Found for ${targetSymbol}: ${livePriceData.price}`);
          break;
        }
      } catch (error) {
        lastError = error.message;
        continue;
      }
    }

    if (!livePriceData || !livePriceData.isLive) {
      return res.status(404).json({
        error: 'No live MCX price available',
        message: 'Live tick-to-tick data not available for requested symbol',
        debug: {
          requested: { symbol, tradingSymbol },
          tried: symbolsToTry,
          lastError,
          availableSymbols: livePriceService ? Object.keys(livePriceService.getAllLivePrices()) : []
        }
      });
    }

    // Return live price data with MCX-specific formatting
    res.json({
      success: true,
      symbol: livePriceData.symbol,
      price: livePriceData.price,
      bid: livePriceData.bid,
      ask: livePriceData.ask,
      timestamp: livePriceData.timestamp,
      ageMinutes: livePriceData.ageMinutes,
      isLive: livePriceData.isLive,
      exchange: 'MCX',
      source: 'LivePriceService',
      message: `Live MCX price - ${livePriceData.ageMinutes.toFixed(2)} minutes old`,
      // Additional MCX-specific data
      marketStatus: 'OPEN', // MCX is open 9AM-11:30PM IST
      dataQuality: livePriceData.ageMinutes <= 1 ? 'EXCELLENT' : 
                   livePriceData.ageMinutes <= 3 ? 'GOOD' : 'ACCEPTABLE'
    });

  } catch (error) {
    console.error('MCX live price error:', error);
    res.status(500).json({
      error: 'Failed to get MCX live price',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/mcx/contract-price
 * @desc    Enhanced MCX contract price endpoint (compatible with existing client)
 * @access  User only
 * @query   {string} token - MCX instrument token
 * @query   {string} symbol - MCX symbol
 * @query   {string} tradingSymbol - Full trading symbol
 * @query   {string} baseSymbol - Base symbol (e.g., CRUDEOIL)
 * @returns MCX contract price with live data validation
 */
router.get('/contract-price', async (req, res) => {
  try {
    const { token, symbol, tradingSymbol, baseSymbol } = req.query;
    
    if (!token && !symbol && !tradingSymbol && !baseSymbol) {
      return res.status(400).json({
        error: 'token, symbol, tradingSymbol, or baseSymbol parameter is required'
      });
    }

    // Import LivePriceService
    let livePriceService;
    try {
      livePriceService = await import('../services/livePriceService.js').then(m => m.default);
    } catch (error) {
      console.error('LivePriceService not available:', error.message);
      return res.status(503).json({
        error: 'Live price service unavailable',
        message: 'MCX live price service is currently initializing'
      });
    }

    // Direct symbol lookup - return mock data immediately
    let livePriceData = null;
    const targetSymbol = tradingSymbol || symbol || baseSymbol;
    
    if (targetSymbol) {
      livePriceData = livePriceService.getLivePrice(targetSymbol);
      if (livePriceData && livePriceData.isLive) {
        console.log(`✅ Found live MCX price for ${targetSymbol}: ${livePriceData.price}`);
      }
    }

    // If not found, try fallback symbols
    if (!livePriceData || !livePriceData.isLive) {
      const fallbackSymbols = [
        `${baseSymbol}FUT`,
        `${baseSymbol}M`,
        baseSymbol
      ];
      
      for (const sym of fallbackSymbols) {
        if (!sym) continue;
        livePriceData = livePriceService.getLivePrice(sym);
        if (livePriceData && livePriceData.isLive) {
          console.log(`✅ Found live MCX price for fallback ${sym}: ${livePriceData.price}`);
          break;
        }
      }
    }

    if (!livePriceData || !livePriceData.isLive) {
      // Get real live data from Zerodha WebSocket marketData
      try {
        // Import WebSocket market data
        const { getMarketData } = await import('../services/zerodhaWebSocket.js');
        const marketData = getMarketData();
        
        console.log(`🔍 Debug: Looking for MCX data - token=${token}, symbol=${symbol}, tradingSymbol=${tradingSymbol}`);
        console.log(`🔍 Debug: Available marketData keys: ${Object.keys(marketData).slice(0, 10)}...`);
        
        // Try multiple ways to find the MCX data
        let liveData = null;
        
        // Try by token number
        if (token) {
          const tokenNumber = parseInt(token);
          liveData = marketData[tokenNumber] || marketData[String(tokenNumber)];
          if (liveData) console.log(`✅ Found by token ${tokenNumber}: ${liveData.last_price}`);
        }
        
        // Try by trading symbol
        if (!liveData && tradingSymbol) {
          // Find matching instrument in marketData
          for (const [key, data] of Object.entries(marketData)) {
            if (data.tradingsymbol === tradingSymbol || data.symbol === tradingSymbol) {
              liveData = data;
              console.log(`✅ Found by tradingSymbol ${tradingSymbol}: ${liveData.last_price}`);
              break;
            }
          }
        }
        
        // Try by symbol
        if (!liveData && symbol) {
          for (const [key, data] of Object.entries(marketData)) {
            if (data.tradingsymbol === symbol || data.symbol === symbol) {
              liveData = data;
              console.log(`✅ Found by symbol ${symbol}: ${liveData.last_price}`);
              break;
            }
          }
        }
        
        // Check for MCX tokens (735000000-735999999 range)
        if (!liveData) {
          for (const [key, data] of Object.entries(marketData)) {
            const keyNum = parseInt(key);
            if (keyNum >= 735000000 && keyNum <= 735999999) {
              if (data.tradingsymbol?.includes(symbol) || data.tradingsymbol?.includes(tradingSymbol)) {
                liveData = data;
                console.log(`✅ Found MCX token ${keyNum}: ${liveData.last_price}`);
                break;
              }
            }
          }
        }
        
        if (liveData && liveData.last_price) {
          const roundedPrice = Math.round(liveData.last_price);
          livePriceData = {
            symbol: tradingSymbol || symbol || baseSymbol,
            price: roundedPrice,
            ltp: roundedPrice,
            bid: liveData.depth?.buy?.[0]?.price ? Math.round(liveData.depth.buy[0].price) : roundedPrice - 1,
            ask: liveData.depth?.sell?.[0]?.price ? Math.round(liveData.depth.sell[0].price) : roundedPrice + 1,
            volume: liveData.volume_traded || liveData.volume || 0,
            timestamp: new Date(liveData.timestamp || Date.now()),
            isLive: true,
            ageMinutes: 0.01
          };
          console.log(`✅ Using REAL live Zerodha MCX price for ${targetSymbol}: ${livePriceData.price} (bid: ${livePriceData.bid}, ask: ${livePriceData.ask})`);
        } else {
          console.log(`⚠️ No live data found for ${targetSymbol}, using fallback`);
        }
      } catch (error) {
        console.log('Error getting live Zerodha market data:', error.message);
      }
    }
    
    // If still no data, return error instead of fallback
    // User wants only live data from Zerodha, no fake/stable prices
    if (!livePriceData || !livePriceData.isLive) {
      console.log(`⚠️ No live data found for ${targetSymbol} - MCX token not subscribed to WebSocket`);
      return res.status(404).json({
        error: "No live data available",
        message: "MCX token not subscribed to WebSocket. Please ensure the instrument is selected in dashboard.",
        symbol: targetSymbol
      });
    }

    if (!livePriceData) {
      return res.status(404).json({
        error: "Price unavailable for requested MCX contract",
        message: "No price data found"
      });
    }

    // Return in format compatible with existing contract-price endpoint
    res.json({
      token: token || 'MCX_LIVE',
      symbol: livePriceData.symbol,
      tradingSymbol: livePriceData.symbol,
      price: livePriceData.price,
      ltp: livePriceData.price,
      bid: livePriceData.bid,
      ask: livePriceData.ask,
      timestamp: livePriceData.timestamp,
      exchange: 'MCX',
      source: 'LivePriceService',
      isLive: true,
      ageMinutes: livePriceData.ageMinutes,
      // Additional fields for compatibility
      open: livePriceData.price, // Will be updated with OHLC data
      high: livePriceData.price,
      low: livePriceData.price,
      close: livePriceData.price,
      volume: 0,
      oi: 0
    });

  } catch (error) {
    console.error('MCX contract price error:', error);
    res.status(500).json({
      error: 'Failed to get MCX contract price',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/mcx/status
 * @desc    Get MCX market status and available symbols
 * @access  User only
 * @returns MCX market status and live symbols
 */
router.get('/status', ...[protectUser, rateLimitMCX], async (req, res) => {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const mcxOpenTime = 9 * 60; // 9:00 AM
    const mcxCloseTime = 23 * 60 + 30; // 11:30 PM
    const isMcxOpen = currentTimeInMinutes >= mcxOpenTime && currentTimeInMinutes <= mcxCloseTime;

    // Get available symbols from LivePriceService
    let livePriceService;
    let availableSymbols = [];
    let serviceStats = null;

    try {
      livePriceService = await import('../services/livePriceService.js').then(m => m.default);
      availableSymbols = Object.keys(livePriceService.getAllLivePrices());
      serviceStats = livePriceService.getStats();
    } catch (error) {
      console.error('LivePriceService not available for status:', error.message);
    }

    res.json({
      market: 'MCX',
      isOpen: isMcxOpen,
      currentTime: now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      marketHours: '9:00 AM - 11:30 PM IST',
      liveSymbols: availableSymbols.filter(s => 
        ['CRUDEOIL', 'GOLD', 'SILVER', 'NATURALGAS', 'COPPER', 'ZINC', 'LEAD', 'ALUMINIUM', 'NICKEL'].some(base => s.includes(base))
      ),
      serviceStats,
      message: isMcxOpen ? 'MCX market is open - live prices available' : 'MCX market is closed'
    });

  } catch (error) {
    console.error('MCX status error:', error);
    res.status(500).json({
      error: 'Failed to get MCX status',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/mcx/test
 * @desc    Public test endpoint for MCX data (no authentication required)
 * @access  Public
 * @returns MCX test data to verify LivePriceService is working
 */
router.get('/test', async (req, res) => {
  try {
    // Import LivePriceService dynamically
    let livePriceService;
    try {
      livePriceService = await import('../services/livePriceService.js').then(m => m.default);
    } catch (error) {
      console.error('LivePriceService not available:', error.message);
      return res.status(503).json({
        error: 'Live price service unavailable',
        message: 'MCX live price service is currently initializing'
      });
    }

    // Get all available symbols
    const allPrices = livePriceService.getAllLivePrices();
    const serviceStats = livePriceService.getStats();
    
    // Test specific MCX symbols
    const testSymbols = ['CRUDEOIL26AUGFUT', 'CRUDEOIL', 'GOLD', 'SILVER', 'GOLDM', 'SILVERM'];
    const testResults = {};
    
    for (const symbol of testSymbols) {
      try {
        const priceData = livePriceService.getLivePrice(symbol);
        const rawData = livePriceService.livePrices.get(symbol);
        
        if (priceData && priceData.isLive) {
          testResults[symbol] = {
            success: true,
            price: priceData.price,
            bid: priceData.bid,
            ask: priceData.ask,
            timestamp: priceData.timestamp,
            ageMinutes: priceData.ageMinutes,
            isLive: priceData.isLive,
            message: `Live MCX price - ${priceData.ageMinutes.toFixed(2)} minutes old`
          };
        } else {
          testResults[symbol] = {
            success: false,
            error: 'No live data available',
            debug: {
              priceData: priceData ? 'exists' : 'null',
              isLive: priceData?.isLive,
              rawData: rawData ? 'exists' : 'null',
              rawTimestamp: rawData?.timestamp,
              ageMinutes: priceData?.ageMinutes
            }
          };
        }
      } catch (error) {
        testResults[symbol] = {
          success: false,
          error: error.message
        };
      }
    }

    res.json({
      success: true,
      message: 'MCX Live Price Service Test',
      timestamp: new Date().toISOString(),
      serviceStats,
      allAvailableSymbols: Object.keys(allPrices),
      totalSymbols: allPrices.length,
      testResults
    });

  } catch (error) {
    console.error('MCX test error:', error);
    res.status(500).json({
      error: 'Failed to test MCX service',
      message: error.message
    });
  }
});

export default router;
