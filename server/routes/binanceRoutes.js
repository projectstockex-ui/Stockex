import express from 'express';
import axios from 'axios';
import { getCryptoData } from '../services/binanceWebSocket.js';
import {
  getCryptoSessionStatus,
  refreshCryptoSessionTimingCache,
  isCryptoSessionLiveSync,
} from '../services/cryptoSessionCloseService.js';

const router = express.Router();

// Binance API base URL
const BINANCE_API = 'https://api.binance.com/api/v3';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';

const binanceAxios = axios.create({
  baseURL: BINANCE_API,
  timeout: 20000,
  headers: BINANCE_API_KEY ? { 'X-MBX-APIKEY': BINANCE_API_KEY } : {},
});

/** Global api.binance.com spot klines do not support *INR; map display pairs to USDT. */
function resolveBinanceSpotKlineSymbol(raw) {
  const u = String(raw || '').toUpperCase().trim();
  if (!u) return '';
  if (u === 'MATICUSDT' || u === 'MATIC') return 'POLUSDT';
  if (u.endsWith('INR') && u.length > 3) return `${u.slice(0, -3)}USDT`;
  if (u.endsWith('USDT') || u.endsWith('BUSD') || u.endsWith('FDUSD')) return u;
  return `${u}USDT`;
}

const CRYPTO_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'SOLUSDT', 'DOTUSDT', 'POLUSDT', 'LTCUSDT',
  'AVAXUSDT', 'LINKUSDT', 'ATOMUSDT', 'UNIUSDT', 'XLMUSDT',
];

function tickerRow(ticker) {
  const symbol = ticker.symbol.replace('USDT', '');
  return {
    symbol,
    pair: ticker.symbol,
    exchange: 'BINANCE',
    ltp: parseFloat(ticker.lastPrice),
    open: parseFloat(ticker.openPrice),
    high: parseFloat(ticker.highPrice),
    low: parseFloat(ticker.lowPrice),
    close: parseFloat(ticker.prevClosePrice),
    change: parseFloat(ticker.priceChange),
    changePercent: parseFloat(ticker.priceChangePercent).toFixed(2),
    volume: parseFloat(ticker.volume),
    quoteVolume: parseFloat(ticker.quoteVolume),
    lastUpdated: new Date(),
  };
}

router.get('/session-status', async (req, res) => {
  try {
    await refreshCryptoSessionTimingCache();
    res.json(getCryptoSessionStatus());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/prices', async (req, res) => {
  try {
    await refreshCryptoSessionTimingCache();
    const cached = getCryptoData();
    if (cached && Object.keys(cached).length > 0) {
      return res.json(cached);
    }
    if (!isCryptoSessionLiveSync()) {
      return res.json(cached || {});
    }
    let rows = [];
    try {
      const response = await binanceAxios.get('/ticker/24hr', {
        params: { symbols: JSON.stringify(CRYPTO_SYMBOLS) },
      });
      rows = Array.isArray(response.data) ? response.data : [];
    } catch (batchErr) {
      console.warn(
        'Binance batch /ticker/24hr failed, retrying per-symbol:',
        batchErr.response?.data?.msg || batchErr.message,
      );
      const settled = await Promise.allSettled(
        CRYPTO_SYMBOLS.map((sym) =>
          binanceAxios.get('/ticker/24hr', { params: { symbol: sym } }),
        ),
      );
      rows = settled
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value.data);
    }

    const cryptoData = {};
    rows.forEach((ticker) => {
      if (!ticker?.symbol) return;
      cryptoData[ticker.symbol] = tickerRow(ticker);
    });

    if (Object.keys(cryptoData).length === 0) {
      throw new Error('No Binance ticker rows returned');
    }

    res.json(cryptoData);
  } catch (error) {
    const detail = error.response?.data?.msg || error.message;
    console.error('Binance price fetch error:', detail);
    res.status(500).json({ message: detail });
  }
});

router.get('/price/:symbol', async (req, res) => {
  const { symbol } = req.params;

  try {
    await refreshCryptoSessionTimingCache();
    const pair = resolveBinanceSpotKlineSymbol(symbol);
    const cached = getCryptoData();
    const hit =
      cached[pair] ||
      cached[symbol?.toUpperCase?.()] ||
      cached[`${String(symbol).toUpperCase()}USDT`];
    if (hit) return res.json(hit);
    if (!isCryptoSessionLiveSync()) {
      return res.status(503).json({ message: 'Crypto session closed — prices frozen' });
    }

    const response = await binanceAxios.get('/ticker/24hr', {
      params: { symbol: pair },
    });

    const ticker = response.data;
    res.json({
      symbol: ticker.symbol.replace('USDT', ''),
      pair: ticker.symbol,
      exchange: 'BINANCE',
      ltp: parseFloat(ticker.lastPrice),
      open: parseFloat(ticker.openPrice),
      high: parseFloat(ticker.highPrice),
      low: parseFloat(ticker.lowPrice),
      close: parseFloat(ticker.prevClosePrice),
      change: parseFloat(ticker.priceChange),
      changePercent: parseFloat(ticker.priceChangePercent).toFixed(2),
      volume: parseFloat(ticker.volume),
      lastUpdated: new Date(),
    });
  } catch (error) {
    console.error('Binance single price error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

router.get('/candles/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { interval = '15m', limit: _limit = 500 } = req.query;

  try {
    const pair = resolveBinanceSpotKlineSymbol(symbol);

    const response = await binanceAxios.get('/klines', {
      params: {
        symbol: pair,
        interval,
        limit: _limit,
      },
    });

    const candles = response.data.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    res.json(candles);
  } catch (error) {
    const detail = error.response?.data?.msg || error.message;
    console.error('Binance candle fetch error:', detail);
    res.status(500).json({ message: detail });
  }
});

router.get('/depth/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { limit = 20 } = req.query;

    const pair = resolveBinanceSpotKlineSymbol(symbol);

    const response = await binanceAxios.get('/depth', {
      params: {
        symbol: pair,
        limit,
      },
    });

    res.json({
      bids: response.data.bids.map((b) => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) })),
      asks: response.data.asks.map((a) => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) })),
    });
  } catch (error) {
    console.error('Binance depth error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

router.get('/search', async (req, res) => {
  const { query } = req.query;

  try {
    const response = await binanceAxios.get('/exchangeInfo');

    const usdtPairs = response.data.symbols
      .filter((s) => s.quoteAsset === 'USDT' && s.status === 'TRADING')
      .filter((s) => s.baseAsset.toLowerCase().includes(query?.toLowerCase() || ''))
      .slice(0, 20)
      .map((s) => ({
        symbol: s.baseAsset,
        pair: s.symbol,
        exchange: 'BINANCE',
      }));

    res.json(usdtPairs);
  } catch (error) {
    console.error('Binance search error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
