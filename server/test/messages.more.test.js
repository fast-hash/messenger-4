import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

import { createApp } from '../src/app.js';
import Chat from '../src/models/Chat.js';
import { setRedisClient, closeRedis } from '../src/services/replayGuard.js';

import { InMemoryRedis } from './helpers/inMemoryRedis.js';

let mongod, app, request;

const senderId = new mongoose.Types.ObjectId().toString();
function testAuth(req, _res, next) {
  req.user = { id: senderId };
  next();
}
const redis = new InMemoryRedis();

test('setup', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp({ authMiddleware: testAuth });
  request = supertest(app);
  setRedisClient(redis);
});

test('401 without auth', async () => {
  const appNoAuth = createApp({ authMiddleware: (_req, _res, next) => next() });
  const reqNoAuth = supertest(appNoAuth);
  const res = await reqNoAuth
    .post('/api/messages')
    .send({ chatId: '000000000000000000000001', encryptedPayload: 'QUJDRA==' });
  assert.equal(res.statusCode, 401);
});

test('422 invalid chatId', async () => {
  const res = await request
    .post('/api/messages')
    .send({ chatId: 'not_objectid', encryptedPayload: 'QUJDRA==' });
  assert.equal(res.statusCode, 422);
});

test('422 invalid base64', async () => {
  const res = await request
    .post('/api/messages')
    .send({ chatId: '000000000000000000000001', encryptedPayload: '💥' });
  assert.equal(res.statusCode, 422);
});

test('403 when sender not a participant', async () => {
  redis.clear();
  const chatId = new mongoose.Types.ObjectId().toString();
  const payload = Buffer.from('rejected').toString('base64');
  const res = await request.post('/api/messages').send({ chatId, encryptedPayload: payload });
  assert.equal(res.statusCode, 403);
});

test('413 when ciphertext exceeds configured limit', async () => {
  redis.clear();
  await Chat.deleteMany({});
  const chatId = new mongoose.Types.ObjectId().toString();
  await Chat.create({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: [new mongoose.Types.ObjectId(senderId)],
  });
  const max = Number(process.env.MAX_CIPHERTEXT_B64 || 131072);
  const oversized = 'A'.repeat(max + 4);
  const res = await request.post('/api/messages').send({ chatId, encryptedPayload: oversized });
  assert.equal(res.statusCode, 413);
});

test('teardown', async () => {
  await mongoose.disconnect();
  await mongod.stop();
  redis.clear();
  await closeRedis();
});
