import assert from 'node:assert/strict';
import test from 'node:test';

import supertest from 'supertest';

import { createApp } from '../src/app.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

test('metrics endpoint demands bearer token when configured', async () => {
  const previous = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = 'metrics-secret';

  try {
    const app = createApp();
    const request = supertest(app);

    const unauthorized = await request.get('/metrics');
    assert.equal(unauthorized.statusCode, 401);
    assert.match(String(unauthorized.headers['www-authenticate'] || ''), /Bearer/);

    const authorized = await request.get('/metrics').set('Authorization', 'Bearer metrics-secret');
    assert.equal(authorized.statusCode, 200);
    assert.match(authorized.text, /http_requests_total/);
  } finally {
    if (previous === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = previous;
    }
  }
});
