const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');

const types = ['Tachinha', 'Girassol', 'ONDA', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'];
for (const type of types) assert(app.includes(`'${type}'`), `Tipo de retiro ausente: ${type}`);
for (const legacyType of ['Taschinha', 'EIS-ME AQUI']) assert(api.includes(`'${legacyType}'`), `Tipo legado ausente na API: ${legacyType}`);
assert.match(app, /<select name="tipoRetiro" required>\$\{retreatTypeOptions\(\)\}<\/select>/, 'A criação deve exigir o tipo do retiro.');
assert.match(app, /<select name="tipoRetiro" required>\$\{retreatTypeOptions\(retreat\.tipoRetiro\)\}<\/select>/, 'A edição deve carregar o tipo salvo.');
assert.doesNotMatch(app, /<select name="tipoFichaCursista">/, 'A ficha de cursista não deve ser escolhida manualmente.');
for (const [type, studentFormType] of [['Tachinha', 'cursista-individual'], ['Girassol', 'cursista-individual'], ['ONDA', 'cursista-individual'], ['EJA', 'cursista-individual'], ['EJU', 'cursista-individual'], ['EPC', 'cursista-epc'], ['SMP', 'cursista-smp'], ['Eis-me aqui', 'cursista-individual']]) {
  assert.match(app, new RegExp(`\\['${type}', '${studentFormType}'\\]`), `O tipo ${type} deve definir a ficha ${studentFormType}.`);
}
assert.match(app, /tipoFichaCursista: studentFormTypeForRetreat\(values\.get\('tipoRetiro'\)\)/, 'A criação e a edição devem gravar a ficha calculada pelo tipo.');
assert.match(api, /studentFormTypeForRetreat\(retreat\)/, 'A API deve validar a ficha calculada pelo tipo do retiro.');
assert.match(app, /form\.elements\.tipoRetiro\.value = source\?\.tipoRetiro \|\| ''/, 'A cópia da estrutura deve copiar o tipo do retiro.');
assert.match(app, /tipoRetiro: values\.get\('tipoRetiro'\)/, 'A criação deve persistir o tipo do retiro.');
assert.match(app, /copyFinanceRecurringStructureToRetreat\(sourceRetreatId, retreat\)/, 'A criação baseada em outro retiro deve copiar a estrutura dos insumos recorrentes do Financeiro.');
assert.match(app, /cloneRecurringStructureSheet\(\{ retreat: targetRetreat, sector, sourceRetreat, sourceSheet, id: createId\(\) \}\)/, 'A cópia financeira deve criar planilhas novas e zeradas para o retiro destino.');
assert.match(app, /Object\.assign\(retreat, \{ nome: values\.get\('nome'\)\.trim\(\), tipoRetiro: values\.get\('tipoRetiro'\)/, 'A edição deve persistir o tipo do retiro.');
assert.match(api, /allowedRetreatTypes/);
assert.match(api, /Tipo do retiro invalido/);
assert.match(adapter, /record\.tipoRetiro && !allowedRetreatTypes\.has\(record\.tipoRetiro\)/, 'O adaptador relacional deve validar o valor.');
assert.doesNotMatch(adapter, /tipo_retiro/, 'O tipo deve permanecer em extras, sem exigir migração da tabela de retiros.');

console.log('Configurações: tipo do retiro e ficha automática validados.');
