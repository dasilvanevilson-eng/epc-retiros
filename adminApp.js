import { dataService, retreatDefaults } from './dataService.js';

const app = document.querySelector('#app');
const publicPathRetreatId = location.pathname.match(/^\/adesao\/([^/?#]+)/)?.[1];
const publicPathReceiverToken = location.pathname.match(/^\/recebedor\/([^/?#]+)/)?.[1];
const publicParams = new URLSearchParams(location.search);
const publicRetreatId = publicParams.get('adesao') || (publicPathRetreatId ? decodeURIComponent(publicPathRetreatId) : '');
const publicSectorToken = publicParams.get('setor') || publicParams.get('setorToken') || '';
const publicReceiverToken = publicParams.get('recebedorToken') || (publicPathReceiverToken ? decodeURIComponent(publicPathReceiverToken) : '');
const publicReceiverRetreatId = globalThis.EPC_PUBLIC_RECEIVER?.retiroId || '';
let retreats = [];
let enrolments = [];
let people = [];
let participantSort = { key: 'nome', direction: 'asc' };
let participantsVisible = false;
let receiverSort = { key: 'nome', direction: 'asc' };
let receiverSectorFilter = '';
let receiverPaymentFilter = '';
let openReceiverPanelAfterRender = false;
let badgePrintEntries = [];
let badgePrintTitle = '';
let currentUser = null;
let authChecked = false;
let closeAdminMenuOnOutsidePointer = null;
const selectedRetreatStorageKey = 'epc-selected-retreat-id';

const viewPermissions = {
  inicio: 'inicio.ver',
  retiros: 'retiros.ver',
  pessoas: 'pessoas.ver',
  'validacao-inscricoes': 'validacao-inscricoes.ver',
  cursista: 'cursista.ver',
  comunidades: 'comunidades.ver',
  'recado-equipe': 'recado-equipe.ver',
  crachas: 'crachas.ver',
  quadrante: 'quadrante.ver',
  recebedor: 'recebedor.ver',
  'alterar-senha': null,
  usuarios: 'usuarios.ver',
};

const canAccess = (permission) => !permission || currentUser?.role === 'admin' || currentUser?.perfilCodigo === 'admin' || (currentUser?.permissions || []).includes(permission);
const canView = (section) => canAccess(viewPermissions[section]);
const firstAllowedSection = () => Object.keys(viewPermissions).find((section) => canView(section)) || 'inicio';
const setSelectedRetreatId = (id = '') => {
  if (id) localStorage.setItem(selectedRetreatStorageKey, id);
};
const selectedRetreatId = () => localStorage.getItem(selectedRetreatStorageKey) || '';
const fallbackRetreat = () => retreats.find((retreat) => retreat.status === 'publicado') || retreats.find((retreat) => retreat.status === 'preparacao') || retreats.find((retreat) => retreat.status === 'concluido') || retreats[0] || null;
const selectedRetreat = () => retreats.find((retreat) => retreat.id === selectedRetreatId()) || fallbackRetreat();
const isRetreatConcluded = (retreat = {}) => retreat?.status === 'concluido';
const canModifyRetreat = (retreat = {}) => Boolean(retreat) && !isRetreatConcluded(retreat);
const ensureRetreatCanBeChanged = (retreat, action = 'alterar este retiro') => {
  if (canModifyRetreat(retreat)) return true;
  alert(`Este retiro esta concluido. Nao e mais possivel ${action}; apenas consultas, relatorios e impressoes estao disponiveis.`);
  return false;
};
const ensureViewPermission = (section) => {
  if (canView(section)) return true;
  layout('<section class="page-heading"><div><p class="eyebrow">Acesso restrito</p><h1>Sem permissao</h1><p>Seu usuario nao tem permissao para acessar esta area.</p></div></section>', firstAllowedSection());
  return false;
};
const renderDenied = () => layout('<section class="page-heading"><div><p class="eyebrow">Acesso restrito</p><h1>Sem permissao</h1><p>Seu usuario nao tem permissao para executar esta acao.</p></div></section>', firstAllowedSection());
const teamMessageConfigId = 'recado-equipe';
const randomBytes = (length) => {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  return bytes;
};
const createId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const submitForm = (form) => {
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
    return;
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};
const sectorToken = () => {
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 18);
};
const publicAccessToken = () => {
  const bytes = randomBytes(16);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const syncSectorLinks = (retreat = {}, sectors = retreat.setores || []) => {
  const existing = new Map((retreat.linksSetores || retreat.setorLinks || []).map((item) => [normalizeText(item.setor || item.sector), item]));
  return sortSectors(sectors).map((setor) => {
    const current = existing.get(normalizeText(setor));
    return {
      setor,
      token: current?.token || sectorToken(),
      cadastroToken: current?.cadastroToken || publicAccessToken(),
      acompanhamentoToken: current?.acompanhamentoToken || publicAccessToken(),
    };
  });
};
const ensureSectorLinks = async (retreat) => {
  const nextLinks = syncSectorLinks(retreat, knownSectors(retreat.setores || []));
  const current = JSON.stringify(retreat.linksSetores || []);
  const next = JSON.stringify(nextLinks);
  if (current === next && retreat.recebedorToken) return nextLinks;
  retreat.linksSetores = nextLinks;
  retreat.recebedorToken = retreat.recebedorToken || publicAccessToken();
  await dataService.saveRetiro(retreat);
  return nextLinks;
};

const sortCommunitiesByPosition = (communities = []) => communities
  .map((community, index) => ({ community, index }))
  .sort((first, second) => {
    const firstOrder = Number(first.community.ordem);
    const secondOrder = Number(second.community.ordem);
    const firstHasOrder = Number.isFinite(firstOrder) && firstOrder > 0;
    const secondHasOrder = Number.isFinite(secondOrder) && secondOrder > 0;
    if (firstHasOrder && secondHasOrder && firstOrder !== secondOrder) return firstOrder - secondOrder;
    if (firstHasOrder !== secondHasOrder) return firstHasOrder ? -1 : 1;
    const firstCreated = Date.parse(first.community.criadoEm || '');
    const secondCreated = Date.parse(second.community.criadoEm || '');
    if (Number.isFinite(firstCreated) && Number.isFinite(secondCreated) && firstCreated !== secondCreated) return firstCreated - secondCreated;
    return first.index - second.index;
  })
  .map(({ community }, index) => ({ ...community, ordem: Number(community.ordem) || index + 1 }));

const communityLabel = (community, fallbackIndex = 0) => community?.nome || `Comunidade ${community?.ordem || fallbackIndex + 1}`;
const communityStudentKey = (student = {}) => String(student.id || student.cpf || '').trim();
const studentCommunityDetails = (communities = []) => {
  const details = new Map();
  sortCommunitiesByPosition(communities).forEach((community, index) => {
    const detail = {
      name: communityLabel(community, index),
      order: Number(community.ordem) || index + 1,
    };
    (community.membroIds || []).forEach((memberId) => {
      const key = String(memberId || '').trim();
      if (!key) return;
      details.set(key, detail);
      const cpfKey = normalizeCpf(key);
      if (cpfKey) details.set(cpfKey, detail);
    });
  });
  return details;
};
const studentCommunityDetail = (student, details) => {
  const keys = [student?.id, student?.cpf, communityStudentKey(student)].map((value) => String(value || '').trim()).filter(Boolean);
  for (const key of keys) {
    const detail = details.get(key) || details.get(normalizeCpf(key));
    if (detail) return detail;
  }
  return { name: 'Sem comunidade', order: Number.MAX_SAFE_INTEGER };
};

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const passwordToggleHtml = '<button type="button" class="password-toggle" data-password-toggle aria-label="Mostrar senha" title="Mostrar senha">👁</button>';
const passwordFieldHtml = (inputAttributes) => `<div class="password-field"><input name="password" type="password" ${inputAttributes}>${passwordToggleHtml}</div>`;
function wirePasswordToggles(root = document) {
  root.querySelectorAll('[data-password-toggle]').forEach((button) => {
    if (button.dataset.passwordToggleReady) return;
    button.dataset.passwordToggleReady = 'true';
    button.addEventListener('click', () => {
      const input = button.closest('.password-field')?.querySelector('input');
      if (!input) return;
      const showPassword = input.type === 'password';
      input.type = showPassword ? 'text' : 'password';
      button.classList.toggle('is-visible', showPassword);
      const label = showPassword ? 'Ocultar senha' : 'Mostrar senha';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      input.focus();
    });
  });
}
const normalizeDateInput = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const [, year, month, day] = iso || (br ? [br[0], br[3], br[2], br[1]] : []);
  if (!year || !month || !day) return '';
  const parsed = new Date(`${year}-${month}-${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  const valid = parsed.getFullYear() === Number(year) && parsed.getMonth() + 1 === Number(month) && parsed.getDate() === Number(day);
  return valid ? `${year}-${month}-${day}` : '';
};
const formatDateInput = (value = '') => {
  const normalized = normalizeDateInput(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
};
const date = (value) => {
  const normalized = normalizeDateInput(value);
  return normalized ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${normalized}T12:00:00`)) : 'A definir';
};
const dateRange = (start, end) => start && end && end !== start ? `${date(start)} a ${date(end)}` : date(start);
const birthday = (value) => {
  const normalized = normalizeDateInput(value);
  return normalized ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(`${normalized}T12:00:00`)) : 'A definir';
};
const parseLocalDate = (value) => {
  const normalized = normalizeDateInput(value);
  return normalized ? new Date(`${normalized}T12:00:00`) : null;
};
const weekdayLabel = (value) => {
  const label = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(value);
  return label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1);
};
const retreatDaysFromDates = (startValue, endValue = startValue) => {
  const start = parseLocalDate(startValue);
  const end = parseLocalDate(endValue || startValue);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < 15) {
    days.push(weekdayLabel(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};
const retreatServiceDays = (retreat = {}) => {
  const generated = retreat.dataInicio && retreat.dataTermino ? retreatDaysFromDates(retreat.dataInicio, retreat.dataTermino) : [];
  return generated.length ? generated : (retreat.dias?.length ? retreat.dias : retreatDefaults.dias);
};
const sortSectors = (sectors = []) => [...sectors].sort((first, second) => first.localeCompare(second, 'pt-BR', { sensitivity: 'base' }));
const hiddenTeamSectors = new Set(['camareiro(a)', 'camareiros(as)', 'cozinha', 'espaço kids', 'espiritual', 'externo', 'pegue e pague', 'refeitório', 'secretaria', 'zeladoria']);
const sectorArea = (sector) => hiddenTeamSectors.has(String(sector).toLocaleLowerCase('pt-BR')) ? 'escondida' : 'sala';
const normalizeText = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
const uniqueSectors = (sectors = []) => {
  const seen = new Set();
  return sectors.filter((sector) => {
    const key = normalizeText(sector);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const replacementWorkSector = 'Animação/Jovem de sala';
const removedWorkSectorKeys = new Set(['coordenacao de jovens']);
const renamedWorkSectorKeys = new Set(['animacao', 'jovem de sala']);
const normalizeConfiguredSector = (sector = '') => {
  const label = String(sector || '').trim();
  const key = normalizeText(label);
  if (!key || removedWorkSectorKeys.has(key)) return '';
  if (renamedWorkSectorKeys.has(key)) return replacementWorkSector;
  return label;
};
const configuredSectors = (sectors = []) => uniqueSectors(sectors.map(normalizeConfiguredSector).filter(Boolean));
const normalizeCpf = (value = '') => String(value).replace(/\D/g, '').slice(0, 11);
const publicBadgeLogos = [
  { id: 'epc', name: 'EPC', src: 'assets/clean/epc.png' },
  { id: 'eis-me-aqui', name: 'Eis-me Aqui', src: 'assets/clean/eis-me-aqui-central.png' },
  { id: 'eja', name: 'EJA', src: 'assets/clean/eja.png' },
  { id: 'eju', name: 'EJU', src: 'assets/clean/eju.png' },
  { id: 'onda', name: 'ONDA', src: 'assets/clean/onda.png' },
  { id: 'pastor', name: 'O Senhor e meu Pastor', src: 'assets/clean/pastor.png' },
  { id: 'girassol', name: 'Girassol', src: 'assets/clean/girassol.png' },
];
const isValidCpf = (value = '') => {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (size) => {
    const sum = cpf.slice(0, size).split('').reduce((total, number, index) => total + Number(number) * (size + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
};
const formatCpf = (value = '') => {
  const digits = normalizeCpf(value);
  return digits.replace(/^(\d{3})(\d{0,3})(\d{0,3})(\d{0,2}).*/, (_, first, second, third, fourth) => [first, second, third].filter(Boolean).join('.') + (fourth ? `-${fourth}` : ''));
};
const recordTime = (record = {}) => Date.parse(record.atualizadoEm || record.updatedAt || record.enviadoEm || record.criadoEm || record.createdAt || '') || 0;
const participantIdentity = (record = {}) => normalizeCpf(record.cpf || record.dadosPessoais?.cpf || record.pessoaId || record.id) || String(record.pessoaId || record.id || record.nome || '').trim();
const entryDays = (entry = {}) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).map((day) => String(day || '').trim()).filter(Boolean);
const entrySectors = (entry = {}) => (Array.isArray(entry.setores) ? entry.setores : [entry.setores || entry.setor]).map((sector) => String(sector || '').trim()).filter(Boolean);
const uniqueByParticipant = (items = []) => {
  const byIdentity = new Map();
  items.forEach((item) => {
    const key = participantIdentity(item);
    if (!key) return;
    const current = byIdentity.get(key);
    if (!current || recordTime(item) >= recordTime(current)) byIdentity.set(key, item);
  });
  return [...byIdentity.values()];
};
const mergeEnrolmentsByParticipant = (items = []) => {
  const grouped = new Map();
  items.forEach((item) => {
    const key = participantIdentity(item);
    if (!key) return;
    const group = grouped.get(key) || [];
    group.push(item);
    grouped.set(key, group);
  });
  return [...grouped.values()].map((group) => {
    const latest = [...group].sort((first, second) => recordTime(second) - recordTime(first))[0] || group[0];
    const kidsByIdentity = new Map();
    group.flatMap((entry) => entry.espacoKids || []).forEach((kid) => {
      const key = normalizeText(`${kid.nome || ''}:${kid.nascimento || ''}`);
      if (key) kidsByIdentity.set(key, kid);
    });
    return {
      ...latest,
      setores: sortSectors(uniqueSectors(group.flatMap(entrySectors))),
      dias: uniqueSectors(group.flatMap(entryDays)),
      espacoKids: [...kidsByIdentity.values()],
      quadrante: group.some((entry) => normalizeText(entry.quadrante) === 'sim') ? 'Sim' : latest.quadrante,
      foto: group.some((entry) => normalizeText(entry.foto) === 'sim') ? 'Sim' : latest.foto,
    };
  });
};
const entryHasSector = (entry, sector) => entrySectors(entry).some((item) => normalizeText(item) === normalizeText(sector));
const isEnrolmentValidated = (entry = {}) => entry.status === 'confirmada' || entry.status === 'validada' || entry.validada === true || Boolean(entry.validadoEm);
const enrolmentValidationGroups = (items = []) => {
  const groupedCouples = new Set();
  return items.reduce((groups, entry) => {
    if (entry.casalId) {
      const key = `${entry.retiroId}:${entry.casalId}`;
      if (groupedCouples.has(key)) return groups;
      groupedCouples.add(key);
      groups.push(items.filter((item) => item.retiroId === entry.retiroId && item.casalId === entry.casalId));
      return groups;
    }
    groups.push([entry]);
    return groups;
  }, []);
};
const isEnrolmentGroupValidated = (group = []) => group.every(isEnrolmentValidated);
const personalDataFields = [
  ['nome', 'nome', normalizeText],
  ['nascimento', 'data de nascimento', (value) => String(value || '').trim()],
  ['telefone', 'telefone', (value) => normalizeCpf(value)],
  ['cep', 'CEP', (value) => normalizeCpf(value)],
  ['endereco', 'endereço', normalizeText],
  ['numero', 'número', normalizeText],
  ['bairro', 'bairro', normalizeText],
  ['cidade', 'cidade', normalizeText],
  ['estado', 'estado', (value) => normalizeText(value).toUpperCase()],
];
const personalDataSnapshot = (person = {}) => ({
  cpf: normalizeCpf(person.cpf || person.id),
  nome: person.nome || '',
  nascimento: person.nascimento || '',
  telefone: person.telefone || '',
  cep: person.cep || '',
  endereco: person.endereco || '',
  numero: person.numero || '',
  bairro: person.bairro || '',
  cidade: person.cidade || '',
  estado: person.estado || '',
});
const brazilianStates = [['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins']];
const standardSectorsKey = 'epc-standard-sectors';
const removeStudentFromCommunities = async (studentOrId) => {
  const studentId = typeof studentOrId === 'string' ? studentOrId : studentOrId?.id;
  const studentCpf = typeof studentOrId === 'string' ? '' : normalizeCpf(studentOrId?.cpf || studentOrId?.id);
  const identifiers = new Set([studentId, studentCpf].filter(Boolean));
  if (!identifiers.size) return;
  const communities = await dataService.listComunidades();
  await Promise.all(communities.map((community) => {
    const currentMemberIds = community.membroIds || [];
    const membroIds = currentMemberIds.filter((memberId) => !identifiers.has(memberId) && !identifiers.has(normalizeCpf(memberId)));
    return membroIds.length === currentMemberIds.length ? null : dataService.saveComunidade({ ...community, membroIds });
  }).filter(Boolean));
};
function standardSectors() {
  try {
    const saved = JSON.parse(localStorage.getItem(standardSectorsKey) || 'null');
    if (Array.isArray(saved) && saved.length) {
      const normalized = configuredSectors(saved);
      if (normalized.length !== saved.length) saveStandardSectors(normalized);
      return normalized;
    }
  } catch {}
  return configuredSectors([...retreatDefaults.setores, ...retreats.flatMap((retreat) => retreat.setores || [])]);
}
const saveStandardSectors = (sectors) => localStorage.setItem(standardSectorsKey, JSON.stringify(configuredSectors(sectors)));
async function normalizeStoredRetreatSectors() {
  const changedRetreats = retreats.filter((retreat) => {
    const sectors = configuredSectors(retreat.setores || []);
    const publicSectors = configuredSectors(retreat.setoresPublicos ?? sectors).filter((sector) => sectors.some((item) => normalizeText(item) === normalizeText(sector)));
    const quadranteOrder = configuredSectors(retreat.ordemQuadrante || sectors).filter((sector) => sectors.some((item) => normalizeText(item) === normalizeText(sector)));
    const linksSetores = syncSectorLinks({ linksSetores: retreat.linksSetores || retreat.setorLinks || [] }, sectors);
    const changed = JSON.stringify(retreat.setores || []) !== JSON.stringify(sectors)
      || JSON.stringify(retreat.setoresPublicos || []) !== JSON.stringify(publicSectors)
      || JSON.stringify(retreat.ordemQuadrante || []) !== JSON.stringify(quadranteOrder)
      || JSON.stringify(retreat.linksSetores || []) !== JSON.stringify(linksSetores);
    if (!changed) return false;
    Object.assign(retreat, { setores: sectors, setoresPublicos: publicSectors, ordemQuadrante: quadranteOrder, linksSetores, updatedAt: new Date().toISOString() });
    return true;
  });
  if (changedRetreats.length) await Promise.all(changedRetreats.map((retreat) => dataService.saveRetiro(retreat)));
  saveStandardSectors([...retreatDefaults.setores, ...retreats.flatMap((retreat) => retreat.setores || [])]);
}
const stateDatalist = () => `<datalist id="state-options">${brazilianStates.map(([uf, name]) => `<option value="${uf}">${name}</option>`).join('')}</datalist>`;
function wireStateFields(root) {
  root.querySelectorAll('[name="estado"]').forEach((input) => {
    input.setAttribute('list', 'state-options');
    input.setAttribute('maxlength', '2');
    input.setAttribute('pattern', '[A-Za-z]{2}');
    input.setAttribute('title', 'Use a sigla do estado com 2 letras');
    const normalizeState = () => {
      const typed = input.value.trim();
      const match = brazilianStates.find(([uf, name]) => normalizeText(uf) === normalizeText(typed) || normalizeText(name) === normalizeText(typed));
      input.value = (match?.[0] || typed.replace(/[^A-Za-z]/g, '').slice(0, 2)).toUpperCase();
    };
    input.addEventListener('input', normalizeState);
    input.addEventListener('change', normalizeState);
  });
}
function wireCepLookup(root) {
  const cep = root.querySelector('[name="cep"]');
  if (!cep) return;
  const lookupCep = async () => {
    const digits = cep.value.replace(/\D/g, '');
    const street = root.elements?.endereco || root.elements?.rua;
    if (digits.length !== 8) return;
    cep.value = `${digits.slice(0, 5)}-${digits.slice(5)}`;
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const address = await response.json();
      if (!response.ok || address.erro) return;
      if (street && address.logradouro) street.value = address.logradouro;
      if (root.elements?.bairro && address.bairro) root.elements.bairro.value = address.bairro;
      if (root.elements?.cidade && address.localidade) root.elements.cidade.value = address.localidade;
      if (root.elements?.estado && address.uf) {
        root.elements.estado.value = address.uf;
        root.elements.estado.dispatchEvent(new Event('change'));
      }
    } catch {
      // Mantem o preenchimento manual se a consulta externa falhar.
    }
  };
  cep.addEventListener('change', lookupCep);
  cep.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await lookupCep();
  });
}
function wireCpfFields(root) {
  root.querySelectorAll('[name="cpf"], [name="spouseCpf"]').forEach((input) => {
    input.inputMode = 'numeric';
    input.placeholder = '000.000.000-00';
    input.maxLength = 14;
    input.pattern = '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}|\\d{11}';
    input.title = 'Informe um CPF válido';
    const validateCpf = () => {
      input.value = formatCpf(input.value);
      input.closest('.field')?.querySelector('.cpf-invalid-message')?.remove();
      const cpf = normalizeCpf(input.value);
      const invalid = cpf.length === 11 && !isValidCpf(cpf);
      input.setCustomValidity(invalid ? 'Informe um CPF válido.' : '');
      if (!invalid) return;
      const message = document.createElement('small');
      message.className = 'cpf-invalid-message';
      message.textContent = 'Informe um CPF válido.';
      setTimeout(() => {
        const field = input.closest('.field');
        field?.querySelector('.cpf-invalid-message')?.remove();
        field?.append(message);
        field?.classList.add('field-warning');
      });
    };
    input.addEventListener('input', validateCpf);
    input.addEventListener('change', validateCpf);
  });
}
function wireTypedBirthDates(root) {
  root.querySelectorAll('[name="nascimento"], [name="spouseNascimento"]').forEach((input) => {
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'dd/mm/aaaa';
    input.maxLength = 10;
    input.pattern = '\\d{2}/\\d{2}/\\d{4}';
    input.title = 'Digite a data no formato dd/mm/aaaa';
    const maskDate = () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 8);
      input.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
      input.setCustomValidity('');
    };
    const validateDate = () => {
      input.value = formatDateInput(input.value) || input.value;
      const invalid = Boolean(input.value.trim()) && !normalizeDateInput(input.value);
      input.setCustomValidity(invalid ? 'Digite a data no formato dd/mm/aaaa.' : '');
    };
    input.value = formatDateInput(input.value) || input.value;
    input.addEventListener('input', maskDate);
    input.addEventListener('change', validateDate);
    input.addEventListener('blur', validateDate);
  });
}

async function loadData() {
  [retreats, enrolments, people] = await Promise.all([dataService.listRetiros(), dataService.listAdesoes(), dataService.listPessoas()]);
  retreats.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  await normalizeStoredRetreatSectors();
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const entriesWithoutPersonalSnapshot = enrolments.filter((entry) => !entry.dadosPessoais && peopleById.has(entry.pessoaId));
  if (entriesWithoutPersonalSnapshot.length) {
    await Promise.all(entriesWithoutPersonalSnapshot.map((entry) => {
      entry.dadosPessoais = personalDataSnapshot(peopleById.get(entry.pessoaId));
      return dataService.saveAdesao(entry);
    }));
  }
}

function ageFromBirth(dateOfBirth) {
  if (!dateOfBirth) return null;
  const today = new Date(); const birth = new Date(`${dateOfBirth}T12:00:00`);
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return Number.isFinite(age) ? age : null;
}

function ageFromBirthAt(dateOfBirth, reference = new Date()) {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth}T12:00:00`);
  const target = reference instanceof Date && Number.isFinite(reference.getTime()) ? reference : new Date();
  let age = target.getFullYear() - birth.getFullYear();
  if (target < new Date(target.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return Number.isFinite(age) ? age : null;
}

function kidBirthDateReadyForAgeCheck(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return '';
  const year = Number(normalized.slice(0, 4));
  const currentYear = new Date().getFullYear();
  return year >= 1900 && year <= currentYear ? normalized : '';
}

function kidExceedsRetreatAgeLimit(retreat, dateOfBirth) {
  const normalizedBirth = kidBirthDateReadyForAgeCheck(dateOfBirth);
  const limit = Number(retreat?.idadeMaximaEspacoKids);
  if (!normalizedBirth || !Number.isFinite(limit) || limit <= 0) return false;
  const reference = retreat?.dataInicio ? new Date(`${retreat.dataInicio}T12:00:00`) : new Date();
  const age = ageFromBirthAt(normalizedBirth, reference);
  return age !== null && age > limit;
}

function ageInYearsAndMonths(dateOfBirth) {
  if (!dateOfBirth) return 'Data não informada';
  const birth = new Date(`${dateOfBirth}T12:00:00`); const today = new Date();
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return 'Data inválida';
  const years = Math.floor(months / 12); const remainder = months % 12;
  return `${years} ano${years === 1 ? '' : 's'} e ${remainder} ${remainder === 1 ? 'mês' : 'meses'}`;
}

function metricCard(id, label, count, placeholder) {
  return `<article class="metric-card" data-metric="${id}"><span>${label}</span><strong>${count}</strong><input class="metric-search" data-search="${id}" placeholder="${placeholder}" aria-label="Buscar ${label.toLowerCase()}"><div class="metric-results" data-results="${id}" hidden></div></article>`;
}

function setupMetricSearch() {
  const sources = {
    retiros: () => retreats.map((item) => ({ label: item.nome, detail: `${date(item.dataInicio)}${item.local ? ` · ${item.local}` : ''}`, href: `#retiros/${item.id}` })),
    pessoas: () => people.map((item) => ({ label: item.nome, detail: `Nascimento: ${date(item.nascimento)}`, href: `#pessoas/${item.id}` })),
  };
  app.querySelectorAll('.metric-search').forEach((input) => {
    const render = () => {
      const results = app.querySelector(`[data-results="${input.dataset.search}"]`);
      const term = input.value.trim().toLocaleLowerCase('pt-BR');
      const entries = sources[input.dataset.search]().filter((entry) => !term || `${entry.label} ${entry.detail}`.toLocaleLowerCase('pt-BR').includes(term));
      results.innerHTML = entries.length ? entries.map((entry) => `<a href="${entry.href}"><strong>${escapeHtml(entry.label)}</strong><span>${escapeHtml(entry.detail)}</span></a>`).join('') : '<p>Nenhum resultado encontrado.</p>';
      results.hidden = false;
    };
    input.addEventListener('focus', render); input.addEventListener('input', render);
    input.closest('.metric-card').addEventListener('click', () => input.focus());
  });
}

function layout(content, active = 'inicio') {
  const isPublicReceiverView = Boolean(publicReceiverToken);
  const navItems = [
    ['inicio', 'Início', '⌂'],
    ['retiros', 'Retiros', '▣'],
    ['pessoas', 'Equipe de trabalho', '♁'],
    ['validacao-inscricoes', 'Validação', '✓'],
    ['cursista', 'Cursista', '♙'],
    ['comunidades', 'Comunidades', '♧'],
    ['recado-equipe', 'Recado &agrave; equipe', '!'],
    ['crachas', 'Crach&aacute;s', '▣'],
    ['quadrante', 'Quadrante', '✣'],
    ['recebedor', 'Recebedor', '▱'],
    ['alterar-senha', 'Alterar senha', '••'],
    ['usuarios', 'Usuarios e permissoes', 'UP'],
  ].sort((first, second) => first[1].localeCompare(second[1], 'pt-BR', { sensitivity: 'base' })).filter(([id]) => canView(id));
  app.innerHTML = `
    <div class="admin-shell has-sidebar">
      <aside class="admin-sidebar" aria-label="Identidade EPC">
        <a class="brand sidebar-brand" href="#inicio"><span>EPC</span><strong><small>Família</small>EPC</strong></a>
        <p>Retiros que transformam vidas e renovam corações.</p>
        ${currentUser ? `<p class="session-user">Acesso ${escapeHtml(currentUser.role)}<br><strong>${escapeHtml(currentUser.username)}</strong></p>` : ''}
        <div class="sidebar-ornament" aria-hidden="true"></div>
      </aside>
      <div class="admin-workspace">
        <header class="admin-header"><button class="menu-toggle" type="button" aria-label="Abrir menu" aria-expanded="false">☰</button></header><nav class="main-nav admin-menu-nav" aria-label="Menu principal">
          ${navItems.map(([id, label, icon]) => `<a href="#${id}" class="${active === id ? 'is-active' : ''}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</a>`).join('')}
          <button type="button" class="logout-link" id="logout-button"><span class="nav-icon" aria-hidden="true">↪</span>Sair</button>
        </nav>
        <main class="admin-main">${content}</main>
      </div>
    </div>`;
  const menuToggle = app.querySelector('.menu-toggle');
  const mainNav = app.querySelector('.main-nav');
  if (!menuToggle || !mainNav) return;
  const closeAdminMenu = () => {
    mainNav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  };
  menuToggle.addEventListener('click', () => {
    const open = mainNav.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mainNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeAdminMenu));
  if (closeAdminMenuOnOutsidePointer) document.removeEventListener('pointerdown', closeAdminMenuOnOutsidePointer, true);
  closeAdminMenuOnOutsidePointer = (event) => {
    if (!mainNav.classList.contains('is-open')) return;
    if (mainNav.contains(event.target) || menuToggle.contains(event.target)) return;
    closeAdminMenu();
  };
  document.addEventListener('pointerdown', closeAdminMenuOnOutsidePointer, true);
  app.querySelector('#logout-button')?.addEventListener('click', async () => {
    await dataService.logout().catch(() => null);
    currentUser = null;
    authChecked = false;
    location.href = 'index.html';
  });
  app.querySelectorAll('.statistics-grid span').forEach((label) => { if (label.textContent === 'Idade média') label.textContent = 'Idade média geral'; });
  if (active === 'cursista') app.querySelector('#student-message')?.insertAdjacentHTML('beforebegin', '<section class="form-section student-registration-value"><div class="section-heading"><span>06</span><div><h2>Inscrição</h2><p>Informe os valores financeiros do cursista.</p></div></div><div class="fields three-columns"><label class="field"><span>Valor da inscrição</span><input name="valorInscricao" type="text" inputmode="decimal" placeholder="R$ 0,00"></label><label class="field"><span>Valor pago</span><input name="valorPago" type="text" inputmode="decimal" placeholder="R$ 0,00"></label><label class="field"><span>Saldo a pagar</span><input name="saldoPagar" type="text" readonly placeholder="R$ 0,00"></label></div></section>');
}

function statusLabel(status) { return ({ preparacao: 'Em preparação', publicado: 'Publicado', concluido: 'Concluído', encerrado: 'Encerrado' })[status] || status; }

function homeInfoPrintDocument(label, content) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(label)}</title><style>@page{size:A4;margin:12mm}body{margin:0;color:#253528;font-family:Arial,sans-serif}h1{margin:0 0 6px;font-size:22px;color:#1f2c3f}h2{margin:0 0 6px;font-size:18px;color:#1f2c3f}.panel-heading{margin-bottom:18px}.panel-heading p{margin:0;color:#667268;font-size:12px}.panel-heading h2+p{margin-top:4px}.student-health-list{border-top:1px solid #d9d1c3}.student-health-list>div{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.85fr);gap:14px;padding:10px 0;border-bottom:1px solid #d9d1c3;break-inside:avoid}.student-health-list strong{display:block;color:#1f2c3f;font-size:12px}.student-health-person{display:flex;flex-direction:column;gap:3px;min-width:0}.student-health-person small,.student-health-list small{color:#6f765f;font-size:10px;line-height:1.3}.student-health-list span{color:#4d5964;font-size:12px;line-height:1.35}.city-health-list>div{grid-template-columns:1fr 110px 130px}.city-health-list span b{display:block;color:#1f2c3f;font-size:14px}.city-health-list span small{display:block;color:#6f765f;font-size:10px}.city-health-list .city-health-total{grid-template-columns:1fr repeat(3,95px);margin-top:4px;border-top:2px solid #c69a45;background:#fff8ec;font-weight:700}.shirt-community-list>div{grid-template-columns:minmax(0,1fr) 100px}.shirt-community-list .shirt-community-heading{display:block;padding:12px 0 6px;border-bottom:2px solid #c69a45;color:#1f2c3f;font-size:14px;font-weight:700}.shirt-community-list>div:not(.shirt-community-heading) strong,.shirt-community-list>div:not(.shirt-community-heading) span,.sector-public-list strong,.sector-public-list span{font-size:24px}.sector-public-list{margin:18px 0 0;padding:0;list-style:none;border-top:1px solid #d9d1c3}.sector-public-list li{display:grid;grid-template-columns:minmax(0,1fr) minmax(190px,.75fr);gap:4px 14px;padding:10px 0;border-bottom:1px solid #d9d1c3;break-inside:avoid}.sector-public-list small{display:block;grid-column:1;color:#6f765f;font-size:13px;line-height:1.3}.sector-public-list span{grid-column:2;grid-row:1 / span 2}.stat-tile-grid,.sector-simple-list{display:grid;gap:8px}.stat-tile-grid{grid-template-columns:repeat(3,1fr)}.stat-tile-grid>div,.sector-simple-list button{padding:10px;border:1px solid #d9d1c3;background:#fff;text-align:left;break-inside:avoid}.stat-tile-grid span,.sector-simple-list span{display:block;color:#4d5964;font-size:11px}.stat-tile-grid strong,.sector-simple-list strong{display:block;margin-top:4px;color:#1f2c3f;font-size:18px}.stat-tile-grid small{display:block;color:#6f765f;font-size:10px}.sector-simple-list button{display:grid;grid-template-columns:1fr auto;align-items:center;width:100%;font:inherit;color:inherit}button{border:0;background:transparent}.empty-state{padding:12px 0;color:#667268}footer{display:none}.receiver-sector-back,.sector-public-summary{display:none}</style></head><body><h1>${escapeHtml(label)}</h1><p style="margin:0 0 18px;color:#667268;font-size:12px">Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}</p>${content}</body></html>`;
}

function printHomeInfoWindow(label, content) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
  printWindow.document.open();
  printWindow.document.write(homeInfoPrintDocument(label, content));
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 250);
}

function setHomeStatPrintOptions(dialog, printOptions = []) {
  const actions = dialog?.querySelector('.home-stat-actions');
  if (!actions) return;
  const options = printOptions.length ? printOptions : [{ label: 'Impressão', title: dialog.getAttribute('aria-label') || 'Visualização', content: dialog.querySelector('.home-stat-scroll')?.innerHTML || '' }];
  actions.innerHTML = options.map((option, index) => `<button type="button" data-home-stat-print="${index}">${escapeHtml(option.label)}</button>`).join('');
  actions.querySelectorAll('[data-home-stat-print]').forEach((button) => {
    button.addEventListener('click', () => {
      const option = options[Number(button.dataset.homeStatPrint)] || options[0];
      printHomeInfoWindow(option.title || dialog.getAttribute('aria-label') || 'Visualização', option.content || dialog.querySelector('.home-stat-scroll')?.innerHTML || '');
    });
  });
}

function shirtCommunityPrintContent(students = [], communityDetails = new Map()) {
  const rows = [...students].sort((first, second) => {
    const firstCommunity = studentCommunityDetail(first, communityDetails);
    const secondCommunity = studentCommunityDetail(second, communityDetails);
    if (firstCommunity.order !== secondCommunity.order) return firstCommunity.order - secondCommunity.order;
    const communityResult = firstCommunity.name.localeCompare(secondCommunity.name, 'pt-BR', { sensitivity: 'base' });
    if (communityResult) return communityResult;
    return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
  });
  if (!rows.length) return '<p class="empty-state">Nenhum cursista informado.</p>';
  let currentCommunity = '';
  return `<div class="student-health-list shirt-community-list">${rows.map((student) => {
    const community = studentCommunityDetail(student, communityDetails);
    const heading = community.name !== currentCommunity ? (currentCommunity = community.name, `<div class="shirt-community-heading"><strong>${escapeHtml(community.name)}</strong></div>`) : '';
    return `${heading}<div><strong>${escapeHtml(student.nome || 'Sem nome')}</strong><span>${escapeHtml(String(student.camiseta || student.camisetaOutro || '').trim() || 'Não informado')}</span></div>`;
  }).join('')}</div>`;
}

function openHomeInfoWindow(label, content, options = {}) {
  app.querySelector('.home-stat-overlay')?.remove();
  const overlay = document.createElement('section');
  overlay.className = 'home-stat-overlay';
  const printOptions = options.printOptions?.length ? options.printOptions : [{ label: 'Impressão', title: label, content }];
  overlay.innerHTML = `<div class="home-stat-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}"><button type="button" class="home-stat-close" aria-label="Fechar">×</button><div class="home-stat-scroll">${content}</div><div class="home-stat-actions"></div></div>`;
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') overlay.remove(); });
  overlay.querySelector('.home-stat-close').addEventListener('click', () => overlay.remove());
  setHomeStatPrintOptions(overlay.querySelector('.home-stat-dialog'), printOptions);
  app.append(overlay);
  overlay.querySelector('.home-stat-close').focus();
}

function setupHomeStatTabs(options = {}) {
  const grid = app.querySelector('.retreat-stats-grid');
  if (!grid) return;
  const panels = [
    ['shirts', 'Camisetas dos cursistas', grid.querySelector('.shirt-stat-panel')],
    ['presence', 'Presen\u00e7a por dia', grid.querySelector('.presence-stat-panel')],
    ['sectors', 'Pessoas por setor', grid.querySelector('.sector-stat-panel')],
  ].filter(([, , panel]) => panel);
  if (!panels.length) return;
  grid.classList.add('home-stat-tabs');
  grid.classList.remove('dashboard-grid');
  const controls = document.createElement('div');
  controls.className = 'home-stat-buttons';
  controls.setAttribute('role', 'tablist');
  controls.setAttribute('aria-label', 'Escolha a informa\u00e7\u00e3o');
  controls.innerHTML = panels.map(([key, label]) => `<button type="button" data-home-stat="${key}" role="tab" aria-selected="false">${label}</button>`).join('');
  grid.prepend(controls);
  const openWindow = (key) => {
    const item = panels.find(([panelKey]) => panelKey === key);
    if (!item) return;
    const [, label, panel] = item;
    const printOptions = key === 'shirts' ? [
      { label: 'Por tamanho da camiseta', title: 'Camisetas dos cursistas por tamanho', content: panel.innerHTML },
      { label: 'Por comunidade', title: 'Camisetas dos cursistas por comunidade', content: shirtCommunityPrintContent(options.shirtStudents || [], options.communityDetails || new Map()) },
    ] : null;
    openHomeInfoWindow(label, panel.innerHTML, { printOptions });
  };
  panels.forEach(([key, , panel]) => {
    panel.classList.add('home-stat-panel');
    panel.dataset.homeStatPanel = key;
    panel.hidden = true;
  });
  controls.querySelectorAll('[data-home-stat]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = button.dataset.homeStat;
      controls.querySelectorAll('[data-home-stat]').forEach((item) => {
        const activeButton = item === button;
        item.classList.toggle('is-active', activeButton);
        item.setAttribute('aria-selected', activeButton ? 'true' : 'false');
      });
      openWindow(selected);
    });
  });
}

function setupSectorStatDrilldown(root, rows = []) {
  const groupedSectorPeople = (volunteers = []) => {
    const grouped = new Map();
    volunteers.forEach((entry, index) => {
      const key = entry.casalId ? `casal:${entry.casalId}` : `pessoa:${entry.pessoaId || entry.id || entry.nome || index}`;
      const group = grouped.get(key) || [];
      group.push(entry);
      grouped.set(key, group);
    });
    return [...grouped.values()].map((entries) => {
      const names = entries.map((entry) => String(entry.nome || '').trim()).filter(Boolean).sort((first, second) => first.localeCompare(second, 'pt-BR', { sensitivity: 'base' }));
      return {
        name: names.join(' e '),
        sectors: uniqueSectors(entries.flatMap((entry) => entry.setores || [])),
        days: uniqueSectors(entries.flatMap((entry) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).map((day) => String(day || '').trim()).filter(Boolean))),
        entries,
      };
    }).filter((entry) => entry.name);
  };
  root.querySelectorAll('[data-stat-sector]').forEach((button) => {
    button.addEventListener('click', () => {
      const sector = button.dataset.statSector;
      const selected = rows.find((row) => normalizeText(row.sector) === normalizeText(sector));
      const volunteers = selected?.volunteers || [];
      const configuredDays = selected?.days?.length
        ? selected.days
        : [...new Set(volunteers.flatMap((entry) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).map((day) => String(day || '').trim()).filter(Boolean)))];
      const people = groupedSectorPeople(volunteers)
        .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' }));
      const peopleCount = people.reduce((total, person) => total + person.entries.length, 0);
      const daySummary = configuredDays
        .map((day) => ({ day, count: people.reduce((total, person) => total + person.entries.filter((entry) => entryDays(entry).some((entryDay) => normalizeText(entryDay) === normalizeText(day))).length, 0) }))
        .filter((item) => item.day);
      root.innerHTML = `<button type="button" class="receiver-sector-back" data-sector-stat-back>← Todos os setores</button><section class="sector-public-modal sector-public-modal-inline" role="dialog" aria-modal="true" aria-labelledby="sector-title"><p class="eyebrow">Acompanhamento do setor</p><h1 id="sector-title">${escapeHtml(sector)}</h1><p>${peopleCount} pessoa(s) inscrita(s) neste setor.</p>${people.length ? `<ul class="sector-public-list">${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><small>Setor de trabalho: ${escapeHtml(person.sectors.length ? person.sectors.join(', ') : sector)}</small><span>Dias de trabalho: ${escapeHtml(person.days.length ? person.days.join(', ') : 'dias nao informados')}</span></li>`).join('')}</ul><footer class="sector-public-summary"><h2>Somatorio por dia de trabalho</h2>${daySummary.map((item) => `<div><span>${escapeHtml(item.day)}</span><strong>${item.count} pessoa(s)</strong></div>`).join('')}</footer>` : '<div class="sector-public-empty">Nenhuma pessoa inscrita neste setor ate o momento.</div>'}</section>`;
      setHomeStatPrintOptions(root.closest('.home-stat-dialog'), [{ label: 'Impressão', title: `Pessoas por setor - ${sector}`, content: root.innerHTML }]);
      root.querySelector('[data-sector-stat-back]').addEventListener('click', () => {
        root.innerHTML = root.dataset.sectorListHtml || '';
        setHomeStatPrintOptions(root.closest('.home-stat-dialog'), [{ label: 'Impressão', title: 'Pessoas por setor', content: root.innerHTML }]);
        setupSectorStatDrilldown(root, rows);
      });
    });
  });
}

function wireSectorStatWindows(rows = []) {
  app.querySelectorAll('[data-home-stat="sectors"]').forEach((button) => {
    button.addEventListener('click', () => {
      setTimeout(() => {
        const root = app.querySelector('.home-stat-scroll');
        if (!root) return;
        root.dataset.sectorListHtml = root.innerHTML;
        setupSectorStatDrilldown(root, rows);
      }, 0);
    });
  });
}

async function renderHome() {
  const active = selectedRetreat();
  const [allStudents, allCommunities] = await Promise.all([dataService.listCursistas(), dataService.listComunidades()]);
  const activeCommunityDetails = active ? studentCommunityDetails(allCommunities.filter((community) => community.retiroId === active.id)) : new Map();
  const activeStudents = active ? uniqueByParticipant(allStudents.filter((student) => student.retiroId === active.id)) : [];
  const activeEnrolments = active ? mergeEnrolmentsByParticipant(enrolments.filter((item) => item.retiroId === active.id)) : [];
  const activeEntries = active ? enrolments.filter((item) => item.retiroId === active.id) : [];
  const activeStatEntries = activeEntries.length ? activeEntries : activeEnrolments;
  const pendingValidationGroups = enrolmentValidationGroups(activeEntries).filter((group) => !isEnrolmentGroupValidated(group));
  const serviceDays = active ? retreatServiceDays(active) : [];
  const sectorCounts = active ? sortSectors(uniqueSectors([...(active.setores || []), ...activeStatEntries.flatMap(entrySectors)]))
    .map((sector) => [sector, activeStatEntries.filter((entry) => entryHasSector(entry, sector)).length])
    .filter(([sector, count]) => count > 0 || active?.setores?.includes(sector)) : [];
  const dayCount = (day) => activeStatEntries.filter((entry) => entryDays(entry).some((item) => normalizeText(item) === normalizeText(day))).length + activeStudents.length;
  const shirtCounts = activeStudents.reduce((counts, student) => {
    const size = String(student.camiseta || '').trim();
    if (size) counts[size] = (counts[size] || 0) + 1;
    return counts;
  }, {});
  const shirtOrder = ['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'];
  const shirtRows = Object.entries(shirtCounts).sort(([first], [second]) => {
    const firstIndex = shirtOrder.indexOf(first);
    const secondIndex = shirtOrder.indexOf(second);
    if (firstIndex !== -1 || secondIndex !== -1) return (firstIndex === -1 ? 99 : firstIndex) - (secondIndex === -1 ? 99 : secondIndex);
    return first.localeCompare(second, 'pt-BR', { numeric: true, sensitivity: 'base' });
  });
  const intoleranceStudents = activeStudents
    .filter((student) => normalizeText(student.intoleranciaAlimentos) === 'sim' || String(student.qualIntolerancia || '').trim())
    .sort((first, second) => {
      const firstCommunity = studentCommunityDetail(first, activeCommunityDetails);
      const secondCommunity = studentCommunityDetail(second, activeCommunityDetails);
      if (firstCommunity.order !== secondCommunity.order) return firstCommunity.order - secondCommunity.order;
      const communityResult = firstCommunity.name.localeCompare(secondCommunity.name, 'pt-BR', { sensitivity: 'base' });
      if (communityResult) return communityResult;
      return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
  const allergyStudents = activeStudents
    .filter((student) => normalizeText(student.alergiaMedicamento) === 'sim' || String(student.qualAlergia || '').trim())
    .sort((first, second) => {
      const firstCommunity = studentCommunityDetail(first, activeCommunityDetails);
      const secondCommunity = studentCommunityDetail(second, activeCommunityDetails);
      if (firstCommunity.order !== secondCommunity.order) return firstCommunity.order - secondCommunity.order;
      const communityResult = firstCommunity.name.localeCompare(secondCommunity.name, 'pt-BR', { sensitivity: 'base' });
      if (communityResult) return communityResult;
      return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
  const groupedPreferenceRows = (entries, field) => {
    const usedCouples = new Set();
    return entries.reduce((rows, entry) => {
      if (entry.casalId) {
        if (usedCouples.has(entry.casalId)) return rows;
        const couple = entries.filter((item) => item.casalId === entry.casalId);
        usedCouples.add(entry.casalId);
        if (!couple.some((item) => normalizeText(item[field]) === 'sim')) return rows;
        rows.push({ name: couple.map((item) => item.nome).filter(Boolean).join(' e '), detail: uniqueSectors(couple.flatMap((item) => item.setores || [])).join(', ') || 'Setor não informado' });
        return rows;
      }
      if (normalizeText(entry[field]) !== 'sim') return rows;
      rows.push({ name: entry.nome || 'Sem nome', detail: entry.setores?.join(', ') || 'Ficha individual' });
      return rows;
    }, []).sort((first, second) => {
      if (field === 'quadrante' || field === 'foto') {
        const sectorResult = first.detail.localeCompare(second.detail, 'pt-BR', { sensitivity: 'base' });
        if (sectorResult) return sectorResult;
      }
      return first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' });
    });
  };
  const quadranteRows = groupedPreferenceRows(activeEnrolments, 'quadrante');
  const photoRows = groupedPreferenceRows(activeEnrolments, 'foto');
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const spaceKidsRows = activeEnrolments.flatMap((entry) => {
    const responsible = peopleById.get(entry.pessoaId) || entry.dadosPessoais || {};
    return (entry.espacoKids || []).map((kid) => ({
      ...kid,
      volunteer: entry.nome || responsible.nome || 'Não informado',
      contact: responsible.telefone || entry.dadosPessoais?.telefone || '',
    }));
  }).sort((first, second) => {
    const firstBirth = Date.parse(`${first.nascimento || ''}T12:00:00`);
    const secondBirth = Date.parse(`${second.nascimento || ''}T12:00:00`);
    if (Number.isFinite(firstBirth) && Number.isFinite(secondBirth) && firstBirth !== secondBirth) return secondBirth - firstBirth;
    if (Number.isFinite(firstBirth) !== Number.isFinite(secondBirth)) return Number.isFinite(firstBirth) ? -1 : 1;
    return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
  });
  const cityStats = new Map();
  const addCityCount = (city, type) => {
    const label = String(city || '').trim();
    if (!label) return;
    const key = normalizeText(label);
    const row = cityStats.get(key) || { city: label, students: 0, team: 0 };
    row[type] += 1;
    cityStats.set(key, row);
  };
  activeStudents.forEach((student) => addCityCount(student.cidade, 'students'));
  activeEnrolments.forEach((entry) => {
    const responsible = peopleById.get(entry.pessoaId) || entry.dadosPessoais || {};
    addCityCount(responsible.cidade || entry.dadosPessoais?.cidade || entry.cidade, 'team');
  });
  const cityRows = [...cityStats.values()].sort((first, second) => first.city.localeCompare(second.city, 'pt-BR', { sensitivity: 'base' }));
  const sectorStatRows = sectorCounts.map(([sector, count]) => ({
    sector,
    count,
    days: serviceDays,
    volunteers: activeStatEntries.filter((entry) => entryHasSector(entry, sector)).sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' })),
  }));
  const sectorRows = sectorStatRows.length ? sectorStatRows.map(({ sector, count }) => `<button type="button" data-stat-sector="${escapeHtml(sector)}"><span>${escapeHtml(sector)}</span><strong>${count}</strong></button>`).join('') : '<p class="empty-state">Nenhum setor com equipe inscrita.</p>';
  const dayRows = serviceDays.length ? serviceDays.map((day) => `<div><span>${escapeHtml(day)}</span><strong>${dayCount(day)}</strong><small>pessoa(s)</small></div>`).join('') : '<p class="empty-state">Nenhum dia configurado.</p>';
  const shirtGrid = shirtRows.length ? shirtRows.map(([size, count]) => `<div><span>${escapeHtml(size)}</span><strong>${count}</strong><small>camiseta(s)</small></div>`).join('') : '<p class="empty-state">Nenhum tamanho informado.</p>';
  const healthRows = (students, field, fallback, options = {}) => students.length ? `<div class="student-health-list">${students.map((student) => {
    const community = options.showCommunity ? studentCommunityDetail(student, options.communityDetails) : null;
    return `<div><div class="student-health-person"><strong>${escapeHtml(student.nome || 'Sem nome')}</strong>${community ? `<small>Comunidade: ${escapeHtml(community.name)}</small>` : ''}</div><span>${escapeHtml(String(student[field] || '').trim() || fallback)}</span></div>`;
  }).join('')}</div>` : '<p class="empty-state">Nenhum cursista informado.</p>';
  const preferenceRows = (rows, fallback) => rows.length ? `<div class="student-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.detail)}</span></div>`).join('')}</div>` : `<p class="empty-state">${fallback}</p>`;
  const kidsRows = (rows) => rows.length ? `<div class="student-health-list kids-health-list">${rows.map((kid) => `<div><strong>${escapeHtml(kid.nome || 'Sem nome')}<span class="student-health-inline">${escapeHtml(ageInYearsAndMonths(kid.nascimento))}</span></strong><small>Cadastrada por: ${escapeHtml(kid.volunteer || 'Não informado')}${kid.contact ? ` · Contato: ${escapeHtml(kid.contact)}` : ' · Contato não informado'}</small></div>`).join('')}</div>` : '<p class="empty-state">Nenhuma criança cadastrada no Espaço Kids.</p>';
  const cityRowsHtml = (rows) => {
    if (!rows.length) return '<p class="empty-state">Nenhuma cidade informada nos cadastros deste retiro.</p>';
    const totals = rows.reduce((sum, row) => ({ students: sum.students + row.students, team: sum.team + row.team }), { students: 0, team: 0 });
    return `<div class="student-health-list city-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.city)}</strong><span><b>${row.students}</b><small>Cursistas</small></span><span><b>${row.team}</b><small>Equipe de trabalho</small></span></div>`).join('')}<div class="city-health-total"><strong>Total geral</strong><span><b>${totals.students}</b><small>Cursistas</small></span><span><b>${totals.team}</b><small>Equipe de trabalho</small></span><span><b>${totals.students + totals.team}</b><small>Participantes</small></span></div></div>`;
  };
  layout(`<section class="dashboard-hero"><div class="hero-cross" aria-hidden="true"></div><h1>${active ? escapeHtml(active.nome) : 'Retiro em foco'}</h1><p>${active ? `${dateRange(active.dataInicio, active.dataTermino)}${active.local ? ` · ${escapeHtml(active.local)}` : ''}` : 'Crie ou publique um retiro para acompanhar as estatísticas.'}</p><div class="gold-divider" aria-hidden="true"></div></section>
    <section class="metric-grid dashboard-metrics">
      <article class="metric-card static-metric"><span>Cursistas</span><strong>${activeStudents.length}</strong><small>pessoa(s)</small></article>
      <article class="metric-card static-metric"><span>Equipe de trabalho</span><strong>${activeEnrolments.length}</strong><small>pessoa(s)</small></article>
      <article class="metric-card static-metric"><span>Fichas da equipe de trabalho aguardando validação</span><strong>${pendingValidationGroups.length}</strong><small>ficha(s)</small></article>
    </section>
    <section class="student-health-grid" aria-label="Cuidados de saúde dos cursistas">
      <article class="student-health-card"><div><span>Cursistas com Intolerância a alimentos</span><strong>${intoleranceStudents.length}</strong></div><button type="button" data-home-health="intolerance">Visualizar</button></article>
      <article class="student-health-card"><div><span>Cursistas Alérgicos a Medicamentos</span><strong>${allergyStudents.length}</strong></div><button type="button" data-home-health="allergy">Visualizar</button></article>
      <article class="student-health-card"><div><span>Quadrante impresso Equipe de trabalho</span><strong>${quadranteRows.length}</strong></div><button type="button" data-home-health="quadrante">Visualizar</button></article>
      <article class="student-health-card"><div><span>Fotos solicitadas pela equipe de trabalho</span><strong>${photoRows.length}</strong></div><button type="button" data-home-health="photo">Visualizar</button></article>
      <article class="student-health-card"><div><span>Número de crianças no Espaço Kids</span><strong>${spaceKidsRows.length}</strong></div><button type="button" data-home-health="kids">Visualizar</button></article>
      <article class="student-health-card"><div><span>Número de cidades com participantes</span><strong>${cityRows.length}</strong></div><button type="button" data-home-health="cities">Visualizar</button></article>
    </section>
    <section class="dashboard-grid retreat-stats-grid">
      <article class="panel dashboard-panel shirt-stat-panel"><div class="panel-heading"><div><h2>Camisetas dos cursistas</h2><p>Quantidade por tamanho informado na ficha do cursista.</p></div></div><div class="stat-tile-grid shirt-stat-grid">${shirtGrid}</div></article>
      <article class="panel dashboard-panel presence-stat-panel"><div class="panel-heading"><div><h2>Presença por dia</h2><p>Cursistas + equipe de trabalho prevista em cada dia.</p></div></div><div class="stat-tile-grid presence-stat-grid">${dayRows}</div></article>
      <article class="panel dashboard-panel sector-stat-panel"><div class="panel-heading"><div><h2>Pessoas por setor</h2><p>Equipe de trabalho inscrita por setor.</p></div></div><div class="sector-simple-list">${sectorRows}</div></article>
    </section>
    <footer class="dashboard-blessing">Deus seja louvado!</footer>`, 'inicio');
  setupHomeStatTabs({ shirtStudents: activeStudents, communityDetails: activeCommunityDetails });
  const healthContent = {
    intolerance: `<div class="panel-heading"><div><h2>Cursistas com Intolerância a alimentos</h2><p>Comunidade, nome do cursista e alimento informado na ficha.</p></div></div>${healthRows(intoleranceStudents, 'qualIntolerancia', 'Intolerância não detalhada', { showCommunity: true, communityDetails: activeCommunityDetails })}`,
    allergy: `<div class="panel-heading"><div><h2>Cursistas Alérgicos a Medicamentos</h2><p>Comunidade, nome do cursista e medicamento informado na ficha.</p></div></div>${healthRows(allergyStudents, 'qualAlergia', 'Medicamento não detalhado', { showCommunity: true, communityDetails: activeCommunityDetails })}`,
    quadrante: `<div class="panel-heading"><div><h2>Quadrante impresso Equipe de trabalho</h2><p>Inscrições da equipe que responderam Sim. Casais aparecem juntos e contam como uma ficha.</p></div></div>${preferenceRows(quadranteRows, 'Nenhuma inscrição solicitou quadrante impresso.')}`,
    photo: `<div class="panel-heading"><div><h2>Fotos solicitadas pela equipe de trabalho</h2><p>Inscrições da equipe que pediram foto. Casais aparecem juntos e contam como uma foto.</p></div></div>${preferenceRows(photoRows, 'Nenhuma inscrição solicitou foto.')}`,
    kids: `<div class="panel-heading"><div><h2>Número de crianças no Espaço Kids</h2><p>Nome da criança, idade e responsável pelo cadastro.</p></div></div>${kidsRows(spaceKidsRows)}`,
    cities: `<div class="panel-heading"><div><h2>Número de cidades com participantes</h2><p>Quantidade de pessoas por cidade, separando cursistas e equipe de trabalho.</p></div></div>${cityRowsHtml(cityRows)}`,
  };
  app.querySelectorAll('[data-home-health]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.homeHealth;
      openHomeInfoWindow(button.closest('.student-health-card')?.querySelector('span')?.textContent || 'Cursistas', healthContent[key] || '');
    });
  });
  wireSectorStatWindows(sectorStatRows);
}

async function renderRetiros() {
  layout(`<section class="page-heading"><div><p class="eyebrow">Configuração de eventos</p><h1>Retiros</h1><p>Cada retiro possui sua própria estrutura, voluntários e histórico.</p></div><a class="primary-button" href="#retiros/novo">+ Novo retiro</a></section>
  <section class="retreat-list">${retreats.length ? retreats.map((retreat) => `<a class="retreat-card" href="#retiros/${retreat.id}"><div><span class="status ${retreat.status}">${statusLabel(retreat.status)}</span><h2>${escapeHtml(retreat.nome)}</h2><p>${dateRange(retreat.dataInicio, retreat.dataTermino)}${retreat.local ? ` · ${escapeHtml(retreat.local)}` : ''}</p></div><div class="retreat-card-meta"><strong>${mergeEnrolmentsByParticipant(enrolments.filter((item) => item.retiroId === retreat.id)).length}</strong><span>voluntários</span></div><span class="arrow">→</span></a>`).join('') : '<div class="empty-state">Nenhum retiro criado. Comece configurando o próximo evento.</div>'}</section>`, 'retiros');
}

const sectorOptionHtml = (sector, selected = false) => `<div class="sector-option" data-sector-option="${escapeHtml(sector)}"><label><input type="checkbox" name="setores" value="${escapeHtml(sector)}" ${selected ? 'checked' : ''}> <span data-sector-name>${escapeHtml(sector)}</span></label></div>`;

function sectorGroups(sectors, selectedSectors = sectors, publicSectors = sectors) {
  const selected = new Set(selectedSectors.map(normalizeText));
  const group = (area, title) => `<section class="sector-area"><h3>${title}</h3><div class="sector-checks" data-area="${area}">${sortSectors(sectors.filter((sector) => sectorArea(sector) === area)).map((sector) => sectorOptionHtml(sector, selected.has(normalizeText(sector)))).join('')}</div></section>`;
  return `${group('escondida', 'Equipe escondida')}${group('sala', 'Equipe Sala')}`;
}

function quadranteOrderList(sectors = [], order = []) {
  const sectorByKey = new Map(sectors.map((sector) => [normalizeText(sector), sector]));
  const orderedSectors = order.map((sector) => sectorByKey.get(normalizeText(sector))).filter(Boolean);
  const active = uniqueSectors([...orderedSectors, ...sectors]);
  return `<div class="quadrante-order-list">${active.map((sector) => `<div class="quadrante-order-row" draggable="true" data-sector="${escapeHtml(sector)}"><input type="hidden" name="ordemQuadrante" value="${escapeHtml(sector)}"><span class="drag-handle" aria-hidden="true">↕</span><span>${escapeHtml(sector)}</span></div>`).join('')}</div>`;
}

const quadranteOrderForSectors = (sectors = [], savedOrder = []) => {
  const baseOrder = savedOrder.length ? savedOrder : retreatDefaults.setores;
  const sectorByKey = new Map(sectors.map((sector) => [normalizeText(sector), sector]));
  const orderedSectors = baseOrder.map((sector) => sectorByKey.get(normalizeText(sector))).filter(Boolean);
  const orderedKeys = new Set(orderedSectors.map(normalizeText));
  return uniqueSectors([...orderedSectors, ...sortSectors(sectors.filter((sector) => !orderedKeys.has(normalizeText(sector))))]);
};

const knownSectors = (extra = []) => configuredSectors([...standardSectors(), ...extra]);
const quadranteOrderSettingId = 'quadrante-order';
const retreatQuadranteOrderFallback = () => retreats.find((retreat) => retreat.ordemQuadrante?.length)?.ordemQuadrante || retreatDefaults.setores;
const loadQuadranteOrderSetting = async () => (await dataService.getConfiguracao(quadranteOrderSettingId).catch(() => null))?.setores || null;
const allQuadranteSectors = (extra = []) => knownSectors([...retreats.flatMap((retreat) => [...(retreat.setores || []), ...(retreat.ordemQuadrante || [])]), ...extra]);

function structureOptions(retreat) {
  const sectors = knownSectors(retreat?.setores || []);
  const selected = retreat ? configuredSectors(retreat.setores) : configuredSectors(retreatDefaults.setores);
  return sectorGroups(sectors, selected, configuredSectors(retreat?.setoresPublicos ?? selected));
}

function wirePublicSectorToggles(form) {
}

function setupQuadranteOrderEditor(root, initialOrder = [], sectorsProvider = null) {
  const container = root.querySelector('[data-quadrante-order]');
  if (!container) return;
  let currentOrder = [...initialOrder];
  let draggedSector = null;
  let scrollFrame = null;
  let scrollSpeed = 0;
  const orderSectors = () => sectorsProvider ? sectorsProvider() : [...root.querySelectorAll('input[name="setores"]')].map((input) => input.value);
  const syncFromRows = () => { currentOrder = [...container.querySelectorAll('.quadrante-order-row')].map((row) => row.dataset.sector); };
  const stopAutoScroll = () => {
    scrollSpeed = 0;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
  };
  const runAutoScroll = () => {
    if (!scrollSpeed) { scrollFrame = null; return; }
    container.scrollTop += scrollSpeed;
    scrollFrame = requestAnimationFrame(runAutoScroll);
  };
  const updateAutoScroll = (clientY) => {
    const rect = container.getBoundingClientRect();
    const edge = Math.min(90, rect.height / 3);
    const topDistance = clientY - rect.top;
    const bottomDistance = rect.bottom - clientY;
    if (topDistance < edge) scrollSpeed = -Math.max(4, Math.round((edge - topDistance) / 3));
    else if (bottomDistance < edge) scrollSpeed = Math.max(4, Math.round((edge - bottomDistance) / 3));
    else scrollSpeed = 0;
    if (scrollSpeed && !scrollFrame) scrollFrame = requestAnimationFrame(runAutoScroll);
    if (!scrollSpeed && scrollFrame) stopAutoScroll();
  };
  const render = () => {
    const sectors = orderSectors();
    currentOrder = quadranteOrderForSectors(sectors, currentOrder);
    container.innerHTML = quadranteOrderList(sectors, currentOrder);
  };
  container.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.quadrante-order-row');
    if (!row) return;
    draggedSector = row.dataset.sector;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedSector);
  });
  container.addEventListener('dragover', (event) => {
    const dragged = container.querySelector('.is-dragging');
    if (!dragged) return;
    event.preventDefault();
    updateAutoScroll(event.clientY);
    const target = event.target.closest('.quadrante-order-row');
    if (!target || target === dragged) return;
    const rect = target.getBoundingClientRect();
    const afterTarget = event.clientY > rect.top + rect.height / 2;
    target.parentNode.insertBefore(dragged, afterTarget ? target.nextSibling : target);
  });
  container.addEventListener('drop', (event) => {
    if (!draggedSector) return;
    event.preventDefault();
    stopAutoScroll();
    syncFromRows();
  });
  container.addEventListener('dragend', () => {
    container.querySelectorAll('.is-dragging').forEach((row) => row.classList.remove('is-dragging'));
    draggedSector = null;
    stopAutoScroll();
    syncFromRows();
  });
  root.addEventListener('change', (event) => { if (event.target.name === 'setores') render(); });
  root.addEventListener('sectors:updated', (event) => { if (event.detail?.order) currentOrder = [...event.detail.order]; render(); });
  render();
}

async function renderNewRetreat() {
  layout(`<section class="page-heading compact"><div><p class="eyebrow">Novo evento</p><h1>Criar retiro</h1><p>Os voluntários começam sempre vazios. Você só pode reaproveitar a estrutura.</p></div><a class="text-link" href="#retiros">← Voltar</a></section>
  <form id="retreat-form" class="panel editor-form"><div class="fields two-columns"><label class="field full"><span>Nome do retiro <b>*</b></span><input name="nome" required placeholder="Ex.: Retiro de Casais 2027"></label><label class="field"><span>Data de início</span><input name="dataInicio" type="date"></label><label class="field"><span>Data de término</span><input name="dataTermino" type="date"></label><label class="field"><span>Local</span><input name="local" placeholder="Ex.: Casa de Retiros"></label><div class="fields three-columns retreat-value-fields full"><label class="field"><span>Inscrição do cursista</span><input name="valorInscricaoCursista" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Inscrição do voluntário</span><input name="valorInscricaoVoluntario" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Valor da foto</span><input name="valorFoto" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Idade máxima para ficar no Espaço Kids</span><input name="idadeMaximaEspacoKids" type="number" min="0" step="1" inputmode="numeric" placeholder="Ex.: 10"></label></div></div>
  <fieldset><legend>Setores de trabalho</legend><p class="hint">Selecione os setores que ter&atilde;o link de inscri&ccedil;&atilde;o por setor neste retiro.</p><div class="sector-groups" id="sector-checks">${sectorGroups(knownSectors(), [], [])}</div></fieldset><div class="form-actions"><p>O retiro ficará salvo como <b>Em preparação</b>.</p><button type="submit">Criar retiro <span>→</span></button></div></form>`, 'retiros');
  const form = app.querySelector('#retreat-form');
  let sourceRetreatId = '';
  ensureOfficialShirtValueField(form);
  wireCurrencyInputs(form);
  wirePublicSectorToggles(form);
  const applySourceRetreat = (source = null) => {
    sourceRetreatId = source?.id || '';
    form.reset();
    form.elements.nome.value = source?.nome || '';
    form.elements.dataInicio.value = source?.dataInicio || '';
    form.elements.dataTermino.value = source?.dataTermino || '';
    form.elements.local.value = source?.local || '';
    form.elements.valorInscricaoCursista.value = source ? currency(source.valorInscricaoCursista) : '';
    form.elements.valorInscricaoVoluntario.value = source ? currency(source.valorInscricaoVoluntario) : '';
    form.elements.valorFoto.value = source ? currency(source.valorFoto ?? 10) : '';
    form.elements.valorCamisetaOficial.value = source ? currency(source.valorCamisetaOficial) : '';
    form.elements.idadeMaximaEspacoKids.value = source?.idadeMaximaEspacoKids ?? '';
    app.querySelector('#sector-checks').innerHTML = source
      ? sectorGroups(knownSectors(source.setores), configuredSectors(source.setores), configuredSectors(source.setoresPublicos ?? source.setores))
      : sectorGroups(knownSectors(), [], []);
    wirePublicSectorToggles(form);
  };
  const openStructureChoice = () => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    const closeToList = () => { overlay.remove(); location.hash = '#retiros'; };
    const finish = (source = null) => { applySourceRetreat(source); overlay.remove(); form.elements.nome.focus(); };
    const renderChoice = () => {
      overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Criar retiro</p><h2>Escolha a estrutura inicial</h2><p>Defina se o novo retiro começa em branco ou se será preenchido a partir de outro retiro.</p></div></div><div class="receiver-sector-list"><button type="button" data-new-retreat-standard><strong>Começar com estrutura padrão</strong><span>Campos vazios, setores desmarcados e sem crachás.</span></button><button type="button" data-new-retreat-copy><strong>Usar estrutura de outro retiro</strong><span>Busca um retiro para copiar dados, setores e crachás ao salvar.</span></button></div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
      overlay.querySelector('[data-new-retreat-standard]').addEventListener('click', () => finish());
      overlay.querySelector('[data-new-retreat-copy]').addEventListener('click', renderSearch);
      overlay.querySelector('.close-sector-view').addEventListener('click', closeToList);
    };
    const renderSearch = () => {
      const rowsHtml = retreats.map((retreat) => `<button type="button" data-source-retreat="${escapeHtml(retreat.id)}"><strong>${escapeHtml(retreat.nome)}</strong><span>${dateRange(retreat.dataInicio, retreat.dataTermino)}${retreat.local ? ` · ${escapeHtml(retreat.local)}` : ''}</span></button>`).join('');
      overlay.innerHTML = `<div class="receiver-sector-dialog"><button type="button" class="receiver-sector-back">← Escolher outra opção</button><div class="panel-heading"><div><p class="eyebrow">Duplicar estrutura</p><h2>Buscar retiro de origem</h2><p>Selecione o retiro que terá dados, setores e modelos de crachá copiados para a nova inclusão.</p></div></div><label class="field"><span>Buscar retiro</span><input id="new-retreat-source-search" autocomplete="off" placeholder="Digite o nome do retiro"></label><div class="receiver-sector-list">${rowsHtml || '<p class="empty-state">Nenhum retiro cadastrado para copiar.</p>'}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
      const search = overlay.querySelector('#new-retreat-source-search');
      const rows = [...overlay.querySelectorAll('[data-source-retreat]')];
      search?.addEventListener('input', () => {
        const term = normalizeText(search.value);
        rows.forEach((row) => { row.hidden = term && !normalizeText(row.textContent).includes(term); });
      });
      overlay.querySelector('.receiver-sector-back').addEventListener('click', renderChoice);
      overlay.querySelector('.close-sector-view').addEventListener('click', closeToList);
      rows.forEach((row) => row.addEventListener('click', () => finish(retreats.find((retreat) => retreat.id === row.dataset.sourceRetreat))));
      search?.focus();
    };
    renderChoice();
    app.append(overlay);
  };
  openStructureChoice();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Salvando...';
    try {
      const values = new FormData(form);
      const selectedSectors = values.getAll('setores');
      if (!selectedSectors.length) { alert('Selecione ao menos um setor de trabalho.'); submitButton.disabled = false; submitButton.innerHTML = 'Criar retiro <span>→</span>'; return; }
      if (values.get('dataInicio') && values.get('dataTermino') && values.get('dataTermino') < values.get('dataInicio')) { alert('A data de término deve ser igual ou posterior à data de início.'); submitButton.disabled = false; submitButton.innerHTML = 'Criar retiro <span>→</span>'; return; }
      const serviceDays = retreatDaysFromDates(values.get('dataInicio'), values.get('dataTermino'));
      const sortedSectors = sortSectors(selectedSectors);
      const retreat = { id: createId(), nome: values.get('nome').trim(), dataInicio: values.get('dataInicio'), dataTermino: values.get('dataTermino'), local: values.get('local').trim(), valorInscricaoCursista: parseCurrency(values.get('valorInscricaoCursista')), valorInscricaoVoluntario: parseCurrency(values.get('valorInscricaoVoluntario')), valorFoto: parseCurrency(values.get('valorFoto')), valorCamisetaOficial: parseCurrency(values.get('valorCamisetaOficial')), idadeMaximaEspacoKids: Number(values.get('idadeMaximaEspacoKids')) || 0, setores: sortedSectors, setoresPublicos: sortedSectors, dias: serviceDays.length ? serviceDays : [...retreatDefaults.dias], contribuicoes: [...retreatDefaults.contribuicoes], linksSetores: syncSectorLinks({}, knownSectors(sortedSectors)), status: 'preparacao', createdAt: new Date().toISOString() };
      await dataService.saveRetiro(retreat);
      if (sourceRetreatId) await copyBadgeProfilesToRetreat(sourceRetreatId, retreat.id);
      await loadData();
      location.hash = `#retiros/${retreat.id}`;
    } catch (error) {
      console.error(error);
      const message = document.createElement('p');
      message.className = 'form-message';
      message.textContent = `Nao foi possivel salvar o retiro. ${error.message || 'Atualize a pagina e tente novamente.'}`;
      form.querySelector('.form-actions').before(message);
      submitButton.disabled = false;
      submitButton.innerHTML = 'Criar retiro <span>→</span>';
    }
  });
}

async function renderRetreat(id) {
  const retreat = retreats.find((item) => item.id === id);
  if (!retreat) return renderRetiros();
  setSelectedRetreatId(retreat.id);
  const canDeleteRetreat = canAccess('retiros.excluir');
  const [allStudents, allCommunities] = await Promise.all([dataService.listCursistas(), dataService.listComunidades()]);
  const registeredStudents = uniqueByParticipant(allStudents.filter((student) => student.retiroId === id));
  const retreatCommunityDetails = studentCommunityDetails(allCommunities.filter((community) => community.retiroId === id));
  const retreatEntries = enrolments.filter((item) => item.retiroId === id);
  const retreatEnrolments = mergeEnrolmentsByParticipant(enrolments.filter((item) => item.retiroId === id));
  const retreatStatEntries = retreatEntries.length ? retreatEntries : retreatEnrolments;
  const storedSectorLinks = retreat.linksSetores || retreat.setorLinks || [];
  const sectorLinks = canAccess('retiros.editar') && canModifyRetreat(retreat)
    ? await ensureSectorLinks(retreat)
    : syncSectorLinks({ linksSetores: storedSectorLinks }, knownSectors(retreat.setores || [])).filter((link) => storedSectorLinks.some((stored) => stored.token === link.token));
  const activeSectorKeys = new Set((retreat.setores || []).map(normalizeText));
  const activeSectorLinks = sectorLinks.filter((link) => activeSectorKeys.has(normalizeText(link.setor)));
  const serviceDays = retreatServiceDays(retreat);
  const participantPeople = retreatEnrolments.map((entry) => people.find((person) => person.id === entry.pessoaId)).filter(Boolean);
  const ages = [...participantPeople, ...registeredStudents].map((person) => ageFromBirth(person.nascimento)).filter((age) => age !== null);
  const averageAge = ages.length ? `${(ages.reduce((sum, age) => sum + age, 0) / ages.length).toFixed(1).replace('.', ',')} anos` : 'Sem dados';
  const dayCount = (day) => retreatStatEntries.filter((entry) => entryDays(entry).some((item) => normalizeText(item) === normalizeText(day))).length + registeredStudents.length;
  const shirtCounts = registeredStudents.reduce((counts, student) => { const size = String(student.camiseta || '').trim(); if (size) counts[size] = (counts[size] || 0) + 1; return counts; }, {});
  const shirtOrder = ['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'];
  const shirtRows = Object.entries(shirtCounts).sort(([first], [second]) => { const firstIndex = shirtOrder.indexOf(first); const secondIndex = shirtOrder.indexOf(second); if (firstIndex !== -1 || secondIndex !== -1) return (firstIndex === -1 ? 99 : firstIndex) - (secondIndex === -1 ? 99 : secondIndex); return first.localeCompare(second, 'pt-BR', { numeric: true, sensitivity: 'base' }); });
  const activeEntries = retreatEntries;
  const pendingValidationGroups = enrolmentValidationGroups(activeEntries).filter((group) => !isEnrolmentGroupValidated(group));
  const sectorCounts = sortSectors(uniqueSectors([...(retreat.setores || []), ...retreatStatEntries.flatMap(entrySectors)]))
    .map((sector) => [sector, retreatStatEntries.filter((entry) => entryHasSector(entry, sector)).length])
    .filter(([sector, count]) => count > 0 || retreat.setores?.includes(sector));
  const intoleranceStudents = registeredStudents
    .filter((student) => normalizeText(student.intoleranciaAlimentos) === 'sim' || String(student.qualIntolerancia || '').trim())
    .sort((first, second) => {
      const firstCommunity = studentCommunityDetail(first, retreatCommunityDetails);
      const secondCommunity = studentCommunityDetail(second, retreatCommunityDetails);
      if (firstCommunity.order !== secondCommunity.order) return firstCommunity.order - secondCommunity.order;
      const communityResult = firstCommunity.name.localeCompare(secondCommunity.name, 'pt-BR', { sensitivity: 'base' });
      if (communityResult) return communityResult;
      return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
  const allergyStudents = registeredStudents
    .filter((student) => normalizeText(student.alergiaMedicamento) === 'sim' || String(student.qualAlergia || '').trim())
    .sort((first, second) => {
      const firstCommunity = studentCommunityDetail(first, retreatCommunityDetails);
      const secondCommunity = studentCommunityDetail(second, retreatCommunityDetails);
      if (firstCommunity.order !== secondCommunity.order) return firstCommunity.order - secondCommunity.order;
      const communityResult = firstCommunity.name.localeCompare(secondCommunity.name, 'pt-BR', { sensitivity: 'base' });
      if (communityResult) return communityResult;
      return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
  const groupedPreferenceRows = (entries, field) => {
    const usedCouples = new Set();
    return entries.reduce((rows, entry) => {
      if (entry.casalId) {
        if (usedCouples.has(entry.casalId)) return rows;
        const couple = entries.filter((item) => item.casalId === entry.casalId);
        usedCouples.add(entry.casalId);
        if (!couple.some((item) => normalizeText(item[field]) === 'sim')) return rows;
        rows.push({ name: couple.map((item) => item.nome).filter(Boolean).join(' e '), detail: uniqueSectors(couple.flatMap((item) => item.setores || [])).join(', ') || 'Setor não informado' });
        return rows;
      }
      if (normalizeText(entry[field]) !== 'sim') return rows;
      rows.push({ name: entry.nome || 'Sem nome', detail: entry.setores?.join(', ') || 'Ficha individual' });
      return rows;
    }, []).sort((first, second) => {
      if (field === 'quadrante' || field === 'foto') {
        const sectorResult = first.detail.localeCompare(second.detail, 'pt-BR', { sensitivity: 'base' });
        if (sectorResult) return sectorResult;
      }
      return first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' });
    });
  };
  const quadranteRows = groupedPreferenceRows(retreatEnrolments, 'quadrante');
  const photoRows = groupedPreferenceRows(retreatEnrolments, 'foto');
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const spaceKidsRows = retreatEnrolments.flatMap((entry) => {
    const responsible = peopleById.get(entry.pessoaId) || entry.dadosPessoais || {};
    return (entry.espacoKids || []).map((kid) => ({
      ...kid,
      volunteer: entry.nome || responsible.nome || 'Não informado',
      contact: responsible.telefone || entry.dadosPessoais?.telefone || '',
    }));
  }).sort((first, second) => {
    const firstBirth = Date.parse(`${first.nascimento || ''}T12:00:00`);
    const secondBirth = Date.parse(`${second.nascimento || ''}T12:00:00`);
    if (Number.isFinite(firstBirth) && Number.isFinite(secondBirth) && firstBirth !== secondBirth) return secondBirth - firstBirth;
    if (Number.isFinite(firstBirth) !== Number.isFinite(secondBirth)) return Number.isFinite(firstBirth) ? -1 : 1;
    return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
  });
  const cityStats = new Map();
  const addCityCount = (city, type) => {
    const label = String(city || '').trim();
    if (!label) return;
    const key = normalizeText(label);
    const row = cityStats.get(key) || { city: label, students: 0, team: 0 };
    row[type] += 1;
    cityStats.set(key, row);
  };
  registeredStudents.forEach((student) => addCityCount(student.cidade, 'students'));
  retreatEnrolments.forEach((entry) => {
    const responsible = peopleById.get(entry.pessoaId) || entry.dadosPessoais || {};
    addCityCount(responsible.cidade || entry.dadosPessoais?.cidade || entry.cidade, 'team');
  });
  const cityRows = [...cityStats.values()].sort((first, second) => first.city.localeCompare(second.city, 'pt-BR', { sensitivity: 'base' }));
  const sectorStatRows = sectorCounts.map(([sector, count]) => ({
    sector,
    count,
    days: serviceDays,
    volunteers: retreatStatEntries.filter((entry) => entryHasSector(entry, sector)).sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' })),
  }));
  const sectorRows = sectorStatRows.length ? sectorStatRows.map(({ sector, count }) => `<button type="button" data-stat-sector="${escapeHtml(sector)}"><span>${escapeHtml(sector)}</span><strong>${count}</strong></button>`).join('') : '<p class="empty-state">Nenhum setor com equipe inscrita.</p>';
  const dayRows = serviceDays.length ? serviceDays.map((day) => `<div><span>${escapeHtml(day)}</span><strong>${dayCount(day)}</strong><small>pessoa(s)</small></div>`).join('') : '<p class="empty-state">Nenhum dia configurado.</p>';
  const shirtGrid = shirtRows.length ? shirtRows.map(([size, count]) => `<div><span>${escapeHtml(size)}</span><strong>${count}</strong><small>camiseta(s)</small></div>`).join('') : '<p class="empty-state">Nenhum tamanho informado.</p>';
  const healthRows = (students, field, fallback, options = {}) => students.length ? `<div class="student-health-list">${students.map((student) => {
    const community = options.showCommunity ? studentCommunityDetail(student, options.communityDetails) : null;
    return `<div><div class="student-health-person"><strong>${escapeHtml(student.nome || 'Sem nome')}</strong>${community ? `<small>Comunidade: ${escapeHtml(community.name)}</small>` : ''}</div><span>${escapeHtml(String(student[field] || '').trim() || fallback)}</span></div>`;
  }).join('')}</div>` : '<p class="empty-state">Nenhum cursista informado.</p>';
  const preferenceRows = (rows, fallback) => rows.length ? `<div class="student-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.detail)}</span></div>`).join('')}</div>` : `<p class="empty-state">${fallback}</p>`;
  const kidsRows = (rows) => rows.length ? `<div class="student-health-list kids-health-list">${rows.map((kid) => `<div><strong>${escapeHtml(kid.nome || 'Sem nome')}<span class="student-health-inline">${escapeHtml(ageInYearsAndMonths(kid.nascimento))}</span></strong><small>Cadastrada por: ${escapeHtml(kid.volunteer || 'Não informado')}${kid.contact ? ` · Contato: ${escapeHtml(kid.contact)}` : ' · Contato não informado'}</small></div>`).join('')}</div>` : '<p class="empty-state">Nenhuma criança cadastrada no Espaço Kids.</p>';
  const cityRowsHtml = (rows) => {
    if (!rows.length) return '<p class="empty-state">Nenhuma cidade informada nos cadastros deste retiro.</p>';
    const totals = rows.reduce((sum, row) => ({ students: sum.students + row.students, team: sum.team + row.team }), { students: 0, team: 0 });
    return `<div class="student-health-list city-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.city)}</strong><span><b>${row.students}</b><small>Cursistas</small></span><span><b>${row.team}</b><small>Equipe de trabalho</small></span></div>`).join('')}<div class="city-health-total"><strong>Total geral</strong><span><b>${totals.students}</b><small>Cursistas</small></span><span><b>${totals.team}</b><small>Equipe de trabalho</small></span><span><b>${totals.students + totals.team}</b><small>Participantes</small></span></div></div>`;
  };
  const retreatStatisticsHtml = `<section class="metric-grid dashboard-metrics">
      <article class="metric-card static-metric"><span>Cursistas</span><strong>${registeredStudents.length}</strong><small>pessoa(s)</small></article>
      <article class="metric-card static-metric"><span>Equipe de trabalho</span><strong>${retreatEnrolments.length}</strong><small>pessoa(s)</small></article>
      <article class="metric-card static-metric"><span>Fichas da equipe de trabalho aguardando validação</span><strong>${pendingValidationGroups.length}</strong><small>ficha(s)</small></article>
    </section>
    <section class="student-health-grid" aria-label="Cuidados de saúde dos cursistas">
      <article class="student-health-card"><div><span>Cursistas com Intolerância a alimentos</span><strong>${intoleranceStudents.length}</strong></div><button type="button" data-home-health="intolerance">Visualizar</button></article>
      <article class="student-health-card"><div><span>Cursistas Alérgicos a Medicamentos</span><strong>${allergyStudents.length}</strong></div><button type="button" data-home-health="allergy">Visualizar</button></article>
      <article class="student-health-card"><div><span>Quadrante impresso Equipe de trabalho</span><strong>${quadranteRows.length}</strong></div><button type="button" data-home-health="quadrante">Visualizar</button></article>
      <article class="student-health-card"><div><span>Fotos solicitadas pela equipe de trabalho</span><strong>${photoRows.length}</strong></div><button type="button" data-home-health="photo">Visualizar</button></article>
      <article class="student-health-card"><div><span>Número de crianças no Espaço Kids</span><strong>${spaceKidsRows.length}</strong></div><button type="button" data-home-health="kids">Visualizar</button></article>
      <article class="student-health-card"><div><span>Número de cidades com participantes</span><strong>${cityRows.length}</strong></div><button type="button" data-home-health="cities">Visualizar</button></article>
    </section>
    <section class="dashboard-grid retreat-stats-grid">
      <article class="panel dashboard-panel shirt-stat-panel"><div class="panel-heading"><div><h2>Camisetas dos cursistas</h2><p>Quantidade por tamanho informado na ficha do cursista.</p></div></div><div class="stat-tile-grid shirt-stat-grid">${shirtGrid}</div></article>
      <article class="panel dashboard-panel presence-stat-panel"><div class="panel-heading"><div><h2>Presença por dia</h2><p>Cursistas + equipe de trabalho prevista em cada dia.</p></div></div><div class="stat-tile-grid presence-stat-grid">${dayRows}</div></article>
      <article class="panel dashboard-panel sector-stat-panel"><div class="panel-heading"><div><h2>Pessoas por setor</h2><p>Equipe de trabalho inscrita por setor.</p></div></div><div class="sector-simple-list">${sectorRows}</div></article>
    </section>`;
  const healthContent = {
    intolerance: `<div class="panel-heading"><div><h2>Cursistas com Intolerância a alimentos</h2><p>Comunidade, nome do cursista e alimento informado na ficha.</p></div></div>${healthRows(intoleranceStudents, 'qualIntolerancia', 'Intolerância não detalhada', { showCommunity: true, communityDetails: retreatCommunityDetails })}`,
    allergy: `<div class="panel-heading"><div><h2>Cursistas Alérgicos a Medicamentos</h2><p>Comunidade, nome do cursista e medicamento informado na ficha.</p></div></div>${healthRows(allergyStudents, 'qualAlergia', 'Medicamento não detalhado', { showCommunity: true, communityDetails: retreatCommunityDetails })}`,
    quadrante: `<div class="panel-heading"><div><h2>Quadrante impresso Equipe de trabalho</h2><p>Inscrições da equipe que responderam Sim. Casais aparecem juntos e contam como uma ficha.</p></div></div>${preferenceRows(quadranteRows, 'Nenhuma inscrição solicitou quadrante impresso.')}`,
    photo: `<div class="panel-heading"><div><h2>Fotos solicitadas pela equipe de trabalho</h2><p>Inscrições da equipe que pediram foto. Casais aparecem juntos e contam como uma foto.</p></div></div>${preferenceRows(photoRows, 'Nenhuma inscrição solicitou foto.')}`,
    kids: `<div class="panel-heading"><div><h2>Número de crianças no Espaço Kids</h2><p>Nome da criança, idade e responsável pelo cadastro.</p></div></div>${kidsRows(spaceKidsRows)}`,
    cities: `<div class="panel-heading"><div><h2>Número de cidades com participantes</h2><p>Quantidade de pessoas por cidade, separando cursistas e equipe de trabalho.</p></div></div>${cityRowsHtml(cityRows)}`,
  };
  const sortedParticipants = [...retreatEnrolments].sort((first, second) => {
    const value = participantSort.key === 'setor' ? first.setores.join(', ') : first.nome;
    const otherValue = participantSort.key === 'setor' ? second.setores.join(', ') : second.nome;
    const result = String(value).localeCompare(String(otherValue), 'pt-BR', { sensitivity: 'base' });
    return participantSort.direction === 'asc' ? result : -result;
  });
  const sortIndicator = (key) => participantSort.key === key ? (participantSort.direction === 'asc' ? '↑' : '↓') : '↕';
  const concluded = isRetreatConcluded(retreat);
  const retreatActions = concluded
    ? '<span class="status concluido">Somente consulta</span>'
    : `<a class="secondary-button" href="#retiros/${retreat.id}/editar">Editar configuração</a><button class="primary-button" id="publish-retreat">${retreat.status === 'publicado' ? 'Retiro publicado' : 'Publicar retiro'}</button><button class="secondary-button" id="conclude-retreat" type="button">Encerrar retiro</button>`;
  layout(`<section class="page-heading compact"><div><a class="back-link" href="#retiros">← Retiros</a><p class="eyebrow">${statusLabel(retreat.status)}</p><h1>${escapeHtml(retreat.nome)}</h1><p>${dateRange(retreat.dataInicio, retreat.dataTermino)}${retreat.local ? ` · ${escapeHtml(retreat.local)}` : ''}</p>${concluded ? '<p class="hint">Retiro concluído: alterações bloqueadas. Consultas, relatórios e impressões continuam disponíveis.</p>' : ''}</div><div class="detail-actions">${retreatActions}</div></section>
    ${retreatStatisticsHtml}
    <section class="detail-grid"></section>
    `, 'retiros');
  setupHomeStatTabs({ shirtStudents: registeredStudents, communityDetails: retreatCommunityDetails });
  app.querySelectorAll('[data-home-health]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.homeHealth;
      openHomeInfoWindow(button.closest('.student-health-card')?.querySelector('span')?.textContent || 'Cursistas', healthContent[key] || '');
    });
  });
  wireSectorStatWindows(sectorStatRows);
  if (canDeleteRetreat && !concluded) {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-retreat';
    deleteButton.id = 'delete-retreat';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Excluir retiro';
    app.querySelector('.detail-actions')?.append(deleteButton);
  }
  if (activeSectorLinks.length) {
    const sectorLinksPanel = document.createElement('article');
    sectorLinksPanel.className = 'panel sector-links-panel';
    sectorLinksPanel.innerHTML = `<h2>Links por setor</h2><p class="hint">Compartilhe somente os links dos setores ativos neste retiro. O link de cadastro abre a ficha limitada ao setor; o link de acompanhamento mostra ao líder a relação de voluntários, os dias de trabalho e o somatório por dia.</p><label class="field sector-link-search"><span>Buscar setor ativo</span><input id="sector-link-search" autocomplete="off" list="sector-link-options" placeholder="Digite o nome do setor"></label><datalist id="sector-link-options">${activeSectorLinks.map((link) => `<option value="${escapeHtml(link.setor)}"></option>`).join('')}</datalist><div class="sector-link-feedback" id="sector-link-feedback">Digite para localizar um setor ativo.</div><div class="sector-link-list" id="sector-link-list">${activeSectorLinks.map((link) => {
      const registrationUrl = `${location.origin}/convite-setor/${encodeURIComponent(link.cadastroToken || link.token)}`;
      const followupUrl = `${location.origin}/setor/${encodeURIComponent(link.acompanhamentoToken || link.token)}`;
      return `<div class="sector-link-row" data-sector-link-row="${escapeHtml(link.setor)}" hidden><strong>${escapeHtml(link.setor)}</strong><div class="sector-link-actions"><label class="copy-field"><span>Cadastro</span><input readonly value="${escapeHtml(registrationUrl)}"><button type="button" data-copy-sector-link="${escapeHtml(registrationUrl)}">Copiar</button></label><label class="copy-field"><span>Acompanhamento do líder</span><input readonly value="${escapeHtml(followupUrl)}"><button type="button" data-copy-sector-link="${escapeHtml(followupUrl)}">Copiar</button></label></div></div>`;
    }).join('')}</div>`;
    app.querySelector('.detail-grid')?.append(sectorLinksPanel);
  }
  if (!canAccess('retiros.editar')) app.querySelector(`a[href="#retiros/${retreat.id}/editar"]`)?.remove();
  if (!canAccess('retiros.publicar')) {
    app.querySelector('#publish-retreat')?.remove();
    app.querySelector('#conclude-retreat')?.remove();
  }
  app.querySelector('#publish-retreat')?.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'publicar este retiro')) return;
    if (retreat.status !== 'publicado') { retreat.status = 'publicado'; await dataService.saveRetiro(retreat); await loadData(); renderRetreat(id); }
  });
  app.querySelector('#conclude-retreat')?.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'encerrar este retiro')) return;
    const first = confirm(`Encerrar o retiro "${retreat.nome}"?\n\nDepois de concluido, este retiro ficara disponivel apenas para consultas, relatorios e impressoes.`);
    if (!first) return;
    const second = confirm('Confirme novamente: apos encerrar, nao sera mais possivel fazer ajustes neste retiro, incluindo configuracoes, fichas, cursistas, comunidades, crachas, financeiro e validacoes.');
    if (!second) return;
    retreat.status = 'concluido';
    retreat.concluidoEm = retreat.concluidoEm || new Date().toISOString();
    retreat.updatedAt = new Date().toISOString();
    await dataService.saveRetiro(retreat);
    await loadData();
    renderRetreat(id);
  });
  app.querySelector('#delete-retreat')?.addEventListener('click', async () => {
    const totalEnrolments = enrolments.filter((entry) => entry.retiroId === id).length;
    if (!confirm(`Excluir o retiro "${retreat.nome}"?\n\nEsta acao remove a estrutura deste retiro e ${totalEnrolments} adesao(oes). Os cadastros dos voluntarios serao preservados.`)) return;
    const button = app.querySelector('#delete-retreat');
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      const [allCommunities, allBadges] = await Promise.all([dataService.listComunidades(), dataService.listCrachas()]);
      await Promise.all([
        ...enrolments.filter((entry) => entry.retiroId === id).map((entry) => dataService.deleteAdesao(entry.id)),
        ...allCommunities.filter((community) => community.retiroId === id).map((community) => dataService.deleteComunidade(community.id)),
        ...allBadges.filter((badge) => badge.retiroId === id).map((badge) => dataService.deleteCracha(badge.id)),
      ]);
      await dataService.deleteRetiro(id);
      await loadData();
      location.hash = '#retiros';
    } catch (error) {
      alert(`Nao foi possivel excluir o retiro. ${error.message || 'Atualize a pagina e tente novamente.'}`);
      button.disabled = false;
      button.textContent = 'Excluir retiro';
    }
  });
  app.querySelectorAll('[data-copy-sector-link]').forEach((button) => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.copySectorLink);
    button.textContent = 'Copiado!';
  }));
  const sectorLinkSearch = app.querySelector('#sector-link-search');
  if (sectorLinkSearch) {
    const rows = [...app.querySelectorAll('[data-sector-link-row]')];
    const feedback = app.querySelector('#sector-link-feedback');
    const filterSectorLinks = () => {
      const query = normalizeText(sectorLinkSearch.value);
      let visible = 0;
      rows.forEach((row) => {
        const matches = query && normalizeText(row.dataset.sectorLinkRow).includes(query);
        row.hidden = !matches;
        if (matches) visible += 1;
      });
      feedback.textContent = query ? (visible ? `${visible} setor(es) ativo(s) encontrado(s).` : 'Nenhum setor ativo encontrado.') : 'Digite para localizar um setor ativo.';
    };
    sectorLinkSearch.addEventListener('input', filterSectorLinks);
    filterSectorLinks();
  }
}

async function renderEditRetreat(id) {
  const retreat = retreats.find((item) => item.id === id);
  if (!retreat) return renderRetiros();
  setSelectedRetreatId(retreat.id);
  if (isRetreatConcluded(retreat)) {
    alert('Este retiro esta concluido. A configuracao esta disponivel apenas para consulta.');
    return renderRetreat(retreat.id);
  }
  layout(`<section class="page-heading compact"><div><p class="eyebrow">Configuração do evento</p><h1>Editar retiro</h1><p>Estas alterações afetam somente este retiro, nunca o histórico dos anteriores.</p></div><a class="text-link" href="#retiros/${retreat.id}">← Voltar</a></section>
  <form id="edit-retreat-form" class="panel editor-form"><div class="fields two-columns"><label class="field full"><span>Nome do retiro <b>*</b></span><input name="nome" required value="${escapeHtml(retreat.nome)}"></label><label class="field"><span>Data de início</span><input name="dataInicio" type="date" value="${escapeHtml(retreat.dataInicio || '')}"></label><label class="field"><span>Data de término</span><input name="dataTermino" type="date" value="${escapeHtml(retreat.dataTermino || '')}"></label><label class="field"><span>Local</span><input name="local" value="${escapeHtml(retreat.local || '')}"></label><div class="fields three-columns retreat-value-fields full"><label class="field"><span>Inscrição do cursista</span><input name="valorInscricaoCursista" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorInscricaoCursista)}"></label><label class="field"><span>Inscrição do voluntário</span><input name="valorInscricaoVoluntario" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorInscricaoVoluntario)}"></label><label class="field"><span>Valor da foto</span><input name="valorFoto" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorFoto ?? 10)}"></label><label class="field"><span>Idade máxima para ficar no Espaço Kids</span><input name="idadeMaximaEspacoKids" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(retreat.idadeMaximaEspacoKids || '')}" placeholder="Ex.: 10"></label></div></div>
  <fieldset><legend>Setores de trabalho</legend><p class="hint">Selecione os setores que ter&atilde;o link de inscri&ccedil;&atilde;o por setor neste retiro.</p>${sectorGroups(knownSectors(retreat.setores), configuredSectors(retreat.setores), configuredSectors(retreat.setoresPublicos ?? retreat.setores))}</fieldset><div class="form-actions"><p>As alterações são salvas neste retiro.</p><button type="submit">Salvar alterações <span>→</span></button></div></form>`, 'retiros');
  const form = app.querySelector('#edit-retreat-form');
  ensureOfficialShirtValueField(form, currency(retreat.valorCamisetaOficial));
  wireCurrencyInputs(form);
  wirePublicSectorToggles(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const selectedSectors = values.getAll('setores');
    const selectedSectorKeys = new Set(selectedSectors.map(normalizeText));
    const removedSectors = (retreat.setores || []).filter((sector) => !selectedSectorKeys.has(normalizeText(sector)));
    const blockedRemovals = removedSectors.map((sector) => ({
      sector,
      volunteers: enrolments.filter((entry) => entry.retiroId === retreat.id && entryHasSector(entry, sector)).map((entry) => entry.nome).filter(Boolean),
    })).filter((item) => item.volunteers.length);
    if (blockedRemovals.length) {
      blockedRemovals.forEach(({ sector }) => {
        const sectorKey = normalizeText(sector);
        const sectorInput = [...form.querySelectorAll('input[name="setores"]')].find((input) => normalizeText(input.value) === sectorKey);
        if (sectorInput) {
          sectorInput.checked = true;
          sectorInput.closest('.sector-option')?.classList.add('field-warning');
        }
      });
      alert(`Setor já tem voluntário(s) cadastrados\n\n${blockedRemovals.map(({ sector, volunteers }) => `${sector}:\n${volunteers.map((name) => `- ${name}`).join('\n')}`).join('\n\n')}`);
      return;
    }
    if (!selectedSectors.length) { alert('Selecione ao menos um setor de trabalho.'); return; }
    if (values.get('dataInicio') && values.get('dataTermino') && values.get('dataTermino') < values.get('dataInicio')) { alert('A data de término deve ser igual ou posterior à data de início.'); return; }
    const serviceDays = values.get('dataInicio') && values.get('dataTermino') ? retreatDaysFromDates(values.get('dataInicio'), values.get('dataTermino')) : [];
    delete retreat.descontoParentesco;
    const sortedSectors = sortSectors(selectedSectors);
    Object.assign(retreat, { nome: values.get('nome').trim(), dataInicio: values.get('dataInicio'), dataTermino: values.get('dataTermino'), local: String(values.get('local') || '').trim(), valorInscricaoCursista: parseCurrency(values.get('valorInscricaoCursista')), valorInscricaoVoluntario: parseCurrency(values.get('valorInscricaoVoluntario')), valorFoto: parseCurrency(values.get('valorFoto')), valorCamisetaOficial: parseCurrency(values.get('valorCamisetaOficial')), idadeMaximaEspacoKids: Number(values.get('idadeMaximaEspacoKids')) || 0, setores: sortedSectors, setoresPublicos: sortedSectors, dias: serviceDays.length ? serviceDays : (retreat.dias?.length ? retreat.dias : [...retreatDefaults.dias]), linksSetores: syncSectorLinks(retreat, knownSectors(sortedSectors)), updatedAt: new Date().toISOString() });
    const renames = [...(form._sectorRenames || new Map()).entries()].filter(([from, to]) => from !== to);
    for (const [from, to] of renames) {
      const affected = enrolments.filter((entry) => entry.retiroId === retreat.id && entryHasSector(entry, from));
      for (const entry of affected) {
        entry.setores = (entry.setores || []).map((sector) => normalizeText(sector) === normalizeText(from) ? to : sector);
        await dataService.saveAdesao(entry);
      }
    }
    await dataService.saveRetiro(retreat);
    await loadData();
    location.hash = `#retiros/${retreat.id}`;
  });
}

function suggestedAmount(value) { const match = String(value || '').replace('.', '').match(/(\d+(?:,\d{1,2})?)/); return match ? Number(match[1].replace(',', '.')) : 0; }
function currency(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0); }
function parseCurrency(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value || '').replace(/[^\d,.-]/g, '');
  if (!raw) return 0;
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  if (hasComma) return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
  if (hasDot) {
    const parts = raw.split('.');
    const decimalLike = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2;
    return Number(decimalLike ? raw : raw.replace(/\./g, '')) || 0;
  }
  return Number(raw) || 0;
}
const paymentMethods = ['Cartão de crédito', 'Cartão de débito', 'Pix', 'Dinheiro', 'Acerto'];
const studentPaymentMethods = paymentMethods.filter((method) => method !== 'Acerto');
const paymentMethodsWithObservation = new Set(['Pix', 'Acerto']);
const paymentObservationPlaceholder = (method) => method === 'Pix' ? 'Digite o nome completo de quem está enviando o Pix' : 'Informe a observação do pagamento';
function askPaymentMethod({ nome = 'Pagamento', total = 0, currentMethod = '', currentObservation = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    let settled = false;
    overlay.innerHTML = `<div class="receiver-sector-dialog receiver-payment-dialog"><div class="panel-heading"><div><p class="eyebrow">Confirmar pagamento</p><h2>Forma de pagamento</h2><p>${escapeHtml(nome)} · ${currency(total)}</p></div></div><div class="payment-method-options">${paymentMethods.map((method) => `<button type="button" class="choice${currentMethod === method ? ' is-selected' : ''}" data-payment-method="${escapeHtml(method)}"><span>${escapeHtml(method)}</span></button>`).join('')}</div><label class="field receiver-payment-observation" ${paymentMethodsWithObservation.has(currentMethod) ? '' : 'hidden'}><span>Observação</span><textarea id="receiver-payment-observation" rows="3" placeholder="${escapeHtml(paymentObservationPlaceholder(currentMethod))}">${escapeHtml(currentObservation)}</textarea></label><p class="form-message" data-payment-method-message></p><div class="form-actions"><button type="button" class="close-sector-view">Fechar</button><button type="button" id="confirm-receiver-payment" class="is-couple-continue" ${currentMethod ? '' : 'disabled'}>Confirmar</button></div></div>`;
    const observationField = overlay.querySelector('.receiver-payment-observation');
    const observationInput = overlay.querySelector('#receiver-payment-observation');
    const message = overlay.querySelector('[data-payment-method-message]');
    let selectedPaymentMethod = currentMethod;
    const toggleObservation = () => {
      observationField.hidden = !paymentMethodsWithObservation.has(selectedPaymentMethod);
      observationInput.placeholder = paymentObservationPlaceholder(selectedPaymentMethod);
      if (observationField.hidden) observationInput.value = '';
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(result);
    };
    const confirmSelection = () => {
      const observation = observationInput.value.trim();
      if (!selectedPaymentMethod) {
        message.textContent = 'Selecione uma forma de pagamento para confirmar.';
        return;
      }
      if (paymentMethodsWithObservation.has(selectedPaymentMethod) && !observation) {
        message.textContent = 'Informe a observação do pagamento para confirmar.';
        observationInput.focus();
        return;
      }
      finish({ method: selectedPaymentMethod, observation });
    };
    const selectPaymentMethod = (method) => {
      selectedPaymentMethod = method;
      overlay.querySelectorAll('[data-payment-method]').forEach((button) => button.classList.toggle('is-selected', button.dataset.paymentMethod === method));
      overlay.querySelector('#confirm-receiver-payment').disabled = false;
      message.textContent = '';
      toggleObservation();
      if (paymentMethodsWithObservation.has(method)) {
        observationInput.focus();
        return;
      }
      finish({ method, observation: '' });
    };
    const close = () => finish(null);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelector('.close-sector-view').addEventListener('click', close);
    overlay.querySelector('.payment-method-options').addEventListener('click', (event) => {
      const button = event.target.closest('[data-payment-method]');
      if (button) selectPaymentMethod(button.dataset.paymentMethod || '');
    });
    toggleObservation();
    overlay.querySelector('#confirm-receiver-payment').addEventListener('click', confirmSelection);
    app.append(overlay);
  });
}
function renderStudentPaymentComment(form) {
  const comment = form?.querySelector('.student-payment-comment');
  if (!comment) return;
  const paidAmount = parseCurrency(form.elements.valorPago?.value);
  const method = form.elements.formaPagamento?.value || '';
  const observation = form.elements.observacaoPagamento?.value || '';
  if (paidAmount > 0 && method) {
    comment.textContent = observation ? `Forma de pagamento: ${method}. Observação: ${observation}` : `Forma de pagamento: ${method}`;
    comment.hidden = false;
    return;
  }
  comment.textContent = '';
  comment.hidden = true;
}
function askStudentPayment({ nome = 'Cursista', paidAmount = 0, currentMethod = '', currentObservation = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    let settled = false;
    let selectedPaymentMethod = currentMethod;
    overlay.innerHTML = `<div class="receiver-sector-dialog receiver-payment-dialog"><div class="panel-heading"><div><p class="eyebrow">Confirmar pagamento</p><h2>Pagamento do cursista</h2><p>${escapeHtml(nome)}</p></div></div><label class="field"><span>Valor pago</span><input id="student-payment-amount" type="text" inputmode="decimal" value="${paidAmount > 0 ? currency(paidAmount) : ''}" placeholder="R$ 0,00"></label><div class="payment-method-options">${studentPaymentMethods.map((method) => `<button type="button" class="choice${currentMethod === method ? ' is-selected' : ''}" data-payment-method="${escapeHtml(method)}"><span>${escapeHtml(method)}</span></button>`).join('')}</div><label class="field receiver-payment-observation" ${paymentMethodsWithObservation.has(currentMethod) ? '' : 'hidden'}><span>Observação</span><textarea id="receiver-payment-observation" rows="3" placeholder="${escapeHtml(paymentObservationPlaceholder(currentMethod))}">${escapeHtml(currentObservation)}</textarea></label><p class="form-message" data-payment-method-message></p><div class="form-actions"><button type="button" class="close-sector-view">Fechar</button><button type="button" id="confirm-receiver-payment" class="is-couple-continue" ${currentMethod ? '' : 'disabled'}>Confirmar</button></div></div>`;
    const amountInput = overlay.querySelector('#student-payment-amount');
    const observationField = overlay.querySelector('.receiver-payment-observation');
    const observationInput = overlay.querySelector('#receiver-payment-observation');
    const message = overlay.querySelector('[data-payment-method-message]');
    const confirmButton = overlay.querySelector('#confirm-receiver-payment');
    const finish = (result) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(result);
    };
    const toggleObservation = () => {
      observationField.hidden = !paymentMethodsWithObservation.has(selectedPaymentMethod);
      observationInput.placeholder = paymentObservationPlaceholder(selectedPaymentMethod);
      if (observationField.hidden) observationInput.value = '';
    };
    const confirmSelection = () => {
      const amount = parseCurrency(amountInput.value);
      const observation = observationInput.value.trim();
      if (amount <= 0) {
        message.textContent = 'Informe o valor pago para confirmar.';
        amountInput.focus();
        return;
      }
      if (!selectedPaymentMethod) {
        message.textContent = 'Selecione uma forma de pagamento para confirmar.';
        return;
      }
      if (paymentMethodsWithObservation.has(selectedPaymentMethod) && !observation) {
        message.textContent = 'Informe a observação do pagamento para confirmar.';
        observationInput.focus();
        return;
      }
      finish({ amount, method: selectedPaymentMethod, observation });
    };
    const selectPaymentMethod = (method) => {
      selectedPaymentMethod = method;
      overlay.querySelectorAll('[data-payment-method]').forEach((button) => button.classList.toggle('is-selected', button.dataset.paymentMethod === method));
      confirmButton.disabled = false;
      message.textContent = '';
      toggleObservation();
      if (paymentMethodsWithObservation.has(method)) {
        observationInput.focus();
        return;
      }
      confirmSelection();
    };
    amountInput.addEventListener('focus', () => { amountInput.value = parseCurrency(amountInput.value) || ''; });
    amountInput.addEventListener('input', () => { message.textContent = ''; });
    amountInput.addEventListener('change', () => { amountInput.value = currency(parseCurrency(amountInput.value)); });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
    overlay.querySelector('.close-sector-view').addEventListener('click', () => finish(null));
    overlay.querySelector('.payment-method-options').addEventListener('click', (event) => {
      const button = event.target.closest('[data-payment-method]');
      if (button) selectPaymentMethod(button.dataset.paymentMethod || '');
    });
    confirmButton.addEventListener('click', confirmSelection);
    toggleObservation();
    app.append(overlay);
    amountInput.focus();
  });
}
function volunteerContributionAmount(retreat = {}, entry = {}) {
  const baseAmount = Number(retreat.valorInscricaoVoluntario) || 0;
  const photoAmount = normalizeText(entry.foto) === 'sim' ? Number(retreat.valorFoto ?? 10) || 0 : 0;
  if (entry.casalId) return (baseAmount * 2) + photoAmount;
  return baseAmount + photoAmount;
}
function ensureOfficialShirtValueField(form, value = '') {
  if (!form || form.elements.valorCamisetaOficial) return;
  const ageField = form.elements.idadeMaximaEspacoKids?.closest('.field');
  if (!ageField) return;
  ageField.insertAdjacentHTML('beforebegin', `<label class="field"><span>Valor da camiseta oficial do retiro</span><input name="valorCamisetaOficial" type="text" inputmode="decimal" data-currency-input value="${escapeHtml(value)}" placeholder="R$ 0,00"></label>`);
}
function wireCurrencyInputs(root) {
  root.querySelectorAll('[data-currency-input]').forEach((input) => {
    const formatValue = () => { input.value = currency(parseCurrency(input.value)); };
    input.addEventListener('focus', formatValue);
    input.addEventListener('change', formatValue);
  });
}
async function renderRecebedor() {
  const retreat = publicReceiverRetreatId
    ? retreats.find((item) => item.id === publicReceiverRetreatId)
    : selectedRetreat();
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Financeiro do retiro</p><h1>Módulo Recebedor</h1><p>Publique ou crie um retiro para acompanhar as contribuições.</p></div></section>', 'recebedor'); return; }
  const canEditReceiver = canAccess('recebedor.editar') && canModifyRetreat(retreat);
  const students = uniqueByParticipant((await dataService.listCursistas()).filter((student) => student.retiroId === retreat.id));
  const entries = [
    ...mergeEnrolmentsByParticipant(enrolments.filter((entry) => entry.retiroId === retreat.id)).map((entry) => ({ ...entry, tipoFinanceiro: 'voluntario' })),
    ...students.map((student) => ({ ...student, setores: ['Cursista'], tipoFinanceiro: 'cursista' })),
  ];
  const effectiveSuggested = (entry) => {
    if (entry.tipoFinanceiro === 'voluntario') return volunteerContributionAmount(retreat, entry);
    const inscription = parseCurrency(entry.valorInscricao) || Number(retreat.valorInscricaoCursista) || suggestedAmount(entry.contribuicao);
    return Math.max(0, inscription - parseCurrency(entry.valorPago));
  };
  const entryAdvanceAmount = (entry) => entry.tipoFinanceiro === 'cursista' ? parseCurrency(entry.valorPago) : 0;
  const entryPaidAmount = (entry) => entry.tipoFinanceiro === 'cursista' ? Math.max(0, parseCurrency(entry.recebedorValorPago) - entryAdvanceAmount(entry)) : parseCurrency(entry.valorPago);
  const entryHasReceiverPayment = (entry) => entryPaidAmount(entry) > 0;
  const entryAdvancePaymentMethod = (entry) => entry.tipoFinanceiro === 'cursista' ? (entry.formaPagamento || (entryAdvanceAmount(entry) > 0 && !entryHasReceiverPayment(entry) ? entry.recebedorFormaPagamento : '') || '') : '';
  const entryAdvancePaymentObservation = (entry) => entry.tipoFinanceiro === 'cursista' ? (entry.observacaoPagamento || (entryAdvanceAmount(entry) > 0 && !entryHasReceiverPayment(entry) ? entry.recebedorObservacao : '') || '') : '';
  const entryPaidStatus = (entry) => {
    if (entry.tipoFinanceiro !== 'cursista') return Boolean(entry.taxaPaga);
    const inscription = parseCurrency(entry.valorInscricao) || Number(retreat.valorInscricaoCursista) || suggestedAmount(entry.contribuicao);
    const advanceBalance = Math.max(0, inscription - entryAdvanceAmount(entry));
    return advanceBalance <= 0 || (inscription <= 0 ? Boolean(entry.recebedorTaxaPaga) : parseCurrency(entry.recebedorValorPago) >= inscription);
  };
  const entryPaymentMethod = (entry) => entry.tipoFinanceiro === 'cursista' ? (entryHasReceiverPayment(entry) ? (entry.recebedorFormaPagamento || '') : '') : (entry.formaPagamento || entry.recebedorFormaPagamento || '');
  const entryPaymentObservation = (entry) => entry.tipoFinanceiro === 'cursista' ? (entryHasReceiverPayment(entry) ? (entry.recebedorObservacao || '') : '') : (entry.recebedorObservacao || '');
  const setEntryPayment = (entry, value, checked, paymentMethod = '', observation) => {
    if (entry.tipoFinanceiro === 'cursista') {
      if (!entry.formaPagamento && entryAdvancePaymentMethod(entry)) entry.formaPagamento = entryAdvancePaymentMethod(entry);
      if (!entry.observacaoPagamento && entryAdvancePaymentObservation(entry)) entry.observacaoPagamento = entryAdvancePaymentObservation(entry);
      entry.recebedorValorPago = entryAdvanceAmount(entry) + value;
      entry.recebedorTaxaPaga = checked;
      entry.recebedorFormaPagamento = checked ? paymentMethod : '';
      if (!checked) entry.recebedorObservacao = '';
      else if (observation !== undefined) entry.recebedorObservacao = observation;
      return;
    }
    entry.valorPago = value;
    entry.taxaPaga = checked;
    entry.formaPagamento = checked ? paymentMethod : '';
    if (!checked) entry.recebedorObservacao = '';
    else if (observation !== undefined) entry.recebedorObservacao = observation;
  };
  const saveFinancialEntry = async (entry) => {
    if (!ensureRetreatCanBeChanged(retreat, 'alterar pagamentos')) return;
    if (entry.tipoFinanceiro === 'cursista') {
      await dataService.saveCursista(entry);
      return;
    }
    await dataService.saveAdesao(entry);
  };
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const entryGender = (entry) => normalizeText(peopleById.get(entry.pessoaId)?.genero || entry.dadosPessoais?.genero || entry.genero);
  const orderedCoupleEntries = (items) => [...items].sort((first, second) => {
    const firstMale = entryGender(first) === 'masculino';
    const secondMale = entryGender(second) === 'masculino';
    if (firstMale !== secondMale) return firstMale ? -1 : 1;
    return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
  });
  const isVolunteerCoupleRow = (row) => row.entries.some((entry) => entry.tipoFinanceiro === 'voluntario' && entry.casalId);
  const isStudentRow = (row) => row.entries.some((entry) => entry.tipoFinanceiro === 'cursista');
  const receiverRows = [];
  const usedCouples = new Set();
  entries.forEach((entry) => {
    if (!entry.casalId || entry.tipoFinanceiro === 'cursista') { receiverRows.push({ id: entry.id, entries: [entry], nome: entry.nome, sortName: entry.nome, setores: entry.setores || [] }); return; }
    if (usedCouples.has(entry.casalId)) return;
    const couple = orderedCoupleEntries(entries.filter((item) => item.tipoFinanceiro === entry.tipoFinanceiro && item.casalId === entry.casalId));
    usedCouples.add(entry.casalId);
    receiverRows.push({ id: `casal-${entry.casalId}`, entries: couple, nome: couple.map((item) => item.nome).filter(Boolean).join(' e '), sortName: couple[0]?.nome || '', setores: uniqueSectors(couple.flatMap((item) => item.setores || [])), isCouple: true });
  });
  const rowSuggested = (row) => {
    const isCoupleRow = isVolunteerCoupleRow(row);
    if (isCoupleRow) {
      return volunteerContributionAmount(retreat, { casalId: row.id, foto: row.entries.some((entry) => normalizeText(entry.foto) === 'sim') ? 'Sim' : 'Não' });
    }
    return row.entries.reduce((sum, entry) => sum + effectiveSuggested(entry), 0);
  };
  const entryOriginalSuggested = (entry) => {
    if (entry.tipoFinanceiro === 'voluntario') return volunteerContributionAmount(retreat, entry);
    return parseCurrency(entry.valorInscricao) || Number(retreat.valorInscricaoCursista) || suggestedAmount(entry.contribuicao);
  };
  const rowOriginalSuggested = (row) => {
    if (isVolunteerCoupleRow(row)) return volunteerContributionAmount(retreat, { casalId: row.id, foto: row.entries.some((entry) => normalizeText(entry.foto) === 'sim') ? 'Sim' : 'Não' });
    return row.entries.reduce((sum, entry) => sum + entryOriginalSuggested(entry), 0);
  };
  const rowPaid = (row) => {
    const values = row.entries.map(entryPaidAmount);
    const sum = values.reduce((total, value) => total + value, 0);
    if (!isVolunteerCoupleRow(row) || values.length < 2) return sum;
    const suggested = rowSuggested(row);
    const max = Math.max(...values);
    const duplicatedCoupleTotal = suggested > 0 && values.filter(Boolean).length > 1 && values.every((value) => !value || Math.abs(value - max) < 0.01) && Math.abs(max - suggested) < 0.01;
    return duplicatedCoupleTotal ? max : sum;
  };
  const rowPaidStatus = (row) => row.entries.every(entryPaidStatus);
  const rowHasPayment = (row) => rowPaid(row) > 0 || row.entries.some((entry) => entryAdvanceAmount(entry) > 0);
  const rowPaymentMethod = (row) => row.entries.map(entryPaymentMethod).find(Boolean) || '';
  const rowPaymentObservation = (row) => row.entries.map(entryPaymentObservation).find(Boolean) || '';
  const rowHasSector = (row, sector) => row.entries.some((entry) => entryHasSector(entry, sector));
  const rowMatchesSectorFilter = (row) => !receiverSectorFilter || rowHasSector(row, receiverSectorFilter);
  const paymentFilterOptions = [
    { id: '', label: 'Mostrar tudo' },
    { id: 'overpaid', label: 'Pago a maior' },
    { id: 'underpaid', label: 'Pago a Menor' },
    { id: 'open', label: 'Em aberto' },
    { id: 'open-or-underpaid', label: 'Em aberto ou a menor' },
  ];
  const rowMatchesPaymentFilter = (row, filter) => {
    if (!filter) return true;
    const paid = rowPaid(row);
    const suggested = rowSuggested(row);
    if (filter === 'overpaid') return paid > suggested;
    if (filter === 'underpaid') return paid > 0 && paid < suggested;
    if (filter === 'open') return suggested > 0 && paid === 0;
    if (filter === 'open-or-underpaid') return suggested > 0 && (paid === 0 || paid < suggested);
    return true;
  };
  const peopleCountForPaymentFilter = (filter) => receiverRows
    .filter(rowMatchesSectorFilter)
    .filter((row) => rowMatchesPaymentFilter(row, filter))
    .reduce((total, row) => total + row.entries.length, 0);
  const rowPaymentState = (row) => {
    const paid = rowPaid(row);
    const suggested = rowSuggested(row);
    if (suggested <= 0) return 'payment-ok';
    if (paid <= 0) return 'payment-open';
    return 'payment-ok';
  };
  const rowAdvanceAmount = (row) => row.entries.reduce((sum, entry) => sum + entryAdvanceAmount(entry), 0);
  const rowAdvancePaymentMethod = (row) => row.entries.map(entryAdvancePaymentMethod).find(Boolean) || '';
  const rowAdvancePaymentObservation = (row) => row.entries.map(entryAdvancePaymentObservation).find(Boolean) || '';
  const receiverPaymentNotes = (row) => {
    const advanceNote = [
      rowAdvanceAmount(row) > 0 ? `Valor antecipado: ${currency(rowAdvanceAmount(row))}` : '',
      rowAdvancePaymentMethod(row),
      rowAdvancePaymentObservation(row),
    ].filter(Boolean).join(' · ');
    const receiverNote = [
      rowPaid(row) > 0 ? `Recebedor: ${currency(rowPaid(row))}` : '',
      rowPaymentMethod(row),
      rowPaymentObservation(row),
    ].filter(Boolean).join(' · ');
    return [advanceNote, receiverNote].filter(Boolean);
  };
  const receiverNameCell = (row) => `<div class="receiver-name-cell"><strong>${escapeHtml(row.nome)}</strong>${receiverPaymentNotes(row).map((note) => `<small>${escapeHtml(note)}</small>`).join('')}</div>`;
  const paymentFilterLabel = paymentFilterOptions.find((option) => option.id === receiverPaymentFilter)?.label || '';
  const values = (row, key) => ({ nome: row.sortName || row.nome, setor: row.setores.join(', '), sugerido: rowSuggested(row), pago: rowPaid(row), taxa: rowPaidStatus(row) ? 1 : 0 })[key];
  const rowHasReceiverContribution = (row) => rowPaid(row) > 0;
  const totalPeopleCount = receiverRows.reduce((total, row) => total + row.entries.length, 0);
  const paidPeopleCount = receiverRows.reduce((total, row) => total + (rowHasReceiverContribution(row) || rowPaidStatus(row) ? row.entries.length : 0), 0);
  const paidCount = receiverRows.filter(rowPaidStatus).length;
  const totalAdvancePaid = receiverRows.reduce((sum, row) => sum + rowAdvanceAmount(row), 0);
  const totalReceiverPaid = receiverRows.reduce((sum, row) => sum + rowPaid(row), 0);
  const totalPaid = totalReceiverPaid;
  const paidSuggested = receiverRows.reduce((sum, row) => sum + (rowHasReceiverContribution(row) || rowPaidStatus(row) ? rowSuggested(row) : 0), 0);
  const balance = totalPaid - paidSuggested;
  const remaining = receiverRows.reduce((sum, row) => sum + (rowPaidStatus(row) ? 0 : rowSuggested(row)), 0);
  const totalsByAdvancePaymentMethod = paymentMethods.map((method) => ({
    method,
    total: receiverRows.reduce((sum, row) => rowAdvancePaymentMethod(row) === method ? sum + rowAdvanceAmount(row) : sum, 0),
  }));
  const totalAdvanceWithoutPaymentMethod = receiverRows.reduce((sum, row) => rowAdvanceAmount(row) > 0 && !rowAdvancePaymentMethod(row) ? sum + rowAdvanceAmount(row) : sum, 0);
  const totalsByReceiverPaymentMethod = paymentMethods.map((method) => ({
    method,
    total: receiverRows.reduce((sum, row) => rowPaid(row) > 0 && rowPaymentMethod(row) === method ? sum + rowPaid(row) : sum, 0),
  }));
  const totalReceiverWithoutPaymentMethod = receiverRows.reduce((sum, row) => rowPaid(row) > 0 && !rowPaymentMethod(row) ? sum + rowPaid(row) : sum, 0);
  const rows = receiverRows
    .filter(rowMatchesSectorFilter)
    .filter((row) => rowMatchesPaymentFilter(row, receiverPaymentFilter))
    .sort((first, second) => { const result = String(values(first, receiverSort.key)).localeCompare(String(values(second, receiverSort.key)), 'pt-BR', { numeric: true, sensitivity: 'base' }); return receiverSort.direction === 'asc' ? result : -result; });
  const indicator = (key) => receiverSort.key === key ? (receiverSort.direction === 'asc' ? '↑' : '↓') : '↕';
  const receiverReportRows = rows.map((row) => ({
    nome: row.nome,
    setor: (row.setores || []).join(', '),
    setores: row.setores || [],
    valorSugerido: rowSuggested(row),
    valorSugeridoOriginal: rowOriginalSuggested(row),
    valorPagoAntecipado: rowAdvanceAmount(row),
    formaPagamentoAntecipado: rowAdvancePaymentMethod(row),
    observacaoAntecipado: rowAdvancePaymentObservation(row),
    valorPago: rowPaid(row),
    pagoMais: Math.max(0, rowAdvanceAmount(row) + rowPaid(row) - rowOriginalSuggested(row)),
    pagoMenos: Math.max(0, rowOriginalSuggested(row) - rowAdvanceAmount(row) - rowPaid(row)),
    formaPagamento: rowPaymentMethod(row),
    observacao: rowPaymentObservation(row),
  }));
  const reportTitle = `Relatório do Recebedor - ${retreat.nome}`;
  const reportSectors = [...new Set(receiverRows.flatMap((row) => row.setores || []))].sort((first, second) => first.localeCompare(second, 'pt-BR'));
  const reportInitialSort = ['nome', 'sugerido', 'pago'].includes(receiverSort.key) ? { ...receiverSort } : { key: 'nome', direction: 'asc' };
  const reportValue = (row, key) => ({ nome: row.nome, sugerido: row.valorSugerido, pago: row.valorPago })[key];
  const reportRowsForSector = (sector = '') => sector ? receiverReportRows.filter((row) => row.setores.some((item) => normalizeText(item) === normalizeText(sector))) : receiverReportRows;
  const sortReceiverReportRows = (sort = reportInitialSort, sector = '') => [...reportRowsForSector(sector)].sort((first, second) => {
    const result = String(reportValue(first, sort.key)).localeCompare(String(reportValue(second, sort.key)), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return sort.direction === 'asc' ? result : -result;
  });
  const reportIndicator = (sort, key) => sort.key === key ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
  const receiverReportHeader = (label, key, sort, interactive) => interactive ? `<button type="button" data-receiver-report-sort="${key}">${label} <span>${reportIndicator(sort, key)}</span></button>` : `${label}`;
  const receiverReportNameCell = (row) => {
    const note = [row.formaPagamento || '', row.observacao || ''].filter(Boolean).join(' · ');
    return `<strong>${escapeHtml(row.nome)}</strong>${note ? `<small class="receiver-report-payment-note">${escapeHtml(note)}</small>` : ''}`;
  };
  const receiverReportTable = (sort = reportInitialSort, interactive = false, sector = '') => `<div class="receiver-report-preview"><table><thead><tr><th>${receiverReportHeader('Nome', 'nome', sort, interactive)}</th><th>${receiverReportHeader('Valor sugerido', 'sugerido', sort, interactive)}</th><th>${receiverReportHeader('Valor pago', 'pago', sort, interactive)}</th></tr></thead><tbody>${sortReceiverReportRows(sort, sector).map((row) => `<tr><td>${receiverReportNameCell(row)}</td><td>${currency(row.valorSugerido)}</td><td>${currency(row.valorPago)}</td></tr>`).join('') || '<tr><td colspan="3">Nenhum registro encontrado.</td></tr>'}</tbody></table></div>`;
  const receiverReportDocument = (sort = reportInitialSort, sector = '') => `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(reportTitle)}</title><style>@page{size:A4;margin:10mm}body{margin:0;color:#26382c;font-family:Arial,sans-serif}h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#667268}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}th,td{padding:8px;border:1px solid #d9d1c3;text-align:left;vertical-align:top}th{background:#edf5e9;color:#285130}th:first-child,td:first-child{width:auto;overflow-wrap:anywhere;word-break:normal}th:nth-child(2),th:nth-child(3),td:nth-child(2),td:nth-child(3){width:105px;white-space:nowrap;font-weight:700}.receiver-report-payment-note{display:block;margin-top:3px;color:#667268;font-size:10px;font-weight:400;line-height:1.25}</style></head><body><h1>${escapeHtml(reportTitle)}</h1><p>${sector ? `Setor: ${escapeHtml(sector)} · ` : ''}Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}</p>${receiverReportTable(sort, false, sector)}</body></html>`;
  const printReceiverReport = (pdf = false, sort = reportInitialSort, sector = '') => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
    printWindow.document.open();
    printWindow.document.write(receiverReportDocument(sort, sector));
    printWindow.document.close();
    if (pdf) alert('Na janela de impressão, escolha "Salvar como PDF".');
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  };
  const downloadReceiverSpreadsheet = () => {
    const headers = ['Nome completo', 'Setor', 'Valor sugerido', 'Valor pago antecipado', 'Forma de pagamento antecipado (ficha cursista)', 'Observação da forma de pagamento antecipado', 'Valor pago (valor informado no modulo recebedor)', 'Valor pago a mais', 'Valor pago a menos', 'Forma de pagamento (modulo recebedor)', 'Observação forma de pagamento (modulo recebedor)'];
    const csvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.map(csvValue).join(';'),
      ...receiverReportRows.map((row) => [row.nome, row.setor, currency(row.valorSugeridoOriginal), currency(row.valorPagoAntecipado), row.formaPagamentoAntecipado, row.observacaoAntecipado, currency(row.valorPago), currency(row.pagoMais), currency(row.pagoMenos), row.formaPagamento, row.observacao].map(csvValue).join(';')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const sectorSuffix = receiverSectorFilter ? `-${normalizeText(receiverSectorFilter).replace(/\s+/g, '-')}` : '';
    const paymentSuffix = receiverPaymentFilter ? `-${normalizeText(paymentFilterLabel).replace(/\s+/g, '-')}` : '';
    link.download = `${normalizeText(retreat.nome || 'relatorio-recebedor').replace(/\s+/g, '-') || 'relatorio-recebedor'}-recebedor${sectorSuffix}${paymentSuffix}.csv`;
    document.body.append(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
  };
  const paymentMethodArticles = (items, missingTotal = 0) => {
    const rows = items.filter(({ total }) => total > 0).map(({ method, total }) => `<article><span>${escapeHtml(method)}</span><strong>${currency(total)}</strong></article>`);
    if (missingTotal > 0) rows.push(`<article><span>Sem forma informada</span><strong>${currency(missingTotal)}</strong></article>`);
    return rows.join('') || '<p class="receiver-payment-empty">Nenhuma entrada registrada.</p>';
  };
  const balanceClass = balance >= 0 ? 'is-positive' : 'is-negative';
  const paymentMethodSummaryHtml = `<div class="receiver-payment-origin"><div class="receiver-payment-origin-heading"><h4>Recebimento antecipado de cursistas</h4><strong>${currency(totalAdvancePaid)}</strong></div><section class="receiver-payment-summary">${paymentMethodArticles(totalsByAdvancePaymentMethod, totalAdvanceWithoutPaymentMethod)}</section></div><div class="receiver-payment-origin"><div class="receiver-payment-origin-heading"><h4>Recebedor</h4><div><strong>${currency(totalReceiverPaid)}</strong><small class="receiver-balance-diff ${balanceClass}">Diferença: <b>${currency(balance)}</b></small></div></div><section class="receiver-payment-summary">${paymentMethodArticles(totalsByReceiverPaymentMethod, totalReceiverWithoutPaymentMethod)}</section></div>`;
  const receiverSummaryHtml = `<section class="receiver-summary"><article><span>Já contribuíram</span><strong>${paidPeopleCount}</strong><small>pessoa(s)</small></article><article><span>Falta contribuir</span><strong>${totalPeopleCount - paidPeopleCount}</strong><small>pessoa(s)</small></article><article><span>Valor a receber</span><strong>${currency(remaining)}</strong></article></section><div class="receiver-payment-heading"><h3>Entradas por forma de pagamento</h3></div>${paymentMethodSummaryHtml}`;
  const sectorFilterLabel = receiverSectorFilter ? `: ${escapeHtml(receiverSectorFilter)}` : '';
  const receiverEmptyMessage = receiverSectorFilter || receiverPaymentFilter ? 'Nenhum registro encontrado para os filtros selecionados.' : 'Nenhum voluntário para este retiro.';
  const receiverUrl = `${location.origin}/recebedor/${encodeURIComponent(retreat.recebedorToken || '')}`;
  const receiverLinkPanel = publicReceiverToken ? '' : `<section class="panel receiver-link-panel"><div class="panel-heading"><div><h2>Link de acesso do recebedor</h2><p>Compartilhe este link somente com quem far&aacute; o controle financeiro deste retiro.</p></div></div><label class="copy-field receiver-retreat-link"><span>Recebedor</span><input readonly value="${escapeHtml(receiverUrl)}"><button type="button" data-copy-receiver-link="${escapeHtml(receiverUrl)}" ${retreat.recebedorToken ? '' : 'disabled'}>Copiar</button></label>${retreat.recebedorToken ? '' : '<p class="form-message">Este retiro ainda nao possui link do recebedor gerado.</p>'}</section>`;
  layout(`<section class="page-heading"><div><p class="eyebrow">Financeiro do retiro</p><h1>Módulo Recebedor</h1><p>${escapeHtml(retreat.nome)} · ${canEditReceiver ? 'Registre as contribuições recebidas.' : 'Consulta financeira do retiro.'}</p>${isRetreatConcluded(retreat) ? '<p class="hint">Retiro concluído: alterações financeiras bloqueadas.</p>' : ''}</div></section>${receiverLinkPanel}<div class="receiver-view-options"><button type="button" id="receiver-by-sector" class="${receiverSectorFilter ? 'is-selected' : ''}">Buscar setor${sectorFilterLabel}</button><button type="button" id="receiver-by-payment" class="${receiverPaymentFilter ? 'is-selected' : ''}">Pagamentos${paymentFilterLabel ? `: ${escapeHtml(paymentFilterLabel)}` : ''}</button><button type="button" id="receiver-show-panel">Mostrar Painel</button><button type="button" id="receiver-download-sheet">Gerar planilha</button></div><section class="panel receiver-panel"><div class="receiver-table"><div class="receiver-head"><button data-receiver-sort="nome">Nome completo <span>${indicator('nome')}</span></button><button data-receiver-sort="setor">Setor <span>${indicator('setor')}</span></button><button data-receiver-sort="sugerido">Saldo devedor <span>${indicator('sugerido')}</span></button><button data-receiver-sort="pago">Valor pago <span>${indicator('pago')}</span></button><button data-receiver-sort="taxa">Contribuição <span>${indicator('taxa')}</span></button></div>${rows.length ? rows.map((row) => `<div class="receiver-row${row.isCouple ? ' receiver-couple-row' : ''}">${receiverNameCell(row)}<span>${escapeHtml(row.setores.join(', '))}</span><span>${currency(rowSuggested(row))}</span><input class="${rowPaymentState(row)}" data-paid-entry="${row.id}" type="text" inputmode="decimal" value="${currency(rowPaid(row))}" ${!canEditReceiver || rowPaidStatus(row) ? 'disabled' : ''} aria-label="Valor pago de ${escapeHtml(row.nome)}"><label class="payment-check${rowHasPayment(row) ? ' has-payment' : ''}"><input data-fee-entry="${row.id}" type="checkbox" ${rowPaidStatus(row) ? 'checked' : ''} ${!canEditReceiver ? 'disabled' : ''} ${rowHasPayment(row) && !rowPaidStatus(row) && !isStudentRow(row) ? 'data-partial-payment="true"' : ''}><span>Pago</span></label></div>`).join('') : `<p class="empty-state">${receiverEmptyMessage}</p>`}</div></section>`, 'recebedor');
  app.querySelector('[data-copy-receiver-link]')?.addEventListener('click', async (event) => {
    await navigator.clipboard.writeText(event.currentTarget.dataset.copyReceiverLink);
    event.currentTarget.textContent = 'Copiado!';
  });
  const openReceiverPanel = () => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    overlay.innerHTML = `<div class="receiver-sector-dialog receiver-panel-dialog"><div class="panel-heading"><div><p class="eyebrow">Painel financeiro</p><h2>Resumo do recebedor</h2><p>${escapeHtml(retreat.nome)}</p></div></div>${receiverSummaryHtml}<button type="button" class="close-sector-view">Fechar painel</button></div>`;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove());
    app.append(overlay);
  };
  app.querySelector('#receiver-show-panel').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    openReceiverPanelAfterRender = true;
    await loadData();
    await renderRecebedor();
  });
  app.querySelector('#receiver-by-payment').addEventListener('click', () => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Pagamentos</p><h2>Escolha um filtro</h2><p>Serão exibidos os registros da lista que se encaixam na situação selecionada.</p></div></div><div class="receiver-sector-list">${paymentFilterOptions.map((option) => `<button type="button" data-receiver-payment-filter="${escapeHtml(option.id)}" class="${receiverPaymentFilter === option.id ? 'is-selected' : ''}"><strong>${escapeHtml(option.label)}</strong><span>${peopleCountForPaymentFilter(option.id)} pessoa(s)</span></button>`).join('')}</div><div class="form-actions"><button type="button" class="close-sector-view">Fechar</button></div></div>`;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('[data-receiver-payment-filter]').forEach((button) => button.addEventListener('click', () => {
      receiverPaymentFilter = button.dataset.receiverPaymentFilter;
      overlay.remove();
      renderRecebedor();
    }));
    app.append(overlay);
  });
  app.querySelector('#receiver-download-sheet').addEventListener('click', downloadReceiverSpreadsheet);
  if (openReceiverPanelAfterRender) {
    openReceiverPanelAfterRender = false;
    openReceiverPanel();
  }
  app.querySelector('#receiver-by-sector').addEventListener('click', () => {
    const sectors = [...new Set(receiverRows.flatMap((row) => row.setores))].sort((first, second) => first.localeCompare(second, 'pt-BR'));
    const overlay = document.createElement('section'); overlay.className = 'receiver-sector-overlay';
    const sectorFilterRows = (sector = '') => receiverRows.filter((row) => (!sector || rowHasSector(row, sector)) && rowMatchesPaymentFilter(row, receiverPaymentFilter));
    const sectorPeopleCount = (sector = '') => sectorFilterRows(sector).reduce((total, row) => total + row.entries.length, 0);
    const sectorButton = (sector, label) => `<button type="button" data-receiver-sector="${escapeHtml(sector)}" class="${receiverSectorFilter === sector ? 'is-selected' : ''}"><strong>${escapeHtml(label)}</strong><span>${sectorPeopleCount(sector)} pessoa(s)</span></button>`;
    const renderSectorList = () => { overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Recebedor por setor</p><h2>Escolha um setor</h2><p>A lista será filtrada pelo setor escolhido e continuará respeitando o filtro Pagamentos.</p></div></div><div class="receiver-sector-list">${sectorButton('', 'Buscar tudo')}${sectors.map((sector) => sectorButton(sector, sector)).join('')}</div><button type="button" class="close-sector-view">Fechar visualização</button></div>`; overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove()); overlay.querySelectorAll('[data-receiver-sector]').forEach((button) => button.addEventListener('click', () => { receiverSectorFilter = button.dataset.receiverSector || ''; receiverSort = { key: receiverSectorFilter ? 'setor' : 'nome', direction: 'asc' }; overlay.remove(); renderRecebedor(); })); };
    renderSectorList(); app.append(overlay);
  });
  app.querySelectorAll('[data-receiver-sort]').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.receiverSort; receiverSort = { key, direction: receiverSort.key === key && receiverSort.direction === 'asc' ? 'desc' : 'asc' }; renderRecebedor(); }));
  const distributePaidValue = (row, total) => {
    if (!row?.entries?.length) return [];
    if (isVolunteerCoupleRow(row)) {
      const share = total / row.entries.length;
      return row.entries.map((entry) => ({ entry, value: share }));
    }
    const suggestedTotal = rowSuggested(row);
    return row.entries.map((entry) => {
      const suggested = effectiveSuggested(entry);
      return { entry, value: suggestedTotal ? total * (suggested / suggestedTotal) : total / row.entries.length };
    });
  };
  const askDeletePayment = (row) => new Promise((resolve) => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(confirmed);
    };
    overlay.innerHTML = `<div class="receiver-sector-dialog receiver-payment-dialog"><div class="panel-heading"><div><p class="eyebrow">Excluir pagamento</p><h2>Confirmar exclusão</h2><p>Tem certeza que quer eliminar o pagamento de ${escapeHtml(row.nome)}?</p></div></div><div class="form-actions"><button type="button" class="close-sector-view">Fechar</button><button type="button" id="confirm-delete-payment" class="delete-student">Confirmar</button></div></div>`;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
    overlay.querySelector('.close-sector-view').addEventListener('click', () => finish(false));
    overlay.querySelector('#confirm-delete-payment').addEventListener('click', () => finish(true));
    app.append(overlay);
  });
  app.querySelectorAll('[data-paid-entry]').forEach((input) => {
    input.addEventListener('focus', () => {
      const row = receiverRows.find((item) => item.id === input.dataset.paidEntry);
      input.value = row ? rowPaid(row) || '' : '';
    });
    input.addEventListener('change', async () => {
      if (!ensureRetreatCanBeChanged(retreat, 'alterar pagamentos')) return;
      const row = receiverRows.find((item) => item.id === input.dataset.paidEntry);
      if (!row) return;
      const total = parseCurrency(input.value);
      const checked = app.querySelector(`[data-fee-entry="${CSS.escape(input.dataset.paidEntry)}"]`)?.checked;
      await Promise.all(distributePaidValue(row, total).map(({ entry, value }) => {
        setEntryPayment(entry, value, checked || entryPaidStatus(entry), entryPaymentMethod(entry));
        return saveFinancialEntry(entry);
      }));
      input.value = currency(total);
      await loadData();
    });
  });
  app.querySelectorAll('[data-partial-payment]').forEach((input) => { input.indeterminate = true; });
  app.querySelectorAll('[data-fee-entry]').forEach((input) => input.addEventListener('change', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'alterar pagamentos')) return;
    const row = receiverRows.find((item) => item.id === input.dataset.feeEntry);
    if (!row) return;
    if (!input.checked && !(await askDeletePayment(row))) {
      input.checked = true;
      return;
    }
    const paidInput = app.querySelector(`[data-paid-entry="${CSS.escape(input.dataset.feeEntry)}"]`);
    const typedPaid = parseCurrency(paidInput?.value);
    const currentPaid = rowPaid(row);
    const total = input.checked ? (typedPaid > 0 ? typedPaid : (currentPaid > 0 ? currentPaid : rowSuggested(row))) : 0;
    const paymentDetails = input.checked ? await askPaymentMethod({ nome: row.nome, total, currentMethod: rowPaymentMethod(row), currentObservation: rowPaymentObservation(row) }) : null;
    if (input.checked && !paymentDetails?.method) {
      input.checked = false;
      return;
    }
    await Promise.all(distributePaidValue(row, total).map(({ entry, value }) => {
      setEntryPayment(entry, value, input.checked, paymentDetails?.method || '', paymentDetails?.observation || '');
      return saveFinancialEntry(entry);
    }));
    await loadData();
    renderRecebedor();
  }));
}
async function renderPessoas() { layout(`<section class="page-heading"><div><p class="eyebrow">Histórico reutilizável</p><h1>Pessoas</h1><p>Dados pessoais são reaproveitados; a participação é sempre nova em cada retiro.</p></div></section><section class="panel">${people.length ? `<div class="simple-list">${people.map((person) => `<div><strong>${escapeHtml(person.nome)}</strong><span>Nascimento: ${date(person.nascimento)} · ${escapeHtml(person.telefone || 'Sem telefone')}</span><small>${enrolments.filter((entry) => entry.pessoaId === person.id).length} retiro(s)</small></div>`).join('')}</div>` : '<div class="empty-state">O histórico de pessoas será formado quando chegarem os primeiros cadastros.</div>'}</section>`, 'pessoas'); }

async function renderValidacaoInscricoes() {
  const retreat = selectedRetreat();
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Equipe de trabalho</p><h1>Valida\u00e7\u00e3o das inscri\u00e7\u00f5es</h1><p>Crie ou publique um retiro para validar as inscri\u00e7\u00f5es da equipe.</p></div></section>', 'validacao-inscricoes'); return; }
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const entryName = (entry) => entry.nome || peopleById.get(entry.pessoaId)?.nome || '';
  const byName = (first, second) => entryName(first).localeCompare(entryName(second), 'pt-BR', { sensitivity: 'base' });
  const allRetreatEntries = enrolments.filter((entry) => entry.retiroId === retreat.id);
  const retreatEntries = [
    ...allRetreatEntries.filter((entry) => !isEnrolmentValidated(entry)).sort(byName),
    ...allRetreatEntries.filter(isEnrolmentValidated).sort(byName),
  ];
  const retreatById = new Map(retreats.map((item) => [item.id, item]));
  const entrySnapshot = (entry) => entry.dadosPessoais || personalDataSnapshot({ ...peopleById.get(entry.pessoaId), nome: entry.nome || peopleById.get(entry.pessoaId)?.nome });
  const entryIdentityKeys = (entry) => {
    const person = peopleById.get(entry.pessoaId);
    const snapshot = entrySnapshot(entry);
    return new Set([entry.pessoaId, normalizeCpf(entry.pessoaId), normalizeCpf(person?.cpf || person?.id), normalizeCpf(snapshot.cpf)].filter(Boolean));
  };
  const entryTime = (entry) => {
    const entryRetreat = retreatById.get(entry.retiroId);
    return Date.parse(entryRetreat?.dataInicio || entryRetreat?.dataTermino || entry.enviadoEm || entry.atualizadoEm || entryRetreat?.createdAt || '') || 0;
  };
  const previousEntryFor = (entry) => {
    const identityKeys = entryIdentityKeys(entry);
    const previousEntries = enrolments
      .filter((candidate) => candidate.id !== entry.id && candidate.retiroId !== entry.retiroId)
      .filter((candidate) => [...entryIdentityKeys(candidate)].some((key) => identityKeys.has(key)))
      .sort((first, second) => entryTime(second) - entryTime(first));
    return previousEntries[0] || null;
  };
  const personalHistoryNotice = (entry) => {
    const previousEntry = previousEntryFor(entry);
    if (!previousEntry) return 'Sem histórico de inscrições';
    const current = entrySnapshot(entry);
    const previous = entrySnapshot(previousEntry);
    const changed = personalDataFields
      .filter(([key, , normalize]) => normalize(current[key]) !== normalize(previous[key]))
      .map(([, label]) => label);
    return changed.length
      ? `Dados pessoais alterados desde a última inscrição: ${changed.join(', ')}`
      : 'Sem alteração nos dados pessoais desde a última inscrição';
  };
  const validationGroups = enrolmentValidationGroups(retreatEntries).map((group) => [...group].sort(byName));
  const groupValidated = isEnrolmentGroupValidated;
  const pendingCount = validationGroups.filter((group) => !groupValidated(group)).length;
  const validatedCount = validationGroups.length - pendingCount;
  const canValidateEntries = canAccess('validacao-inscricoes.validar') && canModifyRetreat(retreat);
  const validationGroupHtml = (group) => {
    const representative = group[0];
    const validated = groupValidated(group);
    const label = group.length > 1 ? 'Casal' : 'Individual';
    const peopleHtml = group.map((entry) => {
      const person = peopleById.get(entry.pessoaId);
      const cpf = normalizeCpf(person?.cpf || entry.pessoaId);
      return `<div class="validation-person"><div><strong>${escapeHtml(entry.nome || person?.nome || 'Sem nome')}</strong><span>${cpf ? formatCpf(cpf) : 'CPF n\u00e3o informado'} · ${escapeHtml((entry.setores || []).join(', ') || 'Sem setor')}</span><small class="personal-history-notice">${escapeHtml(personalHistoryNotice(entry))}</small></div><a href="#pessoas/${entry.pessoaId}/${entry.retiroId}/validacao-inscricoes">Consultar</a></div>`;
    }).join('');
    return `<article class="${group.length > 1 ? 'is-couple-validation' : ''}"><div class="validation-people"><small class="validation-group-label">${label}</small>${peopleHtml}</div><span class="validation-status ${validated ? 'is-valid' : 'is-pending'}">${validated ? 'Validada' : 'Pendente'}</span>${canValidateEntries ? `<div class="registration-actions"><button type="button" data-validate-entry="${representative.id}" ${validated ? 'disabled' : ''}>Validar</button></div>` : ''}</article>`;
  };
  layout(`<section class="page-heading"><div><p class="eyebrow">Equipe de trabalho</p><h1>Valida\u00e7\u00e3o das inscri\u00e7\u00f5es</h1><p>${escapeHtml(retreat.nome)} · Confira os cadastros recebidos e registre a ciência da coordenação.</p></div></section><section class="receiver-summary validation-summary"><article><span>Pendentes</span><strong>${pendingCount}</strong><small>ficha(s)</small></article><article><span>Validadas</span><strong>${validatedCount}</strong><small>ficha(s)</small></article><article><span>Total recebido</span><strong>${validationGroups.length}</strong><small>ficha(s)</small></article></section><section class="panel validation-list">${validationGroups.length ? validationGroups.map(validationGroupHtml).join('') : '<p class="empty-state">Nenhuma inscrição da equipe foi recebida para este retiro.</p>'}</section>`, 'validacao-inscricoes');
  app.querySelectorAll('[data-validate-entry]').forEach((button) => button.addEventListener('click', async () => {
    const entry = enrolments.find((item) => item.id === button.dataset.validateEntry);
    if (!entry) return;
    if (!ensureRetreatCanBeChanged(retreat, 'validar inscrições')) return;
    const validatedAt = new Date().toISOString();
    const entriesToValidate = entry.casalId
      ? enrolments.filter((item) => item.retiroId === entry.retiroId && item.casalId === entry.casalId)
      : [entry];
    await Promise.all(entriesToValidate.map((item) => dataService.saveAdesao({ ...item, status: 'confirmada', validada: true, validadoEm: item.validadoEm || validatedAt, atualizadoEm: validatedAt })));
    await loadData();
    renderValidacaoInscricoes();
  }));
}

async function renderPessoa(id, retreatId, source = '') {
  const person = people.find((item) => item.id === id);
  if (!person) return renderPessoas();
  const entries = enrolments.filter((entry) => entry.pessoaId === id);
  const entry = retreatId ? entries.find((item) => item.retiroId === retreatId) : entries[0];
  const retreat = entry && retreats.find((item) => item.id === entry.retiroId);
  const spouseEntry = entry?.casalId && enrolments.find((item) => item.casalId === entry.casalId && item.retiroId === entry.retiroId && item.pessoaId !== id);
  const spouse = spouseEntry && people.find((item) => item.id === spouseEntry.pessoaId);
  const field = (label, value) => `<div><strong>${label}</strong><span>${escapeHtml(value || 'Não informado')}</span></div>`;
  const backHref = source === 'validacao-inscricoes' ? '#validacao-inscricoes' : (source === 'equipe' ? '#pessoas' : (retreat ? `#retiros/${retreat.id}` : '#pessoas'));
  const sourceSuffix = source ? `/${source}` : '';
  const canDeleteConsultedRegistration = entry && source !== 'retiro' && canModifyRetreat(retreat);
  const address = (item) => [[item.endereco, item.numero].filter(Boolean).join(', '), item.bairro, item.cidade, item.estado].filter(Boolean).join(' · ');
  layout(`<section class="page-heading compact"><div><a class="back-link" href="${backHref}">← Voltar</a><p class="eyebrow">${entry?.casalId ? 'Cadastro individual vinculado a casal' : 'Cadastro individual'}</p><h1>${escapeHtml(person.nome)}</h1><p>${retreat ? `Ficha enviada para ${escapeHtml(retreat.nome)}` : 'Cadastro no histórico'}</p></div></section><section class="panel"><h2>Dados pessoais</h2><div class="simple-list">${field('Nascimento', date(person.nascimento))}${field('Telefone', person.telefone)}${field('Endereço', address(person))}</div></section>${entry ? `<section class="panel"><h2>Participação neste retiro</h2><div class="simple-list">${field('Setor de trabalho', entry.setores.join(', '))}${field('Dias disponíveis', entry.dias.join(', '))}${field('Retiros que fez', entry.retirosAnteriores?.join(', '))}${field('Quadrante impresso', entry.quadrante)}${field('Foto', entry.foto)}${field('Contribuição', entry.contribuicao)}${field('Coordenação informada', entry.coordenacao)}${field('Observação', entry.observacao)}</div>${entry.espacoKids?.length ? `<h3 class="participants-heading">Espaço Kids</h3><div class="simple-list">${entry.espacoKids.map((kid) => field(kid.nome, date(kid.nascimento))).join('')}</div>` : ''}${spouse ? `<h3 class="participants-heading">Cônjuge neste retiro</h3><div class="simple-list"><div><strong>${escapeHtml(spouse.nome)}</strong><span>${escapeHtml(spouseEntry.setores.join(', '))}</span><a href="#pessoas/${spouse.id}/${entry.retiroId}${sourceSuffix}">Abrir ficha do cônjuge</a></div></div>` : ''}</section>` : ''}<section class="panel"><h2>Histórico de retiros</h2><div class="simple-list">${entries.map((item) => `<div><strong>${escapeHtml(retreats.find((retreat) => retreat.id === item.retiroId)?.nome || 'Retiro')}</strong><span>${escapeHtml(item.setores.join(', '))}</span></div>`).join('') || '<p class="empty-state">Sem participações registradas.</p>'}</div></section>${canDeleteConsultedRegistration ? '<section class="panel"><div class="form-actions"><p>Esta ação remove apenas a participação neste retiro.</p><button type="button" id="delete-consulted-registration" class="delete-registration">Excluir participação no retiro</button></div></section>' : ''}`, 'pessoas');
  app.querySelector('#delete-consulted-registration')?.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'excluir participação')) return;
    if (!confirm(`Excluir a participação de ${entry.nome} neste retiro?`)) return;
    const entriesToDelete = [entry, spouseEntry].filter(Boolean);
    for (const entryToDelete of entriesToDelete) {
      await dataService.deleteAdesao(entryToDelete.id);
    }
    await loadData();
    location.hash = backHref;
  });
}
async function renderCursista() {
  const yesNo = (name) => choices(name, ['Sim', 'Não'], false);
  const focusStudentRetreat = selectedRetreat();
  const canEditStudentRetreat = canModifyRetreat(focusStudentRetreat);
  layout(`<section class="page-heading student-page-heading"><div><h1>Cursista</h1><p>Registre as informações necessárias para acolher e acompanhar o cursista.</p></div><button type="button" id="student-financial-summary" class="primary-button">Resumo financeiro</button></section><section class="admin-registration-tools student-registration-tools panel"><div class="panel-heading"><div><h2>Cadastro</h2><p>Busque por nome, CPF ou telefone para editar ou consultar a ficha do retiro em foco.</p></div><div class="student-registration-actions"><button type="button" id="new-student">Incluir novo</button></div></div><label class="field registration-search-field"><span>Busca</span><input id="student-search" autocomplete="off" placeholder="Digite nome, CPF ou telefone"></label><div id="student-search-results" class="registration-search-results" hidden></div></section><form id="student-form" class="panel student-form">${stateDatalist()}<section class="form-section"><div class="section-heading student-personal-heading"><span>01</span><div><h2>Dados pessoais</h2><p>Informações básicas de identificação e contato.</p></div><div class="student-heading-actions" hidden><button type="button" id="edit-selected-student">Editar</button><button type="button" id="delete-selected-student">Excluir</button></div></div><div class="fields two-columns"><label class="field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field full"><span>Nome completo <b>*</b></span><input name="nome" required></label><label class="field"><span>Data de nascimento <b>*</b></span><input name="nascimento" type="date" required></label><label class="field"><span>Telefone <b>*</b></span><input name="telefone" required></label></div></section><section class="form-section"><div class="section-heading"><span>02</span><div><h2>Endereço</h2></div></div><div class="fields address-fields"><label class="field"><span>CEP <b>*</b></span><input name="cep" inputmode="numeric" placeholder="00000-000" required></label><label class="field street-field"><span>Rua <b>*</b></span><input name="rua" required></label><label class="field number-field"><span>Número <b>*</b></span><input name="numero" required></label><label class="field"><span>Bairro <b>*</b></span><input name="bairro" required></label><label class="field"><span>Cidade <b>*</b></span><input name="cidade" required></label><label class="field"><span>Estado <b>*</b></span><input name="estado" maxlength="2" required></label></div></section><section class="form-section"><div class="section-heading"><span>03</span><div><h2>Formação e vivência</h2></div></div><div class="student-questions"><fieldset><legend>É batizado(a)? <b>*</b></legend>${yesNo('batizado')}</fieldset><fieldset><legend>Fez primeira comunhão? <b>*</b></legend>${yesNo('primeiraComunhao')}</fieldset><fieldset><legend>Estuda? <b>*</b></legend>${yesNo('estuda')}<div class="fields two-columns"><label class="field"><span>Série</span><input name="serie"></label><label class="field"><span>Escola</span><input name="escola"></label></div></fieldset><fieldset><legend>Fez algum retiro? <b>*</b></legend>${yesNo('fezRetiro')}<label class="field"><span>Qual?</span><input name="qualRetiro"></label></fieldset></div></section><section class="form-section"><div class="section-heading"><span>04</span><div><h2>Família e convite</h2></div></div><div class="fields two-columns"><label class="field"><span>Nome do pai</span><input name="nomePai"></label><label class="field"><span>Telefone de contato</span><input name="telefonePai"></label><label class="field"><span>Nome da mãe</span><input name="nomeMae"></label><label class="field"><span>Telefone de contato</span><input name="telefoneMae"></label></div><fieldset class="student-fieldset"><legend>Os pais participam de algum movimento na igreja? <b>*</b></legend>${yesNo('paisMovimento')}<label class="field"><span>Qual?</span><input name="qualMovimento"></label></fieldset><div class="fields"><label class="field"><span>Quem o(a) convidou?</span><input name="convidou"></label><fieldset class="student-fieldset full"><legend>Tamanho da camiseta <b>*</b></legend>${choices('camiseta', ['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'], false)}</fieldset></div></section><section class="form-section"><div class="section-heading"><span>05</span><div><h2>Saúde e cuidados</h2></div></div><div class="student-questions"><fieldset><legend>Tem intolerância a alimentos? <b>*</b></legend>${yesNo('intoleranciaAlimentos')}<label class="field"><span>Qual?</span><input name="qualIntolerancia"></label></fieldset><fieldset><legend>É alérgico(a) a algum medicamento? <b>*</b></legend>${yesNo('alergiaMedicamento')}<label class="field"><span>Qual?</span><input name="qualAlergia"></label></fieldset></div><div class="fields two-columns"><label class="field"><span>Medicamento para dor de cabeça</span><input name="medicamentoCabeca"></label><label class="field"><span>Medicamento para dor no estômago</span><input name="medicamentoEstomago"></label></div></section><p id="student-message" class="form-message"></p><div class="form-actions"><p><b>*</b> Campos obrigatórios</p><button type="submit">Salvar cadastro <span>→</span></button></div></form>`, 'cursista');
  const form = app.querySelector('#student-form');
  if (!canEditStudentRetreat) {
    app.querySelector('#new-student')?.remove();
    app.querySelector('#student-message').textContent = 'Retiro concluido: cadastro de cursistas disponivel apenas para consulta.';
  }
  wireStateFields(form);
  wireCepLookup(form);
  wireCpfFields(form);
  const clearStudentWarning = (event) => event.target.closest('.field, .choice-block, fieldset, .form-section')?.classList.remove('field-warning');
  form.addEventListener('input', clearStudentWarning);
  form.addEventListener('change', clearStudentWarning);
  const focusStudentIssue = (control) => {
    if (!control) return;
    const target = control.closest('.field, .choice-block, fieldset, .form-section') || control;
    form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
    target.classList.add('field-warning');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => control.focus({ preventScroll: true }), 180);
  };
  let studentRequiredReviewActive = false;
  const firstStudentRequiredIssue = () => {
    const values = new FormData(form);
    const requiredChoices = ['batizado', 'primeiraComunhao', 'estuda', 'fezRetiro', 'paisMovimento', 'camiseta', 'intoleranciaAlimentos', 'alergiaMedicamento'];
    const missingChoice = requiredChoices.find((name) => !values.get(name));
    if (missingChoice) return form.querySelector(`[name="${missingChoice}"]`);
    if (values.get('intoleranciaAlimentos') === 'Sim' && !String(values.get('qualIntolerancia') || '').trim()) return form.elements.qualIntolerancia;
    if (values.get('alergiaMedicamento') === 'Sim' && !String(values.get('qualAlergia') || '').trim()) return form.elements.qualAlergia;
    return form.querySelector(':invalid');
  };
  const syncStudentConditionalRequired = () => {
    const values = new FormData(form);
    const intoleranceRequired = values.get('intoleranciaAlimentos') === 'Sim';
    const allergyRequired = values.get('alergiaMedicamento') === 'Sim';
    form.elements.qualIntolerancia.required = intoleranceRequired;
    form.elements.qualAlergia.required = allergyRequired;
    form.elements.qualIntolerancia.closest('.field')?.querySelector('span')?.replaceChildren(document.createTextNode('Qual?'), ...(intoleranceRequired ? [document.createTextNode(' '), Object.assign(document.createElement('b'), { textContent: '*' })] : []));
    form.elements.qualAlergia.closest('.field')?.querySelector('span')?.replaceChildren(document.createTextNode('Qual?'), ...(allergyRequired ? [document.createTextNode(' '), Object.assign(document.createElement('b'), { textContent: '*' })] : []));
  };
  const focusNextStudentRequiredIssue = (currentControl) => {
    if (!studentRequiredReviewActive || !currentControl) return;
    syncStudentConditionalRequired();
    const nextIssue = firstStudentRequiredIssue();
    const currentGroup = currentControl.name ? form.querySelector(`[name="${currentControl.name}"]`) : currentControl;
    if (nextIssue && nextIssue !== currentGroup && nextIssue !== currentControl) focusStudentIssue(nextIssue);
    if (!nextIssue) studentRequiredReviewActive = false;
  };
  form.querySelectorAll('[name="intoleranciaAlimentos"], [name="alergiaMedicamento"]').forEach((input) => {
    input.addEventListener('change', () => {
      syncStudentConditionalRequired();
      const detailField = input.name === 'intoleranciaAlimentos' ? form.elements.qualIntolerancia : form.elements.qualAlergia;
      if (input.checked && input.value === 'Sim') focusStudentIssue(detailField);
    });
  });
  form.addEventListener('change', (event) => focusNextStudentRequiredIssue(event.target));
  form.addEventListener('blur', (event) => focusNextStudentRequiredIssue(event.target), true);
  syncStudentConditionalRequired();
  const duplicateStudentCpfMessage = 'CPF já cadastrado';
  const studentTeamConflictMessage = 'Este CPF já está cadastrado na equipe de trabalho deste retiro.';
  const studentArchiveMessage = 'Dados encontrados no acervo da equipe. Revise antes de salvar.';
  const financialSummaryTitle = `Resumo financeiro dos cursistas${focusStudentRetreat ? ` - ${focusStudentRetreat.nome}` : ''}`;
  const financialSummaryRows = async () => {
    const students = await dataService.listCursistas();
    return students
      .filter((student) => !focusStudentRetreat || student.retiroId === focusStudentRetreat.id)
      .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }))
      .map((student) => {
        const valorInscricao = parseCurrency(student.valorInscricao);
        const valorPago = parseCurrency(student.valorPago);
        const saldoInformado = parseCurrency(student.saldoPagar);
        const saldoPagar = student.saldoPagar ? saldoInformado : Math.max(0, valorInscricao - valorPago);
        return { nome: student.nome || 'Sem nome', valorInscricao, valorPago, saldoPagar };
      });
  };
  const financialSummaryTotals = (rows) => rows.reduce((totals, row) => ({
    valorInscricao: totals.valorInscricao + row.valorInscricao,
    valorPago: totals.valorPago + row.valorPago,
    saldoPagar: totals.saldoPagar + row.saldoPagar,
  }), { valorInscricao: 0, valorPago: 0, saldoPagar: 0 });
  const financialSummaryTable = (rows) => {
    const totals = financialSummaryTotals(rows);
    return `<div class="receiver-report-preview student-financial-summary-preview"><table><thead><tr><th>Nome completo do cursista</th><th>Valor da inscrição</th><th>Valor pago</th><th>Saldo a pagar</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.saldoPagar > 0 ? 'has-student-balance' : ''}"><td>${escapeHtml(row.nome)}</td><td>${currency(row.valorInscricao)}</td><td>${currency(row.valorPago)}</td><td>${currency(row.saldoPagar)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum cursista encontrado.</td></tr>'}</tbody><tfoot><tr><th>Total</th><td>${currency(totals.valorInscricao)}</td><td>${currency(totals.valorPago)}</td><td>${currency(totals.saldoPagar)}</td></tr></tfoot></table></div>`;
  };
  const financialSummaryDocument = (rows) => `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(financialSummaryTitle)}</title><style>@page{size:A4;margin:10mm}body{margin:0;color:#26382c;font-family:Arial,sans-serif}h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#667268}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}th,td{padding:8px;border:1px solid #d9d1c3;text-align:left;vertical-align:top}th{background:#edf5e9;color:#285130}.has-student-balance td{font-weight:700}tfoot th,tfoot td{background:#f6fbf2;font-weight:700}th:first-child,td:first-child{width:auto;overflow-wrap:anywhere;word-break:normal}th:nth-child(2),th:nth-child(3),th:nth-child(4),td:nth-child(2),td:nth-child(3),td:nth-child(4){width:105px;white-space:nowrap;font-weight:700}</style></head><body><h1>${escapeHtml(financialSummaryTitle)}</h1><p>Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}</p>${financialSummaryTable(rows)}</body></html>`;
  const printFinancialSummary = (rows, pdf = false) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
    printWindow.document.open();
    printWindow.document.write(financialSummaryDocument(rows));
    printWindow.document.close();
    if (pdf) alert('Na janela de impressão, escolha "Salvar como PDF".');
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  };
  const downloadFinancialSummarySpreadsheet = (rows) => {
    const totals = financialSummaryTotals(rows);
    const headers = ['Nome completo do cursista', 'Valor da inscrição', 'Valor pago', 'Saldo a pagar'];
    const csvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.map(csvValue).join(';'),
      ...rows.map((row) => [row.nome, currency(row.valorInscricao), currency(row.valorPago), currency(row.saldoPagar)].map(csvValue).join(';')),
      ['Total', currency(totals.valorInscricao), currency(totals.valorPago), currency(totals.saldoPagar)].map(csvValue).join(';'),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${normalizeText(financialSummaryTitle).replace(/\s+/g, '-') || 'resumo-financeiro-cursistas'}.csv`;
    document.body.append(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
  };
  app.querySelector('#student-financial-summary').addEventListener('click', async () => {
    const rows = await financialSummaryRows();
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    overlay.innerHTML = `<div class="receiver-sector-dialog receiver-report-dialog student-financial-summary-dialog"><div class="panel-heading"><div><p class="eyebrow">Cursistas</p><h2>${escapeHtml(financialSummaryTitle)}</h2><p>Valores buscados somente nas fichas dos cursistas.</p></div></div><div id="student-financial-summary-table">${financialSummaryTable(rows)}</div><div class="receiver-report-actions"><button type="button" id="student-summary-pdf">Salvar PDF</button><button type="button" id="student-summary-sheet">Salvar planilha</button><button type="button" id="student-summary-print">Imprimir</button><button type="button" class="close-sector-view">Fechar</button></div></div>`;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#student-summary-pdf').addEventListener('click', () => printFinancialSummary(rows, true));
    overlay.querySelector('#student-summary-sheet').addEventListener('click', () => downloadFinancialSummarySpreadsheet(rows));
    overlay.querySelector('#student-summary-print').addEventListener('click', () => printFinancialSummary(rows, false));
    app.append(overlay);
  });
  const findPersonFromArchive = async (cpf) => {
    const currentPeople = people.length ? people : await dataService.listPessoas();
    return currentPeople.find((person) => normalizeCpf(person.cpf || person.id) === cpf || person.id === cpf);
  };
  const fillStudentFromArchive = (person) => {
    if (!person) return;
    const commonFields = {
      nome: person.nome,
      nascimento: person.nascimento,
      telefone: person.telefone,
      cep: person.cep,
      rua: person.endereco || person.rua,
      numero: person.numero,
      bairro: person.bairro,
      cidade: person.cidade,
      estado: person.estado
    };
    Object.entries(commonFields).forEach(([name, value]) => {
      if (value && form.elements[name]) form.elements[name].value = value;
    });
    form.elements.telefone.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const warnStudentTeamConflict = async (focus = false) => {
    const cpf = normalizeCpf(form.elements.cpf.value);
    if (form.elements.cpf.validationMessage === studentTeamConflictMessage) form.elements.cpf.setCustomValidity('');
    if ([studentTeamConflictMessage, studentArchiveMessage].includes(app.querySelector('#student-message').textContent)) app.querySelector('#student-message').textContent = '';
    if (cpf.length !== 11 || !isValidCpf(cpf) || !focusStudentRetreat) return false;
    const person = await findPersonFromArchive(cpf);
    if (person) fillStudentFromArchive(person);
    const personIds = new Set([cpf, person?.id, person?.cpf && normalizeCpf(person.cpf)].filter(Boolean));
    const currentEnrolments = enrolments.length ? enrolments : await dataService.listAdesoes();
    const conflict = currentEnrolments.some((entry) => {
      const entryCpf = normalizeCpf(entry.pessoaId);
      return entry.retiroId === focusStudentRetreat.id && (personIds.has(entry.pessoaId) || personIds.has(entryCpf));
    });
    if (!conflict) {
      if (person && !app.querySelector('#student-message').textContent) app.querySelector('#student-message').textContent = studentArchiveMessage;
      return false;
    }
    form.elements.cpf.setCustomValidity(studentTeamConflictMessage);
    app.querySelector('#student-message').textContent = studentTeamConflictMessage;
    if (focus) focusStudentIssue(form.elements.cpf);
    return true;
  };
  const warnDuplicateStudentCpf = async (focus = false) => {
    const cpf = normalizeCpf(form.elements.cpf.value);
    if (form.elements.cpf.validationMessage === duplicateStudentCpfMessage) form.elements.cpf.setCustomValidity('');
    if (app.querySelector('#student-message').textContent === duplicateStudentCpfMessage) app.querySelector('#student-message').textContent = '';
    if (cpf.length !== 11 || !isValidCpf(cpf)) return false;
    const previousId = form.elements.id?.value || '';
    const students = await dataService.listCursistas();
    const duplicated = students.find((student) => normalizeCpf(student.cpf || student.id) === cpf && student.id !== previousId);
    if (!duplicated) return false;
    form.elements.cpf.setCustomValidity(duplicateStudentCpfMessage);
    app.querySelector('#student-message').textContent = duplicateStudentCpfMessage;
    if (focus) focusStudentIssue(form.elements.cpf);
    return true;
  };
  const checkStudentCpf = async (focus = false) => {
    if (await warnStudentTeamConflict(focus)) return true;
    return warnDuplicateStudentCpf(focus);
  };
  form.elements.cpf.addEventListener('input', () => {
    if (normalizeCpf(form.elements.cpf.value).length === 11) checkStudentCpf();
  });
  form.elements.cpf.addEventListener('change', () => checkStudentCpf(true));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureRetreatCanBeChanged(focusStudentRetreat, 'salvar cursistas')) return;
    syncStudentConditionalRequired();
    const values = new FormData(form);
    const submitCpf = normalizeCpf(values.get('cpf'));
    if (isValidCpf(submitCpf) && await checkStudentCpf(true)) return;
    const firstIssue = firstStudentRequiredIssue();
    if (!form.checkValidity() || firstIssue) {
      studentRequiredReviewActive = true;
      app.querySelector('#student-message').textContent = 'Revise os campos obrigatórios antes de salvar.';
      focusStudentIssue(firstIssue);
      return;
    }
    const cpf = normalizeCpf(values.get('cpf'));
    if (!isValidCpf(cpf)) {
      app.querySelector('#student-message').textContent = 'Informe um CPF válido.';
      focusStudentIssue(form.elements.cpf);
      return;
    }
    if (await checkStudentCpf(true)) return;
    const previousId = values.get('id');
    const currentStudents = await dataService.listCursistas();
    const duplicatedCpf = currentStudents.find((student) => normalizeCpf(student.cpf || student.id) === cpf && student.id !== previousId);
    if (duplicatedCpf) {
      app.querySelector('#student-message').textContent = duplicateStudentCpfMessage;
      focusStudentIssue(form.elements.cpf);
      return;
    }
    const paidAmount = parseCurrency(values.get('valorPago'));
    const currentPaymentMethod = values.get('formaPagamento') || '';
    const currentPaymentObservation = values.get('observacaoPagamento') || '';
    if (paidAmount > 0 && !currentPaymentMethod) {
      app.querySelector('#student-message').textContent = 'Clique em Pago para informar a forma de pagamento antes de salvar.';
      return;
    }
    if (paidAmount > 0 && paymentMethodsWithObservation.has(currentPaymentMethod) && !currentPaymentObservation.trim()) {
      app.querySelector('#student-message').textContent = 'Informe a observação da forma de pagamento antes de salvar.';
      return;
    }
    values.set('recebedorValorPago', paidAmount > 0 ? paidAmount : 0);
    values.set('recebedorTaxaPaga', paidAmount > 0 && paidAmount >= parseCurrency(values.get('valorInscricao')) ? 'true' : '');
    if (paidAmount <= 0) {
      values.set('formaPagamento', '');
      values.set('observacaoPagamento', '');
      values.set('recebedorFormaPagamento', '');
      values.set('recebedorObservacao', '');
    }
    const currentStudent = previousId && currentStudents.find((student) => student.id === previousId);
    const record = { ...(currentStudent || {}), ...Object.fromEntries(values), id: cpf, cpf, criadoEm: currentStudent?.criadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString() };
    await dataService.saveCursista(record);
    if (previousId && previousId !== cpf) {
      const communities = await dataService.listComunidades();
      await Promise.all(communities.map((community) => {
        const membroIds = (community.membroIds || []).map((studentId) => studentId === previousId ? cpf : studentId);
        return membroIds.join('|') === (community.membroIds || []).join('|') ? null : dataService.saveComunidade({ ...community, membroIds });
      }).filter(Boolean));
      await dataService.deleteCursista(previousId);
    }
    form.reset();
    form.querySelector('.student-payment-comment')?.setAttribute('hidden', '');
    form.querySelector('#clear-student-payment')?.setAttribute('hidden', '');
    form.querySelector('input[name="id"]')?.remove();
    form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
    form.querySelector('button[type="submit"]').innerHTML = 'Salvar cadastro <span>→</span>';
    form.querySelector('.delete-student')?.setAttribute('hidden', '');
    app.querySelector('.student-heading-actions')?.setAttribute('hidden', '');
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      if (control.type !== 'hidden') control.disabled = true;
    });
    form.querySelector('button[type="submit"]').disabled = true;
    form.querySelector('#set-student-payment').disabled = true;
    form.querySelector('#clear-student-payment').disabled = true;
    app.querySelector('#student-message').textContent = 'Cadastro do cursista salvo com sucesso.';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
async function renderCursistaDetalhe(id) {
  const [students, allRetreats] = await Promise.all([dataService.listCursistas(), dataService.listRetiros()]);
  const student = students.find((item) => item.id === id);
  if (!student) { location.hash = '#cursista'; return; }
  const retreat = allRetreats.find((item) => item.id === student.retiroId);
  const canDeleteStudentDetail = canModifyRetreat(retreat);
  const field = (label, value) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || 'Não informado')}</span></div>`;
  const address = [student.rua, student.numero, student.bairro, student.cidade, student.estado].filter(Boolean).join(' · ');
  layout(`<section class="page-heading compact"><div><a class="back-link" href="#cursista">← Voltar</a><p class="eyebrow">Consulta de cursista</p><h1>${escapeHtml(student.nome || 'Cursista')}</h1><p>${retreat ? `Ficha cadastrada para ${escapeHtml(retreat.nome)}` : 'Cadastro de cursista'}</p></div></section><section class="panel"><h2>Dados pessoais</h2><div class="simple-list">${field('CPF', formatCpf(student.cpf || student.id))}${field('Nascimento', date(student.nascimento))}${field('Telefone', student.telefone)}${field('Endereço', address)}</div></section><section class="panel"><h2>Formação e vivência</h2><div class="simple-list">${field('É batizado(a)?', student.batizado)}${field('Fez primeira comunhão?', student.primeiraComunhao)}${field('Estuda?', student.estuda)}${field('Série', student.serie)}${field('Escola', student.escola)}${field('Fez algum retiro?', student.fezRetiro)}${field('Qual retiro?', student.qualRetiro)}</div></section><section class="panel"><h2>Família e convite</h2><div class="simple-list">${field('Pai', student.nomePai)}${field('Telefone do pai', student.telefonePai)}${field('Mãe', student.nomeMae)}${field('Telefone da mãe', student.telefoneMae)}${field('Movimento dos pais', student.paisMovimento)}${field('Qual movimento?', student.qualMovimento)}${field('Quem convidou?', student.convidou)}${field('Camiseta', student.camiseta)}</div></section><section class="panel"><h2>Saúde e inscrição</h2><div class="simple-list">${field('Intolerância a alimentos', student.intoleranciaAlimentos)}${field('Qual intolerância?', student.qualIntolerancia)}${field('Alergia a medicamento', student.alergiaMedicamento)}${field('Qual alergia?', student.qualAlergia)}${field('Medicamento para dor de cabeça', student.medicamentoCabeca)}${field('Medicamento para dor no estômago', student.medicamentoEstomago)}${field('Valor da inscrição', student.valorInscricao)}${field('Valor pago', student.valorPago)}${field('Saldo a pagar', student.saldoPagar)}</div></section><section class="panel"><div class="form-actions"><p>Esta ação remove o cadastro do cursista.</p><button type="button" id="delete-consulted-student" class="delete-student">Excluir cursista</button></div></section>`, 'cursista');
  if (!canDeleteStudentDetail) app.querySelector('#delete-consulted-student')?.closest('.panel')?.remove();
  app.querySelector('#delete-consulted-student')?.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'excluir cursistas')) return;
    if (!confirm('Excluir este cursista?')) return;
    await removeStudentFromCommunities(student);
    await dataService.deleteCursista(student.id);
    location.hash = '#cursista';
  });
}
async function renderComunidades() {
  const retreat = selectedRetreat();
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Grupos do retiro</p><h1>Comunidades</h1><p>Crie ou publique um retiro para montar as comunidades.</p></div></section>', 'comunidades'); return; }
  const [students, allCommunities] = await Promise.all([dataService.listCursistas(), dataService.listComunidades()]);
  const communities = sortCommunitiesByPosition(allCommunities.filter((community) => community.retiroId === retreat.id));
  const entries = mergeEnrolmentsByParticipant(enrolments.filter((entry) => entry.retiroId === retreat.id));
  const leaders = [...new Set(entries.filter((entry) => entry.casalId && entryHasSector(entry, 'Tios de comunidade')).map((entry) => entry.casalId))].map((casalId) => { const pair = entries.filter((entry) => entry.casalId === casalId); return { casalId, label: pair.map((entry) => entry.nome).join(' e ') }; });
  const monitorCandidates = [...new Set(entries.filter((entry) => entry.casalId && (entry.setores || []).some((sector) => normalizeText(sector).includes('monitor'))).map((entry) => entry.casalId))].map((casalId) => { const pair = entries.filter((entry) => entry.casalId === casalId); return { casalId, label: pair.map((entry) => entry.nome).join(' e ') }; });
  const retreatStudentRecords = students.filter((student) => student.retiroId === retreat.id);
  const retreatStudents = uniqueByParticipant(retreatStudentRecords);
  const canEditCommunities = canModifyRetreat(retreat);
  const assignedStudentIds = new Set(communities.flatMap((community) => community.membroIds || []));
  const assignedStudentKeys = new Set(retreatStudentRecords.filter((student) => assignedStudentIds.has(student.id)).map(participantIdentity));
  const studentsWithoutCommunity = retreatStudents.filter((student) => !assignedStudentKeys.has(participantIdentity(student))).length;
  const communitiesWithoutLeaders = communities.filter((community) => !community.liderCasalId).length;
  const communitiesWithoutMonitor = communities.filter((community) => !community.monitorCasalId && !(community.monitorIds || []).length).length;
  const leaderOptions = (selected) => `<option value="">Buscar tios da comunidade</option>${leaders.map((leader) => `<option value="${leader.casalId}" ${leader.casalId === selected ? 'selected' : ''}>${escapeHtml(leader.label)}</option>`).join('')}`;
  const monitorOptions = (selected) => `<option value="">Buscar monitores da comunidade</option>${monitorCandidates.map((monitor) => `<option value="${monitor.casalId}" ${monitor.casalId === selected ? 'selected' : ''}>${escapeHtml(monitor.label)}</option>`).join('')}`;
  const moveOptions = (currentCommunityId) => `<option value="">Mover para...</option>${communities.filter((community) => community.id !== currentCommunityId).map((community) => `<option value="${community.id}">${escapeHtml(community.nome || `Comunidade ${community.ordem || ''}`)}</option>`).join('')}`;
  layout(`<section class="page-heading"><div><p class="eyebrow">Grupos do retiro</p><h1>Comunidades</h1><p>${escapeHtml(retreat.nome)} · Forme grupos e distribua os cursistas.</p><div class="community-overview"><article><span>Cursistas sem comunidade</span><strong>${studentsWithoutCommunity}</strong></article><article><span>Comunidades sem tios</span><strong>${communitiesWithoutLeaders}</strong></article><article><span>Comunidades sem monitor</span><strong>${communitiesWithoutMonitor}</strong></article></div></div><div class="detail-actions"><button class="primary-button" id="add-community" type="button">Incluir comunidade</button><button class="secondary-button" id="distribute-students" type="button" ${communities.length ? '' : 'disabled'}>Distribuir cursistas</button></div></section><section class="community-grid">${communities.map((community, index) => { const memberIds = new Set(community.membroIds || []); const members = uniqueByParticipant(retreatStudentRecords.filter((student) => memberIds.has(student.id))).sort((first, second) => new Date(second.nascimento) - new Date(first.nascimento)); return `<article class="community-card"><div class="community-card-heading"><label class="field"><span>Nome da comunidade</span><input class="community-rename" data-community-name="${community.id}" value="${escapeHtml(community.nome || `Comunidade ${index + 1}`)}"></label><div class="community-order-summary"><label class="field community-order-field"><span>Ordem</span><input data-community-order="${community.id}" type="number" min="1" step="1" value="${Number(community.ordem) || index + 1}"></label><div class="community-count"><span>Cursistas</span><strong>${members.length}</strong></div></div></div><div class="community-role-grid"><label class="field"><span>Buscar tios da comunidade</span><div class="community-role-control"><select data-community-leader="${community.id}">${leaderOptions(community.liderCasalId)}</select>${community.liderCasalId ? `<button type="button" data-remove-community-leader="${community.id}">Remover</button>` : ''}</div></label><label class="field"><span>Buscar monitores da comunidade</span><div class="community-role-control"><select data-community-monitor="${community.id}">${monitorOptions(community.monitorCasalId || community.monitorIds?.[0] || '')}</select>${community.monitorCasalId ? `<button type="button" data-remove-community-monitor="${community.id}">Remover</button>` : ''}</div></label></div><div class="community-members">${members.length ? members.map((student) => `<div><span>${escapeHtml(student.nome)} <small>${ageInYearsAndMonths(student.nascimento)}</small></span><select data-move-student="${student.id}" data-current-community="${community.id}">${moveOptions(community.id)}</select><button type="button" data-remove-member="${community.id}" data-student="${student.id}">Remover</button></div>`).join('') : '<p>Nenhum cursista alocado.</p>'}</div><button type="button" class="delete-community" data-delete-community="${community.id}" ${members.length ? 'disabled' : ''}>Excluir comunidade</button></article>`; }).join('') || '<div class="empty-state">Nenhuma comunidade criada ainda. Use Incluir comunidade para iniciar.</div>'}</section>`, 'comunidades');
  if (!canAccess('comunidades.criar') || !canEditCommunities) app.querySelector('#add-community')?.remove();
  if (!canAccess('comunidades.editar') || !canEditCommunities) {
    app.querySelector('#distribute-students')?.remove();
    app.querySelectorAll('[data-community-name], [data-community-order], [data-community-leader], [data-community-monitor], [data-move-student]').forEach((control) => { control.disabled = true; });
    app.querySelectorAll('[data-remove-community-leader], [data-remove-community-monitor], [data-remove-member]').forEach((button) => button.remove());
  }
  if (!canAccess('comunidades.excluir') || !canEditCommunities) app.querySelectorAll('[data-delete-community]').forEach((button) => button.remove());
  app.querySelector('#add-community')?.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'incluir comunidades')) return;
    const latestCommunities = sortCommunitiesByPosition((await dataService.listComunidades()).filter((community) => community.retiroId === retreat.id));
    const nextOrder = Math.max(0, ...latestCommunities.map((community) => Number(community.ordem) || 0)) + 1;
    await dataService.saveComunidade({ id: createId(), retiroId: retreat.id, nome: `Comunidade ${nextOrder}`, liderCasalId: '', monitorCasalId: '', monitorIds: [], membroIds: [], ordem: nextOrder, criadoEm: new Date().toISOString() });
    renderComunidades();
  });
  app.querySelectorAll('[data-community-name]').forEach((input) => input.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === input.dataset.communityName); community.nome = input.value.trim() || `Comunidade ${community.ordem}`; await dataService.saveComunidade(community); input.value = community.nome; }));
  app.querySelectorAll('[data-community-order]').forEach((input) => input.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === input.dataset.communityOrder); const ordem = Number(input.value); if (!community || !Number.isInteger(ordem) || ordem <= 0) { input.value = Number(community?.ordem) || 1; return; } community.ordem = ordem; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-community-leader]').forEach((select) => select.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === select.dataset.communityLeader); community.liderCasalId = select.value; await dataService.saveComunidade(community); }));
  app.querySelectorAll('[data-community-monitor]').forEach((select) => select.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === select.dataset.communityMonitor); community.monitorCasalId = select.value; community.monitorIds = []; await dataService.saveComunidade(community); }));
  app.querySelectorAll('[data-remove-community-leader]').forEach((button) => button.addEventListener('click', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === button.dataset.removeCommunityLeader); community.liderCasalId = ''; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-remove-community-monitor]').forEach((button) => button.addEventListener('click', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === button.dataset.removeCommunityMonitor); community.monitorCasalId = ''; community.monitorIds = []; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-move-student]').forEach((select) => select.addEventListener('change', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return;
    const studentId = select.dataset.moveStudent;
    const targetCommunityId = select.value;
    if (!studentId || !targetCommunityId) return;
    select.disabled = true;
    const latestCommunities = sortCommunitiesByPosition((await dataService.listComunidades()).filter((community) => community.retiroId === retreat.id));
    for (const community of latestCommunities) {
      const memberIds = (community.membroIds || []).filter((id) => id !== studentId);
      if (community.id === targetCommunityId) memberIds.push(studentId);
      await dataService.saveComunidade({ ...community, membroIds: [...new Set(memberIds)] });
    }
    renderComunidades();
  }));
  app.querySelectorAll('[data-remove-member]').forEach((button) => button.addEventListener('click', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === button.dataset.removeMember); community.membroIds = (community.membroIds || []).filter((id) => id !== button.dataset.student); await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-delete-community]').forEach((button) => button.addEventListener('click', async () => { if (!ensureRetreatCanBeChanged(retreat, 'excluir comunidades')) return; const community = communities.find((item) => item.id === button.dataset.deleteCommunity); if (!confirm(`Excluir ${community.nome}?`)) return; await dataService.deleteComunidade(community.id); renderComunidades(); }));
  app.querySelector('#distribute-students')?.addEventListener('click', () => {
    if (!ensureRetreatCanBeChanged(retreat, 'distribuir cursistas em comunidades')) return;
    const overlay = document.createElement('section'); overlay.className = 'receiver-sector-overlay';
    const communityOptions = (selected = '') => `<option value="">Sem comunidade</option>${communities.map((community) => `<option value="${community.id}" ${community.id === selected ? 'selected' : ''}>${escapeHtml(community.nome || `Comunidade ${community.ordem || ''}`)}</option>`).join('')}`;
    overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Distribuição de cursistas</p><h2>Exportar para a comunidade</h2><p>Escolha a comunidade de cada cursista e clique em exportar para a comunidade.</p></div></div><div class="community-export-list">${retreatStudents.map((student) => { const current = communities.find((community) => (community.membroIds || []).includes(student.id)); return `<div><strong>${escapeHtml(student.nome)}</strong><span>${ageInYearsAndMonths(student.nascimento)}</span><select data-student-community="${student.id}">${communityOptions(current?.id)}</select></div>`; }).join('') || '<p>Nenhum cursista cadastrado.</p>'}</div><p id="community-export-message" class="form-message"></p><div class="form-actions"><button type="button" class="close-sector-view">Fechar</button><button type="button" class="suggest-by-age" id="suggest-by-age" ${communities.length ? '' : 'disabled'}>Fazer uma sugestão por idade</button><button type="button" id="export-students" class="is-couple-continue">Exportar para a comunidade</button></div></div>`;
    overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#suggest-by-age').addEventListener('click', () => { const ordered = [...retreatStudents].sort((first, second) => new Date(second.nascimento) - new Date(first.nascimento)); const base = Math.floor(ordered.length / communities.length); const extra = ordered.length % communities.length; let cursor = 0; communities.forEach((community, index) => { const size = base + (index >= communities.length - extra ? 1 : 0); ordered.slice(cursor, cursor + size).forEach((student) => { overlay.querySelector(`[data-student-community="${student.id}"]`).value = community.id; }); cursor += size; }); });
    overlay.querySelector('#export-students').addEventListener('click', async () => {
      const exportButton = overlay.querySelector('#export-students');
      const message = overlay.querySelector('#community-export-message');
      const selections = [...overlay.querySelectorAll('[data-student-community]')]
        .map((input) => ({ studentId: input.dataset.studentCommunity, communityId: input.value }))
        .filter((item) => item.communityId);
      if (!selections.length) {
        message.textContent = 'Escolha pelo menos uma comunidade antes de exportar.';
        return;
      }
      if (!ensureRetreatCanBeChanged(retreat, 'distribuir cursistas em comunidades')) return;
      exportButton.disabled = true;
      message.textContent = 'Exportando cursistas...';
      try {
        const latestCommunities = sortCommunitiesByPosition((await dataService.listComunidades()).filter((community) => community.retiroId === retreat.id));
        const selectedByCommunity = new Map(latestCommunities.map((community) => [community.id, []]));
        selections.forEach((selection) => {
          if (selectedByCommunity.has(selection.communityId)) selectedByCommunity.get(selection.communityId).push(selection.studentId);
        });
        for (const community of latestCommunities) {
          await dataService.saveComunidade({ ...community, membroIds: selectedByCommunity.get(community.id) || [] });
        }
        overlay.remove();
        await renderComunidades();
      } catch (error) {
        exportButton.disabled = false;
        message.textContent = `Não foi possível exportar: ${error.message || 'erro inesperado'}.`;
      }
    });
    app.append(overlay);
  });
}

const badgeSettingsKey = 'epc-badge-settings';
const badgeProfilesKey = 'epc-badge-profiles';
const badgeProfilesMigratedKey = 'epc-badge-profiles-migrated';
const badgeSettingsVersion = 2;
const defaultBadgeSettings = {
  version: badgeSettingsVersion,
  logo: 'epc',
  wallpaper: 'none',
  wallpaperUrl: '',
  watermark: 'none',
  watermarkUrl: '',
  slogan: 'Familia unida, filhos com vida!',
  background: '#fffaf0',
  accent: '#47724e',
  text: '#3a2614',
  muted: '#68737a',
  border: '#d7a752',
  font: 'DM Sans',
  align: 'center',
  textTarget: 'name',
  nameFont: 'DM Sans',
  sectorFont: 'DM Sans',
  sloganFont: 'DM Sans',
  nameAlign: 'center',
  sectorAlign: 'center',
  sloganAlign: 'center',
  sloganColor: '#3a2614',
  logoSize: 18,
  logoX: 14,
  logoY: 13,
  nameSize: 10.5,
  sectorSize: 5,
  sloganSize: 3.4,
  watermarkOpacity: 12,
  watermarkSize: 62,
  watermarkX: 50,
  watermarkY: 52,
  corner: 4,
  borderWidth: 0.6,
};

const loadBadgeSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(badgeSettingsKey) || '{}') || {};
    const settings = { ...defaultBadgeSettings, ...saved };
    if (settings.version !== badgeSettingsVersion) {
      settings.version = badgeSettingsVersion;
      settings.wallpaper = 'none';
      settings.wallpaperUrl = '';
      settings.watermark = 'none';
      settings.watermarkUrl = '';
      saveBadgeSettings(settings);
    }
    return settings;
  } catch {
    return { ...defaultBadgeSettings };
  }
};
const saveBadgeSettings = (settings) => localStorage.setItem(badgeSettingsKey, JSON.stringify(settings));
const normalizeBadgeProfile = (profile = {}, retreatId = '') => {
  const rawSettings = profile.settings || profile;
  const { id, name, retiroId, retreatId: legacyRetreatId, updatedAt, createdAt, clonedFromRetreatId, sourceProfileId, ...settingsOnly } = rawSettings;
  return {
    id: profile.id || id || createId(),
    retiroId: profile.retiroId || profile.retreatId || retreatId || legacyRetreatId || '',
    name: String(profile.name || name || '').trim() || 'Configuracao sem nome',
    settings: { ...defaultBadgeSettings, ...settingsOnly, ...(profile.settings || {}), version: badgeSettingsVersion },
    createdAt: profile.createdAt || createdAt || new Date().toISOString(),
    updatedAt: profile.updatedAt || updatedAt || new Date().toISOString(),
    clonedFromRetreatId: profile.clonedFromRetreatId || clonedFromRetreatId || '',
    sourceProfileId: profile.sourceProfileId || sourceProfileId || '',
  };
};
const loadLegacyBadgeProfiles = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(badgeProfilesKey) || '[]');
    return Array.isArray(saved) ? saved.map((profile) => normalizeBadgeProfile(profile)).filter((profile) => profile.name) : [];
  } catch {
    return [];
  }
};
const migrateLegacyBadgeProfiles = async (retreatId = '') => {
  if (!retreatId || localStorage.getItem(`${badgeProfilesMigratedKey}-${retreatId}`) === '1') return;
  const legacyProfiles = loadLegacyBadgeProfiles();
  if (!legacyProfiles.length) {
    localStorage.setItem(`${badgeProfilesMigratedKey}-${retreatId}`, '1');
    return;
  }
  const storedProfiles = await dataService.listCrachas();
  const storedIds = new Set(storedProfiles.map((profile) => profile.id));
  const profilesToMigrate = legacyProfiles
    .filter((profile) => !profile.retiroId || profile.retiroId === retreatId)
    .map((profile) => normalizeBadgeProfile(profile, retreatId))
    .filter((profile) => !storedIds.has(profile.id));
  await Promise.all(profilesToMigrate.map((profile) => dataService.saveCracha(profile)));
  localStorage.setItem(`${badgeProfilesMigratedKey}-${retreatId}`, '1');
};
const loadBadgeProfiles = async (retreatId = '') => {
  await migrateLegacyBadgeProfiles(retreatId);
  const profiles = await dataService.listCrachas();
  return profiles
    .map((profile) => normalizeBadgeProfile(profile, retreatId))
    .filter((profile) => profile.name && profile.retiroId === retreatId)
    .sort((first, second) => String(second.updatedAt || '').localeCompare(String(first.updatedAt || '')));
};
const saveBadgeProfile = (profile) => dataService.saveCracha(normalizeBadgeProfile(profile, profile.retiroId));
const deleteBadgeProfile = (profileId) => dataService.deleteCracha(profileId);
const copyBadgeProfilesToRetreat = async (sourceRetreatId, targetRetreatId) => {
  if (!sourceRetreatId || !targetRetreatId) return;
  await migrateLegacyBadgeProfiles(sourceRetreatId);
  const profiles = (await dataService.listCrachas())
    .map((profile) => normalizeBadgeProfile(profile, sourceRetreatId))
    .filter((profile) => profile.retiroId === sourceRetreatId);
  const now = new Date().toISOString();
  await Promise.all(profiles.map((profile) => saveBadgeProfile({
    ...profile,
    id: createId(),
    retiroId: targetRetreatId,
    settings: { ...profile.settings },
    createdAt: now,
    updatedAt: now,
    clonedFromRetreatId: sourceRetreatId,
    sourceProfileId: profile.id,
  })));
};
const badgeLogoOptions = [{ id: 'none', name: 'Sem logo', src: '' }, ...publicBadgeLogos];
const logoById = (id) => badgeLogoOptions.find((logo) => logo.id === id) || publicBadgeLogos[0];
const nativeBadgeWallpapers = [
  ['none', 'Sem papel de parede', 'none'],
  ['sunrise', 'Luz suave', 'radial-gradient(circle at 15% 10%, color-mix(in srgb, var(--badge-accent) 38%, transparent), transparent 32%), linear-gradient(135deg, rgba(255,250,240,.96), color-mix(in srgb, var(--badge-accent) 18%, white))'],
  ['folhas', 'Folhas discretas', 'radial-gradient(ellipse at 12% 18%, color-mix(in srgb, var(--badge-accent) 22%, transparent) 0 12%, transparent 13%), radial-gradient(ellipse at 86% 76%, color-mix(in srgb, var(--badge-accent) 16%, transparent) 0 14%, transparent 15%), linear-gradient(135deg, rgba(255,253,247,.96), color-mix(in srgb, var(--badge-accent) 14%, white))'],
  ['ondas', 'Ondas claras', 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--badge-accent) 22%, transparent) 0 8px, color-mix(in srgb, var(--badge-accent) 5%, transparent) 8px 18px), linear-gradient(135deg, rgba(255,253,247,.96), color-mix(in srgb, var(--badge-accent) 12%, white))'],
  ['dourado', 'Dourado sutil', 'radial-gradient(circle at 82% 18%, color-mix(in srgb, var(--badge-accent) 34%, transparent), transparent 28%), radial-gradient(circle at 8% 88%, color-mix(in srgb, var(--badge-accent) 22%, transparent), transparent 30%), linear-gradient(135deg, rgba(255,250,240,.96), color-mix(in srgb, var(--badge-accent) 18%, white))'],
  ['linhas', 'Linhas finas', 'linear-gradient(90deg, color-mix(in srgb, var(--badge-accent) 10%, transparent) 1px, transparent 1px), linear-gradient(0deg, color-mix(in srgb, var(--badge-accent) 8%, transparent) 1px, transparent 1px), linear-gradient(135deg, rgba(255,253,247,.98), color-mix(in srgb, var(--badge-accent) 10%, white))'],
  ['aurora', 'Aurora', 'radial-gradient(circle at 18% 22%, color-mix(in srgb, var(--badge-accent) 42%, transparent), transparent 30%), radial-gradient(circle at 74% 72%, color-mix(in srgb, var(--badge-accent) 18%, transparent), transparent 26%), linear-gradient(125deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 16%, white))'],
  ['diagonal', 'Diagonal leve', 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--badge-accent) 14%, transparent) 0 3px, transparent 3px 13px), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 10%, white))'],
  ['pontilhado', 'Pontilhado', 'radial-gradient(circle, color-mix(in srgb, var(--badge-accent) 24%, transparent) 1.2px, transparent 1.5px), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 9%, white))'],
  ['mosaico', 'Mosaico suave', 'linear-gradient(45deg, color-mix(in srgb, var(--badge-accent) 12%, transparent) 25%, transparent 25% 75%, color-mix(in srgb, var(--badge-accent) 10%, transparent) 75%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 12%, white))'],
  ['halo', 'Halo central', 'radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--badge-accent) 24%, transparent), transparent 42%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
  ['cantos', 'Cantos coloridos', 'radial-gradient(circle at 0 0, color-mix(in srgb, var(--badge-accent) 32%, transparent), transparent 28%), radial-gradient(circle at 100% 100%, color-mix(in srgb, var(--badge-accent) 26%, transparent), transparent 30%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 10%, white))'],
  ['faixa', 'Faixa lateral', 'linear-gradient(90deg, color-mix(in srgb, var(--badge-accent) 30%, white) 0 16%, transparent 16%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
  ['faixa-baixo', 'Faixa inferior', 'linear-gradient(0deg, color-mix(in srgb, var(--badge-accent) 26%, white) 0 18%, transparent 18%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
  ['xadrez', 'Xadrez claro', 'linear-gradient(90deg, color-mix(in srgb, var(--badge-accent) 9%, transparent) 50%, transparent 50%), linear-gradient(0deg, color-mix(in srgb, var(--badge-accent) 9%, transparent) 50%, transparent 50%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 7%, white))'],
  ['cruzado', 'Linhas cruzadas', 'repeating-linear-gradient(30deg, color-mix(in srgb, var(--badge-accent) 13%, transparent) 0 1px, transparent 1px 12px), repeating-linear-gradient(150deg, color-mix(in srgb, var(--badge-accent) 10%, transparent) 0 1px, transparent 1px 14px), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 7%, white))'],
  ['nuvem', 'Nuvem suave', 'radial-gradient(ellipse at 30% 25%, color-mix(in srgb, var(--badge-accent) 18%, transparent) 0 18%, transparent 19%), radial-gradient(ellipse at 62% 34%, color-mix(in srgb, var(--badge-accent) 14%, transparent) 0 16%, transparent 17%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
  ['topografia', 'Topografia', 'repeating-radial-gradient(circle at 20% 30%, color-mix(in srgb, var(--badge-accent) 14%, transparent) 0 1px, transparent 1px 8px), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 7%, white))'],
  ['arco', 'Arcos', 'radial-gradient(circle at 0 50%, transparent 0 28%, color-mix(in srgb, var(--badge-accent) 15%, transparent) 29% 30%, transparent 31%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 9%, white))'],
  ['rays', 'Raios leves', 'conic-gradient(from 20deg at 18% 20%, color-mix(in srgb, var(--badge-accent) 18%, transparent), transparent 18deg 45deg, color-mix(in srgb, var(--badge-accent) 10%, transparent) 46deg 70deg, transparent 71deg), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
  ['grade-fina', 'Grade fina', 'linear-gradient(90deg, color-mix(in srgb, var(--badge-accent) 12%, transparent) 1px, transparent 1px), linear-gradient(0deg, color-mix(in srgb, var(--badge-accent) 12%, transparent) 1px, transparent 1px), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
  ['seda', 'Seda', 'linear-gradient(115deg, transparent 0 28%, color-mix(in srgb, var(--badge-accent) 13%, transparent) 29% 34%, transparent 35% 100%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 11%, white))'],
  ['brilho', 'Brilho discreto', 'radial-gradient(circle at 78% 20%, color-mix(in srgb, var(--badge-accent) 30%, transparent), transparent 24%), radial-gradient(circle at 42% 78%, color-mix(in srgb, var(--badge-accent) 16%, transparent), transparent 20%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 9%, white))'],
  ['folhas-largas', 'Folhas largas', 'radial-gradient(ellipse at 8% 78%, color-mix(in srgb, var(--badge-accent) 18%, transparent) 0 18%, transparent 19%), radial-gradient(ellipse at 94% 18%, color-mix(in srgb, var(--badge-accent) 20%, transparent) 0 20%, transparent 21%), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 9%, white))'],
  ['ondas-finas', 'Ondas finas', 'repeating-radial-gradient(ellipse at 50% -20%, color-mix(in srgb, var(--badge-accent) 12%, transparent) 0 2px, transparent 2px 11px), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
  ['papel', 'Papel texturizado', 'repeating-linear-gradient(8deg, color-mix(in srgb, var(--badge-accent) 7%, transparent) 0 1px, transparent 1px 5px), repeating-linear-gradient(98deg, color-mix(in srgb, var(--badge-accent) 5%, transparent) 0 1px, transparent 1px 7px), linear-gradient(135deg, #fffdf7, color-mix(in srgb, var(--badge-accent) 8%, white))'],
];
const wallpaperById = (id) => nativeBadgeWallpapers.find(([key]) => key === id) || nativeBadgeWallpapers[0];
const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || 'Voluntario';
const personForBadge = (entry) => people.find((person) => person.id === entry.pessoaId) || entry.dadosPessoais || entry;
const genderedLabel = (person, feminine, masculine) => normalizeText(person?.genero) === 'feminino' ? feminine : masculine;
const badgeDisplayName = (entry) => {
  const person = personForBadge(entry);
  return firstName(person.nome || entry.nome);
};
const badgeSectorText = (entry, sector = '') => {
  const person = personForBadge(entry);
  const label = sector || (entry.setores || []).join(', ') || 'Sem setor';
  return entry.coordenacaoSetor ? `${genderedLabel(person, 'Coordenadora', 'Coordenador')} ${label}` : label;
};
const badgeInlineStyle = (settings) => [
  `--badge-bg:${settings.background}`,
  `--badge-accent:${settings.accent}`,
  `--badge-text:${settings.text}`,
  `--badge-muted:${settings.muted}`,
  `--badge-slogan-color:${settings.sloganColor}`,
  `--badge-border:${settings.border}`,
  `--badge-font:${settings.font}`,
  `--badge-align:${settings.align}`,
  `--badge-justify:${settings.align === 'left' ? 'start' : settings.align === 'right' ? 'end' : 'center'}`,
  `--badge-name-font:${settings.nameFont}`,
  `--badge-sector-font:${settings.sectorFont}`,
  `--badge-slogan-font:${settings.sloganFont}`,
  `--badge-name-align:${settings.nameAlign}`,
  `--badge-sector-align:${settings.sectorAlign}`,
  `--badge-slogan-align:${settings.sloganAlign}`,
  `--badge-name-justify:${settings.nameAlign === 'left' ? 'start' : settings.nameAlign === 'right' ? 'end' : 'center'}`,
  `--badge-sector-justify:${settings.sectorAlign === 'left' ? 'start' : settings.sectorAlign === 'right' ? 'end' : 'center'}`,
  `--badge-slogan-justify:${settings.sloganAlign === 'left' ? 'start' : settings.sloganAlign === 'right' ? 'end' : 'center'}`,
  `--badge-logo:${settings.logoSize}mm`,
  `--badge-logo-x:${settings.logoX}%`,
  `--badge-logo-y:${settings.logoY}%`,
  `--badge-name:${settings.nameSize}mm`,
  `--badge-sector:${settings.sectorSize}mm`,
  `--badge-slogan:${settings.sloganSize}mm`,
  `--badge-watermark-opacity:${Number(settings.watermarkOpacity) / 100}`,
  `--badge-watermark-size:${settings.watermarkSize}mm`,
  `--badge-watermark-x:${settings.watermarkX}%`,
  `--badge-watermark-y:${settings.watermarkY}%`,
  `--badge-corner:${settings.corner}mm`,
  `--badge-border-width:${settings.borderWidth}mm`,
].join(';');
const badgeWallpaperStyle = (settings) => {
  if (!settings.wallpaper || settings.wallpaper === 'none' || settings.wallpaper === 'custom') return ' style="background-image:linear-gradient(135deg, color-mix(in srgb, var(--badge-accent) 26%, white), color-mix(in srgb, var(--badge-accent) 8%, white))"';
  const [, , value] = wallpaperById(settings.wallpaper);
  const image = settings.wallpaper === 'custom' ? settings.wallpaperUrl : value;
  if (!image || image === 'none') return '';
  const backgroundImage = settings.wallpaper === 'custom' ? `url("${String(image).replace(/"/g, '\\"')}")` : image;
  return ` style="background-image:${escapeHtml(backgroundImage)}"`;
};
const badgeCard = (entry, settings, sector = '') => {
  const logo = logoById(settings.logo);
  const showLogo = logo.id !== 'none' && logo.src;
  const watermark = settings.watermark && settings.watermark !== 'none' ? (settings.watermark === 'custom' ? settings.watermarkUrl : logoById(settings.watermark)?.src) : '';
  return `<article class="badge-card" style="${escapeHtml(badgeInlineStyle(settings))}">
    ${badgeWallpaperStyle(settings) ? `<div class="badge-wallpaper"${badgeWallpaperStyle(settings)}></div>` : ''}
    ${watermark ? `<img class="badge-watermark" src="${escapeHtml(watermark)}" alt="">` : ''}
    ${showLogo ? `<img class="badge-logo" src="${escapeHtml(logo.src)}" alt="${escapeHtml(logo.name)}">` : ''}
    <div class="badge-main">
      <strong>${escapeHtml(badgeDisplayName(entry))}</strong>
      <span>${escapeHtml(badgeSectorText(entry, sector))}</span>
    </div>
    <footer>${escapeHtml(settings.slogan || '')}</footer>
  </article>`;
};
const blankBadgeCard = (settings) => {
  const logo = logoById(settings.logo);
  const showLogo = logo.id !== 'none' && logo.src;
  const watermark = settings.watermark && settings.watermark !== 'none' ? (settings.watermark === 'custom' ? settings.watermarkUrl : logoById(settings.watermark)?.src) : '';
  return `<article class="badge-card" style="${escapeHtml(badgeInlineStyle(settings))}">
    ${badgeWallpaperStyle(settings) ? `<div class="badge-wallpaper"${badgeWallpaperStyle(settings)}></div>` : ''}
    ${watermark ? `<img class="badge-watermark" src="${escapeHtml(watermark)}" alt="">` : ''}
    ${showLogo ? `<img class="badge-logo" src="${escapeHtml(logo.src)}" alt="${escapeHtml(logo.name)}">` : ''}
    <div class="badge-main"><strong>&nbsp;</strong><span>&nbsp;</span></div>
    <footer>${escapeHtml(settings.slogan || '')}</footer>
  </article>`;
};
const sampleBadgeCard = (settings) => {
  const logo = logoById(settings.logo);
  const showLogo = logo.id !== 'none' && logo.src;
  const watermark = settings.watermark && settings.watermark !== 'none' ? (settings.watermark === 'custom' ? settings.watermarkUrl : logoById(settings.watermark)?.src) : '';
  return `<article class="badge-card" style="${escapeHtml(badgeInlineStyle(settings))}">
    ${badgeWallpaperStyle(settings) ? `<div class="badge-wallpaper"${badgeWallpaperStyle(settings)}></div>` : ''}
    ${watermark ? `<img class="badge-watermark" src="${escapeHtml(watermark)}" alt="">` : ''}
    ${showLogo ? `<img class="badge-logo" src="${escapeHtml(logo.src)}" alt="${escapeHtml(logo.name)}">` : ''}
    <div class="badge-main"><strong>Nome</strong><span>Setor</span></div>
    <footer>${escapeHtml(settings.slogan || '')}</footer>
  </article>`;
};

async function renderCrachas() {
  const retreat = selectedRetreat();
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Identifica&ccedil;&atilde;o</p><h1>Crach&aacute;s</h1><p>Crie ou publique um retiro para gerar os crach&aacute;s.</p></div></section>', 'crachas'); return; }
  let settings = loadBadgeSettings();
  const [allCommunities, allStudents] = await Promise.all([dataService.listComunidades(), dataService.listCursistas()]);
  const badgeCommunities = sortCommunitiesByPosition(allCommunities.filter((community) => community.retiroId === retreat.id));
  const badgeStudents = uniqueByParticipant(allStudents.filter((student) => student.retiroId === retreat.id));
  const entries = mergeEnrolmentsByParticipant(enrolments.filter((entry) => entry.retiroId === retreat.id && entry.setores?.length))
    .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }));
  const sectors = sortSectors(uniqueSectors([...(retreat.setores || []), ...entries.flatMap((entry) => entry.setores || [])]));
  const badgeSectorCount = (sector) => entries.filter((entry) => entryHasSector(entry, sector)).length;
  let badgeProfiles = await loadBadgeProfiles(retreat.id);
  let selectedProfileId = '';
  let blankPreview = false;
  let selectedCommunityId = badgeCommunities[0]?.id || '';
  let activePrintMode = '';
  let badgeManualSelection = null;
  let activeBadgeView = '';
  let sectorPickerOpen = false;
  let personPickerOpen = false;
  const canConfigureBadges = canAccess('crachas.editar') && canModifyRetreat(retreat);
  const canPrintBadges = canAccess('crachas.imprimir');
  const canDeleteBadges = canAccess('crachas.excluir') && canModifyRetreat(retreat);
  const profileOptions = () => `<option value="">Selecione um modelo</option>${badgeProfiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join('')}`;
  const logoOptions = badgeLogoOptions.map((logo) => `<label class="badge-logo-option"><input type="radio" name="logo" value="${escapeHtml(logo.id)}" ${settings.logo === logo.id ? 'checked' : ''}><span>${logo.src ? `<img src="${escapeHtml(logo.src)}" alt="">` : '<i aria-hidden="true">--</i>'}<b>${escapeHtml(logo.name)}</b></span></label>`).join('');
  const watermarkOptions = [
    ['none', 'Sem marca'],
    ...publicBadgeLogos.map((logo) => [logo.id, logo.name]),
    ['custom', 'Imagem informada'],
  ].map(([id, label]) => `<option value="${escapeHtml(id)}" ${settings.watermark === id ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const wallpaperOptions = nativeBadgeWallpapers.map(([id, label]) => `<option value="${escapeHtml(id)}" ${settings.wallpaper === id ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const cursiveFonts = new Set(['Playwrite BR', 'Segoe Script', 'Segoe Print', 'Lucida Handwriting', 'Brush Script MT', 'Monotype Corsiva', 'Snell Roundhand', 'Apple Chancery', 'Bradley Hand', 'cursive']);
  const fontStack = (font) => font === 'cursive' ? 'cursive' : `'${font}', ${cursiveFonts.has(font) ? 'cursive' : 'sans-serif'}`;
  const fontOptions = ['DM Sans', 'Fraunces', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Palatino Linotype', 'Garamond', 'Playwrite BR', 'Segoe Script', 'Segoe Print', 'Lucida Handwriting', 'Brush Script MT', 'Monotype Corsiva', 'Comic Sans MS', 'Snell Roundhand', 'Apple Chancery', 'Bradley Hand', 'cursive']
    .map((font) => `<option value="${escapeHtml(font)}" style="font-family:${escapeHtml(fontStack(font))}">${escapeHtml(font)}</option>`).join('');
  const activeTextColor = settings.textTarget === 'sector' ? settings.muted : settings.textTarget === 'slogan' ? settings.sloganColor : settings.text;
  const stepper = (label, name, min, max, step, value, hideValue = false) => `<label class="badge-stepper${hideValue ? ' is-value-hidden' : ''}"><span>${label}<button type="button" data-step-target="${name}" data-step="-${step}">-</button><button type="button" data-step-target="${name}" data-step="${step}">+</button></span><input name="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}"></label>`;
  layout(`<section class="page-heading badge-page-heading"><div><p class="eyebrow">Modelos de identifica&ccedil;&atilde;o</p><h1>Crach&aacute;s</h1><p>${escapeHtml(retreat.nome)} - Configure modelos ou selecione um modelo salvo para impress&atilde;o.</p></div></section>
  <section class="panel badge-start-panel" id="badge-start-panel">
    ${canConfigureBadges ? '<button type="button" class="primary-button" data-badge-view="config">Configurar crach&aacute;s</button>' : ''}
    ${canPrintBadges ? '<button type="button" class="secondary-button" data-badge-view="print">Imprimir crach&aacute;s</button>' : ''}
    ${!canConfigureBadges && !canPrintBadges ? '<p class="empty-state">Seu usuario pode visualizar a tela, mas nao possui permissao para configurar ou imprimir crachas.</p>' : ''}
  </section>
  <section class="badge-active-area" id="badge-active-area" hidden>
    <section class="panel badge-view-toolbar" id="badge-config-toolbar" hidden>
      <div class="panel-heading"><div><h2>Configurar crach&aacute;s</h2><p>Cadastre, altere e consulte modelos de crach&aacute;.</p></div>${canPrintBadges ? '<button type="button" class="secondary-button badge-view-switch" data-badge-view="print">Imprimir crach&aacute;s</button>' : ''}</div>
      <div class="badge-heading-tools">
      <label class="field"><span>Modelo do crach&aacute;</span><select id="badge-config-select">${profileOptions()}</select></label>
      <div class="badge-config-controls" hidden>
        <label class="field badge-print-mode-field"><span>O que imprimir</span><select id="badge-mode-unused"><option value="">Selecione...</option><option value="sector">Por setor</option><option value="community">Por comunidade</option></select></label>
        <p class="badge-print-comment" id="badge-print-comment-unused"></p>
        <select id="badge-sector-unused" hidden>${sectors.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)} (${badgeSectorCount(sector)})</option>`).join('')}</select>
        <select id="badge-person-unused" hidden>${entries.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.nome)} - ${escapeHtml((entry.setores || []).join(', '))}</option>`).join('')}</select>
      </div>
      <div class="badge-print-actions"><button class="secondary-button" id="badge-print" type="button">Imprimir</button><button class="primary-button" id="badge-word" type="button">Gerar arquivo editável</button></div>
      <div class="badge-model-toolbar">${canConfigureBadges ? '<button class="primary-button" id="badge-new-config" type="button">Novo modelo</button>' : ''}</div>
    </div></section>
  <section class="badge-workbench">
    <section class="panel badge-preview-panel">
      <div class="panel-heading"><div><h2>Pr&eacute;via</h2><p id="badge-print-summary">${entries.length} crach&aacute;(s) dispon&iacute;vel(is).</p></div></div>
      <div class="badge-preview" id="badge-preview"></div>
    </section>
    <form class="panel badge-editor" id="badge-editor">
      <div class="panel-heading"><div><h2>Personaliza&ccedil;&atilde;o</h2><p>Escolha logo, marca d'agua, cores, tipografia e slogan do rodap&eacute;.</p></div></div>
      <div class="badge-function-tabs" role="tablist" aria-label="Fun&ccedil;&otilde;es de personaliza&ccedil;&atilde;o do crach&aacute;">
        <button type="button" class="is-active" data-badge-tab="logo">Logo</button>
        <button type="button" data-badge-tab="wallpaper">Papel de parede</button>
        <button type="button" data-badge-tab="watermark">Marca d'agua</button>
        <button type="button" data-badge-tab="text">Texto/tamanho</button>
        ${canConfigureBadges ? '<button type="button" id="badge-save-tab">Salvar</button>' : ''}
        ${canDeleteBadges ? '<button type="button" class="badge-delete-tab" id="badge-delete-tab">Excluir</button>' : ''}
      </div>
      <input id="badge-config-name" type="hidden">
      <fieldset data-badge-panel="logo"><legend>Logo</legend><div class="badge-logo-picker">${logoOptions}</div><div class="badge-range-grid">${stepper('Tamanho', 'logoSize', 10, 32, 0.5, settings.logoSize)}${stepper('Horizontal', 'logoX', 0, 100, 1, settings.logoX)}${stepper('Vertical', 'logoY', 0, 100, 1, settings.logoY)}</div></fieldset>
      <fieldset data-badge-panel="wallpaper" hidden><legend>Papel de parede</legend><input name="wallpaperUrl" type="hidden" value="${escapeHtml(settings.wallpaperUrl)}"><div class="fields three-columns"><label class="field"><span>Op&ccedil;&atilde;o</span><select name="wallpaper">${wallpaperOptions}</select></label><label class="field badge-color-button"><span>Cor do papel</span><span class="color-caption" data-color-caption="accent" style="background:${escapeHtml(settings.accent)}"></span><input name="accent" type="color" value="${escapeHtml(settings.accent)}"></label><label class="field badge-color-button"><span>Cor da borda</span><span class="color-caption" data-color-caption="border" style="background:${escapeHtml(settings.border)}"></span><input name="border" type="color" value="${escapeHtml(settings.border)}"></label></div><div class="badge-range-grid">${stepper('Curvatura do canto', 'corner', 0, 18, 0.5, settings.corner, true)}${stepper('Largura da borda', 'borderWidth', 0, 2.5, 0.1, settings.borderWidth, true)}</div></fieldset>
      <fieldset data-badge-panel="watermark" hidden><legend>Marca d'agua</legend><div class="fields two-columns"><label class="field"><span>Imagem</span><select name="watermark">${watermarkOptions}</select></label><label class="field"><span>Caminho/URL da imagem</span><input name="watermarkUrl" value="${escapeHtml(settings.watermarkUrl)}" placeholder="assets/minha-imagem.png"></label></div><div class="badge-range-grid">${stepper('Opacidade', 'watermarkOpacity', 0, 35, 1, settings.watermarkOpacity, true)}${stepper('Tamanho', 'watermarkSize', 30, 110, 1, settings.watermarkSize, true)}${stepper('Horizontal', 'watermarkX', 0, 100, 1, settings.watermarkX, true)}${stepper('Vertical', 'watermarkY', 0, 100, 1, settings.watermarkY, true)}</div></fieldset>
      <fieldset data-badge-panel="text" hidden><legend>Texto/tamanho</legend><label class="field"><span>Slogan do rodap&eacute;</span><input name="slogan" value="${escapeHtml(settings.slogan)}"></label><div class="fields three-columns"><label class="field"><span>Alterar</span><select name="textTarget"><option value="name" ${settings.textTarget === 'name' ? 'selected' : ''}>Nome</option><option value="sector" ${settings.textTarget === 'sector' ? 'selected' : ''}>Setor</option><option value="slogan" ${settings.textTarget === 'slogan' ? 'selected' : ''}>Slogan</option></select></label><label class="field"><span>Fonte</span><select name="font">${fontOptions}</select></label><label class="field"><span>Alinhamento</span><select name="align"><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label><label class="field badge-color-button"><span>Cor</span><span class="color-caption" data-color-caption="textColor" style="background:${escapeHtml(activeTextColor)}"></span><input name="textColor" type="color"></label>${stepper('Tamanho', 'textSize', 2.5, 16, 0.1, settings.textTarget === 'sector' ? settings.sectorSize : settings.textTarget === 'slogan' ? settings.sloganSize : settings.nameSize, true)}</div></fieldset>
    </form>
    <section class="panel badge-print-panel" id="badge-print-panel" hidden>
      <div class="panel-heading"><div><h2>Imprimir crach&aacute;s</h2><p>Selecione um modelo salvo e escolha quais crach&aacute;s ser&atilde;o gerados.</p></div>${canConfigureBadges ? '<button type="button" class="secondary-button badge-view-switch" data-badge-view="config">Configurar crach&aacute;s</button>' : ''}</div>
      <div class="badge-heading-tools">
        <label class="field"><span>Modelo do crach&aacute;</span><select id="badge-print-model-select">${profileOptions()}</select></label>
        <div class="badge-print-controls">
          <label class="field badge-print-mode-field"><span>O que imprimir</span><select id="badge-mode"><option value="">Selecione...</option><option value="sector">Por setor</option><option value="community">Por comunidade</option></select></label>
          <p class="badge-print-comment" id="badge-print-comment"></p>
          <select id="badge-sector" hidden>${sectors.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)} (${badgeSectorCount(sector)})</option>`).join('')}</select>
          <select id="badge-person" hidden>${entries.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.nome)} - ${escapeHtml((entry.setores || []).join(', '))}</option>`).join('')}</select>
        </div>
        <div class="badge-print-actions">${canPrintBadges ? '<button class="secondary-button" id="badge-print" type="button">Imprimir</button><button class="primary-button" id="badge-word" type="button">Gerar arquivo edit&aacute;vel</button>' : ''}</div>
      </div>
    </section>
  </section></section><section class="badge-print-area" id="badge-print-area"></section>`, 'crachas');

  const form = app.querySelector('#badge-editor');
  const preview = app.querySelector('#badge-preview');
  const printArea = app.querySelector('#badge-print-area');
  const startPanel = app.querySelector('#badge-start-panel');
  const activeArea = app.querySelector('#badge-active-area');
  const configToolbar = app.querySelector('#badge-config-toolbar');
  const printPanel = app.querySelector('#badge-print-panel');
  const mode = printPanel.querySelector('#badge-mode');
  const sectorSelect = printPanel.querySelector('#badge-sector');
  const personSelect = printPanel.querySelector('#badge-person');
  const printComment = printPanel.querySelector('#badge-print-comment');
  const configSelect = app.querySelector('#badge-config-select');
  const printModelSelect = printPanel.querySelector('#badge-print-model-select');
  const configName = app.querySelector('#badge-config-name');
  const configMessage = app.querySelector('#badge-config-message');
  let communityPickerOpen = false;
  const tabButtons = [...app.querySelectorAll('[data-badge-tab]')];
  const tabPanels = [...app.querySelectorAll('[data-badge-panel]')];
  const textTargetKeys = {
    name: { font: 'nameFont', align: 'nameAlign', size: 'nameSize', color: 'text' },
    sector: { font: 'sectorFont', align: 'sectorAlign', size: 'sectorSize', color: 'muted' },
    slogan: { font: 'sloganFont', align: 'sloganAlign', size: 'sloganSize', color: 'sloganColor' },
  };
  let activeTextTarget = settings.textTarget || 'name';
  const openBadgePanel = (panel) => {
    tabButtons.forEach((button) => {
      const active = button.dataset.badgeTab === panel;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    tabPanels.forEach((item) => { item.hidden = item.dataset.badgePanel !== panel; });
  };
  tabButtons.forEach((button) => button.addEventListener('click', () => openBadgePanel(button.dataset.badgeTab)));
  const showBadgeView = (view) => {
    if (view === 'config' && !canConfigureBadges) return;
    if (view === 'print' && !canPrintBadges) return;
    activeBadgeView = view;
    activeArea.hidden = false;
    startPanel.hidden = true;
    const isPrint = view === 'print';
    configToolbar.hidden = isPrint;
    form.hidden = isPrint;
    printPanel.hidden = !isPrint;
    if (!isPrint) openBadgePanel('logo');
    renderBadges();
  };
  const syncTextTargetControls = (source = settings) => {
    const target = form.elements.textTarget?.value || 'name';
    const keys = textTargetKeys[target] || textTargetKeys.name;
    if (form.elements.font) {
      form.elements.font.value = source[keys.font] || defaultBadgeSettings[keys.font];
      form.elements.font.style.fontFamily = fontStack(form.elements.font.value);
    }
    if (form.elements.align) form.elements.align.value = source[keys.align] || defaultBadgeSettings[keys.align];
    if (form.elements.textSize) form.elements.textSize.value = source[keys.size] || defaultBadgeSettings[keys.size];
    if (form.elements.textColor) form.elements.textColor.value = source[keys.color] || defaultBadgeSettings[keys.color];
    syncColorCaptions(source);
  };
  const applySettingsToForm = (source) => {
    Object.entries(source).forEach(([key, value]) => {
      const control = form.elements[key];
      if (!control) return;
      if (control instanceof RadioNodeList) {
        control.value = value;
        return;
      }
      control.value = value ?? '';
    });
    if (form.elements.textTarget) form.elements.textTarget.value = source.textTarget || 'name';
    activeTextTarget = form.elements.textTarget?.value || 'name';
    syncTextTargetControls(source);
    syncColorCaptions(source);
  };
  const refreshProfileOptions = (selectedId = '') => {
    if (!configSelect) return;
    configSelect.innerHTML = profileOptions();
    configSelect.value = selectedId;
    if (printModelSelect) {
      printModelSelect.innerHTML = profileOptions();
      printModelSelect.value = selectedId;
    }
    selectedProfileId = selectedId;
  };
  const setActiveProfile = (profile, openEditor = false) => {
    if (!profile) return;
    blankPreview = openEditor;
    selectedProfileId = profile.id;
    settings = { ...defaultBadgeSettings, ...profile.settings, version: badgeSettingsVersion };
    applySettingsToForm(settings);
    saveBadgeSettings(settings);
    refreshProfileOptions(profile.id);
    if (configName) configName.value = profile.name;
    if (configMessage) configMessage.textContent = openEditor ? `Alterando o modelo "${profile.name}".` : `Consultando o modelo "${profile.name}".`;
    if (openEditor) openBadgePanel('logo');
    renderBadges();
  };
  const readSettings = () => {
    const data = new FormData(form);
    const next = { ...settings };
    Object.keys(defaultBadgeSettings).forEach((key) => {
      if (data.has(key)) next[key] = ['logoSize', 'logoX', 'logoY', 'nameSize', 'sectorSize', 'sloganSize', 'watermarkOpacity', 'watermarkSize', 'watermarkX', 'watermarkY', 'corner', 'borderWidth'].includes(key) ? Number(data.get(key)) : data.get(key);
    });
    const target = data.get('textTarget') || next.textTarget || 'name';
    const keys = textTargetKeys[activeTextTarget] || textTargetKeys.name;
    next.textTarget = target;
    if (data.has('font')) next[keys.font] = data.get('font');
    if (data.has('align')) next[keys.align] = data.get('align');
    if (data.has('textSize')) next[keys.size] = Number(data.get('textSize'));
    if (data.has('textColor')) next[keys.color] = data.get('textColor');
    next.logo = data.get('logo') || next.logo;
    return next;
  };
  const selectedEntries = () => {
    if (Array.isArray(badgeManualSelection)) return badgeManualSelection;
    if (activePrintMode === 'sector') return entries.filter((entry) => entryHasSector(entry, sectorSelect.value)).map((entry) => ({ entry, sector: sectorSelect.value }));
    if (activePrintMode === 'community') return communityBadgeEntries(selectedCommunityId);
    return [];
  };
  const communityName = (community) => community?.nome || `Comunidade ${community?.ordem || ''}`.trim() || 'Comunidade';
  const communityBadgeEntries = (communityId) => {
    const community = badgeCommunities.find((item) => item.id === communityId);
    if (!community) return [];
    const selected = new Map();
    const addEntry = (entry, role) => {
      if (!entry?.id) return;
      const current = selected.get(entry.id);
      selected.set(entry.id, current ? { entry, sector: current.sector } : { entry, sector: role });
    };
    entries.filter((entry) => community.liderCasalId && entry.casalId === community.liderCasalId).forEach((entry) => {
      const person = personForBadge(entry);
      addEntry(entry, genderedLabel(person, 'Tia de comunidade', 'Tio de comunidade'));
    });
    const monitorCasalIds = new Set([community.monitorCasalId, ...entries.filter((entry) => (community.monitorIds || []).includes(entry.id)).map((entry) => entry.casalId)].filter(Boolean));
    entries
      .filter((entry) => (community.monitorIds || []).includes(entry.id) || (entry.casalId && monitorCasalIds.has(entry.casalId)))
      .forEach((entry) => addEntry(entry, 'Cursista'));
    badgeStudents
      .filter((student) => (community.membroIds || []).includes(student.id))
      .forEach((student) => {
        selected.set(`student-${student.id}`, {
          entry: { id: `student-${student.id}`, nome: student.nome, setores: ['Cursista'] },
          sector: 'Cursista',
        });
      });
    return [...selected.values()].sort((first, second) => String(first.entry.nome || '').localeCompare(String(second.entry.nome || ''), 'pt-BR', { sensitivity: 'base' }));
  };
  const openBadgeSectorPicker = () => {
    if (!sectors.length || sectorPickerOpen) return;
    sectorPickerOpen = true;
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    const close = () => {
      sectorPickerOpen = false;
      overlay.remove();
    };
    const printSelection = (items) => {
      badgeManualSelection = items;
      close();
      renderBadges();
      printBadges();
    };
    const renderEntries = (sector) => {
      sectorSelect.value = sector;
      const items = entries.filter((entry) => entryHasSector(entry, sector)).map((entry) => ({ entry, sector }));
      overlay.innerHTML = `<div class="receiver-sector-dialog"><button type="button" class="receiver-sector-back" data-badge-back>← Escolher outro setor</button><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por setor</p><h2>${escapeHtml(sector)}</h2><p>Marque os integrantes que deseja imprimir.</p></div></div><div class="badge-selection-tools"><button type="button" data-badge-clear-selection ${items.length ? '' : 'disabled'}>Limpar sele&ccedil;&atilde;o</button></div><div class="badge-print-member-list">${items.map(({ entry }, index) => `<label><input type="checkbox" data-badge-print-entry="${index}" checked><span><strong>${escapeHtml(entry.nome)}</strong><small>${escapeHtml((entry.setores || []).join(', ') || sector)}</small></span></label>`).join('') || '<p class="empty-state">Nenhum integrante neste setor.</p>'}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button><button type="button" class="is-couple-continue" data-badge-print-selected ${items.length ? '' : 'disabled'}>Imprimir selecionados</button></div></div>`;
      overlay.querySelector('[data-badge-back]').addEventListener('click', renderSectorList);
      overlay.querySelector('.close-sector-view').addEventListener('click', close);
      overlay.querySelector('[data-badge-clear-selection]').addEventListener('click', () => overlay.querySelectorAll('[data-badge-print-entry]').forEach((input) => { input.checked = false; }));
      overlay.querySelector('[data-badge-print-selected]').addEventListener('click', () => {
        const selected = [...overlay.querySelectorAll('[data-badge-print-entry]:checked')].map((input) => items[Number(input.dataset.badgePrintEntry)]).filter(Boolean);
        if (!selected.length) { alert('Selecione ao menos um integrante.'); return; }
        printSelection(selected);
      });
    };
    const renderSectorList = () => {
      overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por setor</p><h2>Selecione o setor</h2><p>Escolha o setor para revisar os integrantes antes da impress&atilde;o.</p></div></div><div class="receiver-sector-list">${sectors.map((sector) => `<button type="button" data-badge-sector-choice="${escapeHtml(sector)}"><strong>${escapeHtml(sector)}</strong><span>${badgeSectorCount(sector)} crach&aacute;(s)</span></button>`).join('')}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
      overlay.querySelector('.close-sector-view').addEventListener('click', close);
      overlay.querySelectorAll('[data-badge-sector-choice]').forEach((button) => button.addEventListener('click', () => renderEntries(button.dataset.badgeSectorChoice)));
    };
    renderSectorList();
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    app.append(overlay);
  };
  const openBadgePersonPicker = () => {
    if (!entries.length || personPickerOpen) return;
    personPickerOpen = true;
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o individual</p><h2>Selecione a pessoa</h2><p>Escolha quem ter&aacute; o crach&aacute; impresso.</p></div></div><div class="receiver-sector-list">${entries.map((entry) => `<button type="button" data-badge-person-choice="${escapeHtml(entry.id)}"><strong>${escapeHtml(entry.nome)}</strong><span>${escapeHtml((entry.setores || []).join(', ') || 'Sem setor')}</span></button>`).join('')}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
    const close = () => {
      personPickerOpen = false;
      overlay.remove();
    };
    overlay.querySelector('.close-sector-view').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelectorAll('[data-badge-person-choice]').forEach((button) => button.addEventListener('click', () => {
      personSelect.value = button.dataset.badgePersonChoice;
      close();
      renderBadges();
    }));
    app.append(overlay);
  };
  const openBadgeCommunityPicker = () => {
    if (!badgeCommunities.length || communityPickerOpen) return;
    communityPickerOpen = true;
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    const close = () => {
      communityPickerOpen = false;
      overlay.remove();
    };
    const printSelection = (items) => {
      badgeManualSelection = items;
      close();
      renderBadges();
      printBadges();
    };
    const renderEntries = (communityId) => {
      selectedCommunityId = communityId;
      const community = badgeCommunities.find((item) => item.id === communityId);
      const items = communityBadgeEntries(communityId);
      overlay.innerHTML = `<div class="receiver-sector-dialog"><button type="button" class="receiver-sector-back" data-badge-back>← Escolher outra comunidade</button><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por comunidade</p><h2>${escapeHtml(communityName(community))}</h2><p>Marque os integrantes que deseja imprimir.</p></div></div><div class="badge-selection-tools"><button type="button" data-badge-clear-selection ${items.length ? '' : 'disabled'}>Limpar sele&ccedil;&atilde;o</button></div><div class="badge-print-member-list">${items.map(({ entry, sector }, index) => `<label><input type="checkbox" data-badge-print-entry="${index}" checked><span><strong>${escapeHtml(entry.nome)}</strong><small>${escapeHtml(sector)}</small></span></label>`).join('') || '<p class="empty-state">Nenhum integrante nesta comunidade.</p>'}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button><button type="button" class="is-couple-continue" data-badge-print-selected ${items.length ? '' : 'disabled'}>Imprimir selecionados</button></div></div>`;
      overlay.querySelector('[data-badge-back]').addEventListener('click', renderCommunityList);
      overlay.querySelector('.close-sector-view').addEventListener('click', close);
      overlay.querySelector('[data-badge-clear-selection]').addEventListener('click', () => overlay.querySelectorAll('[data-badge-print-entry]').forEach((input) => { input.checked = false; }));
      overlay.querySelector('[data-badge-print-selected]').addEventListener('click', () => {
        const selected = [...overlay.querySelectorAll('[data-badge-print-entry]:checked')].map((input) => items[Number(input.dataset.badgePrintEntry)]).filter(Boolean);
        if (!selected.length) { alert('Selecione ao menos um integrante.'); return; }
        printSelection(selected);
      });
    };
    const renderCommunityList = () => {
      overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por comunidade</p><h2>Selecione a comunidade</h2><p>Revise os integrantes antes da impress&atilde;o.</p></div></div><div class="receiver-sector-list">${badgeCommunities.map((community) => {
        const count = communityBadgeEntries(community.id).length;
        return `<button type="button" data-badge-community-choice="${escapeHtml(community.id)}"><strong>${escapeHtml(communityName(community))}</strong><span>${count} crach&aacute;(s) de cursistas/tios/monitores</span></button>`;
      }).join('')}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
      overlay.querySelector('.close-sector-view').addEventListener('click', close);
      overlay.querySelectorAll('[data-badge-community-choice]').forEach((button) => button.addEventListener('click', () => renderEntries(button.dataset.badgeCommunityChoice)));
    };
    renderCommunityList();
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    app.append(overlay);
  };
  const syncColorCaptions = (source = settings) => {
    ['accent', 'border', 'textColor', 'background'].forEach((name) => {
      const caption = form.querySelector(`[data-color-caption="${name}"]`);
      if (!caption) return;
      const color = name === 'textColor' ? form.elements.textColor?.value : source[name] || defaultBadgeSettings[name];
      caption.textContent = '';
      caption.style.background = color;
    });
  };
  const renderBadges = () => {
    const next = readSettings();
    saveBadgeSettings(next);
    settings = next;
    syncTextTargetControls(next);
    syncColorCaptions(next);
    const selected = selectedEntries();
    const first = selected[0] || entries.map((entry) => ({ entry, sector: '' }))[0];
    const printModelSelected = Boolean(printModelSelect?.value);
    const configModelSelected = Boolean(selectedProfileId || blankPreview);
    preview.innerHTML = activeBadgeView === 'print' ? (printModelSelected ? sampleBadgeCard(next) : '') : activeBadgeView === 'config' && !configModelSelected ? '' : blankPreview || !first ? sampleBadgeCard(next) : badgeCard(first.entry, next, first.sector);
    badgePrintEntries = selected;
    const selectedCommunity = badgeCommunities.find((community) => community.id === selectedCommunityId);
    badgePrintTitle = activePrintMode === 'sector' ? `Crach\u00e1s - ${sectorSelect.value}` : activePrintMode === 'community' ? `Crach\u00e1s - ${communityName(selectedCommunity)}` : `Crach\u00e1s - ${retreat.nome}`;
    const pages = [];
    for (let index = 0; index < selected.length; index += 8) pages.push(selected.slice(index, index + 8));
    printArea.innerHTML = pages.map((page) => `<div class="badge-print-sheet">${page.map(({ entry, sector }) => badgeCard(entry, next, sector)).join('')}</div>`).join('');
    app.querySelector('#badge-print-summary').textContent = `${selected.length} crach\u00e1(s) selecionado(s).`;
    sectorSelect.hidden = true;
    personSelect.hidden = true;
    if (printComment) {
      printComment.textContent = activePrintMode === 'sector'
        ? `Selecionado: ${sectorSelect.value || 'Setor'}`
        : activePrintMode === 'community'
            ? `Selecionado: ${communityName(selectedCommunity)}`
            : 'Selecione uma op\u00e7\u00e3o de impress\u00e3o.';
    }
  };
  const loadSelectedProfile = () => {
    showBadgeView('config');
    const profile = badgeProfiles.find((item) => item.id === configSelect.value);
    if (!profile) {
      selectedProfileId = '';
      blankPreview = false;
      renderBadges();
      return;
    }
    setActiveProfile(profile, true);
  };
  const loadPrintProfile = () => {
    badgeManualSelection = null;
    const profile = badgeProfiles.find((item) => item.id === printModelSelect.value);
    if (!profile) {
      selectedProfileId = '';
      blankPreview = false;
      renderBadges();
      return;
    }
    setActiveProfile(profile);
  };
  const saveCurrentProfile = async (profileName) => {
    if (!canConfigureBadges) return;
    const name = String(profileName || '').trim();
    if (!name) {
      if (configMessage) configMessage.textContent = 'Informe um nome para salvar esta configura\u00e7\u00e3o.';
      return;
    }
    const current = readSettings();
    const selected = badgeProfiles.find((profile) => profile.id === selectedProfileId || profile.id === configSelect?.value);
    const isUpdatingLoadedProfile = selected && normalizeText(selected.name) === normalizeText(name);
    const id = isUpdatingLoadedProfile ? selected.id : createId();
    const nextProfile = normalizeBadgeProfile({ id, retiroId: retreat.id, name, settings: current, updatedAt: new Date().toISOString() }, retreat.id);
    badgeProfiles = [nextProfile, ...badgeProfiles.filter((profile) => profile.id !== id)];
    selectedProfileId = id;
    await saveBadgeProfile(nextProfile);
    refreshProfileOptions(id);
    saveBadgeSettings(current);
    if (configName) configName.value = name;
    if (configMessage) configMessage.textContent = isUpdatingLoadedProfile ? `Modelo "${name}" alterado.` : `Novo modelo "${name}" salvo.`;
  };
  const openSaveBadgeDialog = () => {
    if (!canConfigureBadges) return;
    const selected = badgeProfiles.find((profile) => profile.id === selectedProfileId || profile.id === configSelect?.value);
    const suggestedName = selected?.name || configName?.value || '';
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    overlay.innerHTML = `<div class="receiver-sector-dialog badge-save-dialog">
      <div class="panel-heading"><div><p class="eyebrow">Salvar crach&aacute;</p><h2>Salvar como</h2><p>Se mantiver o nome do crach&aacute; carregado, ele ser&aacute; alterado. Se trocar o nome, um novo crach&aacute; ser&aacute; criado.</p></div></div>
      <label class="field"><span>Nome do crach&aacute;</span><input id="badge-save-as-name" value="${escapeHtml(suggestedName)}" placeholder="Ex.: Crach&aacute; verde com logo EPC"></label>
      <p class="form-message" id="badge-save-as-message"></p>
      <div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button><button type="button" class="is-couple-continue" id="confirm-badge-save">Salvar</button></div>
    </div>`;
    const input = overlay.querySelector('#badge-save-as-name');
    const message = overlay.querySelector('#badge-save-as-message');
    const close = () => overlay.remove();
    const confirmSave = async () => {
      const name = input.value.trim();
      if (!name) {
        message.textContent = 'Informe um nome para salvar o crach\u00e1.';
        input.focus();
        return;
      }
      await saveCurrentProfile(name);
      close();
    };
    overlay.querySelector('.close-sector-view').addEventListener('click', close);
    overlay.querySelector('#confirm-badge-save').addEventListener('click', confirmSave);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmSave();
      }
      if (event.key === 'Escape') close();
    });
    app.append(overlay);
    input.focus();
    input.select();
  };
  const deleteCurrentProfile = async () => {
    if (!canDeleteBadges) return;
    const profile = badgeProfiles.find((item) => item.id === selectedProfileId || item.id === configSelect?.value);
    if (!profile) {
      if (configMessage) configMessage.textContent = 'Selecione um modelo salvo para excluir.';
      configSelect?.focus();
      return;
    }
    if (!confirm(`Excluir o crach\u00e1 "${profile.name}"?`)) return;
    badgeProfiles = badgeProfiles.filter((item) => item.id !== profile.id);
    await deleteBadgeProfile(profile.id);
    selectedProfileId = '';
    refreshProfileOptions('');
    if (configName) configName.value = '';
    settings = { ...defaultBadgeSettings };
    applySettingsToForm(settings);
    saveBadgeSettings(settings);
    if (configMessage) configMessage.textContent = `Crach\u00e1 "${profile.name}" exclu\u00eddo.`;
    renderBadges();
  };
  const startNewProfile = () => {
    showBadgeView('config');
    selectedProfileId = '';
    blankPreview = true;
    settings = { ...defaultBadgeSettings, logo: 'none', slogan: '' };
    applySettingsToForm(settings);
    refreshProfileOptions('');
    if (configName) configName.value = '';
    if (configMessage) configMessage.textContent = 'Novo modelo iniciado. Ajuste as caracter\u00edsticas e salve com um nome.';
    openBadgePanel('logo');
    renderBadges();
  };
  const badgePrintDocument = (content, title) => `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeHtml(`${location.origin}/`)}">
  <title>${escapeHtml(title || 'Crachás')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap" rel="stylesheet">
  <style>
    @page { size:A4; margin:0; }
    * { box-sizing:border-box; }
    html, body { width:210mm; min-height:297mm; margin:0; background:#fff; }
    body { color:#1f2c3f; font-family:'DM Sans',sans-serif; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    .badge-print-sheet { display:grid; grid-template-columns:repeat(2,95mm); grid-template-rows:repeat(4,65mm); align-content:start; justify-content:start; gap:2mm; width:210mm; height:297mm; padding:6mm; margin:0; overflow:hidden; background:#fff; break-after:page; page-break-after:always; }
    .badge-print-sheet:last-child { break-after:auto; page-break-after:auto; }
    .badge-card { position:relative; isolation:isolate; display:grid; grid-template-rows:1fr auto; width:95mm; height:65mm; overflow:hidden; padding:5mm 6mm 4mm; border:var(--badge-border-width) solid var(--badge-border); border-radius:var(--badge-corner); background:var(--badge-bg); color:var(--badge-text); font-family:'DM Sans',sans-serif; box-shadow:none; break-inside:avoid; page-break-inside:avoid; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    .badge-wallpaper { position:absolute; z-index:0; inset:0; background-position:center; background-size:cover; background-repeat:no-repeat; pointer-events:none; }
    .badge-wallpaper::after { content:''; position:absolute; inset:0; background:var(--badge-accent); opacity:.08; mix-blend-mode:multiply; }
    .badge-watermark { position:absolute; z-index:1; left:var(--badge-watermark-x); top:var(--badge-watermark-y); width:var(--badge-watermark-size); height:var(--badge-watermark-size); object-fit:contain; opacity:var(--badge-watermark-opacity); transform:translate(-50%,-50%); }
    .badge-logo { position:absolute; z-index:3; left:var(--badge-logo-x); top:var(--badge-logo-y); width:var(--badge-logo); height:var(--badge-logo); object-fit:contain; transform:translate(-50%,-50%); }
    .badge-main { position:relative; z-index:2; display:grid; align-content:center; min-width:0; padding:12mm 0 5mm; }
    .badge-main strong { display:block; justify-self:var(--badge-name-justify); max-width:100%; color:var(--badge-text); font-family:var(--badge-name-font),'DM Sans',sans-serif; font-size:var(--badge-name); line-height:.96; font-weight:900; text-align:var(--badge-name-align); overflow-wrap:anywhere; }
    .badge-main span { display:block; justify-self:var(--badge-sector-justify); max-width:100%; margin-top:2.2mm; color:var(--badge-muted); font-family:var(--badge-sector-font),'DM Sans',sans-serif; font-size:var(--badge-sector); line-height:1.12; font-weight:800; text-align:var(--badge-sector-align); text-transform:uppercase; overflow-wrap:anywhere; }
    .badge-card footer { position:relative; z-index:2; align-self:end; justify-self:var(--badge-slogan-justify); max-width:100%; min-height:6mm; color:var(--badge-slogan-color); font-family:var(--badge-slogan-font),'DM Sans',sans-serif; font-size:var(--badge-slogan); line-height:1.15; font-weight:800; text-align:var(--badge-slogan-align); overflow-wrap:anywhere; }
  </style>
</head>
<body>${content}</body>
</html>`;
  const badgePrintPayload = () => {
    const profile = badgeProfiles.find((item) => item.id === printModelSelect?.value);
    if (!profile) { alert('Selecione o modelo do crach\u00e1 que ser\u00e1 usado.'); printModelSelect?.focus(); return null; }
    setActiveProfile(profile);
    if (!badgePrintEntries.length) { alert('Nenhum crach\u00e1 selecionado para gerar.'); return; }
    const printContent = printArea.innerHTML.trim();
    if (!printContent) { alert('Nenhuma p\u00e1gina de crach\u00e1 foi montada para gerar.'); return null; }
    return { printContent, title: badgePrintTitle || 'Crach\u00e1s' };
  };
  const printBadges = () => {
    if (!canPrintBadges) return;
    const payload = badgePrintPayload();
    if (!payload) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('O navegador bloqueou a janela de impress\u00e3o. Permita pop-ups para este site e tente novamente.'); return; }
    printWindow.document.open();
    printWindow.document.write(badgePrintDocument(payload.printContent, payload.title));
    printWindow.document.close();
    const triggerPrint = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.addEventListener('load', () => {
      const images = [...printWindow.document.images];
      if (!images.length) {
        setTimeout(triggerPrint, 150);
        return;
      }
      Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      }))).then(() => setTimeout(triggerPrint, 150));
    }, { once: true });
  };
  const generateBadgeWordFile = () => {
    if (!canPrintBadges) return;
    const payload = badgePrintPayload();
    if (!payload) return;
    const documentHtml = badgePrintDocument(payload.printContent, payload.title);
    const blob = new Blob([`\uFEFF${documentHtml}`], { type: 'application/msword;charset=utf-8' });
    const link = document.createElement('a');
    const fileName = normalizeText(payload.title).replace(/\s+/g, '-') || 'crachas';
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.doc`;
    document.body.append(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
    app.querySelector('#badge-print-summary').textContent = 'Arquivo editável gerado.';
  };
  form.elements.textTarget?.addEventListener('change', () => {
    syncTextTargetControls(settings);
    activeTextTarget = form.elements.textTarget?.value || 'name';
  });
  form.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step-target]');
    if (!button) return;
    event.preventDefault();
    const input = form.elements[button.dataset.stepTarget];
    if (!input) return;
    const step = Number(button.dataset.step || input.step || 1);
    const min = input.min === '' ? -Infinity : Number(input.min);
    const max = input.max === '' ? Infinity : Number(input.max);
    const current = Number(input.value || 0);
    const decimals = String(input.step || step).includes('.') ? String(input.step || step).split('.')[1].length : 0;
    const next = Math.min(max, Math.max(min, current + step));
    input.value = decimals ? next.toFixed(decimals) : String(next);
    renderBadges();
  });
  form.addEventListener('input', renderBadges);
  form.addEventListener('change', renderBadges);
  const resetPrintModeField = () => { mode.value = ''; };
  mode.addEventListener('focus', resetPrintModeField);
  mode.addEventListener('pointerdown', resetPrintModeField);
  mode.addEventListener('change', () => {
    if (!mode.value) return;
    activePrintMode = mode.value;
    badgeManualSelection = null;
    renderBadges();
    if (activePrintMode === 'sector') openBadgeSectorPicker();
    if (activePrintMode === 'community') openBadgeCommunityPicker();
    mode.value = '';
  });
  [sectorSelect, personSelect].forEach((control) => control.addEventListener('change', renderBadges));
  app.querySelectorAll('[data-badge-view]').forEach((button) => button.addEventListener('click', () => showBadgeView(button.dataset.badgeView)));
  configSelect?.addEventListener('change', loadSelectedProfile);
  printModelSelect?.addEventListener('change', loadPrintProfile);
  app.querySelector('#badge-new-config')?.addEventListener('click', startNewProfile);
  app.querySelector('#badge-save-tab')?.addEventListener('click', openSaveBadgeDialog);
  app.querySelector('#badge-delete-tab')?.addEventListener('click', deleteCurrentProfile);
  printPanel.querySelector('#badge-print')?.addEventListener('click', printBadges);
  printPanel.querySelector('#badge-word')?.addEventListener('click', generateBadgeWordFile);
  openBadgePanel('logo');
  syncTextTargetControls(settings);
  renderBadges();
}

async function renderRecadoEquipe() {
  const settingId = teamMessageConfigId;
  const setting = await dataService.getConfiguracao(settingId).catch(() => null);
  const messages = setting?.mensagens || {};
  const knownTeamSectors = knownSectors(retreats.flatMap((retreat) => retreat.setores || []));
  const sectorByKey = new Map(knownTeamSectors.map((sector) => [normalizeText(sector), sector]));
  const sectors = sortSectors(uniqueSectors([
    ...knownTeamSectors,
    ...Object.keys(messages).map((key) => sectorByKey.get(normalizeText(key)) || key),
  ]));
  const canEditTeamMessage = canAccess('recado-equipe.editar');
  const messageFields = sectors.map((sector) => {
    const key = normalizeText(sector);
    return `<label class="field team-message-field"><span>${escapeHtml(sector)}</span><textarea data-sector-key="${escapeHtml(key)}" data-sector-name="${escapeHtml(sector)}" rows="4" placeholder="Recado exibido ao volunt&aacute;rio deste setor" ${canEditTeamMessage ? '' : 'readonly'}>${escapeHtml(messages[key] || '')}</textarea></label>`;
  }).join('');

  layout(`<section class="page-heading"><div><p class="eyebrow">Configura&ccedil;&atilde;o do sistema</p><h1>Recado &agrave; equipe</h1><p>Cadastre uma mensagem espec&iacute;fica para cada setor no link p&uacute;blico de ades&atilde;o.</p></div></section>
  <form class="panel team-message-form" id="team-message-form">
    <div class="panel-heading"><div><h2>Mensagens por setor</h2><p>Ao clicar em Acessar cadastro, o volunt&aacute;rio ver&aacute; o recado do setor selecionado. Campos vazios mant&ecirc;m o recado padr&atilde;o.</p></div></div>
    <div class="team-message-list">${messageFields || '<p class="empty-state">Nenhum setor configurado no sistema.</p>'}</div>
    <p class="form-message" id="team-message-status"></p>
    <div class="form-actions"><p>Os recados s&atilde;o salvos como informa&ccedil;&atilde;o geral do sistema.</p><button type="submit" ${sectors.length && canEditTeamMessage ? '' : 'disabled'}>Salvar recados <span>→</span></button></div>
  </form>`, 'recado-equipe');

  const form = app.querySelector('#team-message-form');
  const status = app.querySelector('#team-message-status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canAccess('recado-equipe.editar')) {
      status.textContent = 'Seu usuario nao tem permissao para salvar os recados.';
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    const mensagens = {};
    form.querySelectorAll('[data-sector-key]').forEach((field) => {
      const text = field.value.trim();
      if (text) mensagens[field.dataset.sectorKey] = text;
    });
    button.disabled = true;
    status.textContent = 'Salvando...';
    try {
      await dataService.saveConfiguracao({ id: settingId, mensagens, updatedAt: new Date().toISOString() });
      status.textContent = 'Recados salvos.';
    } catch (error) {
      status.textContent = `Nao foi possivel salvar os recados. ${error.message || 'Atualize a pagina e tente novamente.'}`;
    } finally {
      button.disabled = false;
    }
  });
}

function renderAlterarSenha() {
  layout(`<section class="page-heading"><div><p class="eyebrow">Seguranca</p><h1>Alterar senha</h1><p>Atualize a senha do usuario conectado.</p></div></section>
  <form class="panel access-user-form" id="change-password-form">
    <div class="fields two-columns">
      <label class="field"><span>Senha atual <b>*</b></span><input name="currentPassword" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>Nova senha <b>*</b></span><input name="newPassword" type="password" autocomplete="new-password" minlength="6" required></label>
      <label class="field"><span>Confirmar nova senha <b>*</b></span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required></label>
    </div>
    <p id="change-password-message" class="form-message"></p>
    <div class="form-actions"><p>A nova senha ser&aacute; usada no pr&oacute;ximo login.</p><button type="submit">Alterar senha <span>→</span></button></div>
  </form>`, 'alterar-senha');
  const form = app.querySelector('#change-password-form');
  const message = app.querySelector('#change-password-message');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const confirmPassword = form.elements.confirmPassword.value;
    if (newPassword !== confirmPassword) {
      message.textContent = 'A confirmacao da nova senha nao confere.';
      form.elements.confirmPassword.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = 'Alterando senha...';
    try {
      await dataService.changePassword(currentPassword, newPassword);
      form.reset();
      message.textContent = 'Senha alterada com sucesso.';
    } catch (error) {
      message.textContent = error.message || 'Nao foi possivel alterar a senha.';
    } finally {
      button.disabled = false;
    }
  });
}

async function renderQuadrante() {
  const retreat = selectedRetreat();
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Relatório</p><h1>Quadrante</h1><p>Crie ou publique um retiro para gerar o relatório.</p></div></section>', 'quadrante'); return; }
  const [communities, students, savedQuadranteOrder] = await Promise.all([dataService.listComunidades(), dataService.listCursistas(), loadQuadranteOrderSetting()]);
  const entries = mergeEnrolmentsByParticipant(enrolments.filter((entry) => entry.retiroId === retreat.id && entry.setores?.length));
  const retreatStudentRecords = students.filter((student) => student.retiroId === retreat.id);
  const retreatStudents = uniqueByParticipant(retreatStudentRecords);
  const reportCommunities = sortCommunitiesByPosition(communities.filter((community) => community.retiroId === retreat.id));
  const missing = '—';
  const byName = (first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
  const personForEntry = (entry) => people.find((person) => person.id === entry.pessoaId) || entry;
  const addressForPerson = (person) => [[person.endereco, person.numero].filter(Boolean).join(', '), person.cep, person.bairro, person.cidade, person.estado].filter(Boolean).join(' · ') || missing;
  const addressForStudent = (student) => [[student.rua, student.numero].filter(Boolean).join(', '), student.cep, student.bairro, student.cidade, student.estado].filter(Boolean).join(' · ') || missing;
  const quadranteColgroup = '<colgroup><col class="quadrante-name-col"><col class="quadrante-address-col"><col class="quadrante-birthday-col"><col class="quadrante-contact-col"></colgroup>';
  const communityLeaderLabel = (person) => normalizeText(person.genero) === 'feminino' ? 'Tia' : 'Tio';
  const nameSuffix = (person, className = '') => {
    if (className === 'community-tio') return ` - ${communityLeaderLabel(person)}`;
    if (className === 'community-monitor') return ' - Monitor';
    return '';
  };
  const nameCell = (person, className = '') => `<td>${escapeHtml(person.nome || missing)}${nameSuffix(person, className)}</td>`;
  const detailCells = (person) => `<td>${escapeHtml(birthday(person.nascimento))}</td><td>${escapeHtml(person.telefone || missing)}</td>`;
  const rowClass = (className) => className ? ` class="${className}"` : '';
  const groupedParticipantRows = (rows, className = '') => {
    const sorted = [...rows].sort((first, second) => byName(first.person, second.person));
    const usedCouples = new Set();
    const groups = [];
    sorted.forEach((row) => {
      if (!row.casalId) { groups.push([row]); return; }
      if (usedCouples.has(row.casalId)) return;
      usedCouples.add(row.casalId);
      groups.push(sorted.filter((item) => item.casalId === row.casalId));
    });
    groups.sort((first, second) => {
      const firstCoordinator = first.some((row) => row.coordenacaoSetor);
      const secondCoordinator = second.some((row) => row.coordenacaoSetor);
      if (firstCoordinator !== secondCoordinator) return firstCoordinator ? -1 : 1;
      return byName(first[0]?.person || {}, second[0]?.person || {});
    });
    return groups.map((group) => {
      const groupCoordinator = group.some((row) => row.coordenacaoSetor);
      return group.map((row, index) => {
      const sharedAddress = group.length > 1 && row.casalId;
      const addressCell = sharedAddress
        ? (index === 0 ? `<td class="shared-couple-address" rowspan="${group.length}">${escapeHtml(group[0].address)}</td>` : '')
        : `<td>${escapeHtml(row.address)}</td>`;
      const classes = [className, groupCoordinator ? 'sector-coordinator' : ''].filter(Boolean).join(' ');
      return `<tr${rowClass(classes)}>${nameCell(row.person, className)}${addressCell}${detailCells(row.person)}</tr>`;
    }).join('');
    }).join('');
  };
  const presentSectors = [...new Set(entries.flatMap((entry) => entry.setores || []))].filter((sector) => normalizeText(sector) !== 'tios de comunidade');
  const configuredSectors = uniqueSectors(retreat.setores || []).filter((sector) => normalizeText(sector) !== 'tios de comunidade');
  const orderSource = savedQuadranteOrder || retreat.ordemQuadrante || retreatQuadranteOrderFallback();
  const sectors = quadranteOrderForSectors(configuredSectors, orderSource);
  const orderableSectors = allQuadranteSectors([...orderSource, ...configuredSectors, ...presentSectors]);
  const orderableOrder = quadranteOrderForSectors(orderableSectors, orderSource);
  const sectorSections = sectors.map((sector) => {
    const sectorEntries = entries
      .filter((entry) => entryHasSector(entry, sector))
      .map((entry) => { const person = personForEntry(entry); return { person, casalId: entry.casalId, address: addressForPerson(person), coordenacaoSetor: Boolean(entry.coordenacaoSetor) }; });
    return `<article class="quadrante-sector"><h3>${escapeHtml(sector)}</h3><table>${quadranteColgroup}<tbody>${groupedParticipantRows(sectorEntries)}</tbody></table></article>`;
  }).join('');
  const assignedStudentIds = new Set(reportCommunities.flatMap((community) => community.membroIds || []));
  const assignedStudentKeys = new Set(retreatStudentRecords.filter((student) => assignedStudentIds.has(student.id)).map(participantIdentity));
  const unassignedStudents = retreatStudents.filter((student) => !assignedStudentKeys.has(participantIdentity(student)));
  const communitySections = [
    ...reportCommunities.map((community, index) => ({ ...community, nome: community.nome || `Comunidade ${index + 1}` })),
    ...(unassignedStudents.length ? [{ id: 'sem-comunidade', nome: 'Sem comunidade', liderCasalId: null, membroIds: unassignedStudents.map((student) => student.id) }] : []),
  ].map((community) => {
    const leaderEntries = entries
      .filter((entry) => community.liderCasalId && entry.casalId === community.liderCasalId)
      .map((entry) => { const person = personForEntry(entry); return { person, casalId: entry.casalId, address: addressForPerson(person) }; });
    const monitorCasalIds = new Set([community.monitorCasalId, ...entries.filter((entry) => (community.monitorIds || []).includes(entry.id)).map((entry) => entry.casalId)].filter(Boolean));
    const monitorEntries = entries
      .filter((entry) => (community.monitorIds || []).includes(entry.id) || (entry.casalId && monitorCasalIds.has(entry.casalId)))
      .map((entry) => { const person = personForEntry(entry); return { person, casalId: entry.casalId, address: addressForPerson(person) }; });
    const memberIds = new Set(community.membroIds || []);
    const members = uniqueByParticipant(retreatStudentRecords.filter((student) => memberIds.has(student.id)))
      .sort(byName)
      .map((student) => ({ person: student, address: addressForStudent(student) }));
    return `<article><h3>${escapeHtml(community.nome)}</h3><table>${quadranteColgroup}<tbody>${groupedParticipantRows(monitorEntries, 'community-monitor')}${groupedParticipantRows(leaderEntries, 'community-tio')}${groupedParticipantRows(members) || (!leaderEntries.length && !monitorEntries.length ? '<tr><td colspan="4">Nenhum cursista alocado.</td></tr>' : '')}</tbody></table></article>`;
  }).join('');
  const reportHeader = `<table class="quadrante-column-head">${quadranteColgroup}<thead><tr><th>Nome</th><th>Endereço</th><th>ANIV</th><th>Contato</th></tr></thead></table>`;
  const quadranteActions = [
    canAccess('quadrante.editar') && canModifyRetreat(retreat) ? '<button class="secondary-button" id="order-quadrante" type="button">Ordenar quadrante</button>' : '',
    canAccess('quadrante.imprimir') ? '<button class="primary-button" id="print-quadrante" type="button">Imprimir relatório</button>' : '',
  ].join('');
  layout(`<section class="page-heading"><div><h1>Quadrante - ${escapeHtml(retreat.nome)}</h1></div>${quadranteActions ? `<div class="detail-actions">${quadranteActions}</div>` : ''}</section><section class="quadrante-report" id="quadrante-report">${reportHeader}${sectorSections || '<p class="empty-state">Nenhum voluntário com setor atribuído.</p>'}<section class="quadrante-communities">${communitySections || '<p>Nenhuma comunidade criada.</p>'}</section></section>`, 'quadrante');
  app.querySelector('#order-quadrante')?.addEventListener('click', () => {
    if (!ensureRetreatCanBeChanged(retreat, 'ordenar o quadrante')) return;
    const sectors = orderableSectors;
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    overlay.innerHTML = `<form class="receiver-sector-dialog quadrante-order-dialog"><div class="panel-heading"><div><p class="eyebrow">Quadrante</p><h2>Ordenar setores</h2><p>A ordem definida ficará a mesma para todos os retiros posteriores. Nesta tela estão exibidos todos os setores possíveis, porém apenas os setores configurados para o retiro em foco serão listados no quadrante. As comunidades já seguem uma ordem pré-definida e são listadas ao final do quadrante. Cada comunidade segue a ordem: Monitor, Tios e cursistas.</p></div></div><div data-quadrante-order></div><p class="form-message" id="quadrante-order-message"></p><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button><button type="submit" class="is-couple-continue">Salvar ordem</button></div></form>`;
    const dialog = overlay.querySelector('form');
    const close = () => overlay.remove();
    setupQuadranteOrderEditor(dialog, orderableOrder, () => sectors);
    overlay.querySelector('.close-sector-view').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    dialog.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = dialog.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = 'Salvando...';
      const setores = [...dialog.querySelectorAll('input[name="ordemQuadrante"]')].map((input) => input.value);
      try {
        await dataService.saveConfiguracao({ id: quadranteOrderSettingId, setores, updatedAt: new Date().toISOString() });
        close();
        renderQuadrante();
      } catch (error) {
        dialog.querySelector('#quadrante-order-message').textContent = `Não foi possível salvar a ordem. ${error.message || 'Atualize a página e tente novamente.'}`;
        submitButton.disabled = false;
        submitButton.textContent = 'Salvar ordem';
      }
    });
    app.append(overlay);
  });
  app.querySelector('#print-quadrante')?.addEventListener('click', () => window.print());
}

function choices(name, options, multiple = true) { const visibleOptions = options; return `<div class="inline-choices ${name === 'camiseta' ? 'compact-choices' : ''}">${visibleOptions.map((option) => `<label class="choice"><input type="${multiple ? 'checkbox' : 'radio'}" name="${name}" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join('')}</div>`; }
function syncChoiceStates(root = document) {
  root.querySelectorAll('.choice').forEach((choice) => {
    const input = choice.querySelector('input');
    if (input) choice.classList.toggle('is-selected', input.checked);
  });
}
document.addEventListener('change', (event) => {
  if (event.target.closest?.('.choice')) syncChoiceStates(event.target.closest('form') || document);
});
async function renderPublicForm(id, embedded = false, sectorToken = '') {
  const retreat = await dataService.getRetiro(id);
  if (embedded) layout('<div id="registration-root"></div>', 'pessoas');
  const mount = embedded ? app.querySelector('#registration-root') : app;
  if (!retreat) { mount.innerHTML = '<main class="public-shell"><h1>Retiro não encontrado</h1><p>Confira o link que foi enviado pela equipe.</p></main>'; return; }
  if (!embedded && (!people.length || !enrolments.length)) {
    [enrolments, people] = await Promise.all([dataService.listAdesoes(), dataService.listPessoas()]);
  }
  const requestedSectorToken = !embedded ? String(sectorToken || '').trim() : '';
  const sectorLink = requestedSectorToken ? (retreat.linksSetores || retreat.setorLinks || []).find((item) => item.cadastroToken === requestedSectorToken || item.token === requestedSectorToken) : null;
  const activeSectorByKey = new Map((retreat.setores || []).map((sector) => [normalizeText(sector), sector]));
  const forcedSector = sectorLink ? activeSectorByKey.get(normalizeText(sectorLink.setor || sectorLink.sector)) : '';
  if (requestedSectorToken && !forcedSector) {
    mount.innerHTML = '<main class="public-shell"><h1>Link de setor indisponível</h1><p>Confira se este setor está ativo no retiro ou solicite um novo link à coordenação.</p></main>';
    return;
  }
  const binaryChoices = (name, options) => choices(name, options, false);
  const contributionOptions = ['R$ 60,00 se o voluntário for o único da família', 'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro'];
  const kidsFields = Array.from({ length: 5 }, (_, index) => `<div class="kids-row"><span>${index + 1}</span><label class="field"><span>Nome</span><input name="kidNome${index + 1}" placeholder="Nome da criança"></label><label class="field"><span>Data de nascimento</span><input name="kidNascimento${index + 1}" type="date"></label></div>`).join('');
  const sectorsForRegistration = forcedSector ? [forcedSector] : (embedded ? retreat.setores : (retreat.setoresPublicos ?? retreat.setores));
  const publicHeading = embedded ? String(retreat.nome || '') : `Cadastro da equipe de trabalho para: ${retreat.nome || ''}`;
  const publicLead = forcedSector ? `Este link é exclusivo para cadastro no setor ${forcedSector}.` : (embedded ? 'Preencha os dados para organizar a participacao da equipe neste retiro.' : 'Este e o formulario oficial da equipe de organizacao. Confira o nome do retiro antes de informar seus dados.');
  const publicShellClass = embedded ? 'public-shell embedded-registration-shell' : 'public-shell external-registration-shell';
  const serviceDays = retreatServiceDays(retreat);
  const dayConfirmationName = (name, index) => `${name}Confirm${index}`;
  const dayConfirmations = (name, days) => `<div class="day-confirmation-list" data-day-confirmations="${name}">${days.map((day, index) => `<div class="day-confirmation-row" role="group" aria-label="${escapeHtml(day)}"><strong>${escapeHtml(day)}</strong><div class="day-confirmation-options"><label class="choice"><input type="radio" name="${dayConfirmationName(name, index)}" value="Sim" data-day-value="${escapeHtml(day)}"><span>Sim</span></label><label class="choice"><input type="radio" name="${dayConfirmationName(name, index)}" value="Não" data-day-value="${escapeHtml(day)}"><span>Não</span></label></div></div>`).join('')}</div><p class="hint day-confirmation-hint">Responda Sim ou Não para cada dia. Marque Sim somente nos dias em que você confirma presença.</p>`;
  const includeSubmitText = embedded ? 'Salvar inclusão' : 'Confirmar Inscrição';
  const editSubmitText = embedded ? 'Salvar Alteração' : 'Salvar alterações';
  const hiddenTeamNoticeTitle = 'Atenção, querido(a) servo(a) do Senhor!!';
  const hiddenTeamNoticeText = 'Servindo neste setor, você deve <span class="hidden-team-danger">TOMAR O MÁXIMO DE CUIDADO PARA NÃO SER VISTO POR NENHUM CURSISTA</span>. Evite chegar nos horários em que eles estiverem chegando ou saindo do retiro e estacione seu veículo em um local escondido, principalmente se você tiver algum conhecido fazendo o curso.';
  const roomTeamNoticeTitle = 'Querido servo do Senhor';
  const roomTeamNoticeText = 'Neste retiro, você será a imagem do movimento EPC para os cursistas e, mais ainda, será a imagem de Deus para eles. Por isso: sorriso no rosto, cante com determinação, use roupas adequadas, reze muito e seja cordial em todos os momentos.';
  const volunteerTermTitle = 'TERMO DE ADESÃO DE VOLUNTARIADO';
  const volunteerTermContent = `<div class="volunteer-term-body"><p class="volunteer-term-marker">*</p><p>Associação Encontro de Pais com Cristo de Indaial, associação privada sem fins lucrativos, com sede na cidade de Indaial, vem, através deste instrumento, celebrar o presente “TERMO DE ADESÃO AO SERVIÇO VOLUNTÁRIO”, conforme descrito acima.</p><ol><li>O(A) voluntário(a) se compromete a auxiliar a referida associação com trabalho voluntário nos retiros promovidos pelo Movimento EPC, contribuindo com seus objetivos institucionais, observando as diretrizes aqui traçadas, bem como aquelas informadas pelo responsável da área de Voluntariado (conforme o caso).</li><li>Tenho interesse em voluntariar no endereço: Rua Mal. Floriano Peixoto, 362 Indaial - SC, na opção do setor assinalada acima.</li><li>As despesas previamente autorizadas pela referida associação e realizadas em benefício desta, poderão ser reembolsadas ao voluntário mediante a comprovação dos gastos.</li><li>O presente Termo de Adesão tem prazo indeterminado tendo seu término efetivado com o desligamento do(a) voluntário(a), quando da vontade de uma das partes.</li><li>O(A) voluntário(a) está ciente de que o serviço voluntário, conforme a Lei nº 9.608, de 18 de fevereiro de 1998, “não gera vínculo empregatício, nem obrigação de natureza trabalhista, previdenciária ou afim”, não cabendo portanto, ao(à) voluntário(a) qualquer remuneração ou ressarcimento pelos serviços prestados à referida associação.</li></ol></div>`;
  const personalFields = embedded
    ? `<label class="field cpf-field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field name-field"><span>Nome completo <b>*</b></span><input name="nome" autocomplete="off" required></label><label class="field birthdate-field"><span>Data de nascimento <b>*</b></span><input name="nascimento" inputmode="numeric" placeholder="dd/mm/aaaa" required></label><label class="field phone-field"><span>Telefone <b>*</b></span><input name="telefone" required></label>`
    : `<label class="field cpf-field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field birthdate-field"><span>Data de nascimento <b>*</b></span><input name="nascimento" inputmode="numeric" placeholder="dd/mm/aaaa" required></label><label class="field name-field"><span>Nome completo <b>*</b></span><input name="nome" autocomplete="off" required></label><label class="field phone-field"><span>Telefone <b>*</b></span><input name="telefone" required></label>`;
  const spouseFields = embedded
    ? `<label class="field spouse-cpf-field"><span>CPF <b>*</b></span><input name="spouseCpf"></label><label class="field spouse-name-field"><span>Nome completo <b>*</b></span><input name="spouseNome" autocomplete="off"></label><label class="field spouse-birthdate-field"><span>Data de nascimento <b>*</b></span><input name="spouseNascimento" inputmode="numeric" placeholder="dd/mm/aaaa"></label><label class="field spouse-phone-field"><span>Telefone <b>*</b></span><input name="spouseTelefone"></label>`
    : `<label class="field spouse-cpf-field"><span>CPF <b>*</b></span><input name="spouseCpf"></label><label class="field spouse-birthdate-field"><span>Data de nascimento <b>*</b></span><input name="spouseNascimento" inputmode="numeric" placeholder="dd/mm/aaaa"></label><label class="field spouse-name-field"><span>Nome completo <b>*</b></span><input name="spouseNome" autocomplete="off"></label><label class="field spouse-phone-field"><span>Telefone <b>*</b></span><input name="spouseTelefone"></label>`;
  const sectorAreasForRegistration = forcedSector ? [sectorArea(forcedSector)] : ['escondida', 'sala'];
  const publicSectors = sectorAreasForRegistration.map((area) => `<section class="public-sector-area"><h4>${area === 'escondida' ? 'Equipe escondida' : 'Equipe Sala'}</h4><div class="choice-grid sectors">${sortSectors(sectorsForRegistration.filter((sector) => sectorArea(sector) === area)).map((sector) => `<label class="choice"><input type="radio" name="setores" value="${escapeHtml(sector)}"><span>${escapeHtml(sector)}</span></label>`).join('') || '<p class="hint">Nenhum setor configurado nesta área.</p>'}</div></section>`).join('');
  const sectorCoordinatorOption = embedded ? '<label class="choice sector-coordinator-option"><input type="checkbox" name="coordenacaoSetor" value="sim"><span>Coordenação do setor</span></label>' : '';
  const sectorRegistrationSection = forcedSector
    ? `<input type="hidden" name="setores" value="${escapeHtml(forcedSector)}">`
    : `<section class="form-section"><div class="section-heading"><span>05</span><div><h2>Setor de trabalho <b>*</b></h2></div></div><div class="choice-block">${publicSectors}${sectorCoordinatorOption}</div></section>`;
  const kidsAgeLimitHint = Number(retreat.idadeMaximaEspacoKids) > 0 ? ` Idade máxima: ${Number(retreat.idadeMaximaEspacoKids)} ano(s).` : '';
  const kidsAgeLimitMessage = 'A idade da criança supera a idade máxima para ocupar o espaço kids neste retiro. Por gentileza consulte a coordenação';
  const kidAgeLimitViolation = (source) => {
    if (Number(retreat.idadeMaximaEspacoKids) <= 0) return null;
    for (let index = 1; index <= 5; index += 1) {
      const control = source.elements[`kidNascimento${index}`];
      const normalizedBirth = kidBirthDateReadyForAgeCheck(control?.value);
      if (!control || control.disabled || !normalizedBirth) continue;
      if (kidExceedsRetreatAgeLimit(retreat, normalizedBirth)) return { index, control };
    }
    return null;
  };
  const canEditEmbeddedRegistration = !embedded || canModifyRetreat(retreat);
  const adminSearchPanel = embedded ? `<section class="admin-registration-tools student-registration-tools panel"><div class="panel-heading"><div><h2>Cadastro da equipe de trabalho</h2><p>Busque por nome, CPF ou setor para editar ou consultar a ficha do retiro em foco.</p></div><div class="student-registration-actions">${canEditEmbeddedRegistration ? '<button type="button" id="new-registration">Incluir novo</button>' : '<span class="status concluido">Somente consulta</span>'}</div></div><label class="field registration-search-field"><span>Busca</span><input id="registration-search" autocomplete="off" placeholder="Digite nome, CPF ou setor"></label><div id="registration-search-results" class="registration-search-results" hidden></div></section>` : '';
  mount.innerHTML = `<main class="${publicShellClass}"><header class="hero"><div><p class="eyebrow">Equipe de trabalho</p><h1>${escapeHtml(retreat.nome)}</h1><p class="hero-copy">Preencha seus dados para organizarmos sua participação com carinho e antecedência.</p></div></header>${adminSearchPanel}<form id="public-form" novalidate>${stateDatalist()}
    <section class="form-section form-type-section common-section"><fieldset class="choice-block form-type-choice full"><legend>Esta ficha é: <b>*</b></legend>${binaryChoices('tipoFicha', ['Individual', 'Casal'])}</fieldset></section>
    <section class="form-section"><div class="section-heading student-personal-heading"><span>01</span><div><h2>Seus Dados</h2></div>${embedded ? '<div class="student-heading-actions registration-heading-actions" hidden><button type="button" id="edit-selected-registration">Editar</button><button type="button" id="delete-selected-registration">Excluir participação no retiro</button></div>' : ''}</div><div class="fields two-columns">${personalFields}<fieldset class="choice-block full"><legend>Gênero <b>*</b></legend>${binaryChoices('genero', ['Masculino', 'Feminino'])}</fieldset></div></section>
    <section class="form-section"><div class="section-heading"><span>02</span><div><h2>Sua participação</h2><p>Conte-nos quais retiros você já fez na família EPC.</p></div></div><div class="choice-block"><h3>Retiro(s) que fez <b>*</b></h3>${choices('retiros', ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'])}</div><div class="choice-block day-confirmation-block"><h3>Dias confirmados para trabalhar <b>*</b></h3>${dayConfirmations('dias', serviceDays)}</div></section>
    <section class="form-section couple-only" hidden><div class="section-heading"><span>03</span><div><h2>Segundo cônjuge</h2><p>Dados específicos da segunda pessoa do casal.</p></div></div><div class="fields two-columns">${spouseFields}<fieldset class="choice-block full"><legend>Gênero <b>*</b></legend>${binaryChoices('spouseGenero', ['Masculino', 'Feminino'])}</fieldset></div><div class="choice-block"><h3>Retiro(s) que fez <b>*</b></h3>${choices('spouseRetiros', ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'])}</div><div class="choice-block day-confirmation-block"><h3>Dias confirmados para trabalhar <b>*</b></h3>${dayConfirmations('spouseDias', serviceDays)}</div></section>
    <section class="form-section common-section"><div class="section-heading"><span>04</span><div><h2>Endereço</h2></div></div><div class="fields address-fields"><label class="field cep-field"><span>CEP <b>*</b></span><input name="cep" inputmode="numeric" placeholder="00000-000" required></label><label class="field street-field"><span>Rua / Avenida <b>*</b></span><input name="endereco" required></label><label class="field number-field"><span>Número <b>*</b></span><input name="numero" required></label><label class="field bairro-field"><span>Bairro <b>*</b></span><input name="bairro" required></label><label class="field city-field"><span>Cidade <b>*</b></span><input name="cidade" required></label><label class="field state-field"><span>Estado <b>*</b></span><input name="estado" maxlength="2" required></label></div></section>
    ${sectorRegistrationSection}
    <section class="form-section compact-section"><div class="section-heading"><span>06</span><div><h2>Itens e contribuição</h2><p>Escolhas necessárias para sua inscrição.</p></div></div><div class="fields choice-cards"><div class="choice-block quadrante-print-option"><h3>Quer quadrante impresso? <b>*</b></h3>${binaryChoices('quadrante', ['Sim', 'Não'])}<p class="hint">O quadrante (relação de todas a pessoas que serviram no retiro com os seus contatos) é disponibilizado em PDF após o retiro, mas se você quiser levar impresso no dia do retiro, selecione Sim.</p></div><div class="field choice-block contribution-field"><span data-contribution-label>Valor da inscrição</span><h3>Quer a foto oficial do retiro? <b>*</b></h3>${binaryChoices('foto', ['Sim', 'Não'])}<p class="hint">Valor da foto: ${currency(retreat.valorFoto ?? 10)}.</p><input name="contribuicao" value="${currency(retreat.valorInscricaoVoluntario)}" readonly><p class="hint payment-instructions"><strong><u>Fazer pix CNPJ 52.109.946/0001-94</u></strong> e encaminhar o comprovante no privado para o coordenador do setor que você vai servir.</p></div></div></section>
    <section class="form-section"><div class="section-heading"><span>07</span><div><h2>Espaço Kids <b>*</b></h2><p>Informe suas crianças ou marque que não necessita deste espaço.</p></div></div><div class="choice-block"><div class="kids-heading"><h3>Espaço Kids</h3><label><input type="checkbox" name="kidsNotNeeded"> Não necessito do Espaço Kids</label></div><p class="hint kids-hint">Informe o nome de suas crianças que utilizarão o Espaço Kids ou marque que não necessita. Deixe em branco as linhas não utilizadas.${kidsAgeLimitHint}</p><div class="kids-list">${kidsFields}</div></div></section>
    <section class="form-section"><div class="section-heading"><span>08</span><div><h2>Termo de adesão de voluntariado <b>*</b></h2><p>Leia e aceite o termo para concluir sua inscrição.</p></div></div><div class="volunteer-term-topic"><div><h3>Termo de adesão de voluntariado</h3></div><button type="button" id="read-volunteer-term">Ler termo</button></div></section>
    <p id="form-message" class="form-message"></p><div class="form-actions"><p><b>*</b> Campos obrigatórios</p><button type="submit">${includeSubmitText} <span>→</span></button></div></form></main>`;
  mount.querySelector('.hero h1').textContent = publicHeading;
  mount.querySelector('.hero-copy').textContent = publicLead;
  if (!embedded) document.title = publicHeading;
  const form = mount.querySelector('#public-form');
  syncChoiceStates(form);
  wireStateFields(form);
  wireCepLookup(form);
  wireCpfFields(form);
  wireTypedBirthDates(form);
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target.matches('textarea, button')) return;
    event.preventDefault();
    const controls = [...form.querySelectorAll('input, select, textarea, button[type="submit"]')]
      .filter((control) => !control.disabled && !control.hidden && control.offsetParent !== null && control.type !== 'hidden');
    const current = controls.indexOf(event.target);
    const next = controls[current + 1];
    if (next) next.focus();
    else form.querySelector('button[type="submit"]')?.focus();
  });
  const showSectorTeamAlert = (area) => {
    const isHiddenTeam = area === 'escondida';
    const title = isHiddenTeam ? hiddenTeamNoticeTitle : roomTeamNoticeTitle;
    const text = isHiddenTeam ? hiddenTeamNoticeText : roomTeamNoticeText;
    const label = isHiddenTeam ? 'Equipe escondida' : 'Equipe Sala';
    mount.querySelector('.hidden-team-alert-overlay')?.remove();
    const overlay = document.createElement('section');
    overlay.className = 'hidden-team-alert-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sector-team-alert-title');
    overlay.innerHTML = `<div class="hidden-team-alert-dialog ${isHiddenTeam ? 'is-hidden-team' : 'is-room-team'}"><p class="eyebrow">${label}</p><h2 id="sector-team-alert-title">${title}</h2><p>${text}</p><button type="button" class="hidden-team-alert-close">Li e entendi</button></div>`;
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') close();
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('.hidden-team-alert-close').addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);
    mount.append(overlay);
    overlay.querySelector('.hidden-team-alert-close').focus();
  };
  form.querySelectorAll('[name="setores"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!embedded && input.checked) showSectorTeamAlert(sectorArea(input.value));
    });
  });
  let volunteerTermAccepted = false;
  const syncVolunteerTermState = () => {
    const button = form.querySelector('#read-volunteer-term');
    const topic = button?.closest('.volunteer-term-topic');
    if (!button || !topic) return;
    topic.classList.toggle('is-accepted', volunteerTermAccepted);
    button.textContent = volunteerTermAccepted ? 'Termo lido e aceito' : 'Ler termo';
  };
  const showVolunteerTermAlert = () => {
    mount.querySelector('.hidden-team-alert-overlay')?.remove();
    const overlay = document.createElement('section');
    overlay.className = 'hidden-team-alert-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'volunteer-term-title');
    overlay.innerHTML = `<div class="hidden-team-alert-dialog volunteer-term-dialog"><p class="eyebrow">Voluntariado</p><h2 id="volunteer-term-title">${volunteerTermTitle}</h2>${volunteerTermContent}<button type="button" class="hidden-team-alert-close">Lí e concordo</button></div>`;
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') close();
    };
    const accept = () => {
      volunteerTermAccepted = true;
      syncVolunteerTermState();
      form.querySelector('#form-message')?.replaceChildren('');
      close();
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('.hidden-team-alert-close').addEventListener('click', accept);
    document.addEventListener('keydown', onKeydown);
    mount.append(overlay);
    overlay.querySelector('.hidden-team-alert-close').focus();
  };
  form.querySelector('#read-volunteer-term')?.addEventListener('click', showVolunteerTermAlert);
  syncVolunteerTermState();
  let editingEntry = null;
  let editingSpouseEntry = null;
  let newRecordNeedsType = false;
  const registrationHeadingActions = embedded ? mount.querySelector('.registration-heading-actions') : null;
  const editSelectedRegistration = embedded ? mount.querySelector('#edit-selected-registration') : null;
  const deleteSelectedRegistration = embedded ? mount.querySelector('#delete-selected-registration') : null;
  const setRegistrationFormLocked = (locked) => {
    if (!embedded) return;
    const effectiveLocked = locked || !canEditEmbeddedRegistration;
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      if (control.type !== 'hidden') control.disabled = effectiveLocked;
    });
    form.querySelector('button[type="submit"]').disabled = effectiveLocked;
  };
  const syncRegistrationActions = () => {
    if (!embedded || !registrationHeadingActions) return;
    registrationHeadingActions.hidden = !editingEntry || !canEditEmbeddedRegistration;
  };
  const setChoices = (name, values) => {
    const selected = new Set(Array.isArray(values) ? values : [values]);
    form.querySelectorAll(`[name="${name}"]`).forEach((input) => { input.checked = selected.has(input.value); });
    syncChoiceStates(form);
  };
  const dayConfirmationInputs = (name) => serviceDays.map((day, index) => ({ day, input: form.querySelector(`[name="${dayConfirmationName(name, index)}"]:checked`) }));
  const selectedConfirmedDays = (name) => dayConfirmationInputs(name).filter((item) => item.input?.value === 'Sim').map((item) => item.day);
  const allDaysAnswered = (name) => dayConfirmationInputs(name).every((item) => Boolean(item.input));
  const firstUnansweredDay = (name) => {
    const index = dayConfirmationInputs(name).findIndex((item) => !item.input);
    return index >= 0 ? form.querySelector(`[name="${dayConfirmationName(name, index)}"]`) : null;
  };
  const setDayConfirmations = (name, selectedDays = []) => {
    const selected = new Set(selectedDays || []);
    serviceDays.forEach((day, index) => {
      const value = selected.has(day) ? 'Sim' : 'Não';
      const input = form.querySelector(`[name="${dayConfirmationName(name, index)}"][value="${value}"]`);
      if (input) input.checked = true;
    });
    syncChoiceStates(form);
  };
  const isCouple = () => new FormData(form).get('tipoFicha') === 'Casal';
  const syncContributionAmount = () => {
    const data = new FormData(form);
    const amount = volunteerContributionAmount(retreat, { casalId: isCouple() ? 'casal' : '', foto: data.get('foto') });
    form.elements.contribuicao.value = currency(amount);
    form.querySelector('[data-contribution-label]').textContent = isCouple() ? 'Valor da inscrição do casal' : 'Valor da inscrição';
  };
  const updateSubmitButton = () => {
    const label = editingEntry ? editSubmitText : includeSubmitText;
    form.querySelector('button[type="submit"]').innerHTML = `${isCouple() && embedded ? `${label} do casal` : label} <span>→</span>`;
  };
  const syncSpouseGender = () => {
    const selected = new FormData(form).get('genero');
    const opposite = selected === 'Masculino' ? 'Feminino' : selected === 'Feminino' ? 'Masculino' : '';
    form.querySelectorAll('[name="spouseGenero"]').forEach((input) => {
      input.checked = Boolean(opposite) && input.value === opposite;
      input.disabled = !isCouple() || Boolean(opposite);
    });
  };
  const spouseGenderValue = () => {
    const selected = new FormData(form).get('genero');
    return selected === 'Masculino' ? 'Feminino' : selected === 'Feminino' ? 'Masculino' : new FormData(form).get('spouseGenero');
  };
  const setCoupleMode = (enabled) => {
    const spouseSection = form.querySelector('.couple-only');
    spouseSection.hidden = !enabled;
    spouseSection.querySelectorAll('input, textarea, select').forEach((field) => { field.disabled = !enabled; });
    ['spouseNome', 'spouseCpf', 'spouseNascimento', 'spouseTelefone'].forEach((name) => { form.elements[name].required = enabled; });
    if (enabled) syncSpouseGender();
    syncContributionAmount();
    updateSubmitButton();
  };
  setCoupleMode(false);
  const typeSelectionMessage = 'Primeiro selecione se a ficha é Individual ou Casal';
  const typeSelectionControl = (control) => control?.name === 'tipoFicha';
  const typeSelectionLocked = () => !form.querySelector('[name="tipoFicha"]:checked');
  const showTypeSelectionMessage = () => {
    form.querySelector('#form-message').textContent = typeSelectionMessage;
    const typeSection = form.querySelector('.form-type-section');
    typeSection?.classList.add('field-warning');
    typeSection?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const syncTypeSelectionLock = () => {
    const locked = typeSelectionLocked();
    form.querySelectorAll('input, textarea').forEach((control) => {
      if (control.type === 'hidden' || typeSelectionControl(control)) return;
      control.readOnly = locked && !control.disabled;
      control.classList.toggle('is-waiting-type', locked);
    });
    if (!locked) form.querySelector('.form-type-section')?.classList.remove('field-warning');
  };
  const guardTypeSelection = (event) => {
    if (!typeSelectionLocked()) return;
    const control = event.target.closest?.('input, select, textarea, button') || event.target.closest?.('label')?.querySelector('input, select, textarea, button');
    if (!control || typeSelectionControl(control)) return;
    if (control.id === 'delete-selected-registration' || control.id === 'edit-selected-registration') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'focusin') control.blur();
    showTypeSelectionMessage();
  };
  ['pointerdown', 'click', 'focusin', 'keydown', 'beforeinput'].forEach((eventName) => {
    form.addEventListener(eventName, guardTypeSelection, true);
  });
  form.querySelectorAll('[name="foto"]').forEach((input) => input.addEventListener('change', syncContributionAmount));
  const syncKidsNeed = () => {
    const notNeeded = form.elements.kidsNotNeeded?.checked;
    form.querySelectorAll('.kids-list input').forEach((field) => {
      if (notNeeded) field.value = '';
      field.disabled = Boolean(notNeeded);
    });
    form.querySelector('.kids-list')?.classList.toggle('is-disabled', Boolean(notNeeded));
    form.querySelector('.kids-list')?.toggleAttribute('hidden', Boolean(notNeeded));
    form.querySelector('.kids-hint')?.toggleAttribute('hidden', Boolean(notNeeded));
  };
  form.elements.kidsNotNeeded?.addEventListener('change', syncKidsNeed);
  syncKidsNeed();
  syncTypeSelectionLock();
  const setNewRecordTypeLock = (locked) => {
    newRecordNeedsType = locked;
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      field.disabled = locked && !['nome', 'cpf', 'tipoFicha'].includes(field.name);
    });
    form.querySelector('button[type="submit"]').disabled = locked;
    syncTypeSelectionLock();
  };
  const resetFormForInclusion = (nome = form.elements.nome.value, cpf = form.elements.cpf.value) => {
    const selectedType = new FormData(form).get('tipoFicha');
    form.querySelector('.inline-partner-registration')?.remove();
    form.reset();
    volunteerTermAccepted = false;
    syncVolunteerTermState();
    form.elements.nome.value = nome;
    form.elements.cpf.value = cpf;
    if (selectedType) setChoices('tipoFicha', selectedType);
    editingEntry = null;
    editingSpouseEntry = null;
    setCoupleMode(selectedType === 'Casal');
    syncKidsNeed();
    form.querySelector('#delete-registration')?.remove();
    form.querySelector('#form-message').textContent = selectedType ? 'Nenhuma pessoa encontrada. Continue para incluir um novo cadastro.' : 'Nenhuma pessoa encontrada. Escolha se esta ficha é Individual ou Casal antes de salvar.';
    setNewRecordTypeLock(!selectedType);
    syncTypeSelectionLock();
  };
  const startNewRegistration = () => {
    form.querySelector('.inline-partner-registration')?.remove();
    form.reset();
    volunteerTermAccepted = false;
    syncVolunteerTermState();
    editingEntry = null;
    editingSpouseEntry = null;
    form.querySelector('#delete-registration')?.remove();
    setNewRecordTypeLock(false);
    setRegistrationFormLocked(false);
    syncRegistrationActions();
    setCoupleMode(false);
    syncKidsNeed();
    syncTypeSelectionLock();
    form.querySelector('#form-message').textContent = 'Novo cadastro para o retiro em foco.';
    form.querySelector('[name="tipoFicha"]')?.focus();
  };
  const showSavedSpouse = (spouseEntry) => {
    const spouse = people.find((person) => person.id === spouseEntry.pessoaId);
    if (!spouse) return;
    const overlay = document.createElement('section');
    overlay.className = 'partner-registration';
    overlay.innerHTML = `<section class="saved-spouse-card"><button type="button" class="back-button">← Voltar para a primeira ficha</button><p class="eyebrow">Cadastro do cônjuge</p><h1>Informe os dados do(a) cônjuge</h1><div class="simple-list"><div><strong>Nome completo</strong><span>${escapeHtml(spouse.nome)}</span></div><div><strong>Gênero</strong><span>${escapeHtml(spouse.genero || 'Não informado')}</span></div><div><strong>Data de nascimento</strong><span>${date(spouse.nascimento)}</span></div><div><strong>Telefone</strong><span>${escapeHtml(spouse.telefone || 'Não informado')}</span></div><div><strong>Endereço</strong><span>${escapeHtml([[spouse.endereco, spouse.numero].filter(Boolean).join(', '), spouse.bairro, spouse.cidade, spouse.estado].filter(Boolean).join(' · ') || 'Não informado')}</span></div><div><strong>Setor de trabalho</strong><span>${escapeHtml(spouseEntry.setores.join(', '))}</span></div><div><strong>Dias disponíveis</strong><span>${escapeHtml(spouseEntry.dias.join(', '))}</span></div><div><strong>Observação</strong><span>${escapeHtml(spouseEntry.observacao || 'Não informado')}</span></div></div></section>`;
    overlay.querySelector('.back-button').addEventListener('click', () => overlay.remove());
    app.append(overlay);
  };
  const linkedSpouseForPerson = (personId) => {
    const person = people.find((item) => item.id === personId || normalizeCpf(item.cpf || item.id) === normalizeCpf(personId));
    const linkedSpouseId = person?.conjugeId || person?.spouseId || person?.casalPessoaId;
    if (linkedSpouseId) {
      const spouse = people.find((item) => item.id === linkedSpouseId || normalizeCpf(item.cpf || item.id) === normalizeCpf(linkedSpouseId));
      if (spouse) {
        const spouseEntry = enrolments
          .filter((entry) => entry.pessoaId === spouse.id || normalizeCpf(entry.pessoaId) === normalizeCpf(spouse.id))
          .sort((first, second) => String(second.atualizadoEm || second.enviadoEm || '').localeCompare(String(first.atualizadoEm || first.enviadoEm || '')))[0] || {};
        return { spouse, spouseEntry };
      }
    }
    const entries = enrolments
      .filter((entry) => entry.pessoaId === personId && entry.casalId)
      .sort((first, second) => String(second.atualizadoEm || second.enviadoEm || '').localeCompare(String(first.atualizadoEm || first.enviadoEm || '')));
    for (const entry of entries) {
      const spouseEntry = enrolments.find((item) => item.casalId === entry.casalId && item.pessoaId !== personId);
      const spouse = spouseEntry && people.find((item) => item.id === spouseEntry.pessoaId);
      if (spouse) return { spouse, spouseEntry };
    }
    return null;
  };
  const linkCouplePeople = async (first, second, casalId) => {
    const firstPerson = { ...first, casalId, conjugeId: second.id, updatedAt: new Date().toISOString() };
    const secondPerson = { ...second, casalId, conjugeId: first.id, updatedAt: new Date().toISOString() };
    await Promise.all([dataService.savePessoa(firstPerson), dataService.savePessoa(secondPerson)]);
    people = people.map((person) => person.id === first.id ? firstPerson : person.id === second.id ? secondPerson : person);
  };
  const spouseRegisteredMessage = (spouse, spouseEntry) => `Seu conjuge ${spouse?.nome || 'informado'} já fez inscrição no setor ${(spouseEntry?.setores || []).join(', ') || 'não informado'}`;
  const clearSpouseFields = () => {
    ['spouseCpf', 'spouseNome', 'spouseNascimento', 'spouseTelefone'].forEach((name) => {
      if (form.elements[name]) form.elements[name].value = '';
    });
    ['spouseGenero', 'spouseRetiros'].forEach((name) => {
      form.querySelectorAll(`[name="${name}"]`).forEach((input) => { input.checked = false; });
    });
    serviceDays.forEach((day, index) => {
      form.querySelectorAll(`[name="${dayConfirmationName('spouseDias', index)}"]`).forEach((input) => { input.checked = false; });
    });
    syncChoiceStates(form);
  };
  const showSpouseAlreadyRegisteredDialog = (spouse, spouseEntry) => new Promise((resolve) => {
    mount.querySelector('.hidden-team-alert-overlay')?.remove();
    const overlay = document.createElement('section');
    overlay.className = 'hidden-team-alert-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'spouse-registered-title');
    overlay.innerHTML = `<div class="hidden-team-alert-dialog spouse-registered-dialog"><p class="eyebrow">Cadastro de casal</p><h2 id="spouse-registered-title">Cônjuge já cadastrado</h2><p>${escapeHtml(spouseRegisteredMessage(spouse, spouseEntry))}.</p><p>Deseja alterar os dados particulares do cônjuge?</p><div class="spouse-registered-actions"><button type="button" data-spouse-registered-yes>Sim</button><button type="button" data-spouse-registered-no>Não</button></div></div>`;
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        close();
        resolve(false);
      }
    };
    overlay.querySelector('[data-spouse-registered-yes]').addEventListener('click', () => {
      close();
      resolve(true);
    });
    overlay.querySelector('[data-spouse-registered-no]').addEventListener('click', () => {
      close();
      mount.querySelector('.hidden-team-alert-overlay')?.remove();
      const notice = document.createElement('section');
      notice.className = 'hidden-team-alert-overlay';
      notice.setAttribute('role', 'dialog');
      notice.setAttribute('aria-modal', 'true');
      notice.setAttribute('aria-labelledby', 'spouse-contact-title');
      notice.innerHTML = `<div class="hidden-team-alert-dialog spouse-registered-dialog"><p class="eyebrow">Cadastro de casal</p><h2 id="spouse-contact-title">Atenção</h2><p>Entre em contato com a coordenação do retiro.</p><button type="button" class="hidden-team-alert-close">OK</button></div>`;
      notice.querySelector('.hidden-team-alert-close').addEventListener('click', async () => {
        notice.remove();
        await renderPublicForm(id, embedded, sectorToken);
        resolve(true);
      });
      mount.append(notice);
      notice.querySelector('.hidden-team-alert-close').focus();
    });
    document.addEventListener('keydown', onKeydown);
    mount.append(overlay);
    overlay.querySelector('[data-spouse-registered-yes]').focus();
  });
  const loadLinkedSpouse = async (person) => {
    if (!isCouple() || !person) return false;
    const linked = linkedSpouseForPerson(person.id);
    if (!linked) return false;
    const currentSpouseEntry = enrolments.find((entry) => entry.retiroId === id && entryMatchesCpf(entry, normalizeCpf(linked.spouse.cpf || linked.spouse.id)));
    if (!embedded && currentSpouseEntry) {
      const shouldContinue = await showSpouseAlreadyRegisteredDialog(linked.spouse, currentSpouseEntry);
      if (!shouldContinue) return false;
      editingSpouseEntry = currentSpouseEntry;
      clearSpouseFields();
      form.querySelector('#form-message').textContent = 'Informe os dados particulares do cônjuge para atualizar este cadastro.';
      return true;
    }
    if (currentSpouseEntry) editingSpouseEntry = currentSpouseEntry;
    if (!embedded) clearSpouseFields();
    const spouseCpf = normalizeCpf(linked.spouse.cpf || linked.spouse.id);
    form.elements.spouseCpf.value = isValidCpf(spouseCpf) ? formatCpf(spouseCpf) : '';
    form.elements.spouseNome.value = linked.spouse.nome || '';
    form.elements.spouseNascimento.value = formatDateInput(linked.spouse.nascimento);
    form.elements.spouseTelefone.value = linked.spouse.telefone || '';
    form.elements.spouseTelefone.dispatchEvent(new Event('input'));
    setChoices('spouseGenero', linked.spouse.genero);
    if (embedded) {
      setChoices('spouseRetiros', (currentSpouseEntry || linked.spouseEntry).retirosAnteriores || []);
      setDayConfirmations('spouseDias', (currentSpouseEntry || linked.spouseEntry).dias || []);
    }
    form.elements.spouseCpf.dispatchEvent(new Event('change'));
    if (form.querySelector('#form-message').textContent !== duplicatePublicCpfMessage) {
      form.querySelector('#form-message').textContent = 'Encontramos o cônjuge vinculado a este CPF. Revise os dados antes de enviar.';
    }
    return true;
  };
  const deleteRegistration = async (entry) => {
    if (embedded && !ensureRetreatCanBeChanged(retreat, 'excluir fichas da equipe')) return;
    if (!entry || !confirm(`Excluir a participação de ${entry.nome} neste retiro?`)) return;
    const entriesToDelete = [entry, entry.casalId && enrolments.find((item) => item.casalId === entry.casalId && item.retiroId === entry.retiroId && item.pessoaId !== entry.pessoaId)].filter(Boolean);
    for (const entryToDelete of entriesToDelete) {
      await dataService.deleteAdesao(entryToDelete.id);
    }
    await loadData();
    renderPublicForm(id, true);
  };
  const loadEntryForEdit = (entry, { locked = false } = {}) => {
    const person = people.find((item) => item.id === entry.pessoaId);
    if (!person) return;
    form.reset();
    editingEntry = entry;
    editingSpouseEntry = entry.casalId && enrolments.find((item) => item.casalId === entry.casalId && item.retiroId === entry.retiroId && item.pessoaId !== entry.pessoaId);
    volunteerTermAccepted = Boolean(entry.termoVoluntariadoAceito);
    syncVolunteerTermState();
    setNewRecordTypeLock(false);
    ['nome', 'cpf', 'nascimento', 'telefone', 'endereco', 'numero', 'bairro', 'cidade', 'estado'].forEach((name) => { form.elements[name].value = name === 'cpf' ? formatCpf(person.cpf || person.id) : name === 'nascimento' ? formatDateInput(person[name]) : (person[name] || ''); });
    form.elements.cep.value = person.cep || '';
    setChoices('retiros', entry.retirosAnteriores || []); setDayConfirmations('dias', entry.dias || []); setChoices('setores', entry.setores || []); setChoices('quadrante', entry.quadrante); setChoices('foto', entry.foto); setChoices('tipoFicha', entry.casalId ? 'Casal' : 'Individual'); setChoices('genero', person.genero); setChoices('coordenacaoSetor', entry.coordenacaoSetor || editingSpouseEntry?.coordenacaoSetor ? 'sim' : '');
    if (form.elements.coordenacao) form.elements.coordenacao.value = entry.coordenacao || '';
    form.elements.kidsNotNeeded.checked = Boolean(entry.espacoKidsNaoNecessito);
    (entry.espacoKids || []).forEach((kid, index) => { if (index < 5) { form.elements[`kidNome${index + 1}`].value = kid.nome || ''; form.elements[`kidNascimento${index + 1}`].value = kid.nascimento || ''; } });
    syncKidsNeed();
    if (editingSpouseEntry) {
      const spouse = people.find((item) => item.id === editingSpouseEntry.pessoaId);
      if (spouse) {
        form.elements.spouseNome.value = spouse.nome || '';
        form.elements.spouseCpf.value = formatCpf(spouse.cpf || spouse.id);
        form.elements.spouseNascimento.value = formatDateInput(spouse.nascimento);
        form.elements.spouseTelefone.value = spouse.telefone || '';
        setChoices('spouseGenero', spouse.genero);
      }
      setChoices('spouseRetiros', editingSpouseEntry.retirosAnteriores || []);
      setDayConfirmations('spouseDias', editingSpouseEntry.dias || []);
    }
    setCoupleMode(Boolean(entry.casalId));
    syncTypeSelectionLock();
    syncRegistrationActions();
    setRegistrationFormLocked(Boolean(locked));
    syncTypeSelectionLock();
    form.querySelector('#form-message').textContent = !canEditEmbeddedRegistration ? 'Retiro concluido: cadastro da equipe carregado apenas para consulta.' : locked ? 'Cadastro da equipe carregado. Clique em Editar para alterar.' : 'Editando o cadastro já enviado para este retiro.';
  };
  const orderedRegistrationEntries = (items) => [...items].sort((first, second) => {
    const order = { 'Primeira pessoa': 0, 'Segunda pessoa': 1 };
    return (order[first.papelNoCasal] ?? 9) - (order[second.papelNoCasal] ?? 9)
      || String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR');
  });
  const registrationSearchRows = () => {
    const rows = [];
    const usedCouples = new Set();
    enrolments
      .filter((entry) => entry.retiroId === id)
      .forEach((entry) => {
        if (!entry.casalId) {
          rows.push({ id: entry.id, entries: [entry], selectedEntry: entry });
          return;
        }
        if (usedCouples.has(entry.casalId)) return;
        const couple = orderedRegistrationEntries(enrolments.filter((item) => item.retiroId === id && item.casalId === entry.casalId));
        usedCouples.add(entry.casalId);
        rows.push({ id: `casal-${entry.casalId}`, entries: couple, selectedEntry: couple[0] || entry, isCouple: true });
      });
    return rows;
  };
  const rowSearchText = (row) => normalizeText(row.entries.flatMap((entry) => {
    const person = people.find((item) => item.id === entry.pessoaId);
    const snapshot = entry.dadosPessoais || {};
    const cpf = normalizeCpf(person?.cpf || snapshot.cpf || person?.id);
    return [entry.nome, snapshot.nome, cpf, cpf && formatCpf(cpf), person?.telefone, snapshot.telefone, entry.setores?.join(' '), entry.dias?.join(' ')];
  }).filter(Boolean).join(' '));
  const rowTitle = (row) => row.entries.map((entry) => entry.nome).filter(Boolean).join(' e ') || 'Sem nome';
  const rowDetail = (row) => {
    const cpfs = row.entries.map((entry) => {
      const person = people.find((item) => item.id === entry.pessoaId);
      const cpf = normalizeCpf(person?.cpf || entry.dadosPessoais?.cpf || person?.id);
      return cpf ? formatCpf(cpf) : '';
    }).filter(Boolean);
    const sectors = sortSectors(row.entries.flatMap((entry) => entry.setores || []));
    const cpfText = cpfs.length ? cpfs.join(' e ') : 'CPF não informado';
    const sectorText = sectors.length ? sectors.join(', ') : 'Sem setor';
    return row.isCouple ? `${cpfText} · Casal · ${sectorText}` : `${cpfText} · ${sectorText}`;
  };
  let skipNextNameCascade = false;
  if (embedded) {
    const nameInput = form.elements.nome;
    const nameField = nameInput.closest('.field');
    const cascade = document.createElement('div'); cascade.className = 'person-cascade'; cascade.hidden = true; nameField.append(cascade);
    const renderCascade = () => { const currentName = nameInput.value; const term = normalizeText(currentName); const rows = registrationSearchRows().filter((row) => !term || normalizeText(rowTitle(row)).includes(term)); const selectedType = new FormData(form).get('tipoFicha'); if (term && !rows.length) resetFormForInclusion(currentName); cascade.innerHTML = rows.length ? rows.map((row) => `<button type="button" data-existing-entry="${escapeHtml(row.selectedEntry.id)}"><strong>${escapeHtml(rowTitle(row))}</strong><span>${escapeHtml(rowDetail(row))}</span></button>`).join('') : `<p>${term && !selectedType ? 'Nenhuma pessoa encontrada. Escolha se esta ficha é Individual ou Casal antes de salvar.' : 'Nenhuma pessoa encontrada. Continue para incluir um novo cadastro.'}</p>`; cascade.hidden = false; cascade.querySelectorAll('[data-existing-entry]').forEach((button) => button.addEventListener('click', () => { const entry = enrolments.find((item) => item.id === button.dataset.existingEntry); if (entry) { loadEntryForEdit(entry, { locked: true }); cascade.hidden = true; } })); };
    const closeNameCascade = (event) => { if (!nameField.contains(event.target)) cascade.hidden = true; };
    nameInput.addEventListener('focus', () => {
      if (skipNextNameCascade) {
        skipNextNameCascade = false;
        cascade.hidden = true;
        return;
      }
      renderCascade();
    }); nameInput.addEventListener('input', renderCascade);
    nameField.addEventListener('focusout', (event) => { if (!nameField.contains(event.relatedTarget)) cascade.hidden = true; });
    document.addEventListener('pointerdown', closeNameCascade, true);
    document.addEventListener('focusin', closeNameCascade, true);
  }
  if (embedded) {
    const searchInput = mount.querySelector('#registration-search');
    const searchResults = mount.querySelector('#registration-search-results');
    let registrationSearchRequest = 0;
    const renderRegistrationSearch = async () => {
      const currentRequest = ++registrationSearchRequest;
      searchResults.hidden = false;
      searchResults.innerHTML = '<p>Carregando cadastros...</p>';
      try {
        [enrolments, people] = await Promise.all([dataService.listAdesoes(), dataService.listPessoas()]);
      } catch (error) {
        searchResults.innerHTML = '<p>Não foi possível carregar os cadastros. Atualize a página e tente novamente.</p>';
        return;
      }
      if (currentRequest !== registrationSearchRequest) return;
      const term = normalizeText(searchInput.value);
      const rows = registrationSearchRows()
        .filter((row) => !term || rowSearchText(row).includes(term))
        .sort((first, second) => rowTitle(first).localeCompare(rowTitle(second), 'pt-BR'));
      searchResults.innerHTML = rows.length ? rows.map((row) => {
        return `<article><button type="button" class="student-search-choice" data-registration-select="${escapeHtml(row.selectedEntry.id)}"><strong>${escapeHtml(rowTitle(row))}</strong><span>${escapeHtml(rowDetail(row))}</span></button></article>`;
      }).join('') : '<p>Nenhum cadastro encontrado neste retiro.</p>';
      searchResults.querySelectorAll('[data-registration-select]').forEach((button) => button.addEventListener('click', () => {
        const entry = enrolments.find((item) => item.id === button.dataset.registrationSelect);
        if (entry) {
          loadEntryForEdit(entry, { locked: true });
          searchInput.value = rowTitle(registrationSearchRows().find((row) => row.selectedEntry.id === entry.id) || { entries: [entry] });
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          searchResults.hidden = true;
          skipNextNameCascade = true;
          form.elements.nome.focus({ preventScroll: true });
        }
      }));
    };
    const openRegistrationSearch = async () => {
      const currentRequest = ++registrationSearchRequest;
      const renderRows = () => {
        const term = normalizeText(searchInput.value);
        const rows = registrationSearchRows()
          .filter((row) => !term || rowSearchText(row).includes(term))
          .sort((first, second) => rowTitle(first).localeCompare(rowTitle(second), 'pt-BR'));
        searchResults.hidden = false;
        searchResults.innerHTML = rows.length ? rows.map((row) => {
          return `<article><button type="button" class="student-search-choice" data-registration-select="${escapeHtml(row.selectedEntry.id)}"><strong>${escapeHtml(rowTitle(row))}</strong><span>${escapeHtml(rowDetail(row))}</span></button></article>`;
        }).join('') : '<p>Nenhum cadastro encontrado neste retiro.</p>';
        searchResults.querySelectorAll('[data-registration-select]').forEach((button) => button.addEventListener('click', () => {
          const entry = enrolments.find((item) => item.id === button.dataset.registrationSelect);
          if (entry) {
            loadEntryForEdit(entry, { locked: true });
            searchInput.value = rowTitle(registrationSearchRows().find((row) => row.selectedEntry.id === entry.id) || { entries: [entry] });
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            searchResults.hidden = true;
            skipNextNameCascade = true;
            form.elements.nome.focus({ preventScroll: true });
          }
        }));
      };
      renderRows();
      try {
        const [latestEnrolments, latestPeople] = await Promise.all([dataService.listAdesoes(), dataService.listPessoas()]);
        if (currentRequest !== registrationSearchRequest) return;
        enrolments = latestEnrolments;
        people = latestPeople;
        renderRows();
      } catch {
        if (!registrationSearchRows().length) searchResults.innerHTML = '<p>Nao foi possivel carregar os cadastros.</p>';
      }
    };
    setRegistrationFormLocked(true);
    form.querySelector('#form-message').textContent = canEditEmbeddedRegistration ? 'Clique em Incluir novo para iniciar um cadastro.' : 'Retiro concluido: fichas da equipe disponiveis apenas para consulta.';
    mount.querySelector('#new-registration')?.addEventListener('click', () => {
      if (ensureRetreatCanBeChanged(retreat, 'incluir fichas da equipe')) startNewRegistration();
    });
    editSelectedRegistration?.addEventListener('click', () => {
      if (!ensureRetreatCanBeChanged(retreat, 'editar fichas da equipe')) return;
      if (!editingEntry) return;
      setRegistrationFormLocked(false);
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.elements.nome.focus({ preventScroll: true });
      form.querySelector('#form-message').textContent = 'Editando cadastro da equipe.';
    });
    deleteSelectedRegistration?.addEventListener('click', () => deleteRegistration(editingEntry));
    searchInput.addEventListener('focus', openRegistrationSearch);
    searchInput.addEventListener('click', openRegistrationSearch);
    searchInput.addEventListener('input', openRegistrationSearch);
    const registrationSearchField = searchInput.closest('.registration-search-field');
    const hideRegistrationSearch = () => { searchResults.hidden = true; };
    const closeRegistrationSearch = (event) => {
      if (searchInput === document.activeElement) return;
      if (!registrationSearchField.contains(event.target) && !searchResults.contains(event.target)) hideRegistrationSearch();
    };
    registrationSearchField.addEventListener('focusout', (event) => {
      if (!registrationSearchField.contains(event.relatedTarget) && !searchResults.contains(event.relatedTarget)) hideRegistrationSearch();
    });
    searchResults.addEventListener('focusout', (event) => {
      if (!registrationSearchField.contains(event.relatedTarget) && !searchResults.contains(event.relatedTarget)) hideRegistrationSearch();
    });
    document.addEventListener('pointerdown', closeRegistrationSearch, true);
    document.addEventListener('focusin', closeRegistrationSearch, true);
  }
  const duplicatePublicCpfMessage = 'Esse CPF já está cadastrado para esse retiro, dúvidas ou ajustes entre em contato com a coordenação';
  const publicStudentConflictMessage = 'Este CPF já está cadastrado como cursista deste retiro.';
  const spouseCpfConflictMessage = 'Este CPF já está cadastrado neste retiro e não pode ser incluído como cônjuge nesta ficha.';
  const publicCpfMessages = [duplicatePublicCpfMessage, publicStudentConflictMessage, spouseCpfConflictMessage];
  const setDuplicateCpfLock = (locked) => {
    if (embedded || editingEntry) return;
    form.querySelectorAll('input, textarea, select, button').forEach((field) => {
      const canCorrectCpf = ['cpf', 'spouseCpf'].includes(field.name);
      if (canCorrectCpf) {
        field.disabled = false;
        field.readOnly = false;
        field.classList.remove('is-waiting-type');
      } else {
        field.disabled = locked;
      }
    });
    if (!locked) {
      setCoupleMode(isCouple());
      syncKidsNeed();
      syncTypeSelectionLock();
    }
  };
  const showCpfLockMessage = (control, text) => {
    form.querySelectorAll('.cpf-duplicate-message').forEach((message) => message.remove());
    form.querySelector('#form-message').textContent = text;
    const field = control.closest('.field');
    if (!field) return;
    const message = document.createElement('small');
    message.className = 'cpf-duplicate-message';
    message.textContent = text;
    field.append(message);
    field.classList.add('field-warning');
    setDuplicateCpfLock(true);
  };
  const showDuplicateCpfMessage = (control) => showCpfLockMessage(control, duplicatePublicCpfMessage);
  const showStudentCpfConflictMessage = (control) => showCpfLockMessage(control, publicStudentConflictMessage);
  const clearDuplicateCpfMessage = () => {
    form.querySelectorAll('.cpf-duplicate-message').forEach((message) => message.remove());
    const currentMessage = form.querySelector('#form-message').textContent;
    if (publicCpfMessages.includes(currentMessage) || currentMessage.startsWith('Seu conjuge ')) form.querySelector('#form-message').textContent = '';
    setDuplicateCpfLock(false);
  };
  const listStudentsForCpfCheck = async () => {
    try {
      return await dataService.listCursistas();
    } catch {
      return [];
    }
  };
  const warnPublicStudentConflict = async (control, focus = false) => {
    if (!control) return false;
    const cpf = normalizeCpf(control.value);
    if (cpf.length !== 11 || !isValidCpf(cpf)) {
      clearDuplicateCpfMessage();
      return false;
    }
    const students = await listStudentsForCpfCheck();
    const hasConflict = students.some((student) => student.retiroId === id && normalizeCpf(student.cpf || student.id) === cpf);
    if (!hasConflict) {
      if (form.querySelector('#form-message').textContent === publicStudentConflictMessage) clearDuplicateCpfMessage();
      return false;
    }
    setTimeout(() => showStudentCpfConflictMessage(control));
    if (focus) {
      control.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => control.focus({ preventScroll: true }), 180);
    }
    return true;
  };
  const personIdsForCpf = (cpf) => new Set([
    cpf,
    ...people
      .filter((person) => person.id === cpf || normalizeCpf(person.cpf || person.id) === cpf)
      .flatMap((person) => [person.id, normalizeCpf(person.cpf || person.id)])
      .filter(Boolean),
  ]);
  const entryMatchesCpf = (entry, cpf) => personIdsForCpf(cpf).has(entry.pessoaId) || normalizeCpf(entry.pessoaId) === cpf;
  const findFocusedRetreatEntryByCpf = async (cpf, excludeEntryId = '') => {
    const latestEnrolments = await dataService.listAdesoes().catch(() => enrolments);
    if (Array.isArray(latestEnrolments)) enrolments = latestEnrolments;
    return enrolments.find((entry) => entry.retiroId === id && entry.id !== excludeEntryId && entryMatchesCpf(entry, cpf));
  };
  const warnSpouseCpfConflict = async (control, focus = false) => {
    if (!control || control.name !== 'spouseCpf' || !isCouple()) return false;
    const cpf = normalizeCpf(control.value);
    if (cpf.length !== 11 || !isValidCpf(cpf)) {
      if (form.querySelector('#form-message').textContent === spouseCpfConflictMessage) clearDuplicateCpfMessage();
      return false;
    }
    const mainCpf = normalizeCpf(form.elements.cpf.value);
    const teamConflictEntry = await findFocusedRetreatEntryByCpf(cpf, embedded ? editingSpouseEntry?.id : '');
    const students = await listStudentsForCpfCheck();
    const studentConflict = students.some((student) => student.retiroId === id && normalizeCpf(student.cpf || student.id) === cpf);
    const sameAsMainCpf = mainCpf && mainCpf === cpf;
    if (!teamConflictEntry && !studentConflict && !sameAsMainCpf) {
      const currentMessage = form.querySelector('#form-message').textContent;
      if (currentMessage === spouseCpfConflictMessage || currentMessage.startsWith('Seu conjuge ')) clearDuplicateCpfMessage();
      return false;
    }
    const spouse = teamConflictEntry && people.find((person) => person.id === teamConflictEntry.pessoaId || normalizeCpf(person.cpf || person.id) === cpf);
    const message = teamConflictEntry ? spouseRegisteredMessage(spouse, teamConflictEntry) : spouseCpfConflictMessage;
    setTimeout(() => showCpfLockMessage(control, message));
    if (focus) {
      control.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => control.focus({ preventScroll: true }), 180);
    }
    return true;
  };
  const warnDuplicatePublicCpf = async (control, focus = false) => {
    if (embedded || editingEntry || !control) return false;
    const cpf = normalizeCpf(control.value);
    if (cpf.length !== 11 || !isValidCpf(cpf)) {
      clearDuplicateCpfMessage();
      return false;
    }
    const duplicateEntry = await findFocusedRetreatEntryByCpf(cpf);
    if (!duplicateEntry) clearDuplicateCpfMessage();
    if (!duplicateEntry) return false;
    const duplicatePerson = people.find((person) => person.id === duplicateEntry.pessoaId || normalizeCpf(person.cpf || person.id) === cpf);
    const message = control.name === 'spouseCpf' ? spouseRegisteredMessage(duplicatePerson, duplicateEntry) : duplicatePublicCpfMessage;
    setTimeout(() => showCpfLockMessage(control, message));
    if (focus) {
      control.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => control.focus({ preventScroll: true }), 180);
    }
    return true;
  };
  const checkPublicCpf = async (control, focus = false) => {
    if (await warnSpouseCpfConflict(control, focus)) return true;
    if (await warnPublicStudentConflict(control, focus)) return true;
    return warnDuplicatePublicCpf(control, focus);
  };
  const loadPersonByCpf = async () => {
    if (await checkPublicCpf(form.cpf)) return;
    const cpf = normalizeCpf(form.cpf.value);
    const person = isValidCpf(cpf) && people.find((item) => item.id === cpf || normalizeCpf(item.cpf) === cpf);
    if (!person) return;
    form.elements.nome.value = form.elements.nome.value || person.nome || '';
    form.nascimento.value = formatDateInput(person.nascimento);
    form.telefone.value = person.telefone || '';
    form.endereco.value = person.endereco || '';
    form.numero.value = person.numero || '';
    form.bairro.value = person.bairro || '';
    form.cep.value = person.cep || '';
    form.cidade.value = person.cidade || '';
    form.estado.value = person.estado || '';
    setChoices('genero', person.genero);
    const spouseLoaded = await loadLinkedSpouse(person);
    if (!spouseLoaded) mount.querySelector('#form-message').textContent = 'Encontramos seus dados pelo CPF. Revise antes de enviar este cadastro.';
  };
  form.cpf.addEventListener('change', loadPersonByCpf);
  [form.elements.cpf, form.elements.spouseCpf].filter(Boolean).forEach((control) => {
    control.addEventListener('focus', () => {
      if (form.querySelector('.cpf-duplicate-message')) clearDuplicateCpfMessage();
      if (control.name === 'spouseCpf' && normalizeCpf(control.value).length === 11 && isValidCpf(control.value)) checkPublicCpf(control);
    });
    control.addEventListener('input', () => {
      clearDuplicateCpfMessage();
      if (normalizeCpf(control.value).length === 11 && isValidCpf(control.value)) checkPublicCpf(control);
    });
    control.addEventListener('change', () => checkPublicCpf(control));
  });
  form.addEventListener('change', async (event) => {
    event.target.closest('.field, .choice-block, .form-section')?.classList.remove('field-warning');
    if (/^kidNascimento\d+$/.test(event.target.name || '') && kidAgeLimitViolation(form)?.control === event.target) {
      alert(kidsAgeLimitMessage);
      if (!embedded) form.querySelector('#form-message')?.replaceChildren(kidsAgeLimitMessage);
      return;
    }
    if (event.target.name === 'tipoFicha') {
      if (newRecordNeedsType) setNewRecordTypeLock(false);
      setCoupleMode(event.target.value === 'Casal');
      syncKidsNeed();
      syncTypeSelectionLock();
      if (form.querySelector('#form-message').textContent === typeSelectionMessage) form.querySelector('#form-message').textContent = '';
      if (event.target.value === 'Casal') {
        const cpf = normalizeCpf(form.elements.cpf.value);
        const person = isValidCpf(cpf) && people.find((item) => item.id === cpf || normalizeCpf(item.cpf) === cpf);
        await loadLinkedSpouse(person);
      }
      return;
    }
    if (event.target.name === 'genero' && isCouple()) syncSpouseGender();
  });
  form.addEventListener('input', (event) => {
    event.target.closest('.field, .choice-block, .form-section')?.classList.remove('field-warning');
  });
  const validateForm = (source, requireType = true, requireSector = true) => {
    const data = new FormData(source);
    source.querySelectorAll('[name="nascimento"], [name="spouseNascimento"]').forEach((input) => {
      if (input.disabled) return;
      const value = input.value.trim();
      input.setCustomValidity(value && !normalizeDateInput(value) ? 'Digite a data no formato dd/mm/aaaa.' : '');
    });
    const focusControl = (control) => {
      if (!control) return;
      const target = control.closest('.choice-block, .field, .form-section') || control;
      source.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
      target.classList.add('field-warning');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => control.focus({ preventScroll: true }), 180);
    };
    const firstByName = (name) => source.querySelector(`[name="${name}"]:not(:disabled)`);
    const firstIncompleteKid = () => {
      for (let index = 1; index <= 5; index += 1) {
        const nome = source.elements[`kidNome${index}`];
        const nascimento = source.elements[`kidNascimento${index}`];
        if ((nome?.value.trim() || nascimento?.value.trim()) && !nome.value.trim()) return nome;
        if ((nome?.value.trim() || nascimento?.value.trim()) && !nascimento.value.trim()) return nascimento;
      }
      return null;
    };
    const firstSpouseMissing = () => {
      const missingField = [
        ['spouseNome', () => !String(data.get('spouseNome') || '').trim()],
        ['spouseCpf', () => !isValidCpf(data.get('spouseCpf'))],
        ['spouseNascimento', () => !normalizeDateInput(data.get('spouseNascimento'))],
        ['spouseTelefone', () => !String(data.get('spouseTelefone') || '').trim()],
        ['genero', () => !spouseGenderValue()],
        ['spouseRetiros', () => !data.getAll('spouseRetiros').length],
      ].find(([, missing]) => missing())?.[0];
      if (missingField) return missingField;
      if (!allDaysAnswered('spouseDias')) return firstUnansweredDay('spouseDias')?.name;
      if (!selectedConfirmedDays('spouseDias').length) return dayConfirmationName('spouseDias', 0);
      return null;
    };
    if (embedded && !editingEntry && requireType && !data.get('tipoFicha')) {
      source.querySelector('#form-message')?.replaceChildren('Escolha se esta ficha é Individual ou Casal antes de salvar.');
      focusControl(firstByName('tipoFicha'));
      return false;
    }
    const sectors = data.getAll('setores');
    const days = selectedConfirmedDays('dias');
    const daysComplete = allDaysAnswered('dias');
    const spouseDays = selectedConfirmedDays('spouseDias');
    const spouseDaysComplete = !isCouple() || allDaysAnswered('spouseDias');
    const required = ['cpf', 'genero', 'retiros', 'quadrante', 'foto', 'contribuicao', ...(requireType ? ['tipoFicha'] : [])].filter((name) => source.elements[name]);
    const kidsNotNeeded = data.get('kidsNotNeeded') === 'on';
    const kids = kidsNotNeeded ? [] : Array.from({ length: 5 }, (_, index) => ({ nome: String(data.get(`kidNome${index + 1}`) || '').trim(), nascimento: String(data.get(`kidNascimento${index + 1}`) || '').trim() })).filter((kid) => kid.nome || kid.nascimento);
    const hasKidsChoice = kidsNotNeeded || kids.length > 0;
    const hasIncompleteKid = !kidsNotNeeded && kids.some((kid) => !kid.nome || !kid.nascimento);
    const ageLimitViolation = !kidsNotNeeded ? kidAgeLimitViolation(source) : null;
    const blocksKidAgeLimit = !embedded && ageLimitViolation;
    const spouseValid = !isCouple() || (String(data.get('spouseNome') || '').trim() && isValidCpf(data.get('spouseCpf')) && normalizeDateInput(data.get('spouseNascimento')) && String(data.get('spouseTelefone') || '').trim() && spouseGenderValue() && data.getAll('spouseRetiros').length && spouseDaysComplete && spouseDays.length);
    const firstInvalid = source.querySelector(':invalid');
    const browserValid = source.checkValidity();
    const missingRequired = required.filter((name) => !data.get(name));
    const valid = browserValid && (!requireSector || sectors.length) && daysComplete && days.length && !missingRequired.length && hasKidsChoice && !hasIncompleteKid && !blocksKidAgeLimit && spouseValid && volunteerTermAccepted;
    if (!valid) {
      const labels = { genero: 'gênero', retiros: 'retiro(s) que fez', quadrante: 'quadrante impresso', foto: 'foto oficial do retiro', contribuicao: 'valor da inscrição', tipoFicha: 'Individual ou Casal' };
      const missing = [
        ...(!browserValid ? ['campos marcados com *'] : []),
        ...(requireSector && !sectors.length ? ['setor de trabalho'] : []),
        ...(!daysComplete ? ['Sim ou Não em todos os dias'] : []),
        ...(daysComplete && !days.length ? ['pelo menos um dia confirmado para trabalhar'] : []),
        ...(!volunteerTermAccepted ? ['termo de adesão de voluntariado'] : []),
        ...missingRequired.map((name) => labels[name] || name),
      ];
      let message = missing.length ? `Revise: ${[...new Set(missing)].join(', ')}.` : 'Revise os campos obrigatórios.';
      if (!daysComplete) message = 'Em Dias confirmados para trabalhar, responda Sim ou Não para todos os dias.';
      else if (!days.length) message = 'Em Dias confirmados para trabalhar, confirme pelo menos um dia com Sim.';
      else if (!hasKidsChoice) message = 'No Espaço Kids, marque que não necessita ou informe pelo menos uma criança com nome e data de nascimento.';
      else if (hasIncompleteKid) message = 'No Espaço Kids, preencha nome e data de nascimento de cada criança informada.';
      else if (blocksKidAgeLimit) message = kidsAgeLimitMessage;
      else if (isCouple() && !spouseValid) message = 'Em cadastro de casal, preencha também os dados, retiros e dias do segundo cônjuge.';
      else if (!volunteerTermAccepted) message = 'Leia o Termo de adesão de voluntariado e clique em "Lí e concordo" antes de enviar.';
      source.querySelector('#form-message')?.replaceChildren(message);
      const candidateControls = [
        firstInvalid,
        ...missingRequired.map(firstByName),
        !daysComplete ? firstUnansweredDay('dias') : null,
        daysComplete && !days.length ? firstByName(dayConfirmationName('dias', 0)) : null,
        requireSector && !sectors.length ? firstByName('setores') : null,
        !hasKidsChoice ? firstByName('kidsNotNeeded') || firstByName('kidNome1') : null,
        hasIncompleteKid ? firstIncompleteKid() : null,
        blocksKidAgeLimit ? ageLimitViolation.control : null,
        !volunteerTermAccepted ? source.querySelector('#read-volunteer-term') : null,
        isCouple() && !spouseValid ? firstByName(firstSpouseMissing()) : null,
      ].filter(Boolean);
      const nextControl = candidateControls.sort((first, second) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1)[0];
      focusControl(nextControl);
      if (blocksKidAgeLimit) alert(kidsAgeLimitMessage);
    }
    return valid;
  };
  const saveForm = async (source, casalId, papelNoCasal, existingEntry = null, prefix = '') => {
    const data = new FormData(source);
    const fieldName = (name) => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
    const nome = data.get(fieldName('nome')).trim();
    const cpf = normalizeCpf(data.get(fieldName('cpf')));
    if (!existingEntry) existingEntry = enrolments.find((entry) => entry.retiroId === id && entry.pessoaId === cpf);
    const kidsNotNeeded = data.get('kidsNotNeeded') === 'on';
    const kids = kidsNotNeeded ? [] : Array.from({ length: 5 }, (_, index) => ({ nome: String(data.get(`kidNome${index + 1}`) || '').trim(), nascimento: String(data.get(`kidNascimento${index + 1}`) || '').trim() })).filter((kid) => kid.nome || kid.nascimento);
    let person = people.find((item) => item.id === cpf || normalizeCpf(item.cpf) === cpf);
    if (!person && existingEntry) person = people.find((item) => item.id === existingEntry.pessoaId);
    if (!person) person = { createdAt: new Date().toISOString() };
    const previousPersonId = existingEntry?.pessoaId && existingEntry.pessoaId !== cpf ? existingEntry.pessoaId : null;
    Object.assign(person, { id: cpf, cpf, nome, nomeNormalizado: nome.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '), nascimento: normalizeDateInput(data.get(fieldName('nascimento'))), genero: prefix === 'spouse' ? spouseGenderValue() : data.get(fieldName('genero')), telefone: data.get(fieldName('telefone')), endereco: data.get('endereco'), numero: data.get('numero'), bairro: data.get('bairro'), cep: data.get('cep'), cidade: data.get('cidade'), estado: String(data.get('estado') || '').toUpperCase(), updatedAt: new Date().toISOString() });
    await dataService.savePessoa(person);
    const coordenacaoSetor = embedded ? data.get('coordenacaoSetor') === 'sim' : Boolean(existingEntry?.coordenacaoSetor);
    const quadrante = data.get('quadrante') === 'Sim' ? 'Sim' : 'Não';
    const foto = data.get('foto') === 'Sim' ? 'Sim' : 'Não';
    const contribuicao = currency(volunteerContributionAmount(retreat, { casalId, foto }));
    await dataService.saveAdesao({ ...(existingEntry || {}), id: existingEntry?.id || createId(), retiroId: id, pessoaId: person.id, nome: person.nome, dadosPessoais: personalDataSnapshot(person), dias: selectedConfirmedDays(fieldName('dias')), setores: sortSectors(data.getAll('setores')), retirosAnteriores: data.getAll(fieldName('retiros')), quadrante, foto, contribuicao, coordenacao: form.elements.coordenacao ? data.get('coordenacao') : (existingEntry?.coordenacao || ''), coordenacaoSetor, espacoKids: kids, espacoKidsNaoNecessito: kidsNotNeeded, termoVoluntariadoAceito: true, termoVoluntariadoAceitoEm: existingEntry?.termoVoluntariadoAceitoEm || new Date().toISOString(), tipoFicha: 'Individual', casalId, papelNoCasal, status: existingEntry?.status || 'pendente_validacao', enviadoEm: existingEntry?.enviadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString() });
    if (previousPersonId) {
      const entriesToMigrate = (await dataService.listAdesoes()).filter((item) => item.pessoaId === previousPersonId);
      await Promise.all(entriesToMigrate.map((entry) => dataService.saveAdesao({ ...entry, pessoaId: cpf, nome: entry.nome || nome })));
      await dataService.deletePessoa(previousPersonId);
    }
    return person;
  };
  const showSuccess = (participants) => {
    const list = (Array.isArray(participants) ? participants : [{ nome: participants, dias: [] }]).filter((item) => item?.nome);
    const names = list.map((item) => item.nome).join(' e ');
    const participantRows = list.map((item) => `<li><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml((item.dias || []).join(', ') || 'Dias não informados')}</span></li>`).join('');
    mount.innerHTML = `<main class="public-shell"><section class="success-card"><div class="success-icon">✓</div><h1>Inscrição enviada com sucesso</h1><p>Obrigado, ${escapeHtml(names)}. Sua participação foi registrada para ${escapeHtml(retreat.nome)}.</p><ul class="success-participants">${participantRows}</ul><button type="button" id="close-success-message">Fechar</button></section></main>`;
    mount.querySelector('#close-success-message')?.addEventListener('click', async () => {
      await renderPublicForm(id, embedded, sectorToken);
    });
  };
  const finishSave = async (participants) => {
    if (!embedded) { showSuccess(participants); return; }
    await loadData();
    await renderPublicForm(id, true);
    app.querySelector('#public-form')?.elements.cpf.focus();
  };
  const blockPublicCpfIssues = async () => {
    const data = new FormData(form);
    const checks = [
      { cpf: normalizeCpf(data.get('cpf')), control: form.elements.cpf },
      ...(isCouple() ? [{ cpf: normalizeCpf(data.get('spouseCpf')), control: form.elements.spouseCpf }] : []),
    ].filter((item) => isValidCpf(item.cpf));
    if (!checks.length) return false;
    for (const item of checks) {
      if (await checkPublicCpf(item.control, true)) return true;
    }
    return false;
  };
  const setPublicSubmitting = (submitting) => {
    [form.querySelector('button[type="submit"]')].filter(Boolean).forEach((button) => {
      if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
      button.disabled = submitting;
      if (submitting) button.textContent = 'Enviando...';
      else button.innerHTML = button.dataset.defaultHtml;
    });
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (embedded && !ensureRetreatCanBeChanged(retreat, 'salvar fichas da equipe')) return;
    setPublicSubmitting(true);
    try {
      syncContributionAmount();
      if (!validateForm(form)) {
        return;
      }
      if (embedded && kidAgeLimitViolation(form)) {
        alert(kidsAgeLimitMessage);
      }
      if (await blockPublicCpfIssues()) {
        return;
      }
      if (isCouple()) {
        const casalId = editingEntry?.casalId || createId();
        const first = await saveForm(form, casalId, 'Primeira pessoa', editingEntry);
        const second = await saveForm(form, casalId, 'Segunda pessoa', editingSpouseEntry, 'spouse');
        await linkCouplePeople(first, second, casalId);
        await finishSave([
          { nome: first.nome, dias: selectedConfirmedDays('dias') },
          { nome: second.nome, dias: selectedConfirmedDays('spouseDias') },
        ]);
        return;
      }
      if (editingEntry?.casalId) {
        const spouseEntry = editingSpouseEntry || enrolments.find((item) => item.casalId === editingEntry.casalId && item.retiroId === editingEntry.retiroId && item.pessoaId !== editingEntry.pessoaId);
        if (spouseEntry) {
          await dataService.deleteAdesao(spouseEntry.id);
        }
      }
      const person = await saveForm(form, null, null, editingEntry);
      await finishSave([{ nome: person.nome, dias: selectedConfirmedDays('dias') }]);
      return;
    } catch (error) {
      console.error(error);
      const messageTarget = form.querySelector('#form-message');
      messageTarget?.replaceChildren('Não foi possível salvar a inscrição. Confira os dados e tente novamente.');
    } finally {
      setPublicSubmitting(false);
    }
  });
}

async function renderUsuarios() {
  if (!ensureViewPermission('usuarios')) return;
  const [accessData, allRetreats] = await Promise.all([dataService.getAccessData(), dataService.listRetiros().catch(() => [])]);
  const { usuarios = [], perfis = [], permissoes = [], perfilPermissoes = [], usuarioPermissoes = [], usuarioRetiros = [] } = accessData;
  const profileById = new Map(perfis.map((profile) => [profile.id, profile]));
  const groupedPermissions = permissoes.reduce((groups, permission) => {
    const moduleName = permission.modulo || 'Sistema';
    groups[moduleName] = groups[moduleName] || [];
    groups[moduleName].push(permission);
    return groups;
  }, {});
  Object.values(groupedPermissions).forEach((items) => items.sort((first, second) => first.id.localeCompare(second.id)));
  const effectivePermissions = (user = {}) => {
    const profileAllowed = new Set(perfilPermissoes.filter((item) => item.perfilId === user.perfilId && item.permitido !== false).map((item) => item.permissaoId));
    usuarioPermissoes.filter((item) => item.usuarioId === user.id).forEach((item) => {
      if (item.permitido === false) profileAllowed.delete(item.permissaoId);
      else profileAllowed.add(item.permissaoId);
    });
    if (profileById.get(user.perfilId)?.codigo === 'admin') permissoes.forEach((permission) => profileAllowed.add(permission.id));
    return profileAllowed;
  };
  const userRows = usuarios.sort((first, second) => String(first.nome || first.login).localeCompare(String(second.nome || second.login), 'pt-BR')).map((user) => {
    const profile = profileById.get(user.perfilId);
    const retreatCount = usuarioRetiros.filter((item) => item.usuarioId === user.id).length;
    return `<article class="access-user-row" data-user-row="${escapeHtml(user.id)}"><div><strong>${escapeHtml(user.nome || user.login)}</strong><span>${escapeHtml(user.login)} · ${escapeHtml(profile?.nome || 'Sem perfil')} · ${user.ativo === false ? 'Inativo' : 'Ativo'}${retreatCount ? ` · ${retreatCount} retiro(s)` : ''}</span></div><div class="registration-actions"><button type="button" data-edit-user="${escapeHtml(user.id)}">Editar</button>${canAccess('usuarios.excluir') ? `<button type="button" data-delete-user="${escapeHtml(user.id)}">Excluir</button>` : ''}</div></article>`;
  }).join('');
  const profileOptions = perfis.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.nome)}</option>`).join('');
  const duplicateUserOptions = usuarios.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.nome || user.login)} (${escapeHtml(user.login)})</option>`).join('');
  const retreatChecks = allRetreats.map((retreat) => `<label class="access-check"><input type="checkbox" name="retiroIds" value="${escapeHtml(retreat.id)}"><span>${escapeHtml(retreat.nome)}</span></label>`).join('');
  const permissionGroups = Object.entries(groupedPermissions).map(([moduleName, items]) => `<section class="access-permission-group"><h3>${escapeHtml(moduleName)}</h3>${items.map((permission) => `<label class="access-check"><input type="checkbox" name="permission" value="${escapeHtml(permission.id)}"><span><strong>${escapeHtml(permission.id)}</strong><small>${escapeHtml(permission.descricao || '')}</small></span></label>`).join('')}</section>`).join('');
  const duplicatePermissionsBlock = `<section class="access-duplicate"><div class="panel-heading compact-heading"><div><h3>Duplicar permiss&otilde;es</h3><p>Copie perfil, permiss&otilde;es e retiros vinculados de um usu&aacute;rio existente.</p></div></div><div class="fields two-columns"><label class="field"><span>Usu&aacute;rio modelo</span><select id="duplicate-user-permissions"><option value="">Selecione um usu&aacute;rio</option>${duplicateUserOptions}</select></label><div class="form-actions compact-actions"><button type="button" id="apply-user-permissions" ${usuarios.length ? '' : 'disabled'}>Duplicar permiss&otilde;es</button></div></div></section>`;
  layout(`<section class="page-heading"><div><p class="eyebrow">Seguranca</p><h1>Usuarios e permissoes</h1><p>Gerencie perfis, acessos por tela e acoes permitidas para cada usuario.</p></div><div class="detail-actions"><a class="primary-button" href="#alterar-senha">Alterar senha</a></div></section>
  <section class="access-layout">
    <article class="panel access-list-panel"><div class="panel-heading"><div><h2>Usuarios</h2><p>${usuarios.length} usuario(s) cadastrado(s) no banco.</p></div><button type="button" id="new-access-user" ${canAccess('usuarios.criar') ? '' : 'disabled'}>Novo usuario</button></div><div class="access-user-list">${userRows || '<p class="empty-state">Nenhum usuario cadastrado no banco.</p>'}</div></article>
    <form id="access-user-form" class="panel access-user-form"><div class="panel-heading"><div><p class="eyebrow">Cadastro</p><h2 id="access-form-title">Novo usuario</h2><p>Senhas sao armazenadas com hash no servidor.</p></div></div><input type="hidden" name="id"><div class="fields two-columns"><label class="field"><span>Nome <b>*</b></span><input name="nome" required></label><label class="field"><span>Login <b>*</b></span><input name="login" autocomplete="username" required></label><label class="field"><span>Senha</span><input name="password" type="password" autocomplete="new-password" placeholder="Obrigatoria para novo usuario"></label><label class="field"><span>Perfil <b>*</b></span><select name="perfilId" required>${profileOptions}</select></label><label class="access-active-option"><input type="checkbox" name="ativo" checked> Usuario ativo</label></div><section class="access-retreats"><h3>Retiros vinculados</h3><p class="hint">Use para Coordenador do retiro. Admin e Coordenador Geral podem ficar sem restricao.</p><div class="access-check-grid">${retreatChecks || '<p class="empty-state">Nenhum retiro cadastrado.</p>'}</div></section><section class="access-permissions"><div class="panel-heading compact-heading"><div><h3>Permissoes do usuario</h3><p>Marque exatamente o que este usuario pode acessar e executar.</p></div><button type="button" id="apply-profile-permissions">Aplicar perfil</button></div><div class="access-permission-grid">${permissionGroups}</div></section><p id="access-message" class="form-message"></p><div class="form-actions"><p>As permissoes sao aplicadas no menu e validadas na API.</p><button type="submit" ${canAccess('usuarios.criar') || canAccess('usuarios.editar') ? '' : 'disabled'}>Salvar usuario <span>→</span></button></div></form>
  </section>`, 'usuarios');
  app.querySelector('.access-permissions')?.insertAdjacentHTML('beforebegin', duplicatePermissionsBlock);
  const form = app.querySelector('#access-user-form');
  const message = app.querySelector('#access-message');
  const applyPermissions = (permissionIds = []) => {
    const selected = new Set(permissionIds);
    form.querySelectorAll('input[name="permission"]').forEach((input) => { input.checked = selected.has(input.value); });
  };
  const applyLinkedRetreats = (retreatIds = []) => {
    const selected = new Set(retreatIds);
    form.querySelectorAll('input[name="retiroIds"]').forEach((input) => { input.checked = selected.has(input.value); });
  };
  const profilePermissionIds = (profileId) => perfilPermissoes.filter((item) => item.perfilId === profileId && item.permitido !== false).map((item) => item.permissaoId);
  const clearForm = () => {
    form.reset();
    form.elements.id.value = '';
    form.elements.ativo.checked = true;
    form.elements.password.required = true;
    app.querySelector('#duplicate-user-permissions').value = '';
    app.querySelector('#access-form-title').textContent = 'Novo usuario';
    applyPermissions(profilePermissionIds(form.elements.perfilId.value));
    message.textContent = '';
  };
  const loadUser = (user) => {
    form.reset();
    form.elements.id.value = user.id;
    form.elements.nome.value = user.nome || '';
    form.elements.login.value = user.login || '';
    form.elements.password.value = '';
    form.elements.password.required = false;
    form.elements.perfilId.value = user.perfilId || perfis[0]?.id || '';
    form.elements.ativo.checked = user.ativo !== false;
    const linkedRetreats = new Set(usuarioRetiros.filter((item) => item.usuarioId === user.id).map((item) => item.retiroId));
    form.querySelectorAll('input[name="retiroIds"]').forEach((input) => { input.checked = linkedRetreats.has(input.value); });
    applyPermissions([...effectivePermissions(user)]);
    app.querySelector('#access-form-title').textContent = `Editando ${user.nome || user.login}`;
    message.textContent = 'Revise o perfil, retiros vinculados e permissoes.';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  clearForm();
  app.querySelector('#new-access-user')?.addEventListener('click', clearForm);
  app.querySelector('#apply-profile-permissions')?.addEventListener('click', () => applyPermissions(profilePermissionIds(form.elements.perfilId.value)));
  app.querySelector('#apply-user-permissions')?.addEventListener('click', () => {
    const sourceUser = usuarios.find((item) => item.id === app.querySelector('#duplicate-user-permissions')?.value);
    if (!sourceUser) {
      message.textContent = 'Selecione um usuario para duplicar as permissoes.';
      return;
    }
    form.elements.perfilId.value = sourceUser.perfilId || perfis[0]?.id || '';
    applyPermissions([...effectivePermissions(sourceUser)]);
    applyLinkedRetreats(usuarioRetiros.filter((item) => item.usuarioId === sourceUser.id).map((item) => item.retiroId));
    message.textContent = `Permissoes de ${sourceUser.nome || sourceUser.login} copiadas para este cadastro.`;
  });
  form.elements.perfilId.addEventListener('change', () => applyPermissions(profilePermissionIds(form.elements.perfilId.value)));
  app.querySelectorAll('[data-edit-user]').forEach((button) => button.addEventListener('click', () => {
    const user = usuarios.find((item) => item.id === button.dataset.editUser);
    if (user) loadUser(user);
  }));
  app.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', async () => {
    const user = usuarios.find((item) => item.id === button.dataset.deleteUser);
    if (!user || !confirm(`Excluir o usuario ${user.nome || user.login}?`)) return;
    await dataService.deleteAccessUser(user.id);
    await renderUsuarios();
  }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const permissions = permissoes.map((permission) => ({ permissaoId: permission.id, permitido: data.getAll('permission').includes(permission.id) }));
    try {
      await dataService.saveAccessUser({
        id: data.get('id') || undefined,
        nome: data.get('nome'),
        login: data.get('login'),
        password: data.get('password'),
        perfilId: data.get('perfilId'),
        ativo: data.get('ativo') === 'on',
        retiroIds: data.getAll('retiroIds'),
        permissions,
      });
      await renderUsuarios();
    } catch (error) {
      message.textContent = error.message || 'Nao foi possivel salvar o usuario.';
    }
  });
}

async function ensureAuthenticated() {
  if (publicRetreatId) return true;
  if (authChecked) return Boolean(currentUser);
  try {
    const session = await dataService.getSession();
    currentUser = session.authenticated ? session.user : null;
  } catch {
    currentUser = null;
  }
  authChecked = true;
  return Boolean(currentUser);
}

function renderLogin(message = '') {
  app.innerHTML = `<main class="login-shell">
    <section class="login-panel">
      <a class="brand" href="index.html"><span>EPC</span><strong><small>Familia</small>EPC</strong></a>
      <div class="login-heading">
        <p class="eyebrow">Area restrita</p>
        <h1>Acesse sua conta</h1>
        <p>Use o login e senha configurados para administrar retiros, inscricoes e relatorios.</p>
      </div>
      <form id="login-form">
        <label class="field"><span>Login</span><input name="username" autocomplete="username" required autofocus></label>
        <label class="field"><span>Senha</span>${passwordFieldHtml('autocomplete="current-password" required')}</label>
        <p id="login-message" class="form-message">${escapeHtml(message)}</p>
        <button type="submit" class="primary-button">Entrar <span>→</span></button>
      </form>
    </section>
  </main>`;
  const form = app.querySelector('#login-form');
  wirePasswordToggles(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const messageBox = form.querySelector('#login-message');
    button.disabled = true;
    messageBox.textContent = 'Validando acesso...';
    try {
      const session = await dataService.login(form.elements.username.value.trim(), form.elements.password.value);
      currentUser = session.user;
      authChecked = true;
      location.hash = '#inicio';
      await route();
    } catch (error) {
      messageBox.textContent = error.message || 'Nao foi possivel entrar.';
      button.disabled = false;
    }
  });
}

async function route() {
  try {
    if (publicRetreatId) return renderPublicForm(publicRetreatId, false, publicSectorToken);
    if (publicReceiverToken) {
      if (!publicReceiverRetreatId) {
        app.innerHTML = '<section class="page-heading"><div><p class="eyebrow">Recebedor</p><h1>Link indisponivel</h1><p>Confira o link enviado pelo financeiro.</p></div></section>';
        return;
      }
      await loadData();
      return renderRecebedor();
    }
    if (!(await ensureAuthenticated())) return renderLogin(location.hash === '#login' ? '' : 'Faca login para acessar a area restrita.');
    const target = location.hash.slice(1) || firstAllowedSection();
    if (target === 'usuarios') return renderUsuarios();
    const section = target.startsWith('retiros/') ? 'retiros' : target.startsWith('pessoas/') ? 'pessoas' : target.startsWith('cursista/') ? 'cursista' : target;
    if (!ensureViewPermission(section)) return;
    await loadData();
    if (target === 'inicio') return renderHome(); if (target === 'retiros') return renderRetiros(); if (target === 'retiros/novo') return canAccess('retiros.criar') ? renderNewRetreat() : renderDenied(); if (target.endsWith('/editar')) return canAccess('retiros.editar') ? renderEditRetreat(target.split('/')[1]) : renderDenied(); if (target.startsWith('retiros/')) return renderRetreat(target.split('/')[1]); if (target === 'validacao-inscricoes') return renderValidacaoInscricoes(); if (target === 'recebedor') return renderRecebedor(); if (target === 'comunidades') return renderComunidades(); if (target === 'recado-equipe') return renderRecadoEquipe(); if (target === 'alterar-senha') return renderAlterarSenha(); if (target === 'crachas') return renderCrachas(); if (target === 'quadrante') return renderQuadrante(); if (target.startsWith('cursista/')) return renderCursistaDetalhe(target.split('/')[1]);
    if (target === 'cursista') {
      await renderCursista(); const form = app.querySelector('#student-form'); const activeRetreat = selectedRetreat(); const canEditStudentRetreat = canModifyRetreat(activeRetreat);
    form.noValidate = true; form.reportValidity = () => true;
    form.insertAdjacentHTML('beforeend', `<input type="hidden" name="retiroId" value="${activeRetreat?.id || ''}"><input type="hidden" name="formaPagamento"><input type="hidden" name="observacaoPagamento"><input type="hidden" name="recebedorValorPago"><input type="hidden" name="recebedorTaxaPaga"><input type="hidden" name="recebedorFormaPagamento"><input type="hidden" name="recebedorObservacao">`);
    form.elements.valorInscricao.value = currency(activeRetreat?.valorInscricaoCursista);
    form.elements.valorPago.readOnly = true;
    form.elements.valorPago.closest('.field')?.insertAdjacentHTML('beforeend', '<div class="student-payment-actions"><button type="button" id="set-student-payment">Informar pagamento</button><button type="button" id="clear-student-payment" hidden>Limpar</button></div><small class="student-payment-comment" hidden></small>');
    const recalculateBalance = () => { const value = Math.max(0, parseCurrency(form.elements.valorInscricao.value) - parseCurrency(form.elements.valorPago.value)); form.elements.saldoPagar.value = currency(value); };
    const setStudentPaymentDetails = ({ method = '', observation = '', paidAmount = parseCurrency(form.elements.valorPago.value) } = {}) => {
      form.elements.recebedorValorPago.value = paidAmount > 0 ? paidAmount : 0;
      form.elements.recebedorTaxaPaga.value = paidAmount > 0 ? 'true' : '';
      form.elements.formaPagamento.value = paidAmount > 0 ? method : '';
      form.elements.observacaoPagamento.value = paidAmount > 0 ? observation : '';
      if (paidAmount <= 0) {
        form.elements.recebedorFormaPagamento.value = '';
        form.elements.recebedorObservacao.value = '';
      }
      form.elements.valorPago.value = paidAmount > 0 ? currency(paidAmount) : '';
      app.querySelector('#clear-student-payment').hidden = paidAmount <= 0;
      recalculateBalance();
      renderStudentPaymentComment(form);
    };
    const promptStudentPayment = async () => {
      if (app.querySelector('#set-student-payment')?.disabled || form.querySelector('button[type="submit"]')?.disabled) return;
      const paidAmount = parseCurrency(form.elements.valorPago.value);
      const paymentDetails = await askStudentPayment({
        nome: form.elements.nome.value || 'Cursista',
        paidAmount,
        currentMethod: form.elements.formaPagamento.value,
        currentObservation: form.elements.observacaoPagamento.value,
      });
      if (!paymentDetails?.method) return;
      setStudentPaymentDetails({ method: paymentDetails.method, observation: paymentDetails.observation || '', paidAmount: paymentDetails.amount });
      app.querySelector('#student-message').textContent = 'Pagamento informado. Clique em Salvar alterações para gravar.';
    };
    ['valorInscricao'].forEach((name) => {
      form.elements[name].addEventListener('focus', () => { form.elements[name].value = parseCurrency(form.elements[name].value) || ''; });
      form.elements[name].addEventListener('input', () => {
        recalculateBalance();
      });
      form.elements[name].addEventListener('change', async () => {
        form.elements[name].value = currency(parseCurrency(form.elements[name].value));
        recalculateBalance();
      });
    });
    app.querySelector('#set-student-payment').addEventListener('click', promptStudentPayment);
    app.querySelector('#clear-student-payment').addEventListener('click', () => {
      setStudentPaymentDetails({ paidAmount: 0 });
      recalculateBalance();
      app.querySelector('#student-message').textContent = 'Pagamento removido. Clique em Salvar alterações para gravar.';
    });
    recalculateBalance();
    const actions = form.querySelector('.form-actions'); actions.insertAdjacentHTML('beforeend', '<button type="button" class="delete-student" hidden>Excluir cursista</button>');
    const studentHeadingActions = app.querySelector('.student-heading-actions');
    const editSelectedStudent = app.querySelector('#edit-selected-student');
    const deleteSelectedStudent = app.querySelector('#delete-selected-student');
    if (!canEditStudentRetreat) {
      editSelectedStudent?.remove();
      deleteSelectedStudent?.remove();
      form.querySelector('.delete-student')?.remove();
    }
    let selectedStudentId = '';
    const setStudentFormLocked = (locked) => {
      const effectiveLocked = locked || !canEditStudentRetreat;
      form.querySelectorAll('input, select, textarea').forEach((control) => {
        if (control.type !== 'hidden') control.disabled = effectiveLocked;
      });
      form.querySelector('button[type="submit"]').disabled = effectiveLocked;
      app.querySelector('#set-student-payment').disabled = effectiveLocked;
      app.querySelector('#clear-student-payment').disabled = effectiveLocked;
    };
    const clearStudentForm = ({ focus = true, message = '' } = {}) => { selectedStudentId = ''; studentHeadingActions.hidden = true; setStudentFormLocked(false); form.reset(); form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning')); form.querySelector('input[name="id"]')?.remove(); form.elements.retiroId.value = activeRetreat?.id || ''; form.elements.valorInscricao.value = currency(activeRetreat?.valorInscricaoCursista); setStudentPaymentDetails({ paidAmount: 0 }); form.querySelector('.delete-student')?.setAttribute('hidden', ''); form.querySelector('button[type="submit"]').innerHTML = 'Salvar cadastro <span>→</span>'; form.querySelector('#student-message').textContent = message; recalculateBalance(); if (focus) form.elements.cpf.focus(); };
    const deleteStudentRecord = async (id) => { if (!ensureRetreatCanBeChanged(activeRetreat, 'excluir cursistas')) return; if (!id || !confirm('Excluir este cursista?')) return; const students = await dataService.listCursistas(); const student = students.find((item) => item.id === id) || id; await removeStudentFromCommunities(student); await dataService.deleteCursista(id); clearStudentForm({ focus: false, message: 'Cursista excluído com sucesso.' }); setStudentFormLocked(true); };
    const studentNameInput = form.elements.nome; const nameField = studentNameInput.closest('.field'); const cascade = document.createElement('div'); cascade.className = 'person-cascade'; cascade.hidden = true; nameField.append(cascade);
    const loadStudent = (student) => { selectedStudentId = student.id || ''; studentHeadingActions.hidden = !selectedStudentId; setStudentFormLocked(false); form.reset(); if (!form.elements.id) form.insertAdjacentHTML('beforeend', '<input type="hidden" name="id">'); Object.entries(student).forEach(([key, value]) => { const field = form.elements[key]; if (!field) return; if (field.type === 'radio') form.querySelectorAll(`[name="${key}"]`).forEach((input) => { input.checked = input.value === value; }); else field.value = value || ''; }); form.elements.retiroId.value = student.retiroId || activeRetreat?.id || ''; const receiverPaid = Math.max(0, parseCurrency(student.recebedorValorPago) - parseCurrency(student.valorPago)); const advanceMethod = student.formaPagamento || (parseCurrency(student.valorPago) > 0 && receiverPaid <= 0 ? student.recebedorFormaPagamento : ''); const advanceObservation = student.observacaoPagamento || (parseCurrency(student.valorPago) > 0 && receiverPaid <= 0 ? student.recebedorObservacao : ''); setStudentPaymentDetails({ method: advanceMethod, observation: advanceObservation, paidAmount: parseCurrency(student.valorPago) }); form.elements.recebedorValorPago.value = student.recebedorValorPago || parseCurrency(student.valorPago) || 0; form.elements.recebedorTaxaPaga.value = student.recebedorTaxaPaga ? 'true' : ''; form.elements.recebedorFormaPagamento.value = receiverPaid > 0 ? (student.recebedorFormaPagamento || '') : ''; form.elements.recebedorObservacao.value = receiverPaid > 0 ? (student.recebedorObservacao || '') : ''; form.querySelector('button[type="submit"]').innerHTML = 'Salvar alterações <span>→</span>'; form.querySelector('.delete-student')?.setAttribute('hidden', ''); recalculateBalance(); setStudentFormLocked(true); form.querySelector('#student-message').textContent = canEditStudentRetreat ? 'Cadastro de cursista carregado. Clique em Editar para alterar.' : 'Retiro concluido: cadastro de cursista carregado apenas para consulta.'; };
    const renderCascade = () => { if (selectedStudentId) { cascade.hidden = true; return; } const term = studentNameInput.value.trim().toLocaleLowerCase('pt-BR'); dataService.listCursistas().then((students) => { const filtered = students.filter((student) => (!activeRetreat || student.retiroId === activeRetreat.id) && (!term || student.nome.toLocaleLowerCase('pt-BR').includes(term))); cascade.innerHTML = filtered.length ? filtered.map((student) => `<button type="button" data-student-id="${student.id}"><strong>${escapeHtml(student.nome)}</strong><span>${date(student.nascimento)}</span></button>`).join('') : '<p>Nenhum cursista encontrado. Continue para criar um novo cadastro.</p>'; cascade.hidden = false; cascade.querySelectorAll('[data-student-id]').forEach((button) => button.addEventListener('click', async () => { const students = await dataService.listCursistas(); const student = students.find((item) => item.id === button.dataset.studentId); if (student) { loadStudent(student); cascade.hidden = true; } })); }); };
    const closeStudentNameCascade = (event) => { if (!nameField.contains(event.target)) cascade.hidden = true; };
    studentNameInput.addEventListener('focus', renderCascade); studentNameInput.addEventListener('input', renderCascade);
    nameField.addEventListener('focusout', (event) => { if (!nameField.contains(event.relatedTarget)) cascade.hidden = true; });
    document.addEventListener('pointerdown', closeStudentNameCascade, true);
    document.addEventListener('focusin', closeStudentNameCascade, true);
    const studentSearchInput = app.querySelector('#student-search');
    const studentSearchResults = app.querySelector('#student-search-results');
    const renderStudentSearch = async () => {
      const term = normalizeText(studentSearchInput.value);
      const students = (await dataService.listCursistas())
        .filter((student) => (!activeRetreat || student.retiroId === activeRetreat.id))
        .filter((student) => {
          const cpf = normalizeCpf(student.cpf || student.id);
          const haystack = normalizeText([student.nome, cpf, cpf && formatCpf(cpf), student.telefone, student.nomePai, student.nomeMae].filter(Boolean).join(' '));
          return !term || haystack.includes(term);
        })
        .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR'));
      studentSearchResults.hidden = false;
      studentSearchResults.innerHTML = students.length ? students.map((student) => {
        const cpf = normalizeCpf(student.cpf || student.id);
        return `<article><button type="button" class="student-search-choice" data-student-select="${student.id}"><strong>${escapeHtml(student.nome || 'Sem nome')}</strong><span>${cpf ? formatCpf(cpf) : 'CPF não informado'} · ${escapeHtml(student.telefone || 'Sem telefone')}</span></button></article>`;
      }).join('') : '<p>Nenhum cursista encontrado neste retiro.</p>';
      studentSearchResults.querySelectorAll('[data-student-select]').forEach((button) => button.addEventListener('click', async () => {
        const students = await dataService.listCursistas();
        const student = students.find((item) => item.id === button.dataset.studentSelect);
        if (student) {
          loadStudent(student);
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          studentSearchResults.hidden = true;
        }
      }));
    };
    setStudentFormLocked(true);
    form.querySelector('#student-message').textContent = canEditStudentRetreat ? 'Clique em Incluir novo para iniciar um cadastro.' : 'Retiro concluido: cursistas disponiveis apenas para consulta.';
    app.querySelector('#new-student')?.addEventListener('click', () => { if (ensureRetreatCanBeChanged(activeRetreat, 'incluir cursistas')) clearStudentForm(); });
    editSelectedStudent?.addEventListener('click', () => { if (!ensureRetreatCanBeChanged(activeRetreat, 'editar cursistas')) return; if (selectedStudentId) { setStudentFormLocked(false); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.nome.focus({ preventScroll: true }); form.querySelector('#student-message').textContent = 'Editando cadastro de cursista.'; } });
    deleteSelectedStudent?.addEventListener('click', () => deleteStudentRecord(selectedStudentId));
    studentSearchInput.addEventListener('focus', renderStudentSearch);
    studentSearchInput.addEventListener('input', renderStudentSearch);
    const studentSearchField = studentSearchInput.closest('.registration-search-field');
    const hideStudentSearch = () => { studentSearchResults.hidden = true; };
    const closeStudentSearch = (event) => {
      if (!studentSearchField.contains(event.target) && !studentSearchResults.contains(event.target)) hideStudentSearch();
    };
    studentSearchField.addEventListener('focusout', (event) => { if (!studentSearchField.contains(event.relatedTarget) && !studentSearchResults.contains(event.relatedTarget)) hideStudentSearch(); });
    studentSearchResults.addEventListener('focusout', (event) => { if (!studentSearchField.contains(event.relatedTarget) && !studentSearchResults.contains(event.relatedTarget)) hideStudentSearch(); });
    document.addEventListener('pointerdown', closeStudentSearch, true);
    document.addEventListener('focusin', closeStudentSearch, true);
    form.querySelector('.delete-student')?.addEventListener('click', () => deleteStudentRecord(form.elements.id?.value));
      return;
    }
    if (target === 'pessoas') { const focusRetreat = selectedRetreat(); return focusRetreat ? renderPublicForm(focusRetreat.id, true) : renderPessoas(); } if (target.startsWith('pessoas/')) { const [, personId, personRetreatId, source] = target.split('/'); return renderPessoa(personId, personRetreatId, source); } renderHome();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<main class="login-shell"><section class="login-panel"><a class="brand" href="index.html"><span>EPC</span><strong><small>Familia</small>EPC</strong></a><div class="login-heading"><p class="eyebrow">Area restrita</p><h1>Nao foi possivel abrir a tela</h1><p>${escapeHtml(error.message || 'Atualize a pagina e tente novamente.')}</p></div><button type="button" class="primary-button" onclick="location.reload()">Recarregar</button></section></main>`;
  }
}
document.addEventListener('focusin', (event) => { if (['telefone', 'spouseTelefone', 'telefonePai', 'telefoneMae'].includes(event.target.name)) { event.target.type = 'tel'; event.target.inputMode = 'numeric'; event.target.placeholder = '(00) 00000-0000'; } });
document.addEventListener('input', (event) => { if (!['telefone', 'spouseTelefone', 'telefonePai', 'telefoneMae'].includes(event.target.name)) return; const digits = event.target.value.replace(/\D/g, '').slice(0, 11); event.target.value = digits.length <= 10 ? digits.replace(/^(\d{2})(\d{0,4})(\d{0,4}).*/, (_, area, first, last) => `${area ? `(${area}` : ''}${area.length === 2 ? ') ' : ''}${first}${last ? `-${last}` : ''}`) : digits.replace(/^(\d{2})(\d{0,5})(\d{0,4}).*/, (_, area, first, last) => `(${area}) ${first}${last ? `-${last}` : ''}`); });
window.addEventListener('hashchange', route);
route();
