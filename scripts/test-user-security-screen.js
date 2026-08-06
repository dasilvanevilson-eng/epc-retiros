const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const authSource = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const screenStart = adminSource.indexOf('async function renderUsuariosSeguranca');
const screenEnd = adminSource.indexOf('async function ensureAuthenticated', screenStart);
assert(screenStart >= 0 && screenEnd > screenStart, 'Nova tela de segurança de usuários não encontrada.');
const screen = adminSource.slice(screenStart, screenEnd);

assert.match(screen, /Segurança e acessos/);
assert.match(screen, /Usuários ativos[\s\S]*Inativos[\s\S]*Administradores/);
assert.doesNotMatch(screen, /Último acesso|Acesso restrito/);
assert.match(screen, /const pageSize = 6/);
assert.match(screen, /Buscar por nome ou login/);
assert.match(screen, /data-access-filter="all"[\s\S]*data-access-filter="active"[\s\S]*data-access-filter="inactive"/);
assert.match(screen, /Dados do usuário[\s\S]*Retiros vinculados[\s\S]*Permissões/);
assert.match(screen, /permission\.id === 'retiros\.ver' \? 'Links de cadastro'/);
assert.match(screen, /permission\.id\.startsWith\('retiros\.'\) \? 'Configurações'/);
assert.match(screen, /Copiar acessos de outro usuário/);
assert.match(screen, /Princípio do menor privilégio/);
assert.match(screen, /user\.id === currentDatabaseUserId/);
assert.match(screen, /isSelf \? editingUser\.perfilId/);
assert.match(screen, /isSelf \? true/);
assert.match(screen, /data-delete-access-user[\s\S]*isSelf \? 'disabled/);
assert.match(styles, /\.access-v2-layout \{[\s\S]*grid-template-columns:minmax\(300px,360px\) minmax\(0,1fr\)/);
assert.match(styles, /@media\(max-width:780px\)[\s\S]*\.access-v2-summary,\.access-v2-layout \{ grid-template-columns:1fr/);
assert.match(styles, /\.access-v2-editor-actions \{[\s\S]*position:sticky/);
assert.match(styles, /\.access-v2-permission-item\.is-danger/);
assert.match(authSource, /protectOwnAdministrativeAccess/);
assert.match(apiSource, /saveAccessUser\(incoming, session\)/);
assert.match(apiSource, /deleteAccessUser\(decodeURIComponent\(action\), session\)/);

const databasePath = require.resolve('../databaseAdapter');
const authPath = require.resolve('../auth');
const originalDatabaseModule = require.cache[databasePath];
const originalAuthModule = require.cache[authPath];
const records = new Map([
  ['usuarios', [{ id: 'self-admin', nome: 'Admin Atual', login: 'admin', perfilId: 'admin', ativo: true, passwordHash: 'hash', passwordSalt: 'salt', passwordIterations: 1 }]],
  ['perfis', [{ id: 'admin', nome: 'Admin', codigo: 'admin' }, { id: 'coordenador_retiro', nome: 'Coordenador', codigo: 'coordenador_retiro' }]],
  ['permissoes', []],
  ['perfil_permissoes', []],
  ['usuario_permissoes', []],
  ['usuario_retiros', []],
]);
const listRecords = async (store) => [...(records.get(store) || [])];
const saveRecord = async (store, record) => {
  const rows = records.get(store) || [];
  const index = rows.findIndex((item) => item.id === record.id);
  if (index >= 0) rows[index] = { ...record }; else rows.push({ ...record });
  records.set(store, rows);
  return { ...record };
};
const deleteRecord = async (store, id) => {
  records.set(store, (records.get(store) || []).filter((item) => item.id !== id));
};

require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { listRecords, saveRecord, deleteRecord } };
delete require.cache[authPath];
const { allPermissions } = require('../permissions');
const securedAuth = require('../auth');
const session = { id: 'self-admin', sub: 'admin' };
const allPermissionValues = allPermissions.map(([id]) => ({ permissaoId: id, permitido: true }));
const baseUpdate = { id: 'self-admin', nome: 'Admin Atual', login: 'admin', perfilId: 'admin', ativo: true, permissions: allPermissionValues, retiroIds: [] };

(async () => {
  await assert.rejects(() => securedAuth.deleteAccessUser('self-admin', session), /proprio usuario/);
  await assert.rejects(() => securedAuth.saveAccessUser({ ...baseUpdate, ativo: false }, session), /desativar o proprio usuario/);
  await assert.rejects(() => securedAuth.saveAccessUser({ ...baseUpdate, perfilId: 'coordenador_retiro' }, session), /alterar o proprio perfil/);
  await assert.rejects(() => securedAuth.saveAccessUser({ ...baseUpdate, permissions: allPermissionValues.map((item) => item.permissaoId === 'usuarios.ver' ? { ...item, permitido: false } : item) }, session), /retirar as proprias permissoes/);
  const saved = await securedAuth.saveAccessUser({ ...baseUpdate, nome: 'Admin Protegido' }, session);
  assert.equal(saved.nome, 'Admin Protegido');
  assert.equal(saved.passwordHash, undefined, 'Hash de senha nunca deve ser devolvido.');
  assert.equal(records.get('usuarios').length, 1, 'Os testes não podem criar ou apagar usuários reais.');
  console.log('Usuários: tela responsiva, permissões amigáveis e autoproteção na API validadas.');
})().finally(() => {
  delete require.cache[authPath];
  if (originalAuthModule) require.cache[authPath] = originalAuthModule;
  if (originalDatabaseModule) require.cache[databasePath] = originalDatabaseModule; else delete require.cache[databasePath];
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
