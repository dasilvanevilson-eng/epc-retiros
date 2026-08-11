const assert = require('assert');
const { buildIntoleranceRows, buildKidsIntoleranceRows, buildKidsRegisteredRows, sectorPageHtml, supportsIntoleranceView, supportsKidsIntoleranceView, supportsKidsRegisteredView } = require('../publicSectorPage');

assert.strictEqual(supportsIntoleranceView('Animação/Jovem de sala'), true);
assert.strictEqual(supportsIntoleranceView('ANIMACAO/JOVEM DE SALA'), true);
assert.strictEqual(supportsIntoleranceView('Cozinha'), true);
assert.strictEqual(supportsIntoleranceView('Secretaria'), false);
assert.strictEqual(supportsKidsIntoleranceView('COZINHA'), true);
assert.strictEqual(supportsKidsIntoleranceView('Espaço Kids'), true);
assert.strictEqual(supportsKidsIntoleranceView('ESPACO KIDS'), true);
assert.strictEqual(supportsKidsIntoleranceView('Animação/Jovem de sala'), false);
assert.strictEqual(supportsKidsIntoleranceView('Secretaria'), false);
assert.strictEqual(supportsKidsRegisteredView('Espaço Kids'), true);
assert.strictEqual(supportsKidsRegisteredView('ESPACO KIDS'), true);
assert.strictEqual(supportsKidsRegisteredView('Cozinha'), false);
assert.strictEqual(supportsKidsRegisteredView('Secretaria'), false);

const communities = [
  { id: 'c1', retiroId: 'r-ind', nome: 'Comunidade Verde', membroIds: ['i1'] },
  { id: 'c2', retiroId: 'r-smp', nome: 'Comunidade Azul', membroSmpIds: ['12'] },
  { id: 'c3', retiroId: 'r-epc', nome: 'Comunidade Dourada', membroEpcIds: ['7'] },
];

const individualRows = buildIntoleranceRows({
  retreat: { id: 'r-ind', tipoFichaCursista: 'cursista-individual' },
  communities,
  individualStudents: [
    { id: 'i1', retiroId: 'r-ind', nome: 'Bruna', cpf: '11111111111', telefone: '47999999999', endereco: 'Rua secreta', intoleranciaAlimentos: 'Sim', qualIntolerancia: 'Lactose' },
    { id: 'i2', retiroId: 'r-ind', nome: 'Ana', intoleranciaAlimentos: 'Não', qualIntolerancia: 'Glúten' },
    { id: 'i3', retiroId: 'r-ind', nome: 'Carlos', intoleranciaAlimentos: 'Não', qualIntolerancia: '' },
  ],
});
assert.deepStrictEqual(individualRows, [
  { name: 'Ana', community: 'Sem comunidade', intolerance: 'Glúten' },
  { name: 'Bruna', community: 'Comunidade Verde', intolerance: 'Lactose' },
]);

const smpRows = buildIntoleranceRows({
  retreat: { id: 'r-smp', tipoFichaCursista: 'cursista-smp' },
  communities,
  smpStudents: [{
    id: '12', retiroId: 'r-smp', nomeDele: 'Daniel', nomeDela: 'Carla',
    intoleranciaAlimentarDele: 'Sim', qualIntoleranciaAlimentarDele: 'Amendoim',
    intoleranciaAlimentarDela: 'Não', qualIntoleranciaAlimentarDela: '',
    smpKidNome1: 'Criança privada', smpKidIntolerancia1: 'Sim', smpKidDescricaoIntolerancia1: 'Ovo',
  }],
});
assert.deepStrictEqual(smpRows, [{ name: 'Daniel', community: 'Comunidade Azul', intolerance: 'Amendoim' }]);
assert(!JSON.stringify(smpRows).includes('Criança privada'));

const epcRows = buildIntoleranceRows({
  retreat: { id: 'r-epc', tipoFichaCursista: 'cursista-epc' },
  communities,
  smpStudents: [{ id: '7', retiroId: 'r-epc', nomeDele: 'Origem errada', intoleranciaAlimentarDele: 'Sim', qualIntoleranciaAlimentarDele: 'Soja' }],
  epcStudents: [{ id: '7', retiroId: 'r-epc', nomeDele: 'Eduardo', nomeDela: 'Fernanda', intoleranciaAlimentarDele: 'Sim', qualIntoleranciaAlimentarDele: '', intoleranciaAlimentarDela: 'Sim', qualIntoleranciaAlimentarDela: 'Frutos do mar' }],
});
assert.deepStrictEqual(epcRows, [
  { name: 'Eduardo', community: 'Comunidade Dourada', intolerance: 'Intolerância não detalhada' },
  { name: 'Fernanda', community: 'Comunidade Dourada', intolerance: 'Frutos do mar' },
]);

const kidsRows = buildKidsIntoleranceRows({
  retreat: { id: 'r-smp', tipoFichaCursista: 'cursista-smp' },
  communities,
  entries: [{
    id: 'a1', retiroId: 'r-smp', casalId: 'casal-1', nome: 'Responsável A', setores: ['Cozinha', 'Secretaria'],
    espacoKids: [{ nome: 'Criança Equipe', nascimento: '2020-01-10', intoleranciaAlimentar: 'Sim', descricaoIntolerancia: 'Leite' }],
  }, {
    id: 'a2', retiroId: 'r-smp', casalId: 'casal-1', nome: 'Responsável B', setores: ['Secretaria', 'Recepção'],
    espacoKids: [{ nome: 'Criança Equipe', nascimento: '2020-01-10', intoleranciaAlimentar: 'Sim', descricaoIntolerancia: 'Leite' }],
  }, {
    id: 'a3', retiroId: 'r-smp', nome: 'Responsável Individual', setores: ['Espaço Kids'],
    espacoKids: [{ nome: 'Criança Descrição', nascimento: '2021-03-12', intoleranciaAlimentar: 'Não', descricaoIntolerancia: 'Corante' }],
  }, {
    id: 'fora', retiroId: 'outro-retiro', nome: 'Fora do retiro', setores: ['Cozinha'],
    espacoKids: [{ nome: 'Criança fora', nascimento: '2022-01-01', intoleranciaAlimentar: 'Sim', descricaoIntolerancia: 'Soja' }],
  }],
  smpStudents: [{
    id: '12', retiroId: 'r-smp', nomeDele: 'Daniel', nomeDela: 'Carla',
    smpKidNome1: 'Criança Equipe', smpKidNascimento1: '2020-01-10', smpKidIntolerancia1: 'Sim', smpKidDescricaoIntolerancia1: 'Ovo',
  }, {
    id: '13', retiroId: 'r-smp', smpKidsNotNeeded: true,
    smpKidNome1: 'Dado antigo ignorado', smpKidNascimento1: '2019-01-01', smpKidIntolerancia1: 'Sim', smpKidDescricaoIntolerancia1: 'Trigo',
  }],
});
assert.strictEqual(kidsRows.length, 3, 'Casal da Equipe deve ser deduplicado, mas a mesma criança em outra origem deve contar novamente.');
assert.strictEqual(kidsRows.filter((kid) => kid.name === 'Criança Equipe').length, 2);
const teamCoupleKid = kidsRows.find((kid) => kid.name === 'Criança Equipe' && kid.origin === 'Equipe de trabalho');
assert.strictEqual(teamCoupleKid.responsible, 'Responsável A e Responsável B');
assert.strictEqual(teamCoupleKid.contextValue, 'Cozinha, Secretaria, Recepção');
const studentKid = kidsRows.find((kid) => kid.origin === 'Cursista');
assert.strictEqual(studentKid.contextValue, 'Comunidade Azul');
assert.strictEqual(studentKid.intolerance, 'Ovo');
assert(!JSON.stringify(kidsRows).includes('Dado antigo ignorado'));
assert(!JSON.stringify(kidsRows).includes('Criança fora'));

const registeredKidsRows = buildKidsRegisteredRows({
  retreat: { id: 'r-smp', tipoFichaCursista: 'cursista-smp' },
  communities,
  people: [{ id: 'p1', nome: 'Responsável A', telefone: '(47) 99999-0000' }],
  entries: [{
    id: 'a1', pessoaId: 'p1', retiroId: 'r-smp', casalId: 'casal-1', papelNoCasal: 'Primeira pessoa', nome: 'Responsável A', setores: ['Cozinha'],
    espacoKids: [{ nome: 'Criança Equipe', nascimento: '2020-01-10' }],
  }, {
    id: 'a2', pessoaId: 'p2', retiroId: 'r-smp', casalId: 'casal-1', nome: 'Responsável B', setores: ['Secretaria'],
    espacoKids: [{ nome: 'Criança Equipe', nascimento: '2020-01-10' }],
  }, {
    id: 'a3-old', pessoaId: 'p3', retiroId: 'r-smp', nome: 'Responsável Individual', setores: ['Recepção'], criadoEm: '2026-01-01T10:00:00Z',
    espacoKids: [{ nome: 'Criança Histórica', nascimento: '2021-02-01' }],
  }, {
    id: 'a3-new', pessoaId: 'p3', retiroId: 'r-smp', nome: 'Responsável Individual', setores: ['Espaço Kids'], criadoEm: '2026-02-01T10:00:00Z',
    espacoKids: [{ nome: 'Criança Atual', nascimento: '2022-02-01' }],
  }, {
    id: 'fora', pessoaId: 'p4', retiroId: 'outro-retiro', nome: 'Fora', setores: ['Espaço Kids'],
    espacoKids: [{ nome: 'Criança fora', nascimento: '2023-01-01' }],
  }],
  smpStudents: [{
    id: '12', retiroId: 'r-smp', nomeDele: 'Daniel', nomeDela: 'Carla',
    smpKidNome1: 'Criança Cursista', smpKidNascimento1: '2019-03-01',
  }, {
    id: '13', retiroId: 'r-smp', smpKidsNotNeeded: true,
    smpKidNome1: 'Dado antigo ignorado', smpKidNascimento1: '2018-01-01',
  }],
});
assert.strictEqual(registeredKidsRows.length, 4, 'A lista deve reunir Equipe e Cursistas, preservando crianças históricas de adesões mescladas.');
assert.deepStrictEqual(registeredKidsRows.map((kid) => kid.name), ['Criança Atual', 'Criança Histórica', 'Criança Equipe', 'Criança Cursista']);
const registeredTeamKid = registeredKidsRows.find((kid) => kid.name === 'Criança Equipe');
assert.strictEqual(registeredTeamKid.responsible, 'Responsável A e Responsável B');
assert.strictEqual(registeredTeamKid.contact, '(47) 99999-0000');
assert.strictEqual(registeredTeamKid.contextValue, 'Cozinha, Secretaria');
const registeredStudentKid = registeredKidsRows.find((kid) => kid.origin === 'Cursista');
assert.strictEqual(registeredStudentKid.responsible, 'Daniel e Carla');
assert.strictEqual(registeredStudentKid.contextValue, 'Comunidade Azul');
assert(!JSON.stringify(registeredKidsRows).includes('Dado antigo ignorado'));
assert(!JSON.stringify(registeredKidsRows).includes('Criança fora'));

const epcKidsRows = buildKidsIntoleranceRows({
  retreat: { id: 'r-epc', tipoFichaCursista: 'cursista-epc' },
  communities,
  epcStudents: [{ id: '7', retiroId: 'r-epc', nomeDele: 'Eduardo', nomeDela: 'Fernanda', smpKidNome1: 'Criança EPC', smpKidNascimento1: '2019-05-10', smpKidIntolerancia1Epc: 'Sim', smpKidDescricaoIntolerancia1Epc: '' }],
});
assert.strictEqual(epcKidsRows[0].contextValue, 'Comunidade Dourada');
assert.strictEqual(epcKidsRows[0].intolerance, 'Não detalhado');

const epcRegisteredKidsRows = buildKidsRegisteredRows({
  retreat: { id: 'r-epc', tipoFichaCursista: 'cursista-epc' },
  communities,
  epcStudents: [{ id: '7', retiroId: 'r-epc', nomeDele: 'Eduardo', nomeDela: 'Fernanda', smpKidNome1: 'Criança EPC', smpKidNascimento1: '2019-05-10' }],
});
assert.strictEqual(epcRegisteredKidsRows.length, 1, 'A lista completa deve carregar crianças das fichas EPC.');
assert.strictEqual(epcRegisteredKidsRows[0].name, 'Criança EPC');
assert.strictEqual(epcRegisteredKidsRows[0].contextValue, 'Comunidade Dourada');

const eligibleHtml = sectorPageHtml({
  retreat: { id: 'r-ind', nome: 'Retiro teste', dias: ['Sábado'], tipoFichaCursista: 'cursista-individual' },
  sector: 'Cozinha',
  entries: [{ nome: 'Voluntária', dias: ['Sábado'], retirosAnteriores: ['EPC'] }],
  intolerances: individualRows,
  kidsIntolerances: kidsRows,
});
assert.match(eligibleHtml, /sector-tab-entries/);
assert.match(eligibleHtml, /sector-tab-intolerances/);
assert.match(eligibleHtml, /sector-tab-kids-intolerances/);
assert.match(eligibleHtml, /Ades&otilde;es deste setor/);
assert.match(eligibleHtml, /Cursistas com intoler&acirc;ncia alimentar/);
assert.match(eligibleHtml, /Crianças espaço kids com intolerância alimentar/);
assert.match(eligibleHtml, /Responsável A e Responsável B/);
assert.match(eligibleHtml, /Setor de trabalho: Cozinha, Secretaria, Recepção/);
assert.match(eligibleHtml, /Problema descrito: Leite/);
assert.doesNotMatch(eligibleHtml, /Ades&otilde;es do setor|Intoler&acirc;ncias dos cursistas|Intoler&acirc;ncia alimentar dos cursistas/);
assert.match(eligibleHtml, /Comunidade Verde/);
assert.match(eligibleHtml, /Lactose/);
assert.doesNotMatch(eligibleHtml, /11111111111|47999999999|Rua secreta/);
assert.match(eligibleHtml, /printableReports\[activeSectorView\]/);
assert.match(eligibleHtml, /id="close-sector-view"/);
assert.match(eligibleHtml, /if \(history\.length > 1\)[\s\S]*history\.back\(\)/, 'Fechar o acompanhamento deve retornar à rota administrativa preparada no histórico.');
assert.match(eligibleHtml, /'kids-intolerances':/);
assert.match(eligibleHtml, /\.intolerance-public-list li\{display:grid;grid-template-columns:/);
assert.match(eligibleHtml, /\.intolerance-list li\{display:grid;grid-template-columns:/);
assert.match(eligibleHtml, /grid-column:2;grid-row:1 \/ span 2/);
assert.doesNotMatch(eligibleHtml, /id="sector-tab-kids-registered"/, 'Cozinha não deve receber a lista completa de crianças.');

const regularHtml = sectorPageHtml({
  retreat: { id: 'r-ind', nome: 'Retiro teste', dias: ['Sábado'] },
  sector: 'Secretaria',
  entries: [],
});
assert.doesNotMatch(regularHtml, /id="sector-tab-entries"/);
assert.doesNotMatch(regularHtml, /id="sector-view-intolerances"/);
assert.doesNotMatch(regularHtml, /id="sector-view-kids-intolerances"/);

const animationHtml = sectorPageHtml({
  retreat: { id: 'r-ind', nome: 'Retiro teste', dias: ['Sábado'] },
  sector: 'Animação/Jovem de sala',
  entries: [],
});
assert.match(animationHtml, /id="sector-view-intolerances"/);
assert.doesNotMatch(animationHtml, /id="sector-view-kids-intolerances"/);

const kidsSectorHtml = sectorPageHtml({
  retreat: { id: 'r-smp', nome: 'Retiro teste', dias: ['Sábado'], tipoFichaCursista: 'cursista-smp' },
  sector: 'Espaço Kids',
  entries: [],
  kidsIntolerances: kidsRows,
  kidsRegistered: registeredKidsRows,
});
assert.match(kidsSectorHtml, /id="sector-tab-kids-intolerances"/);
assert.match(kidsSectorHtml, />Crianças com intolerância alimentar<\/button>/);
assert((kidsSectorHtml.match(/Crianças com intolerância alimentar/g) || []).length >= 2, 'A impressão deve usar o título específico do Espaço Kids.');
assert.doesNotMatch(kidsSectorHtml, /id="sector-view-intolerances"/);
assert.match(kidsSectorHtml, /id="sector-tab-kids-registered"/);
assert.match(kidsSectorHtml, />Crian&ccedil;as inscritas no espa&ccedil;o kids<\/button>/);
assert.match(kidsSectorHtml, /Responsável A e Responsável B/);
assert.match(kidsSectorHtml, /Contato: \(47\) 99999-0000/);
assert.match(kidsSectorHtml, /Origem: Cursista/);
assert.match(kidsSectorHtml, /'kids-registered':/);

const emptyKidsSectorHtml = sectorPageHtml({
  retreat: { id: 'r-smp', nome: 'Retiro teste', dias: ['Sábado'], tipoFichaCursista: 'cursista-smp' },
  sector: 'Espaço Kids',
  entries: [],
  kidsRegistered: [],
});
assert.match(emptyKidsSectorHtml, /Nenhuma crian&ccedil;a cadastrada no Espa&ccedil;o Kids/);

const failedKidsSectorHtml = sectorPageHtml({
  retreat: { id: 'r-smp', nome: 'Retiro teste', dias: ['Sábado'], tipoFichaCursista: 'cursista-smp' },
  sector: 'Espaço Kids',
  entries: [],
  kidsRegisteredLoadError: 'Falha controlada ao carregar crianças.',
});
assert.match(failedKidsSectorHtml, /Falha controlada ao carregar crianças/);

console.log('Acompanhamento por setor: fontes, exposição mínima, abas e impressão validadas.');
