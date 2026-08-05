const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');

const quadranteStart = source.indexOf('async function renderQuadrante()');
const quadranteEnd = source.indexOf('\nfunction choices(', quadranteStart);
assert(quadranteStart >= 0 && quadranteEnd > quadranteStart, 'Renderização do Quadrante não encontrada.');
const quadranteSource = source.slice(quadranteStart, quadranteEnd);

assert.match(quadranteSource, /id="print-secret-friend"[^>]*>Imprimir relatório para amigo secreto<\/button>/, 'O botão do relatório para amigo secreto deve estar disponível no Quadrante.');
assert.match(quadranteSource, /const secretFriendRows = sectors\s*\.filter\(\(sector\) => sectorArea\(sector\) === 'escondida'\)/, 'Somente setores configurados e classificados como Equipe escondida devem ser considerados.');
assert.match(quadranteSource, /\.filter\(\(entry\) => entryHasSector\(entry, sector\)\)/, 'As pessoas devem ser vinculadas ao respectivo setor.');
assert.match(quadranteSource, /\.sort\(\(first, second\) => byName\(first\.person, second\.person\)\)/, 'Os nomes devem ser ordenados alfabeticamente dentro de cada setor.');
assert.match(quadranteSource, /<th>Nome completo<\/th><th>Setor de trabalho<\/th>/, 'A impressão deve exibir nome completo e setor lado a lado.');
assert.match(quadranteSource, /body \{[^}]*font-size:20pt;/, 'O relatório deve usar fonte de 20pt.');
assert.match(quadranteSource, /table \{[^}]*font-size:20pt;/, 'A tabela deve manter fonte de 20pt.');
assert.match(quadranteSource, /@page \{ size:A4 portrait; margin:12mm; \}/, 'A impressão deve usar A4 retrato.');
assert.match(quadranteSource, /if \(!secretFriendRows\.length\) \{ alert\('Não há pessoas da Equipe escondida para imprimir neste retiro\.'\); return; \}/, 'Uma impressão vazia deve ser bloqueada com aviso.');
assert.match(quadranteSource, /document\.write\(secretFriendPrintDocument\(\)\)/, 'A janela deve receber somente o documento do relatório para amigo secreto.');
assert.match(quadranteSource, /#print-secret-friend'\)\?\.addEventListener\('click', printSecretFriendReport\)/, 'O botão deve acionar a impressão dedicada.');

console.log('Quadrante: relatório individual para amigo secreto validado.');
