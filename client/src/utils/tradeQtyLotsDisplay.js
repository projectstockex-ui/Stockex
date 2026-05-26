/** True when trade is options (MCXOPT, NSEOPT, CE/PE, symbol …OPT). */
export function isOptionsTrade(row = {}) {
  const seg = String(row.segment || row.displaySegment || '').toUpperCase();
  const sym = String(row.symbol || row.tradingSymbol || '').toUpperCase();
  const it = String(row.instrumentType || '').toUpperCase();
  if (row.optionType) return true;
  if (it === 'OPTIONS') return true;
  if (seg.includes('OPT')) return true;
  if (sym.endsWith('OPT')) return true;
  return false;
}

/** True when trade is futures (MCXFUT, NSEFUT, …FUT symbol). */
export function isFuturesTrade(row = {}) {
  if (isOptionsTrade(row)) return false;
  const seg = String(row.segment || '').toUpperCase();
  const sym = String(row.symbol || '').toUpperCase();
  const it = String(row.instrumentType || '').toUpperCase();
  if (it === 'FUTURES') return true;
  if (seg.includes('FUT') && !seg.includes('OPT')) return true;
  if (sym.endsWith('FUT')) return true;
  return false;
}

/**
 * MCX / F&O ledger cells: futures → Qty column; options → Lots column.
 * @returns {{ qtyText: string, lotsText: string }}
 */
export function getTradeQtyLotsDisplay(row = {}) {
  const qty = Number(row.quantity);
  const lots = Number(row.lots);
  const lotSize = Number(row.lotSize) > 0 ? Number(row.lotSize) : 1;

  if (isOptionsTrade(row)) {
    const displayLots =
      Number.isFinite(lots) && lots > 0
        ? lots
        : Number.isFinite(qty) && qty > 0
          ? qty / lotSize
          : null;
    const lotsLabel =
      displayLots != null
        ? `${Number(displayLots).toLocaleString('en-IN', { maximumFractionDigits: 4 })} lot${
            displayLots === 1 ? '' : 's'
          }`
        : '—';
    return { qtyText: '—', lotsText: lotsLabel };
  }

  const displayQty =
    Number.isFinite(qty) && qty > 0
      ? qty
      : Number.isFinite(lots) && lots > 0
        ? lots
        : null;

  const qtyLabel =
    displayQty != null
      ? Number(displayQty).toLocaleString('en-IN', { maximumFractionDigits: 4 })
      : '—';

  return { qtyText: qtyLabel, lotsText: '—' };
}

/** Single-column label for compact lists (Orders page cards). */
export function formatTradeSizeLabel(row = {}) {
  const { qtyText, lotsText } = getTradeQtyLotsDisplay(row);
  if (lotsText !== '—') return lotsText;
  if (qtyText !== '—') return `${qtyText} qty`;
  return '—';
}
