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
  assert.match(adminSource, /buildCommunityStudentBadgeEntries\(\{/);
  assert.match(adminSource, /const preparedName = String\(entry\.badgeName/);
  assert.match(adminSource, /badgeUsesCoupleStudentForm \? badgeCoupleStudentSource\.list\(retreat\.id\)/);
  assert.match(adminSource, /first && selected\.length \? badgeCard\(first\.entry, firstSettings, first\.sector\)/, 'A prévia de impressão deve usar o participante e o modelo do grupo selecionado.');

  console.log('Crachás: comunidade dos cursistas individuais, SMP e EPC validada.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
