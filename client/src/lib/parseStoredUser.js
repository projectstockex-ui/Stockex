/** Safe parse of localStorage user JSON (handles corrupt "[object Object]" from old mobile inject). */
export function parseStoredUserJson(raw) {
  if (raw == null || raw === '' || raw === '[object Object]') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
