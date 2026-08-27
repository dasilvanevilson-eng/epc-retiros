export const financeNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

export const nonNegativeFinanceNumber = (value) => Math.max(0, financeNumber(value));
export const financeMoney = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financeNumber(value));
export const financeQuantity = (value) => nonNegativeFinanceNumber(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
export const normalizeSectorKey = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

const retreatOrderValue = (retreat = {}) => {
  const start = String(retreat.dataInicio || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return `${start}T12:00:00.000Z`;
  const created = String(retreat.createdAt || '');
  return Number.isNaN(Date.parse(created)) ? '' : new Date(created).toISOString();
};

export function findPreviousRetreat(retreat = {}, retreats = []) {
  const currentOrder = retreatOrderValue(retreat);
  if (!currentOrder) return null;
  return retreats
    .filter((candidate) => candidate?.id && candidate.id !== retreat.id && retreatOrderValue(candidate) < currentOrder)
    .sort((first, second) => retreatOrderValue(second).localeCompare(retreatOrderValue(first)) || String(second.createdAt || '').localeCompare(String(first.createdAt || '')))[0] || null;
}

export function calculateRecurringItem(item = {}) {
  const position = nonNegativeFinanceNumber(item.posicaoAnterior);
  let input = nonNegativeFinanceNumber(item.entrada);
  let output = financeNumber(item.saida);
  let balance;
  const mode = item.modo === 'saldo' ? 'saldo' : 'movimento';
  if (mode === 'saldo') {
    balance = nonNegativeFinanceNumber(item.saldo);
    const delta = balance - position;
    input = delta > 0 ? delta : 0;
    output = delta < 0 ? Math.abs(delta) : 0;
  } else {
    balance = nonNegativeFinanceNumber(item.saldo);
  }
  const unitPrice = nonNegativeFinanceNumber(item.precoUnitario);
  return {
    ...item,
    modo: mode,
    posicaoAnterior: position,
    entrada: input,
    saida: output,
    saldo: balance,
    precoUnitario: unitPrice,
    valorPosicaoAnterior: position * unitPrice,
    valorEntrada: input * unitPrice,
    valorSaida: output * unitPrice,
    valorSaldo: balance * unitPrice,
  };
}

export function inheritSectorSheet({ retreat, sector, previousRetreat, previousSheet, id = '' } = {}) {
  const key = normalizeSectorKey(sector);
  return {
    id,
    retiroId: retreat?.id || '',
    setor: String(sector || '').trim(),
    setorChave: key,
    retiroOrigemId: previousSheet ? previousRetreat?.id || previousSheet.retiroId || '' : '',
    inicializada: true,
    itensRecorrentes: (previousSheet?.itensRecorrentes || []).map((item, index) => calculateRecurringItem({
      id: '',
      chaveRecorrencia: item.chaveRecorrencia || item.itemOrigemId || item.id || '',
      itemOrigemId: item.id || '',
      descricao: item.descricao || '',
      unidade: item.unidade || 'un',
      fornecedor: item.fornecedor || '',
      modo: 'movimento',
      posicaoAnterior: item.saldo,
      entrada: 0,
      saida: 0,
      saldo: item.saldo,
      precoUnitario: item.precoUnitario,
      ordem: index + 1,
    })),
    despesasEventuais: [],
  };
}

export function cloneRecurringStructureSheet({ retreat, sector, sourceRetreat, sourceSheet, id = '' } = {}) {
  const key = normalizeSectorKey(sector);
  return {
    id,
    retiroId: retreat?.id || '',
    setor: String(sector || '').trim(),
    setorChave: key,
    retiroOrigemId: sourceSheet ? sourceRetreat?.id || sourceSheet.retiroId || '' : '',
    inicializada: true,
    itensRecorrentes: (sourceSheet?.itensRecorrentes || []).map((item, index) => ({
      id: '',
      chaveRecorrencia: item.chaveRecorrencia || item.itemOrigemId || item.id || '',
      itemOrigemId: item.id || '',
      descricao: item.descricao || '',
      unidade: item.unidade || 'un',
      fornecedor: item.fornecedor || '',
      modo: 'movimento',
      posicaoAnterior: 0,
      entrada: 0,
      saida: 0,
      saldo: 0,
      precoUnitario: 0,
      ordem: index + 1,
    })),
    despesasEventuais: [],
  };
}

export function sectorSheetTotals(sheet = {}) {
  const recurring = (sheet.itensRecorrentes || []).map(calculateRecurringItem);
  const eventual = (sheet.despesasEventuais || []).reduce((total, item) => total + nonNegativeFinanceNumber(item.valor), 0);
  const sum = (field) => recurring.reduce((total, item) => total + item[field], 0);
  const previous = sum('valorPosicaoAnterior');
  const input = sum('valorEntrada');
  const output = sum('valorSaida');
  const balance = sum('valorSaldo');
  return {
    previous,
    input,
    output,
    balance,
    eventual,
    acquired: input + eventual,
    consumed: output + eventual,
  };
}

export function retreatBalance(sheets = []) {
  return sheets.reduce((totals, sheet) => {
    const current = sectorSheetTotals(sheet);
    Object.keys(totals).forEach((key) => { totals[key] += current[key]; });
    return totals;
  }, { previous: 0, input: 0, output: 0, balance: 0, eventual: 0, acquired: 0, consumed: 0 });
}

export function dailyParticipationTotal({ retreat = {}, enrolments = [], studentCount = 0, kidCount = 0 } = {}) {
  const normalize = normalizeSectorKey;
  const days = Array.isArray(retreat.dias) ? retreat.dias.map((day) => String(day || '').trim()).filter(Boolean) : [];
  return days.reduce((total, day) => total + enrolments.filter((entry) => {
    const entryDays = Array.isArray(entry.dias) ? entry.dias : [entry.dias];
    return entryDays.some((entryDay) => normalize(entryDay) === normalize(day));
  }).length + nonNegativeFinanceNumber(studentCount) + nonNegativeFinanceNumber(kidCount), 0);
}

export function purchaseSuggestionRows({ currentSheets = [], baseSheets = [], baseParticipations = 0, focusParticipations = 0 } = {}) {
  const baseTotal = nonNegativeFinanceNumber(baseParticipations);
  if (baseTotal <= 0) throw new Error('O retiro-base não possui participações diárias para calcular a sugestão.');
  const focusTotal = nonNegativeFinanceNumber(focusParticipations);
  const baseItems = baseSheets.flatMap((sheet) => (sheet.itensRecorrentes || []).map((item) => ({ ...calculateRecurringItem(item), setorChave: sheet.setorChave })));
  return currentSheets.flatMap((sheet) => (sheet.itensRecorrentes || []).map((raw) => {
    const item = calculateRecurringItem(raw);
    const identity = item.chaveRecorrencia || item.itemOrigemId || item.id || '';
    const baseItem = baseItems.find((candidate) => identity && [candidate.chaveRecorrencia, candidate.itemOrigemId, candidate.id].includes(identity))
      || baseItems.find((candidate) => item.itemOrigemId && candidate.id === item.itemOrigemId)
      || baseItems.find((candidate) => candidate.setorChave === sheet.setorChave && normalizeSectorKey(candidate.descricao) === normalizeSectorKey(item.descricao));
    const baseConsumption = nonNegativeFinanceNumber(baseItem?.saida);
    const consumptionPerParticipation = baseConsumption / baseTotal;
    const projectedNeed = consumptionPerParticipation * focusTotal;
    const previousBalance = nonNegativeFinanceNumber(item.posicaoAnterior);
    return {
      setor: sheet.setor,
      setorChave: sheet.setorChave,
      descricao: item.descricao,
      unidade: item.unidade || 'un',
      consumoBase: baseConsumption,
      participacoesBase: baseTotal,
      consumoPorParticipacao: consumptionPerParticipation,
      participacoesFoco: focusTotal,
      necessidadeProjetada: projectedNeed,
      saldoAnterior: previousBalance,
      sugestaoCompra: Math.max(0, projectedNeed - previousBalance),
    };
  }));
}
