const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
const functionSource = source.match(/const badgeSectorDisplayName = \(sector = '', names = \{\}\) => \{[\s\S]*?\n\};\nconst badgeSectorText = \(entry, sector = '', names = \{\}, applyConfiguredNames = true\) => \{[\s\S]*?\n\};/)?.[0];

assert(functionSource, 'Não foi possível localizar o gerador do setor do crachá.');
const normalizeText = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const { badgeSectorText, badgeSectorDisplayName } = Function('normalizeText', `${functionSource}; return { badgeSectorText, badgeSectorDisplayName };`)(normalizeText);

assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Cozinha'] }), 'Coord Cozinha');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Secretaria'] }), 'Coord Secretaria');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Coordenação do retiro'] }), 'Coordenação do retiro');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Coordenação de sala'] }), 'Coordenação de sala');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['coordenacao geral'] }), 'coordenacao geral');
assert.equal(badgeSectorText({ coordenacaoSetor: false, setores: ['CASAL BEM-ESTAR'] }), 'CASAL BEM-ESTAR');
assert.equal(badgeSectorText({ coordenacaoSetor: false, setores: ['RECEBEDOR(ES)'] }), 'RECEBEDOR(ES)');
assert.equal(badgeSectorText({ coordenacaoSetor: false, setores: ['SINETEIRA(S)'] }), 'SINETEIRA(S)');
assert.equal(badgeSectorText({ coordenacaoSetor: false, setores: ['Cozinha'] }), 'Cozinha');
assert.equal(badgeSectorText({ setores: ['Cozinha', 'Secretaria'] }), 'Cozinha, Secretaria');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Cozinha'] }, 'Espaço Kids'), 'Coord Espaço Kids');
assert.equal(badgeSectorText({ coordenacaoSetor: true, setores: ['Cozinha'] }, 'Cozinha', { Cozinha: 'COZINHA CENTRAL' }), 'Coord COZINHA CENTRAL');
assert.equal(badgeSectorText({ setores: ['Cozinha', 'Secretaria'] }, '', { cozinha: 'COZINHA CENTRAL', Secretaria: 'APOIO' }), 'COZINHA CENTRAL, APOIO');
assert.equal(badgeSectorText({ coordenacaoSetor: false }, 'Cursista', { Cursista: 'Não aplicar' }, false), 'Cursista');
assert.equal(badgeSectorDisplayName('Recebedor(es)', {}), 'Recebedor(es)');
assert.equal(badgeSectorText({ coordenacaoSetor: false, setores: [] }), 'Sem setor');
assert(!functionSource.includes('Coordenador'), 'O crachá não deve exibir a palavra completa para coordenação de setor.');
assert(!functionSource.includes('badgeSectorAliases'), 'Os aliases fixos de setor devem ser removidos.');

console.log('Crachás: nomes configuráveis e abreviação Coord validados para visualização e impressão.');
