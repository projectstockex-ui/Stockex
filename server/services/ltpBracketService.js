import User from '../models/User.js';

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

export function buildLtpBracketClientPayload(instrument, enrolled) {
  const cfg = parseLtpBracketPercents(instrument);
  if (!cfg || !enrolled) return null;
  const ltp = Number(instrument.ltp) || 0;
  const bounds = computeLtpBracketBounds(ltp, cfg.percentUp, cfg.percentDown);
  if (!bounds) return null;
  return { active: true, ...bounds };
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

/**
 * Users who placed a trade inside the LTP ±% window are enrolled and must stay in the dynamic window.
 * Others trade normally (no bracket).
 */
export async function assertLtpBracketOrderAllowed(user, instrument, orderData) {
  const cfg = parseLtpBracketPercents(instrument);
  if (!cfg || !user?._id) return;

  const token = instrument.token;
  const ltp = Number(instrument.ltp) || 0;
  if (ltp <= 0) return;

  const orderPrice = getEffectiveOrderPriceForBracket(orderData);
  if (orderPrice <= 0) return;

  const inBracket = isPriceWithinLtpBracket(
    orderPrice,
    ltp,
    cfg.percentUp,
    cfg.percentDown
  );
  const enrolled = await isUserEnrolledInLtpBracket(user._id, token);

  if (!enrolled && inBracket) {
    await enrollUserInLtpBracket(user._id, token);
    return;
  }

  if (enrolled && !inBracket) {
    const bounds = computeLtpBracketBounds(ltp, cfg.percentUp, cfg.percentDown);
    throw new Error(
      `Order price must stay within LTP bracket ₹${bounds.lower} – ₹${bounds.upper} ` +
        `(LTP ₹${ltp}, −${cfg.percentDown}% / +${cfg.percentUp}%). Only users who traded in this bracket see this limit.`
    );
  }
}

/** Attach `ltpBracket` only for enrolled users when instrument has % configured. */
export function attachLtpBracketForUser(instruments, userDoc) {
  const enrolled = new Set(
    Array.isArray(userDoc?.ltpBracketTokens) ? userDoc.ltpBracketTokens.map(String) : []
  );
  return instruments.map((inst) => {
    const plain = inst.toObject ? inst.toObject() : { ...inst };
    const token = String(plain.token || '');
    const payload = buildLtpBracketClientPayload(plain, enrolled.has(token));
    if (payload) plain.ltpBracket = payload;
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
