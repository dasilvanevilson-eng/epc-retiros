const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.match(appSource, /id="badge-print-by-sector">Impress&atilde;o por setor<\/button>/);
assert.match(appSource, /id="badge-print-by-community">Impress&atilde;o por comunidade<\/button>/);
assert.doesNotMatch(appSource, /id="badge-mode"|id="badge-sector"|id="badge-person"/, 'Os seletores antigos de impressão devem ser removidos.');
assert.match(appSource, /openBadgeGroupPicker\('sector'\)/);
assert.match(appSource, /openBadgeGroupPicker\('community'\)/);

const pickerStart = appSource.indexOf('const printGroups =');
const pickerEnd = appSource.indexOf('const syncColorCaptions', pickerStart);
assert(pickerStart >= 0 && pickerEnd > pickerStart, 'Fluxo de seleção múltipla não encontrado.');
const pickerSource = appSource.slice(pickerStart, pickerEnd);

assert.match(pickerSource, /data-badge-group-choice="\$\{index\}"/);
assert.match(pickerSource, /const selectedGroupKeys = new Set\(\)/);
assert.match(pickerSource, /data-badge-select-all>Selecionar todos/);
assert.match(pickerSource, /data-badge-clear-selection>Limpar sele&ccedil;&atilde;o/);
assert.match(pickerSource, /data-badge-review-groups disabled>Continuar/);
assert.match(pickerSource, /continueButton\.disabled = selectedGroupKeys\.size === 0/);
assert.match(pickerSource, /renderMemberReview\(items\)/);
assert.match(pickerSource, /data-badge-print-entry="\$\{index\}" checked/);
assert.match(pickerSource, /data-badge-back>/);
assert.match(pickerSource, /preparedGroups\.flatMap/, 'Os vínculos dos grupos devem ser mantidos sem deduplicação entre grupos.');
assert.match(pickerSource, /badgeProfiles\.find\(\(profile\) => profile\.id === assignedId\)[\s\S]*badgeProfiles\.find\(\(profile\) => profile\.id === printModelSelect\?\.value\)/, 'O modelo associado deve ter prioridade sobre o modelo padrão.');
assert.match(pickerSource, /const missingGroups =/);
assert.match(pickerSource, /Selecione um modelo padrão ou defina um modelo para:/);
assert.match(pickerSource, /profileId: profile\.id/);
assert.match(pickerSource, /badgeSettings/);

assert.match(appSource, /page\.map\(\(\{ entry, sector, badgeSettings, groupType \}\) => badgeCard\(entry, badgeSettings \|\| next, sector, badgeSectorNames, groupType !== 'community'\)\)/);
assert.match(styles, /\.badge-print-controls > button/);
assert.match(styles, /\.badge-multi-print-dialog/);
assert.match(styles, /\.badge-print-group-list label/);

console.log('Crachás: seleção múltipla, modelos e nomes de setor por grupo validados.');
