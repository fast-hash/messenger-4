import test from 'node:test';
import assert from 'node:assert/strict';

import { setupTestLibsignal } from './libsignal-stub.mjs';

process.env.NODE_ENV = 'test';

setupTestLibsignal();

const {
  generateIdentityAndPreKeys,
  initSession,
  encryptMessage,
  decryptMessage,
  resetSignalState,
} = await import('../src/crypto/signal.js');

function bundleToBase64(bundle) {
  return Buffer.from(JSON.stringify(bundle), 'utf-8').toString('base64');
}

test('encrypt/decrypt round-trip succeeds for a self session', async () => {
  resetSignalState();
  const material = await generateIdentityAndPreKeys();

  const bundleForPeer = {
    identityKey: material.bundle.identityKey,
    signedPreKey: material.bundle.signedPreKey,
    oneTimePreKey: material.bundle.oneTimePreKeys[0],
  };

  await initSession('self', bundleForPeer);

  const plaintext = 'Привет, ciphertext!';
  const ciphertext = await encryptMessage(plaintext);
  assert.match(ciphertext, /^[A-Za-z0-9+/=]+$/, 'ciphertext should be base64');

  const decrypted = await decryptMessage(ciphertext);
  assert.equal(decrypted, plaintext);
});

test('tampering with ciphertext is detected', async () => {
  resetSignalState();
  const material = await generateIdentityAndPreKeys();
  const bundleBase64 = bundleToBase64({
    identityKey: material.bundle.identityKey,
    signedPreKey: material.bundle.signedPreKey,
    oneTimePreKey: material.bundle.oneTimePreKeys[0],
  });

  await initSession('peer', bundleBase64);
  const ciphertext = await encryptMessage('sensitive data');

  const decoded = Buffer.from(ciphertext, 'base64').toString('utf-8');
  const payload = JSON.parse(decoded);
  const body = Buffer.from(payload.body, 'base64');
  body[0] ^= 0xff;
  payload.body = Buffer.from(body).toString('base64');
  const tampered = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

  await assert.rejects(() => decryptMessage(tampered));
});

test('decrypting with the wrong identity fails', async () => {
  resetSignalState();
  const material = await generateIdentityAndPreKeys();
  const bundle = bundleToBase64({
    identityKey: material.bundle.identityKey,
    signedPreKey: material.bundle.signedPreKey,
    oneTimePreKey: material.bundle.oneTimePreKeys[0],
  });

  await initSession('peer', bundle);
  const ciphertext = await encryptMessage('classified');

  resetSignalState();
  await generateIdentityAndPreKeys();
  await initSession('peer', bundle);
  await assert.rejects(() => decryptMessage(ciphertext));
});
