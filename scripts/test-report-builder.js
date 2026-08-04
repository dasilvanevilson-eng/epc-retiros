const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateSpec } = require('../reportService');
const { permissionsForRole } = require('../permissions');

const defaults = validateSpec({});
assert.strictEqual(defaults.dataset, 'equipe');
assert.deepStrictEqual(defaults.statuses, ['concluido']);

const hostile = validateSpec({
  dataset: 'nao-existe',
  statuses: ['publicado', 'invalido'],
  columns: ['nome', 'senha', 'nome'],
  groupBy: ['retiro', 'setor', 'cidade', 'cpf'],
  filters: [{ field: 'nome', operator: 'contains', value: 'Ana' }, { field: 'senha', operator: 'equals', value: 'x' }],
  sort: [{ field: 'nome', direction: 'desc' }, { field: 'sql', direction: 'asc' }],
  chart: '<script>',
  locations: ['Indaial', '', 'Indaial'],
  pageSize: 5000,
});
assert.strictEqual(hostile.dataset, 'equipe');
assert.deepStrictEqual(hostile.statuses, ['publicado']);
assert.deepStrictEqual(hostile.columns, ['nome']);
assert.strictEqual(hostile.groupBy.length, 3);
assert.strictEqual(hostile.filters.length, 1);
assert.strictEqual(hostile.sort.length, 1);
assert.strictEqual(hostile.chart, 'bar');
assert.strictEqual(hostile.pageSize, 100);
assert.deepStrictEqual(hostile.locations, ['Indaial']);
assert(permissionsForRole('admin').includes('relatorios.ver'));
assert(!permissionsForRole('coordenador_geral').includes('relatorios.ver'));

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase-relatorios-migration.sql'), 'utf8');
assert.match(migration, /^--[\s\S]*\nbegin;/i);
assert.match(migration, /create table if not exists public\.relatorio_modelos/i);
assert.match(migration, /relatorios\.ver/i);
assert.match(migration, /revoke all on public\.relatorio_modelos from anon, authenticated/i);
assert.doesNotMatch(migration, /\btruncate\b|\bdrop\s+table\b|\bdelete\s+from\b|\bupdate\s+public\.(retiros|pessoas|adesoes|cursistas|cursista_smp|cursista_epc)\b/i);

const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
assert.match(api, /resource === 'reports'[\s\S]*denyIfMissingPermission\(res, session, 'relatorios\.ver'\)/);
assert.match(api, /current\.usuarioId !== session\.id/);
assert.match(api, /buildReport\(await readBody\(req\), reportRetreatIds/);
assert.match(api, /buildReport\(await readBody\(req\), reportRetreatIds, \{ exportAll: true \}\)/);

const frontend = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
assert.match(frontend, /relatorios: 'relatorios\.ver'/);
assert.match(frontend, /async function renderRelatorios\(\)/);
assert.match(frontend, /data-report-step="\$\{step\}"/);
assert.match(frontend, /data-report-action="csv"/);

console.log('Relatorios: validacao, permissao, migracao aditiva e protecoes de API validadas.');
