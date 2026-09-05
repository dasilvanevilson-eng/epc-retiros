const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const dataServiceSource = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');

const receiverSaveSource = adminSource.slice(
  adminSource.indexOf('const saveFinancialEntry = async (entry) => {'),
  adminSource.indexOf('const peopleById = new Map', adminSource.indexOf('const saveFinancialEntry = async (entry) => {')),
);
const receiverRenderSource = adminSource.slice(
  adminSource.indexOf('const receiverPaymentCheckboxAttributes = (row) => ['),
  adminSource.indexOf("app.querySelector('[data-copy-receiver-link]')", adminSource.indexOf('const receiverPaymentCheckboxAttributes = (row) => [')),
);
const receiverCheckboxChangeSource = adminSource.slice(
  adminSource.indexOf("app.querySelectorAll('[data-fee-entry]').forEach((input) => input.addEventListener('change', async () => {"),
  adminSource.indexOf('async function renderPessoas', adminSource.indexOf("app.querySelectorAll('[data-fee-entry]').forEach((input) => input.addEventListener('change', async () => {")),
);
const coupleStudentNormalizeSource = adminSource.slice(
  adminSource.indexOf('record.valorInscricaoSmp = parseCurrency(record.valorInscricaoSmp);'),
  adminSource.indexOf('return record;', adminSource.indexOf('record.valorInscricaoSmp = parseCurrency(record.valorInscricaoSmp);')),
);
const receiverEnrolmentPaymentSource = dataServiceSource.slice(
  dataServiceSource.indexOf('async function saveReceiverEnrolmentPayment(enrolment) {'),
  dataServiceSource.indexOf('export const retreatDefaults', dataServiceSource.indexOf('async function saveReceiverEnrolmentPayment(enrolment) {')),
);

assert.match(
  receiverSaveSource,
  /valorPago:\s*__sourceRecord\?\.valorPago\s*\?\?\s*entry\.valorPago/,
  'Recebedor logado deve preservar o valor pago informado na ficha do cursista individual.',
);
assert.match(
  receiverSaveSource,
  /saldoPagar:\s*__sourceRecord\?\.saldoPagar\s*\?\?\s*entry\.saldoPagar/,
  'Recebedor logado deve preservar o saldo informado/calculado pela ficha do cursista individual.',
);
assert.doesNotMatch(
  receiverSaveSource,
  /valorPagoSmp:\s*entry\.valorPago|saldoPagarSmp:\s*Math\.max/,
  'Recebedor logado nao deve recalcular nem sobrescrever campos financeiros da ficha SMP/EPC.',
);
assert.match(
  receiverSaveSource,
  /recebedorValorPagoSmp:\s*entry\.recebedorValorPago[\s\S]*recebedorTaxaPagaSmp:\s*entry\.recebedorTaxaPaga/,
  'Recebedor logado deve salvar apenas os campos financeiros proprios do recebedor em SMP/EPC.',
);
assert.match(
  receiverSaveSource,
  /dataService\.saveRecebedorAdesao\(entry\)/,
  'Recebedor logado deve salvar ficha de trabalho por um caminho financeiro especifico.',
);
assert.doesNotMatch(
  receiverSaveSource,
  /dataService\.saveAdesao\(entry\)/,
  'Recebedor logado nao deve usar o salvamento protegido generico para excluir pagamento de ficha de trabalho.',
);
assert.match(
  receiverRenderSource,
  /rowPaidStatus\(row\) \|\| rowHasReceiverContribution\(row\) \? 'checked' : ''/,
  'Pagamento parcial do recebedor deve manter o checkbox marcado para permitir desmarcar e excluir.',
);
assert.match(
  receiverRenderSource,
  /rowHasReceiverContribution\(row\) && !rowPaidStatus\(row\) \? 'data-partial-payment="true"' : ''/,
  'Pagamento parcial deve ser indeterminado com base no valor do recebedor, inclusive para cursistas.',
);
assert.doesNotMatch(
  receiverRenderSource,
  /&& !isStudentRow\(row\) \? 'data-partial-payment="true"'/,
  'Cursistas com pagamento parcial do recebedor tambem devem abrir confirmacao ao desmarcar.',
);
assert.match(
  receiverCheckboxChangeSource,
  /if \(!input\.checked\) \{[\s\S]*askDeletePayment\(row\)[\s\S]*paidInput\.value = currency\(0\)[\s\S]*setEntryPayment\(entry, 0, false, '', ''\)[\s\S]*return;/,
  'Exclusao confirmada deve zerar a tela e salvar zero antes de qualquer fluxo de forma de pagamento.',
);
assert.match(
  receiverCheckboxChangeSource,
  /const paymentDetails = await askPaymentMethod/,
  'Forma de pagamento deve ser solicitada apenas depois do caminho de exclusao.',
);
assert.doesNotMatch(
  coupleStudentNormalizeSource,
  /recebedorValorPagoSmp\s*=\s*parseCurrency\(record\.recebedorValorPagoSmp\s*\|\|\s*record\.valorPagoSmp\)/,
  'Normalizacao SMP/EPC nao pode tratar recebedorValorPagoSmp zero como campo ausente.',
);
assert.match(
  coupleStudentNormalizeSource,
  /record\.recebedorValorPagoSmp === undefined \|\| record\.recebedorValorPagoSmp === null \|\| record\.recebedorValorPagoSmp === ''/,
  'Normalizacao SMP/EPC deve usar fallback somente quando o campo do recebedor estiver ausente.',
);
assert.match(
  receiverEnrolmentPaymentSource,
  /const current = await get\('adesoes', enrolment\.id\)/,
  'Salvamento financeiro da ficha de trabalho deve partir da adesao atual.',
);
assert.match(
  receiverEnrolmentPaymentSource,
  /valorPago: enrolment\.valorPago[\s\S]*taxaPaga: enrolment\.taxaPaga[\s\S]*formaPagamento: enrolment\.formaPagamento[\s\S]*recebedorObservacao: enrolment\.recebedorObservacao/,
  'Salvamento financeiro da ficha de trabalho deve alterar somente campos financeiros do recebedor.',
);
assert.match(
  receiverEnrolmentPaymentSource,
  /saveWithTransientControl\('adesoes'[\s\S]*\[dataLossBypassField\]: true/,
  'Exclusao de pagamento da ficha de trabalho deve ter autorizacao explicita e restrita ao fluxo financeiro.',
);

const publicCoupleReceiverSource = apiSource.slice(
  apiSource.indexOf("if (req.method === 'PUT' && ['cursista-smp', 'cursista-epc'].includes(resource) && id && action)"),
  apiSource.indexOf('return false;', apiSource.indexOf("if (req.method === 'PUT' && ['cursista-smp', 'cursista-epc'].includes(resource) && id && action)")),
);

assert.doesNotMatch(
  publicCoupleReceiverSource,
  /allowedFields\s*=\s*\[[^\]]*(?:valorPagoSmp|saldoPagarSmp)/,
  'Recebedor publico SMP/EPC nao deve aceitar campos financeiros da ficha.',
);
assert.match(
  publicCoupleReceiverSource,
  /allowedFields\s*=\s*\['recebedorValorPagoSmp', 'recebedorTaxaPagaSmp', 'recebedorFormaPagamentoSmp', 'recebedorObservacaoSmp'\]/,
  'Recebedor publico SMP/EPC deve aceitar somente campos recebedor.',
);

console.log('Recebedor: pagamentos de cursistas isolados dos valores informados na ficha.');
