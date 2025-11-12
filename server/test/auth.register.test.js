import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

import { createApp } from '../src/app.js';

let mongod;
let request;

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

test('setup register fixtures', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('auth-register')); 

  const app = createApp();
  request = supertest(app);
});

test('register rejects duplicate usernames', async () => {
  const basePayload = {
    username: 'duplicate-user',
    email: 'first@example.com',
    password: 'StrongPass123',
    publicKey: 'Zmlyc3QtcHVibGljLWtleQ==',
  };

  const first = await request.post('/api/auth/register').send(basePayload);
  assert.equal(first.statusCode, 201);
  assert.equal(typeof first.body?.userId, 'string');
  assert.ok(first.headers['set-cookie']);

  const second = await request.post('/api/auth/register').send({
    ...basePayload,
    email: 'second@example.com',
    publicKey: 'c2Vjb25kLXB1YmxpYy1rZXk=',
  });

  assert.equal(second.statusCode, 400);
  assert.equal(second.body?.error, 'user_exists');
});

test('register rejects malformed public key material', async () => {
  const res = await request.post('/api/auth/register').send({
    username: 'malformed-user',
    email: 'malformed@example.com',
    password: 'StrongPass123',
    publicKey: ' not-base64 ',
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, 'invalid_payload');
});

test('teardown register fixtures', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});
