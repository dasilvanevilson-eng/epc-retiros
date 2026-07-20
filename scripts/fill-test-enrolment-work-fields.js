const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function loadLocalEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
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

const { checkDatabaseConnection, listRecords, saveRecord } = require('../databaseAdapter');

const fallbackSectors = [
  'Animacao/Jovem de sala',
  'Camareiros(as)',
  'Cozinha',
  'Direcao Espiritual',
  'Espiritual',
  'Externo',
  'Folclore',
  'Participacoes especiais',
  'Refeitorio',
  'Secretaria',
  'Zeladoria',
];
const fallbackDays = ['Sexta-feira', 'Sabado', 'Domingo'];

const pick = (items, index) => items[index % items.length];
const normalized = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const hasValues = (value) => Array.isArray(value) && value.filter(Boolean).length > 0;
const usableSectors = (retreat) => {
  const sectors = hasValues(retreat.setores) ? retreat.setores : fallbackSectors;
  return sectors.filter((sector) => !normalized(sector).includes('coordenacao geral'));
};
const usableDays = (retreat) => (hasValues(retreat.dias) ? retreat.dias : fallbackDays);

function randomDays(days, index) {
  if (days.length <= 1) return days;
  if (index % 5 === 0) return [pick(days, index), pick(days, index + 1)].filter((day, dayIndex, list) => list.indexOf(day) === dayIndex);
  if (index % 7 === 0) return [pick(days, index + 2)];
  return days;
}

function completeEnrolment(enrolment, retreat, index) {
  const sectors = usableSectors(retreat);
  const days = usableDays(retreat);
  const next = { ...enrolment };
  let changed = false;

  if (!hasValues(next.setores)) {
    next.setores = [pick(sectors, index)];
    changed = true;
  }
  if (!hasValues(next.dias)) {
    next.dias = randomDays(days, index);
    changed = true;
  }
  if (!next.status || next.status === 'pendente_validacao') {
    next.status = 'confirmada';
    next.validada = true;
    next.validadoEm = next.validadoEm || new Date().toISOString();
    changed = true;
  }
  if (!next.atualizadoEm) {
    next.atualizadoEm = new Date().toISOString();
    changed = true;
  }
  return changed ? next : null;
}

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
  const updates = retreatEnrolments
    .map((entry, index) => completeEnrolment(entry, retreat, index))
    .filter(Boolean);

  for (const update of updates) await saveRecord('adesoes', update);

  console.log(JSON.stringify({
    ok: true,
    database: connection.database,
    retreat: retreat.nome,
    retreatId: retreat.id,
    enrolmentsInRetreat: retreatEnrolments.length,
    updatedEnrolments: updates.length,
    sectorsAvailable: usableSectors(retreat).length,
    daysAvailable: usableDays(retreat).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
