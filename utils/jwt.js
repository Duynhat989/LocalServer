const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getDataDir } = require('./dataDir');

function secretPath() {
  return path.join(getDataDir(), '.jwt_secret');
}

let cachedSecret = null;

function getJwtSecret() {
  if (cachedSecret) return cachedSecret;
  try {
    const file = secretPath();
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (raw) {
        cachedSecret = raw;
        return cachedSecret;
      }
    }
  } catch (_) {
    /* ignore */
  }

  const file = secretPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  cachedSecret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
  return cachedSecret;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlJson(obj) {
  return base64url(JSON.stringify(obj));
}

function signJwt(payload, secret = getJwtSecret()) {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(payload);
  const data = `${header}.${body}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

function decodePart(part) {
  const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
  const json = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8'
  );
  return JSON.parse(json);
}

function verifyJwt(token, secret = getJwtSecret()) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const header = decodePart(headerB64);
    if (header.alg !== 'HS256') return null;
    return decodePart(payloadB64);
  } catch {
    return null;
  }
}

function isJwtShape(token) {
  const parts = String(token || '').split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/** JWT không hết hạn theo thời gian — chỉ còn hiệu lực khi còn trong bảng sessions */
function createSessionJwt({ userId, username, role, jti }) {
  return signJwt({
    sub: userId,
    username,
    role,
    jti,
    iat: Math.floor(Date.now() / 1000),
  });
}

module.exports = {
  getJwtSecret,
  signJwt,
  verifyJwt,
  isJwtShape,
  createSessionJwt,
};
