import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expenseTotal, inventorySummary, quoteComparison, retreatCost } from '../financeiroCore.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

assert.equal(expenseTotal({ itens: [{ quantidade: 2, valorUnitario: 10 }], frete: 5, desconto: 2 }), 23);

const quote = {
  itens: [{ id: 'arroz', descricao: 'Arroz', quantidade: 10 }, { id: 'oleo', descricao: 'Óleo', quantidade: 5 }],
  ofertas: [
    { fornecedorId: 'a', itemId: 'arroz', valorUnitario: 5, frete: 10, desconto: 5, disponivel: true },
    { fornecedorId: 'a', itemId: 'oleo', valorUnitario: 8, frete: 10, desconto: 5, disponivel: true },
    { fornecedorId: 'b', itemId: 'arroz', valorUnitario: 4, frete: 8, desconto: 0, disponivel: true },
    { fornecedorId: 'b', itemId: 'oleo', valorUnitario: 12, frete: 8, desconto: 0, disponivel: true },
  ],
};
const comparison = quoteComparison(quote);
assert.equal(comparison.bestSingle.supplierId, 'a', 'Fornecedor A deve vencer o carrinho completo com encargos.');
assert.equal(comparison.bestByItem.length, 2);
assert(comparison.bestCombinationTotal > 0);

const products = [{ id: 'p1', nome: 'Café', unidade: 'kg', estoqueMinimo: 2 }];
const movements = [
  { id: 'm1', produtoId: 'p1', tipo: 'entrada', quantidade: 10, custoUnitario: 20, createdAt: '2026-01-01' },
  { id: 'm2', produtoId: 'p1', tipo: 'entrada', quantidade: 10, custoUnitario: 30, createdAt: '2026-01-02' },
  { id: 'm3', produtoId: 'p1', tipo: 'retirada', quantidade: 4, custoUnitario: 25, createdAt: '2026-01-03' },
];
const inventory = inventorySummary(products, movements)[0];
assert.equal(inventory.balance, 16);
assert.equal(inventory.averageCost, 25);

const cost = retreatCost([
  { status: 'paga', frete: 10, desconto: 0, itens: [{ quantidade: 2, valorUnitario: 50, controlaEstoque: false }, { quantidade: 10, valorUnitario: 20, controlaEstoque: true }] },
], [
  { tipo: 'retirada', quantidade: 4, custoUnitario: 25, custoTotal: 100 },
  { tipo: 'devolucao', quantidade: 1, custoUnitario: 25, custoTotal: 25 },
]);
assert.equal(Math.round(cost.direct * 100) / 100, 103.33, 'Frete misto deve ser rateado proporcionalmente.');
assert.equal(cost.consumed, 75);
assert.equal(Math.round(cost.total * 100) / 100, 178.33);

const app = read('adminApp.js');
const api = read('apiCore.js');
const stores = read('storeConfig.js');
const permissions = read('permissions.js');
const migration = read('supabase-financeiro-migration.sql');
assert.match(app, /\['financeiro', 'Financeiro'\]/);
assert.match(app, /target === 'financeiro'/);
assert.match(api, /financeiro\.ver/);
assert.match(api, /Estoque insuficiente/);
assert.match(api, /auditFinanceDeletion/);
assert.match(stores, /financeiro_movimentos/);
assert.match(permissions, /financeiro\.excluir/);
for (const protectedTable of ['adesoes', 'cursistas', 'pessoas', 'casais', 'comunidades', 'retiros']) {
  assert.doesNotMatch(migration, new RegExp(`(?:delete\\s+from|update|alter\\s+table|drop\\s+table)\\s+(?:public\\.)?${protectedTable}`, 'i'), `A migração não pode alterar ${protectedTable}.`);
}
assert.doesNotMatch(migration, /on delete cascade/i);

console.log('Financeiro: cálculos, estoque, permissões, isolamento e migração aditiva validados.');
