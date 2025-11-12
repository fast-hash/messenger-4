import { Router } from 'express';
import mongoose from 'mongoose';

import { incMessageSaved, incReplayRejected } from '../metrics.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { ensureNotReplayed } from '../services/replayGuard.js';
import base64Regex from '../util/base64Regex.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const noop = (_req, _res, next) => next();

function isCanonicalBase64(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (!base64Regex.test(value)) {
    return false;
  }
  if (value.length % 4 !== 0) {
    return false;
  }
  try {
    const normalised = Buffer.from(value, 'base64').toString('base64');
    return normalised === value;
  } catch {
    return false;
  }
}

export default function messagesRouter({ auth, onMessage } = {}) {
  const router = Router();
  const guard = auth || noop;
  const maxCiphertextLength = Number(process.env.MAX_CIPHERTEXT_B64 || 131072) || 131072;
  const replayTtlSeconds = Number(process.env.REPLAY_TTL_SECONDS || 600) || 600;

  router.post('/', guard, async (req, res, next) => {
    try {
      const { chatId, encryptedPayload } = req.body || {};
      if (typeof chatId !== 'string' || !OBJECT_ID_RE.test(chatId)) {
        return res.status(422).json({ error: 'invalid chatId' });
      }
      if (!isCanonicalBase64(encryptedPayload)) {
        return res.status(422).json({ error: 'invalid encryptedPayload' });
      }
      if (encryptedPayload.length > maxCiphertextLength) {
        return res.status(413).json({ error: 'ciphertext too large' });
      }

      const senderId = req.user?.id;
      if (!senderId) {
        return res.status(401).json({ error: 'unauthenticated' });
      }

      const isMember = await Chat.isMember(chatId, senderId);
      if (!isMember) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const { ok: notDuplicate } = await ensureNotReplayed(
        chatId,
        encryptedPayload,
        replayTtlSeconds
      );
      if (!notDuplicate) {
        incReplayRejected();
        return res.status(409).json({ error: 'duplicate' });
      }

      const payload = {
        chatId: new mongoose.Types.ObjectId(chatId),
        senderId: new mongoose.Types.ObjectId(senderId),
        encryptedPayload,
      };

      const created = await Message.create(payload);
      incMessageSaved();
      const response = {
        id: created._id.toString(),
        chatId: created.chatId.toString(),
        senderId: created.senderId.toString(),
        encryptedPayload: created.encryptedPayload,
        createdAt: created.createdAt,
      };

      if (typeof onMessage === 'function') {
        try {
          onMessage(response);
        } catch (err) {
          req.app?.locals?.logger?.error?.('message.onMessage_failed', err);
        }
      }

      return res.status(200).json({ ok: true, id: response.id });
    } catch (e) {
      next(e);
    }
  });

  function parseCursor(raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return null;
    }
    const [createdAtPart, idPart] = raw.split('|');
    if (!createdAtPart || !idPart) {
      throw new Error('invalid cursor');
    }
    const createdAt = new Date(createdAtPart);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('invalid cursor');
    }
    if (!OBJECT_ID_RE.test(idPart)) {
      throw new Error('invalid cursor');
    }
    return {
      createdAt,
      id: new mongoose.Types.ObjectId(idPart),
    };
  }

  function encodeCursor(doc) {
    if (!doc) {
      return null;
    }
    const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt);
    const id = doc._id?.toString?.() ?? doc.id;
    if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) {
      return null;
    }
    return `${createdAt.toISOString()}|${id}`;
  }

  router.get('/:chatId', guard, async (req, res, next) => {
    try {
      const { chatId } = req.params;
      if (typeof chatId !== 'string' || !OBJECT_ID_RE.test(chatId)) {
        return res.status(422).json({ error: 'invalid chatId' });
      }

      const rawLimit = req.query?.limit;
      const limit =
        rawLimit === undefined || rawLimit === ''
          ? 50
          : Number.parseInt(Array.isArray(rawLimit) ? rawLimit[0] : rawLimit, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return res.status(400).json({ error: 'invalid limit' });
      }

      let cursor;
      try {
        const rawCursor = req.query?.cursor;
        cursor = parseCursor(Array.isArray(rawCursor) ? rawCursor[0] : rawCursor);
      } catch {
        return res.status(400).json({ error: 'invalid cursor' });
      }

      const requesterId = req.user?.id;
      if (!requesterId) {
        return res.status(401).json({ error: 'unauthenticated' });
      }

      const isMember = await Chat.isMember(chatId, requesterId);
      if (!isMember) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const chatObjectId = new mongoose.Types.ObjectId(chatId);
      const filter = { chatId: chatObjectId };
      if (cursor) {
        filter.$or = [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
        ];
      }

      const docsDesc = await Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

      const docsAsc = docsDesc.slice().reverse();

      const hasMore = docsAsc.length > limit;
      const sliceStart = hasMore ? 1 : 0;
      const trimmed = docsAsc.slice(sliceStart);

      const serialised = trimmed.map((doc) => ({
        id: doc._id.toString(),
        chatId: doc.chatId.toString(),
        senderId: doc.senderId.toString(),
        encryptedPayload: doc.encryptedPayload,
        createdAt: doc.createdAt,
      }));

      const nextCursor = hasMore ? encodeCursor(trimmed[0]) : null;

      return res.json({
        messages: serialised,
        nextCursor,
        hasMore,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
