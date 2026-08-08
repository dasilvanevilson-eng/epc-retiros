export const financeNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

export const financeMoney = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financeNumber(value));

export function expenseTotal(expense = {}) {
  const items = Array.isArray(expense.itens) ? expense.itens : [];
  return Math.max(0, items.reduce((sum, item) => sum + financeNumber(item.quantidade) * financeNumber(item.valorUnitario), 0)
    + financeNumber(expense.frete) - financeNumber(expense.desconto));
}

const movementSign = (type) => ['retirada', 'perda', 'ajuste_saida'].includes(type) ? -1 : 1;

export function inventorySummary(products = [], movements = []) {
  const summaries = new Map(products.map((product) => [product.id, { product, balance: 0, value: 0, averageCost: 0 }]));
  [...movements].sort((a, b) => String(a.createdAt || a.data || '').localeCompare(String(b.createdAt || b.data || ''))).forEach((movement) => {
    if (!summaries.has(movement.produtoId)) summaries.set(movement.produtoId, { product: { id: movement.produtoId, nome: 'Produto removido' }, balance: 0, value: 0, averageCost: 0 });
    const summary = summaries.get(movement.produtoId);
    const quantity = Math.max(0, financeNumber(movement.quantidade));
    const cost = Math.max(0, financeNumber(movement.custoUnitario));
    if (movementSign(movement.tipo) > 0) {
      summary.balance += quantity;
      summary.value += quantity * cost;
    } else {
      summary.balance -= quantity;
      summary.value -= quantity * cost;
    }
    if (summary.balance <= 0.000001) { summary.balance = 0; summary.value = 0; }
    summary.averageCost = summary.balance > 0 ? summary.value / summary.balance : 0;
  });
  return [...summaries.values()];
}

export function quoteComparison(quote = {}) {
  const items = Array.isArray(quote.itens) ? quote.itens : [];
  const offers = Array.isArray(quote.ofertas) ? quote.ofertas : [];
  const suppliers = new Map();
  offers.filter((offer) => offer.disponivel !== false).forEach((offer) => {
    const supplier = suppliers.get(offer.fornecedorId) || { supplierId: offer.fornecedorId, freight: financeNumber(offer.frete), discount: financeNumber(offer.desconto), prices: new Map() };
    supplier.freight = Math.max(supplier.freight, financeNumber(offer.frete));
    supplier.discount = Math.max(supplier.discount, financeNumber(offer.desconto));
    supplier.prices.set(offer.itemId, financeNumber(offer.valorUnitario));
    suppliers.set(offer.fornecedorId, supplier);
  });
  const candidates = [...suppliers.values()].map((supplier) => {
    const priced = items.filter((item) => supplier.prices.has(item.id));
    const subtotal = priced.reduce((sum, item) => sum + financeNumber(item.quantidade) * supplier.prices.get(item.id), 0);
    const adjustment = subtotal ? (supplier.freight - supplier.discount) / subtotal : 0;
    const itemCosts = new Map(priced.map((item) => {
      const base = financeNumber(item.quantidade) * supplier.prices.get(item.id);
      return [item.id, Math.max(0, base + base * adjustment)];
    }));
    return { ...supplier, complete: priced.length === items.length, subtotal, total: Math.max(0, subtotal + supplier.freight - supplier.discount), itemCosts };
  });
  const complete = candidates.filter((candidate) => candidate.complete).sort((a, b) => a.total - b.total);
  const bestSingle = complete[0] || null;
  const bestByItem = items.map((item) => {
    const options = candidates.filter((candidate) => candidate.itemCosts.has(item.id)).sort((a, b) => candidateCost(a, item.id) - candidateCost(b, item.id));
    const best = options[0];
    return best ? { itemId: item.id, supplierId: best.supplierId, total: best.itemCosts.get(item.id), unitPrice: best.prices.get(item.id) } : { itemId: item.id, supplierId: '', total: Infinity, unitPrice: 0 };
  });
  return {
    candidates,
    bestSingle,
    bestByItem,
    bestCombinationTotal: bestByItem.every((item) => Number.isFinite(item.total)) ? bestByItem.reduce((sum, item) => sum + item.total, 0) : null,
  };
}

const candidateCost = (candidate, itemId) => candidate.itemCosts.get(itemId) ?? Infinity;

export function retreatCost(expenses = [], movements = []) {
  const activeExpenses = expenses.filter((expense) => expense.status !== 'cancelada');
  const direct = activeExpenses.reduce((sum, expense) => {
    const items = expense.itens || [];
    const subtotal = items.reduce((total, item) => total + financeNumber(item.quantidade) * financeNumber(item.valorUnitario), 0);
    const directSubtotal = items.filter((item) => !item.controlaEstoque).reduce((total, item) => total + financeNumber(item.quantidade) * financeNumber(item.valorUnitario), 0);
    const adjustment = subtotal > 0 ? directSubtotal / subtotal * (financeNumber(expense.frete) - financeNumber(expense.desconto)) : 0;
    return sum + Math.max(0, directSubtotal + adjustment);
  }, 0);
  const consumed = movements.reduce((sum, movement) => {
    const value = financeNumber(movement.custoTotal) || financeNumber(movement.quantidade) * financeNumber(movement.custoUnitario);
    if (['retirada', 'perda'].includes(movement.tipo)) return sum + value;
    if (movement.tipo === 'devolucao') return sum - value;
    return sum;
  }, 0);
  return { direct, consumed: Math.max(0, consumed), total: Math.max(0, direct + consumed) };
}
