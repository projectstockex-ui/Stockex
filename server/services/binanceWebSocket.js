import WebSocket from 'ws';
import TradingService from './tradingService.js';
import MarginMonitorService from './marginMonitorService.js';
import { setLTPInRedis } from './ltpResolutionService.js';
import { recordLtpPoint } from './ltpHistoryStore.js';
import {
  isCryptoSessionLiveSync,
  runCryptoSessionEndIfNeeded,
  getEffectiveCryptoData,
  startCryptoSessionTimingWatcher,
  isCryptoSessionFrozen,
  clearCryptoSessionFreeze,
} from './cryptoSessionCloseService.js';

let io = null;
let ws = null;
let cryptoData = {};
let reconnectAttempts = 0;
let pingInterval = null;
const MAX_RECONNECT_ATTEMPTS = 10;

const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';

const CRYPTO_SYMBOLS = [
  'btcusdt', 'ethusdt', 'bnbusdt', 'xrpusdt', 'adausdt',
  'dogeusdt', 'solusdt', 'dotusdt', 'polusdt', 'ltcusdt',
  'avaxusdt', 'linkusdt', 'atomusdt', 'uniusdt', 'xlmusdt',
];

export const initBinanceWebSocket = (socketIO) => {
  io = socketIO;
  startCryptoSessionTimingWatcher();
  console.log('Binance WebSocket service initialized');
  connectWebSocket();
};

const connectWebSocket = () => {
  const streams = CRYPTO_SYMBOLS.map((s) => `${s}@ticker`).join('/');
  const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  const headers = {};
  if (BINANCE_API_KEY) {
    headers['X-MBX-APIKEY'] = BINANCE_API_KEY;
    console.log('Connecting to Binance WebSocket (authenticated)...');
  } else {
    console.log('Connecting to Binance WebSocket (public)...');
  }

  ws = new WebSocket(wsUrl, { headers });

  ws.on('open', () => {
    console.log(`Binance WebSocket connected${BINANCE_API_KEY ? ' (with API key)' : ''}`);
    reconnectAttempts = 0;

    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 180000);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.data) {
        const ticker = message.data;
        const symbol = ticker.s.replace('USDT', '');
        const pair = ticker.s;

        const tickData = {
          symbol,
          pair,
          exchange: 'BINANCE',
          token: pair,
          ltp: parseFloat(ticker.c),
          open: parseFloat(ticker.o),
          high: parseFloat(ticker.h),
          low: parseFloat(ticker.l),
          close: parseFloat(ticker.c),
          change: parseFloat(ticker.p),
          changePercent: parseFloat(ticker.P).toFixed(2),
          volume: parseFloat(ticker.v),
          quoteVolume: parseFloat(ticker.q),
          bid: parseFloat(ticker.b),
          ask: parseFloat(ticker.a),
          lastUpdated: new Date(),
        };

        if (!isCryptoSessionLiveSync()) {
          void runCryptoSessionEndIfNeeded(
            { ...cryptoData, [pair]: tickData, [symbol]: tickData },
            { io }
          ).catch((err) => console.error('[CryptoSession] end handler:', err?.message || err));
          return;
        }

        if (isCryptoSessionFrozen()) {
          clearCryptoSessionFreeze();
        }

        cryptoData[pair] = tickData;
        cryptoData[symbol] = tickData;

        // Store previous LTPs for UI (sampled)
        recordLtpPoint(pair, { ltp: tickData.ltp, bid: tickData.bid, ask: tickData.ask }, { minSampleMs: 2000 });
        recordLtpPoint(symbol, { ltp: tickData.ltp, bid: tickData.bid, ask: tickData.ask }, { minSampleMs: 2000 });

        // Persist LTP to Redis so EOD auto-square can resolve it
        setLTPInRedis(pair, tickData.ltp).catch(() => {});

        if (io) {
          io.emit('crypto_tick', { [pair]: tickData, [symbol]: tickData });
          // Removed market_tick emission - crypto ticks should only go to crypto_tick event
          // This prevents frontend from receiving crypto ticks on market_tick event
          // market_tick is reserved for NIFTY/Indian market data from Zerodha
        }

        TradingService.processPendingOrdersForUsdSpotTick({
          pair,
          symbol,
          bid: tickData.bid,
          ask: tickData.ask,
          ltp: tickData.ltp,
        })
          .then((filled) => {
            if (io && filled?.length) {
              for (const tr of filled) {
                const plain = typeof tr.toObject === 'function' ? tr.toObject() : tr;
                io.emit('trade_update', {
                  type: 'PENDING_FILLED',
                  trade: plain,
                  adminCode: tr.adminCode,
                });
              }
            }
          })
          .catch((err) => console.error('processPendingOrdersForUsdSpotTick:', err?.message || err));

        // Check and trigger stoploss
        TradingService.checkAndTriggerStopLoss({
          pair,
          symbol,
          bid: tickData.bid,
          ask: tickData.ask,
          ltp: tickData.ltp,
        }).catch((err) => console.error('checkAndTriggerStopLoss:', err?.message || err));

        // Keep wallet/margin heartbeat running on crypto ticks too
        // so STOP_OUT / ledger autosquare triggers without relying on Zerodha ticks.
        MarginMonitorService.onPriceTick(pair, tickData.ltp, {
          bid: tickData.bid,
          ask: tickData.ask,
          ltp: tickData.ltp,
          pair,
          symbol,
          exchange: 'BINANCE',
        }).catch((err) => console.error('marginMonitor(crypto):', err?.message || err));
      }
    } catch (error) {
      console.error('Error parsing Binance message:', error.message);
    }
  });

  ws.on('error', (error) => {
    console.error('Binance WebSocket error:', error.message);
  });

  ws.on('close', () => {
    console.log('Binance WebSocket disconnected');
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      console.log(`Reconnecting to Binance in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(connectWebSocket, delay);
    } else {
      console.error('Max reconnection attempts reached for Binance WebSocket');
    }
  });
};

export const getCryptoData = () => getEffectiveCryptoData(cryptoData);

export const getCryptoPrice = (symbol) => {
  const pair = symbol.toUpperCase().includes('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;
  return cryptoData[pair] || cryptoData[symbol.toUpperCase()] || null;
};

export const isConnected = () => ws && ws.readyState === WebSocket.OPEN;

export default {
  initBinanceWebSocket,
  getCryptoData,
  getCryptoPrice,
  isConnected,
};
