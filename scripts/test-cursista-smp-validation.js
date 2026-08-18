const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const originalUrl = process.env.SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalAnonKey = process.env.SUPABASE_ANON_KEY;
const originalFetch = global.fetch;

const retreatId = '11111111-1111-4111-8111-111111111111';
const hisCpf = '52998224725';
const herCpf = '11144477735';
const personId = '22222222-2222-4222-8222-222222222222';
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const baseRecord = (extra = {}) => ({
  retiroId: retreatId,
  id: '1',
  numeroFichaSmp: '1',
  cpfDele: hisCpf,
  cpfDela: herCpf,
  nomeDele: 'Joao Teste',
  nomeDela: 'Maria Teste',
  ...extra,
});

const tableName = (url) => new URL(url).pathname.split('/').pop();
const mockSupabase = ({ individual = [], smp = [], epc = [], enrolments = [], people = [] } = {}) => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const table = tableName(url);
    calls.push({ table, method });
    if (method === 'POST' && table === 'cursista_smp') {
      const [saved] = JSON.parse(options.body);
      return response([{ ...saved, extras: saved.extras || {} }]);
    }
    if (table === 'cursistas') return response(individual);
    if (table === 'cursista_smp') return response(smp);
    if (table === 'cursista_epc') return response(epc);
    if (table === 'adesoes') return response(enrolments);
    if (table === 'pessoas') return response(people);
    return response([]);
  };
  return calls;
};

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
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  delete process.env.SUPABASE_ANON_KEY;
  delete require.cache[require.resolve('../databaseAdapter')];
  const { saveCursistaSmp } = require('../databaseAdapter');

  let calls = mockSupabase({ individual: [{ id: 'student-1', retiro_id: retreatId, cpf: hisCpf }] });
  await assert.rejects(saveCursistaSmp(baseRecord()), /cadastro de cursista neste retiro/i);
  assert.equal(calls.some(({ method }) => method === 'POST'), false, 'CPF duplicado nao pode chegar ao upsert.');

  calls = mockSupabase({
    enrolments: [{ id: 'enrolment-1', retiro_id: retreatId, pessoa_id: personId }],
    people: [{ id: personId, cpf: herCpf, extras: {} }],
  });
  await assert.rejects(saveCursistaSmp(baseRecord()), /equipe de trabalho deste retiro/i);
  assert.equal(calls.some(({ method }) => method === 'POST'), false, 'Conflito com a equipe nao pode chegar ao upsert.');

  calls = mockSupabase();
  await assert.rejects(saveCursistaSmp(baseRecord({ cpfDela: hisCpf })), /CPF diferente para cada integrante/i);
  assert.equal(calls.some(({ method }) => method === 'POST'), false);

  calls = mockSupabase({
    smp: [{ id: '1', retiro_id: retreatId, ele_cpf: hisCpf, ela_cpf: herCpf, extras: {} }],
    enrolments: [{ id: 'enrolment-1', retiro_id: retreatId, pessoa_id: personId }],
    people: [{ id: personId, cpf: hisCpf, extras: {} }],
  });
  const unchanged = await saveCursistaSmp(baseRecord());
  assert.equal(unchanged.id, '1');
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1, 'Rotinas que apenas atualizam o recebimento devem preservar a ficha historica.');

  calls = mockSupabase({
    smp: [{ id: '1', retiro_id: retreatId, ele_cpf: hisCpf, ela_cpf: herCpf, extras: {} }],
    enrolments: [{ id: 'enrolment-1', retiro_id: retreatId, pessoa_id: personId }],
    people: [{ id: personId, cpf: hisCpf, extras: {} }],
  });
  await assert.rejects(saveCursistaSmp(baseRecord({ validateCpfAvailability: true })), /equipe de trabalho deste retiro/i);
  assert.equal(calls.some(({ method }) => method === 'POST'), false, 'O salvamento completo deve bloquear conflito preexistente informado na tela.');

  const admin = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
  assert.match(admin, /const smpRequiredTextFields = \[[\s\S]*?'nomeDele'[\s\S]*?'valorInscricaoSmp'/);
  const requiredFieldsSource = admin.slice(admin.indexOf('const smpRequiredTextFields = ['), admin.indexOf('const smpRequiredChoiceFields = ['));
  ['casamentoDele', 'casamentoDela', 'filhosDele', 'filhosDela'].forEach((field) => {
    assert.doesNotMatch(requiredFieldsSource, new RegExp(`'${field}'`), `${field} nao deve ser obrigatorio.`);
  });
  assert.match(admin, /const smpRequiredChoiceFields = \[[\s\S]*?'crismaDele'[\s\S]*?'manequimDela'/);
  assert.match(admin, /\['movimentoIgrejaDele', 'qualMovimentoDele'\][\s\S]*\['saudeDela', 'qualSaudeDela'\][\s\S]*\['intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela'\]/);
  assert.match(admin, /const required = values\.get\(choiceName\) === 'Sim';[\s\S]*detail\.required = required/);
  assert.match(admin, /firstSmpKidsIssue[\s\S]*form\.checkValidity\(\)/);
  assert.match(admin, /if \(!usedPanels\.length\) return form\.elements\.smpKidsNotNeeded/);
  assert.match(admin, /requiredNames = \[`smpKidNome\$\{kidNumber\}`, `smpKidNascimento\$\{kidNumber\}`\]/);
  assert.match(api, /resource === 'cursista-smp'[\s\S]*validateCpfAvailability: true/);

  console.log(JSON.stringify({
    ok: true,
    verified: [
      'campos fixos e escolhas da ficha SMP sao obrigatorios',
      'campos Qual sao condicionais a resposta Sim',
      'CPF repetido em cursistas ou equipe bloqueia antes da gravacao',
      'rotinas financeiras preservam fichas historicas sem dispensar a validacao da tela',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(restoreEnvironment);
