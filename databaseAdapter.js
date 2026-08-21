const { stores, financeStores } = require('./storeConfig');

const emptyDatabase = () => Object.fromEntries(stores.map((store) => [store, []]));
const hasSupabase = () => Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
const supabaseRequiredError = () => {
  const error = new Error('Supabase nao configurado. A operacao foi cancelada; nenhum dado foi lido ou salvo no banco local.');
  error.code = 'SUPABASE_REQUIRED';
  return error;
};

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
};
financeStores.forEach((storeName) => { tableByStore[storeName] = storeName; });

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
const dateOnlyOrNull = (value) => {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const year = Number(iso?.[1] || br?.[3]);
  const month = Number(iso?.[2] || br?.[2]);
  const day = Number(iso?.[3] || br?.[1]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!iso && !br || year < 1 || month < 1 || month > 12 || day < 1 || day > daysByMonth[month - 1]) {
    throw new Error('Data invalida. Use o formato dd/mm/aaaa.');
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
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
const studentTeamCpfConflictMessage = 'Este CPF ja esta cadastrado na equipe de trabalho deste retiro.';
const normalizeText = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeCpfDigits = (value = '') => String(value || '').replace(/\D/g, '').slice(0, 11);
const isValidCpfNumber = (value = '') => {
  const cpf = normalizeCpfDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length) => {
    const total = cpf.slice(0, length).split('').reduce((sum, number, index) => sum + Number(number) * (length + 1 - index), 0);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
};
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

async function rowsWhere(table, filter, order = '', select = '*') {
  const orderQuery = order ? `&order=${order}` : '';
  return pagedRows(`${table}?${filter}&select=${select}${orderQuery}`);
}

async function optionalRowsWhere(table, filter, order = '') {
  try {
    return await rowsWhere(table, filter, order);
  } catch (error) {
    if (isMissingRelationError(error, table)) return [];
    throw error;
  }
}

async function rowsWhereIn(table, column, values = [], order = '', select = '*') {
  const uniqueValues = [...new Set(array(values).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!uniqueValues.length) return [];
  const chunks = [];
  for (let index = 0; index < uniqueValues.length; index += 100) chunks.push(uniqueValues.slice(index, index + 100));
  const pages = await Promise.all(chunks.map((chunk) => rowsWhere(table, `${column}=in.(${chunk.map(enc).join(',')})`, order, select)));
  return pages.flat();
}

async function optionalRowsWhereIn(table, column, values = [], order = '', select = '*') {
  try {
    return await rowsWhereIn(table, column, values, order, select);
  } catch (error) {
    if (isMissingRelationError(error, table)) return [];
    throw error;
  }
}

async function oneWhere(table, filter, select = '*') {
  const rows = await supabaseRequest(`${table}?${filter}&select=${select}&limit=1`);
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
  const rows = await rowsWhere(table, `${column}=in.(${ids.map(enc).join(',')})`, '', column);
  return new Set(rows.map((row) => row[column]).filter(Boolean));
}

async function saveRetreat(record) {
  const allowedRetreatTypes = new Set(['Taschinha', 'Girassol', 'ONDA', 'EJA', 'EJU', 'EPC', 'SMP', 'EIS-ME AQUI']);
  if (record.tipoRetiro && !allowedRetreatTypes.has(record.tipoRetiro)) throw new Error('Tipo do retiro invalido.');
  const mappedKeys = new Set(['id', 'nome', 'dataInicio', 'dataTermino', 'local', 'coordenacaoGeral', 'coordenacaoRetiro', 'valorInscricaoCursista', 'valorInscricaoVoluntario', 'valorFoto', 'valorCamisetaOficial', 'descontoParentesco', 'idadeMaximaEspacoKids', 'recebedorToken', 'setores', 'setoresPublicos', 'setoresInscricoesEncerradas', 'ordemQuadrante', 'dias', 'contribuicoes', 'linksSetores', 'setorLinks', 'status', 'createdAt', 'updatedAt']);
  const closedSectorKeysForExtras = new Set(array(record.setoresInscricoesEncerradas).map(normalizeText));
  const retreatExtras = {
    ...extras(record, mappedKeys),
    numeroPrevistoFichasCursista: Math.max(0, Math.trunc(Number(record.numeroPrevistoFichasCursista) || 0)),
    setoresInscricoesEncerradas: array(record.setores).filter((sector) => closedSectorKeysForExtras.has(normalizeText(sector))),
  };
  const [existingSectors, existingDays] = await Promise.all([
    rowsWhere('retiro_setores', `retiro_id=eq.${enc(record.id)}`),
    rowsWhere('retiro_dias', `retiro_id=eq.${enc(record.id)}`),
  ]);
  await upsert('retiros', compact({
    id: record.id,
    nome: record.nome || 'Retiro sem nome',
    data_inicio: dateOnlyOrNull(record.dataInicio),
    data_termino: dateOnlyOrNull(record.dataTermino),
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

async function findPersonRows(ids = []) {
  const uniqueIds = [...new Set(array(ids).map((id) => String(id || '').trim()).filter(Boolean))];
  const uuidIds = uniqueIds.filter(isUuid);
  const cpfIds = uniqueIds.filter((id) => !isUuid(id));
  const [byUuid, byCpf] = await Promise.all([
    rowsWhereIn('pessoas', 'id', uuidIds, '', 'id'),
    rowsWhereIn('pessoas', 'cpf', cpfIds, '', 'id,cpf'),
  ]);
  return [...byUuid, ...byCpf];
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
    nascimento: dateOnlyOrNull(record.nascimento),
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

async function listPeople(retiroId = '') {
  if (!retiroId) return (await allRows('pessoas')).map(mapPerson);
  const enrolments = await rowsWhere('adesoes', `retiro_id=eq.${enc(retiroId)}`, '');
  const people = await rowsWhereIn('pessoas', 'id', enrolments.map((entry) => entry.pessoa_id));
  return people.map(mapPerson);
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
  const espacoKids = array(lookups.kidsByAdesao?.get(row.id)).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((item) => ({
    nome: item.nome || '',
    nascimento: item.nascimento || '',
    problemaSaude: choiceFromBool(item.problema_saude),
    descricaoSaude: item.descricao_saude || '',
    intoleranciaAlimentar: choiceFromBool(item.intolerancia_alimentar),
    descricaoIntolerancia: item.descricao_intolerancia || '',
    cuidadosLegados: item.problema_saude == null && item.descricao_saude == null && item.intolerancia_alimentar == null && item.descricao_intolerancia == null,
  }));
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
  const ids = new Set(rows.map((row) => row.id).filter(Boolean));
  if (!ids.size) return { personByDbId: new Map(), diasByAdesao: new Map(), setoresByAdesao: new Map(), retirosByAdesao: new Map(), kidsByAdesao: new Map() };
  const enrolmentIds = [...ids];
  const [people, linksDias, linksSetores, retiros, kids] = await Promise.all([
    rowsWhereIn('pessoas', 'id', rows.map((row) => row.pessoa_id)),
    rowsWhereIn('adesao_dias', 'adesao_id', enrolmentIds),
    rowsWhereIn('adesao_setores', 'adesao_id', enrolmentIds),
    rowsWhereIn('adesao_retiros_anteriores', 'adesao_id', enrolmentIds, 'ordem.asc'),
    rowsWhereIn('adesao_espaco_kids', 'adesao_id', enrolmentIds, 'ordem.asc'),
  ]);
  const [dias, setores] = await Promise.all([
    rowsWhereIn('retiro_dias', 'id', linksDias.map((item) => item.dia_id)),
    rowsWhereIn('retiro_setores', 'id', linksSetores.map((item) => item.setor_id)),
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

async function listEnrolments(retiroId = '') {
  const rows = retiroId
    ? await rowsWhere('adesoes', `retiro_id=eq.${enc(retiroId)}`, 'updated_at.desc')
    : await allRows('adesoes');
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
    if (field === 'retirosAnteriores' && nextRecord.dispensaRetirosAnteriores === true) return;
    if (current && nonEmptyArray(current[field]) && !nonEmptyArray(nextRecord[field])) {
      nextRecord[field] = current[field];
    }
  });
  record = nextRecord;
  const spaceKidsRows = array(record.espacoKids).map((kid, index) => ({
    adesao_id: record.id,
    nome: kid.nome || '',
    nascimento: dateOnlyOrNull(kid.nascimento),
    problema_saude: boolOrNull(kid.problemaSaude),
    descricao_saude: textOrNull(kid.descricaoSaude),
    intolerancia_alimentar: boolOrNull(kid.intoleranciaAlimentar),
    descricao_intolerancia: textOrNull(kid.descricaoIntolerancia),
    ordem: index + 1,
  }));
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
    spaceKidsRows.length ? upsert('adesao_espaco_kids', spaceKidsRows) : null,
    couple ? upsert('casal_membros', { casal_id: couple.id, adesao_id: record.id, papel: record.papelNoCasal || '' }, 'casal_id,adesao_id') : null,
  ]);
  return getEnrolment(record.id);
}

function atomicPersonPayload(record = {}) {
  const mappedKeys = new Set(['id', 'cpf', 'nome', 'nomeNormalizado', 'nascimento', 'genero', 'telefone', 'cep', 'endereco', 'numero', 'bairro', 'cidade', 'estado', 'createdAt', 'updatedAt']);
  const cpf = record.cpf || (!isUuid(record.id) ? record.id : '');
  return compact({
    cpf: textOrNull(cpf),
    nome: record.nome || 'Sem nome',
    nome_normalizado: record.nomeNormalizado || normalizeText(record.nome || ''),
    nascimento: dateOnlyOrNull(record.nascimento),
    genero: record.genero || '',
    telefone: record.telefone || '',
    cep: record.cep || '',
    endereco: record.endereco || '',
    numero: record.numero || '',
    bairro: record.bairro || '',
    cidade: record.cidade || '',
    estado: record.estado || '',
    created_at: record.createdAt || null,
    updated_at: record.updatedAt || null,
    extras: extras(record, mappedKeys),
  });
}

function atomicEnrolmentPayload(record = {}) {
  const mappedKeys = new Set(['id', 'retiroId', 'pessoaId', 'nome', 'dias', 'setores', 'retirosAnteriores', 'quadrante', 'foto', 'contribuicao', 'coordenacao', 'coordenacaoSetor', 'espacoKids', 'espacoKidsNaoNecessito', 'observacao', 'termoVoluntariadoAceito', 'termoVoluntariadoAceitoEm', 'tipoFicha', 'casalId', 'papelNoCasal', 'tipoFinanceiro', 'taxaPaga', 'valorPago', 'formaPagamento', 'recebedorObservacao', 'status', 'validada', 'validadoEm', 'enviadoEm', 'atualizadoEm', 'dadosPessoais', 'createdAt', 'updatedAt']);
  return compact({
    id: record.id,
    retiro_id: record.retiroId,
    nome: record.nome || '',
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
    enviado_em: record.enviadoEm || null,
    atualizado_em: record.atualizadoEm || null,
    created_at: record.createdAt || null,
    updated_at: record.updatedAt || null,
    dados_pessoais: record.dadosPessoais || {},
    extras: extras(record, mappedKeys),
    dias: array(record.dias).filter(Boolean),
    setores: array(record.setores).filter(Boolean),
    retiros_anteriores: array(record.retirosAnteriores).filter(Boolean),
    espaco_kids: array(record.espacoKids).map((kid, index) => ({
      nome: kid.nome || '',
      nascimento: dateOnlyOrNull(kid.nascimento),
      problema_saude: boolOrNull(kid.problemaSaude),
      descricao_saude: textOrNull(kid.descricaoSaude),
      intolerancia_alimentar: boolOrNull(kid.intoleranciaAlimentar),
      descricao_intolerancia: textOrNull(kid.descricaoIntolerancia),
      ordem: index + 1,
    })),
  });
}

async function saveTeamCoupleAtomic(payload = {}) {
  if (!hasSupabase()) throw supabaseRequiredError();
  const people = array(payload.pessoas);
  const enrolments = array(payload.adesoes);
  const coupleId = String(payload.casalId || '').trim();
  if (!isUuid(coupleId) || people.length !== 2 || enrolments.length !== 2) throw new Error('A ficha de casal deve conter exatamente duas pessoas e duas adesoes validas.');
  const retreatIds = new Set(enrolments.map((record) => String(record.retiroId || '').trim()).filter(Boolean));
  const cpfs = people.map((person) => String(person.cpf || person.id || '').replace(/\D/g, ''));
  if (retreatIds.size !== 1 || cpfs.some((cpf) => cpf.length !== 11) || new Set(cpfs).size !== 2) throw new Error('Os dois integrantes devem pertencer ao mesmo retiro e possuir CPFs diferentes.');
  enrolments.forEach((record) => {
    if (!isUuid(record.id) || record.casalId !== coupleId) throw new Error('Os vinculos da ficha de casal estao inconsistentes.');
  });
  const participants = people.map((person, index) => ({
    person: atomicPersonPayload(person),
    enrolment: atomicEnrolmentPayload(enrolments[index]),
  }));
  try {
    await supabaseRequest('rpc/epc_save_team_couple_atomic', {
      method: 'POST',
      body: JSON.stringify({ p_payload: { couple_id: coupleId, retreat_id: [...retreatIds][0], participants } }),
    });
  } catch (error) {
    if (/PGRST202|epc_save_team_couple_atomic/i.test(String(error?.message || ''))) {
      throw new Error('O salvamento seguro de casal ainda nao foi ativado no Supabase. A ficha nao foi gravada; aplique supabase-adesao-casal-atomica.sql antes de tentar novamente.');
    }
    throw error;
  }
  const [savedPeople, savedEnrolments] = await Promise.all([
    Promise.all(cpfs.map(getPerson)),
    Promise.all(enrolments.map((record) => getEnrolment(record.id))),
  ]);
  if (savedPeople.some((person) => !person) || savedEnrolments.some((record) => !record)) throw new Error('O casal foi gravado, mas nao foi possivel confirmar imediatamente os dois integrantes. Atualize a tela antes de tentar novamente.');
  return { pessoas: savedPeople, adesoes: savedEnrolments };
}

async function moveCommunityMemberAtomic({ retreatId, targetCommunityId, membershipType, studentId } = {}) {
  if (!hasSupabase()) throw supabaseRequiredError();
  const cleanRetreatId = String(retreatId || '').trim();
  const cleanTargetCommunityId = String(targetCommunityId || '').trim();
  const cleanMembershipType = String(membershipType || '').trim().toLowerCase();
  const cleanStudentId = String(studentId || '').trim();
  if (!cleanRetreatId) throw new Error('O identificador do retiro nao foi informado.');
  if (!cleanTargetCommunityId) throw new Error('O identificador da comunidade de destino nao foi informado.');
  if (!cleanStudentId) throw new Error('O identificador do cursista ou casal nao foi informado.');
  if (!['individual', 'smp', 'epc'].includes(cleanMembershipType)) throw new Error('Tipo de ficha de cursista invalido.');
  try {
    return await supabaseRequest('rpc/epc_move_community_member_atomic', {
      method: 'POST',
      body: JSON.stringify({
        p_retiro_id: cleanRetreatId,
        p_comunidade_destino_id: cleanTargetCommunityId,
        p_tipo: cleanMembershipType,
        p_cursista_id: cleanStudentId,
      }),
    });
  } catch (error) {
    if (/PGRST202|epc_move_community_member_atomic/i.test(String(error?.message || ''))) {
      throw new Error('A movimentacao segura entre comunidades ainda nao foi ativada no Supabase. Nenhum vinculo foi alterado; aplique supabase-comunidade-mover-membro-atomico.sql antes de tentar novamente.');
    }
    throw error;
  }
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
  if (isUuid(id)) return oneWhere('cursistas', `id=eq.${enc(id)}&retiro_id=eq.${enc(retreatId)}`, 'id');
  if (!retreatId) return findStudentRow(id);
  return oneWhere('cursistas', `retiro_id=eq.${enc(retreatId)}&cpf=eq.${enc(id)}`, 'id');
}

async function assertStudentBusinessKeys(record, currentId = '') {
  const retreatId = String(record.retiroId || '').trim();
  const cpf = String(record.cpf || '').trim();
  const fileNumber = Number(record.numeroFichaIndividual);
  if (!retreatId) return;
  if (cpf) {
    const duplicateCpf = (await rowsWhere('cursistas', `retiro_id=eq.${enc(retreatId)}&cpf=eq.${enc(cpf)}`, '', 'id'))
      .find((row) => row.id !== currentId);
    if (duplicateCpf) {
      const error = new Error(duplicateStudentCpfMessage);
      error.code = 'DUPLICATE_RETREAT_STUDENT_CPF';
      throw error;
    }
  }
  if (Number.isInteger(fileNumber) && fileNumber > 0) {
    const duplicateFileNumber = (await rowsWhere('cursistas', `retiro_id=eq.${enc(retreatId)}&numero_ficha_individual=eq.${enc(fileNumber)}`, '', 'id'))
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
    nascimento: dateOnlyOrNull(record.nascimento),
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

async function assertCursistaSmpCpfAvailability(record, currentId = '') {
  const retreatId = String(record.retiroId || '').trim();
  const cpfs = [record.cpfDele, record.cpfDela].map(normalizeCpfDigits);
  if (!retreatId) throw new Error('Informe o retiro antes de salvar a ficha Cursista SMP.');

  const filter = `retiro_id=eq.${enc(retreatId)}`;
  const currentRow = currentId
    ? (await rowsWhere('cursista_smp', `${filter}&id=eq.${enc(currentId)}`))[0]
    : null;
  const currentCpfs = currentRow ? [normalizeCpfDigits(currentRow.ele_cpf), normalizeCpfDigits(currentRow.ela_cpf)] : [];
  const cpfsToCheck = currentRow && record.validateCpfAvailability !== true
    ? cpfs.filter((cpf, index) => cpf !== currentCpfs[index])
    : cpfs;
  if (!cpfsToCheck.length) return;
  if (cpfs.some((cpf) => !isValidCpfNumber(cpf))) throw new Error('Informe um CPF valido para cada integrante do casal.');
  if (cpfs[0] === cpfs[1]) throw new Error('Informe um CPF diferente para cada integrante do casal.');

  const cpfFilter = `in.(${cpfsToCheck.map(enc).join(',')})`;
  const [individualStudents, smpByHisCpf, smpByHerCpf, epcByHisCpf, epcByHerCpf, enrolmentRows] = await Promise.all([
    rowsWhere('cursistas', `${filter}&cpf=${cpfFilter}`, '', 'id,cpf'),
    rowsWhere('cursista_smp', `${filter}&ele_cpf=${cpfFilter}`, '', 'id,ele_cpf,ela_cpf'),
    rowsWhere('cursista_smp', `${filter}&ela_cpf=${cpfFilter}`, '', 'id,ele_cpf,ela_cpf'),
    optionalRowsWhere('cursista_epc', `${filter}&ele_cpf=${cpfFilter}`, '', 'id,ele_cpf,ela_cpf'),
    optionalRowsWhere('cursista_epc', `${filter}&ela_cpf=${cpfFilter}`, '', 'id,ele_cpf,ela_cpf'),
    rowsWhere('adesoes', filter, '', 'pessoa_id'),
  ]);
  const smpStudents = [...smpByHisCpf, ...smpByHerCpf];
  const epcStudents = [...epcByHisCpf, ...epcByHerCpf];
  const studentCpfSet = new Set([
    ...individualStudents.map((row) => normalizeCpfDigits(row.cpf)),
    ...smpStudents
      .filter((row) => String(row.id || '') !== String(currentId || ''))
      .flatMap((row) => [normalizeCpfDigits(row.ele_cpf), normalizeCpfDigits(row.ela_cpf)]),
    ...epcStudents.flatMap((row) => [normalizeCpfDigits(row.ele_cpf), normalizeCpfDigits(row.ela_cpf)]),
  ].filter(Boolean));
  if (cpfsToCheck.some((cpf) => studentCpfSet.has(cpf))) {
    const error = new Error(duplicateStudentCpfMessage);
    error.code = 'DUPLICATE_RETREAT_STUDENT_CPF';
    throw error;
  }

  const peopleRows = await rowsWhereIn('pessoas', 'id', enrolmentRows.map((row) => row.pessoa_id), '', 'id,cpf,extras');
  const teamCpfSet = new Set(peopleRows.map((row) => normalizeCpfDigits(row.cpf || row.extras?.cpf)).filter(Boolean));
  if (cpfsToCheck.some((cpf) => teamCpfSet.has(cpf))) {
    const error = new Error(studentTeamCpfConflictMessage);
    error.code = 'STUDENT_TEAM_CONFLICT';
    throw error;
  }
}

async function saveCursistaSmp(record) {
  requireSupabaseForCursistaSmp();
  const id = String(record.id || record.numeroFichaSmp || '').trim();
  await assertCursistaSmpCpfAvailability(record, record.previousId || id);
  const mappedKeys = new Set(['retiroId', 'id', 'numeroFichaSmp', 'previousId', 'validateCpfAvailability', 'nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'crismaDele', 'religiaoDele', 'missaDele', 'movimentoIgrejaDele', 'qualMovimentoDele', 'casamentoDele', 'filhosDele', 'saudeDele', 'qualSaudeDele', 'intoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDele', 'manequimDele', 'nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'crismaDela', 'religiaoDela', 'missaDela', 'movimentoIgrejaDela', 'qualMovimentoDela', 'casamentoDela', 'filhosDela', 'saudeDela', 'qualSaudeDela', 'intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela', 'manequimDela', 'cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp', 'uniaoCasal', 'filhosUniao', 'outrasUnioes', 'smpKidsNotNeeded', 'smpKidNome1', 'smpKidNascimento1', 'smpKidNome2', 'smpKidNascimento2', 'smpKidNome3', 'smpKidNascimento3', 'smpKidNome4', 'smpKidNascimento4', 'smpKidNome5', 'smpKidNascimento5', 'precisaAcolhimento', 'nomeApresentante', 'foneApresentante', 'cursoApresentante', 'cidadeApresentante', 'paroquiaApresentante', 'familiarAmigo', 'foneFamiliar', 'valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp', 'recebedorValorPagoSmp', 'recebedorTaxaPagaSmp', 'recebedorFormaPagamentoSmp', 'recebedorObservacaoSmp', 'criadoEm', 'createdAt', 'updatedAt']);
  cursistaSmpKidCareRecordKeys.forEach((key) => mappedKeys.add(key));
  const row = await upsert('cursista_smp', compact({
    retiro_id: record.retiroId,
    id,
    ele_nome: record.nomeDele || '',
    ele_nascimento: dateOnlyOrNull(record.nascimentoDele),
    ele_cpf: textOrNull(record.cpfDele),
    ele_profissao: record.profissaoDele || '',
    ele_fone: record.foneDele || '',
    ele_crisma: boolOrNull(record.crismaDele),
    ele_religiao: record.religiaoDele || '',
    ele_participa_missas: record.missaDele || '',
    ele_movimento_igreja: boolOrNull(record.movimentoIgrejaDele),
    ele_qual_movimento: record.qualMovimentoDele || '',
    ele_data_primeiro_casamento: dateOnlyOrNull(record.casamentoDele),
    ele_filhos_primeiro_casamento: record.filhosDele || '',
    ele_problema_saude: boolOrNull(record.saudeDele),
    ele_qual_problema_saude: record.qualSaudeDele || '',
    ele_intolerancia_alimentar: boolOrNull(record.intoleranciaAlimentarDele),
    ele_qual_intolerancia_alimentar: record.qualIntoleranciaAlimentarDele || '',
    ele_manequim: record.manequimDele || '',
    ela_nome: record.nomeDela || '',
    ela_nascimento: dateOnlyOrNull(record.nascimentoDela),
    ela_cpf: textOrNull(record.cpfDela),
    ela_profissao: record.profissaoDela || '',
    ela_fone: record.foneDela || '',
    ela_crisma: boolOrNull(record.crismaDela),
    ela_religiao: record.religiaoDela || '',
    ela_participa_missas: record.missaDela || '',
    ela_movimento_igreja: boolOrNull(record.movimentoIgrejaDela),
    ela_qual_movimento: record.qualMovimentoDela || '',
    ela_data_primeiro_casamento: dateOnlyOrNull(record.casamentoDela),
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
    comum_data_uniao_casal: dateOnlyOrNull(record.uniaoCasal),
    comum_filhos_uniao: record.filhosUniao || '',
    comum_outras_unioes: boolOrNull(record.outrasUnioes),
    comum_espaco_kids_nao_necessito: Boolean(record.smpKidsNotNeeded),
    comum_kid_1_nome: record.smpKidNome1 || '',
    comum_kid_1_nascimento: dateOnlyOrNull(record.smpKidNascimento1),
    comum_kid_2_nome: record.smpKidNome2 || '',
    comum_kid_2_nascimento: dateOnlyOrNull(record.smpKidNascimento2),
    comum_kid_3_nome: record.smpKidNome3 || '',
    comum_kid_3_nascimento: dateOnlyOrNull(record.smpKidNascimento3),
    comum_kid_4_nome: record.smpKidNome4 || '',
    comum_kid_4_nascimento: dateOnlyOrNull(record.smpKidNascimento4),
    comum_kid_5_nome: record.smpKidNome5 || '',
    comum_kid_5_nascimento: dateOnlyOrNull(record.smpKidNascimento5),
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
    ele_nascimento: dateOnlyOrNull(record.nascimentoDele),
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
    ela_nascimento: dateOnlyOrNull(record.nascimentoDela),
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
    comum_data_casamento_religioso: dateOnlyOrNull(record.uniaoCasal),
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
    rowData[`comum_kid_${kidNumber}_nascimento`] = dateOnlyOrNull(record[`smpKidNascimento${kidNumber}`]);
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
  if (!ids.size) return { monitorsByCommunity: new Map(), studentsByCommunity: new Map(), smpStudentsByCommunity: new Map(), epcStudentsByCommunity: new Map() };
  const communityIds = [...ids];
  const [linksMonitors, linksStudents, linksSmpStudents, linksEpcStudents] = await Promise.all([
    rowsWhereIn('comunidade_monitores', 'comunidade_id', communityIds),
    rowsWhereIn('comunidade_cursistas', 'comunidade_id', communityIds),
    optionalRowsWhereIn('comunidade_cursistas_smp', 'comunidade_id', communityIds),
    optionalRowsWhereIn('comunidade_cursistas_epc', 'comunidade_id', communityIds),
  ]);
  const [people, students] = await Promise.all([
    rowsWhereIn('pessoas', 'id', linksMonitors.map((item) => item.pessoa_id)),
    rowsWhereIn('cursistas', 'id', linksStudents.map((item) => item.cursista_id)),
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
  const desiredKeys = [...new Set(array(memberIds).map((id) => String(id || '').trim()).filter(Boolean))];
  const uuidIds = desiredKeys.filter(isUuid);
  const cpfIds = desiredKeys.filter((id) => !isUuid(id));
  const [uuidRows, cpfRows] = await Promise.all([
    rowsWhereIn('cursistas', 'id', uuidIds, '', 'id,cpf,retiro_id'),
    rowsWhereIn('cursistas', 'cpf', cpfIds, '', 'id,cpf,retiro_id'),
  ]);
  const desiredRows = [...uuidRows, ...cpfRows].filter((student) => student.retiro_id === retreatId);
  const foundKeys = new Set(desiredRows.flatMap((student) => [student.id, student.cpf].map((value) => String(value || '').trim()).filter(Boolean)));
  if (desiredKeys.some((id) => !foundKeys.has(id))) throw new Error('Um ou mais cursistas individuais nao foram encontrados neste retiro. Nenhum vinculo foi alterado.');
  const desiredIds = new Set(desiredRows.map((student) => student.id));
  const currentRows = await rowsWhere('comunidade_cursistas', `comunidade_id=eq.${enc(communityId)}`, '', 'cursista_id');
  const currentIds = new Set(currentRows.map((item) => item.cursista_id));
  const additions = [...desiredIds].filter((id) => !currentIds.has(id)).map((id) => ({ comunidade_id: communityId, cursista_id: id }));
  const removals = [...currentIds].filter((id) => !desiredIds.has(id));
  if (additions.length) await upsert('comunidade_cursistas', additions, 'comunidade_id,cursista_id');
  if (removals.length) await deleteWhere('comunidade_cursistas', `comunidade_id=eq.${enc(communityId)}&cursista_id=in.(${removals.map(enc).join(',')})`);
}

async function syncSmpCommunityMembers(communityId, retreatId, memberIds = []) {
  const desiredIds = new Set(array(memberIds).map((id) => String(id || '').trim()).filter(Boolean));
  const availableIds = new Set((await rowsWhereIn('cursista_smp', 'id', [...desiredIds], '', 'id,retiro_id')).filter((item) => item.retiro_id === retreatId).map((item) => String(item.id)));
  const missingIds = [...desiredIds].filter((id) => !availableIds.has(id));
  if (missingIds.length) throw new Error('Uma ou mais fichas SMP nao foram encontradas neste retiro. Nenhum vinculo foi alterado.');
  let currentRows;
  try {
    currentRows = await rowsWhere('comunidade_cursistas_smp', `comunidade_id=eq.${enc(communityId)}`, '', 'cursista_id');
  } catch (error) {
    if (isMissingRelationError(error, 'comunidade_cursistas_smp')) throw new Error('A migracao comunidade_cursistas_smp ainda nao foi aplicada ao banco.');
    throw error;
  }
  const currentIds = new Set(currentRows.map((item) => String(item.cursista_id)));
  const additions = [...desiredIds].filter((id) => !currentIds.has(id)).map((id) => ({ comunidade_id: communityId, retiro_id: retreatId, cursista_id: id }));
  const removals = [...currentIds].filter((id) => !desiredIds.has(id));
  if (additions.length) await upsert('comunidade_cursistas_smp', additions, 'comunidade_id,retiro_id,cursista_id');
  if (removals.length) await deleteWhere('comunidade_cursistas_smp', `comunidade_id=eq.${enc(communityId)}&retiro_id=eq.${enc(retreatId)}&cursista_id=in.(${removals.map(enc).join(',')})`);
}

async function syncEpcCommunityMembers(communityId, retreatId, memberIds = []) {
  const desiredIds = new Set(array(memberIds).map((id) => String(id || '').trim()).filter(Boolean));
  const availableIds = new Set((await rowsWhereIn('cursista_epc', 'id', [...desiredIds], '', 'id,retiro_id')).filter((item) => item.retiro_id === retreatId).map((item) => String(item.id)));
  const missingIds = [...desiredIds].filter((id) => !availableIds.has(id));
  if (missingIds.length) throw new Error('Uma ou mais fichas EPC nao foram encontradas neste retiro. Nenhum vinculo foi alterado.');
  let currentRows;
  try {
    currentRows = await rowsWhere('comunidade_cursistas_epc', `comunidade_id=eq.${enc(communityId)}`, '', 'cursista_id');
  } catch (error) {
    if (isMissingRelationError(error, 'comunidade_cursistas_epc')) throw new Error('A migracao comunidade_cursistas_epc ainda nao foi aplicada ao banco.');
    throw error;
  }
  const currentIds = new Set(currentRows.map((item) => String(item.cursista_id)));
  const additions = [...desiredIds].filter((id) => !currentIds.has(id)).map((id) => ({ comunidade_id: communityId, retiro_id: retreatId, cursista_id: id }));
  const removals = [...currentIds].filter((id) => !desiredIds.has(id));
  if (additions.length) await upsert('comunidade_cursistas_epc', additions, 'comunidade_id,retiro_id,cursista_id');
  if (removals.length) await deleteWhere('comunidade_cursistas_epc', `comunidade_id=eq.${enc(communityId)}&retiro_id=eq.${enc(retreatId)}&cursista_id=in.(${removals.map(enc).join(',')})`);
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
  const monitorRows = await findPersonRows(record.monitorIds);
  await Promise.all([
    monitorRows.length ? upsert('comunidade_monitores', monitorRows.map((person) => ({ comunidade_id: record.id, pessoa_id: person.id })), 'comunidade_id,pessoa_id') : null,
  ]);
  if (membershipType === 'individual') await syncIndividualCommunityMembers(record.id, record.retiroId, record.membroIds);
  if (membershipType === 'smp') await syncSmpCommunityMembers(record.id, record.retiroId, record.membroSmpIds);
  if (membershipType === 'epc') await syncEpcCommunityMembers(record.id, record.retiroId, record.membroEpcIds);
  return getRecord('comunidades', record.id);
}

async function listCommunities(retiroId = '') {
  const rows = retiroId
    ? await rowsWhere('comunidades', `retiro_id=eq.${enc(retiroId)}`, 'ordem.asc')
    : await allRows('comunidades', 'ordem.asc');
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
};
financeStores.forEach((storeName) => {
  simpleMappers[storeName] = (row) => ({ ...(row.dados || {}), id: row.id, retiroId: row.retiro_id || row.dados?.retiroId || '', setorChave: row.setor_chave || row.dados?.setorChave || '', createdAt: row.created_at, updatedAt: row.updated_at });
});

async function saveSimple(storeName, record) {
  if (financeStores.includes(storeName)) {
    const row = await upsert(storeName, {
      id: record.id,
      retiro_id: record.retiroId || null,
      setor_chave: storeName === 'financeiro_planilhas' ? record.setorChave || null : undefined,
      dados: extras(record, new Set(['id', 'retiroId', ...(storeName === 'financeiro_planilhas' ? ['setorChave'] : []), 'createdAt', 'updatedAt'])),
      created_at: record.createdAt || undefined,
      updated_at: record.updatedAt || undefined,
    });
    return simpleMappers[storeName](row);
  }
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
  throw new Error(`Store sem mapeamento de gravacao: ${storeName}`);
}

const retreatScopedSimpleStores = new Set(['casais', 'crachas', 'financeiro_planilhas', 'financeiro_planilha_auditoria']);

async function listRelational(storeName, options = {}) {
  const retreatId = typeof options === 'string' ? options : String(options.retiroId || '').trim();
  if (storeName === 'retiros') return listRetreats();
  if (storeName === 'pessoas') return listPeople(retreatId);
  if (storeName === 'adesoes') return listEnrolments(retreatId);
  if (storeName === 'cursistas') return (retreatId ? await rowsWhere('cursistas', `retiro_id=eq.${enc(retreatId)}`, 'updated_at.desc') : await allRows('cursistas')).map(mapStudent);
  if (storeName === 'comunidades') return listCommunities(retreatId);
  const table = tableByStore[storeName];
  const mapper = simpleMappers[storeName];
  if (!table || !mapper) throw new Error(`Store nao mapeada: ${storeName}`);
  if (retreatId && retreatScopedSimpleStores.has(storeName)) return (await rowsWhere(table, `retiro_id=eq.${enc(retreatId)}`, 'updated_at.desc')).map(mapper);
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
  const table = tableByStore[storeName];
  if (!table) throw new Error(`Store nao mapeada: ${storeName}`);
  return deleteWhere(table, `id=eq.${enc(id)}`);
}

async function readDatabase() {
  if (!hasSupabase()) throw supabaseRequiredError();
  const entries = await Promise.all(stores.map(async (storeName) => [storeName, await listRelational(storeName)]));
  return Object.fromEntries(entries);
}

async function importDatabase(incoming) {
  if (!hasSupabase()) throw supabaseRequiredError();
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
  if (!hasSupabase()) throw supabaseRequiredError();
  throw new Error('A substituicao do Supabase deve usar a restauracao transacional de backup.');
}

async function listRecords(storeName, options = {}) {
  if (!hasSupabase()) throw supabaseRequiredError();
  return listRelational(storeName, options);
}

async function getRecord(storeName, id) {
  if (!hasSupabase()) throw supabaseRequiredError();
  return getRelational(storeName, id);
}

// Operacoes estritas nunca podem cair silenciosamente em armazenamento local.
async function getRecordStrict(storeName, id) {
  if (!hasSupabase()) throw supabaseRequiredError();
  return getRelational(storeName, id);
}

async function saveRecord(storeName, record) {
  if (!hasSupabase()) throw supabaseRequiredError();
  return saveRelational(storeName, record);
}

async function saveRetreatStudentRegistrationLinks(retreatId, linksCadastroCursistas = []) {
  if (!hasSupabase()) throw supabaseRequiredError();
  const row = await oneWhere('retiros', `id=eq.${enc(retreatId)}`, 'extras');
  if (!row) return null;
  await supabaseRequest(`retiros?id=eq.${enc(retreatId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      extras: {
        ...(row.extras || {}),
        linksCadastroCursistas,
      },
    }),
  });
  return getRetreat(retreatId);
}

async function saveRetreatClosedRegistrationSectors(retreatId, setoresInscricoesEncerradas = []) {
  if (!hasSupabase()) throw supabaseRequiredError();
  const row = await oneWhere('retiros', `id=eq.${enc(retreatId)}`, 'extras');
  if (!row) return null;
  await supabaseRequest(`retiros?id=eq.${enc(retreatId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      extras: {
        ...(row.extras || {}),
        setoresInscricoesEncerradas,
      },
    }),
  });
  return getRetreat(retreatId);
}

async function deleteRecord(storeName, id) {
  if (!hasSupabase()) throw supabaseRequiredError();
  return deleteRelational(storeName, id);
}

async function deleteRecordStrict(storeName, id) {
  if (!hasSupabase()) throw supabaseRequiredError();
  if (storeName !== 'cursistas') return deleteRelational(storeName, id);
  const row = await findStudentRow(id);
  if (!row) return null;
  const deleted = await supabaseRequest(`cursistas?id=eq.${enc(row.id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  return Array.isArray(deleted) && deleted.length ? mapStudent(deleted[0]) : null;
}

async function checkDatabaseConnection() {
  if (!hasSupabase()) throw supabaseRequiredError();
  await supabaseRequest('retiros?select=id&limit=1');
  return { database: 'supabase-relational', ok: true };
}

module.exports = {
  checkDatabaseConnection,
  dateOnlyOrNull,
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
  getRecordStrict,
  saveRecord,
  saveTeamCoupleAtomic,
  moveCommunityMemberAtomic,
  saveRetreatStudentRegistrationLinks,
  saveRetreatClosedRegistrationSectors,
  deleteRecord,
  deleteRecordStrict,
};
