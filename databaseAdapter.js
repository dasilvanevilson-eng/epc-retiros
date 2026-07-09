const fs = require('fs/promises');
const path = require('path');
const { stores } = require('./storeConfig');

const root = __dirname;
const databaseDir = path.join(root, 'database');
const databaseFile = path.join(databaseDir, 'db.json');

const emptyDatabase = () => Object.fromEntries(stores.map((store) => [store, []]));
const hasSupabase = () => Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
const canFallbackToFile = () => !process.env.VERCEL && process.env.NODE_ENV !== 'production';

async function withLocalFallback(action) {
  if (!hasSupabase()) return action(false);
  try {
    return await action(true);
  } catch (error) {
    if (!canFallbackToFile()) throw error;
    console.warn(`Supabase indisponivel; usando banco local. ${error.message || error}`);
    return action(false);
  }
}

function firstJsonObjectEnd(content) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

async function parseDatabaseContent(content) {
  try {
    return JSON.parse(content || '{}');
  } catch (error) {
    const end = firstJsonObjectEnd(content || '');
    if (end <= 0) throw error;
    const parsed = JSON.parse(content.slice(0, end));
    await writeFileDatabase(parsed);
    return parsed;
  }
}

async function ensureFileDatabase() {
  await fs.mkdir(databaseDir, { recursive: true });
  try {
    await fs.access(databaseFile);
  } catch {
    await writeFileDatabase(emptyDatabase());
  }
}

async function readFileDatabase() {
  await ensureFileDatabase();
  const content = await fs.readFile(databaseFile, 'utf8');
  const parsed = await parseDatabaseContent(content);
  return { ...emptyDatabase(), ...parsed };
}

async function writeFileDatabase(database) {
  await fs.mkdir(databaseDir, { recursive: true });
  const normalized = { ...emptyDatabase(), ...database };
  const tempFile = `${databaseFile}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, databaseFile);
}

async function supabaseRequest(pathname, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${response.status}: ${message}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function listSupabase(storeName) {
  const rows = await supabaseRequest(`epc_store?store=eq.${encodeURIComponent(storeName)}&select=id,data,updated_at&order=updated_at.desc`);
  return rows.map((row) => ({ ...row.data, id: row.id }));
}

async function getSupabase(storeName, id) {
  const rows = await supabaseRequest(`epc_store?store=eq.${encodeURIComponent(storeName)}&id=eq.${encodeURIComponent(id)}&select=id,data&limit=1`);
  return rows[0] ? { ...rows[0].data, id: rows[0].id } : null;
}

async function saveSupabase(storeName, record) {
  const nextRecord = { ...record };
  await supabaseRequest('epc_store?on_conflict=store,id', {
    method: 'POST',
    body: JSON.stringify([{ store: storeName, id: nextRecord.id, data: nextRecord }]),
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  return nextRecord;
}

async function deleteSupabase(storeName, id) {
  await supabaseRequest(`epc_store?store=eq.${encodeURIComponent(storeName)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function readDatabase() {
  return withLocalFallback(async (useSupabase) => {
    if (!useSupabase) return readFileDatabase();
    const entries = await Promise.all(stores.map(async (storeName) => [storeName, await listSupabase(storeName)]));
    return Object.fromEntries(entries);
  });
}

async function importDatabase(incoming) {
  if (!hasSupabase()) {
    const current = await readFileDatabase();
    const imported = Object.fromEntries(stores.map((store) => [store, Array.isArray(incoming[store]) ? incoming[store] : current[store]]));
    await writeFileDatabase({ ...current, ...imported });
    return;
  }
  const records = stores.flatMap((store) => (Array.isArray(incoming[store]) ? incoming[store] : []).map((item) => ({ store, id: item.id, data: item }))).filter((item) => item.id);
  if (!records.length) return;
  await supabaseRequest('epc_store?on_conflict=store,id', {
    method: 'POST',
    body: JSON.stringify(records),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
}

async function listRecords(storeName) {
  return withLocalFallback(async (useSupabase) => (useSupabase ? listSupabase(storeName) : (await readFileDatabase())[storeName]));
}

async function getRecord(storeName, id) {
  return withLocalFallback(async (useSupabase) => (useSupabase ? getSupabase(storeName, id) : (await readFileDatabase())[storeName].find((item) => item.id === id) || null));
}

async function saveRecord(storeName, record) {
  return withLocalFallback(async (useSupabase) => {
    if (useSupabase) return saveSupabase(storeName, record);
    const database = await readFileDatabase();
    const collection = database[storeName];
    const index = collection.findIndex((item) => item.id === record.id);
    if (index >= 0) collection[index] = record;
    else collection.push(record);
    await writeFileDatabase(database);
    return record;
  });
}

async function deleteRecord(storeName, id) {
  return withLocalFallback(async (useSupabase) => {
    if (useSupabase) {
      await deleteSupabase(storeName, id);
      return;
    }
    const database = await readFileDatabase();
    database[storeName] = database[storeName].filter((item) => item.id !== id);
    await writeFileDatabase(database);
  });
}

async function checkDatabaseConnection() {
  if (!hasSupabase()) return { database: 'file', ok: true };
  await supabaseRequest('epc_store?select=store,id&limit=1');
  return { database: 'supabase', ok: true };
}

module.exports = {
  checkDatabaseConnection,
  emptyDatabase,
  hasSupabase,
  importDatabase,
  readDatabase,
  listRecords,
  getRecord,
  saveRecord,
  deleteRecord,
  ensureFileDatabase,
};
