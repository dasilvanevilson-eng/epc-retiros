const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');

assert.match(source, /const badgeSectorNamesType = 'sector-display-names'/);
assert.match(source, /badgeTechnicalRecordTypes = new Set\(\[badgeSectorAssignmentsType, badgeSectorNamesType\]\)/);
assert.match(source, /data-badge-view="sector-names"><strong>Personalizar nome do setor no crach&aacute;<\/strong><span>Ajuste o nome do setor para aparecer no crach&aacute;<\/span>/);
assert.match(source, /id="badge-sector-name-panel" hidden/);
assert.match(source, /const renderBadgeSectorNamesPanel = \(\) =>/);
assert.match(source, /<strong>Nome original<\/strong><strong>Nome exibido no crach&aacute;<\/strong>/);
assert.match(source, /data-badge-sector-name=/);
assert.match(source, /Se o campo ficar vazio, ser&aacute; usado o nome original/);
assert.match(source, /canEditBadgeSectorNames \? '' : 'readonly'/, 'Retiro concluído ou usuário sem edição deve permanecer em consulta.');
assert.match(api, /resource === 'crachas'[\s\S]*retreat\.status === 'concluido'[\s\S]*configuracoes de cracha disponiveis apenas para consulta/, 'O servidor deve impedir alterações de crachá em retiro concluído.');
assert.match(source, /saveBadgeSectorNames\(retreat\.id, names, badgeSectorNamesRecordId\)/);
assert.match(source, /saveBadgeSectorNames\(retreat\.id, names, badgeSectorNamesRecordId\)[\s\S]*message\.textContent = 'Nomes dos setores salvos\.';[\s\S]*showBadgeView\(''\);[\s\S]*catch \(error\)/, 'Após salvar com sucesso, a função deve fechar e voltar à tela inicial de Crachás.');
assert.match(source, /badgeCard\(first\.entry, firstSettings, first\.sector, badgeSectorNames, firstUsesConfiguredSectorName\)/, 'A prévia deve usar os nomes configurados.');
assert.match(source, /badgeCard\(entry, badgeSettings \|\| next, sector, badgeSectorNames, groupType !== 'community'\)/, 'A impressão deve usar nomes por setor e preservar rótulos de comunidade.');
assert.doesNotMatch(source, /'casal bem-estar':|'recebedor\(es\)':|'sineteira\(s\)':/, 'Aliases fixos não podem permanecer no gerador.');
assert.match(styles, /\.badge-sector-name-heading,\.badge-sector-name-row/);
assert.match(styles, /@media\(max-width:720px\)[^{]*\{[^}]*\.badge-sector-name-heading/);

const helperStart = source.indexOf('const normalizeBadgeSectorNames');
const helperEnd = source.indexOf('const copyBadgeProfilesToRetreat', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'Persistência dos nomes de setor não encontrada.');
const helperSource = source.slice(helperStart, helperEnd);
const existingId = 'f8321f58-71ca-40df-a164-6495cd409cce';
let listedRecords = [];
const savedRecords = [];
const context = {
  badgeAssignmentUuidPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  badgeSectorNamesType: 'sector-display-names',
  createId: () => '9d91f0ce-2f25-4f2a-a01c-7c46c734fe44',
  dataService: {
    listCrachas: async () => listedRecords,
    saveCracha: async (record) => { savedRecords.push(record); return record; },
  },
};
vm.runInNewContext(`${helperSource};globalThis.badgeSectorNameTests={normalizeBadgeSectorNames,loadBadgeSectorNames,saveBadgeSectorNames};`, context);
const helpers = context.badgeSectorNameTests;

(async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.normalizeBadgeSectorNames({ Cozinha: '  COZINHA  ', Secretaria: '  ', '': 'Inválido' }))), { Cozinha: 'COZINHA' });
  listedRecords = [
    { id: existingId, retiroId: 'retiro-a', tipo: 'sector-display-names', names: { Cozinha: 'COZINHA CENTRAL' }, updatedAt: '2026-08-07T10:00:00Z' },
    { id: 'a8321f58-71ca-40df-a164-6495cd409cce', retiroId: 'retiro-b', tipo: 'sector-display-names', names: { Cozinha: 'OUTRO RETIRO' } },
  ];
  const loaded = await helpers.loadBadgeSectorNames('retiro-a');
  assert.equal(loaded.id, existingId);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.names)), { Cozinha: 'COZINHA CENTRAL' });
  await helpers.saveBadgeSectorNames('retiro-a', { Cozinha: ' COZINHA CENTRAL ', Secretaria: '' }, existingId);
  assert.equal(savedRecords[0].id, existingId);
  assert.equal(savedRecords[0].retiroId, 'retiro-a');
  assert.equal(savedRecords[0].tipo, 'sector-display-names');
  assert.deepEqual(JSON.parse(JSON.stringify(savedRecords[0].names)), { Cozinha: 'COZINHA CENTRAL' });
  console.log('Crachás: nomes de setores por retiro, fallback e persistência validados.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
