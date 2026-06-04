import Admin from '../models/Admin.js';
import { pattiSegmentKeyFromTrade } from '../constants/pattiSharingSegments.js';
import { findPattiSubtreeRootAdmin } from '../utils/pattiSubtree.js';
import {
  buildHierarchyChainToSuperAdmin,
  resolveEdgePatti,
  getConfiguredChildPct,
} from '../utils/pattiHierarchy.js';

export { pattiSegmentKeyFromTrade };

const ADMIN_SELECT =
  'pattiSharing role parentId adminCode status name username isFranchiseRoot wallet tradingPnL stats';

export function roundMoney(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

/** Child gets childPct% of total; parent gets remainder (preserves sum with rounding). */
export function splitByChildPercent(total, childPct) {
  const pct = Math.min(100, Math.max(0, Number(childPct) || 100));
  if (!Number.isFinite(total) || total === 0) return { child: 0, parent: 0 };
  if (pct >= 100) return { child: roundMoney(total), parent: 0 };
  const child = roundMoney((total * pct) / 100);
  const parent = roundMoney(total - child);
  return { child, parent };
}

function individualPattiAppliesToUser(pattiSharing, userId) {
  const mode = pattiSharing?.appliedTo || 'ALL_TRADES';
  if (mode === 'ALL_TRADES') return true;
  const list = pattiSharing?.specificClients || [];
  if (!Array.isArray(list) || list.length === 0) return false;
  const uid = userId?.toString?.();
  return list.some((id) => id?.toString?.() === uid);
}

async function loadAdmin(adminOrId) {
  if (!adminOrId) return null;
  return Admin.findById(adminOrId._id || adminOrId).select(ADMIN_SELECT);
}

async function resolveParentAdmin(adminDoc) {
  if (!adminDoc?.parentId || adminDoc.role === 'SUPER_ADMIN') return null;
  const parent = await Admin.findById(adminDoc.parentId).select(ADMIN_SELECT);
  if (!parent || parent.status !== 'ACTIVE') return null;
  return parent;
}

function resolvePattiChildPercentForAdmin(fullAdmin, user, segKey) {
  const pct = getConfiguredChildPct(fullAdmin, user, segKey);
  if (pct == null) return null;
  return { childPct: pct, source: 'individual_patti_subtree' };
}

/** Same as Super Admin↔Admin: each configured % is share of the full pool (not % of remainder). */
async function resolveAdminSaOnlyPattiCredits(chain, user, segKey, pool) {
  const credits = [];
  let current = chain[0];
  while (current?.role === 'SUB_BROKER') {
    const parent = await resolveParentAdmin(current);
    if (!parent) break;
    current = parent;
  }
  const pattiRoot = await findPattiSubtreeRootAdmin(current);
  if (!pattiRoot) {
    return { credits, usesPatti: false, segKey, pattiRootId: null };
  }

  const pattiRootId = pattiRoot._id;
  const parentAdmin = await resolveParentAdmin(pattiRoot);
  const levelPatti = resolvePattiChildPercentForAdmin(pattiRoot, user, segKey);

  if (!levelPatti || !parentAdmin) {
    if (Math.abs(pool) >= 0.000001) {
      credits.push({
        adminId: pattiRoot._id,
        admin: pattiRoot,
        amount: pool,
        childPct: 100,
        source: 'individual_patti_subtree',
        segKey,
      });
    }
    return { credits, usesPatti: true, segKey, pattiRootId };
  }

  const { child, parent } = splitByChildPercent(pool, levelPatti.childPct);
  if (Math.abs(child) >= 0.000001) {
    credits.push({
      adminId: pattiRoot._id,
      admin: pattiRoot,
      amount: child,
      childPct: levelPatti.childPct,
      source: levelPatti.source,
      segKey,
    });
  }
  if (Math.abs(parent) >= 0.000001) {
    credits.push({
      adminId: parentAdmin._id,
      admin: parentAdmin,
      amount: parent,
      childPct: 100 - levelPatti.childPct,
      source: 'individual_patti_parent',
      segKey,
    });
  }
  return { credits, usesPatti: true, segKey, pattiRootId };
}

/**
 * Multi-level patti — same rule as Super Admin↔Admin on the full pool:
 * child config % = share of total pool; parent net = own pool% − direct downline pool%.
 */
export async function resolvePattiCascadeCredits(bookAdmin, user, trade, totalAmount) {
  const segKey = pattiSegmentKeyFromTrade(trade);
  const pool = roundMoney(totalAmount);

  if (!pool || !bookAdmin) {
    return { credits: [], usesPatti: false, segKey };
  }

  const chain = await buildHierarchyChainToSuperAdmin(bookAdmin);
  if (chain.length < 2) {
    return { credits: [], usesPatti: false, segKey };
  }

  const grossPctOfPool = new Map();
  for (let i = 0; i < chain.length - 1; i++) {
    const edge = resolveEdgePatti(chain[i], chain[i + 1], user, segKey);
    if (edge) grossPctOfPool.set(String(chain[i]._id), edge.childPct);
  }

  if (grossPctOfPool.size === 0) {
    return resolveAdminSaOnlyPattiCredits(chain, user, segKey, pool);
  }

  const pattiRoot =
    (await findPattiSubtreeRootAdmin(chain.find((a) => a.role === 'ADMIN') || chain[0])) ||
    chain.find((a) => a.role === 'ADMIN');

  const pattiRootId = pattiRoot?._id || null;
  const credits = [];
  let assignedSum = 0;

  for (let i = 0; i < chain.length - 1; i++) {
    const node = chain[i];
    const nodeId = String(node._id);
    const gross = grossPctOfPool.get(nodeId);
    if (gross == null) continue;

    let childGrossOnPath = 0;
    if (i > 0) {
      const below = chain[i - 1];
      if (String(below.parentId) === nodeId) {
        childGrossOnPath = grossPctOfPool.get(String(below._id)) || 0;
      }
    }

    const netPct = Math.max(0, gross - childGrossOnPath);
    if (netPct < 0.000001) continue;

    const amount = roundMoney((pool * netPct) / 100);
    credits.push({
      adminId: node._id,
      admin: node,
      amount,
      childPct: netPct,
      grossPctOfPool: gross,
      source: childGrossOnPath > 0 ? 'hierarchy_patti_net' : 'hierarchy_patti_child',
      segKey,
    });
    assignedSum = roundMoney(assignedSum + amount);
  }

  const sa = chain[chain.length - 1];
  const rootGross =
    grossPctOfPool.get(String(pattiRoot?._id)) ??
    getConfiguredChildPct(pattiRoot, user, segKey) ??
    0;
  const saPct = Math.max(0, 100 - rootGross);

  if (sa?.role === 'SUPER_ADMIN') {
    const saAmount = roundMoney(pool - assignedSum);
    if (Math.abs(saAmount) >= 0.000001) {
      credits.push({
        adminId: sa._id,
        admin: sa,
        amount: saAmount,
        childPct: saPct,
        source: 'individual_patti_parent',
        segKey,
      });
    }
  }

  return {
    credits,
    usesPatti: true,
    segKey,
    pattiRootId,
    allocationMode: 'absolute_pool_pct',
  };
}

/** True when hierarchy patti (any edge or ADMIN root) applies for this trade. */
export async function usesPattiBrokeragePath(bookAdmin, user, trade) {
  const ctx = await resolvePattiAdminSaBrokerageContext(bookAdmin, user, trade);
  return ctx.active === true;
}

export async function resolvePattiAdminSaBrokerageContext(directAdmin, user, trade) {
  const segKey = pattiSegmentKeyFromTrade(trade);
  const chain = await buildHierarchyChainToSuperAdmin(directAdmin);
  if (chain.length < 2) return { active: false, segKey };

  for (let i = 0; i < chain.length - 1; i++) {
    const edge = resolveEdgePatti(chain[i], chain[i + 1], user, segKey);
    if (edge) {
      let pattiRoot = chain.find((a) => a.role === 'ADMIN') || null;
      if (!pattiRoot) {
        pattiRoot = await findPattiSubtreeRootAdmin(chain[0]);
      }
      return {
        active: true,
        segKey,
        childPct: edge.childPct,
        source: edge.source,
        pattiRoot,
        multiLevel: true,
      };
    }
  }

  let current = chain[0];
  while (current?.role === 'SUB_BROKER') {
    const parent = await resolveParentAdmin(current);
    if (!parent) break;
    current = parent;
  }

  const pattiRoot = await findPattiSubtreeRootAdmin(current);
  if (!pattiRoot) return { active: false, segKey };

  const levelPatti = resolvePattiChildPercentForAdmin(pattiRoot, user, segKey);
  if (!levelPatti) {
    return { active: false, pattiRoot, segKey, reason: 'segment_disabled' };
  }

  return {
    active: true,
    pattiRoot,
    childPct: levelPatti.childPct,
    segKey,
    source: levelPatti.source,
    multiLevel: false,
  };
}

export async function resolvePattiSplitForTrade(bookAdmin, user, trade) {
  const ctx = await resolvePattiAdminSaBrokerageContext(bookAdmin, user, trade);
  const segKey = ctx.segKey || pattiSegmentKeyFromTrade(trade);
  if (!ctx.active) {
    return { childPct: 100, parentAdmin: null, segmentKey: segKey, source: 'fallback' };
  }
  const parentAdmin = ctx.pattiRoot ? await resolveParentAdmin(ctx.pattiRoot) : null;
  return {
    childPct: ctx.childPct,
    parentAdmin,
    segmentKey: segKey,
    source: ctx.source,
  };
}
