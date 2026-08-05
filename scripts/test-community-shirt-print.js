const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');

const communitiesStart = source.indexOf('async function renderComunidades()');
const communitiesEnd = source.indexOf('\nconst badgeSettingsKey', communitiesStart);
assert(communitiesStart >= 0 && communitiesEnd > communitiesStart, 'Renderização das Comunidades não encontrada.');
const communitiesSource = source.slice(communitiesStart, communitiesEnd);

assert.match(communitiesSource, /id="print-community-shirts"[^>]*>Imprimir Nr camisetas por comunidade<\/button>/, 'O botão de impressão deve estar disponível em Comunidades.');
assert.match(communitiesSource, /const communityShirtSections = communities\.map/, 'O relatório deve respeitar as comunidades do retiro em foco.');
assert.match(communitiesSource, /\{ name: student\.nomeDele, shirt: student\.manequimDele \}/, 'O integrante masculino de SMP/EPC deve usar seu próprio nome e camiseta.');
assert.match(communitiesSource, /\{ name: student\.nomeDela, shirt: student\.manequimDela \}/, 'A integrante feminina de SMP/EPC deve usar seu próprio nome e camiseta.');
assert.match(communitiesSource, /\{ name: student\.nome, shirt: student\.camiseta \|\| student\.camisetaOutro \}/, 'A ficha individual deve usar o campo próprio de camiseta.');
assert.match(communitiesSource, /localeCompare\(String\(second\.name\), 'pt-BR'/, 'Os nomes devem ser ordenados alfabeticamente dentro da comunidade.');
assert.match(communitiesSource, /@page \{ size:A4 portrait; margin:10mm; \}/, 'A impressão deve usar A4 retrato.');
assert.match(communitiesSource, /font-size:25pt/, 'O relatório deve usar fonte de 25pt.');
assert.match(communitiesSource, /column-count:2/, 'O conteúdo deve ser distribuído em duas colunas verticais.');
assert.match(communitiesSource, /grid-template-columns:minmax\(0,1fr\) auto/, 'Nome e camiseta devem aparecer lado a lado.');
assert.match(communitiesSource, /Não há cursistas vinculados às comunidades deste retiro\./, 'Uma impressão vazia deve ser bloqueada com aviso.');

console.log('Comunidades: impressão de camisetas em A4, duas colunas e fonte 25pt validada.');
