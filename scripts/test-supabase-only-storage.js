const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const databasePath = path.join(root, 'database', 'db.json');
const beforeDatabase = fs.readFileSync(databasePath, 'utf8');
const beforeModifiedAt = fs.statSync(databasePath).mtimeMs;
const originalUrl = process.env.SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalAnonKey = process.env.SUPABASE_ANON_KEY;
const originalFetch = global.fetch;

const restoreEnvironment = () => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalAnonKey;
  global.fetch = originalFetch;
};

async function main() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete require.cache[require.resolve('../databaseAdapter')];
  const databaseAdapter = require('../databaseAdapter');

  await assert.rejects(databaseAdapter.checkDatabaseConnection(), /Supabase nao configurado/);
  await assert.rejects(databaseAdapter.listRecords('retiros'), /nenhum dado foi lido ou salvo no banco local/);
  await assert.rejects(databaseAdapter.saveRecord('configuracoes', { id: 'storage-policy-test' }), /nenhum dado foi lido ou salvo no banco local/);
  await assert.rejects(databaseAdapter.importDatabase({ configuracoes: [{ id: 'storage-policy-test' }] }), /nenhum dado foi lido ou salvo no banco local/);
  await assert.rejects(databaseAdapter.replaceDatabase({}), /nenhum dado foi lido ou salvo no banco local/);

  process.env.SUPABASE_URL = 'https://supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  global.fetch = async () => { throw new Error('remote unavailable'); };
  await assert.rejects(databaseAdapter.saveRecord('configuracoes', { id: 'storage-policy-test' }), /remote unavailable/);

  const afterDatabase = fs.readFileSync(databasePath, 'utf8');
  const afterModifiedAt = fs.statSync(databasePath).mtimeMs;
  assert.equal(afterDatabase, beforeDatabase, 'O conteudo de database/db.json nao pode mudar durante falhas do Supabase.');
  assert.equal(afterModifiedAt, beforeModifiedAt, 'database/db.json nao pode nem ser regravado durante falhas do Supabase.');

  const dataServiceSource = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');
  const adapterSource = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');
  const localServerSource = fs.readFileSync(path.join(root, 'localServer.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');

  assert(!dataServiceSource.includes("backend = 'indexeddb'"), 'O frontend nao pode ativar fallback IndexedDB.');
  assert(!dataServiceSource.includes('legacyStore.save('), 'O frontend nao pode salvar fichas no IndexedDB.');
  assert(!dataServiceSource.includes('legacyStore.delete('), 'O frontend nao pode excluir fichas no IndexedDB.');
  assert(!dataServiceSource.includes("api('/database/import'"), 'Dados locais nao podem ser importados automaticamente.');
  assert(dataServiceSource.includes("health.database !== 'supabase-relational'"), 'O frontend deve exigir explicitamente o Supabase relacional.');
  assert(!adapterSource.includes('writeFileDatabase('), 'O adaptador de producao nao pode conter gravacao em db.json.');
  assert(!adapterSource.includes('readFileDatabase('), 'O adaptador de producao nao pode consultar db.json.');
  assert(!localServerSource.includes('ensureFileDatabase'), 'O servidor local nao pode inicializar db.json.');
  assert(apiSource.includes("database: 'supabase-required'"), 'O health deve informar que o Supabase e obrigatorio.');

  console.log(JSON.stringify({
    ok: true,
    verified: [
      'sem Supabase, leituras e gravacoes sao bloqueadas',
      'falha remota nao altera database/db.json',
      'frontend nao grava nem exclui no IndexedDB',
      'importacao local automatica removida',
      'health exige Supabase relacional',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(restoreEnvironment);
