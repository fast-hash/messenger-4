import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import express from 'express';
import { requestIdLogger } from '../src/logger.js';

let srv, base;
before(async () => {
  const app = express();
  app.use(requestIdLogger);
  app.get('/ping', (_req, res) => res.status(200).end());
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  await new Promise((r) => srv.close(r));
});

test('Authorization header never appears in logs', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (x) => logs.push(String(x));
  const r = await fetch(`${base}/ping`, { headers: { Authorization: 'Bearer SECRET' } });
  console.log = orig;
  assert.equal(r.status, 200);
  assert.ok(!/authorization/i.test(logs.join('')));
});
