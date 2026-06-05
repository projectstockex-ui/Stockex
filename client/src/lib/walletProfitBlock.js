export const WALLET_PROFIT_BLOCK_ROWS = [
  { key: 'nseBse', label: 'NSE & BSE', userField: 'nseBseWallet' },
  { key: 'mcx', label: 'MCX', userField: 'mcxWallet' },
  { key: 'games', label: 'Games Wallet', userField: 'gamesWallet' },
  { key: 'crypto', label: 'Crypto Wallet', userField: 'cryptoWallet' },
  { key: 'forex', label: 'Forex Wallet', userField: 'forexWallet' },
];

export function readWalletProfitBlocked(user, key) {
  const row = WALLET_PROFIT_BLOCK_ROWS.find((r) => r.key === key);
  if (!row) return false;
  if (user?.[row.userField]?.profitBlocked) return true;
  if (key === 'nseBse' && user?.wallet?.tradingWalletBlocked) return true;
  return false;
}

export function buildWalletBlocksState(user) {
  return Object.fromEntries(
    WALLET_PROFIT_BLOCK_ROWS.map((r) => [r.key, readWalletProfitBlocked(user, r.key)])
  );
}

export const WALLET_DISABLED_ALERT =
  'This wallet is disabled by admin. Trading, transfers, and deposits are not allowed.';

/** Dull card shell when superadmin disabled wallet. */
export function walletCardBlockedClass(blocked) {
  return blocked
    ? 'opacity-45 saturate-[0.3] grayscale border border-red-900/55'
    : '';
}

/** Disable Trade / Deposit / Withdraw / Transfer buttons on My Accounts. */
export function walletActionsDisabledClass(blocked) {
  return blocked ? 'opacity-40 pointer-events-none select-none' : '';
}
