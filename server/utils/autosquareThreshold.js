/**
 * Intraday autosquare threshold (segment autosquarePercent).
 * End-time carry-forward uses carryForwardLeverage separately (eodSettlement.js).
 */

/** Read autosquare % from merged segment settings (lot or quantity mode). */
export function resolveAutosquarePercentFromSettings(segmentSettings, user = null) {
  const lot = segmentSettings?.lotSettings || {};
  const qty = segmentSettings?.quantityModeSettings || {};
  if (lot.autosquarePercent != null && Number.isFinite(Number(lot.autosquarePercent))) {
    return clampPercent(Number(lot.autosquarePercent));
  }
  if (qty.autosquarePercent != null && Number.isFinite(Number(qty.autosquarePercent))) {
    return clampPercent(Number(qty.autosquarePercent));
  }
  const userPct = Number(user?.settings?.ledgerBalanceClosePercent);
  if (Number.isFinite(userPct) && userPct >= 0 && userPct <= 100) return userPct;
  return 90;
}

function clampPercent(n) {
  return Math.min(100, Math.max(0, Number(n) || 0));
}

/**
 * Crypto/forex intraday autosquare: loss % vs wallet reference (cash), not cash+usedMargin.
 * realBalance = cash + open MTM (what the user sees as equity).
 */
export function resolveCashLedgerAutosquareMetrics({ cashBalance, referenceBalance, totalMtm }) {
  const cash = Math.max(0, Number(cashBalance) || 0);
  const refStored = Math.max(0, Number(referenceBalance) || 0);
  const reference = refStored > 0 ? Math.max(refStored, cash) : cash;
  const equityBasis = reference > 0 ? reference : cash;
  const realBalance = Math.round((cash + (Number(totalMtm) || 0)) * 100) / 100;
  return { equityBasis, realBalance, referenceBalance: reference };
}

/** Loss as % of equity basis (legacy NSE/MCX: basis may include usedMargin). */
export function computeEquityLossPercent(equityBasis, realBalance) {
  const basis = Math.max(0, Number(equityBasis) || 0);
  if (basis <= 0) return 0;
  const real = Number(realBalance);
  if (!Number.isFinite(real)) return 0;
  const loss = Math.max(0, basis - real);
  return Math.round((loss / basis) * 10000) / 100;
}

/**
 * Intraday autosquare trigger — fires when equity loss >= autosquarePercent.
 * Does NOT use available margin <= 0 (that caused premature crypto cuts).
 */
export function evaluateIntradayAutosquareTrigger({
  equityBasis,
  realBalance,
  autosquarePercent,
}) {
  const pct = clampPercent(autosquarePercent ?? 90);
  const lossPercent = computeEquityLossPercent(equityBasis, realBalance);

  if (lossPercent >= pct) {
    return {
      trigger: true,
      reason: `INTRADAY_AUTOSQUARE_${pct}%`,
      lossPercent,
      autosquarePercent: pct,
    };
  }

  if (Number(realBalance) <= 0.01 && lossPercent >= 99) {
    return {
      trigger: true,
      reason: 'EQUITY_DEPLETED',
      lossPercent,
      autosquarePercent: pct,
    };
  }

  return {
    trigger: false,
    reason: null,
    lossPercent,
    autosquarePercent: pct,
  };
}

/** @deprecated Use evaluateIntradayAutosquareTrigger; kept for legacy imports. */
export function shouldTriggerLedgerAutosquare(availableMargin) {
  return Number(availableMargin) <= 0.01;
}
