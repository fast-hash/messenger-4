import test from 'node:test';
import assert from 'node:assert/strict';

import { api } from '../src/api/api.js';

function isFunction(fn) {
  return typeof fn === 'function';
}

test('client API exposes the expected messaging helpers', () => {
  assert.ok(isFunction(api.getBundle), 'getBundle is missing');
  assert.ok(isFunction(api.sendMessage), 'sendMessage is missing');
  assert.ok(isFunction(api.history), 'history is missing');
});
