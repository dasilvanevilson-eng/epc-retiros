import { expenseTotal, financeMoney, financeNumber, inventorySummary, quoteComparison, retreatCost } from './financeiroCore.js';

let activeFinanceTab = 'visao-geral';
let editingExpenseId = '';
let editingQuoteId = '';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const id = () => globalThis.crypto?.randomUUID?.() || `fin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : 'Não informada';
const optionList = (records, selected = '', empty = 'Selecione') => `<option value="">${empty}</option>${records.map((record) => `<option value="${escapeHtml(record.id)}" ${record.id === selected ? 'selected' : ''}>${escapeHtml(record.nome)}</option>`).join('')}`;
const statusLabel = (status) => ({ pendente: 'Pendente', paga: 'Paga', cancelada: 'Cancelada', aberta: 'Aberta', concluida: 'Concluída' })[status] || status;

function expenseItemRow(item = {}, catalogs = {}) {
  return `<div class="finance-line-row" data-expense-item data-id="${escapeHtml(item.id || id())}">
    <label><span>Produto</span><select data-field="produtoId">${optionList(catalogs.products || [], item.produtoId, 'Sem produto cadastrado')}</select></label>
    <label class="finance-grow"><span>Descrição *</span><input data-field="descricao" value="${escapeHtml(item.descricao || '')}" required></label>
    <label><span>Qtd. *</span><input data-field="quantidade" inputmode="decimal" value="${escapeHtml(item.quantidade || 1)}" required></label>
    <label><span>Unidade</span><input data-field="unidade" value="${escapeHtml(item.unidade || 'un')}" maxlength="20"></label>
    <label><span>Valor unit. *</span><input data-field="valorUnitario" inputmode="decimal" value="${escapeHtml(item.valorUnitario ?? '')}" required></label>
    <label><span>Tipo</span><select data-field="categoriaId">${optionList(catalogs.categories || [], item.categoriaId)}</select></label>
    <label><span>Setor</span><select data-field="setor">${optionList((catalogs.sectors || []).map((nome) => ({ id: nome, nome })), item.setor)}</select></label>
    <label class="finance-check"><input type="checkbox" data-field="controlaEstoque" ${item.controlaEstoque ? 'checked' : ''}> Controlar estoque</label>
    <button type="button" class="finance-icon-button" data-remove-line aria-label="Remover item">×</button>
  </div>`;
}

function quoteItemRow(item = {}) {
  return `<div class="finance-line-row finance-quote-item" data-quote-item data-id="${escapeHtml(item.id || id())}">
    <label class="finance-grow"><span>Item *</span><input data-field="descricao" value="${escapeHtml(item.descricao || '')}" required></label>
    <label><span>Quantidade *</span><input data-field="quantidade" inputmode="decimal" value="${escapeHtml(item.quantidade || 1)}" required></label>
    <label><span>Unidade</span><input data-field="unidade" value="${escapeHtml(item.unidade || 'un')}"></label>
    <button type="button" class="finance-icon-button" data-remove-line aria-label="Remover item">×</button>
  </div>`;
}

function quoteOfferRow(offer = {}, quoteItems = [], suppliers = []) {
  return `<div class="finance-line-row finance-offer-row" data-quote-offer data-id="${escapeHtml(offer.id || id())}">
    <label><span>Fornecedor *</span><select data-field="fornecedorId" required>${optionList(suppliers, offer.fornecedorId)}</select></label>
    <label><span>Item *</span><select data-field="itemId" required>${optionList(quoteItems.map((item) => ({ id: item.id, nome: item.descricao || 'Item sem nome' })), offer.itemId)}</select></label>
    <label><span>Valor unit.</span><input data-field="valorUnitario" inputmode="decimal" value="${escapeHtml(offer.valorUnitario ?? '')}"></label>
    <label><span>Frete fornecedor</span><input data-field="frete" inputmode="decimal" value="${escapeHtml(offer.frete || '')}"></label>
    <label><span>Desconto fornecedor</span><input data-field="desconto" inputmode="decimal" value="${escapeHtml(offer.desconto || '')}"></label>
    <label class="finance-check"><input type="checkbox" data-field="disponivel" ${offer.disponivel === false ? '' : 'checked'}> Disponível</label>
    <button type="button" class="finance-icon-button" data-remove-line aria-label="Remover oferta">×</button>
  </div>`;
}

const itemName = (item, products) => products.find((product) => product.id === item.produtoId)?.nome || item.descricao || 'Item';

function overviewHtml(state) {
  const cost = retreatCost(state.expenses, state.retreatMovements);
  const paid = state.expenses.filter((item) => item.status === 'paga').reduce((sum, item) => sum + expenseTotal(item), 0);
  const pending = state.expenses.filter((item) => item.status === 'pendente').reduce((sum, item) => sum + expenseTotal(item), 0);
  const inventory = inventorySummary(state.products, state.movements);
  const lowStock = inventory.filter((item) => financeNumber(item.product.estoqueMinimo) > 0 && item.balance <= financeNumber(item.product.estoqueMinimo));
  const unreferenced = state.expenses.filter((item) => item.status !== 'cancelada' && !String(item.documento || '').trim());
  const typeTotals = new Map(); const sectorTotals = new Map();
  state.expenses.filter((expense) => expense.status !== 'cancelada').forEach((expense) => (expense.itens || []).filter((item) => !item.controlaEstoque).forEach((item) => {
    const value = financeNumber(item.total) || financeNumber(item.quantidade) * financeNumber(item.valorUnitario);
    const type = state.categories.find((category) => category.id === item.categoriaId)?.nome || 'Sem tipo';
    typeTotals.set(type, (typeTotals.get(type) || 0) + value);
    sectorTotals.set(item.setor || 'Sem setor', (sectorTotals.get(item.setor || 'Sem setor') || 0) + value);
  }));
  state.retreatMovements.filter((movement) => ['retirada', 'perda'].includes(movement.tipo)).forEach((movement) => sectorTotals.set(movement.setor || 'Sem setor', (sectorTotals.get(movement.setor || 'Sem setor') || 0) + financeNumber(movement.custoTotal)));
  const ranking = [...state.expenses].filter((item) => item.status !== 'cancelada').sort((a, b) => expenseTotal(b) - expenseTotal(a)).slice(0, 5);
  return `<section class="finance-metrics">
    <article><span>Custo real do retiro</span><strong>${financeMoney(cost.total)}</strong><small>${financeMoney(cost.direct)} direto + ${financeMoney(cost.consumed)} consumido</small></article>
    <article><span>Despesas pagas</span><strong>${financeMoney(paid)}</strong><small>${state.expenses.filter((item) => item.status === 'paga').length} lançamento(s)</small></article>
    <article><span>A pagar</span><strong>${financeMoney(pending)}</strong><small>${state.expenses.filter((item) => item.status === 'pendente').length} pendência(s)</small></article>
    <article><span>Cotações abertas</span><strong>${state.quotes.filter((item) => item.status !== 'concluida').length}</strong><small>listas em avaliação</small></article>
    <article class="${lowStock.length ? 'is-warning' : ''}"><span>Estoque baixo</span><strong>${lowStock.length}</strong><small>produto(s) no mínimo</small></article>
    <article class="${unreferenced.length ? 'is-warning' : ''}"><span>Sem documento</span><strong>${unreferenced.length}</strong><small>despesa(s) sem referência</small></article>
  </section>
  <section class="finance-overview-grid">
    <article class="panel"><h2>Maiores despesas</h2>${ranking.length ? `<div class="finance-ranked-list">${ranking.map((expense) => `<div><span>${escapeHtml(expense.descricao || 'Despesa')}</span><strong>${financeMoney(expenseTotal(expense))}</strong></div>`).join('')}</div>` : '<p class="empty-state">Nenhuma despesa cadastrada.</p>'}</article>
    <article class="panel"><h2>Custo por tipo</h2>${summaryRows(typeTotals)}</article>
    <article class="panel"><h2>Custo por setor</h2>${summaryRows(sectorTotals)}</article>
    <article class="panel"><h2>Alertas de estoque</h2>${lowStock.length ? `<div class="finance-ranked-list">${lowStock.map((item) => `<div><span>${escapeHtml(item.product.nome)}</span><strong>${item.balance} ${escapeHtml(item.product.unidade || 'un')}</strong></div>`).join('')}</div>` : '<p class="empty-state">Todos os produtos estão acima do mínimo.</p>'}</article>
  </section>`;
}

function summaryRows(map) {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return rows.length ? `<div class="finance-ranked-list">${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${financeMoney(value)}</strong></div>`).join('')}</div>` : '<p class="empty-state">Ainda não há valores para apresentar.</p>';
}

function expensesHtml(state, canEdit, canDelete) {
  const editing = state.expenses.find((item) => item.id === editingExpenseId) || null;
  const items = editing?.itens?.length ? editing.itens : [{}];
  return `<section class="finance-section-heading"><div><h2>Despesas e compras</h2><p>Registre gastos de uso único e compras que abastecem o estoque central.</p></div></section>
  ${canEdit ? `<form class="panel finance-form" id="finance-expense-form">
    <div class="panel-heading"><div><h2>${editing ? 'Editar despesa' : 'Nova despesa'}</h2><p>O custo de itens estocáveis só será atribuído ao retiro quando houver consumo.</p></div>${editing ? '<button type="button" class="secondary-button" data-cancel-expense>Cancelar edição</button>' : ''}</div>
    <input type="hidden" name="id" value="${escapeHtml(editing?.id || '')}">
    <div class="finance-form-grid"><label><span>Descrição *</span><input name="descricao" value="${escapeHtml(editing?.descricao || '')}" required></label><label><span>Fornecedor</span><select name="fornecedorId">${optionList(state.suppliers, editing?.fornecedorId)}</select></label><label><span>Documento/referência</span><input name="documento" value="${escapeHtml(editing?.documento || '')}"></label><label><span>Data</span><input name="data" type="date" value="${escapeHtml(editing?.data || today())}"></label><label><span>Vencimento</span><input name="vencimento" type="date" value="${escapeHtml(editing?.vencimento || '')}"></label><label><span>Situação</span><select name="status"><option value="pendente" ${editing?.status !== 'paga' && editing?.status !== 'cancelada' ? 'selected' : ''}>Pendente</option><option value="paga" ${editing?.status === 'paga' ? 'selected' : ''}>Paga</option><option value="cancelada" ${editing?.status === 'cancelada' ? 'selected' : ''}>Cancelada</option></select></label><label><span>Forma de pagamento</span><input name="formaPagamento" value="${escapeHtml(editing?.formaPagamento || '')}"></label><label><span>Frete</span><input name="frete" inputmode="decimal" value="${escapeHtml(editing?.frete || '')}"></label><label><span>Desconto</span><input name="desconto" inputmode="decimal" value="${escapeHtml(editing?.desconto || '')}"></label></div>
    <div class="finance-lines-heading"><h3>Itens</h3><button type="button" class="secondary-button" data-add-expense-item>Adicionar item</button></div><div data-expense-items>${items.map((item) => expenseItemRow(item, { products: state.products, categories: state.categories, sectors: state.sectors })).join('')}</div>
    <label class="finance-wide"><span>Observações</span><textarea name="observacao" rows="3">${escapeHtml(editing?.observacao || '')}</textarea></label>
    <label class="finance-check finance-stock-confirm"><input type="checkbox" name="confirmarEstoque" ${editing ? '' : 'checked'}> Confirmar agora a entrada dos itens marcados para estoque</label>
    <p class="form-message" data-finance-message></p><div class="form-actions"><button type="submit">Salvar despesa <span>→</span></button></div>
  </form>` : ''}
  <section class="panel finance-table-panel"><div class="finance-table finance-expense-table"><div class="finance-table-head"><span>Data</span><span>Despesa</span><span>Fornecedor</span><span>Situação</span><span>Total</span><span>Ações</span></div>${state.expenses.length ? state.expenses.map((expense) => `<div class="finance-table-row"><span>${formatDate(expense.data)}</span><span><strong>${escapeHtml(expense.descricao || 'Despesa')}</strong><small>${escapeHtml(expense.documento || 'Sem referência')} · ${(expense.itens || []).length} item(ns)</small></span><span>${escapeHtml(state.suppliers.find((supplier) => supplier.id === expense.fornecedorId)?.nome || 'Não informado')}</span><span><em class="finance-status ${escapeHtml(expense.status)}">${statusLabel(expense.status)}</em></span><span><strong>${financeMoney(expenseTotal(expense))}</strong></span><span class="finance-row-actions">${canEdit ? `<button type="button" data-edit-expense="${expense.id}">Editar</button>` : ''}${canDelete ? `<button type="button" class="is-danger" data-delete-expense="${expense.id}">Excluir</button>` : ''}</span></div>`).join('') : '<p class="empty-state">Nenhuma despesa cadastrada para este retiro.</p>'}</div></section>`;
}

function quotesHtml(state, canEdit, canDelete) {
  const editing = state.quotes.find((item) => item.id === editingQuoteId) || null;
  const items = editing?.itens?.length ? editing.itens : [{}];
  const offers = editing?.ofertas || [];
  return `<section class="finance-section-heading"><div><h2>Cotações</h2><p>Compare o menor total em uma loja com a melhor combinação por item.</p></div></section>
  ${canEdit ? `<form class="panel finance-form" id="finance-quote-form"><div class="panel-heading"><div><h2>${editing ? 'Editar cotação' : 'Nova lista de cotação'}</h2><p>Frete e desconto são considerados no custo final.</p></div>${editing ? '<button type="button" class="secondary-button" data-cancel-quote>Cancelar edição</button>' : ''}</div><input type="hidden" name="id" value="${escapeHtml(editing?.id || '')}"><div class="finance-form-grid"><label><span>Título *</span><input name="titulo" value="${escapeHtml(editing?.titulo || '')}" required></label><label><span>Validade</span><input name="validade" type="date" value="${escapeHtml(editing?.validade || '')}"></label><label><span>Condições</span><input name="condicoes" value="${escapeHtml(editing?.condicoes || '')}"></label><label><span>Situação</span><select name="status"><option value="aberta" ${editing?.status !== 'concluida' ? 'selected' : ''}>Aberta</option><option value="concluida" ${editing?.status === 'concluida' ? 'selected' : ''}>Concluída</option></select></label></div><div class="finance-lines-heading"><h3>Itens desejados</h3><button type="button" class="secondary-button" data-add-quote-item>Adicionar item</button></div><div data-quote-items>${items.map(quoteItemRow).join('')}</div><div class="finance-lines-heading"><h3>Preços recebidos</h3><button type="button" class="secondary-button" data-add-quote-offer>Adicionar preço</button></div><div data-quote-offers>${offers.map((offer) => quoteOfferRow(offer, items, state.suppliers)).join('')}</div><label class="finance-wide"><span>Observações</span><textarea name="observacao" rows="3">${escapeHtml(editing?.observacao || '')}</textarea></label><p class="form-message" data-finance-message></p><div class="form-actions"><button type="submit">Salvar cotação <span>→</span></button></div></form>` : ''}
  <div class="finance-quote-cards">${state.quotes.length ? state.quotes.map((quote) => quoteCard(quote, state, canEdit, canDelete)).join('') : '<section class="panel"><p class="empty-state">Nenhuma cotação cadastrada para este retiro.</p></section>'}</div>`;
}

function quoteCard(quote, state, canEdit, canDelete) {
  const comparison = quoteComparison(quote);
  const supplierName = (supplierId) => state.suppliers.find((item) => item.id === supplierId)?.nome || 'Fornecedor não identificado';
  return `<article class="panel finance-quote-card"><div class="panel-heading"><div><h2>${escapeHtml(quote.titulo)}</h2><p>${(quote.itens || []).length} item(ns) · validade ${formatDate(quote.validade)}</p></div><em class="finance-status ${escapeHtml(quote.status)}">${statusLabel(quote.status)}</em></div><div class="finance-comparison"><div><span>Melhor fornecedor único</span><strong>${comparison.bestSingle ? `${escapeHtml(supplierName(comparison.bestSingle.supplierId))} · ${financeMoney(comparison.bestSingle.total)}` : 'Nenhum fornecedor cotou todos os itens'}</strong></div><div><span>Melhor combinação por item</span><strong>${comparison.bestCombinationTotal == null ? 'Cotação incompleta' : financeMoney(comparison.bestCombinationTotal)}</strong></div></div><div class="finance-best-items">${comparison.bestByItem.map((best) => { const item = (quote.itens || []).find((entry) => entry.id === best.itemId); const supplier = state.suppliers.find((entry) => entry.id === best.supplierId); return `<span><b>${escapeHtml(item?.descricao || 'Item')}:</b> ${best.supplierId ? `${escapeHtml(supplier?.nome || '')} (${financeMoney(best.total)})` : 'sem preço'}</span>`; }).join('')}</div><div class="finance-row-actions">${canEdit ? `<button type="button" data-edit-quote="${quote.id}">Editar</button>${comparison.bestCombinationTotal != null ? `<button type="button" data-convert-quote="${quote.id}" data-mode="combination">Comprar melhor combinação</button>` : ''}${comparison.bestSingle ? `<button type="button" data-convert-quote="${quote.id}" data-mode="single">Comprar em uma loja</button>` : ''}` : ''}${canDelete ? `<button type="button" class="is-danger" data-delete-quote="${quote.id}">Excluir</button>` : ''}</div></article>`;
}

function stockHtml(state, canEdit, canDelete) {
  const inventory = inventorySummary(state.products, state.movements);
  return `<section class="finance-section-heading"><div><h2>Estoque central</h2><p>Entradas, consumos, devoluções, perdas e ajustes com custo médio.</p></div></section>${canEdit ? `<form class="panel finance-form" id="finance-movement-form"><div class="panel-heading"><div><h2>Novo movimento</h2><p>Toda saída será vinculada ao retiro em foco e não poderá gerar saldo negativo.</p></div></div><div class="finance-form-grid"><label><span>Produto *</span><select name="produtoId" required>${optionList(state.products)}</select></label><label><span>Movimento *</span><select name="tipo"><option value="entrada">Entrada</option><option value="retirada">Retirada para consumo</option><option value="devolucao">Devolução</option><option value="perda">Perda</option><option value="ajuste_entrada">Ajuste de entrada</option><option value="ajuste_saida">Ajuste de saída</option></select></label><label><span>Quantidade *</span><input name="quantidade" inputmode="decimal" required></label><label><span>Custo unitário</span><input name="custoUnitario" inputmode="decimal" placeholder="Obrigatório para entradas"></label><label><span>Setor</span><select name="setor">${optionList(state.sectors.map((nome) => ({ id: nome, nome })))}</select></label><label><span>Data</span><input name="data" type="date" value="${today()}"></label></div><label class="finance-wide"><span>Observação</span><textarea name="observacao" rows="2"></textarea></label><p class="form-message" data-finance-message></p><div class="form-actions"><button type="submit">Registrar movimento <span>→</span></button></div></form>` : ''}<section class="finance-stock-grid">${inventory.map((item) => `<article class="panel finance-stock-card ${financeNumber(item.product.estoqueMinimo) > 0 && item.balance <= financeNumber(item.product.estoqueMinimo) ? 'is-warning' : ''}"><span>${escapeHtml(item.product.nome)}</span><strong>${item.balance.toLocaleString('pt-BR')} ${escapeHtml(item.product.unidade || 'un')}</strong><small>Custo médio ${financeMoney(item.averageCost)} · Valor ${financeMoney(item.value)}</small><small>Mínimo: ${financeNumber(item.product.estoqueMinimo).toLocaleString('pt-BR')}</small></article>`).join('') || '<section class="panel"><p class="empty-state">Cadastre produtos para iniciar o estoque.</p></section>'}</section><section class="panel finance-table-panel"><h2>Extrato do retiro</h2><div class="finance-ranked-list">${state.retreatMovements.length ? [...state.retreatMovements].reverse().map((movement) => `<div><span><b>${escapeHtml(state.products.find((item) => item.id === movement.produtoId)?.nome || 'Produto')}</b><small>${formatDate(movement.data)} · ${escapeHtml(movement.tipo)} · ${escapeHtml(movement.setor || 'Sem setor')}</small></span><strong>${['retirada', 'perda', 'ajuste_saida'].includes(movement.tipo) ? '−' : '+'}${financeNumber(movement.quantidade).toLocaleString('pt-BR')} · ${financeMoney(movement.custoTotal)}</strong>${canDelete && !movement.reversaoDe ? `<button type="button" class="is-danger" data-delete-movement="${movement.id}">Excluir</button>` : ''}</div>`).join('') : '<p class="empty-state">Nenhum movimento para este retiro.</p>'}</div></section>`;
}

function catalogsHtml(state, canEdit, canDelete) {
  return `<section class="finance-section-heading"><div><h2>Cadastros financeiros</h2><p>Listas independentes, utilizadas apenas neste módulo.</p></div></section><div class="finance-catalog-grid">${catalogPanel('category', 'Tipos de despesa', state.categories, canEdit, canDelete)}${catalogPanel('supplier', 'Fornecedores', state.suppliers, canEdit, canDelete)}${catalogPanel('product', 'Produtos', state.products, canEdit, canDelete)}</div>`;
}

function catalogPanel(type, title, records, canEdit, canDelete) {
  const categorySuggestions = type === 'category' ? '<datalist id="finance-category-suggestions"><option>Alimentação</option><option>Estrutura e hospedagem</option><option>Higiene e limpeza</option><option>Materiais</option><option>Transporte e logística</option><option>Saúde e segurança</option><option>Comunicação</option><option>Serviços</option><option>Taxas</option><option>Outros</option></datalist>' : '';
  const extras = type === 'supplier' ? '<label><span>Endereço</span><input name="endereco"></label><label><span>Cidade</span><input name="cidade"></label><label><span>Telefone</span><input name="telefone"></label><label><span>WhatsApp</span><input name="whatsapp"></label><label><span>Site</span><input name="site"></label><label><span>Observações</span><textarea name="observacao"></textarea></label>' : type === 'product' ? '<label><span>Unidade</span><input name="unidade" value="un"></label><label><span>Estoque mínimo</span><input name="estoqueMinimo" inputmode="decimal" value="0"></label>' : '';
  return `<section class="panel finance-catalog"><h2>${title}</h2>${categorySuggestions}${canEdit ? `<form data-catalog-form="${type}"><label><span>Nome *</span><input name="nome" ${type === 'category' ? 'list="finance-category-suggestions"' : ''} required></label>${extras}<button type="submit">Cadastrar</button><p class="form-message"></p></form>` : ''}<div class="finance-catalog-list">${records.length ? records.map((record) => `<div><span><strong>${escapeHtml(record.nome)}</strong>${type === 'supplier' ? `<small>${escapeHtml([record.cidade, record.telefone || record.whatsapp].filter(Boolean).join(' · ') || 'Sem contato')}</small>` : type === 'product' ? `<small>${escapeHtml(record.unidade || 'un')} · mínimo ${financeNumber(record.estoqueMinimo)}</small>` : ''}</span>${canDelete ? `<button type="button" class="is-danger" data-delete-catalog="${type}" data-id="${record.id}">Excluir</button>` : ''}</div>`).join('') : '<p class="empty-state">Nenhum cadastro.</p>'}</div></section>`;
}

function reportsHtml(state) {
  const cost = retreatCost(state.expenses, state.retreatMovements);
  return `<section class="finance-section-heading"><div><h2>Relatórios e fechamento</h2><p>Todos os arquivos respeitam o retiro em foco e identificam a data de geração.</p></div></section><section class="panel finance-report-summary"><h2>${escapeHtml(state.retreat.nome)}</h2><div class="finance-metrics"><article><span>Custo real</span><strong>${financeMoney(cost.total)}</strong></article><article><span>Uso único</span><strong>${financeMoney(cost.direct)}</strong></article><article><span>Estoque consumido</span><strong>${financeMoney(cost.consumed)}</strong></article></div><div class="finance-report-actions"><button type="button" data-finance-print>Imprimir/PDF</button><button type="button" data-finance-csv="expenses">Despesas CSV</button><button type="button" data-finance-csv="stock">Estoque CSV</button><button type="button" data-finance-csv="quotes">Cotações CSV</button></div></section>`;
}

function financeCsv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

function downloadCsv(filename, rows) {
  const blob = new Blob([`\ufeff${financeCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function collectRows(container, selector) {
  return [...container.querySelectorAll(selector)].map((row) => ({ id: row.dataset.id, ...Object.fromEntries([...row.querySelectorAll('[data-field]')].map((field) => [field.dataset.field, field.type === 'checkbox' ? field.checked : field.value])) }));
}

async function loadFinanceState(retreat, dataService) {
  const [categories, suppliers, products, allExpenses, allQuotes, movements, audit] = await Promise.all([dataService.listFinanceCategories(), dataService.listFinanceSuppliers(), dataService.listFinanceProducts(), dataService.listFinanceExpenses(), dataService.listFinanceQuotes(), dataService.listFinanceMovements(), dataService.listFinanceAudit()]);
  return { retreat, sectors: [...new Set(retreat.setores || [])], categories, suppliers, products, movements, audit, expenses: allExpenses.filter((item) => item.retiroId === retreat.id), quotes: allQuotes.filter((item) => item.retiroId === retreat.id), retreatMovements: movements.filter((item) => item.retiroId === retreat.id) };
}

export async function renderFinanceiro(context) {
  const { retreat, layout, dataService, canAccess, currentUser } = context;
  if (!retreat) {
    layout('<section class="page-heading"><div><p class="eyebrow">Compras, despesas e estoque</p><h1>Nenhum retiro em foco</h1><p>Selecione um retiro na tela Início para acessar o Financeiro.</p></div><a class="secondary-button" href="#inicio">Ir para Início</a></section>', 'financeiro');
    return;
  }
  const state = await loadFinanceState(retreat, dataService);
  const readOnly = retreat.status === 'concluido';
  const canEdit = !readOnly && canAccess('financeiro.editar');
  const canDelete = !readOnly && canAccess('financeiro.excluir');
  const tabs = [['visao-geral', 'Visão Geral'], ['despesas', 'Despesas'], ['cotacoes', 'Cotações'], ['estoque', 'Estoque'], ['cadastros', 'Cadastros'], ['relatorios', 'Relatórios']];
  const tabContent = { 'visao-geral': overviewHtml(state), despesas: expensesHtml(state, canEdit, canDelete), cotacoes: quotesHtml(state, canEdit, canDelete), estoque: stockHtml(state, canEdit, canDelete), cadastros: catalogsHtml(state, canEdit, canDelete), relatorios: reportsHtml(state) }[activeFinanceTab] || overviewHtml(state);
  layout(`<section class="page-heading finance-page-heading"><div><p class="eyebrow">Compras, despesas e estoque</p><h1>Financeiro</h1><p><strong>${escapeHtml(retreat.nome)}</strong> · custo real por consumo e despesas de uso único.</p>${readOnly ? '<p class="finance-readonly">Retiro concluído: módulo disponível somente para consulta.</p>' : ''}</div></section><nav class="finance-tabs" aria-label="Seções do Financeiro">${tabs.map(([tab, label]) => `<button type="button" data-finance-tab="${tab}" class="${activeFinanceTab === tab ? 'is-active' : ''}">${label}</button>`).join('')}</nav><div class="finance-content">${tabContent}</div>`, 'financeiro');
  const root = document.querySelector('.finance-content');
  document.querySelectorAll('[data-finance-tab]').forEach((button) => button.addEventListener('click', () => { activeFinanceTab = button.dataset.financeTab; editingExpenseId = ''; editingQuoteId = ''; renderFinanceiro(context); }));
  wireFinanceActions(root, state, context, { canEdit, canDelete, currentUser });
}

function reasonForDeletion(label) {
  if (!confirm(`Excluir ${label}? O registro será preservado na auditoria.`)) return '';
  return String(prompt('Informe o motivo da exclusão:') || '').trim();
}

async function wireFinanceActions(root, state, context, permissions) {
  if (!root) return;
  const rerender = () => renderFinanceiro(context);
  root.querySelectorAll('[data-remove-line]').forEach((button) => button.addEventListener('click', () => { const row = button.closest('[data-expense-item],[data-quote-item],[data-quote-offer]'); const container = row.parentElement; if (container.children.length > 1 || row.matches('[data-quote-offer]')) row.remove(); }));
  root.querySelector('[data-add-expense-item]')?.addEventListener('click', () => { const container = root.querySelector('[data-expense-items]'); container.insertAdjacentHTML('beforeend', expenseItemRow({}, { products: state.products, categories: state.categories, sectors: state.sectors })); wireLineRemovals(container); });
  root.querySelector('[data-cancel-expense]')?.addEventListener('click', () => { editingExpenseId = ''; rerender(); });
  root.querySelectorAll('[data-edit-expense]').forEach((button) => button.addEventListener('click', () => { editingExpenseId = button.dataset.editExpense; rerender(); }));
  root.querySelector('#finance-expense-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const message = form.querySelector('[data-finance-message]'); const data = new FormData(form); const existing = state.expenses.find((item) => item.id === data.get('id')) || {};
    try {
      const items = collectRows(form, '[data-expense-item]').map((item) => ({ ...item, quantidade: financeNumber(item.quantidade), valorUnitario: financeNumber(item.valorUnitario), total: financeNumber(item.quantidade) * financeNumber(item.valorUnitario) }));
      const expense = await context.dataService.saveFinanceExpense({ ...existing, id: data.get('id') || undefined, retiroId: state.retreat.id, descricao: data.get('descricao'), fornecedorId: data.get('fornecedorId'), documento: data.get('documento'), data: data.get('data'), vencimento: data.get('vencimento'), status: data.get('status'), formaPagamento: data.get('formaPagamento'), frete: financeNumber(data.get('frete')), desconto: financeNumber(data.get('desconto')), observacao: data.get('observacao'), itens });
      if (data.get('confirmarEstoque')) {
        for (const item of items.filter((entry) => entry.controlaEstoque && entry.produtoId)) {
          if (state.movements.some((movement) => movement.chaveOrigem === `despesa:${expense.id}:${item.id}`)) continue;
          await context.dataService.saveFinanceMovement({ retiroId: state.retreat.id, produtoId: item.produtoId, tipo: 'entrada', quantidade: item.quantidade, custoUnitario: item.valorUnitario, data: expense.data, setor: item.setor, despesaId: expense.id, chaveOrigem: `despesa:${expense.id}:${item.id}`, observacao: `Entrada da despesa ${expense.descricao}` });
        }
      }
      editingExpenseId = ''; rerender();
    } catch (error) { message.textContent = error.message; }
  });
  root.querySelectorAll('[data-delete-expense]').forEach((button) => button.addEventListener('click', async () => { const reason = reasonForDeletion('esta despesa'); if (!reason) return; try { await context.dataService.deleteFinanceExpense(button.dataset.deleteExpense, reason); rerender(); } catch (error) { alert(error.message); } }));

  root.querySelector('[data-add-quote-item]')?.addEventListener('click', () => { const container = root.querySelector('[data-quote-items]'); container.insertAdjacentHTML('beforeend', quoteItemRow()); wireLineRemovals(container); refreshOfferItemOptions(root); });
  root.querySelector('[data-add-quote-offer]')?.addEventListener('click', () => { const items = collectRows(root, '[data-quote-item]'); const container = root.querySelector('[data-quote-offers]'); container.insertAdjacentHTML('beforeend', quoteOfferRow({}, items, state.suppliers)); wireLineRemovals(container); });
  root.querySelector('[data-cancel-quote]')?.addEventListener('click', () => { editingQuoteId = ''; rerender(); });
  root.querySelectorAll('[data-edit-quote]').forEach((button) => button.addEventListener('click', () => { editingQuoteId = button.dataset.editQuote; rerender(); }));
  root.querySelector('#finance-quote-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const message = form.querySelector('[data-finance-message]'); try { const items = collectRows(form, '[data-quote-item]').map((item) => ({ ...item, quantidade: financeNumber(item.quantidade) })); const offers = collectRows(form, '[data-quote-offer]').map((offer) => ({ ...offer, valorUnitario: financeNumber(offer.valorUnitario), frete: financeNumber(offer.frete), desconto: financeNumber(offer.desconto) })); await context.dataService.saveFinanceQuote({ ...(state.quotes.find((item) => item.id === data.get('id')) || {}), id: data.get('id') || undefined, retiroId: state.retreat.id, titulo: data.get('titulo'), validade: data.get('validade'), condicoes: data.get('condicoes'), status: data.get('status'), observacao: data.get('observacao'), itens, ofertas: offers }); editingQuoteId = ''; rerender(); } catch (error) { message.textContent = error.message; } });
  root.querySelectorAll('[data-delete-quote]').forEach((button) => button.addEventListener('click', async () => { const reason = reasonForDeletion('esta cotação'); if (!reason) return; try { await context.dataService.deleteFinanceQuote(button.dataset.deleteQuote, reason); rerender(); } catch (error) { alert(error.message); } }));
  root.querySelectorAll('[data-convert-quote]').forEach((button) => button.addEventListener('click', async () => { try { await convertQuote(state.quotes.find((quote) => quote.id === button.dataset.convertQuote), button.dataset.mode, state, context); rerender(); } catch (error) { alert(error.message); } }));

  root.querySelector('#finance-movement-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const message = form.querySelector('[data-finance-message]'); try { await context.dataService.saveFinanceMovement({ retiroId: state.retreat.id, produtoId: data.get('produtoId'), tipo: data.get('tipo'), quantidade: financeNumber(data.get('quantidade')), custoUnitario: financeNumber(data.get('custoUnitario')), setor: data.get('setor'), data: data.get('data'), observacao: data.get('observacao') }); rerender(); } catch (error) { message.textContent = error.message; } });
  root.querySelectorAll('[data-delete-movement]').forEach((button) => button.addEventListener('click', async () => { const reason = reasonForDeletion('este movimento'); if (!reason) return; try { await context.dataService.deleteFinanceMovement(button.dataset.deleteMovement, reason); rerender(); } catch (error) { alert(error.message); } }));

  root.querySelectorAll('[data-catalog-form]').forEach((form) => form.addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const type = form.dataset.catalogForm; try { if (type === 'category') await context.dataService.saveFinanceCategory(data); if (type === 'supplier') await context.dataService.saveFinanceSupplier(data); if (type === 'product') await context.dataService.saveFinanceProduct({ ...data, estoqueMinimo: financeNumber(data.estoqueMinimo) }); rerender(); } catch (error) { form.querySelector('.form-message').textContent = error.message; } }));
  root.querySelectorAll('[data-delete-catalog]').forEach((button) => button.addEventListener('click', async () => { const reason = reasonForDeletion('este cadastro'); if (!reason) return; const methods = { category: 'deleteFinanceCategory', supplier: 'deleteFinanceSupplier', product: 'deleteFinanceProduct' }; try { await context.dataService[methods[button.dataset.deleteCatalog]](button.dataset.id, reason); rerender(); } catch (error) { alert(error.message); } }));

  root.querySelector('[data-finance-print]')?.addEventListener('click', () => printReport(state, permissions.currentUser));
  root.querySelectorAll('[data-finance-csv]').forEach((button) => button.addEventListener('click', () => exportReportCsv(button.dataset.financeCsv, state)));
}

function wireLineRemovals(container) { container.querySelectorAll('[data-remove-line]').forEach((button) => { if (button.dataset.wired) return; button.dataset.wired = 'true'; button.addEventListener('click', () => button.closest('[data-expense-item],[data-quote-item],[data-quote-offer]')?.remove()); }); }
function refreshOfferItemOptions(root) { const items = collectRows(root, '[data-quote-item]'); root.querySelectorAll('[data-quote-offer] select[data-field="itemId"]').forEach((select) => { const value = select.value; select.innerHTML = optionList(items.map((item) => ({ id: item.id, nome: item.descricao || 'Item sem nome' })), value); }); }

async function convertQuote(quote, mode, state, context) {
  const result = quoteComparison(quote); const selections = mode === 'single' ? (quote.itens || []).map((item) => ({ itemId: item.id, supplierId: result.bestSingle?.supplierId, unitPrice: result.bestSingle?.prices.get(item.id) })) : result.bestByItem;
  if (selections.some((item) => !item.supplierId)) throw new Error('A cotação ainda possui itens sem preço.');
  const groups = new Map(); selections.forEach((selection) => { const list = groups.get(selection.supplierId) || []; const quoteItem = quote.itens.find((item) => item.id === selection.itemId); list.push({ id: id(), descricao: quoteItem.descricao, quantidade: quoteItem.quantidade, unidade: quoteItem.unidade, valorUnitario: selection.unitPrice, controlaEstoque: false, categoriaId: '', setor: '' }); groups.set(selection.supplierId, list); });
  for (const [supplierId, items] of groups) await context.dataService.saveFinanceExpense({ retiroId: state.retreat.id, descricao: `Compra da cotação: ${quote.titulo}`, fornecedorId: supplierId, documento: '', data: today(), vencimento: '', status: 'pendente', formaPagamento: '', frete: 0, desconto: 0, observacao: `Gerada automaticamente pela cotação ${quote.titulo}.`, cotacaoId: quote.id, itens });
  await context.dataService.saveFinanceQuote({ ...quote, status: 'concluida', escolha: mode, escolhidoEm: new Date().toISOString() });
}

function exportReportCsv(type, state) {
  const base = `financeiro-${type}-${state.retreat.nome.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}.csv`;
  if (type === 'expenses') downloadCsv(base, [['Data', 'Despesa', 'Fornecedor', 'Documento', 'Situação', 'Total'], ...state.expenses.map((expense) => [expense.data, expense.descricao, state.suppliers.find((item) => item.id === expense.fornecedorId)?.nome || '', expense.documento, statusLabel(expense.status), expenseTotal(expense)])]);
  if (type === 'stock') downloadCsv(base, [['Produto', 'Saldo', 'Unidade', 'Custo médio', 'Valor'], ...inventorySummary(state.products, state.movements).map((item) => [item.product.nome, item.balance, item.product.unidade, item.averageCost, item.value])]);
  if (type === 'quotes') downloadCsv(base, [['Cotação', 'Situação', 'Melhor fornecedor único', 'Total único', 'Melhor combinação'], ...state.quotes.map((quote) => { const result = quoteComparison(quote); return [quote.titulo, statusLabel(quote.status), state.suppliers.find((item) => item.id === result.bestSingle?.supplierId)?.nome || '', result.bestSingle?.total ?? '', result.bestCombinationTotal ?? '']; })]);
}

function printReport(state, currentUser) {
  const cost = retreatCost(state.expenses, state.retreatMovements); const win = window.open('', '_blank'); if (!win) return alert('Permita pop-ups para gerar o relatório.');
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Financeiro - ${escapeHtml(state.retreat.nome)}</title><style>body{font:13px Arial;color:#24372a;margin:28px}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.metrics{display:flex;gap:28px;margin:20px 0}.metrics strong{display:block;font-size:20px}</style></head><body><h1>Fechamento financeiro</h1><p>${escapeHtml(state.retreat.nome)} · gerado em ${new Date().toLocaleString('pt-BR')} por ${escapeHtml(currentUser?.username || 'usuário')}</p><div class="metrics"><div>Custo real<strong>${financeMoney(cost.total)}</strong></div><div>Uso único<strong>${financeMoney(cost.direct)}</strong></div><div>Estoque consumido<strong>${financeMoney(cost.consumed)}</strong></div></div><table><thead><tr><th>Data</th><th>Despesa</th><th>Situação</th><th>Total</th></tr></thead><tbody>${state.expenses.map((expense) => `<tr><td>${formatDate(expense.data)}</td><td>${escapeHtml(expense.descricao)}</td><td>${statusLabel(expense.status)}</td><td>${financeMoney(expenseTotal(expense))}</td></tr>`).join('')}</tbody></table></body></html>`); win.document.close(); setTimeout(() => { win.focus(); win.print(); }, 200);
}
