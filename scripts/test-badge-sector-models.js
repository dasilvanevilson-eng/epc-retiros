const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.match(appSource, /const badgeSectorAssignmentsType = 'sector-model-assignments'/);
assert.match(appSource, /profile\.tipo !== badgeSectorAssignmentsType/, 'A configuração por setor não pode aparecer como modelo de crachá.');
assert.match(appSource, /id="badge-sector-models-tab">Definir crach&aacute; por Setor/);
assert.match(appSource, /badge-sector-model-heading[^`]*Setor[^`]*Buscar e selecionar modelo/);
assert.match(appSource, /sectors\.map\(\(sector\) => `<div class="badge-sector-model-row"/);
assert.match(appSource, /data-badge-sector-model-search/);
assert.match(appSource, /data-badge-sector-model-select/);
assert.match(appSource, /saveBadgeSectorAssignments\(retreat\.id, assignments\)/);
assert.match(appSource, /badgeSectorAssignments = assignments/);
assert.match(appSource, /applyAssignedSectorProfile\(sector\)/, 'A impressão por setor deve aplicar automaticamente o modelo salvo.');
assert.match(appSource, /profileId === profile\.id \? '' : profileId/, 'A exclusão de um modelo deve limpar seus vínculos.');
assert.match(styles, /\.badge-sector-model-heading,\.badge-sector-model-row/);
assert.match(styles, /grid-template-columns:minmax\(180px,.75fr\) minmax\(320px,1.25fr\)/);

console.log('Crachás: definição e persistência de modelo por setor validadas.');
