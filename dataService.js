const DATABASE = 'familiaepcindaial';
const VERSION = 5;
const stores = ['retiros', 'pessoas', 'adesoes', 'casais', 'cursistas', 'comunidades', 'crachas', 'configuracoes', 'usuarios', 'perfis', 'permissoes', 'perfil_permissoes', 'usuario_permissoes', 'usuario_retiros'];

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
  get: (storeName, id) => indexedRequest(storeName, 'readonly', (store) => store.get(id)),
  save: (storeName, record) => indexedRequest(storeName, 'readwrite', (store) => store.put(record)),
  delete: (storeName, id) => indexedRequest(storeName, 'readwrite', (store) => store.delete(id)),
};

let backend = null;
let migrationPromise = null;

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

async function ensureBackend() {
  if (backend) return backend;
  try {
    const health = await api('/health', { timeoutMs: 5000 });
    if (!health.ok) throw new Error(health.error || 'Backend indisponivel.');
    backend = 'file';
    await migrateIndexedDbToFile().catch(() => null);
  } catch {
    backend = 'indexeddb';
  }
  return backend;
}

async function migrateIndexedDbToFile() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const database = await api('/database');
    const fileHasData = stores.some((storeName) => database[storeName]?.length);
    if (fileHasData || localStorage.getItem('epc-file-db-migrated') === '1') return;

    const legacyData = Object.fromEntries(await Promise.all(stores.map(async (storeName) => [storeName, await legacyStore.list(storeName)])));
    const legacyHasData = stores.some((storeName) => legacyData[storeName]?.length);
    if (!legacyHasData) return;

    await api('/database/import', { method: 'POST', body: JSON.stringify(legacyData) });
    localStorage.setItem('epc-file-db-migrated', '1');
  })();
  return migrationPromise;
}

async function list(storeName) {
  return (await ensureBackend()) === 'file' ? api(`/${storeName}`) : legacyStore.list(storeName);
}

async function get(storeName, id) {
  return (await ensureBackend()) === 'file' ? api(`/${storeName}/${encodeURIComponent(id)}`) : legacyStore.get(storeName, id);
}

async function save(storeName, record) {
  const nextRecord = { ...record, id: record.id || createId() };
  return (await ensureBackend()) === 'file'
    ? api(`/${storeName}/${encodeURIComponent(nextRecord.id)}`, { method: 'PUT', body: JSON.stringify(nextRecord) })
    : legacyStore.save(storeName, nextRecord);
}

async function remove(storeName, id) {
  return (await ensureBackend()) === 'file'
    ? api(`/${storeName}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    : legacyStore.delete(storeName, id);
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
  if (allowDataLoss || userSubmittedRegistration) return save(storeName, nextRecord);
  const fields = current ? protectedDataLossFields(current, nextRecord) : [];
  if (fields.length) {
    throw new Error(`Salvamento bloqueado para proteger dados ja cadastrados em ${storeName}. Campos em risco: ${fields.join(', ')}. Se a alteracao for intencional, faca backup, audite o impacto e use autorizacao explicita no codigo.`);
  }
  return save(storeName, nextRecord);
}

export const retreatDefaults = {
  setores: ['Animação/Jovem de sala', 'Camareiros(as)', 'Casal Bem-estar', 'Coordenação do retiro', 'Coordenação geral', 'Cozinha', 'Data Show', 'Direção Espiritual', 'Enfermaria', 'Espaço Kids', 'Espiritual', 'Externo', 'Folclore', 'Ligação', 'Participações especiais', 'Pegue e Pague', 'Recebedor(es)', 'Recreação', 'Refeitório', 'Secretaria', 'Zeladoria'],
  dias: ['Sexta-feira', 'Sábado', 'Domingo'],
  contribuicoes: ['R$ 60,00 se o voluntário for o único da família', 'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro'],
};

export const dataService = {
  getSession: () => api('/auth/session'),
  login: (username, password) => api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  changePassword: (currentPassword, newPassword) => api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  getAccessData: () => api('/access'),
  saveAccessUser: (user) => api('/access/users', { method: 'POST', body: JSON.stringify(user) }),
  deleteAccessUser: (id) => api(`/access/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listRetiros: () => list('retiros'),
  getRetiro: (id) => get('retiros', id),
  saveRetiro: (retreat) => save('retiros', retreat),
  deleteRetiro: (id) => remove('retiros', id),
  listAdesoes: () => list('adesoes'),
  saveAdesao: (enrolment) => saveProtectedRegistration('adesoes', enrolment),
  deleteAdesao: (id) => remove('adesoes', id),
  listPessoas: () => list('pessoas'),
  savePessoa: (person) => save('pessoas', person),
  deletePessoa: (id) => remove('pessoas', id),
  listCursistas: () => list('cursistas'),
  saveCursista: (student) => saveProtectedRegistration('cursistas', student),
  deleteCursista: (id) => remove('cursistas', id),
  listComunidades: () => list('comunidades'),
  saveComunidade: (community) => save('comunidades', community),
  deleteComunidade: (id) => remove('comunidades', id),
  listCrachas: () => list('crachas'),
  saveCracha: (badgeProfile) => save('crachas', badgeProfile),
  deleteCracha: (id) => remove('crachas', id),
  getConfiguracao: (id) => get('configuracoes', id),
  saveConfiguracao: (setting) => save('configuracoes', setting),
  findPessoa: async (nome, nascimento) => {
    const people = await list('pessoas');
    const normalized = nome.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
    return people.find((person) => person.nomeNormalizado === normalized && person.nascimento === nascimento);
  },
};
