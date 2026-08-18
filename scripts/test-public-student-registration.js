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
  linksCadastroCursistas: [{ numeroFicha: 1, token: 'token-publico', createdAt: '2026-08-06T00:00:00.000Z', versao: 2, enviadoPara: 'Família convidada', inscricaoEncerrada: false }],
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
const { prepareStudentRegistrationLinkSync, resolvePublicStudentLink, savePublicStudentRegistration, studentRegistrationLinkStatus } = require('../publicStudentLinks');

const individualPayload = {
  id: 'id-forjado',
  retiroId: 'retiro-forjado',
  numeroFichaIndividual: 999,
  valorPago: 999,
  recebedorTaxaPaga: true,
  cpf: '529.982.247-25',
  nome: 'Cursista Público',
  nomeCracha: 'Campo privado forjado',
  nascimento: '01/02/2008',
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
  await assert.rejects(
    () => savePublicStudentRegistration('token-publico', { ...individualPayload, nascimento: '31/02/2008' }),
    /Revise a data informada/,
  );
  assert.equal(savedIndividual, null, 'Data individual invalida nao pode chegar a persistencia.');
  await savePublicStudentRegistration('token-publico', individualPayload);
  assert.equal(savedIndividual.nascimento, '2008-02-01', 'Data individual em formato brasileiro deve ser persistida em ISO.');
  assert.equal(savedIndividual.retiroId, retreat.id);
  assert.equal(savedIndividual.numeroFichaIndividual, 1);
  assert.notEqual(savedIndividual.id, 'id-forjado');
  assert.equal(savedIndividual.valorInscricao, 250);
  assert.equal(savedIndividual.valorPago, 0);
  assert.equal(savedIndividual.saldoPagar, 250);
  assert.equal(savedIndividual.recebedorTaxaPaga, false);
  assert.equal(Object.prototype.hasOwnProperty.call(savedIndividual, 'nomeCracha'), false, 'O link público não pode gravar o campo exclusivo do acesso autenticado.');
  const individualStatus = (await studentRegistrationLinkStatus(retreat))[0];
  assert.equal(individualStatus.status, 'cadastrada');
  assert.equal(individualStatus.enviadoPara, 'Família convidada');
  assert.equal(individualStatus.tipoCadastro, 'individual');
  assert.equal(individualStatus.nomeCadastrado, 'Cursista Público');

  await assert.rejects(() => savePublicStudentRegistration('token-publico', individualPayload), /Ficha ja cadastrada/);
  database.cursistas.length = 0;
  savedIndividual = null;
  await savePublicStudentRegistration('token-publico', { ...individualPayload, nascimento: '2008-02-01' });
  assert.equal(savedIndividual.nascimento, '2008-02-01', 'O endpoint deve continuar aceitando datas ISO de clientes anteriores.');
  database.cursistas.length = 0;
  retreat = { ...retreat, linksCadastroCursistas: retreat.linksCadastroCursistas.map((link) => ({ ...link, inscricaoEncerrada: true })) };
  const closedContext = await resolvePublicStudentLink('token-publico');
  assert(closedContext.closed && !closedContext.active, 'O link encerrado deve permanecer identificável, mas inativo.');
  assert.equal((await studentRegistrationLinkStatus(retreat))[0].status, 'encerrada');
  await assert.rejects(() => savePublicStudentRegistration('token-publico', individualPayload), /Inscricao encerrada/);
  retreat = { ...retreat, linksCadastroCursistas: retreat.linksCadastroCursistas.map((link) => ({ ...link, inscricaoEncerrada: false })) };
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
  const smpPayload = {
    nomeDele: 'João',
    nomeDela: 'Maria',
    nascimentoDele: '01/02/1980',
    nascimentoDela: '29/02/1984',
    casamentoDele: '03/04/2001',
    casamentoDela: '04/05/2002',
    uniaoCasal: '05/06/2010',
    outrasUnioesDele: 'Não',
    outrasUnioesDela: 'Sim',
    porqueQueremFazerRetiro: 'Fortalecer a vida em família',
    comoSouberamRetiro: 'Por um casal amigo',
    campoPublicoForjado: 'não deve salvar',
    smpKidNascimento1: '06/07/2015',
    smpKidNascimento2: '07/08/2016',
    smpKidNascimento3: '08/09/2017',
    smpKidNascimento4: '09/10/2018',
    smpKidNascimento5: '10/11/2019',
    valorPagoSmp: 900,
    id: '99',
  };
  await assert.rejects(
    () => savePublicStudentRegistration('token-publico', { ...smpPayload, smpKidNascimento1: '29/02/2023' }),
    /Revise a data informada/,
  );
  assert.equal(savedSmp, null, 'Data SMP invalida nao pode chegar a persistencia.');
  await savePublicStudentRegistration('token-publico', smpPayload);
  assert.deepEqual(
    [savedSmp.nascimentoDele, savedSmp.nascimentoDela, savedSmp.casamentoDele, savedSmp.casamentoDela, savedSmp.uniaoCasal,
      savedSmp.smpKidNascimento1, savedSmp.smpKidNascimento2, savedSmp.smpKidNascimento3, savedSmp.smpKidNascimento4, savedSmp.smpKidNascimento5],
    ['1980-02-01', '1984-02-29', '2001-04-03', '2002-05-04', '2010-06-05',
      '2015-07-06', '2016-08-07', '2017-09-08', '2018-10-09', '2019-11-10'],
    'Todas as datas SMP devem ser persistidas em ISO.',
  );
  assert.equal(savedSmp.id, '1');
  assert.equal(savedSmp.retiroId, retreat.id);
  assert.equal(savedSmp.valorPagoSmp, 0);
  assert.equal(savedSmp.outrasUnioesDele, 'Não');
  assert.equal(savedSmp.outrasUnioesDela, 'Sim');
  assert.equal(savedSmp.porqueQueremFazerRetiro, 'Fortalecer a vida em família');
  assert.equal(savedSmp.comoSouberamRetiro, 'Por um casal amigo');
  assert.equal(Object.prototype.hasOwnProperty.call(savedSmp, 'campoPublicoForjado'), false, 'O ajuste nao pode liberar campos publicos desconhecidos.');
  const smpStatus = (await studentRegistrationLinkStatus(retreat))[0];
  assert.equal(smpStatus.tipoCadastro, 'casal');
  assert.equal(smpStatus.nomeCadastrado, 'João e Maria');

  savedSmp = null;
  retreat = { ...retreat, status: 'preparacao', tipoFichaCursista: 'cursista-epc' };
  const epcPayload = {
    nomeDele: 'José',
    nomeDela: 'Ana',
    nascimentoDele: '11/12/1978',
    nascimentoDela: '12/01/1980',
    uniaoCasal: '13/02/2000',
    smpKidNascimento1: '14/03/2010',
    smpKidNascimento2: '15/04/2011',
    smpKidNascimento3: '16/05/2012',
    smpKidNascimento4: '17/06/2013',
    smpKidNascimento5: '18/07/2014',
    retiroId: 'outro',
  };
  await assert.rejects(
    () => savePublicStudentRegistration('token-publico', { ...epcPayload, uniaoCasal: '2020-13-01' }),
    /Revise a data informada/,
  );
  assert.equal(savedEpc, null, 'Data EPC invalida nao pode chegar a persistencia.');
  await savePublicStudentRegistration('token-publico', epcPayload);
  assert.deepEqual(
    [savedEpc.nascimentoDele, savedEpc.nascimentoDela, savedEpc.uniaoCasal,
      savedEpc.smpKidNascimento1, savedEpc.smpKidNascimento2, savedEpc.smpKidNascimento3, savedEpc.smpKidNascimento4, savedEpc.smpKidNascimento5],
    ['1978-12-11', '1980-01-12', '2000-02-13', '2010-03-14', '2011-04-15', '2012-05-16', '2013-06-17', '2014-07-18'],
    'Todas as datas EPC devem ser persistidas em ISO.',
  );
  assert.equal(savedEpc.id, '1');
  assert.equal(savedEpc.retiroId, retreat.id);
  const epcStatus = (await studentRegistrationLinkStatus(retreat))[0];
  assert.equal(epcStatus.tipoCadastro, 'casal');
  assert.equal(epcStatus.nomeCadastrado, 'José e Ana');

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
