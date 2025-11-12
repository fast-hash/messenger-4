import assert from 'node:assert/strict';
import { test } from 'node:test';

import 'fake-indexeddb/auto';
import { initVault, changePassphrase, unlockVault } from '../src/crypto/keystore.js';

test('multiple passphrase rotations preserve data', async () => {
  const data = { keys: { id: 'u-1', priv: 'K' } };
  await initVault(data, 'p0');
  for (let i = 0; i < 10; i++) {
    await changePassphrase(`p${i}`, `p${i + 1}`);
    const d = await unlockVault(`p${i + 1}`);
    assert.deepEqual(d, data);
  }
});
