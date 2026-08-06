const crypto = require('crypto');
const {
  listCursistasEpc,
  listCursistasSmp,
  listRecords,
  saveCursistaEpc,
  saveCursistaSmp,
  saveRecord,
} = require('./databaseAdapter');

const supportedStudentTypes = new Set(['cursista-individual', 'cursista-smp', 'cursista-epc']);
const financialFields = new Set([
  'valorInscricao', 'valorPago', 'saldoPagar', 'formaPagamento', 'observacaoPagamento',
  'recebedorValorPago', 'recebedorTaxaPaga', 'recebedorFormaPagamento', 'recebedorObservacao',
  'valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp', 'recebedorValorPagoSmp',
  'recebedorTaxaPagaSmp', 'recebedorFormaPagamentoSmp', 'recebedorObservacaoSmp',
]);
const reservedFields = new Set([
  'id', 'retiroId', 'numeroFichaIndividual', 'numeroFichaSmp', 'createdAt', 'updatedAt',
  'criadoEm', 'atualizadoEm', '__userSubmittedRegistration', '__allowRegistrationDataLoss',
  ...financialFields,
]);

const individualFields = new Set([
  'cpf', 'nome', 'nascimento', 'telefone', 'cep', 'rua', 'endereco', 'numero', 'bairro',
  'cidade', 'estado', 'batizado', 'primeiraComunhao', 'estuda', 'serie', 'escola',
  'fezRetiro', 'qualRetiro', 'nomePai', 'telefonePai', 'nomeMae', 'telefoneMae',
  'paisMovimento', 'qualMovimento', 'convidou', 'camiseta', 'camisetaOutro',
  'intoleranciaAlimentos', 'qualIntolerancia', 'alergiaMedicamento', 'qualAlergia',
  'medicamentoCabeca', 'medicamentoEstomago', 'medicamentoContinuo', 'qualMedicamentoContinuo',
]);

const coupleFields = new Set([
  'nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'crismaDele',
  'religiaoDele', 'missaDele', 'movimentoIgrejaDele', 'qualMovimentoDele', 'casamentoDele',
  'filhosDele', 'saudeDele', 'qualSaudeDele', 'intoleranciaAlimentarDele',
  'qualIntoleranciaAlimentarDele', 'manequimDele', 'nomeDela', 'nascimentoDela', 'cpfDela',
  'profissaoDela', 'foneDela', 'crismaDela', 'religiaoDela', 'missaDela',
  'movimentoIgrejaDela', 'qualMovimentoDela', 'casamentoDela', 'filhosDela', 'saudeDela',
  'qualSaudeDela', 'intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela', 'manequimDela',
  'cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp', 'emailEpc',
  'uniaoCasal', 'localCasamentoEpc', 'idadeFilhosEpc', 'filhosUniao', 'outrasUnioes',
  'temFilhosEpc', 'smpKidsNotNeeded', 'precisaAcolhimento', 'nomeApresentante',
  'foneApresentante', 'contatoEmergenciaEpc', 'foneEmergenciaEpc', 'cursoApresentante',
  'cidadeApresentante', 'paroquiaApresentante', 'familiarAmigo', 'foneFamiliar',
]);
for (let index = 1; index <= 5; index += 1) {
  [
    `smpKidNome${index}`, `smpKidNascimento${index}`, `smpKidProblemaSaude${index}`,
    `smpKidDescricaoSaude${index}`, `smpKidIntolerancia${index}`,
    `smpKidDescricaoIntolerancia${index}`, `smpKidProblemaSaude${index}Epc`,
    `smpKidDescricaoSaude${index}Epc`, `smpKidIntolerancia${index}Epc`,
    `smpKidDescricaoIntolerancia${index}Epc`,
  ].forEach((field) => coupleFields.add(field));
}

const normalizeCount = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
};
const normalizeFileNumber = (value) => {
  const number = Number(String(value || '').trim());
  return Number.isInteger(number) && number > 0 ? number : 0;
};
const normalizeCpf = (value) => String(value || '').replace(/\D/g, '');
const isValidCpf = (value) => {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length) => {
    let total = 0;
    for (let index = 0; index < length; index += 1) total += Number(cpf[index]) * (length + 1 - index);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
};
const newToken = () => crypto.randomBytes(24).toString('hex');

function syncStudentRegistrationLinks(currentRetreat = null, incomingRetreat = {}) {
  const expectedCount = normalizeCount(incomingRetreat.numeroPrevistoFichasCursista);
  const sourceLinks = currentRetreat ? currentRetreat.linksCadastroCursistas : [];
  const linksByNumber = new Map();
  (Array.isArray(sourceLinks) ? sourceLinks : []).forEach((link) => {
    const numeroFicha = normalizeFileNumber(link?.numeroFicha);
    const token = String(link?.token || '').trim();
    if (!numeroFicha || !token || linksByNumber.has(numeroFicha)) return;
    linksByNumber.set(numeroFicha, {
      numeroFicha,
      token,
      createdAt: link.createdAt || new Date().toISOString(),
    });
  });
  for (let numeroFicha = 1; numeroFicha <= expectedCount; numeroFicha += 1) {
    if (!linksByNumber.has(numeroFicha)) {
      linksByNumber.set(numeroFicha, { numeroFicha, token: newToken(), createdAt: new Date().toISOString() });
    }
  }
  return [...linksByNumber.values()].sort((first, second) => first.numeroFicha - second.numeroFicha);
}

function withSyncedStudentRegistrationLinks(currentRetreat, incomingRetreat) {
  return {
    ...incomingRetreat,
    linksCadastroCursistas: syncStudentRegistrationLinks(currentRetreat, incomingRetreat),
  };
}

function sanitizePublicRetreat(retreat) {
  if (!retreat) return retreat;
  const sanitized = { ...retreat };
  delete sanitized.linksCadastroCursistas;
  return sanitized;
}

async function studentRecordsForRetreat(retreatId) {
  const optionalCoupleList = async (loader) => {
    try {
      return await loader(retreatId);
    } catch (error) {
      if (/usa somente Supabase/i.test(String(error?.message || ''))) return [];
      throw error;
    }
  };
  const [individual, smp, epc] = await Promise.all([
    listRecords('cursistas'),
    optionalCoupleList(listCursistasSmp),
    optionalCoupleList(listCursistasEpc),
  ]);
  return {
    individual: individual.filter((record) => record.retiroId === retreatId),
    smp,
    epc,
  };
}

const recordFileNumber = (record, type) => normalizeFileNumber(
  type === 'cursista-individual' ? record.numeroFichaIndividual : (record.numeroFichaSmp || record.id),
);

function occupiedFileNumbers(records) {
  return new Set([
    ...records.individual.map((record) => recordFileNumber(record, 'cursista-individual')),
    ...records.smp.map((record) => recordFileNumber(record, 'cursista-smp')),
    ...records.epc.map((record) => recordFileNumber(record, 'cursista-epc')),
  ].filter(Boolean));
}

async function studentRegistrationLinkStatus(retreat) {
  const expectedCount = normalizeCount(retreat?.numeroPrevistoFichasCursista);
  if (!expectedCount) return [];
  const occupied = occupiedFileNumbers(await studentRecordsForRetreat(retreat.id));
  return (retreat.linksCadastroCursistas || [])
    .filter((link) => normalizeFileNumber(link.numeroFicha) <= expectedCount)
    .map((link) => ({
      numeroFicha: normalizeFileNumber(link.numeroFicha),
      token: link.token,
      createdAt: link.createdAt,
      status: occupied.has(normalizeFileNumber(link.numeroFicha)) ? 'cadastrada' : 'disponivel',
    }))
    .sort((first, second) => first.numeroFicha - second.numeroFicha);
}

async function resolvePublicStudentLink(token = '') {
  const cleanToken = decodeURIComponent(String(token || '').trim());
  if (!cleanToken) return null;
  const retreats = await listRecords('retiros');
  for (const retreat of retreats) {
    const link = (retreat.linksCadastroCursistas || []).find((item) => item?.token === cleanToken);
    if (!link) continue;
    const numeroFicha = normalizeFileNumber(link.numeroFicha);
    const expectedCount = normalizeCount(retreat.numeroPrevistoFichasCursista);
    const type = supportedStudentTypes.has(retreat.tipoFichaCursista) ? retreat.tipoFichaCursista : 'cursista-individual';
    const occupied = occupiedFileNumbers(await studentRecordsForRetreat(retreat.id));
    return {
      retreat,
      link,
      numeroFicha,
      type,
      active: retreat.status === 'publicado' && numeroFicha > 0 && numeroFicha <= expectedCount,
      occupied: occupied.has(numeroFicha),
    };
  }
  return null;
}

function allowedPayload(incoming, type) {
  const allowed = type === 'cursista-individual' ? individualFields : coupleFields;
  return Object.fromEntries(Object.entries(incoming || {}).filter(([key]) => allowed.has(key) && !reservedFields.has(key)));
}

function publicStudentError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function validateIndividual(record) {
  const required = [
    'cpf', 'nome', 'nascimento', 'telefone', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'estado',
    'batizado', 'primeiraComunhao', 'estuda', 'fezRetiro', 'paisMovimento', 'camiseta',
    'intoleranciaAlimentos', 'alergiaMedicamento', 'medicamentoContinuo',
  ];
  if (required.some((field) => !String(record[field] || '').trim())) throw publicStudentError('Revise os campos obrigatorios antes de salvar.');
  if (!isValidCpf(record.cpf)) throw publicStudentError('Informe um CPF valido.');
  const conditionalFields = [
    ['intoleranciaAlimentos', 'qualIntolerancia'],
    ['alergiaMedicamento', 'qualAlergia'],
    ['medicamentoContinuo', 'qualMedicamentoContinuo'],
  ];
  if (conditionalFields.some(([choice, detail]) => record[choice] === 'Sim' && !String(record[detail] || '').trim())) {
    throw publicStudentError('Detalhe as informacoes de saude indicadas antes de salvar.');
  }
}

function validateCouple(record) {
  if (!String(record.nomeDele || '').trim() || !String(record.nomeDela || '').trim()) {
    throw publicStudentError('Informe os nomes do casal antes de salvar.');
  }
  ['cpfDele', 'cpfDela'].forEach((field) => {
    if (record[field] && !isValidCpf(record[field])) throw publicStudentError('Revise os CPFs informados antes de salvar.');
  });
  if (record.cpfDele && record.cpfDela && normalizeCpf(record.cpfDele) === normalizeCpf(record.cpfDela)) {
    throw publicStudentError('Informe um CPF diferente para cada integrante do casal.');
  }
}

async function validateCpfAvailability(retreatId, record, type) {
  const records = await studentRecordsForRetreat(retreatId);
  const submitted = type === 'cursista-individual'
    ? [normalizeCpf(record.cpf)]
    : [normalizeCpf(record.cpfDele), normalizeCpf(record.cpfDela)];
  const existing = [
    ...records.individual.map((item) => normalizeCpf(item.cpf)),
    ...records.smp.flatMap((item) => [normalizeCpf(item.cpfDele), normalizeCpf(item.cpfDela)]),
    ...records.epc.flatMap((item) => [normalizeCpf(item.cpfDele), normalizeCpf(item.cpfDela)]),
  ].filter(Boolean);
  if (submitted.filter(Boolean).some((cpf) => existing.includes(cpf))) {
    throw publicStudentError('CPF ja cadastrado para este retiro.', 409, 'DUPLICATE_RETREAT_STUDENT_CPF');
  }
  const people = await listRecords('pessoas');
  const enrolments = await listRecords('adesoes');
  const personIds = new Set(people.filter((person) => submitted.includes(normalizeCpf(person.cpf || person.id))).flatMap((person) => [person.id, normalizeCpf(person.cpf)]));
  if (enrolments.some((entry) => entry.retiroId === retreatId && (personIds.has(entry.pessoaId) || submitted.includes(normalizeCpf(entry.pessoaId))))) {
    throw publicStudentError('Este CPF ja esta cadastrado na equipe de trabalho deste retiro.', 409, 'STUDENT_TEAM_CONFLICT');
  }
}

async function savePublicStudentRegistration(token, incoming) {
  const context = await resolvePublicStudentLink(token);
  if (!context) throw publicStudentError('Link de cadastro nao encontrado.', 404);
  if (!context.active) throw publicStudentError('Este cadastro nao esta disponivel.', 409);
  if (context.occupied) throw publicStudentError('Ficha ja cadastrada.', 409, 'STUDENT_FILE_OCCUPIED');
  const record = allowedPayload(incoming, context.type);
  if (record.smpKidsNotNeeded === true) {
    for (let index = 1; index <= 5; index += 1) {
      [...coupleFields]
        .filter((field) => field.startsWith(`smpKid`) && field.includes(String(index)))
        .forEach((field) => { record[field] = ''; });
    }
  }
  if (context.type === 'cursista-individual') validateIndividual(record);
  else validateCouple(record);
  await validateCpfAvailability(context.retreat.id, record, context.type);

  const now = new Date().toISOString();
  const registrationValue = Math.max(0, Number(context.retreat.valorInscricaoCursista) || 0);
  if (context.type === 'cursista-individual') {
    const saved = {
      ...record,
      id: crypto.randomUUID(),
      retiroId: context.retreat.id,
      numeroFichaIndividual: context.numeroFicha,
      cpf: normalizeCpf(record.cpf),
      valorInscricao: registrationValue,
      valorPago: 0,
      saldoPagar: registrationValue,
      recebedorValorPago: 0,
      recebedorTaxaPaga: false,
      criadoEm: now,
      atualizadoEm: now,
    };
    return saveRecord('cursistas', saved);
  }

  const saved = {
    ...record,
    id: String(context.numeroFicha),
    numeroFichaSmp: String(context.numeroFicha),
    retiroId: context.retreat.id,
    cpfDele: normalizeCpf(record.cpfDele),
    cpfDela: normalizeCpf(record.cpfDela),
    valorInscricaoSmp: registrationValue,
    valorPagoSmp: 0,
    saldoPagarSmp: registrationValue,
    recebedorValorPagoSmp: 0,
    recebedorTaxaPagaSmp: false,
    criadoEm: now,
    updatedAt: now,
  };
  return context.type === 'cursista-epc' ? saveCursistaEpc(saved) : saveCursistaSmp(saved);
}

module.exports = {
  normalizeCount,
  resolvePublicStudentLink,
  sanitizePublicRetreat,
  savePublicStudentRegistration,
  studentRegistrationLinkStatus,
  syncStudentRegistrationLinks,
  withSyncedStudentRegistrationLinks,
};
