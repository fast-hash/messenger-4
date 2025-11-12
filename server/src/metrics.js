// Prometheus metrics wiring
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['route', 'status'],
});
export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['route', 'status'],
  buckets: [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5],
});
export const messageSaved = new client.Counter({
  name: 'message_saved_total',
  help: 'Saved messages',
});
export const replayRejected = new client.Counter({
  name: 'replay_rejected_total',
  help: 'Rejected duplicated/replayed messages',
});

// Socket.IO (optional, но полезно)
export const wsConnections = new client.Counter({
  name: 'ws_connections_total',
  help: 'WebSocket connections',
});
export const wsDisconnections = new client.Counter({
  name: 'ws_disconnections_total',
  help: 'WebSocket disconnections',
});
export const wsAuthFailed = new client.Counter({
  name: 'ws_auth_failed_total',
  help: 'WebSocket auth failures',
});

register.registerMetric(httpRequests);
register.registerMetric(httpDuration);
register.registerMetric(messageSaved);
register.registerMetric(replayRejected);
register.registerMetric(wsConnections);
register.registerMetric(wsDisconnections);
register.registerMetric(wsAuthFailed);

// Express middleware: считать метрики на каждый запрос
export function httpMetrics(req, res, next) {
  const routeLabel = () => {
    // без высокой кардинальности: используем определённый express path
    try {
      return req.route?.path || req._parsedUrl?.pathname || req.path || 'unknown';
    } catch {
      return 'unknown';
    }
  };
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = routeLabel();
    const status = String(res.statusCode);
    httpRequests.inc({ route, status }, 1);
    const s = Number(process.hrtime.bigint() - start) / 1e9; // seconds
    httpDuration.observe({ route, status }, s);
  });
  next();
}

// /metrics handler
export async function metricsHandler(_req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

// Хелперы для бизнес-событий
export const incMessageSaved = () => messageSaved.inc(1);
export const incReplayRejected = () => replayRejected.inc(1);

// Socket.IO hooks (если используешь)
export function wireWsMetrics(io) {
  io.on('connection', (s) => {
    wsConnections.inc(1);
    s.on('disconnect', () => wsDisconnections.inc(1));
  });
}
// вызывать при auth-ошибке сокета:
export const incWsAuthFailed = () => wsAuthFailed.inc(1);

export { register };
