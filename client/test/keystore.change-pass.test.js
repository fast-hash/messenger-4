import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import 'fake-indexeddb/auto';

if (!globalThis.crypto?.subtle) throw new Error('WebCrypto not available; use Node 20+');

import {
  initVault,
  changePassphrase,
  unlockVault,
  getVaultSnapshot,
} from '../src/crypto/keystore.js';

const INITIAL = { keys: { id: 'u-1', priv: 'super-secret' }, ts: 1717171717 };
const P1 = 'old-pass-🔐';
const P2 = 'new-P@ss-🔑';

beforeEach(async () => {
  const req = indexedDB.deleteDatabase('secure-keystore');
  await new Promise((res, rej) => {
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
  await initVault(INITIAL, P1);
});

test('wrong old passphrase -> error and no change', async () => {
  await assert.rejects(() => changePassphrase('WRONG', P2), /BAD_OLD_PASSPHRASE/);
  const snap = await unlockVault(P1);
  assert.deepEqual(snap, INITIAL);
});

test('change passphrase -> new salt/iv; new pass decrypts; old fails', async () => {
  const before = await getVaultSnapshot();
  assert.ok(before?.ct && before?.kdf?.salt && before?.cipher?.iv);

  const ok = await changePassphrase(P1, P2);
  assert.equal(ok, true);

  await assert.rejects(() => unlockVault(P1));
  const afterData = await unlockVault(P2);
  assert.deepEqual(afterData, INITIAL);

  const after = await getVaultSnapshot();
  assert.notEqual(after.kdf.salt, before.kdf.salt);
  assert.notEqual(after.cipher.iv, before.cipher.iv);
});

test('no LS/SS usage present in test environment', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined');
  assert.equal(typeof globalThis.sessionStorage, 'undefined');
});
