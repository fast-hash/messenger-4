import http from 'http';
import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import { setupTestLibsignal } from '../../client/test/libsignal-stub.mjs';
import { createApp } from '../src/app.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import { setRedisClient, closeRedis } from '../src/services/replayGuard.js';

import { InMemoryRedis } from './helpers/inMemoryRedis.js';

setupTestLibsignal();

const { generateIdentityAndPreKeys, initSession, resetSignalState } = await import(
  '../../client/src/crypto/signal.js'
);
const { sendMessage, history } = await import('../../client/src/api/api.js');

let mongod;
let server;
let baseUrl;
const senderId = new mongoose.Types.ObjectId().toString();
const redis = new InMemoryRedis();

function authStub(req, _res, next) {
  req.user = { id: senderId };
  next();
}

test('setup', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = createApp({ authMiddleware: authStub });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  globalThis.__API_BASE_URL = baseUrl;
  setRedisClient(redis);
});

test('http round-trip encrypts, stores, and decrypts', async () => {
  resetSignalState();
  const material = await generateIdentityAndPreKeys();
  const recipientId = new mongoose.Types.ObjectId().toString();
  const bundle = {
    identityKey: material.bundle.identityKey,
    signedPreKey: material.bundle.signedPreKey,
    oneTimePreKey: material.bundle.oneTimePreKeys[0],
  };

  await initSession(recipientId, bundle);

  const chatId = new mongoose.Types.ObjectId().toString();
  await Chat.create({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: [new mongoose.Types.ObjectId(senderId)],
  });
  const plaintext = 'integration ciphertext message';

  await sendMessage(chatId, plaintext);

  const stored = await Message.findOne({ chatId: new mongoose.Types.ObjectId(chatId) }).lean();
  assert.ok(stored, 'message should be stored');
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'text'), false);
  assert.match(stored.encryptedPayload, /^[A-Za-z0-9+/=]+$/);

  const { messages: items } = await history(chatId);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, plaintext);
  assert.equal(items[0].encryptedPayload, stored.encryptedPayload);
});

test('teardown', async () => {
  delete globalThis.__API_BASE_URL;
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
