const fs = require('fs/promises');
const path = require('path');
const { stores } = require('./storeConfig');

const root = __dirname;
const databaseDir = path.join(root, 'database');
const databaseFile = path.join(databaseDir, 'db.json');

const emptyDatabase = () => Object.fromEntries(stores.map((store) => [store, []]));
const hasSupabase = () => Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
const canFallbackToFile = () => !process.env.VERCEL && process.env.NODE_ENV !== 'production';

const tableByStore = {
  retiros: 'retiros',
  pessoas: 'pessoas',
  adesoes: 'adesoes',
  casais: 'casais',
  cursistas: 'cursistas',
  comunidades: 'comunidades',
  crachas: 'crachas',
  configuracoes: 'configuracoes',
  usuarios: 'usuarios',
  perfis: 'perfis',
  permissoes: 'permissoes',
  perfil_permissoes: 'perfil_permissoes',
  usuario_permissoes: 'usuario_permissoes',
  usuario_retiros: 'usuario_retiros',
  relatorio_modelos: 'relatorio_modelos',
};

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
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      let errorDetails = null;
      try { errorDetails = JSON.parse(message); } catch {}
      const shouldRetry = attempt === 0
        && response.status === 401
        && errorDetails?.code === 'PGRST303'
        && errorDetails?.message === 'JWT issued at future';
      if (shouldRetry) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw new Error(`Supabase ${response.status}: ${message}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }
}

const enc = (value) => encodeURIComponent(String(value));
const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
const array = (value) => Array.isArray(value) ? value : [];
const nonEmptyArray = (value) => Array.isArray(value) && value.length > 0;
const dateOrNull = (value) => value ? String(value) : null;
const textOrNull = (value) => value === undefined || value === null || value === '' ? null : String(value);
const numberOrZero = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return Number(String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
};
const boolOrFalse = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return ['sim', 'true', '1', 'yes', 'on'].includes(normalized);
};
const boolOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  return boolOrFalse(value);
};
const choiceFromBool = (value) => value === null || value === undefined ? '' : (value ? 'Sim' : 'Não');
const duplicateEnrolmentCpfMessage = 'Este CPF ja possui adesao neste retiro.';
const duplicateStudentCpfMessage = 'Este CPF ja possui cadastro de cursista neste retiro.';
const duplicateStudentFileNumberMessage = 'Este numero de ficha ja possui cadastro de cursista neste retiro.';
const normalizeText = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const isUuid = (value = '') => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
const rowId = (row) => row?.cpf || row?.legacy_id || row?.id;
const requireSupabaseForCursistaSmp = () => {
  if (!hasSupabase()) throw new Error('Cursista SMP usa somente Supabase nesta etapa de testes.');
};
const requireSupabaseForCursistaEpc = () => {
  if (!hasSupabase()) throw new Error('Cursista EPC usa somente Supabase.');
};

function extras(record, mappedKeys) {
  return Object.fromEntries(Object.entries(record || {}).filter(([key, value]) => !mappedKeys.has(key) && value !== undefined));
}

async function upsert(table, rows, conflict = 'id') {
  const body = JSON.stringify(Array.isArray(rows) ? rows : [rows]);
  const result = await supabaseRequest(`${table}?on_conflict=${conflict}`, {
    method: 'POST',
    body,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  return Array.isArray(rows) ? result : result[0];
}

async function deleteWhere(table, filter) {
  await supabaseRequest(`${table}?${filter}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

async function pagedRows(pathname, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabaseRequest(`${pathname}&limit=${pageSize}&offset=${offset}`);
    rows.push(...array(page));
    if (!Array.isArray(page) || page.length < pageSize) return rows;
  }
}

async function allRows(table, order = 'updated_at.desc') {
  const orderQuery = order ? `&order=${order}` : '';
  return pagedRows(`${table}?select=*${orderQuery}`);
}

const isMissingRelationError = (error, table) => {
  const message = String(error?.message || '');
  return message.includes('PGRST205')
    && (message.includes(`public.${table}`) || message.includes(`'${table}'`) || message.includes(`\"${table}\"`));
};

async function optionalAllRows(table, order = '') {
  try {
    return await allRows(table, order);
  } catch (error) {
    if (isMissingRelationError(error, table)) return [];
    throw error;
  }
}

async function rowsWhere(table, filter, order = '') {
  const orderQuery = order ? `&order=${order}` : '';
  return pagedRows(`${table}?${filter}&select=*${orderQuery}`);
}

async function oneWhere(table, filter) {
  const rows = await supabaseRequest(`${table}?${filter}&select=*&limit=1`);
  return rows[0] || null;
}

function mapRetreat(row, children = {}) {
  const setores = array(children.setores).sort((a, b) => (a.ordem_quadrante ?? 9999) - (b.ordem_quadrante ?? 9999) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  const dias = array(children.dias).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const contribuicoes = array(children.contribuicoes).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const closedSectorKeys = new Set(array(row.extras?.setoresInscricoesEncerradas).map(normalizeText));
  return {
    ...(row.extras || {}),
    id: row.id,
    nome: row.nome,
    dataInicio: row.data_inicio || '',
    dataTermino: row.data_termino || '',
    local: row.local || '',
    coordenacaoGeral: row.coordenacao_geral || '',
    coordenacaoRetiro: row.coordenacao_retiro || '',
    valorInscricaoCursista: Number(row.valor_inscricao_cursista || 0),
    valorInscricaoVoluntario: Number(row.valor_inscricao_voluntario || 0),
    valorFoto: Number(row.valor_foto || 0),
    valorCamisetaOficial: Number(row.valor_camiseta_oficial || 0),
    descontoParentesco: Number(row.desconto_parentesco || 0),
    idadeMaximaEspacoKids: Number(row.idade_maxima_espaco_kids || 0),
    recebedorToken: row.recebedor_token || '',
    setores: setores.map((item) => item.nome),
    setoresPublicos: setores.filter((item) => item.publico).map((item) => item.nome),
    ordemQuadrante: setores.filter((item) => item.ordem_quadrante !== null && item.ordem_quadrante !== undefined).sort((a, b) => a.ordem_quadrante - b.ordem_quadrante).map((item) => item.nome),
    dias: dias.map((item) => item.nome),
    contribuicoes: contribuicoes.map((item) => item.descricao),
    linksSetores: setores.map((item) => ({
      setor: item.nome,
      token: item.legacy_token || item.cadastro_token || '',
      cadastroToken: item.cadastro_token || item.legacy_token || '',
      acompanhamentoToken: item.acompanhamento_token || item.legacy_token || '',
      inscricoesEncerradas: closedSectorKeys.has(normalizeText(item.nome)),
    })),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listRetreats() {
  const [rows, setores, dias, contribuicoes] = await Promise.all([
    allRows('retiros'),
    allRows('retiro_setores', 'ordem_quadrante.asc'),
    allRows('retiro_dias', 'ordem.asc'),
    allRows('retiro_contribuicoes', 'ordem.asc'),
  ]);
  return rows.map((row) => mapRetreat(row, {
    setores: setores.filter((item) => item.retiro_id === row.id),
    dias: dias.filter((item) => item.retiro_id === row.id),
    contribuicoes: contribuicoes.filter((item) => item.retiro_id === row.id),
  }));
}

async function getRetreat(id) {
  const row = await oneWhere('retiros', `id=eq.${enc(id)}`);
  if (!row) return null;
  const [setores, dias, contribuicoes] = await Promise.all([
    rowsWhere('retiro_setores', `retiro_id=eq.${enc(id)}`, 'ordem_quadrante.asc'),
    rowsWhere('retiro_dias', `retiro_id=eq.${enc(id)}`, 'ordem.asc'),
    rowsWhere('retiro_contribuicoes', `retiro_id=eq.${enc(id)}`, 'ordem.asc'),
  ]);
  return mapRetreat(row, { setores, dias, contribuicoes });
}

async function referencedIds(table, column, ids = []) {
  if (!ids.length) return new Set();
  const rows = await rowsWhere(table, `${column}=in.(${ids.map(enc).join(',')})`);
  return new Set(rows.map((row) => row[column]).filter(Boolean));
}

async function saveRetreat(record) {
  const mappedKeys = new Set(['id', 'nome', 'dataInicio', 'dataTermino', 'local', 'coordenacaoGeral', 'coordenacaoRetiro', 'valorInscricaoCursista', 'valorInscricaoVoluntario', 'valorFoto', 'valorCamisetaOficial', 'descontoParentesco', 'idadeMaximaEspacoKids', 'recebedorToken', 'setores', 'setoresPublicos', 'setoresInscricoesEncerradas', 'ordemQuadrante', 'dias', 'contribuicoes', 'linksSetores', 'setorLinks', 'status', 'createdAt', 'updatedAt']);
  const closedSectorKeysForExtras = new Set(array(record.setoresInscricoesEncerradas).map(normalizeText));
  const retreatExtras = {
    ...extras(record, mappedKeys),
    setoresInscricoesEncerradas: array(record.setores).filter((sector) => closedSectorKeysForExtras.has(normalizeText(sector))),
  };
  const [existingSectors, existingDays] = await Promise.all([
    rowsWhere('retiro_setores', `retiro_id=eq.${enc(record.id)}`),
    rowsWhere('retiro_dias', `retiro_id=eq.${enc(record.id)}`),
  ]);
  await upsert('retiros', compact({
    id: record.id,
    nome: record.nome || 'Retiro sem nome',
    data_inicio: dateOrNull(record.dataInicio),
    data_termino: dateOrNull(record.dataTermino),
    local: record.local || '',
    coordenacao_geral: record.coordenacaoGeral || '',
    coordenacao_retiro: record.coordenacaoRetiro || '',
    valor_inscricao_cursista: numberOrZero(record.valorInscricaoCursista),
    valor_inscricao_voluntario: numberOrZero(record.valorInscricaoVoluntario),
    valor_foto: numberOrZero(record.valorFoto),
    valor_camiseta_oficial: numberOrZero(record.valorCamisetaOficial),
    desconto_parentesco: numberOrZero(record.descontoParentesco),
    idade_maxima_espaco_kids: Number(record.idadeMaximaEspacoKids || 0),
    recebedor_token: textOrNull(record.recebedorToken),
    status: record.status || 'preparacao',
    created_at: record.createdAt || undefined,
    updated_at: record.updatedAt || undefined,
    extras: retreatExtras,
  }));

  await deleteWhere('retiro_contribuicoes', `retiro_id=eq.${enc(record.id)}`);

  const publicSet = new Set(array(record.setoresPublicos).map(normalizeText));
  const quadranteOrder = new Map(array(record.ordemQuadrante).map((nome, index) => [normalizeText(nome), index + 1]));
  const links = new Map(array(record.linksSetores || record.setorLinks).map((item) => [normalizeText(item.setor || item.sector), item]));
  const existingSectorByKey = new Map(existingSectors.map((setor) => [normalizeText(setor.nome_normalizado || setor.nome), setor]));
  const existingDayByName = new Map(existingDays.map((dia) => [normalizeText(dia.nome), dia]));
  const setores = array(record.setores).filter(Boolean).map((nome, index) => {
    const link = links.get(normalizeText(nome)) || {};
    const existing = existingSectorByKey.get(normalizeText(nome));
    return {
      id: existing?.id,
      retiro_id: record.id,
      nome,
      nome_normalizado: normalizeText(nome),
      publico: publicSet.has(normalizeText(nome)),
      ordem_quadrante: quadranteOrder.get(normalizeText(nome)) || index + 1,
      cadastro_token: textOrNull(link.cadastroToken || link.token),
      acompanhamento_token: textOrNull(link.acompanhamentoToken || link.token),
      legacy_token: textOrNull(link.token),
    };
  });
  const dias = array(record.dias).filter(Boolean).map((nome, index) => {
    const existing = existingDayByName.get(normalizeText(nome));
    return { id: existing?.id, retiro_id: record.id, nome, ordem: index + 1 };
  });
  const contribuicoes = array(record.contribuicoes).filter(Boolean).map((descricao, index) => ({ retiro_id: record.id, descricao, valor: numberOrZero(descricao), ordem: index + 1 }));
  const selectedSectorKeys = new Set(setores.map((setor) => normalizeText(setor.nome)));
  const selectedDayKeys = new Set(dias.map((dia) => normalizeText(dia.nome)));
  const removedSectors = existingSectors.filter((setor) => !selectedSectorKeys.has(normalizeText(setor.nome_normalizado || setor.nome)));
  const removedDays = existingDays.filter((dia) => !selectedDayKeys.has(normalizeText(dia.nome)));
  const [referencedSectors, referencedDays] = await Promise.all([
    referencedIds('adesao_setores', 'setor_id', removedSectors.map((setor) => setor.id)),
    referencedIds('adesao_dias', 'dia_id', removedDays.map((dia) => dia.id)),
  ]);
  const removableSectorIds = removedSectors.map((setor) => setor.id).filter((id) => id && !referencedSectors.has(id));
  const removableDayIds = removedDays.map((dia) => dia.id).filter((id) => id && !referencedDays.has(id));
  const existingSetores = setores.filter((setor) => setor.id);
  const newSetores = setores.filter((setor) => !setor.id).map(({ id, ...setor }) => setor);
  const existingDias = dias.filter((dia) => dia.id);
  const newDias = dias.filter((dia) => !dia.id).map(({ id, ...dia }) => dia);

  await Promise.all([
    existingSetores.length ? upsert('retiro_setores', existingSetores) : null,
    newSetores.length ? upsert('retiro_setores', newSetores) : null,
    existingDias.length ? upsert('retiro_dias', existingDias) : null,
    newDias.length ? upsert('retiro_dias', newDias) : null,
    contribuicoes.length ? upsert('retiro_contribuicoes', contribuicoes) : null,
    removableSectorIds.length ? deleteWhere('retiro_setores', `id=in.(${removableSectorIds.map(enc).join(',')})`) : null,
    removableDayIds.length ? deleteWhere('retiro_dias', `id=in.(${removableDayIds.map(enc).join(',')})`) : null,
  ]);
  return getRetreat(record.id);
}

function mapPerson(row) {
  return {
    ...(row.extras || {}),
    id: rowId(row),
    cpf: row.cpf || row.extras?.cpf || '',
    nome: row.nome,
    nomeNormalizado: row.nome_normalizado || row.extras?.nomeNormalizado || '',
    nascimento: row.nascimento || '',
    genero: row.genero || '',
    telefone: row.telefone || '',
    cep: row.cep || '',
    endereco: row.endereco || '',
    numero: row.numero || '',
    bairro: row.bairro || '',
    cidade: row.cidade || '',
    estado: row.estado || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findPersonRow(id) {
  if (!id) return null;
  if (isUuid(id)) return oneWhere('pessoas', `id=eq.${enc(id)}`);
  return oneWhere('pessoas', `cpf=eq.${enc(id)}`);
}

async function savePerson(record) {
  const mappedKeys = new Set(['id', 'cpf', 'nome', 'nomeNormalizado', 'nascimento', 'genero', 'telefone', 'cep', 'endereco', 'numero', 'bairro', 'cidade', 'estado', 'createdAt', 'updatedAt']);
  const current = await findPersonRow(record.id || record.cpf);
  const cpf = record.cpf || (!isUuid(record.id) ? record.id : '');
  const row = await upsert('pessoas', compact({
    id: current?.id || (isUuid(record.id) ? record.id : undefined),
    cpf: textOrNull(cpf),
    nome: record.nome || 'Sem nome',
    nome_normalizado: record.nomeNormalizado || normalizeText(record.nome || ''),
    nascimento: dateOrNull(record.nascimento),
    genero: record.genero || '',
    telefone: record.telefone || '',
    cep: record.cep || '',
    endereco: record.endereco || '',
    numero: record.numero || '',
    bairro: record.bairro || '',
    cidade: record.cidade || '',
    estado: record.estado || '',
    created_at: record.createdAt || undefined,
    updated_at: record.updatedAt || undefined,
    extras: extras(record, mappedKeys),
  }));
  return mapPerson(row);
}

async function listPeople() {
  return (await allRows('pessoas')).map(mapPerson);
}

async function getPerson(id) {
  const row = await findPersonRow(id);
  return row ? mapPerson(row) : null;
}

async function deletePerson(id) {
  if (isUuid(id)) return deleteWhere('pessoas', `id=eq.${enc(id)}`);
  return deleteWhere('pessoas', `cpf=eq.${enc(id)}`);
}

async function ensureRetreatDay(retiroId, nome) {
  let row = (await rowsWhere('retiro_dias', `retiro_id=eq.${enc(retiroId)}&nome=eq.${enc(nome)}`))[0];
  if (!row) row = await upsert('retiro_dias', { retiro_id: retiroId, nome, ordem: 999 });
  return row;
}

async function ensureRetreatSector(retiroId, nome) {
  let row = (await rowsWhere('retiro_setores', `retiro_id=eq.${enc(retiroId)}&nome=eq.${enc(nome)}`))[0];
  if (!row) row = await upsert('retiro_setores', { retiro_id: retiroId, nome, nome_normalizado: normalizeText(nome), publico: true, ordem_quadrante: 999 });
  return row;
}

async function ensureCouple(record) {
  if (!isUuid(record.casalId)) return null;
  return upsert('casais', {
    id: record.casalId,
    retiro_id: record.retiroId || null,
    nome: record.nome || '',
    extras: {},
  });
}

function mapEnrolment(row, lookups = {}) {
  const person = lookups.personByDbId?.get(row.pessoa_id);
  const dias = array(lookups.diasByAdesao?.get(row.id)).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((item) => item.nome);
  const setores = array(lookups.setoresByAdesao?.get(row.id)).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')).map((item) => item.nome);
  const retirosAnteriores = array(lookups.retirosByAdesao?.get(row.id)).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((item) => item.nome);
  const espacoKids = array(lookups.kidsByAdesao?.get(row.id)).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((item) => ({ nome: item.nome || '', nascimento: item.nascimento || '' }));
  return {
    ...(row.extras || {}),
    id: row.id,
    retiroId: row.retiro_id,
    pessoaId: person ? rowId(person) : row.pessoa_id,
    nome: row.nome || person?.nome || '',
    dias,
    setores,
    retirosAnteriores,
    quadrante: choiceFromBool(row.quadrante),
    foto: choiceFromBool(row.foto),
    contribuicao: row.contribuicao || '',
    coordenacao: row.coordenacao || '',
    coordenacaoSetor: row.coordenacao_setor || '',
    espacoKids,
    espacoKidsNaoNecessito: row.espaco_kids_nao_necessito,
    observacao: row.observacao || '',
    termoVoluntariadoAceito: row.termo_voluntariado_aceito,
    termoVoluntariadoAceitoEm: row.termo_voluntariado_aceito_em,
    tipoFicha: row.tipo_ficha,
    casalId: row.casal_id || row.extras?.casalId || '',
    papelNoCasal: row.papel_no_casal || '',
    tipoFinanceiro: row.tipo_financeiro || '',
    taxaPaga: row.taxa_paga,
    valorPago: Number(row.valor_pago || 0),
    formaPagamento: row.forma_pagamento || '',
    recebedorObservacao: row.recebedor_observacao || '',
    status: row.status,
    validada: row.validada,
    validadoEm: row.validado_em,
    enviadoEm: row.enviado_em,
    atualizadoEm: row.atualizado_em || row.updated_at,
    dadosPessoais: row.dados_pessoais || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function enrolmentLookups(rows) {
  const ids = new Set(rows.map((row) => row.id));
  const [people, linksDias, dias, linksSetores, setores, retiros, kids] = await Promise.all([
    allRows('pessoas'),
    allRows('adesao_dias', ''),
    allRows('retiro_dias', ''),
    allRows('adesao_setores', ''),
    allRows('retiro_setores', ''),
    allRows('adesao_retiros_anteriores', 'ordem.asc'),
    allRows('adesao_espaco_kids', 'ordem.asc'),
  ]);
  const personByDbId = new Map(people.map((person) => [person.id, person]));
  const dayById = new Map(dias.map((dia) => [dia.id, dia]));
  const sectorById = new Map(setores.map((setor) => [setor.id, setor]));
  const diasByAdesao = new Map();
  linksDias.filter((item) => ids.has(item.adesao_id)).forEach((item) => {
    const list = diasByAdesao.get(item.adesao_id) || [];
    if (dayById.has(item.dia_id)) list.push(dayById.get(item.dia_id));
    diasByAdesao.set(item.adesao_id, list);
  });
  const setoresByAdesao = new Map();
  linksSetores.filter((item) => ids.has(item.adesao_id)).forEach((item) => {
    const list = setoresByAdesao.get(item.adesao_id) || [];
    if (sectorById.has(item.setor_id)) list.push(sectorById.get(item.setor_id));
    setoresByAdesao.set(item.adesao_id, list);
  });
  const groupByAdesao = (records) => records.filter((item) => ids.has(item.adesao_id)).reduce((map, item) => map.set(item.adesao_id, [...(map.get(item.adesao_id) || []), item]), new Map());
  return { personByDbId, diasByAdesao, setoresByAdesao, retirosByAdesao: groupByAdesao(retiros), kidsByAdesao: groupByAdesao(kids) };
}

async function listEnrolments() {
  const rows = await allRows('adesoes');
  const lookups = await enrolmentLookups(rows);
  return rows.map((row) => mapEnrolment(row, lookups));
}

async function getEnrolment(id) {
  const row = await oneWhere('adesoes', `id=eq.${enc(id)}`);
  if (!row) return null;
  const lookups = await enrolmentLookups([row]);
  return mapEnrolment(row, lookups);
}

async function assertUniqueEnrolmentPerson(record, person) {
  if (!record?.retiroId || !person?.id) return;
  const rows = await rowsWhere('adesoes', `retiro_id=eq.${enc(record.retiroId)}&pessoa_id=eq.${enc(person.id)}`);
  const conflict = rows.find((row) => row.id !== record.id);
  if (conflict) {
    const error = new Error(duplicateEnrolmentCpfMessage);
    error.code = 'DUPLICATE_RETREAT_ENROLMENT_CPF';
    error.conflictId = conflict.id;
    throw error;
  }
}

async function saveEnrolment(record) {
  const current = record.id ? await getEnrolment(record.id).catch(() => null) : null;
  const nextRecord = { ...record };
  ['dias', 'setores', 'retirosAnteriores'].forEach((field) => {
    if (current && nonEmptyArray(current[field]) && !nonEmptyArray(nextRecord[field])) {
      nextRecord[field] = current[field];
    }
  });
  record = nextRecord;
  const person = await findPersonRow(record.pessoaId);
  await assertUniqueEnrolmentPerson(record, person);
  const couple = await ensureCouple(record);
  const mappedKeys = new Set(['id', 'retiroId', 'pessoaId', 'nome', 'dias', 'setores', 'retirosAnteriores', 'quadrante', 'foto', 'contribuicao', 'coordenacao', 'coordenacaoSetor', 'espacoKids', 'espacoKidsNaoNecessito', 'observacao', 'termoVoluntariadoAceito', 'termoVoluntariadoAceitoEm', 'tipoFicha', 'casalId', 'papelNoCasal', 'tipoFinanceiro', 'taxaPaga', 'valorPago', 'formaPagamento', 'recebedorObservacao', 'status', 'validada', 'validadoEm', 'enviadoEm', 'atualizadoEm', 'dadosPessoais', 'createdAt', 'updatedAt']);
  try {
    await upsert('adesoes', compact({
      id: record.id,
      retiro_id: record.retiroId,
      pessoa_id: person?.id || null,
      casal_id: couple?.id || null,
      nome: record.nome || person?.nome || '',
      tipo_ficha: record.tipoFicha || 'Individual',
      papel_no_casal: record.papelNoCasal || '',
      quadrante: boolOrFalse(record.quadrante),
      foto: boolOrFalse(record.foto),
      contribuicao: record.contribuicao || '',
      coordenacao: record.coordenacao || '',
      coordenacao_setor: record.coordenacaoSetor || '',
      espaco_kids_nao_necessito: Boolean(record.espacoKidsNaoNecessito),
      observacao: record.observacao || '',
      termo_voluntariado_aceito: Boolean(record.termoVoluntariadoAceito),
      termo_voluntariado_aceito_em: dateOrNull(record.termoVoluntariadoAceitoEm),
      tipo_financeiro: record.tipoFinanceiro || '',
      taxa_paga: Boolean(record.taxaPaga),
      valor_pago: numberOrZero(record.valorPago),
      forma_pagamento: record.formaPagamento || '',
      recebedor_observacao: record.recebedorObservacao || '',
      status: record.status || 'pendente_validacao',
      validada: Boolean(record.validada),
      validado_em: dateOrNull(record.validadoEm),
      enviado_em: record.enviadoEm || undefined,
      atualizado_em: record.atualizadoEm || undefined,
      created_at: record.createdAt || undefined,
      updated_at: record.updatedAt || undefined,
      dados_pessoais: record.dadosPessoais || {},
      extras: extras(record, mappedKeys),
    }));
  } catch (error) {
    if (String(error.message || '').includes('adesoes_retiro_pessoa_unique')) {
      const duplicateError = new Error(duplicateEnrolmentCpfMessage);
      duplicateError.code = 'DUPLICATE_RETREAT_ENROLMENT_CPF';
      throw duplicateError;
    }
    throw error;
  }
  await Promise.all([
    deleteWhere('adesao_dias', `adesao_id=eq.${enc(record.id)}`),
    deleteWhere('adesao_setores', `adesao_id=eq.${enc(record.id)}`),
    deleteWhere('adesao_retiros_anteriores', `adesao_id=eq.${enc(record.id)}`),
    deleteWhere('adesao_espaco_kids', `adesao_id=eq.${enc(record.id)}`),
  ]);
  const dias = await Promise.all(array(record.dias).filter(Boolean).map((nome) => ensureRetreatDay(record.retiroId, nome)));
  const setores = await Promise.all(array(record.setores).filter(Boolean).map((nome) => ensureRetreatSector(record.retiroId, nome)));
  await Promise.all([
    dias.length ? upsert('adesao_dias', dias.map((dia) => ({ adesao_id: record.id, dia_id: dia.id })), 'adesao_id,dia_id') : null,
    setores.length ? upsert('adesao_setores', setores.map((setor) => ({ adesao_id: record.id, setor_id: setor.id })), 'adesao_id,setor_id') : null,
    array(record.retirosAnteriores).length ? upsert('adesao_retiros_anteriores', array(record.retirosAnteriores).map((nome, index) => ({ adesao_id: record.id, nome, ordem: index + 1 }))) : null,
    array(record.espacoKids).length ? upsert('adesao_espaco_kids', array(record.espacoKids).map((kid, index) => ({ adesao_id: record.id, nome: kid.nome || '', nascimento: dateOrNull(kid.nascimento), ordem: index + 1 }))) : null,
    couple ? upsert('casal_membros', { casal_id: couple.id, adesao_id: record.id, papel: record.papelNoCasal || '' }, 'casal_id,adesao_id') : null,
  ]);
  return getEnrolment(record.id);
}

function mapStudent(row) {
  return {
    ...(row.extras || {}),
    id: row.id,
    cpf: row.cpf || row.extras?.cpf || '',
    retiroId: row.retiro_id,
    numeroFichaIndividual: row.numero_ficha_individual || row.extras?.numeroFichaIndividual || '',
    nome: row.nome,
    nascimento: row.nascimento || '',
    telefone: row.telefone || '',
    cep: row.cep || '',
    rua: row.rua || '',
    endereco: row.rua || row.extras?.endereco || '',
    numero: row.numero || '',
    bairro: row.bairro || '',
    cidade: row.cidade || '',
    estado: row.estado || '',
    batizado: choiceFromBool(row.batizado),
    primeiraComunhao: choiceFromBool(row.primeira_comunhao),
    estuda: choiceFromBool(row.estuda),
    serie: row.serie || '',
    escola: row.escola || '',
    fezRetiro: choiceFromBool(row.fez_retiro),
    qualRetiro: row.qual_retiro || '',
    nomePai: row.nome_pai || '',
    telefonePai: row.telefone_pai || '',
    nomeMae: row.nome_mae || '',
    telefoneMae: row.telefone_mae || '',
    paisMovimento: choiceFromBool(row.pais_movimento),
    qualMovimento: row.qual_movimento || '',
    convidou: row.convidou || '',
    camiseta: row.camiseta || '',
    camisetaOutro: row.camiseta_outro || '',
    intoleranciaAlimentos: choiceFromBool(row.intolerancia_alimentos),
    qualIntolerancia: row.qual_intolerancia || '',
    alergiaMedicamento: choiceFromBool(row.alergia_medicamento),
    qualAlergia: row.qual_alergia || '',
    medicamentoCabeca: row.medicamento_cabeca || '',
    medicamentoEstomago: row.medicamento_estomago || '',
    valorInscricao: Number(row.valor_inscricao || 0),
    valorPago: Number(row.valor_pago || 0),
    saldoPagar: Number(row.saldo_pagar || 0),
    recebedorValorPago: Number(row.recebedor_valor_pago || 0),
    recebedorTaxaPaga: row.recebedor_taxa_paga,
    recebedorFormaPagamento: row.recebedor_forma_pagamento || '',
    recebedorObservacao: row.recebedor_observacao || '',
    criadoEm: row.criado_em,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findStudentRow(id) {
  if (!id) return null;
  if (isUuid(id)) return oneWhere('cursistas', `id=eq.${enc(id)}`);
  const legacyMatches = await rowsWhere('cursistas', `cpf=eq.${enc(id)}`);
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

async function findStudentRowForRetreat(id, retreatId) {
  if (!id) return null;
  if (isUuid(id)) return oneWhere('cursistas', `id=eq.${enc(id)}&retiro_id=eq.${enc(retreatId)}`);
  if (!retreatId) return findStudentRow(id);
  return oneWhere('cursistas', `retiro_id=eq.${enc(retreatId)}&cpf=eq.${enc(id)}`);
}

async function assertStudentBusinessKeys(record, currentId = '') {
  const retreatId = String(record.retiroId || '').trim();
  const cpf = String(record.cpf || '').trim();
  const fileNumber = Number(record.numeroFichaIndividual);
  if (!retreatId) return;
  if (cpf) {
    const duplicateCpf = (await rowsWhere('cursistas', `retiro_id=eq.${enc(retreatId)}&cpf=eq.${enc(cpf)}`))
      .find((row) => row.id !== currentId);
    if (duplicateCpf) {
      const error = new Error(duplicateStudentCpfMessage);
      error.code = 'DUPLICATE_RETREAT_STUDENT_CPF';
      throw error;
    }
  }
  if (Number.isInteger(fileNumber) && fileNumber > 0) {
    const duplicateFileNumber = (await rowsWhere('cursistas', `retiro_id=eq.${enc(retreatId)}&numero_ficha_individual=eq.${enc(fileNumber)}`))
      .find((row) => row.id !== currentId);
    if (duplicateFileNumber) {
      const error = new Error(duplicateStudentFileNumberMessage);
      error.code = 'DUPLICATE_RETREAT_STUDENT_FILE_NUMBER';
      throw error;
    }
  }
}

async function saveStudent(record) {
  const mappedKeys = new Set(['id', 'cpf', 'retiroId', 'numeroFichaIndividual', 'nome', 'nascimento', 'telefone', 'cep', 'rua', 'endereco', 'numero', 'bairro', 'cidade', 'estado', 'batizado', 'primeiraComunhao', 'estuda', 'serie', 'escola', 'fezRetiro', 'qualRetiro', 'nomePai', 'telefonePai', 'nomeMae', 'telefoneMae', 'paisMovimento', 'qualMovimento', 'convidou', 'camiseta', 'camisetaOutro', 'intoleranciaAlimentos', 'qualIntolerancia', 'alergiaMedicamento', 'qualAlergia', 'medicamentoCabeca', 'medicamentoEstomago', 'valorInscricao', 'valorPago', 'saldoPagar', 'recebedorValorPago', 'recebedorTaxaPaga', 'recebedorFormaPagamento', 'recebedorObservacao', 'criadoEm', 'createdAt', 'updatedAt']);
  const current = isUuid(record.id) ? await findStudentRow(record.id) : null;
  const studentId = current?.id || (isUuid(record.id) ? record.id : undefined);
  const cpf = record.cpf || '';
  await assertStudentBusinessKeys(record, studentId);
  let row;
  try {
    row = await upsert('cursistas', compact({
    id: studentId,
    cpf: textOrNull(cpf),
    retiro_id: record.retiroId,
    numero_ficha_individual: record.numeroFichaIndividual ? Number(record.numeroFichaIndividual) : null,
    nome: record.nome || 'Sem nome',
    nascimento: dateOrNull(record.nascimento),
    telefone: record.telefone || '',
    cep: record.cep || '',
    rua: record.rua || record.endereco || '',
    numero: record.numero || '',
    bairro: record.bairro || '',
    cidade: record.cidade || '',
    estado: record.estado || '',
    batizado: boolOrFalse(record.batizado),
    primeira_comunhao: boolOrFalse(record.primeiraComunhao),
    estuda: boolOrFalse(record.estuda),
    serie: record.serie || '',
    escola: record.escola || '',
    fez_retiro: boolOrFalse(record.fezRetiro),
    qual_retiro: record.qualRetiro || '',
    nome_pai: record.nomePai || '',
    telefone_pai: record.telefonePai || '',
    nome_mae: record.nomeMae || '',
    telefone_mae: record.telefoneMae || '',
    pais_movimento: boolOrFalse(record.paisMovimento),
    qual_movimento: record.qualMovimento || '',
    convidou: record.convidou || '',
    camiseta: record.camiseta || '',
    camiseta_outro: record.camisetaOutro || '',
    intolerancia_alimentos: boolOrFalse(record.intoleranciaAlimentos),
    qual_intolerancia: record.qualIntolerancia || '',
    alergia_medicamento: boolOrFalse(record.alergiaMedicamento),
    qual_alergia: record.qualAlergia || '',
    medicamento_cabeca: record.medicamentoCabeca || '',
    medicamento_estomago: record.medicamentoEstomago || '',
    valor_inscricao: numberOrZero(record.valorInscricao),
    valor_pago: numberOrZero(record.valorPago),
    saldo_pagar: numberOrZero(record.saldoPagar),
    recebedor_valor_pago: numberOrZero(record.recebedorValorPago),
    recebedor_taxa_paga: Boolean(record.recebedorTaxaPaga),
    recebedor_forma_pagamento: record.recebedorFormaPagamento || '',
    recebedor_observacao: record.recebedorObservacao || '',
    criado_em: record.criadoEm || undefined,
    created_at: record.createdAt || undefined,
    updated_at: record.updatedAt || undefined,
    extras: extras(record, mappedKeys),
    }));
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('cursistas_retiro_cpf_unique')) throw new Error(duplicateStudentCpfMessage);
    if (message.includes('cursistas_retiro_numero_ficha_individual_unique')) throw new Error(duplicateStudentFileNumberMessage);
    throw error;
  }
  return mapStudent(row);
}

const cursistaSmpKidCareRecordKeys = Array.from({ length: 5 }, (_, index) => {
  const kidNumber = index + 1;
  return [
    `smpKidProblemaSaude${kidNumber}`,
    `smpKidDescricaoSaude${kidNumber}`,
    `smpKidIntolerancia${kidNumber}`,
    `smpKidDescricaoIntolerancia${kidNumber}`,
  ];
}).flat();

function mapCursistaSmpKidCare(row) {
  const fields = {};
  for (let kidNumber = 1; kidNumber <= 5; kidNumber += 1) {
    fields[`smpKidProblemaSaude${kidNumber}`] = choiceFromBool(row[`comum_kid_${kidNumber}_problema_saude`]);
    fields[`smpKidDescricaoSaude${kidNumber}`] = row[`comum_kid_${kidNumber}_descricao_saude`] || '';
    fields[`smpKidIntolerancia${kidNumber}`] = choiceFromBool(row[`comum_kid_${kidNumber}_intolerancia_alimentar`]);
    fields[`smpKidDescricaoIntolerancia${kidNumber}`] = row[`comum_kid_${kidNumber}_descricao_intolerancia`] || '';
  }
  return fields;
}

function mapCursistaSmpKidCareRow(record) {
  const fields = {};
  for (let kidNumber = 1; kidNumber <= 5; kidNumber += 1) {
    fields[`comum_kid_${kidNumber}_problema_saude`] = boolOrNull(record[`smpKidProblemaSaude${kidNumber}`]);
    fields[`comum_kid_${kidNumber}_descricao_saude`] = textOrNull(record[`smpKidDescricaoSaude${kidNumber}`]);
    fields[`comum_kid_${kidNumber}_intolerancia_alimentar`] = boolOrNull(record[`smpKidIntolerancia${kidNumber}`]);
    fields[`comum_kid_${kidNumber}_descricao_intolerancia`] = textOrNull(record[`smpKidDescricaoIntolerancia${kidNumber}`]);
  }
  return fields;
}

function mapCursistaSmp(row) {
  return {
    ...(row.extras || {}),
    retiroId: row.retiro_id,
    id: row.id,
    numeroFichaSmp: row.id,
    nomeDele: row.ele_nome || '',
    nascimentoDele: row.ele_nascimento || '',
    cpfDele: row.ele_cpf || '',
    profissaoDele: row.ele_profissao || '',
    foneDele: row.ele_fone || '',
    crismaDele: choiceFromBool(row.ele_crisma),
    religiaoDele: row.ele_religiao || '',
    missaDele: row.ele_participa_missas || '',
    movimentoIgrejaDele: choiceFromBool(row.ele_movimento_igreja),
    qualMovimentoDele: row.ele_qual_movimento || '',
    casamentoDele: row.ele_data_primeiro_casamento || '',
    filhosDele: row.ele_filhos_primeiro_casamento || '',
    saudeDele: choiceFromBool(row.ele_problema_saude),
    qualSaudeDele: row.ele_qual_problema_saude || '',
    intoleranciaAlimentarDele: choiceFromBool(row.ele_intolerancia_alimentar),
    qualIntoleranciaAlimentarDele: row.ele_qual_intolerancia_alimentar || '',
    manequimDele: row.ele_manequim || '',
    nomeDela: row.ela_nome || '',
    nascimentoDela: row.ela_nascimento || '',
    cpfDela: row.ela_cpf || '',
    profissaoDela: row.ela_profissao || '',
    foneDela: row.ela_fone || '',
    crismaDela: choiceFromBool(row.ela_crisma),
    religiaoDela: row.ela_religiao || '',
    missaDela: row.ela_participa_missas || '',
    movimentoIgrejaDela: choiceFromBool(row.ela_movimento_igreja),
    qualMovimentoDela: row.ela_qual_movimento || '',
    casamentoDela: row.ela_data_primeiro_casamento || '',
    filhosDela: row.ela_filhos_primeiro_casamento || '',
    saudeDela: choiceFromBool(row.ela_problema_saude),
    qualSaudeDela: row.ela_qual_problema_saude || '',
    intoleranciaAlimentarDela: choiceFromBool(row.ela_intolerancia_alimentar),
    qualIntoleranciaAlimentarDela: row.ela_qual_intolerancia_alimentar || '',
    manequimDela: row.ela_manequim || '',
    cep: row.comum_cep || '',
    endereco: row.comum_endereco || '',
    numero: row.comum_numero || '',
    nrApto: row.comum_nr_apto || '',
    bairro: row.comum_bairro || '',
    cidade: row.comum_cidade || '',
    estadoSmp: row.comum_estado || '',
    uniaoCasal: row.comum_data_uniao_casal || '',
    filhosUniao: row.comum_filhos_uniao || '',
    outrasUnioes: choiceFromBool(row.comum_outras_unioes),
    smpKidsNotNeeded: Boolean(row.comum_espaco_kids_nao_necessito),
    smpKidNome1: row.comum_kid_1_nome || '',
    smpKidNascimento1: row.comum_kid_1_nascimento || '',
    smpKidNome2: row.comum_kid_2_nome || '',
    smpKidNascimento2: row.comum_kid_2_nascimento || '',
    smpKidNome3: row.comum_kid_3_nome || '',
    smpKidNascimento3: row.comum_kid_3_nascimento || '',
    smpKidNome4: row.comum_kid_4_nome || '',
    smpKidNascimento4: row.comum_kid_4_nascimento || '',
    smpKidNome5: row.comum_kid_5_nome || '',
    smpKidNascimento5: row.comum_kid_5_nascimento || '',
    ...mapCursistaSmpKidCare(row),
    precisaAcolhimento: choiceFromBool(row.comum_precisa_acolhimento),
    nomeApresentante: row.comum_nome_apresentante || '',
    foneApresentante: row.comum_fone_apresentante || '',
    cursoApresentante: row.comum_curso_apresentante || '',
    cidadeApresentante: row.comum_cidade_apresentante || '',
    paroquiaApresentante: row.comum_paroquia_apresentante || '',
    familiarAmigo: row.comum_nome_familiar_amigo || '',
    foneFamiliar: row.comum_fone_familiar_amigo || '',
    valorInscricaoSmp: Number(row.comum_valor_inscricao || 0),
    valorPagoSmp: Number(row.comum_valor_pago || 0),
    saldoPagarSmp: Number(row.comum_saldo_pagar || 0),
    recebedorValorPagoSmp: Number(row.comum_recebedor_valor_pago || 0),
    recebedorTaxaPagaSmp: Boolean(row.comum_recebedor_taxa_paga),
    recebedorFormaPagamentoSmp: row.comum_recebedor_forma_pagamento || '',
    recebedorObservacaoSmp: row.comum_recebedor_observacao || '',
    criadoEm: row.criado_em,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listCursistasSmp(retiroId) {
  requireSupabaseForCursistaSmp();
  const filter = retiroId ? `retiro_id=eq.${enc(retiroId)}` : '';
  const rows = filter ? await rowsWhere('cursista_smp', filter, 'updated_at.desc') : await allRows('cursista_smp');
  return rows.map(mapCursistaSmp);
}

async function saveCursistaSmp(record) {
  requireSupabaseForCursistaSmp();
  const id = String(record.id || record.numeroFichaSmp || '').trim();
  const mappedKeys = new Set(['retiroId', 'id', 'numeroFichaSmp', 'nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'crismaDele', 'religiaoDele', 'missaDele', 'movimentoIgrejaDele', 'qualMovimentoDele', 'casamentoDele', 'filhosDele', 'saudeDele', 'qualSaudeDele', 'intoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDele', 'manequimDele', 'nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'crismaDela', 'religiaoDela', 'missaDela', 'movimentoIgrejaDela', 'qualMovimentoDela', 'casamentoDela', 'filhosDela', 'saudeDela', 'qualSaudeDela', 'intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela', 'manequimDela', 'cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp', 'uniaoCasal', 'filhosUniao', 'outrasUnioes', 'smpKidsNotNeeded', 'smpKidNome1', 'smpKidNascimento1', 'smpKidNome2', 'smpKidNascimento2', 'smpKidNome3', 'smpKidNascimento3', 'smpKidNome4', 'smpKidNascimento4', 'smpKidNome5', 'smpKidNascimento5', 'precisaAcolhimento', 'nomeApresentante', 'foneApresentante', 'cursoApresentante', 'cidadeApresentante', 'paroquiaApresentante', 'familiarAmigo', 'foneFamiliar', 'valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp', 'recebedorValorPagoSmp', 'recebedorTaxaPagaSmp', 'recebedorFormaPagamentoSmp', 'recebedorObservacaoSmp', 'criadoEm', 'createdAt', 'updatedAt']);
  cursistaSmpKidCareRecordKeys.forEach((key) => mappedKeys.add(key));
  const row = await upsert('cursista_smp', compact({
    retiro_id: record.retiroId,
    id,
    ele_nome: record.nomeDele || '',
    ele_nascimento: dateOrNull(record.nascimentoDele),
    ele_cpf: textOrNull(record.cpfDele),
    ele_profissao: record.profissaoDele || '',
    ele_fone: record.foneDele || '',
    ele_crisma: boolOrNull(record.crismaDele),
    ele_religiao: record.religiaoDele || '',
    ele_participa_missas: record.missaDele || '',
    ele_movimento_igreja: boolOrNull(record.movimentoIgrejaDele),
    ele_qual_movimento: record.qualMovimentoDele || '',
    ele_data_primeiro_casamento: dateOrNull(record.casamentoDele),
    ele_filhos_primeiro_casamento: record.filhosDele || '',
    ele_problema_saude: boolOrNull(record.saudeDele),
    ele_qual_problema_saude: record.qualSaudeDele || '',
    ele_intolerancia_alimentar: boolOrNull(record.intoleranciaAlimentarDele),
    ele_qual_intolerancia_alimentar: record.qualIntoleranciaAlimentarDele || '',
    ele_manequim: record.manequimDele || '',
    ela_nome: record.nomeDela || '',
    ela_nascimento: dateOrNull(record.nascimentoDela),
    ela_cpf: textOrNull(record.cpfDela),
    ela_profissao: record.profissaoDela || '',
    ela_fone: record.foneDela || '',
    ela_crisma: boolOrNull(record.crismaDela),
    ela_religiao: record.religiaoDela || '',
    ela_participa_missas: record.missaDela || '',
    ela_movimento_igreja: boolOrNull(record.movimentoIgrejaDela),
    ela_qual_movimento: record.qualMovimentoDela || '',
    ela_data_primeiro_casamento: dateOrNull(record.casamentoDela),
    ela_filhos_primeiro_casamento: record.filhosDela || '',
    ela_problema_saude: boolOrNull(record.saudeDela),
    ela_qual_problema_saude: record.qualSaudeDela || '',
    ela_intolerancia_alimentar: boolOrNull(record.intoleranciaAlimentarDela),
    ela_qual_intolerancia_alimentar: record.qualIntoleranciaAlimentarDela || '',
    ela_manequim: record.manequimDela || '',
    comum_cep: record.cep || '',
    comum_endereco: record.endereco || '',
    comum_numero: record.numero || '',
    comum_nr_apto: record.nrApto || '',
    comum_bairro: record.bairro || '',
    comum_cidade: record.cidade || '',
    comum_estado: record.estadoSmp || '',
    comum_data_uniao_casal: dateOrNull(record.uniaoCasal),
    comum_filhos_uniao: record.filhosUniao || '',
    comum_outras_unioes: boolOrNull(record.outrasUnioes),
    comum_espaco_kids_nao_necessito: Boolean(record.smpKidsNotNeeded),
    comum_kid_1_nome: record.smpKidNome1 || '',
    comum_kid_1_nascimento: dateOrNull(record.smpKidNascimento1),
    comum_kid_2_nome: record.smpKidNome2 || '',
    comum_kid_2_nascimento: dateOrNull(record.smpKidNascimento2),
    comum_kid_3_nome: record.smpKidNome3 || '',
    comum_kid_3_nascimento: dateOrNull(record.smpKidNascimento3),
    comum_kid_4_nome: record.smpKidNome4 || '',
    comum_kid_4_nascimento: dateOrNull(record.smpKidNascimento4),
    comum_kid_5_nome: record.smpKidNome5 || '',
    comum_kid_5_nascimento: dateOrNull(record.smpKidNascimento5),
    ...mapCursistaSmpKidCareRow(record),
    comum_precisa_acolhimento: boolOrNull(record.precisaAcolhimento),
    comum_nome_apresentante: record.nomeApresentante || '',
    comum_fone_apresentante: record.foneApresentante || '',
    comum_curso_apresentante: record.cursoApresentante || '',
    comum_cidade_apresentante: record.cidadeApresentante || '',
    comum_paroquia_apresentante: record.paroquiaApresentante || '',
    comum_nome_familiar_amigo: record.familiarAmigo || '',
    comum_fone_familiar_amigo: record.foneFamiliar || '',
    comum_valor_inscricao: numberOrZero(record.valorInscricaoSmp),
    comum_valor_pago: numberOrZero(record.valorPagoSmp),
    comum_saldo_pagar: numberOrZero(record.saldoPagarSmp),
    comum_recebedor_valor_pago: numberOrZero(record.recebedorValorPagoSmp),
    comum_recebedor_taxa_paga: Boolean(record.recebedorTaxaPagaSmp),
    comum_recebedor_forma_pagamento: record.recebedorFormaPagamentoSmp || '',
    comum_recebedor_observacao: record.recebedorObservacaoSmp || '',
    criado_em: record.criadoEm || undefined,
    created_at: record.createdAt || undefined,
    updated_at: record.updatedAt || undefined,
    extras: extras(record, mappedKeys),
  }), 'retiro_id,id');
  return mapCursistaSmp(row);
}

async function deleteCursistaSmp(retiroId, numeroFicha) {
  requireSupabaseForCursistaSmp();
  const ficha = String(numeroFicha || '').trim();
  if (!retiroId || !ficha) throw new Error('Informe o retiro e o Numero da ficha SMP para excluir.');
  const deleted = await supabaseRequest(`cursista_smp?retiro_id=eq.${enc(retiroId)}&id=eq.${enc(ficha)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!Array.isArray(deleted) || !deleted.length) throw new Error(`Ficha SMP ${ficha} nao foi encontrada para exclusao.`);
  return deleted.map(mapCursistaSmp);
}

const cursistaEpcKidRecordKeys = Array.from({ length: 5 }, (_, index) => {
  const kidNumber = index + 1;
  return [
    `smpKidNome${kidNumber}`,
    `smpKidNascimento${kidNumber}`,
    `smpKidProblemaSaude${kidNumber}Epc`,
    `smpKidDescricaoSaude${kidNumber}Epc`,
    `smpKidIntolerancia${kidNumber}Epc`,
    `smpKidDescricaoIntolerancia${kidNumber}Epc`,
  ];
}).flat();

function mapCursistaEpc(row) {
  const record = {
    ...mapCursistaSmp(row),
    emailEpc: row.comum_email || '',
    uniaoCasal: row.comum_data_casamento_religioso || '',
    localCasamentoEpc: row.comum_local_casamento || '',
    precisaAcolhimento: choiceFromBool(row.comum_precisa_acolhimento),
    temFilhosEpc: choiceFromBool(row.comum_tem_filhos),
    idadeFilhosEpc: row.comum_idade_filhos || '',
    smpKidsNotNeeded: Boolean(row.comum_espaco_kids_nao_necessita),
    nomeApresentante: row.comum_nome_apresentante || '',
    foneApresentante: row.comum_fone_apresentante || '',
    contatoEmergenciaEpc: row.comum_contato_emergencia || '',
    foneEmergenciaEpc: row.comum_fone_emergencia || '',
  };
  [
    'religiaoDele', 'missaDele', 'casamentoDele', 'filhosDele',
    'religiaoDela', 'missaDela', 'casamentoDela', 'filhosDela',
    'filhosUniao', 'outrasUnioes', 'cursoApresentante', 'cidadeApresentante',
    'paroquiaApresentante', 'familiarAmigo', 'foneFamiliar',
  ].forEach((key) => { delete record[key]; });
  for (let kidNumber = 1; kidNumber <= 5; kidNumber += 1) {
    delete record[`smpKidProblemaSaude${kidNumber}`];
    delete record[`smpKidDescricaoSaude${kidNumber}`];
    delete record[`smpKidIntolerancia${kidNumber}`];
    delete record[`smpKidDescricaoIntolerancia${kidNumber}`];
    record[`smpKidProblemaSaude${kidNumber}Epc`] = choiceFromBool(row[`comum_kid_${kidNumber}_problema_saude`]);
    record[`smpKidDescricaoSaude${kidNumber}Epc`] = row[`comum_kid_${kidNumber}_descricao_saude`] || '';
    record[`smpKidIntolerancia${kidNumber}Epc`] = choiceFromBool(row[`comum_kid_${kidNumber}_intolerancia_alimentar`]);
    record[`smpKidDescricaoIntolerancia${kidNumber}Epc`] = row[`comum_kid_${kidNumber}_descricao_intolerancia`] || '';
  }
  return record;
}

async function listCursistasEpc(retiroId) {
  requireSupabaseForCursistaEpc();
  const filter = retiroId ? `retiro_id=eq.${enc(retiroId)}` : '';
  const rows = filter ? await rowsWhere('cursista_epc', filter, 'updated_at.desc') : await allRows('cursista_epc');
  return rows.map(mapCursistaEpc);
}

async function saveCursistaEpc(record) {
  requireSupabaseForCursistaEpc();
  const id = String(record.id || record.numeroFichaSmp || '').trim();
  const mappedKeys = new Set([
    'retiroId', 'id', 'numeroFichaSmp', 'nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'crismaDele',
    'movimentoIgrejaDele', 'qualMovimentoDele', 'saudeDele', 'qualSaudeDele', 'intoleranciaAlimentarDele',
    'qualIntoleranciaAlimentarDele', 'manequimDele', 'nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela',
    'crismaDela', 'movimentoIgrejaDela', 'qualMovimentoDela', 'saudeDela', 'qualSaudeDela', 'intoleranciaAlimentarDela',
    'qualIntoleranciaAlimentarDela', 'manequimDela', 'cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp',
    'emailEpc', 'uniaoCasal', 'localCasamentoEpc', 'precisaAcolhimento', 'temFilhosEpc', 'idadeFilhosEpc', 'smpKidsNotNeeded',
    'nomeApresentante', 'foneApresentante', 'contatoEmergenciaEpc', 'foneEmergenciaEpc', 'valorInscricaoSmp', 'valorPagoSmp',
    'saldoPagarSmp', 'recebedorValorPagoSmp', 'recebedorTaxaPagaSmp', 'recebedorFormaPagamentoSmp',
    'recebedorObservacaoSmp', 'criadoEm', 'createdAt', 'updatedAt',
  ]);
  cursistaEpcKidRecordKeys.forEach((key) => mappedKeys.add(key));
  const rowData = {
    retiro_id: record.retiroId,
    id,
    ele_nome: record.nomeDele || '',
    ele_nascimento: dateOrNull(record.nascimentoDele),
    ele_cpf: textOrNull(record.cpfDele),
    ele_profissao: record.profissaoDele || '',
    ele_fone: record.foneDele || '',
    ele_crisma: boolOrNull(record.crismaDele),
    ele_movimento_igreja: boolOrNull(record.movimentoIgrejaDele),
    ele_qual_movimento: record.qualMovimentoDele || '',
    ele_problema_saude: boolOrNull(record.saudeDele),
    ele_qual_problema_saude: record.qualSaudeDele || '',
    ele_intolerancia_alimentar: boolOrNull(record.intoleranciaAlimentarDele),
    ele_qual_intolerancia_alimentar: record.qualIntoleranciaAlimentarDele || '',
    ele_manequim: record.manequimDele || '',
    ela_nome: record.nomeDela || '',
    ela_nascimento: dateOrNull(record.nascimentoDela),
    ela_cpf: textOrNull(record.cpfDela),
    ela_profissao: record.profissaoDela || '',
    ela_fone: record.foneDela || '',
    ela_crisma: boolOrNull(record.crismaDela),
    ela_movimento_igreja: boolOrNull(record.movimentoIgrejaDela),
    ela_qual_movimento: record.qualMovimentoDela || '',
    ela_problema_saude: boolOrNull(record.saudeDela),
    ela_qual_problema_saude: record.qualSaudeDela || '',
    ela_intolerancia_alimentar: boolOrNull(record.intoleranciaAlimentarDela),
    ela_qual_intolerancia_alimentar: record.qualIntoleranciaAlimentarDela || '',
    ela_manequim: record.manequimDela || '',
    comum_cep: record.cep || '',
    comum_endereco: record.endereco || '',
    comum_numero: record.numero || '',
    comum_nr_apto: record.nrApto || '',
    comum_bairro: record.bairro || '',
    comum_cidade: record.cidade || '',
    comum_estado: record.estadoSmp || '',
    comum_email: record.emailEpc || '',
    comum_data_casamento_religioso: dateOrNull(record.uniaoCasal),
    comum_local_casamento: record.localCasamentoEpc || '',
    comum_precisa_acolhimento: boolOrNull(record.precisaAcolhimento),
    comum_tem_filhos: boolOrNull(record.temFilhosEpc),
    comum_idade_filhos: record.idadeFilhosEpc || '',
    comum_espaco_kids_nao_necessita: Boolean(record.smpKidsNotNeeded),
    comum_nome_apresentante: record.nomeApresentante || '',
    comum_fone_apresentante: record.foneApresentante || '',
    comum_contato_emergencia: record.contatoEmergenciaEpc || '',
    comum_fone_emergencia: record.foneEmergenciaEpc || '',
    comum_valor_inscricao: numberOrZero(record.valorInscricaoSmp),
    comum_valor_pago: numberOrZero(record.valorPagoSmp),
    comum_saldo_pagar: numberOrZero(record.saldoPagarSmp),
    comum_recebedor_valor_pago: numberOrZero(record.recebedorValorPagoSmp),
    comum_recebedor_taxa_paga: Boolean(record.recebedorTaxaPagaSmp),
    comum_recebedor_forma_pagamento: record.recebedorFormaPagamentoSmp || '',
    comum_recebedor_observacao: record.recebedorObservacaoSmp || '',
    criado_em: record.criadoEm || undefined,
    created_at: record.createdAt || undefined,
    updated_at: record.updatedAt || undefined,
    extras: extras(record, mappedKeys),
  };
  for (let kidNumber = 1; kidNumber <= 5; kidNumber += 1) {
    rowData[`comum_kid_${kidNumber}_nome`] = record[`smpKidNome${kidNumber}`] || '';
    rowData[`comum_kid_${kidNumber}_nascimento`] = dateOrNull(record[`smpKidNascimento${kidNumber}`]);
    rowData[`comum_kid_${kidNumber}_problema_saude`] = boolOrNull(record[`smpKidProblemaSaude${kidNumber}Epc`]);
    rowData[`comum_kid_${kidNumber}_descricao_saude`] = textOrNull(record[`smpKidDescricaoSaude${kidNumber}Epc`]);
    rowData[`comum_kid_${kidNumber}_intolerancia_alimentar`] = boolOrNull(record[`smpKidIntolerancia${kidNumber}Epc`]);
    rowData[`comum_kid_${kidNumber}_descricao_intolerancia`] = textOrNull(record[`smpKidDescricaoIntolerancia${kidNumber}Epc`]);
  }
  const row = await upsert('cursista_epc', compact(rowData), 'retiro_id,id');
  return mapCursistaEpc(row);
}

async function deleteCursistaEpc(retiroId, numeroFicha) {
  requireSupabaseForCursistaEpc();
  const ficha = String(numeroFicha || '').trim();
  if (!retiroId || !ficha) throw new Error('Informe o retiro e o Numero da ficha EPC para excluir.');
  const deleted = await supabaseRequest(`cursista_epc?retiro_id=eq.${enc(retiroId)}&id=eq.${enc(ficha)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!Array.isArray(deleted) || !deleted.length) throw new Error(`Ficha EPC ${ficha} nao foi encontrada para exclusao.`);
  return deleted.map(mapCursistaEpc);
}

function mapCommunity(row, lookups = {}) {
  return {
    ...(row.extras || {}),
    id: row.id,
    retiroId: row.retiro_id,
    nome: row.nome,
    liderCasalId: row.lider_casal_id || row.extras?.liderCasalId || '',
    monitorCasalId: row.monitor_casal_id || row.extras?.monitorCasalId || '',
    monitorIds: array(lookups.monitorsByCommunity?.get(row.id)).map(rowId),
    membroIds: array(lookups.studentsByCommunity?.get(row.id)).map((item) => item.id),
    membroSmpIds: array(lookups.smpStudentsByCommunity?.get(row.id)).map((item) => item.cursista_id),
    membroEpcIds: array(lookups.epcStudentsByCommunity?.get(row.id)).map((item) => item.cursista_id),
    ordem: row.ordem,
    criadoEm: row.criado_em,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function communityLookups(rows) {
  const ids = new Set(rows.map((row) => row.id));
  const [linksMonitors, people, linksStudents, students, linksSmpStudents, linksEpcStudents] = await Promise.all([
    allRows('comunidade_monitores', ''),
    allRows('pessoas'),
    allRows('comunidade_cursistas', ''),
    allRows('cursistas'),
    optionalAllRows('comunidade_cursistas_smp', ''),
    optionalAllRows('comunidade_cursistas_epc', ''),
  ]);
  const personById = new Map(people.map((item) => [item.id, item]));
  const studentById = new Map(students.map((item) => [item.id, item]));
  const monitorsByCommunity = new Map();
  linksMonitors.filter((item) => ids.has(item.comunidade_id)).forEach((item) => {
    const list = monitorsByCommunity.get(item.comunidade_id) || [];
    if (personById.has(item.pessoa_id)) list.push(personById.get(item.pessoa_id));
    monitorsByCommunity.set(item.comunidade_id, list);
  });
  const studentsByCommunity = new Map();
  linksStudents.filter((item) => ids.has(item.comunidade_id)).forEach((item) => {
    const list = studentsByCommunity.get(item.comunidade_id) || [];
    if (studentById.has(item.cursista_id)) list.push(studentById.get(item.cursista_id));
    studentsByCommunity.set(item.comunidade_id, list);
  });
  const smpStudentsByCommunity = new Map();
  linksSmpStudents.filter((item) => ids.has(item.comunidade_id)).forEach((item) => {
    const list = smpStudentsByCommunity.get(item.comunidade_id) || [];
    list.push(item);
    smpStudentsByCommunity.set(item.comunidade_id, list);
  });
  const epcStudentsByCommunity = new Map();
  linksEpcStudents.filter((item) => ids.has(item.comunidade_id)).forEach((item) => {
    const list = epcStudentsByCommunity.get(item.comunidade_id) || [];
    list.push(item);
    epcStudentsByCommunity.set(item.comunidade_id, list);
  });
  return { monitorsByCommunity, studentsByCommunity, smpStudentsByCommunity, epcStudentsByCommunity };
}

async function syncIndividualCommunityMembers(communityId, retreatId, memberIds = []) {
  const desiredRows = (await Promise.all([...new Set(array(memberIds))].map((id) => findStudentRowForRetreat(id, retreatId)))).filter(Boolean);
  if (desiredRows.length !== new Set(array(memberIds)).size) throw new Error('Um ou mais cursistas individuais nao foram encontrados neste retiro. Nenhum vinculo foi alterado.');
  const desiredIds = new Set(desiredRows.map((student) => student.id));
  const currentRows = await rowsWhere('comunidade_cursistas', `comunidade_id=eq.${enc(communityId)}`);
  const currentIds = new Set(currentRows.map((item) => item.cursista_id));
  const additions = [...desiredIds].filter((id) => !currentIds.has(id)).map((id) => ({ comunidade_id: communityId, cursista_id: id }));
  if (additions.length) await upsert('comunidade_cursistas', additions, 'comunidade_id,cursista_id');
  for (const id of currentIds) {
    if (!desiredIds.has(id)) await deleteWhere('comunidade_cursistas', `comunidade_id=eq.${enc(communityId)}&cursista_id=eq.${enc(id)}`);
  }
}

async function syncSmpCommunityMembers(communityId, retreatId, memberIds = []) {
  const desiredIds = new Set(array(memberIds).map((id) => String(id || '').trim()).filter(Boolean));
  const availableIds = new Set((await rowsWhere('cursista_smp', `retiro_id=eq.${enc(retreatId)}`, '')).map((item) => String(item.id)));
  const missingIds = [...desiredIds].filter((id) => !availableIds.has(id));
  if (missingIds.length) throw new Error('Uma ou mais fichas SMP nao foram encontradas neste retiro. Nenhum vinculo foi alterado.');
  let currentRows;
  try {
    currentRows = await rowsWhere('comunidade_cursistas_smp', `comunidade_id=eq.${enc(communityId)}`, '');
  } catch (error) {
    if (isMissingRelationError(error, 'comunidade_cursistas_smp')) throw new Error('A migracao comunidade_cursistas_smp ainda nao foi aplicada ao banco.');
    throw error;
  }
  const currentIds = new Set(currentRows.map((item) => String(item.cursista_id)));
  const additions = [...desiredIds].filter((id) => !currentIds.has(id)).map((id) => ({ comunidade_id: communityId, retiro_id: retreatId, cursista_id: id }));
  if (additions.length) await upsert('comunidade_cursistas_smp', additions, 'comunidade_id,retiro_id,cursista_id');
  for (const id of currentIds) {
    if (!desiredIds.has(id)) await deleteWhere('comunidade_cursistas_smp', `comunidade_id=eq.${enc(communityId)}&retiro_id=eq.${enc(retreatId)}&cursista_id=eq.${enc(id)}`);
  }
}

async function syncEpcCommunityMembers(communityId, retreatId, memberIds = []) {
  const desiredIds = new Set(array(memberIds).map((id) => String(id || '').trim()).filter(Boolean));
  const availableIds = new Set((await rowsWhere('cursista_epc', `retiro_id=eq.${enc(retreatId)}`, '')).map((item) => String(item.id)));
  const missingIds = [...desiredIds].filter((id) => !availableIds.has(id));
  if (missingIds.length) throw new Error('Uma ou mais fichas EPC nao foram encontradas neste retiro. Nenhum vinculo foi alterado.');
  let currentRows;
  try {
    currentRows = await rowsWhere('comunidade_cursistas_epc', `comunidade_id=eq.${enc(communityId)}`, '');
  } catch (error) {
    if (isMissingRelationError(error, 'comunidade_cursistas_epc')) throw new Error('A migracao comunidade_cursistas_epc ainda nao foi aplicada ao banco.');
    throw error;
  }
  const currentIds = new Set(currentRows.map((item) => String(item.cursista_id)));
  const additions = [...desiredIds].filter((id) => !currentIds.has(id)).map((id) => ({ comunidade_id: communityId, retiro_id: retreatId, cursista_id: id }));
  if (additions.length) await upsert('comunidade_cursistas_epc', additions, 'comunidade_id,retiro_id,cursista_id');
  for (const id of currentIds) {
    if (!desiredIds.has(id)) await deleteWhere('comunidade_cursistas_epc', `comunidade_id=eq.${enc(communityId)}&retiro_id=eq.${enc(retreatId)}&cursista_id=eq.${enc(id)}`);
  }
}

async function saveCommunity(record) {
  const membershipType = record.__membershipType || '';
  const mappedKeys = new Set(['id', 'retiroId', 'nome', 'liderCasalId', 'monitorCasalId', 'monitorIds', 'membroIds', 'membroSmpIds', 'membroEpcIds', '__membershipType', 'ordem', 'criadoEm', 'createdAt', 'updatedAt']);
  await upsert('comunidades', compact({
    id: record.id,
    retiro_id: record.retiroId,
    nome: record.nome || 'Comunidade',
    ordem: Number(record.ordem || 0),
    lider_casal_id: isUuid(record.liderCasalId) ? record.liderCasalId : null,
    monitor_casal_id: isUuid(record.monitorCasalId) ? record.monitorCasalId : null,
    criado_em: record.criadoEm || undefined,
    created_at: record.createdAt || undefined,
    updated_at: record.updatedAt || undefined,
    extras: extras(record, mappedKeys),
  }));
  await Promise.all([
    deleteWhere('comunidade_monitores', `comunidade_id=eq.${enc(record.id)}`),
  ]);
  const monitorRows = (await Promise.all(array(record.monitorIds).map(findPersonRow))).filter(Boolean);
  await Promise.all([
    monitorRows.length ? upsert('comunidade_monitores', monitorRows.map((person) => ({ comunidade_id: record.id, pessoa_id: person.id })), 'comunidade_id,pessoa_id') : null,
  ]);
  if (membershipType === 'individual') await syncIndividualCommunityMembers(record.id, record.retiroId, record.membroIds);
  if (membershipType === 'smp') await syncSmpCommunityMembers(record.id, record.retiroId, record.membroSmpIds);
  if (membershipType === 'epc') await syncEpcCommunityMembers(record.id, record.retiroId, record.membroEpcIds);
  return getRecord('comunidades', record.id);
}

async function listCommunities() {
  const rows = await allRows('comunidades', 'ordem.asc');
  const lookups = await communityLookups(rows);
  return rows.map((row) => mapCommunity(row, lookups));
}

async function getCommunity(id) {
  const row = await oneWhere('comunidades', `id=eq.${enc(id)}`);
  if (!row) return null;
  const lookups = await communityLookups([row]);
  return mapCommunity(row, lookups);
}

const simpleMappers = {
  casais: (row) => ({ ...(row.extras || {}), id: row.id, retiroId: row.retiro_id, nome: row.nome || '', createdAt: row.created_at, updatedAt: row.updated_at }),
  crachas: (row) => ({ ...(row.configuracao || {}), id: row.id, retiroId: row.retiro_id || row.configuracao?.retiroId || '', nome: row.nome, name: row.configuracao?.name || row.nome, tipo: row.tipo || row.configuracao?.tipo || '', createdAt: row.created_at, updatedAt: row.updated_at }),
  configuracoes: (row) => ({ ...(row.valor || {}), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at }),
  perfis: (row) => ({ id: row.id, nome: row.nome, codigo: row.codigo, descricao: row.descricao || '', locked: row.locked }),
  permissoes: (row) => ({ id: row.id, modulo: row.modulo, descricao: row.descricao }),
  usuarios: (row) => ({ id: row.id, nome: row.nome, login: row.login, perfilId: row.perfil_id, ativo: row.ativo, passwordHash: row.password_hash, passwordSalt: row.password_salt, passwordIterations: row.password_iterations, createdAt: row.created_at, updatedAt: row.updated_at }),
  perfil_permissoes: (row) => ({ id: `${row.perfil_id}:${row.permissao_id}`, perfilId: row.perfil_id, permissaoId: row.permissao_id, permitido: row.permitido }),
  usuario_permissoes: (row) => ({ id: `${row.usuario_id}:${row.permissao_id}`, usuarioId: row.usuario_id, permissaoId: row.permissao_id, permitido: row.permitido }),
  usuario_retiros: (row) => ({ id: `${row.usuario_id}:${row.retiro_id}`, usuarioId: row.usuario_id, retiroId: row.retiro_id, papel: row.papel || '' }),
  relatorio_modelos: (row) => ({ id: row.id, usuarioId: row.usuario_id, nome: row.nome, descricao: row.descricao || '', configuracao: row.configuracao || {}, compartilhado: Boolean(row.compartilhado), createdAt: row.created_at, updatedAt: row.updated_at }),
};

async function saveSimple(storeName, record) {
  if (storeName === 'casais') {
    const row = await upsert('casais', { id: record.id, retiro_id: record.retiroId || null, nome: record.nome || '', extras: extras(record, new Set(['id', 'retiroId', 'nome', 'createdAt', 'updatedAt'])) });
    return simpleMappers.casais(row);
  }
  if (storeName === 'crachas') {
    const row = await upsert('crachas', { id: record.id, retiro_id: record.retiroId || null, nome: record.name || record.nome || 'Cracha', tipo: record.tipo || record.type || '', configuracao: record });
    return simpleMappers.crachas(row);
  }
  if (storeName === 'configuracoes') {
    const row = await upsert('configuracoes', { id: record.id, valor: record });
    return simpleMappers.configuracoes(row);
  }
  if (storeName === 'perfis') {
    const row = await upsert('perfis', { id: record.id, nome: record.nome || '', codigo: record.codigo || record.id, descricao: record.descricao || '', locked: Boolean(record.locked) });
    return simpleMappers.perfis(row);
  }
  if (storeName === 'permissoes') {
    const row = await upsert('permissoes', { id: record.id, modulo: record.modulo || '', descricao: record.descricao || '' });
    return simpleMappers.permissoes(row);
  }
  if (storeName === 'usuarios') {
    const row = await upsert('usuarios', { id: record.id, nome: record.nome || '', login: record.login || '', perfil_id: record.perfilId || null, ativo: record.ativo !== false, password_hash: record.passwordHash || null, password_salt: record.passwordSalt || null, password_iterations: record.passwordIterations || null, created_at: record.createdAt || undefined, updated_at: record.updatedAt || undefined });
    return simpleMappers.usuarios(row);
  }
  if (storeName === 'perfil_permissoes') {
    const row = await upsert('perfil_permissoes', { perfil_id: record.perfilId, permissao_id: record.permissaoId, permitido: record.permitido !== false }, 'perfil_id,permissao_id');
    return simpleMappers.perfil_permissoes(row);
  }
  if (storeName === 'usuario_permissoes') {
    const row = await upsert('usuario_permissoes', { usuario_id: record.usuarioId, permissao_id: record.permissaoId, permitido: record.permitido !== false }, 'usuario_id,permissao_id');
    return simpleMappers.usuario_permissoes(row);
  }
  if (storeName === 'usuario_retiros') {
    const row = await upsert('usuario_retiros', { usuario_id: record.usuarioId, retiro_id: record.retiroId, papel: record.papel || '' }, 'usuario_id,retiro_id');
    return simpleMappers.usuario_retiros(row);
  }
  if (storeName === 'relatorio_modelos') {
    const row = await upsert('relatorio_modelos', { id: record.id, usuario_id: record.usuarioId, nome: record.nome || 'Modelo sem nome', descricao: record.descricao || '', configuracao: record.configuracao || {}, compartilhado: Boolean(record.compartilhado), created_at: record.createdAt || undefined, updated_at: record.updatedAt || undefined });
    return simpleMappers.relatorio_modelos(row);
  }
  throw new Error(`Store sem mapeamento de gravacao: ${storeName}`);
}

async function listRelational(storeName) {
  if (storeName === 'retiros') return listRetreats();
  if (storeName === 'pessoas') return listPeople();
  if (storeName === 'adesoes') return listEnrolments();
  if (storeName === 'cursistas') return (await allRows('cursistas')).map(mapStudent);
  if (storeName === 'comunidades') return listCommunities();
  const table = tableByStore[storeName];
  const mapper = simpleMappers[storeName];
  if (!table || !mapper) throw new Error(`Store nao mapeada: ${storeName}`);
  return (await allRows(table, table.includes('permissoes') || table.includes('retiros') ? '' : 'updated_at.desc')).map(mapper);
}

async function getRelational(storeName, id) {
  if (storeName === 'retiros') return getRetreat(id);
  if (storeName === 'pessoas') return getPerson(id);
  if (storeName === 'adesoes') return getEnrolment(id);
  if (storeName === 'comunidades') return getCommunity(id);
  if (storeName === 'cursistas') {
    const row = await findStudentRow(id);
    return row ? mapStudent(row) : null;
  }
  return (await listRelational(storeName)).find((item) => item.id === id) || null;
}

async function saveRelational(storeName, record) {
  if (storeName === 'retiros') return saveRetreat(record);
  if (storeName === 'pessoas') return savePerson(record);
  if (storeName === 'adesoes') return saveEnrolment(record);
  if (storeName === 'cursistas') return saveStudent(record);
  if (storeName === 'comunidades') return saveCommunity(record);
  return saveSimple(storeName, record);
}

async function deleteRelational(storeName, id) {
  if (storeName === 'pessoas') return deletePerson(id);
  if (storeName === 'cursistas') {
    const row = await findStudentRow(id);
    if (row) return deleteWhere('cursistas', `id=eq.${enc(row.id)}`);
    return undefined;
  }
  if (storeName === 'perfil_permissoes') {
    const [perfilId, ...rest] = String(id).split(':');
    return deleteWhere('perfil_permissoes', `perfil_id=eq.${enc(perfilId)}&permissao_id=eq.${enc(rest.join(':'))}`);
  }
  if (storeName === 'usuario_permissoes') {
    const [usuarioId, ...rest] = String(id).split(':');
    return deleteWhere('usuario_permissoes', `usuario_id=eq.${enc(usuarioId)}&permissao_id=eq.${enc(rest.join(':'))}`);
  }
  if (storeName === 'usuario_retiros') {
    const [usuarioId, retiroId] = String(id).split(':');
    return deleteWhere('usuario_retiros', `usuario_id=eq.${enc(usuarioId)}&retiro_id=eq.${enc(retiroId)}`);
  }
  if (storeName === 'relatorio_modelos') return deleteWhere('relatorio_modelos', `id=eq.${enc(id)}`);
  const table = tableByStore[storeName];
  if (!table) throw new Error(`Store nao mapeada: ${storeName}`);
  return deleteWhere(table, `id=eq.${enc(id)}`);
}

async function readDatabase() {
  return withLocalFallback(async (useSupabase) => {
    if (!useSupabase) return readFileDatabase();
    const entries = await Promise.all(stores.map(async (storeName) => [storeName, await listRelational(storeName)]));
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
  for (const storeName of stores) {
    for (const record of array(incoming[storeName])) {
      if (!record?.id) continue;
      if (storeName === 'comunidades') {
        await saveRelational(storeName, { ...record, __membershipType: 'individual' });
        if (Object.prototype.hasOwnProperty.call(record, 'membroSmpIds')) await saveRelational(storeName, { ...record, __membershipType: 'smp' });
        if (Object.prototype.hasOwnProperty.call(record, 'membroEpcIds')) await saveRelational(storeName, { ...record, __membershipType: 'epc' });
      } else {
        await saveRelational(storeName, record);
      }
    }
  }
}

async function replaceDatabase(incoming) {
  if (hasSupabase()) throw new Error('A substituicao do Supabase deve usar a restauracao transacional de backup.');
  const replacement = Object.fromEntries(stores.map((store) => [store, Array.isArray(incoming?.[store]) ? incoming[store] : []]));
  await writeFileDatabase(replacement);
}

async function listRecords(storeName) {
  return withLocalFallback(async (useSupabase) => (useSupabase ? listRelational(storeName) : (await readFileDatabase())[storeName]));
}

async function getRecord(storeName, id) {
  return withLocalFallback(async (useSupabase) => (useSupabase ? getRelational(storeName, id) : (await readFileDatabase())[storeName].find((item) => item.id === id) || null));
}

async function saveRecord(storeName, record) {
  return withLocalFallback(async (useSupabase) => {
    if (useSupabase) return saveRelational(storeName, record);
    if (storeName === 'comunidades' && Object.prototype.hasOwnProperty.call(record, '__membershipType')) {
      record = { ...record };
      delete record.__membershipType;
    }
    const database = await readFileDatabase();
    const collection = database[storeName];
    if (storeName === 'adesoes' && record?.retiroId && record?.pessoaId) {
      const conflict = collection.find((item) => item.id !== record.id && item.retiroId === record.retiroId && item.pessoaId === record.pessoaId);
      if (conflict) {
        const error = new Error(duplicateEnrolmentCpfMessage);
        error.code = 'DUPLICATE_RETREAT_ENROLMENT_CPF';
        error.conflictId = conflict.id;
        throw error;
      }
    }
    if (storeName === 'cursistas' && record?.retiroId) {
      const normalizedCpf = String(record.cpf || '').replace(/\D/g, '');
      const fileNumber = Number(record.numeroFichaIndividual);
      const duplicateCpf = normalizedCpf && collection.find((item) => item.id !== record.id
        && item.retiroId === record.retiroId
        && String(item.cpf || '').replace(/\D/g, '') === normalizedCpf);
      if (duplicateCpf) {
        const error = new Error(duplicateStudentCpfMessage);
        error.code = 'DUPLICATE_RETREAT_STUDENT_CPF';
        throw error;
      }
      const duplicateFileNumber = Number.isInteger(fileNumber) && fileNumber > 0 && collection.find((item) => item.id !== record.id
        && item.retiroId === record.retiroId
        && Number(item.numeroFichaIndividual) === fileNumber);
      if (duplicateFileNumber) {
        const error = new Error(duplicateStudentFileNumberMessage);
        error.code = 'DUPLICATE_RETREAT_STUDENT_FILE_NUMBER';
        throw error;
      }
    }
    const index = collection.findIndex((item) => item.id === record.id);
    if (index >= 0) collection[index] = record;
    else collection.push(record);
    await writeFileDatabase(database);
    return record;
  });
}

async function deleteRecord(storeName, id) {
  return withLocalFallback(async (useSupabase) => {
    if (useSupabase) return deleteRelational(storeName, id);
    const database = await readFileDatabase();
    database[storeName] = database[storeName].filter((item) => item.id !== id);
    await writeFileDatabase(database);
  });
}

async function checkDatabaseConnection() {
  if (!hasSupabase()) return { database: 'file', ok: true };
  await supabaseRequest('retiros?select=id&limit=1');
  return { database: 'supabase-relational', ok: true };
}

module.exports = {
  checkDatabaseConnection,
  emptyDatabase,
  hasSupabase,
  importDatabase,
  listCursistasSmp,
  saveCursistaSmp,
  deleteCursistaSmp,
  listCursistasEpc,
  saveCursistaEpc,
  deleteCursistaEpc,
  readDatabase,
  replaceDatabase,
  listRecords,
  getRecord,
  saveRecord,
  deleteRecord,
  ensureFileDatabase,
};
