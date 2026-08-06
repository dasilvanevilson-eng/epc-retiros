const assert = require('assert');
const fs = require('fs');
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
const { prepareStudentRegistrationLinkSync, resolvePublicStudentLink, savePublicStudentRegistration } = require('../publicStudentLinks');

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
  const preparationContext = await resolvePublicStudentLink('token-publico');
  assert(preparationContext.active, 'Cursista público deve estar disponível durante a preparação.');
  await assert.rejects(() => savePublicStudentRegistration('token-publico', individualPayload, 2), /numero da ficha nao corresponde/);
  await savePublicStudentRegistration('token-publico', individualPayload, 1);
  assert.equal(savedIndividual.numeroFichaIndividual, 1);
  database.cursistas.length = 0;

  retreat = { ...retreat, status: 'concluido' };
  await assert.rejects(() => savePublicStudentRegistration('token-publico', individualPayload), /nao esta disponivel/);

  retreat = { ...retreat, status: 'preparacao', tipoFichaCursista: 'cursista-smp' };
  await savePublicStudentRegistration('token-publico', { nomeDele: 'João', nomeDela: 'Maria', valorPagoSmp: 900, id: '99' });
  assert.equal(savedSmp.id, '1');
  assert.equal(savedSmp.retiroId, retreat.id);
  assert.equal(savedSmp.valorPagoSmp, 0);

  savedSmp = null;
  retreat = { ...retreat, status: 'preparacao', tipoFichaCursista: 'cursista-epc' };
  await savePublicStudentRegistration('token-publico', { nomeDele: 'José', nomeDela: 'Ana', retiroId: 'outro' });
  assert.equal(savedEpc.id, '1');
  assert.equal(savedEpc.retiroId, retreat.id);

  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'apiCore.js'), 'utf8');
  const teamInviteSource = fs.readFileSync(path.join(__dirname, '..', 'publicSectorInvitePage.js'), 'utf8');
  assert.match(adminSource, /const canModifyRetreat = \(retreat = \{\}\) => Boolean\(retreat\) && canAccessRetreat\(retreat\) && !isRetreatConcluded\(retreat\)/, 'A área logada deve continuar editável durante a preparação.');
  assert.match(apiSource, /if \(!retreat \|\| retreat\.tipoFichaCursista !== expectedType\)/, 'A API logada SMP\/EPC deve validar o tipo sem exigir publicação.');
  assert.match(teamInviteSource, /result\.retreat\?\.status !== 'publicado'/, 'O convite público da equipe deve continuar exigindo retiro publicado.');

  database.cursistas.length = 0;
  savedSmp = null;
  savedEpc = null;
  retreat = {
    ...retreat,
    status: 'preparacao',
    tipoFichaCursista: 'cursista-individual',
    linksCadastroCursistas: [{ numeroFicha: 1, token: 'token-legado', createdAt: '2026-01-01T00:00:00.000Z' }],
  };
  const rotation = await prepareStudentRegistrationLinkSync(retreat);
  assert(!rotation.blocked && rotation.rotated);
  assert.notEqual(rotation.links[0].token, 'token-legado');
  assert.equal(rotation.links[0].versao, 2);
  retreat = { ...retreat, linksCadastroCursistas: rotation.links };
  assert.equal(await resolvePublicStudentLink('token-legado'), null, 'O token descartado não deve mais resolver.');
  assert((await resolvePublicStudentLink(rotation.links[0].token))?.active, 'O novo token deve resolver normalmente.');
  const secondSync = await prepareStudentRegistrationLinkSync(retreat);
  assert(!secondSync.rotated);
  assert.equal(secondSync.links[0].token, rotation.links[0].token);

  retreat = { ...retreat, linksCadastroCursistas: [{ numeroFicha: 1, token: 'legado-com-ficha' }] };
  database.cursistas.push({ id: 'individual-1', retiroId: retreat.id, numeroFichaIndividual: 1 });
  const individualBlock = await prepareStudentRegistrationLinkSync(retreat);
  assert(individualBlock.blocked && individualBlock.counts.individual === 1);
  database.cursistas.length = 0;
  savedSmp = { id: '1', numeroFichaSmp: '1', retiroId: retreat.id };
  const smpBlock = await prepareStudentRegistrationLinkSync(retreat);
  assert(smpBlock.blocked && smpBlock.counts.smp === 1);
  savedSmp = null;
  savedEpc = { id: '1', numeroFichaSmp: '1', retiroId: retreat.id };
  const epcBlock = await prepareStudentRegistrationLinkSync(retreat);
  assert(epcBlock.blocked && epcBlock.counts.epc === 1);

  console.log('Cadastro de cursistas: preparação, rotação segura, isolamento e destinos validados.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
