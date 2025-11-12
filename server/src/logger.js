import { randomUUID } from 'node:crypto';

export function requestIdLogger(req, res, next) {
  const rid = req.headers['x-request-id'] || randomUUID();
  // eslint-disable-next-line no-param-reassign
  req.id = rid;
  res.setHeader('X-Request-Id', rid);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    // ВНИМАНИЕ: ничего чувствительного не логируем
    const safePath = req.route?.path || req._parsedUrl?.pathname || req.path || req.url || '/';
    const entry = {
      t: new Date().toISOString(),
      level: 'info',
      reqId: rid,
      method: req.method,
      path: safePath,
      status: res.statusCode,
      dur_ms: Math.round(durMs),
      ip: req.ip,
    };
    // защита от случайного слива заголовков
    // не логируем тела и authorization
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  });
  next();
}
