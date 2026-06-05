/** @typedef {'nseBse' | 'mcx' | 'games' | 'crypto' | 'forex'} WalletBlockType */

export const WALLET_BLOCK_TYPES = {
  nseBse: { field: 'nseBseWallet', label: 'NSE & BSE' },
  mcx: { field: 'mcxWallet', label: 'MCX' },
  games: { field: 'gamesWallet', label: 'Games Wallet' },
  crypto: { field: 'cryptoWallet', label: 'Crypto Wallet' },
  forex: { field: 'forexWallet', label: 'Forex Wallet' },
};

export const WALLET_BLOCK_TYPE_KEYS = Object.keys(WALLET_BLOCK_TYPES);

const WALLET_FIELD_TO_TYPE = Object.fromEntries(
  Object.entries(WALLET_BLOCK_TYPES).map(([key, meta]) => [meta.field, key])
);

export function isWalletProfitBlocked(user, walletType) {
  const meta = WALLET_BLOCK_TYPES[walletType];
  if (!meta || !user) return false;
  if (user[meta.field]?.profitBlocked) return true;
  // Legacy: old tradingWalletBlocked mapped to NSE/BSE
  if (walletType === 'nseBse' && user.wallet?.tradingWalletBlocked) return true;
  return false;
}

/**
 * Returns P&L amount that may be credited/debited to a wallet balance.
 * Profits on blocked wallets are withheld; losses still apply.
 */
export function profitAllowedForWallet(user, walletType, rawPnL) {
  const pnl = Number(rawPnL) || 0;
  if (pnl <= 0) return pnl;
  if (isWalletProfitBlocked(user, walletType)) return 0;
  return pnl;
}

export function walletTypeFromTrade(trade) {
  if (trade?.isCrypto) return 'crypto';
  if (trade?.isForex) return 'forex';
  const seg = String(trade?.segment || '').toUpperCase();
  if (seg === 'FOREX' || seg === 'FOREXFUT' || seg === 'FOREXOPT') return 'forex';
  if (
    trade?.exchange === 'MCX' ||
    trade?.segment === 'MCX' ||
    trade?.segment === 'MCXFUT' ||
    trade?.segment === 'MCXOPT'
  ) {
    return 'mcx';
  }
  return 'nseBse';
}

export function walletTypeFromWalletField(walletField) {
  return WALLET_FIELD_TO_TYPE[walletField] || null;
}

/** Strip positive profit increments when wallet profit is blocked. */
export function applyProfitBlockToIncrements(user, walletType, increments = {}) {
  if (!isWalletProfitBlocked(user, walletType)) return increments;
  const filtered = { ...increments };
  for (const key of ['balance', 'realizedPnL', 'todayRealizedPnL', 'totalRealizedPnL']) {
    if (Number(filtered[key]) > 0) filtered[key] = 0;
  }
  return filtered;
}

export function buildWalletBlocksResponse(user) {
  return Object.fromEntries(
    WALLET_BLOCK_TYPE_KEYS.map((key) => [key, isWalletProfitBlocked(user, key)])
  );
}

const TRANSFER_WALLET_TO_BLOCK_TYPE = {
  nseBseWallet: 'nseBse',
  tradingAccount: 'nseBse',
  mcxWallet: 'mcx',
  gamesWallet: 'games',
  cryptoWallet: 'crypto',
  forexWallet: 'forex',
};

export function walletTypeFromTransferWallet(walletKey) {
  return TRANSFER_WALLET_TO_BLOCK_TYPE[walletKey] || null;
}

export function walletDisabledMessage(walletType) {
  const label = WALLET_BLOCK_TYPES[walletType]?.label || 'Wallet';
  return `${label} is disabled. Contact admin.`;
}

/** Throws when wallet is disabled (no trade, transfer, or deposit). */
export function assertWalletOperationsAllowed(user, walletKey) {
  const blockType = walletTypeFromTransferWallet(walletKey);
  if (blockType && isWalletProfitBlocked(user, blockType)) {
    throw new Error(walletDisabledMessage(blockType));
  }
}

export function assertTransferWalletsAllowed(user, sourceWallet, targetWallet) {
  assertWalletOperationsAllowed(user, sourceWallet);
  assertWalletOperationsAllowed(user, targetWallet);
}

export function walletTypeFromOrder(orderData) {
  if (orderData?.isCrypto || orderData?.exchange === 'BINANCE') return 'crypto';
  if (orderData?.isForex || orderData?.exchange === 'FOREX') return 'forex';
  const seg = String(orderData?.segment || '').toUpperCase();
  if (seg === 'FOREX' || seg === 'FOREXFUT' || seg === 'FOREXOPT') return 'forex';
  if (
    orderData?.exchange === 'MCX' ||
    orderData?.segment === 'MCX' ||
    orderData?.segment === 'MCXFUT' ||
    orderData?.segment === 'MCXOPT'
  ) {
    return 'mcx';
  }
  return 'nseBse';
}

export function assertOrderWalletAllowed(user, orderData) {
  const walletType = walletTypeFromOrder(orderData);
  if (isWalletProfitBlocked(user, walletType)) {
    throw new Error(walletDisabledMessage(walletType));
  }
}
