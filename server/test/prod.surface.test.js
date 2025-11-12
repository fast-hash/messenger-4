import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, '../index.js');

let proc, base, mongod;
let serverLogs = '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const port = 3100 + Math.floor(Math.random() * 200);
  base = `http://127.0.0.1:${port}`;
  mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  proc = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      MONGO_URL: mongoUri,
      VERIFY_MODE: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proc.stderr?.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });
  const start = Date.now();
  let healthy = false;
  while (Date.now() - start < 5000) {
    if (proc.exitCode !== null) {
      throw new Error(`server exited: code=${proc.exitCode} logs=${serverLogs}`);
    }
    try {
      const response = await fetch(`${base}/healthz`, {
        signal: AbortSignal.timeout(300),
      });
      if (response.ok || response.status >= 400) {
        healthy = true;
        break;
      }
    } catch {
      // retry until server is up
    }
    await wait(200);
  }
  if (proc.exitCode !== null) {
    throw new Error(`server exited: code=${proc.exitCode} logs=${serverLogs}`);
  }
  if (!healthy) {
    throw new Error(`server did not start listening within timeout. logs=${serverLogs}`);
  }
});
after(async () => {
  proc?.kill('SIGTERM');
  if (mongod) {
    await mongod.stop();
  }
  serverLogs = '';
});

test('security headers on /healthz and no unsafe-*', async () => {
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(!csp.includes("'unsafe-inline'"));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('__test__/bootstrap is NOT exposed in production', async () => {
  const r = await fetch(`${base}/__test__/bootstrap`).catch(() => null);
  assert.ok(!r || r.status >= 400);
});
