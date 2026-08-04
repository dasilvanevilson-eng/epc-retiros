const assert = require('assert');
const { buildIntoleranceRows, sectorPageHtml, supportsIntoleranceView } = require('../publicSectorPage');

assert.strictEqual(supportsIntoleranceView('Animação/Jovem de sala'), true);
assert.strictEqual(supportsIntoleranceView('ANIMACAO/JOVEM DE SALA'), true);
assert.strictEqual(supportsIntoleranceView('Cozinha'), true);
assert.strictEqual(supportsIntoleranceView('Secretaria'), false);

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

const eligibleHtml = sectorPageHtml({
  retreat: { id: 'r-ind', nome: 'Retiro teste', dias: ['Sábado'], tipoFichaCursista: 'cursista-individual' },
  sector: 'Cozinha',
  entries: [{ nome: 'Voluntária', dias: ['Sábado'], retirosAnteriores: ['EPC'] }],
  intolerances: individualRows,
});
assert.match(eligibleHtml, /sector-tab-entries/);
assert.match(eligibleHtml, /sector-tab-intolerances/);
assert.match(eligibleHtml, /Ades&otilde;es deste setor/);
assert.match(eligibleHtml, /Cursistas com intoler&acirc;ncia alimentar/);
assert.doesNotMatch(eligibleHtml, /Ades&otilde;es do setor|Intoler&acirc;ncias dos cursistas|Intoler&acirc;ncia alimentar dos cursistas/);
assert.match(eligibleHtml, /Comunidade Verde/);
assert.match(eligibleHtml, /Lactose/);
assert.doesNotMatch(eligibleHtml, /11111111111|47999999999|Rua secreta/);
assert.match(eligibleHtml, /printableReports\[activeSectorView\]/);
assert.match(eligibleHtml, /\.intolerance-public-list li\{display:grid;grid-template-columns:/);
assert.match(eligibleHtml, /\.intolerance-list li\{display:grid;grid-template-columns:/);
assert.match(eligibleHtml, /grid-column:2;grid-row:1 \/ span 2/);

const regularHtml = sectorPageHtml({
  retreat: { id: 'r-ind', nome: 'Retiro teste', dias: ['Sábado'] },
  sector: 'Secretaria',
  entries: [],
});
assert.doesNotMatch(regularHtml, /id="sector-tab-entries"/);
assert.doesNotMatch(regularHtml, /id="sector-view-intolerances"/);

console.log('Acompanhamento por setor: fontes, exposição mínima, abas e impressão validadas.');
