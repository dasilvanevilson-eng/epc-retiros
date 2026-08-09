import {
  calculateRecurringItem,
  financeMoney,
  financeNumber,
  financeQuantity,
  findPreviousRetreat,
  inheritSectorSheet,
  normalizeSectorKey,
  retreatBalance,
  sectorSheetTotals,
} from './financeiroCore.js?v=20260809-planilhas-financeiras';

let activeSectorKey = '';
let activeView = 'setor';
let pendingDeletionReason = '';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const createId = () => globalThis.crypto?.randomUUID?.() || `finance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const inputValue = (value) => Number.isFinite(Number(value)) ? String(Number(value)) : '0';

const sheetForSector = (state, sector) => {
  const key = normalizeSectorKey(sector);
  const stored = state.currentSheets.find((sheet) => sheet.setorChave === key);
  if (stored) return stored;
  const previousSheet = state.previousRetreat
    ? state.allSheets.find((sheet) => sheet.retiroId === state.previousRetreat.id && sheet.setorChave === key)
    : null;
  return inheritSectorSheet({ retreat: state.retreat, sector, previousRetreat: state.previousRetreat, previousSheet });
};

async function loadFinanceState(retreat, dataService) {
  const [allSheets, retreats] = await Promise.all([dataService.listFinanceSheets(), dataService.listRetiros()]);
  const sectors = [...new Map((retreat.setores || []).map((sector) => [normalizeSectorKey(sector), String(sector).trim()])).values()]
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const previousRetreat = findPreviousRetreat(retreat, retreats);
  const currentSheets = allSheets.filter((sheet) => sheet.retiroId === retreat.id);
  const activeKeys = new Set(sectors.map(normalizeSectorKey));
  const historicalSheets = currentSheets.filter((sheet) => !activeKeys.has(sheet.setorChave));
  return { retreat, retreats, sectors, previousRetreat, allSheets, currentSheets, historicalSheets };
}

const recurringRowHtml = (item = {}, { canEdit, canDelete } = {}) => {
  const calculated = calculateRecurringItem(item);
  const disabled = canEdit ? '' : 'disabled';
  const movement = calculated.modo !== 'saldo';
  return `<tr data-finance-recurring-row data-id="${escapeHtml(item.id || '')}" data-key="${escapeHtml(item.chaveRecorrencia || '')}" data-origin="${escapeHtml(item.itemOrigemId || '')}">
    <td class="finance-row-order"><button type="button" data-move="up" ${disabled} aria-label="Mover para cima">↑</button><button type="button" data-move="down" ${disabled} aria-label="Mover para baixo">↓</button></td>
    <td><input data-field="descricao" value="${escapeHtml(item.descricao || '')}" placeholder="Descrição" ${disabled}></td>
    <td><input data-field="unidade" value="${escapeHtml(item.unidade || 'un')}" placeholder="un" ${disabled}></td>
    <td><input data-field="posicaoAnterior" value="${inputValue(calculated.posicaoAnterior)}" readonly tabindex="-1"></td>
    <td><select data-field="modo" ${disabled}><option value="movimento" ${movement ? 'selected' : ''}>Entrada/Saída</option><option value="saldo" ${!movement ? 'selected' : ''}>Somente saldo</option></select></td>
    <td><input data-field="entrada" inputmode="decimal" value="${inputValue(calculated.entrada)}" ${disabled} ${movement ? '' : 'readonly'}></td>
    <td><input data-field="saida" inputmode="decimal" value="${inputValue(calculated.saida)}" ${disabled} ${movement ? '' : 'readonly'}></td>
    <td><input data-field="saldo" inputmode="decimal" value="${inputValue(calculated.saldo)}" ${disabled} ${movement ? 'readonly' : ''}></td>
    <td><input data-field="precoUnitario" inputmode="decimal" value="${inputValue(calculated.precoUnitario)}" ${disabled}></td>
    <td data-row-values><small>Entrada ${financeMoney(calculated.valorEntrada)}</small><small>Saída ${financeMoney(calculated.valorSaida)}</small><strong>Saldo ${financeMoney(calculated.valorSaldo)}</strong></td>
    <td>${canEdit && canDelete ? '<button type="button" class="finance-remove-row" data-remove-row aria-label="Remover despesa recorrente">×</button>' : ''}</td>
  </tr>`;
};

const eventualRowHtml = (item = {}, { canEdit, canDelete } = {}) => {
  const disabled = canEdit ? '' : 'disabled';
  return `<tr data-finance-eventual-row data-id="${escapeHtml(item.id || '')}">
    <td class="finance-row-order"><button type="button" data-move="up" ${disabled} aria-label="Mover para cima">↑</button><button type="button" data-move="down" ${disabled} aria-label="Mover para baixo">↓</button></td>
    <td><input data-field="descricao" value="${escapeHtml(item.descricao || '')}" placeholder="Descrição da despesa" ${disabled}></td>
    <td><input data-field="valor" inputmode="decimal" value="${inputValue(item.valor)}" ${disabled}></td>
    <td>${canEdit && canDelete ? '<button type="button" class="finance-remove-row" data-remove-row aria-label="Remover despesa eventual">×</button>' : ''}</td>
  </tr>`;
};

function sectorSheetHtml(sheet, state, permissions, initializationError = '') {
  const totals = sectorSheetTotals(sheet);
  const inherited = sheet.retiroOrigemId && state.previousRetreat;
  return `<section class="finance-section-heading"><div><p class="eyebrow">Movimentação por setor</p><h2>${escapeHtml(sheet.setor)}</h2><p>${inherited ? `Posição e preços herdados de ${escapeHtml(state.previousRetreat.nome)}.` : 'Sem posição anterior disponível; itens novos iniciam zerados.'}</p></div></section>
  <form id="finance-sector-sheet" class="finance-sheet-form" data-sheet-id="${escapeHtml(sheet.id || '')}">
    <section class="panel finance-sheet-panel"><div class="panel-heading"><div><h2>Despesas recorrentes</h2><p>Controle resumido de entrada, saída e saldo, sem lançamento de notas.</p></div>${permissions.canEdit ? '<button type="button" class="secondary-button" data-add-recurring>Adicionar despesa</button>' : ''}</div>
      <div class="finance-sheet-scroll"><table class="finance-sheet-table"><thead><tr><th>Ordem</th><th>Despesa</th><th>Unidade</th><th>Posição anterior</th><th>Lançamento</th><th>Entrada</th><th>Saída</th><th>Saldo</th><th>Preço unitário</th><th>Valores</th><th></th></tr></thead><tbody data-recurring-body>${(sheet.itensRecorrentes || []).map((item) => recurringRowHtml(item, permissions)).join('')}</tbody></table></div>
      ${sheet.itensRecorrentes?.length ? '' : '<p class="empty-state" data-recurring-empty>Nenhuma despesa recorrente neste setor.</p>'}
    </section>
    <section class="panel finance-sheet-panel"><div class="panel-heading"><div><h2>Despesas eventuais</h2><p>Despesas não recorrentes, sem controle de estoque.</p></div>${permissions.canEdit ? '<button type="button" class="secondary-button" data-add-eventual>Adicionar despesa</button>' : ''}</div>
      <div class="finance-sheet-scroll"><table class="finance-eventual-table"><thead><tr><th>Ordem</th><th>Descrição</th><th>Valor</th><th></th></tr></thead><tbody data-eventual-body>${(sheet.despesasEventuais || []).map((item) => eventualRowHtml(item, permissions)).join('')}</tbody></table></div>
      ${sheet.despesasEventuais?.length ? '' : '<p class="empty-state" data-eventual-empty>Nenhuma despesa eventual neste setor.</p>'}
    </section>
    <section class="panel finance-sector-summary"><div><span>Entradas recorrentes</span><strong data-sector-input>${financeMoney(totals.input)}</strong></div><div><span>Saídas recorrentes</span><strong data-sector-output>${financeMoney(totals.output)}</strong></div><div><span>Eventuais</span><strong data-sector-eventual>${financeMoney(totals.eventual)}</strong></div><div><span>Saldo valorizado</span><strong data-sector-balance>${financeMoney(totals.balance)}</strong></div></section>
    <p class="form-message" data-finance-message>${escapeHtml(initializationError)}</p>
    ${permissions.canEdit ? '<div class="form-actions finance-save-actions"><span>As alterações afetam somente este retiro e setor.</span><button type="submit">Salvar planilha <span>→</span></button></div>' : ''}
  </form>`;
}

const metricHtml = (label, value) => `<article><span>${label}</span><strong>${financeMoney(value)}</strong></article>`;

function balanceSectorHtml(sheet) {
  const totals = sectorSheetTotals(sheet);
  const recurringRows = (sheet.itensRecorrentes || []).map((raw) => {
    const item = calculateRecurringItem(raw);
    return `<tr><td>${escapeHtml(item.descricao)}</td><td>${escapeHtml(item.unidade)}</td><td>${financeQuantity(item.posicaoAnterior)}<small>${financeMoney(item.valorPosicaoAnterior)}</small></td><td>${financeQuantity(item.entrada)}<small>${financeMoney(item.valorEntrada)}</small></td><td>${financeQuantity(item.saida)}<small>${financeMoney(item.valorSaida)}</small></td><td>${financeQuantity(item.saldo)}<small>${financeMoney(item.valorSaldo)}</small></td><td>${financeMoney(item.precoUnitario)}</td></tr>`;
  }).join('');
  const eventualRows = (sheet.despesasEventuais || []).map((item) => `<tr><td>${escapeHtml(item.descricao)}</td><td>${financeMoney(item.valor)}</td></tr>`).join('');
  return `<section class="panel finance-balance-sector"><h2>${escapeHtml(sheet.setor)}${sheet.historica ? ' <small>(setor histórico)</small>' : ''}</h2>
    ${recurringRows ? `<div class="finance-sheet-scroll"><table><thead><tr><th>Despesa</th><th>Unidade</th><th>Posição anterior</th><th>Entrada</th><th>Saída</th><th>Saldo</th><th>Preço unitário</th></tr></thead><tbody>${recurringRows}</tbody></table></div>` : '<p class="empty-state">Sem despesas recorrentes.</p>'}
    ${eventualRows ? `<h3>Despesas eventuais</h3><table class="finance-balance-eventual"><thead><tr><th>Descrição</th><th>Valor</th></tr></thead><tbody>${eventualRows}</tbody></table>` : ''}
    <footer><span>Entradas: <b>${financeMoney(totals.input)}</b></span><span>Saídas: <b>${financeMoney(totals.output)}</b></span><span>Eventuais: <b>${financeMoney(totals.eventual)}</b></span><span>Saldo: <b>${financeMoney(totals.balance)}</b></span></footer></section>`;
}

function sheetsForBalance(state) {
  const configured = state.sectors.map((sector) => sheetForSector(state, sector));
  return [...configured, ...state.historicalSheets.map((sheet) => ({ ...sheet, historica: true }))];
}

function balanceHtml(state) {
  const sheets = sheetsForBalance(state);
  const totals = retreatBalance(sheets);
  return `<section class="finance-section-heading"><div><p class="eyebrow">Retiro em foco</p><h2>Balanço de ${escapeHtml(state.retreat.nome)}</h2><p>Valores adquiridos e consumidos apresentados separadamente.</p></div><button type="button" data-finance-print>Visualizar / imprimir</button></section>
    <section class="finance-metrics finance-balance-metrics">${metricHtml('Posição anterior', totals.previous)}${metricHtml('Entradas recorrentes', totals.input)}${metricHtml('Saídas / consumo', totals.output)}${metricHtml('Despesas eventuais', totals.eventual)}${metricHtml('Saldo final valorizado', totals.balance)}${metricHtml('Total adquirido / desembolsado', totals.acquired)}${metricHtml('Total consumido', totals.consumed)}</section>
    <div class="finance-balance-sectors">${sheets.map(balanceSectorHtml).join('') || '<section class="panel"><p class="empty-state">Nenhum setor configurado para este retiro.</p></section>'}</div>`;
}

function collectSheet(root, sheet, retreat) {
  const recurring = [...root.querySelectorAll('[data-finance-recurring-row]')].map((row, index) => ({
    id: row.dataset.id, chaveRecorrencia: row.dataset.key, itemOrigemId: row.dataset.origin,
    descricao: row.querySelector('[data-field="descricao"]').value,
    unidade: row.querySelector('[data-field="unidade"]').value,
    posicaoAnterior: financeNumber(row.querySelector('[data-field="posicaoAnterior"]').value),
    modo: row.querySelector('[data-field="modo"]').value,
    entrada: financeNumber(row.querySelector('[data-field="entrada"]').value),
    saida: financeNumber(row.querySelector('[data-field="saida"]').value),
    saldo: financeNumber(row.querySelector('[data-field="saldo"]').value),
    precoUnitario: financeNumber(row.querySelector('[data-field="precoUnitario"]').value), ordem: index + 1,
  }));
  const eventual = [...root.querySelectorAll('[data-finance-eventual-row]')].map((row, index) => ({
    id: row.dataset.id, descricao: row.querySelector('[data-field="descricao"]').value,
    valor: financeNumber(row.querySelector('[data-field="valor"]').value), ordem: index + 1,
  }));
  return { ...sheet, id: sheet.id || createId(), retiroId: retreat.id, itensRecorrentes: recurring, despesasEventuais: eventual, motivoExclusao: pendingDeletionReason };
}

function refreshRow(row, changedField = '') {
  try {
    const mode = row.querySelector('[data-field="modo"]').value;
    const item = calculateRecurringItem({
      modo: mode,
      posicaoAnterior: row.querySelector('[data-field="posicaoAnterior"]').value,
      entrada: row.querySelector('[data-field="entrada"]').value,
      saida: row.querySelector('[data-field="saida"]').value,
      saldo: row.querySelector('[data-field="saldo"]').value,
      precoUnitario: row.querySelector('[data-field="precoUnitario"]').value,
    });
    const movement = mode !== 'saldo';
    row.querySelector('[data-field="entrada"]').readOnly = !movement;
    row.querySelector('[data-field="saida"]').readOnly = !movement;
    row.querySelector('[data-field="saldo"]').readOnly = movement;
    if (!movement || changedField !== 'entrada') row.querySelector('[data-field="entrada"]').value = inputValue(item.entrada);
    if (!movement || changedField !== 'saida') row.querySelector('[data-field="saida"]').value = inputValue(item.saida);
    if (movement || changedField !== 'saldo') row.querySelector('[data-field="saldo"]').value = inputValue(item.saldo);
    row.querySelector('[data-row-values]').innerHTML = `<small>Entrada ${financeMoney(item.valorEntrada)}</small><small>Saída ${financeMoney(item.valorSaida)}</small><strong>Saldo ${financeMoney(item.valorSaldo)}</strong>`;
    row.classList.remove('is-invalid');
  } catch { row.classList.add('is-invalid'); }
}

function refreshSectorTotals(root) {
  try {
    const provisional = collectSheet(root, { id: '', setor: '' }, { id: '' });
    const totals = sectorSheetTotals(provisional);
    root.querySelector('[data-sector-input]').textContent = financeMoney(totals.input);
    root.querySelector('[data-sector-output]').textContent = financeMoney(totals.output);
    root.querySelector('[data-sector-eventual]').textContent = financeMoney(totals.eventual);
    root.querySelector('[data-sector-balance]').textContent = financeMoney(totals.balance);
  } catch { /* A validação completa será mostrada ao salvar. */ }
}

function moveRow(button) {
  const row = button.closest('tr');
  if (button.dataset.move === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
  if (button.dataset.move === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
}

function wireSheet(root, sheet, state, context, permissions) {
  root.addEventListener('input', (event) => {
    const row = event.target.closest('[data-finance-recurring-row]');
    if (row && ['entrada', 'saida', 'saldo', 'precoUnitario'].includes(event.target.dataset.field)) refreshRow(row, event.target.dataset.field);
    refreshSectorTotals(root);
  });
  root.addEventListener('change', (event) => {
    const row = event.target.closest('[data-finance-recurring-row]');
    if (row && event.target.dataset.field === 'modo') refreshRow(row);
    refreshSectorTotals(root);
  });
  root.addEventListener('click', (event) => {
    const addRecurring = event.target.closest('[data-add-recurring]');
    const addEventual = event.target.closest('[data-add-eventual]');
    const move = event.target.closest('[data-move]');
    const remove = event.target.closest('[data-remove-row]');
    if (addRecurring) {
      root.querySelector('[data-recurring-body]').insertAdjacentHTML('beforeend', recurringRowHtml({ id: '', chaveRecorrencia: createId(), unidade: 'un', modo: 'movimento' }, permissions));
      root.querySelector('[data-recurring-empty]')?.remove();
    }
    if (addEventual) {
      root.querySelector('[data-eventual-body]').insertAdjacentHTML('beforeend', eventualRowHtml({}, permissions));
      root.querySelector('[data-eventual-empty]')?.remove();
    }
    if (move) moveRow(move);
    if (remove) {
      const row = remove.closest('tr');
      if (row.dataset.id) {
        const reason = String(prompt('Informe o motivo da exclusão deste item:') || '').trim();
        if (!reason) return;
        pendingDeletionReason = pendingDeletionReason ? `${pendingDeletionReason}; ${reason}` : reason;
      }
      row.remove();
      refreshSectorTotals(root);
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
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Balanço - ${escapeHtml(state.retreat.nome)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial;color:#203328}h1{margin:0}h2{margin:22px 0 8px;border-bottom:2px solid #315d39;padding-bottom:5px}small{display:block;color:#667}table{width:100%;border-collapse:collapse;margin:8px 0 14px}th,td{padding:6px;border:1px solid #ccd5cc;text-align:left}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}.summary div{border:1px solid #ccd5cc;padding:9px}.summary strong{display:block;font-size:14px;margin-top:4px}.sector{break-inside:avoid}.footer{display:flex;gap:18px;flex-wrap:wrap;font-weight:bold}</style></head><body><h1>Balanço financeiro</h1><p>${escapeHtml(state.retreat.nome)} · gerado em ${new Date().toLocaleString('pt-BR')} por ${escapeHtml(currentUser?.username || currentUser?.nome || 'usuário')}</p><div class="summary">${[['Posição anterior', totals.previous], ['Entradas recorrentes', totals.input], ['Saídas / consumo', totals.output], ['Eventuais', totals.eventual], ['Saldo final', totals.balance], ['Total adquirido / desembolsado', totals.acquired], ['Total consumido', totals.consumed]].map(([label, value]) => `<div>${label}<strong>${financeMoney(value)}</strong></div>`).join('')}</div>${sheets.map((sheet) => `<div class="sector">${balanceSectorHtml(sheet).replace(/<section[^>]*>|<\/section>|class="finance-sheet-scroll"|class="finance-balance-eventual"/g, '')}</div>`).join('')}</body></html>`);
  popup.document.close();
  setTimeout(() => { popup.focus(); popup.print(); }, 250);
}

export async function renderFinanceiro(context) {
  const { retreat, layout, dataService, canAccess, currentUser } = context;
  if (!retreat) {
    layout('<section class="page-heading"><div><p class="eyebrow">Controle por setor</p><h1>Nenhum retiro em foco</h1><p>Selecione um retiro na tela Início para acessar o Financeiro.</p></div><a class="secondary-button" href="#inicio">Ir para Início</a></section>', 'financeiro');
    return;
  }
  let state = await loadFinanceState(retreat, dataService);
  const readOnly = retreat.status === 'concluido';
  const canEdit = !readOnly && canAccess('financeiro.editar');
  const canDelete = !readOnly && canAccess('financeiro.excluir');
  const configuredKeys = state.sectors.map(normalizeSectorKey);
  if (!activeSectorKey || !configuredKeys.includes(activeSectorKey)) activeSectorKey = configuredKeys[0] || '';
  let initializationError = '';
  if (activeView === 'setor' && activeSectorKey && canEdit) {
    const sector = state.sectors.find((item) => normalizeSectorKey(item) === activeSectorKey);
    const existing = state.currentSheets.find((sheet) => sheet.setorChave === activeSectorKey);
    if (!existing) {
      try {
        const draft = sheetForSector(state, sector);
        await dataService.saveFinanceSheet({ ...draft, id: createId() });
        state = await loadFinanceState(retreat, dataService);
      } catch (error) { initializationError = error.message; }
    }
  }
  const activeSector = state.sectors.find((sector) => normalizeSectorKey(sector) === activeSectorKey);
  const sheet = activeSector ? sheetForSector(state, activeSector) : null;
  const permissions = { canEdit, canDelete };
  const navigation = `<nav class="finance-sector-tabs" aria-label="Setores do Financeiro">${state.sectors.map((sector) => `<button type="button" data-finance-sector="${escapeHtml(normalizeSectorKey(sector))}" class="${activeView === 'setor' && normalizeSectorKey(sector) === activeSectorKey ? 'is-active' : ''}">${escapeHtml(sector)}</button>`).join('')}<button type="button" data-finance-balance class="finance-balance-tab ${activeView === 'balanco' ? 'is-active' : ''}">Balanço</button></nav>`;
  const content = activeView === 'balanco' ? balanceHtml(state) : sheet ? sectorSheetHtml(sheet, state, permissions, initializationError) : '<section class="panel"><p class="empty-state">Nenhum setor configurado neste retiro.</p></section>';
  layout(`<section class="page-heading finance-page-heading"><div><p class="eyebrow">Módulo independente · retiro em foco</p><h1>Financeiro</h1><p><strong>${escapeHtml(retreat.nome)}</strong> · controle simplificado de despesas por setor.</p>${readOnly ? '<p class="finance-readonly">Retiro concluído: módulo disponível somente para consulta.</p>' : ''}</div></section>${navigation}<div class="finance-content">${content}</div>`, 'financeiro');
  document.querySelectorAll('[data-finance-sector]').forEach((button) => button.addEventListener('click', () => { activeView = 'setor'; activeSectorKey = button.dataset.financeSector; pendingDeletionReason = ''; renderFinanceiro(context); }));
  document.querySelector('[data-finance-balance]')?.addEventListener('click', () => { activeView = 'balanco'; pendingDeletionReason = ''; renderFinanceiro(context); });
  const root = document.querySelector('.finance-content');
  if (activeView === 'setor' && sheet && root) wireSheet(root, sheet, state, context, permissions);
  root?.querySelector('[data-finance-print]')?.addEventListener('click', () => printBalance(state, currentUser));
}
