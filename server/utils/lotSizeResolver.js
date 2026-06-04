/**
 * Resolve exchange contract lot size from symbol / tradingSymbol (MCX, NSE F&O).
 * Used when Instrument.lotSize is missing or defaulted to 1.
 */

export function deriveUnderlyingSymbol(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  const noSuffix = s.replace(/(?:FUT|CE|PE)$/i, '');
  const dated = noSuffix.match(/^([A-Z]+?)(?:[FGHJKMNQUVXZ])?\d{1,2}[A-Z]{3}/i);
  if (dated?.[1]) return dated[1];
  const alphaPrefix = noSuffix.match(/^[A-Z]+/);
  if (alphaPrefix?.[0]) return alphaPrefix[0];
  const fallback = s.match(/^[A-Z]+/);
  return fallback?.[0] || '';
}

/** @returns {number} contract units per lot (>= 1) */
export function resolveLotSizeFromSymbol({ symbol, tradingSymbol, exchange, category }) {
  const base = deriveUnderlyingSymbol(tradingSymbol || symbol);
  const sym = (base || symbol || '').toUpperCase();
  const exch = String(exchange || '').toUpperCase();
  const cat = String(category || '').toUpperCase();

  if (exch === 'MCX' || cat === 'MCX' || sym.includes('CRUDEOIL') || sym.includes('GOLD') || sym.includes('SILVER')) {
    if (sym.includes('GOLDM') || sym.startsWith('GOLDM')) return 10;
    if (sym.includes('GOLDGUINEA')) return 1;
    if (sym.includes('GOLDPETAL')) return 1;
    if (sym.includes('SILVERM') || sym.startsWith('SILVERM')) return 5;
    if (sym.includes('SILVERMIC')) return 1;
    if (sym.includes('CRUDEOILM') || sym.startsWith('CRUDEOILM')) return 10;
    if (sym.includes('GOLD')) return 100;
    if (sym.includes('SILVER')) return 30;
    if (sym.includes('CRUDEOIL') || sym === 'CRUDE') return 100;
    if (sym.includes('NATURALGAS')) return 1250;
    if (sym.includes('COPPER')) return 2500;
    if (sym.includes('ZINC')) return 5000;
    if (sym.includes('ALUMINIUM')) return 5000;
    if (sym.includes('LEAD')) return 5000;
    if (sym.includes('NICKEL')) return 1500;
  }

  if (cat) {
    if (cat.includes('NIFTY') && !cat.includes('BANK') && !cat.includes('FIN') && !cat.includes('MID')) return 25;
    if (cat.includes('BANKNIFTY')) return 15;
    if (cat.includes('FINNIFTY')) return 25;
    if (cat.includes('MIDCPNIFTY')) return 50;
  }

  if (sym.includes('BANKNIFTY')) return 15;
  if (sym.includes('FINNIFTY')) return 25;
  if (sym.includes('MIDCPNIFTY')) return 50;
  if (sym.includes('NIFTY')) return 25;
  if (sym.includes('SENSEX')) return 10;
  if (sym.includes('BANKEX')) return 15;

  return 1;
}

/**
 * Prefer DB lot when > 1; otherwise symbol-based exchange lot.
 */
export function resolveContractLotSize(instrument, orderData = {}) {
  const segU = String(orderData?.segment || instrument?.displaySegment || instrument?.segment || '').toUpperCase();
  if (segU === 'CRYPTOFUT' || segU === 'CRYPTOOPT') return 1;

  const dbLot = instrument?.lotSize > 0 ? Number(instrument.lotSize) : 0;
  const bodyLot = orderData?.lotSize > 0 ? Number(orderData.lotSize) : 0;

  if (dbLot > 1) return dbLot;
  if (bodyLot > 1) return bodyLot;

  const fromSymbol = resolveLotSizeFromSymbol({
    symbol: orderData?.symbol || instrument?.symbol,
    tradingSymbol: orderData?.tradingSymbol || instrument?.tradingSymbol,
    exchange: orderData?.exchange || instrument?.exchange,
    category: orderData?.category || instrument?.category,
  });

  if (fromSymbol > 1) return fromSymbol;
  return dbLot || bodyLot || 1;
}
