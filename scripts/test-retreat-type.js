const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');

const types = ['Taschinha', 'Girassol', 'ONDA', 'EJA', 'EJU', 'EPC', 'SMP', 'EIS-ME AQUI'];
for (const type of types) assert(app.includes(`'${type}'`), `Tipo de retiro ausente: ${type}`);
assert.match(app, /<select name="tipoRetiro" required>\$\{retreatTypeOptions\(\)\}<\/select>/, 'A criação deve exigir o tipo do retiro.');
assert.match(app, /<select name="tipoRetiro" required>\$\{retreatTypeOptions\(retreat\.tipoRetiro\)\}<\/select>/, 'A edição deve carregar o tipo salvo.');
assert.match(app, /form\.elements\.tipoRetiro\.value = source\?\.tipoRetiro \|\| ''/, 'A cópia da estrutura deve copiar o tipo do retiro.');
assert.match(app, /tipoRetiro: values\.get\('tipoRetiro'\)/, 'A criação deve persistir o tipo do retiro.');
assert.match(app, /copyFinanceRecurringStructureToRetreat\(sourceRetreatId, retreat\)/, 'A criação baseada em outro retiro deve copiar a estrutura dos insumos recorrentes do Financeiro.');
assert.match(app, /cloneRecurringStructureSheet\(\{ retreat: targetRetreat, sector, sourceRetreat, sourceSheet, id: createId\(\) \}\)/, 'A cópia financeira deve criar planilhas novas e zeradas para o retiro destino.');
assert.match(app, /Object\.assign\(retreat, \{ nome: values\.get\('nome'\)\.trim\(\), tipoRetiro: values\.get\('tipoRetiro'\)/, 'A edição deve persistir o tipo do retiro.');
assert.match(api, /allowedRetreatTypes/);
assert.match(api, /Tipo do retiro invalido/);
assert.match(adapter, /record\.tipoRetiro && !allowedRetreatTypes\.has\(record\.tipoRetiro\)/, 'O adaptador relacional deve validar o valor.');
assert.doesNotMatch(adapter, /tipo_retiro/, 'O tipo deve permanecer em extras, sem exigir migração da tabela de retiros.');

console.log('Configurações: seleção e persistência do tipo do retiro validadas.');
