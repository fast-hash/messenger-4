const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function ensureUint8(view) {
  if (view instanceof Uint8Array) {
    return view;
  }
  if (view instanceof ArrayBuffer) {
    return new Uint8Array(view);
  }
  if (ArrayBuffer.isView(view)) {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  throw new TypeError('Unsupported binary type');
}

function toArrayBuffer(view) {
  const bytes = ensureUint8(view);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function encodeBinary(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return binary;
}

function decodeBinary(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

function base64EncodeBytes(globalScope, bytes) {
  const data = ensureUint8(bytes);
  if (typeof globalScope.btoa === 'function') {
    return globalScope.btoa(encodeBinary(data));
  }
  if (typeof globalScope.Buffer !== 'undefined') {
    return globalScope.Buffer.from(data).toString('base64');
  }
  throw new Error('Base64 encoding not supported in this environment');
}

function base64DecodeToBytes(globalScope, str) {
  if (typeof globalScope.atob === 'function') {
    return decodeBinary(globalScope.atob(str));
  }
  if (typeof globalScope.Buffer !== 'undefined') {
    return new Uint8Array(globalScope.Buffer.from(str, 'base64'));
  }
  throw new Error('Base64 decoding not supported in this environment');
}

function base64EncodeString(globalScope, value) {
  return base64EncodeBytes(globalScope, textEncoder.encode(value));
}

function base64DecodeToString(globalScope, value) {
  return textDecoder.decode(base64DecodeToBytes(globalScope, value));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseBundle(globalScope, input) {
  if (!input) {
    throw new Error('Remote pre-key bundle is required');
  }

  let bundle;
  if (typeof input === 'string') {
    bundle = JSON.parse(base64DecodeToString(globalScope, input));
  } else if (typeof input === 'object') {
    bundle = input;
  } else {
    throw new TypeError('Unsupported bundle format');
  }

  if (!bundle.identityKey || !bundle.signedPreKey) {
    throw new Error('Pre-key bundle is missing mandatory fields');
  }

  const oneTimePreKey =
    bundle.preKey ||
    bundle.oneTimePreKey ||
    (Array.isArray(bundle.oneTimePreKeys) ? bundle.oneTimePreKeys[0] : null);
  if (!oneTimePreKey) {
    throw new Error('Pre-key bundle does not contain a pre-key');
  }

  return {
    registrationId: bundle.registrationId || 1,
    identityKey: toArrayBuffer(base64DecodeToBytes(globalScope, bundle.identityKey)),
    signedPreKey: {
      keyId: bundle.signedPreKey.keyId,
      publicKey: toArrayBuffer(base64DecodeToBytes(globalScope, bundle.signedPreKey.publicKey)),
      signature: toArrayBuffer(base64DecodeToBytes(globalScope, bundle.signedPreKey.signature)),
    },
    preKey: {
      keyId: oneTimePreKey.keyId,
      publicKey: toArrayBuffer(base64DecodeToBytes(globalScope, oneTimePreKey.publicKey)),
    },
  };
}

function getAddress(libsignal, recipientId) {
  return new libsignal.SignalProtocolAddress(recipientId, 1);
}

function serialiseEnvelope(globalScope, envelope) {
  return base64EncodeString(globalScope, JSON.stringify(envelope));
}

function deserialiseEnvelope(globalScope, serialised) {
  const payload = JSON.parse(base64DecodeToString(globalScope, serialised));
  if (typeof payload.body !== 'string') {
    throw new Error('Encrypted payload is not base64');
  }
  return payload;
}

export function setupCryptoWorker({
  globalScope,
  addMessageListener,
  postMessage,
  ensureCrypto,
  loadLibsignal,
}) {
  if (!globalScope) {
    throw new Error('globalScope is required');
  }
  if (!addMessageListener || !postMessage || !loadLibsignal) {
    throw new Error('Worker communication hooks are missing');
  }

  if (!globalScope.window) {
    globalScope.window = globalScope;
  }

  const memoryStore = new Map();
  let activeRecipientId = null;
  let libsignalPromise = null;
  const seenCiphertexts = new Map();

  async function ensureLibsignal() {
    if (!libsignalPromise) {
      libsignalPromise = (async () => {
        if (ensureCrypto) {
          await ensureCrypto();
        }

        await loadLibsignal();

        const started = Date.now();
        while (!globalScope.libsignal) {
          if (Date.now() - started > 5000) {
            throw new Error('libsignal runtime did not initialise in worker');
          }
          await wait(10);
        }

        if (!globalScope.signalStore) {
          globalScope.signalStore = memoryStore;
        }

        return globalScope.libsignal;
      })();
    }

    return libsignalPromise;
  }

  function storeValue(key, value) {
    if (value === undefined || value === null) {
      memoryStore.delete(key);
      return;
    }
    memoryStore.set(key, value);
  }

  function getValue(key) {
    return memoryStore.get(key) ?? null;
  }

  function identityKeyFingerprint(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return base64EncodeBytes(globalScope, ensureUint8(value));
    } catch (err) {
      console.warn('worker: failed to derive identity fingerprint', err);
      return null;
    }
  }

  function identitiesMatch(existing, candidate) {
    if (!existing || !candidate) {
      return true;
    }
    const existingFingerprint = identityKeyFingerprint(existing);
    const candidateFingerprint = identityKeyFingerprint(candidate);
    if (!existingFingerprint || !candidateFingerprint) {
      return false;
    }
    return existingFingerprint === candidateFingerprint;
  }

  const signalStore = {
    getIdentityKeyPair: () => getValue('identityKeyPair'),
    setIdentityKeyPair: (value) => storeValue('identityKeyPair', value),
    getLocalRegistrationId: () => getValue('registrationId'),
    setLocalRegistrationId: (value) => storeValue('registrationId', value),

    loadPreKey: (keyId) => getValue(`25519KeypreKey${keyId}`),
    storePreKey: (keyId, keyPair) => storeValue(`25519KeypreKey${keyId}`, keyPair),
    removePreKey: (keyId) => storeValue(`25519KeypreKey${keyId}`, undefined),

    loadSignedPreKey: (keyId) => getValue(`25519KeysignedKey${keyId}`),
    storeSignedPreKey: (keyId, keyPair) => storeValue(`25519KeysignedKey${keyId}`, keyPair),
    removeSignedPreKey: (keyId) => storeValue(`25519KeysignedKey${keyId}`, undefined),

    loadSession: (id) => getValue(`session${id}`),
    storeSession: (id, session) => storeValue(`session${id}`, session),
    removeSession: (id) => storeValue(`session${id}`, undefined),

    isTrustedIdentity: (id, identityKey) => {
      if (!id) {
        return false;
      }
      const stored = getValue(`identityKey${id}`);
      if (!stored) {
        return true;
      }
      if (!identityKey) {
        return true;
      }
      return identitiesMatch(stored, identityKey);
    },
    loadIdentityKey: (id) => getValue(`identityKey${id}`),
    saveIdentity: (id, identityKey) => {
      const key = `identityKey${id}`;
      const previous = getValue(key);
      storeValue(key, identityKey);
      if (!identityKey) {
        return false;
      }
      const prevFingerprint = identityKeyFingerprint(previous);
      const nextFingerprint = identityKeyFingerprint(identityKey);
      if (!nextFingerprint) {
        return false;
      }
      return !prevFingerprint || prevFingerprint !== nextFingerprint;
    },

    reset: () => {
      memoryStore.clear();
    },
  };

  function requireIdentityMaterial() {
    const identityKeyPair = signalStore.getIdentityKeyPair();
    const registrationId = signalStore.getLocalRegistrationId();
    if (!identityKeyPair || !registrationId) {
      throw new Error(
        'Identity keys are not loaded. Generate or load them before using Signal sessions.'
      );
    }
    return { identityKeyPair, registrationId };
  }

  function ensureActiveRecipient() {
    if (!activeRecipientId) {
      throw new Error('Signal session is not initialised. Call initSession first.');
    }
    return activeRecipientId;
  }

  async function generateIdentityAndPreKeys() {
    const libsignal = await ensureLibsignal();

    let identityKeyPair = signalStore.getIdentityKeyPair();
    let registrationId = signalStore.getLocalRegistrationId();

    if (!identityKeyPair || !registrationId) {
      identityKeyPair = await libsignal.KeyHelper.generateIdentityKeyPair();
      registrationId = await libsignal.KeyHelper.generateRegistrationId();
      signalStore.setIdentityKeyPair(identityKeyPair);
      signalStore.setLocalRegistrationId(registrationId);
    }

    const preKeyId = 1;
    const signedPreKeyId = 1;

    const preKey = await libsignal.KeyHelper.generatePreKey(preKeyId);
    const signedPreKey = await libsignal.KeyHelper.generateSignedPreKey(
      identityKeyPair,
      signedPreKeyId
    );

    signalStore.storePreKey(preKeyId, preKey.keyPair);
    signalStore.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

    const bundle = {
      identityKey: base64EncodeBytes(globalScope, ensureUint8(identityKeyPair.pubKey)),
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: base64EncodeBytes(globalScope, ensureUint8(signedPreKey.keyPair.pubKey)),
        signature: base64EncodeBytes(globalScope, ensureUint8(signedPreKey.signature)),
      },
      oneTimePreKeys: [
        {
          keyId: preKeyId,
          publicKey: base64EncodeBytes(globalScope, ensureUint8(preKey.keyPair.pubKey)),
        },
      ],
    };

    return {
      bundle,
      identityKeyPair,
      registrationId,
      signedPreKey: {
        keyId: signedPreKeyId,
        keyPair: signedPreKey.keyPair,
        signature: signedPreKey.signature,
      },
      oneTimePreKeys: [
        {
          keyId: preKeyId,
          keyPair: preKey.keyPair,
        },
      ],
    };
  }

  async function initSession(recipientId, bundleBase64) {
    const libsignal = await ensureLibsignal();
    requireIdentityMaterial();

    activeRecipientId = recipientId;

    if (!bundleBase64) {
      return null;
    }

    const address = getAddress(libsignal, recipientId);
    const builder = new libsignal.SessionBuilder(signalStore, address);
    const preKeyBundle = normaliseBundle(globalScope, bundleBase64);
    await builder.processPreKey(preKeyBundle);
    return null;
  }

  async function encryptMessage(utf8Plaintext) {
    const libsignal = await ensureLibsignal();
    requireIdentityMaterial();
    const recipientId = ensureActiveRecipient();
    const address = getAddress(libsignal, recipientId);
    const cipher = new libsignal.SessionCipher(signalStore, address);

    const message = await cipher.encrypt(textEncoder.encode(utf8Plaintext));
    const body = ensureUint8(message.body);

    const envelope = {
      type: message.type,
      body: base64EncodeBytes(globalScope, body),
    };

    return serialiseEnvelope(globalScope, envelope);
  }

  async function decryptMessage(ciphertextBase64) {
    const libsignal = await ensureLibsignal();
    requireIdentityMaterial();
    const recipientId = ensureActiveRecipient();
    const address = getAddress(libsignal, recipientId);
    const cipher = new libsignal.SessionCipher(signalStore, address);

    const envelope = deserialiseEnvelope(globalScope, ciphertextBase64);
    const bodyBytes = base64DecodeToBytes(globalScope, envelope.body);

    let seenForRecipient = seenCiphertexts.get(recipientId);
    if (!seenForRecipient) {
      seenForRecipient = new Set();
      seenCiphertexts.set(recipientId, seenForRecipient);
    }
    const replayKey = `${envelope.type}:${envelope.body}`;
    if (seenForRecipient.has(replayKey)) {
      throw new Error('Replay detected for ciphertext');
    }

    const method = envelope.type === 3 ? 'decryptPreKeyWhisperMessage' : 'decryptWhisperMessage';

    const plaintext = await cipher[method](toArrayBuffer(bodyBytes), 'binary');
    seenForRecipient.add(replayKey);
    return textDecoder.decode(ensureUint8(plaintext));
  }

  const handlers = {
    async init() {
      await ensureLibsignal();
      return { ok: true };
    },
    async 'store:set'(payload) {
      storeValue(payload.key, payload.value);
      return { ok: true };
    },
    async 'store:remove'(payload) {
      storeValue(payload.key, undefined);
      return { ok: true };
    },
    async 'store:clear'() {
      memoryStore.clear();
      activeRecipientId = null;
      seenCiphertexts.clear();
      return { ok: true };
    },
    async generateIdentityAndPreKeys() {
      const material = await generateIdentityAndPreKeys();
      return { material };
    },
    async initSession(payload) {
      await initSession(payload.recipientId, payload.bundleBase64);
      return { ok: true };
    },
    async encryptMessage(payload) {
      const ciphertext = await encryptMessage(payload.plaintext);
      return { ciphertext };
    },
    async decryptMessage(payload) {
      const plaintext = await decryptMessage(payload.ciphertext);
      return { plaintext };
    },
  };

  addMessageListener(async (event) => {
    const { id, action, payload } = event?.data || {};
    if (typeof id === 'undefined' || !action) {
      return;
    }

    try {
      if (!Object.prototype.hasOwnProperty.call(handlers, action)) {
        throw new Error(`Unknown crypto worker action: ${action}`);
      }
      const result = await handlers[action](payload || {});
      postMessage({ id, result });
    } catch (error) {
      postMessage({ id, error: { message: error.message, name: error.name } });
    }
  });
}
