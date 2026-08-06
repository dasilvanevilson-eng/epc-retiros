const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  sanitizePublicRetreat,
  studentRegistrationLinkVersion,
  syncStudentRegistrationLinks,
  withSyncedStudentRegistrationLinks,
} = require('../publicStudentLinks');
const { allPermissions, defaultProfiles } = require('../permissions');

assert(allPermissions.some(([id, moduleName]) => id === 'links-cadastro.editar' && moduleName === 'Links de cadastro'));
assert(defaultProfiles.find((profile) => profile.id === 'coordenador_retiro').permissions.includes('links-cadastro.editar'));

const base = { id: 'r1', numeroPrevistoFichasCursista: 2 };
const created = withSyncedStudentRegistrationLinks(null, base);
assert.equal(created.linksCadastroCursistas.length, 2);
assert.deepEqual(created.linksCadastroCursistas.map((link) => link.numeroFicha), [1, 2]);
assert(created.linksCadastroCursistas.every((link) => /^[a-f0-9]{48}$/.test(link.token)));
assert(created.linksCadastroCursistas.every((link) => link.versao === studentRegistrationLinkVersion));
assert(created.linksCadastroCursistas.every((link) => link.enviadoPara === ''));
assert(created.linksCadastroCursistas.every((link) => link.inscricaoEncerrada === false));
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
    { numeroFicha: 1, token: 'token-antigo-1', createdAt: '2026-01-01T00:00:00.000Z', enviadoPara: 'Família Silva', inscricaoEncerrada: true },
    { numeroFicha: 2, token: 'token-antigo-2', createdAt: '2026-01-01T00:00:00.000Z' },
    { numeroFicha: 3, token: 'token-antigo-oculto', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
};
const rotated = syncStudentRegistrationLinks(legacy, legacy, { rotateLegacy: true });
assert.equal(rotated.length, 3, 'Links ocultos também devem ser preservados e rotacionados.');
assert(rotated.every((link) => link.versao === studentRegistrationLinkVersion));
assert(rotated.every((link, index) => link.token !== legacy.linksCadastroCursistas[index].token));
assert.equal(rotated[0].enviadoPara, 'Família Silva', 'A rotação deve preservar o destinatário informado.');
assert.equal(rotated[0].inscricaoEncerrada, true, 'A rotação deve preservar o encerramento individual do link.');
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
const stylesSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
assert.match(adminSource, /cadastro-cursista\/ficha\$\{link\.numeroFicha\}\/\$\{encodeURIComponent\(link\.token\)\}/);
assert.match(adminSource, />Enviado para</);
assert.match(adminSource, /Cursista cadastrado/);
assert.match(adminSource, /Casal cadastrado/);
assert.match(adminSource, /saveStudentRegistrationLinkRecipient\(id, numeroFicha, input\.value\)/);
assert.match(adminSource, />Inscrição encerrada</);
assert.match(adminSource, /student-registration-link-title[\s\S]*<strong>Ficha \$\{link\.numeroFicha\}<\/strong>[\s\S]*student-registration-link-closed/, 'O checkbox deve ficar imediatamente ao lado do número da ficha.');
assert.match(adminSource, /student-registration-link-title[\s\S]*<strong>Ficha \$\{link\.numeroFicha\}<\/strong>[\s\S]*student-registration-link-open[\s\S]*student-registration-link-closed/, 'Abrir deve ficar entre o número da ficha e o checkbox.');
assert.match(adminSource, /student-registration-link-number[\s\S]*<strong>Ficha \$\{link\.numeroFicha\}<\/strong>[\s\S]*student-registration-link-status-note/, 'O status deve aparecer como comentário do número da ficha.');
assert.doesNotMatch(adminSource, /<\/div><span class="status[^>]*data-student-link-status/, 'O status não deve ocupar um selo separado no cabeçalho.');
assert.match(adminSource, /student-registration-link-url[\s\S]*class="sr-only">Endereço público da ficha \$\{link\.numeroFicha\}[\s\S]*data-copy-student-link/, 'Copiar link deve ficar à direita do campo da URL com rótulo apenas acessível.');
assert.doesNotMatch(adminSource, /<span>Link público — ficha/, 'O número da ficha não deve ser repetido visualmente acima do campo do link.');
assert.match(adminSource, /id="view-student-link-status">Visualizar<\/button>/, 'A caixa de links dos cursistas deve possuir a ação Visualizar.');
assert.match(adminSource, /\['numeroFicha', 'Nr Ficha'\][\s\S]*\['nomeCadastrado', 'Nome cursista\/casal'\][\s\S]*\['enviadoPara', 'Enviada para'\][\s\S]*\['status', 'Status'\]/, 'A visualização deve apresentar as quatro colunas solicitadas.');
assert.match(adminSource, /\[\.\.\.studentLinks\]\.sort[\s\S]*aria-sort[\s\S]*data-student-link-sort/, 'Todas as fichas devem ser listadas com ordenação por qualquer coluna.');
assert.match(stylesSource, /@media \(max-width:640px\)[\s\S]*\.student-registration-link-recipient,\.student-registration-link-url\{grid-template-columns:minmax\(0,1fr\) auto\}/, 'Os campos e botões devem manter no mobile a mesma disposição em linha do desktop.');
assert.match(stylesSource, /@media \(max-width:640px\)[\s\S]*\.student-registration-link-title\{flex-wrap:nowrap[\s\S]*\.student-registration-link-open\{width:auto/, 'Abrir deve permanecer compacto entre a ficha e o checkbox no mobile.');
assert.match(adminSource, /setStudentRegistrationLinkClosed\(id, numeroFicha, checkbox\.checked\)/);
assert.match(adminSource, /canAccess\('links-cadastro\.editar'\) && canModifyRetreat\(retreat\)/);
assert.match(adminSource, /setSectorRegistrationLinkClosed\(id, sector, nextClosed\)/);
assert.match(vercelRoutes, /cadastro-cursista\/ficha\(\[0-9\]\+\)\/\(\[\^\/\]\+\)/, 'A rota identificada deve preceder a compatibilidade antiga.');
assert.match(vercelRoutes, /cadastro-cursista\/\(\[\^\/\]\+\)/, 'A rota antiga deve permanecer disponível.');
assert.match(localServer, /identified\?\.\[1\][\s\S]*identified\?\.\[2\][\s\S]*legacy\?\.\[1\]/, 'O servidor local deve aceitar os dois formatos.');
assert.match(publicApp, /expectedFileNumber[\s\S]*O número da ficha não corresponde a este link/, 'A página deve rejeitar identificação divergente.');
assert.match(apiSource, /prepareStudentRegistrationLinkSync\(current\)[\s\S]*saveRetreatStudentRegistrationLinks\(retreatId, syncResult\.links\)/, 'A API deve auditar antes de usar a atualização dedicada.');
assert.match(apiSource, /action === 'destinatario'[\s\S]*denyIfMissingPermission\(res, session, 'links-cadastro\.editar'\)[\s\S]*saveRetreatStudentRegistrationLinks\(retreatId, updatedLinks\)/, 'O destinatário deve usar a permissão própria de links e atualização dedicada.');
assert.match(apiSource, /action === 'inscricao'[\s\S]*denyIfMissingPermission\(res, session, 'links-cadastro\.editar'\)[\s\S]*inscricaoEncerrada[\s\S]*saveRetreatStudentRegistrationLinks\(retreatId, updatedLinks\)/, 'O encerramento individual deve usar a permissão própria e ser protegido no servidor.');
assert.match(apiSource, /action === 'setor'[\s\S]*denyIfMissingPermission\(res, session, 'links-cadastro\.editar'\)[\s\S]*saveRetreatClosedRegistrationSectors/, 'O fechamento dos links da equipe deve usar a mesma permissão própria.');
assert.match(publicApp, /context\.inscricaoEncerrada[\s\S]*Inscrição encerrada/, 'A página pública deve informar o encerramento individual do link.');
const dedicatedUpdate = adapterSource.slice(adapterSource.indexOf('async function saveRetreatStudentRegistrationLinks'), adapterSource.indexOf('async function deleteRecord'));
assert.match(dedicatedUpdate, /extras:[\s\S]*linksCadastroCursistas/, 'A atualização relacional deve alterar somente o extras dos links de cursistas.');
assert.doesNotMatch(dedicatedUpdate, /linksSetores|retiro_setores|adesoes|cursistas/, 'A atualização dedicada não deve tocar em links da equipe ou fichas.');
const sectorUpdate = adapterSource.slice(adapterSource.indexOf('async function saveRetreatClosedRegistrationSectors'), adapterSource.indexOf('async function deleteRecord'));
assert.match(sectorUpdate, /extras:[\s\S]*setoresInscricoesEncerradas/, 'O fechamento de setor deve alterar somente os metadados correspondentes.');
assert.doesNotMatch(sectorUpdate, /linksCadastroCursistas|retiro_setores|adesoes|cursistas/, 'O fechamento de setor não deve alterar tokens ou fichas.');

console.log('Links publicos de cursistas: sincronizacao e privacidade validadas.');
