import { KiteTicker } from 'kiteconnect';
import MarginMonitorService from './marginMonitorService.js';
import Instrument from '../models/Instrument.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let ticker = null;
let connectionInProgress = false; // Flag to prevent multiple simultaneous connection attempts
let io = null;
let subscribedTokens = [];
/** Tokens to subscribe on next ticker connect (e.g. user watchlist while Zerodha was still connecting) */
let pendingUserSubscribe = new Set();
let marketData = {};
let marginMonitorEnabled = true; // Toggle for margin monitoring

// Initialize WebSocket with Socket.IO instance
export const initZerodhaWebSocket = (socketIO) => {
  io = socketIO;
  // Initialize margin monitor with same Socket.IO instance
  MarginMonitorService.init(socketIO);
  
  // Clear any stale subscriptions from previous session
  console.log('[initZerodhaWebSocket] Clearing stale subscription list from previous session');
  subscribedTokens = [];
  pendingUserSubscribe.clear();
  
  console.log('Zerodha WebSocket service initialized with TradePro Margin Monitor');
};

/**
 * Older seeds used placeholder tokens (99926xxx). Kite Connect uses these instrument_token values.
 * @see https://kite.trade/forum/discussion/2825/how-to-get-ticks-for-indices-like-banknifty-nifty-50
 */
const INDEX_TOKEN_LEGACY_TO_KITE = {
  99926000: 256265,
  99926009: 260105,
  99926037: 257801,
  99926074: 288009,
};

const INDEX_TOKEN_KITE_TO_LEGACY = {
  256265: ['99926000'],
  260105: ['99926009'],
  257801: ['99926037'],
  288009: ['99926074'],
};

/** Display symbol when Kite omits tradingsymbol on non-tradable index ticks */
const KITE_INDEX_SYMBOL = {
  256265: 'NIFTY 50',
  260105: 'NIFTY BANK',
  257801: 'NIFTY FIN SERVICE',
  288009: 'NIFTY MID SELECT',
};

export function normalizeKiteInstrumentToken(t) {
  const n = parseInt(t, 10);
  if (Number.isNaN(n) || n <= 0) return n;
  return INDEX_TOKEN_LEGACY_TO_KITE[n] || n;
}

// Essential tokens that should always be subscribed (for games and indices)
const ESSENTIAL_TOKENS = [
  256265,   // NIFTY 50 (Index)
  260105,   // NIFTY BANK (Index)
  257801,   // NIFTY FIN SERVICE
  288009,   // NIFTY MID SELECT
];

/** Kite: one WebSocket may stream at most ~3000 instruments; higher caused OOM + 502 in prod. */
const KITE_HARD_CAP_WS = 3000;
function getMaxZerodhaWsSubscriptions() {
  const n = parseInt(process.env.ZERODHA_MAX_WS_TOKENS || String(KITE_HARD_CAP_WS), 10);
  return Number.isFinite(n) ? Math.min(Math.max(256, n), KITE_HARD_CAP_WS) : KITE_HARD_CAP_WS;
}

/**
 * Dedupe & cap token list — essentials kept first when truncating (rest after sync may be dropped).
 */
function capSubscriptionsTokenList(rawTokens, context = '') {
  const max = getMaxZerodhaWsSubscriptions();
  const seen = new Map();
  for (const t of ESSENTIAL_TOKENS) {
    const n = normalizeKiteInstrumentToken(t);
    if (Number.isFinite(n) && n > 0) seen.set(n, true);
  }
  for (const t of rawTokens) {
    const n = normalizeKiteInstrumentToken(t);
    if (Number.isFinite(n) && n > 0) seen.set(n, true);
  }
  const merged = [...seen.keys()];
  if (merged.length <= max) return merged;

  console.warn(
    `[Zerodha] Subscription list truncated to ${max} (had ${merged.length})${context ? `: ${context}` : ''}; ` +
      `hard cap=${KITE_HARD_CAP_WS}. Tune ZERODHA_MAX_WS_TOKENS ≤ ${KITE_HARD_CAP_WS}.`,
  );

  /* Essentials first — re-order merged so ESSENTIAL_* then others */
  const essSet = new Set(ESSENTIAL_TOKENS.map((e) => normalizeKiteInstrumentToken(e)));
  const essentials = merged.filter((t) => essSet.has(t));
  const rest = merged.filter((t) => !essSet.has(t));
  const ordered = [...essentials, ...rest];
  return ordered.slice(0, max);
}

// Connect to Zerodha WebSocket
export const connectTicker = (apiKey, accessToken) => {
  // Check if connection is already in progress
  if (connectionInProgress) {
    console.log('[WebSocket] Connection already in progress, skipping duplicate request');
    return ticker;
  }

  // Trim API key and access token to remove any whitespace
  const trimmedApiKey = apiKey.trim();
  const trimmedAccessToken = accessToken.trim();

  // Check if already connected with the same credentials
  if (ticker && ticker.connected()) {
    console.log('[WebSocket] Already connected with same credentials, skipping reconnect');
    return ticker;
  }

  // Disconnect existing ticker before creating new one
  if (ticker) {
    console.log('[WebSocket] Disconnecting existing ticker before reconnect');
    ticker.disconnect();
  }

  console.log('[WebSocket] Creating new ticker connection');
  connectionInProgress = true; // Set flag to prevent multiple simultaneous connections

  ticker = new KiteTicker({
    api_key: trimmedApiKey,
    access_token: trimmedAccessToken
  });

  ticker.autoReconnect(true, 1000, 1000); // Enable auto-reconnect with 1s interval, max 1000 attempts

  ticker.on('connect', () => {
    console.log('[WebSocket] Connected successfully');
    console.log('[WebSocket] Pending queue size:', pendingUserSubscribe.size);
    connectionInProgress = false; // Reset flag on successful connection
    // Broadcast connection status to all clients
    if (io) {
      io.emit('zerodha_status', { connected: true });
    }
    const queued = [...pendingUserSubscribe];
    pendingUserSubscribe.clear();
    // Always subscribe to essential tokens (NIFTY 50, BANKNIFTY) for games, plus any queued user tokens
    const allTokens = [...new Set([...ESSENTIAL_TOKENS, ...queued])];
    console.log(
      `[WebSocket] Subscribing to ${allTokens.length} tokens (including ${ESSENTIAL_TOKENS.length} essential + ${queued.length} queued)`
    );
    if (allTokens.length > 0) {
      subscribeTokens(allTokens);
    }
  });

  ticker.on('ticks', (ticks) => {
    processTicks(ticks);
  });

  ticker.on('disconnect', () => {
    console.log('[WebSocket] Disconnected');
    console.log('[WebSocket] Current subscription count:', subscribedTokens.length);
    connectionInProgress = false; // Reset flag on disconnect to allow reconnection
    // Broadcast disconnection status to all clients
    if (io) {
      io.emit('zerodha_status', { connected: false });
    }
  });

  ticker.on('error', (error) => {
    const msg = error?.message || String(error);
    console.error('Zerodha WebSocket error:', msg);
    if (String(msg).includes('403')) {
      console.error(
        '[Zerodha] WebSocket 403: access_token is usually expired or invalid. Super Admin → Connect Zerodha again (do not paste logs: they may contain secrets).'
      );
    }
    // Don't disconnect on error, let auto-reconnect handle it
  });

  ticker.on('reconnect', (reconnect_count, reconnect_interval) => {
    console.log(`[WebSocket] Reconnecting... Attempt: ${reconnect_count}, Interval: ${reconnect_interval}s`);
    setTimeout(() => {
      console.log('[WebSocket] Reconnection attempt - checking connection status');
      if (!ticker || !ticker.connected()) {
        console.log('[WebSocket] Not connected after reconnection attempt');
        return;
      }
      console.log('[WebSocket] Connected after reconnection - resubscribing tokens');
      if (subscribedTokens.length > 0) {
        const toResub = capSubscriptionsTokenList(subscribedTokens, 'after-reconnect');
        subscribedTokens = [...toResub];
        console.log(`[WebSocket] Resubscribing to ${toResub.length} tokens after reconnection`);
        ticker.subscribe(toResub);
        ticker.setMode(ticker.modeFull, toResub);
      }
      const queued = [...pendingUserSubscribe];
      console.log('[WebSocket] Pending queue size for reconnection:', queued.length);
      if (queued.length > 0) {
        pendingUserSubscribe.clear();
        console.log('[WebSocket] Subscribing to queued tokens after reconnection');
        subscribeTokens(queued);
      }
    }, 1000);
  });

  ticker.on('noreconnect', () => {
    console.log('Zerodha WebSocket max reconnection attempts reached - this should not happen with 1000 retries');
    if (io) {
      io.emit('zerodha_status', { connected: false, error: 'Max reconnection attempts reached' });
    }
  });

  ticker.on('order_update', (order) => {
    console.log('Order update:', order);
    if (io) {
      io.emit('order_update', order);
    }
  });

  ticker.connect();
  return ticker;
};

// Subscribe to instrument tokens in batches
// Zerodha has limits: ~3000 tokens per connection; batching helps avoid bursts
const BATCH_SIZE = 100; // Subscribe in batches of 100 tokens
const BATCH_DELAY = 100; // 100ms delay between batches

/** Full order-book depth is huge — keep only if explicitly enabled (OOM risk when many ticks/sec). */
const streamTickDepth = () =>
  String(process.env.ZERODHA_TICK_DEPTH_STREAM || '').toLowerCase() === 'true' ||
  String(process.env.ZERODHA_TICK_DEPTH_STREAM || '') === '1';

export const subscribeTokens = async (tokens) => {
  // Map legacy DB tokens → official Kite tokens so Zerodha streams match Kite / TradingView
  const capped = Array.isArray(tokens) ? capSubscriptionsTokenList(tokens, 'subscribeTokens') : [];
  const numericTokens = capped
    .map((t) => normalizeKiteInstrumentToken(t))
    .filter((t) => !isNaN(t) && t > 0);

  if (!ticker || !ticker.connected()) {
    numericTokens.forEach((t) => pendingUserSubscribe.add(t));
    console.log(
      `Ticker not connected; queued ${numericTokens.length} token(s) for next connect (queue size ${pendingUserSubscribe.size})`
    );
    return { subscribed: 0, total: subscribedTokens.length, queued: numericTokens.length };
  }

  // Remove already subscribed tokens
  const newTokens = numericTokens.filter(t => !subscribedTokens.includes(t));

  console.log('[subscribeTokens] Subscription status', {
    requestedTokens: numericTokens.length,
    alreadySubscribedCount: subscribedTokens.length,
    newTokensCount: newTokens.length,
    requestedTokensList: numericTokens.slice(0, 10), // Show first 10
    alreadySubscribedList: subscribedTokens.slice(0, 10), // Show first 10
    newTokensList: newTokens.slice(0, 10) // Show first 10
  });

  if (newTokens.length === 0) {
    console.log('All tokens already subscribed');
    return { subscribed: 0, total: subscribedTokens.length };
  }
  
  console.log(`Subscribing to ${newTokens.length} new tokens in batches of ${BATCH_SIZE}...`);
  
  // Subscribe in batches to avoid overwhelming the connection
  let subscribedCount = 0;
  for (let i = 0; i < newTokens.length; i += BATCH_SIZE) {
    const batch = newTokens.slice(i, i + BATCH_SIZE);
    
    try {
      ticker.subscribe(batch);
      ticker.setMode(ticker.modeFull, batch);
      subscribedCount += batch.length;
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: Subscribed to ${batch.length} tokens (${subscribedCount}/${newTokens.length})`);
      
      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < newTokens.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    } catch (error) {
      console.error(`Error subscribing batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
    }
  }
  
  subscribedTokens = [...new Set([...subscribedTokens, ...newTokens])];
  console.log(`Successfully subscribed to ${subscribedCount} tokens. Total subscribed: ${subscribedTokens.length}`);
  
  return { subscribed: subscribedCount, total: subscribedTokens.length };
};

// Unsubscribe from tokens
export const unsubscribeTokens = (tokens) => {
  if (!ticker || !ticker.connected()) return;

  const numericTokens = tokens.map((t) => normalizeKiteInstrumentToken(t));
  ticker.unsubscribe(numericTokens);
  subscribedTokens = subscribedTokens.filter((t) => !numericTokens.includes(t));
};

// Force unsubscribe all tokens (clear subscription list)
export const unsubscribeAllTokens = () => {
  if (!ticker || !ticker.connected()) {
    console.log('[unsubscribeAllTokens] Ticker not connected, clearing subscription list only');
    subscribedTokens = [];
    return;
  }

  console.log(`[unsubscribeAllTokens] Unsubscribing from ${subscribedTokens.length} tokens`);
  ticker.unsubscribe(subscribedTokens);
  subscribedTokens = [];
  console.log('[unsubscribeAllTokens] Subscription list cleared');
};

// Process incoming ticks and broadcast to clients
const processTicks = async (ticks) => {
  const serverTimestamp = Date.now(); // Capture server time immediately
  const updates = {};
  const canonicalOnly = {};

  // MCX MARKET STATUS CHECK
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeInMinutes = currentHour * 60 + currentMinute;
  const mcxOpenTime = 9 * 60; // 9:00 AM = 540 minutes
  const mcxCloseTime = 23 * 60 + 30; // 11:30 PM = 1410 minutes
  const isMcxOpen = currentTimeInMinutes >= mcxOpenTime && currentTimeInMinutes <= mcxCloseTime;
  
  console.log(`🏭 MCX MARKET STATUS: ${isMcxOpen ? 'OPEN' : 'CLOSED'} | Current: ${now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log(`📅 MCX Hours: 9:00 AM - 11:30 PM IST`);

  // TEMPORARILY DISABLE HISTORICAL FILTER TO SEE ALL TICKS
  const liveTicks = ticks; // Process all ticks for now
  console.log(`📊 TICKS RECEIVED: ${ticks.length} (filtering disabled)`);

  // Token to symbol mapping
  const tokenSymbolMap = {
    256265: 'NIFTY 50',
    257801: 'BANKNIFTY',
    260105: 'FINNIFTY',
    288009: 'SENSEX',
    143610119: 'CRUDEOIL26AUGFUT'
  };

  // Add symbol and default values for missing fields
  liveTicks.forEach(tick => {
    tick.tradingsymbol = tokenSymbolMap[tick.instrument_token] || `Token-${tick.instrument_token}`;
    // Add default values for undefined fields
    tick.timestamp = tick.timestamp || tick.exchange_timestamp || tick.last_trade_time || new Date().toISOString();
    tick.volume = tick.volume || tick.volume_traded || 0;
    tick.exchange = tick.exchange || 'NSE'; // Default to NSE for essential tokens
  });

  // LOG: Show only live Zerodha WebSocket data in JSON format
  console.log('📡 LIVE ZERODHA WEBSOCKET DATA (JSON):', JSON.stringify(liveTicks, null, 2));
  
  // LOG: Stockex complete data structure
  console.log('🏭 STOCKEX COMPLETE MARKET DATA:');
  for (let i = 0; i < liveTicks.length; i++) {
    const tick = liveTicks[i];
    console.log(`\n📊 STOCKEX TICKET ${i + 1}:`);
    console.log(`🔸 INSTRUMENT: ${tick.tradingsymbol} (${tick.instrument_token})`);
    console.log(`🔸 LTP: ${tick.last_price}`);
    console.log(`🔸 CLEARING PRICE: ${tick.ohlc?.close || 'N/A'}`);
    console.log(`🔸 OHLC: O:${tick.ohlc?.open || 'N/A'} H:${tick.ohlc?.high || 'N/A'} L:${tick.ohlc?.low || 'N/A'} C:${tick.ohlc?.close || 'N/A'}`);
    console.log(`🔸 VOLUME: ${tick.volume || 'N/A'}`);
    console.log(`🔸 OI: ${tick.oi || 'N/A'}`);
    console.log(`🔸 CHANGE: ${tick.change || 'N/A'} (${tick.change_percent || 'N/A'}%)`);
    console.log(`🔸 TIMESTAMP: ${tick.timestamp}`);
    console.log(`🔸 EXCHANGE: ${tick.exchange || 'N/A'}`);
    if (tick.depth?.buy?.[0] && tick.depth?.sell?.[0]) {
      console.log(`🔸 BID/ASK: ${tick.depth.buy[0].price}/${tick.depth.sell[0].price}`);
    }
    console.log('---');
  }
  
  // LOG: Check if we have live ticks and LTP
  if (liveTicks.length === 0) {
    console.log('⚠️ NO LIVE TICKS RECEIVED - All data is historical');
  } else {
    console.log(`✅ RECEIVED ${liveTicks.length} LIVE TICK(S)`);
    console.log(`📈 CURRENT OHLC DATA FOR ALL LIVE INSTRUMENTS:`);
    
    for (let i = 0; i < liveTicks.length; i++) {
      const tick = liveTicks[i];
      console.log(`📊 TICK ${i + 1}:`);
      console.log(`  - Token: ${tick.instrument_token}`);
      console.log(`  - Symbol: ${tick.tradingsymbol}`);
      console.log(`  - LTP (last_price): ${tick.last_price}`);
      console.log(`  - Timestamp: ${tick.timestamp}`);
      console.log(`  - Volume: ${tick.volume}`);
      
      // OHLC DATA LOGGING
      if (tick.ohlc) {
        console.log(`📊 OHLC DATA FOR ${tick.tradingsymbol}:`);
        console.log(`  - Open: ${tick.ohlc.open}`);
        console.log(`  - High: ${tick.ohlc.high}`);
        console.log(`  - Low: ${tick.ohlc.low}`);
        console.log(`  - Close: ${tick.ohlc.close}`);
        console.log(`  - Current LTP: ${tick.last_price}`);
        console.log(`  - Change from Close: ${tick.last_price - tick.ohlc.close}`);
        console.log(`  - Change %: ${((tick.last_price - tick.ohlc.close) / tick.ohlc.close * 100).toFixed(2)}%`);
        
        // SPECIFIC GOLD OHLC LOGGING
        if (tick.tradingsymbol && tick.tradingsymbol.includes('GOLD')) {
          // GOLD DATA VALIDATION - Check if data is current
          const goldTimestamp = new Date(tick.timestamp);
          const serverTime = new Date();
          const goldTimeDiffMinutes = (serverTime - goldTimestamp) / (1000 * 60);
          const isGoldDataCurrent = goldTimeDiffMinutes <= 5; // Gold data should be within 5 minutes
          
          console.log(`🥇 GOLD SPECIFIC OHLC DATA:`);
          console.log(`  - Gold Symbol: ${tick.tradingsymbol}`);
          console.log(`  - Gold Token: ${tick.instrument_token}`);
          console.log(`  - Gold Open: ${tick.ohlc.open}`);
          console.log(`  - Gold High: ${tick.ohlc.high}`);
          console.log(`  - Gold Low: ${tick.ohlc.low}`);
          console.log(`  - Gold Close: ${tick.ohlc.close}`);
          console.log(`  - Gold Current LTP: ${tick.last_price}`);
          console.log(`  - Gold Change: ${tick.last_price - tick.ohlc.close}`);
          console.log(`  - Gold Change %: ${((tick.last_price - tick.ohlc.close) / tick.ohlc.close * 100).toFixed(2)}%`);
          console.log(`  - Gold Volume: ${tick.volume_traded || tick.volume}`);
          console.log(`  - Gold OI: ${tick.oi}`);
          console.log(`  - Gold Bid/Ask: ${tick.depth?.buy?.[0]?.price}/${tick.depth?.sell?.[0]?.price}`);
          console.log(`  - Gold Timestamp: ${tick.timestamp}`);
          console.log(`  - Gold Parsed Time: ${goldTimestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
          console.log(`  - Gold Server Time: ${serverTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
          console.log(`  - Gold Time Diff: ${goldTimeDiffMinutes.toFixed(2)} minutes`);
          console.log(`  - Gold Data Status: ${isGoldDataCurrent ? '✅ LIVE DATA' : '❌ HISTORICAL DATA'}`);
          
          if (!isGoldDataCurrent) {
            console.log(`🚨 WARNING: HISTORICAL GOLD DATA DETECTED!`);
            console.log(`🚨 This gold data is ${goldTimeDiffMinutes.toFixed(2)} minutes old`);
            console.log(`🚨 Open price of ${tick.ohlc.open} appears to be historical data`);
            console.log(`🚨 Expected current time: ${serverTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
            console.log(`🚨 Received data time: ${goldTimestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
          } else {
            console.log(`✅ GOLD DATA IS CURRENT AND LIVE!`);
          }
        }
      } else {
        console.log(`📊 OHLC DATA FOR ${tick.tradingsymbol}: ❌ NO OHLC DATA AVAILABLE`);
      }
      
      // MCX SPECIFIC LOGGING
      const token = tick.instrument_token.toString();
      const nTok = parseInt(token, 10);
      
      // Check if this is an MCX instrument (MCX tokens typically start with 735xxxx or similar)
      if (nTok >= 735000000 && nTok <= 735999999) {
        // TIMESTAMP VALIDATION - Check if data is current
        const tickTimestamp = new Date(tick.timestamp);
        const serverTime = new Date();
        const timeDiffMinutes = (serverTime - tickTimestamp) / (1000 * 60);
        const isDataCurrent = timeDiffMinutes <= 5; // Data should be within 5 minutes
        
        console.log(`🏭 MCX INSTRUMENT DETECTED:`);
        console.log(`  - MCX Token: ${nTok}`);
        console.log(`  - MCX Symbol: ${tick.tradingsymbol}`);
        console.log(`  - MCX LTP: ${tick.last_price}`);
        console.log(`  - MCX Volume: ${tick.volume_traded || tick.volume}`);
        console.log(`  - MCX OI: ${tick.oi}`);
        console.log(`  - MCX OI Day High: ${tick.oi_day_high}`);
        console.log(`  - MCX OI Day Low: ${tick.oi_day_low}`);
        console.log(`  - MCX Bid: ${tick.depth?.buy?.[0]?.price}`);
        console.log(`  - MCX Ask: ${tick.depth?.sell?.[0]?.price}`);
        console.log(`  - MCX Bid Qty: ${tick.depth?.buy?.[0]?.quantity}`);
        console.log(`  - MCX Ask Qty: ${tick.depth?.sell?.[0]?.quantity}`);
        console.log(`  - MCX Change: ${tick.change}`);
        console.log(`  - MCX Change %: ${tick.change_percent}`);
        console.log(`  - MCX OHLC Open: ${tick.ohlc?.open}`);
        console.log(`  - MCX OHLC High: ${tick.ohlc?.high}`);
        console.log(`  - MCX OHLC Low: ${tick.ohlc?.low}`);
        console.log(`  - MCX OHLC Close: ${tick.ohlc?.close}`);
        console.log(`  - MCX Last Trade Time: ${tick.last_trade_time}`);
        console.log(`  - MCX Total Buy Qty: ${tick.total_buy_quantity}`);
        console.log(`  - MCX Total Sell Qty: ${tick.total_sell_quantity}`);
        console.log(`  - MCX Timestamp: ${tick.timestamp}`);
        console.log(`  - MCX Parsed Time: ${tickTimestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        console.log(`  - MCX Server Time: ${serverTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        console.log(`  - MCX Time Diff: ${timeDiffMinutes.toFixed(2)} minutes`);
        console.log(`  - MCX Data Status: ${isDataCurrent ? '✅ CURRENT' : '❌ OLD DATA'}`);
        console.log(`  - MCX Tradable: ${tick.tradable}`);
        console.log(`  - MCX Mode: ${tick.mode}`);
        
        if (!isDataCurrent) {
          console.log(`🚨 WARNING: OLD MCX DATA DETECTED!`);
          console.log(`🚨 This data is ${timeDiffMinutes.toFixed(2)} minutes old`);
          console.log(`🚨 Expected current time: ${serverTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
          console.log(`🚨 Received data time: ${tickTimestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        }
        
        console.log(`🏭 COMPLETE MCX DATA STRUCTURE:`);
        console.log(JSON.stringify(tick, null, 2));
      }
      
      // Also check for common MCX symbols
      const mcxSymbols = ['CRUDEOIL', 'NATURALGAS', 'GOLD', 'SILVER', 'COPPER', 'ZINC', 'LEAD', 'ALUMINIUM', 'NICKEL'];
      if (mcxSymbols.some(symbol => tick.tradingsymbol?.includes(symbol))) {
        console.log(`🏭 MCX SYMBOL DETECTED: ${tick.tradingsymbol}`);
        console.log(`  - MCX Token: ${nTok}`);
        console.log(`  - MCX LTP: ${tick.last_price}`);
        console.log(`  - MCX Volume: ${tick.volume_traded || tick.volume}`);
        console.log(`  - MCX OI: ${tick.oi}`);
        console.log(`  - MCX Change: ${tick.change}`);
        console.log(`  - MCX Change %: ${tick.change_percent}`);
        console.log(`  - MCX OHLC: ${JSON.stringify(tick.ohlc)}`);
        console.log(`  - MCX Market Depth: ${JSON.stringify(tick.depth)}`);
        console.log(`🏭 COMPLETE MCX DATA:`);
        console.log(JSON.stringify(tick, null, 2));
      }
    }
  }

  // INTEGRATE WITH LIVE PRICE SERVICE FOR ORDER PRICING
  for (const tick of liveTicks) {
    // Update LivePriceService with current live prices
    try {
      const livePriceService = await import('./livePriceService.js').then(m => m.default);
      livePriceService.updateLivePrice(tick);
    } catch (error) {
      console.error('Failed to update LivePriceService:', error.message);
    }
  }

  // PHASE 1: Build tick data objects (minimal processing) - ONLY LIVE DATA
  for (const tick of liveTicks) {
    const token = tick.instrument_token.toString();
    const nTok = parseInt(token, 10);

    // LOG: Track LTP from raw WebSocket data
    console.log(`🔍 PROCESSING LIVE TICK - Raw LTP from WebSocket: ${tick.last_price}`);

    const rawBid = tick.depth?.buy?.[0]?.price;
    const rawAsk = tick.depth?.sell?.[0]?.price;

    const bestBid = rawBid && rawBid > 0 ? rawBid : tick.last_price;
    const bestAsk = rawAsk && rawAsk > 0 ? rawAsk : tick.last_price;

    const isUpperCircuit = (!rawAsk || rawAsk === 0) && tick.last_price > 0;
    const isLowerCircuit = (!rawBid || rawBid === 0) && tick.last_price > 0;
    const circuitStatus = isUpperCircuit ? 'UC' : isLowerCircuit ? 'LC' : null;

    const indexSym = KITE_INDEX_SYMBOL[nTok];
    const tickData = {
      token,
      symbol: tick.tradable ? tick.tradingsymbol : indexSym || tick.tradingsymbol,
      ltp: tick.last_price,
      bid: bestBid,
      ask: bestAsk,
      rawBid: rawBid || 0,
      rawAsk: rawAsk || 0,
      circuit: circuitStatus,
      open: tick.ohlc?.open,
      high: tick.ohlc?.high,
      low: tick.ohlc?.low,
      close: tick.ohlc?.close,
      change: tick.change,
      changePercent:
        tick.change_percent ||
        (tick.ohlc?.close
          ? (((tick.last_price - tick.ohlc.close) / tick.ohlc.close) * 100).toFixed(2)
          : 0),
      volume: tick.volume_traded || tick.volume,
      buyQuantity: tick.total_buy_quantity,
      sellQuantity: tick.total_sell_quantity,
      lastTradeTime: tick.last_trade_time,
      oi: tick.oi,
      oiDayHigh: tick.oi_day_high,
      oiDayLow: tick.oi_day_low,
      ...(streamTickDepth() ? { depth: tick.depth } : {}),
      lastUpdated: new Date(),
      serverTimestamp, // Add server timestamp for latency tracking
    };

    marketData[token] = tickData;
    updates[token] = tickData;
    canonicalOnly[token] = tickData;

    for (const leg of INDEX_TOKEN_KITE_TO_LEGACY[nTok] || []) {
      const alias = { ...tickData, token: String(leg) };
      marketData[String(leg)] = alias;
      updates[String(leg)] = alias;
    }
  }

  // PHASE 2: IMMEDIATE BROADCAST - Send to clients FIRST before any heavy processing
  if (io && Object.keys(updates).length > 0) {
    io.emit('market_tick', updates);
  }

  // PHASE 3: DEFERRED PROCESSING - Run margin monitoring and DB updates asynchronously
  // Use setImmediate to defer to next event loop iteration (non-blocking)
  if (marginMonitorEnabled && Object.keys(canonicalOnly).length > 0) {
    setImmediate(() => {
      for (const [tok, tickData] of Object.entries(canonicalOnly)) {
        // Margin monitoring (async, non-blocking)
        MarginMonitorService.onPriceTick(tok, tickData.ltp, tickData).catch((err) =>
          console.error(`Margin monitor error for token ${tok}:`, err.message)
        );
        // Database update (async, non-blocking)
        updateInstrumentLastPrice(tok, tickData).catch((err) =>
          console.error(`DB update error for token ${tok}:`, err.message)
        );
        
        // For NIFTY 50, also persist price to file cache for closed-market fallback
        if (tok === '256265' && tickData.ltp && tickData.ltp > 0) {
          try {
            const __dirname = path.dirname(fileURLToPath(import.meta.url));
            const cacheFile = path.join(__dirname, '../../.nifty-last-price.json');
            const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            fs.writeFileSync(cacheFile, JSON.stringify({ 
              price: tickData.ltp, 
              date: todayIst, 
              savedAt: new Date().toISOString() 
            }));
          } catch (err) {
            // Silently ignore file write errors
          }
        }
      }
    });
  }
};

// Update instrument's last price for fallback when market is closed
const updateInstrumentLastPrice = async (token, tickData) => {
  try {
    const nTok = parseInt(token, 10);
    const tokenVariants = [token.toString()];
    if (INDEX_TOKEN_KITE_TO_LEGACY[nTok]) {
      tokenVariants.push(...INDEX_TOKEN_KITE_TO_LEGACY[nTok]);
    }

    const updateFields = {
      lastPrice: tickData.ltp,
      ltp: tickData.ltp,
      open: tickData.open,
      high: tickData.high,
      low: tickData.low,
      close: tickData.close,
      change: tickData.change,
      changePercent: tickData.changePercent,
      lastUpdated: new Date(),
    };

    // Update lastBid and lastAsk if available
    if (tickData.bid && tickData.bid > 0) {
      updateFields.lastBid = tickData.bid;
    }
    if (tickData.ask && tickData.ask > 0) {
      updateFields.lastAsk = tickData.ask;
    }

    await Instrument.updateMany(
      { token: { $in: tokenVariants } },
      {
        $set: updateFields,
      },
      { upsert: false }
    );
  } catch (error) {
    console.error(`Failed to update last price for token ${token}:`, error.message);
  }
};

// Get current market data
export const getMarketData = () => {
  return marketData;
};

// Get ticker status
export const getTickerStatus = () => {
  console.log('[getTickerStatus] Current subscribed tokens:', subscribedTokens.slice(0, 20)); // Show first 20
  return {
    connected: ticker ? ticker.connected() : false,
    subscribedTokens: subscribedTokens.length
  };
};

// Disconnect ticker
export const disconnectTicker = () => {
  if (ticker) {
    ticker.disconnect();
    ticker = null;
    subscribedTokens = [];
    pendingUserSubscribe.clear();
    marketData = {};
  }
};

// Toggle margin monitoring on/off
export const setMarginMonitorEnabled = (enabled) => {
  marginMonitorEnabled = enabled;
  console.log(`Margin monitoring ${enabled ? 'enabled' : 'disabled'}`);
};

// Get margin monitor status
export const isMarginMonitorEnabled = () => marginMonitorEnabled;

export default {
  initZerodhaWebSocket,
  connectTicker,
  subscribeTokens,
  unsubscribeTokens,
  unsubscribeAllTokens,
  getMarketData,
  getTickerStatus,
  disconnectTicker,
  setMarginMonitorEnabled,
  isMarginMonitorEnabled,
  normalizeKiteInstrumentToken,
};
