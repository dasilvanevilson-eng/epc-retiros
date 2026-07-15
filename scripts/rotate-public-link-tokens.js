const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { checkDatabaseConnection, listRecords, saveRecord } = require('../databaseAdapter');

const issuedTokens = new Set();
function publicToken() {
  let token = '';
  do {
    token = crypto.randomBytes(24).toString('hex');
  } while (issuedTokens.has(token));
  issuedTokens.add(token);
  return token;
}

function rotateRetreat(retreat) {
  const links = Array.isArray(retreat.linksSetores || retreat.setorLinks) ? (retreat.linksSetores || retreat.setorLinks) : [];
  return {
    ...retreat,
    recebedorToken: publicToken(),
    linksSetores: links.map((link) => ({
      ...link,
      token: publicToken(),
      cadastroToken: publicToken(),
      acompanhamentoToken: publicToken(),
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const connection = await checkDatabaseConnection();
  if (connection.database !== 'supabase-relational') {
    throw new Error(`Conexao inesperada: ${JSON.stringify(connection)}`);
  }

  const retreats = await listRecords('retiros');
  const enrolments = await listRecords('adesoes');
  let rotatedRetreats = 0;
  let rotatedSectorLinks = 0;
  let restoredEnrolments = 0;

  for (const retreat of retreats) {
    const retreatEnrolments = enrolments.filter((entry) => entry.retiroId === retreat.id);
    const next = rotateRetreat(retreat);
    rotatedSectorLinks += next.linksSetores.length;
    await saveRecord('retiros', next);
    for (const enrolment of retreatEnrolments) {
      await saveRecord('adesoes', enrolment);
      restoredEnrolments += 1;
    }
    rotatedRetreats += 1;
  }

  console.log(JSON.stringify({
    ok: true,
    database: connection.database,
    rotatedRetreats,
    rotatedSectorLinks,
    restoredEnrolments,
    tokenBytes: 24,
    tokenHexLength: 48,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
