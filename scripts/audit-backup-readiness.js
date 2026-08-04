const fs = require('fs');
const path = require('path');
const { relationalTableNames } = require('../backupService');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
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

const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!baseUrl || !serviceKey) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias para a auditoria.');

async function countTable(table) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 404 || detail.includes('PGRST205')) return { table, status: 'ausente', count: null };
    throw new Error(`Falha ao auditar ${table}: Supabase ${response.status}.`);
  }
  const range = response.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return { table, status: 'ok', count: Number.isFinite(total) ? total : null };
}

(async () => {
  const results = [];
  for (const table of relationalTableNames) results.push(await countTable(table));
  console.table(results);
  console.log(`Administrador de emergencia configurado: ${Boolean(process.env.EPC_ADMIN_USER && process.env.EPC_ADMIN_PASSWORD) ? 'sim' : 'nao'}`);
  if (results.some((item) => item.status !== 'ok' && item.table !== 'epc_store')) process.exitCode = 2;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
