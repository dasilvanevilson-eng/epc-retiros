const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BACKUP_FORMAT, BACKUP_VERSION, checksumForBackup, relationalTableNames, validateBackupEnvelope } = require('../backupService');
const { stores } = require('../storeConfig');

const makeBackup = () => {
  const tables = Object.fromEntries(stores.map((name) => [name, []]));
  tables.retiros.push({ id: 'retiro-1', nome: 'Retiro preservado' });
  tables.adesoes.push({ id: 'adesao-1', retiroId: 'retiro-1', pessoaId: 'pessoa-1', setores: ['Cozinha'] });
  tables.pessoas.push({ id: 'pessoa-1', nome: 'Pessoa preservada' });
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: 'local-logical-2026-08-v1',
    storage: 'local-logical',
    createdAt: '2026-08-04T12:00:00.000Z',
    counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    tables,
  };
  backup.checksum = checksumForBackup(backup);
  return backup;
};

const valid = makeBackup();
assert.doesNotThrow(() => validateBackupEnvelope(valid));

const tampered = structuredClone(valid);
tampered.tables.retiros[0].nome = 'Conteudo adulterado';
assert.throws(() => validateBackupEnvelope(tampered), /checksum/i);

const missingTable = makeBackup();
delete missingTable.tables.adesoes;
missingTable.counts = Object.fromEntries(Object.entries(missingTable.tables).map(([name, rows]) => [name, rows.length]));
missingTable.checksum = checksumForBackup(missingTable);
assert.throws(() => validateBackupEnvelope(missingTable), /ausentes/i);

const duplicate = makeBackup();
duplicate.tables.retiros.push({ id: 'retiro-1', nome: 'Duplicado' });
duplicate.counts.retiros = 2;
duplicate.checksum = checksumForBackup(duplicate);
assert.throws(() => validateBackupEnvelope(duplicate), /duplicada/i);

const large = makeBackup();
large.tables.cursistas = Array.from({ length: 10001 }, (_, index) => ({ id: `cursista-${index}`, retiroId: 'retiro-1', nome: `Cursista ${index}` }));
large.counts.cursistas = large.tables.cursistas.length;
large.checksum = checksumForBackup(large);
assert.doesNotThrow(() => validateBackupEnvelope(large));

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase-backup-restauracao.sql'), 'utf8');
assert.match(migration, /^--[\s\S]*\nbegin;/i, 'A migracao deve iniciar uma transacao explicita.');
assert.match(migration, /commit;\s+\nnotify pgrst/i, 'A migracao deve confirmar antes de recarregar o PostgREST.');
assert.doesNotMatch(migration, /\btruncate\b|\bdrop\s+table\b/i, 'A instalacao nao pode conter TRUNCATE ou DROP TABLE.');
assert.match(migration, /from \(%s\) snapshot_rows/i, 'O snapshot deve reunir as tabelas em um unico comando SQL.');
assert.match(migration, /delete from public\.epc_backup_operations where expires_at < now\(\)/i, 'Operacoes temporarias expiradas devem ser limpas oportunisticamente.');
const registrySection = migration.match(/as \$\$\s*values([\s\S]*?);\s*\$\$;/i)?.[1] || '';
const sqlRegistryTables = [...registrySection.matchAll(/\('([^']+)',\s*\d+,\s*(?:true|false)\)/gi)].map((match) => match[1]);
assert.deepStrictEqual(sqlRegistryTables, relationalTableNames, 'O registro de tabelas do SQL deve coincidir com o backend.');
for (const table of ['retiros', 'pessoas', 'adesoes', 'cursistas', 'cursista_smp', 'cursista_epc', 'comunidades', 'comunidade_cursistas_epc', 'usuarios']) {
  assert.doesNotMatch(migration, new RegExp(`delete\\s+from\\s+public\\.${table}\\b`, 'i'), `A migracao nao pode excluir diretamente dados de ${table}.`);
}

console.log('Backup: formato, integridade, volume e protecoes estaticas da migracao validados.');
