const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');

const printStart = app.indexOf('const studentRegistrationPrintValue');
const printEnd = app.indexOf('\nfunction setHomeStatPrintOptions', printStart);
assert(printStart >= 0 && printEnd > printStart, 'O gerador compartilhado da ficha deve existir.');
const printSource = app.slice(printStart, printEnd);

assert.match(printSource, /Não informado/, 'Campos vazios devem ser identificados na impressão.');
assert.match(printSource, /@page\{size:A4 portrait;margin:8mm\}/, 'Todas as fichas devem usar A4 vertical.');
assert.match(printSource, /\.print-page\{[^}]*width:194mm;height:281mm;overflow:hidden/, 'A área impressa deve ficar limitada a uma página A4.');
assert.match(printSource, /Math\.min\(1,[\s\S]*page\.clientHeight \/ Math\.max\(sheet\.scrollHeight, 1\)/, 'Conteúdo extenso deve ser reduzido proporcionalmente para caber na página.');
assert.match(printSource, /Dados pessoais[\s\S]*Endereço[\s\S]*Formação e vivência[\s\S]*Família e convite[\s\S]*Saúde e cuidados/, 'A ficha Individual deve conter as seções operacionais do cadastro.');
assert.match(printSource, /<th>Informação<\/th><th>Ele<\/th><th>Ela<\/th>/, 'SMP e EPC devem usar o quadro comparativo Ele e Ela.');
assert.match(printSource, /Contato de emergência/, 'As informações comuns específicas do EPC devem ser contempladas.');
assert.match(printSource, /Familiar ou amigo/, 'As informações comuns específicas do SMP devem ser contempladas.');
assert.match(printSource, /Informações em comum/, 'A ficha de casal deve identificar os dados compartilhados.');
assert.doesNotMatch(printSource, /smpKid|Espaço Kids|valorInscricao|valorPago|saldoPagar|recebedor|formaPagamento|observacaoPagamento/, 'A ficha impressa não pode conter Espaço Kids nem informações financeiras.');
assert.match(printSource, /window\.open\('', '_blank'\)[\s\S]*O navegador bloqueou a janela de impressão/, 'O fluxo deve abrir uma prévia isolada e tratar bloqueio de pop-up.');
for (const marker of [/retreat\?\.nome/, /fileNumber/, /participantName/, /generatedAt/]) {
  assert.match(printSource, marker, 'O cabeçalho deve identificar retiro, ficha, participante e emissão.');
}

assert.match(app, /id="print-selected-student"[^>]*>Imprimir ficha<\/button>/, 'O Individual deve possuir a ação de impressão autenticada.');
assert.match(app, /id="print-cursista-smp"[^>]*hidden>Imprimir ficha<\/button>/, 'SMP e EPC devem possuir a ação inicialmente oculta.');
assert.match(app, /loadRecord = \(record\)[\s\S]*printButton\.hidden = false/, 'A impressão SMP/EPC deve aparecer ao carregar registro salvo.');
assert.match(app, /editButton\.addEventListener\('click'[\s\S]*printButton\.hidden = true/, 'A impressão SMP/EPC deve ser ocultada durante edição.');
assert.match(app, /loadStudent = \(student\)[\s\S]*selectedStudentRecord = student[\s\S]*printSelectedStudent\.hidden = !selectedStudentId/, 'A impressão Individual deve usar o registro persistido carregado.');
assert.match(app, /editSelectedStudent\?\.addEventListener\('click'[\s\S]*printSelectedStudent\.hidden = true/, 'A impressão Individual deve ser ocultada durante edição.');
assert.match(app, /if \(publicContext\)[\s\S]*student-heading-actions'\)\?\.remove\(\)/, 'O acesso público Individual deve remover as ações autenticadas.');
assert.match(app, /prepareSharedPublicCoupleStudentForm[\s\S]*cursista-smp-tools/, 'O acesso público SMP/EPC deve remover a barra que contém a impressão.');

console.log('Impressão A4 das fichas Individual, SMP e EPC validada.');
