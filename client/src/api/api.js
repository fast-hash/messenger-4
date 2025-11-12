// client/src/api/api.js
import { encryptMessage, decryptMessage } from '../crypto/signal.js';

import { request } from './request.js';

export async function getBundle(userId) {
  return request(`/api/keybundle/${userId}`);
}

export async function sendMessage(chatId, plaintext) {
  if (typeof chatId !== 'string') {
    throw new TypeError('chatId must be a string');
  }
  if (typeof plaintext !== 'string' || !plaintext.length) {
    throw new TypeError('plaintext must be a non-empty string');
  }
  const encryptedPayload = await encryptMessage(plaintext);
  await request('/api/messages', 'POST', { chatId, encryptedPayload });
  return { chatId, encryptedPayload };
}

export async function history(chatId, options = {}) {
  if (typeof chatId !== 'string') {
    throw new TypeError('chatId must be a string');
  }
  const params = new URLSearchParams();
  if (options.limit != null) {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('limit must be a positive integer');
    }
    params.set('limit', String(limit));
  }
  if (options.cursor) {
    params.set('cursor', options.cursor);
  }

  const suffix = params.toString();
  const payload = await request(`/api/messages/${chatId}${suffix ? `?${suffix}` : ''}`);

  const records = Array.isArray(payload?.messages)
    ? payload.messages
    : Array.isArray(payload)
      ? payload
      : [];

  const decrypted = [];
  for (const record of records) {
    if (!record || typeof record.encryptedPayload !== 'string') {
      continue;
    }
    const text = await decryptMessage(record.encryptedPayload);
    decrypted.push({ ...record, text });
  }

  return {
    messages: decrypted,
    nextCursor: typeof payload?.nextCursor === 'string' ? payload.nextCursor : null,
    hasMore: Boolean(payload?.hasMore),
  };
}

const api = {
  register: (data) => request('/api/auth/register', 'POST', data),
  login: (data) => request('/api/auth/login', 'POST', data),
  logout: () => request('/api/auth/logout', 'POST'),
  session: () => request('/api/auth/session'),
  uploadBundle: (bundle) => request('/api/keybundle', 'POST', bundle),
  getBundle,
  sendMessage,
  history,
};

export { api };
