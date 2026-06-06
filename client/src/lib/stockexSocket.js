import { io } from 'socket.io-client';
import { getRuntimeSocketUrl, getSocketClientOptions } from './runtimeApiUrl';

let socket = null;
let refCount = 0;
let registeredUserId = null;
let releaseTimer = null;

function ensureSocket() {
  if (!socket) {
    socket = io(getRuntimeSocketUrl(), getSocketClientOptions());
    socket.on('connect', () => {
      if (registeredUserId) socket.emit('register_user', registeredUserId);
    });
  }
  return socket;
}

/** One shared Socket.IO connection for the whole user app (ref-counted). */
export function acquireStockexSocket(userId) {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  const s = ensureSocket();
  refCount += 1;
  if (userId) {
    registeredUserId = String(userId);
    if (s.connected) s.emit('register_user', registeredUserId);
  }
  return s;
}

export function releaseStockexSocket() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  // Brief delay so React StrictMode remount does not tear down a live handshake.
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (refCount === 0 && socket) {
      socket.disconnect();
      socket = null;
      registeredUserId = null;
    }
  }, 200);
}
