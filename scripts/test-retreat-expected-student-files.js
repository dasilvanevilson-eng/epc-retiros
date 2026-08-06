const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');

const normalizerDeclaration = app.match(/const normalizeExpectedStudentFileCount = \(value\) => \{[\s\S]*?\n\};/)?.[0] || '';
assert(normalizerDeclaration, 'A normalizacao da previsao de fichas deve existir.');
const normalize = Function(`${normalizerDeclaration}; return normalizeExpectedStudentFileCount;`)();
assert.strictEqual(normalize(''), 0);
assert.strictEqual(normalize(0), 0);
assert.strictEqual(normalize('80'), 80);
assert.strictEqual(normalize('-1'), 0);
assert.strictEqual(normalize('2.5'), 0);

const fieldPattern = /<span>Número previsto de fichas de cursista<\/span><input name="numeroPrevistoFichasCursista" type="number" min="0" step="1" inputmode="numeric"/g;
assert.strictEqual((app.match(fieldPattern) || []).length, 2, 'O campo deve existir na criação e na edição do retiro.');
assert.match(app, /form\.elements\.numeroPrevistoFichasCursista\.value = source\?\.numeroPrevistoFichasCursista \?\? ''/, 'A cópia de estrutura deve carregar a previsão.');
assert.match(app, /numeroPrevistoFichasCursista: normalizeExpectedStudentFileCount\(values\.get\('numeroPrevistoFichasCursista'\)\)/, 'A criação deve salvar o valor normalizado.');
assert.match(app, /value="\$\{escapeHtml\(retreat\.numeroPrevistoFichasCursista \|\| ''\)\}"/, 'A edição deve carregar o valor existente.');

const mappedKeys = adapter.match(/const mappedKeys = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
assert(!mappedKeys.includes('numeroPrevistoFichasCursista'), 'A previsão deve permanecer em extras, sem exigir coluna ou migration.');
assert.match(adapter, /numeroPrevistoFichasCursista: Math\.max\(0, Math\.trunc\(Number\(record\.numeroPrevistoFichasCursista\) \|\| 0\)\)/, 'O adaptador deve persistir um inteiro não negativo em extras.');

console.log('Retiro: número previsto de fichas de cursista validado na criação, edição, cópia e persistência complementar.');
