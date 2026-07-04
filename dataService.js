const DATABASE = 'epc-retiros';
const VERSION = 4;
const stores = ['retiros', 'pessoas', 'adesoes', 'casais', 'cursistas', 'comunidades', 'crachas'];

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
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
  });
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
    await api('/health');
    backend = 'file';
    await migrateIndexedDbToFile();
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
  const nextRecord = { ...record, id: record.id || crypto.randomUUID() };
  return (await ensureBackend()) === 'file'
    ? api(`/${storeName}/${encodeURIComponent(nextRecord.id)}`, { method: 'PUT', body: JSON.stringify(nextRecord) })
    : legacyStore.save(storeName, nextRecord);
}

async function remove(storeName, id) {
  return (await ensureBackend()) === 'file'
    ? api(`/${storeName}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    : legacyStore.delete(storeName, id);
}

export const retreatDefaults = {
  setores: ['Animação', 'Camareiros(as)', 'Casal Bem-estar', 'Coordenação do retiro', 'Coordenação geral', 'Cozinha', 'Data Show', 'Enfermaria', 'Espaço Kids', 'Espiritual', 'Externo', 'Folclore', 'Jovem de sala', 'Ligação', 'Recreação', 'Refeitório', 'Secretaria', 'Zeladoria'],
  dias: ['Sexta-feira', 'Sábado', 'Domingo'],
  contribuicoes: ['R$ 60,00 se o voluntário for o único da família', 'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro'],
};

export const dataService = {
  getSession: () => api('/auth/session'),
  login: (username, password) => api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => api('/auth/logout', { method: 'POST' }),
  listRetiros: () => list('retiros'),
  getRetiro: (id) => get('retiros', id),
  saveRetiro: (retreat) => save('retiros', retreat),
  deleteRetiro: (id) => remove('retiros', id),
  listAdesoes: () => list('adesoes'),
  saveAdesao: (enrolment) => save('adesoes', enrolment),
  deleteAdesao: (id) => remove('adesoes', id),
  listPessoas: () => list('pessoas'),
  savePessoa: (person) => save('pessoas', person),
  deletePessoa: (id) => remove('pessoas', id),
  listCursistas: () => list('cursistas'),
  saveCursista: (student) => save('cursistas', student),
  deleteCursista: (id) => remove('cursistas', id),
  listComunidades: () => list('comunidades'),
  saveComunidade: (community) => save('comunidades', community),
  deleteComunidade: (id) => remove('comunidades', id),
  listCrachas: () => list('crachas'),
  saveCracha: (badgeProfile) => save('crachas', badgeProfile),
  deleteCracha: (id) => remove('crachas', id),
  findPessoa: async (nome, nascimento) => {
    const people = await list('pessoas');
    const normalized = nome.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
    return people.find((person) => person.nomeNormalizado === normalized && person.nascimento === nascimento);
  },
};
