const { stores } = require('./storeConfig');
const { authStatus, clearSessionCookie, createSession, readSession, sessionCookie, validateLogin } = require('./auth');
const { checkDatabaseConnection, getRecord, importDatabase, listRecords, readDatabase, saveRecord, deleteRecord } = require('./databaseAdapter');

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

async function handleApi(req, res, pathname) {
  const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id, action] = parts;

  if (resource === 'health') {
    const connection = await checkDatabaseConnection();
    return sendJson(res, 200, { ok: connection.ok, database: connection.database, auth: authStatus(req).configured });
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
  if (!publicRegistrationRequest && !readSession(req)) return sendError(res, 401, 'Acesso restrito. Faca login para continuar.');

  if (resource === 'database' && req.method === 'GET') return sendJson(res, 200, await readDatabase());
  if (resource === 'database' && id === 'import' && req.method === 'POST') {
    await importDatabase(await readBody(req));
    return sendNoContent(res);
  }

  if (!stores.includes(resource)) return sendError(res, 404, 'Recurso nao encontrado.');
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
