/** Timestamp for merge priority (prefer fresher Zerodha websocket rows). */
export function marketTickTimestampMs(row) {
  if (!row) return 0;
  const ts = Number(row.serverTimestamp);
  if (Number.isFinite(ts) && ts > 0) return ts;
  const parsed = new Date(row.lastUpdated || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function marketTickRowChanged(before, after) {
  if (!before) return !!after;
  if (!after) return false;
  const fields = ['ltp', 'last_price', 'bid', 'ask', 'rawBid', 'rawAsk', 'change', 'changePercent'];
  return fields.some((f) => Number(before[f]) !== Number(after[f]));
}

/**
 * Merge incoming quote into marketData.
 * Live `zerodha_tick` wins over HTTP poll / DB snapshot when fresh.
 */
export function mergeMarketTickRow(existing, incoming) {
  if (!incoming || typeof incoming !== 'object') return existing;
  if (!existing) return incoming;

  const existingTs = marketTickTimestampMs(existing);
  const incomingTs = marketTickTimestampMs(incoming);
  const incomingIsDbSnapshot = incoming.source === 'instrument_snapshot_fallback';
  const incomingIsPoll = incoming.source === 'market_data_poll';
  const existingIsLive = existing.source === 'zerodha_tick';
  const existingHasLiveLtp = Number(existing.ltp ?? existing.last_price) > 0;

  if (
    incomingIsDbSnapshot &&
    existingHasLiveLtp &&
    existingTs > 0 &&
    Date.now() - existingTs < 120_000
  ) {
    return existing;
  }

  if (incomingIsPoll && existingIsLive && existingTs > 0 && Date.now() - existingTs < 8000) {
    return existing;
  }

  return incomingTs >= existingTs ? { ...existing, ...incoming } : existing;
}

export function applyMarketTickBatch(prev, batch) {
  if (!batch || typeof batch !== 'object') return prev;
  let changed = false;
  const next = { ...prev };
  for (const [k, row] of Object.entries(batch)) {
    const merged = mergeMarketTickRow(prev[k], row);
    if (merged !== prev[k] && marketTickRowChanged(prev[k], merged)) {
      next[k] = merged;
      changed = true;
    }
  }
  return changed ? next : prev;
}
