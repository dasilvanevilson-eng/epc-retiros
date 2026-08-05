const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

(async () => {
const migration = await readFile(path.join(__dirname, '..', 'supabase-adesao-espaco-kids-cuidados.sql'), 'utf8');
const app = await readFile(path.join(__dirname, '..', 'adminApp.js'), 'utf8');
const adapter = await readFile(path.join(__dirname, '..', 'databaseAdapter.js'), 'utf8');

assert.doesNotMatch(migration, /\b(update|delete\s+from|truncate|drop\s+table|insert\s+into)\b/i,
  'A migracao da Equipe nao pode modificar dados historicos.');
for (const column of ['problema_saude', 'descricao_saude', 'intolerancia_alimentar', 'descricao_intolerancia']) {
  assert.match(migration, new RegExp(`add column if not exists ${column}\\b`, 'i'), `Coluna ausente na migracao: ${column}`);
  assert.match(adapter, new RegExp(`\\b${column}\\b`), `Campo ausente no adaptador: ${column}`);
}

for (const field of ['kidProblemaSaude', 'kidDescricaoSaude', 'kidIntolerancia', 'kidDescricaoIntolerancia']) {
  assert.match(app, new RegExp(`${field}\\$\\{kidNumber\\}`), `Geracao dos campos ausente: ${field}`);
}

assert.match(app, /legacyKidCare/, 'Compatibilidade com criancas historicas nao encontrada.');
assert.match(app, /kidExceedsRetreatAgeLimit/, 'A validacao de idade existente deve permanecer no formulario.');
assert.match(app, /canUseInternalKidAgeLimitException/, 'A excecao interna de idade deve permanecer no formulario.');

console.log('Espaco Kids da Equipe: estrutura, persistencia e migracao aditiva validadas.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
