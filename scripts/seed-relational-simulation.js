const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const databaseFile = path.join(root, 'database', 'db.json');
const marker = 'simulacao_relacional_60_cursistas_190_adesoes';
const now = new Date().toISOString();
const args = new Set(process.argv.slice(2));

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios para gerar a simulacao relacional.');
}

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { checkDatabaseConnection, deleteRecord, listRecords, saveRecord } = require('../databaseAdapter');
const stores = require('../storeConfig').stores;

const sectors = [
  'Animacao',
  'Camareiros(as)',
  'Casal Bem-estar',
  'Coordenacao do retiro',
  'Coordenacao geral',
  'Cozinha',
  'Data Show',
  'Enfermaria',
  'Espaco Kids',
  'Espiritual',
  'Externo',
  'Folclore',
  'Jovem de sala',
  'Ligacao',
  'Monitores',
  'Recreacao',
  'Refeitorio',
  'Secretaria',
  'Tios de comunidade',
  'Zeladoria',
];
const publicSectors = sectors.filter((sector) => !['Coordenacao do retiro', 'Tios de comunidade', 'Monitores'].includes(sector));
const days = ['Sexta-feira', 'Sabado', 'Domingo'];
const cities = [
  { cidade: 'Blumenau', cep: '89010-000' },
  { cidade: 'Indaial', cep: '89130-000' },
  { cidade: 'Timbo', cep: '89120-000' },
  { cidade: 'Rio dos Cedros', cep: '89121-000' },
  { cidade: 'Pomerode', cep: '89107-000' },
];
const neighborhoods = ['Centro', 'Nacoes', 'Estados', 'Encano', 'Das Capitais', 'Velha', 'Quintino', 'Warnow'];
const streets = ['Rua das Flores', 'Rua Santa Catarina', 'Avenida Central', 'Rua Sao Jose', 'Rua Pomerode', 'Rua da Igreja', 'Rua Sete de Setembro', 'Rua XV de Novembro'];
const adultMale = ['Andre', 'Bruno', 'Carlos', 'Daniel', 'Eduardo', 'Fabio', 'Gustavo', 'Henrique', 'Leandro', 'Marcelo', 'Paulo', 'Rafael', 'Rodrigo', 'Tiago', 'Vinicius'];
const adultFemale = ['Aline', 'Camila', 'Daniela', 'Eliane', 'Fernanda', 'Gabriela', 'Juliana', 'Karina', 'Luciana', 'Mariana', 'Patricia', 'Renata', 'Simone', 'Tatiane', 'Vanessa'];
const childMale = ['Arthur', 'Bernardo', 'Davi', 'Enzo', 'Felipe', 'Gabriel', 'Heitor', 'Joao', 'Lorenzo', 'Miguel', 'Nicolas', 'Pedro', 'Rafael', 'Theo', 'Vitor'];
const childFemale = ['Alice', 'Ana', 'Beatriz', 'Clara', 'Helena', 'Isabela', 'Julia', 'Laura', 'Livia', 'Luiza', 'Manuela', 'Maria', 'Sofia', 'Valentina', 'Yasmin'];
const lastNames = ['Almeida', 'Bauer', 'Cardoso', 'Costa', 'Fischer', 'Freitas', 'Goncalves', 'Krause', 'Lima', 'Muller', 'Oliveira', 'Pereira', 'Ribeiro', 'Schmidt', 'Silva', 'Souza', 'Weber'];
const retreatsDone = ['Girassol', 'Onda', 'EPC', 'EJA', 'EJU', 'Taschinha', 'Eis-me aqui'];
const shirtSizes = ['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2'];
const paymentMethods = ['Pix', 'Dinheiro', 'Cartao', 'Transferencia'];

const pick = (items, index) => items[index % items.length];
const uuid = () => crypto.randomUUID();
const normalizeName = (name) => name.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const birthDate = (year, index) => `${year}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`;
const phone = (index) => `(47) 9${String(7000 + index).padStart(4, '0')}-${String(1000 + index).padStart(4, '0')}`;
const fullName = (firstNames, index, suffix = '') => `${pick(firstNames, index)} ${pick(lastNames, index)} ${pick(lastNames, index + 7)}${suffix}`;

function cpfFromIndex(index) {
  const base = String(920000000 + index).padStart(9, '0').slice(0, 9);
  const digits = base.split('').map(Number);
  const firstSum = digits.reduce((sum, digit, digitIndex) => sum + digit * (10 - digitIndex), 0);
  const firstDigit = firstSum % 11 < 2 ? 0 : 11 - (firstSum % 11);
  const secondSum = [...digits, firstDigit].reduce((sum, digit, digitIndex) => sum + digit * (11 - digitIndex), 0);
  const secondDigit = secondSum % 11 < 2 ? 0 : 11 - (secondSum % 11);
  return `${base}${firstDigit}${secondDigit}`;
}

function address(index) {
  const city = pick(cities, index);
  return {
    endereco: pick(streets, index),
    rua: pick(streets, index),
    numero: String(70 + index),
    bairro: pick(neighborhoods, index),
    cep: city.cep,
    cidade: city.cidade,
    estado: 'SC',
  };
}

function personalDataSnapshot(person) {
  return {
    cpf: person.cpf,
    nome: person.nome,
    nascimento: person.nascimento,
    genero: person.genero,
    telefone: person.telefone,
    cep: person.cep,
    endereco: person.endereco,
    numero: person.numero,
    bairro: person.bairro,
    cidade: person.cidade,
    estado: person.estado,
  };
}

function createPerson(index, gender, suffix = ' Equipe') {
  const cpf = cpfFromIndex(index);
  const firstNames = gender === 'Masculino' ? adultMale : adultFemale;
  const name = fullName(firstNames, index, suffix);
  return {
    id: cpf,
    cpf,
    nome: name,
    nomeNormalizado: normalizeName(name),
    nascimento: birthDate(1965 + (index % 28), index),
    genero: gender,
    telefone: phone(index),
    ...address(index),
    simulation: marker,
    createdAt: now,
    updatedAt: now,
  };
}

function createKids(index) {
  if (index % 4 !== 0) return [];
  const count = index % 8 === 0 ? 2 : 1;
  return Array.from({ length: count }, (_, offset) => {
    const gender = (index + offset) % 2 === 0 ? 'Masculino' : 'Feminino';
    return {
      nome: fullName(gender === 'Masculino' ? childMale : childFemale, index + offset, ' Kids'),
      nascimento: birthDate(2020 + ((index + offset) % 5), index + offset),
    };
  });
}

function createEnrolment(retreat, person, index, sector, casalId = '', papelNoCasal = '') {
  const validated = index % 5 !== 0;
  const paid = validated && index % 4 !== 0;
  const baseValue = Number(retreat.valorInscricaoVoluntario) || 60;
  const foto = index % 3 === 0 ? 'Nao' : 'Sim';
  const amount = baseValue + (foto === 'Sim' ? Number(retreat.valorFoto || 0) : 0);
  const kids = createKids(index);
  return {
    id: uuid(),
    retiroId: retreat.id,
    pessoaId: person.id,
    nome: person.nome,
    dadosPessoais: personalDataSnapshot(person),
    dias: index % 6 === 0 ? ['Sabado', 'Domingo'] : index % 7 === 0 ? ['Sexta-feira', 'Sabado'] : [...days],
    setores: [sector],
    retirosAnteriores: index % 6 === 0 ? [] : [pick(retreatsDone, index), pick(retreatsDone, index + 2)],
    quadrante: index % 8 === 0 ? 'Nao' : 'Sim',
    foto,
    contribuicao: money(amount),
    coordenacao: index % 17 === 0 ? 'Coordenador auxiliar' : '',
    coordenacaoSetor: index % 19 === 0,
    espacoKids: kids,
    espacoKidsNaoNecessito: kids.length === 0,
    observacao: index % 9 === 0 ? 'Observacao ficticia para validacao de relatorios.' : '',
    termoVoluntariadoAceito: true,
    termoVoluntariadoAceitoEm: now,
    tipoFicha: casalId ? 'Casal' : 'Individual',
    casalId,
    papelNoCasal,
    tipoFinanceiro: '',
    taxaPaga: paid,
    valorPago: paid ? amount : index % 10 === 0 ? amount / 2 : 0,
    formaPagamento: paid ? pick(paymentMethods, index) : '',
    recebedorObservacao: paid ? 'Pagamento simulado.' : '',
    status: validated ? 'confirmada' : 'pendente_validacao',
    validada: validated,
    validadoEm: validated ? now : '',
    simulation: marker,
    enviadoEm: now,
    atualizadoEm: now,
  };
}

function createStudent(retreat, index) {
  const gender = index % 2 === 0 ? 'Masculino' : 'Feminino';
  const cpf = cpfFromIndex(5000 + index);
  const value = Number(retreat.valorInscricaoCursista) || 180;
  const paid = index % 6 === 0 ? 0 : index % 5 === 0 ? value / 2 : value;
  const receiverPaid = index % 4 === 0 ? paid : 0;
  return {
    id: cpf,
    cpf,
    retiroId: retreat.id,
    nome: fullName(gender === 'Masculino' ? childMale : childFemale, index, ' Cursista'),
    nascimento: birthDate(2011 + (index % 6), index),
    genero: gender,
    telefone: phone(600 + index),
    ...address(500 + index),
    batizado: index % 7 === 0 ? 'Nao' : 'Sim',
    primeiraComunhao: index % 5 === 0 ? 'Nao' : 'Sim',
    estuda: 'Sim',
    serie: `${3 + (index % 6)} ano`,
    escola: `Escola ${pick(lastNames, index)} ${pick(cities, index).cidade}`,
    fezRetiro: index % 8 === 0 ? 'Sim' : 'Nao',
    qualRetiro: index % 8 === 0 ? pick(retreatsDone, index) : '',
    nomePai: fullName(adultMale, 700 + index),
    telefonePai: phone(700 + index),
    nomeMae: fullName(adultFemale, 800 + index),
    telefoneMae: phone(800 + index),
    paisMovimento: index % 3 === 0 ? 'Sim' : 'Nao',
    qualMovimento: index % 3 === 0 ? 'EPC' : '',
    convidou: fullName(index % 2 === 0 ? adultFemale : adultMale, 900 + index),
    camiseta: pick(shirtSizes, index),
    camisetaOutro: '',
    intoleranciaAlimentos: index % 10 === 0 ? 'Sim' : 'Nao',
    qualIntolerancia: index % 10 === 0 ? 'Lactose' : '',
    alergiaMedicamento: index % 12 === 0 ? 'Sim' : 'Nao',
    qualAlergia: index % 12 === 0 ? 'Dipirona' : '',
    medicamentoCabeca: 'Paracetamol',
    medicamentoEstomago: 'Buscopan',
    valorInscricao: money(value),
    valorPago: money(paid),
    saldoPagar: money(Math.max(0, value - paid)),
    recebedorValorPago: receiverPaid,
    recebedorTaxaPaga: receiverPaid >= value,
    recebedorFormaPagamento: receiverPaid ? pick(paymentMethods, index + 1) : '',
    recebedorObservacao: receiverPaid ? 'Recebimento simulado.' : '',
    simulation: marker,
    criadoEm: now,
    atualizadoEm: now,
  };
}

function createRetreat() {
  return {
    id: uuid(),
    nome: 'Retiro Simulado Relacional 2026',
    dataInicio: '2026-10-09',
    dataTermino: '2026-10-11',
    local: 'Casa de Retiros Sao Jose - Simulacao',
    coordenacaoGeral: 'Tios Coordenacao Geral',
    coordenacaoRetiro: 'Tios Coordenacao do Retiro',
    valorInscricaoCursista: 180,
    valorInscricaoVoluntario: 60,
    valorFoto: 15,
    descontoParentesco: 5,
    idadeMaximaEspacoKids: 10,
    recebedorToken: `recebedor-${marker}`,
    setores: sectors,
    setoresPublicos: publicSectors,
    ordemQuadrante: sectors,
    dias: days,
    contribuicoes: ['R$ 60,00 se o voluntario for o unico da familia', 'R$ 55,00 se o voluntario tiver mais pessoas da mesma familia trabalhando no retiro'],
    linksSetores: sectors.map((setor, index) => ({
      setor,
      token: `${marker}-legacy-${index}`,
      cadastroToken: `${marker}-cadastro-${index}`,
      acompanhamentoToken: `${marker}-setor-${index}`,
    })),
    status: 'publicado',
    simulation: marker,
    createdAt: now,
    updatedAt: now,
  };
}

async function cleanupPreviousSimulation() {
  const [retreats, people, settings] = await Promise.all([
    listRecords('retiros'),
    listRecords('pessoas'),
    listRecords('configuracoes'),
  ]);

  for (const setting of settings.filter((item) => item.simulation === marker || item.id === `quadrante:${marker}`)) {
    await deleteRecord('configuracoes', setting.id);
  }

  for (const retreat of retreats.filter((item) => item.simulation === marker || item.nome === 'Retiro Simulado Relacional 2026')) {
    await deleteRecord('retiros', retreat.id);
  }

  for (const person of people.filter((item) => item.simulation === marker)) {
    await deleteRecord('pessoas', person.id);
  }
}

async function clearLegacyEpcStore() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  let deleted = 0;
  for (const store of stores) {
    const response = await fetch(`${baseUrl}/rest/v1/epc_store?store=eq.${encodeURIComponent(store)}`, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=representation',
      },
    });
    if (response.status === 404) return { deleted, skipped: 'epc_store ausente' };
    if (!response.ok) throw new Error(`Falha ao limpar epc_store (${response.status}): ${await response.text()}`);
    const rows = await response.json().catch(() => []);
    deleted += Array.isArray(rows) ? rows.length : 0;
  }
  return { deleted };
}

function deleteLocalJson() {
  if (!fs.existsSync(databaseFile)) return false;
  fs.unlinkSync(databaseFile);
  return true;
}

async function main() {
  const connection = await checkDatabaseConnection();
  if (connection.database !== 'supabase-relational') {
    throw new Error(`Conexao inesperada: ${JSON.stringify(connection)}`);
  }

  await cleanupPreviousSimulation();

  const retreat = createRetreat();
  await saveRecord('retiros', retreat);

  const people = [];
  const couples = [];
  const enrolments = [];
  const students = [];
  const communities = [];

  let personIndex = 1;
  for (let index = 0; index < 40; index += 1) {
    const casalId = uuid();
    const first = createPerson(personIndex, 'Masculino');
    personIndex += 1;
    const second = createPerson(personIndex, 'Feminino');
    personIndex += 1;
    const sharedAddress = address(index);
    Object.assign(first, sharedAddress);
    Object.assign(second, sharedAddress);
    couples.push({ id: casalId, retiroId: retreat.id, nome: `${first.nome} e ${second.nome}`, simulation: marker });
    people.push(first, second);
    enrolments.push(createEnrolment(retreat, first, enrolments.length, pick(sectors, index), casalId, 'Primeira pessoa'));
    enrolments.push(createEnrolment(retreat, second, enrolments.length, pick(sectors, index + 4), casalId, 'Segunda pessoa'));
  }

  while (enrolments.length < 190) {
    const gender = personIndex % 2 === 0 ? 'Masculino' : 'Feminino';
    const person = createPerson(personIndex, gender);
    people.push(person);
    enrolments.push(createEnrolment(retreat, person, enrolments.length, pick(sectors, personIndex + 2)));
    personIndex += 1;
  }

  for (let index = 0; index < 60; index += 1) students.push(createStudent(retreat, index));

  for (const couple of couples) await saveRecord('casais', couple);
  for (const person of people) await saveRecord('pessoas', person);
  for (const enrolment of enrolments) await saveRecord('adesoes', enrolment);
  for (const student of students) await saveRecord('cursistas', student);

  const leaderCouples = couples.slice(0, 10);
  for (let index = 0; index < 10; index += 1) {
    communities.push({
      id: uuid(),
      retiroId: retreat.id,
      nome: `Comunidade ${index + 1}`,
      liderCasalId: leaderCouples[index]?.id || '',
      monitorCasalId: leaderCouples[(index + 3) % leaderCouples.length]?.id || '',
      monitorIds: [],
      membroIds: students.slice(index * 6, index * 6 + 6).map((student) => student.id),
      ordem: index + 1,
      simulation: marker,
      criadoEm: now,
    });
  }
  for (const community of communities) await saveRecord('comunidades', community);

  await saveRecord('crachas', {
    id: uuid(),
    retiroId: retreat.id,
    name: 'Cracha Simulado - Padrao',
    settings: { accent: '#2f855a', showSector: true, showCommunity: true },
    simulation: marker,
    createdAt: now,
    updatedAt: now,
  });

  await saveRecord('configuracoes', {
    id: `quadrante:${marker}`,
    setores: sectors,
    simulation: marker,
    updatedAt: now,
  });

  const legacy = args.has('--clear-legacy-json') ? await clearLegacyEpcStore() : { skipped: 'use --clear-legacy-json para limpar epc_store' };
  const localJsonDeleted = args.has('--delete-local-json') ? deleteLocalJson() : false;

  const [savedRetreats, savedEnrolments, savedStudents] = await Promise.all([
    listRecords('retiros'),
    listRecords('adesoes'),
    listRecords('cursistas'),
  ]);
  const savedRetreat = savedRetreats.find((item) => item.id === retreat.id);
  const simulationEnrolments = savedEnrolments.filter((item) => item.retiroId === retreat.id);
  const simulationStudents = savedStudents.filter((item) => item.retiroId === retreat.id);

  if (!savedRetreat || simulationEnrolments.length !== 190 || simulationStudents.length !== 60) {
    throw new Error(`Contagem inesperada: adesoes=${simulationEnrolments.length}, cursistas=${simulationStudents.length}`);
  }

  console.log(JSON.stringify({
    ok: true,
    database: connection.database,
    retiro: savedRetreat.nome,
    retiroId: savedRetreat.id,
    pessoasEquipe: people.length,
    casais: couples.length,
    adesoes: simulationEnrolments.length,
    adesoesConfirmadas: simulationEnrolments.filter((item) => item.status === 'confirmada').length,
    adesoesPendentes: simulationEnrolments.filter((item) => item.status !== 'confirmada').length,
    cursistas: simulationStudents.length,
    comunidades: communities.length,
    legacyEpcStore: legacy,
    localJsonDeleted,
    simulation: marker,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
