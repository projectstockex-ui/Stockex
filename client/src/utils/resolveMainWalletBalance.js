import { formatCoins } from './stockexCoins.js';

/**
 * Authoritative main (cash) wallet balance — same logic as UserAccounts.
 * Prefer top-level cashBalance; optional nse-bse-wallet mainBalance override.
 */
export function resolveMainWalletBalance(walletData, nseBseSnapshot = null) {
  if (nseBseSnapshot?.mainBalance != null && Number.isFinite(Number(nseBseSnapshot.mainBalance))) {
    return Number(nseBseSnapshot.mainBalance) || 0;
  }
  return (
    Number(
      walletData?.cashBalance ??
        walletData?.wallet?.cashBalance ??
        walletData?.wallet?.balance ??
        0
    ) || 0
  );
}

/** @deprecated name kept for imports — displays Stockex coins */
export function formatInrMainWallet(amount) {
  return formatCoins(amount);
}
