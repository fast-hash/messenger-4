import { setupCryptoWorker } from './core.js';

const scope = typeof self !== 'undefined' ? self : globalThis;

setupCryptoWorker({
  globalScope: scope,
  addMessageListener: (handler) => scope.addEventListener('message', handler),
  postMessage: (message) => scope.postMessage(message),
  ensureCrypto: async () => {
    if (!scope.crypto?.subtle) {
      throw new Error('WebCrypto not available');
    }
  },
  loadLibsignal: async () => {
    // eslint-disable-next-line no-undef
    importScripts(new URL('../libsignal-protocol/index.js', import.meta.url).toString());
  },
});
