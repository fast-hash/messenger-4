import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';

import { setupCryptoWorker } from './core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scope = globalThis;

if (!scope.window) {
  scope.window = scope;
}

function loadLibsignalFromDisk() {
  const filePath = resolve(__dirname, '../libsignal-protocol/index.js');
  const source = readFileSync(filePath, 'utf-8');
  // eslint-disable-next-line no-eval, security/detect-eval-with-expression
  eval(source);
}

setupCryptoWorker({
  globalScope: scope,
  addMessageListener: (handler) => {
    parentPort.on('message', (data) => handler({ data }));
  },
  postMessage: (message) => {
    parentPort.postMessage(message);
  },
  ensureCrypto: async () => {
    if (!scope.crypto?.subtle) {
      const { webcrypto } = await import('node:crypto');
      scope.crypto = webcrypto;
    }
  },
  loadLibsignal: async () => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      const { setupTestLibsignal } = await import('../../../test/libsignal-stub.mjs');
      setupTestLibsignal(scope);
      return;
    }
    loadLibsignalFromDisk();
  },
});
