const crypto = require('crypto');
const { listRecords, saveRecord, deleteRecord } = require('./databaseAdapter');
const { allPermissions, defaultPerfilPermissoes, defaultProfiles, normalizeRole, permissionsForRole, safeUser } = require('./permissions');

const cookieName = 'epc_session';
const roles = ['admin', 'coordenador_geral', 'coordenador_retiro', 'gestor', 'consulta'];
const defaultMaxAge = 60 * 60 * 8;
const passwordIterations = 120000;
const passwordKeyLength = 32;

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

const randomId = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
const hashPassword = (password, salt = crypto.randomBytes(16).toString('base64url'), iterations = passwordIterations) => ({
  passwordHash: crypto.pbkdf2Sync(String(password || ''), salt, iterations, passwordKeyLength, 'sha256').toString('base64url'),
  passwordSalt: salt,
  passwordIterations: iterations,
});

function verifyPassword(password, user) {
  if (user.passwordHash && user.passwordSalt) {
    const hashed = hashPassword(password, user.passwordSalt, Number(user.passwordIterations) || passwordIterations);
    return timingSafeEqual(hashed.passwordHash, user.passwordHash);
  }
  return user.password && timingSafeEqual(user.password, password);
}

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
    sub: user.username || user.login,
    id: user.id || user.username || user.login,
    nome: user.nome || user.name || user.username || user.login,
    role: normalizeRole(roles.includes(user.role) ? user.role : user.perfilCodigo),
    perfilId: user.perfilId || normalizeRole(user.role || user.perfilCodigo),
    perfilCodigo: user.perfilCodigo || normalizeRole(user.role),
    permissions: user.permissions || permissionsForRole(user.role || user.perfilCodigo),
    retiroIds: user.retiroIds || [],
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
  const login = String(username || '').trim();
  try {
    await ensureDefaultAccessData();
    const databaseUser = (await listRecords('usuarios')).find((item) => item.login === login && item.ativo !== false);
    if (databaseUser && verifyPassword(password, databaseUser)) return hydrateUser(databaseUser);
  } catch {
    // Mantem o usuario de emergencia por variavel de ambiente disponivel para manutencao.
  }

  const user = configuredUsers().find((item) => item.username === login && item.active !== false);
  if (!user || !user.password || !timingSafeEqual(user.password, password)) return null;
  const role = normalizeRole(user.role || 'admin');
  return { id: `env:${user.username}`, username: user.username, nome: user.username, role, perfilId: role, perfilCodigo: role, permissions: permissionsForRole(role), retiroIds: [] };
}

function authStatus(req) {
  const session = readSession(req);
  return {
    authenticated: Boolean(session),
    user: session ? { id: session.id, username: session.sub, nome: session.nome, role: session.role, perfilId: session.perfilId, perfilCodigo: session.perfilCodigo, permissions: session.permissions || [], retiroIds: session.retiroIds || [] } : null,
    configured: Boolean(getSecret()),
  };
}

async function ensureDefaultAccessData() {
  const [profiles, permissions, profilePermissions] = await Promise.all([
    listRecords('perfis'),
    listRecords('permissoes'),
    listRecords('perfil_permissoes'),
  ]);
  const profileIds = new Set(profiles.map((item) => item.id));
  const permissionIds = new Set(permissions.map((item) => item.id));
  const profilePermissionIds = new Set(profilePermissions.map((item) => item.id));
  await Promise.all([
    ...defaultProfiles.filter((profile) => !profileIds.has(profile.id)).map((profile) => saveRecord('perfis', { ...safeUser(profile), permissions: undefined, locked: profile.id === 'admin' })),
    ...allPermissions.filter(([id]) => !permissionIds.has(id)).map(([id, modulo, descricao]) => saveRecord('permissoes', { id, modulo, descricao })),
    ...defaultPerfilPermissoes.filter((item) => !profilePermissionIds.has(item.id)).map((item) => saveRecord('perfil_permissoes', item)),
  ]);
}

async function hydrateUser(user) {
  const [profiles, profilePermissions, userPermissions, userRetreats] = await Promise.all([
    listRecords('perfis'),
    listRecords('perfil_permissoes'),
    listRecords('usuario_permissoes'),
    listRecords('usuario_retiros'),
  ]);
  const profile = profiles.find((item) => item.id === user.perfilId) || profiles.find((item) => item.codigo === user.perfilCodigo);
  const role = normalizeRole(profile?.codigo || user.role || user.perfilCodigo || user.perfilId);
  const basePermissions = role === 'admin'
    ? allPermissions.map(([id]) => id)
    : profilePermissions.filter((item) => item.perfilId === (profile?.id || user.perfilId) && item.permitido !== false).map((item) => item.permissaoId);
  const overrides = userPermissions.filter((item) => item.usuarioId === user.id);
  const permissions = new Set(basePermissions);
  overrides.forEach((item) => {
    if (item.permitido === false) permissions.delete(item.permissaoId);
    else permissions.add(item.permissaoId);
  });
  return {
    id: user.id,
    username: user.login,
    login: user.login,
    nome: user.nome || user.login,
    role,
    perfilId: profile?.id || user.perfilId || role,
    perfilCodigo: role,
    permissions: [...permissions],
    retiroIds: userRetreats.filter((item) => item.usuarioId === user.id).map((item) => item.retiroId),
  };
}

async function listAccessData() {
  await ensureDefaultAccessData();
  const [usuarios, perfis, permissoes, perfilPermissoes, usuarioPermissoes, usuarioRetiros] = await Promise.all([
    listRecords('usuarios'),
    listRecords('perfis'),
    listRecords('permissoes'),
    listRecords('perfil_permissoes'),
    listRecords('usuario_permissoes'),
    listRecords('usuario_retiros'),
  ]);
  return {
    usuarios: usuarios.map(safeUser),
    perfis,
    permissoes,
    perfilPermissoes,
    usuarioPermissoes,
    usuarioRetiros,
  };
}

async function saveAccessUser(incoming = {}) {
  await ensureDefaultAccessData();
  const id = incoming.id || randomId();
  const current = incoming.id ? await listRecords('usuarios').then((users) => users.find((user) => user.id === incoming.id)) : null;
  const record = {
    ...(current || {}),
    id,
    nome: String(incoming.nome || '').trim(),
    login: String(incoming.login || '').trim(),
    perfilId: incoming.perfilId || 'coordenador_retiro',
    ativo: incoming.ativo !== false,
    updatedAt: new Date().toISOString(),
    createdAt: current?.createdAt || new Date().toISOString(),
  };
  if (!record.nome || !record.login) throw new Error('Nome e login sao obrigatorios.');
  if (incoming.password) Object.assign(record, hashPassword(incoming.password));
  if (!record.passwordHash && !record.password) throw new Error('Senha obrigatoria para novo usuario.');
  await saveRecord('usuarios', record);

  const existingOverrides = (await listRecords('usuario_permissoes')).filter((item) => item.usuarioId === id);
  await Promise.all(existingOverrides.map((item) => deleteRecord('usuario_permissoes', item.id)));
  await Promise.all((incoming.permissions || []).map((item) => saveRecord('usuario_permissoes', {
    id: `${id}:${item.permissaoId}`,
    usuarioId: id,
    permissaoId: item.permissaoId,
    permitido: item.permitido !== false,
  })));

  const existingRetreats = (await listRecords('usuario_retiros')).filter((item) => item.usuarioId === id);
  await Promise.all(existingRetreats.map((item) => deleteRecord('usuario_retiros', item.id)));
  await Promise.all((incoming.retiroIds || []).filter(Boolean).map((retiroId) => saveRecord('usuario_retiros', {
    id: `${id}:${retiroId}`,
    usuarioId: id,
    retiroId,
    papel: incoming.perfilId || 'coordenador_retiro',
  })));
  return safeUser(record);
}

async function deleteAccessUser(id) {
  await deleteRecord('usuarios', id);
  const [overrides, retreats] = await Promise.all([listRecords('usuario_permissoes'), listRecords('usuario_retiros')]);
  await Promise.all([
    ...overrides.filter((item) => item.usuarioId === id).map((item) => deleteRecord('usuario_permissoes', item.id)),
    ...retreats.filter((item) => item.usuarioId === id).map((item) => deleteRecord('usuario_retiros', item.id)),
  ]);
}

module.exports = {
  authStatus,
  clearSessionCookie,
  createSession,
  deleteAccessUser,
  ensureDefaultAccessData,
  hydrateUser,
  listAccessData,
  readSession,
  saveAccessUser,
  sessionCookie,
  validateLogin,
};
