import { wireWsMetrics, incWsAuthFailed } from '../metrics.js';
import { verifyAccess, getAccessTokenFromCookieHeader } from '../middleware/auth.js';

function extractToken(socket) {
  const header = socket.handshake?.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const candidate = header.slice(7).trim();
    if (candidate) {
      return candidate;
    }
  }

  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === 'string' && authToken) {
    return authToken;
  }

  const cookieToken = getAccessTokenFromCookieHeader(socket.handshake?.headers?.cookie);
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

export function socketAuth(io) {
  wireWsMetrics(io);

  io.use((socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) {
        incWsAuthFailed();
        return next(new Error('unauthorized'));
      }
      const user = verifyAccess(token);
      socket.data.user = { id: user.id };
      return next();
    } catch (err) {
      incWsAuthFailed();
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.use((_, next) => {
      try {
        const token = extractToken(socket);
        if (!token) {
          throw new Error('unauthorized');
        }
        const user = verifyAccess(token);
        socket.data.user = { id: user.id };
        next();
      } catch (err) {
        incWsAuthFailed();
        socket.emit('error', 'unauthorized');
        socket.disconnect(true);
      }
    });
  });
}
