const assert = require('assert');
const path = require('path');

const adapterPath = require.resolve('../databaseAdapter');
const linksPath = require.resolve('../publicStudentLinks');
let retreat = {
  id: 'retreat-public',
  nome: 'Retiro público',
  status: 'publicado',
  tipoFichaCursista: 'cursista-individual',
  numeroPrevistoFichasCursista: 1,
  valorInscricaoCursista: 250,
  linksCadastroCursistas: [{ numeroFicha: 1, token: 'token-publico', createdAt: '2026-08-06T00:00:00.000Z' }],
};
const database = { cursistas: [], pessoas: [], adesoes: [] };
let savedIndividual = null;
let savedSmp = null;
let savedEpc = null;

require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: {
    listRecords: async (store) => store === 'retiros' ? [retreat] : (database[store] || []),
    listCursistasSmp: async () => savedSmp ? [savedSmp] : [],
    listCursistasEpc: async () => savedEpc ? [savedEpc] : [],
    saveRecord: async (store, record) => {
      assert.equal(store, 'cursistas');
      savedIndividual = { ...record };
      database.cursistas.push(savedIndividual);
      return savedIndividual;
    },
    saveCursistaSmp: async (record) => { savedSmp = { ...record }; return savedSmp; },
    saveCursistaEpc: async (record) => { savedEpc = { ...record }; return savedEpc; },
  },
};
delete require.cache[linksPath];
const { resolvePublicStudentLink, savePublicStudentRegistration } = require('../publicStudentLinks');

const individualPayload = {
  id: 'id-forjado',
  retiroId: 'retiro-forjado',
  numeroFichaIndividual: 999,
  valorPago: 999,
  recebedorTaxaPaga: true,
  cpf: '529.982.247-25',
  nome: 'Cursista Público',
  nascimento: '2008-01-01',
  telefone: '47999999999',
  cep: '89000000',
  rua: 'Rua Teste',
  numero: '10',
  bairro: 'Centro',
  cidade: 'Indaial',
  estado: 'SC',
  batizado: 'Sim',
  primeiraComunhao: 'Sim',
  estuda: 'Sim',
  fezRetiro: 'Não',
  paisMovimento: 'Não',
  camiseta: 'M',
  intoleranciaAlimentos: 'Não',
  alergiaMedicamento: 'Não',
  medicamentoContinuo: 'Não',
};

(async () => {
  const before = await resolvePublicStudentLink('token-publico');
  assert(before.active && !before.occupied);
  await savePublicStudentRegistration('token-publico', individualPayload);
  assert.equal(savedIndividual.retiroId, retreat.id);
  assert.equal(savedIndividual.numeroFichaIndividual, 1);
  assert.notEqual(savedIndividual.id, 'id-forjado');
  assert.equal(savedIndividual.valorInscricao, 250);
  assert.equal(savedIndividual.valorPago, 0);
  assert.equal(savedIndividual.saldoPagar, 250);
  assert.equal(savedIndividual.recebedorTaxaPaga, false);

  await assert.rejects(() => savePublicStudentRegistration('token-publico', individualPayload), /Ficha ja cadastrada/);
  database.cursistas.length = 0;
  retreat = { ...retreat, numeroPrevistoFichasCursista: 0 };
  await assert.rejects(() => savePublicStudentRegistration('token-publico', individualPayload), /nao esta disponivel/);
  retreat = { ...retreat, numeroPrevistoFichasCursista: 1, status: 'preparacao' };
  await assert.rejects(() => savePublicStudentRegistration('token-publico', individualPayload), /nao esta disponivel/);

  retreat = { ...retreat, status: 'publicado', tipoFichaCursista: 'cursista-smp' };
  await savePublicStudentRegistration('token-publico', { nomeDele: 'João', nomeDela: 'Maria', valorPagoSmp: 900, id: '99' });
  assert.equal(savedSmp.id, '1');
  assert.equal(savedSmp.retiroId, retreat.id);
  assert.equal(savedSmp.valorPagoSmp, 0);

  savedSmp = null;
  retreat = { ...retreat, tipoFichaCursista: 'cursista-epc' };
  await savePublicStudentRegistration('token-publico', { nomeDele: 'José', nomeDela: 'Ana', retiroId: 'outro' });
  assert.equal(savedEpc.id, '1');
  assert.equal(savedEpc.retiroId, retreat.id);

  console.log('Cadastro publico de cursistas: isolamento, uso unico e destinos validados.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
