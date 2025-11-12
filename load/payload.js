'use strict';

const { webcrypto } = require('node:crypto');

function getRandomBase64(bytesLength = 24) {
  const cryptoApi = webcrypto ?? globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random generator is unavailable');
  }
  const buffer = new Uint8Array(bytesLength);
  cryptoApi.getRandomValues(buffer);
  return Buffer.from(buffer).toString('base64');
}

module.exports = {
  generateCiphertext(context, events, done) {
    try {
      context.vars.cipher = getRandomBase64();
      done();
    } catch (err) {
      done(err);
    }
  },
};
