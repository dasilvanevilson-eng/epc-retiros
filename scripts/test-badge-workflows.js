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
const sectorNamesPosition = startPanel.indexOf('data-badge-view="sector-names"');
const configPosition = startPanel.indexOf('data-badge-view="config"');
assert(printPosition >= 0 && printPosition < assignmentPosition && assignmentPosition < sectorNamesPosition && sectorNamesPosition < configPosition, 'As quatro opções devem aparecer na ordem definida.');
assert.match(startPanel, /<strong>Imprimir<\/strong><span>/);
assert.match(startPanel, /<strong>Definir crach&aacute;s por setor\/comunidade<\/strong><span>/);
assert.match(startPanel, /<strong>Personalizar nome do setor no crach&aacute;<\/strong><span>/);
assert.match(startPanel, /<strong>Configurar crach&aacute;s<\/strong><span>/);

assert.match(appSource, /id="badge-config-toolbar" hidden>[\s\S]*?data-badge-home>Voltar<\/button>/);
assert.match(appSource, /id="badge-print-panel" hidden>[\s\S]*?data-badge-home>Voltar<\/button>/);
assert.match(appSource, /badge-sector-model-page[^`]*data-badge-home>Voltar<\/button>/);
assert.match(appSource, /badge-sector-name-page[^`]*data-badge-home>Voltar<\/button>/);
assert.doesNotMatch(appSource, /badge-view-switch" data-badge-view/, 'Não deve haver atalho direto entre os fluxos.');
assert.match(appSource, /\['config', 'assignments'\]\.includes\(view\) && !canConfigureBadges/);
assert.match(appSource, /view === 'sector-names' && !canViewBadgeSectorNames/);
assert.match(appSource, /view === 'print' && !canPrintBadges/);
assert.match(appSource, /assignmentPanel\.hidden = !isAssignment/);
assert.match(appSource, /sectorNamePanel\.hidden = !isSectorNames/);
assert.match(appSource, /workbench\.hidden = isStandalonePanel/);
assert.match(appSource, /showBadgeView\(''\)/);
assert.match(appSource, /<label class="field"><span>Texto superior<\/span><textarea name="topText" rows="2">/, 'O editor deve permitir informar duas linhas no texto superior.');
assert.match(appSource, /<label class="field"><span>Slogan do rodap&eacute;<\/span><textarea name="slogan" rows="2">/, 'O editor deve permitir informar duas linhas no slogan.');
assert.match(appSource, /const twoLineBadgeText = \(value = ''\) =>/, 'Textos multilinha do crachá devem ser normalizados.');
assert.match(appSource, /next\.topText = twoLineBadgeText\(next\.topText\);[\s\S]*next\.slogan = twoLineBadgeText\(next\.slogan\);/, 'Texto superior e slogan devem salvar no máximo duas linhas.');
assert.match(appSource, /<option value="topText"[^>]*>Texto Superior<\/option>/, 'O seletor Alterar deve incluir Texto Superior.');
assert.match(appSource, /topText: \{ font: 'topTextFont', align: 'topTextAlign', size: 'topTextSize', color: 'topTextColor' \}/, 'Texto Superior deve ter controles proprios de fonte, alinhamento, tamanho e cor.');
assert.match(appSource, /<header>\$\{escapeHtml\(settings\.topText \|\| ''\)\}<\/header>/, 'O crachá deve renderizar o texto superior acima do nome.');
assert.match(styles, /\.badge-card \{[^}]*grid-template-rows:auto 1fr auto/, 'O crachá deve reservar faixas para texto superior, conteúdo e rodapé.');
assert.match(styles, /\.badge-card header \{[^}]*--badge-top-text/, 'O texto superior deve ter estilo proprio no topo do crachá.');
assert.match(styles, /\.badge-card header \{[^}]*white-space:pre-line/, 'O texto superior deve preservar quebras de linha.');
assert.match(styles, /\.badge-card footer \{[^}]*white-space:pre-line/, 'O slogan deve preservar quebras de linha.');

const assignmentFunctionStart = appSource.indexOf('const renderBadgeAssignmentsPanel');
const assignmentFunctionEnd = appSource.indexOf('const renderBadgeSectorNamesPanel', assignmentFunctionStart);
const assignmentFunction = appSource.slice(assignmentFunctionStart, assignmentFunctionEnd);
assert.doesNotMatch(assignmentFunction, /document\.createElement|receiver-sector-overlay|app\.append/, 'A definição por setor deve ser um painel da página, não um modal.');

assert.match(styles, /\.badge-start-panel \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(styles, /\.badge-start-option \{/);
assert.match(styles, /@media\(max-width:820px\) \{ \.badge-start-panel \{ grid-template-columns:1fr/);
assert.match(styles, /\.badge-assignment-panel,\.badge-sector-name-panel \{/);
assert.match(styles, /\.badge-active-area\[hidden\],\.badge-active-area \[hidden\] \{ display:none !important; \}/);

console.log('Crachás: menu e quatro fluxos independentes validados.');
