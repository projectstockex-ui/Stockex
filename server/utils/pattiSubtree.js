import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import { normalizeIndividualPattiSegments } from '../constants/pattiSharingSegments.js';
import { disableFranchiseForPattiAdmin } from './pattiFranchiseExclusion.js';

/** All admin ids under an ADMIN root (root + descendants). */
export async function getAdminSubtreeIds(rootAdminId) {
  const rootOid =
    rootAdminId instanceof mongoose.Types.ObjectId
      ? rootAdminId
      : new mongoose.Types.ObjectId(String(rootAdminId));

  const rows = await Admin.find({
    $or: [{ _id: rootOid }, { hierarchyPath: rootOid }],
  })
    .select('_id role')
    .lean();

  return rows.map((a) => a._id);
}

/** Remove patti config from all descendants (brokers etc.) — only ADMIN root keeps config. */
export async function clearDescendantPattiSharing(rootAdminId) {
  const rootOid =
    rootAdminId instanceof mongoose.Types.ObjectId
      ? rootAdminId
      : new mongoose.Types.ObjectId(String(rootAdminId));

  const result = await Admin.updateMany(
    { hierarchyPath: rootOid, role: { $ne: 'SUPER_ADMIN' } },
    {
      $set: {
        pattiSharing: {
          enabled: false,
          appliedTo: 'ALL_TRADES',
          segments: {},
          notes: '',
        },
      },
    }
  );

  return { descendantsCleared: result.modifiedCount || 0 };
}

/**
 * Super Admin saves patti on an ADMIN — config lives only on that ADMIN;
 * descendants are cleared so settlement bubbles up to this root.
 */
export async function applyPattiSubtreeFromAdminRoot(rootAdmin, payload) {
  const { enabled, appliedTo, segments, notes } = payload;

  rootAdmin.pattiSharing = rootAdmin.pattiSharing || {};
  if (typeof enabled === 'boolean') rootAdmin.pattiSharing.enabled = enabled;
  if (appliedTo === 'ALL_TRADES' || appliedTo === 'SPECIFIC_CLIENTS') {
    rootAdmin.pattiSharing.appliedTo = appliedTo;
  }
  if (segments && typeof segments === 'object') {
    rootAdmin.pattiSharing.segments = normalizeIndividualPattiSegments(segments);
  }
  if (typeof notes === 'string') rootAdmin.pattiSharing.notes = notes;
  rootAdmin.pattiSharing.subtreeRoot = true;

  let franchiseCleared = null;
  if (rootAdmin.pattiSharing.enabled === true && rootAdmin.isFranchiseRoot === true) {
    franchiseCleared = (await disableFranchiseForPattiAdmin(rootAdmin)).cleared;
  }

  await rootAdmin.save();

  return { franchiseCleared, descendantsCleared: 0 };
}

/**
 * Parent sets patti on direct child (broker / sub-broker). Does not clear other downline.
 */
export async function applyPattiOnDirectChild(childAdmin, payload) {
  const { enabled, appliedTo, segments, notes } = payload;

  childAdmin.pattiSharing = childAdmin.pattiSharing || {};
  if (typeof enabled === 'boolean') childAdmin.pattiSharing.enabled = enabled;
  if (appliedTo === 'ALL_TRADES' || appliedTo === 'SPECIFIC_CLIENTS') {
    childAdmin.pattiSharing.appliedTo = appliedTo;
  }
  if (segments && typeof segments === 'object') {
    childAdmin.pattiSharing.segments = normalizeIndividualPattiSegments(segments);
  }
  if (typeof notes === 'string') childAdmin.pattiSharing.notes = notes;
  delete childAdmin.pattiSharing.subtreeRoot;

  await childAdmin.save();
  return childAdmin;
}

/** Walk up from book admin to find ADMIN with active subtree patti root. */
export async function findPattiSubtreeRootAdmin(startAdmin) {
  let current = startAdmin;
  const visited = new Set();

  while (current && !visited.has(String(current._id))) {
    visited.add(String(current._id));

    if (
      current.role === 'ADMIN' &&
      current.pattiSharing?.enabled === true &&
      current.status !== 'INACTIVE'
    ) {
      return current;
    }

    if (current.role === 'SUPER_ADMIN' || !current.parentId) break;

    current = await Admin.findById(current.parentId).select(
      'pattiSharing role parentId adminCode status name username'
    );
  }

  return null;
}

/** True if this admin or any ancestor has active patti (ADMIN root or any downline edge). */
export async function isAdminInActivePattiSubtree(targetAdmin) {
  if (!targetAdmin) return false;
  if (targetAdmin.pattiSharing?.enabled === true) return true;
  const pathIds = targetAdmin.hierarchyPath || [];
  if (!pathIds.length) return false;
  const n = await Admin.countDocuments({
    _id: { $in: pathIds },
    'pattiSharing.enabled': true,
  });
  return n > 0;
}
