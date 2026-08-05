const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
const functionSource = source.match(/const badgeSectorText = \(entry, sector = ''\) => \{[\s\S]*?\n\};/)?.[0];

assert(functionSource, 'Não foi possível localizar o gerador do setor do crachá.');
const badgeSectorText = Function(`${functionSource}; return badgeSectorText;`)();

assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Cozinha'] }), 'Coord Cozinha');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Secretaria'] }), 'Coord Secretaria');
assert.equal(badgeSectorText({ coordenacaoSetor: false, setores: ['Cozinha'] }), 'Cozinha');
assert.equal(badgeSectorText({ setores: ['Cozinha', 'Secretaria'] }), 'Cozinha, Secretaria');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Cozinha'] }, 'Espaço Kids'), 'Coord Espaço Kids');
assert.equal(badgeSectorText({ coordenacaoSetor: false, setores: [] }), 'Sem setor');
assert(!functionSource.includes('Coordenador'), 'O crachá não deve mais exibir a palavra completa para coordenação de setor.');

console.log('Crachás: abreviação Coord validada para visualização e impressão.');
