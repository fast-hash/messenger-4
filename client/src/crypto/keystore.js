// Keystore: зашифрованный vault (AES-GCM) в IndexedDB с KDF PBKDF2-SHA256.
// Реализована атомарная смена пароля: changePassphrase(oldPass, newPass).
// НИКАКИХ localStorage/sessionStorage здесь нет (запрещено ESLint-ом).

const KDF_ITER = 310_000; // итерации PBKDF2
const KDF_HASH = 'SHA-256';
const ENC = 'AES-GCM';
const KEY_LENGTH = 256; // bits

const DB_NAME = 'secure-keystore';
const STORE = 'keystore';
const VAULT_KEY = 'vault';
const EMPTY_VAULT = Object.freeze({ identity: null, preKeys: null, meta: null });

let _lock = Promise.resolve();
function withLock(fn) {
  const p = _lock.then(fn, fn);
  _lock = p.catch(() => {});
  return p;
}

const te = new TextEncoder();
const td = new TextDecoder();

// Безопасная base64 для браузера и Node
function binToStr(u8) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    out += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return out;
}
function strToBin(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
function b64e(u8) {
  if (typeof btoa === 'function') return btoa(binToStr(u8));
  return Buffer.from(u8).toString('base64');
}
function b64d(b64) {
  if (typeof atob === 'function') return strToBin(atob(b64));
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStore(mode = 'readonly') {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const store = tx.objectStore(STORE);
  return { db, tx, store };
}

async function deriveKey(passphraseUtf8, saltU8, iterations = KDF_ITER) {
  const baseKey = await crypto.subtle.importKey('raw', passphraseUtf8, { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltU8, iterations, hash: KDF_HASH },
    baseKey,
    { name: ENC, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
  return aesKey;
}

async function encryptVaultJson(plaintextJson, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(te.encode(passphrase), salt, KDF_ITER);
  const ctBuf = await crypto.subtle.encrypt({ name: ENC, iv }, key, te.encode(plaintextJson));
  const ct = new Uint8Array(ctBuf);
  // лёгкая помощь GC
  salt.slice();
  iv.slice();
  ct.slice();
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: KDF_HASH, iterations: KDF_ITER, salt: b64e(salt) },
    cipher: { name: ENC, iv: b64e(iv) },
    ct: b64e(ct),
  };
}

async function decryptVaultToJson(vaultObj, passphrase) {
  if (!vaultObj || typeof vaultObj !== 'object') throw new Error('VAULT_NOT_FOUND');
  const salt = b64d(vaultObj.kdf?.salt || '');
  const iv = b64d(vaultObj.cipher?.iv || '');
  const key = await deriveKey(te.encode(passphrase), salt, vaultObj.kdf?.iterations || KDF_ITER);
  const ptBuf = await crypto.subtle.decrypt(
    { name: vaultObj.cipher?.name || ENC, iv },
    key,
    b64d(vaultObj.ct)
  );
  const pt = new Uint8Array(ptBuf);
  const json = td.decode(pt);
  pt.fill(0);
  return json;
}

async function readVaultObj() {
  const { db, tx, store } = await getStore('readonly');
  const obj = await new Promise((resolve, reject) => {
    const r = store.get(VAULT_KEY);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
  await new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
  return obj;
}

async function writeVaultObj(vaultObj) {
  const { db, tx, store } = await getStore('readwrite');
  await new Promise((resolve, reject) => {
    const r = store.put(vaultObj, VAULT_KEY);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  await new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

function toUint8(view) {
  if (view instanceof Uint8Array) {
    return new Uint8Array(view);
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
  return b64e(toUint8(bytes));
}

function base64ToArrayBuffer(base64) {
  const decoded = b64d(base64);
  return decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength);
}

function normaliseKeyPair(keyPair) {
  if (!keyPair || !keyPair.pubKey || !keyPair.privKey) {
    throw new TypeError('Invalid identity key pair');
  }
  return {
    pubKey: toUint8(keyPair.pubKey),
    privKey: toUint8(keyPair.privKey),
  };
}

function serialiseIdentity(identity) {
  if (!identity) {
    throw new TypeError('Identity material is required');
  }
  const keyPair = normaliseKeyPair(identity.identityKeyPair);
  return {
    registrationId: identity.registrationId,
    identityKeyPair: {
      pubKey: bytesToBase64(keyPair.pubKey),
      privKey: bytesToBase64(keyPair.privKey),
    },
  };
}

function deserialiseIdentity(record) {
  if (!record) return null;
  return {
    registrationId: record.registrationId,
    identityKeyPair: {
      pubKey: base64ToArrayBuffer(record.identityKeyPair.pubKey),
      privKey: base64ToArrayBuffer(record.identityKeyPair.privKey),
    },
  };
}

function serialisePreKeys(preKeys) {
  if (!preKeys || !preKeys.signedPreKey) {
    throw new TypeError('Signed pre-key is required');
  }
  const result = {
    signedPreKey: {
      keyId: preKeys.signedPreKey.keyId,
      publicKey: bytesToBase64(toUint8(preKeys.signedPreKey.keyPair.pubKey)),
      privateKey: bytesToBase64(toUint8(preKeys.signedPreKey.keyPair.privKey)),
      signature: bytesToBase64(toUint8(preKeys.signedPreKey.signature)),
    },
    oneTimePreKeys: [],
  };
  if (Array.isArray(preKeys.oneTimePreKeys)) {
    for (const item of preKeys.oneTimePreKeys) {
      result.oneTimePreKeys.push({
        keyId: item.keyId,
        publicKey: bytesToBase64(toUint8(item.keyPair.pubKey)),
        privateKey: bytesToBase64(toUint8(item.keyPair.privKey)),
      });
    }
  }
  return result;
}

function deserialisePreKeys(record) {
  if (!record) return null;
  return {
    signedPreKey: {
      keyId: record.signedPreKey.keyId,
      keyPair: {
        pubKey: base64ToArrayBuffer(record.signedPreKey.publicKey),
        privKey: base64ToArrayBuffer(record.signedPreKey.privateKey),
      },
      signature: base64ToArrayBuffer(record.signedPreKey.signature),
    },
    oneTimePreKeys: Array.isArray(record.oneTimePreKeys)
      ? record.oneTimePreKeys.map((item) => ({
          keyId: item.keyId,
          keyPair: {
            pubKey: base64ToArrayBuffer(item.publicKey),
            privKey: base64ToArrayBuffer(item.privateKey),
          },
        }))
      : [],
  };
}

function ensureVaultData(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_VAULT };
  }
  return {
    identity: raw.identity ?? null,
    preKeys: raw.preKeys ?? null,
    meta: raw.meta ?? null,
  };
}

async function writeVaultData(passphrase, data) {
  const plaintext = JSON.stringify(data);
  const vaultObj = await encryptVaultJson(plaintext, passphrase);
  await writeVaultObj(vaultObj);
  return true;
}

async function loadVaultForUpdate(passphrase) {
  const snapshot = await getVaultSnapshot();
  if (!snapshot) {
    return { data: { ...EMPTY_VAULT }, exists: false };
  }
  const unlocked = await unlockVault(passphrase);
  return { data: ensureVaultData(unlocked), exists: true };
}

function mapDecryptError(error, fallbackMessage) {
  if (error && (error.message === 'VAULT_NOT_FOUND' || error.code === 'VAULT_NOT_FOUND')) {
    return Object.assign(new Error('VAULT_NOT_FOUND'), { code: 'VAULT_NOT_FOUND' });
  }
  const err = new Error(fallbackMessage);
  err.cause = error;
  return err;
}

export async function initVault(initialObject, passphrase) {
  if (!passphrase) throw new Error('EMPTY_PASSPHRASE');
  if (!initialObject || typeof initialObject !== 'object')
    throw new Error('INITIAL_OBJECT_REQUIRED');
  return withLock(() => writeVaultData(passphrase, initialObject));
}

export async function changePassphrase(oldPass, newPass) {
  if (!oldPass || !newPass) throw new Error('EMPTY_PASSPHRASE');
  if (oldPass === newPass) return false;

  return withLock(async () => {
    const current = await readVaultObj();
    if (!current) throw new Error('VAULT_NOT_FOUND');

    let plaintextJson;
    try {
      plaintextJson = await decryptVaultToJson(current, oldPass);
    } catch {
      throw new Error('BAD_OLD_PASSPHRASE');
    }

    const nextVault = await encryptVaultJson(plaintextJson, newPass);
    await writeVaultObj(nextVault);
    plaintextJson = '';
    return true;
  });
}

export async function getVaultSnapshot() {
  return readVaultObj();
}
export async function unlockVault(passphrase) {
  const v = await readVaultObj();
  const json = await decryptVaultToJson(v, passphrase);
  return JSON.parse(json);
}

export async function saveIdentityEncrypted(passphrase, identity) {
  if (!passphrase) throw new Error('Passphrase is required to encrypt identity material');
  if (!identity) throw new Error('Identity material is required');

  return withLock(async () => {
    const { data } = await loadVaultForUpdate(passphrase);
    data.identity = serialiseIdentity(identity);
    await writeVaultData(passphrase, data);
  });
}

export async function loadIdentity(passphrase) {
  if (!passphrase) throw new Error('Passphrase is required to decrypt identity material');
  try {
    const snapshot = await getVaultSnapshot();
    if (!snapshot) return null;
    const unlocked = ensureVaultData(await unlockVault(passphrase));
    return deserialiseIdentity(unlocked.identity);
  } catch (error) {
    if (error && error.message === 'VAULT_NOT_FOUND') {
      return null;
    }
    throw mapDecryptError(error, 'Failed to decrypt identity material');
  }
}

export async function savePreKeys(passphrase, preKeys) {
  if (!passphrase) throw new Error('Passphrase is required to encrypt pre-key material');
  if (!preKeys) throw new Error('Pre-key material is required');

  return withLock(async () => {
    const { data } = await loadVaultForUpdate(passphrase);
    data.preKeys = serialisePreKeys(preKeys);
    await writeVaultData(passphrase, data);
  });
}

export async function loadPreKeys(passphrase) {
  if (!passphrase) throw new Error('Passphrase is required to decrypt pre-key material');
  try {
    const snapshot = await getVaultSnapshot();
    if (!snapshot) return null;
    const unlocked = ensureVaultData(await unlockVault(passphrase));
    return deserialisePreKeys(unlocked.preKeys);
  } catch (error) {
    if (error && error.message === 'VAULT_NOT_FOUND') {
      return null;
    }
    throw mapDecryptError(error, 'Failed to decrypt pre-key material');
  }
}
