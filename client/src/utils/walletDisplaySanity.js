/** Match server MAX_SANE_SUBWALLET_INR — UI must not show corrupted wallet figures. */
export const MAX_SANE_WALLET_DISPLAY_INR = 1_000_000_000;

export function sanitizeWalletDisplayInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > MAX_SANE_WALLET_DISPLAY_INR) return MAX_SANE_WALLET_DISPLAY_INR;
  return n;
}
