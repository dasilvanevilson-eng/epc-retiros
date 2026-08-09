const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
const choicesSource = app.match(/function choices\(name, options, multiple = true\) \{([^\n]+)\}/)?.[1] || '';

assert(choicesSource, 'A função compartilhada das opções deve existir.');
assert.match(choicesSource, /name === 'camiseta' && !options\.includes\('16'\)/, 'A inclusão deve ficar limitada ao campo camiseta.');
assert.match(choicesSource, /option === 'PP' \? \['16', option\] : \[option\]/, 'O tamanho 16 deve aparecer imediatamente antes de PP.');
assert.match(app, /choices\('camiseta', \['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'\], false\)/, 'A alteração deve permanecer na ficha de Cursista Individual.');

const reportOrders = [...app.matchAll(/const shirtOrder = \['8', '10', '12', '14', '16', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'\]/g)];
assert.equal(reportOrders.length, 2, 'Os dois relatórios de camisetas devem reconhecer e ordenar o tamanho 16.');

console.log('Cursista Individual: tamanho 16 incluído entre 14 e PP sem migração de fichas existentes.');
