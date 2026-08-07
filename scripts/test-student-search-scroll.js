const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'adminApp.js'), 'utf8');

const coupleSearchSelection = app.match(/searchResults\.querySelectorAll\('\[data-smp-select\]'\)[\s\S]*?\n\s*\}\)\);/u)?.[0] || '';
assert(coupleSearchSelection, 'O manipulador da busca em cascata SMP/EPC deve existir.');
assert.match(
  coupleSearchSelection,
  /app\.querySelector\('\.cursista-smp-file-number'\)\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/u,
  'SMP/EPC devem rolar ate o painel do numero da ficha.',
);
assert.doesNotMatch(
  coupleSearchSelection,
  /form\.scrollIntoView/u,
  'A selecao SMP/EPC nao deve rolar diretamente ate o formulario.',
);

const individualSearchSelection = app.match(/studentSearchResults\.querySelectorAll\('\[data-student-select\]'\)[\s\S]*?\n\s*\}\)\);/u)?.[0] || '';
assert(individualSearchSelection, 'O manipulador da busca em cascata Individual deve existir.');
assert.match(
  individualSearchSelection,
  /app\.querySelector\('\.student-file-number'\)\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/u,
  'Individual deve rolar ate o painel do numero da ficha.',
);
assert.doesNotMatch(
  individualSearchSelection,
  /form\.scrollIntoView/u,
  'A selecao Individual nao deve rolar diretamente ate o formulario.',
);

console.log('Rolagem da busca em cascata validada para Individual, SMP e EPC.');
