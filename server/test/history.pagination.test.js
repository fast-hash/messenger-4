import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

import { createApp } from '../src/app.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';

let mongod;
let request;
let chatId;
let senderId;

const decodeOrdinal = (encryptedPayload) => {
  const decoded = Buffer.from(encryptedPayload, 'base64').toString('utf-8');
  const [, suffix] = decoded.split('-');
  return Number.parseInt(suffix, 10);
};

test('setup history pagination fixtures', async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('history-pagination');
  await mongoose.connect(uri);

  senderId = new mongoose.Types.ObjectId();
  chatId = new mongoose.Types.ObjectId();

  await Chat.create({
    _id: chatId,
    participants: [senderId.toString()],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const base = new Date('2024-01-01T00:00:00.000Z');
  const documents = Array.from({ length: 200 }, (_, index) => {
    const ordinal = index + 1;
    return {
      chatId,
      senderId,
      encryptedPayload: Buffer.from(`msg-${ordinal}`, 'utf-8').toString('base64'),
      createdAt: new Date(base.getTime() + index * 1000),
      updatedAt: new Date(base.getTime() + index * 1000),
    };
  });

  await Message.insertMany(documents);

  const authBypass = (req, _res, next) => {
    req.user = { id: senderId.toString() };
    next();
  };

  const app = createApp({ authMiddleware: authBypass });
  request = supertest(app);
});

test('history pagination yields stable, deduplicated pages', async () => {
  const seenOrdinals = new Set();
  let cursor = null;

  for (let page = 0; page < 4; page += 1) {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const res = await request.get(`/api/messages/${chatId.toString()}?${query.toString()}`);
    assert.equal(res.statusCode, 200, `page ${page + 1} should succeed`);

    const { messages, hasMore, nextCursor } = res.body ?? {};
    assert.ok(Array.isArray(messages), 'messages should be an array');
    assert.equal(messages.length, 50, `page ${page + 1} should return 50 items`);

    const ordinals = messages.map((msg) => decodeOrdinal(msg.encryptedPayload));

    for (let i = 1; i < ordinals.length; i += 1) {
      assert.ok(ordinals[i] > ordinals[i - 1], 'messages must be ascending by createdAt');
    }

    const expectedMax = 200 - page * 50;
    const expectedMin = expectedMax - 49;
    assert.equal(ordinals[0], expectedMin, 'first ordinal should match expected window start');
    assert.equal(
      ordinals[ordinals.length - 1],
      expectedMax,
      'last ordinal should match window end'
    );

    for (const ordinal of ordinals) {
      assert.equal(seenOrdinals.has(ordinal), false, `ordinal ${ordinal} duplicated`);
      seenOrdinals.add(ordinal);
    }

    if (page < 3) {
      assert.equal(hasMore, true, 'should report more history before final page');
      assert.equal(typeof nextCursor, 'string', 'nextCursor should be provided');
      cursor = nextCursor;
    } else {
      assert.equal(hasMore, false, 'last page should not report more history');
      assert.equal(nextCursor, null, 'last page cursor must be null');
    }
  }

  assert.equal(seenOrdinals.size, 200, 'all ordinals should be seen exactly once');
});

test('history limit validation', async () => {
  const resLow = await request.get(`/api/messages/${chatId.toString()}?limit=0`);
  assert.equal(resLow.statusCode, 400);

  const resHigh = await request.get(`/api/messages/${chatId.toString()}?limit=500`);
  assert.equal(resHigh.statusCode, 400);

  const resCursor = await request.get(
    `/api/messages/${chatId.toString()}?limit=50&cursor=not-a-valid-cursor`
  );
  assert.equal(resCursor.statusCode, 400);
});

test('teardown history pagination fixtures', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});
