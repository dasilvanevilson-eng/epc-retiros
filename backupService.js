const crypto = require('crypto');
const { hasSupabase, readDatabase, replaceDatabase } = require('./databaseAdapter');
const { stores } = require('./storeConfig');

const BACKUP_FORMAT = 'familia-epc-backup';
const BACKUP_VERSION = 1;
const SCHEMA_VERSION = 'supabase-relational-2026-08-v4';
const LOCAL_SCHEMA_VERSION = 'local-logical-2026-08-v2';
const LEGACY_SCHEMA_VERSIONS = new Set(['supabase-relational-2026-08-v3', 'local-logical-2026-08-v1']);
const RETIRED_REPORT_MODELS_TABLE = 'relatorio_modelos';
const RETIRED_REPORT_MODELS_WARNING = 'Este backup pertence à versão anterior. A tabela aposentada relatorio_modelos será ignorada; todas as demais tabelas serão restauradas normalmente.';
const CHUNK_SIZE = 200;

const relationalTables = [
  ['perfis', ['id']],
  ['permissoes', ['id']],
  ['retiros', ['id']],
  ['retiro_dias', ['id']],
  ['retiro_setores', ['id']],
  ['retiro_contribuicoes', ['id']],
  ['pessoas', ['id']],
  ['casais', ['id']],
  ['adesoes', ['id']],
  ['casal_membros', ['casal_id', 'adesao_id']],
  ['adesao_dias', ['adesao_id', 'dia_id']],
  ['adesao_setores', ['adesao_id', 'setor_id']],
  ['adesao_retiros_anteriores', ['id']],
  ['adesao_espaco_kids', ['id']],
  ['cursistas', ['id']],
  ['cursista_smp', ['retiro_id', 'id']],
  ['cursista_epc', ['retiro_id', 'id']],
  ['cursista_fotos', ['id']],
  ['comunidades', ['id']],
  ['comunidade_monitores', ['comunidade_id', 'pessoa_id']],
  ['comunidade_cursistas', ['comunidade_id', 'cursista_id']],
  ['comunidade_cursistas_smp', ['comunidade_id', 'retiro_id', 'cursista_id']],
  ['comunidade_cursistas_epc', ['comunidade_id', 'retiro_id', 'cursista_id']],
  ['crachas', ['id']],
  ['configuracoes', ['id']],
  ['usuarios', ['id']],
  ['perfil_permissoes', ['perfil_id', 'permissao_id']],
  ['usuario_permissoes', ['usuario_id', 'permissao_id']],
  ['usuario_retiros', ['usuario_id', 'retiro_id']],
  ['epc_store', ['store', 'id']],
];

const tablePrimaryKeys = Object.fromEntries(relationalTables);
const allowedRelationalTables = new Set(relationalTables.map(([name]) => name));
const requiredRelationalTables = new Set(relationalTables
  .map(([name]) => name)
  .filter((name) => !['epc_store', 'cursista_fotos'].includes(name)));
const localOperations = new Map();

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
};
const stableStringify = (value) => JSON.stringify(stableValue(value));
const checksumForBackup = (backup) => crypto.createHash('sha256').update(stableStringify({
  format: backup.format,
  version: backup.version,
  schemaVersion: backup.schemaVersion,
  storage: backup.storage,
  createdAt: backup.createdAt,
  tables: backup.tables,
})).digest('hex');

const uuid = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const arraysOnly = (tables) => plainObject(tables) && Object.values(tables).every(Array.isArray);
const countsForTables = (tables) => Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
const splitRows = (tableName, rows) => {
  const chunks = [];
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    chunks.push({ tableName, chunkIndex: Math.floor(offset / CHUNK_SIZE), rows: rows.slice(offset, offset + CHUNK_SIZE) });
  }
  if (!rows.length) chunks.push({ tableName, chunkIndex: 0, rows: [] });
  return chunks;
};

async function supabaseRequest(pathname, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY e obrigatoria para backup e restauracao.');
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

function assertAdmin(session = {}) {
  if (session.role !== 'admin' && session.perfilCodigo !== 'admin') {
    const error = new Error('Apenas administradores podem acessar backup e restauracao.');
    error.statusCode = 403;
    throw error;
  }
}

function validateBackupEnvelope(backup, { requireTables = true } = {}) {
  if (!plainObject(backup) || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) throw new Error('Arquivo de backup invalido ou de versao nao suportada.');
  if (!['supabase-relational', 'local-logical'].includes(backup.storage)) throw new Error('Origem do backup nao suportada.');
  const expectedSchema = backup.storage === 'supabase-relational' ? SCHEMA_VERSION : LOCAL_SCHEMA_VERSION;
  const legacySchema = LEGACY_SCHEMA_VERSIONS.has(backup.schemaVersion);
  if (backup.schemaVersion !== expectedSchema && !legacySchema) throw new Error('O backup nao e compativel com a versao atual do banco.');
  if (!backup.createdAt || Number.isNaN(Date.parse(backup.createdAt))) throw new Error('Data de criacao do backup invalida.');
  if (!requireTables) return;
  if (!arraysOnly(backup.tables)) throw new Error('O backup nao contem tabelas validas.');
  const names = Object.keys(backup.tables);
  const allowed = new Set(backup.storage === 'supabase-relational' ? allowedRelationalTables : stores);
  const required = new Set(backup.storage === 'supabase-relational' ? requiredRelationalTables : stores);
  if (legacySchema) {
    allowed.add(RETIRED_REPORT_MODELS_TABLE);
    required.add(RETIRED_REPORT_MODELS_TABLE);
  }
  const unknown = names.filter((name) => !allowed.has(name));
  const missing = [...required].filter((name) => !names.includes(name));
  if (unknown.length) throw new Error(`O backup contem tabelas desconhecidas: ${unknown.join(', ')}.`);
  if (missing.length) throw new Error(`O backup esta incompleto. Tabelas ausentes: ${missing.join(', ')}.`);
  for (const [name, rows] of Object.entries(backup.tables)) {
    if (rows.some((row) => !plainObject(row))) throw new Error(`A tabela ${name} contem registros invalidos.`);
    const primaryKeys = name === RETIRED_REPORT_MODELS_TABLE ? ['id'] : (backup.storage === 'supabase-relational' ? tablePrimaryKeys[name] : ['id']);
    const identities = new Set();
    rows.forEach((row) => {
      if (primaryKeys.some((key) => row[key] === undefined || row[key] === null || row[key] === '')) throw new Error(`A tabela ${name} contem registro sem chave primaria valida.`);
      const identity = primaryKeys.map((key) => stableStringify(row[key])).join('|');
      if (identities.has(identity)) throw new Error(`A tabela ${name} contem chave primaria duplicada.`);
      identities.add(identity);
    });
  }
  const actualCounts = countsForTables(backup.tables);
  if (!plainObject(backup.counts) || stableStringify(actualCounts) !== stableStringify(backup.counts)) throw new Error('As contagens do backup nao conferem com seu conteudo.');
  if (!/^[a-f0-9]{64}$/.test(String(backup.checksum || '')) || checksumForBackup(backup) !== backup.checksum) throw new Error('O checksum do backup e invalido. O arquivo pode estar incompleto ou alterado.');
}

function normalizeRestorableBackup(backup) {
  if (!LEGACY_SCHEMA_VERSIONS.has(backup.schemaVersion)) return { ...backup, warnings: [] };
  const tables = { ...backup.tables };
  const counts = { ...backup.counts };
  delete tables[RETIRED_REPORT_MODELS_TABLE];
  delete counts[RETIRED_REPORT_MODELS_TABLE];
  return { ...backup, tables, counts, warnings: [RETIRED_REPORT_MODELS_WARNING] };
}

async function createSnapshot(session) {
  assertAdmin(session);
  if (hasSupabase()) {
    const result = await supabaseRequest('rpc/epc_backup_create_snapshot', {
      method: 'POST',
      body: JSON.stringify({ p_actor: session.username || session.sub || session.id || 'admin' }),
    });
    return result;
  }
  const database = await readDatabase();
  const tables = Object.fromEntries(stores.map((name) => [name, Array.isArray(database[name]) ? database[name] : []]));
  const operationId = uuid();
  const chunks = Object.entries(tables).flatMap(([name, rows]) => splitRows(name, rows));
  const manifest = {
    operationId,
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: LOCAL_SCHEMA_VERSION,
    storage: 'local-logical',
    createdAt: new Date().toISOString(),
    counts: countsForTables(tables),
    tableNames: Object.keys(tables),
  };
  localOperations.set(operationId, { id: operationId, type: 'export', manifest, chunks, createdAt: Date.now() });
  return manifest;
}

async function listChunks(session, operationId, offset = 0, limit = 25) {
  assertAdmin(session);
  if (hasSupabase()) {
    const rows = await supabaseRequest(`epc_backup_chunks?operation_id=eq.${encodeURIComponent(operationId)}&select=table_name,chunk_index,rows&order=table_name.asc,chunk_index.asc&offset=${Math.max(0, offset)}&limit=${Math.min(100, Math.max(1, limit))}`);
    return { chunks: rows.map((row) => ({ tableName: row.table_name, chunkIndex: row.chunk_index, rows: row.rows })), hasMore: rows.length === Math.min(100, Math.max(1, limit)) };
  }
  const operation = localOperations.get(operationId);
  if (!operation || operation.type !== 'export') throw new Error('Operacao de backup nao encontrada ou expirada.');
  const chunks = operation.chunks.slice(offset, offset + limit);
  return { chunks, hasMore: offset + chunks.length < operation.chunks.length };
}

async function createRestore(session, envelope) {
  assertAdmin(session);
  validateBackupEnvelope(envelope, { requireTables: false });
  const manifest = {
    format: envelope.format,
    version: envelope.version,
    schemaVersion: envelope.schemaVersion,
    storage: envelope.storage,
    createdAt: envelope.createdAt,
    counts: envelope.counts,
    checksum: envelope.checksum,
    tableNames: Object.keys(envelope.counts || {}),
  };
  if (hasSupabase()) {
    if (envelope.storage !== 'supabase-relational') throw new Error('Este arquivo foi criado por um banco local e nao pode substituir o Supabase.');
    return supabaseRequest('rpc/epc_backup_create_restore', {
      method: 'POST',
      body: JSON.stringify({ p_actor: session.username || session.sub || session.id || 'admin', p_manifest: manifest }),
    });
  }
  if (envelope.storage !== 'local-logical') throw new Error('Este backup do Supabase nao pode ser restaurado no banco local.');
  const operationId = uuid();
  localOperations.set(operationId, { id: operationId, type: 'restore', manifest, chunks: [], createdAt: Date.now() });
  return { operationId };
}

async function uploadRestoreChunk(session, operationId, chunk) {
  assertAdmin(session);
  if (!plainObject(chunk) || !Array.isArray(chunk.rows) || !Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) throw new Error('Bloco de restauracao invalido.');
  const allowed = new Set(hasSupabase() ? allowedRelationalTables : stores);
  allowed.add(RETIRED_REPORT_MODELS_TABLE);
  if (!allowed.has(chunk.tableName)) throw new Error(`Tabela nao permitida no backup: ${chunk.tableName}.`);
  if (chunk.rows.length > CHUNK_SIZE || chunk.rows.some((row) => !plainObject(row))) throw new Error('Bloco de restauracao excede o limite ou contem registros invalidos.');
  if (hasSupabase()) {
    await supabaseRequest('epc_backup_chunks?on_conflict=operation_id,table_name,chunk_index', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ operation_id: operationId, table_name: chunk.tableName, chunk_index: chunk.chunkIndex, rows: chunk.rows }),
    });
    return;
  }
  const operation = localOperations.get(operationId);
  if (!operation || operation.type !== 'restore') throw new Error('Operacao de restauracao nao encontrada ou expirada.');
  const index = operation.chunks.findIndex((item) => item.tableName === chunk.tableName && item.chunkIndex === chunk.chunkIndex);
  if (index >= 0) operation.chunks[index] = chunk;
  else operation.chunks.push(chunk);
}

async function loadRestoreBackup(operationId) {
  let operation;
  let chunks;
  if (hasSupabase()) {
    const operations = await supabaseRequest(`epc_backup_operations?id=eq.${encodeURIComponent(operationId)}&type=eq.restore&select=id,manifest,status&limit=1`);
    if (!operations.length) throw new Error('Operacao de restauracao nao encontrada ou expirada.');
    operation = operations[0];
    chunks = [];
    let offset = 0;
    while (true) {
      const rows = await supabaseRequest(`epc_backup_chunks?operation_id=eq.${encodeURIComponent(operationId)}&select=table_name,chunk_index,rows&order=table_name.asc,chunk_index.asc&offset=${offset}&limit=1000`);
      chunks.push(...rows.map((row) => ({ tableName: row.table_name, chunkIndex: row.chunk_index, rows: row.rows })));
      offset += rows.length;
      if (rows.length < 1000) break;
    }
  } else {
    operation = localOperations.get(operationId);
    if (!operation || operation.type !== 'restore') throw new Error('Operacao de restauracao nao encontrada ou expirada.');
    chunks = operation.chunks;
  }
  const manifest = operation.manifest;
  const tables = Object.fromEntries((manifest.tableNames || Object.keys(manifest.counts || {})).map((name) => [name, []]));
  chunks.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.chunkIndex - b.chunkIndex).forEach((chunk) => {
    if (!tables[chunk.tableName]) tables[chunk.tableName] = [];
    tables[chunk.tableName].push(...chunk.rows);
  });
  const backup = { ...manifest, tables };
  delete backup.tableNames;
  delete backup.operationId;
  validateBackupEnvelope(backup);
  return normalizeRestorableBackup(backup);
}

const rowKey = (tableName, row, storage) => {
  const keys = storage === 'supabase-relational' ? tablePrimaryKeys[tableName] : ['id'];
  return keys.map((key) => `${key}:${stableStringify(row[key])}`).join('|');
};
function compareTables(currentTables, backupTables, storage) {
  return Object.fromEntries(Object.keys(backupTables).map((tableName) => {
    const current = new Map((currentTables[tableName] || []).map((row) => [rowKey(tableName, row, storage), stableStringify(row)]));
    const incoming = new Map((backupTables[tableName] || []).map((row) => [rowKey(tableName, row, storage), stableStringify(row)]));
    let added = 0; let changed = 0; let deleted = 0;
    incoming.forEach((value, key) => { if (!current.has(key)) added += 1; else if (current.get(key) !== value) changed += 1; });
    current.forEach((_, key) => { if (!incoming.has(key)) deleted += 1; });
    return [tableName, { current: current.size, backup: incoming.size, added, changed, deleted }];
  }));
}

async function previewRestore(session, operationId) {
  assertAdmin(session);
  const backup = await loadRestoreBackup(operationId);
  if (!process.env.EPC_ADMIN_USER && backup.storage === 'supabase-relational') {
    const profiles = new Map((backup.tables.perfis || []).map((profile) => [profile.id, profile]));
    const hasAdmin = (backup.tables.usuarios || []).some((user) => user.ativo !== false && profiles.get(user.perfil_id)?.codigo === 'admin');
    if (!hasAdmin) throw new Error('O backup nao possui administrador ativo e nao ha administrador de emergencia configurado.');
  }
  let currentTables;
  let snapshotOperationId = '';
  if (hasSupabase()) {
    const snapshot = await createSnapshot(session);
    snapshotOperationId = snapshot.operationId;
    currentTables = Object.fromEntries((snapshot.tableNames || []).map((name) => [name, []]));
    let offset = 0;
    while (true) {
      const page = await listChunks(session, snapshotOperationId, offset, 100);
      page.chunks.forEach((chunk) => { currentTables[chunk.tableName].push(...chunk.rows); });
      offset += page.chunks.length;
      if (!page.hasMore) break;
    }
    await cancelOperation(session, snapshotOperationId);
  } else currentTables = await readDatabase();
  return { operationId, backupCreatedAt: backup.createdAt, counts: backup.counts, differences: compareTables(currentTables, backup.tables, backup.storage), warnings: backup.warnings };
}

async function commitRestore(session, operationId) {
  assertAdmin(session);
  const backup = await loadRestoreBackup(operationId);
  if (hasSupabase()) {
    await supabaseRequest(`epc_backup_operations?id=eq.${encodeURIComponent(operationId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'restoring', expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }),
    });
    try {
      await supabaseRequest('rpc/epc_backup_restore', { method: 'POST', body: JSON.stringify({ p_operation_id: operationId }) });
    } catch (error) {
      await supabaseRequest(`epc_backup_operations?id=eq.${encodeURIComponent(operationId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed' }) }).catch(() => null);
      throw error;
    }
    return { warnings: backup.warnings };
  }
  await replaceDatabase(backup.tables);
  localOperations.delete(operationId);
  return { warnings: backup.warnings };
}

async function cancelOperation(session, operationId) {
  assertAdmin(session);
  if (hasSupabase()) {
    await supabaseRequest(`epc_backup_operations?id=eq.${encodeURIComponent(operationId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  } else localOperations.delete(operationId);
}

async function isMaintenanceActive() {
  if (!hasSupabase()) return false;
  try {
    const rows = await supabaseRequest(`epc_backup_operations?status=eq.restoring&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id&limit=1`);
    return rows.length > 0;
  } catch (error) {
    if (/PGRST205|42P01|epc_backup_operations/.test(error.message)) return false;
    throw error;
  }
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  CHUNK_SIZE,
  SCHEMA_VERSION,
  cancelOperation,
  checksumForBackup,
  commitRestore,
  createRestore,
  createSnapshot,
  isMaintenanceActive,
  listChunks,
  normalizeRestorableBackup,
  previewRestore,
  uploadRestoreChunk,
  validateBackupEnvelope,
  relationalTableNames: relationalTables.map(([name]) => name),
};
