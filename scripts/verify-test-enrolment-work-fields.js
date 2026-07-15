const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function loadLocalEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  });
}

loadLocalEnv();
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { checkDatabaseConnection, listRecords } = require('../databaseAdapter');

const hasValues = (value) => Array.isArray(value) && value.filter(Boolean).length > 0;

async function main() {
  const connection = await checkDatabaseConnection();
  if (connection.database !== 'supabase-relational') {
    throw new Error(`Conexao inesperada: ${JSON.stringify(connection)}`);
  }

  const [retreats, enrolments] = await Promise.all([
    listRecords('retiros'),
    listRecords('adesoes'),
  ]);
  const retreat = retreats.find((item) => item.status === 'publicado') || retreats.find((item) => item.status === 'preparacao') || retreats[0];
  if (!retreat) throw new Error('Nenhum retiro encontrado.');

  const retreatEnrolments = enrolments.filter((entry) => entry.retiroId === retreat.id);
  const withoutSectors = retreatEnrolments.filter((entry) => !hasValues(entry.setores));
  const withoutDays = retreatEnrolments.filter((entry) => !hasValues(entry.dias));
  const result = {
    ok: withoutSectors.length === 0 && withoutDays.length === 0,
    database: connection.database,
    retreat: retreat.nome,
    retreatId: retreat.id,
    enrolmentsInRetreat: retreatEnrolments.length,
    withoutSectors: withoutSectors.length,
    withoutDays: withoutDays.length,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
