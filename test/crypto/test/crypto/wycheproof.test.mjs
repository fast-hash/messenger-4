import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, hkdfSync, timingSafeEqual, createHmac } from 'node:crypto';
import { x25519 } from '@noble/curves/ed25519';

const { subtle } = webcrypto;

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) {
    throw new TypeError('hex string must have even length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

test('Wycheproof X25519 known good vector', () => {
  const vector = {
    public: '504a36999f489cd2fdbc08baff3d88fa00569ba986cba22548ffde80f9806829',
    private: 'c8a9d5a91091ad851c668b0736c1c9a02936c0d3ad62670858088047ba057475',
    shared: '436a2c040cf45fea9b29a0cb81b1f41458f863d0d61b453d0a982720d6d61320',
  };

  const shared = x25519.scalarMult(hexToBytes(vector.private), hexToBytes(vector.public));
  assert.equal(bytesToHex(shared), vector.shared);
});

test('Wycheproof X25519 twist point still yields expected secret', () => {
  const vector = {
    public: '63aa40c6e38346c5caf23a6df0a5e6c80889a08647e551b3563449befcfc9733',
    private: 'd85d8c061a50804ac488ad774ac716c3f5ba714b2712e048491379a500211958',
    shared: '279df67a7c4611db4708a0e8282b195e5ac0ed6f4b2f292c6fbd0acac30d1332',
  };

  const shared = x25519.scalarMult(hexToBytes(vector.private), hexToBytes(vector.public));
  assert.equal(bytesToHex(shared), vector.shared);
});

test('Wycheproof AES-GCM encrypt/decrypt round-trip matches vectors', async () => {
  const vector = {
    key: '5b9604fe14eadba931b0ccf34843dab9',
    iv: '028318abc1824029138141a2',
    msg: '001d0c231287c1182784554ca3a21908',
    ct: '26073cc1d851beff176384dc9896d5ff',
    tag: '0a3ea7a5487cb5f7d70fb6c58d038554',
  };

  const key = await subtle.importKey('raw', hexToBytes(vector.key), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  const plaintext = hexToBytes(vector.msg);
  const iv = hexToBytes(vector.iv);
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const ciphertext = encryptedBytes.slice(0, plaintext.length);
  const tag = encryptedBytes.slice(plaintext.length);

  assert.equal(bytesToHex(ciphertext), vector.ct);
  assert.equal(bytesToHex(tag), vector.tag);

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedBytes
  );
  assert.equal(bytesToHex(new Uint8Array(decrypted)), vector.msg);
});

test('Wycheproof AES-GCM rejects modified tag', async () => {
  const vector = {
    key: '000102030405060708090a0b0c0d0e0f',
    iv: '505152535455565758595a5b',
    msg: '202122232425262728292a2b2c2d2e2f',
    ct: 'eb156d081ed6b6b55f4612f021d87b39',
    tag: 'd9847dbc326a06e988c77ad3863e6083',
  };

  const key = await subtle.importKey('raw', hexToBytes(vector.key), 'AES-GCM', false, [
    'decrypt',
  ]);
  const iv = hexToBytes(vector.iv);
  const ciphertext = hexToBytes(vector.ct + vector.tag);
  await assert.rejects(
    () =>
      subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      ),
    /Operation failed|decrypt/i
  );
});

test('Wycheproof HKDF SHA-256 reproduces RFC5869 vector', () => {
  const vector = {
    ikm: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
    salt: '000102030405060708090a0b0c',
    info: 'f0f1f2f3f4f5f6f7f8f9',
    size: 42,
    okm: '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
  };

  const output = hkdfSync(
    'sha256',
    hexToBytes(vector.ikm),
    hexToBytes(vector.salt),
    hexToBytes(vector.info),
    vector.size
  );
  assert.equal(Buffer.from(output).toString('hex'), vector.okm);
});

test('Wycheproof HKDF rejects oversize output', () => {
  const vector = {
    ikm: 'db89f54af757f8c7e57248a1718105b1',
    salt: 'd5efc88adf3d5afc970284aab51690bdfedfa40be98e374efa3060ccf97fc650',
    info: '134f085797b1ae2e',
    size: 8161,
  };

  assert.throws(() => {
    hkdfSync(
      'sha256',
      hexToBytes(vector.ikm),
      hexToBytes(vector.salt),
      hexToBytes(vector.info),
      vector.size
    );
  }, (error) => {
    assert.ok(error instanceof RangeError);
    assert.match(error.message, /Invalid (?:key )?length|size/i);
    return true;
  });
});

function verifyHmacSha256(keyHex, messageHex, tagHex) {
  const key = Buffer.from(keyHex, 'hex');
  const msg = Buffer.from(messageHex, 'hex');
  const expected = Buffer.from(tagHex, 'hex');
  const mac = createHmac('sha256', key).update(msg).digest();
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    throw new Error('HMAC verification failed');
  }
}

test('Wycheproof HMAC SHA-256 validates known tag', () => {
  const vector = {
    key: '1e225cafb90339bba1b24076d4206c3e79c355805d851682bc818baa4f5a7779',
    msg: '',
    tag: 'b175b57d89ea6cb606fb3363f2538abd73a4c00b4a1386905bac809004cf1933',
  };
  verifyHmacSha256(vector.key, vector.msg, vector.tag);
});

test('Wycheproof HMAC SHA-256 detects modified tag', () => {
  const vector = {
    key: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    msg: '',
    tag: 'd28b42096d80f45f826b44a9d5607de72496a415d3f4a1a8c88e3bb9da8dc1cb',
  };
  assert.throws(
    () => verifyHmacSha256(vector.key, vector.msg, vector.tag),
    /HMAC verification failed/
  );
});
