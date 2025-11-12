import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

import { createApp } from '../src/app.js';

let mongod;
let agent;

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const BASE_USER = {
  username: 'login-user',
  email: 'user@example.com',
  password: 'Sup3rSecret!',
  publicKey: 'bG9naW4tdXNlci1wdWJsaWMta2V5LXNob3VsZC1iZS1iYXNlNjQ=',
};

test('setup login fixtures', async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('auth-login'));

  const app = createApp();
  agent = supertest.agent(app);

  const registerRes = await agent.post('/api/auth/register').send(BASE_USER);
  assert.equal(registerRes.statusCode, 201);
});

test('login is case-insensitive by email and returns session cookie', async () => {
  const res = await agent.post('/api/auth/login').send({
    email: BASE_USER.email.toUpperCase(),
    password: BASE_USER.password,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body?.userId, 'string');
  assert.ok(res.headers['set-cookie']);

  const session = await agent.get('/api/auth/session');
  assert.equal(session.statusCode, 200);
  assert.equal(session.body?.userId, res.body.userId);
});

test('teardown login fixtures', async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});
