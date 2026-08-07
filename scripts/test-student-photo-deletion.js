const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.SUPABASE_URL = 'https://student-photo-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'student-photo-test-service-key';
process.env.NODE_ENV = 'development';

const { deleteStudentPhotos } = require('../studentPhotoService');
const { deleteRecordStrict, getRecordStrict } = require('../databaseAdapter');

const response = (status, body = null) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    if (body === undefined) throw new Error('Resposta sem JSON.');
    return body;
  },
  async text() {
    if (typeof body === 'string') return body;
    return body === undefined ? '' : JSON.stringify(body);
  },
});

const equalFilter = (url, name) => {
  const value = url.searchParams.get(name) || '';
  return value.startsWith('eq.') ? value.slice(3) : '';
};

function createHarness({
  metadata = [],
  storage = [],
  ignoreStorageDelete = false,
  failStorageDelete = false,
  failStorageList = false,
  failMetadataDelete = false,
  ignoreMetadataDelete = false,
  lateStoragePath = '',
} = {}) {
  const state = {
    metadata: metadata.map((row) => ({ ...row })),
    storage: new Set(storage),
    calls: [],
    events: [],
  };

  const fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    state.calls.push({ method, pathname: url.pathname, search: url.search, body });

    if (url.pathname === '/rest/v1/cursista_fotos') {
      if (method === 'GET') {
        state.events.push('metadata-list');
        const retreatId = equalFilter(url, 'retiro_id');
        const type = equalFilter(url, 'tipo');
        const recordId = equalFilter(url, 'registro_id');
        const offset = Number(url.searchParams.get('offset')) || 0;
        const limit = Number(url.searchParams.get('limit')) || Number.MAX_SAFE_INTEGER;
        return response(200, state.metadata
          .filter((row) => row.retiro_id === retreatId && row.tipo === type && row.registro_id === recordId)
          .slice(offset, offset + limit)
          .map(({ id, storage_path }) => ({ id, storage_path })));
      }
      if (method === 'DELETE') {
        state.events.push('metadata-delete');
        if (failMetadataDelete) return response(500, { message: 'metadata delete failed' });
        if (!ignoreMetadataDelete) {
          const id = equalFilter(url, 'id');
          if (id) state.metadata = state.metadata.filter((row) => row.id !== id);
          else {
            const retreatId = equalFilter(url, 'retiro_id');
            const type = equalFilter(url, 'tipo');
            const recordId = equalFilter(url, 'registro_id');
            state.metadata = state.metadata.filter((row) => row.retiro_id !== retreatId || row.tipo !== type || row.registro_id !== recordId);
          }
        }
        if (lateStoragePath) state.storage.add(lateStoragePath);
        return response(204);
      }
    }

    if (url.pathname === '/storage/v1/object/list/cursista-fotos' && method === 'POST') {
      state.events.push('storage-list');
      if (failStorageList) return response(500, { message: 'list failed' });
      const prefix = String(body.prefix || '').replace(/\/$/, '');
      const offset = Number(body.offset) || 0;
      const limit = Number(body.limit) || 100;
      const entries = [...state.storage]
        .filter((storagePath) => storagePath.startsWith(`${prefix}/`))
        .sort()
        .slice(offset, offset + limit)
        .map((storagePath, index) => ({ id: `object-${offset + index}`, name: storagePath.slice(prefix.length + 1) }));
      return response(200, entries);
    }

    if (url.pathname === '/storage/v1/object/cursista-fotos' && method === 'DELETE') {
      state.events.push('storage-delete');
      if (failStorageDelete) return response(500, { message: 'delete failed' });
      if (!ignoreStorageDelete) (body.prefixes || []).forEach((storagePath) => state.storage.delete(storagePath));
      return response(200, []);
    }

    return response(500, { message: `Unexpected request: ${method} ${url.pathname}${url.search}` });
  };

  return { fetch, state };
}

async function testThreeStudentTypes() {
  for (const type of ['individual', 'smp', 'epc']) {
    const directory = `retreat-1/${type}/student-1`;
    const version1 = `${directory}/version-1.jpg`;
    const version2 = `${directory}/version-2.jpg`;
    const orphan = `${directory}/without-metadata.jpg`;
    const neighbour = `retreat-1/${type}/student-10/keep.jpg`;
    const otherType = `retreat-1/${type === 'individual' ? 'smp' : 'individual'}/student-1/keep.jpg`;
    const harness = createHarness({
      metadata: [
        { id: `${type}-1`, retiro_id: 'retreat-1', tipo: type, registro_id: 'student-1', storage_path: version1, ativo: false },
        { id: `${type}-2`, retiro_id: 'retreat-1', tipo: type, registro_id: 'student-1', storage_path: version2, ativo: true },
        { id: `${type}-neighbour`, retiro_id: 'retreat-1', tipo: type, registro_id: 'student-10', storage_path: neighbour, ativo: true },
      ],
      storage: [version1, version2, orphan, neighbour, otherType],
    });
    global.fetch = harness.fetch;

    const result = await deleteStudentPhotos(type, 'retreat-1', 'student-1');

    assert.deepEqual(result, { deleted: 2, objectsDeleted: 3 }, `${type}: deve excluir versoes e objeto sem metadado.`);
    assert.deepEqual([...harness.state.storage].sort(), [neighbour, otherType].sort(), `${type}: nao pode tocar outra ficha ou modalidade.`);
    assert.deepEqual(harness.state.metadata.map((row) => row.id), [`${type}-neighbour`], `${type}: deve manter metadado de outra ficha.`);
    assert(harness.state.events.indexOf('storage-delete') < harness.state.events.indexOf('metadata-delete'), `${type}: Storage deve ser apagado antes dos metadados.`);
    assert(harness.state.events.slice(0, harness.state.events.indexOf('metadata-delete')).filter((event) => event === 'storage-list').length >= 2, `${type}: a remocao do Storage deve ser confirmada antes dos metadados.`);
    assert(harness.state.events.lastIndexOf('storage-list') > harness.state.events.indexOf('metadata-delete'), `${type}: o Storage deve ser conferido novamente contra upload concorrente.`);
  }
}

async function testUnconfirmedDeletionBlocksMetadata() {
  const pathName = 'retreat-1/individual/student-1/photo.jpg';
  const harness = createHarness({
    metadata: [{ id: 'photo-1', retiro_id: 'retreat-1', tipo: 'individual', registro_id: 'student-1', storage_path: pathName }],
    storage: [pathName],
    ignoreStorageDelete: true,
  });
  global.fetch = harness.fetch;
  await assert.rejects(deleteStudentPhotos('individual', 'retreat-1', 'student-1'), /ficha foi preservada/i);
  assert(harness.state.storage.has(pathName));
  assert.equal(harness.state.metadata.length, 1);
  assert(!harness.state.events.includes('metadata-delete'));
}

async function testStorageFailuresBlockMetadata() {
  const pathName = 'retreat-1/smp/student-1/photo.jpg';
  const harness = createHarness({
    metadata: [{ id: 'photo-1', retiro_id: 'retreat-1', tipo: 'smp', registro_id: 'student-1', storage_path: pathName }],
    storage: [pathName],
    failStorageDelete: true,
  });
  global.fetch = harness.fetch;
  await assert.rejects(deleteStudentPhotos('smp', 'retreat-1', 'student-1'), /Storage 500/i);
  assert.equal(harness.state.metadata.length, 1);
  assert(!harness.state.events.includes('metadata-delete'));
}

async function testStorageListFailureBlocksMetadata() {
  const pathName = 'retreat-1/epc/student-1/photo.jpg';
  const harness = createHarness({
    metadata: [{ id: 'photo-1', retiro_id: 'retreat-1', tipo: 'epc', registro_id: 'student-1', storage_path: pathName }],
    storage: [pathName],
    failStorageList: true,
  });
  global.fetch = harness.fetch;
  await assert.rejects(deleteStudentPhotos('epc', 'retreat-1', 'student-1'), /Storage 500/i);
  assert(harness.state.storage.has(pathName));
  assert.equal(harness.state.metadata.length, 1);
  assert(!harness.state.events.includes('storage-delete'));
  assert(!harness.state.events.includes('metadata-delete'));
}

async function testMetadataFailureCanBeRetried() {
  const pathName = 'retreat-1/individual/student-retry/photo.jpg';
  const firstAttempt = createHarness({
    metadata: [{ id: 'photo-1', retiro_id: 'retreat-1', tipo: 'individual', registro_id: 'student-retry', storage_path: pathName }],
    storage: [pathName],
    failMetadataDelete: true,
  });
  global.fetch = firstAttempt.fetch;
  await assert.rejects(deleteStudentPhotos('individual', 'retreat-1', 'student-retry'), /metadata delete failed/i);
  assert.equal(firstAttempt.state.storage.size, 0, 'O objeto confirmado como removido nao deve reaparecer.');
  assert.equal(firstAttempt.state.metadata.length, 1, 'Falha relacional deve manter o metadado para nova tentativa.');

  const retry = createHarness({ metadata: firstAttempt.state.metadata, storage: [...firstAttempt.state.storage] });
  global.fetch = retry.fetch;
  const result = await deleteStudentPhotos('individual', 'retreat-1', 'student-retry');
  assert.deepEqual(result, { deleted: 1, objectsDeleted: 1 });
  assert.equal(retry.state.metadata.length, 0);
  assert.equal(retry.state.storage.size, 0);
}

async function testUnconfirmedMetadataDeletionBlocksStudent() {
  const pathName = 'retreat-1/smp/student-metadata/photo.jpg';
  const harness = createHarness({
    metadata: [{ id: 'photo-1', retiro_id: 'retreat-1', tipo: 'smp', registro_id: 'student-metadata', storage_path: pathName }],
    storage: [pathName],
    ignoreMetadataDelete: true,
  });
  global.fetch = harness.fetch;
  await assert.rejects(deleteStudentPhotos('smp', 'retreat-1', 'student-metadata'), /metadados.*ficha foi preservada/i);
  assert.equal(harness.state.storage.size, 0);
  assert.equal(harness.state.metadata.length, 1);
}

async function testConcurrentUploadPreservesStudent() {
  const originalPath = 'retreat-1/epc/student-concurrent/original.jpg';
  const latePath = 'retreat-1/epc/student-concurrent/late.jpg';
  const harness = createHarness({
    metadata: [{ id: 'photo-1', retiro_id: 'retreat-1', tipo: 'epc', registro_id: 'student-concurrent', storage_path: originalPath }],
    storage: [originalPath],
    lateStoragePath: latePath,
  });
  global.fetch = harness.fetch;
  await assert.rejects(deleteStudentPhotos('epc', 'retreat-1', 'student-concurrent'), /nova foto.*ficha foi preservada/i);
  assert(harness.state.storage.has(latePath));
  assert.equal(harness.state.metadata.length, 0);
}

async function testOrphanWithoutMetadataIsDeleted() {
  const orphan = 'retreat-1/epc/student-1/orphan.jpg';
  const harness = createHarness({ storage: [orphan] });
  global.fetch = harness.fetch;
  const result = await deleteStudentPhotos('epc', 'retreat-1', 'student-1');
  assert.deepEqual(result, { deleted: 0, objectsDeleted: 1 });
  assert.equal(harness.state.storage.size, 0);
  assert(harness.state.events.includes('metadata-delete'));
}

async function testStudentWithoutPhotoRemainsDeletable() {
  const harness = createHarness();
  global.fetch = harness.fetch;
  const result = await deleteStudentPhotos('individual', 'retreat-1', 'student-without-photo');
  assert.deepEqual(result, { deleted: 0, objectsDeleted: 0 });
  assert(!harness.state.events.includes('storage-delete'));
  assert(harness.state.events.includes('metadata-delete'));
}

async function testMetadataScopeMismatchIsBlocked() {
  const wrongPath = 'retreat-1/individual/another-student/photo.jpg';
  const harness = createHarness({
    metadata: [{ id: 'photo-1', retiro_id: 'retreat-1', tipo: 'individual', registro_id: 'student-1', storage_path: wrongPath }],
    storage: [wrongPath],
  });
  global.fetch = harness.fetch;
  await assert.rejects(deleteStudentPhotos('individual', 'retreat-1', 'student-1'), /nao correspondem a pasta/i);
  assert(!harness.state.events.includes('storage-delete'));
  assert(!harness.state.events.includes('metadata-delete'));
}

async function testDeletionUsesBatches() {
  const directory = 'retreat-1/individual/student-many';
  const storage = Array.from({ length: 1001 }, (_, index) => `${directory}/photo-${String(index).padStart(4, '0')}.jpg`);
  const metadata = storage.map((storagePath, index) => ({
    id: `photo-${index}`,
    retiro_id: 'retreat-1',
    tipo: 'individual',
    registro_id: 'student-many',
    storage_path: storagePath,
  }));
  const harness = createHarness({ metadata, storage });
  global.fetch = harness.fetch;
  const result = await deleteStudentPhotos('individual', 'retreat-1', 'student-many');
  assert.equal(result.deleted, 1001);
  assert.equal(result.objectsDeleted, 1001);
  assert.equal(harness.state.calls.filter((call) => call.pathname === '/storage/v1/object/cursista-fotos' && call.method === 'DELETE').length, 2);
  assert.equal(harness.state.calls.filter((call) => call.pathname === '/rest/v1/cursista_fotos' && call.method === 'GET' && call.search.includes('select=id,storage_path')).length, 2);
  assert.equal(harness.state.storage.size, 0);
}

async function testStrictIndividualAdapterDoesNotFallBack() {
  global.fetch = async () => response(503, { message: 'database unavailable' });
  await assert.rejects(getRecordStrict('cursistas', '00000000-0000-4000-8000-000000000001'), /Supabase 503/i);
  await assert.rejects(deleteRecordStrict('cursistas', '00000000-0000-4000-8000-000000000001'), /Supabase 503/i);
}

async function main() {
  const originalFetch = global.fetch;
  try {
    await testThreeStudentTypes();
    await testUnconfirmedDeletionBlocksMetadata();
    await testStorageFailuresBlockMetadata();
    await testStorageListFailureBlocksMetadata();
    await testMetadataFailureCanBeRetried();
    await testUnconfirmedMetadataDeletionBlocksStudent();
    await testConcurrentUploadPreservesStudent();
    await testOrphanWithoutMetadataIsDeleted();
    await testStudentWithoutPhotoRemainsDeletable();
    await testMetadataScopeMismatchIsBlocked();
    await testDeletionUsesBatches();
    await testStrictIndividualAdapterDoesNotFallBack();

    const root = path.join(__dirname, '..');
    const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
    const dataService = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
    assert.match(dataService, /deleteCursista:\s*\(id\)\s*=>\s*api\(`\/cursistas\//, 'Individual deve excluir exclusivamente pela API.');
    for (const method of ['deleteCursista', 'deleteCursistaSmp', 'deleteCursistaEpc']) {
      assert.match(dataService, new RegExp(`${method}:[\\s\\S]{0,300}method: 'DELETE', timeoutMs: 120000`), `${method} deve aguardar a limpeza confirmada do Storage.`);
    }
    assert.match(api, /const canonicalRecordId = String\(student\.id \|\| student\.numeroFichaSmp \|\| recordId\)[\s\S]*downloadStudentPhotoAliases\(type, retreatId, canonicalRecordId, recordId\)[\s\S]*savePhoto\([\s\S]*recordId: canonicalRecordId[\s\S]*deleteStudentPhotoAliases\(type, retreatId, canonicalRecordId, recordId\)/, 'A API de fotos deve sempre usar o identificador canonico da ficha e limpar aliases antigos.');
    assert.match(api, /getRecordStrict\('cursistas'[\s\S]*deleteStudentPhotoAliases\('individual'[\s\S]*deleteRecordStrict\('cursistas'/, 'Individual deve usar leitura e exclusao estritas no servidor.');
    assert.match(api, /const existing = \(await listCoupleStudents[\s\S]*deleteStudentPhotoAliases\(resource === 'cursista-epc' \? 'epc' : 'smp'[\s\S]*deleteCoupleStudent/, 'SMP e EPC devem validar a ficha, remover fotos e somente depois excluir o cadastro.');
    assert.match(api, /req\.method === 'DELETE' && id && action[\s\S]*retreat\.status === 'concluido'[\s\S]*deleteStudentPhotoAliases\(resource === 'cursista-epc'/, 'SMP e EPC concluidos devem continuar somente para consulta.');
    assert.match(api, /resource === 'cursistas'[\s\S]*getRecordStrict\('retiros'[\s\S]*retreat\.status === 'concluido'[\s\S]*deleteStudentPhotoAliases\('individual'/, 'Individual concluido deve continuar somente para consulta.');
    assert.match(app, /await dataService\.deleteCursista\(student\.id\);[\s\S]*removeStudentFromCommunities\(student\)/, 'A comunidade nao pode ser alterada antes da confirmacao da exclusao Individual.');
    assert.match(app, /await dataService\.deleteCursista\(id\);[\s\S]*removeStudentFromCommunities\(student\)/, 'O formulario Individual deve aguardar a exclusao antes de sincronizar a comunidade.');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('Exclusao definitiva de fotos: Individual, SMP e EPC validados com confirmacao do Storage e sem fallback local.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
