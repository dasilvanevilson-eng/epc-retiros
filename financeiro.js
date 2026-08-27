import {
  calculateRecurringItem,
  dailyParticipationTotal,
  financeMoney,
  financeNumber,
  financeQuantity,
  findPreviousRetreat,
  inheritSectorSheet,
  normalizeSectorKey,
  purchaseSuggestionRows,
  RETREAT_FINANCE_KEY,
  RETREAT_FINANCE_LABEL,
  retreatBalance,
  sectorSheetTotals,
} from './financeiroCore.js?v=20260809-sugestao-compra';

let activeView = 'recorrentes';
let pendingDeletionReason = '';
let purchaseBaseRetreatId = '';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const createId = () => globalThis.crypto?.randomUUID?.() || `finance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const inputValue = (value) => Number.isFinite(Number(value)) ? String(Number(value)) : '0';
const supplierListId = 'finance-supplier-options';
const normalizeFinanceSearch = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
const recurringKey = (item = {}) => String(item.chaveRecorrencia || item.itemOrigemId || item.id || createId()).trim();
const financeSheetsForRetreat = (sheets = [], retreatId = '') => {
  const retreatSheets = sheets.filter((sheet) => sheet.retiroId === retreatId);
  const current = retreatSheets.find((sheet) => sheet.setorChave === RETREAT_FINANCE_KEY);
  if (current) return [current];
  const legacyKitchen = retreatSheets.find((sheet) => normalizeSectorKey(sheet.setorChave || sheet.setor) === 'cozinha');
  return legacyKitchen ? [{ ...legacyKitchen, id: '', setor: RETREAT_FINANCE_LABEL, setorChave: RETREAT_FINANCE_KEY, retiroOrigemId: legacyKitchen.retiroOrigemId || legacyKitchen.id || '' }] : [];
};
const generalSheet = (state) => {
  const [current] = financeSheetsForRetreat(state.currentSheets, state.retreat.id);
  if (current?.id && current.setorChave === RETREAT_FINANCE_KEY) return current;
  const legacyKitchen = current;
  if (legacyKitchen) {
    return {
      ...legacyKitchen,
      id: '',
      setor: RETREAT_FINANCE_LABEL,
      setorChave: RETREAT_FINANCE_KEY,
      retiroOrigemId: legacyKitchen.retiroOrigemId || legacyKitchen.id || '',
    };
  }
  const previousSheet = state.previousRetreat
    ? state.allSheets.find((sheet) => sheet.retiroId === state.previousRetreat.id && sheet.setorChave === RETREAT_FINANCE_KEY)
    : null;
  return inheritSectorSheet({ retreat: state.retreat, sector: RETREAT_FINANCE_LABEL, previousRetreat: state.previousRetreat, previousSheet, id: '' });
};

const supplierOptionsHtml = (sheets = []) => {
  const suppliers = new Map();
  sheets.flatMap((sheet) => [...(sheet.itensRecorrentes || []), ...(sheet.despesasEventuais || [])]).forEach((item) => {
    const supplier = String(item.fornecedor || '').trim();
    const key = supplier.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    if (supplier && !suppliers.has(key)) suppliers.set(key, supplier);
  });
  return [...suppliers.values()].sort((first, second) => first.localeCompare(second, 'pt-BR', { sensitivity: 'base' }))
    .map((supplier) => `<option value="${escapeHtml(supplier)}"></option>`).join('');
};

async function loadFinanceState(retreat, dataService) {
  const [allSheets, retreats] = await Promise.all([dataService.listFinanceSheets(), dataService.listRetiros()]);
  const sectors = [...new Map((retreat.setores || []).map((sector) => [normalizeSectorKey(sector), String(sector).trim()])).values()]
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const previousRetreat = findPreviousRetreat(retreat, retreats);
  const currentSheets = allSheets.filter((sheet) => sheet.retiroId === retreat.id);
  return { retreat, retreats, sectors, previousRetreat, allSheets, currentSheets };
}

const recurringRowHtml = (item = {}, { canEdit, canDelete } = {}) => {
  const calculated = calculateRecurringItem(item);
  const disabled = canEdit ? '' : 'disabled';
  const movement = calculated.modo !== 'saldo';
  const key = recurringKey(item);
  return `<tr data-finance-recurring-row data-id="${escapeHtml(item.id || '')}" data-key="${escapeHtml(key)}" data-origin="${escapeHtml(item.itemOrigemId || '')}">
    <td><input data-field="descricao" value="${escapeHtml(item.descricao || '')}" placeholder="Descrição" ${disabled}></td>
    <td><input data-field="unidade" value="${escapeHtml(item.unidade || 'un')}" placeholder="un" ${disabled}></td>
    <td><input data-field="fornecedor" list="${supplierListId}" value="${escapeHtml(item.fornecedor || '')}" placeholder="Fornecedor" autocomplete="off" ${disabled}></td>
    <td><input data-field="posicaoAnterior" value="${inputValue(calculated.posicaoAnterior)}" readonly tabindex="-1"><input type="hidden" data-field="modo" value="${escapeHtml(calculated.modo)}"><input type="hidden" data-field="entrada" value="${inputValue(calculated.entrada)}"></td>
    <td><input data-field="saida" inputmode="decimal" value="${inputValue(calculated.saida)}" ${disabled} ${movement ? '' : 'readonly'}></td>
    <td><input data-field="doacao" inputmode="decimal" value="${inputValue(calculated.doacao)}" ${disabled}></td>
    <td><input data-field="saldo" inputmode="decimal" value="${inputValue(calculated.saldo)}" ${disabled}></td>
    <td><input data-field="precoUnitario" inputmode="decimal" value="${inputValue(calculated.precoUnitario)}" ${disabled}></td>
    <td data-row-values><small>Saída ${financeMoney(calculated.valorSaida)}</small><strong>Saldo ${financeMoney(calculated.valorSaldo)}</strong></td>
    <td>${canEdit && canDelete ? '<button type="button" class="finance-remove-row" data-remove-row aria-label="Remover insumo recorrente">×</button>' : ''}</td>
  </tr>`;
};

const eventualRowHtml = (item = {}, { canEdit, canDelete } = {}) => {
  const disabled = canEdit ? '' : 'disabled';
  return `<tr data-finance-eventual-row data-id="${escapeHtml(item.id || '')}">
    <td><input data-field="numero" value="${escapeHtml(item.numero || item.descricao || '')}" placeholder="Número" ${disabled}></td>
    <td><input data-field="tipoSerie" value="${escapeHtml(item.tipoSerie || '')}" placeholder="Tipo/Série" ${disabled}></td>
    <td><input data-field="observacao" value="${escapeHtml(item.observacao || '')}" placeholder="Observação" ${disabled}></td>
    <td><input data-field="fornecedor" list="${supplierListId}" value="${escapeHtml(item.fornecedor || '')}" placeholder="Fornecedor" autocomplete="off" ${disabled}></td>
    <td><input data-field="valor" inputmode="decimal" value="${inputValue(item.valor)}" ${disabled}></td>
    <td>${canEdit && canDelete ? '<button type="button" class="finance-remove-row" data-remove-row aria-label="Remover despesa eventual">×</button>' : ''}</td>
  </tr>`;
};

function recurringSheetHtml(sheet, state, permissions, initializationError = '') {
  const inherited = sheet.retiroOrigemId && state.previousRetreat;
  const supplierOptions = supplierOptionsHtml(state.allSheets);
  const sortHeader = (key, label) => `<button type="button" class="finance-sort-header" data-recurring-sort="${key}" aria-sort="none">${label}<span aria-hidden="true"></span></button>`;
  return `<section class="finance-section-heading"><div><p class="eyebrow">Retiro em foco</p><h2>Insumos recorrentes</h2><p>${inherited ? `Posição e preços herdados de ${escapeHtml(state.previousRetreat.nome)}.` : 'Lançamentos indexados diretamente ao retiro em foco.'}</p></div></section>
  <form id="finance-retreat-sheet" class="finance-sheet-form" data-sheet-id="${escapeHtml(sheet.id || '')}">
    <datalist id="${supplierListId}">${supplierOptions}</datalist>
    <section class="panel finance-sheet-panel"><div class="panel-heading"><div class="finance-recurring-heading"><h2>Insumos Recorrentes</h2><p>Controle resumido de entrada, saída e saldo, sem lançamento de notas.</p><label class="finance-recurring-search"><span>Buscar insumo</span><input type="search" data-recurring-search placeholder="Digite a descrição" autocomplete="off"></label></div>${permissions.canEdit ? '<button type="button" class="secondary-button" data-add-recurring>Adicionar insumo</button>' : ''}</div>
      <div class="finance-sheet-scroll"><table class="finance-sheet-table"><thead><tr><th>${sortHeader('descricao', 'Insumo')}</th><th>${sortHeader('unidade', 'Unidade')}</th><th>${sortHeader('fornecedor', 'Fornecedor')}</th><th>${sortHeader('posicaoAnterior', 'POSIÇÃO ANT.')}</th><th>${sortHeader('saida', 'Comprado')}</th><th>${sortHeader('doacao', 'Doação')}</th><th>${sortHeader('saldo', 'Saldo')}</th><th>${sortHeader('precoUnitario', 'R$ UNITÁRIO')}</th><th>${sortHeader('valorSaida', 'Valores')}</th><th></th></tr></thead><tbody data-recurring-body>${(sheet.itensRecorrentes || []).map((item) => recurringRowHtml(item, permissions)).join('')}</tbody></table></div>
      ${sheet.itensRecorrentes?.length ? '' : '<p class="empty-state" data-recurring-empty>Nenhum insumo recorrente neste retiro.</p>'}
      <p class="empty-state" data-recurring-no-results hidden>Nenhum insumo encontrado para esta busca.</p>
    </section>
    <p class="form-message" data-finance-message>${escapeHtml(initializationError)}</p>
    ${permissions.canEdit ? '<div class="form-actions finance-save-actions"><span>As alterações afetam somente este retiro.</span><button type="submit">Salvar insumos <span>→</span></button></div>' : ''}
  </form>`;
}

function eventualSheetHtml(sheet, state, permissions, initializationError = '') {
  const supplierOptions = supplierOptionsHtml(state.allSheets);
  return `<section class="finance-section-heading"><div><p class="eyebrow">Retiro em foco</p><h2>Despesas eventuais</h2><p>Lançamentos eventuais indexados diretamente ao retiro em foco.</p></div></section>
  <form id="finance-retreat-sheet" class="finance-sheet-form" data-sheet-id="${escapeHtml(sheet.id || '')}">
    <datalist id="${supplierListId}">${supplierOptions}</datalist>
    <section class="panel finance-sheet-panel"><div class="panel-heading"><div><h2>Despesas eventuais</h2><p>Despesas não recorrentes, sem controle de estoque.</p></div>${permissions.canEdit ? '<button type="button" class="secondary-button" data-add-eventual>Adicionar despesa</button>' : ''}</div>
      <div class="finance-sheet-scroll"><table class="finance-eventual-table"><thead><tr><th>Número</th><th>Tipo/Série</th><th>Observação</th><th>Fornecedor</th><th>Valor</th><th></th></tr></thead><tbody data-eventual-body>${(sheet.despesasEventuais || []).map((item) => eventualRowHtml(item, permissions)).join('')}</tbody></table></div>
      ${sheet.despesasEventuais?.length ? '' : '<p class="empty-state" data-eventual-empty>Nenhuma despesa eventual neste retiro.</p>'}
    </section>
    <p class="form-message" data-finance-message>${escapeHtml(initializationError)}</p>
    ${permissions.canEdit ? '<div class="form-actions finance-save-actions"><span>As alterações afetam somente este retiro.</span><button type="submit">Salvar despesas <span>→</span></button></div>' : ''}
  </form>`;
}

const metricHtml = (label, value) => `<article><span>${label}</span><strong>${financeMoney(value)}</strong></article>`;

function balanceSectorHtml(sheet) {
  const totals = sectorSheetTotals(sheet);
  const recurringRows = (sheet.itensRecorrentes || []).map((raw) => {
    const item = calculateRecurringItem(raw);
    return `<tr><td>${escapeHtml(item.descricao)}</td><td>${escapeHtml(item.unidade)}</td><td>${financeQuantity(item.posicaoAnterior)}<small>${financeMoney(item.valorPosicaoAnterior)}</small></td><td>${financeQuantity(item.entrada)}<small>${financeMoney(item.valorEntrada)}</small></td><td>${financeQuantity(item.saida)}</td><td>${financeQuantity(item.saldo)}<small>${financeMoney(item.valorSaldo)}</small></td><td>${financeMoney(item.precoUnitario)}</td><td><strong>${financeMoney(item.valorSaida)}</strong></td></tr>`;
  }).join('');
  const eventualRows = (sheet.despesasEventuais || []).map((item) => `<tr><td>${escapeHtml(item.numero || item.descricao)}</td><td>${escapeHtml(item.tipoSerie || '')}</td><td>${escapeHtml(item.observacao || '')}</td><td>${financeMoney(item.valor)}</td></tr>`).join('');
  return `<section class="panel finance-balance-sector"><h2>${escapeHtml(sheet.setor)}</h2>
    ${recurringRows ? `<div class="finance-sheet-scroll"><table class="finance-balance-recurring"><colgroup><col class="finance-balance-description"><col class="finance-balance-unit"><col class="finance-balance-previous"><col class="finance-balance-input"><col class="finance-balance-output"><col class="finance-balance-stock"><col class="finance-balance-price"><col class="finance-balance-output-value"></colgroup><thead><tr><th>Insumo</th><th>Unidade</th><th>Posição anterior</th><th>Entrada</th><th>Saída</th><th>Saldo</th><th>Preço unitário</th><th>Valor da saída</th></tr></thead><tbody>${recurringRows}</tbody></table></div>` : '<p class="empty-state">Sem insumos recorrentes.</p>'}
    ${eventualRows ? `<h3>Despesas eventuais</h3><table class="finance-balance-eventual"><thead><tr><th>Número</th><th>Tipo/Série</th><th>Observação</th><th>Valor</th></tr></thead><tbody>${eventualRows}</tbody></table>` : ''}
    <footer><span>Entradas: <b>${financeMoney(totals.input)}</b></span><span>Saídas: <b>${financeMoney(totals.output)}</b></span><span>Eventuais: <b>${financeMoney(totals.eventual)}</b></span><span>Saldo: <b>${financeMoney(totals.balance)}</b></span></footer></section>`;
}

function sheetsForBalance(state) { return [generalSheet(state)]; }

function balanceHtml(state) {
  const sheets = sheetsForBalance(state);
  const totals = retreatBalance(sheets);
  return `<section class="finance-section-heading"><div><p class="eyebrow">Retiro em foco</p><h2>Balanço de ${escapeHtml(state.retreat.nome)}</h2><p>Valores adquiridos e consumidos apresentados separadamente.</p></div><button type="button" data-finance-print>Visualizar / imprimir</button></section>
    <section class="finance-metrics finance-balance-metrics">${metricHtml('Posição anterior', totals.previous)}${metricHtml('Entradas recorrentes', totals.input)}${metricHtml('Saídas / consumo', totals.output)}${metricHtml('Despesas eventuais', totals.eventual)}${metricHtml('Saldo final valorizado', totals.balance)}${metricHtml('Total adquirido / desembolsado', totals.acquired)}${metricHtml('Total consumido', totals.consumed)}</section>
    <div class="finance-balance-sectors">${sheets.map(balanceSectorHtml).join('') || '<section class="panel"><p class="empty-state">Nenhum lançamento financeiro neste retiro.</p></section>'}</div>`;
}

const suggestionQuantity = (value) => financeNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 });

const teamKidsCount = (enrolments = []) => {
  const identities = new Set();
  enrolments.forEach((entry) => (entry.espacoKids || []).forEach((kid) => {
    const owner = entry.casalId ? `casal:${entry.casalId}` : `ficha:${entry.id || entry.pessoaId || ''}`;
    const identity = `${owner}:${normalizeSectorKey(kid.nome)}:${String(kid.nascimento || '')}`;
    if (kid.nome || kid.nascimento) identities.add(identity);
  }));
  return identities.size;
};

const coupleStudentKidsCount = (records = []) => records.reduce((total, record) => {
  if (record.smpKidsNotNeeded) return total;
  return total + Array.from({ length: 5 }, (_, index) => index + 1)
    .filter((number) => String(record[`smpKidNome${number}`] || record[`smpKidNascimento${number}`] || '').trim()).length;
}, 0);

async function participationTotalForRetreat(retreat, dataService, allEnrolments, individualStudents) {
  const enrolments = allEnrolments.filter((entry) => entry.retiroId === retreat.id);
  const studentType = retreat.tipoFichaCursista || 'cursista-individual';
  let coupleStudents = [];
  if (studentType === 'cursista-smp') coupleStudents = await dataService.listCursistasSmp(retreat.id);
  if (studentType === 'cursista-epc') coupleStudents = await dataService.listCursistasEpc(retreat.id);
  const studentCount = ['cursista-smp', 'cursista-epc'].includes(studentType)
    ? coupleStudents.length * 2
    : new Set(individualStudents.filter((student) => student.retiroId === retreat.id).map((student) => student.id || student.cpf)).size;
  const kidCount = teamKidsCount(enrolments) + coupleStudentKidsCount(coupleStudents);
  return dailyParticipationTotal({ retreat, enrolments, studentCount, kidCount });
}

function purchaseSuggestionHtml(state) {
  const baseRetreats = state.retreats
    .filter((candidate) => candidate.id !== state.retreat.id && candidate.acessoPermitido !== false && financeSheetsForRetreat(state.allSheets, candidate.id).length)
    .sort((first, second) => String(second.dataInicio || second.createdAt || '').localeCompare(String(first.dataInicio || first.createdAt || '')));
  if (!baseRetreats.some((retreat) => retreat.id === purchaseBaseRetreatId)) purchaseBaseRetreatId = '';
  return `<section class="finance-section-heading"><div><p class="eyebrow">Planejamento do retiro em foco</p><h2>Sugestão de compras</h2><p>Projete todos os insumos recorrentes pelo consumo por participação diária de outro retiro.</p></div></section>
    <form class="panel finance-purchase-form" data-purchase-form><label><span>Retiro usado como base <b>*</b></span><select name="baseRetreatId" required><option value="" ${purchaseBaseRetreatId ? '' : 'selected'} disabled>Selecione o retiro-base</option>${baseRetreats.map((retreat) => `<option value="${escapeHtml(retreat.id)}" ${retreat.id === purchaseBaseRetreatId ? 'selected' : ''}>${escapeHtml(retreat.nome)}</option>`).join('')}</select></label><button type="submit">Calcular sugestão</button></form>
    ${baseRetreats.length ? '' : '<section class="panel"><p class="empty-state">Nenhum outro retiro com planilha financeira está disponível como base.</p></section>'}
    <div data-purchase-result></div>`;
}

function purchaseSuggestionResultHtml({ rows, baseRetreat, state, baseParticipations, focusParticipations }) {
  const total = rows.reduce((sum, row) => sum + row.sugestaoCompra, 0);
  return `<section class="panel finance-purchase-summary"><div><span>Retiro-base</span><strong>${escapeHtml(baseRetreat.nome)}</strong></div><div><span>Participações diárias da base</span><strong>${suggestionQuantity(baseParticipations)}</strong></div><div><span>Participações diárias do foco</span><strong>${suggestionQuantity(focusParticipations)}</strong></div><div><span>Soma das quantidades sugeridas</span><strong>${suggestionQuantity(total)}</strong></div></section>
    ${focusParticipations > 0 ? '' : '<p class="finance-purchase-warning">O retiro em foco ainda não possui participações diárias; as necessidades projetadas ficaram zeradas.</p>'}
    <section class="panel finance-sheet-panel"><div class="panel-heading"><div><h2>Memória de cálculo</h2><p>Retiro em foco: ${escapeHtml(state.retreat.nome)}. Nenhum valor desta tabela é lançado automaticamente.</p></div></div><div class="finance-sheet-scroll"><table class="finance-purchase-table"><thead><tr><th>Setor</th><th>Insumo</th><th>Unidade</th><th>Consumo efetivo na base</th><th>Participações da base</th><th>Consumo por participação</th><th>Participações do foco</th><th>Necessidade projetada</th><th>Saldo do retiro anterior</th><th>Sugestão de compra</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.setor)}</td><td>${escapeHtml(row.descricao)}</td><td>${escapeHtml(row.unidade)}</td><td>${suggestionQuantity(row.consumoBase)}</td><td>${suggestionQuantity(row.participacoesBase)}</td><td>${suggestionQuantity(row.consumoPorParticipacao)}</td><td>${suggestionQuantity(row.participacoesFoco)}</td><td>${suggestionQuantity(row.necessidadeProjetada)}</td><td>${suggestionQuantity(row.saldoAnterior)}</td><td><strong>${suggestionQuantity(row.sugestaoCompra)}</strong></td></tr>`).join('')}</tbody></table></div>${rows.length ? '' : '<p class="empty-state">Nenhum insumo recorrente cadastrado no retiro em foco.</p>'}</section>`;
}

function wirePurchaseSuggestion(root, state, context) {
  root.querySelector('[data-purchase-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = root.querySelector('[data-purchase-result]');
    const button = form.querySelector('button[type="submit"]');
    purchaseBaseRetreatId = new FormData(form).get('baseRetreatId') || '';
    const baseRetreat = state.retreats.find((retreat) => retreat.id === purchaseBaseRetreatId);
    if (!baseRetreat) return;
    try {
      button.disabled = true;
      result.innerHTML = '<section class="panel"><p class="empty-state">Calculando participações e consumo...</p></section>';
      const [baseEnrolments, focusEnrolments, baseStudents, focusStudents] = await Promise.all([
        context.dataService.listAdesoes(baseRetreat.id),
        context.dataService.listAdesoes(state.retreat.id),
        context.dataService.listCursistas(baseRetreat.id),
        context.dataService.listCursistas(state.retreat.id),
      ]);
      const [baseParticipations, focusParticipations] = await Promise.all([
        participationTotalForRetreat(baseRetreat, context.dataService, baseEnrolments, baseStudents),
        participationTotalForRetreat(state.retreat, context.dataService, focusEnrolments, focusStudents),
      ]);
      const currentSheets = [generalSheet(state)];
      const baseSheets = financeSheetsForRetreat(state.allSheets, baseRetreat.id);
      const rows = purchaseSuggestionRows({ currentSheets, baseSheets, baseParticipations, focusParticipations });
      result.innerHTML = purchaseSuggestionResultHtml({ rows, baseRetreat, state, baseParticipations, focusParticipations });
    } catch (error) {
      result.innerHTML = `<p class="form-message finance-purchase-error">${escapeHtml(error.message)}</p>`;
    } finally { button.disabled = false; }
  });
}

function collectSheet(root, sheet, retreat) {
  const recurringRows = [...root.querySelectorAll('[data-finance-recurring-row]')];
  const recurring = recurringRows.length ? recurringRows.map((row, index) => ({
    id: row.dataset.id, chaveRecorrencia: row.dataset.key || row.dataset.origin || row.dataset.id || createId(), itemOrigemId: row.dataset.origin,
    descricao: row.querySelector('[data-field="descricao"]').value,
    unidade: row.querySelector('[data-field="unidade"]').value,
    fornecedor: row.querySelector('[data-field="fornecedor"]').value,
    posicaoAnterior: financeNumber(row.querySelector('[data-field="posicaoAnterior"]').value),
    modo: row.querySelector('[data-field="modo"]').value,
    entrada: financeNumber(row.querySelector('[data-field="entrada"]').value),
    saida: financeNumber(row.querySelector('[data-field="saida"]').value),
    doacao: financeNumber(row.querySelector('[data-field="doacao"]').value),
    saldo: financeNumber(row.querySelector('[data-field="saldo"]').value),
    precoUnitario: financeNumber(row.querySelector('[data-field="precoUnitario"]').value), ordem: index + 1,
  })) : (sheet.itensRecorrentes || []);
  const eventualRows = [...root.querySelectorAll('[data-finance-eventual-row]')];
  const eventual = eventualRows.length ? eventualRows.map((row, index) => ({
    id: row.dataset.id, numero: row.querySelector('[data-field="numero"]').value,
    tipoSerie: row.querySelector('[data-field="tipoSerie"]').value,
    observacao: row.querySelector('[data-field="observacao"]').value,
    fornecedor: row.querySelector('[data-field="fornecedor"]').value,
    valor: financeNumber(row.querySelector('[data-field="valor"]').value), ordem: index + 1,
  })) : (sheet.despesasEventuais || []);
  return { ...sheet, id: sheet.id || createId(), retiroId: retreat.id, setor: RETREAT_FINANCE_LABEL, setorChave: RETREAT_FINANCE_KEY, itensRecorrentes: recurring, despesasEventuais: eventual, motivoExclusao: pendingDeletionReason };
}

function refreshRow(row, changedField = '') {
  try {
    const mode = row.querySelector('[data-field="modo"]').value;
    const item = calculateRecurringItem({
      modo: mode,
      posicaoAnterior: row.querySelector('[data-field="posicaoAnterior"]').value,
      entrada: row.querySelector('[data-field="entrada"]').value,
      saida: row.querySelector('[data-field="saida"]').value,
      doacao: row.querySelector('[data-field="doacao"]').value,
      saldo: row.querySelector('[data-field="saldo"]').value,
      precoUnitario: row.querySelector('[data-field="precoUnitario"]').value,
    });
    const movement = mode !== 'saldo';
    row.querySelector('[data-field="saida"]').readOnly = !movement;
    row.querySelector('[data-field="saldo"]').readOnly = false;
    if (!movement || changedField !== 'entrada') row.querySelector('[data-field="entrada"]').value = inputValue(item.entrada);
    if (!movement || changedField !== 'saida') row.querySelector('[data-field="saida"]').value = inputValue(item.saida);
    if (!movement && changedField !== 'saldo') row.querySelector('[data-field="saldo"]').value = inputValue(item.saldo);
    row.querySelector('[data-row-values]').innerHTML = `<small>Saída ${financeMoney(item.valorSaida)}</small><strong>Saldo ${financeMoney(item.valorSaldo)}</strong>`;
    row.classList.remove('is-invalid');
  } catch { row.classList.add('is-invalid'); }
}

function sortRecurringRows(root, button) {
  const key = button.dataset.recurringSort;
  const body = root.querySelector('[data-recurring-body]');
  if (!key || !body) return;
  const nextDirection = button.dataset.sortDirection === 'asc' ? 'desc' : 'asc';
  const textValue = (row, field) => normalizeFinanceSearch(row.querySelector(`[data-field="${field}"]`)?.value);
  const numericValue = (row, field) => financeNumber(row.querySelector(`[data-field="${field}"]`)?.value);
  const rowValue = (row) => {
    if (['descricao', 'unidade', 'fornecedor'].includes(key)) return textValue(row, key);
    if (key === 'valorSaida') {
      const item = calculateRecurringItem({
        posicaoAnterior: numericValue(row, 'posicaoAnterior'),
        entrada: numericValue(row, 'entrada'),
        saida: numericValue(row, 'saida'),
        doacao: numericValue(row, 'doacao'),
        saldo: numericValue(row, 'saldo'),
        precoUnitario: numericValue(row, 'precoUnitario'),
        modo: row.querySelector('[data-field="modo"]')?.value,
      });
      return item.valorSaida;
    }
    return numericValue(row, key);
  };
  const rows = [...body.querySelectorAll('[data-finance-recurring-row]')];
  rows.sort((first, second) => {
    const firstValue = rowValue(first);
    const secondValue = rowValue(second);
    const result = typeof firstValue === 'string'
      ? firstValue.localeCompare(secondValue, 'pt-BR', { numeric: true, sensitivity: 'base' })
      : firstValue - secondValue;
    return nextDirection === 'asc' ? result : -result;
  });
  rows.forEach((row) => body.append(row));
  root.querySelectorAll('[data-recurring-sort]').forEach((header) => {
    header.dataset.sortDirection = '';
    header.setAttribute('aria-sort', 'none');
  });
  button.dataset.sortDirection = nextDirection;
  button.setAttribute('aria-sort', nextDirection === 'asc' ? 'ascending' : 'descending');
}

function filterRecurringRows(root) {
  const query = normalizeFinanceSearch(root.querySelector('[data-recurring-search]')?.value);
  const rows = [...root.querySelectorAll('[data-finance-recurring-row]')];
  let visibleRows = 0;
  rows.forEach((row) => {
    const description = normalizeFinanceSearch(row.querySelector('[data-field="descricao"]')?.value);
    row.hidden = Boolean(query) && !description.includes(query);
    if (!row.hidden) visibleRows += 1;
  });
  const noResults = root.querySelector('[data-recurring-no-results]');
  if (noResults) noResults.hidden = !query || visibleRows > 0 || rows.length === 0;
}

function wireSheet(root, sheet, state, context, permissions) {
  root.addEventListener('input', (event) => {
    if (event.target.matches('[data-recurring-search]')) {
      filterRecurringRows(root);
      return;
    }
    const row = event.target.closest('[data-finance-recurring-row]');
    if (row && ['entrada', 'saida', 'doacao', 'saldo', 'precoUnitario'].includes(event.target.dataset.field)) refreshRow(row, event.target.dataset.field);
    if (row && event.target.dataset.field === 'descricao') filterRecurringRows(root);
  });
  root.addEventListener('change', (event) => {
    const row = event.target.closest('[data-finance-recurring-row]');
    if (row && event.target.dataset.field === 'modo') refreshRow(row);
  });
  root.addEventListener('click', (event) => {
    const addRecurring = event.target.closest('[data-add-recurring]');
    const addEventual = event.target.closest('[data-add-eventual]');
    const remove = event.target.closest('[data-remove-row]');
    const sort = event.target.closest('[data-recurring-sort]');
    if (sort) {
      sortRecurringRows(root, sort);
      filterRecurringRows(root);
      return;
    }
    if (addRecurring) {
      root.querySelector('[data-recurring-body]').insertAdjacentHTML('beforeend', recurringRowHtml({ id: '', chaveRecorrencia: createId(), unidade: 'un', modo: 'movimento' }, permissions));
      root.querySelector('[data-recurring-empty]')?.remove();
      filterRecurringRows(root);
    }
    if (addEventual) {
      root.querySelector('[data-eventual-body]').insertAdjacentHTML('beforeend', eventualRowHtml({}, permissions));
      root.querySelector('[data-eventual-empty]')?.remove();
    }
    if (remove) {
      const row = remove.closest('tr');
      if (row.dataset.id) {
        const reason = String(prompt('Informe o motivo da exclusão deste item:') || '').trim();
        if (!reason) return;
        pendingDeletionReason = pendingDeletionReason ? `${pendingDeletionReason}; ${reason}` : reason;
      }
      row.remove();
      filterRecurringRows(root);
    }
  });
  root.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = root.querySelector('[data-finance-message]');
    const button = root.querySelector('button[type="submit"]');
    try {
      button.disabled = true;
      message.textContent = 'Salvando...';
      await context.dataService.saveFinanceSheet(collectSheet(root, sheet, state.retreat));
      pendingDeletionReason = '';
      await renderFinanceiro(context);
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });
}

function printBalance(state, currentUser) {
  const sheets = sheetsForBalance(state);
  const totals = retreatBalance(sheets);
  const popup = window.open('', '_blank');
  if (!popup) return alert('Permita pop-ups para visualizar e imprimir o balanço.');
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Balanço - ${escapeHtml(state.retreat.nome)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial;color:#203328}h1{margin:0}h2{margin:22px 0 8px;border-bottom:2px solid #315d39;padding-bottom:5px}small{display:block;color:#667}table{width:100%;border-collapse:collapse;margin:8px 0 14px}th,td{padding:6px;border:1px solid #ccd5cc;text-align:left;vertical-align:middle}.finance-balance-recurring{table-layout:fixed}.finance-balance-description{width:24%}.finance-balance-unit{width:8%}.finance-balance-previous{width:13%}.finance-balance-input{width:11%}.finance-balance-output{width:8%}.finance-balance-output-value{width:13%}.finance-balance-stock{width:11%}.finance-balance-price{width:12%}.finance-balance-recurring th{white-space:normal}.finance-balance-recurring td:not(:first-child){white-space:nowrap}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}.summary div{border:1px solid #ccd5cc;padding:9px}.summary strong{display:block;font-size:14px;margin-top:4px}.sector{break-inside:avoid}.footer{display:flex;gap:18px;flex-wrap:wrap;font-weight:bold}</style></head><body><h1>Balanço financeiro</h1><p>${escapeHtml(state.retreat.nome)} · gerado em ${new Date().toLocaleString('pt-BR')} por ${escapeHtml(currentUser?.username || currentUser?.nome || 'usuário')}</p><div class="summary">${[['Posição anterior', totals.previous], ['Entradas recorrentes', totals.input], ['Saídas / consumo', totals.output], ['Eventuais', totals.eventual], ['Saldo final', totals.balance], ['Total adquirido / desembolsado', totals.acquired], ['Total consumido', totals.consumed]].map(([label, value]) => `<div>${label}<strong>${financeMoney(value)}</strong></div>`).join('')}</div>${sheets.map((sheet) => `<div class="sector">${balanceSectorHtml(sheet).replace(/<section[^>]*>|<\/section>|class="finance-sheet-scroll"|class="finance-balance-eventual"/g, '')}</div>`).join('')}</body></html>`);
  popup.document.close();
  setTimeout(() => { popup.focus(); popup.print(); }, 250);
}

export async function renderFinanceiro(context) {
  const { retreat, layout, dataService, canAccess, currentUser } = context;
  if (!retreat) {
    layout('<section class="page-heading"><div><p class="eyebrow">Controle do retiro</p><h1>Nenhum retiro em foco</h1><p>Selecione um retiro na tela Início para acessar o Financeiro.</p></div><a class="secondary-button" href="#inicio">Ir para Início</a></section>', 'financeiro');
    return;
  }
  let state = await loadFinanceState(retreat, dataService);
  const readOnly = retreat.status === 'concluido';
  const canEdit = !readOnly && canAccess('financeiro.editar');
  const canDelete = !readOnly && canAccess('financeiro.excluir');
  if (!['recorrentes', 'eventuais', 'compra', 'balanco'].includes(activeView)) activeView = 'recorrentes';
  let initializationError = '';
  let sheet = generalSheet(state);
  if (['recorrentes', 'eventuais'].includes(activeView) && canEdit) {
    const existing = state.currentSheets.find((item) => item.setorChave === RETREAT_FINANCE_KEY);
    if (!existing) {
      try {
        await dataService.saveFinanceSheet({ ...sheet, id: createId() });
        state = await loadFinanceState(retreat, dataService);
        sheet = generalSheet(state);
      } catch (error) { initializationError = error.message; }
    }
  }
  const permissions = { canEdit, canDelete };
  const navigation = `<nav class="finance-sector-tabs" aria-label="Opções do Financeiro">${[
    ['recorrentes', 'Insumos recorrentes'],
    ['eventuais', 'Despesas eventuais'],
    ['compra', 'Sugestão de compras'],
    ['balanco', 'Balanço'],
  ].map(([view, label]) => `<button type="button" data-finance-view="${view}" class="${activeView === view ? 'is-active' : ''}">${label}</button>`).join('')}</nav>`;
  const content = activeView === 'balanco' ? balanceHtml(state) : activeView === 'compra' ? purchaseSuggestionHtml(state) : activeView === 'eventuais' ? eventualSheetHtml(sheet, state, permissions, initializationError) : recurringSheetHtml(sheet, state, permissions, initializationError);
  layout(`<section class="page-heading finance-page-heading"><div><p class="eyebrow">Módulo independente · retiro em foco</p><h1>Financeiro</h1><p><strong>${escapeHtml(retreat.nome)}</strong> · controle simplificado de despesas do retiro.</p>${readOnly ? '<p class="finance-readonly">Retiro concluído: módulo disponível somente para consulta.</p>' : ''}</div></section>${navigation}<div class="finance-content">${content}</div>`, 'financeiro');
  document.querySelectorAll('[data-finance-view]').forEach((button) => button.addEventListener('click', () => { activeView = button.dataset.financeView; pendingDeletionReason = ''; renderFinanceiro(context); }));
  const root = document.querySelector('.finance-content');
  if (['recorrentes', 'eventuais'].includes(activeView) && sheet && root) wireSheet(root, sheet, state, context, permissions);
  if (activeView === 'compra' && root) wirePurchaseSuggestion(root, state, context);
  root?.querySelector('[data-finance-print]')?.addEventListener('click', () => printBalance(state, currentUser));
}
