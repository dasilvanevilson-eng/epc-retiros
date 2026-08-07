const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'adminApp.js'), 'utf8');

const coupleSearchSelection = app.match(/searchResults\.querySelectorAll\('\[data-smp-select\]'\)[\s\S]*?\n\s*\}\)\);/u)?.[0] || '';
assert(coupleSearchSelection, 'O manipulador da busca em cascata SMP/EPC deve existir.');
assert.doesNotMatch(
  coupleSearchSelection,
  /scrollIntoView/u,
  'A selecao SMP/EPC deve manter a posicao atual da tela.',
);

const individualSearchSelection = app.match(/studentSearchResults\.querySelectorAll\('\[data-student-select\]'\)[\s\S]*?\n\s*\}\)\);/u)?.[0] || '';
assert(individualSearchSelection, 'O manipulador da busca em cascata Individual deve existir.');
assert.doesNotMatch(
  individualSearchSelection,
  /scrollIntoView/u,
  'A selecao Individual deve manter a posicao atual da tela.',
);

console.log('Busca em cascata sem rolagem validada para Individual, SMP e EPC.');
