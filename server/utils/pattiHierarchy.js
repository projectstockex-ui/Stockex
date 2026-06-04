import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import {
  individualPattiSegmentConfig,
  normalizeIndividualPattiSegments,
  isPattiEligibleRole,
  PATTI_SHARING_SEGMENT_KEYS,
} from '../constants/pattiSharingSegments.js';
import { findPattiSubtreeRootAdmin } from './pattiSubtree.js';

const CHAIN_SELECT =
  'pattiSharing role parentId adminCode status name username hierarchyPath isFranchiseRoot';

function segmentEnabled(cfg) {
  return cfg && cfg.enabled !== false;
}

function individualPattiAppliesToUser(pattiSharing, userId) {
  const mode = pattiSharing?.appliedTo || 'ALL_TRADES';
  if (mode === 'ALL_TRADES') return true;
  const list = pattiSharing?.specificClients || [];
  if (!Array.isArray(list) || list.length === 0) return false;
  const uid = userId?.toString?.();
  return list.some((id) => id?.toString?.() === uid);
}

/** Configured % kept by this node when splitting vs parent (stored on child doc). */
export function getConfiguredChildPct(node, user, segKey) {
  if (!node || !isPattiEligibleRole(node.role)) return null;
  const ps = node.pattiSharing;
  if (!ps?.enabled || !individualPattiAppliesToUser(ps, user?._id)) return null;

  const seg = individualPattiSegmentConfig(ps.segments, segKey);
  const pct = Number(seg?.adminPercentage ?? seg?.brokerPercentage);
  if (!segmentEnabled(seg) || !Number.isFinite(pct)) return null;

  const childPct = Math.min(100, Math.max(0, pct));
  if (childPct >= 100) return null;
  return childPct;
}

/** Max % a parent may set on a direct child (= parent's own child % vs grandparent). */
export function getMaxChildPctForParent(parent, user, segKey) {
  if (!parent) return 100;
  if (parent.role === 'SUPER_ADMIN') return 100;
  const parentAsChild = getConfiguredChildPct(parent, user, segKey);
  if (parentAsChild != null) return parentAsChild;
  return 100;
}

export function clampSegmentPctToCap(rawPct, maxPct) {
  const max = Math.min(100, Math.max(0, Number(maxPct) || 100));
  const x = Number(rawPct);
  if (!Number.isFinite(x)) return max;
  return Math.min(max, Math.max(0, Math.round(x)));
}

export function validateChildSegmentsAgainstParentCap(parent, segments, user) {
  const normalized = normalizeIndividualPattiSegments(segments || {});
  const errors = [];
  for (const [segKey, cfg] of Object.entries(normalized)) {
    if (cfg.enabled === false) continue;
    const max = getMaxChildPctForParent(parent, user, segKey);
    if (cfg.adminPercentage > max) {
      errors.push({ segKey, max, requested: cfg.adminPercentage });
    }
  }
  return { normalized, errors };
}

export function buildMaxPctHints(parent, user) {
  const hints = {};
  for (const key of PATTI_SHARING_SEGMENT_KEYS) {
    hints[key] = getMaxChildPctForParent(parent, user, key);
  }
  return hints;
}

async function loadAdmin(id) {
  if (!id) return null;
  return Admin.findById(id._id || id).select(CHAIN_SELECT);
}

/** Chain from book admin (bottom) up to SUPER_ADMIN (top). */
export async function buildHierarchyChainToSuperAdmin(startAdmin) {
  const chain = [];
  let current = await loadAdmin(startAdmin);
  const visited = new Set();

  while (current && !visited.has(String(current._id))) {
    visited.add(String(current._id));
    chain.push(current);
    if (current.role === 'SUPER_ADMIN' || !current.parentId) break;
    current = await loadAdmin(current.parentId);
  }

  return chain;
}

export function resolveEdgePatti(child, parent, user, segKey) {
  const configured = getConfiguredChildPct(child, user, segKey);
  if (configured == null) return null;

  const cap = getMaxChildPctForParent(parent, user, segKey);
  const childPct = Math.min(configured, cap);
  if (childPct >= 100) return null;

  return {
    childPct,
    configured,
    cap,
    source: 'hierarchy_patti_child',
  };
}

export function isDirectParentOf(parent, child) {
  if (!parent?._id || !child?.parentId) return false;
  return String(child.parentId) === String(parent._id);
}

/** Roles allowed to open/save patti on a downline admin (not on clients). */
export const PATTI_CONFIGURATOR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BROKER'];

/** Valid parent → child patti config pairs. Stops at SUB_BROKER; clients have no patti %. */
const PATTI_CONFIG_EDGE = {
  SUPER_ADMIN: ['ADMIN'],
  ADMIN: ['BROKER'],
  BROKER: ['SUB_BROKER'],
};

export function isValidPattiConfigEdge(parentRole, childRole) {
  const allowed = PATTI_CONFIG_EDGE[String(parentRole || '').toUpperCase()];
  if (!allowed) return false;
  return allowed.includes(String(childRole || '').toUpperCase());
}

export function canActorConfigurePatti(actorRole) {
  return PATTI_CONFIGURATOR_ROLES.includes(String(actorRole || '').toUpperCase());
}

export async function canManagePattiSharing(actor, target) {
  if (!actor || !target) return { allowed: false, reason: 'missing_admin' };
  if (target.role === 'SUPER_ADMIN') {
    return { allowed: false, reason: 'cannot_configure_super_admin' };
  }
  if (!isPattiEligibleRole(target.role)) {
    return { allowed: false, reason: 'role_not_eligible' };
  }
  if (!canActorConfigurePatti(actor.role)) {
    return {
      allowed: false,
      reason: 'sub_broker_cannot_configure',
    };
  }

  if (actor.role === 'SUPER_ADMIN') {
    if (target.role === 'ADMIN') return { allowed: true, mode: 'sa_admin_root' };
    return { allowed: false, reason: 'super_admin_only_admin_root' };
  }

  if (!isDirectParentOf(actor, target)) {
    return { allowed: false, reason: 'not_direct_parent' };
  }

  if (!isValidPattiConfigEdge(actor.role, target.role)) {
    return { allowed: false, reason: 'invalid_patti_config_edge' };
  }

  const subtreeRoot = await findPattiSubtreeRootAdmin(actor);
  if (!subtreeRoot) {
    return { allowed: false, reason: 'no_patti_subtree' };
  }

  return { allowed: true, mode: 'parent_child' };
}

export function chainHasDownlinePattiEdges(chain, user, segKey) {
  if (!chain || chain.length < 2) return false;
  for (let i = 0; i < chain.length - 1; i++) {
    if (resolveEdgePatti(chain[i], chain[i + 1], user, segKey)) return true;
  }
  return false;
}

const PATTI_DENY_MESSAGES = {
  super_admin_only_admin_root: 'Super Admin can only configure patti on ADMIN accounts.',
  not_direct_parent: 'You can only configure patti on your direct downline.',
  sub_broker_cannot_configure:
    'Sub-brokers cannot set patti. Patti ends at sub-broker; client trades use the full hierarchy split below you.',
  invalid_patti_config_edge:
    'Invalid patti level. Only Super Admin→Admin, Admin→Broker, and Broker→Sub-broker are allowed.',
  no_patti_subtree: 'Patti sharing is not active in your hierarchy branch.',
  role_not_eligible: 'Patti can only be configured on Admin, Broker, or Sub-broker accounts (not clients).',
};

export async function assertCanManagePattiSharing(actor, target) {
  const check = await canManagePattiSharing(actor, target);
  if (!check.allowed) {
    const err = new Error(
      PATTI_DENY_MESSAGES[check.reason] || 'Not allowed to configure patti for this account.'
    );
    err.status = 403;
    throw err;
  }
  return check;
}

export function parentIdInHierarchy(actorId, target) {
  const oid =
    actorId instanceof mongoose.Types.ObjectId
      ? actorId
      : new mongoose.Types.ObjectId(String(actorId));
  return oid;
}
