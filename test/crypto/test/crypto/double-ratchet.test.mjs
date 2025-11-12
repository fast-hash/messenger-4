import test from 'node:test';
import assert from 'node:assert/strict';

import { setupTestLibsignal } from '../../client/test/libsignal-stub.mjs';

process.env.NODE_ENV = 'test';
setupTestLibsignal();

const {
  generateIdentityAndPreKeys,
  initSession,
  encryptMessage,
  decryptMessage,
  resetSignalState,
} = await import('../../client/src/crypto/signal.js');

function buildPeerBundle(material) {
  return {
    identityKey: material.bundle.identityKey,
    signedPreKey: material.bundle.signedPreKey,
    oneTimePreKey: material.bundle.oneTimePreKeys[0],
  };
}

test('Double Ratchet enforces forward secrecy after state reset', async () => {
  resetSignalState();
  const local = await generateIdentityAndPreKeys();
  const bundle = buildPeerBundle(local);
  await initSession('peer', bundle);

  const ciphertext = await encryptMessage('alpha');
  assert.equal(await decryptMessage(ciphertext), 'alpha');

  resetSignalState();
  await generateIdentityAndPreKeys();
  await initSession('peer', bundle);

  await assert.rejects(() => decryptMessage(ciphertext));
});

test('Double Ratchet recovers after break-in with fresh session material', async () => {
  resetSignalState();
  const first = await generateIdentityAndPreKeys();
  await initSession('peer', buildPeerBundle(first));
  await encryptMessage('preface');

  resetSignalState();
  const restored = await generateIdentityAndPreKeys();
  await initSession('peer', buildPeerBundle(restored));

  const cipher = await encryptMessage('post-compromise message');
  assert.equal(await decryptMessage(cipher), 'post-compromise message');
});

test('Double Ratchet tolerates out-of-order delivery', async () => {
  resetSignalState();
  const material = await generateIdentityAndPreKeys();
  await initSession('peer', buildPeerBundle(material));

  const m1 = await encryptMessage('first');
  const m2 = await encryptMessage('second');
  const m3 = await encryptMessage('third');

  assert.equal(await decryptMessage(m3), 'third');
  assert.equal(await decryptMessage(m1), 'first');
  assert.equal(await decryptMessage(m2), 'second');
});

test('Double Ratchet rejects ciphertext replay attempts', async () => {
  resetSignalState();
  const material = await generateIdentityAndPreKeys();
  await initSession('peer', buildPeerBundle(material));

  const cipher = await encryptMessage('unique payload');
  assert.equal(await decryptMessage(cipher), 'unique payload');
  await assert.rejects(() => decryptMessage(cipher), /replay/i);
});
