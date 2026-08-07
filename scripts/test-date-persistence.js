const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { dateOnlyOrNull } = require('../databaseAdapter');

assert.equal(dateOnlyOrNull('2024-02-29'), '2024-02-29');
assert.equal(dateOnlyOrNull('29/02/2024'), '2024-02-29');
assert.equal(dateOnlyOrNull(' 07/01/1940 '), '1940-01-07');
assert.equal(dateOnlyOrNull('0001-01-01'), '0001-01-01');
assert.equal(dateOnlyOrNull(''), null);
assert.equal(dateOnlyOrNull('   '), null);
assert.equal(dateOnlyOrNull(null), null);
assert.equal(dateOnlyOrNull(undefined), null);

[
  '2023-02-29',
  '29/02/2023',
  '31/04/2024',
  '2024-13-01',
  '00/01/2024',
  '2024/01/01',
  '01-01-2024',
  '0000-01-01',
  'data invalida',
].forEach((value) => assert.throws(
  () => dateOnlyOrNull(value),
  /Data invalida/,
  `A data ${value} deveria ser rejeitada.`,
));

const adapter = fs.readFileSync(path.join(__dirname, '..', 'databaseAdapter.js'), 'utf8');
[
  /data_inicio: dateOnlyOrNull\(record\.dataInicio\)/,
  /data_termino: dateOnlyOrNull\(record\.dataTermino\)/,
  /nascimento: dateOnlyOrNull\(record\.nascimento\)/,
  /nascimento: dateOnlyOrNull\(kid\.nascimento\)/,
  /ele_nascimento: dateOnlyOrNull\(record\.nascimentoDele\)/,
  /ele_data_primeiro_casamento: dateOnlyOrNull\(record\.casamentoDele\)/,
  /ela_nascimento: dateOnlyOrNull\(record\.nascimentoDela\)/,
  /ela_data_primeiro_casamento: dateOnlyOrNull\(record\.casamentoDela\)/,
  /comum_data_uniao_casal: dateOnlyOrNull\(record\.uniaoCasal\)/,
  /comum_kid_1_nascimento: dateOnlyOrNull\(record\.smpKidNascimento1\)/,
  /comum_kid_2_nascimento: dateOnlyOrNull\(record\.smpKidNascimento2\)/,
  /comum_kid_3_nascimento: dateOnlyOrNull\(record\.smpKidNascimento3\)/,
  /comum_kid_4_nascimento: dateOnlyOrNull\(record\.smpKidNascimento4\)/,
  /comum_kid_5_nascimento: dateOnlyOrNull\(record\.smpKidNascimento5\)/,
  /comum_data_casamento_religioso: dateOnlyOrNull\(record\.uniaoCasal\)/,
  /rowData\[`comum_kid_\$\{kidNumber\}_nascimento`\] = dateOnlyOrNull\(record\[`smpKidNascimento\$\{kidNumber\}`\]\)/,
].forEach((pattern) => assert.match(adapter, pattern));

assert.match(adapter, /termo_voluntariado_aceito_em: dateOrNull\(record\.termoVoluntariadoAceitoEm\)/);
assert.match(adapter, /validado_em: dateOrNull\(record\.validadoEm\)/);
assert.doesNotMatch(adapter, /(?:data_inicio|data_termino|ele_nascimento|ela_nascimento|comum_data_[a-z_]+|comum_kid_[1-5]_nascimento): dateOrNull\(/);

const saveEnrolmentSource = adapter.slice(
  adapter.indexOf('async function saveEnrolment(record)'),
  adapter.indexOf('function mapStudent'),
);
assert(
  saveEnrolmentSource.indexOf('const spaceKidsRows =') < saveEnrolmentSource.indexOf("await upsert('adesoes'"),
  'Datas das crianças devem ser validadas antes de qualquer escrita da adesão.',
);

console.log('Persistencia de datas: conversao ISO/BR, calendario real e separacao de timestamps validadas.');
