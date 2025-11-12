import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import express from 'express';
import { requestIdLogger } from '../src/logger.js';
import {
  httpMetrics,
  metricsHandler,
  incMessageSaved,
  incReplayRejected,
  httpRequests,
  httpDuration,
  messageSaved,
  replayRejected,
} from '../src/metrics.js';

let server;
let base;

before(async () => {
  httpRequests.reset();
  httpDuration.reset();
  messageSaved.reset();
  replayRejected.reset();

  const app = express();
  app.use(requestIdLogger);
  app.use(httpMetrics);
  app.get('/hello', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/simulate/message-saved', (_req, res) => {
    incMessageSaved();
    res.status(204).end();
  });
  app.post('/simulate/replay-rejected', (_req, res) => {
    incReplayRejected();
    res.status(409).end();
  });
  app.get('/metrics', metricsHandler);

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test('http metrics and counters exposed', async () => {
  // дергаем пару эндпойнтов
  let r = await fetch(`${base}/hello`);
  assert.equal(r.status, 200);

  r = await fetch(`${base}/simulate/message-saved`, { method: 'POST' });
  assert.equal(r.status, 204);

  r = await fetch(`${base}/simulate/replay-rejected`, { method: 'POST' });
  assert.equal(r.status, 409);

  const m = await fetch(`${base}/metrics`);
  assert.equal(m.status, 200);
  const txt = await m.text();
  // Базовые метрики присутствуют
  assert.match(txt, /http_requests_total{.*route="\/hello".*status="200"}\s+1/);
  assert.match(txt, /message_saved_total\s+1/);
  assert.match(txt, /replay_rejected_total\s+1/);
  assert.match(txt, /http_request_duration_seconds_bucket{.*}/);
});

test('requestId logger emits JSON without secrets', async () => {
  // перехватываем console.log
  const logs = [];
  const orig = console.log;
  console.log = (line) => logs.push(line);

  const r = await fetch(`${base}/hello`, { headers: { 'X-Request-Id': 'rid-123' } });
  assert.equal(r.status, 200);

  // ждём запись лога
  await new Promise((r2) => setTimeout(r2, 20));
  console.log = orig;

  assert.ok(logs.length >= 1, 'no log lines captured');
  const parsed = JSON.parse(logs[logs.length - 1]);
  assert.equal(parsed.reqId, 'rid-123');
  assert.equal(parsed.path, '/hello');
  assert.equal(parsed.status, 200);
  assert.ok(Number.isInteger(parsed.dur_ms));
  // убедимся, что нет authorization
  assert.ok(!/authorization/i.test(logs.join('')), 'authorization leaked in logs');
});
