const crypto = require('crypto');
const { getRecord, listRecords, listCursistasSmp, listCursistasEpc, hasSupabase } = require('./databaseAdapter');

const BUCKET = 'cursista-fotos';
const MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_TICKET_TTL_SECONDS = 10 * 60;
const types = new Set(['individual', 'smp', 'epc']);
const enc = (value) => encodeURIComponent(String(value));

function photoError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const baseUrl = () => String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
function requireStorage() {
  if (!hasSupabase() || !serviceKey()) throw photoError('O armazenamento privado de fotos ainda nao esta configurado.', 503);
}

async function request(url, options = {}) {
  requireStorage();
  const response = await fetch(url, {
    ...options,
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, ...(options.headers || {}) },
  });
  if (!response.ok) throw photoError(`Supabase Storage ${response.status}: ${await response.text()}`, response.status >= 500 ? 503 : 400);
  return response;
}

async function rest(pathname, options = {}) {
  const response = await request(`${baseUrl()}/rest/v1/${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  return response.json();
}

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!types.has(type)) throw photoError('Tipo de ficha invalido.');
  return type;
}

async function findStudent(type, retreatId, recordId) {
  type = normalizeType(type);
  if (type === 'individual') {
    const record = await getRecord('cursistas', recordId).catch(() => null);
    return record?.retiroId === retreatId ? record : null;
  }
  const records = type === 'epc' ? await listCursistasEpc(retreatId) : await listCursistasSmp(retreatId);
  return records.find((item) => String(item.id || item.numeroFichaSmp) === String(recordId)) || null;
}

async function findStudentByFile(type, retreatId, fileNumber) {
  type = normalizeType(type);
  const target = String(Number(fileNumber) || fileNumber || '').trim();
  if (type === 'individual') {
    return (await listRecords('cursistas')).find((item) => item.retiroId === retreatId && String(Number(item.numeroFichaIndividual) || item.numeroFichaIndividual) === target) || null;
  }
  const records = type === 'epc' ? await listCursistasEpc(retreatId) : await listCursistasSmp(retreatId);
  return records.find((item) => String(Number(item.numeroFichaSmp || item.id) || item.numeroFichaSmp || item.id) === target) || null;
}

async function activePhoto(type, retreatId, recordId) {
  type = normalizeType(type);
  const rows = await rest(`cursista_fotos?retiro_id=eq.${enc(retreatId)}&tipo=eq.${enc(type)}&registro_id=eq.${enc(recordId)}&ativo=eq.true&select=*&limit=1`);
  return rows[0] || null;
}

function jpegDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw photoError('O arquivo enviado nao e um JPEG valido.');
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw photoError('Nao foi possivel validar as dimensoes do JPEG.');
}

async function readRawImage(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw photoError('A foto final deve ter no maximo 2 MB.', 413);
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw photoError('Nenhuma foto foi enviada.');
  return buffer;
}

function validatePhotoBuffer(buffer, type) {
  if (buffer.length > MAX_BYTES) throw photoError('A foto final deve ter no maximo 2 MB.', 413);
  const dimensions = jpegDimensions(buffer);
  const expected = normalizeType(type) === 'individual' ? { width: 900, height: 1200 } : { width: 1200, height: 900 };
  if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
    throw photoError(`A imagem deve possuir ${expected.width} x ${expected.height} pixels.`);
  }
  return dimensions;
}

async function savePhoto({ type, retreatId, recordId, fileNumber, buffer, origin, actorId, allowReplace }) {
  type = normalizeType(type);
  const dimensions = validatePhotoBuffer(buffer, type);
  const objectId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const storagePath = `${retreatId}/${type}/${enc(recordId)}/${objectId}.jpg`;
  await request(`${baseUrl()}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST', body: buffer, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
  });
  const inserted = await rest('cursista_fotos', {
    method: 'POST',
    body: JSON.stringify({ retiro_id: retreatId, tipo: type, registro_id: String(recordId), numero_ficha: String(fileNumber), storage_path: storagePath, mime_type: 'image/jpeg', largura: dimensions.width, altura: dimensions.height, tamanho_bytes: buffer.length, ativo: false, origem: origin, autor_id: actorId || null }),
  });
  try {
    const activated = await rest('rpc/epc_ativar_foto_cursista', { method: 'POST', body: JSON.stringify({ p_foto_id: inserted[0].id, p_permitir_substituir: Boolean(allowReplace) }) });
    return Array.isArray(activated) ? activated[0] : activated;
  } catch (error) {
    throw error;
  }
}

async function downloadPhoto(type, retreatId, recordId) {
  const metadata = await activePhoto(type, retreatId, recordId);
  if (!metadata) return null;
  const response = await request(`${baseUrl()}/storage/v1/object/authenticated/${BUCKET}/${metadata.storage_path}`);
  return { metadata, buffer: Buffer.from(await response.arrayBuffer()) };
}

async function deleteStudentPhotos(type, retreatId, recordId) {
  type = normalizeType(type);
  const rows = await rest(`cursista_fotos?retiro_id=eq.${enc(retreatId)}&tipo=eq.${enc(type)}&registro_id=eq.${enc(recordId)}&select=id,storage_path`);
  if (!rows.length) return { deleted: 0 };
  const paths = rows.map((row) => row.storage_path).filter(Boolean);
  if (paths.length) {
    await request(`${baseUrl()}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: paths }),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  await rest(`cursista_fotos?retiro_id=eq.${enc(retreatId)}&tipo=eq.${enc(type)}&registro_id=eq.${enc(recordId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return { deleted: rows.length };
}

const ticketSecret = () => process.env.EPC_AUTH_SECRET || (!process.env.VERCEL ? 'epc-local-development-secret' : '');
function createPublicPhotoTicket({ token, retreatId, type, recordId, fileNumber }) {
  const secret = ticketSecret();
  // A ausencia do segredo nunca pode transformar um cadastro ja salvo em erro.
  // Nesse caso apenas o upload publico da foto fica indisponivel.
  if (!secret) return '';
  const payload = Buffer.from(JSON.stringify({ tokenHash: crypto.createHash('sha256').update(String(token)).digest('hex'), retreatId, type, recordId: String(recordId), fileNumber: String(fileNumber), exp: Math.floor(Date.now() / 1000) + PHOTO_TICKET_TTL_SECONDS })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyPublicPhotoTicket(ticket, token) {
  const secret = ticketSecret();
  const [payload, signature] = String(ticket || '').split('.');
  if (!secret || !payload || !signature) throw photoError('Autorizacao de foto invalida.', 403);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const first = Buffer.from(signature); const second = Buffer.from(expected);
  if (first.length !== second.length || !crypto.timingSafeEqual(first, second)) throw photoError('Autorizacao de foto invalida.', 403);
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw photoError('Autorizacao de foto invalida.', 403); }
  if (data.exp < Math.floor(Date.now() / 1000)) throw photoError('A autorizacao para enviar a foto expirou.', 403);
  if (data.tokenHash !== crypto.createHash('sha256').update(String(token)).digest('hex')) throw photoError('Autorizacao de foto invalida.', 403);
  return data;
}

module.exports = { activePhoto, createPublicPhotoTicket, deleteStudentPhotos, downloadPhoto, findStudent, findStudentByFile, normalizeType, readRawImage, savePhoto, verifyPublicPhotoTicket, validatePhotoBuffer };
