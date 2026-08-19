const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.match(appSource, /id="badge-profile-trigger"[^>]*aria-haspopup="listbox"/);
assert.match(appSource, /id="badge-profile-menu" role="listbox" hidden/);
assert.match(appSource, /badge-profile-thumbnail[^`]*sampleBadgeCard\(thumbnailSettings\)/);
assert.match(appSource, /profileTrigger\?\.addEventListener\('focus'/, 'A lista deve abrir quando o campo recebe foco.');
assert.match(appSource, /let suppressProfileFocusOpen = false;/, 'O foco programático após selecionar modelo não deve reabrir a lista.');
assert.match(appSource, /data-badge-profile-choice/);
assert.match(appSource, /configSelect\.value = option\.dataset\.badgeProfileChoice/);
assert.match(appSource, /loadSelectedProfile\(\)/, 'A escolha visual deve reutilizar o carregamento atual do modelo.');
assert.match(appSource, /setProfileMenuOpen\(false\);[\s\S]*loadSelectedProfile\(\);[\s\S]*suppressProfileFocusOpen = true;[\s\S]*profileTrigger\.focus\(\);/, 'Ao selecionar um modelo, a lista deve fechar e permanecer fechada.');
assert.match(appSource, /ArrowDown/);
assert.match(appSource, /Escape/);
assert.match(styles, /\.badge-profile-menu \{/);
assert.match(styles, /\.badge-profile-thumbnail \.badge-card/);

console.log('Crachás: seletor visual de modelos com miniaturas validado.');
