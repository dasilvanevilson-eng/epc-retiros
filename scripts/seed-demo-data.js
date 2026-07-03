const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const root = path.join(__dirname, '..');
const databaseDir = path.join(root, 'database');
const databaseFile = path.join(databaseDir, 'db.json');

const sectors = [
  'Animação',
  'Camareiros(as)',
  'Casal Bem-estar',
  'Coordenação do retiro',
  'Coordenação geral',
  'Cozinha',
  'Data Show',
  'Enfermaria',
  'Espaço Kids',
  'Espiritual',
  'Externo',
  'Folclore',
  'Jovem de sala',
  'Ligação',
  'Monitores',
  'Recreação',
  'Refeitório',
  'Secretaria',
  'Tios de comunidade',
  'Zeladoria',
];

const firstNamesMale = ['Andre', 'Bruno', 'Carlos', 'Daniel', 'Eduardo', 'Felipe', 'Gabriel', 'Henrique', 'Joao', 'Lucas', 'Marcos', 'Mateus', 'Paulo', 'Rafael', 'Thiago', 'Vinicius'];
const firstNamesFemale = ['Ana', 'Beatriz', 'Camila', 'Daniela', 'Fernanda', 'Gabriela', 'Isabela', 'Juliana', 'Larissa', 'Mariana', 'Natalia', 'Patricia', 'Renata', 'Sofia', 'Tatiana', 'Viviane'];
const lastNames = ['Almeida', 'Barbosa', 'Carvalho', 'Costa', 'Ferreira', 'Lima', 'Martins', 'Mendes', 'Oliveira', 'Pereira', 'Ribeiro', 'Rocha', 'Santos', 'Silva', 'Souza', 'Teixeira'];
const streets = ['Rua das Flores', 'Rua Sao Jose', 'Avenida Brasil', 'Rua Santa Rita', 'Rua do Rosario', 'Avenida Central', 'Rua Padre Cicero', 'Rua Nossa Senhora Aparecida'];
const neighborhoods = ['Centro', 'Jardim America', 'Vila Nova', 'Santa Luzia', 'Sao Francisco', 'Boa Vista'];
const cities = ['Sao Paulo', 'Campinas', 'Santo Andre', 'Guarulhos', 'Sorocaba'];
const retreatsDone = ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'];
const shirtSizes = ['P', 'M', 'G', 'GG'];

const pick = (items, index) => items[index % items.length];
const phone = (index) => `(11) 9${String(7000 + index).padStart(4, '0')}-${String(1000 + index).padStart(4, '0')}`;
const birthDate = (startYear, index) => `${startYear + (index % 30)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`;
const normalizedName = (name) => name.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
const now = new Date().toISOString();

function personName(index, gender, suffix = '') {
  const first = gender === 'Masculino' ? pick(firstNamesMale, index) : pick(firstNamesFemale, index);
  return `${first} ${pick(lastNames, index)} ${pick(lastNames, index + 5)}${suffix}`;
}

function address(index) {
  return {
    endereco: pick(streets, index),
    numero: String(100 + index),
    bairro: pick(neighborhoods, index),
    cep: `${String(13000 + index).padStart(5, '0')}-${String(100 + index).padStart(3, '0')}`,
    cidade: pick(cities, index),
    estado: 'SP',
  };
}

function createPerson(index, gender, name) {
  const fullName = name || personName(index, gender);
  return {
    id: randomUUID(),
    nome: fullName,
    nomeNormalizado: normalizedName(fullName),
    nascimento: birthDate(1965, index),
    genero: gender,
    telefone: phone(index),
    ...address(index),
    createdAt: now,
    updatedAt: now,
  };
}

function createEnrolment(retreatId, person, index, sector, casalId = null, papelNoCasal = 'Individual') {
  const daysOptions = [['Sexta-feira', 'Sábado', 'Domingo'], ['Sábado', 'Domingo'], ['Sexta-feira', 'Sábado']];
  return {
    id: randomUUID(),
    retiroId: retreatId,
    pessoaId: person.id,
    nome: person.nome,
    dias: pick(daysOptions, index),
    setores: [sector],
    retirosAnteriores: [pick(retreatsDone, index), pick(retreatsDone, index + 3)],
    quadrante: index % 4 === 0 ? 'Não' : 'Sim',
    foto: index % 3 === 0 ? 'Não' : 'Sim',
    contribuicao: index % 2 === 0
      ? 'R$ 60,00 se o voluntário for o único da família'
      : 'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro',
    coordenacao: '',
    espacoKids: [],
    observacao: '',
    tipoFicha: casalId ? 'Casal' : 'Individual',
    casalId,
    papelNoCasal,
    status: 'confirmada',
    enviadoEm: now,
    atualizadoEm: now,
  };
}

function createStudent(retreatId, index) {
  const gender = index % 2 === 0 ? 'Masculino' : 'Feminino';
  const nome = personName(index + 200, gender, ' Cursista');
  return {
    id: randomUUID(),
    retiroId: retreatId,
    nome,
    nascimento: birthDate(2007, index),
    telefone: phone(index + 300),
    cep: `${String(14000 + index).padStart(5, '0')}-${String(200 + index).padStart(3, '0')}`,
    rua: pick(streets, index + 2),
    numero: String(40 + index),
    bairro: pick(neighborhoods, index + 1),
    cidade: pick(cities, index + 1),
    estado: 'SP',
    batizado: 'Sim',
    primeiraComunhao: index % 5 === 0 ? 'Não' : 'Sim',
    estuda: 'Sim',
    serie: `${6 + (index % 7)} ano`,
    escola: `Escola ${pick(lastNames, index)}`,
    fezRetiro: index % 4 === 0 ? 'Sim' : 'Não',
    qualRetiro: index % 4 === 0 ? pick(retreatsDone, index) : '',
    nomePai: personName(index + 400, 'Masculino'),
    telefonePai: phone(index + 400),
    nomeMae: personName(index + 500, 'Feminino'),
    telefoneMae: phone(index + 500),
    paisMovimento: index % 3 === 0 ? 'Sim' : 'Não',
    qualMovimento: index % 3 === 0 ? 'EPC' : '',
    convidou: personName(index + 30, index % 2 === 0 ? 'Feminino' : 'Masculino'),
    camiseta: pick(shirtSizes, index),
    camisetaOutro: '',
    intoleranciaAlimentos: index % 8 === 0 ? 'Sim' : 'Não',
    qualIntolerancia: index % 8 === 0 ? 'Lactose' : '',
    alergiaMedicamento: index % 10 === 0 ? 'Sim' : 'Não',
    qualAlergia: index % 10 === 0 ? 'Dipirona' : '',
    medicamentoCabeca: 'Paracetamol',
    medicamentoEstomago: 'Buscopan',
    valorInscricao: 'R$ 180,00',
    valorPago: index % 4 === 0 ? 'R$ 90,00' : 'R$ 180,00',
    saldoPagar: index % 4 === 0 ? 'R$ 90,00' : 'R$ 0,00',
    criadoEm: now,
  };
}

function createCouple(retreatId, startIndex, sector, label) {
  const casalId = randomUUID();
  const husband = createPerson(startIndex, 'Masculino', personName(startIndex, 'Masculino', ` ${label}`));
  const wife = createPerson(startIndex + 1, 'Feminino', personName(startIndex + 1, 'Feminino', ` ${label}`));
  const sharedAddress = address(startIndex);
  Object.assign(husband, sharedAddress);
  Object.assign(wife, sharedAddress);
  return {
    people: [husband, wife],
    enrolments: [
      createEnrolment(retreatId, husband, startIndex, sector, casalId, 'Primeira pessoa'),
      createEnrolment(retreatId, wife, startIndex + 1, sector, casalId, 'Segunda pessoa'),
    ],
  };
}

function seed() {
  fs.mkdirSync(databaseDir, { recursive: true });
  const existing = fs.existsSync(databaseFile) ? JSON.parse(fs.readFileSync(databaseFile, 'utf8') || '{}') : {};
  const hasExistingData = ['retiros', 'pessoas', 'adesoes', 'cursistas', 'comunidades'].some((store) => existing[store]?.length);
  if (hasExistingData) {
    const backupFile = path.join(databaseDir, `db.backup-${Date.now()}.json`);
    fs.copyFileSync(databaseFile, backupFile);
    console.log(`Backup criado em ${path.relative(root, backupFile)}`);
  }

  const retreatId = randomUUID();
  const people = [];
  const adesoes = [];
  const cursistas = [];

  for (let index = 0; index < 7; index += 1) {
    const couple = createCouple(retreatId, index * 2, 'Tios de comunidade', 'Tios');
    people.push(...couple.people);
    adesoes.push(...couple.enrolments);
  }

  for (let index = 0; index < 7; index += 1) {
    const couple = createCouple(retreatId, 100 + index * 2, 'Monitores', 'Monitor');
    people.push(...couple.people);
    adesoes.push(...couple.enrolments);
  }

  const remainingWorkers = 150 - people.length;
  const regularSectors = sectors.filter((sector) => !['Tios de comunidade', 'Monitores'].includes(sector));
  for (let index = 0; index < remainingWorkers; index += 1) {
    const gender = index % 2 === 0 ? 'Masculino' : 'Feminino';
    const person = createPerson(200 + index, gender);
    people.push(person);
    adesoes.push(createEnrolment(retreatId, person, 200 + index, pick(regularSectors, index)));
  }

  for (let index = 0; index < 50; index += 1) {
    cursistas.push(createStudent(retreatId, index));
  }

  const database = {
    retiros: [{
      id: retreatId,
      nome: 'Retiro Teste - Massa de Dados',
      dataInicio: '2026-07-10',
      dataTermino: '2026-07-12',
      local: 'Casa de Retiros Sao Jose',
      coordenacaoGeral: 'Equipe de Coordenacao Geral',
      coordenacaoRetiro: 'Equipe de Coordenacao do Retiro',
      valorInscricaoCursista: 180,
      valorInscricaoVoluntario: 60,
      setores: [...sectors].sort((first, second) => first.localeCompare(second, 'pt-BR', { sensitivity: 'base' })),
      setoresPublicos: [...sectors].sort((first, second) => first.localeCompare(second, 'pt-BR', { sensitivity: 'base' })),
      ordemQuadrante: [...sectors],
      dias: ['Sexta-feira', 'Sábado', 'Domingo'],
      contribuicoes: [
        'R$ 60,00 se o voluntário for o único da família',
        'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro',
      ],
      status: 'publicado',
      createdAt: now,
    }],
    pessoas: people,
    adesoes,
    casais: [],
    cursistas,
    comunidades: [],
  };

  fs.writeFileSync(databaseFile, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  console.log(`Seed concluido: ${people.length} pessoas, ${adesoes.length} adesoes e ${cursistas.length} cursistas.`);
}

seed();
