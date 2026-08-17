const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'databaseAdapter.js'), 'utf8');
const localServerSource = fs.readFileSync(path.join(root, 'localServer.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

const helperStart = adminSource.indexOf("const normalizeText = (value = '')");
const helperEnd = adminSource.indexOf('const uniqueSectors', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'Os geradores dos links da equipe devem estar definidos.');

const context = {};
vm.runInNewContext(`${adminSource.slice(helperStart, helperEnd)}
this.teamSectorLinkSlug = teamSectorLinkSlug;
this.teamSectorPublicUrls = teamSectorPublicUrls;`, context);

assert.equal(context.teamSectorLinkSlug('Camareiros(as)'), 'camareiros-as');
assert.equal(context.teamSectorLinkSlug('Animação/Jovem de sala'), 'animacao-jovem-de-sala');
assert.equal(context.teamSectorLinkSlug('  Espaço Kids  '), 'espaco-kids');

const oldUrls = context.teamSectorPublicUrls({}, {
  setor: 'Cozinha',
  cadastroToken: 'cadastro antigo',
  acompanhamentoToken: 'acompanhamento antigo',
}, 'https://exemplo.test');
assert.equal(oldUrls.registrationUrl, 'https://exemplo.test/convite-setor/cadastro%20antigo');
assert.equal(oldUrls.followupUrl, 'https://exemplo.test/setor/acompanhamento%20antigo');

const newUrls = context.teamSectorPublicUrls({ versaoFormatoLinksEquipe: 2 }, {
  setor: 'Camareiros(as)',
  cadastroToken: 'cadastro novo',
  acompanhamentoToken: 'acompanhamento novo',
}, 'https://exemplo.test');
assert.equal(newUrls.registrationUrl, 'https://exemplo.test/setor/camareiros-as/cadastro/cadastro%20novo');
assert.equal(newUrls.followupUrl, 'https://exemplo.test/setor/camareiros-as/acompanhamento/acompanhamento%20novo');

assert.match(adminSource, /versaoFormatoLinksEquipe: teamSectorLinkFormatVersion/, 'Somente o cadastro de novos retiros deve ativar o formato identificado.');
assert.equal([...adminSource.matchAll(/versaoFormatoLinksEquipe:/g)].length, 1, 'Editar ou abrir um retiro existente não deve ativar o formato novo.');
assert.match(adminSource, /teamSectorPublicUrls\(retreat, link, location\.origin\)/, 'A tela deve montar os dois links pela versão do retiro.');
assert.match(adapterSource, /function mapRetreat[\s\S]*?\.\.\.\(row\.extras \|\| \{\}\)/, 'O marcador deve voltar do Supabase junto aos demais extras do retiro.');
const saveRetreatSource = adapterSource.slice(adapterSource.indexOf('async function saveRetreat(record)'), adapterSource.indexOf('async function listPeople'));
assert.match(saveRetreatSource, /\.\.\.extras\(record, mappedKeys\)/, 'O marcador deve ser salvo como metadado adicional, sem migração de tabela.');
assert.doesNotMatch(saveRetreatSource.match(/const mappedKeys = new Set\(\[[^;]+/)?.[0] || '', /versaoFormatoLinksEquipe/, 'O marcador não deve ser descartado do metadado do retiro.');

const routeBySource = new Map(vercel.routes.map((route) => [route.src, route.dest]));
assert.equal(routeBySource.get('/setor/([^/]+)/cadastro/([^/]+)'), '/api/convite-setor.js?token=$2');
assert.equal(routeBySource.get('/setor/([^/]+)/acompanhamento/([^/]+)'), '/api/setor.js?token=$2');
assert.equal(routeBySource.get('/convite-setor/([^/]+)'), '/api/convite-setor.js?token=$1', 'O link antigo de cadastro deve continuar válido.');
assert.equal(routeBySource.get('/setor/([^/]+)'), '/api/setor.js?token=$1', 'O link antigo de acompanhamento deve continuar válido.');

const registrationRouteIndex = vercel.routes.findIndex((route) => route.src === '/setor/([^/]+)/cadastro/([^/]+)');
const legacySectorRouteIndex = vercel.routes.findIndex((route) => route.src === '/setor/([^/]+)');
assert(registrationRouteIndex >= 0 && registrationRouteIndex < legacySectorRouteIndex, 'As rotas identificadas devem ser avaliadas antes das rotas antigas.');

assert.match(localServerSource, /\(cadastro\|acompanhamento\)/, 'O servidor local deve reconhecer as duas finalidades.');
assert.match(localServerSource, /sendPublicSectorInvitePage\(req, res, '', identifiedLink\[2\]\)/, 'Cadastro identificado deve reutilizar a página pública de cadastro.');
assert.match(localServerSource, /sendPublicSectorPage\(req, res, '', identifiedLink\[2\]\)/, 'Acompanhamento identificado deve reutilizar a página pública do líder.');

console.log('Links identificados da equipe validados com compatibilidade para retiros existentes.');
