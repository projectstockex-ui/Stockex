/**
 * Net carry-forward: same user + symbol + side processed as one position at session end.
 */

export function buildNetCarryGroupKey(trade) {
  const userKey = String(trade.user || '');
  const userId = String(trade.userId || '');
  const sym = String(trade.symbol || '').trim().toUpperCase();
  const side = String(trade.side || '').toUpperCase();
  return `${userKey}|${userId}|${sym}|${side}`;
}

export function tradeQtyAtCarryEvent(trade) {
  if (trade.originalQty != null && Number(trade.originalQty) > 0) {
    return Number(trade.originalQty);
  }
  return Number(trade.quantity) || Number(trade.lots) || 0;
}

/** Split total next-day qty across legs proportionally (sums exactly to totalNext). */
export function allocateProportionalNextDay(totalNext, qtyList) {
  const total = qtyList.reduce((s, x) => s + Math.max(0, Math.floor(Number(x.qty) || 0)), 0);
  const target = Math.max(0, Math.floor(Number(totalNext) || 0));
  if (total <= 0 || !qtyList.length) {
    return qtyList.map((x) => ({ ...x, alloc: 0 }));
  }
  let used = 0;
  return qtyList.map((item, i) => {
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    if (i === qtyList.length - 1) {
      return { ...item, alloc: Math.max(0, Math.min(qty, target - used)) };
    }
    const alloc = Math.min(qty, Math.floor((target * qty) / total));
    used += alloc;
    return { ...item, alloc };
  });
}

export function groupTradesForNetCarry(trades) {
  const map = new Map();
  for (const t of trades) {
    const key = buildNetCarryGroupKey(t);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}
