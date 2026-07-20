const { stores } = require('./storeConfig');
const { authStatus, changeOwnPassword, clearSessionCookie, createSession, deleteAccessUser, listAccessData, readSession, saveAccessUser, sessionCookie, validateLogin } = require('./auth');
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

const dataLossBypassField = '__allowRegistrationDataLoss';
const protectedRegistrationStores = new Set(['adesoes', 'cursistas']);
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isEmptyProtectedValue = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return !value.length;
  if (isPlainObject(value)) return !Object.keys(value).length;
  return false;
};
const wouldLoseProtectedValue = (current, next) => {
  if (isEmptyProtectedValue(current)) return false;
  if (isEmptyProtectedValue(next)) return true;
  if (typeof current === 'number' && current !== 0 && Number(next) === 0) return true;
  if (current === true && next === false) return true;
  return false;
};
const protectedDataLossFields = (current = {}, next = {}) => Object.keys(current)
  .filter((field) => !['updatedAt', 'atualizadoEm'].includes(field))
  .filter((field) => wouldLoseProtectedValue(current[field], next[field]));

async function assertNoRegistrationDataLoss(resource, record) {
  const allowDataLoss = record[dataLossBypassField] === true;
  delete record[dataLossBypassField];
  if (!protectedRegistrationStores.has(resource) || !record.id || allowDataLoss) return;
  const current = await getRecord(resource, record.id).catch(() => null);
  const fields = current ? protectedDataLossFields(current, record) : [];
  if (fields.length) {
    throw new Error(`Salvamento bloqueado para proteger dados ja cadastrados em ${resource}. Campos em risco: ${fields.join(', ')}. Se a alteracao for intencional, faca backup, audite o impacto e use autorizacao explicita no codigo.`);
  }
}

function isPublicRegistrationRequest(resource, id, req) {
  if (req.method === 'GET' && resource === 'retiros' && id) return true;
  if (req.method === 'PUT' && ['pessoas', 'adesoes'].includes(resource) && id) return true;
  if (req.method === 'GET' && ['pessoas', 'adesoes'].includes(resource)) return true;
  return false;
}

async function publicReceiverRetreat(req) {
  const token = String(req.headers['x-public-receiver-token'] || '').trim();
  if (!token) return null;
  const retreats = await listRecords('retiros');
  return retreats.find((retreat) => retreat?.recebedorToken === token) || null;
}

async function handlePublicReceiverRequest(req, res, resource, id) {
  const retreat = await publicReceiverRetreat(req);
  if (!retreat) return false;
  const retreatId = retreat.id;
  const allowedStores = ['retiros', 'adesoes', 'pessoas', 'cursistas'];
  if (!allowedStores.includes(resource)) return false;

  if (req.method === 'GET' && resource === 'retiros' && id) {
    if (decodeURIComponent(id) !== retreatId) return sendError(res, 403, 'Link do recebedor nao autorizado para este retiro.'), true;
    return sendJson(res, 200, retreat), true;
  }
  if (req.method === 'GET' && resource === 'retiros' && !id) return sendJson(res, 200, [retreat]), true;

  if (req.method === 'GET' && resource === 'adesoes' && !id) {
    const records = (await listRecords('adesoes')).filter((entry) => entry.retiroId === retreatId);
    return sendJson(res, 200, records), true;
  }
  if (req.method === 'GET' && resource === 'cursistas' && !id) {
    const records = (await listRecords('cursistas')).filter((entry) => entry.retiroId === retreatId);
    return sendJson(res, 200, records), true;
  }
  if (req.method === 'GET' && resource === 'pessoas' && !id) {
    const entries = (await listRecords('adesoes')).filter((entry) => entry.retiroId === retreatId);
    const peopleIds = new Set(entries.map((entry) => entry.pessoaId).filter(Boolean));
    const records = (await listRecords('pessoas')).filter((person) => peopleIds.has(person.id));
    return sendJson(res, 200, records), true;
  }
  if (req.method === 'PUT' && ['adesoes', 'cursistas'].includes(resource) && id) {
    const decodedId = decodeURIComponent(id);
    const current = await getRecord(resource, decodedId);
    if (!current || current.retiroId !== retreatId) return sendError(res, 403, 'Link do recebedor nao autorizado para este registro.'), true;
    const incoming = await readBody(req);
    const allowedFields = resource === 'cursistas'
      ? ['recebedorValorPago', 'recebedorTaxaPaga', 'recebedorFormaPagamento', 'recebedorObservacao']
      : ['valorPago', 'taxaPaga', 'formaPagamento', 'recebedorObservacao'];
    const record = { ...current };
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(incoming, field)) record[field] = incoming[field];
    });
    return sendJson(res, 200, await saveRecord(resource, record)), true;
  }
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
  if (resource === 'configuracoes') {
    if (String(id || '') === 'recado-equipe') {
      if (req.method === 'GET') return 'recado-equipe.ver';
      if (req.method === 'PUT') return 'recado-equipe.editar';
      if (req.method === 'DELETE') return 'usuarios.editar';
    }
    if (String(id || '') === 'quadrante-order') {
      if (req.method === 'GET') return 'quadrante.ver';
      if (req.method === 'PUT') return 'quadrante.editar';
      if (req.method === 'DELETE') return 'usuarios.editar';
    }
    if (req.method === 'GET') return 'quadrante.ver';
    if (req.method === 'PUT') return 'quadrante.editar';
    if (req.method === 'DELETE') return 'usuarios.editar';
  }
  return null;
}

function isRetreatConcludeUpdate(current = {}, next = {}) {
  if (!current?.id || next.status !== 'concluido' || current.status === 'concluido') return false;
  const allowedChangedFields = new Set(['status', 'concluidoEm', 'updatedAt', 'atualizadoEm']);
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  for (const key of keys) {
    if (allowedChangedFields.has(key)) continue;
    if (JSON.stringify(current[key] ?? null) !== JSON.stringify(next[key] ?? null)) return false;
  }
  return true;
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
  if (await handlePublicReceiverRequest(req, res, resource, id)) return;
  if (!publicRegistrationRequest && !session) return sendError(res, 401, 'Acesso restrito. Faca login para continuar.');

  if (resource === 'auth' && id === 'change-password' && req.method === 'POST') {
    const { currentPassword, newPassword } = await readBody(req);
    await changeOwnPassword(session, String(currentPassword || ''), String(newPassword || ''));
    return sendNoContent(res);
  }

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
  let requestBody = null;
  let requestPermission = permissionForRequest(resource, id, req);
  if (!publicRegistrationRequest && resource === 'retiros' && req.method === 'PUT' && id) {
    requestBody = await readBody(req);
    const record = { ...requestBody, id: decodeURIComponent(id) };
    const current = await getRecord(resource, record.id).catch(() => null);
    requestPermission = isRetreatConcludeUpdate(current, record) ? 'retiros.encerrar' : 'retiros.editar';
  }
  if (!publicRegistrationRequest && denyIfMissingPermission(res, session, requestPermission)) return;
  if (req.method === 'GET' && !id) return sendJson(res, 200, await listRecords(resource));
  if (req.method === 'GET' && id) return sendJson(res, 200, await getRecord(resource, decodeURIComponent(id)));

  if (req.method === 'PUT' && id) {
    const record = { ...(requestBody || await readBody(req)), id: decodeURIComponent(id) };
    await assertNoRegistrationDataLoss(resource, record);
    return sendJson(res, 200, await saveRecord(resource, record));
  }

  if (req.method === 'DELETE' && id) {
    await deleteRecord(resource, decodeURIComponent(id));
    return sendNoContent(res);
  }

  return sendError(res, 405, action ? 'Acao nao permitida.' : 'Metodo nao permitido.');
}

module.exports = { handleApi, sendError };
