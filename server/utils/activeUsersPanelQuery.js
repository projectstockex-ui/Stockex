import User from '../models/User.js';
import Trade from '../models/Trade.js';

const PANEL_USER_SELECT =
  'name email adminCode isActive wallet gamesWallet cryptoWallet mcxWallet forexWallet nseWallet bseWallet updatedAt';

/**
 * Lightweight active-users payload for Super Admin dashboard (top N only).
 */
export async function fetchActiveUsersPanel(limit = 50) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const users = await User.find({ isActive: true })
    .select(PANEL_USER_SELECT)
    .populate('admin', 'name adminCode')
    .sort({ updatedAt: -1 })
    .limit(cap)
    .lean();

  if (!users.length) return [];

  const userIds = users.map((u) => u._id);
  const positionRows = await Trade.aggregate([
    { $match: { status: 'OPEN', user: { $in: userIds } } },
    {
      $group: {
        _id: '$user',
        netPosition: { $sum: '$unrealizedPnL' },
        openTrades: { $sum: 1 },
        totalValue: { $sum: { $multiply: ['$quantity', '$entryPrice'] } },
      },
    },
  ]);

  const positionMap = new Map(
    positionRows.map((row) => [
      String(row._id),
      {
        netPosition: row.netPosition || 0,
        openTrades: row.openTrades || 0,
        totalValue: row.totalValue || 0,
      },
    ])
  );

  return users.map((user) => {
    const position = positionMap.get(String(user._id)) || {
      netPosition: 0,
      openTrades: 0,
      totalValue: 0,
    };
    return { ...user, ...position };
  });
}
