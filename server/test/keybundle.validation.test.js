import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.KEYBUNDLE_MAX_PREKEYS = '5';

const { createApp } = await import('../src/app.js');
const { default: KeyBundle } = await import('../src/models/KeyBundle.js');

let mongod;
let app;
let request;
const userId = new mongoose.Types.ObjectId().toString();

function authStub(req, _res, next) {
  req.user = { id: userId };
  next();
}

const VALID_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const VALID_SIGNATURE = 'c2lnbmF0dXJlMDEyMzQ1Njc4OWFiY2RlZnNpZ25hdHVyZTAxMjM0NTY3ODlhYmNkZWY=';

const basePayload = {
  identityKey: VALID_KEY,
  signedPreKey: {
    keyId: 1,
    publicKey: VALID_KEY,
    signature: VALID_SIGNATURE,
  },
};

test('setup', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp({ authMiddleware: authStub });
  request = supertest(app);
});

test('rejects invalid one-time pre-key payloads', async () => {
  const cases = [
    [{ keyId: '1', publicKey: VALID_KEY }],
    [{ keyId: 1 }],
    [{ keyId: 1, publicKey: '' }],
    [{ keyId: 1, publicKey: 'not-base64!!' }],
    [{ keyId: -1, publicKey: VALID_KEY }],
    Array.from({ length: 10 }, (_, idx) => ({ keyId: idx, publicKey: VALID_KEY })),
  ];

  for (const invalid of cases) {
    const res = await request.post('/api/keybundle').send({
      ...basePayload,
      oneTimePreKeys: invalid,
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_payload');
  }
});

test('rejects invalid identity or signed pre-key payloads', async () => {
  const invalidRequests = [
    { ...basePayload, identityKey: 'not-base64' },
    { ...basePayload, identityKey: '   ' + VALID_KEY },
    { ...basePayload, signedPreKey: { ...basePayload.signedPreKey, keyId: -5 } },
    { ...basePayload, signedPreKey: { ...basePayload.signedPreKey, publicKey: 'bad' } },
    { ...basePayload, signedPreKey: { ...basePayload.signedPreKey, signature: 'bad' } },
  ];

  for (const payload of invalidRequests) {
    const res = await request.post('/api/keybundle').send({
      ...payload,
      oneTimePreKeys: [],
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_payload');
  }
});

test('deduplicates one-time pre-keys before persisting', async () => {
  const bundle = {
    ...basePayload,
    oneTimePreKeys: [
      { keyId: 1, publicKey: VALID_KEY },
      { keyId: 1, publicKey: VALID_KEY },
      { keyId: 2, publicKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZTA=' },
      { keyId: 2, publicKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZTA=' },
    ],
  };

  const res = await request.post('/api/keybundle').send(bundle);
  assert.equal(res.statusCode, 204);

  const stored = await KeyBundle.findOne({ userId }).lean();
  assert.ok(stored);
  assert.equal(stored.oneTimePreKeys.length, 2);
  assert.deepEqual(
    stored.oneTimePreKeys.map(({ keyId, publicKey }) => ({ keyId, publicKey })),
    [
      { keyId: 1, publicKey: VALID_KEY },
      { keyId: 2, publicKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZTA=' },
    ]
  );
});

test('teardown', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});
