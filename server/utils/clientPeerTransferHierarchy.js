import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import { getAdminSubtreeIds } from './pattiSubtree.js';

function toOid(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

/**
 * ADMIN root for a client — all users under this ADMIN (any broker/sub-broker) share one hierarchy.
 */
export async function resolveHierarchyAdminRootId(user) {
  if (!user) return null;

  const chainIds = [];
  const seen = new Set();
  const push = (id) => {
    const oid = toOid(id);
    if (!oid) return;
    const s = String(oid);
    if (seen.has(s)) return;
    seen.add(s);
    chainIds.push(oid);
  };

  if (Array.isArray(user.hierarchyPath)) {
    for (const id of user.hierarchyPath) push(id);
  }
  push(user.admin);

  if (chainIds.length) {
    const admins = await Admin.find({ _id: { $in: chainIds } })
      .select('_id role status')
      .lean();
    const byId = new Map(admins.map((a) => [String(a._id), a]));
    for (const id of chainIds) {
      const a = byId.get(String(id));
      if (a?.role === 'ADMIN' && a.status !== 'INACTIVE') return a._id;
    }
  }

  let current = user.admin
    ? await Admin.findById(user.admin).select('_id role parentId status').lean()
    : null;
  const visited = new Set();
  while (current && !visited.has(String(current._id))) {
    visited.add(String(current._id));
    if (current.role === 'ADMIN' && current.status !== 'INACTIVE') return current._id;
    if (current.role === 'SUPER_ADMIN' || !current.parentId) break;
    current = await Admin.findById(current.parentId).select('_id role parentId status').lean();
  }

  return null;
}

/**
 * Mongo filter: active clients under same ADMIN subtree (excludes sender).
 */
export async function buildHierarchyPeerTransferFilter(sender) {
  const adminRootId = await resolveHierarchyAdminRootId(sender);
  const excludeId = sender._id;

  if (adminRootId) {
    const adminIds = await getAdminSubtreeIds(adminRootId);
    const rootOid = toOid(adminRootId);
    return {
      mode: 'hierarchy',
      adminRootId: rootOid,
      filter: {
        isActive: true,
        isDemo: { $ne: true },
        _id: { $ne: excludeId },
        $or: [{ hierarchyPath: rootOid }, { admin: { $in: adminIds } }],
      },
    };
  }

  const adminCode = String(sender?.adminCode || '').trim();
  if (!adminCode) {
    return { mode: 'none', adminRootId: null, filter: null };
  }

  return {
    mode: 'adminCode_fallback',
    adminRootId: null,
    filter: {
      adminCode,
      isActive: true,
      isDemo: { $ne: true },
      _id: { $ne: excludeId },
    },
  };
}

export async function usersShareSameHierarchyScope(sender, recipient) {
  const aRoot = await resolveHierarchyAdminRootId(sender);
  const bRoot = await resolveHierarchyAdminRootId(recipient);
  if (aRoot && bRoot) return String(aRoot) === String(bRoot);

  const a = String(sender?.adminCode || '').trim().toUpperCase();
  const b = String(recipient?.adminCode || '').trim().toUpperCase();
  if (!a || !b) return false;
  return a === b;
}

export async function getHierarchyScopeMeta(adminRootId) {
  if (!adminRootId) return null;
  const adm = await Admin.findById(adminRootId).select('name username adminCode role').lean();
  if (!adm) return null;
  return {
    adminRootId: String(adm._id),
    adminName: adm.name || adm.username || adm.adminCode || 'Admin',
    adminCode: adm.adminCode || '',
  };
}
