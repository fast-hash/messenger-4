import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { createApp } = await import('../src/app.js');

let mongod;
let app;
let request;

function authStub(req, _res, next) {
  req.user = { id: new mongoose.Types.ObjectId().toString() };
  next();
}

test('setup', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp({ authMiddleware: authStub });
  request = supertest(app);
});

test('GET /api/keybundle/:userId rejects invalid userId values', async () => {
  const invalidIds = ['not-a-valid-oid', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz'];
  for (const invalidId of invalidIds) {
    const res = await request.get(`/api/keybundle/${invalidId}`);
    assert.equal(res.statusCode, 400, `should reject ${invalidId}`);
    assert.equal(res.body?.error, 'invalid_userId');
  }
});

test('teardown', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});
