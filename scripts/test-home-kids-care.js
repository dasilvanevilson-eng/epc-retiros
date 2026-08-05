const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'kidsCareSummary.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { buildKidsCareSummary } = await import(moduleUrl);

  const teamKids = [{
    nome: 'Ana Criança',
    nascimento: '2020-02-01',
    intoleranciaAlimentar: 'Sim',
    descricaoIntolerancia: 'Lactose',
    problemaSaude: '',
    descricaoSaude: 'Asma',
    volunteer: 'Responsável Equipe',
    contact: '(47) 99999-0000',
  }];
  const smpStudents = [{
    id: '1',
    retiroId: 'retiro-foco',
    nomeDele: 'Responsável SMP',
    foneDele: '(47) 98888-0000',
    smpKidNome1: 'Ana Criança',
    smpKidNascimento1: '2020-02-01',
    smpKidProblemaSaude1: 'Sim',
    smpKidDescricaoSaude1: '',
    smpKidIntolerancia1: 'Não',
    smpKidDescricaoIntolerancia1: 'Glúten',
  }, {
    id: '2',
    retiroId: 'outro-retiro',
    smpKidNome1: 'Fora do foco',
    smpKidNascimento1: '2021-01-01',
    smpKidProblemaSaude1: 'Sim',
  }, {
    id: '3',
    retiroId: 'retiro-foco',
    smpKidsNotNeeded: true,
    smpKidNome1: 'Dado antigo ignorado',
    smpKidNascimento1: '2022-01-01',
    smpKidIntolerancia1: 'Sim',
  }];

  const smpSummary = buildKidsCareSummary({ teamKids, coupleStudents: smpStudents, studentFormType: 'cursista-smp', retreatId: 'retiro-foco' });
  assert.equal(smpSummary.intolerance.length, 2, 'A mesma crianca deve contar uma vez por origem.');
  assert.equal(smpSummary.health.length, 2, 'Resposta Sim ou descricao deve incluir a crianca.');
  assert.deepEqual(smpSummary.intolerance.map((kid) => kid.origin).sort(), ['Cursista SMP', 'Equipe de Trabalho']);
  assert(!JSON.stringify(smpSummary).includes('Fora do foco'), 'Crianca de outro retiro nao pode entrar no resumo.');
  assert(!JSON.stringify(smpSummary).includes('Dado antigo ignorado'), 'Ficha que nao necessita do Espaco Kids deve ser ignorada.');

  const epcSummary = buildKidsCareSummary({
    coupleStudents: [{
      id: '4',
      retiroId: 'retiro-foco',
      nomeDele: 'Responsável EPC',
      smpKidNome1: 'Criança EPC',
      smpKidNascimento1: '2019-05-10',
      smpKidProblemaSaude1Epc: 'Sim',
      smpKidDescricaoSaude1Epc: 'Bronquite',
      smpKidIntolerancia1Epc: 'Sim',
      smpKidDescricaoIntolerancia1Epc: 'Ovo',
    }],
    studentFormType: 'cursista-epc',
    retreatId: 'retiro-foco',
  });
  assert.equal(epcSummary.health[0].origin, 'Cursista EPC');
  assert.equal(epcSummary.health[0].detail, 'Bronquite');
  assert.equal(epcSummary.intolerance[0].detail, 'Ovo');

  const individualSummary = buildKidsCareSummary({ teamKids, coupleStudents: smpStudents, studentFormType: 'cursista-individual', retreatId: 'retiro-foco' });
  assert.equal(individualSummary.health.length, 1, 'Ficha individual deve considerar somente criancas da Equipe.');
  assert.equal(individualSummary.intolerance.length, 1, 'Ficha individual deve considerar somente criancas da Equipe.');

  const emptySummary = buildKidsCareSummary();
  assert.deepEqual(emptySummary, { intolerance: [], health: [] });

  console.log('Inicio: indicadores combinados de saude das criancas validados.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
