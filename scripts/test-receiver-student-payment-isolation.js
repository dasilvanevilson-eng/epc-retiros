const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');

const receiverSaveSource = adminSource.slice(
  adminSource.indexOf('const saveFinancialEntry = async (entry) => {'),
  adminSource.indexOf('const peopleById = new Map', adminSource.indexOf('const saveFinancialEntry = async (entry) => {')),
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
