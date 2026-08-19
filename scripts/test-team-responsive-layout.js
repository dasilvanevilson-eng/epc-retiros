const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.match(
  admin,
  /const publicShellClass = embedded \? 'public-shell team-registration-shell embedded-registration-shell' : 'public-shell team-registration-shell external-registration-shell'/,
  'Os dois acessos devem compartilhar a nova linguagem visual sem duplicar o formulario.',
);

assert.match(styles, /\.team-registration-shell #public-form > \.form-section \.section-heading h2[\s\S]*text-transform:uppercase/);
assert.match(styles, /\.team-registration-shell #public-form > \.form-section:has\(\[name="retiros"\]\) \.section-heading h2 \{[\s\S]*text-transform:none/);
assert.match(admin, new RegExp('<h2>Quais retiros fez como CURSISTA na Fam\\u00edlia EPC\\?</h2>'), 'O titulo deve preservar exatamente as maiusculas e minusculas definidas.');
assert.match(styles, /\.embedded-registration-shell #public-form \{[\s\S]*grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(styles, /@media\(max-width:980px\)[\s\S]*\.embedded-registration-shell #public-form \{[\s\S]*grid-template-columns:1fr/);
assert.match(styles, /@media\(max-width:720px\)[\s\S]*\.external-registration-shell #public-form \.fields\.two-columns,[\s\S]*grid-template-columns:1fr/);
assert.match(styles, /\.external-registration-shell #public-form input,[\s\S]*min-height:48px/);
assert.match(styles, /\.external-registration-shell #public-form > \.form-actions \{[\s\S]*position:sticky/);

const publicFormSource = admin.slice(admin.indexOf('async function renderPublicForm'), admin.indexOf('\nasync function renderPublicSectorPage'));
for (const flowMarker of [
  'wireCpfFields(form)',
  'wireTypedBirthDates(form)',
  "form.addEventListener('submit'",
  'saveTeamCouple',
  'saveAdesao',
]) {
  assert.match(publicFormSource, new RegExp(flowMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `O fluxo existente deve manter ${flowMarker}.`);
}

console.log('Equipe de trabalho: layout desktop logado e mobile publico validados sem alterar o fluxo.');
