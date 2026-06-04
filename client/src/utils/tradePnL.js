/** Client P&L from stored entry/exit/qty — matches wallet close for crypto qty-mode. */

export function roundTradePnL(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function computeTradePricePnL(trade, exitPrice, qtyOverride) {
  if (!trade) return 0;
  const qty = Number(qtyOverride ?? trade.originalQty ?? trade.quantity) || 0;
  const entry = Number(trade.entryPrice);
  const exit = Number(exitPrice ?? trade.exitPrice ?? trade.autoSquareLtp ?? trade.currentPrice);
  if (!(qty > 0) || !Number.isFinite(entry) || !Number.isFinite(exit)) return 0;
  const mult = trade.side === 'BUY' ? 1 : -1;
  return roundTradePnL((exit - entry) * mult * qty);
}

/** Autosquare / closed card — prefer price math when stored snapshot is inflated. */
export function resolveTradeDisplayPnL(trade) {
  if (!trade) return 0;
  const mark =
    trade.autoSquareLtp ??
    trade.exitPrice ??
    trade.effectiveExitPrice ??
    trade.currentPrice;
  const qty = trade.originalQty ?? trade.quantity;
  const fromPrices = computeTradePricePnL(trade, mark, qty);
  const stored = Number(trade.pnlAtAutoSquare ?? trade.realizedPnL ?? trade.netPnL ?? trade.pnl);
  if (!Number.isFinite(stored)) return fromPrices;
  if (Math.abs(fromPrices - stored) <= 0.02) return roundTradePnL(stored);
  if (Math.abs(fromPrices + stored) <= 0.02 && fromPrices !== 0) return fromPrices;
  if (Math.abs(fromPrices) > 0 && Math.abs(stored) > Math.abs(fromPrices) * 1.25) return fromPrices;
  return roundTradePnL(stored);
}
