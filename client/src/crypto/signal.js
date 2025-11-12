const globalScope = typeof window !== 'undefined' ? window : globalThis;
if (!globalScope.window) {
  globalScope.window = globalScope;
}

const WORKER_TIMEOUT_MS = 10_000;
const memoryStore = new Map();
let workerWrapperPromise = null;
let requestCounter = 0;
const pendingRequests = new Map();
let storeSyncChain = Promise.resolve();

function toUint8Array(view) {
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

function bytesToBase64(bytes) {
  const data = toUint8Array(bytes);
  if (typeof globalScope.Buffer !== 'undefined') {
    return globalScope.Buffer.from(data).toString('base64');
  }
  if (typeof globalScope.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < data.length; i += 1) {
      binary += String.fromCharCode(data[i]);
    }
    return globalScope.btoa(binary);
  }
  throw new Error('Base64 encoding not supported in this environment');
}

function identityKeyFingerprint(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return bytesToBase64(value);
  } catch (err) {
    console.warn('Failed to derive identity fingerprint', err);
    return null;
  }
}

function identitiesMatch(existing, next) {
  if (!existing || !next) {
    return true;
  }
  const currentFingerprint = identityKeyFingerprint(existing);
  const nextFingerprint = identityKeyFingerprint(next);
  if (!currentFingerprint || !nextFingerprint) {
    return false;
  }
  return currentFingerprint === nextFingerprint;
}

function shouldSyncKey(key) {
  if (key === 'identityKeyPair' || key === 'registrationId') {
    return true;
  }
  if (key.startsWith('25519KeypreKey') || key.startsWith('25519KeysignedKey')) {
    return true;
  }
  return false;
}

function getValue(key) {
  return memoryStore.get(key) ?? null;
}

function storeValue(key, value, options = {}) {
  const { sync = true } = options;

  if (value === undefined || value === null) {
    memoryStore.delete(key);
    if (sync && shouldSyncKey(key)) {
      queueStoreSync('store:remove', { key });
    }
    return;
  }

  memoryStore.set(key, value);
  if (sync && shouldSyncKey(key)) {
    queueStoreSync('store:set', { key, value });
  }
}

function applyMaterialToLocalStore(material) {
  if (!material) {
    return;
  }

  storeValue('identityKeyPair', material.identityKeyPair, { sync: false });
  storeValue('registrationId', material.registrationId, { sync: false });

  if (material.signedPreKey) {
    storeValue(`25519KeysignedKey${material.signedPreKey.keyId}`, material.signedPreKey.keyPair, {
      sync: false,
    });
  }

  if (Array.isArray(material.oneTimePreKeys)) {
    material.oneTimePreKeys.forEach((preKey) => {
      if (preKey && typeof preKey.keyId !== 'undefined') {
        storeValue(`25519KeypreKey${preKey.keyId}`, preKey.keyPair, { sync: false });
      }
    });
  }
}

function handleWorkerMessage(message) {
  const payload = message?.data ?? message;
  if (!payload || typeof payload.id === 'undefined') {
    return;
  }

  const entry = pendingRequests.get(payload.id);
  if (!entry) {
    return;
  }

  clearTimeout(entry.timeout);
  pendingRequests.delete(payload.id);

  if (payload.error) {
    const error = new Error(payload.error.message || 'Crypto worker error');
    error.name = payload.error.name || 'Error';
    entry.reject(error);
    return;
  }

  entry.resolve(payload.result);
}

function handleWorkerError(error) {
  const err =
    error instanceof Error ? error : new Error(String(error || 'Unknown crypto worker error'));
  pendingRequests.forEach((entry) => {
    clearTimeout(entry.timeout);
    entry.reject(err);
  });
  pendingRequests.clear();
  workerWrapperPromise = null;
}

function wrapBrowserWorker(worker) {
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', handleWorkerError);
  worker.addEventListener('messageerror', handleWorkerError);
  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      worker.terminate();
    },
  };
}

function wrapNodeWorker(worker) {
  worker.on('message', handleWorkerMessage);
  worker.on('error', handleWorkerError);
  worker.on('exit', (code) => {
    if (code !== 0) {
      handleWorkerError(new Error(`Crypto worker exited with code ${code}`));
    }
  });
  if (typeof worker.unref === 'function') {
    worker.unref();
  }
  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      worker.terminate();
    },
  };
}

async function createWorkerWrapper() {
  if (typeof window !== 'undefined' && typeof window.Worker === 'function') {
    const worker = new Worker(new URL('./worker/crypto.browser.worker.js', import.meta.url), {
      type: 'module',
    });
    return wrapBrowserWorker(worker);
  }

  const { Worker: NodeWorker } = await import('node:worker_threads');
  const worker = new NodeWorker(new URL('./worker/crypto.node.worker.js', import.meta.url), {
    type: 'module',
  });
  return wrapNodeWorker(worker);
}

async function ensureWorker() {
  if (!workerWrapperPromise) {
    workerWrapperPromise = createWorkerWrapper()
      .then((wrapper) => wrapper)
      .catch((error) => {
        workerWrapperPromise = null;
        throw error;
      });
  }

  return workerWrapperPromise;
}

async function sendRequest(action, payload = {}) {
  const wrapper = await ensureWorker();
  return new Promise((resolve, reject) => {
    const id = ++requestCounter;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Crypto worker request timed out for action "${action}"`));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timeout });
    wrapper.postMessage({ id, action, payload });
  });
}

function queueStoreSync(action, payload) {
  storeSyncChain = storeSyncChain
    .then(() => sendRequest(action, payload))
    .catch((error) => {
      console.error('Failed to synchronise crypto store with worker', error);
    });
}

async function callWorker(action, payload) {
  await storeSyncChain;
  return sendRequest(action, payload);
}

export async function generateIdentityAndPreKeys() {
  const response = await callWorker('generateIdentityAndPreKeys');
  const material = response?.material;
  applyMaterialToLocalStore(material);
  return material;
}

export async function initSession(recipientId, bundleBase64) {
  if (!recipientId) {
    throw new Error('recipientId is required to initialise a session');
  }
  await callWorker('initSession', { recipientId, bundleBase64 });
}

export async function encryptMessage(utf8Plaintext) {
  if (typeof utf8Plaintext !== 'string') {
    throw new TypeError('encryptMessage expects a UTF-8 string');
  }
  const response = await callWorker('encryptMessage', { plaintext: utf8Plaintext });
  return response?.ciphertext;
}

export async function decryptMessage(ciphertextBase64) {
  if (typeof ciphertextBase64 !== 'string') {
    throw new TypeError('decryptMessage expects a base64 string');
  }
  const response = await callWorker('decryptMessage', { ciphertext: ciphertextBase64 });
  return response?.plaintext;
}

export function resetSignalState() {
  memoryStore.clear();
  queueStoreSync('store:clear', {});
}

export const signalStore = {
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
  storeSession: (id, session) => storeValue(`session${id}`, session, { sync: false }),
  removeSession: (id) => storeValue(`session${id}`, undefined, { sync: false }),

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
    storeValue(key, identityKey, { sync: false });
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
    queueStoreSync('store:clear', {});
  },
};
