/**
 * Sub-wallet cash rules (Crypto, Forex, MCX, NSE/BSE):
 * - Open: lock margin in usedMargin only; debit round-trip brokerage from balance once.
 * - Close (prepaid FUT): apply gross price P&L to balance; release margin from usedMargin only.
 */

export function isCryptoForexTrade(tradeOrOrder = {}) {
  if (tradeOrOrder.isCrypto) return true;
  if (tradeOrOrder.isForex) return true;
  const ex = String(tradeOrOrder.exchange || '').toUpperCase();
  if (ex === 'BINANCE' || ex === 'FOREX') return true;
  const seg = String(tradeOrOrder.segment || '').toUpperCase();
  return ['CRYPTOFUT', 'CRYPTOOPT', 'FOREX', 'FOREXFUT', 'FOREXOPT'].includes(seg);
}

export function isMcxTrade(tradeOrOrder = {}) {
  const ex = String(tradeOrOrder.exchange || '').toUpperCase();
  const seg = String(tradeOrOrder.segment || '').toUpperCase();
  return ex === 'MCX' || seg === 'MCX' || seg === 'MCXFUT' || seg === 'MCXOPT';
}

/** Any dedicated segment wallet (not legacy-only paths). */
export function isSubwalletCashTrade(tradeOrOrder = {}) {
  return (
    isCryptoForexTrade(tradeOrOrder) ||
    isMcxTrade(tradeOrOrder) ||
    tradeOrOrder.isCrypto ||
    tradeOrOrder.isForex
  );
}

/** Prepaid FUT: balance books gross price P&L at close (brokerage already debited on open). */
export function subwalletCloseBalancePnL(trade, grossPnL, netPnL) {
  const prepaid = trade?.brokeragePrepaidRoundTrip !== false;
  if (prepaid) {
    return Number(grossPnL) || 0;
  }
  return Number(netPnL) || 0;
}

/**
 * Amount to release from usedMargin on close.
 * New trades: margin only (brokerage was balance-debited on open).
 * Legacy: also release brokerage if it was reserved in usedMargin and never debited from balance.
 */
export function subwalletMarginReleaseOnClose(trade) {
  const margin = Number(trade?.marginUsed) || 0;
  if (!trade?.brokerageReservedInMargin || trade?.walletBrokerageDebited) {
    return margin;
  }
  const brokerageRelease = Number(trade?.commission) || 0;
  return margin + brokerageRelease;
}
