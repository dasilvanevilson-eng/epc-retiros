const fs = require('fs');
const path = require('path');

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

const { checkDatabaseConnection, listRecords } = require('../databaseAdapter');

async function main() {
  const connection = await checkDatabaseConnection();
  const retreats = await listRecords('retiros');
  const result = retreats.map((retreat) => {
    const links = retreat.linksSetores || [];
    const lengths = [
      String(retreat.recebedorToken || '').length,
      ...links.flatMap((link) => [link.token, link.cadastroToken, link.acompanhamentoToken].map((value) => String(value || '').length)),
    ];
    return {
      id: retreat.id,
      links: links.length,
      minTokenLength: Math.min(...lengths),
      maxTokenLength: Math.max(...lengths),
    };
  });
  console.log(JSON.stringify({ ok: true, database: connection.database, retreats: result }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
