let io = null;

export function setAppSocket(socketIO) {
  io = socketIO;
}

export function getAppSocket() {
  return io;
}

export function emitToUser(userId, event, payload = {}) {
  if (!io || !userId) return;
  const room = String(userId);
  io.to(room).emit(event, { ...payload, targetUserId: room });
}
