import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateRecurringItem,
  dailyParticipationTotal,
  findPreviousRetreat,
  inheritSectorSheet,
  normalizeSectorKey,
  purchaseSuggestionRows,
  retreatBalance,
  sectorSheetTotals,
} from '../financeiroCore.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

assert.equal(normalizeSectorKey('  Cozinha Ágil  '), 'cozinha agil');

const movement = calculateRecurringItem({ modo: 'movimento', posicaoAnterior: 10, entrada: 5, saida: 3, precoUnitario: 4 });
assert.equal(movement.saldo, 12);
assert.equal(movement.valorEntrada, 20);
assert.equal(movement.valorSaida, 12);
assert.equal(movement.valorSaldo, 48);
assert.throws(() => calculateRecurringItem({ modo: 'movimento', posicaoAnterior: 2, entrada: 0, saida: 3 }), /saldo negativo/);

const lowerBalance = calculateRecurringItem({ modo: 'saldo', posicaoAnterior: 10, saldo: 7, entrada: 99, saida: 99 });
assert.equal(lowerBalance.entrada, 0);
assert.equal(lowerBalance.saida, 3);
const higherBalance = calculateRecurringItem({ modo: 'saldo', posicaoAnterior: 10, saldo: 14 });
assert.equal(higherBalance.entrada, 4);
assert.equal(higherBalance.saida, 0);
const sameBalance = calculateRecurringItem({ modo: 'saldo', posicaoAnterior: 10, saldo: 10 });
assert.equal(sameBalance.entrada, 0);
assert.equal(sameBalance.saida, 0);

const retreats = [
  { id: 'old', dataInicio: '2025-06-01', createdAt: '2025-01-01T00:00:00Z' },
  { id: 'previous', dataInicio: '2026-05-01', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'current', dataInicio: '2026-08-01', createdAt: '2026-02-01T00:00:00Z' },
  { id: 'future', dataInicio: '2027-01-01', createdAt: '2026-03-01T00:00:00Z' },
];
assert.equal(findPreviousRetreat(retreats[2], retreats)?.id, 'previous');
assert.equal(findPreviousRetreat(retreats[0], retreats), null);

const previousSheet = {
  retiroId: 'previous', setor: 'Cozinha', setorChave: 'cozinha',
  itensRecorrentes: [{ id: 'rice-prev', chaveRecorrencia: 'rice', descricao: 'Arroz', unidade: 'kg', fornecedor: 'Atacado EPC', saldo: 8, precoUnitario: 7 }],
};
const inherited = inheritSectorSheet({ retreat: retreats[2], sector: 'COZINHA', previousRetreat: retreats[1], previousSheet });
assert.equal(inherited.retiroOrigemId, 'previous');
assert.equal(inherited.itensRecorrentes[0].posicaoAnterior, 8);
assert.equal(inherited.itensRecorrentes[0].precoUnitario, 7);
assert.equal(inherited.itensRecorrentes[0].fornecedor, 'Atacado EPC');
assert.equal(inherited.itensRecorrentes[0].chaveRecorrencia, 'rice');

const totals = sectorSheetTotals({
  itensRecorrentes: [{ modo: 'movimento', posicaoAnterior: 10, entrada: 5, saida: 4, precoUnitario: 2 }],
  despesasEventuais: [{ descricao: 'Frete', valor: 30 }],
});
assert.deepEqual(totals, { previous: 20, input: 10, output: 8, balance: 22, eventual: 30, acquired: 40, consumed: 38 });
assert.deepEqual(retreatBalance([{ itensRecorrentes: [], despesasEventuais: [{ valor: 10 }] }, { itensRecorrentes: [], despesasEventuais: [{ valor: 5 }] }]).eventual, 15);

assert.equal(dailyParticipationTotal({
  retreat: { dias: ['Sexta-feira', 'Sábado'] },
  enrolments: [{ dias: ['Sexta-feira', 'Sábado'] }, { dias: ['Sábado'] }],
  studentCount: 2,
  kidCount: 1,
}), 9, 'A participação diária deve somar equipe escalada, cursistas e crianças em cada dia.');

const suggestions = purchaseSuggestionRows({
  currentSheets: [{ setor: 'Cozinha', setorChave: 'cozinha', itensRecorrentes: [{ chaveRecorrencia: 'arroz', descricao: 'Arroz', unidade: 'kg', posicaoAnterior: 2, entrada: 0, saida: 0, precoUnitario: 5 }] }],
  baseSheets: [{ setor: 'Cozinha', setorChave: 'cozinha', itensRecorrentes: [{ chaveRecorrencia: 'arroz', descricao: 'Arroz', unidade: 'kg', posicaoAnterior: 20, entrada: 0, saida: 10, precoUnitario: 4 }] }],
  baseParticipations: 20,
  focusParticipations: 30,
});
assert.equal(suggestions[0].consumoBase, 10);
assert.equal(suggestions[0].consumoPorParticipacao, 0.5);
assert.equal(suggestions[0].necessidadeProjetada, 15);
assert.equal(suggestions[0].saldoAnterior, 2);
assert.equal(suggestions[0].sugestaoCompra, 13);
assert.throws(() => purchaseSuggestionRows({ baseParticipations: 0 }), /não possui participações diárias/);

const app = read('adminApp.js');
const ui = read('financeiro.js');
const api = read('apiCore.js');
const stores = read('storeConfig.js');
const permissions = read('permissions.js');
const migration = read('supabase-financeiro-migration.sql');
const backup = read('backupService.js');

assert.match(app, /\['financeiro', 'Financeiro'\]/);
assert.match(app, /target === 'financeiro'/);
assert.match(ui, /Posição anterior/);
assert.match(ui, /Somente saldo/);
assert.match(ui, /Despesas eventuais/);
assert.match(ui, /Visualizar \/ imprimir/);
assert.match(ui, /Valor da saída/);
assert.match(ui, /<th>Saída<\/th><th>Saldo<\/th><th>Preço unitário<\/th><th>Valor da saída<\/th>/);
assert.match(ui, /finance-balance-output-value/);
assert.match(ui, /financeMoney\(item\.valorSaida\)/);
assert.match(ui, /data-field="fornecedor"/);
assert.match(ui, /finance-supplier-options/);
assert.match(ui, /supplierOptionsHtml\(state\.allSheets\)/);
assert.match(ui, /data-recurring-search/);
assert.match(ui, /filterRecurringRows\(root\)/);
assert.match(ui, /normalizeFinanceSearch/);
assert.match(ui, /Nenhuma despesa encontrada para esta busca/);
assert.match(ui, /<th>Despesa<\/th><th>Unidade<\/th><th>Fornecedor<\/th><th>Posição anterior<\/th>/);
assert.match(ui, /<th>Descrição<\/th><th>Fornecedor<\/th><th>Valor<\/th>/);
assert.match(ui, /Sugestão de compra/);
assert.match(ui, /Consumo efetivo na base/);
assert.match(ui, /Participações da base/);
assert.match(ui, /Saldo do retiro anterior/);
assert.match(ui, /listAdesoes\(\)/);
assert.match(ui, /setor histórico/);
assert.match(api, /financeiro_planilhas/);
assert.match(api, /Object\.hasOwn\(line, 'fornecedor'\)/);
assert.match(api, /existing\?\.fornecedor \|\| previous\?\.fornecedor/);
assert.match(api, /A saida de .* nao pode gerar saldo negativo/);
assert.match(api, /exclusao_item/);
assert.match(api, /Retiro encerrado: Financeiro disponivel apenas para consulta/);
assert.match(stores, /financeiro_planilhas/);
assert.doesNotMatch(stores, /financeiro_movimentos/);
assert.match(permissions, /financeiro\.excluir/);
assert.match(backup, /financeiro_planilha_auditoria/);
assert.doesNotMatch(migration, /Backup obrigatorio|snapshot integral recente/i);
assert.match(migration, /Financeiro legado autorizado para exclusao/);
assert.match(migration, /drop table if exists public\.financeiro_movimentos/);
assert.match(migration, /unique \(retiro_id, setor_chave\)/);
for (const protectedTable of ['adesoes', 'cursistas', 'pessoas', 'casais', 'comunidades', 'retiros']) {
  assert.doesNotMatch(migration, new RegExp(`(?:delete\\s+from|update|alter\\s+table|drop\\s+table)\\s+(?:public\\.)?${protectedTable}`, 'i'), `A migração não pode alterar ${protectedTable}.`);
}
assert.doesNotMatch(migration, /on delete cascade/i);

console.log('Financeiro: planilhas, herança, balanço, permissões e migração protegida validados.');
