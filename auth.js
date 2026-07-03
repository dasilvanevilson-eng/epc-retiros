const crypto = require('crypto');

const cookieName = 'epc_session';
const roles = ['admin', 'gestor', 'consulta'];
const defaultMaxAge = 60 * 60 * 8;

const getSecret = () => process.env.EPC_AUTH_SECRET || (process.env.VERCEL ? '' : 'epc-local-development-secret');
const configuredUsers = () => {
  const fromJson = process.env.EPC_USERS_JSON;
  if (fromJson) return JSON.parse(fromJson);
  const username = process.env.EPC_ADMIN_USER;
  const password = process.env.EPC_ADMIN_PASSWORD;
  return username && password ? [{ username, password, role: 'admin' }] : [];
};

const base64url = (value) => Buffer.from(value).toString('base64url');
const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
const timingSafeEqual = (first, second) => {
  const a = Buffer.from(String(first));
  const b = Buffer.from(String(second));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index >= 0 ? [part.slice(0, index), decodeURIComponent(part.slice(index + 1))] : [part, ''];
  }));
}

function sessionCookie(token, maxAge = defaultMaxAge) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie() {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function createSession(user) {
  const secret = getSecret();
  if (!secret) throw new Error('EPC_AUTH_SECRET nao configurado.');
  const payload = base64url(JSON.stringify({
    sub: user.username,
    role: roles.includes(user.role) ? user.role : 'consulta',
    exp: Math.floor(Date.now() / 1000) + defaultMaxAge,
  }));
  return `${payload}.${sign(payload, secret)}`;
}

function readSession(req) {
  const secret = getSecret();
  if (!secret) return null;
  const token = parseCookies(req.headers.cookie || '')[cookieName];
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!timingSafeEqual(sign(payload, secret), signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

async function validateLogin(username, password) {
  const user = configuredUsers().find((item) => item.username === username && item.active !== false);
  if (!user || !user.password || !timingSafeEqual(user.password, password)) return null;
  return { username: user.username, role: roles.includes(user.role) ? user.role : 'consulta' };
}

function authStatus(req) {
  const session = readSession(req);
  return {
    authenticated: Boolean(session),
    user: session ? { username: session.sub, role: session.role } : null,
    configured: configuredUsers().length > 0 && Boolean(getSecret()),
  };
}

module.exports = {
  authStatus,
  clearSessionCookie,
  createSession,
  readSession,
  sessionCookie,
  validateLogin,
};
