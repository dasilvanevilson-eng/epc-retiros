const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase-cursista-epc-migration.sql'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const dataService = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');

assert.match(migration, /^--[\s\S]*\nbegin;/i, 'A migracao EPC deve usar transacao explicita.');
assert.match(migration, /create table if not exists public\.cursista_epc/i);
assert.match(migration, /create table if not exists public\.comunidade_cursistas_epc/i);
assert.match(migration, /primary key \(retiro_id, id\)/i);
assert.match(migration, /references public\.cursista_epc\(retiro_id, id\)[\s\S]*?on delete cascade/i);
assert.match(migration, /references public\.comunidades\(id, retiro_id\)[\s\S]*?on delete cascade/i);
assert.match(migration, /tipo_ficha is distinct from 'cursista-epc'/i);
assert.match(migration, /tipo_ficha is distinct from 'cursista-smp'/i);
assert.doesNotMatch(migration, /\btruncate\b|\bdrop\s+table\b|\bdelete\s+from\b|\binsert\s+into\s+public\.cursista_smp\b/i,
  'A instalacao EPC nao pode remover, copiar ou alterar fichas historicas.');

const requiredColumns = [
  'ele_nome', 'ele_nascimento', 'ele_cpf', 'ele_profissao', 'ele_fone', 'ele_crisma', 'ele_movimento_igreja',
  'ele_qual_movimento', 'ele_problema_saude', 'ele_qual_problema_saude', 'ele_intolerancia_alimentar',
  'ele_qual_intolerancia_alimentar', 'ele_manequim', 'ela_nome', 'ela_nascimento', 'ela_cpf', 'ela_profissao',
  'ela_fone', 'ela_crisma', 'ela_movimento_igreja', 'ela_qual_movimento', 'ela_problema_saude',
  'ela_qual_problema_saude', 'ela_intolerancia_alimentar', 'ela_qual_intolerancia_alimentar', 'ela_manequim',
  'comum_email', 'comum_data_casamento_religioso', 'comum_local_casamento', 'comum_tem_filhos',
  'comum_idade_filhos', 'comum_contato_emergencia', 'comum_fone_emergencia', 'comum_valor_inscricao',
  'comum_valor_pago', 'comum_saldo_pagar', 'extras',
];
for (const column of requiredColumns) assert.match(migration, new RegExp(`\\b${column}\\b`, 'i'), `Coluna EPC ausente: ${column}`);
for (let kid = 1; kid <= 5; kid += 1) {
  for (const suffix of ['nome', 'nascimento', 'problema_saude', 'descricao_saude', 'intolerancia_alimentar', 'descricao_intolerancia']) {
    assert.match(migration, new RegExp(`\\bcomum_kid_${kid}_${suffix}\\b`, 'i'), `Campo da crianca ${kid} ausente: ${suffix}`);
  }
}

for (const method of ['listCursistasEpc', 'saveCursistaEpc', 'deleteCursistaEpc']) {
  assert.match(adapter, new RegExp(`function ${method}\\b`));
  assert.match(dataService, new RegExp(`${method}:`));
  assert.match(admin, new RegExp(`dataService\\.${method}`));
}
assert.match(api, /resource === 'cursista-smp' \|\| resource === 'cursista-epc'/);
assert.match(adapter, /upsert\('cursista_epc'/);
assert.match(adapter, /cursista_epc\?retiro_id=/);
assert.match(adapter, /membroEpcIds:/);
assert.match(adapter, /syncEpcCommunityMembers/);
assert.match(adapter, /upsert\('comunidade_cursistas_epc'/);
assert.match(dataService, /membershipType === 'epc' \? 'membroEpcIds'/);
assert.match(admin, /studentFormType === 'cursista-epc' \? 'membroEpcIds'/);
assert.match(admin, /setupCoupleStudentFinancialSummary\('cursista-epc'\)/);
assert.match(admin, /const coupleStudentSource =/);
assert.match(admin, /list: isEpc \? dataService\.listCursistasEpc : dataService\.listCursistasSmp/);
assert.match(admin, /coupleStudentSource\(activeStudentFormType\)\.list/);
assert.doesNotMatch(admin, /Cursista EPC ainda indisponível/);

console.log('Cursista EPC: migracao aditiva, colunas, adaptador, API e tela validados.');
