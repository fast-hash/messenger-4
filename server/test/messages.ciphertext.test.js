import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { createApp } = await import('../src/app.js');
const { default: Message } = await import('../src/models/Message.js');
const { default: Chat } = await import('../src/models/Chat.js');
const { setRedisClient, closeRedis } = await import('../src/services/replayGuard.js');
const { InMemoryRedis } = await import('./helpers/inMemoryRedis.js');

let mongod;
let app;
let request;
let capturedLogs = [];
const fixedSenderId = new mongoose.Types.ObjectId().toString();
const redis = new InMemoryRedis();

function testAuth(req, _res, next) {
  req.user = { id: fixedSenderId };
  next();
}

function audit(line) {
  capturedLogs.push(line);
}

test('setup', async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  capturedLogs = [];
  app = createApp({ authMiddleware: testAuth, audit });
  request = supertest(app);
  setRedisClient(redis);
});

test('rejects plaintext body', async () => {
  capturedLogs = [];
  const res = await request.post('/api/messages').send({ text: 'hello' });
  assert.equal(res.statusCode, 422);
  const count = await Message.countDocuments({});
  assert.equal(count, 0);
  const joined = capturedLogs.join('\n');
  assert.equal(joined.includes('"text":"hello"'), false);
});

test('accepts ciphertext-only and stores no plaintext', async () => {
  await Message.deleteMany({});
  await Chat.deleteMany({});
  redis.clear();
  capturedLogs = [];
  const chatId = new mongoose.Types.ObjectId().toString();
  await Chat.create({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: [new mongoose.Types.ObjectId(fixedSenderId)],
  });
  const payload = Buffer.from('ABCD').toString('base64');
  const res = await request.post('/api/messages').send({ chatId, encryptedPayload: payload });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.id);

  const docs = await Message.find({}).lean();
  assert.equal(docs.length, 1);
  const doc = docs[0];
  assert.ok(typeof doc.encryptedPayload === 'string');
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(doc.encryptedPayload));
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'text'), false);
  assert.equal(doc.chatId.toString(), chatId);
  assert.equal(doc.senderId.toString(), fixedSenderId);
});

test('teardown', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
  await closeRedis();
});
