const DATABASE = 'familiaepcindaial';
const VERSION = 8;
const stores = ['retiros', 'pessoas', 'adesoes', 'casais', 'cursistas', 'comunidades', 'crachas', 'configuracoes', 'usuarios', 'perfis', 'permissoes', 'perfil_permissoes', 'usuario_permissoes', 'usuario_retiros', 'financeiro_planilhas', 'financeiro_planilha_auditoria'];

const randomBytes = (length) => {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  return bytes;
};
const createId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      stores.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function indexedRequest(storeName, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const result = action(transaction.objectStore(storeName));
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
    transaction.oncomplete = () => db.close();
  });
}

const legacyStore = {
  list: (storeName) => indexedRequest(storeName, 'readonly', (store) => store.getAll()),
};

let backend = null;
let backendPromise = null;
let legacyLocalDataStatusPromise = null;

const supabaseRequiredMessage = 'Nao foi possivel conectar ao Supabase. A operacao foi cancelada e nenhum dado foi salvo localmente.';

async function api(path, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const publicReceiverToken = globalThis.EPC_PUBLIC_RECEIVER?.token || new URLSearchParams(globalThis.location?.search || '').get('recebedorToken') || globalThis.location?.pathname?.match(/^\/recebedor\/([^/?#]+)/)?.[1] || '';
  let response;
  try {
    response = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json', ...(publicReceiverToken ? { 'X-Public-Receiver-Token': decodeURIComponent(publicReceiverToken) } : {}), ...(options.headers || {}) },
      credentials: 'same-origin',
      ...options,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Tempo esgotado ao acessar o servidor.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Falha ao acessar o banco (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function apiBlob(path, options = {}) {
  const timeoutMs = options.timeoutMs || 120000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin',
      ...options,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Tempo esgotado ao gerar o arquivo.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Falha ao gerar o arquivo (${response.status})`);
  }
  return response.blob();
}

async function ensureBackend() {
  if (backend) return backend;
  if (!backendPromise) {
    backendPromise = (async () => {
      try {
        const health = await api('/health', { timeoutMs: 10000 });
        if (!health.ok || health.database !== 'supabase-relational') {
          throw new Error(health.error || `Banco inesperado: ${health.database || 'nao informado'}.`);
        }
        backend = 'supabase';
        inspectLegacyLocalData().then((status) => {
          if (!status.total) return;
          console.warn('Foram encontrados registros legados apenas neste navegador. Eles foram preservados e nao serao usados nem enviados automaticamente.', status.counts);
          globalThis.dispatchEvent?.(new CustomEvent('epc-legacy-local-data-detected', { detail: status }));
        }).catch(() => null);
        return backend;
      } catch (error) {
        throw new Error(`${supabaseRequiredMessage} ${error.message || ''}`.trim());
      }
    })();
  }
  try {
    return await backendPromise;
  } finally {
    if (!backend) backendPromise = null;
  }
}

async function inspectLegacyLocalData() {
  if (legacyLocalDataStatusPromise) return legacyLocalDataStatusPromise;
  legacyLocalDataStatusPromise = (async () => {
    if (!globalThis.indexedDB || typeof globalThis.indexedDB.databases !== 'function') {
      return { checked: false, total: 0, counts: {} };
    }
    const databases = await globalThis.indexedDB.databases();
    if (!databases.some((database) => database.name === DATABASE)) return { checked: true, total: 0, counts: {} };
    const entries = await Promise.all(stores.map(async (storeName) => {
      const rows = await legacyStore.list(storeName).catch(() => []);
      return [storeName, Array.isArray(rows) ? rows.length : 0];
    }));
    const counts = Object.fromEntries(entries.filter(([, count]) => count > 0));
    return { checked: true, total: Object.values(counts).reduce((sum, count) => sum + count, 0), counts };
  })();
  return legacyLocalDataStatusPromise;
}

async function list(storeName, options = {}) {
  await ensureBackend();
  const params = new URLSearchParams();
  if (options.retiroId) params.set('retiroId', options.retiroId);
  ['cpf', 'numeroFicha', 'nomeNormalizado', 'nascimento', 'setorChave'].forEach((key) => {
    if (options[key]) params.set(key, options[key]);
  });
  const query = params.toString();
  return api(`/${storeName}${query ? `?${query}` : ''}`);
}

async function get(storeName, id) {
  await ensureBackend();
  return api(`/${storeName}/${encodeURIComponent(id)}`);
}

async function save(storeName, record) {
  const nextRecord = { ...record, id: record.id || createId() };
  await ensureBackend();
  return api(`/${storeName}/${encodeURIComponent(nextRecord.id)}`, { method: 'PUT', body: JSON.stringify(nextRecord) });
}

async function saveWithTransientControl(storeName, record, control = {}) {
  const nextRecord = { ...record, id: record.id || createId() };
  await ensureBackend();
  return api(`/${storeName}/${encodeURIComponent(nextRecord.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...nextRecord, ...control }),
  });
}

async function remove(storeName, id) {
  await ensureBackend();
  return api(`/${storeName}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
async function removeWithReason(storeName, id, reason = '') {
  await ensureBackend();
  return api(`/${storeName}/${encodeURIComponent(id)}?motivo=${encodeURIComponent(reason)}`, { method: 'DELETE' });
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
const preserveExistingRegistrationFields = ['dias', 'setores', 'retirosAnteriores'];
const preserveExistingRegistrationData = (current = {}, next = {}) => {
  preserveExistingRegistrationFields.forEach((field) => {
    if (field === 'retirosAnteriores' && next.dispensaRetirosAnteriores === true) return;
    if (!isEmptyProtectedValue(current[field]) && isEmptyProtectedValue(next[field])) {
      next[field] = current[field];
    }
  });
  return next;
};

async function saveProtectedRegistration(storeName, record) {
  const nextRecord = { ...record };
  const allowDataLoss = nextRecord[dataLossBypassField] === true;
  const userSubmittedRegistration = nextRecord[userSubmittedRegistrationField] === true;
  delete nextRecord[dataLossBypassField];
  delete nextRecord[userSubmittedRegistrationField];
  if (!protectedRegistrationStores.has(storeName) || !nextRecord.id) return save(storeName, nextRecord);
  const current = await get(storeName, nextRecord.id).catch(() => null);
  if (current) preserveExistingRegistrationData(current, nextRecord);
  if (allowDataLoss) return saveWithTransientControl(storeName, nextRecord, { [dataLossBypassField]: true });
  if (userSubmittedRegistration) return save(storeName, nextRecord);
  const fields = current ? protectedDataLossFields(current, nextRecord) : [];
  if (fields.length) {
    throw new Error(`Salvamento bloqueado para proteger dados ja cadastrados em ${storeName}. Campos em risco: ${fields.join(', ')}. Se a alteracao for intencional, faca backup, audite o impacto e use autorizacao explicita no codigo.`);
  }
  return save(storeName, nextRecord);
}

async function saveStudentRegistration(record) {
  const nextRecord = { ...record, id: record.id || createId() };
  return saveProtectedRegistration('cursistas', nextRecord);
}

export const retreatDefaults = {
  setores: ['Animação/Jovem de sala', 'Camareiros(as)', 'Casal Bem-estar', 'Coordenação do retiro', 'Coordenação geral', 'Cozinha', 'Data Show', 'Direção Espiritual', 'Enfermaria', 'Espaço Kids', 'Espiritual', 'Externo', 'Folclore', 'Ligação', 'Monitor(es)', 'Participações especiais', 'Pegue e Pague', 'Recebedor(es)', 'Recreação', 'Refeitório', 'Secretaria', 'Sineteira(s)', 'Zeladoria'],
  dias: ['Sexta-feira', 'Sábado', 'Domingo'],
  contribuicoes: ['R$ 60,00 se o voluntário for o único da família', 'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro'],
};

export const dataService = {
  inspectLegacyLocalData,
  getSession: async () => { await ensureBackend(); return api('/auth/session'); },
  login: async (username, password) => { await ensureBackend(); return api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); },
  changePassword: (currentPassword, newPassword) => api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  getAccessData: () => api('/access'),
  saveAccessUser: (user) => api('/access/users', { method: 'POST', body: JSON.stringify(user) }),
  deleteAccessUser: (id) => api(`/access/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  startBackupExport: () => api('/backup/export', { method: 'POST', timeoutMs: 120000 }),
  listBackupChunks: (operationId, offset = 0, limit = 25) => api(`/backup/chunks/${encodeURIComponent(operationId)}?offset=${offset}&limit=${limit}`, { timeoutMs: 120000 }),
  startBackupRestore: (envelope) => api('/backup/restore', { method: 'POST', body: JSON.stringify(envelope), timeoutMs: 120000 }),
  uploadBackupChunk: (operationId, chunk) => api(`/backup/restore/${encodeURIComponent(operationId)}`, { method: 'POST', body: JSON.stringify(chunk), timeoutMs: 120000 }),
  previewBackupRestore: (operationId) => api(`/backup/preview/${encodeURIComponent(operationId)}`, { timeoutMs: 120000 }),
  commitBackupRestore: (operationId) => api(`/backup/commit/${encodeURIComponent(operationId)}`, { method: 'POST', body: '{}', timeoutMs: 120000 }),
  cancelBackupOperation: (operationId) => api(`/backup/cancel/${encodeURIComponent(operationId)}`, { method: 'POST', body: '{}', timeoutMs: 30000 }),
  listRetiros: () => list('retiros'),
  getRetiro: (id) => get('retiros', id),
  saveRetiro: (retreat) => save('retiros', retreat),
  syncStudentRegistrationLinks: (retreatId) => api(`/cursista-links/${encodeURIComponent(retreatId)}/sync`, { method: 'POST', body: '{}' }),
  saveStudentRegistrationLinkRecipient: (retreatId, numeroFicha, enviadoPara) => api(`/cursista-links/${encodeURIComponent(retreatId)}/destinatario`, { method: 'POST', body: JSON.stringify({ numeroFicha, enviadoPara }) }),
  setStudentRegistrationLinkClosed: (retreatId, numeroFicha, inscricaoEncerrada) => api(`/cursista-links/${encodeURIComponent(retreatId)}/inscricao`, { method: 'POST', body: JSON.stringify({ numeroFicha, inscricaoEncerrada }) }),
  setSectorRegistrationLinkClosed: (retreatId, setor, inscricaoEncerrada) => api(`/cursista-links/${encodeURIComponent(retreatId)}/setor`, { method: 'POST', body: JSON.stringify({ setor, inscricaoEncerrada }) }),
  deleteRetiro: (id) => remove('retiros', id),
  listAdesoes: (retiroId = '') => list('adesoes', { retiroId }),
  listAdesoesPorCpf: (retiroId = '', cpf = '') => list('adesoes', { retiroId, cpf }),
  saveAdesao: (enrolment) => saveProtectedRegistration('adesoes', enrolment),
  saveTeamCouple: (payload) => api('/adesoes-casal', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 120000 }),
  deleteAdesao: (id) => remove('adesoes', id),
  listPessoas: (retiroId = '') => list('pessoas', { retiroId }),
  getPessoa: (id) => get('pessoas', id),
  savePessoa: (person) => save('pessoas', person),
  deletePessoa: (id) => remove('pessoas', id),
  listCursistas: (retiroId = '') => list('cursistas', { retiroId }),
  listCursistasPorCpf: (retiroId = '', cpf = '') => list('cursistas', { retiroId, cpf }),
  listCursistasPorFicha: (retiroId = '', numeroFicha = '') => list('cursistas', { retiroId, numeroFicha }),
  getCursista: (id) => get('cursistas', id),
  saveCursista: (student) => saveStudentRegistration(student),
  // A exclusao passa pelo servidor para remover a foto privada antes da ficha.
  deleteCursista: (id) => api(`/cursistas/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 120000 }),
  listCursistasSmp: (retiroId = '') => api(`/cursista-smp${retiroId ? `?retiroId=${encodeURIComponent(retiroId)}` : ''}`),
  saveCursistaSmp: (student) => {
    const retiroId = student.retiroId || '';
    const numeroFicha = student.id || student.numeroFichaSmp || '';
    return api(`/cursista-smp/${encodeURIComponent(retiroId)}/${encodeURIComponent(numeroFicha)}`, { method: 'PUT', body: JSON.stringify(student) });
  },
  deleteCursistaSmp: (retiroId, numeroFicha) => api(`/cursista-smp/${encodeURIComponent(retiroId)}/${encodeURIComponent(numeroFicha)}`, { method: 'DELETE', timeoutMs: 120000 }),
  listCursistasEpc: (retiroId = '') => api(`/cursista-epc${retiroId ? `?retiroId=${encodeURIComponent(retiroId)}` : ''}`),
  saveCursistaEpc: (student) => {
    const retiroId = student.retiroId || '';
    const numeroFicha = student.id || student.numeroFichaSmp || '';
    return api(`/cursista-epc/${encodeURIComponent(retiroId)}/${encodeURIComponent(numeroFicha)}`, { method: 'PUT', body: JSON.stringify(student) });
  },
  deleteCursistaEpc: (retiroId, numeroFicha) => api(`/cursista-epc/${encodeURIComponent(retiroId)}/${encodeURIComponent(numeroFicha)}`, { method: 'DELETE', timeoutMs: 120000 }),
  listComunidades: (retiroId = '') => list('comunidades', { retiroId }),
  saveComunidade: (community) => save('comunidades', community),
  saveComunidadeMembros: async (community, membershipType, memberIds = []) => {
    const memberField = membershipType === 'smp' ? 'membroSmpIds' : (membershipType === 'epc' ? 'membroEpcIds' : 'membroIds');
    const nextCommunity = { ...community, [memberField]: [...new Set(memberIds)] };
    await ensureBackend();
    return api(`/comunidades/${encodeURIComponent(nextCommunity.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...nextCommunity, __membershipType: membershipType }),
    });
  },
  moveComunidadeMembro: ({ retreatId, targetCommunityId, membershipType, studentId }) => api('/comunidades-mover-membro', {
    method: 'POST',
    body: JSON.stringify({ retreatId, targetCommunityId, membershipType, studentId }),
  }),
  deleteComunidade: (id) => remove('comunidades', id),
  listCrachas: (retiroId = '') => list('crachas', { retiroId }),
  saveCracha: (badgeProfile) => save('crachas', badgeProfile),
  deleteCracha: (id) => remove('crachas', id),
  getConfiguracao: (id) => get('configuracoes', id),
  saveConfiguracao: (setting) => save('configuracoes', setting),
  listFinanceSheets: (retiroId = '') => list('financeiro_planilhas', { retiroId }),
  saveFinanceSheet: (record) => save('financeiro_planilhas', record),
  deleteFinanceSheet: (id, reason = '') => removeWithReason('financeiro_planilhas', id, reason),
  listFinanceAudit: () => list('financeiro_planilha_auditoria'),
  findPessoa: async (nome, nascimento) => {
    const normalized = nome.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
    const people = await list('pessoas', { nomeNormalizado: normalized, nascimento });
    return people.find((person) => person.nomeNormalizado === normalized && person.nascimento === nascimento);
  },
};
