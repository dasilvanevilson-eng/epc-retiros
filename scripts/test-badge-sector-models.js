const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.match(appSource, /const badgeSectorAssignmentsType = 'sector-model-assignments'/);
assert.match(appSource, /profile\.tipo !== badgeSectorAssignmentsType/, 'A configuração por setor não pode aparecer como modelo de crachá.');
assert.match(appSource, /data-badge-view="assignments"><strong>Definir crach&aacute;s por setor/);
assert.match(appSource, /id="badge-assignment-panel" hidden/);
assert.match(appSource, /const renderBadgeAssignmentsPanel = \(\) =>/);
assert.doesNotMatch(appSource, /badge-sector-models-tab/, 'A definição não deve permanecer dentro da configuração de modelos.');
assert.match(appSource, /<h3>Setores<\/h3>/);
assert.match(appSource, /<h3>Comunidades<\/h3>/);
assert.match(appSource, /assignmentRows\(sectors, 'sectors'\)/);
assert.match(appSource, /assignmentRows\(badgeCommunities, 'communities'\)/);
assert.match(appSource, /data-badge-sector-model-search/);
assert.match(appSource, /data-assignment-kind/);
assert.match(appSource, /data-assignment-key/);
assert.match(appSource, /saveBadgeSectorAssignments\(retreat\.id, assignments, badgeSectorAssignmentsRecordId\)/);
assert.match(appSource, /applyAssignedSectorProfile\(sector\)/, 'A impressão por setor deve aplicar automaticamente o modelo salvo.');
assert.match(appSource, /applyAssignedCommunityProfile\(communityId\)/, 'A impressão por comunidade deve aplicar automaticamente o modelo salvo.');
assert.match(appSource, /sectors:[\s\S]*communities:/, 'Setores e comunidades devem ser armazenados separadamente.');
assert.match(styles, /\.badge-sector-model-heading,\.badge-sector-model-row/);
assert.match(styles, /\.badge-assignment-group/);

const helperStart = appSource.indexOf('const normalizeBadgeSectorAssignments');
const helperEnd = appSource.indexOf('const copyBadgeProfilesToRetreat', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'Funções de persistência dos vínculos não encontradas.');
const helperSource = appSource.slice(helperStart, helperEnd);
const generatedId = '7d91f0ce-2f25-4f2a-a01c-7c46c734fe44';
const existingId = 'e8321f58-71ca-40df-a164-6495cd409cce';
const savedRecords = [];
let listedRecords = [];
const context = {
  badgeAssignmentUuidPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  badgeSectorAssignmentsType: 'sector-model-assignments',
  createId: () => generatedId,
  dataService: {
    listCrachas: async () => listedRecords,
    saveCracha: async (record) => {
      savedRecords.push(record);
      return record;
    },
  },
};
vm.runInNewContext(`${helperSource};globalThis.badgeAssignmentTests={normalizeBadgeSectorAssignments,loadBadgeSectorAssignments,saveBadgeSectorAssignments};`, context);
const helpers = context.badgeAssignmentTests;

(async () => {
  const legacy = helpers.normalizeBadgeSectorAssignments({ Cozinha: 'modelo-a' });
  assert.deepEqual(JSON.parse(JSON.stringify(legacy)), { sectors: { Cozinha: 'modelo-a' }, communities: {} });

  listedRecords = [
    { id: 'badge-sector-assignments-retiro-a', retiroId: 'retiro-a', tipo: 'sector-model-assignments', assignments: { Cozinha: 'legado' }, updatedAt: '2026-08-05T12:00:00Z' },
    { id: existingId, retiroId: 'retiro-a', tipo: 'sector-model-assignments', assignments: { sectors: { Cozinha: 'atual' }, communities: { 'comunidade-1': 'modelo-b' } }, updatedAt: '2026-08-05T11:00:00Z' },
    { id: '5b826db6-ca2e-4d0b-b153-3beb7a8fba32', retiroId: 'retiro-b', tipo: 'sector-model-assignments', assignments: { sectors: { Música: 'outro-retiro' } } },
  ];
  const loaded = await helpers.loadBadgeSectorAssignments('retiro-a');
  assert.equal(loaded.id, existingId, 'Deve reutilizar o registro UUID do retiro em foco.');
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.assignments)), { sectors: { Cozinha: 'atual' }, communities: { 'comunidade-1': 'modelo-b' } });

  await helpers.saveBadgeSectorAssignments('retiro-a', legacy);
  assert.equal(savedRecords[0].id, generatedId, 'O primeiro salvamento deve gerar UUID válido.');
  assert.equal(savedRecords[0].retiroId, 'retiro-a');
  await helpers.saveBadgeSectorAssignments('retiro-a', loaded.assignments, existingId);
  assert.equal(savedRecords[1].id, existingId, 'As alterações devem atualizar o mesmo registro UUID.');
  assert.deepEqual(JSON.parse(JSON.stringify(savedRecords[1].assignments.communities)), { 'comunidade-1': 'modelo-b' });

  console.log('Crachás: vínculos por retiro, setor e comunidade validados.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
