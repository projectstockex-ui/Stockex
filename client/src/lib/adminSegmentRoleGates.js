/** Who may configure limit / SL-M gate (`allowLimitPendingOrders`) — Super Admin & Admin only (not Broker/Sub broker). */
export function canManageLimitPendingSegmentGate(role) {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** MCX session start/close — Super Admin only (flows to full hierarchy). */
export function canEditMcxSessionTiming(role) {
  return role === 'SUPER_ADMIN';
}

/** NSE/BSE session start/close — Super Admin only. */
export function canEditNseBseSessionTiming(role) {
  return role === 'SUPER_ADMIN';
}

/** Crypto session start/close — Super Admin only. */
export function canEditCryptoSessionTiming(role) {
  return role === 'SUPER_ADMIN';
}

/**
 * Hierarchy "Admin Settings" modal: show the limit/pending toggle only when the row being edited
 * is an Admin or Super Admin — not Broker/Sub broker — even when a Super Admin opens Settings.
 */
export function showLimitPendingHierarchyTarget(role) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

/** Helper copy shown under the limit/pending segment toggle (when visible). */
export const LIMIT_PENDING_HELP_TEXT =
  'If you turn this on, the user can trade between the high and the low.';
