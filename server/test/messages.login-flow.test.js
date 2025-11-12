import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

import { createApp } from '../src/app.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import User from '../src/models/User.js';
import { setRedisClient, closeRedis } from '../src/services/replayGuard.js';

import { InMemoryRedis } from './helpers/inMemoryRedis.js';

let mongod;
let request;
let privateKey;
const redis = new InMemoryRedis();

test('setup', async () => {
  const { privateKey: priv, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = priv.export({ type: 'pkcs1', format: 'pem' });
  const pubKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' });
  process.env.JWT_PUBLIC_KEY = pubKeyPem;
  process.env.JWT_CLOCK_TOLERANCE_SEC = '120';

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = createApp();
  request = supertest(app);
  setRedisClient(redis);
});

test('POST /api/messages succeeds with login-style token', async () => {
  redis.clear();
  await Promise.all([
    Chat.deleteMany({}),
    Message.deleteMany({}),
    User.deleteMany({}),
  ]);

  const user = await User.create({
    username: 'alice',
    email: 'alice@example.com',
    password: 'not-used-in-test',
    publicKey: 'public-key',
  });

  const chatId = new mongoose.Types.ObjectId().toString();
  await Chat.create({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: [user._id],
  });

  const accessToken = jwt.sign({ userId: user.id }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',
  });

  const encryptedPayload = Buffer.from('ciphertext').toString('base64');
  const res = await request
    .post('/api/messages')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ chatId, encryptedPayload });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.id, /^[a-f\d]{24}$/i);

  const stored = await Message.findOne({
    chatId: new mongoose.Types.ObjectId(chatId),
    senderId: user._id,
  }).lean();
  assert.ok(stored, 'message persisted');
  assert.equal(stored.encryptedPayload, encryptedPayload);
});

test('teardown', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
  redis.clear();
  await closeRedis();
});
