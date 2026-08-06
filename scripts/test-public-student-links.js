const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  sanitizePublicRetreat,
  studentRegistrationLinkVersion,
  syncStudentRegistrationLinks,
  withSyncedStudentRegistrationLinks,
} = require('../publicStudentLinks');

const base = { id: 'r1', numeroPrevistoFichasCursista: 2 };
const created = withSyncedStudentRegistrationLinks(null, base);
assert.equal(created.linksCadastroCursistas.length, 2);
assert.deepEqual(created.linksCadastroCursistas.map((link) => link.numeroFicha), [1, 2]);
assert(created.linksCadastroCursistas.every((link) => /^[a-f0-9]{48}$/.test(link.token)));
assert(created.linksCadastroCursistas.every((link) => link.versao === studentRegistrationLinkVersion));
assert(created.linksCadastroCursistas.every((link) => link.enviadoPara === ''));
assert.notEqual(created.linksCadastroCursistas[0].token, created.linksCadastroCursistas[1].token);

const increased = {
  ...created,
  numeroPrevistoFichasCursista: 4,
  linksCadastroCursistas: syncStudentRegistrationLinks(created, { ...created, numeroPrevistoFichasCursista: 4 }),
};
assert.equal(increased.linksCadastroCursistas.length, 4);
assert.equal(increased.linksCadastroCursistas[0].token, created.linksCadastroCursistas[0].token);
assert.equal(increased.linksCadastroCursistas[1].token, created.linksCadastroCursistas[1].token);

const reducedLinks = syncStudentRegistrationLinks(increased, { ...increased, numeroPrevistoFichasCursista: 1 });
assert.equal(reducedLinks.length, 4, 'Reduzir a previsao deve preservar links ocultos.');
const restoredLinks = syncStudentRegistrationLinks(
  { ...increased, linksCadastroCursistas: reducedLinks },
  { ...increased, numeroPrevistoFichasCursista: 4 },
);
assert.deepEqual(restoredLinks.map((link) => link.token), increased.linksCadastroCursistas.map((link) => link.token));

const copied = withSyncedStudentRegistrationLinks(null, { ...increased, id: 'r2' });
assert.notEqual(copied.linksCadastroCursistas[0].token, increased.linksCadastroCursistas[0].token);

const legacy = {
  ...base,
  linksSetores: [{ setor: 'Cozinha', cadastroToken: 'equipe-nao-alterar' }],
  linksCadastroCursistas: [
    { numeroFicha: 1, token: 'token-antigo-1', createdAt: '2026-01-01T00:00:00.000Z', enviadoPara: 'Família Silva' },
    { numeroFicha: 2, token: 'token-antigo-2', createdAt: '2026-01-01T00:00:00.000Z' },
    { numeroFicha: 3, token: 'token-antigo-oculto', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
};
const rotated = syncStudentRegistrationLinks(legacy, legacy, { rotateLegacy: true });
assert.equal(rotated.length, 3, 'Links ocultos também devem ser preservados e rotacionados.');
assert(rotated.every((link) => link.versao === studentRegistrationLinkVersion));
assert(rotated.every((link, index) => link.token !== legacy.linksCadastroCursistas[index].token));
assert.equal(rotated[0].enviadoPara, 'Família Silva', 'A rotação deve preservar o destinatário informado.');
const rotatedAgain = syncStudentRegistrationLinks({ ...legacy, linksCadastroCursistas: rotated }, legacy, { rotateLegacy: true });
assert.deepEqual(rotatedAgain.map((link) => link.token), rotated.map((link) => link.token), 'A rotação deve ocorrer somente uma vez.');
assert.equal(legacy.linksSetores[0].cadastroToken, 'equipe-nao-alterar');

const publicRetreat = sanitizePublicRetreat(increased);
assert(!Object.hasOwn(publicRetreat, 'linksCadastroCursistas'));
assert(Object.hasOwn(increased, 'linksCadastroCursistas'), 'A sanitizacao nao deve alterar o objeto original.');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const vercelRoutes = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const localServer = fs.readFileSync(path.join(root, 'localServer.js'), 'utf8');
const publicApp = fs.readFileSync(path.join(root, 'publicStudentApp.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');
assert.match(adminSource, /cadastro-cursista\/ficha\$\{link\.numeroFicha\}\/\$\{encodeURIComponent\(link\.token\)\}/);
assert.match(adminSource, />Enviado para</);
assert.match(adminSource, /Cursista cadastrado/);
assert.match(adminSource, /Casal cadastrado/);
assert.match(adminSource, /saveStudentRegistrationLinkRecipient\(id, numeroFicha, input\.value\)/);
assert.match(vercelRoutes, /cadastro-cursista\/ficha\(\[0-9\]\+\)\/\(\[\^\/\]\+\)/, 'A rota identificada deve preceder a compatibilidade antiga.');
assert.match(vercelRoutes, /cadastro-cursista\/\(\[\^\/\]\+\)/, 'A rota antiga deve permanecer disponível.');
assert.match(localServer, /identified\?\.\[1\][\s\S]*identified\?\.\[2\][\s\S]*legacy\?\.\[1\]/, 'O servidor local deve aceitar os dois formatos.');
assert.match(publicApp, /expectedFileNumber[\s\S]*O número da ficha não corresponde a este link/, 'A página deve rejeitar identificação divergente.');
assert.match(apiSource, /prepareStudentRegistrationLinkSync\(current\)[\s\S]*saveRetreatStudentRegistrationLinks\(retreatId, syncResult\.links\)/, 'A API deve auditar antes de usar a atualização dedicada.');
assert.match(apiSource, /action === 'destinatario'[\s\S]*denyIfMissingPermission\(res, session, 'retiros\.editar'\)[\s\S]*saveRetreatStudentRegistrationLinks\(retreatId, updatedLinks\)/, 'O destinatário deve usar permissão de edição e atualização dedicada.');
const dedicatedUpdate = adapterSource.slice(adapterSource.indexOf('async function saveRetreatStudentRegistrationLinks'), adapterSource.indexOf('async function deleteRecord'));
assert.match(dedicatedUpdate, /extras:[\s\S]*linksCadastroCursistas/, 'A atualização relacional deve alterar somente o extras dos links de cursistas.');
assert.doesNotMatch(dedicatedUpdate, /linksSetores|retiro_setores|adesoes|cursistas/, 'A atualização dedicada não deve tocar em links da equipe ou fichas.');

console.log('Links publicos de cursistas: sincronizacao e privacidade validadas.');
