const assert = require('assert');

const state = {
  events: [],
  failPhoto: false,
  retreatStatus: 'publicado',
};

const individual = { id: '11111111-1111-4111-8111-111111111111', retiroId: 'retreat-individual', cpf: '12345678901' };
const smp = { id: '21', numeroFichaSmp: '21', retiroId: 'retreat-smp' };
const epc = { id: '31', numeroFichaSmp: '31', retiroId: 'retreat-epc' };

function mockModule(request, exports) {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const retreat = (id, type) => ({ id, tipoFichaCursista: type, status: state.retreatStatus });

mockModule('../databaseAdapter', {
  checkDatabaseConnection: async () => ({ ok: true, database: 'test' }),
  deleteCursistaEpc: async (retreatId, id) => { state.events.push(`ficha:epc:${retreatId}:${id}`); return [epc]; },
  deleteCursistaSmp: async (retreatId, id) => { state.events.push(`ficha:smp:${retreatId}:${id}`); return [smp]; },
  deleteRecord: async () => null,
  deleteRecordStrict: async (storeName, id) => { state.events.push(`ficha:individual:${storeName}:${id}`); return individual; },
  getRecord: async (storeName, id) => {
    if (storeName !== 'retiros') return null;
    if (id === 'retreat-smp') return retreat(id, 'cursista-smp');
    if (id === 'retreat-epc') return retreat(id, 'cursista-epc');
    if (id === 'retreat-individual') return retreat(id, 'cursista-individual');
    return null;
  },
  getRecordStrict: async (storeName, id) => {
    if (storeName === 'cursistas' && id === individual.id) return individual;
    if (storeName === 'retiros' && id === individual.retiroId) return retreat(id, 'cursista-individual');
    return null;
  },
  importDatabase: async () => null,
  listCursistasEpc: async () => [epc],
  listCursistasSmp: async () => [smp],
  listRecords: async () => [],
  readDatabase: async () => ({}),
  saveCursistaEpc: async (record) => record,
  saveCursistaSmp: async (record) => record,
  saveRecord: async (storeName, record) => record,
  saveRetreatClosedRegistrationSectors: async () => null,
  saveRetreatStudentRegistrationLinks: async () => null,
});

mockModule('../studentPhotoService', {
  activePhoto: async () => null,
  createPublicPhotoTicket: () => '',
  deleteStudentPhotos: async (type, retreatId, recordId) => {
    state.events.push(`foto:${type}:${retreatId}:${recordId}`);
    if (state.failPhoto) throw new Error('storage unavailable');
    return { deleted: 1, objectsDeleted: 1 };
  },
  downloadPhoto: async () => null,
  findStudent: async () => null,
  findStudentByFile: async () => null,
  readRawImage: async () => Buffer.alloc(0),
  savePhoto: async () => null,
  verifyPublicPhotoTicket: () => ({}),
});

mockModule('../auth', {
  authStatus: () => ({ configured: true }),
  changeOwnPassword: async () => null,
  clearSessionCookie: () => '',
  createSession: () => '',
  deleteAccessUser: async () => null,
  hydrateUser: (user) => user,
  listAccessData: async () => ({}),
  readSession: () => ({ id: 'env:test-admin', role: 'admin', perfilCodigo: 'admin', permissions: [] }),
  saveAccessUser: async () => null,
  sessionCookie: () => '',
  validateLogin: async () => null,
});

mockModule('../permissions', { can: () => true });
mockModule('../backupService', {
  cancelOperation: async () => null,
  commitRestore: async () => null,
  createRestore: async () => null,
  createSnapshot: async () => null,
  isMaintenanceActive: async () => false,
  listChunks: async () => [],
  previewRestore: async () => null,
  uploadRestoreChunk: async () => null,
});
mockModule('../publicStudentLinks', {
  prepareStudentRegistrationLinkSync: async () => ({}),
  resolvePublicStudentLink: async () => null,
  sanitizePublicRetreat: (value) => value,
  savePublicStudentRegistration: async () => null,
  studentRegistrationLinkStatus: () => ({}),
  withSyncedStudentRegistrationLinks: (current, next) => next || current,
});

const { handleApi } = require('../apiCore');

const request = (url) => ({ method: 'DELETE', url, headers: {} });
const response = () => ({
  status: 0,
  body: '',
  writeHead(status) { this.status = status; },
  end(body = '') { this.body = String(body || ''); },
});

const scenarios = [
  { type: 'individual', path: `/api/cursistas/${individual.id}`, fichaEvent: 'ficha:individual:' },
  { type: 'smp', path: `/api/cursista-smp/${smp.retiroId}/${smp.id}`, fichaEvent: 'ficha:smp:' },
  { type: 'epc', path: `/api/cursista-epc/${epc.retiroId}/${epc.id}`, fichaEvent: 'ficha:epc:' },
];

async function main() {
  for (const scenario of scenarios) {
    state.events = [];
    state.failPhoto = true;
    state.retreatStatus = 'publicado';
    await assert.rejects(handleApi(request(scenario.path), response(), scenario.path), /storage unavailable/);
    assert(!state.events.some((event) => event.startsWith(scenario.fichaEvent)), `${scenario.type}: falha da foto nao pode excluir a ficha.`);

    state.events = [];
    state.failPhoto = false;
    const res = response();
    await handleApi(request(scenario.path), res, scenario.path);
    assert.equal(res.status, 204, `${scenario.type}: exclusao confirmada deve retornar 204.`);
    const fichaIndex = state.events.findIndex((event) => event.startsWith(scenario.fichaEvent));
    assert(fichaIndex > 0, `${scenario.type}: a ficha deve ser excluida depois das fotos.`);
    assert(state.events.slice(0, fichaIndex).every((event) => event.startsWith('foto:')), `${scenario.type}: nenhuma exclusao de ficha pode anteceder as fotos.`);

    state.events = [];
    state.retreatStatus = 'concluido';
    const concludedResponse = response();
    await handleApi(request(scenario.path), concludedResponse, scenario.path);
    assert.equal(concludedResponse.status, 409, `${scenario.type}: retiro concluido deve ser somente leitura.`);
    assert(!state.events.some((event) => event.startsWith('foto:') || event.startsWith(scenario.fichaEvent)));
  }

  console.log('API de exclusao: falhas preservam as fichas e a ordem foto -> cadastro foi validada nos tres tipos.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
