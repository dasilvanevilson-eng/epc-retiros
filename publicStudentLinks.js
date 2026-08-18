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
const studentRegistrationLinkVersion = 2;
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
  'outrasUnioesDele', 'outrasUnioesDela', 'porqueQueremFazerRetiro', 'comoSouberamRetiro',
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

const smpRequiredTextFields = [
  'nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'religiaoDele', 'missaDele',
  'nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'religiaoDela', 'missaDela',
  'cep', 'endereco', 'numero', 'bairro', 'cidade', 'estadoSmp', 'uniaoCasal', 'filhosUniao',
  'familiarAmigo', 'foneFamiliar',
];
const smpRequiredChoiceFields = [
  'crismaDele', 'crismaDela', 'movimentoIgrejaDele', 'movimentoIgrejaDela', 'outrasUnioesDele', 'outrasUnioesDela',
  'saudeDele', 'saudeDela', 'intoleranciaAlimentarDele', 'intoleranciaAlimentarDela',
  'precisaAcolhimento', 'manequimDele', 'manequimDela',
];
const smpConditionalRequiredFields = [
  ['movimentoIgrejaDele', 'qualMovimentoDele'],
  ['movimentoIgrejaDela', 'qualMovimentoDela'],
  ['saudeDele', 'qualSaudeDele'],
  ['saudeDela', 'qualSaudeDela'],
  ['intoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDele'],
  ['intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela'],
];

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

function syncStudentRegistrationLinks(currentRetreat = null, incomingRetreat = {}, { rotateLegacy = false } = {}) {
  const expectedCount = normalizeCount(incomingRetreat.numeroPrevistoFichasCursista);
  const sourceLinks = currentRetreat ? currentRetreat.linksCadastroCursistas : [];
  const linksByNumber = new Map();
  (Array.isArray(sourceLinks) ? sourceLinks : []).forEach((link) => {
    const numeroFicha = normalizeFileNumber(link?.numeroFicha);
    const token = String(link?.token || '').trim();
    if (!numeroFicha || !token || linksByNumber.has(numeroFicha)) return;
    const legacy = Number(link.versao) !== studentRegistrationLinkVersion;
    linksByNumber.set(numeroFicha, {
      numeroFicha,
      token: rotateLegacy && legacy ? newToken() : token,
      createdAt: rotateLegacy && legacy ? new Date().toISOString() : (link.createdAt || new Date().toISOString()),
      enviadoPara: String(link.enviadoPara || '').trim(),
      inscricaoEncerrada: link.inscricaoEncerrada === true,
      ...(legacy && !rotateLegacy ? {} : { versao: studentRegistrationLinkVersion }),
    });
  });
  for (let numeroFicha = 1; numeroFicha <= expectedCount; numeroFicha += 1) {
    if (!linksByNumber.has(numeroFicha)) {
      linksByNumber.set(numeroFicha, {
        numeroFicha,
        token: newToken(),
        createdAt: new Date().toISOString(),
        enviadoPara: '',
        inscricaoEncerrada: false,
        versao: studentRegistrationLinkVersion,
      });
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
    listRecords('cursistas', { retiroId: retreatId }),
    optionalCoupleList(listCursistasSmp),
    optionalCoupleList(listCursistasEpc),
  ]);
  return {
    individual: individual.filter((record) => record.retiroId === retreatId),
    smp,
    epc,
  };
}

const studentRecordCounts = (records) => ({
  individual: records.individual.length,
  smp: records.smp.length,
  epc: records.epc.length,
});

async function prepareStudentRegistrationLinkSync(retreat) {
  const sourceLinks = Array.isArray(retreat?.linksCadastroCursistas) ? retreat.linksCadastroCursistas : [];
  const hasLegacyLinks = sourceLinks.some((link) => Number(link?.versao) !== studentRegistrationLinkVersion);
  if (!hasLegacyLinks) {
    return {
      blocked: false,
      rotated: false,
      counts: { individual: 0, smp: 0, epc: 0 },
      links: syncStudentRegistrationLinks(retreat, retreat),
    };
  }
  const records = await studentRecordsForRetreat(retreat.id);
  const counts = studentRecordCounts(records);
  if (counts.individual + counts.smp + counts.epc > 0) {
    return { blocked: true, rotated: false, counts, links: sourceLinks };
  }
  return {
    blocked: false,
    rotated: true,
    counts,
    links: syncStudentRegistrationLinks(retreat, retreat, { rotateLegacy: true }),
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

function registeredStudentsByFileNumber(records) {
  const registrations = new Map();
  records.individual.forEach((record) => {
    const numeroFicha = recordFileNumber(record, 'cursista-individual');
    if (!numeroFicha || registrations.has(numeroFicha)) return;
    registrations.set(numeroFicha, {
      tipoCadastro: 'individual',
      nomeCadastrado: String(record.nome || '').trim() || 'Nome não informado',
    });
  });
  [records.smp, records.epc].forEach((coupleRecords) => coupleRecords.forEach((record) => {
    const numeroFicha = recordFileNumber(record, 'cursista-smp');
    if (!numeroFicha || registrations.has(numeroFicha)) return;
    const names = [record.nomeDele, record.nomeDela].map((name) => String(name || '').trim()).filter(Boolean);
    registrations.set(numeroFicha, {
      tipoCadastro: 'casal',
      nomeCadastrado: names.join(' e ') || 'Nomes não informados',
    });
  }));
  return registrations;
}

async function studentRegistrationLinkStatus(retreat) {
  const expectedCount = normalizeCount(retreat?.numeroPrevistoFichasCursista);
  if (!expectedCount) return [];
  const records = await studentRecordsForRetreat(retreat.id);
  const occupied = occupiedFileNumbers(records);
  const registrations = registeredStudentsByFileNumber(records);
  return (retreat.linksCadastroCursistas || [])
    .filter((link) => normalizeFileNumber(link.numeroFicha) <= expectedCount)
    .map((link) => {
      const numeroFicha = normalizeFileNumber(link.numeroFicha);
      const registration = registrations.get(numeroFicha) || {};
      return {
        numeroFicha,
        token: link.token,
        createdAt: link.createdAt,
        versao: link.versao,
        enviadoPara: String(link.enviadoPara || '').trim(),
        inscricaoEncerrada: link.inscricaoEncerrada === true,
        status: occupied.has(numeroFicha) ? 'cadastrada' : (link.inscricaoEncerrada === true ? 'encerrada' : 'disponivel'),
        tipoCadastro: registration.tipoCadastro || '',
        nomeCadastrado: registration.nomeCadastrado || '',
      };
    })
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
      active: ['preparacao', 'publicado'].includes(retreat.status) && link.inscricaoEncerrada !== true && numeroFicha > 0 && numeroFicha <= expectedCount,
      closed: link.inscricaoEncerrada === true,
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

const individualDateFields = ['nascimento'];
const coupleDateFields = [
  'nascimentoDele', 'nascimentoDela', 'casamentoDele', 'casamentoDela', 'uniaoCasal',
  ...Array.from({ length: 5 }, (_, index) => `smpKidNascimento${index + 1}`),
];

function normalizePublicDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!iso && !br) return '';
  const year = Number(iso ? iso[1] : br[3]);
  const month = Number(iso ? iso[2] : br[2]);
  const day = Number(iso ? iso[3] : br[1]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizePublicRecordDates(record, type) {
  const fields = type === 'cursista-individual' ? individualDateFields : coupleDateFields;
  fields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(record, field)) return;
    const raw = String(record[field] || '').trim();
    if (!raw) {
      record[field] = '';
      return;
    }
    const normalized = normalizePublicDate(raw);
    if (!normalized) throw publicStudentError('Revise a data informada. Use o formato dd/mm/aaaa.');
    record[field] = normalized;
  });
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

function validateCouple(record, type) {
  if (!String(record.nomeDele || '').trim() || !String(record.nomeDela || '').trim()) {
    throw publicStudentError('Informe os nomes do casal antes de salvar.');
  }
  ['cpfDele', 'cpfDela'].forEach((field) => {
    if (record[field] && !isValidCpf(record[field])) throw publicStudentError('Revise os CPFs informados antes de salvar.');
  });
  if (record.cpfDele && record.cpfDela && normalizeCpf(record.cpfDele) === normalizeCpf(record.cpfDela)) {
    throw publicStudentError('Informe um CPF diferente para cada integrante do casal.');
  }
  if (type !== 'cursista-smp') return;
  if (smpRequiredTextFields.some((field) => !String(record[field] || '').trim())
    || smpRequiredChoiceFields.some((field) => !String(record[field] || '').trim())) {
    throw publicStudentError('Revise todos os campos obrigatorios antes de salvar.');
  }
  if (!isValidCpf(record.cpfDele) || !isValidCpf(record.cpfDela)) {
    throw publicStudentError('Informe um CPF valido para cada integrante do casal.');
  }
  if (smpConditionalRequiredFields.some(([choice, detail]) => record[choice] === 'Sim' && !String(record[detail] || '').trim())) {
    throw publicStudentError('Preencha os campos de detalhe obrigatorios antes de salvar.');
  }
  if (record.smpKidsNotNeeded === true) return;
  const usedKids = Array.from({ length: 5 }, (_, index) => index + 1).filter((kidNumber) => [...coupleFields]
    .filter((field) => field.startsWith(`smpKid`) && field.includes(String(kidNumber)))
    .some((field) => String(record[field] || '').trim()));
  if (!usedKids.length) throw publicStudentError('Informe os dados das criancas que usarao o Espaco Kids ou marque que nao necessita.');
  const invalidKid = usedKids.some((kidNumber) => {
    const name = String(record[`smpKidNome${kidNumber}`] || '').trim();
    const birthDate = String(record[`smpKidNascimento${kidNumber}`] || '').trim();
    const health = record[`smpKidProblemaSaude${kidNumber}`];
    const intolerance = record[`smpKidIntolerancia${kidNumber}`];
    return !name || !birthDate || !health || !intolerance
      || (health === 'Sim' && !String(record[`smpKidDescricaoSaude${kidNumber}`] || '').trim())
      || (intolerance === 'Sim' && !String(record[`smpKidDescricaoIntolerancia${kidNumber}`] || '').trim());
  });
  if (invalidKid) throw publicStudentError('Complete os dados obrigatorios das criancas que usarao o Espaco Kids.');
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
  const people = await listRecords('pessoas', { retiroId: retreatId });
  const enrolments = await listRecords('adesoes', { retiroId: retreatId });
  const personIds = new Set(people.filter((person) => submitted.includes(normalizeCpf(person.cpf || person.id))).flatMap((person) => [person.id, normalizeCpf(person.cpf)]));
  if (enrolments.some((entry) => entry.retiroId === retreatId && (personIds.has(entry.pessoaId) || submitted.includes(normalizeCpf(entry.pessoaId))))) {
    throw publicStudentError('Este CPF ja esta cadastrado na equipe de trabalho deste retiro.', 409, 'STUDENT_TEAM_CONFLICT');
  }
}

async function savePublicStudentRegistration(token, incoming, expectedFileNumber = 0) {
  const context = await resolvePublicStudentLink(token);
  if (!context) throw publicStudentError('Link de cadastro nao encontrado.', 404);
  const expectedNumber = normalizeFileNumber(expectedFileNumber);
  if (expectedNumber && expectedNumber !== context.numeroFicha) {
    throw publicStudentError('O numero da ficha nao corresponde a este link.', 404, 'STUDENT_LINK_FILE_MISMATCH');
  }
  if (context.closed) throw publicStudentError('Inscricao encerrada para esta ficha.', 409, 'STUDENT_LINK_CLOSED');
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
  normalizePublicRecordDates(record, context.type);
  if (context.type === 'cursista-individual') validateIndividual(record);
  else validateCouple(record, context.type);
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
  prepareStudentRegistrationLinkSync,
  resolvePublicStudentLink,
  sanitizePublicRetreat,
  savePublicStudentRegistration,
  studentRegistrationLinkStatus,
  studentRegistrationLinkVersion,
  syncStudentRegistrationLinks,
  withSyncedStudentRegistrationLinks,
};
