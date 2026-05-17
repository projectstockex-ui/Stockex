/**
 * Data utility functions for AdminDashboard
 */

/**
 * Plain-object snapshot of Mongoose Map / nested docs from GET responses (avoids stale getters / shallow-merge bugs).
 * @param {object} raw - Raw data from MongoDB
 * @returns {object} Normalized plain object
 */
export function normalizeMongoMapOfObjects(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
  const out = {};

  for (const [k, v] of entries) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        out[k] = { ...v };
      }
    }
  }

  return out;
}
