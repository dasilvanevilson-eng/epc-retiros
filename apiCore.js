const { randomUUID } = require('crypto');
const { stores, financeStores } = require('./storeConfig');
const { authStatus, changeOwnPassword, clearSessionCookie, createSession, deleteAccessUser, hydrateUser, listAccessData, readSession, saveAccessUser, sessionCookie, validateLogin } = require('./auth');
const { checkDatabaseConnection, deleteCursistaEpc, deleteCursistaSmp, getRecord, getRecordStrict, importDatabase, listCursistasEpc, listCursistasSmp, listRecords, moveCommunityMemberAtomic, readDatabase, saveCursistaEpc, saveCursistaSmp, saveRecord, saveTeamCoupleAtomic, saveRetreatClosedRegistrationSectors, saveRetreatStudentRegistrationLinks, deleteRecord, deleteRecordStrict } = require('./databaseAdapter');
const { can } = require('./permissions');
const { cancelOperation, commitRestore, createRestore, createSnapshot, isMaintenanceActive, listChunks, previewRestore, uploadRestoreChunk } = require('./backupService');
const {
  prepareStudentRegistrationLinkSync,
  resolvePublicStudentLink,
  sanitizePublicRetreat,
  savePublicStudentRegistration,
  studentRegistrationLinkStatus,
  withSyncedStudentRegistrationLinks,
} = require('./publicStudentLinks');
const {
  createPublicPhotoTicket,
  deleteStudentPhotos,
  downloadPhoto,
  findStudent,
  findStudentByFile,
  readRawImage,
  savePhoto,
  verifyPublicPhotoTicket,
} = require('./studentPhotoService');

const accessStores = ['usuarios', 'perfis', 'permissoes', 'perfil_permissoes', 'usuario_permissoes', 'usuario_retiros'];
const financeStoreSet = new Set(financeStores);
const scopedFinanceStores = new Set(['financeiro_planilhas', 'financeiro_planilha_auditoria']);
const allowedRetreatTypes = new Set(['Taschinha', 'Girassol', 'ONDA', 'EJA', 'EJU', 'EPC', 'SMP', 'EIS-ME AQUI']);

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

function sendJpeg(res, photo) {
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': photo.buffer.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(photo.buffer);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

const uniquePhotoRecordIds = (...recordIds) => [...new Set(recordIds.map((value) => String(value || '').trim()).filter(Boolean))];
async function deleteStudentPhotoAliases(type, retreatId, ...recordIds) {
  const total = { deleted: 0, objectsDeleted: 0 };
  for (const recordId of uniquePhotoRecordIds(...recordIds)) {
    const result = await deleteStudentPhotos(type, retreatId, recordId);
    total.deleted += Number(result.deleted) || 0;
    total.objectsDeleted += Number(result.objectsDeleted) || 0;
  }
  return total;
}

async function downloadStudentPhotoAliases(type, retreatId, ...recordIds) {
  for (const recordId of uniquePhotoRecordIds(...recordIds)) {
    const photo = await downloadPhoto(type, retreatId, recordId);
    if (photo) return photo;
  }
  return null;
}

const dataLossBypassField = '__allowRegistrationDataLoss';
const userSubmittedRegistrationField = '__userSubmittedRegistration';
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
const preservedRegistrationFields = ['dias', 'setores', 'retirosAnteriores'];
const requestOrigin = (req = {}) => ({
  method: req.method || '',
  url: req.url || '',
  referer: req.headers?.referer || req.headers?.referrer || '',
  userAgent: req.headers?.['user-agent'] || '',
});

async function protectRegistrationWrite(resource, record, req) {
  const allowDataLoss = record[dataLossBypassField] === true;
  const userSubmittedRegistration = record[userSubmittedRegistrationField] === true;
  delete record[dataLossBypassField];
  delete record[userSubmittedRegistrationField];
  if (!protectedRegistrationStores.has(resource) || !record.id) return record;
  const current = await getRecord(resource, record.id).catch(() => null);
  if (current) {
    const preserved = preservedRegistrationFields.filter((field) => !(field === 'retirosAnteriores' && record.dispensaRetirosAnteriores === true) && !isEmptyProtectedValue(current[field]) && isEmptyProtectedValue(record[field]));
    if (preserved.length) {
      preserved.forEach((field) => { record[field] = current[field]; });
      console.warn(JSON.stringify({
        event: 'registration-protected-fields-preserved',
        resource,
        id: record.id,
        fields: preserved,
        origin: requestOrigin(req),
      }));
    }
  }
  if (allowDataLoss || userSubmittedRegistration) return record;
  const fields = current ? protectedDataLossFields(current, record) : [];
  if (fields.length) {
    throw new Error(`Salvamento bloqueado para proteger dados ja cadastrados em ${resource}. Campos em risco: ${fields.join(', ')}. Se a alteracao for intencional, faca backup, audite o impacto e use autorizacao explicita no codigo.`);
  }
  return record;
}

function isPublicRegistrationRequest(resource, id, req) {
  if (req.method === 'POST' && resource === 'adesoes-casal' && !id) return true;
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

async function handlePublicReceiverRequest(req, res, resource, id, action) {
  const retreat = await publicReceiverRetreat(req);
  if (!retreat) return false;
  const retreatId = retreat.id;
  const studentFormType = retreat.tipoFichaCursista || 'cursista-individual';
  const usesCoupleStudentForm = ['cursista-smp', 'cursista-epc'].includes(studentFormType);
  const allowedStores = ['retiros', 'adesoes', 'pessoas', 'cursistas', 'cursista-smp', 'cursista-epc'];
  if (!allowedStores.includes(resource)) return false;

  if (req.method === 'GET' && resource === 'retiros' && id) {
    if (decodeURIComponent(id) !== retreatId) return sendError(res, 403, 'Link do recebedor nao autorizado para este retiro.'), true;
    return sendJson(res, 200, retreat), true;
  }
  if (req.method === 'GET' && resource === 'retiros' && !id) return sendJson(res, 200, [retreat]), true;

  if (req.method === 'GET' && resource === 'adesoes' && !id) {
    const records = await listRecords('adesoes', { retiroId: retreatId });
    return sendJson(res, 200, records), true;
  }
  if (req.method === 'GET' && resource === 'cursistas' && !id) {
    if (usesCoupleStudentForm) return sendError(res, 403, 'Link do recebedor nao autorizado para esta ficha de cursista.'), true;
    const records = await listRecords('cursistas', { retiroId: retreatId });
    return sendJson(res, 200, records), true;
  }
  if (req.method === 'GET' && ['cursista-smp', 'cursista-epc'].includes(resource) && !id) {
    if (resource !== studentFormType) return sendError(res, 403, 'Link do recebedor nao autorizado para esta ficha de cursista.'), true;
    const url = new URL(req.url || `/api/${resource}`, 'https://familiaepcindaial.local');
    const queryRetreatId = url.searchParams.get('retiroId') || retreatId;
    if (queryRetreatId !== retreatId) return sendError(res, 403, 'Link do recebedor nao autorizado para este retiro.'), true;
    return sendJson(res, 200, resource === 'cursista-epc' ? await listCursistasEpc(retreatId) : await listCursistasSmp(retreatId)), true;
  }
  if (req.method === 'GET' && resource === 'pessoas' && !id) {
    const records = await listRecords('pessoas', { retiroId: retreatId });
    return sendJson(res, 200, records), true;
  }
  if (req.method === 'PUT' && ['adesoes', 'cursistas'].includes(resource) && id) {
    if (resource === 'cursistas' && usesCoupleStudentForm) return sendError(res, 403, 'Link do recebedor nao autorizado para esta ficha de cursista.'), true;
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
  if (req.method === 'PUT' && ['cursista-smp', 'cursista-epc'].includes(resource) && id && action) {
    if (resource !== studentFormType) return sendError(res, 403, 'Link do recebedor nao autorizado para esta ficha de cursista.'), true;
    if (decodeURIComponent(id) !== retreatId) return sendError(res, 403, 'Link do recebedor nao autorizado para este retiro.'), true;
    const decodedId = decodeURIComponent(action);
    const listCoupleStudents = resource === 'cursista-epc' ? listCursistasEpc : listCursistasSmp;
    const saveCoupleStudent = resource === 'cursista-epc' ? saveCursistaEpc : saveCursistaSmp;
    const current = (await listCoupleStudents(retreatId)).find((record) => record.id === decodedId || record.numeroFichaSmp === decodedId);
    if (!current) return sendError(res, 403, 'Link do recebedor nao autorizado para este registro.'), true;
    const incoming = await readBody(req);
    const allowedFields = ['valorPagoSmp', 'saldoPagarSmp', 'recebedorValorPagoSmp', 'recebedorTaxaPagaSmp', 'recebedorFormaPagamentoSmp', 'recebedorObservacaoSmp'];
    const record = { ...current, retiroId, id: decodedId };
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(incoming, field)) record[field] = incoming[field];
    });
    return sendJson(res, 200, await saveCoupleStudent(record)), true;
  }
  return false;
}

function permissionForRequest(resource, id, req) {
  if (financeStoreSet.has(resource)) {
    if (resource === 'financeiro_planilha_auditoria') return req.method === 'GET' ? 'financeiro.ver' : 'financeiro.excluir';
    if (req.method === 'GET') return 'financeiro.ver';
    if (req.method === 'PUT') return 'financeiro.editar';
    if (req.method === 'DELETE') return 'financeiro.excluir';
  }
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

const financeNumber = (value) => {
  const raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  const number = typeof value === 'number' ? value : Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(number) ? number : 0;
};
const nonNegativeFinanceNumber = (value) => Math.max(0, financeNumber(value));
const financeSectorKey = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const retreatFinanceOrder = (retreat = {}) => {
  const start = String(retreat.dataInicio || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return `${start}T12:00:00.000Z`;
  const created = String(retreat.createdAt || '');
  return Number.isNaN(Date.parse(created)) ? '' : new Date(created).toISOString();
};
const previousFinanceRetreat = (retreat, retreats) => {
  const order = retreatFinanceOrder(retreat);
  return retreats.filter((item) => item.id !== retreat.id && retreatFinanceOrder(item) < order)
    .sort((first, second) => retreatFinanceOrder(second).localeCompare(retreatFinanceOrder(first)) || String(second.createdAt || '').localeCompare(String(first.createdAt || '')))[0] || null;
};
const normalizeFinanceLine = (line, position, existing = null, previous = null, index = 0) => {
  const mode = line.modo === 'saldo' ? 'saldo' : 'movimento';
  const initial = nonNegativeFinanceNumber(position);
  let input = nonNegativeFinanceNumber(line.entrada);
  let output = nonNegativeFinanceNumber(line.saida);
  let balance;
  if (mode === 'saldo') {
    balance = nonNegativeFinanceNumber(line.saldo);
    const delta = balance - initial;
    input = delta > 0 ? delta : 0;
    output = delta < 0 ? Math.abs(delta) : 0;
  } else {
    balance = initial + input - output;
    if (balance < -0.000001) throw new Error(`A saida de ${line.descricao || 'um item'} nao pode gerar saldo negativo.`);
    balance = Math.max(0, balance);
  }
  const description = String(line.descricao || '').trim();
  if (!description) throw new Error('Toda despesa recorrente precisa de descricao.');
  return {
    id: existing?.id || String(line.id || '').trim() || randomUUID(),
    chaveRecorrencia: existing?.chaveRecorrencia || previous?.chaveRecorrencia || String(line.chaveRecorrencia || '').trim() || randomUUID(),
    itemOrigemId: existing?.itemOrigemId || previous?.id || String(line.itemOrigemId || '').trim(),
    descricao: description,
    unidade: String(line.unidade || 'un').trim() || 'un',
    fornecedor: Object.hasOwn(line, 'fornecedor') ? String(line.fornecedor || '').trim() : String(existing?.fornecedor || previous?.fornecedor || '').trim(),
    modo: mode,
    posicaoAnterior: initial,
    entrada: input,
    saida: output,
    saldo: balance,
    precoUnitario: nonNegativeFinanceNumber(line.precoUnitario),
    ordem: index + 1,
  };
};

async function saveFinanceAudit({ sheet, action, reason, data, session }) {
  await saveRecord('financeiro_planilha_auditoria', {
    id: randomUUID(), retiroId: sheet.retiroId, setor: sheet.setor, setorChave: sheet.setorChave,
    planilhaId: sheet.id, acao: action, motivo: String(reason || '').trim(), dados: data,
    responsavel: session?.username || session?.sub || session?.id || '', realizadoEm: new Date().toISOString(),
  });
}

async function normalizeFinanceRecord(resource, record, session) {
  const now = new Date().toISOString();
  const next = { ...record, updatedAt: now, atualizadoPor: session?.username || session?.sub || session?.id || '' };
  if (!next.createdAt) next.createdAt = now;
  if (resource !== 'financeiro_planilhas') return next;
  if (!next.retiroId) throw new Error('A planilha deve estar vinculada ao retiro em foco.');
  const retreat = await getRecord('retiros', next.retiroId);
  if (!retreat) throw new Error('Retiro em foco nao encontrado.');
  const sectorKey = financeSectorKey(next.setorChave || next.setor);
  const configuredSector = (retreat.setores || []).find((sector) => financeSectorKey(sector) === sectorKey);
  const currentSheets = await listRecords('financeiro_planilhas', { retiroId: next.retiroId });
  const current = currentSheets.find((sheet) => sheet.id === next.id) || null;
  if (!configuredSector && !current) throw new Error('O setor nao faz parte da configuracao do retiro em foco.');
  if (currentSheets.some((sheet) => sheet.id !== next.id && sheet.setorChave === sectorKey)) throw new Error('A planilha deste setor ja foi inicializada. Recarregue a pagina.');
  const retreats = await listRecords('retiros');
  const previousRetreat = previousFinanceRetreat(retreat, retreats);
  const previousSheets = previousRetreat ? await listRecords('financeiro_planilhas', { retiroId: previousRetreat.id }) : [];
  const previousSheet = previousSheets.find((sheet) => sheet.setorChave === sectorKey) || null;
  const currentLines = current?.itensRecorrentes || [];
  const previousLines = previousSheet?.itensRecorrentes || [];
  const requestedLines = Array.isArray(next.itensRecorrentes) ? next.itensRecorrentes : [];
  const inheritedLines = !current && previousSheet ? previousLines.map((previous) => requestedLines.find((line) => line.chaveRecorrencia === previous.chaveRecorrencia || line.itemOrigemId === previous.id) || {
    id: '', chaveRecorrencia: previous.chaveRecorrencia || previous.id, itemOrigemId: previous.id,
    descricao: previous.descricao, unidade: previous.unidade, fornecedor: previous.fornecedor || '', modo: 'movimento', entrada: 0, saida: 0,
    saldo: previous.saldo, precoUnitario: previous.precoUnitario,
  }) : [];
  const inheritedKeys = new Set(inheritedLines.map((line) => line.chaveRecorrencia || line.itemOrigemId));
  const incomingLines = current ? requestedLines : [...inheritedLines, ...requestedLines.filter((line) => !inheritedKeys.has(line.chaveRecorrencia || line.itemOrigemId))];
  if (incomingLines.length > 500) throw new Error('A planilha excede o limite de 500 despesas recorrentes.');
  next.itensRecorrentes = incomingLines.map((line, index) => {
    const existing = currentLines.find((item) => item.id === line.id || (line.chaveRecorrencia && item.chaveRecorrencia === line.chaveRecorrencia)) || null;
    const previous = previousLines.find((item) => item.chaveRecorrencia === line.chaveRecorrencia || item.id === line.itemOrigemId) || null;
    const position = existing ? existing.posicaoAnterior : previous ? previous.saldo : 0;
    return normalizeFinanceLine(line, position, existing, previous, index);
  });
  const incomingEventual = Array.isArray(next.despesasEventuais) ? next.despesasEventuais : [];
  if (incomingEventual.length > 500) throw new Error('A planilha excede o limite de 500 despesas eventuais.');
  next.despesasEventuais = incomingEventual.map((item, index) => {
    const description = String(item.descricao || '').trim();
    if (!description) throw new Error('Toda despesa eventual precisa de descricao.');
    const existing = (current?.despesasEventuais || []).find((candidate) => candidate.id === item.id) || null;
    const supplier = Object.hasOwn(item, 'fornecedor') ? String(item.fornecedor || '').trim() : String(existing?.fornecedor || '').trim();
    return { id: String(item.id || '').trim() || randomUUID(), descricao: description, fornecedor: supplier, valor: nonNegativeFinanceNumber(item.valor), ordem: index + 1 };
  });
  const removed = current ? [
    ...currentLines.filter((item) => !next.itensRecorrentes.some((incoming) => incoming.id === item.id)).map((item) => ({ tipo: 'recorrente', item })),
    ...(current.despesasEventuais || []).filter((item) => !next.despesasEventuais.some((incoming) => incoming.id === item.id)).map((item) => ({ tipo: 'eventual', item })),
  ] : [];
  if (removed.length) {
    const reason = String(next.motivoExclusao || '').trim();
    if (!can(session, 'financeiro.excluir')) throw Object.assign(new Error('Sem permissao para excluir itens financeiros.'), { statusCode: 403 });
    if (!reason) throw new Error('Informe o motivo da exclusao dos itens financeiros.');
    for (const removedItem of removed) await saveFinanceAudit({ sheet: current, action: 'exclusao_item', reason, data: removedItem, session });
  }
  delete next.motivoExclusao;
  next.setor = current?.setor || configuredSector || String(next.setor || '').trim();
  next.setorChave = current?.setorChave || sectorKey;
  next.retiroOrigemId = current?.retiroOrigemId || previousSheet?.retiroId || '';
  next.inicializada = true;
  return next;
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

async function teamRegistrationClosedMessage(record = {}) {
  const retreat = record.retiroId ? await getRecord('retiros', record.retiroId).catch(() => null) : null;
  if (!retreat) return null;
  if (retreat.status === 'publicado') return null;
  return retreat.status === 'preparacao'
    ? 'Este retiro ainda esta em preparacao. O cadastro da equipe de trabalho sera liberado quando o retiro for publicado.'
    : 'Este retiro nao esta recebendo cadastro da equipe de trabalho.';
}

async function denyIfTeamRegistrationClosed(res, resource, record, publicRegistrationRequest) {
  if (resource !== 'adesoes') return false;
  if (!publicRegistrationRequest && record?.[userSubmittedRegistrationField] !== true) return false;
  const message = await teamRegistrationClosedMessage(record);
  if (!message) return false;
  sendError(res, 403, message);
  return true;
}

function denyIfMissingPublicVolunteerTerm(res, resource, records, publicRegistrationRequest) {
  if (!publicRegistrationRequest || resource !== 'adesoes') return false;
  const enrolments = Array.isArray(records) ? records : [records];
  if (enrolments.length && enrolments.every((record) => record?.termoVoluntariadoAceito === true)) return false;
  sendError(res, 400, 'Aceite o Termo de adesao de voluntariado para concluir a inscricao.');
  return true;
}

function denyIfMissingPermission(res, session, permission) {
  if (!permission || can(session, permission)) return false;
  sendError(res, 403, 'Voce nao tem permissao para esta acao.');
  return true;
}

const hasGlobalRetreatAccess = (session = {}) => session?.role === 'admin' || session?.perfilCodigo === 'admin';
const allowedRetreatIds = (session = {}) => new Set((session?.retiroIds || []).filter(Boolean));
const canAccessRetreat = (session = {}, retiroId = '') => hasGlobalRetreatAccess(session) || allowedRetreatIds(session).has(retiroId);
const noRetreatAccessMessage = 'Voce nao tem acesso a este retiro.';
const recordRetreatId = (record = {}) => record.retiroId || record.retiro_id || record.id && '';
const filterByAllowedRetreats = (session = {}, records = []) => {
  if (hasGlobalRetreatAccess(session)) return records;
  const allowed = allowedRetreatIds(session);
  return records.filter((record) => allowed.has(recordRetreatId(record)));
};
const tagRetreatAccess = (session = {}, retreat = {}) => ({
  ...retreat,
  acessoPermitido: canAccessRetreat(session, retreat.id),
});
async function allowedPersonIdsForSession(session = {}) {
  if (hasGlobalRetreatAccess(session)) return null;
  const allowed = allowedRetreatIds(session);
  const entries = (await Promise.all([...allowed].map((retiroId) => listRecords('adesoes', { retiroId })))).flat();
  return new Set(entries.map((entry) => entry.pessoaId).filter(Boolean));
}

async function currentSession(req) {
  const session = readSession(req);
  if (!session || String(session.id || '').startsWith('env:')) return session;
  const user = (await listRecords('usuarios')).find((item) => (item.id === session.id || item.login === session.sub) && item.ativo !== false);
  return user ? hydrateUser(user) : null;
}

async function listAuthorizedRecords(resource, session, options = {}) {
  const requestedRetreatId = String(options.retiroId || '').trim();
  if (requestedRetreatId && !canAccessRetreat(session, requestedRetreatId)) return [];
  const records = await listRecords(resource, requestedRetreatId ? { retiroId: requestedRetreatId } : {});
  if (hasGlobalRetreatAccess(session)) return resource === 'retiros' ? records.map((retreat) => tagRetreatAccess(session, retreat)) : records;
  if (resource === 'retiros') return records.map((retreat) => tagRetreatAccess(session, retreat));
  if (['adesoes', 'cursistas', 'casais', 'comunidades', 'crachas'].includes(resource)) return filterByAllowedRetreats(session, records);
  if (scopedFinanceStores.has(resource)) return filterByAllowedRetreats(session, records);
  if (resource === 'pessoas') {
    if (requestedRetreatId) return records;
    const allowedPeople = await allowedPersonIdsForSession(session);
    return records.filter((person) => allowedPeople.has(person.id));
  }
  return records;
}

async function getAuthorizedRecord(resource, id, session) {
  const record = await getRecord(resource, id);
  if (!record) return null;
  if (hasGlobalRetreatAccess(session)) return resource === 'retiros' ? tagRetreatAccess(session, record) : record;
  if (resource === 'retiros') return canAccessRetreat(session, record.id) ? tagRetreatAccess(session, record) : null;
  if (['adesoes', 'cursistas', 'casais', 'comunidades', 'crachas'].includes(resource)) return canAccessRetreat(session, recordRetreatId(record)) ? record : null;
  if (scopedFinanceStores.has(resource)) return canAccessRetreat(session, recordRetreatId(record)) ? record : null;
  if (resource === 'pessoas') {
    const allowedPeople = await allowedPersonIdsForSession(session);
    return allowedPeople.has(record.id) ? record : null;
  }
  return record;
}

async function denyIfMissingRetreatAccess(res, session, resource, recordOrId) {
  if (hasGlobalRetreatAccess(session)) return false;
  if (resource === 'retiros') {
    const retiroId = typeof recordOrId === 'string' ? recordOrId : recordOrId?.id;
    if (canAccessRetreat(session, retiroId)) return false;
    sendError(res, 403, noRetreatAccessMessage);
    return true;
  }
  if (['adesoes', 'cursistas', 'casais', 'comunidades', 'crachas'].includes(resource)) {
    const record = typeof recordOrId === 'string' ? await getRecord(resource, recordOrId) : recordOrId;
    if (record && canAccessRetreat(session, recordRetreatId(record))) return false;
    sendError(res, 403, noRetreatAccessMessage);
    return true;
  }
  if (scopedFinanceStores.has(resource)) {
    const record = typeof recordOrId === 'string' ? await getRecord(resource, recordOrId) : recordOrId;
    if (record && canAccessRetreat(session, recordRetreatId(record))) return false;
    sendError(res, 403, noRetreatAccessMessage);
    return true;
  }
  if (resource === 'pessoas') {
    const personId = typeof recordOrId === 'string' ? recordOrId : recordOrId?.id;
    const allowedPeople = await allowedPersonIdsForSession(session);
    if (allowedPeople.has(personId)) return false;
    sendError(res, 403, noRetreatAccessMessage);
    return true;
  }
  return false;
}

async function handleApi(req, res, pathname) {
  const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [resource, id, action, fourth] = parts;
  const requestUrl = new URL(req.url || pathname || '/', 'https://familiaepcindaial.local');
  const listRetreatId = String(requestUrl.searchParams.get('retiroId') || '').trim();

  if (resource === 'cadastro-cursista' && id) {
    try {
      const publicStudentUrl = new URL(req.url || '/', 'https://familiaepcindaial.local');
      const requestedFileNumber = Number(publicStudentUrl.searchParams.get('ficha')) || 0;
      if (req.method === 'GET' && !action) {
        const context = await resolvePublicStudentLink(id);
        if (!context) return sendError(res, 404, 'Link de cadastro nao encontrado.');
        if (requestedFileNumber && requestedFileNumber !== context.numeroFicha) return sendError(res, 404, 'O numero da ficha nao corresponde a este link.');
        return sendJson(res, 200, {
          numeroFicha: context.numeroFicha,
          tipoFichaCursista: context.type,
          ativo: context.active,
          inscricaoEncerrada: context.closed,
          cadastrado: context.occupied,
          retiro: sanitizePublicRetreat({
            id: context.retreat.id,
            nome: context.retreat.nome,
            dataInicio: context.retreat.dataInicio,
            dataTermino: context.retreat.dataTermino,
            idadeMaximaEspacoKids: context.retreat.idadeMaximaEspacoKids,
            tipoFichaCursista: context.type,
            status: context.retreat.status,
          }),
        });
      }
      if (req.method === 'POST' && action === 'foto') {
        if (await isMaintenanceActive()) return sendError(res, 503, 'O sistema esta temporariamente em manutencao. Tente novamente em alguns minutos.');
        const grant = verifyPublicPhotoTicket(req.headers['x-photo-upload-token'], id);
        const context = await resolvePublicStudentLink(id);
        if (!context || context.retreat.id !== grant.retreatId || context.numeroFicha !== Number(grant.fileNumber) || !context.occupied) {
          return sendError(res, 403, 'A autorizacao nao corresponde a esta ficha.');
        }
        const student = await findStudentByFile(grant.type, grant.retreatId, grant.fileNumber);
        if (!student || String(student.id || student.numeroFichaSmp) !== String(grant.recordId)) return sendError(res, 404, 'Ficha cadastrada nao encontrada.');
        const buffer = await readRawImage(req);
        await savePhoto({ type: grant.type, retreatId: grant.retreatId, recordId: grant.recordId, fileNumber: grant.fileNumber, buffer, origin: 'publico', actorId: null, allowReplace: false });
        return sendJson(res, 201, { saved: true });
      }
      if (req.method === 'POST' && !action) {
        if (await isMaintenanceActive()) return sendError(res, 503, 'O sistema esta temporariamente em manutencao. Tente novamente em alguns minutos.');
        const before = await resolvePublicStudentLink(id);
        const saved = await savePublicStudentRegistration(id, await readBody(req), requestedFileNumber);
        const type = before.type === 'cursista-individual' ? 'individual' : (before.type === 'cursista-epc' ? 'epc' : 'smp');
        const recordId = String(saved.id || saved.numeroFichaSmp);
        return sendJson(res, 201, {
          saved: true,
          photoUploadToken: createPublicPhotoTicket({ token: id, retreatId: before.retreat.id, type, recordId, fileNumber: before.numeroFicha }),
        });
      }
      return sendError(res, 405, 'Metodo nao permitido.');
    } catch (error) {
      return sendError(res, error.statusCode || 400, error.message || 'Nao foi possivel salvar o cadastro.');
    }
  }

  if (resource === 'health') {
    try {
      const connection = await checkDatabaseConnection();
      return sendJson(res, 200, { ok: connection.ok, database: connection.database, auth: authStatus(req).configured });
    } catch (error) {
      return sendJson(res, 200, { ok: false, database: 'supabase-required', auth: authStatus(req).configured, error: error.message || 'Falha ao verificar banco.' });
    }
  }
  if (resource === 'auth' && id === 'session' && req.method === 'GET') {
    const session = await currentSession(req);
    return sendJson(res, 200, {
      authenticated: Boolean(session),
      user: session ? { id: session.id, username: session.username || session.sub, nome: session.nome, role: session.role, perfilId: session.perfilId, perfilCodigo: session.perfilCodigo, permissions: session.permissions || [], retiroIds: session.retiroIds || [] } : null,
      configured: authStatus(req).configured,
    });
  }
  if (resource === 'auth' && id === 'login' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    const user = await validateLogin(String(username || ''), String(password || ''));
    if (!user) return sendError(res, 401, 'Login ou senha invalidos.');
    return sendJson(res, 200, { user }, { 'Set-Cookie': sessionCookie(createSession(user)) });
  }
  if (resource === 'auth' && id === 'logout' && req.method === 'POST') return sendNoContent(res, { 'Set-Cookie': clearSessionCookie() });

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !['auth', 'backup'].includes(resource) && await isMaintenanceActive()) {
    return sendError(res, 503, 'O sistema esta temporariamente em manutencao para restauracao de backup. Tente novamente em alguns minutos.');
  }

  const session = await currentSession(req);
  const publicRegistrationRequest = !session && isPublicRegistrationRequest(resource, id, req);
  if (await handlePublicReceiverRequest(req, res, resource, id, action)) return;
  if (!publicRegistrationRequest && !session) return sendError(res, 401, 'Acesso restrito. Faca login para continuar.');

  if (resource === 'adesoes-casal') {
    if (req.method !== 'POST' || id) return sendError(res, 405, 'Metodo nao permitido.');
    try {
      const incoming = await readBody(req);
      const pessoas = Array.isArray(incoming.pessoas) ? incoming.pessoas : [];
      const adesoes = Array.isArray(incoming.adesoes) ? incoming.adesoes : [];
      const casalId = String(incoming.casalId || '').trim();
      if (pessoas.length !== 2 || adesoes.length !== 2 || !casalId) return sendError(res, 400, 'A ficha de casal deve conter exatamente dois integrantes.');
      const retreatIds = new Set(adesoes.map((record) => String(record?.retiroId || '').trim()).filter(Boolean));
      if (retreatIds.size !== 1) return sendError(res, 400, 'Os dois integrantes devem pertencer ao mesmo retiro.');
      const retreatId = [...retreatIds][0];
      const cpfs = pessoas.map((person) => String(person?.cpf || person?.id || '').replace(/\D/g, ''));
      const enrolmentCpfs = adesoes.map((record) => String(record?.pessoaId || '').replace(/\D/g, ''));
      if (cpfs.some((cpf) => cpf.length !== 11) || new Set(cpfs).size !== 2 || cpfs.some((cpf, index) => cpf !== enrolmentCpfs[index])) {
        return sendError(res, 400, 'Os integrantes e seus vinculos de CPF estao inconsistentes.');
      }
      if (adesoes.some((record) => record.casalId !== casalId)) return sendError(res, 400, 'O vinculo do casal esta inconsistente.');
      if (denyIfMissingPublicVolunteerTerm(res, 'adesoes', adesoes, publicRegistrationRequest)) return;
      if (session) {
        if (denyIfMissingPermission(res, session, 'pessoas.editar')) return;
        if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
      }
      const protectedEnrolments = [];
      for (const incomingRecord of adesoes) {
        const record = { ...incomingRecord };
        if (publicRegistrationRequest) record[userSubmittedRegistrationField] = true;
        if (await denyIfTeamRegistrationClosed(res, 'adesoes', record, publicRegistrationRequest)) return;
        protectedEnrolments.push(await protectRegistrationWrite('adesoes', record, req));
      }
      return sendJson(res, 200, await saveTeamCoupleAtomic({ casalId, pessoas, adesoes: protectedEnrolments }));
    } catch (error) {
      console.error(error);
      return sendError(res, 400, error.message || 'Nao foi possivel salvar a ficha de casal.');
    }
  }

  if (resource === 'comunidades-mover-membro') {
    if (req.method !== 'POST' || id) return sendError(res, 405, 'Metodo nao permitido.');
    if (denyIfMissingPermission(res, session, 'comunidades.editar')) return;
    try {
      const body = await readBody(req);
      const retreatId = String(body.retiroId || '').trim();
      const targetCommunityId = String(body.targetCommunityId || '').trim();
      const membershipType = String(body.membershipType || '').trim().toLowerCase();
      const studentId = String(body.studentId || '').trim();
      if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
      const result = await moveCommunityMemberAtomic({ retreatId, targetCommunityId, membershipType, studentId });
      return sendJson(res, 200, result);
    } catch (error) {
      console.error(error);
      return sendError(res, 400, error.message || 'Nao foi possivel mover o integrante entre comunidades.');
    }
  }

  if (resource === 'cursista-foto' && id && action && fourth) {
    try {
      const type = decodeURIComponent(id);
      const retreatId = decodeURIComponent(action);
      const recordId = decodeURIComponent(fourth);
      const permissionPrefix = type === 'individual' ? 'cursista' : `cursista-${type}`;
      if (!['individual', 'smp', 'epc'].includes(type)) return sendError(res, 400, 'Tipo de ficha invalido.');
      if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
      const student = await findStudent(type, retreatId, recordId);
      if (!student) return sendError(res, 404, 'Ficha de cursista nao encontrada.');
      const canonicalRecordId = String(student.id || student.numeroFichaSmp || recordId);
      if (req.method === 'GET') {
        if (denyIfMissingPermission(res, session, `${permissionPrefix}.ver`)) return;
        const photo = await downloadStudentPhotoAliases(type, retreatId, canonicalRecordId, recordId);
        if (!photo) return sendError(res, 404, 'Esta ficha ainda nao possui foto.');
        return sendJpeg(res, photo);
      }
      if (req.method === 'PUT') {
        if (denyIfMissingPermission(res, session, `${permissionPrefix}.editar`)) return;
        const retreat = await getRecord('retiros', retreatId).catch(() => null);
        if (!retreat) return sendError(res, 404, 'Retiro nao encontrado.');
        if (retreat.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: disponivel apenas para consulta.');
        const fileNumber = type === 'individual' ? student.numeroFichaIndividual : (student.numeroFichaSmp || student.id);
        const buffer = await readRawImage(req);
        await savePhoto({ type, retreatId, recordId: canonicalRecordId, fileNumber, buffer, origin: 'logado', actorId: session.id || session.sub, allowReplace: true });
        return sendJson(res, 201, { saved: true });
      }
      if (req.method === 'DELETE') {
        if (denyIfMissingPermission(res, session, `${permissionPrefix}.editar`)) return;
        const retreat = await getRecord('retiros', retreatId).catch(() => null);
        if (!retreat) return sendError(res, 404, 'Retiro nao encontrado.');
        if (retreat.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: disponivel apenas para consulta.');
        if (req.headers['x-confirm-photo-deletion'] !== 'definitive') return sendError(res, 400, 'Confirme explicitamente a exclusao definitiva da foto.');
        const result = await deleteStudentPhotoAliases(type, retreatId, canonicalRecordId, recordId);
        return sendJson(res, 200, { deleted: true, versionsDeleted: result.deleted });
      }
      return sendError(res, 405, 'Metodo nao permitido para foto de cursista.');
    } catch (error) {
      return sendError(res, error.statusCode || 400, error.message || 'Nao foi possivel processar a foto.');
    }
  }

  if (resource === 'cursista-links' && id && action === 'sync' && req.method === 'POST') {
    if (denyIfMissingPermission(res, session, 'retiros.ver')) return;
    const retreatId = decodeURIComponent(id);
    if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
    const current = await getRecord('retiros', retreatId).catch(() => null);
    if (!current) return sendError(res, 404, 'Retiro nao encontrado.');
    const syncResult = await prepareStudentRegistrationLinkSync(current);
    if (syncResult.blocked) {
      const { individual, smp, epc } = syncResult.counts;
      return sendError(res, 409, `Rotacao dos links bloqueada: existem fichas cadastradas neste retiro (Individual: ${individual}, SMP: ${smp}, EPC: ${epc}).`);
    }
    const sameLinks = JSON.stringify(syncResult.links) === JSON.stringify(current.linksCadastroCursistas || []);
    const saved = sameLinks
      ? current
      : await saveRetreatStudentRegistrationLinks(retreatId, syncResult.links);
    return sendJson(res, 200, {
      retiroId: saved.id,
      numeroPrevistoFichasCursista: Number(saved.numeroPrevistoFichasCursista) || 0,
      linksRegenerados: syncResult.rotated,
      links: await studentRegistrationLinkStatus(saved),
    });
  }

  if (resource === 'cursista-links' && id && action === 'destinatario' && req.method === 'POST') {
    if (denyIfMissingPermission(res, session, 'links-cadastro.editar')) return;
    const retreatId = decodeURIComponent(id);
    if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
    const current = await getRecord('retiros', retreatId).catch(() => null);
    if (!current) return sendError(res, 404, 'Retiro nao encontrado.');
    if (current.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: disponivel apenas para consulta.');
    const body = await readBody(req);
    const numeroFicha = Number(body.numeroFicha);
    const enviadoPara = String(body.enviadoPara || '').trim();
    if (!Number.isInteger(numeroFicha) || numeroFicha <= 0) return sendError(res, 400, 'Numero da ficha invalido.');
    if (enviadoPara.length > 160) return sendError(res, 400, 'O campo Enviado para deve ter no maximo 160 caracteres.');
    const links = Array.isArray(current.linksCadastroCursistas) ? current.linksCadastroCursistas : [];
    if (!links.some((link) => Number(link.numeroFicha) === numeroFicha)) return sendError(res, 404, 'Link da ficha nao encontrado.');
    const updatedLinks = links.map((link) => Number(link.numeroFicha) === numeroFicha
      ? { ...link, enviadoPara }
      : link);
    await saveRetreatStudentRegistrationLinks(retreatId, updatedLinks);
    return sendJson(res, 200, { numeroFicha, enviadoPara });
  }

  if (resource === 'cursista-links' && id && action === 'inscricao' && req.method === 'POST') {
    if (denyIfMissingPermission(res, session, 'links-cadastro.editar')) return;
    const retreatId = decodeURIComponent(id);
    if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
    const current = await getRecord('retiros', retreatId).catch(() => null);
    if (!current) return sendError(res, 404, 'Retiro nao encontrado.');
    if (current.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: disponivel apenas para consulta.');
    const body = await readBody(req);
    const numeroFicha = Number(body.numeroFicha);
    if (!Number.isInteger(numeroFicha) || numeroFicha <= 0) return sendError(res, 400, 'Numero da ficha invalido.');
    const inscricaoEncerrada = body.inscricaoEncerrada === true;
    const links = Array.isArray(current.linksCadastroCursistas) ? current.linksCadastroCursistas : [];
    if (!links.some((link) => Number(link.numeroFicha) === numeroFicha)) return sendError(res, 404, 'Link da ficha nao encontrado.');
    const updatedLinks = links.map((link) => Number(link.numeroFicha) === numeroFicha
      ? { ...link, inscricaoEncerrada }
      : link);
    await saveRetreatStudentRegistrationLinks(retreatId, updatedLinks);
    return sendJson(res, 200, { numeroFicha, inscricaoEncerrada });
  }

  if (resource === 'cursista-links' && id && action === 'setor' && req.method === 'POST') {
    if (denyIfMissingPermission(res, session, 'links-cadastro.editar')) return;
    const retreatId = decodeURIComponent(id);
    if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
    const current = await getRecord('retiros', retreatId).catch(() => null);
    if (!current) return sendError(res, 404, 'Retiro nao encontrado.');
    if (current.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: disponivel apenas para consulta.');
    const body = await readBody(req);
    const sectorKey = String(body.setor || '').trim().toLocaleLowerCase('pt-BR');
    const sector = (current.setores || []).find((item) => String(item || '').trim().toLocaleLowerCase('pt-BR') === sectorKey);
    if (!sector) return sendError(res, 404, 'Setor nao encontrado neste retiro.');
    const closedKeys = new Set((current.setoresInscricoesEncerradas || []).map((item) => String(item || '').trim().toLocaleLowerCase('pt-BR')));
    if (body.inscricaoEncerrada === true) closedKeys.add(sectorKey); else closedKeys.delete(sectorKey);
    const setoresInscricoesEncerradas = (current.setores || []).filter((item) => closedKeys.has(String(item || '').trim().toLocaleLowerCase('pt-BR')));
    await saveRetreatClosedRegistrationSectors(retreatId, setoresInscricoesEncerradas);
    return sendJson(res, 200, { setor: sector, inscricaoEncerrada: body.inscricaoEncerrada === true });
  }

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
    try {
      return sendJson(res, 200, await saveAccessUser(incoming, session));
    } catch (error) {
      if (error.statusCode === 403) return sendError(res, 403, error.message);
      throw error;
    }
  }
  if (resource === 'access' && id === 'users' && action && req.method === 'DELETE') {
    if (denyIfMissingPermission(res, session, 'usuarios.excluir')) return;
    try {
      await deleteAccessUser(decodeURIComponent(action), session);
    } catch (error) {
      if (error.statusCode === 403) return sendError(res, 403, error.message);
      throw error;
    }
    return sendNoContent(res);
  }

  if (resource === 'backup') {
    if (!hasGlobalRetreatAccess(session)) return sendError(res, 403, 'Apenas administradores podem acessar backup e restauracao.');
    if (id === 'export' && !action && req.method === 'POST') return sendJson(res, 201, await createSnapshot(session));
    if (id === 'chunks' && action && req.method === 'GET') {
      const url = new URL(req.url || '/', 'https://familiaepcindaial.local');
      return sendJson(res, 200, await listChunks(session, decodeURIComponent(action), Number(url.searchParams.get('offset')) || 0, Number(url.searchParams.get('limit')) || 25));
    }
    if (id === 'restore' && !action && req.method === 'POST') return sendJson(res, 201, await createRestore(session, await readBody(req)));
    if (id === 'restore' && action && req.method === 'POST') {
      await uploadRestoreChunk(session, decodeURIComponent(action), await readBody(req));
      return sendNoContent(res);
    }
    if (id === 'preview' && action && req.method === 'GET') return sendJson(res, 200, await previewRestore(session, decodeURIComponent(action)));
    if (id === 'commit' && action && req.method === 'POST') {
      const operationId = decodeURIComponent(action);
      const result = await commitRestore(session, operationId);
      await cancelOperation(session, operationId).catch(() => null);
      return sendJson(res, 200, { restored: true, warnings: result?.warnings || [] }, { 'Set-Cookie': clearSessionCookie() });
    }
    if ((id === 'cancel' && action && req.method === 'POST') || (id === 'operations' && action && req.method === 'DELETE')) {
      await cancelOperation(session, decodeURIComponent(action));
      return sendNoContent(res);
    }
    return sendError(res, 405, 'Operacao de backup nao permitida.');
  }

  if (resource === 'database' && req.method === 'GET') {
    if (!hasGlobalRetreatAccess(session)) return sendError(res, 403, 'Apenas admin pode acessar o banco completo.');
    if (denyIfMissingPermission(res, session, 'usuarios.ver')) return;
    return sendJson(res, 200, await readDatabase());
  }
  if (resource === 'database' && id === 'import' && req.method === 'POST') {
    if (!hasGlobalRetreatAccess(session)) return sendError(res, 403, 'Apenas admin pode importar o banco completo.');
    if (denyIfMissingPermission(res, session, 'usuarios.editar')) return;
    await importDatabase(await readBody(req));
    return sendNoContent(res);
  }

  if (resource === 'cursista-smp' || resource === 'cursista-epc') {
    const expectedType = resource;
    const permissionPrefix = resource;
    const listCoupleStudents = resource === 'cursista-epc' ? listCursistasEpc : listCursistasSmp;
    const saveCoupleStudent = resource === 'cursista-epc' ? saveCursistaEpc : saveCursistaSmp;
    const deleteCoupleStudent = resource === 'cursista-epc' ? deleteCursistaEpc : deleteCursistaSmp;
    const label = resource === 'cursista-epc' ? 'Cursista EPC' : 'Cursista SMP';
    const url = new URL(req.url || `/api/${resource}`, 'https://familiaepcindaial.local');
    const queryRetreatId = url.searchParams.get('retiroId') || '';
    if (req.method === 'GET' && !id) {
      if (denyIfMissingPermission(res, session, `${permissionPrefix}.ver`)) return;
      if (!hasGlobalRetreatAccess(session) && (!queryRetreatId || !canAccessRetreat(session, queryRetreatId))) return sendError(res, 403, noRetreatAccessMessage);
      const retreat = queryRetreatId ? await getRecord('retiros', queryRetreatId).catch(() => null) : null;
      if (retreat && retreat.tipoFichaCursista !== expectedType) return sendError(res, 409, `O retiro nao esta configurado como ${label}.`);
      return sendJson(res, 200, await listCoupleStudents(queryRetreatId));
    }
    if (req.method === 'PUT' && id && action) {
      const record = { ...(await readBody(req)), retiroId: decodeURIComponent(id), id: decodeURIComponent(action) };
      if (!canAccessRetreat(session, record.retiroId)) return sendError(res, 403, noRetreatAccessMessage);
      const retreat = await getRecord('retiros', record.retiroId).catch(() => null);
      if (!retreat || retreat.tipoFichaCursista !== expectedType) return sendError(res, 409, `O retiro nao esta configurado como ${label}.`);
      const existing = (await listCoupleStudents(record.retiroId)).some((item) => item.id === record.id || item.numeroFichaSmp === record.id);
      if (denyIfMissingPermission(res, session, existing ? `${permissionPrefix}.editar` : `${permissionPrefix}.criar`)) return;
      return sendJson(res, 200, await saveCoupleStudent(record));
    }
    if (req.method === 'DELETE' && id && action) {
      const retreatId = decodeURIComponent(id);
      if (denyIfMissingPermission(res, session, `${permissionPrefix}.excluir`)) return;
      if (!canAccessRetreat(session, retreatId)) return sendError(res, 403, noRetreatAccessMessage);
      const retreat = await getRecord('retiros', retreatId).catch(() => null);
      if (!retreat || retreat.tipoFichaCursista !== expectedType) return sendError(res, 409, `O retiro nao esta configurado como ${label}.`);
      if (retreat.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: disponivel apenas para consulta.');
      const deletingId = decodeURIComponent(action);
      const existing = (await listCoupleStudents(retreatId)).find((item) => (
        String(item.id || '') === String(deletingId)
        || String(item.numeroFichaSmp || '') === String(deletingId)
      ));
      if (!existing) return sendError(res, 404, `${label} nao encontrado.`);
      const canonicalId = String(existing.id || existing.numeroFichaSmp);
      await deleteStudentPhotoAliases(resource === 'cursista-epc' ? 'epc' : 'smp', retreatId, canonicalId, existing.numeroFichaSmp);
      await deleteCoupleStudent(retreatId, canonicalId);
      return sendNoContent(res);
    }
    return sendError(res, 405, `Metodo nao permitido para ${label}.`);
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
  if (!publicRegistrationRequest && !hasGlobalRetreatAccess(session) && resource === 'retiros' && req.method === 'PUT' && !id) return sendError(res, 403, noRetreatAccessMessage);
  if (req.method === 'GET' && !id) {
    if (publicRegistrationRequest && ['pessoas', 'adesoes'].includes(resource) && !listRetreatId) return sendError(res, 400, 'Informe o retiro para esta consulta.');
    return sendJson(res, 200, publicRegistrationRequest
      ? await listRecords(resource, listRetreatId ? { retiroId: listRetreatId } : {})
      : await listAuthorizedRecords(resource, session, listRetreatId ? { retiroId: listRetreatId } : {}));
  }
  if (req.method === 'GET' && id) {
    const record = publicRegistrationRequest ? await getRecord(resource, decodeURIComponent(id)) : await getAuthorizedRecord(resource, decodeURIComponent(id), session);
    if (!record && !publicRegistrationRequest && ['retiros', 'adesoes', 'cursistas', 'casais', 'comunidades', 'crachas', 'pessoas'].includes(resource)) return sendError(res, 403, noRetreatAccessMessage);
    return sendJson(res, 200, publicRegistrationRequest && resource === 'retiros' ? sanitizePublicRetreat(record) : record);
  }

  if (req.method === 'PUT' && id) {
    let record = { ...(requestBody || await readBody(req)), id: decodeURIComponent(id) };
    if (resource === 'retiros' && record.tipoRetiro && !allowedRetreatTypes.has(record.tipoRetiro)) return sendError(res, 400, 'Tipo do retiro invalido.');
    if (!publicRegistrationRequest && resource !== 'pessoas' && await denyIfMissingRetreatAccess(res, session, resource, record)) return;
    if (!publicRegistrationRequest && resource === 'crachas') {
      const retreat = await getRecord('retiros', recordRetreatId(record)).catch(() => null);
      if (!retreat) return sendError(res, 404, 'Retiro nao encontrado.');
      if (retreat.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: configuracoes de cracha disponiveis apenas para consulta.');
    }
    if (financeStoreSet.has(resource)) {
      if (resource === 'financeiro_planilha_auditoria') return sendError(res, 405, 'A auditoria financeira e somente leitura.');
      if (scopedFinanceStores.has(resource)) {
        const retreat = await getRecord('retiros', record.retiroId).catch(() => null);
        if (!retreat) return sendError(res, 404, 'Retiro em foco nao encontrado.');
        if (retreat.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: Financeiro disponivel apenas para consulta.');
      }
      record = await normalizeFinanceRecord(resource, record, session);
    }
    if (denyIfMissingPublicVolunteerTerm(res, resource, record, publicRegistrationRequest)) return;
    if (await denyIfTeamRegistrationClosed(res, resource, record, publicRegistrationRequest)) return;
    if (!publicRegistrationRequest && resource === 'retiros') {
      const current = await getRecord('retiros', record.id).catch(() => null);
      record = withSyncedStudentRegistrationLinks(current, record);
    }
    const protectedRecord = await protectRegistrationWrite(resource, record, req);
    return sendJson(res, 200, await saveRecord(resource, protectedRecord));
  }

  if (req.method === 'DELETE' && id) {
    if (!publicRegistrationRequest && await denyIfMissingRetreatAccess(res, session, resource, decodeURIComponent(id))) return;
    if (resource === 'cursistas') {
      const student = await getRecordStrict('cursistas', decodeURIComponent(id));
      if (!student) return sendError(res, 404, 'Cursista nao encontrado.');
      const retreat = await getRecordStrict('retiros', student.retiroId);
      if (!retreat) return sendError(res, 404, 'Retiro nao encontrado.');
      if (retreat.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: disponivel apenas para consulta.');
      await deleteStudentPhotoAliases('individual', student.retiroId, student.id, student.cpf);
      const deleted = await deleteRecordStrict('cursistas', student.id);
      if (!deleted) return sendError(res, 409, 'A foto foi processada, mas nao foi possivel confirmar a exclusao da ficha. Recarregue e tente novamente.');
      return sendNoContent(res);
    }
    if (financeStoreSet.has(resource)) {
      if (resource === 'financeiro_planilha_auditoria') return sendError(res, 405, 'A auditoria financeira nao pode ser excluida.');
      const recordId = decodeURIComponent(id);
      const current = await getRecord(resource, recordId);
      if (!current) return sendError(res, 404, 'Registro financeiro nao encontrado.');
      if (current.retiroId) {
        const retreat = await getRecord('retiros', current.retiroId).catch(() => null);
        if (retreat?.status === 'concluido') return sendError(res, 409, 'Retiro encerrado: Financeiro disponivel apenas para consulta.');
      }
      const url = new URL(req.url || '/', 'https://familiaepcindaial.local');
      const reason = url.searchParams.get('motivo') || '';
      if (!String(reason || '').trim()) return sendError(res, 400, 'Informe o motivo da exclusao.');
      await saveFinanceAudit({ sheet: current, action: 'exclusao_planilha', reason, data: current, session });
      await deleteRecord(resource, recordId);
      return sendNoContent(res);
    }
    await deleteRecord(resource, decodeURIComponent(id));
    return sendNoContent(res);
  }

  return sendError(res, 405, action ? 'Acao nao permitida.' : 'Metodo nao permitido.');
}

module.exports = { handleApi, sendError };
