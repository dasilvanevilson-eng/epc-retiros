const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const app = await readFile(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
  const normalizeDateInput = app.match(/const normalizeDateInput = \(value = ''\) => \{[^]*?\n\};/)?.[0];
  assert(normalizeDateInput, 'Função normalizeDateInput não encontrada.');
  const functionNames = [
    'ageFromBirthAt',
    'kidBirthDateReadyForAgeCheck',
    'kidExceedsRetreatAgeLimit',
    'cursistaKidExceedsRetreatAgeLimit',
    'retreatKidsAgeLimitLabel',
  ];
  const functions = [normalizeDateInput, ...functionNames.map((name) => {
    const match = app.match(new RegExp(`function ${name}\\([^]*?\\n\\}`, 'm'));
    assert(match, `Função ${name} não encontrada.`);
    return match[0];
  })].join('\n');
  const context = { module: { exports: {} }, Date };
  vm.runInNewContext(`${functions}\nmodule.exports = { cursistaKidExceedsRetreatAgeLimit, retreatKidsAgeLimitLabel };`, context);
  const { cursistaKidExceedsRetreatAgeLimit, retreatKidsAgeLimitLabel } = context.module.exports;

  const retreat = { dataInicio: '2026-10-09', idadeMaximaEspacoKids: 10 };
  assert.equal(retreatKidsAgeLimitLabel(retreat), 'Idade máxima: 10 anos');
  assert.equal(retreatKidsAgeLimitLabel({ idadeMaximaEspacoKids: 1 }), 'Idade máxima: 1 ano');
  assert.equal(retreatKidsAgeLimitLabel({ idadeMaximaEspacoKids: 0 }), 'Idade máxima: não definida');
  assert.equal(retreatKidsAgeLimitLabel({}), 'Idade máxima: não definida');

  assert.equal(cursistaKidExceedsRetreatAgeLimit(retreat, '09/10/2015'), true, '11 anos completos deve avisar.');
  assert.equal(cursistaKidExceedsRetreatAgeLimit(retreat, '2015-10-10'), false, 'Na véspera do aniversário, ainda tem 10 anos.');
  assert.equal(cursistaKidExceedsRetreatAgeLimit(retreat, '2016-10-09'), false, 'Idade exatamente igual ao limite deve ser aceita.');
  assert.equal(cursistaKidExceedsRetreatAgeLimit({ ...retreat, dataInicio: '09/10/2026' }, '09/10/2015'), true, 'A data inicial também deve ser normalizada antes do cálculo.');
  assert.equal(cursistaKidExceedsRetreatAgeLimit({ ...retreat, idadeMaximaEspacoKids: 0 }, '2010-01-01'), false, 'Sem limite não deve avisar.');
  assert.equal(cursistaKidExceedsRetreatAgeLimit({ idadeMaximaEspacoKids: 10 }, '2010-01-01'), false, 'Sem data inicial não deve avisar.');
  assert.equal(cursistaKidExceedsRetreatAgeLimit(retreat, 'data inválida'), false, 'Data inválida não deve disparar aviso de idade.');

  assert.match(app, /form\.querySelectorAll\('\[name\^="smpKidNascimento"\]'\)/, 'O aviso deve observar os cinco campos compartilhados.');
  assert.match(app, /alert\('Criança acima da idade permitida pra esse retiro'\)/, 'Texto do alerta não encontrado.');
  const ageWarningHandler = app.match(/form\.querySelectorAll\('\[name\^="smpKidNascimento"\]'\)[^]*?\n  \}\);/)?.[0] || '';
  assert(ageWarningHandler, 'Evento compartilhado de aviso de idade não encontrado.');
  assert.doesNotMatch(ageWarningHandler, /setCustomValidity|return false/, 'O alerta de idade não pode invalidar ou bloquear o formulário.');
  assert.match(app, /save: isEpc \? dataService\.saveCursistasEpc|save: isEpc \? dataService\.saveCursistaEpc : dataService\.saveCursistaSmp/, 'Os serviços separados de EPC e SMP devem permanecer configurados.');

  console.log('Cursistas SMP/EPC: indicação e aviso não bloqueante de idade validados.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
