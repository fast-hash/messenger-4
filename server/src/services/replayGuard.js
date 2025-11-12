import crypto from 'node:crypto';

import { createClient } from 'redis';

import config from '../config.js';

let redisClient;
let connectPromise;
let redisDegradedLogged = false;

export function sha256Base64Str(b64) {
  return crypto.createHash('sha256').update(b64, 'utf8').digest('hex');
}

export function setRedisClient(client) {
  redisClient = client || undefined;
  connectPromise = undefined;
}

export async function closeRedis() {
  const client = await resolveClient(false);
  if (client && typeof client.quit === 'function') {
    await client.quit();
  } else if (client && typeof client.disconnect === 'function') {
    await client.disconnect();
  }
  redisClient = undefined;
  connectPromise = undefined;
}

async function resolveClient(connectIfNeeded = true) {
  if (redisClient) {
    return redisClient;
  }
  if (!connectIfNeeded) {
    return undefined;
  }
  if (!connectPromise) {
    const fallbackUrl = config.redisUrl || 'redis://127.0.0.1:6379';
    const url = process.env.REDIS_URL || fallbackUrl;
    const client = createClient({ url });
    client.on('error', (err) => {
      console.error('[redis]', err.message);
    });
    connectPromise = client
      .connect()
      .then(() => {
        redisClient = client;
        return redisClient;
      })
      .catch((err) => {
        connectPromise = undefined;
        throw err;
      });
  }
  return connectPromise;
}

export async function ensureNotReplayed(chatId, encryptedPayload, ttlSeconds = 600) {
  let client;
  try {
    client = await resolveClient();
  } catch (err) {
    if (!redisDegradedLogged) {
      console.warn('[replayGuard] Redis unavailable, falling back to in-memory acceptance.', err);
      redisDegradedLogged = true;
    }
    return { ok: true, key: null };
  }

  if (!client) {
    return { ok: true, key: null };
  }

  const digest = sha256Base64Str(encryptedPayload);
  const key = `replay:${chatId}:${digest}`;

  try {
    const result = await client.set(key, '1', { NX: true, EX: ttlSeconds });
    const ok = result === 'OK';
    if (ok && redisDegradedLogged) {
      redisDegradedLogged = false;
    }
    return { ok, key };
  } catch (err) {
    if (!redisDegradedLogged) {
      console.warn('[replayGuard] Redis error, accepting message without replay guard.', err);
      redisDegradedLogged = true;
    }
    return { ok: true, key: null };
  }
}

export async function getRedisClient() {
  return resolveClient();
}
