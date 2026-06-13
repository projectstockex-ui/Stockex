/**
 * Trading utility functions for AdminDashboard
 */
import axios from '../../../../config/axios';

/** Human-readable label for a running Zerodha sync job. */
export function formatZerodhaSyncProgress(job) {
  const pct = Math.round(Number(job?.progress) || 0);
  const msg = job?.message || 'Syncing…';
  return pct > 0 ? `${msg} (${pct}%)` : msg;
}

/** Polls background Zerodha reset-and-sync until completed/failed (POST returns 202/409). */
export async function pollZerodhaResetSyncResult(authToken, statusUrl, options = {}) {
  const intervalMs = options.intervalMs ?? 2000;
  const maxAttempts = options.maxAttempts ?? 300;
  const pollUrl = statusUrl || '/api/zerodha/sync/jobs';
  const onProgress = options.onProgress;

  const normalizeResult = (jobData) => {
    const payload = jobData?.result ?? null;
    if (payload?.result && typeof payload.result === 'object') return payload.result;
    return payload;
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { data } = await axios.get(pollUrl, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const job = Array.isArray(data?.jobs)
        ? data.jobs.find((j) => j?.status === 'running') || data.jobs[0]
        : data;

      if (!job) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }

      if (job.status === 'running' && onProgress) {
        onProgress(job);
      }

      if (job.status === 'completed') {
        const normalized = normalizeResult(job);
        if (normalized) return normalized;
        throw new Error('Sync completed but result payload is missing');
      }

      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.error?.message || job.error || job.message || 'Reset & sync failed');
      }
    } catch (error) {
      if (error?.response?.status !== 404) throw error;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    'Reset & sync is still running after a long wait. Check server logs or refresh later.',
  );
}

/** POST a background Zerodha sync endpoint and poll until completion. */
export async function runZerodhaBackgroundSync(authToken, postUrl, options = {}) {
  const headers = { Authorization: `Bearer ${authToken}` };
  const pollOpts = { onProgress: options.onProgress };

  try {
    const res = await axios.post(postUrl, {}, { headers });

    if (res.status === 202 && res.data?.statusUrl) {
      return pollZerodhaResetSyncResult(authToken, res.data.statusUrl, pollOpts);
    }

    if (
      res.data?.counts != null ||
      res.data?.deleted !== undefined ||
      res.data?.added !== undefined ||
      res.data?.totalInDatabase != null
    ) {
      return res.data;
    }

    throw new Error('Unexpected sync response');
  } catch (err) {
    if (err.response?.status === 409 && authToken) {
      return pollZerodhaResetSyncResult(
        authToken,
        err.response?.data?.statusUrl || '/api/zerodha/sync/jobs',
        pollOpts,
      );
    }
    throw err;
  }
}

/**
 * GAME_PROFIT: server sends displaySharePercent; client fallbacks for cached/offline.
 * @param {object} entry - Ledger entry
 * @returns {string} Formatted share percentage
 */
export function formatLedgerSharePercent(entry) {
  if (entry?.displaySharePercent) return entry.displaySharePercent;
  if (entry?.reason !== 'GAME_PROFIT') return '—';

  const p = entry?.sharePercentResolved ?? entry?.meta?.sharePercent;
  if (p != null && Number.isFinite(Number(p))) {
    return `${Number(p).toFixed(2)}%`;
  }

  const base = entry?.meta?.baseAmount;
  const amt = entry?.amount;
  if (base != null && Number.isFinite(Number(base)) && Number(base) > 0 && Number.isFinite(Number(amt))) {
    return `${((Number(amt) / Number(base)) * 100).toFixed(2)}%`;
  }

  const desc = String(entry?.description || '');
  const m =
    desc.match(/\((\d+\.?\d*)\s*%\s*of/) ||
    desc.match(/(\d+\.?\d*)\s*%\s*of/i);
  if (m) return `${parseFloat(m[1], 10).toFixed(2)}%`;

  return '—';
}

/**
 * Create empty instrument trading form
 * @returns {object} Empty trading form object
 */
export function emptyInstrumentTradingForm() {
  return {
    enabled: false,
    blockTrading: false,
    notes: '',
    maxIntradayLeverage: '',
    maxCarryLeverage: '',
    brokerage: {
      intradayFuture: '',
      carryFuture: '',
      optionBuyIntraday: '',
      optionBuyCarry: '',
      optionSellIntraday: '',
      optionSellCarry: '',
    },
    fixedMargin: {
      intradayFuture: '',
      carryFuture: '',
      optionBuyIntraday: '',
      optionBuyCarry: '',
      optionSellIntraday: '',
      optionSellCarry: '',
    },
    lotSettings: {
      maxLots: '',
      minLots: '',
      perOrderLots: '',
    },
    spread: { buy: '', sell: '' },
    additionalCharges: {
      perTradeInr: '',
      perLotInr: '',
      perCroreInr: '',
      perTradeEnabled: false,
      perLotEnabled: false,
      perCroreEnabled: false,
      perTradeUnit: 'COINS',
      perLotUnit: 'COINS',
      perCroreUnit: 'PERCENT',
      extraCommissionUnit: 'COINS',
    },
  };
}

/**
 * Convert instrument data to trading form
 * @param {object} inst - Instrument object
 * @returns {object} Trading form object
 */
export function instrumentToTradingForm(inst) {
  const f = emptyInstrumentTradingForm();
  const td = inst?.tradingDefaults;
  if (!td) return f;

  /** Normalize DB numbers / BSON for controlled inputs */
  const s = (n) => {
    if (n == null || n === '') return '';
    const v = typeof n === 'object' && n != null && typeof n.valueOf === 'function' ? n.valueOf() : n;
    const num = Number(v);
    return Number.isFinite(num) ? String(num) : '';
  };

  f.enabled = !!td.enabled;
  f.blockTrading = !!td.blockTrading;
  f.notes = td.notes || '';
  f.maxIntradayLeverage = s(td.maxIntradayLeverage);
  f.maxCarryLeverage = s(td.maxCarryLeverage);

  const bk = ['intradayFuture', 'carryFuture', 'optionBuyIntraday', 'optionBuyCarry', 'optionSellIntraday', 'optionSellCarry'];
  for (const k of bk) {
    f.brokerage[k] = s(td.brokerage?.[k]);
    f.fixedMargin[k] = s(td.fixedMargin?.[k]);
  }

  f.lotSettings.maxLots = s(td.lotSettings?.maxLots);
  f.lotSettings.minLots = s(td.lotSettings?.minLots);
  f.lotSettings.perOrderLots = s(td.lotSettings?.perOrderLots);
  f.spread.buy = s(td.spread?.buy);
  f.spread.sell = s(td.spread?.sell);

  f.additionalCharges.perTradeInr = s(td.additionalCharges?.perTradeInr);
  f.additionalCharges.perLotInr = s(td.additionalCharges?.perLotInr);
  f.additionalCharges.perCroreInr = s(td.additionalCharges?.perCroreInr);

  const ac = td.additionalCharges || {};
  const legacyToggles =
    ac.perTradeEnabled == null && ac.perLotEnabled == null && ac.perCroreEnabled == null;
  const ptN = Number(ac.perTradeInr);
  const plN = Number(ac.perLotInr);
  const pcN = Number(ac.perCroreInr);

  f.additionalCharges.perTradeEnabled = legacyToggles
    ? Number.isFinite(ptN) && ptN > 0
    : !!ac.perTradeEnabled;
  f.additionalCharges.perLotEnabled = legacyToggles
    ? Number.isFinite(plN) && plN > 0
    : !!ac.perLotEnabled;
  f.additionalCharges.perCroreEnabled = legacyToggles
    ? Number.isFinite(pcN) && pcN > 0
    : !!ac.perCroreEnabled;

  f.additionalCharges.extraCommissionUnit =
    ac.extraCommissionUnit === 'PERCENT' ? 'PERCENT' : 'INR';
  f.additionalCharges.perTradeUnit =
    ac.perTradeUnit === 'PERCENT' ? 'PERCENT' : 'INR';
  f.additionalCharges.perLotUnit = ac.perLotUnit === 'PERCENT' ? 'PERCENT' : 'INR';
  f.additionalCharges.perCroreUnit =
    ac.perCroreUnit === 'INR'
      ? 'INR'
      : ac.perCroreUnit === 'PERCENT'
        ? 'PERCENT'
        : ac.extraCommissionUnit === 'PERCENT'
          ? 'PERCENT'
          : 'INR';

  return f;
}

/**
 * Serialize instrument trading form for API
 * @param {object} form - Trading form object
 * @returns {object} Serialized form object
 */
export function serializeInstrumentTradingForm(form) {
  const n = (v) => {
    if (v === '' || v == null) return null;
    const x = parseFloat(String(v).trim());
    return Number.isFinite(x) ? x : null;
  };

  const keys = ['intradayFuture', 'carryFuture', 'optionBuyIntraday', 'optionBuyCarry', 'optionSellIntraday', 'optionSellCarry'];
  const brokerage = {};
  const fixedMargin = {};

  for (const k of keys) {
    brokerage[k] = n(form.brokerage?.[k]);
    fixedMargin[k] = n(form.fixedMargin?.[k]);
  }

  return {
    enabled: !!form.enabled,
    blockTrading: !!form.blockTrading,
    notes: (form.notes || '').trim(),
    maxIntradayLeverage: n(form.maxIntradayLeverage),
    maxCarryLeverage: n(form.maxCarryLeverage),
    brokerage,
    fixedMargin,
    lotSettings: {
      maxLots: n(form.lotSettings?.maxLots),
      minLots: n(form.lotSettings?.minLots),
      perOrderLots: n(form.lotSettings?.perOrderLots),
    },
    spread: {
      buy: n(form.spread?.buy),
      sell: n(form.spread?.sell),
    },
    additionalCharges: {
      perTradeInr: n(form.additionalCharges?.perTradeInr),
      perLotInr: n(form.additionalCharges?.perLotInr),
      perCroreInr: n(form.additionalCharges?.perCroreInr),
      perTradeEnabled: !!form.additionalCharges?.perTradeEnabled,
      perLotEnabled: !!form.additionalCharges?.perLotEnabled,
      perCroreEnabled: !!form.additionalCharges?.perCroreEnabled,
      perTradeUnit: 'COINS',
      perLotUnit: 'COINS',
      perCroreUnit: 'PERCENT',
    },
  };
}

/**
 * Extra charge type metadata for trading forms
 */
export const EXTRA_CHARGE_TYPE_META = [
  {
    type: 'PER_TRADE',
    inrKey: 'perTradeInr',
    enKey: 'perTradeEnabled',
    label: 'Per trade',
    step: '0.01',
    suffix: '',
    shortHint: 'Flat fee each time an order completes',
  },
  {
    type: 'PER_LOT',
    inrKey: 'perLotInr',
    enKey: 'perLotEnabled',
    label: 'Per lot',
    step: '0.01',
    suffix: '',
    shortHint: 'Charged per lot traded',
  },
  {
    type: 'PER_CRORE',
    inrKey: 'perCroreInr',
    enKey: 'perCroreEnabled',
    label: 'Per crore',
    step: '0.01',
    suffix: '%',
    shortHint: '% of turnover value',
  },
];
