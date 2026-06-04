import Admin from '../models/Admin.js';
import User from '../models/User.js';

const SEGMENTS = ['games', 'trading', 'mcx', 'crypto', 'forex'];

/** Normalize legacy boolean or partial object to full segment map. */
export function normalizeReferralDistributionEnabled(raw) {
  if (raw === true || raw == null) {
    return { games: true, trading: true, mcx: true, crypto: true, forex: true };
  }
  if (raw === false) {
    return { games: false, trading: false, mcx: false, crypto: false, forex: false };
  }
  if (typeof raw !== 'object') {
    return { games: true, trading: true, mcx: true, crypto: true, forex: true };
  }
  return {
    games: raw.games !== false,
    trading: raw.trading !== false,
    mcx: raw.mcx !== false,
    crypto: raw.crypto !== false,
    forex: raw.forex !== false,
  };
}

export function isReferralSegmentEnabled(settings, segment) {
  const s = normalizeReferralDistributionEnabled(settings);
  const key = String(segment || '').trim().toLowerCase();
  if (key === 'games') return s.games;
  if (key === 'trading') return s.trading;
  if (key === 'mcx' || key === 'crypto' || key === 'forex') {
    if (!s.trading) return false;
    return s[key];
  }
  return s.trading;
}

export async function findHierarchyRootAdmin(startAdminId) {
  let current = startAdminId
    ? await Admin.findById(startAdminId).select('role parentId referralDistributionEnabled').lean()
    : null;
  let rootAdmin = null;

  while (current) {
    if (current.role === 'ADMIN') rootAdmin = current;
    if (current.role === 'SUPER_ADMIN' || !current.parentId) break;
    current = await Admin.findById(current.parentId).select('role parentId referralDistributionEnabled').lean();
  }

  return rootAdmin;
}

/** ADMIN root whose referralDistributionEnabled governs users in this tree. */
export async function resolveReferralPolicyAdminForUser(userId) {
  const user = await User.findById(userId).select('admin hierarchyPath').lean();
  if (!user) return null;

  const chainIds = [];
  const seen = new Set();
  const push = (id) => {
    if (id == null) return;
    const s = String(id);
    if (seen.has(s)) return;
    seen.add(s);
    chainIds.push(id);
  };

  if (Array.isArray(user.hierarchyPath)) {
    for (const id of user.hierarchyPath) push(id);
  }
  push(user.admin);

  if (chainIds.length) {
    const admins = await Admin.find({ _id: { $in: chainIds } })
      .select('role referralDistributionEnabled')
      .lean();
    const byId = new Map(admins.map((a) => [String(a._id), a]));
    for (const id of chainIds) {
      const a = byId.get(String(id));
      if (a?.role === 'ADMIN') return a;
    }
  }

  if (user.admin) {
    return findHierarchyRootAdmin(user.admin);
  }
  return null;
}

export async function isReferralEnabledForUser(userId, segment) {
  const policyAdmin = await resolveReferralPolicyAdminForUser(userId);
  if (!policyAdmin) return true;
  return isReferralSegmentEnabled(policyAdmin.referralDistributionEnabled, segment);
}

export function applyReferralDistributionPatch(adminDoc, patch) {
  if (!adminDoc || !patch || typeof patch !== 'object') return;
  const current = normalizeReferralDistributionEnabled(adminDoc.referralDistributionEnabled);
  const next = { ...current };
  for (const key of SEGMENTS) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  adminDoc.referralDistributionEnabled = next;
  adminDoc.markModified('referralDistributionEnabled');
}

export function referralDistributionForResponse(adminDoc) {
  return normalizeReferralDistributionEnabled(adminDoc?.referralDistributionEnabled);
}
