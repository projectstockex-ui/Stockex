/**
 * Safe Express response helpers.
 *
 * Single Responsibility: never let a controller crash the process by trying to
 * write to a response that has already been sent. All Zerodha-style controllers
 * should funnel their JSON / error payloads through these helpers so a sync
 * serialization error in `res.json(...)` cannot trigger a second `res.json(...)`
 * inside the catch block (which would throw `ERR_HTTP_HEADERS_SENT` and crash
 * the Node process under nodemon / pm2).
 *
 * Usage:
 *   import { sendJson, sendError } from '../utils/safeResponse.js';
 *   sendJson(res, payload);
 *   sendError(res, 500, 'Failed to ...', error);
 */

/**
 * Send a JSON response only when headers haven't been written yet.
 * If serialization fails, we attempt a degraded `{}` payload so the client
 * never sees a hung request, but we never throw.
 *
 * @template T
 * @param {import('express').Response} res
 * @param {T} payload
 * @param {number} [status=200]
 */
export function sendJson(res, payload, status = 200) {
  if (!res || res.headersSent || res.writableEnded) return;
  try {
    return res.status(status).json(payload);
  } catch (err) {
    if (res.headersSent || res.writableEnded) return;
    try {
      return res.status(500).json({ message: 'Failed to serialize response', error: String(err?.message || err) });
    } catch {
      // Swallow; nothing more we can do without crashing the process.
    }
  }
}

/**
 * Send a structured error JSON safely.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} message
 * @param {unknown} [error]
 * @param {Record<string, unknown>} [extra]
 */
export function sendError(res, status, message, error, extra = {}) {
  const body = {
    message,
    ...(error ? { error: String(error?.message || error) } : {}),
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
  return sendJson(res, body, status);
}

export default { sendJson, sendError };
