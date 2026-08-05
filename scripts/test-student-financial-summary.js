const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const summaryStart = appSource.indexOf('const financialSummaryTotals');
const summaryEnd = appSource.indexOf('\nfunction renderCursistaSmpScreen', summaryStart);
assert(summaryStart >= 0 && summaryEnd > summaryStart, 'Gerador do resumo financeiro não encontrado.');
const summarySource = appSource.slice(summaryStart, summaryEnd);

assert.match(summarySource, /<th>Forma de pagamento<\/th><th>Observação<\/th>/, 'O resumo deve exibir as duas novas colunas.');
assert.match(summarySource, /row\.formaPagamento \|\| 'Não informado'/, 'A forma de pagamento ausente deve possuir fallback visual.');
assert.match(summarySource, /row\.observacao \|\| '—'/, 'A observação ausente deve possuir fallback visual.');
assert.match(summarySource, /<td colspan="6">/, 'A linha vazia deve abranger as seis colunas.');
assert.match(summarySource, /'Forma de pagamento', 'Observação'/, 'A planilha deve conter as duas novas colunas.');
assert.match(summarySource, /row\.formaPagamento \|\| '', row\.observacao \|\| ''/, 'A planilha deve exportar os dados de pagamento.');

const coupleStart = appSource.indexOf('function setupCoupleStudentFinancialSummary');
const coupleEnd = appSource.indexOf('\nasync function renderCursistaSmp()', coupleStart);
const coupleSource = appSource.slice(coupleStart, coupleEnd);
assert.match(coupleSource, /formaPagamento: record\.recebedorFormaPagamentoSmp \|\| ''/, 'SMP/EPC devem usar o campo próprio da forma de pagamento.');
assert.match(coupleSource, /observacao: record\.recebedorObservacaoSmp \|\| ''/, 'SMP/EPC devem usar o campo próprio da observação.');

const individualStart = appSource.indexOf('const financialSummaryTitle');
const individualEnd = appSource.indexOf('\n  const findPersonFromArchive', individualStart);
const individualSource = appSource.slice(individualStart, individualEnd);
assert.match(individualSource, /formaPagamento: student\.formaPagamento \|\| student\.recebedorFormaPagamento \|\| ''/, 'Individual deve usar o campo próprio da forma de pagamento.');
assert.match(individualSource, /observacao: student\.observacaoPagamento \|\| student\.recebedorObservacao \|\| ''/, 'Individual deve usar o campo próprio da observação.');

assert.match(stylesSource, /\.student-financial-summary-preview th:nth-child\(5\)/, 'A nova coluna de pagamento deve possuir largura controlada.');
assert.match(stylesSource, /\.student-financial-summary-preview th:nth-child\(6\)/, 'A nova coluna de observação deve possuir largura controlada.');

console.log('Cursistas: forma de pagamento e observação incluídas no resumo financeiro dos três tipos de ficha.');
