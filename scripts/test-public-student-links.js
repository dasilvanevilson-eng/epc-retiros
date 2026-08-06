const assert = require('assert');
const {
  sanitizePublicRetreat,
  syncStudentRegistrationLinks,
  withSyncedStudentRegistrationLinks,
} = require('../publicStudentLinks');

const base = { id: 'r1', numeroPrevistoFichasCursista: 2 };
const created = withSyncedStudentRegistrationLinks(null, base);
assert.equal(created.linksCadastroCursistas.length, 2);
assert.deepEqual(created.linksCadastroCursistas.map((link) => link.numeroFicha), [1, 2]);
assert(created.linksCadastroCursistas.every((link) => /^[a-f0-9]{48}$/.test(link.token)));
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

const publicRetreat = sanitizePublicRetreat(increased);
assert(!Object.hasOwn(publicRetreat, 'linksCadastroCursistas'));
assert(Object.hasOwn(increased, 'linksCadastroCursistas'), 'A sanitizacao nao deve alterar o objeto original.');

console.log('Links publicos de cursistas: sincronizacao e privacidade validadas.');
