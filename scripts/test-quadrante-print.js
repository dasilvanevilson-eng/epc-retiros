const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');

const quadranteStart = source.indexOf('async function renderQuadrante()');
const quadranteEnd = source.indexOf('\nfunction choices(', quadranteStart);
assert(quadranteStart >= 0 && quadranteEnd > quadranteStart, 'Renderização do Quadrante não encontrada.');
const quadranteSource = source.slice(quadranteStart, quadranteEnd);

assert.match(quadranteSource, /<tbody class="quadrante-person-group">\$\{groupRows\}<\/tbody>/, 'Cada pessoa ou casal deve formar um bloco indivisível.');
assert.doesNotMatch(quadranteSource, /<tbody>\$\{groupedParticipantRows/, 'Os grupos não devem ficar presos em um único tbody por setor.');
assert.match(quadranteSource, /const quadrantePrintDocument = \(content\) =>/);
assert.match(quadranteSource, /id="print-quadrante"[^>]*>Imprimir relatório completo<\/button>/);
assert.match(quadranteSource, /@page \{ size:A4 portrait; margin:9mm 10mm; \}/);
assert.match(quadranteSource, /\.quadrante-sector,\.quadrante-communities article[^}]*break-inside:auto; page-break-inside:auto;/);
assert.match(quadranteSource, /\.quadrante-person-group,\.quadrante-person-group tr \{ break-inside:avoid; page-break-inside:avoid; \}/);
assert.match(quadranteSource, /height:auto;[^}]*white-space:normal;[^}]*overflow-wrap:anywhere;[^}]*word-break:normal;/);
assert.match(quadranteSource, /font-size:9pt; line-height:1\.2;/);
assert.match(quadranteSource, /\.quadrante-sector h3,\.quadrante-communities h3 \{[^}]*width:100%;[^}]*border-bottom:\.25mm solid #7f927f;[^}]*font-size:12pt;/, 'Setores e comunidades devem ficar 20% maiores e sublinhados até o fim da linha.');
assert.match(quadranteSource, /quadrantePrintDocument\(report\.outerHTML\)/, 'Somente o relatório deve ser enviado à janela de impressão.');
assert.match(quadranteSource, /addEventListener\('click', printQuadrante\)/);
assert.doesNotMatch(quadranteSource, /#print-quadrante'\)\?\.addEventListener\('click', \(\) => window\.print\(\)\)/);

console.log('Quadrante: impressão contínua, nomes variáveis e grupos indivisíveis validados.');
