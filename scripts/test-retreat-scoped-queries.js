const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const originalUrl = process.env.SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalAnonKey = process.env.SUPABASE_ANON_KEY;
const originalFetch = global.fetch;

const retreatWithRegistrations = '11111111-1111-4111-8111-111111111111';
const emptyRetreat = '22222222-2222-4222-8222-222222222222';
const personId = '33333333-3333-4333-8333-333333333333';
const enrolmentId = '44444444-4444-4444-8444-444444444444';
const studentId = '55555555-5555-4555-8555-555555555555';
const calls = [];

const restoreEnvironment = () => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalAnonKey;
  global.fetch = originalFetch;
};

const rowsFor = (url) => {
  const parsed = new URL(url);
  const table = parsed.pathname.split('/').pop();
  const retreatFilter = parsed.searchParams.get('retiro_id');
  if (table === 'adesoes') {
    if (retreatFilter === `eq.${emptyRetreat}`) return [];
    return [{ id: enrolmentId, retiro_id: retreatWithRegistrations, pessoa_id: personId, nome: 'Pessoa Teste', extras: {} }];
  }
  if (table === 'pessoas') return [{ id: personId, cpf: '12345678909', nome: 'Pessoa Teste', extras: {} }];
  if (['adesao_dias', 'adesao_setores', 'adesao_retiros_anteriores', 'adesao_espaco_kids'].includes(table)) return [];
  if (table === 'cursistas') {
    if (retreatFilter === `eq.${emptyRetreat}`) return [];
    return [{ id: studentId, retiro_id: retreatWithRegistrations, cpf: '98765432100', nome: 'Cursista Teste', extras: {} }];
  }
  if (table === 'comunidades') return [];
  if (table === 'crachas') return retreatFilter === `eq.${emptyRetreat}` ? [] : [{ id: 'badge-1', retiro_id: retreatWithRegistrations, extras: {} }];
  return [];
};

async function main() {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  delete process.env.SUPABASE_ANON_KEY;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    return new Response(JSON.stringify(rowsFor(url)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  delete require.cache[require.resolve('../databaseAdapter')];
  const { listRecords } = require('../databaseAdapter');

  const enrolments = await listRecords('adesoes', { retiroId: retreatWithRegistrations });
  assert.equal(enrolments.length, 1);
  assert(calls.some(({ url }) => url.includes(`adesoes?retiro_id=eq.${retreatWithRegistrations}`)), 'Adesoes devem ser filtradas no Supabase pelo retiro.');
  assert(calls.some(({ url }) => url.includes(`pessoas?id=in.(${personId})`)), 'Somente as pessoas vinculadas devem ser consultadas.');
  assert(calls.filter(({ url }) => /adesao_(dias|setores|retiros_anteriores|espaco_kids)/.test(url)).every(({ url }) => url.includes(`adesao_id=in.(${enrolmentId})`)), 'Tabelas auxiliares devem receber somente os IDs das adesoes consultadas.');

  calls.length = 0;
  const emptyEnrolments = await listRecords('adesoes', { retiroId: emptyRetreat });
  assert.deepEqual(emptyEnrolments, []);
  assert.equal(calls.length, 1, 'Retiro vazio nao deve disparar consultas auxiliares nem carregar dados de outro retiro.');
  assert(calls[0].url.includes(`retiro_id=eq.${emptyRetreat}`));

  calls.length = 0;
  const people = await listRecords('pessoas', { retiroId: retreatWithRegistrations });
  assert.equal(people.length, 1);
  assert(calls[0].url.includes(`adesoes?retiro_id=eq.${retreatWithRegistrations}`));
  assert(calls[1].url.includes(`pessoas?id=in.(${personId})`));

  calls.length = 0;
  const students = await listRecords('cursistas', { retiroId: retreatWithRegistrations });
  assert.equal(students.length, 1);
  assert(calls[0].url.includes(`cursistas?retiro_id=eq.${retreatWithRegistrations}`));

  calls.length = 0;
  assert.deepEqual(await listRecords('comunidades', { retiroId: emptyRetreat }), []);
  assert.equal(calls.length, 1);
  assert(calls[0].url.includes(`comunidades?retiro_id=eq.${emptyRetreat}`));

  calls.length = 0;
  assert.equal((await listRecords('crachas', { retiroId: retreatWithRegistrations })).length, 1);
  assert(calls[0].url.includes(`crachas?retiro_id=eq.${retreatWithRegistrations}`));
  assert(calls.every(({ method }) => method === 'GET'), 'A auditoria de consultas nao pode executar gravacoes.');

  const adminSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
  const dataServiceSource = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');
  const publicSectorSource = fs.readFileSync(path.join(root, 'publicSectorPage.js'), 'utf8');
  assert.match(adminSource, /listAdesoes\(focusRetreatId\)[\s\S]*listPessoas\(focusRetreatId\)/, 'O carregamento principal deve usar o retiro em foco.');
  assert.match(dataServiceSource, /params\.set\('retiroId', options\.retiroId\)/, 'O servico deve enviar o filtro para a API.');
  assert.match(apiSource, /listRecords\(resource, listRetreatId \? \{ retiroId: listRetreatId \} : \{\}\)/, 'A API deve encaminhar o filtro ao adaptador.');
  assert.match(publicSectorSource, /listRecords\('adesoes', \{ retiroId: result\.retreatId \}\)/, 'A pagina publica do setor deve limitar as adesoes ao retiro do link.');

  console.log(JSON.stringify({
    ok: true,
    verified: [
      'consultas principais filtradas no Supabase por retiro',
      'relacionamentos carregados somente para os registros retornados',
      'retiro vazio nao recebe dados do retiro publicado',
      'fluxo exercitado somente com requisicoes GET',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(restoreEnvironment);
