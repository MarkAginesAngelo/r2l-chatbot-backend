const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('./env');
const logger = require('./logger');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true },
  });

  // Staff/admin dashboards authenticate with the same JWT used for the REST API.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing auth token'));
      const payload = jwt.verify(token, env.jwt.secret);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    // All staff join a shared room for now — good enough for a small NGO team.
    // If the team grows, split into per-department rooms here.
    socket.join('staff_dashboard');
  });

  return io;
}

function getIO() {
  if (!io) {
    logger.warn('[socket] getIO() called before initSocket() — event dropped');
    return null;
  }
  return io;
}

/** Emit an event to every connected staff dashboard client. */
function notifyStaff(event, payload) {
  const instance = getIO();
  if (instance) instance.to('staff_dashboard').emit(event, payload);
}

module.exports = { initSocket, getIO, notifyStaff };
