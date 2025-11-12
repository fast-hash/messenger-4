import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

import { createApp, attachHttp } from '../src/app.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import { setRedisClient, closeRedis } from '../src/services/replayGuard.js';

import { InMemoryRedis } from './helpers/inMemoryRedis.js';

const senderId = new mongoose.Types.ObjectId().toString();
function testAuth(req, _res, next) {
  req.user = { id: senderId };
  next();
}

let mongod, app, server, request;
const redis = new InMemoryRedis();

test('setup', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setRedisClient(redis);
  const baseApp = createApp({ authMiddleware: testAuth });
  ({ app, server } = await attachHttp(baseApp));
  request = supertest(app);
});

test('first ciphertext ok, duplicate 409', async () => {
  await Chat.deleteMany({});
  await Message.deleteMany({});
  redis.clear();
  const chatId = new mongoose.Types.ObjectId().toString();
  await Chat.create({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: [new mongoose.Types.ObjectId(senderId)],
  });
  const payload = 'QUJDRA==';

  const first = await request.post('/api/messages').send({ chatId, encryptedPayload: payload });
  assert.equal(first.statusCode, 200);

  const duplicate = await request.post('/api/messages').send({ chatId, encryptedPayload: payload });
  assert.equal(duplicate.statusCode, 409);
});

test('teardown', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  redis.clear();
  await closeRedis();
});
