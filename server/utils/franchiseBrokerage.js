import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import User from '../models/User.js';

export const ONE_CRORE = 10_000_000;

/** ₹ amount from ₹/crore rate, turnover, and leg multiplier (1 = one leg, 2 = OPEN+CLOSE). */
export function perCroreRateToInr(ratePerCrore, turnover, legMultiplier = 1) {
  const rate = Number(ratePerCrore) || 0;
  const t = Number(turnover) || 0;
  const mult = Number(legMultiplier) > 0 ? Number(legMultiplier) : 1;
  if (rate <= 0 || t <= 0) return 0;
  return Math.round((t / ONE_CRORE) * rate * mult * 100) / 100;
}

export function getUserFranchiseRatePerCrore(user) {
  return Number(user?.franchiseChargePerCrore) || 0;
}

export function getAdminFranchiseRatePerCrore(admin) {
  return Number(admin?.restrictMode?.brokerageChargePerCrore) || 0;
}

/** Segment keys to try when resolving admin ₹/crore (crypto/forex aliases). */
export function resolveFranchiseSegmentCandidates(segment, trade = null) {
  const primary = String(segment || '').toUpperCase();
  const keys = new Set();
  if (primary) keys.add(primary);
  if (trade?.isCrypto || String(trade?.exchange || '').toUpperCase() === 'BINANCE') {
    keys.add('CRYPTO');
    keys.add('BINANCE');
  }
  if (trade?.isForex || String(trade?.exchange || '').toUpperCase() === 'FOREX') {
    keys.add('FOREX');
  }
  if (primary.includes('MCX')) keys.add('MCX');
  if (primary.includes('NSE') || primary.includes('BSE') || primary === 'EQUITY') keys.add('NSE/BSE');
  return [...keys];
}

export function getAdminSegmentPermissionSlice(admin, segment) {
  if (!admin || !segment) return null;
  let segPerms = admin.segmentPermissions;
  if (segPerms && typeof segPerms.toObject === 'function') segPerms = segPerms.toObject();
  const slice = segPerms instanceof Map ? segPerms.get(segment) : segPerms?.[segment];
  if (!slice) return null;
  return typeof slice.toObject === 'function' ? slice.toObject() : slice;
}

/**
 * Franchise cascade ₹/crore for an admin: restrictMode first, then segment PER_CRORE, then defaults.
 */
export function resolveAdminFranchiseRatePerCrore(admin, segment, trade = null) {
  if (admin?.role === 'SUPER_ADMIN') return 0;

  const restrictRate = getAdminFranchiseRatePerCrore(admin);
  if (restrictRate > 0) return restrictRate;

  for (const segKey of resolveFranchiseSegmentCandidates(segment, trade)) {
    const slice = getAdminSegmentPermissionSlice(admin, segKey);
    const commType = String(slice?.commissionType || '').toUpperCase();
    if (commType === 'PER_CRORE') {
      const comm = Number(slice?.commission) || 0;
      if (comm > 0) return comm;
    }
  }

  const defaultRate = Number(admin?.defaultSettings?.brokerage?.perCrore) || 0;
  return defaultRate > 0 ? defaultRate : 0;
}

/**
 * Match client debit: OPEN+CLOSE prepaid → 2×; single OPEN/CLOSE leg → 1×.
 */
export function resolveFranchiseLegMultiplier(trade, leg) {
  const legU = String(leg || '').toUpperCase();
  if (legU === 'OPEN+CLOSE') return 2;
  if (trade?.brokeragePrepaidRoundTrip === true && legU !== 'CLOSE') return 2;
  return 1;
}

/** Active Super Admin document (for cascade top / remainder). */
export async function resolveSuperAdminAdmin() {
  return Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).select(
    'name role restrictMode isFranchiseRoot parentId adminCode wallet stats status receivesHierarchyBrokerage segmentPermissions defaultSettings platformChargesPercentage'
  );
}

/**
 * Direct manager for brokerage cascade: user.admin (canonical) → createdBy → adminCode.
 * Must NOT use getAdminSettings() which may return a different admin for leverage/settings.
 */
export async function resolveUserDirectAdmin(user) {
  if (!user) return null;

  if (user.admin) {
    const populated = user.admin?._id ? user.admin : null;
    const doc =
      populated && populated.role
        ? populated
        : await Admin.findById(user.admin._id || user.admin).select(
            'name role restrictMode isFranchiseRoot parentId adminCode hierarchyPath wallet stats status receivesHierarchyBrokerage segmentPermissions defaultSettings platformChargesPercentage'
          );
    if (doc) return doc;
  }

  if (user.createdBy) {
    const doc = await Admin.findById(user.createdBy).select(
      'name role restrictMode isFranchiseRoot parentId adminCode hierarchyPath wallet stats status receivesHierarchyBrokerage segmentPermissions defaultSettings platformChargesPercentage'
    );
    if (doc) return doc;
  }

  if (user.adminCode && user.adminCode !== 'SYSTEM') {
    return Admin.findOne({ adminCode: user.adminCode }).select(
      'name role restrictMode isFranchiseRoot parentId adminCode hierarchyPath wallet stats status receivesHierarchyBrokerage segmentPermissions defaultSettings platformChargesPercentage'
    );
  }

  return null;
}

/**
 * MLM cascade must start at the user's sub-broker when they created the client,
 * even if user.admin was later pointed at the parent broker.
 */
export async function resolveBrokerageCascadeStartAdmin(user, directAdmin = null) {
  const direct = directAdmin || (await resolveUserDirectAdmin(user));
  if (!user || !direct) return direct;

  const fullSelect =
    'name role restrictMode isFranchiseRoot parentId adminCode hierarchyPath wallet stats status receivesHierarchyBrokerage segmentPermissions defaultSettings platformChargesPercentage';

  const creatorRole = String(user.creatorRole || '').toUpperCase();
  if (creatorRole === 'SUB_BROKER' && user.createdBy) {
    const subId = user.createdBy._id || user.createdBy;
    if (String(direct._id) !== String(subId)) {
      const sub = await Admin.findById(subId).select(fullSelect);
      if (sub?.role === 'SUB_BROKER' && sub.status === 'ACTIVE') {
        return sub;
      }
    }
  }

  if (Array.isArray(user.hierarchyPath) && user.hierarchyPath.length > 0) {
    for (let i = user.hierarchyPath.length - 1; i >= 0; i--) {
      const id = user.hierarchyPath[i];
      if (!id) continue;
      const adm = await Admin.findById(id).select('role status');
      if (adm?.role === 'SUB_BROKER' && adm.status === 'ACTIVE') {
        if (String(direct._id) !== String(id)) {
          return Admin.findById(id).select(fullSelect);
        }
        break;
      }
    }
  }

  return direct;
}

/** Build chain from direct admin up to Super Admin (inclusive). */
export async function buildAdminHierarchyChain(directAdmin) {
  const chain = [];
  let current = directAdmin;
  const seen = new Set();
  while (current) {
    const id = current._id?.toString();
    if (id && seen.has(id)) break;
    if (id) seen.add(id);
    chain.push({ admin: current, role: current.role });
    if (current.role === 'SUPER_ADMIN') break;
    if (!current.parentId) break;
    current = await Admin.findById(current.parentId);
    if (!current) break;
  }
  return chain;
}

/** Append Super Admin when parentId chain stops before SA (e.g. franchise root missing parentId). */
export async function ensureSuperAdminInChain(hierarchyChain) {
  if (!hierarchyChain?.length) return hierarchyChain || [];
  if (hierarchyChain.some((h) => h.role === 'SUPER_ADMIN')) return hierarchyChain;
  const sa = await resolveSuperAdminAdmin();
  if (!sa) return hierarchyChain;
  return [...hierarchyChain, { admin: sa, role: 'SUPER_ADMIN' }];
}

/** Reload restrictMode.franchise rates so cascade uses DB values (not stale populate). */
export async function refreshFranchiseHierarchyChain(hierarchyChain) {
  if (!hierarchyChain?.length) return [];
  const ids = hierarchyChain.map((h) => h.admin?._id).filter(Boolean);
  const fresh = await Admin.find({ _id: { $in: ids } }).select(
    'name role restrictMode isFranchiseRoot parentId adminCode wallet stats status receivesHierarchyBrokerage segmentPermissions defaultSettings platformChargesPercentage'
  );
  const byId = new Map(fresh.map((a) => [a._id.toString(), a]));
  return hierarchyChain.map((h) => ({
    role: h.role,
    admin: byId.get(h.admin._id.toString()) || h.admin,
  }));
}

export function findFranchiseRootInChain(hierarchyChain) {
  for (const entry of hierarchyChain || []) {
    if (entry.admin?.isFranchiseRoot === true) return entry.admin;
  }
  return null;
}

/** True if user trades under a franchise root (Radha subtree). */
export async function resolveFranchiseTradingContext(user, directAdmin) {
  if (!user || !directAdmin) {
    return { active: false, franchiseRoot: null, hierarchyChain: [] };
  }

  let hierarchyChain = await buildAdminHierarchyChain(directAdmin);
  hierarchyChain = await ensureSuperAdminInChain(hierarchyChain);
  hierarchyChain = await refreshFranchiseHierarchyChain(hierarchyChain);

  let franchiseRoot = findFranchiseRootInChain(hierarchyChain);

  if (!franchiseRoot) {
    const pathIds = [user.admin, ...(user.hierarchyPath || [])].filter(Boolean);
    if (pathIds.length) {
      franchiseRoot = await Admin.findOne({ _id: { $in: pathIds }, isFranchiseRoot: true });
    }
  }

  return {
    active: !!franchiseRoot,
    franchiseRoot,
    hierarchyChain,
  };
}

/** One-way brokerage ₹ for client under franchise (PER_CRORE from franchiseChargePerCrore). */
export function computeFranchiseUserOneWayBrokerage(user, turnover) {
  const rate = getUserFranchiseRatePerCrore(user);
  return perCroreRateToInr(rate, turnover, 1);
}

/**
 * Ensure parent ₹ levels never exceed child (direct admin highest → SA lowest).
 * Skips clamp when child level is unset (0) so downstream restrictMode rates are preserved.
 */
export function normalizeFranchiseAdminInrLevels(adminInrs, hierarchyChain = []) {
  if (!adminInrs?.length) return adminInrs || [];
  const out = adminInrs.map((v) => Math.round((Number(v) || 0) * 100) / 100);
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1] > 0 && out[i] > out[i - 1]) {
      out[i] = out[i - 1];
    }
  }
  const lastIdx = out.length - 1;
  if (hierarchyChain[lastIdx]?.role === 'SUPER_ADMIN') {
    out[lastIdx] = 0;
  }
  return out;
}

/** Full ₹ at each admin's franchise rate for this distribution leg (same turnover × legMultiplier). */
export function buildFranchiseAdminInrLevels(hierarchyChain, turnover, legMultiplier = 1, segment = null, trade = null) {
  const raw = (hierarchyChain || []).map((entry) =>
    perCroreRateToInr(resolveAdminFranchiseRatePerCrore(entry.admin, segment, trade), turnover, legMultiplier)
  );
  return normalizeFranchiseAdminInrLevels(raw, hierarchyChain);
}

/** Expected client total from user franchise rate (for sanity check). */
export function computeFranchiseUserTotalBrokerage(user, turnover, legMultiplier = 1) {
  return perCroreRateToInr(getUserFranchiseRatePerCrore(user), turnover, legMultiplier);
}

/**
 * Franchise cascade credits (client pays totalBrokerage = user full rate for this leg).
 * directAdmin: total - inrs[0]; chain[i+1]: inrs[i]-inrs[i+1]; SA gets last diff to 0.
 */
export function computeFranchiseCascadeShares(totalBrokerage, hierarchyChain, adminInrs) {
  const credits = [];
  if (!hierarchyChain?.length) return credits;

  const total = Math.round(Number(totalBrokerage) * 100) / 100;

  const directShare = Math.round((total - (adminInrs[0] || 0)) * 100) / 100;
  if (directShare > 0) {
    credits.push({
      admin: hierarchyChain[0].admin,
      role: hierarchyChain[0].role,
      amount: directShare,
      label: 'direct',
    });
  }

  for (let i = 0; i < hierarchyChain.length - 1; i++) {
    const amount = Math.round(((adminInrs[i] || 0) - (adminInrs[i + 1] || 0)) * 100) / 100;
    if (amount <= 0) continue;
    credits.push({
      admin: hierarchyChain[i + 1].admin,
      role: hierarchyChain[i + 1].role,
      amount,
      label: 'cascade',
    });
  }

  return credits;
}

/** Sum of cascade credits (should match totalBrokerage within rounding). */
export function sumFranchiseCascadeCredits(credits) {
  return Math.round(credits.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100;
}

/**
 * Split B_BOOK counterparty P&L between franchise root and Super Admin platform %.
 * @param {number} totalAdminPnL — book side (opposite of client net P&L)
 * @returns {{ franchiseAmount: number, platformAmount: number }}
 */
export function splitFranchiseBookPnL(totalAdminPnL, platformChargesPercentage) {
  if (!Number.isFinite(totalAdminPnL) || totalAdminPnL === 0) {
    return { franchiseAmount: 0, platformAmount: 0 };
  }
  const pct = Math.min(100, Math.max(0, Number(platformChargesPercentage) || 0));
  const absBook = Math.abs(totalAdminPnL);
  const platformSlice = Math.round((absBook * pct / 100) * 100) / 100;
  if (totalAdminPnL > 0) {
    return {
      franchiseAmount: Math.round((totalAdminPnL - platformSlice) * 100) / 100,
      platformAmount: platformSlice,
    };
  }
  return {
    franchiseAmount: Math.round((totalAdminPnL + platformSlice) * 100) / 100,
    platformAmount: -platformSlice,
  };
}

/** Validate admin franchise ₹/crore: >= parent rate, <= downstream admin rates (when set). */
export async function validateAdminFranchiseRate(targetAdmin, newRatePerCrore) {
  if (!Number.isFinite(newRatePerCrore) || newRatePerCrore < 0) {
    return { ok: false, message: 'Rate must be a number >= 0' };
  }

  if (targetAdmin?.parentId) {
    const parent = await Admin.findById(targetAdmin.parentId).select(
      'restrictMode role name username adminCode'
    );
    if (parent && parent.role !== 'SUPER_ADMIN') {
      const parentRate = getAdminFranchiseRatePerCrore(parent);
      if (parentRate > 0 && newRatePerCrore < parentRate) {
        return {
          ok: false,
          message: `Rate must be >= parent (${parent.name || parent.username}) rate ₹${parentRate}/crore`,
        };
      }
    }
  }

  const children = await Admin.find({ parentId: targetAdmin._id }).select(
    'restrictMode name username adminCode'
  );
  for (const child of children) {
    const childRate = getAdminFranchiseRatePerCrore(child);
    if (childRate > 0 && newRatePerCrore < childRate) {
      return {
        ok: false,
        message: `Rate cannot be below downstream admin (${child.name || child.username}) ₹${childRate}/crore`,
      };
    }
  }

  return { ok: true };
}

/** Client franchise rate must be >= direct manager's franchise rate. */
export async function validateUserFranchiseRate(user, newRatePerCrore) {
  if (!Number.isFinite(newRatePerCrore) || newRatePerCrore < 0) {
    return { ok: false, message: 'Rate must be a number >= 0' };
  }

  const directAdmin = await resolveUserDirectAdmin(user);
  if (!directAdmin) return { ok: true };

  const managerRate = getAdminFranchiseRatePerCrore(directAdmin);
  if (managerRate > 0 && newRatePerCrore < managerRate) {
    return {
      ok: false,
      message: `Client rate must be >= direct manager (${directAdmin.name || directAdmin.username}) rate ₹${managerRate}/crore`,
    };
  }

  return { ok: true };
}

/** True if this admin or any ancestor has active franchise root (isFranchiseRoot). */
export async function isAdminInActiveFranchiseSubtree(targetAdmin) {
  if (!targetAdmin) return false;
  if (targetAdmin.isFranchiseRoot === true) return true;
  const pathIds = targetAdmin.hierarchyPath || [];
  if (!pathIds.length) return false;
  const n = await Admin.countDocuments({ _id: { $in: pathIds }, isFranchiseRoot: true });
  return n > 0;
}

/** User's manager chain includes an active franchise root. */
export async function isUserInActiveFranchiseSubtree(user) {
  if (!user) return false;
  const adminIds = [user.admin, ...(user.hierarchyPath || [])].filter(Boolean);
  if (!adminIds.length) return false;
  const n = await Admin.countDocuments({ _id: { $in: adminIds }, isFranchiseRoot: true });
  return n > 0;
}

/**
 * When franchise root is disabled, clear downstream ₹/crore rates so children cannot keep franchise UI/charges.
 */
export async function clearFranchiseSubtreeRates(franchiseRootId) {
  const rootOid =
    franchiseRootId instanceof mongoose.Types.ObjectId
      ? franchiseRootId
      : new mongoose.Types.ObjectId(String(franchiseRootId));

  const adminIds = await getFranchiseSubtreeAdminIds(rootOid);
  const descendantAdminIds = adminIds.filter((id) => id.toString() !== rootOid.toString());

  if (descendantAdminIds.length) {
    await Admin.updateMany(
      { _id: { $in: descendantAdminIds } },
      { $set: { 'restrictMode.brokerageChargePerCrore': 0 } }
    );
  }

  const userQuery = {
    $or: [{ hierarchyPath: rootOid }, { admin: { $in: adminIds } }],
  };
  await User.updateMany(userQuery, { $set: { franchiseChargePerCrore: 0 } });

  return { adminsCleared: descendantAdminIds.length };
}

/** Mongo filter: users under a franchise root admin subtree. */
export function franchiseSubtreeUserQuery(franchiseRootId) {
  const rootOid =
    franchiseRootId instanceof mongoose.Types.ObjectId
      ? franchiseRootId
      : new mongoose.Types.ObjectId(String(franchiseRootId));
  return {
    $or: [{ hierarchyPath: rootOid }, { admin: rootOid }],
  };
}

/** All admin ids in franchise subtree (root + descendants). */
export async function getFranchiseSubtreeAdminIds(franchiseRootId) {
  const rootOid =
    franchiseRootId instanceof mongoose.Types.ObjectId
      ? franchiseRootId
      : new mongoose.Types.ObjectId(String(franchiseRootId));
  const rows = await Admin.find({
    $or: [{ _id: rootOid }, { hierarchyPath: rootOid }],
  })
    .select('_id')
    .lean();
  return rows.map((a) => a._id);
}

/** All client user ids under any franchise root (for SA feed exclusions). */
export async function getAllFranchiseSubtreeUserIds() {
  const roots = await Admin.find({ isFranchiseRoot: true }).select('_id').lean();
  const seen = new Set();
  for (const root of roots) {
    const ids = await getFranchiseSubtreeUserIds(root._id);
    for (const id of ids) seen.add(String(id));
  }
  return [...seen].map((id) => new mongoose.Types.ObjectId(id));
}

/** Users whose trading activity belongs to this franchise. */
export async function getFranchiseSubtreeUserIds(franchiseRootId) {
  const rootOid =
    franchiseRootId instanceof mongoose.Types.ObjectId
      ? franchiseRootId
      : new mongoose.Types.ObjectId(String(franchiseRootId));
  const adminIds = await getFranchiseSubtreeAdminIds(rootOid);
  if (!adminIds.length) return [];
  const users = await User.find({
    $or: [{ hierarchyPath: rootOid }, { admin: { $in: adminIds } }],
  })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
}
