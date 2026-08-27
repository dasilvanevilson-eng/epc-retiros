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
  casamentoDele: '01/02/2000',
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

  let calls = mockSupabase();
  await assert.rejects(saveCursistaSmp(baseRecord({ casamentoDele: '', casamentoDela: '' })), /casamento religioso de pelo menos um dos cônjuges/i);
  assert.equal(calls.some(({ method }) => method === 'POST'), false, 'Ficha SMP sem data de casamento religioso nao pode chegar ao upsert.');

  calls = mockSupabase({ individual: [{ id: 'student-1', retiro_id: retreatId, cpf: hisCpf }] });
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

  calls = mockSupabase();
  const individualizedUnions = await saveCursistaSmp(baseRecord({
    nomeCrachaDele: 'Joao do SMP',
    nomeCrachaDela: 'Maria do SMP',
    outrasUnioes: 'Sim',
    outrasUnioesDele: 'Não',
    outrasUnioesDela: 'Sim',
    porqueQueremFazerRetiro: 'Fortalecer a família',
    comoSouberamRetiro: 'Por amigos',
    nomeApresentante: 'Apresentante histórico',
    foneApresentante: '(47) 99999-9999',
    cursoApresentante: 'Curso histórico',
    cidadeApresentante: 'Indaial',
    paroquiaApresentante: 'Paróquia histórica',
  }));
  assert.equal(individualizedUnions.outrasUnioesDele, 'Não');
  assert.equal(individualizedUnions.outrasUnioesDela, 'Sim');
  assert.equal(individualizedUnions.nomeCrachaDele, 'Joao do SMP');
  assert.equal(individualizedUnions.nomeCrachaDela, 'Maria do SMP');
  assert.equal(individualizedUnions.outrasUnioes, 'Sim', 'A resposta historica em comum deve continuar preservada.');
  assert.equal(individualizedUnions.porqueQueremFazerRetiro, 'Fortalecer a família');
  assert.equal(individualizedUnions.comoSouberamRetiro, 'Por amigos');
  assert.equal(individualizedUnions.nomeApresentante, 'Apresentante histórico');
  assert.equal(individualizedUnions.foneApresentante, '(47) 99999-9999');
  assert.equal(individualizedUnions.cursoApresentante, 'Curso histórico');
  assert.equal(individualizedUnions.cidadeApresentante, 'Indaial');
  assert.equal(individualizedUnions.paroquiaApresentante, 'Paróquia histórica');

  calls = mockSupabase({
    smp: [{ id: '1', retiro_id: retreatId, ele_cpf: hisCpf, ela_cpf: herCpf, extras: {} }],
    enrolments: [{ id: 'enrolment-1', retiro_id: retreatId, pessoa_id: personId }],
    people: [{ id: personId, cpf: hisCpf, extras: {} }],
  });
  await assert.rejects(saveCursistaSmp(baseRecord({ validateCpfAvailability: true })), /equipe de trabalho deste retiro/i);
  assert.equal(calls.some(({ method }) => method === 'POST'), false, 'O salvamento completo deve bloquear conflito preexistente informado na tela.');

  const admin = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
  assert.match(admin, /const smpRequiredTextFields = \[[\s\S]*?'nomeDele'[\s\S]*?'valorInscricaoSmp'/);
  const requiredFieldsSource = admin.slice(admin.indexOf('const smpRequiredTextFields = ['), admin.indexOf('const smpRequiredChoiceFields = ['));
  ['casamentoDele', 'casamentoDela', 'filhosDele', 'filhosDela', 'nrApto'].forEach((field) => {
    assert.doesNotMatch(requiredFieldsSource, new RegExp(`'${field}'`), `${field} nao deve ser obrigatorio.`);
  });
  ['nomeCrachaDele', 'nomeCrachaDela'].forEach((field) => {
    assert.doesNotMatch(requiredFieldsSource, new RegExp(`'${field}'`), `${field} deve permanecer opcional.`);
  });
  assert.match(admin, /const smpRequiredChoiceFields = \[[\s\S]*?'crismaDele'[\s\S]*?'manequimDela'/);
  assert.match(admin, /'casamentoDele', 'filhosDele', 'outrasUnioesDele'/);
  assert.match(admin, /'casamentoDela', 'filhosDela', 'outrasUnioesDela'/);
  assert.match(admin, /class="smp-pair-row-start"><legend>Pertence a movimento da Igreja\? Ele/);
  assert.match(admin, /class="smp-pair-row-start"><legend>Pertence a movimento da Igreja\? Ela/);
  assert.match(admin, /class="field smp-pair-row-start"><span>Data do 1º casamento dele/);
  assert.match(admin, /class="field smp-pair-row-start"><span>Data do 1º casamento dela/);
  assert.doesNotMatch(admin, /commonFields = fieldsBlock\([^\n]*'outrasUnioes'/);
  const smpCommonFieldsSource = admin.match(/const commonFields = fieldsBlock\('fields two-columns cursista-smp-common-fields', \[[^\n]+/)?.[0] || '';
  assert.match(smpCommonFieldsSource, /'precisaAcolhimento', 'porqueQueremFazerRetiro', 'comoSouberamRetiro', 'familiarAmigo'/);
  ['nomeApresentante', 'foneApresentante', 'cursoApresentante', 'cidadeApresentante', 'paroquiaApresentante'].forEach((field) => {
    assert.doesNotMatch(smpCommonFieldsSource, new RegExp(`'${field}'`), `${field} nao deve aparecer no formulario SMP.`);
  });
  assert.match(styles, /fieldset:has\(\[name="precisaAcolhimento"\]\) \{ grid-column:1 \/ span 6; \}/);
  assert.match(styles, /\.field:has\(\[name="porqueQueremFazerRetiro"\]\) \{ grid-column:7 \/ span 6; \}/);
  assert.match(styles, /\.cursista-smp-form \.smp-pair-row-start \{\s*grid-column:1;\s*\}/);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*?\.cursista-smp-form \.smp-pair-row-start \{\s*grid-column:auto;\s*\}/);
  assert.match(admin, /legacyValue = \['outrasUnioesDele', 'outrasUnioesDela'\]\.includes\(name\) \? record\.outrasUnioes : ''/);
  assert.match(admin, /\['movimentoIgrejaDele', 'qualMovimentoDele'\][\s\S]*\['saudeDela', 'qualSaudeDela'\][\s\S]*\['intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela'\]/);
  assert.match(admin, /const required = values\.get\(choiceName\) === 'Sim';[\s\S]*detail\.required = required/);
  assert.match(admin, /firstSmpKidsIssue[\s\S]*form\.checkValidity\(\)/);
  assert.match(admin, /if \(!usedPanels\.length\) return form\.elements\.smpKidsNotNeeded/);
  assert.match(admin, /requiredNames = \[`smpKidNome\$\{kidNumber\}`, `smpKidNascimento\$\{kidNumber\}`\]/);
  assert.match(admin, /if \(!choice\) return form\.querySelector\(`\[name="\$\{choiceName\}"\]`\)/);
  assert.match(admin, /if \(choice === 'Sim' && !String\(form\.elements\[detailName\]\?\.value \|\| ''\)\.trim\(\)\) return form\.elements\[detailName\]/);
  assert.match(admin, /const focusChurchMarriageIssue = \(\) => \{[\s\S]*form\.elements\.casamentoDele[\s\S]*form\.elements\.casamentoDela[\s\S]*classList\.add\('field-warning'\)/);
  assert.match(admin, /const smpChurchMarriageMessage = 'A data de casamento religioso de pelo menos um dos cônjuges deve ser preenchida\.'/);
  assert.match(admin, /inlineMessage\.dataset\.smpChurchMarriageMessage = 'true'[\s\S]*inlineMessage\.role = 'alert'/);
  assert.match(admin, /setMessage\(smpChurchMarriageMessage\);[\s\S]*focusChurchMarriageIssue\(\)/);
  assert.match(admin, /if \(\['casamentoDele', 'casamentoDela'\]\.includes\(event\.target\.name\)\) \{[\s\S]*form\.elements\.casamentoDele[\s\S]*form\.elements\.casamentoDela[\s\S]*classList\.remove\('field-warning'\)[\s\S]*data-smp-church-marriage-message/);
  assert.match(styles, /\.cursista-smp-form \.smp-church-marriage-message \{[\s\S]*grid-column:1 \/ -1;[\s\S]*font-weight:700;/);
  assert.match(admin, /const syncSmpKidRequiredRules = \(\) => \{[\s\S]*control\.required = hasData;[\s\S]*setSmpRequiredMarker\(control, hasData\)/);
  assert.match(admin, /const detailRequired = hasData && new FormData\(form\)\.get\(choiceName\) === 'Sim';[\s\S]*setSmpRequiredMarker\(detail, detailRequired\)/);
  assert.match(admin, /function wirePublicSmpValidation\(form\)[\s\S]*const setPublicRequiredMarker = \(control, required\) =>/);
  assert.match(admin, /smpRequiredTextFields\.forEach[\s\S]*setPublicRequiredMarker\(form\.elements\[name\], true\)/);
  assert.match(admin, /smpRequiredChoiceFields\.forEach[\s\S]*setPublicRequiredMarker\(controls\[0\], true\)/);
  assert.match(admin, /const required = values\.get\(choiceName\) === 'Sim';[\s\S]*setPublicRequiredMarker\(form\.elements\[detailName\], required\)/);
  assert.match(admin, /setPublicRequiredMarker\(form\.elements\[name\], hasData\)/);
  assert.match(admin, /setPublicRequiredMarker\(form\.elements\[detailName\], detailRequired\)/);
  assert.match(api, /resource === 'cursista-smp'[\s\S]*validateCpfAvailability: true/);

  console.log(JSON.stringify({
    ok: true,
    verified: [
      'campos fixos e escolhas da ficha SMP sao obrigatorios',
      'campos Qual sao condicionais a resposta Sim',
      'CPF repetido em cursistas ou equipe bloqueia antes da gravacao',
      'rotinas financeiras preservam fichas historicas sem dispensar a validacao da tela',
      'outras unioes sao individuais e preservam a resposta historica em comum',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(restoreEnvironment);
