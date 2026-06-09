import User from '../models/User.js';
import {
  getSegmentGroupingMap,
  resolveSegmentGroupLtpBracketWithMap,
  resolveSegmentGroupLtpBracketForInstrument,
} from './segmentGroupingService.js';

/** @returns {{ percentUp: number, percentDown: number } | null} */
export function parseLtpBracketPercents(instrument) {
  if (!instrument) return null;
  const percentUp = Number(instrument.ltpBracketPercentUp);
  const percentDown = Number(instrument.ltpBracketPercentDown);
  if (
    !Number.isFinite(percentUp) ||
    !Number.isFinite(percentDown) ||
    percentUp <= 0 ||
    percentDown <= 0
  ) {
    return null;
  }
  return { percentUp, percentDown };
}

export function computeLtpBracketBounds(ltp, percentUp, percentDown) {
  const base = Number(ltp);
  if (!Number.isFinite(base) || base <= 0) return null;
  const upper = base * (1 + percentUp / 100);
  const lower = base * (1 - percentDown / 100);
  return {
    ltp: base,
    lower: Math.round(lower * 100) / 100,
    upper: Math.round(upper * 100) / 100,
    percentUp,
    percentDown,
  };
}

export function isPriceWithinLtpBracket(price, ltp, percentUp, percentDown) {
  const bounds = computeLtpBracketBounds(ltp, percentUp, percentDown);
  if (!bounds) return true;
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return false;
  return p >= bounds.lower && p <= bounds.upper;
}

export function buildLtpBracketClientPayload(instrument, enrolled, percentUp, percentDown) {
  const cfg =
    percentUp != null && percentDown != null
      ? { percentUp: Number(percentUp), percentDown: Number(percentDown) }
      : parseLtpBracketPercents(instrument);
  if (!cfg || !enrolled) return null;
  const ltp = Number(instrument.ltp) || 0;
  const bounds = computeLtpBracketBounds(ltp, cfg.percentUp, cfg.percentDown);
  if (!bounds) return null;
  const source = instrument._ltpBracketSource || 'instrument';
  return {
    active: true,
    ...bounds,
    groupLabel: source === 'group' ? instrument._ltpBracketGroupLabel || null : null,
    source,
  };
}

export function getEffectiveOrderPriceForBracket(orderData) {
  const od = orderData || {};
  const limit = Number(od.limitPrice);
  if (Number.isFinite(limit) && limit > 0) return limit;
  const trigger = Number(od.triggerPrice);
  if (Number.isFinite(trigger) && trigger > 0) return trigger;
  return Number(od.price) || 0;
}

export async function isUserEnrolledInLtpBracket(userId, token) {
  const t = String(token || '').trim();
  if (!t || !userId) return false;
  const user = await User.findById(userId).select('ltpBracketTokens').lean();
  return Array.isArray(user?.ltpBracketTokens) && user.ltpBracketTokens.includes(t);
}

export async function enrollUserInLtpBracket(userId, token) {
  const t = String(token || '').trim();
  if (!t || !userId) return;
  await User.updateOne({ _id: userId }, { $addToSet: { ltpBracketTokens: t } });
}

async function resolveEffectiveLtpBracket(instrument, orderData, userId) {
  const groupCfg = await resolveSegmentGroupLtpBracketForInstrument(instrument, orderData);
  if (groupCfg?.active) {
    return {
      active: true,
      percentUp: groupCfg.percentUp,
      percentDown: groupCfg.percentDown,
      source: 'group',
      groupLabel: groupCfg.groupLabel || groupCfg.groupKey || null,
    };
  }

  const instCfg = parseLtpBracketPercents(instrument);
  if (!instCfg || !userId) return { active: false };

  const enrolled = await isUserEnrolledInLtpBracket(userId, instrument.token);
  return {
    active: enrolled,
    percentUp: instCfg.percentUp,
    percentDown: instCfg.percentDown,
    source: 'instrument',
    enrolled,
  };
}

/**
 * Segment group LTP ±% applies to all users in the group.
 * Legacy per-instrument bracket still uses enrollment after first in-bracket trade.
 */
export async function assertLtpBracketOrderAllowed(user, instrument, orderData) {
  if (!user?._id || !instrument) return;

  const cfg = await resolveEffectiveLtpBracket(instrument, orderData, user._id);

  const ltp = Number(instrument.ltp) || Number(orderData.price) || 0;
  if (ltp <= 0) return;

  const orderPrice = getEffectiveOrderPriceForBracket(orderData);
  if (orderPrice <= 0) return;

  if (cfg.source === 'group' && cfg.active) {
    if (!isPriceWithinLtpBracket(orderPrice, ltp, cfg.percentUp, cfg.percentDown)) {
      const bounds = computeLtpBracketBounds(ltp, cfg.percentUp, cfg.percentDown);
      const grp = cfg.groupLabel ? ` (${cfg.groupLabel})` : '';
      throw new Error(
        `Order price must stay within LTP bracket ${bounds.lower} – ${bounds.upper}${grp} ` +
          `(LTP ${ltp}, −${cfg.percentDown}% / +${cfg.percentUp}%).`
      );
    }
    return;
  }

  const instCfg = parseLtpBracketPercents(instrument);
  if (!instCfg) return;

  const inBracket = isPriceWithinLtpBracket(
    orderPrice,
    ltp,
    instCfg.percentUp,
    instCfg.percentDown
  );
  const enrolled = await isUserEnrolledInLtpBracket(user._id, instrument.token);

  if (!enrolled && inBracket) {
    await enrollUserInLtpBracket(user._id, instrument.token);
    return;
  }

  if (enrolled && !inBracket) {
    const bounds = computeLtpBracketBounds(ltp, instCfg.percentUp, instCfg.percentDown);
    throw new Error(
      `Order price must stay within LTP bracket ${bounds.lower} – ${bounds.upper} ` +
        `(LTP ${ltp}, −${instCfg.percentDown}% / +${instCfg.percentUp}%). Only users who traded in this bracket see this limit.`
    );
  }
}

function enrichInstrumentLtpBracket(plain, groupingMap, enrolled) {
  const groupCfg = resolveSegmentGroupLtpBracketWithMap(plain, groupingMap);
  if (groupCfg?.active) {
    plain._ltpBracketGroupLabel = groupCfg.groupLabel || null;
    plain._ltpBracketSource = 'group';
    const payload = buildLtpBracketClientPayload(
      plain,
      true,
      groupCfg.percentUp,
      groupCfg.percentDown
    );
    if (payload) plain.ltpBracket = payload;
    return plain;
  }

  plain._ltpBracketSource = 'instrument';
  const token = String(plain.token || '');
  const payload = buildLtpBracketClientPayload(plain, enrolled.has(token));
  if (payload) plain.ltpBracket = payload;
  return plain;
}

/** Attach `ltpBracket` for segment-group rules (all users) or enrolled legacy instrument rules. */
export async function attachLtpBracketForUser(instruments, userDoc) {
  const enrolled = new Set(
    Array.isArray(userDoc?.ltpBracketTokens) ? userDoc.ltpBracketTokens.map(String) : []
  );
  const groupingMap = await getSegmentGroupingMap();
  return instruments.map((inst) => {
    const plain = inst.toObject ? inst.toObject() : { ...inst };
    enrichInstrumentLtpBracket(plain, groupingMap, enrolled);
    delete plain._ltpBracketGroupLabel;
    delete plain._ltpBracketSource;
    return plain;
  });
}

/** Group bracket only — for public instrument routes (no user enrollment). */
export async function attachLtpBracketFromGrouping(instruments) {
  const groupingMap = await getSegmentGroupingMap();
  const enrolled = new Set();
  return instruments.map((inst) => {
    const plain = inst.toObject ? inst.toObject() : { ...inst };
    enrichInstrumentLtpBracket(plain, groupingMap, enrolled);
    delete plain._ltpBracketGroupLabel;
    delete plain._ltpBracketSource;
    return plain;
  });
}

export function sanitizeLtpBracketBody(body) {
  const out = {};
  for (const key of ['ltpBracketPercentUp', 'ltpBracketPercentDown']) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];
    if (raw === '' || raw === null || raw === undefined) {
      out[key] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new Error(`${key} must be between 0 and 100`);
    }
    out[key] = n;
  }
  return out;
}
