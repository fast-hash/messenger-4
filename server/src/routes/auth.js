import bcrypt from 'bcryptjs';
import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

import config from '../config.js';
import authRequired from '../middleware/auth.js';
import User from '../models/User.js';
import base64Regex from '../util/base64Regex.js';

const router = Router();
const jwtSecret = process.env.JWT_SECRET || config.jwtSecret;
const jwtExpires = process.env.JWT_EXPIRES_IN || '1h';

const LOGIN_LIMITER = expressRateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const rawEmail = req.body?.email;
    if (typeof rawEmail === 'string') {
      return rawEmail.trim().toLowerCase();
    }
    return req.ip;
  },
  handler: (_req, res) => {
    res.status(429).json({ error: 'too_many_attempts' });
  },
});

const TOKEN_COOKIE_NAME = 'accessToken';
const rawCookieSecure = process.env.COOKIE_SECURE;
const cookieSecure =
  typeof rawCookieSecure === 'string'
    ? rawCookieSecure.toLowerCase() === 'true'
    : (process.env.NODE_ENV || '').toLowerCase() === 'production';
const BASE_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  sameSite: 'strict',
  secure: cookieSecure,
  path: process.env.ACCESS_TOKEN_COOKIE_PATH || '/',
  ...(process.env.ACCESS_TOKEN_COOKIE_DOMAIN
    ? { domain: process.env.ACCESS_TOKEN_COOKIE_DOMAIN }
    : {}),
});

const MIN_PUBLIC_KEY_B64_LEN = 16;
const MAX_PUBLIC_KEY_B64_LEN = 512;
const MAX_PUBLIC_KEY_BYTES = 256;

function resolveCookieOptions() {
  const options = { ...BASE_COOKIE_OPTIONS };
  const maxAgeMs = resolveJwtExpiresToMs(jwtExpires);
  if (maxAgeMs) {
    options.maxAge = maxAgeMs;
  }
  return options;
}

function resolveJwtExpiresToMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value * 1000);
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  const match = /^([\d]+)\s*([smhd])$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2].toLowerCase();
  const unitToMs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return unitToMs[unit] ? amount * unitToMs[unit] : null;
}

function normalizeUsername(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePublicKey(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length !== value.length) {
    return null;
  }
  if (trimmed.length < MIN_PUBLIC_KEY_B64_LEN || trimmed.length > MAX_PUBLIC_KEY_B64_LEN) {
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
    if (decoded.length === 0 || decoded.length > MAX_PUBLIC_KEY_BYTES) {
      return null;
    }
    if (decoded.toString('base64') !== trimmed) {
      return null;
    }
  } catch {
    return null;
  }

  return trimmed;
}

function issueToken(user) {
  const payload = { sub: user.id, userId: user.id };
  return jwt.sign(payload, jwtSecret, { expiresIn: jwtExpires, algorithm: 'HS256' });
}

function setAuthCookie(res, token) {
  res.cookie(TOKEN_COOKIE_NAME, token, resolveCookieOptions());
}

function clearAuthCookie(res) {
  const options = resolveCookieOptions();
  delete options.maxAge;
  res.clearCookie(TOKEN_COOKIE_NAME, options);
}

router.post('/register', async (req, res) => {
  const { username: rawUsername, email: rawEmail, password, publicKey } = req.body || {};
  const normalizedUsername = normalizeUsername(rawUsername);
  const normalizedEmail = normalizeEmail(rawEmail);
  const sanitizedPublicKey = sanitizePublicKey(publicKey);

  if (!normalizedUsername || !normalizedEmail || typeof password !== 'string' || !sanitizedPublicKey) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  try {
    const existing = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    }).lean();
    if (existing) {
      return res.status(400).json({ error: 'user_exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password: hash,
      publicKey: sanitizedPublicKey,
    });

    const token = issueToken(user);
    setAuthCookie(res, token);
    return res.status(201).json({ userId: user.id });
  } catch (err) {
    if (err?.code === 11000 && err?.name === 'MongoServerError') {
      return res.status(400).json({ error: 'user_exists' });
    }
    req.app?.locals?.logger?.error?.('auth.register_failed', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/login', LOGIN_LIMITER, async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : null;
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'missing_credentials' });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ error: 'invalid_credentials' });
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      return res.status(400).json({ error: 'invalid_credentials' });
    }

    const token = issueToken(user);
    setAuthCookie(res, token);
    return res.json({ userId: user.id });
  } catch (err) {
    req.app?.locals?.logger?.error?.('auth.login_failed', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  return res.sendStatus(204);
});

router.get('/session', authRequired, (req, res) => {
  return res.json({ userId: req.user.id });
});

export default router;
