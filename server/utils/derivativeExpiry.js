const FNO_TYPES = new Set(['FUTURES', 'OPTIONS', 'FUT', 'OPT', 'OPTION']);

/** YYYY-MM-DD in Asia/Kolkata; matches sorting / string compare. */
export function kolkataCalendarDateString(d) {
  if (d == null) return null;
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function isFnoInstrumentType(t) {
  if (!t) return false;
  return FNO_TYPES.has(String(t).toUpperCase());
}

/**
 * F&O: expired when (IST calendar date of expiry) is strictly before (IST today).
 * So the contract is still "active" for the full expiry session day in India.
 * Missing expiry: not treated as expired (perpetuals / bad data).
 */
export function isExpiredDerivative({ instrumentType, expiry }, now = new Date()) {
  if (!isFnoInstrumentType(instrumentType)) return false;
  if (expiry == null) return false;
  const e = kolkataCalendarDateString(expiry);
  const t = kolkataCalendarDateString(now);
  if (!e || !t) return false;
  return e < t;
}

/**
 * Mongo helper: F&O row is included if IST expiry date is >= IST today.
 * Uses $expr + $dateToString (Asia/Kolkata) so date-only / UTC-midnight expiries stay visible on the MCX day.
 */
export function addActiveDerivExpiryToQuery(query, now = new Date()) {
  if (!query.$and) query.$and = [];
  const ref = now instanceof Date ? now : new Date(now);
  query.$and.push({
    $or: [
      { instrumentType: { $nin: ['FUTURES', 'OPTIONS'] } },
      { expiry: null },
      { expiry: { $exists: false } },
      {
        $expr: {
          $gte: [
            { $dateToString: { format: '%Y-%m-%d', date: '$expiry', timezone: 'Asia/Kolkata' } },
            { $dateToString: { format: '%Y-%m-%d', date: ref, timezone: 'Asia/Kolkata' } }
          ]
        }
      }
    ]
  });
  return query;
}

export function watchlistItemIsExpired(item, dbRow) {
  const type = (dbRow && dbRow.instrumentType) || item.instrumentType;
  const expiry = dbRow && dbRow.expiry != null ? dbRow.expiry : item.expiry;
  return isExpiredDerivative({ instrumentType: type, expiry });
}

/** User panel: only F&O rows whose contract expiry falls in [startDate, endDate]. Spot/no expiry pass through. */
export function applyContractExpiryRangeToQuery(query, { startDate, endDate } = {}) {
  const rangeFrom = startDate ? String(startDate).trim() : '';
  const rangeTo = endDate ? String(endDate).trim() : '';
  if (!rangeFrom && !rangeTo) return query;

  const expiryBounds = {};
  if (rangeFrom && /^\d{4}-\d{2}-\d{2}$/.test(rangeFrom)) {
    expiryBounds.$gte = new Date(`${rangeFrom}T00:00:00.000`);
  }
  if (rangeTo && /^\d{4}-\d{2}-\d{2}$/.test(rangeTo)) {
    expiryBounds.$lte = new Date(`${rangeTo}T23:59:59.999`);
  }
  if (Object.keys(expiryBounds).length === 0) return query;

  if (!query.$and) query.$and = [];
  query.$and.push({
    $or: [
      { expiry: null },
      { expiry: { $exists: false } },
      { expiry: expiryBounds },
    ],
  });
  return query;
}

export function instrumentMatchesContractExpiryRange({ expiry } = {}, { startDate, endDate } = {}) {
  if (!startDate && !endDate) return true;
  if (expiry == null) return true;
  const exp = expiry instanceof Date ? expiry : new Date(expiry);
  if (Number.isNaN(exp.getTime())) return true;
  if (startDate) {
    const from = new Date(`${startDate}T00:00:00.000`);
    if (exp < from) return false;
  }
  if (endDate) {
    const to = new Date(`${endDate}T23:59:59.999`);
    if (exp > to) return false;
  }
  return true;
}
