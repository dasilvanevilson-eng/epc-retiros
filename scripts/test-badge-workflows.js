const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const startPanelStart = appSource.indexOf('<section class="panel badge-start-panel"');
const startPanelEnd = appSource.indexOf('</section>', startPanelStart);
assert(startPanelStart >= 0 && startPanelEnd > startPanelStart, 'Menu inicial de crachás não encontrado.');
const startPanel = appSource.slice(startPanelStart, startPanelEnd);
const printPosition = startPanel.indexOf('data-badge-view="print"');
const assignmentPosition = startPanel.indexOf('data-badge-view="assignments"');
const configPosition = startPanel.indexOf('data-badge-view="config"');
assert(printPosition >= 0 && printPosition < assignmentPosition && assignmentPosition < configPosition, 'As três opções devem aparecer na ordem solicitada.');
assert.match(startPanel, /<strong>Imprimir<\/strong><span>/);
assert.match(startPanel, /<strong>Definir crach&aacute;s por setor<\/strong><span>/);
assert.match(startPanel, /<strong>Configurar crach&aacute;s<\/strong><span>/);

assert.match(appSource, /id="badge-config-toolbar" hidden>[\s\S]*?data-badge-home>Voltar<\/button>/);
assert.match(appSource, /id="badge-print-panel" hidden>[\s\S]*?data-badge-home>Voltar<\/button>/);
assert.match(appSource, /badge-sector-model-page[^`]*data-badge-home>Voltar<\/button>/);
assert.doesNotMatch(appSource, /badge-view-switch" data-badge-view/, 'Não deve haver atalho direto entre os fluxos.');

assert.match(appSource, /\['config', 'assignments'\]\.includes\(view\) && !canConfigureBadges/);
assert.match(appSource, /view === 'print' && !canPrintBadges/);
assert.match(appSource, /assignmentPanel\.hidden = !isAssignment/);
assert.match(appSource, /workbench\.hidden = isAssignment/);
assert.match(appSource, /showBadgeView\(''\)/);

const assignmentFunctionStart = appSource.indexOf('const renderBadgeAssignmentsPanel');
const assignmentFunctionEnd = appSource.indexOf('const deleteCurrentProfile', assignmentFunctionStart);
const assignmentFunction = appSource.slice(assignmentFunctionStart, assignmentFunctionEnd);
assert.doesNotMatch(assignmentFunction, /document\.createElement|receiver-sector-overlay|app\.append/, 'A definição por setor deve ser um painel da página, não um modal.');

assert.match(styles, /\.badge-start-panel \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(styles, /\.badge-start-option \{/);
assert.match(styles, /@media\(max-width:820px\) \{ \.badge-start-panel \{ grid-template-columns:1fr/);
assert.match(styles, /\.badge-assignment-panel \{/);
assert.match(styles, /\.badge-active-area\[hidden\],\.badge-active-area \[hidden\] \{ display:none !important; \}/);

console.log('Crachás: menu e três fluxos independentes validados.');
