const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const marker = 'simulacao_relacional_60_cursistas_190_adesoes';

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

const { checkDatabaseConnection, listRecords } = require('../databaseAdapter');

async function legacyCount() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  if (!key || !baseUrl) return null;
  const response = await fetch(`${baseUrl}/rest/v1/epc_store?select=store,id&limit=10000`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Falha ao contar epc_store (${response.status}): ${await response.text()}`);
  return (await response.json()).length;
}

async function main() {
  const connection = await checkDatabaseConnection();
  const [retreats, people, enrolments, students, communities] = await Promise.all([
    listRecords('retiros'),
    listRecords('pessoas'),
    listRecords('adesoes'),
    listRecords('cursistas'),
    listRecords('comunidades'),
  ]);
  const retreat = retreats.find((item) => item.simulation === marker || item.nome === 'Retiro Simulado Relacional 2026');
  const retreatId = retreat?.id;
  const simulationEnrolments = enrolments.filter((item) => item.retiroId === retreatId);
  const enrolmentsWithoutWorkDays = simulationEnrolments.filter((item) => !Array.isArray(item.dias) || item.dias.length === 0).length;
  const validWorkDays = new Set(['Sexta-feira', 'Sábado', 'Domingo']);
  const enrolmentsWithInvalidWorkDays = simulationEnrolments.filter((item) => (item.dias || []).some((day) => !validWorkDays.has(day))).length;
  const result = {
    ok: Boolean(retreatId),
    database: connection.database,
    retiro: retreat?.nome || null,
    retiroId: retreatId,
    pessoasEquipe: people.filter((item) => item.simulation === marker).length,
    adesoes: simulationEnrolments.length,
    adesoesSemDiasConfirmados: enrolmentsWithoutWorkDays,
    adesoesComDiasInvalidos: enrolmentsWithInvalidWorkDays,
    cursistas: students.filter((item) => item.retiroId === retreatId).length,
    comunidades: communities.filter((item) => item.retiroId === retreatId).length,
    legacyEpcStoreRows: await legacyCount(),
    localJsonExists: fs.existsSync(path.join(root, 'database', 'db.json')),
    simulation: marker,
  };
  result.ok = result.ok
    && result.pessoasEquipe === 190
    && result.adesoes === 190
    && result.adesoesSemDiasConfirmados === 0
    && result.adesoesComDiasInvalidos === 0
    && result.cursistas === 60
    && result.comunidades === 10
    && result.legacyEpcStoreRows === 0
    && result.localJsonExists === false;
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
