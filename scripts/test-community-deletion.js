const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase-relational-schema.sql'), 'utf8');
const smpMigration = fs.readFileSync(path.join(root, 'supabase-comunidade-cursistas-smp.sql'), 'utf8');
const epcMigration = fs.readFileSync(path.join(root, 'supabase-cursista-epc-migration.sql'), 'utf8');
const communitiesStart = app.indexOf('async function renderComunidades');
const communitiesEnd = app.indexOf('\nconst badgeSettingsKey', communitiesStart);
const communities = app.slice(communitiesStart, communitiesEnd);
const deletionStart = communities.indexOf("app.querySelectorAll('[data-delete-community]')");
const deletionEnd = communities.indexOf("app.querySelector('#distribute-students')", deletionStart);
const deletion = communities.slice(deletionStart, deletionEnd);

assert(communitiesStart >= 0 && communitiesEnd > communitiesStart, 'A tela de Comunidades deve existir.');
assert.doesNotMatch(communities, /data-delete-community="\$\{community\.id\}"[^>]*disabled/, 'Comunidades preenchidas também devem permitir a exclusão do agrupamento.');
assert.match(deletion, /Somente o agrupamento será excluído/, 'A confirmação deve explicar o alcance restrito da exclusão.');
assert.match(deletion, /Nenhum cadastro de cursista, adesão, pessoa ou casal será excluído/, 'A confirmação deve informar que os cadastros são preservados.');
assert.match(deletion, /dataService\.deleteComunidade\(community\.id\)/, 'A ação deve excluir somente o registro da comunidade.');
assert.doesNotMatch(deletion, /deleteCursista|deleteAdesao|deletePessoa|deleteCasal|deleteRecord/, 'A interface não pode excluir cadastros relacionados.');
assert.match(deletion, /await renderComunidades\(\)/, 'A tela deve recalcular cursistas sem comunidade e papéis disponíveis após a exclusão.');
assert.match(communities, /const assignedStudentIds = new Set\(communities\.flatMap\(memberIdsFor\)/, 'Cursistas sem comunidade devem ser recalculados somente a partir dos agrupamentos restantes.');
assert.match(communities, /const assignedLeaderIds = new Set\(communities\.map/, 'Tios disponíveis devem ser recalculados somente a partir dos agrupamentos restantes.');

assert.match(adapter, /async function deleteRecord\(storeName, id\) \{[\s\S]*if \(!hasSupabase\(\)\) throw supabaseRequiredError\(\);[\s\S]*return deleteRelational\(storeName, id\);[\s\S]*\}/, 'A exclusão deve ocorrer exclusivamente no Supabase.');
assert.doesNotMatch(adapter, /writeFileDatabase|readFileDatabase/, 'A exclusão não pode possuir fallback para database\/db.json.');
assert.match(schema, /comunidade_id uuid not null references public\.comunidades\(id\) on delete cascade[\s\S]*cursista_id uuid not null references public\.cursistas\(id\) on delete cascade/i, 'A exclusão da comunidade deve remover somente o vínculo com cursistas individuais.');
assert.match(schema, /lider_casal_id uuid references public\.casais\(id\) on delete set null[\s\S]*monitor_casal_id uuid references public\.casais\(id\) on delete set null/i, 'Tios e monitores devem permanecer cadastrados independentemente da comunidade.');
assert.match(smpMigration, /foreign key \(comunidade_id, retiro_id\)[\s\S]*references public\.comunidades\(id, retiro_id\)[\s\S]*on delete cascade/i, 'O vínculo SMP deve ser removido junto do agrupamento, preservando a ficha SMP.');
assert.match(epcMigration, /foreign key \(comunidade_id, retiro_id\)[\s\S]*references public\.comunidades\(id, retiro_id\)[\s\S]*on delete cascade/i, 'O vínculo EPC deve ser removido junto do agrupamento, preservando a ficha EPC.');

console.log('Comunidades: exclusao exclusiva do agrupamento e preservacao dos cadastros validadas.');
