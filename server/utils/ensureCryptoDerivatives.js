import axios from 'axios';
import Instrument from '../models/Instrument.js';

const FAPI_EXCHANGE_INFO = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
let lastUmFuturesSyncAt = 0;
const FUTURES_THROTTLE_MS = 12 * 60 * 1000; // 12 minutes when list already looks complete

function lotTickFromFilters(filters) {
  const lot = filters?.find((f) => f.filterType === 'LOT_SIZE');
  const pr = filters?.find((f) => f.filterType === 'PRICE_FILTER');
  let lotSize = parseFloat(lot?.stepSize || lot?.minQty || '0.001');
  let tickSize = parseFloat(pr?.tickSize || '0.01');
  const minQ = parseFloat(lot?.minQty || '');
  const maxQ = parseFloat(lot?.maxQty || '');
  if (!Number.isFinite(lotSize) || lotSize <= 0) lotSize = 0.001;
  if (!Number.isFinite(tickSize) || tickSize <= 0) tickSize = 0.01;
  const qtyFilterMin = Number.isFinite(minQ) && minQ > 0 ? minQ : lotSize;
  const qtyFilterMax = Number.isFinite(maxQ) && maxQ > 0 ? maxQ : null;
  return { lotSize, tickSize, qtyFilterMin, qtyFilterMax };
}

function buildSyntheticCryptoOptions() {
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + 1);
  expiry.setDate(Math.min(28, expiry.getDate()));
  const expKey = `${expiry.getUTCFullYear()}${String(expiry.getUTCMonth() + 1).padStart(2, '0')}${String(expiry.getUTCDate()).padStart(2, '0')}`;

  const btcStrikes = [
    82000, 84000, 86000, 88000, 90000, 92000, 94000, 95000, 96000, 98000, 100000, 102000, 105000, 108000, 110000, 115000, 120000
  ];
  const ethStrikes = [2400, 2600, 2800, 3000, 3200, 3400, 3500, 3600, 3800, 4000, 4200, 4400, 4600, 4800, 5000];

  const out = [];
  const addChain = (base, pair, strikes, lotSize, tickSize) => {
    for (const strike of strikes) {
      for (const ot of ['CE', 'PE']) {
        const sym = `${base}USDT${strike}${ot}`;
        out.push({
          token: `BIN_OPT_${base}_${strike}_${ot}_${expKey}`,
          symbol: sym,
          tradingSymbol: sym,
          name: `${base} ${ot === 'CE' ? 'Call' : 'Put'} ${strike} USDT`,
          exchange: 'BINANCE',
          segment: 'CRYPTOOPT',
          displaySegment: 'CRYPTOOPT',
          category: 'OTHER',
          instrumentType: 'OPTIONS',
          pair,
          lotSize,
          tickSize,
          qtyFilterMin: lotSize,
          qtyFilterMax: null,
          strike,
          optionType: ot,
          expiry,
          ltp: ot === 'CE' ? Math.max(1, strike * 0.002) : Math.max(1, strike * 0.0015),
          isCrypto: true,
          isEnabled: true
        });
      }
    }
  };
  addChain('BTC', 'BTCUSDT', btcStrikes, 0.001, 0.1);
  addChain('ETH', 'ETHUSDT', ethStrikes, 0.01, 0.01);
  return out;
}

function minimalFuturesFallback() {
  return [
    {
      token: 'BIN_UM_BTCUSDT',
      symbol: 'BTCUSDT',
      tradingSymbol: 'BTCUSDT',
      name: 'BTC / USDT Perpetual',
      exchange: 'BINANCE',
      segment: 'CRYPTOFUT',
      displaySegment: 'CRYPTOFUT',
      category: 'OTHER',
      instrumentType: 'FUTURES',
      pair: 'BTCUSDT',
      lotSize: 0.001,
      tickSize: 0.1,
      qtyFilterMin: 0.001,
      qtyFilterMax: null,
      ltp: 97000,
      isCrypto: true,
      isEnabled: true
    },
    {
      token: 'BIN_UM_ETHUSDT',
      symbol: 'ETHUSDT',
      tradingSymbol: 'ETHUSDT',
      name: 'ETH / USDT Perpetual',
      exchange: 'BINANCE',
      segment: 'CRYPTOFUT',
      displaySegment: 'CRYPTOFUT',
      category: 'OTHER',
      instrumentType: 'FUTURES',
      pair: 'ETHUSDT',
      lotSize: 0.01,
      tickSize: 0.01,
      qtyFilterMin: 0.01,
      qtyFilterMax: null,
      ltp: 3500,
      isCrypto: true,
      isEnabled: true
    }
  ];
}

/**
 * Pull all USDT-margined perpetual contracts from Binance USD-M Futures and upsert as CRYPTOFUT.
 * Throttled unless force=true or list is still small (re-sync after minimal seed).
 */
export async function syncBinanceUsdtmPerpetualInstruments({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastUmFuturesSyncAt < FUTURES_THROTTLE_MS) {
    return { skipped: true, reason: 'throttle', syncedAt: lastUmFuturesSyncAt };
  }

  let list = [];
  try {
    const { data } = await axios.get(FAPI_EXCHANGE_INFO, { timeout: 30000 });
    list = (data.symbols || []).filter(
      (s) => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL'
    );
    lastUmFuturesSyncAt = now;
  } catch (e) {
    console.error('[syncBinanceUsdtmPerpetualInstruments]', e?.message || e);
    list = [];
  }

  if (list.length === 0) {
    const fallback = minimalFuturesFallback();
    for (const inst of fallback) {
      await Instrument.findOneAndUpdate({ token: inst.token }, { $set: inst }, { upsert: true });
    }
    return { synced: fallback.length, skipped: false, fallback: true };
  }

  const bulkOps = list.map((s) => {
    const { lotSize, tickSize, qtyFilterMin, qtyFilterMax } = lotTickFromFilters(s.filters);
    const pair = s.symbol;
    const token = `BIN_UM_${pair}`;
    return {
      updateOne: {
        filter: { token },
        update: {
          $set: {
            token,
            symbol: pair,
            tradingSymbol: pair,
            name: `${s.baseAsset} / ${s.quoteAsset} Perpetual`,
            exchange: 'BINANCE',
            segment: 'CRYPTOFUT',
            displaySegment: 'CRYPTOFUT',
            category: 'OTHER',
            instrumentType: 'FUTURES',
            pair,
            lotSize,
            tickSize,
            qtyFilterMin,
            qtyFilterMax,
            isCrypto: true,
            isEnabled: true
          }
        },
        upsert: true
      }
    };
  });

  if (bulkOps.length) {
    await Instrument.bulkWrite(bulkOps, { ordered: false });
    await Instrument.updateMany(
      { token: { $in: ['BIN_BTC_PERP', 'BIN_ETH_PERP'] } },
      { $set: { isEnabled: false } }
    );
  }
  return { synced: list.length, skipped: false, fallback: false };
}

/**
 * Upsert expanded synthetic BTC/ETH options chain (CRYPTOOPT).
 */
export async function upsertSyntheticCryptoOptionsInstruments() {
  const rows = buildSyntheticCryptoOptions();
  let added = 0;
  let updated = 0;
  for (const inst of rows) {
    const existing = await Instrument.findOne({ token: inst.token });
    if (existing) {
      await Instrument.updateOne({ _id: existing._id }, { $set: inst });
      updated++;
    } else {
      await Instrument.create(inst);
      added++;
    }
  }
  return { added, updated, total: rows.length };
}

/**
 * Full seed: all Binance USDT perps + synthetic options (admin button / manual).
 */
export async function ensureCryptoDerivativesInstruments() {
  const fut = await syncBinanceUsdtmPerpetualInstruments({ force: true });
  const opt = await upsertSyntheticCryptoOptionsInstruments();
  return {
    futures: fut,
    options: opt,
    total: (fut.synced || 0) + opt.total
  };
}
