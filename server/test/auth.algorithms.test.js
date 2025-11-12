import assert from 'node:assert/strict';
import { test } from 'node:test';

import jwt from 'jsonwebtoken';

import { verifyAccess, __resetAuthCache } from '../src/middleware/auth.js';

function withSharedSecret(secret, fn) {
  const previousShared = process.env.JWT_SHARED_SECRET;
  const previousPublic = process.env.JWT_PUBLIC_KEY;
  process.env.JWT_SHARED_SECRET = secret;
  delete process.env.JWT_PUBLIC_KEY;
  __resetAuthCache();
  try {
    fn();
  } finally {
    if (previousShared === undefined) {
      delete process.env.JWT_SHARED_SECRET;
    } else {
      process.env.JWT_SHARED_SECRET = previousShared;
    }
    if (previousPublic === undefined) {
      delete process.env.JWT_PUBLIC_KEY;
    } else {
      process.env.JWT_PUBLIC_KEY = previousPublic;
    }
    __resetAuthCache();
  }
}

test('HS256 tokens are accepted when shared secret configured', () => {
  withSharedSecret('unit-test-secret', () => {
    const token = jwt.sign({ sub: 'hs-user', userId: 'hs-user' }, 'unit-test-secret', {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
    const payload = verifyAccess(token);
    assert.equal(payload.id, 'hs-user');
    assert.equal(payload.sub, 'hs-user');
    assert.equal(payload.userId, 'hs-user');
  });
});

test('tokens signed with unsupported algorithm are rejected', () => {
  withSharedSecret('unit-test-secret', () => {
    const token = jwt.sign({ sub: 'bad-alg' }, 'unit-test-secret', {
      algorithm: 'HS384',
      expiresIn: '5m',
    });
    assert.throws(() => verifyAccess(token));
  });
});
