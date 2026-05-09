import Admin from '../models/Admin.js';
import PattiSharing from '../models/PattiSharing.js';

/**
 * Map trade segment/exchange → keys used in Admin.pattiSharing / PattiSharing.segments.
 */
export function pattiSegmentKeyFromTrade(trade) {
  const seg = String(trade?.segment || '').toUpperCase();
  const ex = String(trade?.exchange || '').toUpperCase();

  if (trade?.isCrypto || ex === 'BINANCE') {
    return 'CRYPTO';
  }
  if (trade?.isForex || seg.startsWith('FOREX') || ex === 'FOREX') {
    return 'FOREX';
  }
  if (seg === 'MCX' || seg === 'MCXFUT' || seg === 'MCXOPT' || ex === 'MCX' || seg === 'COMMODITY') {
    return 'MCX';
  }
  if (seg === 'CDS' || seg === 'CURRENCY') {
    return 'CURRENCY';
  }
  if (seg === 'EQUITY' || seg === 'NSE-EQ') {
    return 'EQUITY';
  }
  return 'FNO';
}

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

/**
 * Book admin's share % vs immediate parent for B_BOOK P&L and brokerage (same split).
 * Parent share = 100 − childPct.
 */
export async function resolvePattiSplitForTrade(bookAdmin, user, trade) {
  const segKey = pattiSegmentKeyFromTrade(trade);
  const fullAdmin = await Admin.findById(bookAdmin._id).select(
    'pattiSharing role parentId adminCode status'
  );
  if (!fullAdmin) {
    return { childPct: 100, parentAdmin: null, segmentKey: segKey, source: 'none' };
  }

  const parentId = fullAdmin.parentId;
  let parentAdmin =
    parentId && fullAdmin.role !== 'SUPER_ADMIN'
      ? await Admin.findById(parentId).select('wallet tradingPnL stats adminCode role status')
      : null;

  if (parentAdmin && parentAdmin.status !== 'ACTIVE') {
    parentAdmin = null;
  }

  const ps = fullAdmin.pattiSharing;
  if (ps?.enabled && individualPattiAppliesToUser(ps, user?._id)) {
    const seg = ps.segments?.[segKey];
    if (segmentEnabled(seg) && Number.isFinite(Number(seg.adminPercentage))) {
      const childPct = Math.min(100, Math.max(0, Number(seg.adminPercentage)));
      if (childPct < 100 && parentAdmin) {
        return {
          childPct,
          parentAdmin,
          segmentKey: segKey,
          source: 'individual_patti',
        };
      }
    }
  }

  if (fullAdmin.role === 'BROKER') {
    const doc = await PattiSharing.findOne({
      broker: fullAdmin._id,
      isActive: true,
    }).lean();

    if (doc) {
      const applies =
        doc.appliedTo === 'ALL_CLIENTS' ||
        (doc.appliedTo === 'SPECIFIC_CLIENTS' &&
          (doc.specificClients || []).some((id) => id?.toString?.() === user?._id?.toString?.()));

      if (applies) {
        let seg = doc.segments?.[segKey];
        if (segKey === 'FOREX' && !segmentEnabled(seg)) {
          seg = doc.segments?.CURRENCY;
        }
        if (segmentEnabled(seg) && Number.isFinite(Number(seg.brokerPercentage))) {
          const childPct = Math.min(100, Math.max(0, Number(seg.brokerPercentage)));
          if (childPct < 100 && parentAdmin) {
            return {
              childPct,
              parentAdmin,
              segmentKey: segKey,
              source: 'broker_patti_sharing',
            };
          }
        }
      }
    }
  }

  return { childPct: 100, parentAdmin: parentAdmin || null, segmentKey: segKey, source: 'fallback' };
}
