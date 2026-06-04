/**
 * Canonical trade close P&L — user screen, wallet (prepaid crypto), and patti share one base.
 */

export function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Entry INR-display vs exit USDT tick — align to entry scale before gross P&L. */
export function cryptoPricesNeedInrAlignment(trade, entry, exit) {
  if (!trade?.isCrypto && trade?.exchange !== 'BINANCE') return false;
  if (!(entry > 0) || !(exit > 0)) return false;
  const ratio = entry / exit;
  return entry > 5000 && exit < entry * 0.2 && ratio >= 50 && ratio <= 200;
}

export function alignCryptoExitToEntryUnit(trade, exitPrice) {
  const entry = Number(trade?.entryPrice);
  let exit = Number(exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0 || exit <= 0) {
    return exitPrice;
  }
  if (cryptoPricesNeedInrAlignment(trade, entry, exit)) {
    return roundMoney(exit * (entry / exit));
  }
  return exit;
}

/** User gross from stored close prices (Orders UI card). */
export function computeUserGrossClosePnL(trade) {
  if (!trade) return 0;
  const qty = Number(trade.quantity) || 0;
  const entry = Number(trade.entryPrice);
  const exit = Number(trade.exitPrice ?? trade.effectiveExitPrice);
  if (!qty || !Number.isFinite(entry) || !Number.isFinite(exit)) return 0;
  const mult = trade.side === 'BUY' ? 1 : -1;
  return roundMoney((exit - entry) * mult * qty);
}

/** Prefer price-based gross; fix legacy rows that stored loss as positive magnitude. */
export function reconcileStoredGrossPnL(trade) {
  const screen = computeUserGrossClosePnL(trade);
  const raw = trade?.realizedPnL ?? trade?.pnl;
  const stored = Number(raw);
  if (!Number.isFinite(stored)) return screen;
  const s = roundMoney(stored);
  if (Math.abs(screen - s) <= 0.02) return s;
  if (Math.abs(screen + s) <= 0.02 && screen !== 0) return screen;
  return screen;
}

export function isPrepaidSubwalletTrade(trade) {
  if (trade?.brokeragePrepaidRoundTrip === false) return false;
  return (
    trade?.isCrypto ||
    trade?.isForex ||
    trade?.exchange === 'BINANCE' ||
    trade?.exchange === 'FOREX'
  );
}

/** Net credited to wallet at close (prepaid crypto/forex books gross only). */
export function computeUserNetClosePnL(trade, gross) {
  const g = roundMoney(gross);
  const charges = chargeTotal(trade);
  const computed = roundMoney(g - charges);
  const stored = Number(trade?.netPnL);
  const commission = Math.max(0, Number(trade?.commission) || 0);

  if (isPrepaidSubwalletTrade(trade)) {
    return g;
  }

  if (Number.isFinite(stored) && Math.abs(stored - computed) <= 0.02) {
    return roundMoney(stored);
  }
  // Legacy bug: net saved as |gross| + commission while gross was positive
  if (g < 0 && stored > 0 && commission > 0 && Math.abs(stored - (Math.abs(g) + commission)) < 0.02) {
    return computed;
  }
  return computed;
}

/** Informational: signed P&L plus round-trip brokerage already debited on open. */
export function computeTotalEconomicImpact(trade, gross) {
  const g = roundMoney(gross);
  const commission = Math.max(0, Number(trade?.commission) || 0);
  if (!commission) return g;
  if (isPrepaidSubwalletTrade(trade)) {
    return roundMoney(g - commission);
  }
  const charges = chargeTotal(trade);
  if (charges > 0) return roundMoney(g - charges);
  return roundMoney(g - commission);
}

/** B_BOOK patti pool = opposite of user gross (matches card, not inflated net/admin fields). */
export function computeAdminBookPoolForPatti(trade) {
  if (!trade || trade.bookType !== 'B_BOOK') return 0;
  return roundMoney(-computeUserGrossClosePnL(trade));
}

export function chargeTotal(trade) {
  const c = trade?.charges;
  if (!c) return 0;
  if (typeof c.total === 'number' && Number.isFinite(c.total)) return c.total;
  return (
    (Number(c.exchange) || 0) +
    (Number(c.gst) || 0) +
    (Number(c.stt) || 0) +
    (Number(c.sebi) || 0) +
    (Number(c.stamp) || 0)
  );
}

/** Crypto/forex qty is total units — do not multiply lotSize again. */
export function positionPnLMultiplier(position) {
  if (
    position?.isCrypto ||
    position?.isForex ||
    position?.exchange === 'BINANCE' ||
    position?.exchange === 'FOREX'
  ) {
    return 1;
  }
  const seg = String(position?.segment || position?.displaySegment || '').toUpperCase();
  if (['CRYPTOFUT', 'CRYPTOOPT', 'FOREXFUT', 'FOREXOPT'].includes(seg)) {
    return 1;
  }
  const cs = Number(position?.contractSize);
  const ls = Number(position?.lotSize);
  if (Number.isFinite(cs) && cs > 0) return cs;
  if (Number.isFinite(ls) && ls > 1) return ls;
  return 1;
}

/** Qty for P&L — crypto qty-mode uses `quantity` / `originalQty`, never lots × lotSize. */
export function resolveTradeCloseQuantity(trade) {
  if (!trade) return 0;
  const seg = String(trade?.segment || trade?.displaySegment || '').toUpperCase();
  const isQtyMode =
    trade?.isCrypto ||
    trade?.isForex ||
    trade?.exchange === 'BINANCE' ||
    trade?.exchange === 'FOREX' ||
    ['CRYPTOFUT', 'CRYPTOOPT', 'FOREXFUT', 'FOREXOPT'].includes(seg);

  const q = Number(trade?.quantity);
  const oq = Number(trade?.originalQty);
  const lots = Number(trade?.lots);
  const lotSize = Number(trade?.lotSize) || 1;

  if (isQtyMode) {
    if (Number.isFinite(q) && q > 0) return q;
    if (Number.isFinite(oq) && oq > 0) return oq;
    if (Number.isFinite(lots) && lots > 0) return lots;
    return 0;
  }

  if (Number.isFinite(q) && q > 0) return q;
  if (Number.isFinite(lots) && lots > 0) return lots * (lotSize > 0 ? lotSize : 1);
  if (Number.isFinite(oq) && oq > 0) return oq;
  return 0;
}

/** Mark-to-market / autosquare P&L — same unit as entryPrice (aligns crypto exit tick). */
export function computeMarkToMarketPnL(trade, markPrice, qtyOverride) {
  if (!trade) return 0;
  const qty =
    qtyOverride != null && qtyOverride !== ''
      ? Number(qtyOverride)
      : resolveTradeCloseQuantity(trade);
  const entry = Number(trade?.entryPrice);
  const exit = alignCryptoExitToEntryUnit(trade, markPrice);
  if (!(qty > 0) || !Number.isFinite(entry) || !Number.isFinite(exit)) return 0;
  const sideMult = trade.side === 'BUY' ? 1 : -1;
  return roundMoney((exit - entry) * sideMult * qty * positionPnLMultiplier(trade));
}

/** Autosquare card P&L — prefer price-based when stored snapshot is stale/wrong scale. */
export function reconcileAutosquarePnL(trade, markPrice, storedPnL, qtyOverride) {
  const screen = computeMarkToMarketPnL(trade, markPrice, qtyOverride);
  const stored = Number(storedPnL);
  if (!Number.isFinite(stored)) return screen;
  const s = roundMoney(stored);
  if (Math.abs(screen - s) <= 0.02) return s;
  if (Math.abs(screen + s) <= 0.02 && screen !== 0) return screen;
  if (Math.abs(screen) > 0 && Math.abs(s) > Math.abs(screen) * 1.25) return screen;
  return screen;
}

export function computePositionPnL(position, currentPrice) {
  const price = Number(currentPrice) || Number(position?.currentPrice) || Number(position?.entryPrice) || 0;
  const quantity = Number(position?.quantity) || 0;
  const entryPrice = Number(position?.entryPrice) || 0;
  const mult = positionPnLMultiplier(position);
  if (position?.side === 'BUY') {
    return roundMoney((price - entryPrice) * quantity * mult);
  }
  return roundMoney((entryPrice - price) * quantity * mult);
}
