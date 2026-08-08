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
    responsible: 'Responsável Equipe',
    sectors: ['Cozinha', 'Secretaria'],
    contact: '(47) 99999-0000',
  }];
  const smpStudents = [{
    id: '1',
    retiroId: 'retiro-foco',
    nomeDele: 'Responsável SMP',
    foneDele: '(47) 98888-0000',
    kidsCommunity: 'Comunidade Azul',
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
  assert.equal(smpSummary.children.length, 2, 'O total deve reunir criancas da equipe e das fichas SMP do retiro em foco.');
  assert.equal(smpSummary.intolerance.length, 2, 'A mesma crianca deve contar uma vez por origem.');
  assert.equal(smpSummary.health.length, 2, 'Resposta Sim ou descricao deve incluir a crianca.');
  assert.deepEqual(smpSummary.intolerance.map((kid) => kid.origin).sort(), ['Cursista', 'Equipe de trabalho']);
  const teamKid = smpSummary.intolerance.find((kid) => kid.origin === 'Equipe de trabalho');
  assert.equal(teamKid.responsible, 'Responsável Equipe');
  assert.equal(teamKid.contextLabel, 'Setor de trabalho');
  assert.equal(teamKid.contextValue, 'Cozinha, Secretaria');
  const smpKid = smpSummary.intolerance.find((kid) => kid.origin === 'Cursista');
  assert.equal(smpKid.responsible, 'Responsável SMP');
  assert.equal(smpKid.contextLabel, 'Comunidade');
  assert.equal(smpKid.contextValue, 'Comunidade Azul');
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
  assert.equal(epcSummary.children.length, 1, 'O total deve incluir criancas das fichas EPC do retiro em foco.');
  assert.equal(epcSummary.health[0].origin, 'Cursista');
  assert.equal(epcSummary.health[0].contextLabel, 'Comunidade');
  assert.equal(epcSummary.health[0].contextValue, 'Sem comunidade');
  assert.equal(epcSummary.health[0].detail, 'Bronquite');
  assert.equal(epcSummary.intolerance[0].detail, 'Ovo');

  const individualSummary = buildKidsCareSummary({ teamKids, coupleStudents: smpStudents, studentFormType: 'cursista-individual', retreatId: 'retiro-foco' });
  assert.equal(individualSummary.health.length, 1, 'Ficha individual deve considerar somente criancas da Equipe.');
  assert.equal(individualSummary.intolerance.length, 1, 'Ficha individual deve considerar somente criancas da Equipe.');

  const emptySummary = buildKidsCareSummary();
  assert.deepEqual(emptySummary, { children: [], intolerance: [], health: [] });

  const adminSource = await fs.readFile(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
  assert.match(adminSource, /sectors:\s*couple\.flatMap\(entrySectors\)/, 'Os setores dos dois responsáveis devem ser reunidos.');
  assert.match(adminSource, /sectors:\s*uniqueSectors\(options\.sectors/, 'Setores repetidos devem ser removidos.');
  const spaceKidsRenderer = adminSource.match(/const kidsRows = .*?;\r?\n/)?.[0] || '';
  assert.match(spaceKidsRenderer, /Responsável:/);
  assert.match(spaceKidsRenderer, /kid\.origin/, 'A lista geral do Espaço Kids deve informar a origem de cada criança.');
  assert.match(spaceKidsRenderer, /kid\.contextLabel/, 'A lista geral do Espaço Kids deve informar setor ou comunidade conforme a origem.');
  const careRenderer = adminSource.match(/const kidsCareRows = .*?;\r?\n/)?.[0] || '';
  assert.match(careRenderer, /Responsável:/);
  assert.match(careRenderer, /Origem:/);
  assert.match(careRenderer, /Problema descrito:/);
  assert.match(careRenderer, /kids-care-problem[^>]*><strong>Problema descrito:/, 'O problema descrito deve aparecer em negrito.');
  assert(!careRenderer.includes('Contato:'), 'O telefone não deve aparecer nos dois indicadores infantis.');
  assert.match(adminSource, /kidsCareSummary\.health, 'Não detalhado'/, 'Problema sem descrição deve usar o fallback solicitado.');
  assert.match(adminSource, /class="home-column-list home-misc-groups"/, 'A coluna Diversos deve possuir duas caixas internas.');
  assert.match(adminSource, /aria-label="Participação"[\s\S]*?Presença por dia[\s\S]*?Cidades participantes/, 'A primeira caixa deve reunir presença e cidades.');
  assert.match(adminSource, /id="home-kids-group-title">Espaço Kids<[\s\S]*?Total de crianças[\s\S]*?Crianças com intolerância alimentar[\s\S]*?Crianças com problema de saúde/, 'A segunda caixa deve reunir os três indicadores do Espaço Kids.');

  assert.match(adminSource, /const dayCount = \(day\).*?\+ kidsCareSummary\.children\.length;/, 'A presenca do painel Inicio deve somar o total consolidado de criancas.');
  assert.match(adminSource, /homeHealthCard\('Total de crianças', kidsCareSummary\.children\.length, 'kids'\)/, 'O card Total de criancas deve usar a fonte consolidada.');
  assert.match(adminSource, /\['cursista-smp', 'cursista-epc'\]\.includes\(studentFormType\)[\s\S]*?\? coupleStudents\.length \* 2[\s\S]*?: individualStudents\.length/, 'A quantidade de cursistas deve contar uma pessoa por ficha Individual e duas por ficha SMP ou EPC.');
  assert.match(adminSource, /activeStudentPresenceCount = studentPresenceCount\(activeStudentFormType, activeStudents, coupleStudents\)/, 'O painel Inicio deve escolher a fonte conforme o tipo de ficha do retiro.');
  assert.match(adminSource, /retreatStudentPresenceCount = studentPresenceCount\(retreatStudentFormType, registeredStudents, coupleStudents\)/, 'A tela Links de cadastro deve usar a mesma regra de presença.');
  assert.match(adminSource, /const dayCount = \(day\).*?\+ activeStudentPresenceCount \+ kidsCareSummary\.children\.length;/, 'A presença do painel Inicio deve combinar equipe, cursistas da fonte configurada e crianças.');
  assert.match(adminSource, /const dayCount = \(day\).*?\+ retreatStudentPresenceCount \+ retreatKidsSummary\.children\.length;/, 'A presença em Links de cadastro deve combinar equipe, cursistas da fonte configurada e crianças.');
  assert.match(adminSource, /Equipe de trabalho \+ Cursistas \+ Crianças Kids/, 'O card de presenca deve informar que inclui as criancas do Espaco Kids.');

  console.log('Inicio: indicadores combinados de saude das criancas validados.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
