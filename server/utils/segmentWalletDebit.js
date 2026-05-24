/**
 * Inter-wallet transfers: debit only free balance on segment wallets (MCX / crypto / forex)
 * Free balance = balance - usedMargin (cannot transfer locked margin)
 */

const MARGIN_SEGMENTS = new Set(['mcxWallet', 'cryptoWallet', 'forexWallet']);

export function isMarginSegmentWallet(key) {
  return MARGIN_SEGMENTS.has(String(key));
}

export function getStampedSegmentBalance(user, segmentKey) {
  if (!user || !isMarginSegmentWallet(segmentKey)) return 0;
  return Number(user[segmentKey]?.balance) || 0;
}

/**
 * @returns {Object|null} updated user doc (selected fields) or null if insufficient balance
 */
export async function atomicMarginSegmentDebitForTransfer(User, userId, segmentKey, amount) {
  const key = String(segmentKey);
  if (!isMarginSegmentWallet(key)) return null;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;

  const balPath = `${key}.balance`;
  const umPath = `${key}.usedMargin`;

  // Check if free balance (balance - usedMargin) >= amount
  const updated = await User.findOneAndUpdate(
    { 
      _id: userId, 
      $expr: {
        $gte: [
          { $subtract: [{ $toDouble: { $ifNull: [`$${key}.balance`, 0] } }, { $toDouble: { $ifNull: [`$${key}.usedMargin`, 0] } }] },
          amt
        ]
      }
    },
    [
      {
        $set: {
          [balPath]: {
            $subtract: [{ $toDouble: { $ifNull: [`$${key}.balance`, 0] } }, amt],
          },
          // usedMargin remains unchanged (we only transfer free balance)
        },
      },
    ],
    { new: true }
  );

  return updated || null;
}
