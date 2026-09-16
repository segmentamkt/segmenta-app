const crypto = require('crypto');

const COOKIE_NAME = 'segmenta_crm_session';
const SESSION_SECONDS = 60 * 60 * 12;
const EXPECTED_EMAIL = 'host@segmenta.co';
const PASSWORD_SALT = 'segmenta-crm-2026';
const EXPECTED_PASSWORD_HASH = '743f13edcb172e3f1e7f313706ff953ce0365538a60c9154d1288cba2019b32f';

function getSigningKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function sign(value) {
  return crypto.createHmac('sha256', getSigningKey()).update(value).digest('hex');
}

function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch (_) {
    return false;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function verifySession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token || !getSigningKey()) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) { return false; }
  return decoded?.email === EXPECTED_EMAIL && Number(decoded?.exp || 0) > Date.now();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, authenticated: verifySession(req) });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!getSigningKey()) {
    return res.status(503).json({ ok: false, error: 'Server session key not configured' });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const passwordHash = crypto.scryptSync(password, PASSWORD_SALT, 32).toString('hex');

  if (email !== EXPECTED_EMAIL || !safeEqualHex(passwordHash, EXPECTED_PASSWORD_HASH)) {
    return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
  }

  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_SECONDS * 1000 })).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
  return res.status(200).json({ ok: true, authenticated: true });
};
