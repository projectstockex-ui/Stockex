/** Resolve live LTP for a saved price alert from marketData ticks. */
export function resolveLtpForPriceAlert(marketData, alert) {
  if (!marketData || typeof marketData !== 'object' || !alert) return 0;

  const pickLtp = (row) => {
    if (!row) return 0;
    const n = Number(row.ltp ?? row.close ?? row.last_price);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  if (alert.isCrypto || String(alert.exchange || '').toUpperCase() === 'BINANCE') {
    const keys = [alert.pair, alert.symbol, alert.token].filter(
      (v) => v != null && String(v).trim() !== ''
    );
    for (const raw of keys) {
      const s = String(raw).trim();
      for (const k of [s, s.toUpperCase(), s.toLowerCase()]) {
        const ltp = pickLtp(marketData[k]);
        if (ltp > 0) return ltp;
      }
    }
    return 0;
  }

  if (alert.token != null && alert.token !== '') {
    const s = String(alert.token);
    const ltp = pickLtp(marketData[s] ?? marketData[Number.parseInt(s, 10)]);
    if (ltp > 0) return ltp;
  }

  const sym = String(alert.symbol || '').trim().toUpperCase();
  const tsym = String(alert.tradingSymbol || '').trim().toUpperCase();
  if (!sym && !tsym) return 0;

  const rows = Object.values(marketData);
  const byTs = rows.find(
    (r) => tsym && String(r?.tradingSymbol || '').trim().toUpperCase() === tsym
  );
  if (byTs) return pickLtp(byTs);
  const bySym = rows.find((r) => sym && String(r?.symbol || '').trim().toUpperCase() === sym);
  return pickLtp(bySym);
}

/** True when LTP crosses or touches alert price (tick-safe). */
export function isPriceAlertHit(prevLtp, ltp, alertPrice) {
  const target = Number(alertPrice);
  const now = Number(ltp);
  const prev = Number(prevLtp);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(now) || now <= 0) return false;

  const tol = Math.max(0.01, target * 0.00005);
  if (Math.abs(now - target) <= tol) return true;
  if (!Number.isFinite(prev) || prev <= 0) return false;

  const prevDiff = prev - target;
  const nowDiff = now - target;
  return prevDiff !== 0 && nowDiff !== 0 && prevDiff * nowDiff <= 0;
}
