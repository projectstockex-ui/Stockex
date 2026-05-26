/**
 * Segment brokerage — resolve type from merged layers only (no segment-key hardcoding).
 */

export function resolveSegmentCommissionType(...typeSources) {
  for (const t of typeSources) {
    if (t != null && String(t).trim() !== '') return String(t);
  }
  return '';
}
