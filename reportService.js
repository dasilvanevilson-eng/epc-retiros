const { listCursistasEpc, listCursistasSmp, listRecords } = require('./databaseAdapter');

const allowedStatuses = new Set(['preparacao', 'publicado', 'concluido']);
const statusLabels = { preparacao: 'Em preparação', publicado: 'Publicado', concluido: 'Encerrado' };
const normalizeCpf = (value = '') => String(value || '').replace(/\D/g, '');
const text = (value = '') => String(value ?? '').trim();
const money = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.') : raw.replace(/[^\d.-]/g, '');
  return Number(normalized) || 0;
};
const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
const validCpfKey = (value) => normalizeCpf(value).length === 11 ? `cpf:${normalizeCpf(value)}` : '';
const dateValue = (value) => value ? String(value).slice(0, 10) : '';

const commonFields = [
  ['retiro', 'Retiro', 'text'], ['retiroStatus', 'Situação do retiro', 'enum'], ['retiroInicio', 'Início do retiro', 'date'],
  ['retiroTermino', 'Término do retiro', 'date'], ['local', 'Local', 'text'], ['nome', 'Nome', 'text'],
  ['cpf', 'CPF', 'text'], ['nascimento', 'Nascimento', 'date'], ['telefone', 'Telefone', 'text'], ['cidade', 'Cidade', 'text'],
  ['estado', 'Estado', 'text'], ['tipoParticipacao', 'Tipo de participação', 'enum'], ['tipoFicha', 'Tipo de ficha', 'enum'],
  ['numeroFicha', 'Número da ficha', 'text'], ['setor', 'Setor', 'text'], ['comunidade', 'Comunidade', 'text'],
  ['problemaSaude', 'Problema de saúde', 'text'], ['intolerancia', 'Intolerância alimentar', 'text'],
  ['valorInscricao', 'Valor da inscrição', 'money'], ['valorPago', 'Valor pago', 'money'], ['saldoPagar', 'Saldo a pagar', 'money'],
  ['formaPagamento', 'Forma de pagamento', 'text'], ['statusCadastro', 'Situação do cadastro', 'enum'],
];

const fieldCatalog = Object.fromEntries(commonFields.map(([id, label, type]) => [id, { id, label, type }]));
const metrics = {
  registros: { id: 'registros', label: 'Registros', format: 'number' },
  pessoas: { id: 'pessoas', label: 'Pessoas distintas', format: 'number' },
  fichas: { id: 'fichas', label: 'Fichas distintas', format: 'number' },
  retiros: { id: 'retiros', label: 'Retiros distintos', format: 'number' },
  comunidades: { id: 'comunidades', label: 'Comunidades', format: 'number' },
  valorInscricao: { id: 'valorInscricao', label: 'Total de inscrições', format: 'money' },
  valorPago: { id: 'valorPago', label: 'Total pago', format: 'money' },
  saldoPagar: { id: 'saldoPagar', label: 'Saldo total', format: 'money' },
};

const datasets = {
  equipe: {
    id: 'equipe', label: 'Equipe de trabalho', description: 'Participações, setores e presença da equipe.',
    fields: ['retiro', 'retiroStatus', 'retiroInicio', 'retiroTermino', 'local', 'nome', 'cpf', 'nascimento', 'telefone', 'cidade', 'estado', 'setor', 'statusCadastro'],
    metrics: ['registros', 'pessoas', 'retiros'], defaults: ['nome', 'retiro', 'setor', 'statusCadastro'],
  },
  participacoes: {
    id: 'participacoes', label: 'Participações de pessoas', description: 'Histórico conjunto de equipe e cursistas.',
    fields: ['nome', 'cpf', 'tipoParticipacao', 'tipoFicha', 'retiro', 'retiroStatus', 'retiroInicio', 'setor', 'comunidade', 'cidade'],
    metrics: ['registros', 'pessoas', 'fichas', 'retiros'], defaults: ['nome', 'tipoParticipacao', 'retiro', 'retiroStatus'],
  },
  cursistas: {
    id: 'cursistas', label: 'Cursistas', description: 'Cursistas individuais, SMP e EPC sem misturar as tabelas de origem.',
    fields: ['nome', 'cpf', 'nascimento', 'telefone', 'cidade', 'estado', 'tipoFicha', 'numeroFicha', 'retiro', 'retiroStatus', 'retiroInicio', 'comunidade', 'problemaSaude', 'intolerancia'],
    metrics: ['registros', 'pessoas', 'fichas', 'retiros'], defaults: ['nome', 'tipoFicha', 'numeroFicha', 'retiro', 'comunidade'],
  },
  financeiro: {
    id: 'financeiro', label: 'Financeiro', description: 'Inscrições, pagamentos e saldos por ficha.',
    fields: ['nome', 'tipoParticipacao', 'tipoFicha', 'numeroFicha', 'retiro', 'retiroStatus', 'retiroInicio', 'valorInscricao', 'valorPago', 'saldoPagar', 'formaPagamento'],
    metrics: ['fichas', 'retiros', 'valorInscricao', 'valorPago', 'saldoPagar'], defaults: ['nome', 'tipoFicha', 'retiro', 'valorInscricao', 'valorPago', 'saldoPagar'],
  },
  comunidades: {
    id: 'comunidades', label: 'Comunidades', description: 'Distribuição dos cursistas nas comunidades.',
    fields: ['comunidade', 'nome', 'tipoFicha', 'numeroFicha', 'retiro', 'retiroStatus', 'retiroInicio'],
    metrics: ['registros', 'pessoas', 'fichas', 'comunidades', 'retiros'], defaults: ['comunidade', 'nome', 'tipoFicha', 'numeroFicha', 'retiro'],
  },
  retiros: {
    id: 'retiros', label: 'Retiros', description: 'Visão comparativa dos retiros e suas situações.',
    fields: ['retiro', 'retiroStatus', 'retiroInicio', 'retiroTermino', 'local'],
    metrics: ['retiros'], defaults: ['retiro', 'retiroStatus', 'retiroInicio', 'retiroTermino', 'local'],
  },
};

const catalog = () => ({
  statuses: Object.entries(statusLabels).map(([id, label]) => ({ id, label })),
  datasets: Object.values(datasets).map((dataset) => ({
    ...dataset,
    fields: dataset.fields.map((id) => fieldCatalog[id]),
    metrics: dataset.metrics.map((id) => metrics[id]),
  })),
  operators: [
    { id: 'contains', label: 'contém' }, { id: 'equals', label: 'é igual a' }, { id: 'notEquals', label: 'é diferente de' },
    { id: 'gte', label: 'maior ou igual a' }, { id: 'lte', label: 'menor ou igual a' }, { id: 'empty', label: 'não informado' }, { id: 'notEmpty', label: 'informado' },
  ],
});

function validateSpec(incoming = {}) {
  const dataset = datasets[incoming.dataset] || datasets.equipe;
  const allowedFields = new Set(dataset.fields);
  const statuses = unique(array(incoming.statuses).filter((status) => allowedStatuses.has(status)));
  const columns = unique(array(incoming.columns).filter((field) => allowedFields.has(field))).slice(0, 20);
  const groupBy = unique(array(incoming.groupBy).filter((field) => allowedFields.has(field))).slice(0, 3);
  const selectedMetrics = unique(array(incoming.metrics).filter((id) => dataset.metrics.includes(id))).slice(0, 8);
  const filters = array(incoming.filters).slice(0, 12).map((filter) => ({
    field: allowedFields.has(filter?.field) ? filter.field : '',
    operator: ['contains', 'equals', 'notEquals', 'gte', 'lte', 'empty', 'notEmpty'].includes(filter?.operator) ? filter.operator : 'contains',
    value: text(filter?.value),
  })).filter((filter) => filter.field);
  const sort = array(incoming.sort).slice(0, 3).map((item) => ({
    field: [...allowedFields, ...dataset.metrics].includes(item?.field) ? item.field : '',
    direction: item?.direction === 'desc' ? 'desc' : 'asc',
  })).filter((item) => item.field);
  return {
    dataset: dataset.id,
    statuses: statuses.length ? statuses : ['concluido'],
    retreatIds: unique(array(incoming.retreatIds).map(text)),
    locations: unique(array(incoming.locations).map(text)).slice(0, 100),
    periodStart: dateValue(incoming.periodStart), periodEnd: dateValue(incoming.periodEnd),
    columns: columns.length ? columns : [...dataset.defaults], groupBy,
    metrics: selectedMetrics.length ? selectedMetrics : [dataset.metrics[0]], filters, sort,
    chart: ['bar', 'line', 'donut', 'none'].includes(incoming.chart) ? incoming.chart : 'bar',
    page: Math.max(1, Number(incoming.page) || 1), pageSize: Math.min(100, Math.max(10, Number(incoming.pageSize) || 25)),
  };
}

const baseRetreatFields = (retreat = {}) => ({
  retiroId: retreat.id, retiro: retreat.nome || 'Retiro sem nome', retiroStatus: statusLabels[retreat.status] || retreat.status || '',
  retiroStatusId: retreat.status || '', retiroInicio: dateValue(retreat.dataInicio), retiroTermino: dateValue(retreat.dataTermino), local: retreat.local || '',
});

const communityFor = (communities, field, id) => communities.find((community) => array(community[field]).map(String).includes(String(id)))?.nome || 'Sem comunidade';

async function sourceRows(spec, allowedRetreatIds = null) {
  const [allRetreats, enrolments, people, individualStudents, communities] = await Promise.all([
    listRecords('retiros'), listRecords('adesoes'), listRecords('pessoas'), listRecords('cursistas'), listRecords('comunidades'),
  ]);
  const allowed = allowedRetreatIds ? new Set(allowedRetreatIds) : null;
  const requested = new Set(spec.retreatIds);
  const requestedLocations = new Set(spec.locations.map((location) => location.toLocaleLowerCase('pt-BR')));
  const selectedRetreats = allRetreats.filter((retreat) => (!allowed || allowed.has(retreat.id))
    && spec.statuses.includes(retreat.status)
    && (!requested.size || requested.has(retreat.id))
    && (!requestedLocations.size || requestedLocations.has(text(retreat.local).toLocaleLowerCase('pt-BR')))
    && (!spec.periodStart || dateValue(retreat.dataTermino || retreat.dataInicio) >= spec.periodStart)
    && (!spec.periodEnd || dateValue(retreat.dataInicio) <= spec.periodEnd));
  const retreatById = new Map(selectedRetreats.map((retreat) => [retreat.id, retreat]));
  const personById = new Map(people.map((person) => [person.id, person]));
  const communityByRetreat = new Map(selectedRetreats.map((retreat) => [retreat.id, communities.filter((community) => community.retiroId === retreat.id)]));
  const smpByRetreat = new Map();
  const epcByRetreat = new Map();
  await Promise.all(selectedRetreats.map(async (retreat) => {
    const [smp, epc] = await Promise.all([listCursistasSmp(retreat.id), listCursistasEpc(retreat.id)]);
    smpByRetreat.set(retreat.id, smp);
    epcByRetreat.set(retreat.id, epc);
  }));

  const teamRows = enrolments.filter((entry) => retreatById.has(entry.retiroId)).flatMap((entry) => {
    const retreat = retreatById.get(entry.retiroId); const person = personById.get(entry.pessoaId) || {};
    const sectors = array(entry.setores).length ? entry.setores : ['Sem setor'];
    return sectors.map((setor) => ({
      ...baseRetreatFields(retreat), recordKey: `equipe:${entry.id}:${setor}`, formKey: `equipe:${entry.id}`,
      personKey: validCpfKey(person.cpf || entry.cpf) || `pessoa:${entry.pessoaId || entry.id}`,
      nome: entry.nome || person.nome || '', cpf: person.cpf || entry.cpf || '', nascimento: person.nascimento || entry.nascimento || '',
      telefone: person.telefone || entry.telefone || '', cidade: person.cidade || entry.cidade || '', estado: person.estado || entry.estado || '',
      tipoParticipacao: 'Equipe de trabalho', tipoFicha: entry.tipoFicha || 'Equipe', setor, statusCadastro: entry.status || '',
      valorInscricao: money(entry.contribuicao) || money(retreat.valorInscricaoVoluntario), valorPago: money(entry.valorPago),
      saldoPagar: Math.max(0, (money(entry.contribuicao) || money(retreat.valorInscricaoVoluntario)) - money(entry.valorPago)), formaPagamento: entry.formaPagamento || '',
    }));
  });

  const studentRows = individualStudents.filter((student) => retreatById.has(student.retiroId)).map((student) => {
    const retreat = retreatById.get(student.retiroId); const retreatCommunities = communityByRetreat.get(student.retiroId) || [];
    return {
      ...baseRetreatFields(retreat), recordKey: `individual:${student.id}`, formKey: `individual:${student.id}`,
      personKey: validCpfKey(student.cpf) || `individual:${student.id}`, nome: student.nome || '', cpf: student.cpf || '', nascimento: student.nascimento || '',
      telefone: student.telefone || '', cidade: student.cidade || '', estado: student.estado || '', tipoParticipacao: 'Cursista', tipoFicha: 'Cursista individual',
      numeroFicha: student.numeroFichaIndividual || '', comunidade: communityFor(retreatCommunities, 'membroIds', student.id) !== 'Sem comunidade'
        ? communityFor(retreatCommunities, 'membroIds', student.id) : communityFor(retreatCommunities, 'membroIds', student.cpf),
      problemaSaude: student.qualAlergia || student.qualMedicamentoContinuo || '', intolerancia: student.qualIntolerancia || '',
      valorInscricao: money(student.valorInscricao), valorPago: money(student.valorPago), saldoPagar: money(student.saldoPagar) || Math.max(0, money(student.valorInscricao) - money(student.valorPago)), formaPagamento: student.recebedorFormaPagamento || student.formaPagamento || '',
    };
  });

  selectedRetreats.forEach((retreat) => {
    const retreatCommunities = communityByRetreat.get(retreat.id) || [];
    [[false, smpByRetreat.get(retreat.id)], [true, epcByRetreat.get(retreat.id)]].forEach(([isEpc, records]) => array(records).forEach((record) => {
      const memberField = isEpc ? 'membroEpcIds' : 'membroSmpIds';
      const formId = record.id || record.numeroFichaSmp; const coupleName = [record.nomeDele, record.nomeDela].filter(Boolean).join(' e ');
      const enrollmentValue = money(record.valorInscricaoSmp); const paidValue = money(record.valorPagoSmp);
      const common = { ...baseRetreatFields(retreat), formKey: `${isEpc ? 'epc' : 'smp'}:${retreat.id}:${formId}`, tipoParticipacao: 'Cursista', tipoFicha: isEpc ? 'Cursista EPC' : 'Cursista SMP', numeroFicha: formId, comunidade: communityFor(retreatCommunities, memberField, formId), casal: coupleName, valorInscricao: enrollmentValue, valorPago: paidValue, saldoPagar: money(record.saldoPagarSmp) || Math.max(0, enrollmentValue - paidValue), formaPagamento: record.recebedorFormaPagamentoSmp || '' };
      [['Dele', 'nomeDele', 'cpfDele', 'nascimentoDele', 'foneDele', 'saudeDele', 'qualSaudeDele', 'qualIntoleranciaAlimentarDele'], ['Dela', 'nomeDela', 'cpfDela', 'nascimentoDela', 'foneDela', 'saudeDela', 'qualSaudeDela', 'qualIntoleranciaAlimentarDela']].forEach(([side, nameKey, cpfKey, birthKey, phoneKey, healthKey, healthDetailKey, intoleranceKey]) => {
        if (!record[nameKey] && !record[cpfKey]) return;
        studentRows.push({ ...common, recordKey: `${common.formKey}:${side}`, personKey: validCpfKey(record[cpfKey]) || `${common.formKey}:${side}`, nome: record[nameKey] || side, cpf: record[cpfKey] || '', nascimento: record[birthKey] || '', telefone: record[phoneKey] || '', cidade: record.cidade || '', estado: record.estadoSmp || '', problemaSaude: text(record[healthDetailKey]) || (text(record[healthKey]).toLowerCase() === 'sim' ? 'Informado' : ''), intolerancia: record[intoleranceKey] || '' });
      });
    }));
  });

  if (spec.dataset === 'retiros') return selectedRetreats.map((retreat) => ({ ...baseRetreatFields(retreat), recordKey: `retiro:${retreat.id}`, formKey: `retiro:${retreat.id}` }));
  if (spec.dataset === 'equipe') return teamRows;
  if (spec.dataset === 'cursistas') return studentRows;
  if (spec.dataset === 'participacoes') {
    const byForm = new Map();
    teamRows.forEach((row) => {
      const current = byForm.get(row.formKey);
      if (!current) byForm.set(row.formKey, { ...row, recordKey: row.formKey, setor: row.setor });
      else current.setor = unique([...String(current.setor || '').split(', '), row.setor]).join(', ');
    });
    const teamParticipations = [...byForm.values()];
    return [...teamParticipations, ...studentRows];
  }
  if (spec.dataset === 'financeiro') {
    const teamForms = [...new Map(teamRows.map((row) => [row.formKey, row])).values()];
    const studentForms = [...new Map(studentRows.map((row) => [row.formKey, { ...row, nome: row.casal || row.nome }])).values()];
    return [...teamForms, ...studentForms];
  }
  if (spec.dataset === 'comunidades') return [...new Map(studentRows.filter((row) => row.comunidade && row.comunidade !== 'Sem comunidade').map((row) => [row.formKey, { ...row, nome: row.casal || row.nome }])).values()];
  return [];
}

const comparable = (value) => typeof value === 'number' ? value : text(value).toLocaleLowerCase('pt-BR');
function matchesFilters(row, filters) {
  return filters.every((filter) => {
    const current = row[filter.field];
    const numeric = fieldCatalog[filter.field]?.type === 'money';
    const left = numeric ? money(current) : comparable(current); const right = numeric ? money(String(filter.value).replace(',', '.')) : comparable(filter.value);
    if (filter.operator === 'empty') return current === undefined || current === null || text(current) === '';
    if (filter.operator === 'notEmpty') return !(current === undefined || current === null || text(current) === '');
    if (filter.operator === 'equals') return left === right;
    if (filter.operator === 'notEquals') return left !== right;
    if (filter.operator === 'gte') return left >= right;
    if (filter.operator === 'lte') return left <= right;
    return String(left).includes(String(right));
  });
}

function metricValues(rows) {
  return {
    registros: new Set(rows.map((row) => row.recordKey)).size,
    pessoas: new Set(rows.map((row) => row.personKey).filter(Boolean)).size,
    fichas: new Set(rows.map((row) => row.formKey).filter(Boolean)).size,
    retiros: new Set(rows.map((row) => row.retiroId).filter(Boolean)).size,
    comunidades: new Set(rows.filter((row) => row.comunidade && row.comunidade !== 'Sem comunidade').map((row) => `${row.retiroId}:${row.comunidade}`)).size,
    valorInscricao: rows.reduce((sum, row) => sum + money(row.valorInscricao), 0),
    valorPago: rows.reduce((sum, row) => sum + money(row.valorPago), 0),
    saldoPagar: rows.reduce((sum, row) => sum + money(row.saldoPagar), 0),
  };
}

function orderRows(rows, sort) {
  const rules = sort.length ? sort : [];
  if (!rules.length) return rows;
  return [...rows].sort((a, b) => {
    for (const rule of rules) {
      const left = comparable(a[rule.field]); const right = comparable(b[rule.field]);
      const result = left < right ? -1 : left > right ? 1 : 0;
      if (result) return rule.direction === 'desc' ? -result : result;
    }
    return 0;
  });
}

async function buildReport(incoming, allowedRetreatIds = null, options = {}) {
  const spec = validateSpec(incoming); const dataset = datasets[spec.dataset];
  const source = (await sourceRows(spec, allowedRetreatIds)).filter((row) => matchesFilters(row, spec.filters));
  const summaryValues = metricValues(source);
  let resultRows;
  let resultColumns;
  if (spec.groupBy.length) {
    const groups = new Map();
    source.forEach((row) => {
      const key = JSON.stringify(spec.groupBy.map((field) => row[field] ?? 'Não informado'));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    resultRows = [...groups.values()].map((rows) => ({
      ...Object.fromEntries(spec.groupBy.map((field) => [field, rows[0][field] || 'Não informado'])),
      ...Object.fromEntries(spec.metrics.map((metric) => [metric, metricValues(rows)[metric]])),
    }));
    resultColumns = [...spec.groupBy, ...spec.metrics];
  } else {
    resultRows = source.map((row) => Object.fromEntries(spec.columns.map((field) => [field, row[field] ?? ''])));
    resultColumns = spec.columns;
  }
  resultRows = orderRows(resultRows, spec.sort);
  const totalRows = resultRows.length;
  const exportAll = options.exportAll === true;
  const pageRows = exportAll ? resultRows : resultRows.slice((spec.page - 1) * spec.pageSize, spec.page * spec.pageSize);
  const columnCatalog = resultColumns.map((id) => fieldCatalog[id] || metrics[id]).filter(Boolean);
  const chartMetric = spec.metrics[0];
  const chart = spec.groupBy.length && spec.chart !== 'none' ? pageRows.slice(0, 20).map((row) => ({ label: spec.groupBy.map((field) => row[field]).join(' · '), value: Number(row[chartMetric]) || 0 })) : [];
  return {
    spec, dataset: { id: dataset.id, label: dataset.label }, columns: columnCatalog, rows: pageRows, totalRows,
    page: spec.page, pageSize: spec.pageSize, truncated: false,
    summary: spec.metrics.map((id) => ({ ...metrics[id], value: summaryValues[id] })), chart,
    generatedAt: new Date().toISOString(), liveData: spec.statuses.some((status) => status !== 'concluido'),
  };
}

async function reportCatalog(allowedRetreatIds = null) {
  const allowed = allowedRetreatIds ? new Set(allowedRetreatIds) : null;
  const retreats = (await listRecords('retiros')).filter((retreat) => !allowed || allowed.has(retreat.id));
  return { ...catalog(), locations: unique(retreats.map((retreat) => text(retreat.local))).sort((a, b) => a.localeCompare(b, 'pt-BR')), retreats: retreats.map((retreat) => ({ id: retreat.id, nome: retreat.nome, status: retreat.status, statusLabel: statusLabels[retreat.status] || retreat.status, dataInicio: retreat.dataInicio, dataTermino: retreat.dataTermino, local: retreat.local || '' })) };
}

module.exports = { buildReport, reportCatalog, validateSpec };
