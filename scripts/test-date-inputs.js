const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'adminApp.js');
const app = fs.readFileSync(appPath, 'utf8');

const sectionBetween = (startMarker, endMarker, label) => {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `Se\u00e7\u00e3o de integra\u00e7\u00e3o n\u00e3o encontrada: ${label}.`);
  return app.slice(start, end);
};

const assertOrdered = (source, markers, label) => {
  let previous = -1;
  for (const marker of markers) {
    const position = source.indexOf(marker);
    assert(position >= 0, `${label}: trecho ausente: ${marker}`);
    assert(position > previous, `${label}: ordem incorreta em: ${marker}`);
    previous = position;
  }
};

const sourceMatch = (pattern, label) => {
  const match = app.match(pattern);
  assert(match, `${label} n\u00e3o encontrado em adminApp.js.`);
  return match[0];
};

const helperSource = [
  sourceMatch(/const normalizeDateInput = \(value = ''\) => \{[\s\S]*?\n\};/, 'normalizeDateInput'),
  sourceMatch(/const formatDateInput = \(value = ''\) => \{[\s\S]*?\n\};/, 'formatDateInput'),
  sourceMatch(/const coupleStudentDateFieldNames = Object\.freeze\(\[[\s\S]*?\n\]\);/, 'coupleStudentDateFieldNames'),
  sourceMatch(/const teamKidDateFieldNames = Object\.freeze\([^\n]+\);/, 'teamKidDateFieldNames'),
  sourceMatch(/const namedFieldSelector = [^\n]+;/, 'namedFieldSelector'),
  sourceMatch(/function wireTypedDates\(root, selector\) \{[\s\S]*?\n\}/, 'wireTypedDates'),
].join('\n');

const context = { module: { exports: {} }, Date, Object, Array, String, Number, Boolean };
vm.runInNewContext(`${helperSource}\nmodule.exports = { normalizeDateInput, formatDateInput, coupleStudentDateFieldNames, teamKidDateFieldNames, namedFieldSelector, wireTypedDates };`, context);
const {
  normalizeDateInput,
  formatDateInput,
  coupleStudentDateFieldNames,
  teamKidDateFieldNames,
  namedFieldSelector,
  wireTypedDates,
} = context.module.exports;

const validDates = new Map([
  ['', ''],
  ['29/02/2024', '2024-02-29'],
  ['2024-02-29', '2024-02-29'],
  ['29/02/2000', '2000-02-29'],
  ['01/03/1900', '1900-03-01'],
  ['15/03/1940', '1940-03-15'],
  ['31/12/2099', '2099-12-31'],
]);
for (const [value, expected] of validDates) {
  assert.equal(normalizeDateInput(value), expected, `Normaliza\u00e7\u00e3o incorreta para ${value || 'data vazia'}.`);
}

for (const value of [
  '29/02/2023',
  '29/02/1900',
  '31/04/2024',
  '31/06/2024',
  '00/01/2024',
  '01/00/2024',
  '01/13/2024',
  '1/1/2024',
  '01/01/0000',
  '2023-02-29',
  '2024-04-31',
  '2024/01/01',
  'data inv\u00e1lida',
]) {
  assert.equal(normalizeDateInput(value), '', `A data inv\u00e1lida ${value} n\u00e3o pode ser normalizada.`);
}

assert.equal(formatDateInput('1940-03-15'), '15/03/1940', 'Registro hist\u00f3rico ISO deve ser exibido em dd/mm/aaaa.');
assert.equal(formatDateInput('15/03/1940'), '15/03/1940', 'Formata\u00e7\u00e3o BR deve ser idempotente.');
assert.equal(formatDateInput('2023-02-29'), '', 'Data ISO inv\u00e1lida n\u00e3o pode ser exibida como v\u00e1lida.');

const listeners = new Map();
const input = {
  dataset: {},
  type: 'date',
  inputMode: '',
  placeholder: '',
  maxLength: 0,
  pattern: '',
  title: '',
  value: '1940-03-15',
  validationMessage: '',
  addEventListener(name, listener) {
    const registered = listeners.get(name) || [];
    registered.push(listener);
    listeners.set(name, registered);
  },
  setCustomValidity(message) {
    this.validationMessage = message;
  },
};
const queriedSelectors = [];
const fakeRoot = {
  querySelectorAll(selector) {
    queriedSelectors.push(selector);
    return [input];
  },
};

wireTypedDates(fakeRoot, '[name="nascimento"]');
assert.equal(input.type, 'text', 'O helper deve retirar o seletor nativo de data.');
assert.equal(input.inputMode, 'numeric');
assert.equal(input.placeholder, 'dd/mm/aaaa');
assert.equal(input.maxLength, 10);
assert.equal(input.pattern, '\\d{2}/\\d{2}/\\d{4}');
assert.equal(input.value, '15/03/1940', 'Valor ISO carregado deve aparecer em formato brasileiro.');
assert.equal(input.validationMessage, '');
for (const eventName of ['input', 'change', 'blur']) {
  assert.equal(listeners.get(eventName)?.length, 1, `Evento ${eventName} deve ser instalado uma vez.`);
}

wireTypedDates(fakeRoot, '[name="nascimento"]');
for (const eventName of ['input', 'change', 'blur']) {
  assert.equal(listeners.get(eventName)?.length, 1, `O wiring deve ser idempotente para o evento ${eventName}.`);
}
assert.deepEqual(queriedSelectors, ['[name="nascimento"]', '[name="nascimento"]']);

const dispatch = (eventName) => listeners.get(eventName)[0]();
input.value = '01021940';
dispatch('input');
assert.equal(input.value, '01/02/1940', 'A digita\u00e7\u00e3o num\u00e9rica deve receber a m\u00e1scara.');
assert.equal(input.validationMessage, '');

input.value = '1940-02-01';
dispatch('input');
assert.equal(input.value, '01/02/1940', 'A colagem de uma data ISO deve ser convertida para dd/mm/aaaa.');
assert.equal(input.validationMessage, '');

input.value = '29022023';
dispatch('input');
assert.equal(input.value, '29/02/2023');
assert.notEqual(input.validationMessage, '', 'Data semanticamente inv\u00e1lida deve ser bloqueada ainda no evento input.');

input.value = '2023-02-29';
dispatch('input');
assert.equal(input.value, '29/02/2023', 'Colagem ISO inv\u00e1lida deve continuar leg\u00edvel para corre\u00e7\u00e3o.');
assert.notEqual(input.validationMessage, '', 'Colagem ISO inv\u00e1lida deve permanecer bloqueada.');

input.value = '';
dispatch('input');
assert.equal(input.validationMessage, '', 'Campo opcional vazio deve permanecer v\u00e1lido.');

const expectedCoupleFields = [
  'nascimentoDele', 'nascimentoDela', 'casamentoDele', 'casamentoDela', 'uniaoCasal',
  'smpKidNascimento1', 'smpKidNascimento2', 'smpKidNascimento3', 'smpKidNascimento4', 'smpKidNascimento5',
];
const expectedTeamKidFields = [
  'kidNascimento1', 'kidNascimento2', 'kidNascimento3', 'kidNascimento4', 'kidNascimento5',
];
assert.deepEqual(Array.from(coupleStudentDateFieldNames), expectedCoupleFields, 'Invent\u00e1rio compartilhado SMP/EPC incompleto.');
assert.deepEqual(Array.from(teamKidDateFieldNames), expectedTeamKidFields, 'Invent\u00e1rio das crian\u00e7as da equipe incompleto.');
assert.equal(namedFieldSelector(['dataInicio', 'dataTermino']), '[name="dataInicio"], [name="dataTermino"]');

const dateFieldInventory = {
  retiro: ['dataInicio', 'dataTermino'],
  individual: ['nascimento'],
  smp: expectedCoupleFields,
  epc: expectedCoupleFields.filter((name) => !['casamentoDele', 'casamentoDela'].includes(name)),
  equipe: ['nascimento', 'spouseNascimento', ...expectedTeamKidFields],
};
const logicalDateFieldCount = Object.values(dateFieldInventory).reduce((total, fields) => total + fields.length, 0);
assert.equal(logicalDateFieldCount, 28, 'O sistema deve manter exatamente 28 campos l\u00f3gicos de data cobertos.');

for (const fieldName of new Set(Object.values(dateFieldInventory).flat())) {
  const literalName = app.includes(`name="${fieldName}"`);
  const generatedName = /^(?:smpKidNascimento|kidNascimento)\d+$/.test(fieldName)
    && app.includes(fieldName.startsWith('smp') ? 'smpKidNascimento${kidNumber}' : 'kidNascimento${kidNumber}');
  assert(literalName || generatedName, `Campo de data ${fieldName} n\u00e3o encontrado na interface.`);
}

// Retiro: a inclus\u00e3o, a c\u00f3pia de estrutura e a edi\u00e7\u00e3o devem manter BR somente na tela.
const newRetreatSource = sectionBetween(
  'async function renderNewRetreat',
  'async function renderRetreat',
  'cria\u00e7\u00e3o de retiro',
);
assert.match(newRetreatSource, /wireTypedDates\(form, namedFieldSelector\(\['dataInicio', 'dataTermino'\]\)\)/,
  'Cria\u00e7\u00e3o de retiro deve ligar as duas datas ao helper textual.');
assert.match(newRetreatSource, /form\.elements\.dataInicio\.value = formatDateInput\(source\?\.dataInicio\) \|\| source\?\.dataInicio \|\| ''/,
  'C\u00f3pia de retiro deve formatar a data inicial hist\u00f3rica.');
assert.match(newRetreatSource, /form\.elements\.dataTermino\.value = formatDateInput\(source\?\.dataTermino\) \|\| source\?\.dataTermino \|\| ''/,
  'C\u00f3pia de retiro deve formatar a data final hist\u00f3rica.');
assertOrdered(newRetreatSource, [
  "const dataInicio = normalizeDateInput(rawDataInicio)",
  "const dataTermino = normalizeDateInput(rawDataTermino)",
  "values.set('dataInicio', dataInicio)",
  "if (dataInicio && dataTermino && dataTermino < dataInicio)",
  'const retreat = { id: createId()',
  'await dataService.saveRetiro(retreat)',
], 'Cria\u00e7\u00e3o de retiro deve normalizar antes de comparar e salvar');

const editRetreatSource = sectionBetween(
  'async function renderEditRetreat',
  'async function renderRecebedor',
  'edi\u00e7\u00e3o de retiro',
);
assert.match(editRetreatSource, /value="\$\{escapeHtml\(formatDateInput\(retreat\.dataInicio\) \|\| retreat\.dataInicio \|\| ''\)\}"/,
  'Edi\u00e7\u00e3o deve exibir a data inicial hist\u00f3rica em formato brasileiro.');
assert.match(editRetreatSource, /value="\$\{escapeHtml\(formatDateInput\(retreat\.dataTermino\) \|\| retreat\.dataTermino \|\| ''\)\}"/,
  'Edi\u00e7\u00e3o deve exibir a data final hist\u00f3rica em formato brasileiro.');
assert.match(editRetreatSource, /wireTypedDates\(form, namedFieldSelector\(\['dataInicio', 'dataTermino'\]\)\)/,
  'Edi\u00e7\u00e3o de retiro deve ligar as duas datas ao helper textual.');
assertOrdered(editRetreatSource, [
  'const normalizedDataInicio = normalizeDateInput(rawDataInicio)',
  'const normalizedDataTermino = normalizeDateInput(rawDataTermino)',
  "const dataInicio = isPublished ? (retreat.dataInicio || '') : normalizedDataInicio",
  'if (dataInicio && dataTermino && dataTermino < dataInicio)',
  'Object.assign(retreat, { nome:',
  'await dataService.saveRetiro(retreat)',
], 'Edi\u00e7\u00e3o de retiro deve normalizar antes de comparar e salvar');

// Individual: o mesmo formul\u00e1rio atende o acesso logado e o link p\u00fablico.
const individualSource = sectionBetween(
  'async function renderCursista({ publicContext = null } = {})',
  'async function renderCursistaDetalhe',
  'cadastro Individual',
);
const individualWirePosition = individualSource.indexOf("wireTypedDates(form, namedFieldSelector(['nascimento']))");
const publicBranchPosition = individualSource.indexOf('if (publicContext)');
assert(individualWirePosition >= 0 && individualWirePosition < publicBranchPosition,
  'O nascimento Individual deve ser ligado ao helper antes da separa\u00e7\u00e3o entre acesso logado e p\u00fablico.');
assert.match(individualSource, /nascimento: formatDateInput\(person\.nascimento\) \|\| person\.nascimento/,
  'Dados hist\u00f3ricos do acervo devem preencher o nascimento Individual em formato brasileiro.');
assertOrdered(individualSource, [
  "const nascimento = normalizeDateInput(values.get('nascimento'))",
  "values.set('nascimento', nascimento)",
  'const record = {',
  'await dataService.saveCursista(record)',
], 'Cadastro Individual logado deve normalizar a data antes de salvar');
assert.match(app, /field\.value = key === 'nascimento' \? \(formatDateInput\(value\) \|\| value \|\| ''\) : \(value \|\| ''\)/,
  'Edi\u00e7\u00e3o de uma ficha Individual hist\u00f3rica deve formatar o nascimento carregado.');

const publicPayloadSource = sectionBetween(
  'const publicStudentPayload =',
  'const wireSharedPublicStudentSubmission =',
  'payload p\u00fablico de cursistas',
);
assert.match(publicPayloadSource, /\['nascimento', \.\.\.coupleStudentDateFieldNames\]\.forEach/,
  'Payload p\u00fablico deve abranger Individual, SMP e EPC.');
assert.match(publicPayloadSource, /payload\[name\] = raw \? \(normalizeDateInput\(raw\) \|\| raw\) : ''/,
  'Payload p\u00fablico deve converter datas v\u00e1lidas para ISO antes do envio.');

// SMP/EPC: a lista efetiva deve ser derivada dos controles que permaneceram no DOM.
const coupleScreenSource = sectionBetween(
  'function renderCursistaSmpScreen',
  'async function setupCursistaSmpTestCrud',
  'tela SMP/EPC',
);
assert.match(coupleScreenSource, /const dateInputAttributes = 'type="text" inputmode="numeric" maxlength="10" placeholder="dd\/mm\/aaaa"'/,
  'SMP e EPC devem renderizar somente campos de data textuais.');

const coupleCrudSource = sectionBetween(
  'async function setupCursistaSmpTestCrud',
  'function setupCoupleStudentFinancialSummary',
  'CRUD SMP/EPC',
);
assert.match(coupleCrudSource, /const typedDateFields = coupleStudentDateFieldNames\.filter\(\(name\) => form\.elements\[name\]\)/,
  'SMP/EPC devem considerar somente as datas realmente presentes no DOM de cada modalidade.');
assert.match(coupleCrudSource, /wireTypedDates\(form, namedFieldSelector\(typedDateFields\)\)/,
  'CRUD SMP/EPC deve ligar sua lista efetiva ao helper.');
assert.match(coupleCrudSource, /typedDateFields\.includes\(name\)[\s\S]*?formatDateInput\(value\) \|\| value \|\| ''/,
  'Carga hist\u00f3rica SMP/EPC deve exibir datas ISO em formato brasileiro.');
assert.match(coupleCrudSource, /typedDateFields\.forEach\(\(name\) => \{[\s\S]*?record\[name\] = normalizeDateInput\(record\[name\]\)/,
  'Persist\u00eancia SMP/EPC deve normalizar todas as datas presentes.');

const publicCoupleSource = sectionBetween(
  'function prepareSharedPublicCoupleStudentForm',
  'async function renderSharedPublicStudentRegistration',
  'cadastro p\u00fablico SMP/EPC',
);
assert.match(publicCoupleSource, /wireTypedDates\(form, namedFieldSelector\(coupleStudentDateFieldNames\)\)/,
  'Cadastro p\u00fablico SMP/EPC deve usar o mesmo helper de data.');

// Equipe: titular, c\u00f4njuge e as cinco crian\u00e7as compartilham m\u00e1scara, carga e ISO persistido.
const teamSource = sectionBetween(
  'async function renderPublicForm',
  'async function renderUsuarios',
  'cadastro da equipe',
);
assert.match(app, /function wireTypedBirthDates\(root\) \{\s*wireTypedDates\(root, namedFieldSelector\(\['nascimento', 'spouseNascimento', \.\.\.teamKidDateFieldNames\]\)\);?\s*\}/,
  'Helper da equipe deve incluir titular, c\u00f4njuge e os cinco filhos.');
assert.match(teamSource, /wireTypedBirthDates\(form\)/,
  'Formul\u00e1rio da equipe deve ligar todos os nascimentos ao helper.');
assert.match(teamSource, /form\.elements\[`kidNascimento\$\{kidNumber\}`\]\.value = formatDateInput\(kid\.nascimento\) \|\| kid\.nascimento \|\| ''/,
  'Carga de cada crian\u00e7a hist\u00f3rica da equipe deve formatar a data.');
assert.match(teamSource, /source\.querySelectorAll\(namedFieldSelector\(\['nascimento', 'spouseNascimento', \.\.\.teamKidDateFieldNames\]\)\)/,
  'Valida\u00e7\u00e3o da equipe deve abranger os sete campos de data.');
assert.match(teamSource, /const rawNascimento = String\(data\.get\(`kidNascimento\$\{kidNumber\}`\) \|\| ''\)\.trim\(\)[\s\S]*?const normalizedNascimento = normalizeDateInput\(rawNascimento\)[\s\S]*?nascimento: normalizedNascimento/,
  'Cada nascimento infantil da equipe deve ser normalizado antes de compor a ades\u00e3o.');
assert.match(teamSource, /nascimento: normalizeDateInput\(data\.get\(fieldName\('nascimento'\)\)\)/,
  'Nascimento do titular e do c\u00f4njuge deve ser normalizado antes de salvar a pessoa.');

const productionFiles = [];
const collectProductionFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', '.agents', '.codex', 'node_modules', 'scripts', 'database', 'assets', 'supabase-import'].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectProductionFiles(entryPath);
    else if (/\.(?:js|html)$/i.test(entry.name)) productionFiles.push(entryPath);
  }
};
collectProductionFiles(root);

const nativeDatePattern = /\btype\s*=\s*["']date["']|\.type\s*=\s*["']date["']/i;
const nativeDateOccurrences = productionFiles.flatMap((file) => fs.readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((line, index) => ({ file: path.relative(root, file), line: index + 1, text: line }))
  .filter((entry) => nativeDatePattern.test(entry.text)));
assert.deepEqual(nativeDateOccurrences, [], `Ainda existem seletores nativos de data:\n${nativeDateOccurrences.map((entry) => `${entry.file}:${entry.line}`).join('\n')}`);

console.log('Campos de data: helpers, m\u00e1scara, valida\u00e7\u00e3o, invent\u00e1rio e aus\u00eancia de seletor nativo validados.');
