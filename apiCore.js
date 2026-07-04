const { stores } = require('./storeConfig');
const { authStatus, clearSessionCookie, createSession, deleteAccessUser, listAccessData, readSession, saveAccessUser, sessionCookie, validateLogin } = require('./auth');
const { checkDatabaseConnection, getRecord, importDatabase, listRecords, readDatabase, saveRecord, deleteRecord } = require('./databaseAdapter');
const { can } = require('./permissions');

const accessStores = ['usuarios', 'perfis', 'permissoes', 'perfil_permissoes', 'usuario_permissoes', 'usuario_retiros'];

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function sendNoContent(res, headers = {}) {
  res.writeHead(204, headers);
  res.end();
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function isPublicRegistrationRequest(resource, id, req) {
  if (req.method === 'GET' && resource === 'retiros' && id) return true;
  if (req.method === 'PUT' && ['pessoas', 'adesoes'].includes(resource) && id) return true;
  if (req.method === 'GET' && ['pessoas', 'adesoes'].includes(resource)) return true;
  return false;
}

function permissionForRequest(resource, id, req) {
  if (resource === 'database') return req.method === 'GET' ? 'usuarios.ver' : 'usuarios.editar';
  if (resource === 'retiros') {
    if (req.method === 'GET') return 'retiros.ver';
    if (req.method === 'PUT') return id ? 'retiros.editar' : 'retiros.criar';
    if (req.method === 'DELETE') return 'retiros.excluir';
  }
  if (resource === 'pessoas' || resource === 'adesoes') {
    if (req.method === 'GET') return 'pessoas.ver';
    if (req.method === 'PUT') return id ? 'pessoas.editar' : 'pessoas.criar';
    if (req.method === 'DELETE') return 'pessoas.excluir';
  }
  if (resource === 'cursistas') {
    if (req.method === 'GET') return 'cursista.ver';
    if (req.method === 'PUT') return id ? 'cursista.editar' : 'cursista.criar';
    if (req.method === 'DELETE') return 'cursista.excluir';
  }
  if (resource === 'comunidades') {
    if (req.method === 'GET') return 'comunidades.ver';
    if (req.method === 'PUT') return id ? 'comunidades.editar' : 'comunidades.criar';
    if (req.method === 'DELETE') return 'comunidades.excluir';
  }
  if (resource === 'crachas') {
    if (req.method === 'GET') return 'crachas.ver';
    if (req.method === 'PUT') return 'crachas.editar';
    if (req.method === 'DELETE') return 'crachas.excluir';
  }
  return null;
}

function denyIfMissingPermission(res, session, permission) {
  if (!permission || can(session, permission)) return false;
  sendError(res, 403, 'Voce nao tem permissao para esta acao.');
  return true;
}

async function handleApi(req, res, pathname) {
  const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id, action] = parts;

  if (resource === 'health') {
    try {
      const connection = await checkDatabaseConnection();
      return sendJson(res, 200, { ok: connection.ok, database: connection.database, auth: authStatus(req).configured });
    } catch (error) {
      return sendJson(res, 200, { ok: false, database: process.env.SUPABASE_URL ? 'supabase' : 'file', auth: authStatus(req).configured, error: error.message || 'Falha ao verificar banco.' });
    }
  }
  if (resource === 'auth' && id === 'session' && req.method === 'GET') return sendJson(res, 200, authStatus(req));
  if (resource === 'auth' && id === 'login' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    const user = await validateLogin(String(username || ''), String(password || ''));
    if (!user) return sendError(res, 401, 'Login ou senha invalidos.');
    return sendJson(res, 200, { user }, { 'Set-Cookie': sessionCookie(createSession(user)) });
  }
  if (resource === 'auth' && id === 'logout' && req.method === 'POST') return sendNoContent(res, { 'Set-Cookie': clearSessionCookie() });

  const publicRegistrationRequest = isPublicRegistrationRequest(resource, id, req);
  const session = readSession(req);
  if (!publicRegistrationRequest && !session) return sendError(res, 401, 'Acesso restrito. Faca login para continuar.');

  if (resource === 'access' && req.method === 'GET') {
    if (denyIfMissingPermission(res, session, 'usuarios.ver')) return;
    return sendJson(res, 200, await listAccessData());
  }
  if (resource === 'access' && id === 'users' && req.method === 'POST') {
    const incoming = await readBody(req);
    const permission = incoming.id ? 'usuarios.editar' : 'usuarios.criar';
    if (denyIfMissingPermission(res, session, permission)) return;
    return sendJson(res, 200, await saveAccessUser(incoming));
  }
  if (resource === 'access' && id === 'users' && action && req.method === 'DELETE') {
    if (denyIfMissingPermission(res, session, 'usuarios.excluir')) return;
    await deleteAccessUser(decodeURIComponent(action));
    return sendNoContent(res);
  }

  if (resource === 'database' && req.method === 'GET') {
    if (denyIfMissingPermission(res, session, 'usuarios.ver')) return;
    return sendJson(res, 200, await readDatabase());
  }
  if (resource === 'database' && id === 'import' && req.method === 'POST') {
    if (denyIfMissingPermission(res, session, 'usuarios.editar')) return;
    await importDatabase(await readBody(req));
    return sendNoContent(res);
  }

  if (!stores.includes(resource)) return sendError(res, 404, 'Recurso nao encontrado.');
  if (accessStores.includes(resource)) return sendError(res, 404, 'Recurso nao encontrado.');
  if (!publicRegistrationRequest && denyIfMissingPermission(res, session, permissionForRequest(resource, id, req))) return;
  if (req.method === 'GET' && !id) return sendJson(res, 200, await listRecords(resource));
  if (req.method === 'GET' && id) return sendJson(res, 200, await getRecord(resource, decodeURIComponent(id)));

  if (req.method === 'PUT' && id) {
    const record = { ...(await readBody(req)), id: decodeURIComponent(id) };
    return sendJson(res, 200, await saveRecord(resource, record));
  }

  if (req.method === 'DELETE' && id) {
    await deleteRecord(resource, decodeURIComponent(id));
    return sendNoContent(res);
  }

  return sendError(res, 405, action ? 'Acao nao permitida.' : 'Metodo nao permitido.');
}

module.exports = { handleApi, sendError };
