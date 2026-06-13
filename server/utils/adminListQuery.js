import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import User from '../models/User.js';

/** Fields omitted from hierarchy list API — loaded on demand via settings/detail endpoints. */
const LIST_OMIT = {
  password: 0,
  pin: 0,
  segmentPermissions: 0,
  scriptSettings: 0,
  segmentExplicitKeys: 0,
  defaultSettings: 0,
  permissions: 0,
  leverageSettings: 0,
};

function isInFlaggedSubtree(admin, flaggedIdSet) {
  if (!admin) return false;
  const selfId = String(admin._id);
  if (flaggedIdSet.has(selfId)) return true;
  for (const id of admin.hierarchyPath || []) {
    if (flaggedIdSet.has(String(id))) return true;
  }
  return false;
}

/**
 * Fast hierarchy admin list: lean docs, batched user counts, batched franchise/patti flags.
 */
export async function fetchAdminHierarchyList(query) {
  const admins = await Admin.find(query)
    .select(LIST_OMIT)
    .populate('parentId', 'name adminCode role')
    .sort({ createdAt: -1 })
    .lean();

  if (!admins.length) return [];

  const adminIds = admins.map((a) => a._id);

  const userCountRows = await User.aggregate([
    { $match: { admin: { $in: adminIds } } },
    {
      $group: {
        _id: '$admin',
        totalUsers: { $sum: 1 },
        activeUsers: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
      },
    },
  ]);

  const userCountMap = new Map(
    userCountRows.map((row) => [
      String(row._id),
      { totalUsers: row.totalUsers, activeUsers: row.activeUsers },
    ])
  );

  const ancestorIdSet = new Set();
  for (const admin of admins) {
    ancestorIdSet.add(String(admin._id));
    for (const id of admin.hierarchyPath || []) {
      ancestorIdSet.add(String(id));
    }
  }

  const ancestorIds = [...ancestorIdSet].map((id) => new mongoose.Types.ObjectId(id));
  const ancestorFlags = ancestorIds.length
    ? await Admin.find({ _id: { $in: ancestorIds } })
        .select('_id isFranchiseRoot pattiSharing.enabled')
        .lean()
    : [];

  const franchiseRootIds = new Set(
    ancestorFlags.filter((a) => a.isFranchiseRoot === true).map((a) => String(a._id))
  );
  const pattiEnabledIds = new Set(
    ancestorFlags.filter((a) => a.pattiSharing?.enabled === true).map((a) => String(a._id))
  );

  return admins.map((admin) => {
    const counts = userCountMap.get(String(admin._id)) || { totalUsers: 0, activeUsers: 0 };
    return {
      ...admin,
      franchiseSubtreeActive: isInFlaggedSubtree(admin, franchiseRootIds),
      pattiSubtreeActive: isInFlaggedSubtree(admin, pattiEnabledIds),
      stats: {
        ...(admin.stats || {}),
        totalUsers: counts.totalUsers,
        activeUsers: counts.activeUsers,
      },
    };
  });
}
