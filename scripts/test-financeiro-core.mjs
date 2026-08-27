import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateRecurringItem,
  cloneRecurringStructureSheet,
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
assert.equal(movement.saldo, 0);
assert.equal(movement.valorEntrada, 20);
assert.equal(movement.valorSaida, 12);
assert.equal(movement.valorSaldo, 0);
const donated = calculateRecurringItem({ doacao: 6 });
assert.equal(donated.doacao, 6);
const unrestrictedUse = calculateRecurringItem({ modo: 'movimento', posicaoAnterior: 2, entrada: 0, saida: 3, saldo: 2, precoUnitario: 4 });
assert.equal(unrestrictedUse.saida, 3);
assert.equal(unrestrictedUse.saldo, 2);
const signedUse = calculateRecurringItem({ modo: 'movimento', saida: -1.5 });
assert.equal(signedUse.saida, -1.5);

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
const clonedStructure = cloneRecurringStructureSheet({
  retreat: { id: 'new-retreat' },
  sector: 'Cozinha',
  sourceRetreat: { id: 'base-retreat' },
  sourceSheet: {
    retiroId: 'base-retreat',
    itensRecorrentes: [{ id: 'rice-prev', chaveRecorrencia: 'rice', descricao: 'Arroz', unidade: 'kg', fornecedor: 'Atacado EPC', saldo: 8, entrada: 3, saida: 2, precoUnitario: 7 }],
    despesasEventuais: [{ descricao: 'Frete', valor: 30 }],
  },
});
assert.equal(clonedStructure.retiroId, 'new-retreat');
assert.equal(clonedStructure.retiroOrigemId, 'base-retreat');
assert.equal(clonedStructure.itensRecorrentes[0].descricao, 'Arroz');
assert.equal(clonedStructure.itensRecorrentes[0].fornecedor, 'Atacado EPC');
assert.equal(clonedStructure.itensRecorrentes[0].posicaoAnterior, 0);
assert.equal(clonedStructure.itensRecorrentes[0].entrada, 0);
assert.equal(clonedStructure.itensRecorrentes[0].saida, 0);
assert.equal(clonedStructure.itensRecorrentes[0].doacao, 0);
assert.equal(clonedStructure.itensRecorrentes[0].saldo, 0);
assert.equal(clonedStructure.itensRecorrentes[0].precoUnitario, 0);
assert.deepEqual(clonedStructure.despesasEventuais, []);

const totals = sectorSheetTotals({
  itensRecorrentes: [{ modo: 'movimento', posicaoAnterior: 10, entrada: 5, saida: 4, precoUnitario: 2 }],
  despesasEventuais: [{ descricao: 'Frete', valor: 30 }],
});
assert.deepEqual(totals, { previous: 20, input: 10, output: 8, balance: 0, eventual: 30, acquired: 40, consumed: 38 });
assert.deepEqual(retreatBalance([{ itensRecorrentes: [], despesasEventuais: [{ valor: 10 }] }, { itensRecorrentes: [], despesasEventuais: [{ valor: 5 }] }]).eventual, 15);

assert.equal(dailyParticipationTotal({
  retreat: { dias: ['Sexta-feira', 'Sábado'] },
  enrolments: [{ dias: ['Sexta-feira', 'Sábado'] }, { dias: ['Sábado'] }],
  studentCount: 2,
  kidCount: 1,
}), 9, 'A participação diária deve somar equipe escalada, cursistas e crianças em cada dia.');

const suggestions = purchaseSuggestionRows({
  currentSheets: [{ setor: 'Cozinha', setorChave: 'cozinha', itensRecorrentes: [{ chaveRecorrencia: 'arroz', descricao: 'Arroz parboilizado', unidade: 'kg', posicaoAnterior: 2, entrada: 0, saida: 0, precoUnitario: 5 }] }],
  baseSheets: [{ setor: 'Cozinha', setorChave: 'cozinha', itensRecorrentes: [{ chaveRecorrencia: 'arroz', descricao: 'Arroz', unidade: 'kg', posicaoAnterior: 20, entrada: 0, saida: 10, precoUnitario: 4 }] }],
  baseParticipations: 20,
  focusParticipations: 30,
});
assert.equal(suggestions[0].descricao, 'Arroz parboilizado');
assert.equal(suggestions[0].consumoBase, 10);
assert.equal(suggestions[0].consumoPorParticipacao, 0.5);
assert.equal(suggestions[0].necessidadeProjetada, 15);
assert.equal(suggestions[0].saldoAnterior, 2);
assert.equal(suggestions[0].sugestaoCompra, 13);
assert.throws(() => purchaseSuggestionRows({ baseParticipations: 0 }), /não possui participações diárias/);

const app = read('adminApp.js');
const ui = read('financeiro.js');
const styles = read('styles.css');
const api = read('apiCore.js');
const stores = read('storeConfig.js');
const permissions = read('permissions.js');
const migration = read('supabase-financeiro-migration.sql');
const backup = read('backupService.js');

assert.match(app, /\['financeiro', 'Financeiro'\]/);
assert.match(app, /target === 'financeiro'/);
assert.match(ui, /Posição ant\./);
assert.match(ui, /Despesas eventuais/);
assert.match(ui, /Visualizar \/ imprimir/);
assert.match(ui, /Relatório Insumos/);
assert.match(ui, /Listagem dos campos cadastrados em insumos recorrentes/);
assert.doesNotMatch(ui, /finance-balance-metrics/);
assert.doesNotMatch(ui, /metricHtml/);
assert.match(ui, /<th>Fornecedor<\/th><th>Posição ant\.<\/th><th>Comprado<\/th><th>Doação<\/th><th>Saldo<\/th><th>R\$ unitário<\/th><th>Valores<\/th>/);
assert.doesNotMatch(ui, /<h2>Balanço de/);
assert.doesNotMatch(ui, /<h3>Despesas eventuais<\/h3>/);
assert.match(ui, /finance-balance-output-value/);
assert.match(ui, /financeMoney\(item\.valorSaida\)/);
assert.match(ui, /data-field="fornecedor"/);
assert.match(ui, /const recurringKey = \(item = \{\}\) => String\(item\.chaveRecorrencia \|\| item\.itemOrigemId \|\| item\.id \|\| createId\(\)\)\.trim\(\)/);
assert.match(ui, /data-key="\$\{escapeHtml\(key\)\}"/);
assert.match(ui, /chaveRecorrencia: row\.dataset\.key \|\| row\.dataset\.origin \|\| row\.dataset\.id \|\| createId\(\)/);
assert.match(ui, /finance-supplier-options/);
assert.match(ui, /supplierOptionsHtml\(state\.allSheets\)/);
assert.match(ui, /data-recurring-search/);
assert.match(ui, /filterRecurringRows\(root\)/);
assert.match(ui, /normalizeFinanceSearch/);
assert.match(ui, /Insumos Recorrentes/);
assert.match(ui, /Nenhum insumo encontrado para esta busca/);
assert.match(ui, /sortHeader = \(key, label\) => `<button type="button" class="finance-sort-header" data-recurring-sort="\$\{key\}" aria-sort="none">/);
assert.match(ui, /sortHeader\('descricao', 'Insumo'\)[\s\S]*sortHeader\('unidade', 'Unidade'\)[\s\S]*sortHeader\('valorSaida', 'Valores'\)/);
assert.match(ui, /function sortRecurringRows\(root, button\)/);
assert.match(ui, /button\.dataset\.sortDirection === 'asc' \? 'desc' : 'asc'/);
assert.match(ui, /rows\.forEach\(\(row\) => body\.append\(row\)\)/);
assert.match(ui, /event\.target\.closest\('\[data-recurring-sort\]'\)/);
assert.match(ui, /sortRecurringRows\(root, sort\)/);
assert.doesNotMatch(ui, /<th>Ordem<\/th><th>Insumo<\/th>/);
assert.doesNotMatch(ui, /data-move=/);
assert.doesNotMatch(ui, /function moveRow/);
assert.doesNotMatch(ui, /finance-row-order/);
assert.doesNotMatch(ui, /<th>Ordem<\/th><th>Descrição<\/th>/);
assert.match(ui, /sortHeader\('posicaoAnterior', 'POSIÇÃO ANT\.'\)[\s\S]*sortHeader\('saida', 'Comprado'\)[\s\S]*sortHeader\('doacao', 'Doação'\)[\s\S]*sortHeader\('saldo', 'Saldo'\)[\s\S]*sortHeader\('precoUnitario', 'R\$ UNITÁRIO'\)/);
assert.doesNotMatch(ui, /<th>Lançamento<\/th>/);
assert.doesNotMatch(ui, /<th>Lançamento<\/th><th>Entrada<\/th><th>Saída<\/th><th>Saldo<\/th>/);
assert.match(ui, /type="hidden" data-field="entrada"/);
assert.match(ui, /type="hidden" data-field="modo"/);
assert.match(ui, /data-field="doacao"/);
assert.match(ui, /doacao: financeNumber\(row\.querySelector\('\[data-field="doacao"\]'\)\.value\)/);
assert.match(ui, /row\.querySelector\('\[data-field="saldo"\]'\)\.readOnly = false/);
assert.match(styles, /\.finance-sheet-table \{ width:100%; min-width:1110px; border-collapse:collapse; \}/);
assert.match(styles, /\.finance-sort-header \{ display:inline-flex;[\s\S]*?cursor:pointer; \}/);
assert.match(styles, /\.finance-sort-header\[data-sort-direction="asc"\] span::after \{ content:'↑'; color:var\(--leaf\); \}/);
assert.doesNotMatch(styles, /finance-description-cell/);
assert.doesNotMatch(styles, /finance-row-order/);
assert.match(styles, /\.finance-sheet-table td:nth-child\(1\) input \{ min-width:190px; \}/);
assert.match(styles, /\.finance-sheet-table td:nth-child\(3\) input,\.finance-eventual-table td:nth-child\(2\) input \{ min-width:180px; \}/);
assert.match(styles, /\.finance-sheet-table td:nth-child\(2\) input,[\s\S]*?\.finance-sheet-table td:nth-child\(8\) input \{ min-width:46px; max-width:74px; \}/);
assert.match(ui, /<th>Número<\/th><th>Tipo\/Série<\/th><th>Fornecedor<\/th><th>Valor<\/th><th>Observação<\/th>/);
assert.match(ui, /data-field="numero"/);
assert.match(ui, /data-field="tipoSerie"/);
assert.match(ui, /data-field="observacao"/);
assert.match(ui, /numero: row\.querySelector\('\[data-field="numero"\]'\)\.value/);
assert.match(ui, /tipoSerie: row\.querySelector\('\[data-field="tipoSerie"\]'\)\.value/);
assert.match(ui, /observacao: row\.querySelector\('\[data-field="observacao"\]'\)\.value/);
assert.match(ui, /RETREAT_FINANCE_KEY/);
assert.match(ui, /setorChave: RETREAT_FINANCE_KEY/);
assert.match(ui, /legacyKitchen/);
assert.match(ui, /financeSheetsForRetreat/);
assert.match(ui, /Insumos recorrentes/);
assert.match(ui, /Despesas eventuais/);
assert.match(ui, /Sugestão de compras/);
assert.match(ui, /Relatório Insumos/);
assert.match(ui, /data-finance-view/);
assert.match(ui, /activeView = 'recorrentes'/);
assert.match(ui, /\['recorrentes', 'Insumos recorrentes'\]/);
assert.match(ui, /\['eventuais', 'Despesas eventuais'\]/);
assert.doesNotMatch(ui, /finance-heading-actions/);
assert.doesNotMatch(ui, /data-finance-sector/);
assert.doesNotMatch(ui, /data-finance-purchase/);
assert.doesNotMatch(ui, /activeSectorKey/);
assert.doesNotMatch(ui, /controle simplificado de despesas por setor/);
assert.match(ui, /Consumo efetivo na base/);
assert.match(ui, /Participações da base/);
assert.match(ui, /Saldo do retiro anterior/);
assert.match(ui, /listAdesoes\(baseRetreat\.id\)/);
assert.match(ui, /listAdesoes\(state\.retreat\.id\)/);
assert.match(ui, /listCursistas\(baseRetreat\.id\)/);
assert.match(ui, /listCursistas\(state\.retreat\.id\)/);
assert.doesNotMatch(ui, /setor histórico/);
assert.match(api, /financeiro_planilhas/);
assert.match(api, /RETREAT_FINANCE_KEY/);
assert.match(api, /isRetreatSheet/);
assert.match(api, /Toda despesa eventual precisa de numero/);
assert.match(api, /tipoSerie/);
assert.match(api, /observacao/);
assert.match(api, /Object\.hasOwn\(line, 'fornecedor'\)/);
assert.match(api, /existing\?\.fornecedor \|\| previous\?\.fornecedor/);
assert.doesNotMatch(api, /nao pode gerar saldo negativo/);
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
