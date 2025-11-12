import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { createApp } = await import('../src/app.js');
const { default: Chat } = await import('../src/models/Chat.js');
const { setRedisClient, closeRedis } = await import('../src/services/replayGuard.js');
const { InMemoryRedis } = await import('./helpers/inMemoryRedis.js');

let mongod;
let app;
let request;
const redis = new InMemoryRedis();
const senderId = new mongoose.Types.ObjectId().toString();
const limit = Number(process.env.MAX_CIPHERTEXT_B64 || 131072) || 131072;

function testAuth(req, _res, next) {
  req.user = { id: senderId };
  next();
}

async function ensureChat(chatId) {
  const chatObjectId = new mongoose.Types.ObjectId(chatId);
  await Chat.deleteMany({ _id: chatObjectId });
  await Chat.create({
    _id: chatObjectId,
    participants: [new mongoose.Types.ObjectId(senderId)],
  });
}

test('setup', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp({ authMiddleware: testAuth });
  request = supertest(app);
  setRedisClient(redis);
});

test('rejects ciphertext above MAX_CIPHERTEXT_B64', async () => {
  const chatId = new mongoose.Types.ObjectId().toString();
  await ensureChat(chatId);
  redis.clear();
  const oversized = 'A'.repeat(limit + 4);
  const res = await request.post('/api/messages').send({ chatId, encryptedPayload: oversized });
  assert.equal(res.statusCode, 413);
});

test('accepts ciphertext exactly at MAX_CIPHERTEXT_B64', async () => {
  const chatId = new mongoose.Types.ObjectId().toString();
  await ensureChat(chatId);
  redis.clear();
  const boundary = 'A'.repeat(limit);
  const res = await request.post('/api/messages').send({ chatId, encryptedPayload: boundary });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('rejects malformed base64 payloads', async () => {
  const chatId = new mongoose.Types.ObjectId().toString();
  await ensureChat(chatId);
  redis.clear();
  const invalids = ['', 'QUJDRA', '"QUJDRA=="', 'Привет'];
  for (const value of invalids) {
    const res = await request.post('/api/messages').send({ chatId, encryptedPayload: value });
    assert.equal(res.statusCode, 422);
  }
});

test('teardown', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
  await closeRedis();
});
