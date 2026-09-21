const crypto = require('crypto');

const COOKIE_NAME = 'segmenta_crm_session';
const SESSION_SECONDS = 60 * 60 * 12;

function signingKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function readCookie(req, name = COOKIE_NAME) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function sign(value) {
  return crypto.createHmac('sha256', signingKey()).update(value).digest('hex');
}

function verifySession(req) {
  const token = readCookie(req);
  if (!token || !signingKey()) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Number(decoded?.exp || 0) <= Date.now()) return null;
    return decoded;
  } catch (_) {
    return null;
  }
}

function setSession(res, data) {
  const payloadData = {
    ...data,
    exp: Date.now() + SESSION_SECONDS * 1000
  };
  const payload = Buffer.from(JSON.stringify(payloadData)).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
  return payloadData;
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function isPlatformAdmin(session) {
  return session?.platform_role === 'super_admin';
}

module.exports = { COOKIE_NAME, SESSION_SECONDS, verifySession, setSession, clearSession, isPlatformAdmin };
