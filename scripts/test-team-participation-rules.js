const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
assert.match(adminSource, /<span>02<\/span><div><h2>Quais retiros fez como CURSISTA na Família EPC\?<\/h2><\/div>/, 'O tópico 2 deve identificar que os retiros foram realizados como cursista.');
assert.doesNotMatch(adminSource, /Conte-nos quais retiros você já fez na família EPC\./, 'O tópico 2 não deve manter o comentário anterior.');
const serviceSource = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');

assert.match(adminSource, /isSpiritualDirectionRegistration[\s\S]*?normalizeText\('Direção Espiritual'\)/, 'A dispensa deve ser exclusiva do setor Direção Espiritual.');
assert.match(adminSource, /spiritualDirectionRegistration \? \[\] : \['retiros'\]/, 'Retiro(s) que fez não deve bloquear Direção Espiritual.');
assert.match(adminSource, /retirosAnteriores: dispensaRetirosAnteriores \? \[\] : checkedValues/, 'Direção Espiritual deve salvar a lista de retiros vazia.');
assert.match(adminSource, /Qual retiro você fez mais recente\?/, 'A confirmação EPC/SMP deve usar a pergunta definida.');
assert.match(adminSource, /data-recent-retreat="SMP"[\s\S]*?data-recent-retreat="EPC"/, 'A confirmação deve oferecer SMP e EPC.');
assert.match(adminSource, /selectedMostRecentEpcSmp\('retiros'/, 'A primeira pessoa deve confirmar o retiro mais recente.');
assert.match(adminSource, /selectedMostRecentEpcSmp\('spouseRetiros'/, 'O segundo cônjuge deve confirmar o retiro mais recente separadamente.');
assert.match(adminSource, /retiroMaisRecenteEpcSmp: dispensaRetirosAnteriores \? '' : retiroMaisRecenteEpcSmp/, 'A escolha EPC/SMP deve ser gravada na adesão.');
assert.match(adminSource, /normalized\.has\(normalizeText\('EPC'\)\)[\s\S]*?normalized\.has\(normalizeText\('SMP'\)\)[\s\S]*?mostRecentEpcSmp/, 'Pessoas por grupo deve priorizar a escolha salva quando EPC e SMP estiverem marcados.');

[serviceSource, apiSource, adapterSource].forEach((source) => {
  assert.match(source, /field === 'retirosAnteriores' && .*dispensaRetirosAnteriores === true/, 'Cada camada deve permitir a limpeza intencional somente para Direção Espiritual.');
});

console.log('Equipe: regras de Direção Espiritual e confirmação EPC/SMP validadas.');
