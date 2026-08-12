const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const moduleSource = await fs.readFile(path.join(__dirname, '..', 'badgeParticipants.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
  const { buildCommunityStudentBadgeEntries } = await import(moduleUrl);

  const individual = buildCommunityStudentBadgeEntries({
    community: { nome: 'Comunidade Azul', membroIds: ['i1'] },
    students: [
      { id: 'i1', retiroId: 'r1', nome: 'João da Silva' },
      { id: 'i2', retiroId: 'r1', nome: 'Outra Pessoa' },
      { id: 'i1', retiroId: 'outro', nome: 'Outro Retiro' },
    ],
    studentFormType: 'cursista-individual',
    retreatId: 'r1',
  });
  assert.deepEqual(individual, [{
    entry: {
      id: 'student-i1',
      nome: 'João da Silva',
      badgeName: 'João',
      setores: ['Comunidade Azul'],
      badgeParticipantType: 'student',
    },
    sector: 'Comunidade Azul',
  }]);

  const individualWithBadgeName = buildCommunityStudentBadgeEntries({
    community: { nome: 'Comunidade Azul', membroIds: ['i3'] },
    students: [{ id: 'i3', retiroId: 'r1', nome: 'Maria de Souza', nomeCracha: '  Maria da Acolhida  ' }],
    studentFormType: 'cursista-individual',
    retreatId: 'r1',
  });
  assert.equal(individualWithBadgeName[0].entry.badgeName, 'Maria da Acolhida', 'O nome personalizado completo deve substituir o primeiro nome no crachá.');

  const smp = buildCommunityStudentBadgeEntries({
    community: { nome: 'Comunidade Verde', membroSmpIds: ['12'] },
    students: [{ id: '12', retiroId: 'r2', nomeDele: 'Carlos Alberto', nomeDela: 'Maria Helena' }],
    studentFormType: 'cursista-smp',
    retreatId: 'r2',
  });
  assert.equal(smp.length, 1, 'SMP deve gerar um único crachá por casal.');
  assert.equal(smp[0].entry.badgeName, 'Carlos e Maria');
  assert.equal(smp[0].sector, 'Comunidade Verde');

  const epc = buildCommunityStudentBadgeEntries({
    community: { nome: 'Comunidade Dourada', membroEpcIds: ['7'] },
    students: [{ numeroFichaSmp: '7', retiroId: 'r3', nomeDele: 'Eduardo Lima', nomeDela: 'Fernanda Souza' }],
    studentFormType: 'cursista-epc',
    retreatId: 'r3',
  });
  assert.equal(epc.length, 1, 'EPC deve gerar um único crachá por casal.');
  assert.equal(epc[0].entry.badgeName, 'Eduardo e Fernanda');
  assert.equal(epc[0].sector, 'Comunidade Dourada');

  const adminSource = await fs.readFile(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
  assert.match(adminSource, /const badgeNameField = publicContext \? '' : '<label class="field full"><span>Nome para crach&aacute;<\/span><input name="nomeCracha" autocomplete="off"><\/label>';/, 'O campo opcional deve existir somente no formulário autenticado.');
  assert.match(adminSource, /name="nome" required><\/label>\$\{badgeNameField\}<label class="field"><span>Data de nascimento/, 'O nome para crachá deve ficar imediatamente abaixo do nome completo.');
  const teamPersonalFields = adminSource.match(/const personalFields = embedded\s*\? `([^`]*)`\s*: `([^`]*)`;/);
  assert(teamPersonalFields, 'Os campos pessoais da equipe devem separar os contextos autenticado e publico.');
  assert.match(teamPersonalFields[1], /name="nome"[\s\S]*name="badgeName"/, 'A equipe autenticada deve exibir o nome para cracha abaixo do nome completo.');
  assert.doesNotMatch(teamPersonalFields[2], /name="badgeName"/, 'O formulario publico nao pode exibir o nome para cracha.');
  const teamSpouseFields = adminSource.match(/const spouseFields = embedded\s*\? `([^`]*)`\s*: `([^`]*)`;/);
  assert(teamSpouseFields, 'Os campos do segundo conjuge devem separar os contextos autenticado e publico.');
  assert.match(teamSpouseFields[1], /name="spouseNome"[\s\S]*name="spouseBadgeName"/, 'Cada conjuge deve possuir seu proprio nome para cracha.');
  assert.doesNotMatch(teamSpouseFields[2], /name="spouseBadgeName"/, 'O nome para cracha do conjuge nao pode aparecer no formulario publico.');
  assert.match(adminSource, /form\.elements\.badgeName\.value = entry\.badgeName \|\| '';/, 'Cadastros antigos devem abrir com o novo campo vazio.');
  assert.match(adminSource, /form\.elements\.spouseBadgeName\.value = editingSpouseEntry\.badgeName \|\| '';/, 'O nome para cracha do segundo conjuge deve ser carregado separadamente.');
  assert.match(adminSource, /const internalBadgeName = embedded \? \{ badgeName: String\(data\.get\(fieldName\('badgeName'\)\) \|\| ''\)\.trim\(\) \} : \{\};/, 'Somente o formulario autenticado pode gravar ou limpar o nome para cracha.');
  assert.match(adminSource, /buildCommunityStudentBadgeEntries\(\{/);
  assert.match(adminSource, /const preparedName = String\(entry\.badgeName/);
  assert.match(adminSource, /badgeUsesCoupleStudentForm \? badgeCoupleStudentSource\.list\(retreat\.id\)/);
  assert.match(adminSource, /first && selected\.length \? badgeCard\(first\.entry, firstSettings, first\.sector, badgeSectorNames, firstUsesConfiguredSectorName\)/, 'A prévia deve usar participante, modelo e regra de nome do grupo selecionado.');
  assert.match(adminSource, /firstUsesConfiguredSectorName = first\?\.groupType !== 'community'/, 'Rótulos de comunidade não devem receber nomes configurados para setores.');

  console.log('Crachás: comunidade dos cursistas individuais, SMP e EPC validada.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
