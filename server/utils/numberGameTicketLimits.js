/**
 * Nifty Number / BTC Number — max tickets per user per selected number per IST day.
 */

export function resolveMaxTicketsPerNumber(gameConfig) {
  const raw = gameConfig?.maxTicketsPerNumber;
  if (raw === undefined || raw === null) return 2;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function userTicketsOnNumberFromBets(bets, selectedNumber) {
  return (bets || [])
    .filter((b) => Number(b.selectedNumber) === Number(selectedNumber) && b.status !== 'expired')
    .reduce((s, b) => s + (b.quantity || 1), 0);
}

export async function getUserTicketsOnNumber(BetModel, userId, betDate, selectedNumber) {
  const bets = await BetModel.find({
    user: userId,
    betDate,
    selectedNumber,
    status: { $ne: 'expired' },
  }).lean();
  return userTicketsOnNumberFromBets(bets, selectedNumber);
}

export function formatNumberPickLabel(selectedNumber, { btcStyle = false } = {}) {
  const s = String(selectedNumber).padStart(2, '0');
  return btcStyle ? s : `.${s}`;
}

export function buildPerNumberCapError(selectedNumber, cap, already, { btcStyle = false } = {}) {
  const label = formatNumberPickLabel(selectedNumber, { btcStyle });
  const remaining = Math.max(0, cap - already);
  return `Max ${cap} ticket(s) per number on ${label}. You have ${already}; ${remaining} remaining.`;
}

export function assertQtyWithinPerNumberCap({ qty, cap, alreadyOnNumber, selectedNumber, btcStyle }) {
  if (!(cap > 0)) return null;
  if (qty > cap) {
    return `Cannot place more than ${cap} ticket(s) on one number in a single order.`;
  }
  if (alreadyOnNumber + qty > cap) {
    return buildPerNumberCapError(selectedNumber, cap, alreadyOnNumber, { btcStyle });
  }
  return null;
}

/** Nifty Bracket / single-order games — max tickets per one POST. */
export function assertTicketsWithinPerOrderCap({ qty, cap }) {
  if (!(cap > 0)) return null;
  if (qty > cap) {
    return `Cannot place more than ${cap} ticket(s) in a single order.`;
  }
  return null;
}
