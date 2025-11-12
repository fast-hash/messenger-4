// JWT verification with clock skew tolerance and HTTP middleware
import jwt from 'jsonwebtoken';

import config from '../config.js';

const COOKIE_TOKEN_NAME = 'accessToken';

const JWT_ALG = Object.freeze({
  RS256: 'RS256',
  HS256: 'HS256',
});
const SUPPORTED_ALGS = new Set(Object.values(JWT_ALG));
const CLOCK_TOLERANCE_SEC = parseInt(process.env.JWT_CLOCK_TOLERANCE_SEC || '120', 10);

function buildUser(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('NO_PAYLOAD');
  }
  const subject = payload.sub ?? payload.userId ?? payload.id;
  if (!subject) {
    throw new Error('NO_SUBJECT');
  }
  const id = subject.toString();
  return { ...payload, id };
}

let cachedPubKey = null;
let cachedSharedSecret = null;

export function getPublicKey() {
  if (cachedPubKey) return cachedPubKey;
  const k = process.env.JWT_PUBLIC_KEY;
  if (!k) throw new Error('JWT_PUBLIC_KEY not set');
  // поддержка PEM в переменных окружения с \n
  cachedPubKey = k.replace(/\\n/g, '\n');
  return cachedPubKey;
}

export function getSharedSecret() {
  if (cachedSharedSecret) return cachedSharedSecret;
  const candidates = [process.env.JWT_SHARED_SECRET, process.env.JWT_SECRET, config.jwtSecret];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.trim().length > 0) {
      const trimmed = candidate.trim();
      if (
        trimmed === 'change_me_to_a_long_random_string' &&
        (process.env.NODE_ENV || '').toLowerCase() === 'production'
      ) {
        throw new Error('JWT_SECRET_DEFAULT_IN_PROD');
      }
      cachedSharedSecret = trimmed;
      return cachedSharedSecret;
    }
  }

  throw new Error('JWT_SECRET_NOT_SET');
}

export function resolveVerification(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== 'object' || !decoded.header) {
    throw new Error('TOKEN_DECODE_FAILED');
  }

  const { alg } = decoded.header;
  if (!SUPPORTED_ALGS.has(alg)) {
    throw new Error('UNSUPPORTED_ALG');
  }

  if (alg === JWT_ALG.RS256) {
    return { key: getPublicKey(), algorithms: [JWT_ALG.RS256] };
  }

  if (alg === JWT_ALG.HS256) {
    return { key: getSharedSecret(), algorithms: [JWT_ALG.HS256] };
  }

  throw new Error('UNSUPPORTED_ALG');
}

export function verifyJwt(token, options = {}) {
  if (!token) throw new Error('NO_TOKEN');
  const { key, algorithms } = resolveVerification(token);
  const verifyOptions = {
    algorithms,
    clockTolerance: CLOCK_TOLERANCE_SEC,
    ...options,
  };
  return jwt.verify(token, key, verifyOptions);
}

export function verifyAccess(token) {
  const payload = verifyJwt(token);
  return buildUser(payload);
}

function parseCookie(header, name) {
  if (typeof header !== 'string' || header.length === 0) {
    return null;
  }

  const pairs = header.split(';');
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split('=');
    if (!rawKey || rest.length === 0) {
      continue;
    }
    if (rawKey.trim() !== name) {
      continue;
    }
    const value = rest.join('=').trim();
    if (!value) {
      return null;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function getAccessTokenFromRequest(req) {
  const header = req?.headers?.authorization || '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const candidate = header.slice(7).trim();
    if (candidate) {
      return candidate;
    }
  }

  const cookieHeader = req?.headers?.cookie;
  const cookieToken = parseCookie(cookieHeader, COOKIE_TOKEN_NAME);
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

export function getAccessTokenFromCookieHeader(header) {
  return parseCookie(header, COOKIE_TOKEN_NAME);
}

export function authRequired(req, res, next) {
  try {
    const token = getAccessTokenFromRequest(req);
    if (!token) {
      throw new Error('NO_TOKEN');
    }
    req.user = verifyAccess(token);
    next();
  } catch (err) {
    res.status(401).json({ error: 'unauthorized' });
  }
}

export function __resetAuthCache() {
  cachedPubKey = null;
  cachedSharedSecret = null;
}

export default function authMiddleware(req, res, next) {
  return authRequired(req, res, next);
}
