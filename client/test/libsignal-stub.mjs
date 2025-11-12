import { webcrypto } from 'node:crypto';

const encoder = new TextEncoder();
const sessionSecrets = new Map();

function randomBytes(scope, length) {
  const arr = new Uint8Array(length);
  scope.crypto.getRandomValues(arr);
  return arr;
}

function bufferToBase64(source) {
  return Buffer.from(new Uint8Array(source)).toString('base64');
}

async function deriveSessionKey(scope, identityKey, address, localIdentity) {
  const identity = bufferToBase64(identityKey);
  const material = encoder.encode(`${identity}:${address.name}:${localIdentity}`);
  const hash = await scope.crypto.subtle.digest('SHA-256', material);
  return scope.crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function setupTestLibsignal() {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }
  if (!globalThis.window) {
    globalThis.window = globalThis;
  }
  const scope = globalThis.window;
  scope.dcodeIO ||= {};
  scope.crypto ||= globalThis.crypto;
  scope.btoa ||= (str) => Buffer.from(str, 'binary').toString('base64');
  scope.atob ||= (str) => Buffer.from(str, 'base64').toString('binary');

  if (scope.libsignal?.__testDouble) {
    return;
  }

  const store = new Map();
  scope.libsignal = {
    __testDouble: true,
    KeyHelper: {
      async generateIdentityKeyPair() {
        return {
          pubKey: randomBytes(scope, 32).buffer,
          privKey: randomBytes(scope, 32).buffer,
        };
      },
      async generateRegistrationId() {
        return Math.floor(Math.random() * 1e6) + 1;
      },
      async generatePreKey(keyId) {
        return {
          keyId,
          keyPair: {
            pubKey: randomBytes(scope, 32).buffer,
            privKey: randomBytes(scope, 32).buffer,
          },
        };
      },
      async generateSignedPreKey(identityKeyPair, keyId) {
        return {
          keyId,
          keyPair: {
            pubKey: randomBytes(scope, 32).buffer,
            privKey: randomBytes(scope, 32).buffer,
          },
          signature: randomBytes(scope, 64).buffer,
        };
      },
    },
    SignalProtocolAddress: class {
      constructor(name, deviceId) {
        this.name = name;
        this.deviceId = deviceId;
      }
    },
    SessionBuilder: class {
      constructor(storeProvider, address) {
        this.address = address;
        this.store = storeProvider;
      }

      async processPreKey(bundle) {
        const local = this.store.getIdentityKeyPair?.();
        if (!local) {
          throw new Error('Local identity missing');
        }
        const localIdentity = bufferToBase64(local.pubKey);
        const key = await deriveSessionKey(scope, bundle.identityKey, this.address, localIdentity);
        sessionSecrets.set(this.address.name, key);
      }
    },
    SessionCipher: class {
      constructor(storeProvider, address) {
        this.address = address;
        this.store = storeProvider;
      }

      async encrypt(plaintext) {
        const key = sessionSecrets.get(this.address.name);
        if (!key) throw new Error('Session key missing');
        const iv = randomBytes(scope, 12);
        const ciphertext = await scope.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          plaintext
        );
        const body = new Uint8Array(iv.byteLength + ciphertext.byteLength);
        body.set(iv, 0);
        body.set(new Uint8Array(ciphertext), iv.byteLength);
        return { type: 3, body };
      }

      async decryptPreKeyWhisperMessage(body) {
        return this.#decrypt(body);
      }

      async decryptWhisperMessage(body) {
        return this.#decrypt(body);
      }

      async #decrypt(body) {
        const key = sessionSecrets.get(this.address.name);
        if (!key) throw new Error('Session key missing');
        const data = new Uint8Array(body);
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);
        return scope.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      }
    },
  };

  if (!scope.signalStore) {
    scope.signalStore = store;
  }
}
