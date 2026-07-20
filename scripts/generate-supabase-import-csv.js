const fs = require('fs');
const path = require('path');
const { randomBytes, randomUUID } = require('crypto');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'supabase-import');
const now = new Date().toISOString();
const marker = 'simulacao_girassol_2026_csv';
const publicToken = () => randomBytes(24).toString('hex');

const cities = [
  { cidade: 'Timbo', cep: '89120-000' },
  { cidade: 'Indaial', cep: '89130-000' },
  { cidade: 'Blumenau', cep: '89010-000' },
  { cidade: 'Rio dos Cedros', cep: '89121-000' },
];
const neighborhoods = ['Centro', 'Estados', 'Nacoes', 'Quintino', 'Das Capitais', 'Padre Martinho', 'Encano', 'Divineia'];
const streets = ['Rua das Flores', 'Rua Santa Catarina', 'Rua Sao Jose', 'Rua das Palmeiras', 'Avenida Central', 'Rua Pomerode', 'Rua da Igreja', 'Rua Sete de Setembro'];
const maleKids = ['Arthur', 'Bernardo', 'Davi', 'Enzo', 'Felipe', 'Gabriel', 'Heitor', 'Joao', 'Lorenzo', 'Miguel', 'Nicolas', 'Pedro', 'Rafael', 'Theo', 'Vitor'];
const femaleKids = ['Alice', 'Ana', 'Beatriz', 'Clara', 'Helena', 'Isabela', 'Julia', 'Laura', 'Livia', 'Luiza', 'Manuela', 'Maria', 'Sofia', 'Valentina', 'Yasmin'];
const adultMale = ['Adriano', 'Bruno', 'Carlos', 'Daniel', 'Eduardo', 'Fabio', 'Gustavo', 'Henrique', 'Leandro', 'Marcelo', 'Paulo', 'Rafael', 'Rodrigo', 'Tiago', 'Vinicius'];
const adultFemale = ['Aline', 'Camila', 'Daniela', 'Eliane', 'Fernanda', 'Gabriela', 'Juliana', 'Karina', 'Luciana', 'Mariana', 'Patricia', 'Renata', 'Simone', 'Tatiane', 'Vanessa'];
const lastNames = ['Almeida', 'Bauer', 'Cardoso', 'Costa', 'Fischer', 'Freitas', 'Goncalves', 'Krause', 'Lima', 'Muller', 'Oliveira', 'Pereira', 'Ribeiro', 'Schmidt', 'Silva', 'Souza', 'Weber'];
const retreatsDone = ['Girassol', 'Onda', 'EPC', 'EJA', 'EJU', 'Taschinha', 'Eis-me aqui'];
const shirtSizes = ['8', '10', '12', '14', 'PP', 'P', 'M', 'G'];
const sectors = ['Animacao/Jovem de sala', 'Camareiros(as)', 'Casal Bem-estar', 'Coordenacao do retiro', 'Coordenacao geral', 'Cozinha', 'Data Show', 'Direcao Espiritual', 'Enfermaria', 'Espaco Kids', 'Espiritual', 'Externo', 'Folclore', 'Ligacao', 'Participacoes especiais', 'Recreacao', 'Refeitorio', 'Secretaria', 'Zeladoria']
  .sort((first, second) => first.localeCompare(second, 'pt-BR', { sensitivity: 'base' }));

const pick = (items, index) => items[index % items.length];
const normalizeName = (name) => name.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const phone = (index) => `(47) 9${String(7100 + index).padStart(4, '0')}-${String(1000 + index).padStart(4, '0')}`;
const birthDate = (year, index) => `${year}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`;
const fullName = (firstNames, index, suffix = '') => `${pick(firstNames, index)} ${pick(lastNames, index)} ${pick(lastNames, index + 7)}${suffix}`;

function cpfFromIndex(index) {
  const base = String(910000000 + index).padStart(9, '0').slice(0, 9);
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
    numero: String(80 + index),
    bairro: pick(neighborhoods, index),
    cep: city.cep,
    cidade: city.cidade,
    estado: 'SC',
  };
}

function personalDataSnapshot(person) {
  return {
    cpf: person.cpf || person.id,
    nome: person.nome,
    nascimento: person.nascimento,
    genero: person.genero,
    telefone: person.telefone,
    endereco: person.endereco,
    numero: person.numero,
    bairro: person.bairro,
    cidade: person.cidade,
    estado: person.estado,
    cep: person.cep,
  };
}

function createPerson(index, gender, name, birthYear) {
  const cpf = cpfFromIndex(index);
  return {
    id: cpf,
    cpf,
    nome: name,
    nomeNormalizado: normalizeName(name),
    nascimento: birthDate(birthYear, index),
    genero: gender,
    telefone: phone(index),
    ...address(index),
    simulation: marker,
    createdAt: now,
    updatedAt: now,
  };
}

function createKids(parentIndex) {
  const count = parentIndex % 3 === 0 ? 2 : 1;
  return Array.from({ length: count }, (_, offset) => {
    const gender = (parentIndex + offset) % 2 === 0 ? 'Masculino' : 'Feminino';
    return {
      nome: fullName(gender === 'Masculino' ? maleKids : femaleKids, parentIndex + offset, ' Kids'),
      nascimento: birthDate(2020 + ((parentIndex + offset) % 5), parentIndex + offset),
    };
  });
}

function createEnrolment(retreat, person, index, sector, casalId = null, papelNoCasal = '', forcedValidated = null) {
  const validated = forcedValidated ?? index % 5 !== 0;
  const amount = Number(retreat.valorInscricaoVoluntario) || 60;
  const hasKids = index % 4 === 0;
  return {
    id: randomUUID(),
    retiroId: retreat.id,
    pessoaId: person.id,
    nome: person.nome,
    dadosPessoais: personalDataSnapshot(person),
    dias: index % 6 === 0 ? ['Sábado', 'Domingo'] : ['Sexta-feira', 'Sábado', 'Domingo'],
    setores: [sector],
    retirosAnteriores: index % 4 === 0 ? [] : [pick(retreatsDone, index), pick(retreatsDone, index + 2)],
    quadrante: index % 7 === 0 ? 'Nao' : 'Sim',
    foto: index % 3 === 0 ? 'Nao' : 'Sim',
    contribuicao: money(amount),
    coordenacao: index % 13 === 0 ? 'Coordenador auxiliar' : '',
    coordenacaoSetor: '',
    espacoKids: hasKids ? createKids(index) : [],
    espacoKidsNaoNecessito: !hasKids,
    observacao: hasKids ? 'Registro ficticio com crianca no Espaco Kids.' : 'Registro ficticio para teste.',
    tipoFicha: casalId ? 'Casal' : 'Individual',
    casalId,
    papelNoCasal: papelNoCasal || null,
    status: validated ? 'confirmada' : 'pendente_validacao',
    validada: validated,
    validadoEm: validated ? now : '',
    taxaPaga: validated && index % 3 !== 0,
    valorPago: validated && index % 3 !== 0 ? amount : 0,
    simulation: marker,
    enviadoEm: now,
    atualizadoEm: now,
  };
}

function createStudent(retreat, index) {
  const gender = index % 2 === 0 ? 'Masculino' : 'Feminino';
  const cpf = cpfFromIndex(5000 + index);
  const value = Number(retreat.valorInscricaoCursista) || 180;
  const paid = index % 5 === 0 ? value / 2 : value;
  return {
    id: cpf,
    cpf,
    retiroId: retreat.id,
    nome: fullName(gender === 'Masculino' ? maleKids : femaleKids, index, ' Cursista'),
    nascimento: birthDate(2016 + (index % 3), index),
    genero: gender,
    telefone: phone(500 + index),
    ...address(index),
    batizado: index % 6 === 0 ? 'Nao' : 'Sim',
    primeiraComunhao: index % 4 === 0 ? 'Nao' : 'Sim',
    estuda: 'Sim',
    serie: `${3 + (index % 3)} ano`,
    escola: `Escola ${pick(lastNames, index)} ${pick(cities, index).cidade}`,
    fezRetiro: index % 7 === 0 ? 'Sim' : 'Nao',
    qualRetiro: index % 7 === 0 ? pick(retreatsDone, index) : '',
    nomePai: fullName(adultMale, index + 40),
    telefonePai: phone(700 + index),
    nomeMae: fullName(adultFemale, index + 50),
    telefoneMae: phone(800 + index),
    paisMovimento: index % 3 === 0 ? 'Sim' : 'Nao',
    qualMovimento: index % 3 === 0 ? 'EPC' : '',
    convidou: fullName(index % 2 === 0 ? adultFemale : adultMale, index + 90),
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
    simulation: marker,
    criadoEm: now,
    atualizadoEm: now,
  };
}

function createRetreat() {
  return {
    id: 'girassol-2026-teste',
    nome: 'Girassol 2026',
    dataInicio: '2026-07-10',
    dataTermino: '2026-07-12',
    local: 'Casa de Retiros - Vale Europeu',
    coordenacaoGeral: 'Coordenacao Geral Teste',
    coordenacaoRetiro: 'Coordenacao Girassol 2026',
    valorInscricaoCursista: 180,
    valorInscricaoVoluntario: 60,
    valorFoto: 10,
    setores: sectors,
    setoresPublicos: sectors,
    ordemQuadrante: sectors,
    dias: ['Sexta-feira', 'Sábado', 'Domingo'],
    contribuicoes: ['R$ 60,00 se o voluntario for o unico da familia', 'R$ 55,00 se o voluntario tiver mais pessoas da mesma familia trabalhando no retiro'],
    linksSetores: sectors.map((setor) => ({ setor, token: publicToken(), cadastroToken: publicToken(), acompanhamentoToken: publicToken() })),
    status: 'publicado',
    simulation: marker,
    createdAt: now,
    updatedAt: now,
  };
}

function csvValue(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function epcRow(store, record) {
  return [csvValue(store), csvValue(record.id), csvValue(JSON.stringify(record))].join(',');
}

function buildRecords() {
  const retreat = createRetreat();
  const people = [];
  const enrolments = [];
  const students = [];
  const workerSectors = sectors.filter((sector) => !/coordenacao geral/i.test(sector));

  let personIndex = 1000;
  for (let coupleIndex = 0; coupleIndex < 50; coupleIndex += 1) {
    const casalId = randomUUID();
    const sharedAddress = address(coupleIndex);
    const first = createPerson(personIndex, 'Masculino', fullName(adultMale, personIndex, ' Teste'), 1968 + (coupleIndex % 24));
    personIndex += 1;
    const second = createPerson(personIndex, 'Feminino', fullName(adultFemale, personIndex, ' Teste'), 1968 + (coupleIndex % 24));
    personIndex += 1;
    Object.assign(first, sharedAddress);
    Object.assign(second, sharedAddress);
    people.push(first, second);
    const coupleSector = pick(workerSectors, coupleIndex);
    const coupleValidated = coupleIndex % 5 !== 0;
    enrolments.push(
      createEnrolment(retreat, first, coupleIndex * 2, coupleSector, casalId, 'Primeira pessoa', coupleValidated),
      createEnrolment(retreat, second, coupleIndex * 2 + 1, coupleSector, casalId, 'Segunda pessoa', coupleValidated),
    );
  }

  for (let index = 0; index < 80; index += 1) {
    const gender = index % 2 === 0 ? 'Masculino' : 'Feminino';
    const name = fullName(gender === 'Masculino' ? adultMale : adultFemale, personIndex, ' Teste');
    const person = createPerson(personIndex, gender, name, 1965 + (index % 28));
    people.push(person);
    enrolments.push(createEnrolment(retreat, person, 100 + index, pick(workerSectors, index + 5)));
    personIndex += 1;
  }

  for (let index = 0; index < 50; index += 1) students.push(createStudent(retreat, index));

  return { retreat, people, enrolments, students };
}

function writeFiles() {
  const { retreat, people, enrolments, students } = buildRecords();
  const rows = [
    'store,id,data',
    epcRow('retiros', retreat),
    ...people.map((person) => epcRow('pessoas', person)),
    ...enrolments.map((enrolment) => epcRow('adesoes', enrolment)),
    ...students.map((student) => epcRow('cursistas', student)),
  ];
  const summary = {
    arquivo: 'epc_store_girassol_2026.csv',
    retiro: retreat.nome,
    retiroId: retreat.id,
    pessoasEquipe: people.length,
    adesoesEquipe: enrolments.length,
    equipeValidada: enrolments.filter((entry) => entry.validada).length,
    equipeAValidar: enrolments.filter((entry) => !entry.validada).length,
    cursistas: students.length,
    totalLinhasImportacao: rows.length - 1,
    simulation: marker,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'epc_store_girassol_2026.csv'), `${rows.join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'epc_store_girassol_2026_resumo.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'LEIA-ME-importacao-girassol-2026.txt'), [
    'Importacao no Supabase',
    '',
    '1. Abra o Supabase > Table Editor > epc_store.',
    '2. Use Import data from CSV.',
    '3. Selecione epc_store_girassol_2026.csv.',
    '4. Confira as colunas: store, id, data.',
    '5. Importe. created_at e updated_at serao preenchidos pelo banco.',
    '',
    'Observacao: se houver conflito com registros existentes de mesmo store/id, apague esses registros de teste antes ou use upsert/import equivalente.',
  ].join('\n'), 'utf8');

  console.log(JSON.stringify(summary, null, 2));
}

writeFiles();
