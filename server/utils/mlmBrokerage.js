/**

 * MLM hierarchy brokerage (normal + patti path).

 * Uses restrictMode.brokerageChargePerCrore, segmentPermissions, defaultSettings.

 * Franchise-only path still uses distributeFranchiseBrokerage when not in patti subtree.

 */



import {

  getAdminSegmentPermissionSlice,

  resolveFranchiseSegmentCandidates,

  normalizeFranchiseAdminInrLevels,

} from './franchiseBrokerage.js';



export function resolveAdminMlmSegmentSlice(admin, segmentKey, trade = null) {

  if (!admin) return null;

  for (const key of resolveFranchiseSegmentCandidates(segmentKey, trade)) {

    const slice = getAdminSegmentPermissionSlice(admin, key);

    if (slice && slice.enabled !== false) return slice;

  }

  return null;

}



export function readMlmSliceCommission(rawSlice, systemSlice) {

  const finalSlice = rawSlice || systemSlice || {};

  const commType = finalSlice?.commissionType || 'PER_LOT';

  const commValue =

    commType === 'PER_CRORE'

      ? Number(finalSlice?.commission) || 0

      : Number(finalSlice?.commissionLot ?? finalSlice?.commission) || 0;

  return { commType, commValue };

}



/**

 * Resolve an admin's upstream cost rate for MLM cascade (/crore or per-lot).

 * Priority: restrictMode → segment PER_CRORE → defaultSettings → parent chain → system.

 */

export function resolveAdminMlmCommissionRate(

  admin,

  segmentKey,

  trade,

  systemSlice,

  parentResolved = null

) {

  if (!admin || admin.role === 'SUPER_ADMIN') {

    return { commType: 'PER_CRORE', commValue: 0, source: 'super_admin' };

  }



  const restrictRate = Number(admin?.restrictMode?.brokerageChargePerCrore) || 0;

  if (restrictRate > 0) {

    return { commType: 'PER_CRORE', commValue: restrictRate, source: 'restrictMode' };

  }



  const slice = resolveAdminMlmSegmentSlice(admin, segmentKey, trade);

  if (slice && slice.enabled !== false) {

    const fromSlice = readMlmSliceCommission(slice, null);

    if (fromSlice.commValue > 0) {

      return { ...fromSlice, source: 'segment' };

    }

  }



  const defaultPerCrore = Number(admin?.defaultSettings?.brokerage?.perCrore) || 0;

  if (defaultPerCrore > 0) {

    return { commType: 'PER_CRORE', commValue: defaultPerCrore, source: 'defaultSettings' };

  }



  if (parentResolved && parentResolved.commValue > 0) {

    return {

      commType: parentResolved.commType || 'PER_CRORE',

      commValue: parentResolved.commValue,

      source: 'inherited',

    };

  }



  const sys = readMlmSliceCommission(null, systemSlice);

  return { ...sys, source: 'system' };

}



/**

 * One-way  brokerage at each hierarchy level for MLM diff distribution.

 * @param {Function} commissionToInr - (commType, commValue) => inr (from TradeService)

 */

export function buildMlmAdminInrLevels(

  hierarchyChain,

  segmentKey,

  trade,

  systemSlice,

  commissionToInr

) {

  const chain = hierarchyChain || [];

  const resolved = new Array(chain.length);



  for (let i = chain.length - 1; i >= 0; i--) {

    const parentResolved = i < chain.length - 1 ? resolved[i + 1] : null;

    resolved[i] = resolveAdminMlmCommissionRate(

      chain[i].admin,

      segmentKey,

      trade,

      systemSlice,

      parentResolved

    );

  }



  const raw = resolved.map((r) => commissionToInr(r.commType, r.commValue));

  return normalizeFranchiseAdminInrLevels(raw, chain);

}



/** Export resolved commission metadata for logging on each chain entry. */

export function resolveMlmChainCommissionMeta(hierarchyChain, segmentKey, trade, systemSlice) {

  const chain = hierarchyChain || [];

  const meta = new Array(chain.length);

  for (let i = chain.length - 1; i >= 0; i--) {

    const parentResolved = i < chain.length - 1 ? meta[i + 1] : null;

    meta[i] = resolveAdminMlmCommissionRate(

      chain[i].admin,

      segmentKey,

      trade,

      systemSlice,

      parentResolved

    );

  }

  return meta;

}



/**

 * MLM cascade share at hierarchy index i (matches franchise diff cascade).

 * i=0 (direct admin): client charge − this level's cost rate.

 * i≥1: previous level's cost − this level's cost (downstream flow minus own cost).

 */

export function computeMlmLevelShareAmount(i, totalBrokerage, levels) {

  if (i === 0) {

    const myRate = Number(levels[0]) || 0;

    return Math.round((Number(totalBrokerage) - myRate) * 100) / 100;

  }

  const belowRate = Number(levels[i - 1]) || 0;

  const myRate = Number(levels[i]) || 0;

  return Math.round((belowRate - myRate) * 100) / 100;

}


