import { Router } from 'express';
import mongoose from 'mongoose';

import KeyBundle from '../models/KeyBundle.js';
import base64Regex from '../util/base64Regex.js';

const MIN_KEY_B64_LEN = 16;
const MAX_KEY_B64_LEN = 512;
const MAX_SIGNATURE_B64_LEN = 1024;
const MAX_IDENTITY_KEY_BYTES = 256;
const MAX_SIGNED_PREKEY_BYTES = 256;
const MAX_SIGNATURE_BYTES = 512;
const MAX_ONE_TIME_PRE_KEY_BYTES = 256;

function sanitizeBase64(
  value,
  { minLength = MIN_KEY_B64_LEN, maxLength = MAX_KEY_B64_LEN, maxBytes } = {}
) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed !== value) {
    return null;
  }
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    return null;
  }
  if (trimmed.length % 4 !== 0) {
    return null;
  }
  if (!base64Regex.test(trimmed)) {
    return null;
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 0) {
      return null;
    }
    if (typeof maxBytes === 'number' && maxBytes > 0 && decoded.length > maxBytes) {
      return null;
    }
    if (decoded.toString('base64') !== trimmed) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function sanitizeIdentityKey(value) {
  return sanitizeBase64(value, {
    minLength: 16,
    maxLength: MAX_KEY_B64_LEN,
    maxBytes: MAX_IDENTITY_KEY_BYTES,
  });
}

function sanitizeSignedPreKey(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const { keyId, publicKey, signature } = value;
  if (!Number.isInteger(keyId) || keyId < 0) {
    return null;
  }

  const sanitizedPublicKey = sanitizeBase64(publicKey, {
    minLength: 16,
    maxLength: MAX_KEY_B64_LEN,
    maxBytes: MAX_SIGNED_PREKEY_BYTES,
  });
  const sanitizedSignature = sanitizeBase64(signature, {
    minLength: 16,
    maxLength: MAX_SIGNATURE_B64_LEN,
    maxBytes: MAX_SIGNATURE_BYTES,
  });

  if (!sanitizedPublicKey || !sanitizedSignature) {
    return null;
  }

  return { keyId, publicKey: sanitizedPublicKey, signature: sanitizedSignature };
}

function resolveMaxOneTimePreKeys() {
  const raw = process.env.KEYBUNDLE_MAX_PREKEYS ?? process.env.KEYBUNDLE_PREKEY_LIMIT;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return Math.min(parsed, 500);
    }
  }
  return 200;
}

function sanitizeOneTimePreKeys(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  const maxPreKeys = resolveMaxOneTimePreKeys();
  if (items.length > maxPreKeys) {
    return null;
  }

  const seenKeyIds = new Set();
  const seenPublicKeys = new Set();
  const sanitized = [];

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const { keyId } = entry;
    if (!Number.isInteger(keyId) || keyId < 0) {
      return null;
    }

    const sanitizedPublicKey = sanitizeBase64(entry.publicKey, {
      minLength: 16,
      maxLength: MAX_KEY_B64_LEN,
      maxBytes: MAX_ONE_TIME_PRE_KEY_BYTES,
    });
    if (!sanitizedPublicKey) {
      return null;
    }

    if (seenKeyIds.has(keyId) || seenPublicKeys.has(sanitizedPublicKey)) {
      continue;
    }

    seenKeyIds.add(keyId);
    seenPublicKeys.add(sanitizedPublicKey);
    sanitized.push({ keyId, publicKey: sanitizedPublicKey });

    if (sanitized.length > maxPreKeys) {
      return null;
    }
  }

  return sanitized;
}

export default function keybundleRouter(auth) {
  const router = Router();

  router.post('/', auth, async (req, res) => {
    const userId = req.user?.id;
    const { identityKey, signedPreKey, oneTimePreKeys } = req.body || {};
    if (!userId || !identityKey || !signedPreKey || !Array.isArray(oneTimePreKeys)) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const sanitizedIdentityKey = sanitizeIdentityKey(identityKey);
    const sanitizedSignedPreKey = sanitizeSignedPreKey(signedPreKey);
    const sanitizedOneTimePreKeys = sanitizeOneTimePreKeys(oneTimePreKeys);

    if (!sanitizedIdentityKey || !sanitizedSignedPreKey || sanitizedOneTimePreKeys === null) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    try {
      await KeyBundle.findOneAndUpdate(
        { userId },
        {
          userId,
          identityKey: sanitizedIdentityKey,
          signedPreKey: sanitizedSignedPreKey,
          oneTimePreKeys: sanitizedOneTimePreKeys.map((k) => ({
            keyId: k.keyId,
            publicKey: k.publicKey,
            used: false,
          })),
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          runValidators: true,
          context: 'query',
        }
      );
      return res.sendStatus(204);
    } catch (err) {
      req.app?.locals?.logger?.error?.('keybundle.save_failed', err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/:userId', auth, async (req, res) => {
    const targetId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: 'invalid_userId' });
    }

    const targetObjectId = new mongoose.Types.ObjectId(targetId);

    try {
      const bundle = await KeyBundle.findOneAndUpdate(
        { userId: targetObjectId, 'oneTimePreKeys.used': false },
        { $set: { 'oneTimePreKeys.$.used': true } },
        {
          projection: {
            identityKey: 1,
            signedPreKey: 1,
            'oneTimePreKeys.$': 1,
          },
          returnDocument: 'before',
          lean: true,
        }
      );

      if (!bundle) {
        const exists = await KeyBundle.exists({ userId: targetObjectId });
        if (!exists) {
          return res.status(404).json({ error: 'not_found' });
        }
        return res.status(410).json({ error: 'no_prekeys' });
      }

      const [otp] = Array.isArray(bundle.oneTimePreKeys) ? bundle.oneTimePreKeys : [];
      if (!otp) {
        return res.status(410).json({ error: 'no_prekeys' });
      }

      return res.json({
        identityKey: bundle.identityKey,
        signedPreKey: bundle.signedPreKey,
        oneTimePreKey: { keyId: otp.keyId, publicKey: otp.publicKey },
      });
    } catch (err) {
      req.app?.locals?.logger?.error?.('keybundle.fetch_failed', err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}
