import express from 'express';
import axios from 'axios';

const router = express.Router();

const BINANCE_BASES_FOR_INR = [
  'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'DOGE', 'ADA', 'TRX', 'LTC', 'MATIC', 'AVAX', 'DOT', 'LINK',
  'ATOM', 'UNI', 'ETC', 'XLM', 'SHIB', 'NEAR', 'APT'
];

// Cache for exchange rate + per-base INR multipliers (matches binance.com …/price/bitcoin/INR)
let cachedRate = {
  rate: 83.5,
  lastUpdated: null,
  source: 'default',
  impliedInrPerUsdt: {}
};

async function fetchBinancePrice(symbol) {
  const { data } = await axios.get('https://api.binance.com/api/v3/ticker/price', {
    params: { symbol },
    timeout: 5000
  });
  return parseFloat(data?.price);
}

/** INR per 1 USDT implied by Binance {BASE}INR / {BASE}USDT — aligns  with Binance India BTC/INR page. */
async function fetchBinanceImpliedInrPerUsdtByBase() {
  const implied = {};
  for (const base of BINANCE_BASES_FOR_INR) {
    try {
      const inrP = await fetchBinancePrice(`${base}INR`);
      const usdtP = await fetchBinancePrice(`${base}USDT`);
      if (
        Number.isFinite(inrP) &&
        inrP > 0 &&
        Number.isFinite(usdtP) &&
        usdtP > 0
      ) {
        implied[base] = inrP / usdtP;
      }
    } catch {
      // Pair may not exist on this venue
    }
  }
  return implied;
}

async function fetchBinanceUsdtInr() {
  const p = await fetchBinancePrice('USDTINR');
  if (Number.isFinite(p) && p > 50 && p < 200) {
    return { rate: p, source: 'binance-usdtinr' };
  }
  return null;
}

async function fetchExchangerateApiInr() {
  const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
    timeout: 5000
  });
  const r = response.data?.rates?.INR;
  if (Number.isFinite(r) && r > 50) {
    return { rate: r, source: 'exchangerate-api' };
  }
  return null;
}

// Get USD/INR (or USDT→INR) + optional per-coin multipliers so USDT price × mult = Binance {COIN}INR.
router.get('/usdinr', async (req, res) => {
  try {
    const now = Date.now();
    if (cachedRate.lastUpdated && (now - cachedRate.lastUpdated) < 120000) {
      return res.json({
        rate: cachedRate.rate,
        impliedInrPerUsdt: cachedRate.impliedInrPerUsdt || {},
        cached: true,
        source: cachedRate.source || 'cache'
      });
    }

    let implied = {};
    try {
      implied = await fetchBinanceImpliedInrPerUsdtByBase();
    } catch (e) {
      console.warn('[usdinr] implied INR fetch:', e?.message || e);
    }

    let next = null;
    try {
      next = await fetchBinanceUsdtInr();
    } catch {
      // USDTINR may be unavailable in some regions — fall through
    }
    if (!next) {
      try {
        next = await fetchExchangerateApiInr();
      } catch (apiError) {
        console.log('Exchange rate APIs unavailable, using cached rate');
      }
    }
    if (next) {
      cachedRate.rate = next.rate;
      cachedRate.source = next.source;
    }
    cachedRate.impliedInrPerUsdt = implied;
    cachedRate.lastUpdated = now;

    res.json({
      rate: cachedRate.rate,
      impliedInrPerUsdt: cachedRate.impliedInrPerUsdt,
      cached: false,
      source: cachedRate.source || 'default'
    });
  } catch (error) {
    res.json({ rate: 83.5, impliedInrPerUsdt: {}, error: true, source: 'default' });
  }
});

export default router;
