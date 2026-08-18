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
assert.match(printSource, /const photoFrameSize = individual \? 'width:31\.2mm;height:41\.6mm' : 'width:49\.4mm;height:37\.05mm'/, 'As fotos Individual, SMP e EPC devem ser impressas com aumento de 30%.');
assert.match(printSource, /class="print-photo-frame"[^>]*\$\{photoFrameSize\};margin:0 auto/, 'O espaço da foto deve ficar centralizado horizontalmente na impressão.');
assert.match(printSource, /const photoPrint = `<section[\s\S]*Foto não cadastrada[\s\S]*\$\{photoImage\}/, 'O quadro da foto deve ser impresso mesmo sem uma imagem cadastrada.');
assert.match(printSource, /onerror="this\.remove\(\)"/, 'Uma falha ao carregar a foto deve remover apenas a imagem e preservar o quadro.');
assert.doesNotMatch(printSource, /onerror="this\.closest\('section'\)\.remove\(\)"/, 'A falha da imagem não pode remover o espaço reservado para a foto.');
assert.match(printSource, /Math\.min\(1,[\s\S]*page\.clientHeight \/ Math\.max\(sheet\.scrollHeight, 1\)/, 'Conteúdo extenso deve ser reduzido proporcionalmente para caber na página.');
assert.match(printSource, /studentRegistrationPrintBatchDocument[\s\S]*studentRegistrationPrintDocument\(\{ retreat, record, studentFormType \}\)/, 'A impressão em lote deve reutilizar o mesmo gerador das fichas individuais.');
assert.match(printSource, /break-after:page;page-break-after:always/, 'Cada ficha do lote deve ocupar uma página própria.');
assert.match(printSource, /Dados pessoais[\s\S]*Endereço[\s\S]*Formação e vivência[\s\S]*Família e convite[\s\S]*Saúde e cuidados/, 'A ficha Individual deve conter as seções operacionais do cadastro.');
assert.match(printSource, /É batizado\(a\)\?[\s\S]*Fez primeira comunhão\?[\s\S]*Estuda\?[\s\S]*Série[\s\S]*Escola[\s\S]*Fez algum retiro\?[\s\S]*Qual retiro\?[\s\S]*'print-formation-grid'/, 'Formação e vivência deve manter a sequência solicitada.');
assert.match(printSource, /\.print-formation-grid\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/, 'Formação e vivência deve permitir linhas de duas e três colunas.');
assert.match(printSource, /nth-child\(1\)[\s\S]*nth-child\(2\)[\s\S]*nth-child\(6\)[\s\S]*nth-child\(7\)\{grid-column:span 3\}/, 'A primeira e a terceira linhas devem possuir dois campos.');
assert.match(printSource, /nth-child\(3\)[\s\S]*nth-child\(4\)[\s\S]*nth-child\(5\)\{grid-column:span 2\}/, 'A segunda linha deve possuir três campos.');
assert.match(printSource, /Nome do pai[\s\S]*Telefone do pai[\s\S]*Nome da mãe[\s\S]*Telefone da mãe[\s\S]*'print-family-grid'/, 'Mãe e telefone devem aparecer logo abaixo de pai e telefone em duas colunas.');
assert.match(printSource, /Intolerância alimentar\?[\s\S]*Qual intolerância\?[\s\S]*Alergia a medicamentos\?[\s\S]*Qual medicamento\?[\s\S]*Medicamento contínuo\?[\s\S]*Qual medicamento\?[\s\S]*Medicamento para dor de cabeça[\s\S]*Medicamento para dor no estômago[\s\S]*'print-health-grid'/, 'Saúde e cuidados deve manter a sequência solicitada.');
assert.match(printSource, /\.print-family-grid,\.print-health-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/, 'Família e saúde devem usar duas colunas na impressão.');
assert.match(printSource, /dependsOn && normalizeText\(record\?\.\[dependsOn\]\) === 'nao'[\s\S]*\? ''/, 'Descrições condicionais devem ficar em branco quando a resposta for Não.');
for (const dependency of ['estuda', 'fezRetiro', 'paisMovimento', 'intoleranciaAlimentos', 'alergiaMedicamento', 'medicamentoContinuo']) {
  assert.match(printSource, new RegExp(`'${dependency}'`), `A impressão deve respeitar a resposta de ${dependency}.`);
}
assert.match(printSource, /<th>Informação<\/th><th>Ele<\/th><th>Ela<\/th>/, 'SMP e EPC devem usar o quadro comparativo Ele e Ela.');
assert.match(printSource, /\['Qual movimento\?', 'qualMovimentoDele', 'qualMovimentoDela', '', 'movimentoIgrejaDele', 'movimentoIgrejaDela'\]/);
assert.match(printSource, /\['Qual problema de saúde\?', 'qualSaudeDele', 'qualSaudeDela', '', 'saudeDele', 'saudeDela'\]/);
assert.match(printSource, /\['Qual intolerância\?', 'qualIntoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDela', '', 'intoleranciaAlimentarDele', 'intoleranciaAlimentarDela'\]/);
assert.match(printSource, /studentRegistrationPrintConditionalValue\(printRecord, hisKey, type, hisDependsOn\)[\s\S]*studentRegistrationPrintConditionalValue\(printRecord, herKey, type, herDependsOn\)/, 'Os campos Qual do casal devem respeitar separadamente as respostas dele e dela.');
assert.match(printSource, /Contato de emergência/, 'As informações comuns específicas do EPC devem ser contempladas.');
assert.match(printSource, /Familiar ou amigo/, 'As informações comuns específicas do SMP devem ser contempladas.');
assert.match(printSource, /Informações em comum/, 'A ficha de casal deve identificar os dados compartilhados.');
assert.match(printSource, /const addressFields = \[[\s\S]*CEP[\s\S]*Endereço[\s\S]*Número[\s\S]*Apartamento[\s\S]*Bairro[\s\S]*Cidade[\s\S]*Estado[\s\S]*studentFormType === 'cursista-smp'[\s\S]*Informações em comum[\s\S]*Endereço/, 'A impressão SMP deve separar o endereço das demais informações em comum.');
assert.match(printSource, /studentRegistrationPrintFieldGrid\(record, commonFields, 'print-smp-common-grid'\)/, 'As informações em comum do SMP devem possuir layout próprio.');
assert.match(printSource, /\.print-smp-common-grid\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/, 'A grade SMP deve permitir linhas completas com um, dois ou três campos.');
assert.match(printSource, /nth-child\(4\)\{grid-column:span 6\}/, 'O campo anterior a Apresentante deve completar sua linha.');
assert.match(printSource, /nth-child\(8\)[\s\S]*nth-child\(9\)[\s\S]*nth-child\(10\)[\s\S]*nth-child\(11\)\{grid-column:span 3\}/, 'As duas linhas finais devem ter dois campos e contornos completos.');
assert.match(printSource, /studentFormType === 'cursista-epc' \? \[[\s\S]*\.\.\.addressFields/, 'A impressão EPC deve permanecer com o endereço dentro das informações em comum.');
assert.match(printSource, /studentRegistrationPrintFieldGrid\(record, commonFields, 'print-epc-common-grid'\)/, 'As informações em comum do EPC devem possuir layout próprio.');
assert.match(printSource, /\.print-epc-common-grid\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/, 'A grade EPC deve permitir a quebra antes do E-mail sem interromper os contornos.');
assert.match(printSource, /\.print-epc-common-grid \.print-field:nth-child\(7\)\{grid-column:span 6\}/, 'O Estado deve completar a linha anterior para que E-mail inicie a seguinte.');
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
assert.match(app, /name="coupleNameSearch"[^>]*placeholder="Digite o nome dele ou dela"/, 'A impressão completa de casais deve permitir busca pelo nome dele ou dela.');
assert.match(app, /<span>Buscar pelo nome<\/span><input name="coupleNameSearch"/);
assert.match(app, /coupleNameSearchInput\?\.addEventListener\('focus', renderCoupleSearchResults\)/, 'A lista de casais deve abrir ao focar o campo de busca.');
assert.match(app, /coupleNameSearchInput\?\.addEventListener\('input',[\s\S]*renderCoupleSearchResults\(\)/, 'A lista de casais deve ser refinada durante a digitação.');
assert.match(app, /const matches = records\.filter\(\(record\) => normalizeText\(`\$\{record\.nomeDele \|\| ''\} \$\{record\.nomeDela \|\| ''\}`\)\.includes\(query\)\)/);
assert.match(app, /data-complete-student-sheet-search-result[\s\S]*selectedCoupleRecord = matches/, 'A lista suspensa deve permitir selecionar exatamente um casal.');
assert.match(app, /const hasRange = hasInitial \|\| hasFinal;[\s\S]*if \(!hasRange && !nameQuery\)/, 'A busca por nome deve funcionar sem remover o filtro atual por intervalo.');
assert.match(app, /if \(hasRange\)[\s\S]*fileNumber >= initial && fileNumber <= final[\s\S]*if \(nameQuery\)[\s\S]*record\.nomeDele[\s\S]*record\.nomeDela/, 'Intervalo e nome devem poder ser aplicados em conjunto.');
assert.match(app, /coupleNameSearchInput\.disabled = printAllInput\.checked/, 'Imprimir todas deve continuar ignorando e desabilitando os demais filtros.');

console.log('Impressão A4 das fichas Individual, SMP e EPC validada.');
