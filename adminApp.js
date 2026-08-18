import { dataService, retreatDefaults } from './dataService.js';
import { buildKidsCareSummary } from './kidsCareSummary.js';
import { buildCommunityStudentBadgeEntries } from './badgeParticipants.js';
import { attachStudentPhotoField, photoUrl as studentPhotoUrl } from './studentPhotoClient.js';
import { renderFinanceiro } from './financeiro.js?v=20260809-acoes-cabecalho';

const app = document.querySelector('#app');
const publicPathRetreatId = location.pathname.match(/^\/adesao\/([^/?#]+)/)?.[1];
const publicPathReceiverToken = location.pathname.match(/^\/recebedor\/([^/?#]+)/)?.[1];
const publicStudentIdentifiedPath = location.pathname.match(/^\/cadastro-cursista\/ficha(\d+)\/([^/?#]+)/i);
const publicStudentRegistrationToken = document.body.dataset.publicStudentToken || publicStudentIdentifiedPath?.[2] || location.pathname.match(/^\/cadastro-cursista\/([^/?#]+)/)?.[1] || '';
const publicStudentRegistrationFileNumber = Number(document.body.dataset.publicStudentFileNumber || publicStudentIdentifiedPath?.[1]) || 0;
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
let authenticationBackendError = '';
let legacyLocalDataWarningShown = false;
let closeAdminMenuOnOutsidePointer = null;
let closeHomeRetreatSelectorOnOutsidePointer = null;
let lastBackupGeneratedAt = '';
let pendingRestoreOperationId = '';
const selectedRetreatStorageKeyPrefix = 'epc-selected-retreat-id';

const viewPermissions = {
  inicio: 'inicio.ver',
  retiros: 'retiros.ver',
  configuracoes: null,
  pessoas: 'pessoas.ver',
  'validacao-inscricoes': 'validacao-inscricoes.ver',
  cursista: 'cursista.ver',
  'cursista-epc': 'cursista-epc.ver',
  'cursista-smp': 'cursista-smp.ver',
  comunidades: 'comunidades.ver',
  'recado-equipe': 'recado-equipe.ver',
  crachas: 'crachas.ver',
  quadrante: 'quadrante.ver',
  recebedor: 'recebedor.ver',
  relatorios: 'relatorios.ver',
  financeiro: 'financeiro.ver',
  'alterar-senha': null,
  usuarios: 'usuarios.ver',
  backup: 'backup.admin',
};

const retreatConfigurationPermissions = ['retiros.criar', 'retiros.editar', 'retiros.publicar', 'retiros.encerrar', 'retiros.excluir'];

const defaultStudentFormType = 'cursista-individual';
const normalizeExpectedStudentFileCount = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
};
const studentFormTypes = [
  ['cursista-individual', 'Cursista Individual'],
  ['cursista-smp', 'Cursista SMP'],
  ['cursista-epc', 'Cursista EPC'],
];
const studentFormNavIds = {
  'cursista-individual': 'cursista',
  'cursista-smp': 'cursista-smp',
  'cursista-epc': 'cursista-epc',
};
const coupleStudentSource = (studentFormType = 'cursista-smp') => {
  const isEpc = studentFormType === 'cursista-epc';
  return {
    type: isEpc ? 'cursista-epc' : 'cursista-smp',
    label: isEpc ? 'Cursista EPC' : 'Cursista SMP',
    shortLabel: isEpc ? 'EPC' : 'SMP',
    membershipType: isEpc ? 'epc' : 'smp',
    memberField: isEpc ? 'membroEpcIds' : 'membroSmpIds',
    list: isEpc ? dataService.listCursistasEpc : dataService.listCursistasSmp,
    save: isEpc ? dataService.saveCursistaEpc : dataService.saveCursistaSmp,
    delete: isEpc ? dataService.deleteCursistaEpc : dataService.deleteCursistaSmp,
  };
};
const studentPresenceCount = (studentFormType, individualStudents = [], coupleStudents = []) => (
  ['cursista-smp', 'cursista-epc'].includes(studentFormType)
    ? coupleStudents.length * 2
    : individualStudents.length
);
const studentFormTypeOptions = (selected = defaultStudentFormType) => studentFormTypes
  .map(([value, label]) => `<option value="${value}" ${value === (selected || defaultStudentFormType) ? 'selected' : ''}>${escapeHtml(label)}</option>`)
  .join('');
const retreatTypes = ['Taschinha', 'Girassol', 'ONDA', 'EJA', 'EJU', 'EPC', 'SMP', 'EIS-ME AQUI'];
const retreatTypeOptions = (selected = '') => `<option value="" ${selected ? '' : 'selected'} disabled>Selecione o tipo do retiro</option>${retreatTypes
  .map((type) => `<option value="${escapeHtml(type)}" ${type === selected ? 'selected' : ''}>${escapeHtml(type)}</option>`)
  .join('')}`;

const canAccess = (permission) => !permission || currentUser?.role === 'admin' || currentUser?.perfilCodigo === 'admin' || (currentUser?.permissions || []).includes(permission);
const canConfigureRetreats = () => retreatConfigurationPermissions.some(canAccess);
const canView = (section) => section === 'configuracoes' ? canConfigureRetreats() : canAccess(viewPermissions[section]);
const firstAllowedSection = () => Object.keys(viewPermissions).find((section) => canView(section)) || 'inicio';
const hasGlobalRetreatAccess = () => currentUser?.role === 'admin' || currentUser?.perfilCodigo === 'admin';
const canAccessRetreat = (retreatOrId = '') => {
  const id = typeof retreatOrId === 'string' ? retreatOrId : retreatOrId?.id;
  if (!id) return false;
  if (hasGlobalRetreatAccess()) return true;
  if (typeof retreatOrId === 'object' && retreatOrId?.acessoPermitido === false) return false;
  return (currentUser?.retiroIds || []).includes(id);
};
const accessibleRetreats = () => retreats.filter(canAccessRetreat);
const selectedRetreatStorageKey = () => {
  const userKey = String(currentUser?.id || currentUser?.username || 'sem-usuario').trim();
  return `${selectedRetreatStorageKeyPrefix}:${encodeURIComponent(userKey)}`;
};
const setSelectedRetreatId = (id = '') => {
  if (!id) {
    localStorage.removeItem(selectedRetreatStorageKey());
    return false;
  }
  if (!canAccessRetreat(id)) return false;
  localStorage.setItem(selectedRetreatStorageKey(), id);
  return true;
};
const selectedRetreatId = () => localStorage.getItem(selectedRetreatStorageKey()) || '';
const fallbackRetreat = () => accessibleRetreats().find((retreat) => retreat.status === 'publicado') || accessibleRetreats().find((retreat) => retreat.status === 'preparacao') || accessibleRetreats().find((retreat) => retreat.status === 'concluido') || accessibleRetreats()[0] || null;
const selectedRetreat = () => {
  const selected = retreats.find((retreat) => retreat.id === selectedRetreatId() && canAccessRetreat(retreat));
  if (selected) return selected;
  const fallback = fallbackRetreat();
  if (fallback) setSelectedRetreatId(fallback.id);
  else setSelectedRetreatId('');
  return fallback;
};
const isRetreatConcluded = (retreat = {}) => retreat?.status === 'concluido';
const isTeamRegistrationOpen = (retreat = {}) => retreat?.status === 'publicado';
const canModifyRetreat = (retreat = {}) => Boolean(retreat) && canAccessRetreat(retreat) && !isRetreatConcluded(retreat);
const teamRegistrationClosedMessage = (retreat = {}) => retreat?.status === 'preparacao'
  ? 'Este retiro ainda esta em preparacao. O cadastro da equipe de trabalho sera liberado quando o retiro for publicado.'
  : 'Este retiro nao esta recebendo cadastro da equipe de trabalho.';
const renderRetreatAccessDenied = () => layout('<section class="page-heading"><div><p class="eyebrow">Acesso restrito</p><h1>Sem acesso a este retiro</h1><p>Este retiro nao esta vinculado ao seu usuario.</p></div><a class="text-link" href="#retiros">Voltar para retiros</a></section>', 'retiros');
const ensureRetreatAccess = (retreat) => {
  if (canAccessRetreat(retreat)) return true;
  renderRetreatAccessDenied();
  return false;
};
const ensureRetreatCanBeChanged = (retreat, action = 'alterar este retiro') => {
  if (!canAccessRetreat(retreat)) {
    alert('Este retiro nao esta vinculado ao seu usuario.');
    return false;
  }
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
const nextAvailableStudentFileNumber = (students = [], retreatId = '') => {
  const used = new Set(students
    .filter((student) => !retreatId || student.retiroId === retreatId)
    .map((student) => Number(student.numeroFichaIndividual))
    .filter((number) => Number.isInteger(number) && number > 0));
  let next = 1;
  while (used.has(next)) next += 1;
  return String(next);
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
      inscricoesEncerradas: current?.inscricoesEncerradas === true,
    };
  });
};
const preparedSectorLinks = (retreat) => syncSectorLinks(retreat, knownSectors(retreat.setores || []));
const closedRegistrationSectorKeys = (retreat = {}) => new Set((retreat.setoresInscricoesEncerradas || []).map(normalizeText));
const sectorRegistrationClosed = (retreat = {}, sector = '') => closedRegistrationSectorKeys(retreat).has(normalizeText(sector))
  || (retreat.linksSetores || retreat.setorLinks || []).some((link) => normalizeText(link.setor || link.sector) === normalizeText(sector) && link.inscricoesEncerradas === true);

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
const coupleCommunityDetails = (communities = [], studentFormType = 'cursista-smp') => {
  const details = new Map();
  const memberField = studentFormType === 'cursista-epc' ? 'membroEpcIds' : 'membroSmpIds';
  sortCommunitiesByPosition(communities).forEach((community, index) => {
    const detail = { name: communityLabel(community, index), order: Number(community.ordem) || index + 1 };
    (community[memberField] || []).forEach((memberId) => {
      const key = String(memberId || '').trim();
      if (key) details.set(key, detail);
    });
  });
  return details;
};
const coupleCommunityDetail = (record, details) => details.get(String(record?.id || record?.numeroFichaSmp || '').trim())
  || { name: 'Sem comunidade', order: Number.MAX_SAFE_INTEGER };

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
  if (!year || !month || !day || Number(year) < 1) return '';
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
const teamSectorLinkFormatVersion = 2;
const teamSectorLinkSlug = (sector = '') => normalizeText(sector)
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'setor';
const teamSectorPublicUrls = (retreat = {}, link = {}, origin = '') => {
  const registrationToken = encodeURIComponent(link.cadastroToken || link.token || '');
  const followupToken = encodeURIComponent(link.acompanhamentoToken || link.token || '');
  if (Number(retreat.versaoFormatoLinksEquipe || 0) < teamSectorLinkFormatVersion) {
    return {
      registrationUrl: `${origin}/convite-setor/${registrationToken}`,
      followupUrl: `${origin}/setor/${followupToken}`,
    };
  }
  const sectorSlug = teamSectorLinkSlug(link.setor);
  return {
    registrationUrl: `${origin}/setor/${sectorSlug}/cadastro/${registrationToken}`,
    followupUrl: `${origin}/setor/${sectorSlug}/acompanhamento/${followupToken}`,
  };
};
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
const formatBrazilianPhone = (value = '') => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  return digits.length <= 10
    ? digits.replace(/^(\d{2})(\d{0,4})(\d{0,4}).*/, (_, area, first, last) => `${area ? `(${area}` : ''}${area.length === 2 ? ') ' : ''}${first}${last ? `-${last}` : ''}`)
    : digits.replace(/^(\d{2})(\d{0,5})(\d{0,4}).*/, (_, area, first, last) => `(${area}) ${first}${last ? `-${last}` : ''}`);
};
const recordTime = (record = {}) => Date.parse(record.atualizadoEm || record.updatedAt || record.enviadoEm || record.criadoEm || record.createdAt || '') || 0;
const participantIdentity = (record = {}) => normalizeCpf(record.cpf || record.dadosPessoais?.cpf || record.pessoaId || record.id) || String(record.pessoaId || record.id || record.nome || '').trim();
const entryDays = (entry = {}) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).map((day) => String(day || '').trim()).filter(Boolean);
const entrySectors = (entry = {}) => (Array.isArray(entry.setores) ? entry.setores : [entry.setores || entry.setor]).map((sector) => String(sector || '').trim()).filter(Boolean);
const participationGroupOrder = ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'];
const participationGroupOrderIndex = new Map(participationGroupOrder.map((group, index) => [normalizeText(group), index]));
const entryPreviousRetreats = (entry = {}) => (Array.isArray(entry.retirosAnteriores) ? entry.retirosAnteriores : [entry.retirosAnteriores])
  .map((retreat) => String(retreat || '').trim())
  .filter(Boolean);
const sortedPreviousRetreats = (retreats = []) => retreats
  .map((retreat, index) => ({ retreat, index }))
  .sort((first, second) => {
    const firstOrder = participationGroupOrderIndex.has(normalizeText(first.retreat)) ? participationGroupOrderIndex.get(normalizeText(first.retreat)) : participationGroupOrder.length + first.index;
    const secondOrder = participationGroupOrderIndex.has(normalizeText(second.retreat)) ? participationGroupOrderIndex.get(normalizeText(second.retreat)) : participationGroupOrder.length + second.index;
    return firstOrder - secondOrder;
  })
  .map((item) => item.retreat);
const entryParticipationGroup = (entry = {}) => {
  const previousRetreats = entryPreviousRetreats(entry);
  if (!previousRetreats.length) return '';
  const normalized = new Set(previousRetreats.map(normalizeText));
  const mostRecentEpcSmp = String(entry.retiroMaisRecenteEpcSmp || '').trim();
  if (normalized.has(normalizeText('EPC')) && normalized.has(normalizeText('SMP')) && ['epc', 'smp'].includes(normalizeText(mostRecentEpcSmp))) {
    return mostRecentEpcSmp.toLocaleUpperCase('pt-BR');
  }
  if (previousRetreats.length === 1) {
    return participationGroupOrder.find((group) => normalized.has(normalizeText(group))) || '';
  }
  const withoutEisMeAqui = new Set([...normalized].filter((retreat) => retreat !== normalizeText('Eis-me aqui')));
  return [...participationGroupOrder].reverse().find((group) => withoutEisMeAqui.has(normalizeText(group))) || '';
};
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
const firstCoupleEnrolment = (entries = []) => [...entries].sort((first, second) => {
  const firstPriority = normalizeText(first.papelNoCasal) === 'primeira pessoa' ? 0 : 1;
  const secondPriority = normalizeText(second.papelNoCasal) === 'primeira pessoa' ? 0 : 1;
  if (firstPriority !== secondPriority) return firstPriority - secondPriority;
  return recordTime(first) - recordTime(second);
})[0] || entries[0] || {};
const sortSpaceKidsRows = (rows = []) => rows.sort((first, second) => {
  const firstBirth = Date.parse(`${first.nascimento || ''}T12:00:00`);
  const secondBirth = Date.parse(`${second.nascimento || ''}T12:00:00`);
  if (Number.isFinite(firstBirth) && Number.isFinite(secondBirth) && firstBirth !== secondBirth) return secondBirth - firstBirth;
  if (Number.isFinite(firstBirth) !== Number.isFinite(secondBirth)) return Number.isFinite(firstBirth) ? -1 : 1;
  return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
});
const spaceKidsRowsForEnrolments = (items = [], peopleById = new Map()) => {
  const usedCouples = new Set();
  const rows = [];
  const responsibleName = (entry = {}) => entry.nome
    || peopleById.get(entry.pessoaId)?.nome
    || entry.dadosPessoais?.nome
    || '';
  const addRows = (kids = [], responsibleEntry = {}, options = {}) => {
    const responsible = peopleById.get(responsibleEntry.pessoaId) || responsibleEntry.dadosPessoais || {};
    kids.forEach((kid) => rows.push({
      ...kid,
      volunteer: responsibleName(responsibleEntry) || 'Não informado',
      contact: responsible.telefone || responsibleEntry.dadosPessoais?.telefone || '',
      responsible: options.responsible || responsibleName(responsibleEntry) || 'Não informado',
      sectors: uniqueSectors(options.sectors || entrySectors(responsibleEntry)),
    }));
  };
  items.forEach((entry) => {
    if (entry.casalId) {
      const coupleKey = `${entry.retiroId || ''}:${entry.casalId}`;
      if (usedCouples.has(coupleKey)) return;
      usedCouples.add(coupleKey);
      const couple = items.filter((item) => item.casalId === entry.casalId && item.retiroId === entry.retiroId);
      const responsibleEntry = firstCoupleEnrolment(couple);
      const kidsByIdentity = new Map();
      [responsibleEntry, ...couple.filter((item) => item !== responsibleEntry)].flatMap((item) => item.espacoKids || []).forEach((kid) => {
        const key = normalizeText(`${kid.nome || ''}:${kid.nascimento || ''}`);
        if (key && !kidsByIdentity.has(key)) kidsByIdentity.set(key, kid);
      });
      addRows([...kidsByIdentity.values()], responsibleEntry, {
        responsible: couple.map(responsibleName).filter(Boolean).join(' e ') || responsibleName(responsibleEntry),
        sectors: couple.flatMap(entrySectors),
      });
      return;
    }
    addRows(entry.espacoKids || [], entry);
  });
  return sortSpaceKidsRows(rows);
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
  const studentCpf = typeof studentOrId === 'string' ? '' : normalizeCpf(studentOrId?.cpf);
  const identifiers = new Set([studentId, studentCpf].filter(Boolean));
  if (!identifiers.size) return;
  const retreatId = typeof studentOrId === 'string' ? selectedRetreat()?.id : studentOrId?.retiroId;
  const communities = await dataService.listComunidades(retreatId || '');
  await Promise.all(communities.map((community) => {
    const currentMemberIds = community.membroIds || [];
    const membroIds = currentMemberIds.filter((memberId) => !identifiers.has(memberId) && !identifiers.has(normalizeCpf(memberId)));
    return membroIds.length === currentMemberIds.length ? null : dataService.saveComunidadeMembros(community, 'individual', membroIds);
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
function normalizeRetreatSectorsForDisplay() {
  retreats.forEach((retreat) => {
    const sectors = configuredSectors(retreat.setores || []);
    const publicSectors = configuredSectors(retreat.setoresPublicos ?? sectors).filter((sector) => sectors.some((item) => normalizeText(item) === normalizeText(sector)));
    const quadranteOrder = configuredSectors(retreat.ordemQuadrante || sectors).filter((sector) => sectors.some((item) => normalizeText(item) === normalizeText(sector)));
    const linksSetores = (retreat.linksSetores || retreat.setorLinks || []).filter((link) => sectors.some((sector) => normalizeText(sector) === normalizeText(link.setor || link.sector)));
    const setoresInscricoesEncerradas = (retreat.setoresInscricoesEncerradas || []).filter((sector) => sectors.some((item) => normalizeText(item) === normalizeText(sector)));
    Object.assign(retreat, { setores: sectors, setoresPublicos: publicSectors, setoresInscricoesEncerradas, ordemQuadrante: quadranteOrder, linksSetores });
  });
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
const coupleStudentDateFieldNames = Object.freeze([
  'nascimentoDele', 'nascimentoDela', 'casamentoDele', 'casamentoDela', 'uniaoCasal',
  ...Array.from({ length: 5 }, (_, index) => `smpKidNascimento${index + 1}`),
]);
const teamKidDateFieldNames = Object.freeze(Array.from({ length: 5 }, (_, index) => `kidNascimento${index + 1}`));
const namedFieldSelector = (fieldNames) => fieldNames.map((name) => `[name="${name}"]`).join(', ');

function wireTypedDates(root, selector) {
  root.querySelectorAll(selector).forEach((input) => {
    if (input.dataset.typedDateWired === 'true') {
      input._syncTypedDateValue?.();
      return;
    }
    input.dataset.typedDateWired = 'true';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'dd/mm/aaaa';
    input.maxLength = 10;
    input.pattern = '\\d{2}/\\d{2}/\\d{4}';
    input.title = 'Digite a data no formato dd/mm/aaaa';
    const setDateValidity = () => {
      const invalid = Boolean(input.value.trim()) && !normalizeDateInput(input.value);
      input.setCustomValidity(invalid ? 'Digite uma data válida no formato dd/mm/aaaa.' : '');
    };
    const maskDate = () => {
      const raw = String(input.value || '').trim();
      const normalized = normalizeDateInput(raw);
      const isoCandidate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (normalized) input.value = formatDateInput(normalized);
      else if (isoCandidate) input.value = `${isoCandidate[3]}/${isoCandidate[2]}/${isoCandidate[1]}`;
      else {
        const digits = raw.replace(/\D/g, '').slice(0, 8);
        input.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
      }
      setDateValidity();
    };
    const validateDate = () => {
      input.value = formatDateInput(input.value) || input.value;
      setDateValidity();
    };
    input._syncTypedDateValue = validateDate;
    input.value = formatDateInput(input.value) || input.value;
    setDateValidity();
    input.addEventListener('input', maskDate);
    input.addEventListener('change', validateDate);
    input.addEventListener('blur', validateDate);
  });
  if (typeof root.addEventListener === 'function' && !root._typedDateResetWired) {
    root._typedDateResetWired = true;
    root.addEventListener('reset', () => {
      setTimeout(() => root.querySelectorAll('[data-typed-date-wired="true"]').forEach((input) => input._syncTypedDateValue?.()), 0);
    });
  }
}

function wireTypedBirthDates(root) {
  wireTypedDates(root, namedFieldSelector(['nascimento', 'spouseNascimento', ...teamKidDateFieldNames]));
}

async function loadData() {
  retreats = await dataService.listRetiros();
  retreats.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  normalizeRetreatSectorsForDisplay();
  const focusRetreatId = publicRetreatId || publicReceiverRetreatId || selectedRetreat()?.id || '';
  [enrolments, people] = focusRetreatId
    ? await Promise.all([dataService.listAdesoes(focusRetreatId), dataService.listPessoas(focusRetreatId)])
    : [[], []];
}

async function ensureRetreatFocusLoaded() {
  if (retreats.length) return;
  retreats = await dataService.listRetiros();
  retreats.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  normalizeRetreatSectorsForDisplay();
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

function cursistaKidExceedsRetreatAgeLimit(retreat, dateOfBirth) {
  const normalizedStart = normalizeDateInput(retreat?.dataInicio);
  if (!normalizedStart) return false;
  return kidExceedsRetreatAgeLimit({ ...retreat, dataInicio: normalizedStart }, dateOfBirth);
}

function retreatKidsAgeLimitLabel(retreat) {
  const limit = Number(retreat?.idadeMaximaEspacoKids);
  if (!Number.isFinite(limit) || limit <= 0) return 'Idade máxima: não definida';
  return `Idade máxima: ${limit} ${limit === 1 ? 'ano' : 'anos'}`;
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
  if (closeHomeRetreatSelectorOnOutsidePointer) {
    document.removeEventListener('pointerdown', closeHomeRetreatSelectorOnOutsidePointer, true);
    closeHomeRetreatSelectorOnOutsidePointer = null;
  }
  if (publicStudentRegistrationToken) {
    const currentStudentScreenClass = active === 'cursista' ? ' student-screen' : '';
    app.innerHTML = `<main class="public-student-shell shared-public-student-shell${currentStudentScreenClass}">${content}</main>`;
    return;
  }
  const isPublicReceiverView = Boolean(publicReceiverToken);
  const focusedRetreat = selectedRetreat();
  const activeStudentNavId = studentFormNavIds[focusedRetreat?.tipoFichaCursista || defaultStudentFormType] || studentFormNavIds[defaultStudentFormType];
  const studentNavIds = new Set(Object.values(studentFormNavIds));
  const isVisibleStudentNav = (id) => !studentNavIds.has(id) || id === activeStudentNavId;
  const navItems = [
    ['inicio', 'Início'],
    ['retiros', 'Links de cadastro'],
    ['configuracoes', 'Configurações'],
    ['pessoas', 'Equipe de trabalho'],
    ['validacao-inscricoes', 'Validação'],
    ['cursista-epc', 'Cursista EPC'],
    ['cursista', 'Cursista Individual'],
    ['cursista-smp', 'Cursista SMP'],
    ['comunidades', 'Comunidades'],
    ['recado-equipe', 'Recado &agrave; equipe'],
    ['crachas', 'Crach&aacute;s'],
    ['quadrante', 'Quadrante'],
    ['recebedor', 'Recebedor'],
    ['relatorios', 'Relat&oacute;rios'],
    ['financeiro', 'Financeiro'],
    ['alterar-senha', 'Alterar senha'],
    ['backup', 'Backup e restaura&ccedil;&atilde;o'],
    ['usuarios', 'Usuários'],
  ].sort((first, second) => first[1].localeCompare(second[1], 'pt-BR', { sensitivity: 'base' })).filter(([id]) => canView(id) && isVisibleStudentNav(id));
  app.innerHTML = `
    <div class="admin-shell has-sidebar">
      <aside class="admin-sidebar" aria-label="Identidade EPC">
        <a class="brand sidebar-brand" href="#inicio"><span>EPC</span><strong><small>Família</small>EPC</strong></a>
        <p>Retiros que transformam vidas e renovam corações.</p>
        ${currentUser ? `<p class="session-user">Acesso ${escapeHtml(currentUser.role)}<br><strong>${escapeHtml(currentUser.username)}</strong></p>` : ''}
        <div class="sidebar-ornament" aria-hidden="true"></div>
      </aside>
      <div class="admin-workspace">
        <header class="admin-header">
          ${currentUser ? `<div class="mobile-session-user" title="Login ativo: ${escapeHtml(currentUser.username)}${focusedRetreat?.nome ? ` · Retiro em foco: ${escapeHtml(focusedRetreat.nome)}` : ''}" aria-label="Login ativo: ${escapeHtml(currentUser.username)}${focusedRetreat?.nome ? `. Retiro em foco: ${escapeHtml(focusedRetreat.nome)}` : ''}"><div class="mobile-session-login"><span>Logado:</span><strong>${escapeHtml(currentUser.username)}</strong></div>${focusedRetreat?.nome ? `<small class="mobile-session-retreat">Retiro: ${escapeHtml(focusedRetreat.nome)}</small>` : ''}</div>` : ''}
          <button class="menu-toggle" type="button" aria-label="Abrir menu" aria-expanded="false">☰</button>
        </header><nav class="main-nav admin-menu-nav" aria-label="Menu principal">
          ${navItems.map(([id, label]) => `<a href="#${id}" class="${active === id ? 'is-active' : ''}">${label}</a>`).join('')}
          <button type="button" class="logout-link" id="logout-button">Sair do sistema</button>
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

const studentRegistrationPrintValue = (value, type = 'text') => {
  let formatted = value;
  if (Array.isArray(formatted)) formatted = formatted.filter(Boolean).join(', ');
  if (type === 'date') formatted = formatDateInput(formatted);
  if (type === 'cpf') formatted = formatCpf(formatted);
  if (type === 'phone') formatted = formatBrazilianPhone(formatted);
  const text = String(formatted ?? '').trim();
  return escapeHtml(text || 'Não informado');
};

const studentRegistrationPrintConditionalValue = (record, key, type, dependsOn) => dependsOn && normalizeText(record?.[dependsOn]) === 'nao'
  ? ''
  : studentRegistrationPrintValue(record?.[key], type);

const studentRegistrationPrintFieldGrid = (record, fields, className = '') => `<div class="print-field-grid${className ? ` ${className}` : ''}">${fields.map(([label, key, type, dependsOn]) => `<div class="print-field"><strong>${escapeHtml(label)}</strong><span>${studentRegistrationPrintConditionalValue(record, key, type, dependsOn)}</span></div>`).join('')}</div>`;

const studentRegistrationPrintSection = (title, content) => `<section class="print-section"><h2>${escapeHtml(title)}</h2>${content}</section>`;

function individualStudentRegistrationPrintContent(record) {
  return [
    studentRegistrationPrintSection('Dados pessoais', studentRegistrationPrintFieldGrid(record, [
      ['Nome completo', 'nome'], ['CPF', 'cpf', 'cpf'], ['Data de nascimento', 'nascimento', 'date'], ['Telefone', 'telefone', 'phone'],
    ])),
    studentRegistrationPrintSection('Endereço', studentRegistrationPrintFieldGrid(record, [
      ['CEP', 'cep'], ['Rua', 'rua'], ['Número', 'numero'], ['Bairro', 'bairro'], ['Cidade', 'cidade'], ['Estado', 'estado'],
    ])),
    studentRegistrationPrintSection('Formação e vivência', studentRegistrationPrintFieldGrid(record, [
      ['É batizado(a)?', 'batizado'], ['Fez primeira comunhão?', 'primeiraComunhao'], ['Estuda?', 'estuda'], ['Série', 'serie', '', 'estuda'], ['Escola', 'escola', '', 'estuda'], ['Fez algum retiro?', 'fezRetiro'], ['Qual retiro?', 'qualRetiro', '', 'fezRetiro'],
    ], 'print-formation-grid')),
    studentRegistrationPrintSection('Família e convite', studentRegistrationPrintFieldGrid(record, [
      ['Nome do pai', 'nomePai'], ['Telefone do pai', 'telefonePai', 'phone'], ['Nome da mãe', 'nomeMae'], ['Telefone da mãe', 'telefoneMae', 'phone'], ['Pais participam de movimento?', 'paisMovimento'], ['Qual movimento?', 'qualMovimento', '', 'paisMovimento'], ['Quem convidou?', 'convidou'], ['Camiseta', 'camiseta'],
    ], 'print-family-grid')),
    studentRegistrationPrintSection('Saúde e cuidados', studentRegistrationPrintFieldGrid(record, [
      ['Intolerância alimentar?', 'intoleranciaAlimentos'], ['Qual intolerância?', 'qualIntolerancia', '', 'intoleranciaAlimentos'], ['Alergia a medicamentos?', 'alergiaMedicamento'], ['Qual medicamento?', 'qualAlergia', '', 'alergiaMedicamento'], ['Medicamento contínuo?', 'medicamentoContinuo'], ['Qual medicamento?', 'qualMedicamentoContinuo', '', 'medicamentoContinuo'], ['Medicamento para dor de cabeça', 'medicamentoCabeca'], ['Medicamento para dor no estômago', 'medicamentoEstomago'],
    ], 'print-health-grid')),
  ].join('');
}

function coupleStudentRegistrationPrintContent(record, studentFormType) {
  const sharedRows = [
    ['Nome completo', 'nomeDele', 'nomeDela'],
    ['Data de nascimento', 'nascimentoDele', 'nascimentoDela', 'date'],
    ['CPF', 'cpfDele', 'cpfDela', 'cpf'],
    ['Profissão', 'profissaoDele', 'profissaoDela'],
    ['Telefone', 'foneDele', 'foneDela', 'phone'],
    ['Crismado(a)?', 'crismaDele', 'crismaDela'],
    ['Participa de movimento?', 'movimentoIgrejaDele', 'movimentoIgrejaDela'],
    ['Qual movimento?', 'qualMovimentoDele', 'qualMovimentoDela'],
    ['Problema de saúde?', 'saudeDele', 'saudeDela'],
    ['Qual problema de saúde?', 'qualSaudeDele', 'qualSaudeDela'],
    ['Intolerância alimentar?', 'intoleranciaAlimentarDele', 'intoleranciaAlimentarDela'],
    ['Qual intolerância?', 'qualIntoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDela'],
    ['Manequim / camisa', 'manequimDele', 'manequimDela'],
  ];
  const smpOnlyRows = [
    ['Religião', 'religiaoDele', 'religiaoDela'],
    ['Frequenta missa?', 'missaDele', 'missaDela'],
    ['Data do casamento', 'casamentoDele', 'casamentoDela', 'date'],
    ['Filhos', 'filhosDele', 'filhosDela'],
  ];
  const rows = studentFormType === 'cursista-smp'
    ? [...sharedRows.slice(0, 6), ...smpOnlyRows, ...sharedRows.slice(6)]
    : sharedRows;
  const comparison = `<table class="couple-comparison"><thead><tr><th>Informação</th><th>Ele</th><th>Ela</th></tr></thead><tbody>${rows.map(([label, hisKey, herKey, type]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${studentRegistrationPrintValue(record?.[hisKey], type)}</td><td>${studentRegistrationPrintValue(record?.[herKey], type)}</td></tr>`).join('')}</tbody></table>`;
  const addressFields = [
    ['CEP', 'cep'], ['Endereço', 'endereco'], ['Número', 'numero'], ['Apartamento', 'nrApto'], ['Bairro', 'bairro'], ['Cidade', 'cidade'], ['Estado', 'estadoSmp'],
  ];
  const commonFields = studentFormType === 'cursista-epc' ? [
    ...addressFields, ['E-mail', 'emailEpc'],
    ['Casamento religioso', 'uniaoCasal', 'date'], ['Local do casamento', 'localCasamentoEpc'], ['Tem filhos?', 'temFilhosEpc'], ['Idade dos filhos', 'idadeFilhosEpc'], ['Precisa de acolhimento?', 'precisaAcolhimento'],
    ['Apresentante', 'nomeApresentante'], ['Fone do apresentante', 'foneApresentante', 'phone'], ['Contato de emergência', 'contatoEmergenciaEpc'], ['Fone de emergência', 'foneEmergenciaEpc', 'phone'],
  ] : [
    ['Data da união', 'uniaoCasal', 'date'], ['Filhos da união', 'filhosUniao'], ['Outras uniões?', 'outrasUnioes'], ['Precisa de acolhimento?', 'precisaAcolhimento'],
    ['Apresentante', 'nomeApresentante'], ['Fone do apresentante', 'foneApresentante', 'phone'], ['Curso do apresentante', 'cursoApresentante'], ['Cidade do apresentante', 'cidadeApresentante'], ['Paróquia do apresentante', 'paroquiaApresentante'], ['Familiar ou amigo', 'familiarAmigo'], ['Fone do familiar', 'foneFamiliar', 'phone'],
  ];
  const commonSections = studentFormType === 'cursista-smp'
    ? `${studentRegistrationPrintSection('Informações em comum', studentRegistrationPrintFieldGrid(record, commonFields, 'print-smp-common-grid'))}${studentRegistrationPrintSection('Endereço', studentRegistrationPrintFieldGrid(record, addressFields))}`
    : studentRegistrationPrintSection('Informações em comum', studentRegistrationPrintFieldGrid(record, commonFields, 'print-epc-common-grid'));
  return `${studentRegistrationPrintSection('Informações do casal', comparison)}${commonSections}`;
}

function studentRegistrationPrintDocument({ retreat, record, studentFormType }) {
  const individual = studentFormType === 'cursista';
  const label = individual ? 'Cursista Individual' : (studentFormType === 'cursista-epc' ? 'Cursista EPC' : 'Cursista SMP');
  const fileNumber = individual ? record?.numeroFichaIndividual : (record?.numeroFichaSmp || record?.id);
  const participantName = individual
    ? record?.nome
    : [record?.nomeDele, record?.nomeDela].map((name) => String(name || '').trim()).filter(Boolean).join(' e ');
  const baseContent = individual ? individualStudentRegistrationPrintContent(record) : coupleStudentRegistrationPrintContent(record, studentFormType);
  const photoType = individual ? 'individual' : (studentFormType === 'cursista-epc' ? 'epc' : 'smp');
  const photoRecordId = record?.id || record?.numeroFichaSmp;
  const photoSrc = retreat?.id && photoRecordId ? studentPhotoUrl(photoType, retreat.id, photoRecordId) : '';
  const photoFrameSize = individual ? 'width:31.2mm;height:41.6mm' : 'width:49.4mm;height:37.05mm';
  const photoImage = photoSrc ? `<img src="${escapeHtml(photoSrc)}" alt="${individual ? 'Foto do cursista' : 'Foto do casal'}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:1.6mm" onerror="this.remove()">` : '';
  const photoPrint = `<section class="print-section print-photo-section"><h2>Foto</h2><div class="print-photo-frame" style="position:relative;display:grid;place-items:center;${photoFrameSize};margin:0 auto;border:.35mm dashed #9aa89d;border-radius:2mm;background:#f7f9f6;overflow:hidden"><span style="color:#748078;font-size:7pt">Foto não cadastrada</span>${photoImage}</div></section>`;
  const content = `${photoPrint}${baseContent}`;
  const generatedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ficha ${escapeHtml(String(fileNumber || ''))} - ${escapeHtml(label)}</title><style>
    @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#1f2c28;font-family:Arial,sans-serif}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.print-page{position:relative;width:194mm;height:281mm;overflow:hidden}.print-sheet{width:194mm;transform-origin:top left}.print-header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5mm;align-items:start;padding-bottom:3mm;border-bottom:.6mm solid #356d41}.print-header h1{margin:0;color:#254d30;font-size:16pt;line-height:1.05}.print-header p{margin:1mm 0 0;color:#56665a;font-size:8pt}.print-header-meta{display:grid;grid-template-columns:auto auto;gap:1mm 4mm;text-align:right}.print-header-meta strong{font-size:7pt;text-transform:uppercase;color:#627065}.print-header-meta span{font-size:8pt;font-weight:700}.print-participant{margin:2.5mm 0 0;font-size:10pt;font-weight:700}.print-sections{display:grid;gap:2mm;margin-top:2.5mm}.print-section{break-inside:avoid}.print-section h2{margin:0 0 1mm;padding:1.1mm 2mm;border-radius:1mm;background:#e9f1e7;color:#285130;font-size:9pt;line-height:1.1}.print-field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:.2mm solid #cbd5ca;border-left:.2mm solid #cbd5ca}.print-formation-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.print-formation-grid .print-field:nth-child(1),.print-formation-grid .print-field:nth-child(2),.print-formation-grid .print-field:nth-child(6),.print-formation-grid .print-field:nth-child(7){grid-column:span 3}.print-formation-grid .print-field:nth-child(3),.print-formation-grid .print-field:nth-child(4),.print-formation-grid .print-field:nth-child(5){grid-column:span 2}.print-family-grid,.print-health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.print-field{min-width:0;padding:1.2mm 1.5mm;border-right:.2mm solid #cbd5ca;border-bottom:.2mm solid #cbd5ca}.print-field strong,.print-field span{display:block;overflow-wrap:anywhere}.print-field strong{margin-bottom:.35mm;color:#5b695f;font-size:6.5pt;line-height:1.05}.print-field span{font-size:7.7pt;line-height:1.15}.couple-comparison{width:100%;border-collapse:collapse;table-layout:fixed}.couple-comparison th,.couple-comparison td{padding:1mm 1.4mm;border:.2mm solid #cbd5ca;vertical-align:top;overflow-wrap:anywhere;font-size:7.2pt;line-height:1.12}.couple-comparison thead th{background:#f3f6f1;color:#285130;font-size:7pt;text-transform:uppercase}.couple-comparison th:first-child{width:27%;color:#56665a;text-align:left}.couple-comparison td{width:36.5%}.print-footer{margin-top:2mm;color:#68746b;font-size:6.5pt;text-align:right}@media screen{body{display:grid;place-items:start center;min-height:100vh;padding:10mm;background:#e8ece7}.print-page{background:#fff;box-shadow:0 10px 30px #1f2c2830}}@media print{body{background:#fff}.print-page{box-shadow:none}}
    .print-smp-common-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.print-smp-common-grid .print-field:nth-child(1),.print-smp-common-grid .print-field:nth-child(2),.print-smp-common-grid .print-field:nth-child(3),.print-smp-common-grid .print-field:nth-child(5),.print-smp-common-grid .print-field:nth-child(6),.print-smp-common-grid .print-field:nth-child(7){grid-column:span 2}.print-smp-common-grid .print-field:nth-child(4){grid-column:span 6}.print-smp-common-grid .print-field:nth-child(8),.print-smp-common-grid .print-field:nth-child(9),.print-smp-common-grid .print-field:nth-child(10),.print-smp-common-grid .print-field:nth-child(11){grid-column:span 3}
    .print-epc-common-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.print-epc-common-grid .print-field:nth-child(1),.print-epc-common-grid .print-field:nth-child(2),.print-epc-common-grid .print-field:nth-child(3),.print-epc-common-grid .print-field:nth-child(4),.print-epc-common-grid .print-field:nth-child(5),.print-epc-common-grid .print-field:nth-child(6),.print-epc-common-grid .print-field:nth-child(8),.print-epc-common-grid .print-field:nth-child(9),.print-epc-common-grid .print-field:nth-child(10),.print-epc-common-grid .print-field:nth-child(11),.print-epc-common-grid .print-field:nth-child(12),.print-epc-common-grid .print-field:nth-child(13){grid-column:span 2}.print-epc-common-grid .print-field:nth-child(7){grid-column:span 6}.print-epc-common-grid .print-field:nth-child(14),.print-epc-common-grid .print-field:nth-child(15),.print-epc-common-grid .print-field:nth-child(16),.print-epc-common-grid .print-field:nth-child(17){grid-column:span 3}
  </style></head><body><main class="print-page"><article class="print-sheet"><header class="print-header"><div><h1>Ficha de cadastro — ${escapeHtml(label)}</h1><p>${escapeHtml(retreat?.nome || 'Retiro não informado')}</p><div class="print-participant">${studentRegistrationPrintValue(participantName)}</div></div><div class="print-header-meta"><strong>Ficha</strong><span>${studentRegistrationPrintValue(fileNumber)}</span><strong>Emitida em</strong><span>${escapeHtml(generatedAt)}</span></div></header><div class="print-sections">${content}</div><footer class="print-footer">Documento para arquivo interno.</footer></article></main></body></html>`;
}

function openStudentRegistrationPrintDocument(documentHtml) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.');
    return false;
  }
  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();
  const fitAndPrint = () => {
    printWindow.document.querySelectorAll('.print-page').forEach((page) => {
      const sheet = page.querySelector('.print-sheet');
      if (!sheet) return;
      sheet.style.transform = 'none';
      const scale = Math.min(1, page.clientWidth / Math.max(sheet.scrollWidth, 1), page.clientHeight / Math.max(sheet.scrollHeight, 1));
      sheet.style.transform = `scale(${scale})`;
    });
    printWindow.focus();
    printWindow.print();
  };
  const imagesReady = Promise.all([...printWindow.document.images].map((image) => image.complete
    ? Promise.resolve()
    : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })));
  Promise.all([printWindow.document.fonts?.ready || Promise.resolve(), imagesReady])
    .then(() => printWindow.requestAnimationFrame(fitAndPrint));
  return true;
}

function studentRegistrationPrintBatchDocument({ retreat, records, studentFormType }) {
  const documents = records.map((record) => studentRegistrationPrintDocument({ retreat, record, studentFormType }));
  const parsed = documents.map((documentHtml) => new DOMParser().parseFromString(documentHtml, 'text/html'));
  const head = parsed[0]?.head?.innerHTML || '';
  const pages = parsed.map((documentNode) => documentNode.querySelector('.print-page')?.outerHTML || '').join('');
  return `<!doctype html><html lang="pt-BR"><head>${head}<style>.print-page{break-after:page;page-break-after:always}.print-page:last-child{break-after:auto;page-break-after:auto}@media screen{body{gap:10mm}}</style></head><body>${pages}</body></html>`;
}

function printStudentRegistrationSheet({ retreat, record, studentFormType }) {
  if (!retreat || !record) return false;
  return openStudentRegistrationPrintDocument(studentRegistrationPrintDocument({ retreat, record, studentFormType }));
}

function printStudentRegistrationSheets({ retreat, records, studentFormType }) {
  if (!retreat || !records?.length) return false;
  return openStudentRegistrationPrintDocument(studentRegistrationPrintBatchDocument({ retreat, records, studentFormType }));
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

function shirtCouplePrintContent(peopleRows = []) {
  const rows = [...peopleRows].sort((first, second) => String(first.couple || '').localeCompare(String(second.couple || ''), 'pt-BR', { sensitivity: 'base' }) || String(first.name || '').localeCompare(String(second.name || ''), 'pt-BR', { sensitivity: 'base' }));
  if (!rows.length) return '<p class="empty-state">Nenhum cursista informado.</p>';
  let currentCouple = '';
  return `<div class="student-health-list shirt-community-list">${rows.map((person) => {
    const heading = person.couple !== currentCouple ? (currentCouple = person.couple, `<div class="shirt-community-heading"><strong>${escapeHtml(person.couple || 'Casal sem nome')}</strong></div>`) : '';
    return `${heading}<div><strong>${escapeHtml(person.name || 'Sem nome')}</strong><span>${escapeHtml(String(person.shirt || '').trim() || 'NÃ£o informado')}</span></div>`;
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
    ['groups', 'Pessoas por grupo', grid.querySelector('.participation-group-stat-panel')],
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
    const printOptions = key === 'shirts' ? (options.shirtPrintOptions || [
      { label: 'Por tamanho da camiseta', title: 'Camisetas dos cursistas por tamanho', content: panel.innerHTML },
      { label: 'Por comunidade', title: 'Camisetas dos cursistas por comunidade', content: shirtCommunityPrintContent(options.shirtStudents || [], options.communityDetails || new Map()) },
    ]) : null;
    openHomeInfoWindow(label, panel.innerHTML, { printOptions });
  };
  const bindHomeStatButton = (button) => {
    if (button.dataset.homeStatBound === 'true') return;
    button.dataset.homeStatBound = 'true';
    button.addEventListener('click', () => {
      const selected = button.dataset.homeStat;
      if (!selected) return;
      controls.querySelectorAll('[data-home-stat]').forEach((item) => {
        const activeButton = item.dataset.homeStat === selected;
        item.classList.toggle('is-active', activeButton);
        item.setAttribute('aria-selected', activeButton ? 'true' : 'false');
      });
      openWindow(selected);
    });
  };
  panels.forEach(([key, , panel]) => {
    panel.classList.add('home-stat-panel');
    panel.dataset.homeStatPanel = key;
    panel.hidden = true;
  });
  controls.querySelectorAll('[data-home-stat]').forEach((button) => {
    bindHomeStatButton(button);
  });
  app.querySelectorAll('[data-home-stat]').forEach((button) => {
    bindHomeStatButton(button);
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

function setupParticipationGroupStatDrilldown(root, rows = []) {
  root.querySelectorAll('[data-stat-participation-group]').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.dataset.statParticipationGroup;
      const selected = rows.find((row) => normalizeText(row.group) === normalizeText(group));
      const volunteers = selected?.volunteers || [];
      root.innerHTML = `<button type="button" class="receiver-sector-back" data-participation-group-stat-back>← Todos os grupos</button><section class="sector-public-modal sector-public-modal-inline" role="dialog" aria-modal="true" aria-labelledby="participation-group-title"><p class="eyebrow">Pessoas por grupo</p><h1 id="participation-group-title">${escapeHtml(group)}</h1><p>${volunteers.length} pessoa(s) classificada(s) neste grupo.</p>${volunteers.length ? `<ul class="sector-public-list">${volunteers.map((entry) => {
        const previousRetreats = sortedPreviousRetreats(entryPreviousRetreats(entry));
        return `<li><strong>${escapeHtml(entry.nome || 'Sem nome')}</strong><small>Setor de trabalho: ${escapeHtml(entrySectors(entry).length ? entrySectors(entry).join(', ') : 'Setor nao informado')}</small><span>Retiros que fez: ${escapeHtml(previousRetreats.length ? previousRetreats.join(', ') : 'nao informado')}</span><span>Dias de trabalho: ${escapeHtml(entryDays(entry).length ? entryDays(entry).join(', ') : 'dias nao informados')}</span></li>`;
      }).join('')}</ul>` : '<div class="sector-public-empty">Nenhuma pessoa classificada neste grupo.</div>'}</section>`;
      setHomeStatPrintOptions(root.closest('.home-stat-dialog'), [{ label: 'Impressão', title: `Pessoas por grupo - ${group}`, content: root.innerHTML }]);
      root.querySelector('[data-participation-group-stat-back]').addEventListener('click', () => {
        root.innerHTML = root.dataset.participationGroupListHtml || '';
        setHomeStatPrintOptions(root.closest('.home-stat-dialog'), [{ label: 'Impressão', title: 'Pessoas por grupo', content: root.innerHTML }]);
        setupParticipationGroupStatDrilldown(root, rows);
      });
    });
  });
}

function wireParticipationGroupStatWindows(rows = []) {
  app.querySelectorAll('[data-home-stat="groups"]').forEach((button) => {
    button.addEventListener('click', () => {
      setTimeout(() => {
        const root = app.querySelector('.home-stat-scroll');
        if (!root) return;
        root.dataset.participationGroupListHtml = root.innerHTML;
        setupParticipationGroupStatDrilldown(root, rows);
      }, 0);
    });
  });
}

function wireHomeRetreatSelector(activeRetreat, focusRetreats = []) {
  const selector = app.querySelector('[data-home-retreat-selector]');
  const input = selector?.querySelector('#home-retreat-search');
  const list = selector?.querySelector('#home-retreat-options');
  const empty = selector?.querySelector('[data-home-retreat-empty]');
  const message = selector?.querySelector('[data-home-retreat-message]');
  if (!selector || !input || !list || input.disabled) return;
  const optionButtons = [...list.querySelectorAll('[data-home-retreat-id]')];
  const retreatById = new Map(focusRetreats.map((retreat) => [retreat.id, retreat]));
  const currentName = activeRetreat?.nome || '';
  let keyboardIndex = -1;
  let switching = false;

  const visibleOptions = () => optionButtons.filter((option) => !option.hidden);
  const setKeyboardIndex = (nextIndex) => {
    const visible = visibleOptions();
    optionButtons.forEach((option) => option.classList.remove('is-keyboard-active'));
    if (!visible.length) {
      keyboardIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    keyboardIndex = (nextIndex + visible.length) % visible.length;
    const activeOption = visible[keyboardIndex];
    activeOption.classList.add('is-keyboard-active');
    input.setAttribute('aria-activedescendant', activeOption.id);
    activeOption.scrollIntoView({ block: 'nearest' });
  };
  const filterOptions = (term = '') => {
    const normalizedTerm = normalizeText(term);
    optionButtons.forEach((option) => {
      const retreat = retreatById.get(option.dataset.homeRetreatId);
      const searchText = normalizeText([
        retreat?.nome,
        retreat?.local,
        statusLabel(retreat?.status),
        retreat?.status === 'concluido' ? 'Somente leitura' : '',
        dateRange(retreat?.dataInicio, retreat?.dataTermino),
      ].filter(Boolean).join(' '));
      option.hidden = Boolean(normalizedTerm && !searchText.includes(normalizedTerm));
    });
    const visible = visibleOptions();
    if (empty) empty.hidden = Boolean(visible.length);
    setKeyboardIndex(visible.length ? 0 : -1);
  };
  const openList = ({ showAll = false } = {}) => {
    if (switching) return;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    filterOptions(showAll ? '' : input.value);
  };
  const closeList = ({ restore = true } = {}) => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    optionButtons.forEach((option) => option.classList.remove('is-keyboard-active'));
    keyboardIndex = -1;
    if (restore) input.value = currentName;
  };
  const selectRetreat = async (retreatId) => {
    if (switching) return;
    const retreat = retreatById.get(retreatId);
    if (!retreat || !canAccessRetreat(retreat)) {
      if (message) message.textContent = 'Este retiro não está mais disponível para o seu usuário.';
      closeList();
      return;
    }
    if (retreat.id === activeRetreat?.id) {
      closeList();
      return;
    }
    switching = true;
    const previousRetreatId = activeRetreat?.id || '';
    selector.setAttribute('aria-busy', 'true');
    input.disabled = true;
    optionButtons.forEach((option) => { option.disabled = true; });
    if (message) message.textContent = 'Atualizando o retiro em foco...';
    closeList({ restore: false });
    try {
      if (!setSelectedRetreatId(retreat.id)) throw new Error('Este retiro não está mais disponível para o seu usuário.');
      await loadData();
      const resolvedRetreat = selectedRetreat();
      await renderHome({
        focusChangedMessage: resolvedRetreat?.id === retreat.id
          ? 'Retiro em foco alterado'
          : 'O retiro selecionado não está mais disponível. O foco foi atualizado.',
      });
    } catch (error) {
      setSelectedRetreatId(previousRetreatId);
      switching = false;
      selector.removeAttribute('aria-busy');
      input.disabled = false;
      optionButtons.forEach((option) => { option.disabled = false; });
      input.value = currentName;
      if (message) message.textContent = error.message || 'Não foi possível alterar o retiro em foco.';
    }
  };

  input.addEventListener('focus', () => {
    input.select();
    openList({ showAll: true });
  });
  input.addEventListener('click', () => openList({ showAll: input.value === currentName }));
  input.addEventListener('input', () => openList());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeList();
      return;
    }
    if (event.key === 'Tab') {
      closeList();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) openList({ showAll: input.value === currentName });
      setKeyboardIndex(keyboardIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter' && !list.hidden) {
      event.preventDefault();
      const option = visibleOptions()[keyboardIndex];
      if (option) void selectRetreat(option.dataset.homeRetreatId);
    }
  });
  optionButtons.forEach((option) => {
    option.addEventListener('pointermove', () => {
      const index = visibleOptions().indexOf(option);
      if (index >= 0) setKeyboardIndex(index);
    });
    option.addEventListener('click', () => void selectRetreat(option.dataset.homeRetreatId));
  });
  closeHomeRetreatSelectorOnOutsidePointer = (event) => {
    if (!selector.contains(event.target)) closeList();
  };
  document.addEventListener('pointerdown', closeHomeRetreatSelectorOnOutsidePointer, true);
}

async function renderHome({ focusChangedMessage = '' } = {}) {
  const active = selectedRetreat();
  const activeStudentFormType = active?.tipoFichaCursista || defaultStudentFormType;
  const usesCoupleStudentForm = ['cursista-smp', 'cursista-epc'].includes(activeStudentFormType);
  const [allStudents, allCommunities, coupleStudents] = await Promise.all([
    dataService.listCursistas(active?.id || ''),
    dataService.listComunidades(active?.id || ''),
    active?.id && usesCoupleStudentForm ? coupleStudentSource(activeStudentFormType).list(active.id).catch((error) => {
      console.error(error);
      return [];
    }) : Promise.resolve([]),
  ]);
  const activeCommunities = active ? allCommunities.filter((community) => community.retiroId === active.id) : [];
  const activeCommunityDetails = studentCommunityDetails(activeCommunities);
  const activeCoupleCommunityDetails = coupleCommunityDetails(activeCommunities, activeStudentFormType);
  const activeStudents = active ? uniqueByParticipant(allStudents.filter((student) => student.retiroId === active.id)) : [];
  const activeStudentPresenceCount = studentPresenceCount(activeStudentFormType, activeStudents, coupleStudents);
  const coupleStudentTitle = activeStudentFormType === 'cursista-epc' ? 'Cursista EPC' : 'Cursista SMP';
  const smpYes = (value) => normalizeText(value) === 'sim';
  const smpCoupleName = (record = {}) => [record.nomeDele, record.nomeDela].map((name) => String(name || '').trim()).filter(Boolean).join(' e ') || (record.numeroFichaSmp || record.id ? `Ficha ${record.numeroFichaSmp || record.id}` : 'Casal sem nome');
  const smpPeople = coupleStudents.flatMap((record) => [
    { record, side: 'Dele', name: record.nomeDele || 'Ele', health: record.saudeDele, healthDetail: record.qualSaudeDele, intolerance: record.intoleranciaAlimentarDele, intoleranceDetail: record.qualIntoleranciaAlimentarDele, shirt: record.manequimDele },
    { record, side: 'Dela', name: record.nomeDela || 'Ela', health: record.saudeDela, healthDetail: record.qualSaudeDela, intolerance: record.intoleranciaAlimentarDela, intoleranceDetail: record.qualIntoleranciaAlimentarDela, shirt: record.manequimDela },
  ].map((person) => ({ ...person, couple: smpCoupleName(record), community: coupleCommunityDetail(record, activeCoupleCommunityDetails) })));
  const smpIntolerancePeople = smpPeople.filter((person) => smpYes(person.intolerance) || String(person.intoleranceDetail || '').trim());
  const smpHealthPeople = smpPeople.filter((person) => smpYes(person.health) || String(person.healthDetail || '').trim());
  const smpAcolhimentoCouples = coupleStudents.filter((record) => smpYes(record.precisaAcolhimento));
  const retreatBirthdayMonths = (() => {
    const months = new Set();
    const start = parseLocalDate(active?.dataInicio);
    const end = parseLocalDate(active?.dataTermino || active?.dataInicio);
    if (!start || !end || end < start) return months;
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
    const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1, 12);
    while (cursor <= lastMonth && months.size < 12) {
      months.add(cursor.getMonth());
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  })();
  const birthdayStudents = activeStudents
    .filter((student) => {
      const birthDate = parseLocalDate(student.nascimento);
      return birthDate && retreatBirthdayMonths.has(birthDate.getMonth());
    })
    .sort((first, second) => {
      const firstBirth = parseLocalDate(first.nascimento);
      const secondBirth = parseLocalDate(second.nascimento);
      const monthResult = firstBirth.getMonth() - secondBirth.getMonth();
      if (monthResult) return monthResult;
      const dayResult = firstBirth.getDate() - secondBirth.getDate();
      if (dayResult) return dayResult;
      return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
  const activeEnrolments = active ? mergeEnrolmentsByParticipant(enrolments.filter((item) => item.retiroId === active.id)) : [];
  const activeEntries = active ? enrolments.filter((item) => item.retiroId === active.id) : [];
  const activeStatEntries = activeEntries.length ? activeEntries : activeEnrolments;
  const pendingValidationGroups = enrolmentValidationGroups(activeEntries).filter((group) => !isEnrolmentGroupValidated(group));
  const serviceDays = active ? retreatServiceDays(active) : [];
  const sectorCounts = active ? sortSectors(uniqueSectors([...(active.setores || []), ...activeStatEntries.flatMap(entrySectors)]))
    .map((sector) => [sector, activeStatEntries.filter((entry) => entryHasSector(entry, sector)).length])
    .filter(([sector, count]) => count > 0 || active?.setores?.includes(sector)) : [];
  const dayCount = (day) => activeStatEntries.filter((entry) => entryDays(entry).some((item) => normalizeText(item) === normalizeText(day))).length + activeStudentPresenceCount + kidsCareSummary.children.length;
  const shirtCounts = activeStudents.reduce((counts, student) => {
    const size = String(student.camiseta || '').trim();
    if (size) counts[size] = (counts[size] || 0) + 1;
    return counts;
  }, {});
  const smpShirtCounts = smpPeople.reduce((counts, person) => {
    const size = String(person.shirt || '').trim();
    if (size) counts[size] = (counts[size] || 0) + 1;
    return counts;
  }, {});
  const shirtOrder = ['8', '10', '12', '14', '16', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'];
  const shirtRowsFor = (counts) => Object.entries(counts).sort(([first], [second]) => {
    const firstIndex = shirtOrder.indexOf(first);
    const secondIndex = shirtOrder.indexOf(second);
    if (firstIndex !== -1 || secondIndex !== -1) return (firstIndex === -1 ? 99 : firstIndex) - (secondIndex === -1 ? 99 : secondIndex);
    return first.localeCompare(second, 'pt-BR', { numeric: true, sensitivity: 'base' });
  });
  const shirtRows = shirtRowsFor(usesCoupleStudentForm ? smpShirtCounts : shirtCounts);
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
  const continuousMedicationStudents = activeStudents
    .filter((student) => normalizeText(student.medicamentoContinuo) === 'sim')
    .sort((first, second) => {
      const firstCommunity = studentCommunityDetail(first, activeCommunityDetails);
      const secondCommunity = studentCommunityDetail(second, activeCommunityDetails);
      if (firstCommunity.order !== secondCommunity.order) return firstCommunity.order - secondCommunity.order;
      const communityResult = firstCommunity.name.localeCompare(secondCommunity.name, 'pt-BR', { sensitivity: 'base' });
      if (communityResult) return communityResult;
      return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
  const parentSuggestedMedicationStudents = activeStudents
    .filter((student) => String(student.medicamentoCabeca || '').trim() || String(student.medicamentoEstomago || '').trim())
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
  const teamBirthdayRows = activeEnrolments
    .map((entry) => {
      const person = peopleById.get(entry.pessoaId) || {};
      const historicalData = entry.dadosPessoais || {};
      return {
        name: person.nome || historicalData.nome || entry.nome || 'Sem nome',
        nascimento: [person.nascimento, historicalData.nascimento, entry.nascimento].map(normalizeDateInput).find(Boolean) || '',
        sectors: entrySectors(entry),
      };
    })
    .filter((row) => {
      const birthDate = parseLocalDate(row.nascimento);
      return birthDate && retreatBirthdayMonths.has(birthDate.getMonth());
    })
    .sort((first, second) => {
      const firstBirth = parseLocalDate(first.nascimento);
      const secondBirth = parseLocalDate(second.nascimento);
      const monthResult = firstBirth.getMonth() - secondBirth.getMonth();
      if (monthResult) return monthResult;
      const dayResult = firstBirth.getDate() - secondBirth.getDate();
      if (dayResult) return dayResult;
      return first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' });
    });
  const spaceKidsRows = spaceKidsRowsForEnrolments(activeEnrolments, peopleById);
  const kidsCareSummary = buildKidsCareSummary({
    teamKids: spaceKidsRows,
    coupleStudents: coupleStudents.map((record) => ({
      ...record,
      kidsCommunity: coupleCommunityDetail(record, activeCoupleCommunityDetails).name,
    })),
    studentFormType: activeStudentFormType,
    retreatId: active?.id || '',
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
  const participationGroupStatRows = participationGroupOrder.map((group) => {
    const volunteers = activeStatEntries
      .filter((entry) => normalizeText(entryParticipationGroup(entry)) === normalizeText(group))
      .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }));
    return { group, count: volunteers.length, volunteers };
  });
  const sectorRows = sectorStatRows.length ? sectorStatRows.map(({ sector, count }) => `<button type="button" data-stat-sector="${escapeHtml(sector)}"><span>${escapeHtml(sector)}</span><strong>${count}</strong></button>`).join('') : '<p class="empty-state">Nenhum setor com equipe inscrita.</p>';
  const participationGroupRows = participationGroupStatRows.map(({ group, count }) => `<button type="button" data-stat-participation-group="${escapeHtml(group)}"><span>${escapeHtml(group)}</span><strong>${count}</strong></button>`).join('');
  const dayRows = serviceDays.length ? serviceDays.map((day) => `<div><span>${escapeHtml(day)}</span><strong>${dayCount(day)}</strong><small>pessoa(s)</small></div>`).join('') : '<p class="empty-state">Nenhum dia configurado.</p>';
  const shirtGrid = shirtRows.length ? shirtRows.map(([size, count]) => `<div><span>${escapeHtml(size)}</span><strong>${count}</strong><small>camiseta(s)</small></div>`).join('') : '<p class="empty-state">Nenhum tamanho informado.</p>';
  const healthRows = (students, field, fallback, options = {}) => students.length ? `<div class="student-health-list">${students.map((student) => {
    const community = options.showCommunity ? studentCommunityDetail(student, options.communityDetails) : null;
    return `<div><div class="student-health-person"><strong>${escapeHtml(student.nome || 'Sem nome')}</strong>${community ? `<small>Comunidade: ${escapeHtml(community.name)}</small>` : ''}</div><span>${escapeHtml(String(student[field] || '').trim() || fallback)}</span></div>`;
  }).join('')}</div>` : '<p class="empty-state">Nenhum cursista informado.</p>';
  const smpPersonRows = (rows, field, fallback) => rows.length ? `<div class="student-health-list">${rows.map((person) => `<div><div class="student-health-person"><strong>${escapeHtml(person.name || 'Sem nome')}</strong><small>Comunidade: ${escapeHtml(person.community?.name || 'Sem comunidade')}</small></div><span>${escapeHtml(String(person[field] || '').trim() || fallback)}</span></div>`).join('')}</div>` : '<p class="empty-state">Nenhum cursista informado.</p>';
  const smpAcolhimentoRows = (rows) => rows.length ? `<div class="student-health-list">${rows.map((record) => {
    const details = [
      record.foneDele ? `Fone dele: ${record.foneDele}` : '',
      record.foneDela ? `Fone dela: ${record.foneDela}` : '',
      record.nomeApresentante ? `Apresentante: ${record.nomeApresentante}` : '',
    ].filter(Boolean).join(' Â· ');
    return `<div><strong>${escapeHtml(smpCoupleName(record))}</strong><span>${escapeHtml(details || 'Precisa de acolhimento')}</span></div>`;
  }).join('')}</div>` : '<p class="empty-state">Nenhum casal informado.</p>';
  const parentSuggestedMedicationRows = (students, communityDetails) => students.length ? `<div class="student-health-list">${students.map((student) => {
    const community = studentCommunityDetail(student, communityDetails);
    const headacheMedication = String(student.medicamentoCabeca || '').trim();
    const stomachMedication = String(student.medicamentoEstomago || '').trim();
    const details = [
      headacheMedication ? `Dor de cabeça: ${headacheMedication}` : '',
      stomachMedication ? `Dor no estômago: ${stomachMedication}` : '',
    ].filter(Boolean).join(' · ');
    return `<div><div class="student-health-person"><strong>${escapeHtml(student.nome || 'Sem nome')}</strong><small>Comunidade: ${escapeHtml(community.name)}</small></div><span>${escapeHtml(details || 'Medicamento não detalhado')}</span></div>`;
  }).join('')}</div>` : '<p class="empty-state">Nenhum cursista informado.</p>';
  const preferenceRows = (rows, fallback) => rows.length ? `<div class="student-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.detail)}</span></div>`).join('')}</div>` : `<p class="empty-state">${fallback}</p>`;
  const kidsRows = (rows) => rows.length ? `<div class="student-health-list kids-health-list">${rows.map((kid) => `<div><strong>${escapeHtml(kid.nome || 'Sem nome')}<span class="student-health-inline">${escapeHtml(ageInYearsAndMonths(kid.nascimento))}</span></strong><div class="kids-care-comments"><small>Responsável: ${escapeHtml(kid.responsible || kid.volunteer || 'Não informado')}${kid.contact ? ` · Contato: ${escapeHtml(kid.contact)}` : ''}</small><small>Origem: ${escapeHtml(kid.origin || 'Equipe de trabalho')} · ${escapeHtml(kid.contextLabel || 'Setor de trabalho')}: ${escapeHtml(kid.contextValue || (Array.isArray(kid.sectors) && kid.sectors.length ? kid.sectors.join(', ') : 'Não informado'))}</small></div></div>`).join('')}</div>` : '<p class="empty-state">Nenhuma criança cadastrada no Espaço Kids.</p>';
  const kidsCareRows = (rows, fallback, emptyMessage) => rows.length ? `<div class="student-health-list kids-health-list kids-care-comment-list">${rows.map((kid) => `<div style="grid-template-columns:1fr;gap:6px"><strong>${escapeHtml(kid.nome || 'Sem nome')}<span class="student-health-inline">${escapeHtml(ageInYearsAndMonths(kid.nascimento))}</span></strong><div class="kids-care-comments" style="display:grid;gap:3px"><small>Responsável: ${escapeHtml(kid.responsible || 'Não informado')}</small><small>Origem: ${escapeHtml(kid.origin)} · ${escapeHtml(kid.contextLabel)}: ${escapeHtml(kid.contextValue)}</small><small class="kids-care-problem"><strong>Problema descrito: ${escapeHtml(kid.detail || fallback)}</strong></small></div></div>`).join('')}</div>` : `<p class="empty-state">${emptyMessage}</p>`;
  const birthdayRowsHtml = (students) => students.length ? `<div class="student-health-list">${students.map((student) => {
    const community = studentCommunityDetail(student, activeCommunityDetails);
    return `<div><div class="student-health-person"><strong>${escapeHtml(student.nome || 'Sem nome')}</strong><small>Comunidade: ${escapeHtml(community.name)}</small></div><span>${escapeHtml(date(student.nascimento))}</span></div>`;
  }).join('')}</div>` : '<p class="empty-state">Nenhum cursista aniversariante nos meses deste retiro.</p>';
  const teamBirthdayRowsHtml = (rows) => rows.length ? `<div class="student-health-list">${rows.map((row) => `<div><div class="student-health-person"><strong>${escapeHtml(row.name)}</strong><small>Setor: ${escapeHtml(row.sectors.length ? row.sectors.join(', ') : 'Setor não informado')}</small></div><span>${escapeHtml(date(row.nascimento))}</span></div>`).join('')}</div>` : '<p class="empty-state">Nenhuma pessoa da equipe de trabalho aniversariante nos meses deste retiro.</p>';
  const cityRowsHtml = (rows) => {
    if (!rows.length) return '<p class="empty-state">Nenhuma cidade informada nos cadastros deste retiro.</p>';
    const totals = rows.reduce((sum, row) => ({ students: sum.students + row.students, team: sum.team + row.team }), { students: 0, team: 0 });
    return `<div class="student-health-list city-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.city)}</strong><span><b>${row.students}</b><small>Cursistas</small></span><span><b>${row.team}</b><small>Equipe de trabalho</small></span></div>`).join('')}<div class="city-health-total"><strong>Total geral</strong><span><b>${totals.students}</b><small>Cursistas</small></span><span><b>${totals.team}</b><small>Equipe de trabalho</small></span><span><b>${totals.students + totals.team}</b><small>Participantes</small></span></div></div>`;
  };
  const homeHealthCard = (label, count, key, action = 'Visualizar') => `<article class="student-health-card home-column-card"><div><span>${label}</span>${count === null ? '' : `<strong>${count}</strong>`}</div><button type="button" data-home-health="${key}">${action}</button></article>`;
  const homeStatCard = (label, count, key, action = 'Visualizar') => `<article class="student-health-card home-column-card"><div><span>${label}</span>${count === null ? '' : `<strong>${count}</strong>`}</div><button type="button" data-home-stat="${key}">${action}</button></article>`;
  const homeLinkCard = (label, count, href, action = 'Visualizar') => `<article class="student-health-card home-column-card"><div><span>${label}</span>${count === null ? '' : `<strong>${count}</strong>`}</div><a href="${href}">${action}</a></article>`;
  const homePanel = (label, description, content) => `<article class="panel dashboard-panel home-column-panel"><div class="panel-heading"><div><h2>${label}</h2>${description ? `<p>${description}</p>` : ''}</div></div><div>${content}</div></article>`;
  const studentColumnHtml = usesCoupleStudentForm
    ? `<section class="home-column"><div class="home-column-heading"><h2>${escapeHtml(coupleStudentTitle)}</h2><div class="home-column-total"><strong>${coupleStudents.length}</strong><small>Casal(is)</small></div></div><div class="home-column-list">
        ${homeHealthCard('Possui intolerância alimentar', smpIntolerancePeople.length, 'smp-intolerance')}
        ${homeHealthCard('Possui problema de saúde', smpHealthPeople.length, 'smp-health')}
        ${homeHealthCard('Precisa de acolhimento', smpAcolhimentoCouples.length, 'smp-acolhimento')}
        ${homeStatCard('Camisetas dos cursistas', null, 'shirts', 'Visualizar detalhes')}
      </div></section>`
    : `<section class="home-column"><div class="home-column-heading"><h2>Cursistas</h2><div class="home-column-total"><strong>${activeStudents.length}</strong><small>Pessoa(s)</small></div></div><div class="home-column-list">
        ${homeHealthCard('Intolerância a alimentos', intoleranceStudents.length, 'intolerance')}
        ${homeHealthCard('Alérgicos a Medicamentos', allergyStudents.length, 'allergy')}
        ${homeHealthCard('Tomam medicamento contínuo', continuousMedicationStudents.length, 'continuous-medication')}
        ${homeHealthCard('Medicação sugerida pelos pais', parentSuggestedMedicationStudents.length, 'parent-suggested-medication')}
        ${homeHealthCard('Aniversariantes do mês', birthdayStudents.length, 'birthdays')}
        ${homeStatCard('Camisetas dos cursistas', null, 'shirts', 'Visualizar detalhes')}
      </div></section>`;
  const homeFocusRetreats = accessibleRetreats();
  const homeFocusDisabled = homeFocusRetreats.length <= 1;
  const homeFocusOptions = homeFocusRetreats.map((retreat, index) => {
    const readOnlyLabel = retreat.status === 'concluido' ? ' · Somente leitura' : '';
    const optionDetails = [dateRange(retreat.dataInicio, retreat.dataTermino), retreat.local].filter(Boolean).join(' · ');
    return `<button type="button" role="option" tabindex="-1" id="home-retreat-option-${index}" class="home-retreat-option${retreat.id === active?.id ? ' is-selected' : ''}" data-home-retreat-id="${escapeHtml(retreat.id)}" aria-selected="${retreat.id === active?.id}"><span><strong>${escapeHtml(retreat.nome || 'Retiro sem nome')}</strong><small>${escapeHtml(optionDetails || 'Período e local não informados')}</small></span><em class="status ${escapeHtml(retreat.status || '')}">${escapeHtml(statusLabel(retreat.status))}${readOnlyLabel}</em></button>`;
  }).join('');
  const homeFocusHint = homeFocusRetreats.length > 1
    ? 'Digite para buscar por nome, período, local ou situação.'
    : (homeFocusRetreats.length === 1 ? 'Único retiro disponível para o seu usuário.' : 'Nenhum retiro disponível para o seu usuário.');
  const homeRetreatSelectorHtml = `<section class="home-retreat-selector" data-home-retreat-selector aria-labelledby="home-retreat-selector-label"><label id="home-retreat-selector-label" for="home-retreat-search">Retiro em foco</label><div class="home-retreat-picker"><input type="search" id="home-retreat-search" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="home-retreat-options" aria-describedby="home-retreat-selector-hint" autocomplete="off" value="${escapeHtml(active?.nome || (homeFocusRetreats.length ? '' : 'Nenhum retiro disponível'))}" ${homeFocusDisabled ? 'disabled' : ''}><span aria-hidden="true">⌄</span><div class="home-retreat-options" id="home-retreat-options" role="listbox" hidden>${homeFocusOptions}<p data-home-retreat-empty hidden>Nenhum retiro encontrado.</p></div></div><small id="home-retreat-selector-hint">${escapeHtml(homeFocusHint)}</small><p class="home-retreat-focus-message" data-home-retreat-message role="status" aria-live="polite">${escapeHtml(focusChangedMessage)}</p></section>`;
  layout(`<section class="home-topline"><section class="dashboard-hero"><div class="hero-cross" aria-hidden="true"></div><h1>${active ? escapeHtml(active.nome) : 'Retiro em foco'}</h1><p>${active ? `${dateRange(active.dataInicio, active.dataTermino)}${active.local ? ` · ${escapeHtml(active.local)}` : ''}` : 'Crie ou publique um retiro para acompanhar as estatísticas.'}</p><div class="gold-divider" aria-hidden="true"></div></section>${homeRetreatSelectorHtml}
    </section>
    <section class="home-overview" aria-label="Resumo do retiro em foco">
      ${studentColumnHtml}
      <section class="home-column"><div class="home-column-heading"><h2>Equipe de trabalho</h2><div class="home-column-total"><strong>${activeEnrolments.length}</strong><small>Pessoa(s)</small></div></div><div class="home-column-list">
        ${homeLinkCard('Inscrições aguardando validação', pendingValidationGroups.length, '#validacao-inscricoes')}
        ${homeHealthCard('Quadrante(s) impresso', quadranteRows.length, 'quadrante')}
        ${homeHealthCard('Fotos solicitadas', photoRows.length, 'photo')}
        ${homeStatCard('Pessoas por setor', null, 'sectors')}
        ${homeStatCard('Pessoas por grupo', null, 'groups')}
        ${homeHealthCard('Aniversariantes do mês', teamBirthdayRows.length, 'team-birthdays')}
      </div></section>
      <section class="home-column"><h2>Diversos</h2><div class="home-column-list home-misc-groups">
        <section class="home-misc-box" aria-label="Participação">
          ${homePanel('Presença por dia', 'Equipe de trabalho + Cursistas + Crianças Kids', `<div class="stat-tile-grid presence-stat-grid">${dayRows}</div>`)}
          ${homeHealthCard('Cidades participantes', cityRows.length, 'cities', 'Visualizar detalhes')}
        </section>
        <section class="home-misc-box" aria-labelledby="home-kids-group-title">
          <h3 id="home-kids-group-title">Espaço Kids</h3>
          <div class="home-column-list">
            ${homeHealthCard('Total de crianças', kidsCareSummary.children.length, 'kids')}
            ${homeHealthCard('Crianças com intolerância alimentar', kidsCareSummary.intolerance.length, 'kids-intolerance')}
            ${homeHealthCard('Crianças com problema de saúde', kidsCareSummary.health.length, 'kids-health')}
          </div>
        </section>
      </div></section>
    </section>
    <section class="dashboard-grid retreat-stats-grid home-detail-source" aria-hidden="true">
      <article class="panel dashboard-panel shirt-stat-panel"><div class="panel-heading"><div><h2>Camisetas dos cursistas</h2><p>Quantidade por tamanho informado na ficha do cursista.</p></div></div><div class="stat-tile-grid shirt-stat-grid">${shirtGrid}</div></article>
      <article class="panel dashboard-panel presence-stat-panel"><div class="panel-heading"><div><h2>Presença por dia</h2><p>Equipe de trabalho + Cursistas + Crianças Kids.</p></div></div><div class="stat-tile-grid presence-stat-grid">${dayRows}</div></article>
      <article class="panel dashboard-panel sector-stat-panel"><div class="panel-heading"><div><h2>Pessoas por setor</h2><p>Equipe de trabalho inscrita por setor.</p></div></div><div class="sector-simple-list">${sectorRows}</div></article>
      <article class="panel dashboard-panel participation-group-stat-panel"><div class="panel-heading"><div><h2>Pessoas por grupo</h2><p>Equipe de trabalho classificada pelos retiros anteriores.</p></div></div><div class="sector-simple-list">${participationGroupRows}</div></article>
    </section>
    <footer class="dashboard-blessing">Deus seja louvado!</footer>`, 'inicio');
  wireHomeRetreatSelector(active, homeFocusRetreats);
  setupHomeStatTabs({
    shirtStudents: usesCoupleStudentForm ? smpPeople.map((person) => ({ nome: person.name, camiseta: person.shirt })) : activeStudents,
    communityDetails: activeCommunityDetails,
    shirtPrintOptions: usesCoupleStudentForm ? [
      { label: 'Por tamanho da camiseta', title: 'Camisetas dos cursistas por tamanho', content: app.querySelector('.shirt-stat-panel')?.innerHTML || '' },
      { label: 'Por casal', title: `Camisetas dos cursistas por casal - ${coupleStudentTitle}`, content: shirtCouplePrintContent(smpPeople) },
    ] : null,
  });
  const healthContent = {
    intolerance: `<div class="panel-heading"><div><h2>Intolerância a alimentos</h2><p>Comunidade, nome do cursista e alimento informado na ficha.</p></div></div>${healthRows(intoleranceStudents, 'qualIntolerancia', 'Intolerância não detalhada', { showCommunity: true, communityDetails: activeCommunityDetails })}`,
    allergy: `<div class="panel-heading"><div><h2>Alérgicos a Medicamentos</h2><p>Comunidade, nome do cursista e medicamento informado na ficha.</p></div></div>${healthRows(allergyStudents, 'qualAlergia', 'Medicamento não detalhado', { showCommunity: true, communityDetails: activeCommunityDetails })}`,
    'continuous-medication': `<div class="panel-heading"><div><h2>Tomam medicamento contínuo</h2><p>Comunidade, nome do cursista e medicamento informado na ficha.</p></div></div>${healthRows(continuousMedicationStudents, 'qualMedicamentoContinuo', 'Medicamento não detalhado', { showCommunity: true, communityDetails: activeCommunityDetails })}`,
    'parent-suggested-medication': `<div class="panel-heading"><div><h2>Medicação sugerida pelos pais</h2><p>Comunidade, nome do cursista e remédios sugeridos pelos pais na ficha.</p></div></div>${parentSuggestedMedicationRows(parentSuggestedMedicationStudents, activeCommunityDetails)}`,
    'smp-intolerance': `<div class="panel-heading"><div><h2>Possui intolerância alimentar</h2><p>Comunidade, nome da pessoa e intolerância informada na ficha ${escapeHtml(coupleStudentTitle)}.</p></div></div>${smpPersonRows(smpIntolerancePeople, 'intoleranceDetail', 'Intolerância não detalhada')}`,
    'smp-health': `<div class="panel-heading"><div><h2>Possui problema de saúde</h2><p>Comunidade, nome da pessoa e problema informado na ficha ${escapeHtml(coupleStudentTitle)}.</p></div></div>${smpPersonRows(smpHealthPeople, 'healthDetail', 'Problema de saúde não detalhado')}`,
    'smp-acolhimento': `<div class="panel-heading"><div><h2>Precisa de acolhimento</h2><p>Dados buscados na ficha ${escapeHtml(coupleStudentTitle)}, por casal.</p></div></div>${smpAcolhimentoRows(smpAcolhimentoCouples)}`,
    quadrante: `<div class="panel-heading"><div><h2>Quadrante(s) impresso</h2><p>Inscrições da equipe que responderam Sim. Casais aparecem juntos e contam como uma ficha.</p></div></div>${preferenceRows(quadranteRows, 'Nenhuma inscrição solicitou quadrante impresso.')}`,
    photo: `<div class="panel-heading"><div><h2>Fotos solicitadas</h2><p>Inscrições da equipe que pediram foto. Casais aparecem juntos e contam como uma foto.</p></div></div>${preferenceRows(photoRows, 'Nenhuma inscrição solicitou foto.')}`,
    kids: `<div class="panel-heading"><div><h2>Crianças no Espaço Kids</h2><p>Nome da criança, idade e responsável pelo cadastro.</p></div></div>${kidsRows(kidsCareSummary.children)}`,
    'kids-intolerance': `<div class="panel-heading"><div><h2>Crianças com intolerância alimentar</h2><p>Crianças informadas pela Equipe de Trabalho e nas fichas de cursistas do retiro em foco.</p></div></div>${kidsCareRows(kidsCareSummary.intolerance, 'Não detalhado', 'Nenhuma criança com intolerância alimentar informada.')}`,
    'kids-health': `<div class="panel-heading"><div><h2>Crianças com problema de saúde</h2><p>Crianças informadas pela Equipe de Trabalho e nas fichas de cursistas do retiro em foco.</p></div></div>${kidsCareRows(kidsCareSummary.health, 'Não detalhado', 'Nenhuma criança com problema de saúde informada.')}`,
    cities: `<div class="panel-heading"><div><h2>Cidades com participantes</h2><p>Quantidade de pessoas por cidade, separando cursistas e equipe de trabalho.</p></div></div>${cityRowsHtml(cityRows)}`,
    birthdays: `<div class="panel-heading"><div><h2>Aniversariantes do mês</h2><p>Comunidade, nome do cursista e data de nascimento.</p></div></div>${birthdayRowsHtml(birthdayStudents)}`,
    'team-birthdays': `<div class="panel-heading"><div><h2>Aniversariantes do mês</h2><p>Nome completo, setor da equipe de trabalho e data de nascimento.</p></div></div>${teamBirthdayRowsHtml(teamBirthdayRows)}`,
  };
  app.querySelectorAll('[data-home-health]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.homeHealth;
      openHomeInfoWindow(button.closest('.student-health-card')?.querySelector('span')?.textContent || 'Cursistas', healthContent[key] || '');
    });
  });
  wireSectorStatWindows(sectorStatRows);
  wireParticipationGroupStatWindows(participationGroupStatRows);
}

async function renderRetiros() {
  const retreat = selectedRetreat();
  if (retreat) return renderRetreat(retreat.id);
  layout('<section class="page-heading"><div><p class="eyebrow">Links de cadastro da equipe de trabalho por setor</p><h1>Nenhum retiro em foco</h1><p>Selecione um retiro na tela Início para visualizar seus links por setor.</p></div><div class="detail-actions"><a class="secondary-button" href="#inicio">Ir para Início</a></div></section>', 'retiros');
}

const sectorOptionHtml = (sector, selected = false) => `<div class="sector-option" data-sector-option="${escapeHtml(sector)}"><label><input type="checkbox" name="setores" value="${escapeHtml(sector)}" ${selected ? 'checked' : ''}> <span data-sector-name>${escapeHtml(sector)}</span></label></div>`;

function sectorGroups(sectors, selectedSectors = sectors, publicSectors = sectors, closedSectors = []) {
  const selected = new Set(selectedSectors.map(normalizeText));
  const group = (area, title) => `<section class="sector-area"><h3>${title}</h3><div class="sector-checks" data-area="${area}">${sortSectors(sectors.filter((sector) => sectorArea(sector) === area)).map((sector) => sectorOptionHtml(sector, selected.has(normalizeText(sector)))).join('')}</div></section>`;
  return `${group('escondida', 'Equipe escondida')}${group('sala', 'Equipe Sala')}`;
}

function applyRetreatConfigLayout(form) {
  if (!form || form.classList.contains('retreat-config-form')) return;
  const fields = form.querySelector(':scope > .fields.two-columns');
  const valueFields = fields?.querySelector('.retreat-value-fields');
  const sectorFieldset = form.querySelector(':scope > fieldset');
  if (!fields || !valueFields || !sectorFieldset) return;

  form.classList.remove('panel');
  form.classList.add('retreat-config-form');
  fields.classList.add('retreat-event-fields');
  valueFields.classList.remove('full');

  const eventPanel = document.createElement('section');
  eventPanel.className = 'retreat-config-panel';
  eventPanel.innerHTML = '<h2><span class="retreat-config-icon" aria-hidden="true">▣</span> Dados do evento</h2>';
  form.insertBefore(eventPanel, fields);
  eventPanel.append(fields);

  const valuePanel = document.createElement('section');
  valuePanel.className = 'retreat-config-panel';
  valuePanel.innerHTML = '<h2><span class="retreat-config-icon" aria-hidden="true">◇</span> Valores e regras</h2>';
  form.insertBefore(valuePanel, sectorFieldset);
  valuePanel.append(valueFields);

  sectorFieldset.classList.add('retreat-config-panel', 'retreat-sector-panel');
  const legend = sectorFieldset.querySelector('legend');
  if (legend) legend.innerHTML = '<span class="retreat-config-icon" aria-hidden="true">♙</span> Setores de trabalho';
  sectorFieldset.querySelector('.hint')?.remove();
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
  return sectorGroups(sectors, selected, configuredSectors(retreat?.setoresPublicos ?? selected), retreat?.setoresInscricoesEncerradas || []);
}

function wirePublicSectorToggles(form) {
  const syncClosedOptions = () => {
    form.querySelectorAll('.sector-option').forEach((option) => {
      const sectorInput = option.querySelector('input[name="setores"]');
      const closedInput = option.querySelector('input[name="setoresInscricoesEncerradas"]');
      if (!sectorInput || !closedInput) return;
      closedInput.disabled = !sectorInput.checked;
      if (!sectorInput.checked) closedInput.checked = false;
    });
  };
  syncClosedOptions();
  form.addEventListener('change', (event) => {
    if (event.target?.name === 'setores') syncClosedOptions();
  });
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

async function renderNewRetreat(returnHash = '#configuracoes') {
  layout(`<section class="page-heading compact"><div><p class="eyebrow">Novo evento</p><h1>Criar retiro</h1><p>Os voluntários começam sempre vazios. Você só pode reaproveitar a estrutura.</p></div><a class="text-link" href="${escapeHtml(returnHash)}">← Voltar</a></section>
  <form id="retreat-form" class="panel editor-form"><div class="fields two-columns"><label class="field full"><span>Nome do retiro <b>*</b></span><input name="nome" required placeholder="Ex.: Retiro de Casais 2027"></label><label class="field"><span>Data de início</span><input name="dataInicio" type="text" inputmode="numeric" placeholder="dd/mm/aaaa"></label><label class="field"><span>Data de término</span><input name="dataTermino" type="text" inputmode="numeric" placeholder="dd/mm/aaaa"></label><label class="field"><span>Local</span><input name="local" placeholder="Ex.: Casa de Retiros"></label><label class="field"><span>Tipo do retiro <b>*</b></span><select name="tipoRetiro" required>${retreatTypeOptions()}</select></label><label class="field full"><span>Ficha cursista para esse retiro.</span><select name="tipoFichaCursista">${studentFormTypeOptions()}</select></label><div class="fields three-columns retreat-value-fields full"><label class="field"><span>Inscrição do cursista</span><input name="valorInscricaoCursista" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Inscrição do voluntário</span><input name="valorInscricaoVoluntario" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Valor da foto</span><input name="valorFoto" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Idade máxima para ficar no Espaço Kids</span><input name="idadeMaximaEspacoKids" type="number" min="0" step="1" inputmode="numeric" placeholder="Ex.: 10"></label><label class="field"><span>Número previsto de fichas de cursista</span><input name="numeroPrevistoFichasCursista" type="number" min="0" step="1" inputmode="numeric" placeholder="Ex.: 80"></label></div></div>
  <fieldset><legend>Setores de trabalho</legend><p class="hint">Selecione os setores que ter&atilde;o link de inscri&ccedil;&atilde;o por setor neste retiro.</p><div class="sector-groups" id="sector-checks">${sectorGroups(knownSectors(), [], [])}</div></fieldset><div class="form-actions"><p>O retiro ficará salvo como <b>Em preparação</b>.</p><button type="submit">Criar retiro <span>→</span></button></div></form>`, 'configuracoes');
  const form = app.querySelector('#retreat-form');
  let sourceRetreatId = '';
  wireTypedDates(form, namedFieldSelector(['dataInicio', 'dataTermino']));
  ensureOfficialShirtValueField(form);
  wireCurrencyInputs(form);
  wirePublicSectorToggles(form);
  const applySourceRetreat = (source = null) => {
    sourceRetreatId = source?.id || '';
    form.reset();
    form.elements.nome.value = source?.nome || '';
    form.elements.dataInicio.value = formatDateInput(source?.dataInicio) || source?.dataInicio || '';
    form.elements.dataTermino.value = formatDateInput(source?.dataTermino) || source?.dataTermino || '';
    form.elements.local.value = source?.local || '';
    form.elements.tipoRetiro.value = source?.tipoRetiro || '';
    form.elements.valorInscricaoCursista.value = source ? currency(source.valorInscricaoCursista) : '';
    form.elements.valorInscricaoVoluntario.value = source ? currency(source.valorInscricaoVoluntario) : '';
    form.elements.valorFoto.value = source ? currency(source.valorFoto ?? 10) : '';
    form.elements.valorCamisetaOficial.value = source ? currency(source.valorCamisetaOficial) : '';
    form.elements.idadeMaximaEspacoKids.value = source?.idadeMaximaEspacoKids ?? '';
    form.elements.numeroPrevistoFichasCursista.value = source?.numeroPrevistoFichasCursista ?? '';
    form.elements.tipoFichaCursista.value = source?.tipoFichaCursista || defaultStudentFormType;
    app.querySelector('#sector-checks').innerHTML = source
      ? sectorGroups(knownSectors(source.setores), configuredSectors(source.setores), configuredSectors(source.setoresPublicos ?? source.setores), source.setoresInscricoesEncerradas || [])
      : sectorGroups(knownSectors(), [], []);
    wirePublicSectorToggles(form);
  };
  const openStructureChoice = () => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    const closeToList = () => { overlay.remove(); location.hash = returnHash; };
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
    const values = new FormData(form);
    const rawDataInicio = String(values.get('dataInicio') || '').trim();
    const rawDataTermino = String(values.get('dataTermino') || '').trim();
    const dataInicio = normalizeDateInput(rawDataInicio);
    const dataTermino = normalizeDateInput(rawDataTermino);
    const invalidDateInput = [
      [form.elements.dataInicio, rawDataInicio, dataInicio],
      [form.elements.dataTermino, rawDataTermino, dataTermino],
    ].find(([, raw, normalized]) => raw && !normalized)?.[0];
    if (invalidDateInput) {
      invalidDateInput.setCustomValidity('Digite uma data válida no formato dd/mm/aaaa.');
      form.reportValidity();
      invalidDateInput.focus();
      return;
    }
    values.set('dataInicio', dataInicio);
    values.set('dataTermino', dataTermino);
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Salvando...';
    try {
      const selectedSectors = values.getAll('setores');
      if (!selectedSectors.length) { alert('Selecione ao menos um setor de trabalho.'); submitButton.disabled = false; submitButton.innerHTML = 'Criar retiro <span>→</span>'; return; }
      if (dataInicio && dataTermino && dataTermino < dataInicio) { alert('A data de término deve ser igual ou posterior à data de início.'); submitButton.disabled = false; submitButton.innerHTML = 'Criar retiro <span>→</span>'; return; }
      const serviceDays = retreatDaysFromDates(dataInicio, dataTermino);
      const sortedSectors = sortSectors(selectedSectors);
      const closedKeys = new Set(values.getAll('setoresInscricoesEncerradas').map(normalizeText));
      const setoresInscricoesEncerradas = sortedSectors.filter((sector) => closedKeys.has(normalizeText(sector)));
      const retreat = { id: createId(), nome: values.get('nome').trim(), tipoRetiro: values.get('tipoRetiro'), dataInicio, dataTermino, local: values.get('local').trim(), tipoFichaCursista: values.get('tipoFichaCursista') || defaultStudentFormType, valorInscricaoCursista: parseCurrency(values.get('valorInscricaoCursista')), valorInscricaoVoluntario: parseCurrency(values.get('valorInscricaoVoluntario')), valorFoto: parseCurrency(values.get('valorFoto')), valorCamisetaOficial: parseCurrency(values.get('valorCamisetaOficial')), idadeMaximaEspacoKids: Number(values.get('idadeMaximaEspacoKids')) || 0, numeroPrevistoFichasCursista: normalizeExpectedStudentFileCount(values.get('numeroPrevistoFichasCursista')), setores: sortedSectors, setoresPublicos: sortedSectors, setoresInscricoesEncerradas, dias: serviceDays.length ? serviceDays : [...retreatDefaults.dias], contribuicoes: [...retreatDefaults.contribuicoes], linksSetores: syncSectorLinks({ linksSetores: setoresInscricoesEncerradas.map((setor) => ({ setor, inscricoesEncerradas: true })) }, knownSectors(sortedSectors)), versaoFormatoLinksEquipe: teamSectorLinkFormatVersion, status: 'preparacao', createdAt: new Date().toISOString() };
      await dataService.saveRetiro(retreat);
      if (sourceRetreatId) await copyBadgeProfilesToRetreat(sourceRetreatId, retreat.id);
      await loadData();
      alert(`Retiro "${retreat.nome}" criado. Para colocá-lo em foco, selecione-o na tela Início.`);
      location.hash = returnHash;
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

async function renderRetreat(id, selectedSector = '') {
  const retreat = retreats.find((item) => item.id === id);
  if (!retreat) return renderRetiros();
  if (!ensureRetreatAccess(retreat)) return;
  const retreatStudentFormType = retreat.tipoFichaCursista || defaultStudentFormType;
  const usesCoupleStudentForm = ['cursista-smp', 'cursista-epc'].includes(retreatStudentFormType);
  const [allStudents, allCommunities, studentLinkData, coupleStudents] = await Promise.all([
    dataService.listCursistas(id),
    dataService.listComunidades(id),
    dataService.syncStudentRegistrationLinks(id).catch((error) => ({ error: error.message || 'Não foi possível carregar os links.' })),
    usesCoupleStudentForm ? coupleStudentSource(retreatStudentFormType).list(id).catch((error) => {
      console.error(error);
      return [];
    }) : Promise.resolve([]),
  ]);
  const registeredStudents = uniqueByParticipant(allStudents.filter((student) => student.retiroId === id));
  const retreatCommunities = allCommunities.filter((community) => community.retiroId === id);
  const retreatCommunityDetails = studentCommunityDetails(retreatCommunities);
  const retreatCoupleCommunityDetails = coupleCommunityDetails(retreatCommunities, retreatStudentFormType);
  const retreatStudentPresenceCount = studentPresenceCount(retreatStudentFormType, registeredStudents, coupleStudents);
  const retreatEntries = enrolments.filter((item) => item.retiroId === id);
  const retreatEnrolments = mergeEnrolmentsByParticipant(enrolments.filter((item) => item.retiroId === id));
  const retreatStatEntries = retreatEntries.length ? retreatEntries : retreatEnrolments;
  const storedSectorLinks = retreat.linksSetores || retreat.setorLinks || [];
  const sectorLinks = syncSectorLinks({ linksSetores: storedSectorLinks }, retreat.setores || [])
    .filter((link) => storedSectorLinks.some((stored) => normalizeText(stored.setor || stored.sector) === normalizeText(link.setor)));
  const activeSectorKeys = new Set((retreat.setores || []).map(normalizeText));
  const activeSectorLinks = sectorLinks.filter((link) => activeSectorKeys.has(normalizeText(link.setor)));
  const configuredRetreatSectors = sortSectors(retreat.setores || []);
  const serviceDays = retreatServiceDays(retreat);
  const participantPeople = retreatEnrolments.map((entry) => people.find((person) => person.id === entry.pessoaId)).filter(Boolean);
  const ages = [...participantPeople, ...registeredStudents].map((person) => ageFromBirth(person.nascimento)).filter((age) => age !== null);
  const averageAge = ages.length ? `${(ages.reduce((sum, age) => sum + age, 0) / ages.length).toFixed(1).replace('.', ',')} anos` : 'Sem dados';
  const dayCount = (day) => retreatStatEntries.filter((entry) => entryDays(entry).some((item) => normalizeText(item) === normalizeText(day))).length + retreatStudentPresenceCount + retreatKidsSummary.children.length;
  const shirtCounts = registeredStudents.reduce((counts, student) => { const size = String(student.camiseta || '').trim(); if (size) counts[size] = (counts[size] || 0) + 1; return counts; }, {});
  const shirtOrder = ['8', '10', '12', '14', '16', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'];
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
  const continuousMedicationStudents = registeredStudents
    .filter((student) => normalizeText(student.medicamentoContinuo) === 'sim')
    .sort((first, second) => {
      const firstCommunity = studentCommunityDetail(first, retreatCommunityDetails);
      const secondCommunity = studentCommunityDetail(second, retreatCommunityDetails);
      if (firstCommunity.order !== secondCommunity.order) return firstCommunity.order - secondCommunity.order;
      const communityResult = firstCommunity.name.localeCompare(secondCommunity.name, 'pt-BR', { sensitivity: 'base' });
      if (communityResult) return communityResult;
      return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
    });
  const parentSuggestedMedicationStudents = registeredStudents
    .filter((student) => String(student.medicamentoCabeca || '').trim() || String(student.medicamentoEstomago || '').trim())
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
  const spaceKidsRows = spaceKidsRowsForEnrolments(retreatEnrolments, peopleById);
  const retreatKidsSummary = buildKidsCareSummary({
    teamKids: spaceKidsRows,
    coupleStudents: coupleStudents.map((record) => ({
      ...record,
      kidsCommunity: coupleCommunityDetail(record, retreatCoupleCommunityDetails).name,
    })),
    studentFormType: retreatStudentFormType,
    retreatId: id,
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
  const parentSuggestedMedicationRows = (students, communityDetails) => students.length ? `<div class="student-health-list">${students.map((student) => {
    const community = studentCommunityDetail(student, communityDetails);
    const headacheMedication = String(student.medicamentoCabeca || '').trim();
    const stomachMedication = String(student.medicamentoEstomago || '').trim();
    const details = [
      headacheMedication ? `Dor de cabeça: ${headacheMedication}` : '',
      stomachMedication ? `Dor no estômago: ${stomachMedication}` : '',
    ].filter(Boolean).join(' · ');
    return `<div><div class="student-health-person"><strong>${escapeHtml(student.nome || 'Sem nome')}</strong><small>Comunidade: ${escapeHtml(community.name)}</small></div><span>${escapeHtml(details || 'Medicamento não detalhado')}</span></div>`;
  }).join('')}</div>` : '<p class="empty-state">Nenhum cursista informado.</p>';
  const preferenceRows = (rows, fallback) => rows.length ? `<div class="student-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.detail)}</span></div>`).join('')}</div>` : `<p class="empty-state">${fallback}</p>`;
  const kidsRows = (rows) => rows.length ? `<div class="student-health-list kids-health-list">${rows.map((kid) => `<div><strong>${escapeHtml(kid.nome || 'Sem nome')}<span class="student-health-inline">${escapeHtml(ageInYearsAndMonths(kid.nascimento))}</span></strong><small>Responsável: ${escapeHtml(kid.responsible || kid.volunteer || 'Não informado')}${kid.contact ? ` · Contato: ${escapeHtml(kid.contact)}` : ''}</small><small>Origem: ${escapeHtml(kid.origin || 'Equipe de trabalho')} · ${escapeHtml(kid.contextLabel || 'Setor de trabalho')}: ${escapeHtml(kid.contextValue || (Array.isArray(kid.sectors) && kid.sectors.length ? kid.sectors.join(', ') : 'Não informado'))}</small></div>`).join('')}</div>` : '<p class="empty-state">Nenhuma criança cadastrada no Espaço Kids.</p>';
  const cityRowsHtml = (rows) => {
    if (!rows.length) return '<p class="empty-state">Nenhuma cidade informada nos cadastros deste retiro.</p>';
    const totals = rows.reduce((sum, row) => ({ students: sum.students + row.students, team: sum.team + row.team }), { students: 0, team: 0 });
    return `<div class="student-health-list city-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.city)}</strong><span><b>${row.students}</b><small>Cursistas</small></span><span><b>${row.team}</b><small>Equipe de trabalho</small></span></div>`).join('')}<div class="city-health-total"><strong>Total geral</strong><span><b>${totals.students}</b><small>Cursistas</small></span><span><b>${totals.team}</b><small>Equipe de trabalho</small></span><span><b>${totals.students + totals.team}</b><small>Participantes</small></span></div></div>`;
  };
  const retreatStatisticsHtml = `<section class="metric-grid dashboard-metrics">
      <article class="metric-card static-metric"><span>Cursistas</span><strong>${retreatStudentPresenceCount}</strong><small>pessoa(s)</small></article>
      <article class="metric-card static-metric"><span>Equipe de trabalho</span><strong>${retreatEnrolments.length}</strong><small>pessoa(s)</small></article>
      <article class="metric-card static-metric"><span>Fichas da equipe de trabalho aguardando validação</span><strong>${pendingValidationGroups.length}</strong><small>ficha(s)</small></article>
    </section>
    <section class="student-health-grid" aria-label="Cuidados de saúde dos cursistas">
      <article class="student-health-card"><div><span>Cursistas com Intolerância a alimentos</span><strong>${intoleranceStudents.length}</strong></div><button type="button" data-home-health="intolerance">Visualizar</button></article>
      <article class="student-health-card"><div><span>Cursistas Alérgicos a Medicamentos</span><strong>${allergyStudents.length}</strong></div><button type="button" data-home-health="allergy">Visualizar</button></article>
      <article class="student-health-card"><div><span>Cursista(s) com medicamento contínuo</span><strong>${continuousMedicationStudents.length}</strong></div><button type="button" data-home-health="continuous-medication">Visualizar</button></article>
      <article class="student-health-card"><div><span>Cursistas com remédios sugerido pelos pais</span><strong>${parentSuggestedMedicationStudents.length}</strong></div><button type="button" data-home-health="parent-suggested-medication">Visualizar</button></article>
      <article class="student-health-card"><div><span>Quadrante impresso Equipe de trabalho</span><strong>${quadranteRows.length}</strong></div><button type="button" data-home-health="quadrante">Visualizar</button></article>
      <article class="student-health-card"><div><span>Fotos solicitadas pela equipe de trabalho</span><strong>${photoRows.length}</strong></div><button type="button" data-home-health="photo">Visualizar</button></article>
      <article class="student-health-card"><div><span>Número de crianças no Espaço Kids</span><strong>${retreatKidsSummary.children.length}</strong></div><button type="button" data-home-health="kids">Visualizar</button></article>
      <article class="student-health-card"><div><span>Número de cidades com participantes</span><strong>${cityRows.length}</strong></div><button type="button" data-home-health="cities">Visualizar</button></article>
    </section>
    <section class="dashboard-grid retreat-stats-grid">
      <article class="panel dashboard-panel shirt-stat-panel"><div class="panel-heading"><div><h2>Camisetas dos cursistas</h2><p>Quantidade por tamanho informado na ficha do cursista.</p></div></div><div class="stat-tile-grid shirt-stat-grid">${shirtGrid}</div></article>
      <article class="panel dashboard-panel presence-stat-panel"><div class="panel-heading"><div><h2>Presença por dia</h2><p>Equipe de trabalho + Cursistas + Crianças Kids.</p></div></div><div class="stat-tile-grid presence-stat-grid">${dayRows}</div></article>
      <article class="panel dashboard-panel sector-stat-panel"><div class="panel-heading"><div><h2>Pessoas por setor</h2><p>Equipe de trabalho inscrita por setor.</p></div></div><div class="sector-simple-list">${sectorRows}</div></article>
    </section>`;
  const healthContent = {
    intolerance: `<div class="panel-heading"><div><h2>Cursistas com Intolerância a alimentos</h2><p>Comunidade, nome do cursista e alimento informado na ficha.</p></div></div>${healthRows(intoleranceStudents, 'qualIntolerancia', 'Intolerância não detalhada', { showCommunity: true, communityDetails: retreatCommunityDetails })}`,
    allergy: `<div class="panel-heading"><div><h2>Cursistas Alérgicos a Medicamentos</h2><p>Comunidade, nome do cursista e medicamento informado na ficha.</p></div></div>${healthRows(allergyStudents, 'qualAlergia', 'Medicamento não detalhado', { showCommunity: true, communityDetails: retreatCommunityDetails })}`,
    'continuous-medication': `<div class="panel-heading"><div><h2>Cursista(s) com medicamento contínuo</h2><p>Comunidade, nome do cursista e medicamento informado na ficha.</p></div></div>${healthRows(continuousMedicationStudents, 'qualMedicamentoContinuo', 'Medicamento não detalhado', { showCommunity: true, communityDetails: retreatCommunityDetails })}`,
    'parent-suggested-medication': `<div class="panel-heading"><div><h2>Cursistas com remédios sugerido pelos pais</h2><p>Comunidade, nome do cursista e remédios sugeridos pelos pais na ficha.</p></div></div>${parentSuggestedMedicationRows(parentSuggestedMedicationStudents, retreatCommunityDetails)}`,
    quadrante: `<div class="panel-heading"><div><h2>Quadrante impresso Equipe de trabalho</h2><p>Inscrições da equipe que responderam Sim. Casais aparecem juntos e contam como uma ficha.</p></div></div>${preferenceRows(quadranteRows, 'Nenhuma inscrição solicitou quadrante impresso.')}`,
    photo: `<div class="panel-heading"><div><h2>Fotos solicitadas pela equipe de trabalho</h2><p>Inscrições da equipe que pediram foto. Casais aparecem juntos e contam como uma foto.</p></div></div>${preferenceRows(photoRows, 'Nenhuma inscrição solicitou foto.')}`,
    kids: `<div class="panel-heading"><div><h2>Número de crianças no Espaço Kids</h2><p>Nome da criança, idade e responsável pelo cadastro.</p></div></div>${kidsRows(retreatKidsSummary.children)}`,
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
  const focusedRetreat = selectedRetreat();
  const focusReturnLink = focusedRetreat?.id !== retreat.id ? '<a class="back-link" href="#retiros">← Retiro em foco</a>' : '';
  layout(`<section class="page-heading compact"><div>${focusReturnLink}<p class="eyebrow">${statusLabel(retreat.status)}</p><h1>${escapeHtml(retreat.nome)}</h1><p>${dateRange(retreat.dataInicio, retreat.dataTermino)}${retreat.local ? ` · ${escapeHtml(retreat.local)}` : ''}</p>${concluded ? '<p class="hint">Retiro concluído: alterações bloqueadas. Consultas, relatórios e impressões continuam disponíveis.</p>' : ''}</div></section>
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
  if (activeSectorLinks.length || configuredRetreatSectors.length) {
    const sectorLinksPanel = document.createElement('article');
    sectorLinksPanel.className = 'panel sector-links-panel';
    sectorLinksPanel.id = 'retreat-links';
    sectorLinksPanel.innerHTML = `<div class="sector-link-panel-heading"><div class="sector-links-heading"><div class="sector-links-title"><h2>Links de cadastro da equipe de trabalho por setor</h2><div class="sector-links-help"><button type="button" class="sector-links-info" id="sector-links-info" aria-label="Informações sobre os links de cadastro da equipe por setor" aria-expanded="false" aria-controls="sector-links-explanation"><img src="/assets/info-icon.png?v=20260806-legivel" alt="" aria-hidden="true"></button><div class="sector-links-explanation" id="sector-links-explanation" role="note" hidden><ul><li>O link “Cadastro” abre somente a ficha limitada ao setor. Esse link deve ser encaminhado ao coordenador do setor para cadastro da sua equipe.</li><li>O link “Acompanhamento do líder” mostra ao coordenador do setor a relação de voluntários, os dias de trabalho e o somatório por dia.</li><li>O link “Acompanhamento do líder” do setor Animação/Jovem de sala visualiza também cursistas com intolerância alimentar. O link “Acompanhamento do líder” do setor Cozinha visualiza também cursistas e crianças do Espaço Kids com intolerância alimentar.</li><li>O link “Acompanhamento do líder” do setor Espaço Kids visualiza também crianças com intolerância alimentar e problema de saúde.</li></ul></div></div></div></div><button type="button" class="secondary-button sector-link-view-status" id="view-sector-link-status">Visualizar</button></div><div class="field sector-link-search"><span>Buscar setor ativo</span><input id="sector-link-search" type="search" autocomplete="off" aria-controls="sector-link-menu" aria-expanded="false" placeholder="Digite o nome do setor"><div class="sector-link-menu" id="sector-link-menu" hidden>${activeSectorLinks.map((link) => {
      const { registrationUrl, followupUrl } = teamSectorPublicUrls(retreat, link, location.origin);
      return `<article class="sector-link-menu-item" data-sector-link-row="${escapeHtml(link.setor)}"><button type="button" class="sector-link-choice" data-sector-link-select="${escapeHtml(link.setor)}" data-registration-url="${escapeHtml(registrationUrl)}" data-followup-url="${escapeHtml(followupUrl)}" data-registration-closed="${sectorRegistrationClosed(retreat, link.setor) ? 'true' : 'false'}"><strong>${escapeHtml(link.setor)}</strong><span>Selecionar</span></button></article>`;
    }).join('')}<p class="sector-link-empty" hidden>Nenhum setor ativo encontrado.</p></div></div><p class="sector-link-feedback student-registration-link-search-feedback" id="sector-link-feedback" role="status">Selecione um setor para visualizar os links.</p><div class="sector-link-selected" id="sector-link-selected"></div>`;
    app.querySelector('.detail-grid')?.append(sectorLinksPanel);
    const sectorLinksInfoButton = sectorLinksPanel.querySelector('#sector-links-info');
    const sectorLinksExplanation = sectorLinksPanel.querySelector('#sector-links-explanation');
    const sectorLinksHelp = sectorLinksPanel.querySelector('.sector-links-help');
    const setSectorLinksExplanationOpen = (open, { restoreFocus = false } = {}) => {
      sectorLinksInfoButton.setAttribute('aria-expanded', String(open));
      sectorLinksExplanation.hidden = !open;
      if (open) {
        document.addEventListener('pointerdown', closeSectorLinksExplanationFromOutside);
        document.addEventListener('keydown', closeSectorLinksExplanationFromKeyboard);
      } else {
        document.removeEventListener('pointerdown', closeSectorLinksExplanationFromOutside);
        document.removeEventListener('keydown', closeSectorLinksExplanationFromKeyboard);
        if (restoreFocus) sectorLinksInfoButton.focus();
      }
    };
    function closeSectorLinksExplanationFromOutside(event) {
      if (!sectorLinksHelp.contains(event.target)) setSectorLinksExplanationOpen(false);
    }
    function closeSectorLinksExplanationFromKeyboard(event) {
      if (event.key === 'Escape') setSectorLinksExplanationOpen(false, { restoreFocus: true });
    }
    sectorLinksInfoButton.addEventListener('click', () => {
      setSectorLinksExplanationOpen(sectorLinksInfoButton.getAttribute('aria-expanded') !== 'true');
    });
  }
  const studentRegistrationLinksPanel = document.createElement('article');
  studentRegistrationLinksPanel.className = 'panel student-registration-links-panel';
  studentRegistrationLinksPanel.id = 'retreat-student-links';
  const studentLinks = Array.isArray(studentLinkData?.links) ? studentLinkData.links : [];
  const internalStudentSection = studentFormNavIds[retreat.tipoFichaCursista] || 'cursista';
  const canEditStudentLinkRecipient = canAccess('links-cadastro.editar') && canModifyRetreat(retreat);
  const studentLinkSearchOptionLabel = (link) => {
    return `${link.nomeCadastrado || ''} ${link.enviadoPara || ''}`.trim();
  };
  const studentLinksContent = studentLinkData?.error
    ? `<p class="empty-state">${escapeHtml(studentLinkData.error)}</p>`
    : studentLinks.length
      ? `<div class="student-registration-link-search-shell"><div class="student-registration-link-search-control"><label class="field student-registration-link-search"><span>Buscar ficha</span><input id="student-registration-link-search" type="search" inputmode="numeric" autocomplete="off" aria-controls="student-registration-link-options" aria-expanded="false" aria-autocomplete="list" aria-describedby="student-registration-link-search-feedback" placeholder="Digite o número da ficha"></label><div id="student-registration-link-options" class="student-registration-link-options" role="listbox" hidden>${studentLinks.map((link) => { const optionLabel = studentLinkSearchOptionLabel(link); return `<button type="button" role="option" data-student-link-option="${escapeHtml(link.numeroFicha)}" data-student-link-option-search="${escapeHtml(normalizeText(`${link.numeroFicha} ${optionLabel}`))}"><strong>Ficha ${escapeHtml(link.numeroFicha)}</strong><span data-student-link-option-student><b>Cursista</b> ${escapeHtml(link.nomeCadastrado || '')}</span><span data-student-link-option-recipient><b>Enviado para</b> ${escapeHtml(link.enviadoPara || '')}</span></button>`; }).join('')}<p class="student-registration-link-option-empty" hidden>Nenhuma ficha encontrada.</p></div></div><p id="student-registration-link-search-feedback" class="student-registration-link-search-feedback" role="status">Selecione uma ficha para visualizar seus dados.</p></div><div class="student-registration-link-list" id="student-registration-link-list">${studentLinks.map((link) => {
        const publicUrl = `${location.origin}/cadastro-cursista/ficha${link.numeroFicha}/${encodeURIComponent(link.token)}`;
        const registered = link.status === 'cadastrada';
        const closed = link.inscricaoEncerrada === true;
        return `<article class="student-registration-link-row" data-student-link-row="${link.numeroFicha}" data-student-link-registered="${registered ? 'true' : 'false'}" hidden>
          <div class="student-registration-link-heading"><div class="student-registration-link-title"><div class="student-registration-link-number"><strong>Ficha ${link.numeroFicha}</strong>${registered ? '' : `<span class="student-registration-link-status-note ${closed ? 'is-closed' : 'is-available'}" data-student-link-status="${link.numeroFicha}">${closed ? 'Encerrada' : 'Disponível'}</span>`}</div><a class="secondary-button student-registration-link-open" href="#${internalStudentSection}?ficha=${link.numeroFicha}" aria-label="Abrir ficha ${link.numeroFicha} na opção de cursistas">Abrir</a><label class="student-registration-link-closed"><input type="checkbox" data-student-link-closed="${link.numeroFicha}" ${closed ? 'checked' : ''} ${canEditStudentLinkRecipient ? '' : 'disabled'}><span>Inscrição encerrada</span></label></div></div>
          <span class="student-registration-link-closed-feedback" data-student-link-closed-feedback="${link.numeroFicha}" role="status"></span>
          <div class="student-registration-link-url"><label class="field"><span class="sr-only">Endereço público da ficha ${link.numeroFicha}</span><input value="${escapeHtml(publicUrl)}" readonly aria-label="Link público da ficha ${link.numeroFicha}"></label><button type="button" class="secondary-button" data-copy-student-link="${escapeHtml(publicUrl)}">Copiar link</button></div>
          <div class="student-registration-link-recipient"><label class="field"><span>Enviado para</span><input maxlength="160" autocomplete="off" value="${escapeHtml(link.enviadoPara || '')}" data-student-link-recipient="${link.numeroFicha}" ${canEditStudentLinkRecipient ? '' : 'readonly'} aria-label="Enviado para, ficha ${link.numeroFicha}"></label>${canEditStudentLinkRecipient ? `<button type="button" class="secondary-button" data-save-student-link-recipient="${link.numeroFicha}">Salvar</button>` : ''}<span class="student-registration-link-feedback" data-student-link-recipient-feedback="${link.numeroFicha}" role="status"></span></div>
          ${registered && link.nomeCadastrado ? `<p class="student-registration-link-registration"><strong>${link.tipoCadastro === 'casal' ? 'Casal cadastrado' : 'Cursista cadastrado'}:</strong> ${escapeHtml(link.nomeCadastrado)}</p>` : ''}
        </article>`;
      }).join('')}</div>`
      : '<p class="empty-state">Configure o Número previsto de fichas de cursista para gerar os links públicos.</p>';
  studentRegistrationLinksPanel.innerHTML = `<div class="sector-link-panel-heading"><div class="student-registration-links-heading"><div class="student-registration-links-title"><h2>Links de cadastro de cursistas</h2><div class="student-registration-links-help"><button type="button" class="student-registration-links-info" id="student-registration-links-info" aria-label="Informações sobre os links de cadastro de cursistas" aria-expanded="false" aria-controls="student-registration-links-explanation"><img src="/assets/info-icon.png?v=20260806-legivel" alt="" aria-hidden="true"></button><div class="student-registration-links-explanation" id="student-registration-links-explanation" role="note" hidden><ul><li>Esses links têm o objetivo de compartilhar o acesso a uma ficha específica do cadastro de cursista deste retiro.</li><li>Essa mesma ficha também poderá ser preenchida internamente pelo sistema. Nesse caso, o link perderá a funcionalidade.</li><li>Se uma ficha for cadastrada e posteriormente excluída, o link voltará a permitir o acesso a essa ficha.</li><li>Se o campo “Inscrições encerradas” for selecionado, o link perderá a funcionalidade.</li><li>O acesso ao cadastro pelo link somente salva a ficha. Caso seja necessário fazer algum ajuste, ele deverá ser realizado no sistema pelo coordenador, mediante login e senha.</li><li>O acesso ao cadastro pelo link não exibe o botão “Resumo financeiro” nem permite cadastrar pagamentos. Essas informações deverão ser inseridas pelo coordenador.</li></ul></div></div></div></div><button type="button" class="secondary-button" id="view-student-link-status">Visualizar</button></div>${studentLinksContent}`;
  app.querySelector('.detail-grid')?.append(studentRegistrationLinksPanel);
  const studentLinksInfoButton = studentRegistrationLinksPanel.querySelector('#student-registration-links-info');
  const studentLinksExplanation = studentRegistrationLinksPanel.querySelector('#student-registration-links-explanation');
  const studentLinksHelp = studentRegistrationLinksPanel.querySelector('.student-registration-links-help');
  const setStudentLinksExplanationOpen = (open, { restoreFocus = false } = {}) => {
    if (!studentLinksInfoButton || !studentLinksExplanation) return;
    studentLinksInfoButton.setAttribute('aria-expanded', String(open));
    studentLinksExplanation.hidden = !open;
    if (open) {
      document.addEventListener('pointerdown', closeStudentLinksExplanationFromOutside);
      document.addEventListener('keydown', closeStudentLinksExplanationFromKeyboard);
    } else {
      document.removeEventListener('pointerdown', closeStudentLinksExplanationFromOutside);
      document.removeEventListener('keydown', closeStudentLinksExplanationFromKeyboard);
      if (restoreFocus) studentLinksInfoButton.focus();
    }
  };
  function closeStudentLinksExplanationFromOutside(event) {
    if (!studentLinksHelp?.contains(event.target)) setStudentLinksExplanationOpen(false);
  }
  function closeStudentLinksExplanationFromKeyboard(event) {
    if (event.key === 'Escape') setStudentLinksExplanationOpen(false, { restoreFocus: true });
  }
  studentLinksInfoButton?.addEventListener('click', () => {
    setStudentLinksExplanationOpen(studentLinksInfoButton.getAttribute('aria-expanded') !== 'true');
  });
  const studentLinkSearch = studentRegistrationLinksPanel.querySelector('#student-registration-link-search');
  const refreshStudentLinkSearchOption = (numeroFicha) => {
    const link = studentLinks.find((item) => Number(item.numeroFicha) === Number(numeroFicha));
    const option = studentRegistrationLinksPanel.querySelector(`[data-student-link-option="${Number(numeroFicha)}"]`);
    if (link && option) {
      const label = studentLinkSearchOptionLabel(link);
      option.dataset.studentLinkOptionSearch = normalizeText(`${link.numeroFicha} ${label}`);
      const student = option.querySelector('[data-student-link-option-student]');
      const recipient = option.querySelector('[data-student-link-option-recipient]');
      if (student) student.innerHTML = `<b>Cursista</b> ${escapeHtml(link.nomeCadastrado || '')}`;
      if (recipient) recipient.innerHTML = `<b>Enviado para</b> ${escapeHtml(link.enviadoPara || '')}`;
    }
  };
  if (studentLinkSearch) {
    const rows = [...studentRegistrationLinksPanel.querySelectorAll('[data-student-link-row]')];
    const options = [...studentRegistrationLinksPanel.querySelectorAll('[data-student-link-option]')];
    const menu = studentRegistrationLinksPanel.querySelector('#student-registration-link-options');
    const empty = menu.querySelector('.student-registration-link-option-empty');
    const searchControl = studentRegistrationLinksPanel.querySelector('.student-registration-link-search-control');
    const feedback = studentRegistrationLinksPanel.querySelector('#student-registration-link-search-feedback');
    const openStudentLinkOptions = () => { menu.hidden = false; studentLinkSearch.setAttribute('aria-expanded', 'true'); };
    const closeStudentLinkOptions = () => { menu.hidden = true; studentLinkSearch.setAttribute('aria-expanded', 'false'); };
    const filterStudentLinkOptions = () => {
      const query = normalizeText(studentLinkSearch.value);
      let visible = 0;
      options.forEach((option) => {
        const matches = !query || option.dataset.studentLinkOptionSearch.includes(query);
        option.hidden = !matches;
        if (matches) visible += 1;
      });
      empty.hidden = visible > 0;
    };
    const selectStudentLink = (numeroFicha) => {
      const number = Number(numeroFicha);
      const selectedRow = rows.find((row) => Number(row.dataset.studentLinkRow) === number);
      rows.forEach((row) => { row.hidden = row !== selectedRow; });
      if (!selectedRow) return;
      studentLinkSearch.value = String(number);
      feedback.textContent = `Ficha ${number} selecionada.`;
      closeStudentLinkOptions();
    };
    options.forEach((option) => option.addEventListener('click', () => selectStudentLink(option.dataset.studentLinkOption)));
    studentLinkSearch.addEventListener('focus', () => { filterStudentLinkOptions(); openStudentLinkOptions(); });
    studentLinkSearch.addEventListener('click', () => { filterStudentLinkOptions(); openStudentLinkOptions(); });
    studentLinkSearch.addEventListener('input', () => {
      rows.forEach((row) => { row.hidden = true; });
      feedback.textContent = 'Selecione uma ficha na lista abaixo do campo.';
      filterStudentLinkOptions();
      openStudentLinkOptions();
    });
    studentLinkSearch.addEventListener('keydown', (event) => {
      const visibleOptions = options.filter((option) => !option.hidden);
      if (event.key === 'Escape') { closeStudentLinkOptions(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); visibleOptions[0]?.focus(); return; }
      if (event.key === 'Enter' && visibleOptions.length) { event.preventDefault(); const exact = visibleOptions.find((option) => Number(option.dataset.studentLinkOption) === Number(studentLinkSearch.value)); (exact || visibleOptions[0]).click(); }
    });
    searchControl.addEventListener('focusout', () => setTimeout(() => { if (!searchControl.contains(document.activeElement)) closeStudentLinkOptions(); }, 0));
    filterStudentLinkOptions();
  }
  const openStudentLinkStatusWindow = () => {
    app.querySelector('.student-link-status-overlay')?.remove();
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay student-link-status-overlay';
    overlay.innerHTML = `<div class="receiver-sector-dialog student-link-status-dialog"><div class="panel-heading"><div><p class="eyebrow">Links de cadastro de cursistas</p><h2>Fichas previstas</h2><p>Todas as fichas do retiro em foco.</p></div></div><div class="student-link-status-table-wrap"><table class="student-link-status-table"></table></div><div class="form-actions"><button type="button" class="close-student-link-status">Fechar</button></div></div>`;
    let sort = { key: 'numeroFicha', direction: 'asc' };
    const table = overlay.querySelector('.student-link-status-table');
    const columns = [
      ['numeroFicha', 'Nr Ficha'],
      ['nomeCadastrado', 'Nome cursista/casal'],
      ['enviadoPara', 'Enviada para'],
      ['status', 'Status'],
    ];
    const statusText = (link) => link.status === 'cadastrada' ? 'Cadastrada' : (link.inscricaoEncerrada === true || link.status === 'encerrada' ? 'Encerrada' : 'Disponível');
    const valueFor = (link, key) => key === 'status' ? statusText(link) : (link[key] || '');
    const renderTable = () => {
      const directionFactor = sort.direction === 'asc' ? 1 : -1;
      const rows = [...studentLinks].sort((first, second) => {
        if (sort.key === 'numeroFicha') return (Number(first.numeroFicha) - Number(second.numeroFicha)) * directionFactor;
        return String(valueFor(first, sort.key)).localeCompare(String(valueFor(second, sort.key)), 'pt-BR', { numeric: true, sensitivity: 'base' }) * directionFactor;
      });
      table.innerHTML = `<thead><tr>${columns.map(([key, label]) => `<th scope="col" aria-sort="${sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-student-link-sort="${key}">${label}<span aria-hidden="true">${sort.key === key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((link) => `<tr><td>${link.numeroFicha}</td><td>${escapeHtml(link.nomeCadastrado || '—')}</td><td>${escapeHtml(link.enviadoPara || '—')}</td><td>${escapeHtml(statusText(link))}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">Nenhuma ficha prevista para este retiro.</td></tr>'}</tbody>`;
      table.querySelectorAll('[data-student-link-sort]').forEach((button) => button.addEventListener('click', () => {
        const key = button.dataset.studentLinkSort;
        sort = { key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' };
        renderTable();
      }));
    };
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    const onKeydown = (event) => { if (event.key === 'Escape') close(); };
    overlay.querySelector('.close-student-link-status')?.addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown);
    renderTable();
    app.append(overlay);
    overlay.querySelector('[data-student-link-sort]')?.focus();
  };
  studentRegistrationLinksPanel.querySelector('#view-student-link-status')?.addEventListener('click', openStudentLinkStatusWindow);
  studentRegistrationLinksPanel.querySelectorAll('[data-copy-student-link]').forEach((button) => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.copyStudentLink);
    button.textContent = 'Copiado!';
    setTimeout(() => { button.textContent = 'Copiar link'; }, 1600);
  }));
  studentRegistrationLinksPanel.querySelectorAll('[data-save-student-link-recipient]').forEach((button) => button.addEventListener('click', async () => {
    const numeroFicha = Number(button.dataset.saveStudentLinkRecipient);
    const input = studentRegistrationLinksPanel.querySelector(`[data-student-link-recipient="${numeroFicha}"]`);
    const feedback = studentRegistrationLinksPanel.querySelector(`[data-student-link-recipient-feedback="${numeroFicha}"]`);
    if (!input || !feedback) return;
    button.disabled = true;
    feedback.textContent = 'Salvando...';
    try {
      const saved = await dataService.saveStudentRegistrationLinkRecipient(id, numeroFicha, input.value);
      input.value = saved.enviadoPara || '';
      const link = studentLinks.find((item) => Number(item.numeroFicha) === numeroFicha);
      if (link) link.enviadoPara = input.value;
      refreshStudentLinkSearchOption(numeroFicha);
      feedback.textContent = 'Destinatário salvo.';
    } catch (error) {
      feedback.textContent = error.message || 'Não foi possível salvar o destinatário.';
    } finally {
      button.disabled = false;
    }
  }));
  studentRegistrationLinksPanel.querySelectorAll('[data-student-link-closed]').forEach((checkbox) => checkbox.addEventListener('change', async () => {
    const numeroFicha = Number(checkbox.dataset.studentLinkClosed);
    const row = checkbox.closest('[data-student-link-row]');
    const status = row?.querySelector(`[data-student-link-status="${numeroFicha}"]`);
    const feedback = row?.querySelector(`[data-student-link-closed-feedback="${numeroFicha}"]`);
    const previous = !checkbox.checked;
    checkbox.disabled = true;
    if (feedback) feedback.textContent = 'Salvando...';
    try {
      const saved = await dataService.setStudentRegistrationLinkClosed(id, numeroFicha, checkbox.checked);
      checkbox.checked = saved.inscricaoEncerrada === true;
      const link = studentLinks.find((item) => Number(item.numeroFicha) === numeroFicha);
      if (link) {
        link.inscricaoEncerrada = checkbox.checked;
        if (link.status !== 'cadastrada') link.status = checkbox.checked ? 'encerrada' : 'disponivel';
      }
      refreshStudentLinkSearchOption(numeroFicha);
      if (row?.dataset.studentLinkRegistered !== 'true' && status) {
        status.textContent = checkbox.checked ? 'Encerrada' : 'Disponível';
        status.className = `student-registration-link-status-note ${checkbox.checked ? 'is-closed' : 'is-available'}`;
      }
      if (feedback) feedback.textContent = checkbox.checked ? 'Inscrição encerrada.' : 'Inscrição reaberta.';
    } catch (error) {
      checkbox.checked = previous;
      if (feedback) feedback.textContent = error.message || 'Não foi possível alterar a inscrição.';
    } finally {
      checkbox.disabled = false;
    }
  }));
  app.querySelectorAll('[data-copy-sector-link]').forEach((button) => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.copySectorLink);
    button.textContent = 'Copiado!';
  }));
  const sectorLinkSearch = app.querySelector('#sector-link-search');
  if (sectorLinkSearch) {
    const menu = app.querySelector('#sector-link-menu');
    const rows = [...app.querySelectorAll('[data-sector-link-row]')];
    const feedback = app.querySelector('#sector-link-feedback');
    const empty = app.querySelector('.sector-link-empty');
    const selectedLinks = app.querySelector('#sector-link-selected');
    const canToggleSectorRegistration = canAccess('links-cadastro.editar') && canModifyRetreat(retreat);
    selectedLinks.addEventListener('click', (event) => {
      const viewLink = event.target.closest('a[data-view-sector-link]');
      if (!viewLink) return;
      const sector = viewLink.dataset.viewSectorName || '';
      history.replaceState(null, '', `#retiros/${id}?setor=${encodeURIComponent(sector)}`);
    });
    const openSectorLinkStatusWindow = () => {
      app.querySelector('.sector-link-status-overlay')?.remove();
      const overlay = document.createElement('section');
      overlay.className = 'receiver-sector-overlay sector-link-status-overlay';
      const sectorRows = configuredRetreatSectors.map((sector) => {
        const closed = sectorRegistrationClosed(retreat, sector);
        return `<div class="sector-link-status-row"><strong>${escapeHtml(sector)}</strong><span class="sector-link-status-badge ${closed ? 'is-closed' : 'is-active'}">${closed ? 'Inscrições encerradas' : 'Ativo'}</span></div>`;
      }).join('');
      overlay.innerHTML = `<div class="receiver-sector-dialog sector-link-status-dialog"><div class="panel-heading"><div><p class="eyebrow">Links de cadastro da equipe de trabalho por setor</p><h2>Status dos links por setor</h2><p>Visualização dos setores configurados para ${escapeHtml(retreat.nome || 'este retiro')}.</p></div></div>${sectorRows ? `<div class="sector-link-status-list">${sectorRows}</div>` : '<p class="empty-state">Nenhum setor configurado neste retiro.</p>'}<div class="form-actions"><button type="button" class="close-sector-view">Fechar</button></div></div>`;
      const close = () => overlay.remove();
      overlay.querySelector('.close-sector-view')?.addEventListener('click', close);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
      app.append(overlay);
      overlay.querySelector('.close-sector-view')?.focus();
    };
    app.querySelector('#view-sector-link-status')?.addEventListener('click', openSectorLinkStatusWindow);
    const openSectorLinksMenu = () => {
      menu.hidden = false;
      sectorLinkSearch.setAttribute('aria-expanded', 'true');
    };
    const closeSectorLinksMenu = () => {
      menu.hidden = true;
      sectorLinkSearch.setAttribute('aria-expanded', 'false');
    };
    const filterSectorLinks = () => {
      const query = normalizeText(sectorLinkSearch.value);
      let visible = 0;
      rows.forEach((row) => {
        const matches = !query || normalizeText(row.dataset.sectorLinkRow).includes(query);
        row.hidden = !matches;
        if (matches) visible += 1;
      });
      if (empty) empty.hidden = visible > 0;
      feedback.textContent = query ? (visible ? `${visible} setor(es) ativo(s) encontrado(s).` : 'Nenhum setor ativo encontrado.') : 'Selecione um setor para visualizar os links.';
    };
    app.querySelectorAll('[data-sector-link-select]').forEach((button) => button.addEventListener('click', () => {
      const sector = button.dataset.sectorLinkSelect || '';
      sectorLinkSearch.value = sector;
      selectedLinks.innerHTML = `<article class="sector-link-selected-card"><strong>${escapeHtml(sector)}</strong><div class="sector-link-actions"><label class="copy-field"><span>Cadastro</span><input readonly value="${escapeHtml(button.dataset.registrationUrl || '')}"><button type="button" data-copy-sector-link="${escapeHtml(button.dataset.registrationUrl || '')}">Copiar</button></label><label class="copy-field sector-link-followup-field"><span>Acompanhamento do líder</span><input readonly value="${escapeHtml(button.dataset.followupUrl || '')}"><button type="button" data-copy-sector-link="${escapeHtml(button.dataset.followupUrl || '')}">Copiar</button><a class="secondary-button sector-link-preview-button" href="${escapeHtml(button.dataset.followupUrl || '')}" data-view-sector-link="${escapeHtml(button.dataset.followupUrl || '')}" data-view-sector-name="${escapeHtml(sector)}">Visualizar</a></label></div></article>`;
      selectedLinks.querySelectorAll('[data-copy-sector-link]').forEach((copyButton) => copyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(copyButton.dataset.copySectorLink);
        copyButton.textContent = 'Copiado!';
      }));
      filterSectorLinks();
      closeSectorLinksMenu();
    }));
    app.querySelectorAll('[data-sector-link-select]').forEach((button) => button.addEventListener('click', () => {
      const sector = button.dataset.sectorLinkSelect || '';
      const registrationClosed = button.dataset.registrationClosed === 'true';
      sectorLinkSearch.value = sector;
      selectedLinks.innerHTML = `<article class="sector-link-selected-card"><div class="sector-link-selected-heading"><strong>${escapeHtml(sector)}</strong><label class="sector-link-closed-option"><input type="checkbox" data-sector-registration-closed="${escapeHtml(sector)}" ${registrationClosed ? 'checked' : ''} ${canToggleSectorRegistration ? '' : 'disabled'}><span>Inscrições encerradas</span></label></div><p class="sector-link-save-message" data-sector-closed-message>${canToggleSectorRegistration ? '' : 'Somente consulta.'}</p><div class="sector-link-actions"><label class="copy-field"><span>Cadastro</span><input readonly value="${escapeHtml(button.dataset.registrationUrl || '')}"><button type="button" data-copy-sector-link="${escapeHtml(button.dataset.registrationUrl || '')}">Copiar</button></label><label class="copy-field sector-link-followup-field"><span>Acompanhamento do líder</span><input readonly value="${escapeHtml(button.dataset.followupUrl || '')}"><button type="button" data-copy-sector-link="${escapeHtml(button.dataset.followupUrl || '')}">Copiar</button><a class="secondary-button sector-link-preview-button" href="${escapeHtml(button.dataset.followupUrl || '')}" data-view-sector-link="${escapeHtml(button.dataset.followupUrl || '')}" data-view-sector-name="${escapeHtml(sector)}">Visualizar</a></label></div></article>`;
      selectedLinks.querySelectorAll('[data-copy-sector-link]').forEach((copyButton) => copyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(copyButton.dataset.copySectorLink);
        copyButton.textContent = 'Copiado!';
      }));
      selectedLinks.querySelector('[data-sector-registration-closed]')?.addEventListener('change', async (event) => {
        const checkbox = event.currentTarget;
        const nextClosed = checkbox.checked;
        const previousClosed = !nextClosed;
        const message = selectedLinks.querySelector('[data-sector-closed-message]');
        checkbox.disabled = true;
        if (message) message.textContent = 'Salvando...';
        try {
          await dataService.setSectorRegistrationLinkClosed(id, sector, nextClosed);
          if (message) message.textContent = 'Status salvo.';
          await loadData();
          await renderRetreat(id, sector);
        } catch (error) {
          checkbox.checked = previousClosed;
          checkbox.disabled = !canToggleSectorRegistration;
          if (message) message.textContent = `Nao foi possivel salvar o status. ${error.message || 'Atualize a pagina e tente novamente.'}`;
        }
      });
    }));
    sectorLinkSearch.addEventListener('focus', () => { filterSectorLinks(); openSectorLinksMenu(); });
    sectorLinkSearch.addEventListener('click', () => { filterSectorLinks(); openSectorLinksMenu(); });
    sectorLinkSearch.addEventListener('input', () => {
      if (!sectorLinkSearch.value.trim()) selectedLinks.innerHTML = '';
      filterSectorLinks();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!sectorLinksPanel.contains(event.target)) closeSectorLinksMenu();
    });
    sectorLinkSearch.addEventListener('blur', () => setTimeout(closeSectorLinksMenu, 140));
    filterSectorLinks();
    if (selectedSector) {
      const selectedButton = [...app.querySelectorAll('[data-sector-link-select]')].find((button) => normalizeText(button.dataset.sectorLinkSelect) === normalizeText(selectedSector));
      if (selectedButton) selectedButton.click();
    }
  }
}

async function renderConfiguracoes({ message = '' } = {}) {
  const retreat = selectedRetreat();
  const canCreateRetreat = canAccess('retiros.criar');
  const newRetreatAction = canCreateRetreat ? '<a class="primary-button" href="#configuracoes/novo">+ Novo retiro</a>' : '';
  if (!retreat) {
    layout(`<section class="page-heading"><div><p class="eyebrow">Administração</p><h1>Configurações</h1><p>Nenhum retiro está em foco. Selecione um retiro na tela Início para administrar suas configurações.</p>${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ''}</div><div class="detail-actions">${newRetreatAction}<a class="secondary-button" href="#inicio">Ir para Início</a></div></section>`, 'configuracoes');
    return;
  }
  const concluded = isRetreatConcluded(retreat);
  const canEditRetreat = canAccess('retiros.editar') && canModifyRetreat(retreat);
  const canPublishRetreat = canAccess('retiros.publicar') && canModifyRetreat(retreat) && retreat.status !== 'publicado';
  const canConcludeRetreat = canAccess('retiros.encerrar') && canModifyRetreat(retreat);
  const canDeleteRetreat = canAccess('retiros.excluir') && !concluded;
  const actions = [
    newRetreatAction,
    canEditRetreat ? '<a class="secondary-button" href="#configuracoes/editar">Editar</a>' : '',
    canPublishRetreat ? '<button class="primary-button" id="publish-retreat" type="button">Publicar retiro</button>' : '',
    canConcludeRetreat ? '<button class="secondary-button" id="conclude-retreat" type="button">Encerrar</button>' : '',
    canDeleteRetreat ? '<button class="delete-retreat" id="delete-retreat" type="button">Excluir</button>' : '',
  ].filter(Boolean).join('');
  layout(`<section class="page-heading compact"><div><p class="eyebrow">Administração do retiro</p><h1>Configurações</h1><p>As ações abaixo se aplicam ao retiro em foco.</p></div></section>
    <section class="panel"><div class="panel-heading"><div><span class="status ${escapeHtml(retreat.status || '')}">${statusLabel(retreat.status)}</span><h2>${escapeHtml(retreat.nome)}</h2><p>${dateRange(retreat.dataInicio, retreat.dataTermino)}${retreat.local ? ` · ${escapeHtml(retreat.local)}` : ''}</p></div></div>${message ? `<p class="form-message">${escapeHtml(message)}</p>` : ''}${concluded ? '<p class="hint">Retiro concluído: alterações bloqueadas. Consultas, relatórios e impressões continuam disponíveis.</p>' : ''}<div class="detail-actions retreat-actions-menu">${actions || '<p class="empty-state">Nenhuma ação disponível para este retiro.</p>'}</div></section>`, 'configuracoes');

  app.querySelector('#publish-retreat')?.addEventListener('click', async () => {
    if (!canAccess('retiros.publicar') || !ensureRetreatCanBeChanged(retreat, 'publicar este retiro')) return;
    if (retreat.status !== 'publicado') {
      retreat.status = 'publicado';
      retreat.linksSetores = preparedSectorLinks(retreat);
      retreat.recebedorToken = retreat.recebedorToken || publicAccessToken();
      retreat.updatedAt = new Date().toISOString();
      await dataService.saveRetiro(retreat);
      await loadData();
      renderConfiguracoes({ message: 'Retiro publicado.' });
    }
  });
  app.querySelector('#conclude-retreat')?.addEventListener('click', async () => {
    if (!canAccess('retiros.encerrar') || !ensureRetreatCanBeChanged(retreat, 'encerrar este retiro')) return;
    const first = confirm(`Encerrar o retiro "${retreat.nome}"?\n\nDepois de concluido, este retiro ficara disponivel apenas para consultas, relatorios e impressoes.`);
    if (!first) return;
    const second = confirm('Confirme novamente: apos encerrar, nao sera mais possivel fazer ajustes neste retiro, incluindo configuracoes, fichas, cursistas, comunidades, crachas, financeiro e validacoes.');
    if (!second) return;
    retreat.status = 'concluido';
    retreat.concluidoEm = retreat.concluidoEm || new Date().toISOString();
    retreat.updatedAt = new Date().toISOString();
    await dataService.saveRetiro(retreat);
    await loadData();
    renderConfiguracoes({ message: 'Retiro encerrado.' });
  });
  app.querySelector('#delete-retreat')?.addEventListener('click', async () => {
    if (!canAccess('retiros.excluir') || isRetreatConcluded(retreat)) return;
    const button = app.querySelector('#delete-retreat');
    const [allCommunities, allBadges] = await Promise.all([dataService.listComunidades(retreat.id), dataService.listCrachas(retreat.id)]);
    const retreatEnrolments = enrolments.filter((entry) => entry.retiroId === retreat.id);
    const retreatCommunities = allCommunities.filter((community) => community.retiroId === retreat.id);
    const retreatBadges = allBadges.filter((badge) => badge.retiroId === retreat.id);
    if (!confirm(`Excluir o retiro "${retreat.nome}"?\n\nEsta ação remove a estrutura do retiro, ${retreatEnrolments.length} adesão(ões), ${retreatCommunities.length} comunidade(s) e ${retreatBadges.length} configuração(ões) de crachá vinculadas. Os cadastros das pessoas serão preservados.`)) return;
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      await Promise.all([
        ...retreatEnrolments.map((entry) => dataService.deleteAdesao(entry.id)),
        ...retreatCommunities.map((community) => dataService.deleteComunidade(community.id)),
        ...retreatBadges.map((badge) => dataService.deleteCracha(badge.id)),
      ]);
      await dataService.deleteRetiro(retreat.id);
      await loadData();
      renderConfiguracoes({ message: 'Retiro excluído.' });
    } catch (error) {
      alert(`Nao foi possivel excluir o retiro. ${error.message || 'Atualize a pagina e tente novamente.'}`);
      button.disabled = false;
      button.textContent = 'Excluir';
    }
  });
}

async function renderEditRetreat(id, returnHash = '#configuracoes') {
  const retreat = retreats.find((item) => item.id === id);
  if (!retreat) return renderRetiros();
  if (!ensureRetreatAccess(retreat)) return;
  if (isRetreatConcluded(retreat)) {
    alert('Este retiro esta concluido. A configuracao esta disponivel apenas para consulta.');
    return renderConfiguracoes();
  }
  const isPublished = retreat.status === 'publicado';
  const dateLockAttr = isPublished ? 'readonly aria-readonly="true"' : '';
  const publishedDateHint = isPublished ? '<p class="hint full">Retiro publicado: as datas de início e término não podem mais ser alteradas.</p>' : '';
  layout(`<section class="page-heading compact"><div><p class="eyebrow">Configuração do evento</p><h1>Editar retiro</h1><p>Estas alterações afetam somente este retiro, nunca o histórico dos anteriores.</p></div><a class="text-link" href="${escapeHtml(returnHash)}">← Voltar</a></section>
  <form id="edit-retreat-form" class="panel editor-form"><div class="fields two-columns"><label class="field full"><span>Nome do retiro <b>*</b></span><input name="nome" required value="${escapeHtml(retreat.nome)}"></label><label class="field"><span>Data de início</span><input name="dataInicio" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" value="${escapeHtml(formatDateInput(retreat.dataInicio) || retreat.dataInicio || '')}" ${dateLockAttr}></label><label class="field"><span>Data de término</span><input name="dataTermino" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" value="${escapeHtml(formatDateInput(retreat.dataTermino) || retreat.dataTermino || '')}" ${dateLockAttr}></label>${publishedDateHint}<label class="field"><span>Local</span><input name="local" value="${escapeHtml(retreat.local || '')}"></label><label class="field"><span>Tipo do retiro <b>*</b></span><select name="tipoRetiro" required>${retreatTypeOptions(retreat.tipoRetiro)}</select></label><label class="field full"><span>Ficha cursista para esse retiro.</span><select name="tipoFichaCursista">${studentFormTypeOptions(retreat.tipoFichaCursista)}</select></label><div class="fields three-columns retreat-value-fields full"><label class="field"><span>Inscrição do cursista</span><input name="valorInscricaoCursista" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorInscricaoCursista)}"></label><label class="field"><span>Inscrição do voluntário</span><input name="valorInscricaoVoluntario" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorInscricaoVoluntario)}"></label><label class="field"><span>Valor da foto</span><input name="valorFoto" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorFoto ?? 10)}"></label><label class="field"><span>Idade máxima para ficar no Espaço Kids</span><input name="idadeMaximaEspacoKids" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(retreat.idadeMaximaEspacoKids || '')}" placeholder="Ex.: 10"></label><label class="field"><span>Número previsto de fichas de cursista</span><input name="numeroPrevistoFichasCursista" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(retreat.numeroPrevistoFichasCursista || '')}" placeholder="Ex.: 80"></label></div></div>
  <fieldset><legend>Setores de trabalho</legend><p class="hint">Selecione os setores que ter&atilde;o link de inscri&ccedil;&atilde;o por setor neste retiro.</p>${sectorGroups(knownSectors(retreat.setores), configuredSectors(retreat.setores), configuredSectors(retreat.setoresPublicos ?? retreat.setores), retreat.setoresInscricoesEncerradas || [])}</fieldset><div class="form-actions"><p>As alterações são salvas neste retiro.</p><button type="submit">Salvar alterações <span>→</span></button></div></form>`, 'configuracoes');
  const form = app.querySelector('#edit-retreat-form');
  wireTypedDates(form, namedFieldSelector(['dataInicio', 'dataTermino']));
  form.querySelector('.form-actions')?.insertAdjacentHTML('beforebegin', '<p id="edit-retreat-message" class="form-message"></p>');
  ensureOfficialShirtValueField(form, currency(retreat.valorCamisetaOficial));
  applyRetreatConfigLayout(form);
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
    const rawDataInicio = String(values.get('dataInicio') || '').trim();
    const rawDataTermino = String(values.get('dataTermino') || '').trim();
    const normalizedDataInicio = normalizeDateInput(rawDataInicio);
    const normalizedDataTermino = normalizeDateInput(rawDataTermino);
    const invalidDateInput = !isPublished ? [
      [form.elements.dataInicio, rawDataInicio, normalizedDataInicio],
      [form.elements.dataTermino, rawDataTermino, normalizedDataTermino],
    ].find(([, raw, normalized]) => raw && !normalized)?.[0] : null;
    if (invalidDateInput) {
      invalidDateInput.setCustomValidity('Digite uma data válida no formato dd/mm/aaaa.');
      form.reportValidity();
      invalidDateInput.focus();
      return;
    }
    const dataInicio = isPublished ? (retreat.dataInicio || '') : normalizedDataInicio;
    const dataTermino = isPublished ? (retreat.dataTermino || '') : normalizedDataTermino;
    if (dataInicio && dataTermino && dataTermino < dataInicio) { alert('A data de término deve ser igual ou posterior à data de início.'); return; }
    const serviceDays = dataInicio && dataTermino ? retreatDaysFromDates(dataInicio, dataTermino) : [];
    delete retreat.descontoParentesco;
    const sortedSectors = sortSectors(selectedSectors);
    const setoresInscricoesEncerradas = sortedSectors.filter((sector) => sectorRegistrationClosed(retreat, sector));
    const existingLinks = (retreat.linksSetores || retreat.setorLinks || []).map((link) => ({
      ...link,
      inscricoesEncerradas: setoresInscricoesEncerradas.some((sector) => normalizeText(sector) === normalizeText(link.setor || link.sector)),
    }));
    Object.assign(retreat, { nome: values.get('nome').trim(), tipoRetiro: values.get('tipoRetiro'), dataInicio, dataTermino, local: String(values.get('local') || '').trim(), tipoFichaCursista: values.get('tipoFichaCursista') || defaultStudentFormType, valorInscricaoCursista: parseCurrency(values.get('valorInscricaoCursista')), valorInscricaoVoluntario: parseCurrency(values.get('valorInscricaoVoluntario')), valorFoto: parseCurrency(values.get('valorFoto')), valorCamisetaOficial: parseCurrency(values.get('valorCamisetaOficial')), idadeMaximaEspacoKids: Number(values.get('idadeMaximaEspacoKids')) || 0, numeroPrevistoFichasCursista: normalizeExpectedStudentFileCount(values.get('numeroPrevistoFichasCursista')), setores: sortedSectors, setoresPublicos: sortedSectors, setoresInscricoesEncerradas, dias: serviceDays.length ? serviceDays : (retreat.dias?.length ? retreat.dias : [...retreatDefaults.dias]), linksSetores: syncSectorLinks({ ...retreat, linksSetores: existingLinks }, knownSectors(sortedSectors)), updatedAt: new Date().toISOString() });
    const message = form.querySelector('#edit-retreat-message');
    if (message) message.textContent = '';
    try {
      await dataService.saveRetiro(retreat);
      await loadData();
      location.hash = returnHash;
    } catch (error) {
      if (message) message.textContent = `NÃ£o foi possÃ­vel salvar as alteraÃ§Ãµes. ${error.message || 'Atualize a pÃ¡gina e tente novamente.'}`;
    }
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
  const paidAmount = parseCurrency(form.elements.valorPago?.value ?? form.elements.valorPagoSmp?.value);
  const method = form.elements.formaPagamento?.value || form.elements.recebedorFormaPagamentoSmp?.value || '';
  const observation = form.elements.observacaoPagamento?.value || form.elements.recebedorObservacaoSmp?.value || '';
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
  const canEditReceiverRetreat = () => Boolean(retreat) && !isRetreatConcluded(retreat) && (publicReceiverToken || (canAccess('recebedor.editar') && canAccessRetreat(retreat)));
  const ensureReceiverCanBeChanged = () => {
    if (publicReceiverToken) {
      if (!isRetreatConcluded(retreat)) return true;
      alert('Este retiro esta concluido. Para preservar o historico, alteracoes financeiras estao bloqueadas.');
      return false;
    }
    return ensureRetreatCanBeChanged(retreat, 'alterar pagamentos');
  };
  const canEditReceiver = canEditReceiverRetreat();
  const studentFormType = retreat.tipoFichaCursista || defaultStudentFormType;
  const usesCoupleStudentForm = ['cursista-smp', 'cursista-epc'].includes(studentFormType);
  const studentFinanceType = usesCoupleStudentForm ? studentFormType : 'cursista';
  const studentSectorLabel = studentFormType === 'cursista-epc' ? 'Cursista EPC' : (studentFormType === 'cursista-smp' ? 'Cursista SMP' : 'Cursista');
  const smpReceiverName = (record = {}) => [record.nomeDele, record.nomeDela].map((name) => String(name || '').trim()).filter(Boolean).join(' e ') || (record.numeroFichaSmp || record.id ? `Ficha ${record.numeroFichaSmp || record.id}` : studentSectorLabel);
  const mapSmpReceiverStudent = (record = {}) => ({
    ...record,
    id: `smp-${record.id || record.numeroFichaSmp}`,
    sourceId: record.id || record.numeroFichaSmp,
    nome: smpReceiverName(record),
    sortName: smpReceiverName(record),
    setores: [studentSectorLabel],
    tipoFinanceiro: studentFinanceType,
    valorInscricao: record.valorInscricaoSmp,
    valorPago: record.valorPagoSmp,
    recebedorValorPago: record.recebedorValorPagoSmp,
    recebedorTaxaPaga: record.recebedorTaxaPagaSmp,
    recebedorFormaPagamento: record.recebedorFormaPagamentoSmp,
    recebedorObservacao: record.recebedorObservacaoSmp,
    __sourceRecord: record,
  });
  const activeCoupleStudentSource = usesCoupleStudentForm ? coupleStudentSource(studentFormType) : null;
  const students = usesCoupleStudentForm
    ? (await activeCoupleStudentSource.list(retreat.id)).map(mapSmpReceiverStudent)
    : uniqueByParticipant(await dataService.listCursistas(retreat.id)).map((student) => ({ ...student, setores: ['Cursista'], tipoFinanceiro: 'cursista' }));
  const isStudentFinanceEntry = (entry = {}) => ['cursista', 'cursista-smp', 'cursista-epc'].includes(entry.tipoFinanceiro);
  const isCoupleStudentFinanceEntry = (entry = {}) => ['cursista-smp', 'cursista-epc'].includes(entry.tipoFinanceiro);
  const entries = [
    ...mergeEnrolmentsByParticipant(enrolments.filter((entry) => entry.retiroId === retreat.id)).map((entry) => ({ ...entry, tipoFinanceiro: 'voluntario' })),
    ...students,
  ];
  const effectiveSuggested = (entry) => {
    if (entry.tipoFinanceiro === 'voluntario') return volunteerContributionAmount(retreat, entry);
    const inscription = parseCurrency(entry.valorInscricao) || Number(retreat.valorInscricaoCursista) || suggestedAmount(entry.contribuicao);
    return Math.max(0, inscription - parseCurrency(entry.valorPago));
  };
  const entryAdvanceAmount = (entry) => isStudentFinanceEntry(entry) ? parseCurrency(entry.valorPago) : 0;
  const entryPaidAmount = (entry) => isStudentFinanceEntry(entry) ? Math.max(0, parseCurrency(entry.recebedorValorPago) - entryAdvanceAmount(entry)) : parseCurrency(entry.valorPago);
  const entryHasReceiverPayment = (entry) => entryPaidAmount(entry) > 0;
  const entryAdvancePaymentMethod = (entry) => isStudentFinanceEntry(entry) ? (entry.formaPagamento || (entryAdvanceAmount(entry) > 0 && !entryHasReceiverPayment(entry) ? entry.recebedorFormaPagamento : '') || '') : '';
  const entryAdvancePaymentObservation = (entry) => isStudentFinanceEntry(entry) ? (entry.observacaoPagamento || (entryAdvanceAmount(entry) > 0 && !entryHasReceiverPayment(entry) ? entry.recebedorObservacao : '') || '') : '';
  const entryPaidStatus = (entry) => {
    if (!isStudentFinanceEntry(entry)) return Boolean(entry.taxaPaga);
    const inscription = parseCurrency(entry.valorInscricao) || Number(retreat.valorInscricaoCursista) || suggestedAmount(entry.contribuicao);
    const advanceBalance = Math.max(0, inscription - entryAdvanceAmount(entry));
    return advanceBalance <= 0 || (inscription <= 0 ? Boolean(entry.recebedorTaxaPaga) : parseCurrency(entry.recebedorValorPago) >= inscription);
  };
  const entryPaymentMethod = (entry) => isStudentFinanceEntry(entry) ? (entryHasReceiverPayment(entry) ? (entry.recebedorFormaPagamento || '') : '') : (entry.formaPagamento || entry.recebedorFormaPagamento || '');
  const entryPaymentObservation = (entry) => isStudentFinanceEntry(entry) ? (entryHasReceiverPayment(entry) ? (entry.recebedorObservacao || '') : '') : (entry.recebedorObservacao || '');
  const setEntryPayment = (entry, value, checked, paymentMethod = '', observation) => {
    if (isStudentFinanceEntry(entry)) {
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
    if (!ensureReceiverCanBeChanged()) return;
    if (entry.tipoFinanceiro === 'cursista') {
      await dataService.saveCursista(entry);
      return;
    }
    if (isCoupleStudentFinanceEntry(entry)) {
      await coupleStudentSource(entry.tipoFinanceiro).save({
        ...entry.__sourceRecord,
        valorPagoSmp: entry.valorPago,
        saldoPagarSmp: Math.max(0, (parseCurrency(entry.valorInscricao) || Number(retreat.valorInscricaoCursista) || 0) - parseCurrency(entry.valorPago)),
        recebedorValorPagoSmp: entry.recebedorValorPago,
        recebedorTaxaPagaSmp: entry.recebedorTaxaPaga,
        recebedorFormaPagamentoSmp: entry.recebedorFormaPagamento,
        recebedorObservacaoSmp: entry.recebedorObservacao,
      });
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
  const isStudentRow = (row) => row.entries.some((entry) => isStudentFinanceEntry(entry));
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
  const receiverUrl = retreat.recebedorToken ? `${location.origin}/recebedor/${encodeURIComponent(retreat.recebedorToken)}` : '';
  const receiverLinkValue = receiverUrl || 'Esse link será gerado na publicação do retiro';
  const receiverLinkPanel = publicReceiverToken ? '' : `<section class="panel receiver-link-panel"><div class="panel-heading"><div><h2>Link de acesso do recebedor</h2><p>Compartilhe este link somente com quem far&aacute; o controle financeiro deste retiro.</p></div></div><label class="copy-field receiver-retreat-link"><span>Recebedor</span><input readonly value="${escapeHtml(receiverLinkValue)}"><button type="button" data-copy-receiver-link="${escapeHtml(receiverUrl)}" ${retreat.recebedorToken ? '' : 'disabled'}>Copiar</button></label></section>`;
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
      if (!ensureReceiverCanBeChanged()) return;
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
    if (!ensureReceiverCanBeChanged()) return;
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
  layout(`<section class="page-heading"><div><p class="eyebrow">Equipe de trabalho</p><h1>Valida\u00e7\u00e3o das inscri\u00e7\u00f5es</h1><p>${escapeHtml(retreat.nome)} · Confira os cadastros recebidos e registre a ciência da coordenação. Fichas não validadas não aparecem para o recebedor.</p></div></section><section class="receiver-summary validation-summary"><article><span>Pendentes</span><strong>${pendingCount}</strong><small>ficha(s)</small></article><article><span>Validadas</span><strong>${validatedCount}</strong><small>ficha(s)</small></article><article><span>Total recebido</span><strong>${validationGroups.length}</strong><small>ficha(s)</small></article></section><section class="panel validation-list">${validationGroups.length ? validationGroups.map(validationGroupHtml).join('') : '<p class="empty-state">Nenhuma inscrição da equipe foi recebida para este retiro.</p>'}</section>`, 'validacao-inscricoes');
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

const financialSummaryTotals = (rows) => rows.reduce((totals, row) => ({
  valorInscricao: totals.valorInscricao + row.valorInscricao,
  valorPago: totals.valorPago + row.valorPago,
  saldoPagar: totals.saldoPagar + row.saldoPagar,
}), { valorInscricao: 0, valorPago: 0, saldoPagar: 0 });

const financialSummaryTable = (rows, { firstColumnLabel, emptyMessage }) => {
  const totals = financialSummaryTotals(rows);
  const body = rows.map((row) => {
    const detail = row.detalhe ? `<small class="student-financial-summary-detail">${escapeHtml(row.detalhe)}</small>` : '';
    return `<tr class="${row.saldoPagar > 0 ? 'has-student-balance' : ''}"><td>${escapeHtml(row.nome)}${detail}</td><td>${currency(row.valorInscricao)}</td><td>${currency(row.valorPago)}</td><td>${currency(row.saldoPagar)}</td><td>${escapeHtml(row.formaPagamento || 'Não informado')}</td><td>${escapeHtml(row.observacao || '—')}</td></tr>`;
  }).join('') || `<tr><td colspan="6">${escapeHtml(emptyMessage)}</td></tr>`;
  return `<div class="receiver-report-preview student-financial-summary-preview"><table><thead><tr><th>${escapeHtml(firstColumnLabel)}</th><th>Valor da inscrição</th><th>Valor pago</th><th>Saldo a pagar</th><th>Forma de pagamento</th><th>Observação</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th>Total</th><td>${currency(totals.valorInscricao)}</td><td>${currency(totals.valorPago)}</td><td>${currency(totals.saldoPagar)}</td><td></td><td></td></tr></tfoot></table></div>`;
};

const financialSummaryDocument = (rows, options) => `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(options.title)}</title><style>@page{size:A4;margin:10mm}body{margin:0;color:#26382c;font-family:Arial,sans-serif}h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#667268}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px}th,td{padding:6px;border:1px solid #d9d1c3;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:normal}th{background:#edf5e9;color:#285130}.has-student-balance td{font-weight:700}.student-financial-summary-detail{display:block;margin-top:3px;color:#667268;font-size:9px;font-weight:400}tfoot th,tfoot td{background:#f6fbf2;font-weight:700}th:first-child,td:first-child{width:auto}th:nth-child(2),th:nth-child(3),th:nth-child(4),td:nth-child(2),td:nth-child(3),td:nth-child(4){width:72px;white-space:nowrap;font-weight:700}th:nth-child(5),td:nth-child(5){width:95px}th:nth-child(6),td:nth-child(6){width:150px}</style></head><body><h1>${escapeHtml(options.title)}</h1><p>Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}</p>${financialSummaryTable(rows, options)}</body></html>`;

const printFinancialSummary = (rows, options, pdf = false) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
  printWindow.document.open();
  printWindow.document.write(financialSummaryDocument(rows, options));
  printWindow.document.close();
  if (pdf) alert('Na janela de impressão, escolha "Salvar como PDF".');
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 250);
};

const downloadFinancialSummarySpreadsheet = (rows, options) => {
  const totals = financialSummaryTotals(rows);
  const headers = [options.firstColumnLabel, 'Valor da inscrição', 'Valor pago', 'Saldo a pagar', 'Forma de pagamento', 'Observação'];
  const csvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.map(csvValue).join(';'),
    ...rows.map((row) => [row.detalhe ? `${row.nome} - ${row.detalhe}` : row.nome, currency(row.valorInscricao), currency(row.valorPago), currency(row.saldoPagar), row.formaPagamento || '', row.observacao || ''].map(csvValue).join(';')),
    ['Total', currency(totals.valorInscricao), currency(totals.valorPago), currency(totals.saldoPagar), '', ''].map(csvValue).join(';'),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${normalizeText(options.title).replace(/\s+/g, '-') || options.filenameFallback}.csv`;
  document.body.append(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
};

const openFinancialSummary = (rows, options) => {
  const overlay = document.createElement('section');
  overlay.className = 'receiver-sector-overlay student-financial-summary-overlay';
  overlay.innerHTML = `<div class="receiver-sector-dialog receiver-report-dialog student-financial-summary-dialog"><div class="panel-heading"><div><p class="eyebrow">${escapeHtml(options.eyebrow)}</p><h2>${escapeHtml(options.title)}</h2><p>${escapeHtml(options.description)}</p></div></div><div id="student-financial-summary-table">${financialSummaryTable(rows, options)}</div><div class="receiver-report-actions"><button type="button" id="student-summary-pdf">Salvar PDF</button><button type="button" id="student-summary-sheet">Salvar planilha</button><button type="button" id="student-summary-print">Imprimir</button><button type="button" class="close-sector-view">Fechar</button></div></div>`;
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#student-summary-pdf').addEventListener('click', () => printFinancialSummary(rows, options, true));
  overlay.querySelector('#student-summary-sheet').addEventListener('click', () => downloadFinancialSummarySpreadsheet(rows, options));
  overlay.querySelector('#student-summary-print').addEventListener('click', () => printFinancialSummary(rows, options, false));
  app.append(overlay);
};

const wireFinancialSummaryButton = ({ buttonSelector, loadRows, ...options }) => {
  const button = app.querySelector(buttonSelector);
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      openFinancialSummary(await loadRows(), options);
    } catch (error) {
      alert(error.message || 'Não foi possível carregar o resumo financeiro.');
    } finally {
      button.disabled = false;
    }
  });
};

const publicStudentRegistrationApiUrl = () => `/api/cadastro-cursista/${encodeURIComponent(publicStudentRegistrationToken)}${publicStudentRegistrationFileNumber ? `?ficha=${publicStudentRegistrationFileNumber}` : ''}`;
const publicStudentUnavailable = (title, message) => {
  app.innerHTML = `<main class="public-student-shell"><section class="panel public-student-state"><p class="eyebrow">Cadastro de cursista</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></section></main>`;
};
const publicStudentPayload = (form) => {
  const payload = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => { if (input.name) payload[input.name] = input.checked; });
  ['cpf', 'cpfDele', 'cpfDela'].forEach((name) => { if (payload[name]) payload[name] = normalizeCpf(payload[name]); });
  ['nascimento', ...coupleStudentDateFieldNames].forEach((name) => {
    if (!Object.prototype.hasOwnProperty.call(payload, name)) return;
    const raw = String(payload[name] || '').trim();
    payload[name] = raw ? (normalizeDateInput(raw) || raw) : '';
  });
  return payload;
};
const wireSharedPublicStudentSubmission = (form, context, messageSelector) => {
  const message = app.querySelector(messageSelector);
  let registrationSaved = false;
  let photoUploadToken = '';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!registrationSaved && !form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    if (message) message.textContent = registrationSaved ? 'Tentando enviar a foto novamente...' : 'Salvando cadastro...';
    try {
      if (!registrationSaved) {
        const response = await fetch(publicStudentRegistrationApiUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(publicStudentPayload(form)),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Não foi possível concluir o cadastro.');
        registrationSaved = true;
        photoUploadToken = result.photoUploadToken || '';
      }
      if (form._studentPhotoController?.hasPending()) {
        await form._studentPhotoController.uploadPublic(photoUploadToken, publicStudentRegistrationApiUrl());
      }
      publicStudentUnavailable('Cadastro realizado', `A ficha ${context.numeroFicha} foi cadastrada com sucesso.`);
    } catch (error) {
      if (message) message.textContent = error.message || 'Não foi possível concluir o cadastro.';
      button.disabled = false;
      if (registrationSaved) button.innerHTML = 'Tentar enviar a foto novamente <span>→</span>';
    }
  });
};

function prepareSharedPublicCoupleStudentForm(context) {
  const form = app.querySelector('#cursista-smp-form');
  if (!form) return;
  app.querySelector('#smp-financial-summary')?.remove();
  app.querySelector('.cursista-smp-tools')?.remove();
  const fileNumberInput = app.querySelector('[name="numeroFichaSmp"]');
  if (fileNumberInput) {
    fileNumberInput.value = String(context.numeroFicha);
    fileNumberInput.readOnly = true;
  }
  ['valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp'].forEach((name) => form.elements[name]?.closest('.field')?.remove());
  ['recebedorValorPagoSmp', 'recebedorTaxaPagaSmp', 'recebedorFormaPagamentoSmp', 'recebedorObservacaoSmp'].forEach((name) => form.elements[name]?.remove());
  form.querySelector('.cursista-smp-actions')?.replaceChildren();
  const actions = form.querySelector('.cursista-smp-actions');
  if (actions) actions.innerHTML = '<div><button type="submit">Salvar cadastro <span>→</span></button></div>';
  form.elements.nomeDele.required = true;
  form.elements.nomeDela.required = true;
  wireTypedDates(form, namedFieldSelector(coupleStudentDateFieldNames));
  form.querySelectorAll('[name="cpfDele"], [name="cpfDela"]').forEach((input) => input.addEventListener('input', () => { input.value = formatCpf(input.value); }));
  ['foneDele', 'foneDela', 'foneApresentante', 'foneFamiliar', 'foneEmergenciaEpc'].forEach((name) => {
    form.elements[name]?.addEventListener('blur', () => { form.elements[name].value = formatBrazilianPhone(form.elements[name].value); });
  });
  const kidsNotNeeded = form.elements.smpKidsNotNeeded;
  const kidsList = kidsNotNeeded?.closest('.choice-block')?.querySelector('.kids-list');
  kidsNotNeeded?.addEventListener('change', () => { if (kidsList) kidsList.hidden = kidsNotNeeded.checked; });
  form.querySelectorAll('[name^="smpKidNascimento"]').forEach((input) => input.addEventListener('change', () => {
    if (cursistaKidExceedsRetreatAgeLimit(context.retiro, input.value)) alert('Criança acima da idade permitida pra esse retiro');
  }));
  form.classList.add('shared-public-student-form');
  wireSharedPublicStudentSubmission(form, context, '#cursista-smp-message');
}

async function renderSharedPublicStudentRegistration() {
  try {
    const response = await fetch(publicStudentRegistrationApiUrl(), { cache: 'no-store' });
    const context = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(context.error || 'Link de cadastro não encontrado.');
    if (publicStudentRegistrationFileNumber && publicStudentRegistrationFileNumber !== Number(context.numeroFicha)) return publicStudentUnavailable('Link indisponível', 'O número da ficha não corresponde a este link.');
    if (context.cadastrado) return publicStudentUnavailable('Ficha já cadastrada', 'Este link já foi utilizado e não permite consultar ou editar os dados enviados.');
    if (context.inscricaoEncerrada) return publicStudentUnavailable('Inscrição encerrada', 'Este link não está mais disponível para cadastro.');
    if (!context.ativo) return publicStudentUnavailable('Cadastro indisponível', 'Este retiro não está recebendo cadastros por este link.');
    context.retiro = { ...(context.retiro || {}), tipoFichaCursista: context.tipoFichaCursista };
    retreats = [context.retiro];
    currentUser = { id: 'public-student', username: 'cadastro-publico', role: 'admin', perfilCodigo: 'admin', permissions: [], retiroIds: [context.retiro.id] };
    setSelectedRetreatId(context.retiro.id);
    document.body.classList.add('shared-public-student-mode');
    if (context.tipoFichaCursista === 'cursista-individual') return renderCursista({ publicContext: context });
    const active = context.tipoFichaCursista === 'cursista-epc' ? 'cursista-epc' : 'cursista-smp';
    renderCursistaSmpScreen({ title: active === 'cursista-epc' ? 'Cursista EPC' : 'Cursista SMP', active });
    attachStudentPhotoField(app.querySelector('#cursista-smp-form'), { type: active === 'cursista-epc' ? 'epc' : 'smp', publicMode: true, mountTarget: app.querySelector('.cursista-smp-file-number') });
    prepareSharedPublicCoupleStudentForm(context);
  } catch (error) {
    publicStudentUnavailable('Link indisponível', error.message || 'Confira o endereço recebido da equipe do retiro.');
  }
}

function renderCursistaSmpScreen({ title = 'Cursista SMP', active = 'cursista-smp' } = {}) {
  const yesNo = (name) => choices(name, ['Sim', 'Não'], false);
  const shirtChoices = (name) => choices(name, ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'], false);
  const dateInputAttributes = 'type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa"';
  const kidsAgeLimitLabel = retreatKidsAgeLimitLabel(selectedRetreat());
  const smpKidsFields = Array.from({ length: 5 }, (_, index) => {
    const kidNumber = index + 1;
    const row = `<div class="kids-row" data-smp-kid-row="${kidNumber}"><span>${kidNumber}</span><label class="field"><span>Nome</span><input name="smpKidNome${kidNumber}" placeholder="Nome da criança"></label><label class="field"><span>Data de nascimento</span><input name="smpKidNascimento${kidNumber}" ${dateInputAttributes}></label></div>`;
    if (!['cursista-smp', 'cursista-epc'].includes(active)) return row;
    return `<details class="smp-kid-panel" data-smp-kid-panel="${kidNumber}" ${index === 0 ? 'open' : ''}><summary><strong>Criança ${kidNumber}</strong><span class="smp-kid-summary-value">Não preenchida</span></summary>${row}</details>`;
  }).join('');
  layout(`<section class="page-heading cursista-smp-heading"><div><p class="eyebrow">Cadastro de cursista</p><h1>${escapeHtml(title)}</h1><p>Registre as informações necessárias para acolher e acompanhar o casal cursista.</p></div><button type="button" id="smp-financial-summary" class="primary-button">Resumo financeiro</button></section>
  <section class="admin-registration-tools cursista-smp-tools panel">
    <div class="cursista-smp-search-shell"><label class="field registration-search-field"><span>Busca</span><input id="cursista-smp-search" autocomplete="off" placeholder="Digite nome, CPF ou telefone"></label><div id="cursista-smp-search-results" class="registration-search-results" hidden></div></div>
    <div class="cursista-smp-tool-actions">
      <button type="button" id="new-cursista-smp">Incluir novo</button>
      <button type="button" id="edit-cursista-smp" class="secondary-button">Editar</button>
      <button type="button" id="print-cursista-smp" class="secondary-button" hidden>Imprimir ficha</button>
    </div>
  </section>
  <section class="panel cursista-smp-file-number">
    <label class="field"><span>Número da ficha</span><input name="numeroFichaSmp" type="text" inputmode="numeric" placeholder="Ex.: 001"></label>
  </section>
  <form id="cursista-smp-form" class="panel cursista-smp-form" autocomplete="off">
    <section class="cursista-smp-section">
      <div class="section-heading"><span>1.</span><div><h2>Dados do casal</h2></div></div>
      <div class="fields two-columns">
        <label class="field"><span>Nome dele</span><input name="nomeDele" placeholder="Digite o nome completo"></label>
        <label class="field"><span>Data de nascimento</span><input name="nascimentoDele" ${dateInputAttributes}></label>
        <label class="field"><span>Nome dela</span><input name="nomeDela" placeholder="Digite o nome completo"></label>
        <label class="field"><span>Data de nascimento</span><input name="nascimentoDela" ${dateInputAttributes}></label>
        <label class="field"><span>CPF dele</span><input name="cpfDele" inputmode="numeric" placeholder="000.000.000-00"></label>
        <label class="field"><span>CPF dela</span><input name="cpfDela" inputmode="numeric" placeholder="000.000.000-00"></label>
        <label class="field"><span>Profissão dele</span><input name="profissaoDele" placeholder="Digite a profissão"></label>
        <label class="field"><span>Profissão dela</span><input name="profissaoDela" placeholder="Digite a profissão"></label>
      </div>
    </section>
    <section class="cursista-smp-section">
      <div class="section-heading"><span>2.</span><div><h2>Endereço e contato</h2></div></div>
      <div class="fields cursista-smp-address">
        <label class="field"><span>CEP</span><input name="cep" inputmode="numeric" placeholder="00000-000"></label>
        <label class="field smp-address-line"><span>Endereço</span><input name="endereco" placeholder="Digite o endereço"></label>
        <label class="field"><span>Número</span><input name="numero" placeholder="Nº"></label>
        <label class="field"><span>Nr Apto</span><input name="nrApto" placeholder="Apto"></label>
        <label class="field"><span>Bairro</span><input name="bairro" placeholder="Digite o bairro"></label>
        <label class="field"><span>Cidade</span><input name="cidade" placeholder="Digite a cidade"></label>
        <label class="field"><span>Estado</span><input name="estadoSmp" maxlength="2" placeholder="SC"></label>
        <label class="field"><span>Fone dele</span><input name="foneDele" inputmode="tel" placeholder="(00) 00000-0000"></label>
        <label class="field"><span>Fone dela</span><input name="foneDela" inputmode="tel" placeholder="(00) 00000-0000"></label>
      </div>
    </section>
    <section class="cursista-smp-section">
      <div class="section-heading"><span>3.</span><div><h2>Vivência religiosa</h2></div></div>
      <div class="fields two-columns">
        <fieldset><legend>Crismado?</legend>${yesNo('crismaDele')}</fieldset>
        <fieldset><legend>Crismada?</legend>${yesNo('crismaDela')}</fieldset>
        <label class="field"><span>Religião dele</span><input name="religiaoDele" placeholder="Digite a religião"></label>
        <label class="field"><span>Religião dela</span><input name="religiaoDela" placeholder="Digite a religião"></label>
        <label class="field"><span>Participa das missas? Ele</span><input name="missaDele" placeholder="Informe a participação"></label>
        <label class="field"><span>Participa das missas? Ela</span><input name="missaDela" placeholder="Informe a participação"></label>
        <fieldset><legend>Pertence a movimento da Igreja? Ele</legend>${yesNo('movimentoIgrejaDele')}</fieldset>
        <label class="field"><span>Qual movimento dele?</span><input name="qualMovimentoDele" placeholder="Digite o movimento"></label>
        <fieldset><legend>Pertence a movimento da Igreja? Ela</legend>${yesNo('movimentoIgrejaDela')}</fieldset>
        <label class="field"><span>Qual movimento dela?</span><input name="qualMovimentoDela" placeholder="Digite o movimento"></label>
      </div>
    </section>
    <section class="cursista-smp-section">
      <div class="section-heading"><span>4.</span><div><h2>Filhos e casamento</h2></div></div>
      <div class="fields three-columns">
        <label class="field"><span>Data do 1º casamento dele</span><input name="casamentoDele" ${dateInputAttributes}></label>
        <label class="field"><span>Data do 1º casamento dela</span><input name="casamentoDela" ${dateInputAttributes}></label>
        <label class="field"><span>Data desta união do casal</span><input name="uniaoCasal" ${dateInputAttributes}></label>
        <label class="field"><span>Idade dos filhos do 1º casamento dele</span><input name="filhosDele" placeholder="Digite a idade"></label>
        <label class="field"><span>Idade dos filhos do 1º casamento dela</span><input name="filhosDela" placeholder="Digite a idade"></label>
        <label class="field"><span>Idade dos filhos desta união</span><input name="filhosUniao" placeholder="Digite a idade"></label>
        <fieldset><legend>Houve outras uniões?</legend>${yesNo('outrasUnioes')}</fieldset>
      </div>
    </section>
    <section class="cursista-smp-section">
      <div class="section-heading"><span>5.</span><div><h2>Espaço Kids</h2></div></div>
      <div class="choice-block smp-wide"><div class="kids-heading"><div class="kids-title-with-limit"><h3>Espaço Kids</h3><span class="kids-age-limit-label">${escapeHtml(kidsAgeLimitLabel)}</span></div><label><input type="checkbox" name="smpKidsNotNeeded"> Não necessita do Espaço Kids</label></div><p class="hint kids-hint">Informe o nome de suas crianças que utilizarão o Espaço Kids ou marque que não necessita. Deixe em branco as linhas não utilizadas.</p><div class="kids-list">${smpKidsFields}</div></div>
    </section>
    <section class="cursista-smp-section">
      <div class="section-heading"><span>6.</span><div><h2>Saúde e acolhimento</h2></div></div>
      <div class="fields two-columns">
        <fieldset><legend>Possui algum problema de saúde? Ele</legend>${yesNo('saudeDele')}</fieldset>
        <label class="field"><span>Qual?</span><input name="qualSaudeDele" placeholder="Digite o problema (opcional)"></label>
        <fieldset><legend>Possui algum problema de saúde? Ela</legend>${yesNo('saudeDela')}</fieldset>
        <label class="field"><span>Qual?</span><input name="qualSaudeDela" placeholder="Digite o problema (opcional)"></label>
        <fieldset><legend>Possui alguma intolerância alimentar? Ele</legend>${yesNo('intoleranciaAlimentarDele')}</fieldset>
        <label class="field"><span>Qual?</span><input name="qualIntoleranciaAlimentarDele" placeholder="Digite a intolerância (opcional)"></label>
        <fieldset><legend>Possui alguma intolerância alimentar? Ela</legend>${yesNo('intoleranciaAlimentarDela')}</fieldset>
        <label class="field"><span>Qual?</span><input name="qualIntoleranciaAlimentarDela" placeholder="Digite a intolerância (opcional)"></label>
        <fieldset class="smp-wide"><legend>Precisa de Acolhimento</legend>${yesNo('precisaAcolhimento')}</fieldset>
        <div class="smp-shirt-row smp-wide"><strong>Manequim / Camisa normal</strong><div class="smp-shirt-choice-line"><span>Ele</span>${shirtChoices('manequimDele')}</div><div class="smp-shirt-choice-line"><span>Ela</span>${shirtChoices('manequimDela')}</div></div>
      </div>
    </section>
    <section class="cursista-smp-section">
      <div class="section-heading"><span>7.</span><div><h2>Apresentante e origem</h2></div></div>
      <div class="fields two-columns">
        <label class="field"><span>Nome do apresentante</span><input name="nomeApresentante" placeholder="Digite o nome"></label>
        <label class="field"><span>Fone do apresentante</span><input name="foneApresentante" inputmode="tel" placeholder="(00) 00000-0000"></label>
        <label class="field"><span>Curso que fez o apresentante</span><input name="cursoApresentante" placeholder="Digite o curso"></label>
        <label class="field"><span>Cidade do apresentante</span><input name="cidadeApresentante" placeholder="Digite a cidade"></label>
        <label class="field smp-wide"><span>Paróquia que pertence o apresentante</span><input name="paroquiaApresentante" placeholder="Digite a paróquia"></label>
        <label class="field"><span>Nome de um familiar ou amigo</span><input name="familiarAmigo" placeholder="Digite o nome"></label>
        <label class="field"><span>Fone</span><input name="foneFamiliar" inputmode="tel" placeholder="(00) 00000-0000"></label>
      </div>
    </section>
    <section class="cursista-smp-section student-registration-value">
      <div class="section-heading"><span>8.</span><div><h2>Inscrição</h2><p>Informe os valores financeiros do cursista.</p></div></div>
      <div class="fields three-columns"><label class="field"><span>Valor da inscrição</span><input name="valorInscricaoSmp" type="text" inputmode="decimal" placeholder="R$ 0,00"></label><label class="field"><span>Valor pago</span><input name="valorPagoSmp" type="text" inputmode="decimal" readonly placeholder="R$ 0,00"><div class="student-payment-actions"><button type="button" id="set-smp-payment">Informar pagamento</button><button type="button" id="clear-smp-payment" hidden>Limpar</button></div><small class="student-payment-comment" hidden></small></label><label class="field"><span>Saldo a pagar</span><input name="saldoPagarSmp" type="text" readonly placeholder="R$ 0,00"></label></div><input type="hidden" name="recebedorValorPagoSmp"><input type="hidden" name="recebedorTaxaPagaSmp"><input type="hidden" name="recebedorFormaPagamentoSmp"><input type="hidden" name="recebedorObservacaoSmp">
    </section>
    <p id="cursista-smp-message" class="form-message"></p>
    <div class="form-actions cursista-smp-actions"><div><button type="button" id="save-cursista-smp">Salvar</button><button type="button" id="save-new-cursista-smp" class="secondary-button">Salvar e novo</button><button type="button" id="delete-cursista-smp" class="delete-registration" hidden>Excluir</button><button type="button" class="clear-student-form" id="cancel-cursista-smp">Cancelar</button></div></div>
  </form>`, active);
  if (!['cursista-smp', 'cursista-epc'].includes(active)) return;
  const markOwner = (owner, fieldNames = []) => {
    fieldNames.forEach((name) => {
      app.querySelectorAll(`[name="${name}"]`).forEach((input) => {
        const target = input.closest('.field, fieldset, .smp-shirt-choice-line, .kids-row, .choice-block');
        target?.classList.add(`smp-owner-${owner}`);
      });
    });
  };
  const markSectionOwner = (owner, fieldName) => {
    const section = app.querySelector(`[name="${fieldName}"]`)?.closest('.cursista-smp-section');
    section?.classList.add(`smp-owner-${owner}`);
  };
  const fieldBlock = (name) => {
    const input = app.querySelector(`[name="${name}"]`);
    if (['manequimDele', 'manequimDela'].includes(name)) {
      const shirtLine = input?.closest('.smp-shirt-choice-line');
      const shirtLabel = shirtLine?.querySelector(':scope > span');
      if (shirtLabel) shirtLabel.textContent = 'Manequim / Camisa normal';
      shirtLine?.classList.add('epc-shirt-choice-line');
      return shirtLine;
    }
    return input?.closest('.field, fieldset, .smp-shirt-row, .choice-block');
  };
  const fieldsBlock = (className, names = []) => {
    const block = document.createElement('div');
    block.className = className;
    names.forEach((name) => {
      const field = fieldBlock(name);
      if (field && !block.contains(field)) block.append(field);
    });
    return block;
  };
  const section = (number, titleText, block) => {
    const item = document.createElement('section');
    item.className = 'cursista-smp-section';
    item.innerHTML = `<div class="section-heading"><span>${number}.</span><div><h2>${titleText}</h2></div></div>`;
    item.append(block);
    return item;
  };
  app.querySelector('#cursista-smp-form')?.classList.add('smp-ownership-debug');
  app.querySelector('.cursista-smp-file-number')?.classList.add('smp-ownership-debug', 'smp-owner-common');
  markOwner('him', ['nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'crismaDele', 'religiaoDele', 'missaDele', 'movimentoIgrejaDele', 'qualMovimentoDele', 'casamentoDele', 'filhosDele', 'saudeDele', 'qualSaudeDele', 'intoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDele', 'manequimDele']);
  markOwner('her', ['nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'crismaDela', 'religiaoDela', 'missaDela', 'movimentoIgrejaDela', 'qualMovimentoDela', 'casamentoDela', 'filhosDela', 'saudeDela', 'qualSaudeDela', 'intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela', 'manequimDela']);
  markOwner('common', ['cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp', 'uniaoCasal', 'filhosUniao', 'outrasUnioes', 'smpKidsNotNeeded', 'smpKidNome1', 'smpKidNascimento1', 'smpKidNome2', 'smpKidNascimento2', 'smpKidNome3', 'smpKidNascimento3', 'smpKidNome4', 'smpKidNascimento4', 'smpKidNome5', 'smpKidNascimento5', 'precisaAcolhimento']);
  markSectionOwner('common', 'smpKidsNotNeeded');
  markSectionOwner('common', 'nomeApresentante');
  markSectionOwner('common', 'valorInscricaoSmp');
  if (active === 'cursista-smp') {
    app.querySelectorAll('.kids-row').forEach((row, index) => {
      const kidNumber = index + 1;
      const careQuestions = document.createElement('div');
      careQuestions.className = 'smp-kid-care';
      careQuestions.innerHTML = `
        <div class="smp-kid-care-row">
          <fieldset class="smp-owner-common"><legend>Possui algum problema de saúde?</legend>${yesNo(`smpKidProblemaSaude${kidNumber}`)}</fieldset>
          <label class="field smp-owner-common"><span>Descreva</span><input name="smpKidDescricaoSaude${kidNumber}" placeholder="Descreva o problema de saúde"></label>
        </div>
        <div class="smp-kid-care-row">
          <fieldset class="smp-owner-common"><legend>Possui alguma intolerância alimentar?</legend>${yesNo(`smpKidIntolerancia${kidNumber}`)}</fieldset>
          <label class="field smp-owner-common"><span>Descreva</span><input name="smpKidDescricaoIntolerancia${kidNumber}" placeholder="Descreva a intolerância alimentar"></label>
        </div>`;
      row.append(careQuestions);
    });
    const form = app.querySelector('#cursista-smp-form');
    const message = app.querySelector('#cursista-smp-message');
    const actions = app.querySelector('.cursista-smp-actions');
    const himFields = fieldsBlock('fields two-columns', ['nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'crismaDele', 'religiaoDele', 'missaDele', 'movimentoIgrejaDele', 'qualMovimentoDele', 'casamentoDele', 'filhosDele', 'saudeDele', 'qualSaudeDele', 'intoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDele', 'manequimDele']);
    const herFields = fieldsBlock('fields two-columns', ['nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'crismaDela', 'religiaoDela', 'missaDela', 'movimentoIgrejaDela', 'qualMovimentoDela', 'casamentoDela', 'filhosDela', 'saudeDela', 'qualSaudeDela', 'intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela', 'manequimDela']);
    const commonFields = fieldsBlock('fields two-columns cursista-smp-common-fields', ['cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp', 'uniaoCasal', 'filhosUniao', 'outrasUnioes', 'smpKidsNotNeeded', 'precisaAcolhimento', 'nomeApresentante', 'foneApresentante', 'cursoApresentante', 'cidadeApresentante', 'paroquiaApresentante', 'familiarAmigo', 'foneFamiliar', 'valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp']);
    commonFields.querySelectorAll(':scope > .field, :scope > fieldset, :scope > .choice-block').forEach((field) => {
      field.classList.add('smp-owner-common');
    });
    form.querySelectorAll('[type="hidden"]').forEach((input) => commonFields.append(input));
    form.querySelectorAll('.cursista-smp-section').forEach((item) => item.remove());
    form.classList.add('smp-three-section-layout');
    form.insertBefore(section('1', 'Informações dele', himFields), message);
    form.insertBefore(section('2', 'Informações dela', herFields), message);
    const commonSection = section('3', 'Informações em comum', commonFields);
    commonSection.classList.add('cursista-smp-common-section', 'student-registration-value');
    form.insertBefore(commonSection, message);
    if (actions) form.append(actions);
  }
  if (active === 'cursista-epc') {
    const form = app.querySelector('#cursista-smp-form');
    const message = app.querySelector('#cursista-smp-message');
    const actions = app.querySelector('.cursista-smp-actions');
    const hisConfirmationField = app.querySelector('[name="crismaDele"]')?.closest('fieldset');
    const herConfirmationField = app.querySelector('[name="crismaDela"]')?.closest('fieldset');
    const hisConfirmationLegend = hisConfirmationField?.querySelector('legend');
    const herConfirmationLegend = herConfirmationField?.querySelector('legend');
    if (hisConfirmationLegend) hisConfirmationLegend.textContent = 'É crismado?';
    if (herConfirmationLegend) herConfirmationLegend.textContent = 'É crismado?';
    hisConfirmationField?.classList.add('smp-owner-him');
    herConfirmationField?.classList.add('smp-owner-her');
    const himFields = fieldsBlock('fields two-columns', ['nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'crismaDele', 'movimentoIgrejaDele', 'qualMovimentoDele', 'saudeDele', 'qualSaudeDele', 'intoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDele', 'manequimDele']);
    const herFields = fieldsBlock('fields two-columns', ['nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'crismaDela', 'movimentoIgrejaDela', 'qualMovimentoDela', 'saudeDela', 'qualSaudeDela', 'intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela', 'manequimDela']);
    const commonFields = fieldsBlock('fields three-columns', ['cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp', 'uniaoCasal', 'smpKidsNotNeeded', 'precisaAcolhimento', 'nomeApresentante', 'foneApresentante', 'valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp']);
    const emailField = document.createElement('label');
    emailField.className = 'field smp-owner-common';
    emailField.innerHTML = '<span>E-mail</span><input name="emailEpc" type="email" autocomplete="email" placeholder="Digite o e-mail">';
    commonFields.querySelector('[name="estadoSmp"]')?.closest('.field')?.insertAdjacentElement('afterend', emailField);
    const marriageDateLabel = commonFields.querySelector('[name="uniaoCasal"]')?.closest('.field')?.querySelector('span');
    if (marriageDateLabel) marriageDateLabel.textContent = 'Data do casamento no religioso';
    const marriagePlaceField = document.createElement('label');
    marriagePlaceField.className = 'field smp-owner-common';
    marriagePlaceField.innerHTML = '<span>Local do casamento</span><input name="localCasamentoEpc" placeholder="Digite o local do casamento">';
    const marriageDateField = commonFields.querySelector('[name="uniaoCasal"]')?.closest('.field');
    const careField = commonFields.querySelector('[name="precisaAcolhimento"]')?.closest('fieldset');
    if (marriageDateField) marriageDateField.insertAdjacentElement('afterend', marriagePlaceField);
    if (careField) marriagePlaceField.insertAdjacentElement('afterend', careField);
    const hasChildrenField = document.createElement('fieldset');
    hasChildrenField.className = 'smp-owner-common';
    hasChildrenField.innerHTML = `<legend>Tem filhos?</legend>${yesNo('temFilhosEpc')}`;
    const childrenAgeField = document.createElement('label');
    childrenAgeField.className = 'field smp-owner-common';
    childrenAgeField.innerHTML = '<span>Idade dos filhos</span><input name="idadeFilhosEpc" placeholder="Digite a idade dos filhos">';
    if (careField) careField.insertAdjacentElement('afterend', hasChildrenField);
    hasChildrenField.insertAdjacentElement('afterend', childrenAgeField);
    const emergencyContactField = document.createElement('label');
    emergencyContactField.className = 'field smp-owner-common';
    emergencyContactField.innerHTML = '<span>Nome para caso de emergência - parentesco</span><input name="contatoEmergenciaEpc" placeholder="Digite o nome e o parentesco">';
    const emergencyPhoneField = document.createElement('label');
    emergencyPhoneField.className = 'field smp-owner-common';
    emergencyPhoneField.innerHTML = '<span>Fone para caso de emergência</span><input name="foneEmergenciaEpc" inputmode="tel" placeholder="(00) 00000-0000">';
    const presenterPhoneField = commonFields.querySelector('[name="foneApresentante"]')?.closest('.field');
    if (presenterPhoneField) presenterPhoneField.insertAdjacentElement('afterend', emergencyContactField);
    emergencyContactField.insertAdjacentElement('afterend', emergencyPhoneField);
    commonFields.querySelectorAll('.kids-row').forEach((row, index) => {
      const kidNumber = index + 1;
      const careQuestions = document.createElement('div');
      careQuestions.className = 'epc-kid-care';
      careQuestions.innerHTML = `
        <div class="epc-kid-care-row">
          <fieldset class="smp-owner-common"><legend>Possui algum problema de saúde?</legend>${yesNo(`smpKidProblemaSaude${kidNumber}Epc`)}</fieldset>
          <label class="field smp-owner-common"><span>Descreva</span><input name="smpKidDescricaoSaude${kidNumber}Epc" placeholder="Descreva o problema de saúde"></label>
        </div>
        <div class="epc-kid-care-row">
          <fieldset class="smp-owner-common"><legend>Possui alguma intolerância alimentar?</legend>${yesNo(`smpKidIntolerancia${kidNumber}Epc`)}</fieldset>
          <label class="field smp-owner-common"><span>Descreva</span><input name="smpKidDescricaoIntolerancia${kidNumber}Epc" placeholder="Descreva a intolerância alimentar"></label>
        </div>`;
      row.append(careQuestions);
    });
    commonFields.classList.add('cursista-epc-common-fields');
    const commonFieldSpans = {
      cep: 2,
      endereco: 5,
      numero: 1,
      nrApto: 2,
      bairro: 3,
      cidade: 3,
      estadoSmp: 2,
      emailEpc: 4,
      uniaoCasal: 3,
      localCasamentoEpc: 4,
      temFilhosEpc: 4,
      idadeFilhosEpc: 8,
      smpKidsNotNeeded: 12,
      precisaAcolhimento: 5,
      nomeApresentante: 9,
      foneApresentante: 3,
      contatoEmergenciaEpc: 9,
      foneEmergenciaEpc: 3,
      valorInscricaoSmp: 4,
      valorPagoSmp: 4,
      saldoPagarSmp: 4,
    };
    Object.entries(commonFieldSpans).forEach(([name, span]) => {
      const field = commonFields.querySelector(`[name="${name}"]`)?.closest('.field, fieldset, .choice-block');
      field?.classList.add(`epc-common-field-${name}`, `epc-common-span-${span}`);
    });
    commonFields.querySelectorAll(':scope > .field, :scope > fieldset, :scope > .choice-block').forEach((field) => {
      field.classList.add('smp-owner-common');
    });
    form.querySelectorAll('[type="hidden"]').forEach((input) => commonFields.append(input));
    form.querySelectorAll('.cursista-smp-section').forEach((item) => item.remove());
    form.classList.add('smp-three-section-layout');
    form.insertBefore(section('1', 'Informações dele', himFields), message);
    form.insertBefore(section('2', 'Informações dela', herFields), message);
    const commonSection = section('3', 'Informações em comum', commonFields);
    commonSection.classList.add('cursista-epc-common-section', 'student-registration-value');
    form.insertBefore(commonSection, message);
    if (actions) form.append(actions);
  }
}

async function setupCursistaSmpTestCrud({ expectedType = 'cursista-smp', permissionPrefix = 'cursista-smp', label = 'Cursista SMP', initialFileNumber = 0 } = {}) {
  const form = app.querySelector('#cursista-smp-form');
  if (!form) return;
  const photoController = attachStudentPhotoField(form, { type: expectedType === 'cursista-epc' ? 'epc' : 'smp', mountTarget: app.querySelector('.cursista-smp-file-number') });
  const retreat = selectedRetreat();
  const fileNumberInput = app.querySelector('[name="numeroFichaSmp"]');
  const searchInput = app.querySelector('#cursista-smp-search');
  const searchResults = app.querySelector('#cursista-smp-search-results');
  const message = app.querySelector('#cursista-smp-message');
  const saveButton = app.querySelector('#save-cursista-smp');
  const saveNewButton = app.querySelector('#save-new-cursista-smp');
  const editButton = app.querySelector('#edit-cursista-smp');
  const printButton = app.querySelector('#print-cursista-smp');
  const newButton = app.querySelector('#new-cursista-smp');
  const deleteButton = app.querySelector('#delete-cursista-smp');
  const cancelButton = app.querySelector('#cancel-cursista-smp');
  app.querySelector('.cursista-smp-tool-actions')?.append(deleteButton);
  const allFormControls = () => [...form.querySelectorAll('input, select, textarea'), fileNumberInput].filter(Boolean);
  const smpKidRadioNames = Array.from({ length: 5 }, (_, index) => [`smpKidProblemaSaude${index + 1}`, `smpKidIntolerancia${index + 1}`]).flat();
  const smpKidTextFields = Array.from({ length: 5 }, (_, index) => [`smpKidDescricaoSaude${index + 1}`, `smpKidDescricaoIntolerancia${index + 1}`]).flat();
  const epcKidRadioNames = Array.from({ length: 5 }, (_, index) => [`smpKidProblemaSaude${index + 1}Epc`, `smpKidIntolerancia${index + 1}Epc`]).flat();
  const epcKidTextFields = Array.from({ length: 5 }, (_, index) => [`smpKidDescricaoSaude${index + 1}Epc`, `smpKidDescricaoIntolerancia${index + 1}Epc`]).flat();
  const radioNames = ['crismaDele', 'crismaDela', 'movimentoIgrejaDele', 'movimentoIgrejaDela', 'outrasUnioes', 'saudeDele', 'saudeDela', 'intoleranciaAlimentarDele', 'intoleranciaAlimentarDela', 'precisaAcolhimento', 'temFilhosEpc', 'manequimDele', 'manequimDela', ...smpKidRadioNames, ...epcKidRadioNames];
  const textFields = ['nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'religiaoDele', 'missaDele', 'qualMovimentoDele', 'casamentoDele', 'filhosDele', 'qualSaudeDele', 'qualIntoleranciaAlimentarDele', 'nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'religiaoDela', 'missaDela', 'qualMovimentoDela', 'casamentoDela', 'filhosDela', 'qualSaudeDela', 'qualIntoleranciaAlimentarDela', 'cep', 'endereco', 'numero', 'nrApto', 'bairro', 'cidade', 'estadoSmp', 'emailEpc', 'uniaoCasal', 'localCasamentoEpc', 'idadeFilhosEpc', 'filhosUniao', 'smpKidNome1', 'smpKidNascimento1', 'smpKidNome2', 'smpKidNascimento2', 'smpKidNome3', 'smpKidNascimento3', 'smpKidNome4', 'smpKidNascimento4', 'smpKidNome5', 'smpKidNascimento5', ...smpKidTextFields, ...epcKidTextFields, 'nomeApresentante', 'foneApresentante', 'contatoEmergenciaEpc', 'foneEmergenciaEpc', 'cursoApresentante', 'cidadeApresentante', 'paroquiaApresentante', 'familiarAmigo', 'foneFamiliar', 'valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp', 'recebedorValorPagoSmp', 'recebedorFormaPagamentoSmp', 'recebedorObservacaoSmp'];
  const typedDateFields = coupleStudentDateFieldNames.filter((name) => form.elements[name]);
  const phoneFields = expectedType === 'cursista-epc'
    ? ['foneDele', 'foneDela', 'foneApresentante', 'foneEmergenciaEpc']
    : ['foneDele', 'foneDela', 'foneApresentante', 'foneFamiliar'];
  const cpfFields = ['cpfDele', 'cpfDela'];
  const activeCoupleStudentSource = coupleStudentSource(expectedType);
  const listCoupleStudents = activeCoupleStudentSource.list;
  const saveCoupleStudent = activeCoupleStudentSource.save;
  const deleteCoupleStudent = activeCoupleStudentSource.delete;
  const smpConditionalRequiredFields = [
    ['movimentoIgrejaDele', 'qualMovimentoDele'],
    ['movimentoIgrejaDela', 'qualMovimentoDela'],
    ['saudeDele', 'qualSaudeDele'],
    ['saudeDela', 'qualSaudeDela'],
    ['intoleranciaAlimentarDele', 'qualIntoleranciaAlimentarDele'],
    ['intoleranciaAlimentarDela', 'qualIntoleranciaAlimentarDela'],
  ];
  const smpRequiredTextFields = [
    'nomeDele', 'nascimentoDele', 'cpfDele', 'profissaoDele', 'foneDele', 'religiaoDele', 'missaDele',
    'nomeDela', 'nascimentoDela', 'cpfDela', 'profissaoDela', 'foneDela', 'religiaoDela', 'missaDela',
    'cep', 'endereco', 'numero', 'bairro',
    'cidade', 'estadoSmp', 'uniaoCasal', 'filhosUniao', 'nomeApresentante', 'foneApresentante',
    'cursoApresentante', 'cidadeApresentante', 'paroquiaApresentante', 'familiarAmigo', 'foneFamiliar',
    'valorInscricaoSmp',
  ];
  const smpRequiredChoiceFields = [
    'crismaDele', 'crismaDela', 'movimentoIgrejaDele', 'movimentoIgrejaDela', 'outrasUnioes',
    'saudeDele', 'saudeDela', 'intoleranciaAlimentarDele', 'intoleranciaAlimentarDela',
    'precisaAcolhimento', 'manequimDele', 'manequimDela',
  ];
  const setSmpRequiredMarker = (control, required) => {
    if (!control) return;
    const container = control.closest('.field, fieldset, .smp-shirt-choice-line');
    const label = container?.querySelector(':scope > span, :scope > legend');
    if (!label) return;
    let marker = label.querySelector(':scope > b[data-required-marker]');
    if (required && !marker) {
      marker = document.createElement('b');
      marker.dataset.requiredMarker = 'true';
      marker.textContent = '*';
      label.append(document.createTextNode(' '), marker);
    } else if (!required) marker?.remove();
  };
  const syncSmpRequiredRules = () => {
    if (expectedType !== 'cursista-smp') return;
    smpRequiredTextFields.forEach((name) => {
      const control = form.elements[name];
      if (!control) return;
      control.required = true;
      setSmpRequiredMarker(control, true);
    });
    smpRequiredChoiceFields.forEach((name) => {
      const controls = [...form.querySelectorAll(`[name="${name}"]`)];
      controls.forEach((control) => { control.required = true; });
      setSmpRequiredMarker(controls[0], true);
    });
    const values = new FormData(form);
    smpConditionalRequiredFields.forEach(([choiceName, detailName]) => {
      const detail = form.elements[detailName];
      if (!detail) return;
      const required = values.get(choiceName) === 'Sim';
      detail.required = required;
      setSmpRequiredMarker(detail, required);
    });
  };
  if (typedDateFields.length) wireTypedDates(form, namedFieldSelector(typedDateFields));
  let records = [];
  let selectedId = '';
  let searchRequest = 0;
  let searchOpen = false;
  const smpKidPanels = ['cursista-smp', 'cursista-epc'].includes(expectedType) ? [...form.querySelectorAll('[data-smp-kid-panel]')] : [];
  const smpKidPanelHasData = (panel) => [...panel.querySelectorAll('input, select, textarea')].some((control) => {
    if (['checkbox', 'radio'].includes(control.type)) return control.checked;
    return Boolean(String(control.value || '').trim());
  });
  const syncSmpKidPanels = ({ resetOpen = false } = {}) => {
    let firstPanelWithData = -1;
    smpKidPanels.forEach((panel, index) => {
      const kidNumber = panel.dataset.smpKidPanel;
      const name = String(form.elements[`smpKidNome${kidNumber}`]?.value || '').trim();
      const hasData = smpKidPanelHasData(panel);
      if (hasData && firstPanelWithData < 0) firstPanelWithData = index;
      const summary = panel.querySelector('.smp-kid-summary-value');
      if (summary) summary.textContent = name || (hasData ? 'Dados preenchidos' : 'Não preenchida');
    });
    if (!resetOpen || !smpKidPanels.length) return;
    const openIndex = firstPanelWithData >= 0 ? firstPanelWithData : 0;
    smpKidPanels.forEach((panel, index) => { panel.open = index === openIndex; });
  };
  const coupleKidsNotNeededInput = ['cursista-smp', 'cursista-epc'].includes(expectedType) ? form.elements.smpKidsNotNeeded : null;
  const smpKidsList = coupleKidsNotNeededInput?.closest('.choice-block')?.querySelector('.kids-list');
  const smpKidsHint = coupleKidsNotNeededInput?.closest('.choice-block')?.querySelector('.kids-hint');
  const clearSmpKidFields = () => {
    smpKidPanels.forEach((panel) => {
      panel.querySelectorAll('input, select, textarea').forEach((control) => {
        if (['checkbox', 'radio'].includes(control.type)) control.checked = false;
        else control.value = '';
        control.setCustomValidity?.('');
      });
    });
    syncChoiceStates(form);
    syncSmpKidPanels();
  };
  const syncSmpKidsNeedVisibility = ({ clearChildren = false } = {}) => {
    if (!coupleKidsNotNeededInput) return;
    const notNeeded = coupleKidsNotNeededInput.checked;
    if (notNeeded && clearChildren) clearSmpKidFields();
    smpKidsList?.classList.toggle('is-disabled', notNeeded);
    smpKidsList?.toggleAttribute('hidden', notNeeded);
    smpKidsHint?.toggleAttribute('hidden', notNeeded);
    if (notNeeded) smpKidPanels.forEach((panel) => { panel.open = false; });
    else syncSmpKidPanels({ resetOpen: true });
  };

  const setMessage = (text = '') => { if (message) message.textContent = text; };
  const canUseSmp = () => {
    if (!retreat) return `Selecione um retiro em foco antes de testar ${label}.`;
    if (retreat.tipoFichaCursista !== expectedType) return `O retiro em foco nao esta configurado como ${label}.`;
    if (!canModifyRetreat(retreat)) return `Retiro concluido: ${label} disponivel apenas para consulta.`;
    return '';
  };
  const canCreateSmp = () => canAccess(`${permissionPrefix}.criar`);
  const canEditSmp = () => canAccess(`${permissionPrefix}.editar`);
  const canDeleteSmp = () => canAccess(`${permissionPrefix}.excluir`);
  const smpPermissionMessage = (action) => `Voce nao tem permissao para ${action} ${label}.`;
  const actionBlockedReason = (permission, action) => canUseSmp() || (!canAccess(permission) ? smpPermissionMessage(action) : '');
  const idleNotice = () => canUseSmp();
  const setLocked = (locked) => {
    allFormControls().forEach((control) => { control.disabled = locked; });
    if (fileNumberInput && ['cursista-smp', 'cursista-epc'].includes(expectedType)) fileNumberInput.disabled = !retreat;
    const saveDisabled = locked || (selectedId ? !canEditSmp() : !canCreateSmp());
    saveButton.disabled = saveDisabled;
    saveNewButton.disabled = saveDisabled;
    deleteButton.disabled = Boolean(canUseSmp()) || !selectedId || !canDeleteSmp();
    app.querySelector('#set-smp-payment').disabled = saveDisabled;
    app.querySelector('#clear-smp-payment').disabled = saveDisabled;
    photoController?.setEditable(!saveDisabled);
  };
  const recalculateBalance = () => {
    const value = Math.max(0, parseCurrency(form.elements.valorInscricaoSmp?.value) - parseCurrency(form.elements.valorPagoSmp?.value));
    if (form.elements.saldoPagarSmp) form.elements.saldoPagarSmp.value = value > 0 ? currency(value) : currency(0);
  };
  const setSmpPaymentDetails = ({ method = '', observation = '', paidAmount = parseCurrency(form.elements.valorPagoSmp?.value) } = {}) => {
    form.elements.valorPagoSmp.value = paidAmount > 0 ? currency(paidAmount) : '';
    form.elements.recebedorValorPagoSmp.value = paidAmount > 0 ? paidAmount : 0;
    form.elements.recebedorTaxaPagaSmp.value = paidAmount > 0 ? 'true' : '';
    form.elements.recebedorFormaPagamentoSmp.value = paidAmount > 0 ? method : '';
    form.elements.recebedorObservacaoSmp.value = paidAmount > 0 ? observation : '';
    app.querySelector('#clear-smp-payment').hidden = paidAmount <= 0;
    recalculateBalance();
    renderStudentPaymentComment(form);
  };
  const promptSmpPayment = async () => {
    if (app.querySelector('#set-smp-payment')?.disabled || saveButton?.disabled) return;
    const paymentDetails = await askStudentPayment({
      nome: [form.elements.nomeDele?.value, form.elements.nomeDela?.value].map((name) => String(name || '').trim()).filter(Boolean).join(' e ') || label,
      paidAmount: parseCurrency(form.elements.valorPagoSmp?.value),
      currentMethod: form.elements.recebedorFormaPagamentoSmp?.value,
      currentObservation: form.elements.recebedorObservacaoSmp?.value,
    });
    if (!paymentDetails?.method) return;
    form.dataset.smpPaymentTouched = 'true';
    setSmpPaymentDetails({ method: paymentDetails.method, observation: paymentDetails.observation || '', paidAmount: paymentDetails.amount });
    setMessage('Pagamento informado. Clique em Salvar para gravar.');
  };
  const formatCpfField = (input) => {
    input.value = formatCpf(input.value);
    const cpf = normalizeCpf(input.value);
    input.setCustomValidity(cpf && cpf.length === 11 && !isValidCpf(cpf) ? 'Informe um CPF valido.' : '');
  };
  const clearForm = ({ unlock = false, focus = false, notice = '' } = {}) => {
    selectedId = '';
    photoController?.reset();
    form.reset();
    syncChoiceStates(form);
    form.querySelectorAll('input, select, textarea').forEach((control) => control.setCustomValidity?.(''));
    if (fileNumberInput) fileNumberInput.value = '';
    deleteButton.hidden = true;
    deleteButton.disabled = true;
    printButton.hidden = true;
    form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
    if (retreat?.valorInscricaoCursista && form.elements.valorInscricaoSmp) form.elements.valorInscricaoSmp.value = currency(retreat.valorInscricaoCursista);
    form.dataset.smpPaymentTouched = 'false';
    setSmpPaymentDetails({ paidAmount: 0 });
    syncSmpKidsNeedVisibility();
    syncSmpKidPanels({ resetOpen: true });
    syncSmpRequiredRules();
    setLocked(!unlock);
    setMessage(notice);
    if (focus) fileNumberInput?.focus();
  };
  const fillRadio = (name, value) => {
    form.querySelectorAll(`[name="${name}"]`).forEach((input) => { input.checked = input.value === value; });
  };
  const loadRecord = (record) => {
    selectedId = record.id || record.numeroFichaSmp || '';
    clearForm({ unlock: false });
    selectedId = record.id || record.numeroFichaSmp || '';
    if (fileNumberInput) fileNumberInput.value = record.numeroFichaSmp || record.id || '';
    textFields.forEach((name) => {
      if (!form.elements[name]) return;
      const value = record[name];
      if (['valorInscricaoSmp', 'valorPagoSmp', 'saldoPagarSmp', 'recebedorValorPagoSmp'].includes(name)) form.elements[name].value = currency(value);
      else if (cpfFields.includes(name)) form.elements[name].value = formatCpf(value);
      else if (phoneFields.includes(name)) form.elements[name].value = formatBrazilianPhone(value);
      else if (typedDateFields.includes(name)) form.elements[name].value = formatDateInput(value) || value || '';
      else form.elements[name].value = value || '';
    });
    const paidAmount = parseCurrency(record.valorPagoSmp);
    setSmpPaymentDetails({ method: record.recebedorFormaPagamentoSmp || '', observation: record.recebedorObservacaoSmp || '', paidAmount });
    radioNames.forEach((name) => fillRadio(name, record[name] || ''));
    if (form.elements.smpKidsNotNeeded) form.elements.smpKidsNotNeeded.checked = Boolean(record.smpKidsNotNeeded);
    syncChoiceStates(form);
    syncSmpKidPanels({ resetOpen: true });
    syncSmpKidsNeedVisibility();
    syncSmpRequiredRules();
    deleteButton.hidden = !canDeleteSmp();
    printButton.hidden = false;
    setLocked(true);
    setMessage(canUseSmp() || (!canEditSmp() ? `${label} carregado apenas para consulta.` : `${label} carregado. Clique em Editar para alterar.`));
    photoController?.load(record);
  };
  const normalizeSmpFileNumberLookup = (value) => {
    const fileNumber = String(value || '').trim();
    return /^\d+$/.test(fileNumber) ? String(Number(fileNumber)) : fileNumber;
  };
  const findRecordByFileNumber = (value) => {
    const target = normalizeSmpFileNumberLookup(value);
    if (!target) return null;
    return records.find((record) => [record.numeroFichaSmp, record.id]
      .some((fileNumber) => normalizeSmpFileNumberLookup(fileNumber) === target)) || null;
  };
  const consultFileNumber = async (value = fileNumberInput?.value) => {
    const typedFileNumber = String(value || '').trim();
    if (!typedFileNumber || !retreat?.id) return;
    if (!records.length) await refreshRecords();
    const record = findRecordByFileNumber(typedFileNumber);
    if (record) {
      loadRecord(record);
      searchInput.value = '';
      setMessage(`${label} carregado pela ficha ${record.numeroFichaSmp || record.id}.`);
      return;
    }
    setMessage(`Ficha ${typedFileNumber} não encontrada neste retiro.`);
  };
  const collectRecord = () => {
    const values = new FormData(form);
    const previousRecord = records.find((item) => item.id === selectedId || item.numeroFichaSmp === selectedId);
    const record = {
      ...(previousRecord || {}),
      retiroId: retreat?.id || '',
      id: String(fileNumberInput?.value || '').trim(),
      numeroFichaSmp: String(fileNumberInput?.value || '').trim(),
      previousId: selectedId || '',
      smpKidsNotNeeded: Boolean(form.elements.smpKidsNotNeeded?.checked),
      criadoEm: previousRecord?.criadoEm || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    textFields.forEach((name) => {
      if (form.elements[name]) record[name] = values.get(name) || '';
    });
    typedDateFields.forEach((name) => {
      if (form.elements[name]) record[name] = normalizeDateInput(record[name]);
    });
    phoneFields.forEach((name) => {
      if (form.elements[name]) record[name] = formatBrazilianPhone(record[name]);
    });
    radioNames.forEach((name) => {
      if (form.elements[name]) record[name] = values.get(name) || '';
    });
    if (record.smpKidsNotNeeded) {
      Array.from({ length: 5 }, (_, index) => index + 1).forEach((kidNumber) => {
        [`smpKidNome${kidNumber}`, `smpKidNascimento${kidNumber}`, `smpKidProblemaSaude${kidNumber}`, `smpKidDescricaoSaude${kidNumber}`, `smpKidIntolerancia${kidNumber}`, `smpKidDescricaoIntolerancia${kidNumber}`, `smpKidProblemaSaude${kidNumber}Epc`, `smpKidDescricaoSaude${kidNumber}Epc`, `smpKidIntolerancia${kidNumber}Epc`, `smpKidDescricaoIntolerancia${kidNumber}Epc`]
          .forEach((name) => { record[name] = ''; });
      });
    }
    record.cpfDele = normalizeCpf(record.cpfDele);
    record.cpfDela = normalizeCpf(record.cpfDela);
    record.valorInscricaoSmp = parseCurrency(record.valorInscricaoSmp);
    record.valorPagoSmp = parseCurrency(record.valorPagoSmp);
    record.saldoPagarSmp = Math.max(0, record.valorInscricaoSmp - record.valorPagoSmp);
    record.recebedorValorPagoSmp = parseCurrency(record.recebedorValorPagoSmp || record.valorPagoSmp);
    record.recebedorTaxaPagaSmp = record.recebedorValorPagoSmp > 0;
    record.recebedorFormaPagamentoSmp = record.recebedorValorPagoSmp > 0 ? String(record.recebedorFormaPagamentoSmp || '').trim() : '';
    record.recebedorObservacaoSmp = record.recebedorValorPagoSmp > 0 ? String(record.recebedorObservacaoSmp || '').trim() : '';
    return record;
  };
  const focusIssue = (control) => {
    const target = control?.closest('.field, fieldset, .cursista-smp-file-number') || control;
    target?.classList.add('field-warning');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => control?.focus({ preventScroll: true }), 180);
  };
  const firstSmpKidsIssue = () => {
    if (expectedType !== 'cursista-smp' || form.elements.smpKidsNotNeeded?.checked) return null;
    const usedPanels = smpKidPanels.filter(smpKidPanelHasData);
    if (!usedPanels.length) return form.elements.smpKidsNotNeeded;
    for (const panel of usedPanels) {
      const kidNumber = panel.dataset.smpKidPanel;
      const requiredNames = [`smpKidNome${kidNumber}`, `smpKidNascimento${kidNumber}`];
      const missingText = requiredNames.map((name) => form.elements[name]).find((control) => !String(control?.value || '').trim());
      if (missingText) return missingText;
      for (const [choiceName, detailName] of [
        [`smpKidProblemaSaude${kidNumber}`, `smpKidDescricaoSaude${kidNumber}`],
        [`smpKidIntolerancia${kidNumber}`, `smpKidDescricaoIntolerancia${kidNumber}`],
      ]) {
        const choice = new FormData(form).get(choiceName);
        if (!choice) return form.querySelector(`[name="${choiceName}"]`);
        if (choice === 'Sim' && !String(form.elements[detailName]?.value || '').trim()) return form.elements[detailName];
      }
    }
    return null;
  };
  const validateBeforeSave = () => {
    const blockedReason = canUseSmp();
    if (blockedReason) { setMessage(blockedReason); return false; }
    const nextId = String(fileNumberInput?.value || '').trim();
    const changingId = Boolean(selectedId && nextId && nextId !== selectedId);
    if (selectedId && !canEditSmp()) {
      setMessage(smpPermissionMessage('editar'));
      return false;
    }
    if (!selectedId && !canCreateSmp()) {
      setMessage(smpPermissionMessage('criar'));
      return false;
    }
    if (changingId && (!canCreateSmp() || !canDeleteSmp())) {
      setMessage(`Para alterar o Numero da ficha, o usuario precisa das permissoes criar e excluir ${label}.`);
      return false;
    }
    if (!String(fileNumberInput?.value || '').trim()) {
      setMessage('Informe o Numero da ficha para salvar.');
      focusIssue(fileNumberInput);
      return false;
    }
    const duplicated = records.find((record) => (record.id === nextId || record.numeroFichaSmp === nextId) && record.id !== selectedId);
    if (duplicated) {
      setMessage('Numero da ficha ja cadastrado neste retiro. Busque a ficha para editar.');
      focusIssue(fileNumberInput);
      return false;
    }
    syncSmpRequiredRules();
    const invalidCpf = cpfFields.map((name) => form.elements[name]).find((input) => {
      const cpf = normalizeCpf(input?.value || '');
      return expectedType === 'cursista-smp' ? !isValidCpf(cpf) : (cpf && cpf.length === 11 && !isValidCpf(cpf));
    });
    if (invalidCpf) {
      setMessage('Revise o CPF informado antes de salvar.');
      focusIssue(invalidCpf);
      return false;
    }
    const invalidDate = typedDateFields
      .map((name) => form.elements[name])
      .find((input) => String(input?.value || '').trim() && !normalizeDateInput(input.value));
    if (invalidDate) {
      invalidDate.setCustomValidity('Digite a data no formato dd/mm/aaaa.');
      setMessage('Revise a data informada. Use o formato dd/mm/aaaa.');
      focusIssue(invalidDate);
      return false;
    }
    const kidsIssue = firstSmpKidsIssue();
    const requiredIssue = kidsIssue || form.querySelector(':invalid');
    if (!form.checkValidity() || requiredIssue) {
      setMessage(kidsIssue
        ? 'Informe os dados das criancas que usarao o Espaco Kids ou marque que nao necessita.'
        : 'Revise todos os campos obrigatorios antes de salvar.');
      focusIssue(requiredIssue);
      return false;
    }
    return true;
  };
  const refreshRecords = async () => {
    records = retreat?.id ? await listCoupleStudents(retreat.id) : [];
    return records;
  };
  const nextCoupleStudentFileNumber = () => {
    const used = new Set(records
      .map((record) => Number(record.id || record.numeroFichaSmp))
      .filter((number) => Number.isInteger(number) && number > 0));
    let next = 1;
    while (used.has(next)) next += 1;
    return String(next);
  };
  const suggestCoupleStudentFileNumber = async () => {
    await refreshRecords();
    if (fileNumberInput) fileNumberInput.value = nextCoupleStudentFileNumber();
  };
  const hideSearch = () => {
    searchOpen = false;
    searchRequest += 1;
    searchResults.hidden = true;
  };
  const renderSearch = async () => {
    searchOpen = true;
    const currentRequest = ++searchRequest;
    const term = normalizeText(searchInput.value);
    const list = records.length ? records : await refreshRecords();
    const filtered = list
      .filter((record) => {
        const cpfDele = normalizeCpf(record.cpfDele);
        const cpfDela = normalizeCpf(record.cpfDela);
        const haystack = normalizeText([record.id, record.numeroFichaSmp, record.nomeDele, record.nomeDela, cpfDele, cpfDela, cpfDele && formatCpf(cpfDele), cpfDela && formatCpf(cpfDela), record.foneDele, record.foneDela].filter(Boolean).join(' '));
        return !term || haystack.includes(term);
      })
      .sort((first, second) => String(first.id || '').localeCompare(String(second.id || ''), 'pt-BR', { numeric: true }));
    if (!searchOpen || currentRequest !== searchRequest) return;
    searchResults.hidden = false;
    searchResults.innerHTML = filtered.length ? filtered.map((record) => {
      const coupleName = [record.nomeDele, record.nomeDela].map((name) => String(name || '').trim()).filter(Boolean).join(' e ') || 'Sem nomes informados';
      const fileNumber = record.numeroFichaSmp || record.id || '';
      return `<article><button type="button" class="student-search-choice" data-smp-select="${escapeHtml(record.id)}"><div class="student-search-choice-heading"><strong class="student-search-choice-name">${escapeHtml(coupleName)}</strong><span class="student-search-choice-file-number">Ficha ${escapeHtml(fileNumber)}</span></div></button></article>`;
    }).join('') : `<p>Nenhuma ficha ${escapeHtml(label)} encontrada neste retiro.</p>`;
    searchResults.querySelectorAll('[data-smp-select]').forEach((button) => button.addEventListener('click', () => {
      const record = records.find((item) => item.id === button.dataset.smpSelect);
      if (!record) return;
      hideSearch();
      searchInput.value = '';
      loadRecord(record);
    }));
  };
  const saveRecord = async ({ clearAfter = false } = {}) => {
    if (!validateBeforeSave()) return;
    recalculateBalance();
    const record = collectRecord();
    const previousId = selectedId;
    setMessage(`Salvando ${label}...`);
    try {
      const saved = await saveCoupleStudent(record);
      if (photoController?.hasPending()) await photoController.uploadLogged(saved);
      if (previousId && previousId !== saved.id) await deleteCoupleStudent(retreat.id, previousId);
      await refreshRecords();
      if (clearAfter) {
        clearForm({ unlock: true, focus: true, notice: `${label} salvo com sucesso. Informe a proxima ficha.` });
        if (fileNumberInput) fileNumberInput.value = nextCoupleStudentFileNumber();
        return;
      }
      clearForm({ unlock: false, notice: `${label} salvo com sucesso.` });
    } catch (error) {
      setMessage(error.message || `Nao foi possivel salvar ${label}.`);
    }
  };

  wireCepLookup(form);
  coupleKidsNotNeededInput?.addEventListener('change', () => {
    if (!coupleKidsNotNeededInput.checked) {
      syncSmpKidsNeedVisibility();
      return;
    }
    const hasRegisteredKid = smpKidPanels.some(smpKidPanelHasData);
    if (hasRegisteredKid && !confirm('Esta ação limpará todos os dados das crianças desta ficha quando ela for salva. Deseja continuar?')) {
      coupleKidsNotNeededInput.checked = false;
      syncSmpKidsNeedVisibility();
      return;
    }
    syncSmpKidsNeedVisibility({ clearChildren: true });
    if (hasRegisteredKid) setMessage('Dados das crianças removidos do formulário. Clique em Salvar para confirmar a alteração.');
  });
  const syncChangedSmpKidPanel = (event) => {
    if (event.target.closest('[data-smp-kid-panel]')) syncSmpKidPanels();
  };
  form.addEventListener('input', syncChangedSmpKidPanel);
  form.addEventListener('change', syncChangedSmpKidPanel);
  form.addEventListener('input', (event) => event.target.closest('.field, fieldset, .choice-block')?.classList.remove('field-warning'));
  form.addEventListener('change', (event) => {
    event.target.closest('.field, fieldset, .choice-block')?.classList.remove('field-warning');
    syncSmpRequiredRules();
  });
  form.querySelectorAll('[name^="smpKidNascimento"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (cursistaKidExceedsRetreatAgeLimit(retreat, input.value)) {
        alert('Criança acima da idade permitida pra esse retiro');
      }
    });
  });
  syncSmpKidPanels({ resetOpen: true });
  syncSmpKidsNeedVisibility();
  syncSmpRequiredRules();
  form.elements.estadoSmp?.addEventListener('input', () => { form.elements.estadoSmp.value = form.elements.estadoSmp.value.toUpperCase().slice(0, 2); });
  cpfFields.forEach((name) => {
    const input = form.elements[name];
    if (!input) return;
    input.maxLength = 14;
    input.pattern = '\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}|\\d{11}';
    input.title = 'Informe um CPF válido';
    input.addEventListener('input', () => formatCpfField(input));
    input.addEventListener('change', () => formatCpfField(input));
  });
  phoneFields.forEach((name) => {
    const input = form.elements[name];
    if (!input) return;
    input.maxLength = 15;
    input.addEventListener('blur', () => { input.value = formatBrazilianPhone(input.value); });
  });
  if (fileNumberInput && ['cursista-smp', 'cursista-epc'].includes(expectedType)) {
    let fileNumberLookupTimer = 0;
    const runFileNumberLookup = () => consultFileNumber().catch((error) => {
      setMessage(error.message || `Não foi possível consultar a ficha ${label}.`);
    });
    const scheduleFileNumberLookup = () => {
      fileNumberInput.value = fileNumberInput.value.replace(/\D/g, '');
      clearTimeout(fileNumberLookupTimer);
      if (!fileNumberInput.value) return;
      fileNumberLookupTimer = setTimeout(runFileNumberLookup, 450);
    };
    fileNumberInput.addEventListener('input', scheduleFileNumberLookup);
    fileNumberInput.addEventListener('change', () => {
      clearTimeout(fileNumberLookupTimer);
      runFileNumberLookup();
    });
    fileNumberInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      clearTimeout(fileNumberLookupTimer);
      runFileNumberLookup();
    });
  }
  ['valorInscricaoSmp'].forEach((name) => {
    const input = form.elements[name];
    input?.addEventListener('focus', () => { input.value = parseCurrency(input.value) || ''; });
    input?.addEventListener('input', recalculateBalance);
    input?.addEventListener('change', () => { input.value = currency(parseCurrency(input.value)); recalculateBalance(); });
  });
  app.querySelector('#set-smp-payment')?.addEventListener('click', promptSmpPayment);
  app.querySelector('#clear-smp-payment')?.addEventListener('click', () => {
    form.dataset.smpPaymentTouched = 'true';
    setSmpPaymentDetails({ paidAmount: 0 });
    setMessage('Pagamento removido. Clique em Salvar para gravar.');
  });
  form.elements.saldoPagarSmp.readOnly = true;
  saveButton.addEventListener('click', () => saveRecord());
  saveNewButton.addEventListener('click', () => saveRecord({ clearAfter: true }));
  newButton.addEventListener('click', async () => {
    const blockedReason = actionBlockedReason(`${permissionPrefix}.criar`, 'criar');
    if (blockedReason) { setMessage(blockedReason); return; }
    try {
      await suggestCoupleStudentFileNumber();
      clearForm({ unlock: true, focus: true, notice: `Nova ficha ${label}.` });
      if (fileNumberInput) fileNumberInput.value = nextCoupleStudentFileNumber();
    } catch (error) {
      setMessage(error.message || `Nao foi possivel sugerir o numero da ficha ${label}.`);
    }
  });
  editButton.addEventListener('click', () => {
    const blockedReason = actionBlockedReason(`${permissionPrefix}.editar`, 'editar');
    if (blockedReason) { setMessage(blockedReason); return; }
    if (!selectedId) { setMessage(`Busque e selecione uma ficha ${label} para editar.`); return; }
    printButton.hidden = true;
    setLocked(false);
    setMessage(`Editando ${label}.`);
    fileNumberInput?.focus();
  });
  cancelButton.addEventListener('click', () => {
    const current = records.find((item) => item.id === selectedId);
    if (current) loadRecord(current);
    else clearForm({ unlock: false, notice: idleNotice() });
  });
  printButton.addEventListener('click', () => {
    const record = records.find((item) => item.id === selectedId || item.numeroFichaSmp === selectedId);
    if (!record) { setMessage(`Busque e selecione uma ficha ${label} para imprimir.`); return; }
    printStudentRegistrationSheet({ retreat, record, studentFormType: expectedType });
  });
  deleteButton.addEventListener('click', async () => {
    const blockedReason = actionBlockedReason(`${permissionPrefix}.excluir`, 'excluir');
    if (blockedReason) { setMessage(blockedReason); return; }
    if (!selectedId || !confirm(`Excluir a ficha ${label} ${selectedId}?`)) return;
    const deletingId = selectedId;
    deleteButton.disabled = true;
    setMessage(`Excluindo ${label}...`);
    try {
      await deleteCoupleStudent(retreat.id, deletingId);
      await refreshRecords();
      if (records.some((record) => record.id === deletingId || record.numeroFichaSmp === deletingId)) {
        throw new Error('A ficha ainda aparece na lista apos a exclusao.');
      }
      clearForm({ unlock: false, notice: `${label} excluido com sucesso.` });
    } catch (error) {
      deleteButton.disabled = false;
      setMessage(error.message || `Nao foi possivel excluir ${label}.`);
    }
  });
  searchInput.addEventListener('focus', renderSearch);
  searchInput.addEventListener('input', renderSearch);
  document.addEventListener('pointerdown', (event) => {
    if (!searchInput.closest('.registration-search-field')?.contains(event.target) && !searchResults.contains(event.target)) hideSearch();
  }, true);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveRecord();
  });

  setLocked(true);
  try {
    await refreshRecords();
    const blockedReason = canUseSmp();
    newButton.disabled = Boolean(blockedReason) || !canCreateSmp();
    editButton.disabled = Boolean(blockedReason) || !canEditSmp();
    const requestedFileNumber = String(initialFileNumber || '').trim();
    if (requestedFileNumber) {
      const record = findRecordByFileNumber(requestedFileNumber);
      if (record) {
        loadRecord(record);
        setMessage(`${label} carregado pela ficha ${record.numeroFichaSmp || record.id}.`);
      } else if (!blockedReason && canCreateSmp()) {
        clearForm({ unlock: true, focus: false, notice: `Nova ficha ${requestedFileNumber} - ${label}.` });
        if (fileNumberInput) fileNumberInput.value = requestedFileNumber;
      } else {
        if (fileNumberInput) fileNumberInput.value = requestedFileNumber;
        setMessage(blockedReason || smpPermissionMessage('cadastrar'));
      }
    } else setMessage(blockedReason || idleNotice());
  } catch (error) {
    setMessage(error.message || `Nao foi possivel carregar as fichas ${label}.`);
    newButton.disabled = true;
    editButton.disabled = true;
  }
}

function setupCoupleStudentFinancialSummary(studentFormType = 'cursista-smp') {
  const retreat = selectedRetreat();
  const source = coupleStudentSource(studentFormType);
  const usesEpc = source.type === 'cursista-epc';
  const label = source.label;
  const listCoupleStudents = source.list;
  wireFinancialSummaryButton({
    buttonSelector: '#smp-financial-summary',
    title: `Resumo financeiro dos casais ${label}${retreat ? ` - ${retreat.nome}` : ''}`,
    eyebrow: label,
    description: `Valores buscados somente nas fichas ${label}.`,
    firstColumnLabel: 'Casal cursista',
    emptyMessage: `Nenhuma ficha ${usesEpc ? 'EPC' : 'SMP'} encontrada neste retiro.`,
    filenameFallback: `resumo-financeiro-${usesEpc ? 'cursista-epc' : 'cursista-smp'}`,
    loadRows: async () => {
      if (!retreat?.id) return [];
      const records = await listCoupleStudents(retreat.id);
      return records
        .filter((record) => !record.retiroId || record.retiroId === retreat.id)
        .map((record) => {
          const names = [record.nomeDele, record.nomeDela].map((name) => String(name || '').trim()).filter(Boolean);
          const valorInscricao = parseCurrency(record.valorInscricaoSmp);
          const valorPago = parseCurrency(record.valorPagoSmp);
          const saldoInformado = parseCurrency(record.saldoPagarSmp);
          const saldoPagar = record.saldoPagarSmp ? saldoInformado : Math.max(0, valorInscricao - valorPago);
          const fileNumber = String(record.numeroFichaSmp || record.id || '').trim();
          return {
            nome: names.join(' e ') || 'Sem nomes informados',
            detalhe: fileNumber ? `Ficha ${fileNumber}` : 'Ficha sem número',
            valorInscricao,
            valorPago,
            saldoPagar,
            formaPagamento: record.recebedorFormaPagamentoSmp || '',
            observacao: record.recebedorObservacaoSmp || '',
          };
        })
        .sort((first, second) => first.nome.localeCompare(second.nome, 'pt-BR', { sensitivity: 'base' }));
    },
  });
}

async function renderCursistaSmp(initialFileNumber = 0) {
  renderCursistaSmpScreen({ title: 'Cursista SMP', active: 'cursista-smp' });
  setupCoupleStudentFinancialSummary('cursista-smp');
  await setupCursistaSmpTestCrud({ expectedType: 'cursista-smp', permissionPrefix: 'cursista-smp', label: 'Cursista SMP', initialFileNumber });
}

async function renderCursistaEpc(initialFileNumber = 0) {
  renderCursistaSmpScreen({ title: 'Cursista EPC', active: 'cursista-epc' });
  setupCoupleStudentFinancialSummary('cursista-epc');
  await setupCursistaSmpTestCrud({ expectedType: 'cursista-epc', permissionPrefix: 'cursista-epc', label: 'Cursista EPC', initialFileNumber });
}

async function renderCursista({ publicContext = null } = {}) {
  const yesNo = (name) => choices(name, ['Sim', 'Não'], false);
  const focusStudentRetreat = selectedRetreat();
  const canEditStudentRetreat = canModifyRetreat(focusStudentRetreat);
  const badgeNameField = publicContext ? '' : '<label class="field full"><span>Nome para crach&aacute;</span><input name="nomeCracha" autocomplete="off"></label>';
  layout(`<section class="page-heading student-page-heading"><div><h1>Cursista individual</h1><p>Registre as informações necessárias para acolher e acompanhar o cursista.</p></div><button type="button" id="student-financial-summary" class="primary-button">Resumo financeiro</button></section><section class="admin-registration-tools student-registration-tools panel"><div class="panel-heading"><div><h2>Cadastro</h2><p>Busque por nome, CPF ou telefone para editar ou consultar a ficha do retiro em foco.</p></div><div class="student-registration-actions"><button type="button" id="new-student">Incluir novo</button></div></div><label class="field registration-search-field"><span>Busca</span><input id="student-search" autocomplete="off" placeholder="Digite nome, CPF ou telefone"></label><div id="student-search-results" class="registration-search-results" hidden></div></section><section class="panel student-file-number"><label class="field"><span>Número da ficha</span><input type="text" inputmode="numeric" placeholder="Sem número definido" readonly aria-label="Número da ficha apenas visual"></label></section><form id="student-form" class="panel student-form">${stateDatalist()}<section class="form-section"><div class="section-heading student-personal-heading"><span>01</span><div><h2>Dados pessoais</h2><p>Informações básicas de identificação e contato.</p></div><div class="student-heading-actions" hidden><button type="button" id="edit-selected-student">Editar</button><button type="button" id="print-selected-student" class="secondary-button">Imprimir ficha</button><button type="button" id="delete-selected-student">Excluir</button></div></div><div class="fields two-columns"><label class="field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field full"><span>Nome completo <b>*</b></span><input name="nome" required></label>${badgeNameField}<label class="field"><span>Data de nascimento <b>*</b></span><input name="nascimento" type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa" required></label><label class="field"><span>Telefone <b>*</b></span><input name="telefone" required></label></div></section><section class="form-section"><div class="section-heading"><span>02</span><div><h2>Endereço</h2></div></div><div class="fields address-fields"><label class="field"><span>CEP <b>*</b></span><input name="cep" inputmode="numeric" placeholder="00000-000" required></label><label class="field street-field"><span>Rua <b>*</b></span><input name="rua" required></label><label class="field number-field"><span>Número <b>*</b></span><input name="numero" required></label><label class="field"><span>Bairro <b>*</b></span><input name="bairro" required></label><label class="field"><span>Cidade <b>*</b></span><input name="cidade" required></label><label class="field"><span>Estado <b>*</b></span><input name="estado" maxlength="2" required></label></div></section><section class="form-section"><div class="section-heading"><span>03</span><div><h2>Formação e vivência</h2></div></div><div class="student-questions"><fieldset><legend>É batizado(a)? <b>*</b></legend>${yesNo('batizado')}</fieldset><fieldset><legend>Fez primeira comunhão? <b>*</b></legend>${yesNo('primeiraComunhao')}</fieldset><fieldset><legend>Estuda? <b>*</b></legend>${yesNo('estuda')}<div class="fields two-columns"><label class="field"><span>Série</span><input name="serie"></label><label class="field"><span>Escola</span><input name="escola"></label></div></fieldset><fieldset><legend>Fez algum retiro? <b>*</b></legend>${yesNo('fezRetiro')}<label class="field"><span>Qual?</span><input name="qualRetiro"></label></fieldset></div></section><section class="form-section"><div class="section-heading"><span>04</span><div><h2>Família e convite</h2></div></div><div class="fields two-columns"><label class="field"><span>Nome do pai</span><input name="nomePai"></label><label class="field"><span>Telefone de contato</span><input name="telefonePai"></label><label class="field"><span>Nome da mãe</span><input name="nomeMae"></label><label class="field"><span>Telefone de contato</span><input name="telefoneMae"></label></div><fieldset class="student-fieldset"><legend>Os pais participam de algum movimento na igreja? <b>*</b></legend>${yesNo('paisMovimento')}<label class="field"><span>Qual?</span><input name="qualMovimento"></label></fieldset><div class="fields"><label class="field"><span>Quem o(a) convidou?</span><input name="convidou"></label><fieldset class="student-fieldset full"><legend>Tamanho da camiseta <b>*</b></legend>${choices('camiseta', ['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'], false)}</fieldset></div></section><section class="form-section"><div class="section-heading"><span>05</span><div><h2>Saúde e cuidados</h2></div></div><div class="student-questions"><fieldset><legend>Tem intolerância a alimentos? <b>*</b></legend>${yesNo('intoleranciaAlimentos')}<label class="field"><span>Qual?</span><input name="qualIntolerancia"></label></fieldset><fieldset><legend>É alérgico(a) a algum medicamento? <b>*</b></legend>${yesNo('alergiaMedicamento')}<label class="field"><span>Qual?</span><input name="qualAlergia"></label></fieldset></div><div class="fields two-columns"><label class="field"><span>Medicamento para dor de cabeça</span><input name="medicamentoCabeca"></label><label class="field"><span>Medicamento para dor no estômago</span><input name="medicamentoEstomago"></label></div></section><p id="student-message" class="form-message"></p><div class="form-actions"><p><b>*</b> Campos obrigatórios</p><button type="submit">Salvar cadastro <span>→</span></button></div></form>`, 'cursista');
  const form = app.querySelector('#student-form');
  const photoController = attachStudentPhotoField(form, { type: 'individual', publicMode: Boolean(publicContext), mountTarget: app.querySelector('.student-file-number') });
  app.querySelector('.student-registration-actions')?.append(app.querySelector('.student-heading-actions'));
  const studentFileNumberInput = app.querySelector('.student-file-number input');
  if (studentFileNumberInput) {
    studentFileNumberInput.name = 'numeroFichaIndividual';
    studentFileNumberInput.required = true;
    studentFileNumberInput.readOnly = false;
    studentFileNumberInput.placeholder = 'Ex.: 001';
    studentFileNumberInput.setAttribute('aria-label', 'Número da ficha');
    const fileNumberLabel = studentFileNumberInput.closest('.field')?.querySelector('span');
    if (fileNumberLabel) fileNumberLabel.innerHTML = 'Número da ficha <b>*</b>';
  }
  const studentMain = app.querySelector('.admin-main, .shared-public-student-shell');
  studentMain?.classList.add('student-screen');
  const studentHeadingIntro = app.querySelector('.student-page-heading>div');
  if (focusStudentRetreat && studentHeadingIntro) {
    studentHeadingIntro.insertAdjacentHTML('beforeend', `<small class="student-retreat-context">Retiro em foco: <strong>${escapeHtml(focusStudentRetreat.nome || 'Retiro')}</strong></small>`);
  }
  const studentStepLabels = ['Dados pessoais', 'Endereço', 'Formação e vivência', 'Família e convite', 'Saúde e cuidados', 'Inscrição'];
  const studentSections = [...form.querySelectorAll(':scope > .form-section')];
  const studentWorkspace = document.createElement('div');
  studentWorkspace.className = 'student-form-workspace';
  form.before(studentWorkspace);
  studentWorkspace.append(form);
  const studentStepper = document.createElement('nav');
  studentStepper.className = 'student-form-stepper';
  studentStepper.setAttribute('aria-label', 'Etapas do cadastro de cursista');
  studentStepper.innerHTML = studentSections.map((section, index) => {
    const label = studentStepLabels[index] || section.querySelector('h2')?.textContent || `Etapa ${index + 1}`;
    section.id = `student-form-step-${index + 1}`;
    section.dataset.studentFormStep = String(index);
    return `<button type="button" data-student-step="${index}" class="${index === 0 ? 'is-active' : ''}" ${index === 0 ? 'aria-current="step"' : ''}><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(label)}</strong></button>`;
  }).join('');
  studentWorkspace.prepend(studentStepper);
  const setActiveStudentStep = (index) => {
    studentStepper.querySelectorAll('[data-student-step]').forEach((button) => {
      const active = Number(button.dataset.studentStep) === index;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
  };
  studentStepper.addEventListener('click', (event) => {
    const button = event.target.closest('[data-student-step]');
    if (!button) return;
    const index = Number(button.dataset.studentStep);
    setActiveStudentStep(index);
    studentSections[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  form.addEventListener('focusin', (event) => {
    const section = event.target.closest('[data-student-form-step]');
    if (section) setActiveStudentStep(Number(section.dataset.studentFormStep));
  });
  form.querySelector('input[name="qualAlergia"]')?.closest('fieldset')?.insertAdjacentHTML('afterend', `<fieldset><legend>Toma medicamento de forma contínua? <b>*</b></legend>${yesNo('medicamentoContinuo')}<label class="field"><span>Qual?</span><input name="qualMedicamentoContinuo"></label></fieldset>`);
  if (!canEditStudentRetreat) {
    app.querySelector('#new-student')?.remove();
    app.querySelector('#student-message').textContent = 'Retiro concluido: cadastro de cursistas disponivel apenas para consulta.';
  }
  wireStateFields(form);
  wireCepLookup(form);
  wireCpfFields(form);
  wireTypedDates(form, namedFieldSelector(['nascimento']));
  const clearStudentWarning = (event) => event.target.closest('.field, .choice-block, fieldset, .form-section')?.classList.remove('field-warning');
  form.addEventListener('input', clearStudentWarning);
  form.addEventListener('change', clearStudentWarning);
  studentFileNumberInput?.addEventListener('input', clearStudentWarning);
  studentFileNumberInput?.addEventListener('change', clearStudentWarning);
  const focusStudentIssue = (control) => {
    if (!control) return;
    const target = control.closest('.field, .choice-block, fieldset, .form-section') || control;
    form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
    target.classList.add('field-warning');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => control.focus({ preventScroll: true }), 180);
  };
  const firstStudentRequiredIssue = () => {
    const values = new FormData(form);
    const requiredChoices = ['batizado', 'primeiraComunhao', 'estuda', 'fezRetiro', 'paisMovimento', 'camiseta', 'intoleranciaAlimentos', 'alergiaMedicamento', 'medicamentoContinuo'];
    const missingChoice = requiredChoices.find((name) => !values.get(name));
    if (missingChoice) return form.querySelector(`[name="${missingChoice}"]`);
    if (values.get('intoleranciaAlimentos') === 'Sim' && !String(values.get('qualIntolerancia') || '').trim()) return form.elements.qualIntolerancia;
    if (values.get('alergiaMedicamento') === 'Sim' && !String(values.get('qualAlergia') || '').trim()) return form.elements.qualAlergia;
    if (values.get('medicamentoContinuo') === 'Sim' && !String(values.get('qualMedicamentoContinuo') || '').trim()) return form.elements.qualMedicamentoContinuo;
    return form.querySelector(':invalid');
  };
  const syncStudentConditionalRequired = () => {
    const values = new FormData(form);
    const intoleranceRequired = values.get('intoleranciaAlimentos') === 'Sim';
    const allergyRequired = values.get('alergiaMedicamento') === 'Sim';
    const continuousMedicationRequired = values.get('medicamentoContinuo') === 'Sim';
    form.elements.qualIntolerancia.required = intoleranceRequired;
    form.elements.qualAlergia.required = allergyRequired;
    form.elements.qualMedicamentoContinuo.required = continuousMedicationRequired;
    form.elements.qualIntolerancia.closest('.field')?.querySelector('span')?.replaceChildren(document.createTextNode('Qual?'), ...(intoleranceRequired ? [document.createTextNode(' '), Object.assign(document.createElement('b'), { textContent: '*' })] : []));
    form.elements.qualAlergia.closest('.field')?.querySelector('span')?.replaceChildren(document.createTextNode('Qual?'), ...(allergyRequired ? [document.createTextNode(' '), Object.assign(document.createElement('b'), { textContent: '*' })] : []));
    form.elements.qualMedicamentoContinuo.closest('.field')?.querySelector('span')?.replaceChildren(document.createTextNode('Qual?'), ...(continuousMedicationRequired ? [document.createTextNode(' '), Object.assign(document.createElement('b'), { textContent: '*' })] : []));
  };
  form.querySelectorAll('[name="intoleranciaAlimentos"], [name="alergiaMedicamento"], [name="medicamentoContinuo"]').forEach((input) => {
    input.addEventListener('change', () => {
      syncStudentConditionalRequired();
    });
  });
  syncStudentConditionalRequired();
  if (publicContext) {
    app.querySelector('#student-financial-summary')?.remove();
    app.querySelector('.student-registration-tools')?.remove();
    app.querySelector('.student-heading-actions')?.remove();
    if (studentFileNumberInput) {
      studentFileNumberInput.value = String(publicContext.numeroFicha);
      studentFileNumberInput.readOnly = true;
      studentFileNumberInput.required = false;
    }
    form.classList.add('shared-public-student-form');
    wireSharedPublicStudentSubmission(form, publicContext, '#student-message');
    return;
  }
  const duplicateStudentCpfMessage = 'CPF já cadastrado';
  const duplicateStudentFileNumberMessage = 'Número da ficha já cadastrado neste retiro.';
  const studentTeamConflictMessage = 'Este CPF já está cadastrado na equipe de trabalho deste retiro.';
  const studentArchiveMessage = 'Dados encontrados no acervo da equipe. Revise antes de salvar.';
  const studentFileNumberValue = () => String(studentFileNumberInput?.value || '').trim();
  const normalizeStudentFileNumber = (value) => {
    const number = Number(String(value || '').trim());
    return Number.isInteger(number) && number > 0 ? String(number) : '';
  };
  const financialSummaryTitle = `Resumo financeiro dos cursistas${focusStudentRetreat ? ` - ${focusStudentRetreat.nome}` : ''}`;
  wireFinancialSummaryButton({
    buttonSelector: '#student-financial-summary',
    title: financialSummaryTitle,
    eyebrow: 'Cursistas',
    description: 'Valores buscados somente nas fichas dos cursistas.',
    firstColumnLabel: 'Nome completo do cursista',
    emptyMessage: 'Nenhum cursista encontrado.',
    filenameFallback: 'resumo-financeiro-cursistas',
    loadRows: async () => {
      const students = await dataService.listCursistas(focusStudentRetreat?.id || '');
      return students
        .filter((student) => !focusStudentRetreat || student.retiroId === focusStudentRetreat.id)
        .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }))
        .map((student) => {
          const valorInscricao = parseCurrency(student.valorInscricao);
          const valorPago = parseCurrency(student.valorPago);
          const saldoInformado = parseCurrency(student.saldoPagar);
          const saldoPagar = student.saldoPagar ? saldoInformado : Math.max(0, valorInscricao - valorPago);
          return {
            nome: student.nome || 'Sem nome',
            valorInscricao,
            valorPago,
            saldoPagar,
            formaPagamento: student.formaPagamento || student.recebedorFormaPagamento || '',
            observacao: student.observacaoPagamento || student.recebedorObservacao || '',
          };
        });
    },
  });
  const findPersonFromArchive = async (cpf) => {
    const currentPerson = people.find((person) => normalizeCpf(person.cpf || person.id) === cpf || person.id === cpf);
    return currentPerson || await dataService.getPessoa(cpf);
  };
  const fillStudentFromArchive = (person) => {
    if (!person) return;
    const commonFields = {
      nome: person.nome,
      nascimento: formatDateInput(person.nascimento) || person.nascimento,
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
    wireTypedDates(form, namedFieldSelector(['nascimento']));
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
    const currentEnrolments = enrolments.length ? enrolments : await dataService.listAdesoes(focusStudentRetreat.id);
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
    const students = await dataService.listCursistas(focusStudentRetreat?.id || '');
    const duplicated = students.find((student) => student.retiroId === focusStudentRetreat?.id && normalizeCpf(student.cpf) === cpf && student.id !== previousId);
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
  const resetStudentScreenAfterSave = () => {
    photoController?.reset();
    form.reset();
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      control.setCustomValidity?.('');
      if (control.type === 'radio' || control.type === 'checkbox') control.checked = false;
      else if (control.name !== 'retiroId') control.value = '';
    });
    if (form.elements.retiroId) form.elements.retiroId.value = focusStudentRetreat?.id || '';
    form.querySelector('input[name="id"]')?.remove();
    form.dataset.studentPaymentTouched = 'false';
    syncStudentConditionalRequired();
    syncChoiceStates(form);
    form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
    const paymentComment = form.querySelector('.student-payment-comment');
    if (paymentComment) {
      paymentComment.textContent = '';
      paymentComment.hidden = true;
    }
    form.querySelector('#clear-student-payment')?.setAttribute('hidden', '');
    form.querySelector('.delete-student')?.setAttribute('hidden', '');
    app.querySelector('.student-heading-actions')?.setAttribute('hidden', '');
    if (studentFileNumberInput) {
      studentFileNumberInput.value = '';
      studentFileNumberInput.setCustomValidity('');
      studentFileNumberInput.disabled = false;
    }
    const studentSearchInput = app.querySelector('#student-search');
    const studentSearchResults = app.querySelector('#student-search-results');
    if (studentSearchInput) studentSearchInput.value = '';
    if (studentSearchResults) {
      studentSearchResults.hidden = true;
      studentSearchResults.innerHTML = '';
    }
    form.querySelector('button[type="submit"]').innerHTML = 'Salvar cadastro <span>→</span>';
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      if (control.type !== 'hidden') control.disabled = true;
    });
    form.querySelector('button[type="submit"]').disabled = true;
    form.querySelector('#set-student-payment').disabled = true;
    form.querySelector('#clear-student-payment').disabled = true;
    app.querySelector('#student-message').textContent = 'Cadastro do cursista salvo com sucesso.';
    form.dispatchEvent(new CustomEvent('student-form-cleared-after-save'));
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ensureRetreatCanBeChanged(focusStudentRetreat, 'salvar cursistas')) return;
    syncStudentConditionalRequired();
    const values = new FormData(form);
    const numeroFichaIndividual = normalizeStudentFileNumber(studentFileNumberValue());
    if (!numeroFichaIndividual) {
      app.querySelector('#student-message').textContent = 'Informe um Número da ficha válido.';
      focusStudentIssue(studentFileNumberInput);
      return;
    }
    const nascimento = normalizeDateInput(values.get('nascimento'));
    if (!nascimento) {
      form.elements.nascimento.setCustomValidity('Digite uma data válida no formato dd/mm/aaaa.');
      app.querySelector('#student-message').textContent = 'Revise a data de nascimento. Use o formato dd/mm/aaaa.';
      focusStudentIssue(form.elements.nascimento);
      return;
    }
    values.set('nascimento', nascimento);
    const submitCpf = normalizeCpf(values.get('cpf'));
    if (isValidCpf(submitCpf) && await checkStudentCpf(true)) return;
    const firstIssue = firstStudentRequiredIssue();
    if (!form.checkValidity() || firstIssue) {
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
    const currentStudents = await dataService.listCursistas(focusStudentRetreat?.id || '');
    const currentStudent = previousId && currentStudents.find((student) => student.id === previousId);
    const duplicatedFileNumber = currentStudents.find((student) => (
      (!focusStudentRetreat || student.retiroId === focusStudentRetreat.id)
      && String(student.numeroFichaIndividual || '') === numeroFichaIndividual
      && student.id !== previousId
    ));
    if (duplicatedFileNumber) {
      app.querySelector('#student-message').textContent = duplicateStudentFileNumberMessage;
      focusStudentIssue(studentFileNumberInput);
      return;
    }
    const duplicatedCpf = currentStudents.find((student) => student.retiroId === focusStudentRetreat?.id && normalizeCpf(student.cpf) === cpf && student.id !== previousId);
    if (duplicatedCpf) {
      app.querySelector('#student-message').textContent = duplicateStudentCpfMessage;
      focusStudentIssue(form.elements.cpf);
      return;
    }
    const paymentTouched = form.dataset.studentPaymentTouched === 'true';
    if (currentStudent && !paymentTouched) {
      ['valorPago', 'recebedorValorPago', 'recebedorTaxaPaga', 'formaPagamento', 'observacaoPagamento', 'recebedorFormaPagamento', 'recebedorObservacao'].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(currentStudent, field)) values.set(field, currentStudent[field] ?? '');
      });
    }
    const paidAmount = parseCurrency(values.get('valorPago'));
    const currentPaymentMethod = values.get('formaPagamento') || '';
    const currentPaymentObservation = values.get('observacaoPagamento') || '';
    if (paymentTouched && paidAmount > 0 && !currentPaymentMethod) {
      app.querySelector('#student-message').textContent = 'Clique em Pago para informar a forma de pagamento antes de salvar.';
      return;
    }
    if (paymentTouched && paidAmount > 0 && paymentMethodsWithObservation.has(currentPaymentMethod) && !currentPaymentObservation.trim()) {
      app.querySelector('#student-message').textContent = 'Informe a observação da forma de pagamento antes de salvar.';
      return;
    }
    if (paymentTouched) {
      values.set('recebedorValorPago', paidAmount > 0 ? paidAmount : 0);
      values.set('recebedorTaxaPaga', paidAmount > 0 && paidAmount >= parseCurrency(values.get('valorInscricao')) ? 'true' : '');
      if (paidAmount <= 0) {
        values.set('formaPagamento', '');
        values.set('observacaoPagamento', '');
        values.set('recebedorFormaPagamento', '');
        values.set('recebedorObservacao', '');
      }
    }
    values.set('numeroFichaIndividual', numeroFichaIndividual);
    const record = { ...(currentStudent || {}), ...Object.fromEntries(values), id: currentStudent?.id || createId(), cpf, numeroFichaIndividual, __userSubmittedRegistration: true, ...(paymentTouched ? { __allowRegistrationDataLoss: true } : {}), criadoEm: currentStudent?.criadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString() };
    try {
      const saved = await dataService.saveCursista(record);
      if (photoController?.hasPending()) await photoController.uploadLogged(saved);
    } catch (error) {
      const message = String(error?.message || 'Nao foi possivel salvar o cursista.');
      app.querySelector('#student-message').textContent = message;
      if (normalizeText(message).includes('numero de ficha')) focusStudentIssue(studentFileNumberInput);
      else if (normalizeText(message).includes('cpf')) focusStudentIssue(form.elements.cpf);
      return;
    }
    resetStudentScreenAfterSave();
  });
}
async function renderCursistaDetalhe(id) {
  const [student, allRetreats] = await Promise.all([dataService.getCursista(id), dataService.listRetiros()]);
  if (!student) { location.hash = '#cursista'; return; }
  const retreat = allRetreats.find((item) => item.id === student.retiroId);
  const canDeleteStudentDetail = canModifyRetreat(retreat);
  const field = (label, value) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || 'Não informado')}</span></div>`;
  const address = [student.rua, student.numero, student.bairro, student.cidade, student.estado].filter(Boolean).join(' · ');
  layout(`<section class="page-heading compact"><div><a class="back-link" href="#cursista">← Voltar</a><p class="eyebrow">Consulta de cursista</p><h1>${escapeHtml(student.nome || 'Cursista')}</h1><p>${retreat ? `Ficha cadastrada para ${escapeHtml(retreat.nome)}` : 'Cadastro de cursista'}</p></div></section><section class="panel"><h2>Dados pessoais</h2><div class="simple-list">${field('Número da ficha', student.numeroFichaIndividual)}${field('CPF', formatCpf(student.cpf))}${field('Nascimento', date(student.nascimento))}${field('Telefone', student.telefone)}${field('Endereço', address)}</div></section><section class="panel"><h2>Formação e vivência</h2><div class="simple-list">${field('É batizado(a)?', student.batizado)}${field('Fez primeira comunhão?', student.primeiraComunhao)}${field('Estuda?', student.estuda)}${field('Série', student.serie)}${field('Escola', student.escola)}${field('Fez algum retiro?', student.fezRetiro)}${field('Qual retiro?', student.qualRetiro)}</div></section><section class="panel"><h2>Família e convite</h2><div class="simple-list">${field('Pai', student.nomePai)}${field('Telefone do pai', student.telefonePai)}${field('Mãe', student.nomeMae)}${field('Telefone da mãe', student.telefoneMae)}${field('Movimento dos pais', student.paisMovimento)}${field('Qual movimento?', student.qualMovimento)}${field('Quem convidou?', student.convidou)}${field('Camiseta', student.camiseta)}</div></section><section class="panel"><h2>Saúde e inscrição</h2><div class="simple-list">${field('Intolerância a alimentos', student.intoleranciaAlimentos)}${field('Qual intolerância?', student.qualIntolerancia)}${field('Alergia a medicamento', student.alergiaMedicamento)}${field('Qual alergia?', student.qualAlergia)}${field('Medicamento para dor de cabeça', student.medicamentoCabeca)}${field('Medicamento para dor no estômago', student.medicamentoEstomago)}${field('Valor da inscrição', student.valorInscricao)}${field('Valor pago', student.valorPago)}${field('Saldo a pagar', student.saldoPagar)}</div></section><section class="panel"><div class="form-actions"><p>Esta ação remove o cadastro do cursista.</p><button type="button" id="delete-consulted-student" class="delete-student">Excluir cursista</button></div></section>`, 'cursista');
  const detailPhoto = document.createElement('section');
  detailPhoto.className = 'panel student-detail-photo';
  detailPhoto.innerHTML = `<h2>Foto</h2><img src="${escapeHtml(studentPhotoUrl('individual', student.retiroId, student.id))}" alt="Foto de ${escapeHtml(student.nome || 'cursista')}" onerror="this.closest('section').remove()">`;
  app.querySelector('.admin-main .panel')?.before(detailPhoto);
  const studentHealthItems = [...app.querySelectorAll('.panel')].find((panel) => panel.querySelector('h2')?.textContent === 'Saúde e inscrição')?.querySelectorAll('.simple-list > div');
  studentHealthItems?.[3]?.insertAdjacentHTML('afterend', `${field('Toma medicamento contínuo', student.medicamentoContinuo || 'Não')}${field('Qual medicamento contínuo?', student.qualMedicamentoContinuo)}`);
  if (!canDeleteStudentDetail) app.querySelector('#delete-consulted-student')?.closest('.panel')?.remove();
  app.querySelector('#delete-consulted-student')?.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'excluir cursistas')) return;
    if (!confirm('Excluir este cursista?')) return;
    const button = app.querySelector('#delete-consulted-student');
    button.disabled = true;
    try {
      await dataService.deleteCursista(student.id);
      await removeStudentFromCommunities(student).catch(() => null);
      location.hash = '#cursista';
    } catch (error) {
      button.disabled = false;
      alert(error.message || 'Não foi possível concluir a exclusão do cursista e da foto. Recarregue a ficha e tente novamente.');
    }
  });
}
async function renderComunidades() {
  const retreat = selectedRetreat();
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Grupos do retiro</p><h1>Comunidades</h1><p>Crie ou publique um retiro para montar as comunidades.</p></div></section>', 'comunidades'); return; }
  const studentFormType = retreat.tipoFichaCursista || defaultStudentFormType;
  const usesSmpStudents = studentFormType === 'cursista-smp';
  const usesEpcStudents = studentFormType === 'cursista-epc';
  const usesCoupleStudents = usesSmpStudents || usesEpcStudents;
  const activeCoupleStudentSource = usesCoupleStudents ? coupleStudentSource(studentFormType) : null;
  const [sourceStudents, allCommunities] = await Promise.all([
    usesCoupleStudents ? activeCoupleStudentSource.list(retreat.id) : dataService.listCursistas(retreat.id),
    dataService.listComunidades(retreat.id),
  ]);
  const communities = sortCommunitiesByPosition(allCommunities.filter((community) => community.retiroId === retreat.id));
  const entries = mergeEnrolmentsByParticipant(enrolments.filter((entry) => entry.retiroId === retreat.id));
  const leaders = [...new Set(entries.filter((entry) => entry.casalId && entryHasSector(entry, 'Tios de comunidade')).map((entry) => entry.casalId))].map((casalId) => { const pair = entries.filter((entry) => entry.casalId === casalId); return { casalId, label: pair.map((entry) => entry.nome).join(' e ') }; });
  const monitorCandidates = [...new Set(entries.filter((entry) => entry.casalId && (entry.setores || []).some((sector) => normalizeText(sector).includes('monitor'))).map((entry) => entry.casalId))].map((casalId) => { const pair = entries.filter((entry) => entry.casalId === casalId); return { casalId, label: pair.map((entry) => entry.nome).join(' e ') }; });
  const retreatStudentRecords = usesCoupleStudents ? sourceStudents : sourceStudents.filter((student) => student.retiroId === retreat.id);
  const smpCoupleName = (record = {}) => [record.nomeDele, record.nomeDela].map((name) => String(name || '').trim()).filter(Boolean).join(' e ') || `Ficha ${record.numeroFichaSmp || record.id || 'sem número'}`;
  const averageSmpBirthTime = (record = {}) => {
    const dates = [record.nascimentoDele, record.nascimentoDela].map(parseLocalDate);
    if (dates.some((value) => !value)) return Number.NEGATIVE_INFINITY;
    return dates.reduce((total, value) => total + value.getTime(), 0) / dates.length;
  };
  const toCommunityStudent = (student) => usesCoupleStudents
    ? { ...student, id: String(student.id || student.numeroFichaSmp || ''), nome: smpCoupleName(student), detail: `Ficha ${student.numeroFichaSmp || student.id || 'sem número'}`, ageSort: averageSmpBirthTime(student) }
    : { ...student, detail: ageInYearsAndMonths(student.nascimento), ageSort: parseLocalDate(student.nascimento)?.getTime() ?? Number.NEGATIVE_INFINITY };
  const retreatStudents = (usesCoupleStudents ? retreatStudentRecords : uniqueByParticipant(retreatStudentRecords)).map(toCommunityStudent);
  const membershipType = usesCoupleStudents ? activeCoupleStudentSource.membershipType : 'individual';
  const memberField = usesCoupleStudents ? activeCoupleStudentSource.memberField : 'membroIds';
  const memberIdsFor = (community) => community[memberField] || [];
  const communityMembers = (community) => {
    const memberIds = new Set(memberIdsFor(community).map(String));
    const records = retreatStudentRecords.filter((student) => memberIds.has(String(student.id)));
    return (usesCoupleStudents ? records : uniqueByParticipant(records)).map(toCommunityStudent).sort((first, second) => second.ageSort - first.ageSort);
  };
  const communityShirtSections = communities.map((community, index) => {
    const peopleRows = communityMembers(community).flatMap((student) => usesCoupleStudents ? [
      { name: student.nomeDele, shirt: student.manequimDele },
      { name: student.nomeDela, shirt: student.manequimDela },
    ] : [{ name: student.nome, shirt: student.camiseta || student.camisetaOutro }])
      .filter((person) => String(person.name || '').trim())
      .sort((first, second) => String(first.name).localeCompare(String(second.name), 'pt-BR', { sensitivity: 'base' }));
    return { name: community.nome || `Comunidade ${index + 1}`, peopleRows };
  }).filter((community) => community.peopleRows.length);
  const canEditCommunities = canModifyRetreat(retreat);
  const assignedStudentIds = new Set(communities.flatMap(memberIdsFor).map(String));
  const assignedStudentKeys = usesCoupleStudents ? assignedStudentIds : new Set(retreatStudentRecords.filter((student) => assignedStudentIds.has(String(student.id))).map(participantIdentity));
  const studentsWithoutCommunity = retreatStudents.filter((student) => usesCoupleStudents ? !assignedStudentIds.has(String(student.id)) : !assignedStudentKeys.has(participantIdentity(student))).length;
  const communitiesWithoutLeaders = communities.filter((community) => !community.liderCasalId).length;
  const communitiesWithoutMonitor = communities.filter((community) => !community.monitorCasalId && !(community.monitorIds || []).length).length;
  const participantLabel = usesCoupleStudents ? 'Casais' : 'Cursistas';
  const participantLabelLower = usesCoupleStudents ? 'casais' : 'cursistas';
  const assignedLeaderIds = new Set(communities.map((community) => community.liderCasalId).filter(Boolean).map(String));
  const remainingLeadersFor = (selected = '') => leaders.filter((leader) => !assignedLeaderIds.has(String(leader.casalId)) || String(leader.casalId) === String(selected));
  const leaderOptions = (selected) => `<option value="">Buscar tios da comunidade</option>${remainingLeadersFor(selected).map((leader) => `<option value="${leader.casalId}" ${String(leader.casalId) === String(selected) ? 'selected' : ''}>${escapeHtml(leader.label)}</option>`).join('')}`;
  const monitorOptions = (selected) => `<option value="">Buscar monitores da comunidade</option>${monitorCandidates.map((monitor) => `<option value="${monitor.casalId}" ${monitor.casalId === selected ? 'selected' : ''}>${escapeHtml(monitor.label)}</option>`).join('')}`;
  const moveOptions = (currentCommunityId) => `<option value="">Mover para...</option>${communities.filter((community) => community.id !== currentCommunityId).map((community) => `<option value="${community.id}">${escapeHtml(community.nome || `Comunidade ${community.ordem || ''}`)}</option>`).join('')}`;
  layout(`<section class="page-heading"><div><p class="eyebrow">Grupos do retiro</p><h1>Comunidades</h1><p>${escapeHtml(retreat.nome)} · Forme grupos e distribua os ${participantLabelLower}.</p><div class="community-overview"><article><span>${participantLabel} sem comunidade</span><strong>${studentsWithoutCommunity}</strong></article><article><span>Comunidades sem tios</span><strong>${communitiesWithoutLeaders}</strong></article><article><span>Comunidades sem monitor</span><strong>${communitiesWithoutMonitor}</strong></article></div></div><div class="detail-actions"><button class="primary-button" id="add-community" type="button">Incluir comunidade</button><button class="primary-button" id="distribute-students" type="button" ${communities.length ? '' : 'disabled'}>Distribuir ${participantLabelLower}</button><button class="primary-button" id="print-community-shirts" type="button">Imprimir Nr camisetas por comunidade</button></div></section><section class="community-grid">${communities.map((community, index) => { const members = communityMembers(community); return `<article class="community-card"><div class="community-card-heading"><label class="field"><span>Nome da comunidade</span><input class="community-rename" data-community-name="${community.id}" value="${escapeHtml(community.nome || `Comunidade ${index + 1}`)}"></label><div class="community-order-summary"><label class="field community-order-field"><span>Ordem</span><input data-community-order="${community.id}" type="number" min="1" step="1" value="${Number(community.ordem) || index + 1}"></label><div class="community-count"><span>${participantLabel}</span><strong>${members.length}</strong></div></div></div><div class="community-role-grid"><label class="field"><span>Buscar tios da comunidade</span><div class="community-role-control"><select data-community-leader="${community.id}">${leaderOptions(community.liderCasalId)}</select>${community.liderCasalId ? `<button type="button" data-remove-community-leader="${community.id}">Remover</button>` : ''}</div></label><label class="field"><span>Buscar monitores da comunidade</span><div class="community-role-control"><select data-community-monitor="${community.id}">${monitorOptions(community.monitorCasalId || community.monitorIds?.[0] || '')}</select>${community.monitorCasalId ? `<button type="button" data-remove-community-monitor="${community.id}">Remover</button>` : ''}</div></label></div><div class="community-members">${members.length ? members.map((student) => `<div><span>${escapeHtml(student.nome)} <small>${escapeHtml(student.detail)}</small></span><select data-move-student="${escapeHtml(student.id)}" data-current-community="${community.id}">${moveOptions(community.id)}</select><button type="button" data-remove-member="${community.id}" data-student="${escapeHtml(student.id)}">Remover</button></div>`).join('') : `<p>Nenhum ${usesCoupleStudents ? 'casal' : 'cursista'} alocado.</p>`}</div><button type="button" class="delete-community" data-delete-community="${community.id}">Excluir comunidade</button></article>`; }).join('') || '<div class="empty-state">Nenhuma comunidade criada ainda. Use Incluir comunidade para iniciar.</div>'}</section>`, 'comunidades');
  app.querySelector('#print-community-shirts')?.addEventListener('click', () => {
    if (!communityShirtSections.length) { alert('Não há cursistas vinculados às comunidades deste retiro.'); return; }
    const communityContent = communityShirtSections.map((community) => `<section><h2>${escapeHtml(community.name)}</h2>${community.peopleRows.map((person) => `<div class="community-shirt-row"><div class="community-shirt-person"><strong>${escapeHtml(person.name)}</strong><small>Comunidade: ${escapeHtml(community.name)}</small></div><span>${escapeHtml(String(person.shirt || '').trim() || 'Não informado')}</span></div>`).join('')}</section>`).join('');
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Número das camisetas por comunidade - ${escapeHtml(retreat.nome)}</title>
  <style>
    @page { size:A4 portrait; margin:10mm; }
    * { box-sizing:border-box; }
    html,body { margin:0; padding:0; background:#fff; color:#1f2c3f; }
    body { font-family:"Times New Roman",Times,serif; font-size:25pt; line-height:1.15; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    h1 { margin:0 0 7mm; font-size:25pt; line-height:1.15; }
    .community-shirt-report { column-count:2; column-gap:10mm; column-rule:.25mm solid #aeb7ae; }
    section { width:100%; margin:0 0 6mm; break-inside:auto; page-break-inside:auto; }
    h2 { margin:0 0 2mm; padding:0 0 1mm; border-bottom:.4mm solid #7f927f; color:#285130; font-size:25pt; line-height:1.15; break-after:avoid; page-break-after:avoid; }
    .community-shirt-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4mm; padding:2mm 0; border-bottom:.25mm solid #d9d1c3; break-inside:avoid; page-break-inside:avoid; }
    .community-shirt-row strong,.community-shirt-row span { min-width:0; font-size:25pt; overflow-wrap:anywhere; }
    .community-shirt-person { display:flex; min-width:0; flex-direction:column; gap:1mm; }
    .community-shirt-person small { color:#667268; font-size:15pt; line-height:1.2; overflow-wrap:anywhere; }
  </style>
</head>
<body><h1>Número das camisetas por comunidade - ${escapeHtml(retreat.nome)}</h1><main class="community-shirt-report">${communityContent}</main></body>
</html>`);
    printWindow.document.close();
    const triggerPrint = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.addEventListener('load', () => setTimeout(triggerPrint, 120), { once: true });
  });
  if (!canAccess('comunidades.criar') || !canEditCommunities) app.querySelector('#add-community')?.remove();
  if (!canAccess('comunidades.editar') || !canEditCommunities) {
    app.querySelector('#distribute-students')?.remove();
    app.querySelectorAll('[data-community-name], [data-community-order], [data-community-leader], [data-community-monitor], [data-move-student]').forEach((control) => { control.disabled = true; });
    app.querySelectorAll('[data-remove-community-leader], [data-remove-community-monitor], [data-remove-member]').forEach((button) => button.remove());
  }
  if (!canAccess('comunidades.excluir') || !canEditCommunities) app.querySelectorAll('[data-delete-community]').forEach((button) => button.remove());
  app.querySelector('#add-community')?.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'incluir comunidades')) return;
    const latestCommunities = sortCommunitiesByPosition(await dataService.listComunidades(retreat.id));
    const nextOrder = Math.max(0, ...latestCommunities.map((community) => Number(community.ordem) || 0)) + 1;
    await dataService.saveComunidade({ id: createId(), retiroId: retreat.id, nome: `Comunidade ${nextOrder}`, liderCasalId: '', monitorCasalId: '', monitorIds: [], membroIds: [], membroSmpIds: [], membroEpcIds: [], ordem: nextOrder, criadoEm: new Date().toISOString() });
    renderComunidades();
  });
  app.querySelectorAll('[data-community-name]').forEach((input) => input.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === input.dataset.communityName); community.nome = input.value.trim() || `Comunidade ${community.ordem}`; await dataService.saveComunidade(community); input.value = community.nome; }));
  app.querySelectorAll('[data-community-order]').forEach((input) => input.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === input.dataset.communityOrder); const ordem = Number(input.value); if (!community || !Number.isInteger(ordem) || ordem <= 0) { input.value = Number(community?.ordem) || 1; return; } community.ordem = ordem; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-community-leader]').forEach((select) => select.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === select.dataset.communityLeader); community.liderCasalId = select.value; await dataService.saveComunidade(community); await renderComunidades(); }));
  app.querySelectorAll('[data-community-monitor]').forEach((select) => select.addEventListener('change', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === select.dataset.communityMonitor); community.monitorCasalId = select.value; community.monitorIds = []; await dataService.saveComunidade(community); }));
  app.querySelectorAll('[data-remove-community-leader]').forEach((button) => button.addEventListener('click', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === button.dataset.removeCommunityLeader); community.liderCasalId = ''; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-remove-community-monitor]').forEach((button) => button.addEventListener('click', async () => { if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return; const community = communities.find((item) => item.id === button.dataset.removeCommunityMonitor); community.monitorCasalId = ''; community.monitorIds = []; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-move-student]').forEach((select) => select.addEventListener('change', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return;
    const studentId = select.dataset.moveStudent;
    const targetCommunityId = select.value;
    if (!studentId || !targetCommunityId) return;
    select.disabled = true;
    try {
      await dataService.moveComunidadeMembro({ retreatId: retreat.id, targetCommunityId, membershipType, studentId });
      await renderComunidades();
    } catch (error) {
      alert(error.message || 'Não foi possível mover o cursista.');
      await renderComunidades();
    }
  }));
  app.querySelectorAll('[data-remove-member]').forEach((button) => button.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'alterar comunidades')) return;
    const community = communities.find((item) => item.id === button.dataset.removeMember);
    const memberIds = memberIdsFor(community).filter((id) => String(id) !== button.dataset.student);
    try {
      await dataService.saveComunidadeMembros(community, membershipType, memberIds);
      renderComunidades();
    } catch (error) {
      alert(error.message || 'Não foi possível remover o cursista da comunidade.');
    }
  }));
  app.querySelectorAll('[data-delete-community]').forEach((button) => button.addEventListener('click', async () => {
    if (!ensureRetreatCanBeChanged(retreat, 'excluir comunidades')) return;
    const community = communities.find((item) => item.id === button.dataset.deleteCommunity);
    if (!community) return;
    const linkedStudents = memberIdsFor(community).length;
    const linkedRoles = Number(Boolean(community.liderCasalId)) + Number(Boolean(community.monitorCasalId || (community.monitorIds || []).length));
    const confirmation = `Excluir a comunidade "${community.nome}"?\n\nSomente o agrupamento será excluído. ${linkedStudents} ${usesCoupleStudents ? 'casal(is)' : 'cursista(s)'} ficará(ão) sem comunidade e ${linkedRoles} vínculo(s) de tio/monitor será(ão) liberado(s). Nenhum cadastro de cursista, adesão, pessoa ou casal será excluído.`;
    if (!confirm(confirmation)) return;
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      await dataService.deleteComunidade(community.id);
      await renderComunidades();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Excluir comunidade';
      alert(error.message || 'Não foi possível excluir somente o agrupamento da comunidade. Nenhum cadastro foi alterado.');
    }
  }));
  app.querySelector('#distribute-students')?.addEventListener('click', () => {
    if (!ensureRetreatCanBeChanged(retreat, 'distribuir cursistas em comunidades')) return;
    const overlay = document.createElement('section'); overlay.className = 'receiver-sector-overlay';
    const communityOptions = (selected = '') => `<option value="">Sem comunidade</option>${communities.map((community) => `<option value="${community.id}" ${community.id === selected ? 'selected' : ''}>${escapeHtml(community.nome || `Comunidade ${community.ordem || ''}`)}</option>`).join('')}`;
    overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Distribuição de ${participantLabelLower}</p><h2>Exportar para a comunidade</h2><p>Escolha a comunidade de cada ${usesCoupleStudents ? 'casal' : 'cursista'} e clique em exportar para a comunidade.</p></div></div><div class="community-export-list">${retreatStudents.map((student) => { const current = communities.find((community) => memberIdsFor(community).map(String).includes(String(student.id))); return `<div><strong>${escapeHtml(student.nome)}</strong><span>${escapeHtml(student.detail)}</span><select data-student-community="${escapeHtml(student.id)}">${communityOptions(current?.id)}</select></div>`; }).join('') || `<p>Nenhum ${usesCoupleStudents ? `casal ${usesEpcStudents ? 'EPC' : 'SMP'}` : 'cursista'} cadastrado.</p>`}</div><p id="community-export-message" class="form-message"></p><div class="form-actions"><button type="button" class="close-sector-view">Fechar</button><button type="button" class="suggest-by-age" id="suggest-by-age" ${communities.length && retreatStudents.length ? '' : 'disabled'}>Fazer uma sugestão por idade</button><button type="button" id="export-students" class="is-couple-continue">Exportar para a comunidade</button></div></div>`;
    overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#suggest-by-age').addEventListener('click', () => { const ordered = [...retreatStudents].sort((first, second) => second.ageSort - first.ageSort); const base = Math.floor(ordered.length / communities.length); const extra = ordered.length % communities.length; let cursor = 0; communities.forEach((community, index) => { const size = base + (index >= communities.length - extra ? 1 : 0); ordered.slice(cursor, cursor + size).forEach((student) => { const control = [...overlay.querySelectorAll('[data-student-community]')].find((input) => input.dataset.studentCommunity === String(student.id)); if (control) control.value = community.id; }); cursor += size; }); });
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
        const latestCommunities = sortCommunitiesByPosition(await dataService.listComunidades(retreat.id));
        const selectedByCommunity = new Map(latestCommunities.map((community) => [community.id, []]));
        selections.forEach((selection) => {
          if (selectedByCommunity.has(selection.communityId)) selectedByCommunity.get(selection.communityId).push(selection.studentId);
        });
        for (const community of latestCommunities) {
          await dataService.saveComunidadeMembros(community, membershipType, selectedByCommunity.get(community.id) || []);
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
const badgeSectorAssignmentsType = 'sector-model-assignments';
const badgeSectorNamesType = 'sector-display-names';
const badgeTechnicalRecordTypes = new Set([badgeSectorAssignmentsType, badgeSectorNamesType]);
const badgeAssignmentUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  const storedProfiles = await dataService.listCrachas(retreatId);
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
  const profiles = await dataService.listCrachas(retreatId);
  return profiles
    .filter((profile) => profile.tipo !== badgeSectorAssignmentsType && !badgeTechnicalRecordTypes.has(profile.tipo))
    .map((profile) => normalizeBadgeProfile(profile, retreatId))
    .filter((profile) => profile.name && profile.retiroId === retreatId)
    .sort((first, second) => String(second.updatedAt || '').localeCompare(String(first.updatedAt || '')));
};
const saveBadgeProfile = (profile) => dataService.saveCracha(normalizeBadgeProfile(profile, profile.retiroId));
const deleteBadgeProfile = (profileId) => dataService.deleteCracha(profileId);
const normalizeBadgeSectorAssignments = (assignments = {}) => {
  const hasGroupedAssignments = assignments?.sectors && typeof assignments.sectors === 'object'
    || assignments?.communities && typeof assignments.communities === 'object';
  if (!hasGroupedAssignments) return { sectors: { ...(assignments || {}) }, communities: {} };
  return {
    sectors: { ...(assignments.sectors || {}) },
    communities: { ...(assignments.communities || {}) },
  };
};
const loadBadgeSectorAssignments = async (retreatId = '') => {
  const records = (await dataService.listCrachas(retreatId))
    .filter((item) => item.retiroId === retreatId && item.tipo === badgeSectorAssignmentsType)
    .sort((first, second) => {
      const uuidDifference = Number(badgeAssignmentUuidPattern.test(second.id || '')) - Number(badgeAssignmentUuidPattern.test(first.id || ''));
      return uuidDifference || String(second.updatedAt || '').localeCompare(String(first.updatedAt || ''));
    });
  const record = records[0];
  return {
    id: badgeAssignmentUuidPattern.test(record?.id || '') ? record.id : '',
    assignments: normalizeBadgeSectorAssignments(record?.assignments),
  };
};
const saveBadgeSectorAssignments = (retreatId, assignments = {}, recordId = '') => dataService.saveCracha({
  id: badgeAssignmentUuidPattern.test(recordId) ? recordId : createId(),
  retiroId: retreatId,
  name: 'Modelos de crachá por setor e comunidade',
  tipo: badgeSectorAssignmentsType,
  assignments: normalizeBadgeSectorAssignments(assignments),
  updatedAt: new Date().toISOString(),
});
const normalizeBadgeSectorNames = (names = {}) => Object.fromEntries(Object.entries(names || {})
  .map(([sector, displayName]) => [String(sector || '').trim(), String(displayName || '').trim()])
  .filter(([sector, displayName]) => sector && displayName));
const loadBadgeSectorNames = async (retreatId = '') => {
  const records = (await dataService.listCrachas(retreatId))
    .filter((item) => item.retiroId === retreatId && item.tipo === badgeSectorNamesType)
    .sort((first, second) => {
      const uuidDifference = Number(badgeAssignmentUuidPattern.test(second.id || '')) - Number(badgeAssignmentUuidPattern.test(first.id || ''));
      return uuidDifference || String(second.updatedAt || '').localeCompare(String(first.updatedAt || ''));
    });
  const record = records[0];
  return {
    id: badgeAssignmentUuidPattern.test(record?.id || '') ? record.id : '',
    names: normalizeBadgeSectorNames(record?.names),
  };
};
const saveBadgeSectorNames = (retreatId, names = {}, recordId = '') => dataService.saveCracha({
  id: badgeAssignmentUuidPattern.test(recordId) ? recordId : createId(),
  retiroId: retreatId,
  name: 'Nomes dos setores nos crachás',
  tipo: badgeSectorNamesType,
  names: normalizeBadgeSectorNames(names),
  updatedAt: new Date().toISOString(),
});
const copyBadgeProfilesToRetreat = async (sourceRetreatId, targetRetreatId) => {
  if (!sourceRetreatId || !targetRetreatId) return;
  await migrateLegacyBadgeProfiles(sourceRetreatId);
  const profiles = (await dataService.listCrachas(sourceRetreatId))
    .filter((profile) => profile.tipo !== badgeSectorAssignmentsType && !badgeTechnicalRecordTypes.has(profile.tipo))
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
  const preparedName = String(entry.badgeName || '').trim();
  if (preparedName) return preparedName;
  const person = personForBadge(entry);
  return firstName(person.nome || entry.nome);
};
const badgeSectorDisplayName = (sector = '', names = {}) => {
  const source = String(sector || '').trim();
  if (!source) return '';
  const direct = String(names?.[source] || '').trim();
  if (direct) return direct;
  const matched = Object.entries(names || {}).find(([savedSector]) => normalizeText(savedSector) === normalizeText(source));
  return String(matched?.[1] || '').trim() || source;
};
const badgeSectorText = (entry, sector = '', names = {}, applyConfiguredNames = true) => {
  const sourceLabels = sector ? [sector] : (entry.setores || []);
  if (!sourceLabels.length) return 'Sem setor';
  const labels = sourceLabels.map((sourceLabel) => applyConfiguredNames ? badgeSectorDisplayName(sourceLabel, names) : String(sourceLabel || '').trim()).filter(Boolean);
  const label = labels.join(', ') || 'Sem setor';
  const labelAlreadyIdentifiesCoordination = sourceLabels.some((sourceLabel) => normalizeText(sourceLabel).includes('coordenacao'));
  return entry.coordenacaoSetor && !labelAlreadyIdentifiesCoordination ? `Coord ${label}` : label;
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
const badgeCard = (entry, settings, sector = '', sectorNames = {}, applyConfiguredSectorNames = true) => {
  const logo = logoById(settings.logo);
  const showLogo = logo.id !== 'none' && logo.src;
  const watermark = settings.watermark && settings.watermark !== 'none' ? (settings.watermark === 'custom' ? settings.watermarkUrl : logoById(settings.watermark)?.src) : '';
  return `<article class="badge-card" style="${escapeHtml(badgeInlineStyle(settings))}">
    ${badgeWallpaperStyle(settings) ? `<div class="badge-wallpaper"${badgeWallpaperStyle(settings)}></div>` : ''}
    ${watermark ? `<img class="badge-watermark" src="${escapeHtml(watermark)}" alt="">` : ''}
    ${showLogo ? `<img class="badge-logo" src="${escapeHtml(logo.src)}" alt="${escapeHtml(logo.name)}">` : ''}
    <div class="badge-main">
      <strong>${escapeHtml(badgeDisplayName(entry))}</strong>
      <span>${escapeHtml(badgeSectorText(entry, sector, sectorNames, applyConfiguredSectorNames))}</span>
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
  const badgeStudentFormType = retreat.tipoFichaCursista || defaultStudentFormType;
  const badgeUsesCoupleStudentForm = ['cursista-smp', 'cursista-epc'].includes(badgeStudentFormType);
  const badgeCoupleStudentSource = badgeUsesCoupleStudentForm ? coupleStudentSource(badgeStudentFormType) : null;
  const [allCommunities, allStudents] = await Promise.all([
    dataService.listComunidades(retreat.id),
    badgeUsesCoupleStudentForm ? badgeCoupleStudentSource.list(retreat.id) : dataService.listCursistas(retreat.id),
  ]);
  const badgeCommunities = sortCommunitiesByPosition(allCommunities.filter((community) => community.retiroId === retreat.id));
  const badgeStudents = badgeUsesCoupleStudentForm
    ? allStudents.filter((student) => !student.retiroId || student.retiroId === retreat.id)
    : uniqueByParticipant(allStudents.filter((student) => student.retiroId === retreat.id));
  const entries = mergeEnrolmentsByParticipant(enrolments.filter((entry) => entry.retiroId === retreat.id && entry.setores?.length))
    .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }));
  const sectors = sortSectors(uniqueSectors([...(retreat.setores || []), ...entries.flatMap((entry) => entry.setores || [])]));
  const badgeSectorCount = (sector) => entries.filter((entry) => entryHasSector(entry, sector)).length;
  let badgeProfiles = await loadBadgeProfiles(retreat.id);
  const loadedBadgeSectorAssignments = await loadBadgeSectorAssignments(retreat.id);
  const loadedBadgeSectorNames = await loadBadgeSectorNames(retreat.id);
  let badgeSectorAssignmentsRecordId = loadedBadgeSectorAssignments.id;
  let badgeSectorAssignments = loadedBadgeSectorAssignments.assignments;
  let badgeSectorNamesRecordId = loadedBadgeSectorNames.id;
  let badgeSectorNames = loadedBadgeSectorNames.names;
  let selectedProfileId = '';
  let blankPreview = false;
  let activePrintMode = '';
  let badgeManualSelection = null;
  let activeBadgeView = '';
  let printGroupPickerOpen = false;
  const canConfigureBadges = canAccess('crachas.editar') && canModifyRetreat(retreat);
  const canViewBadgeSectorNames = canAccess('crachas.ver');
  const canEditBadgeSectorNames = canAccess('crachas.editar') && canModifyRetreat(retreat);
  const canPrintBadges = canAccess('crachas.imprimir');
  const canDeleteBadges = canAccess('crachas.excluir') && canModifyRetreat(retreat);
  const profileOptions = () => `<option value="">Selecione um modelo</option>${badgeProfiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join('')}`;
  const profilePickerOptions = () => `<button type="button" class="badge-profile-option badge-profile-option-empty" data-badge-profile-choice="" role="option"><span>Selecione um modelo</span></button>${badgeProfiles.map((profile) => {
    const thumbnailSettings = { ...defaultBadgeSettings, ...profile.settings, version: badgeSettingsVersion };
    return `<button type="button" class="badge-profile-option" data-badge-profile-choice="${escapeHtml(profile.id)}" role="option"><span class="badge-profile-thumbnail" aria-hidden="true">${sampleBadgeCard(thumbnailSettings)}</span><strong>${escapeHtml(profile.name)}</strong></button>`;
  }).join('')}`;
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
    ${canPrintBadges ? '<button type="button" class="badge-start-option" data-badge-view="print"><strong>Imprimir</strong><span>Selecione o modelo e gere os crach&aacute;s por setor ou comunidade.</span></button>' : ''}
    ${canConfigureBadges ? '<button type="button" class="badge-start-option" data-badge-view="assignments"><strong>Definir crach&aacute;s por setor/comunidade</strong><span>Associe modelos aos setores e comunidades do retiro.</span></button>' : ''}
    ${canViewBadgeSectorNames ? '<button type="button" class="badge-start-option" data-badge-view="sector-names"><strong>Personalizar nome do setor no crach&aacute;</strong><span>Ajuste o nome do setor para aparecer no crach&aacute;</span></button>' : ''}
    ${canConfigureBadges ? '<button type="button" class="badge-start-option" data-badge-view="config"><strong>Configurar crach&aacute;s</strong><span>Crie, personalize e gerencie os modelos de crach&aacute;.</span></button>' : ''}
    ${!canConfigureBadges && !canPrintBadges && !canViewBadgeSectorNames ? '<p class="empty-state">Seu usuario pode visualizar a tela, mas nao possui permissao para configurar ou imprimir crachas.</p>' : ''}
  </section>
  <section class="badge-active-area" id="badge-active-area" hidden>
    <section class="panel badge-view-toolbar" id="badge-config-toolbar" hidden>
      <div class="panel-heading"><div><h2>Configurar crach&aacute;s</h2><p>Cadastre, altere e consulte modelos de crach&aacute;.</p></div><button type="button" class="secondary-button badge-view-back" data-badge-home>Voltar</button></div>
      <div class="badge-heading-tools">
      <div class="field badge-profile-picker-field"><span>Modelo do crach&aacute;</span><select id="badge-config-select" hidden tabindex="-1" aria-hidden="true">${profileOptions()}</select><div class="badge-profile-picker"><button type="button" class="badge-profile-trigger" id="badge-profile-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="badge-profile-menu">Selecione um modelo</button><div class="badge-profile-menu" id="badge-profile-menu" role="listbox" hidden>${profilePickerOptions()}</div></div></div>
      <div class="badge-model-toolbar">${canConfigureBadges ? '<button class="primary-button" id="badge-new-config" type="button">Novo modelo</button>' : ''}</div>
    </div></section>
    <section class="panel badge-assignment-panel" id="badge-assignment-panel" hidden></section>
    <section class="panel badge-sector-name-panel" id="badge-sector-name-panel" hidden></section>
  <section class="badge-workbench" id="badge-workbench">
    <section class="panel badge-preview-panel" id="badge-preview-panel">
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
      <div class="panel-heading"><div><h2>Imprimir crach&aacute;s</h2><p>Escolha os setores ou comunidades. Ser&atilde;o usados os modelos definidos em "Definir crach&aacute;s por setor/comunidade".</p></div><button type="button" class="secondary-button badge-view-back" data-badge-home>Voltar</button></div>
      <div class="badge-heading-tools">
        <div class="badge-print-controls">
          <button type="button" class="secondary-button" id="badge-print-by-sector">Impress&atilde;o por setor</button>
          <button type="button" class="secondary-button" id="badge-print-by-community">Impress&atilde;o por comunidade</button>
          <p class="badge-print-comment" id="badge-print-comment"></p>
        </div>
      </div>
    </section>
  </section></section><section class="badge-print-area" id="badge-print-area"></section>`, 'crachas');

  const form = app.querySelector('#badge-editor');
  const preview = app.querySelector('#badge-preview');
  const printArea = app.querySelector('#badge-print-area');
  const startPanel = app.querySelector('#badge-start-panel');
  const activeArea = app.querySelector('#badge-active-area');
  const configToolbar = app.querySelector('#badge-config-toolbar');
  const assignmentPanel = app.querySelector('#badge-assignment-panel');
  const sectorNamePanel = app.querySelector('#badge-sector-name-panel');
  const workbench = app.querySelector('#badge-workbench');
  const previewPanel = app.querySelector('#badge-preview-panel');
  const printPanel = app.querySelector('#badge-print-panel');
  const printComment = printPanel.querySelector('#badge-print-comment');
  const configSelect = app.querySelector('#badge-config-select');
  const profilePicker = app.querySelector('.badge-profile-picker');
  const profileTrigger = app.querySelector('#badge-profile-trigger');
  const profileMenu = app.querySelector('#badge-profile-menu');
  const configName = app.querySelector('#badge-config-name');
  const configMessage = app.querySelector('#badge-config-message');
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
    if (['config', 'assignments'].includes(view) && !canConfigureBadges) return;
    if (view === 'sector-names' && !canViewBadgeSectorNames) return;
    if (view === 'print' && !canPrintBadges) return;
    activeBadgeView = view;
    const isHome = !view;
    activeArea.hidden = isHome;
    startPanel.hidden = !isHome;
    if (isHome) return;
    const isPrint = view === 'print';
    const isAssignment = view === 'assignments';
    const isSectorNames = view === 'sector-names';
    const isStandalonePanel = isAssignment || isSectorNames;
    configToolbar.hidden = view !== 'config';
    assignmentPanel.hidden = !isAssignment;
    sectorNamePanel.hidden = !isSectorNames;
    workbench.hidden = isStandalonePanel;
    previewPanel.hidden = isStandalonePanel;
    form.hidden = view !== 'config';
    printPanel.hidden = !isPrint;
    if (view === 'config') openBadgePanel('logo');
    if (isAssignment) renderBadgeAssignmentsPanel();
    else if (isSectorNames) renderBadgeSectorNamesPanel();
    else renderBadges();
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
    if (profileMenu) profileMenu.innerHTML = profilePickerOptions();
    if (profileTrigger) profileTrigger.textContent = badgeProfiles.find((profile) => profile.id === selectedId)?.name || 'Selecione um modelo';
    profileMenu?.querySelectorAll('[data-badge-profile-choice]').forEach((option) => option.setAttribute('aria-selected', option.dataset.badgeProfileChoice === selectedId ? 'true' : 'false'));
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
  const assignedProfileIdForSector = (sector) => {
    const direct = badgeSectorAssignments.sectors[sector];
    if (direct) return direct;
    const entry = Object.entries(badgeSectorAssignments.sectors).find(([savedSector]) => normalizeText(savedSector) === normalizeText(sector));
    return entry?.[1] || '';
  };
  const assignedProfileIdForCommunity = (communityId) => badgeSectorAssignments.communities[communityId] || '';
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
  const selectedEntries = () => Array.isArray(badgeManualSelection) ? badgeManualSelection : [];
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
    buildCommunityStudentBadgeEntries({
      community,
      students: badgeStudents,
      studentFormType: badgeStudentFormType,
      retreatId: retreat.id,
    }).forEach((item) => selected.set(item.entry.id, item));
    return [...selected.values()].sort((first, second) => String(first.entry.nome || '').localeCompare(String(second.entry.nome || ''), 'pt-BR', { sensitivity: 'base' }));
  };
  const printGroups = (type) => type === 'sector'
    ? sectors.map((sector) => ({ key: sector, label: sector, count: badgeSectorCount(sector) }))
    : badgeCommunities.map((community) => ({ key: community.id, label: communityName(community), count: communityBadgeEntries(community.id).length }));
  const printGroupProfile = (type, key) => {
    const assignedId = type === 'sector' ? assignedProfileIdForSector(key) : assignedProfileIdForCommunity(key);
    return badgeProfiles.find((profile) => profile.id === assignedId) || null;
  };
  const printGroupEntries = (type, group, profile) => {
    const groupEntries = type === 'sector'
      ? entries.filter((entry) => entryHasSector(entry, group.key)).map((entry) => ({ entry, sector: group.label }))
      : communityBadgeEntries(group.key);
    const badgeSettings = { ...defaultBadgeSettings, ...(profile?.settings || {}), version: badgeSettingsVersion };
    return groupEntries.map((item) => ({
      ...item,
      groupType: type,
      groupKey: group.key,
      groupLabel: group.label,
      profileId: profile.id,
      badgeSettings,
    }));
  };
  const openBadgeGroupPicker = (type) => {
    const groups = printGroups(type);
    if (!groups.length || printGroupPickerOpen) return;
    printGroupPickerOpen = true;
    const selectedGroupKeys = new Set();
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay';
    const typeLabel = type === 'sector' ? 'setor' : 'comunidade';
    const typeLabelPlural = type === 'sector' ? 'setores' : 'comunidades';
    const close = () => {
      printGroupPickerOpen = false;
      overlay.remove();
    };
    const renderGroupList = () => {
      overlay.innerHTML = `<div class="receiver-sector-dialog badge-multi-print-dialog"><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por ${typeLabel}</p><h2>Selecione ${typeLabelPlural}</h2><p>Marque um ou mais itens para revisar as pessoas antes da impress&atilde;o.</p></div></div><div class="badge-selection-tools"><button type="button" data-badge-select-all>Selecionar todos</button><button type="button" data-badge-clear-selection>Limpar sele&ccedil;&atilde;o</button></div><div class="badge-print-member-list badge-print-group-list">${groups.map((group, index) => `<label><input type="checkbox" data-badge-group-choice="${index}" ${selectedGroupKeys.has(group.key) ? 'checked' : ''}><span><strong>${escapeHtml(group.label)}</strong><small>${group.count} crach&aacute;(s)</small></span></label>`).join('')}</div><p class="form-message" data-badge-group-message></p><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button><button type="button" class="is-couple-continue" data-badge-review-groups disabled>Continuar</button></div></div>`;
      const inputs = [...overlay.querySelectorAll('[data-badge-group-choice]')];
      const continueButton = overlay.querySelector('[data-badge-review-groups]');
      const message = overlay.querySelector('[data-badge-group-message]');
      const syncGroupSelection = () => {
        selectedGroupKeys.clear();
        inputs.filter((input) => input.checked).forEach((input) => selectedGroupKeys.add(groups[Number(input.dataset.badgeGroupChoice)].key));
        continueButton.disabled = selectedGroupKeys.size === 0;
        message.textContent = selectedGroupKeys.size ? `${selectedGroupKeys.size} ${typeLabel}${selectedGroupKeys.size === 1 ? '' : type === 'sector' ? 'es' : 's'} selecionado(s).` : 'Selecione ao menos um item.';
      };
      inputs.forEach((input) => input.addEventListener('change', syncGroupSelection));
      overlay.querySelector('[data-badge-select-all]').addEventListener('click', () => { inputs.forEach((input) => { input.checked = true; }); syncGroupSelection(); });
      overlay.querySelector('[data-badge-clear-selection]').addEventListener('click', () => { inputs.forEach((input) => { input.checked = false; }); syncGroupSelection(); });
      overlay.querySelector('.close-sector-view').addEventListener('click', close);
      continueButton.addEventListener('click', () => {
        const selectedGroups = groups.filter((group) => selectedGroupKeys.has(group.key));
        const preparedGroups = selectedGroups.map((group) => ({ group, profile: printGroupProfile(type, group.key) }));
        const missingGroups = preparedGroups.filter((item) => !item.profile).map((item) => item.group.label);
        if (missingGroups.length) {
          message.textContent = `Defina um modelo em "Definir crachás por setor/comunidade" para: ${missingGroups.join(', ')}.`;
          return;
        }
        const items = preparedGroups.flatMap(({ group, profile }) => printGroupEntries(type, group, profile));
        renderMemberReview(items);
      });
      syncGroupSelection();
    };
    const renderMemberReview = (items) => {
      overlay.innerHTML = `<div class="receiver-sector-dialog badge-multi-print-dialog"><button type="button" class="receiver-sector-back" data-badge-back>← Voltar para ${typeLabelPlural}</button><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por ${typeLabel}</p><h2>Revise as pessoas</h2><p>Cada pessoa gerar&aacute; um crach&aacute; por vínculo selecionado.</p></div></div><div class="badge-selection-tools"><button type="button" data-badge-select-all ${items.length ? '' : 'disabled'}>Selecionar todos</button><button type="button" data-badge-clear-selection ${items.length ? '' : 'disabled'}>Limpar sele&ccedil;&atilde;o</button></div><div class="badge-print-member-list">${items.map((item, index) => `<label><input type="checkbox" data-badge-print-entry="${index}" checked><span><strong>${escapeHtml(item.entry.nome)}</strong><small>${escapeHtml(item.groupLabel)}${item.sector && normalizeText(item.sector) !== normalizeText(item.groupLabel) ? ` · ${escapeHtml(item.sector)}` : ''}</small></span></label>`).join('') || '<p class="empty-state">Nenhuma pessoa encontrada nos itens selecionados.</p>'}</div><p class="form-message" data-badge-member-message></p><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button><button type="button" class="is-couple-continue" data-badge-print-selected ${items.length ? '' : 'disabled'}>Imprimir selecionados</button></div></div>`;
      const inputs = [...overlay.querySelectorAll('[data-badge-print-entry]')];
      const printButton = overlay.querySelector('[data-badge-print-selected]');
      const message = overlay.querySelector('[data-badge-member-message]');
      const syncMemberSelection = () => {
        const count = inputs.filter((input) => input.checked).length;
        printButton.disabled = count === 0;
        message.textContent = count ? `${count} crachá(s) selecionado(s).` : 'Selecione ao menos uma pessoa.';
      };
      inputs.forEach((input) => input.addEventListener('change', syncMemberSelection));
      overlay.querySelector('[data-badge-select-all]').addEventListener('click', () => { inputs.forEach((input) => { input.checked = true; }); syncMemberSelection(); });
      overlay.querySelector('[data-badge-clear-selection]').addEventListener('click', () => { inputs.forEach((input) => { input.checked = false; }); syncMemberSelection(); });
      overlay.querySelector('[data-badge-back]').addEventListener('click', renderGroupList);
      overlay.querySelector('.close-sector-view').addEventListener('click', close);
      printButton.addEventListener('click', () => {
        const selected = inputs.filter((input) => input.checked).map((input) => items[Number(input.dataset.badgePrintEntry)]).filter(Boolean);
        if (!selected.length) return;
        activePrintMode = type;
        badgeManualSelection = selected;
        close();
        renderBadges();
        printBadges();
      });
      syncMemberSelection();
    };
    renderGroupList();
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
    const firstSettings = first?.badgeSettings || next;
    const configModelSelected = Boolean(selectedProfileId || blankPreview);
    const firstUsesConfiguredSectorName = first?.groupType !== 'community';
    preview.innerHTML = activeBadgeView === 'print' ? (first && selected.length ? badgeCard(first.entry, firstSettings, first.sector, badgeSectorNames, firstUsesConfiguredSectorName) : '') : activeBadgeView === 'config' && !configModelSelected ? '' : blankPreview || !first ? sampleBadgeCard(next) : badgeCard(first.entry, next, first.sector, badgeSectorNames, firstUsesConfiguredSectorName);
    badgePrintEntries = selected;
    const selectedGroupLabels = [...new Set(selected.map((item) => item.groupLabel).filter(Boolean))];
    const selectionLabel = selectedGroupLabels.length === 1 ? selectedGroupLabels[0] : activePrintMode === 'sector' ? 'Setores selecionados' : activePrintMode === 'community' ? 'Comunidades selecionadas' : retreat.nome;
    badgePrintTitle = `Crach\u00e1s - ${selectionLabel}`;
    const pages = [];
    for (let index = 0; index < selected.length; index += 8) pages.push(selected.slice(index, index + 8));
    printArea.innerHTML = pages.map((page) => `<div class="badge-print-sheet">${page.map(({ entry, sector, badgeSettings, groupType }) => badgeCard(entry, badgeSettings || next, sector, badgeSectorNames, groupType !== 'community')).join('')}</div>`).join('');
    app.querySelector('#badge-print-summary').textContent = `${selected.length} crach\u00e1(s) selecionado(s).`;
    if (printComment) {
      printComment.textContent = selected.length
        ? `${selectedGroupLabels.length} ${activePrintMode === 'sector' ? 'setor(es)' : 'comunidade(s)'} · ${selected.length} crach\u00e1(s)`
        : 'Escolha a impress\u00e3o por setor ou por comunidade.';
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
  const renderBadgeAssignmentsPanel = () => {
    if (!canConfigureBadges) return;
    const profileSelectOptions = (selectedId = '') => `<option value="">Nenhum modelo definido</option>${badgeProfiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === selectedId ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}`;
    const currentAssignment = (kind, key) => {
      const profileId = kind === 'communities' ? assignedProfileIdForCommunity(key) : assignedProfileIdForSector(key);
      return badgeProfiles.some((profile) => profile.id === profileId) ? profileId : '';
    };
    const assignmentRows = (items, kind) => items.map((item) => {
      const key = kind === 'communities' ? item.id : item;
      const label = kind === 'communities' ? communityName(item) : item;
      return `<div class="badge-sector-model-row" data-badge-sector-model-row><strong>${escapeHtml(label)}</strong><div><select data-badge-sector-model-select data-assignment-kind="${kind}" data-assignment-key="${escapeHtml(key)}">${profileSelectOptions(currentAssignment(kind, key))}</select></div></div>`;
    }).join('');
    const hasAssignmentTargets = sectors.length || badgeCommunities.length;
    assignmentPanel.innerHTML = `<form class="badge-sector-model-dialog badge-sector-model-page" id="badge-sector-model-form"><div class="panel-heading"><div><p class="eyebrow">Configura&ccedil;&atilde;o de crach&aacute;s</p><h2>Definir crach&aacute;s por setor/comunidade</h2><p>Associe os setores e as comunidades do retiro em foco aos modelos de crach&aacute; salvos.</p></div><button type="button" class="secondary-button badge-view-back" data-badge-home>Voltar</button></div><section class="badge-assignment-group"><h3>Setores</h3><div class="badge-sector-model-heading"><strong>Setor</strong><strong>Selecionar modelo</strong></div><div class="badge-sector-model-list">${assignmentRows(sectors, 'sectors') || '<p class="empty-state">Nenhum setor configurado neste retiro.</p>'}</div></section><section class="badge-assignment-group"><h3>Comunidades</h3><div class="badge-sector-model-heading"><strong>Comunidade</strong><strong>Selecionar modelo</strong></div><div class="badge-sector-model-list">${assignmentRows(badgeCommunities, 'communities') || '<p class="empty-state">Nenhuma comunidade cadastrada neste retiro.</p>'}</div></section><p class="form-message" id="badge-sector-model-message">${badgeProfiles.length ? '' : 'Cadastre ao menos um modelo de crachá para realizar as associações.'}</p><div class="form-actions"><button type="submit" class="is-couple-continue" ${hasAssignmentTargets ? '' : 'disabled'}>Salvar</button></div></form>`;
    const formElement = assignmentPanel.querySelector('#badge-sector-model-form');
    const message = assignmentPanel.querySelector('#badge-sector-model-message');
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const saveButton = formElement.querySelector('button[type="submit"]');
      const assignments = { sectors: {}, communities: {} };
      formElement.querySelectorAll('[data-badge-sector-model-select]').forEach((select) => {
        assignments[select.dataset.assignmentKind][select.dataset.assignmentKey] = select.value || '';
      });
      saveButton.disabled = true;
      message.textContent = 'Salvando...';
      try {
        const savedRecord = await saveBadgeSectorAssignments(retreat.id, assignments, badgeSectorAssignmentsRecordId);
        badgeSectorAssignmentsRecordId = savedRecord.id;
        badgeSectorAssignments = assignments;
        message.textContent = 'Modelos por setor e comunidade salvos.';
      } catch (error) {
        message.textContent = `Não foi possível salvar. ${error.message || 'Atualize a página e tente novamente.'}`;
      } finally {
        saveButton.disabled = false;
      }
    });
    assignmentPanel.querySelector('[data-badge-home]').addEventListener('click', () => showBadgeView(''));
  };
  const renderBadgeSectorNamesPanel = () => {
    if (!canViewBadgeSectorNames) return;
    const configuredNameFor = (sector) => {
      const direct = String(badgeSectorNames?.[sector] || '').trim();
      if (direct) return direct;
      const matched = Object.entries(badgeSectorNames || {}).find(([savedSector]) => normalizeText(savedSector) === normalizeText(sector));
      return String(matched?.[1] || '').trim();
    };
    const rows = sectors.map((sector) => `<div class="badge-sector-name-row"><strong>${escapeHtml(sector)}</strong><input type="text" data-badge-sector-name="${escapeHtml(sector)}" value="${escapeHtml(configuredNameFor(sector))}" placeholder="${escapeHtml(sector)}" ${canEditBadgeSectorNames ? '' : 'readonly'}></div>`).join('');
    sectorNamePanel.innerHTML = `<form class="badge-sector-model-dialog badge-sector-name-page" id="badge-sector-name-form"><div class="panel-heading"><div><p class="eyebrow">Configura&ccedil;&atilde;o de crach&aacute;s</p><h2>Personalizar nome do setor no crach&aacute;</h2><p>Ajuste o nome do setor para aparecer no crach&aacute;. Se o campo ficar vazio, ser&aacute; usado o nome original.</p></div><button type="button" class="secondary-button badge-view-back" data-badge-home>Voltar</button></div><section class="badge-assignment-group"><div class="badge-sector-name-heading"><strong>Nome original</strong><strong>Nome exibido no crach&aacute;</strong></div><div class="badge-sector-name-list">${rows || '<p class="empty-state">Nenhum setor configurado ou utilizado neste retiro.</p>'}</div></section><p class="form-message" id="badge-sector-name-message">${canEditBadgeSectorNames ? '' : 'Somente consulta.'}</p>${canEditBadgeSectorNames ? `<div class="form-actions"><button type="submit" class="is-couple-continue" ${sectors.length ? '' : 'disabled'}>Salvar</button></div>` : ''}</form>`;
    const formElement = sectorNamePanel.querySelector('#badge-sector-name-form');
    const message = sectorNamePanel.querySelector('#badge-sector-name-message');
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!canEditBadgeSectorNames) return;
      const saveButton = formElement.querySelector('button[type="submit"]');
      const names = {};
      formElement.querySelectorAll('[data-badge-sector-name]').forEach((input) => {
        const displayName = input.value.trim();
        if (displayName) names[input.dataset.badgeSectorName] = displayName;
      });
      saveButton.disabled = true;
      message.textContent = 'Salvando...';
      try {
        const savedRecord = await saveBadgeSectorNames(retreat.id, names, badgeSectorNamesRecordId);
        badgeSectorNamesRecordId = savedRecord.id;
        badgeSectorNames = normalizeBadgeSectorNames(savedRecord.names || names);
        message.textContent = 'Nomes dos setores salvos.';
        showBadgeView('');
      } catch (error) {
        message.textContent = `Não foi possível salvar. ${error.message || 'Atualize a página e tente novamente.'}`;
      } finally {
        saveButton.disabled = false;
      }
    });
    sectorNamePanel.querySelector('[data-badge-home]').addEventListener('click', () => showBadgeView(''));
    if (canEditBadgeSectorNames) formElement.querySelector('[data-badge-sector-name]')?.focus();
  };
  const deleteCurrentProfile = async () => {
    if (!canDeleteBadges) return;
    const profile = badgeProfiles.find((item) => item.id === selectedProfileId || item.id === configSelect?.value);
    if (!profile) {
      if (configMessage) configMessage.textContent = 'Selecione um modelo salvo para excluir.';
      profileTrigger?.focus();
      return;
    }
    if (!confirm(`Excluir o crach\u00e1 "${profile.name}"?`)) return;
    badgeProfiles = badgeProfiles.filter((item) => item.id !== profile.id);
    await deleteBadgeProfile(profile.id);
    const cleanedAssignments = {
      sectors: Object.fromEntries(Object.entries(badgeSectorAssignments.sectors).map(([sector, profileId]) => [sector, profileId === profile.id ? '' : profileId])),
      communities: Object.fromEntries(Object.entries(badgeSectorAssignments.communities).map(([communityId, profileId]) => [communityId, profileId === profile.id ? '' : profileId])),
    };
    if (JSON.stringify(cleanedAssignments) !== JSON.stringify(badgeSectorAssignments)) {
      const savedRecord = await saveBadgeSectorAssignments(retreat.id, cleanedAssignments, badgeSectorAssignmentsRecordId);
      badgeSectorAssignmentsRecordId = savedRecord.id;
      badgeSectorAssignments = cleanedAssignments;
    }
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
  printPanel.querySelector('#badge-print-by-sector')?.addEventListener('click', () => openBadgeGroupPicker('sector'));
  printPanel.querySelector('#badge-print-by-community')?.addEventListener('click', () => openBadgeGroupPicker('community'));
  app.querySelectorAll('[data-badge-view]').forEach((button) => button.addEventListener('click', () => showBadgeView(button.dataset.badgeView)));
  app.querySelectorAll('[data-badge-home]').forEach((button) => button.addEventListener('click', () => showBadgeView('')));
  const setProfileMenuOpen = (open) => {
    if (!profileMenu || !profileTrigger) return;
    profileMenu.hidden = !open;
    profileTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  profileTrigger?.addEventListener('focus', (event) => {
    if (!profilePicker?.contains(event.relatedTarget)) setProfileMenuOpen(true);
  });
  profileTrigger?.addEventListener('click', () => setProfileMenuOpen(true));
  profileTrigger?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setProfileMenuOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    setProfileMenuOpen(true);
    const options = [...profileMenu.querySelectorAll('[data-badge-profile-choice]')];
    (event.key === 'ArrowDown' ? options[0] : options.at(-1))?.focus();
  });
  profileMenu?.addEventListener('click', (event) => {
    const option = event.target.closest('[data-badge-profile-choice]');
    if (!option) return;
    configSelect.value = option.dataset.badgeProfileChoice || '';
    setProfileMenuOpen(false);
    loadSelectedProfile();
    profileTrigger.focus();
  });
  profileMenu?.addEventListener('keydown', (event) => {
    const option = event.target.closest('[data-badge-profile-choice]');
    if (!option) return;
    const options = [...profileMenu.querySelectorAll('[data-badge-profile-choice]')];
    const currentIndex = options.indexOf(option);
    if (event.key === 'Escape') {
      event.preventDefault();
      setProfileMenuOpen(false);
      profileTrigger.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    options[(currentIndex + direction + options.length) % options.length]?.focus();
  });
  profilePicker?.addEventListener('focusout', (event) => {
    if (!profilePicker.contains(event.relatedTarget)) setProfileMenuOpen(false);
  });
  configSelect?.addEventListener('change', loadSelectedProfile);
  app.querySelector('#badge-new-config')?.addEventListener('click', startNewProfile);
  app.querySelector('#badge-save-tab')?.addEventListener('click', openSaveBadgeDialog);
  app.querySelector('#badge-delete-tab')?.addEventListener('click', deleteCurrentProfile);
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

const backupStableValue = (value) => {
  if (Array.isArray(value)) return value.map(backupStableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, backupStableValue(value[key])]));
  return value;
};
const backupChecksum = async (backup) => {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador nao oferece o recurso seguro necessario para validar o backup.');
  const source = JSON.stringify(backupStableValue({
    format: backup.format,
    version: backup.version,
    schemaVersion: backup.schemaVersion,
    storage: backup.storage,
    createdAt: backup.createdAt,
    tables: backup.tables,
  }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const backupFileTimestamp = (date = new Date()) => {
  const part = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}`;
};
const downloadBackupJson = (backup, safety = false) => {
  const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `familia-epc-${safety ? 'backup-seguranca' : 'backup'}-${backupFileTimestamp()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function generateCompleteBackup({ safety = false } = {}) {
  const manifest = await dataService.startBackupExport();
  const tables = Object.fromEntries((manifest.tableNames || Object.keys(manifest.counts || {})).map((name) => [name, []]));
  let offset = 0;
  try {
    while (true) {
      const page = await dataService.listBackupChunks(manifest.operationId, offset, 25);
      page.chunks.forEach((chunk) => {
        if (!tables[chunk.tableName]) tables[chunk.tableName] = [];
        tables[chunk.tableName].push(...chunk.rows);
      });
      offset += page.chunks.length;
      if (!page.hasMore) break;
    }
    const backup = {
      format: manifest.format,
      version: manifest.version,
      schemaVersion: manifest.schemaVersion,
      storage: manifest.storage,
      createdAt: manifest.createdAt,
      counts: manifest.counts,
      tables,
    };
    backup.checksum = await backupChecksum(backup);
    downloadBackupJson(backup, safety);
    if (!safety) lastBackupGeneratedAt = backup.createdAt;
    return backup;
  } finally {
    await dataService.cancelBackupOperation(manifest.operationId).catch(() => null);
  }
}
async function validateBackupFile(backup) {
  if (!backup || backup.format !== 'familia-epc-backup' || backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables)) throw new Error('O arquivo selecionado nao e um backup valido do Familia EPC.');
  if (!backup.createdAt || Number.isNaN(Date.parse(backup.createdAt))) throw new Error('O backup nao possui uma data valida.');
  const counts = Object.fromEntries(Object.entries(backup.tables).map(([name, rows]) => {
    if (!Array.isArray(rows)) throw new Error(`A tabela ${name} possui formato invalido.`);
    return [name, rows.length];
  }));
  if (JSON.stringify(backupStableValue(counts)) !== JSON.stringify(backupStableValue(backup.counts || {}))) throw new Error('As contagens informadas no arquivo nao conferem.');
  if (!/^[a-f0-9]{64}$/.test(String(backup.checksum || '')) || await backupChecksum(backup) !== backup.checksum) throw new Error('O arquivo esta incompleto, corrompido ou foi alterado.');
}
async function stageBackupRestore(backup) {
  const envelope = {
    format: backup.format,
    version: backup.version,
    schemaVersion: backup.schemaVersion,
    storage: backup.storage,
    createdAt: backup.createdAt,
    counts: backup.counts,
    checksum: backup.checksum,
  };
  const operation = await dataService.startBackupRestore(envelope);
  try {
    for (const [tableName, rows] of Object.entries(backup.tables)) {
      const totalChunks = Math.max(1, Math.ceil(rows.length / 200));
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        await dataService.uploadBackupChunk(operation.operationId, { tableName, chunkIndex, rows: rows.slice(chunkIndex * 200, (chunkIndex + 1) * 200) });
      }
    }
    return operation.operationId;
  } catch (error) {
    await dataService.cancelBackupOperation(operation.operationId).catch(() => null);
    throw error;
  }
}

const operationalReportCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

const studentRegistrationReportFileNumber = (record, studentFormType) => {
  const value = studentFormType === 'cursista-individual' ? record?.numeroFichaIndividual : record?.numeroFichaSmp;
  const number = Number(String(value ?? '').trim());
  return Number.isInteger(number) && number > 0 ? number : null;
};

async function openCompleteStudentSheetsReport() {
  const retreat = selectedRetreat();
  if (!retreat) throw new Error('Selecione um retiro em foco antes de gerar as fichas.');
  const configuredType = retreat.tipoFichaCursista || defaultStudentFormType;
  const printType = configuredType === 'cursista-individual' ? 'cursista' : configuredType;
  const loadedRecords = configuredType === 'cursista-individual'
    ? await dataService.listCursistas(retreat.id)
    : await coupleStudentSource(configuredType).list(retreat.id);
  const records = [...loadedRecords].sort((first, second) => {
    const firstNumber = studentRegistrationReportFileNumber(first, configuredType);
    const secondNumber = studentRegistrationReportFileNumber(second, configuredType);
    if (firstNumber !== null && secondNumber !== null && firstNumber !== secondNumber) return firstNumber - secondNumber;
    if (firstNumber !== null && secondNumber === null) return -1;
    if (firstNumber === null && secondNumber !== null) return 1;
    const firstName = configuredType === 'cursista-individual' ? first.nome : `${first.nomeDele || ''} ${first.nomeDela || ''}`;
    const secondName = configuredType === 'cursista-individual' ? second.nome : `${second.nomeDele || ''} ${second.nomeDela || ''}`;
    return String(firstName || '').localeCompare(String(secondName || ''), 'pt-BR', { sensitivity: 'base' });
  });
  const overlay = document.createElement('div');
  overlay.className = 'receiver-sector-overlay complete-student-sheets-overlay';
  overlay.innerHTML = `<section class="receiver-sector-dialog complete-student-sheets-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-student-sheets-title"><div class="panel-heading"><div><p class="eyebrow">Cursistas · ${escapeHtml(retreat.nome || 'Retiro em foco')}</p><h2 id="complete-student-sheets-title">Imprimir fichas completas</h2><p>${records.length} ficha(s) cadastrada(s). Cada ficha será impressa em uma página.</p></div></div><form class="complete-student-sheets-form"><div class="fields two-columns complete-student-sheet-range"><label class="field"><span>Ficha inicial</span><input name="initialFile" type="number" min="1" step="1" inputmode="numeric" placeholder="Inicial" ${records.length ? '' : 'disabled'}></label><label class="field"><span>Ficha final</span><input name="finalFile" type="number" min="1" step="1" inputmode="numeric" placeholder="Final" ${records.length ? '' : 'disabled'}></label></div><label class="complete-student-sheets-all"><input type="checkbox" name="printAll" ${records.length ? '' : 'disabled'}><span><strong>Imprimir todas</strong><small>Ignora o intervalo e inclui todas as fichas deste retiro.</small></span></label><p class="form-message" data-complete-student-sheets-message aria-live="polite">${records.length ? 'Informe o intervalo ou marque Imprimir todas.' : 'Não há fichas cadastradas para este retiro.'}</p><div class="student-photo-editor-actions"><button type="button" class="secondary-button" data-complete-student-sheets-close>Cancelar</button><button type="submit" class="primary-button" ${records.length ? '' : 'disabled'}>Imprimir fichas</button></div></form></section>`;
  app.append(overlay);
  const form = overlay.querySelector('form');
  const initialInput = form.elements.initialFile;
  const finalInput = form.elements.finalFile;
  const printAllInput = form.elements.printAll;
  const message = overlay.querySelector('[data-complete-student-sheets-message]');
  const submitButton = form.querySelector('button[type="submit"]');
  const close = () => overlay.remove();
  overlay.querySelector('[data-complete-student-sheets-close]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  printAllInput.addEventListener('change', () => {
    initialInput.disabled = printAllInput.checked;
    finalInput.disabled = printAllInput.checked;
    message.textContent = printAllInput.checked ? `${records.length} ficha(s) serão impressas.` : 'Informe o intervalo de fichas.';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let selectedRecords = records;
    if (!printAllInput.checked) {
      const initial = Number(initialInput.value);
      const final = Number(finalInput.value);
      if (!initialInput.value || !finalInput.value || !Number.isInteger(initial) || !Number.isInteger(final) || initial < 1 || final < 1) {
        message.textContent = 'Informe números válidos para a ficha inicial e a ficha final.';
        return;
      }
      if (initial > final) {
        message.textContent = 'A ficha inicial não pode ser maior que a ficha final.';
        return;
      }
      selectedRecords = records.filter((record) => {
        const fileNumber = studentRegistrationReportFileNumber(record, configuredType);
        return fileNumber !== null && fileNumber >= initial && fileNumber <= final;
      });
    }
    if (!selectedRecords.length) {
      message.textContent = 'Nenhuma ficha cadastrada foi encontrada no intervalo informado.';
      return;
    }
    submitButton.disabled = true;
    message.textContent = `Preparando ${selectedRecords.length} ficha(s) para impressão...`;
    const opened = printStudentRegistrationSheets({ retreat, records: selectedRecords, studentFormType: printType });
    if (opened) close();
    else {
      submitButton.disabled = false;
      message.textContent = 'A janela de impressão foi bloqueada. Permita pop-ups e tente novamente.';
    }
  });
  initialInput.focus();
}

const participationDeclarationTypes = retreatTypes.map((type) => ({
  type,
  label: type === 'EIS-ME AQUI' ? 'Eis-me aqui' : type,
  available: type === 'Girassol',
}));

const participationDeclarationModels = {
  Girassol: { available: true, buildDocument: girassolParticipationDeclarationDocument },
  Taschinha: { available: false },
  ONDA: { available: false },
  EJA: { available: false },
  EJU: { available: false },
  EPC: { available: false },
  SMP: { available: false },
  'EIS-ME AQUI': { available: false },
};

const participationDeclarationParticipant = ({ record, side = '', studentFormType, index }) => {
  const individual = studentFormType === 'cursista-individual';
  const name = individual ? record?.nome : record?.[`nome${side}`];
  const cpf = individual ? record?.cpf : record?.[`cpf${side}`];
  const fileNumber = individual ? record?.numeroFichaIndividual : record?.numeroFichaSmp;
  return {
    key: `${individual ? 'individual' : studentFormType}:${record?.id || fileNumber || index}:${side || 'student'}`,
    name: String(name || '').trim(),
    cpf: normalizeCpf(cpf),
    fileNumber: String(fileNumber || '').trim(),
    sourceLabel: individual ? 'Cursista individual' : `${studentFormType === 'cursista-epc' ? 'EPC' : 'SMP'} · ${side === 'Dele' ? 'Ele' : 'Ela'}`,
  };
};

async function listParticipationDeclarationParticipants(retreat) {
  const studentFormType = retreat?.tipoFichaCursista || defaultStudentFormType;
  if (studentFormType === 'cursista-individual') {
    return (await dataService.listCursistas(retreat.id))
      .map((record, index) => participationDeclarationParticipant({ record, studentFormType, index }));
  }
  const records = await coupleStudentSource(studentFormType).list(retreat.id);
  return records.flatMap((record, index) => ['Dele', 'Dela'].map((side) => participationDeclarationParticipant({ record, side, studentFormType, index })));
}

function listTeamParticipationDeclarationParticipants(retreat) {
  return enrolments
    .filter((entry) => entry.retiroId === retreat.id)
    .map((entry, index) => {
      const entryCpf = normalizeCpf(entry.pessoaId);
      const person = people.find((item) => item.id === entry.pessoaId || normalizeCpf(item.cpf || item.id) === entryCpf) || {};
      const historical = entry.dadosPessoais || {};
      const cpf = normalizeCpf(historical.cpf || person.cpf || entry.pessoaId || person.id);
      const sectors = Array.isArray(entry.setores) ? entry.setores.filter(Boolean) : [];
      return {
        key: `team:${entry.id || entry.pessoaId || index}`,
        name: String(entry.nome || historical.nome || person.nome || '').trim(),
        cpf,
        fileNumber: '',
        sourceLabel: `Equipe de trabalho${sectors.length ? ` · ${sectors.join(', ')}` : ' · Setor não informado'}${entry.casalId ? ' · Cadastro de casal' : ''}`,
      };
    });
}

const participationDeclarationSearchMatches = (participant, query) => {
  const normalizedQuery = normalizeText(query);
  const cpfQuery = normalizeCpf(query);
  const searchable = normalizeText([participant.name, participant.cpf, participant.cpf && formatCpf(participant.cpf), participant.fileNumber, participant.sourceLabel].filter(Boolean).join(' '));
  return !normalizedQuery || searchable.includes(normalizedQuery) || Boolean(cpfQuery && participant.cpf.includes(cpfQuery));
};

const participationDeclarationLongDate = (value) => {
  const normalized = normalizeDateInput(value);
  if (!normalized) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${normalized}T12:00:00`));
};

const participationDeclarationPeriod = (startValue, endValue) => {
  const start = normalizeDateInput(startValue);
  const end = normalizeDateInput(endValue);
  if (!start || !end) return '';
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(`${start}T12:00:00`));
  if (start === end) return `no dia ${startDay} de ${month} de ${startYear}`;
  if (startYear === endYear && startMonth === endMonth) return `nos dias ${startDay} e ${endDay} de ${month} de ${startYear}`;
  return `no período de ${participationDeclarationLongDate(start)} a ${participationDeclarationLongDate(end)}`;
};

function girassolParticipationDeclarationDocument({ retreat, participant, audience = 'students' }) {
  const period = participationDeclarationPeriod(retreat.dataInicio, retreat.dataTermino);
  const issueDate = participationDeclarationLongDate(retreat.dataInicio);
  const girassolLogo = new URL('assets/girassol.png', document.baseURI).href;
  const epcLogo = new URL('assets/epc.png', document.baseURI).href;
  const parishLogo = new URL('assets/paroquia-santa-ines.svg', document.baseURI).href;
  const participationRole = audience === 'team' ? 'voluntário(a)' : 'cursista';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Declaração de Participação - ${escapeHtml(participant.name)}</title><style>
    @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:"Times New Roman",serif}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.declaration-page{display:flex;flex-direction:column;width:210mm;height:297mm;padding:26mm 25mm 17mm}.organization{margin:0;text-align:center;font-size:15pt;font-weight:700;line-height:1.2}.declaration-title{margin:19mm 0 18mm;text-align:center;font-size:18pt;line-height:1.2}.declaration-body{margin:0;font-size:12pt;line-height:1.85;text-align:justify;text-indent:12mm}.declaration-body+.declaration-body{margin-top:4mm}.declaration-value{font-weight:700}.declaration-place{margin:8mm 0 0;font-size:12pt;line-height:1.55}.declaration-contact{margin:9mm 0 0;font-size:12pt;line-height:1.55;text-align:justify}.declaration-date{margin:9mm 0 0;font-size:12pt}.signature{width:92mm;margin:13mm auto 0;text-align:center;font-size:11pt;line-height:1.25}.signature-line{border-top:.35mm solid #000;padding-top:2mm}.signature strong,.signature span{display:block}.association{margin-top:6mm;text-align:center;font:700 11pt Arial,sans-serif;line-height:1.35}.association span{display:block}.declaration-logos{display:grid;grid-template-columns:2.2fr .95fr 1.2fr;align-items:center;gap:8mm;margin-top:auto}.declaration-logos img{display:block;width:100%;height:31mm;object-fit:contain}.declaration-logos img:first-child{height:27mm}@media screen{body{display:grid;place-items:start center;min-height:100vh;padding:10mm;background:#e8ece7}.declaration-page{background:#fff;box-shadow:0 10px 30px #1f2c2830}}@media print{body{background:#fff}.declaration-page{box-shadow:none}}
  </style></head><body><main class="declaration-page"><p class="organization">FAMÍLIA EPC - PARÓQUIA SANTA INÊS - INDAIAL - SC</p><h1 class="declaration-title">DECLARAÇÃO DE PARTICIPAÇÃO</h1><p class="declaration-body">Declaro para os devidos fins que <span class="declaration-value">${escapeHtml(participant.name)}</span>, documento <span class="declaration-value">${escapeHtml(formatCpf(participant.cpf))}</span>, participou do curso/retiro denominado <strong>GIRASSOL</strong>, ${escapeHtml(period)}, onde participou como ${participationRole} na seguinte atividade: <strong>EVANGELIZAÇÃO DE CRIANÇAS DE 07 A 10 ANOS</strong>, (Das 8h às 18:30h).</p><p class="declaration-place"><strong>Local:</strong> Paróquia Santa Inês - R. Mal. Floriano Peixoto, 362 - Centro, Indaial - SC.</p><p class="declaration-contact">Dúvidas ou esclarecimentos podem ser obtidas com a Coordenação Geral pelos contatos a seguir listados.</p><p class="declaration-date">Indaial, ${escapeHtml(issueDate)}.</p><section class="signature"><div class="signature-line"><strong>EVANDRO BIEGER/ LUCIANA A. N. BIEGER</strong><span>COORDENAÇÃO GERAL</span><span>FAMÍLIA EPC</span><span>47 - 988328012</span></div></section><p class="association"><span>Associação dos Amigos do Encontro de Pais com Cristo de Indaial</span><span>CNPJ 52.109.946/0001-94</span></p><footer class="declaration-logos"><img src="${escapeHtml(parishLogo)}" alt="Paróquia Santa Inês"><img src="${escapeHtml(epcLogo)}" alt="Encontro de Pais com Cristo"><img src="${escapeHtml(girassolLogo)}" alt="Girassol - Ama pra valer"></footer></main></body></html>`;
}

function openParticipationDeclarationPrint(documentHtml) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();
  const printWhenReady = () => {
    const images = [...printWindow.document.images];
    Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }))).then(() => setTimeout(() => { printWindow.focus(); printWindow.print(); }, 120));
  };
  if (printWindow.document.readyState === 'complete') printWhenReady();
  else printWindow.addEventListener('load', printWhenReady, { once: true });
  return true;
}

async function openParticipationDeclarationReport({ audience = 'students' } = {}) {
  const retreat = selectedRetreat();
  if (!retreat) throw new Error('Selecione um retiro em foco antes de gerar a declaração.');
  const isTeam = audience === 'team';
  const audienceLabel = isTeam ? 'Equipe de trabalho' : 'Cursistas';
  const personLabel = isTeam ? 'integrante da equipe' : 'cursista';
  const participants = (isTeam ? listTeamParticipationDeclarationParticipants(retreat) : await listParticipationDeclarationParticipants(retreat))
    .sort((first, second) => operationalReportCollator.compare(first.name || 'Sem nome', second.name || 'Sem nome'));
  const suggestedType = participationDeclarationTypes.some((item) => item.type === retreat.tipoRetiro) ? retreat.tipoRetiro : '';
  const overlay = document.createElement('div');
  overlay.className = 'receiver-sector-overlay participation-declaration-overlay';
  overlay.innerHTML = `<section class="receiver-sector-dialog participation-declaration-dialog" role="dialog" aria-modal="true" aria-labelledby="participation-declaration-title"><div class="panel-heading"><div><p class="eyebrow">${audienceLabel} · ${escapeHtml(retreat.nome || 'Retiro em foco')}</p><h2 id="participation-declaration-title">Declaração de Participação</h2><p>Selecione o modelo e carregue os dados de uma pessoa cadastrada neste retiro.</p></div></div><form class="participation-declaration-form"><label class="field"><span>Tipo da declaração</span><select name="declarationType"><option value="" disabled ${suggestedType ? '' : 'selected'}>Selecione o tipo do retiro</option>${participationDeclarationTypes.map((item) => `<option value="${escapeHtml(item.type)}" ${item.type === suggestedType ? 'selected' : ''}>${escapeHtml(item.label)}${item.available ? '' : ' - modelo ainda não definido'}</option>`).join('')}</select></label><p class="participation-declaration-model-status" data-declaration-model-status role="status"></p><label class="field participation-declaration-search"><span>${isTeam ? 'Buscar equipe de trabalho' : 'Buscar cursista'}</span><input name="studentSearch" type="search" autocomplete="off" placeholder="${isTeam ? 'Digite nome, CPF ou setor' : 'Digite nome, CPF ou número da ficha'}" ${participants.length ? '' : 'disabled'}></label><div class="participation-declaration-results" data-declaration-results hidden></div><section class="participation-declaration-selected" data-declaration-selected hidden></section><p class="form-message" data-declaration-message aria-live="polite">${participants.length ? `Busque e selecione o ${personLabel}.` : `Não há ${isTeam ? 'integrantes da equipe de trabalho' : 'cursistas'} cadastrados neste retiro.`}</p><div class="student-photo-editor-actions"><button type="button" class="secondary-button" data-declaration-close>Cancelar</button><button type="submit" class="primary-button" disabled>Visualizar e imprimir</button></div></form></section>`;
  app.append(overlay);
  const form = overlay.querySelector('form');
  const typeSelect = form.elements.declarationType;
  const searchInput = form.elements.studentSearch;
  const results = overlay.querySelector('[data-declaration-results]');
  const selectedSummary = overlay.querySelector('[data-declaration-selected]');
  const modelStatus = overlay.querySelector('[data-declaration-model-status]');
  const message = overlay.querySelector('[data-declaration-message]');
  const submitButton = form.querySelector('button[type="submit"]');
  let selectedParticipant = null;
  const close = () => overlay.remove();
  const selectedModel = () => participationDeclarationModels[typeSelect.value];
  const missingData = () => {
    if (!selectedParticipant?.name) return `O ${personLabel} selecionado não possui nome cadastrado.`;
    if (!selectedParticipant?.cpf) return `O ${personLabel} selecionado não possui CPF cadastrado.`;
    if (!normalizeDateInput(retreat.dataInicio) || !normalizeDateInput(retreat.dataTermino)) return 'As datas inicial e final do retiro precisam estar preenchidas nas Configurações.';
    if (normalizeDateInput(retreat.dataTermino) < normalizeDateInput(retreat.dataInicio)) return 'A data final do retiro não pode ser anterior à data inicial.';
    return '';
  };
  const updateAvailability = () => {
    const model = selectedModel();
    const selectedType = participationDeclarationTypes.find((item) => item.type === typeSelect.value);
    modelStatus.className = `participation-declaration-model-status ${model?.available ? 'is-available' : 'is-pending'}`;
    modelStatus.textContent = model?.available ? `Modelo ${selectedType?.label || typeSelect.value} disponível.` : (typeSelect.value ? `O modelo ${selectedType?.label || typeSelect.value} ainda não foi definido.` : 'Selecione um tipo de declaração.');
    submitButton.disabled = !model?.available || !selectedParticipant || Boolean(missingData());
    if (selectedParticipant && missingData()) message.textContent = missingData();
    else if (selectedParticipant) message.textContent = model?.available ? 'Dados prontos para gerar a declaração.' : 'Selecione um modelo disponível para continuar.';
  };
  const selectParticipant = (participant) => {
    selectedParticipant = participant;
    selectedSummary.hidden = false;
    selectedSummary.innerHTML = `<span>${isTeam ? 'Integrante selecionado' : 'Cursista selecionado'}</span><strong>${escapeHtml(participant.name || 'Nome não informado')}</strong><small>${participant.cpf ? formatCpf(participant.cpf) : 'CPF não informado'}${participant.fileNumber ? ` · Ficha ${escapeHtml(participant.fileNumber)}` : ''} · ${escapeHtml(participant.sourceLabel)}</small>`;
    results.hidden = true;
    searchInput.value = participant.name;
    updateAvailability();
  };
  const renderResults = () => {
    selectedParticipant = null;
    selectedSummary.hidden = true;
    selectedSummary.innerHTML = '';
    submitButton.disabled = true;
    const query = searchInput.value.trim();
    if (!query) {
      results.hidden = true;
      results.innerHTML = '';
      message.textContent = participants.length ? `Busque e selecione o ${personLabel}.` : `Não há ${isTeam ? 'integrantes da equipe de trabalho' : 'cursistas'} cadastrados neste retiro.`;
      return;
    }
    const matches = participants.filter((participant) => participationDeclarationSearchMatches(participant, query)).slice(0, 30);
    results.hidden = false;
    results.innerHTML = matches.length ? matches.map((participant) => `<button type="button" data-declaration-participant="${escapeHtml(participant.key)}"><strong>${escapeHtml(participant.name || 'Nome não informado')}</strong><span>${participant.cpf ? formatCpf(participant.cpf) : 'CPF não informado'}${participant.fileNumber ? ` · Ficha ${escapeHtml(participant.fileNumber)}` : ''}</span><small>${escapeHtml(participant.sourceLabel)}</small></button>`).join('') : `<p>Nenhum ${personLabel} encontrado neste retiro.</p>`;
    results.querySelectorAll('[data-declaration-participant]').forEach((button) => button.addEventListener('click', () => {
      const participant = participants.find((item) => item.key === button.dataset.declarationParticipant);
      if (participant) selectParticipant(participant);
    }));
    message.textContent = matches.length ? `${matches.length} resultado(s) encontrado(s).` : `Nenhum ${personLabel} encontrado neste retiro.`;
  };
  overlay.querySelector('[data-declaration-close]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  typeSelect.addEventListener('change', updateAvailability);
  searchInput.addEventListener('input', renderResults);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const model = selectedModel();
    const validationMessage = missingData();
    if (!model?.available) { message.textContent = 'O modelo selecionado ainda não foi definido.'; return; }
    if (!selectedParticipant) { message.textContent = `Busque e selecione o ${personLabel}.`; return; }
    if (validationMessage) { message.textContent = validationMessage; return; }
    const opened = openParticipationDeclarationPrint(model.buildDocument({ retreat, participant: selectedParticipant, audience }));
    if (opened) close();
    else message.textContent = 'A janela de impressão foi bloqueada. Permita pop-ups e tente novamente.';
  });
  updateAvailability();
  (suggestedType ? searchInput : typeSelect).focus();
}

const operationalReports = [
  { id: 'community-shirts-summary', topic: 'Comunidades', title: 'Camisetas dos cursistas por comunidade', description: 'Lista os cursistas e os tamanhos de camiseta agrupados por comunidade.', permission: 'inicio.ver', formTypes: ['cursista-individual'], source: 'inicio', formats: ['Impressão'], steps: ['[data-home-stat="shirts"]', '.home-stat-dialog [data-home-stat-print="1"]'] },
  { id: 'community-shirts-large', topic: 'Comunidades', title: 'Número das camisetas por comunidade — formato ampliado', description: 'Gera a relação de camisetas por comunidade em A4, duas colunas e fonte ampliada.', permission: 'comunidades.ver', source: 'comunidades', formats: ['Impressão'], steps: ['#print-community-shirts'] },
  { id: 'badges-community', topic: 'Crachás', title: 'Crachás por comunidade', description: 'Permite escolher comunidades, revisar pessoas e imprimir os crachás com o modelo associado.', permission: 'crachas.imprimir', source: 'crachas', formats: ['Impressão'], actionLabel: 'Configurar impressão', steps: ['[data-badge-view="print"]', '#badge-print-by-community'] },
  { id: 'badges-sector', topic: 'Crachás', title: 'Crachás por setor', description: 'Permite escolher setores, revisar pessoas e imprimir os crachás com o modelo associado.', permission: 'crachas.imprimir', source: 'crachas', formats: ['Impressão'], actionLabel: 'Configurar impressão', steps: ['[data-badge-view="print"]', '#badge-print-by-sector'] },
  { id: 'student-allergies', topic: 'Cursistas', title: 'Alergias a medicamentos', description: 'Relaciona cursistas individuais com alergias a medicamentos e os detalhes informados.', permission: 'inicio.ver', formTypes: ['cursista-individual'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="allergy"]'] },
  { id: 'student-birthdays', topic: 'Cursistas', title: 'Aniversariantes dos cursistas', description: 'Apresenta os aniversariantes do mês com comunidade e data de nascimento.', permission: 'inicio.ver', formTypes: ['cursista-individual'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="birthdays"]'] },
  { id: 'student-shirts-couple', topic: 'Cursistas', title: 'Camisetas por casal', description: 'Organiza os tamanhos de camiseta por casal cursista SMP ou EPC.', permission: 'inicio.ver', formTypes: ['cursista-smp', 'cursista-epc'], source: 'inicio', formats: ['Impressão'], steps: ['[data-home-stat="shirts"]', '.home-stat-dialog [data-home-stat-print="1"]'] },
  { id: 'student-shirts-size', topic: 'Cursistas', title: 'Camisetas por tamanho', description: 'Resume a quantidade de camisetas de cursistas por tamanho informado.', permission: 'inicio.ver', source: 'inicio', formats: ['Impressão'], steps: ['[data-home-stat="shirts"]', '.home-stat-dialog [data-home-stat-print="0"]'] },
  { id: 'student-intolerances-individual', topic: 'Cursistas', title: 'Intolerâncias alimentares', description: 'Relaciona cursistas individuais com intolerâncias alimentares e os detalhes informados.', permission: 'inicio.ver', formTypes: ['cursista-individual'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="intolerance"]'] },
  { id: 'student-intolerances-couple', topic: 'Cursistas', title: 'Intolerâncias alimentares', description: 'Relaciona as pessoas das fichas SMP ou EPC com intolerâncias alimentares.', permission: 'inicio.ver', formTypes: ['cursista-smp', 'cursista-epc'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="smp-intolerance"]'] },
  { id: 'student-continuous-medication', topic: 'Cursistas', title: 'Medicação contínua', description: 'Relaciona cursistas individuais que utilizam medicamento contínuo.', permission: 'inicio.ver', formTypes: ['cursista-individual'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="continuous-medication"]'] },
  { id: 'student-parent-medication', topic: 'Cursistas', title: 'Medicação sugerida pelos pais', description: 'Mostra os medicamentos para dor de cabeça ou estômago sugeridos pelos responsáveis.', permission: 'inicio.ver', formTypes: ['cursista-individual'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="parent-suggested-medication"]'] },
  { id: 'student-welcome', topic: 'Cursistas', title: 'Necessidade de acolhimento', description: 'Lista os casais SMP ou EPC que informaram necessidade de acolhimento.', permission: 'inicio.ver', formTypes: ['cursista-smp', 'cursista-epc'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="smp-acolhimento"]'] },
  { id: 'student-health-couple', topic: 'Cursistas', title: 'Problemas de saúde', description: 'Relaciona as pessoas das fichas SMP ou EPC com problemas de saúde informados.', permission: 'inicio.ver', formTypes: ['cursista-smp', 'cursista-epc'], source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="smp-health"]'] },
  { id: 'student-participation-declaration', topic: 'Cursistas', title: 'Declaração de Participação', description: 'Busca um cursista do retiro em foco e gera sua declaração individual de participação.', permissionsByFormType: { 'cursista-individual': 'cursista.ver', 'cursista-smp': 'cursista-smp.ver', 'cursista-epc': 'cursista-epc.ver' }, source: 'relatorios', formats: ['Visualização', 'Impressão'], actionLabel: 'Selecionar cursista', direct: true, steps: [] },
  { id: 'student-complete-sheets', topic: 'Cursistas', title: 'Imprimir fichas completas', description: 'Imprime as fichas completas dos cursistas do retiro em foco por intervalo ou todas de uma vez.', permissionsByFormType: { 'cursista-individual': 'cursista.ver', 'cursista-smp': 'cursista-smp.ver', 'cursista-epc': 'cursista-epc.ver' }, source: 'relatorios', formats: ['Impressão'], actionLabel: 'Selecionar fichas', direct: true, steps: [] },
  { id: 'team-participation-declaration', topic: 'Equipe de trabalho', title: 'Declaração de Participação', description: 'Busca uma pessoa da equipe do retiro em foco e gera sua declaração individual de participação.', permission: 'pessoas.ver', source: 'relatorios', formats: ['Visualização', 'Impressão'], actionLabel: 'Selecionar integrante', direct: true, steps: [] },
  { id: 'team-birthdays', topic: 'Equipe de trabalho', title: 'Aniversariantes da equipe', description: 'Apresenta aniversariantes da equipe com setor e data de nascimento.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="team-birthdays"]'] },
  { id: 'team-photos', topic: 'Equipe de trabalho', title: 'Fotos solicitadas', description: 'Lista as fichas da equipe que solicitaram a foto oficial do retiro.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="photo"]'] },
  { id: 'team-groups', topic: 'Equipe de trabalho', title: 'Pessoas por grupo', description: 'Resume a equipe por grupo de participação e permite detalhar um grupo.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-stat="groups"]'] },
  { id: 'team-sectors', topic: 'Equipe de trabalho', title: 'Pessoas por setor', description: 'Resume a equipe por setor e permite abrir a relação detalhada de um setor.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-stat="sectors"]'] },
  { id: 'team-quadrante-requests', topic: 'Equipe de trabalho', title: 'Solicitações de quadrante impresso', description: 'Lista as fichas da equipe que solicitaram quadrante impresso.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="quadrante"]'] },
  { id: 'kids-registered', topic: 'Espaço Kids', title: 'Crianças cadastradas', description: 'Relaciona as crianças cadastradas, suas idades e os responsáveis.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="kids"]'] },
  { id: 'kids-intolerances', topic: 'Espaço Kids', title: 'Crianças com intolerância alimentar', description: 'Reúne crianças da equipe e dos cursistas com intolerância alimentar.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="kids-intolerance"]'] },
  { id: 'kids-health', topic: 'Espaço Kids', title: 'Crianças com problema de saúde', description: 'Reúne crianças da equipe e dos cursistas com problema de saúde.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="kids-health"]'] },
  { id: 'general-cities', topic: 'Geral', title: 'Cidades participantes', description: 'Apresenta a quantidade de cursistas e integrantes da equipe por cidade.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-health="cities"]'] },
  { id: 'general-presence', topic: 'Geral', title: 'Presença por dia', description: 'Resume a presença prevista de cursistas e equipe em cada dia do retiro.', permission: 'inicio.ver', source: 'inicio', formats: ['Visualização', 'Impressão'], steps: ['[data-home-stat="presence"]'] },
  { id: 'quadrante-complete', topic: 'Quadrante', title: 'Relatório completo', description: 'Gera o quadrante completo com setores, comunidades, responsáveis, endereços e contatos.', permission: 'quadrante.imprimir', source: 'quadrante', formats: ['Impressão'], steps: ['#print-quadrante'] },
  { id: 'quadrante-secret-friend', topic: 'Quadrante', title: 'Relatório para amigo secreto', description: 'Gera nome e setor das pessoas vinculadas à Equipe Escondida.', permission: 'quadrante.imprimir', source: 'quadrante', formats: ['Impressão'], steps: ['#print-secret-friend'] },
].map((report) => ({ ...report, generate: () => runOperationalReportGenerator(report) }));

async function runOperationalReportGenerator(report) {
  if (report.id === 'student-complete-sheets') return openCompleteStudentSheetsReport();
  if (report.id === 'student-participation-declaration') return openParticipationDeclarationReport();
  if (report.id === 'team-participation-declaration') return openParticipationDeclarationReport({ audience: 'team' });
  for (const selector of report.steps) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const control = app.querySelector(selector);
    if (!control) throw new Error(`Não foi possível abrir "${report.title}" nesta tela.`);
    control.click();
  }
}

let pendingOperationalReportId = '';
let operationalReportReturnState = null;

const returnToOperationalReports = () => {
  if (!operationalReportReturnState || operationalReportReturnState.returning) return;
  operationalReportReturnState.returning = true;
  if (location.hash === '#relatorios') {
    restoreOperationalReportPosition();
    return;
  }
  location.hash = '#relatorios';
};

const watchOperationalReportClose = () => {
  const overlay = app.querySelector('.home-stat-overlay, .student-financial-summary-overlay, .receiver-sector-overlay');
  if (!overlay) {
    returnToOperationalReports();
    return;
  }
  const observer = new MutationObserver(() => {
    if (app.contains(overlay)) return;
    observer.disconnect();
    if (location.hash !== '#relatorios' && location.hash !== `#${operationalReportReturnState?.source || ''}`) {
      operationalReportReturnState = null;
      return;
    }
    returnToOperationalReports();
  });
  observer.observe(app, { childList: true, subtree: true });
};

const restoreOperationalReportPosition = async () => {
  if (!operationalReportReturnState || location.hash !== '#relatorios' || !app.querySelector('.report-center-topics')) return;
  const state = operationalReportReturnState;
  operationalReportReturnState = null;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const launch = app.querySelector(`[data-report-launch="${CSS.escape(state.reportId)}"]`);
  const toggle = app.querySelector(`[data-report-description="${CSS.escape(state.reportId)}"]`);
  if (state.descriptionExpanded && toggle?.getAttribute('aria-expanded') !== 'true') toggle.click();
  window.scrollTo({ top: state.scrollY, behavior: 'auto' });
  launch?.focus({ preventScroll: true });
};

const operationalReportAvailable = (report, retreat) => {
  const formType = retreat?.tipoFichaCursista || defaultStudentFormType;
  const permission = report.permissionsByFormType?.[formType] || report.permission;
  return canAccess(permission) && (!report.formTypes?.length || report.formTypes.includes(formType));
};

const launchOperationalReport = async (reportId) => {
  const report = operationalReports.find((item) => item.id === reportId);
  if (!report) return;
  const toggle = app.querySelector(`[data-report-description="${CSS.escape(report.id)}"]`);
  operationalReportReturnState = {
    reportId: report.id,
    source: report.source,
    scrollY: window.scrollY,
    descriptionExpanded: toggle?.getAttribute('aria-expanded') === 'true',
    returning: false,
  };
  if (report.direct) {
    try {
      await report.generate();
      watchOperationalReportClose();
    } catch (error) {
      alert(error.message);
      operationalReportReturnState = null;
    }
    return;
  }
  pendingOperationalReportId = report.id;
  if (location.hash === '#' + report.source) {
    await routeAndLaunchOperationalReport();
    return;
  }
  location.hash = '#' + report.source;
};

const launchPendingOperationalReport = async () => {
  if (!pendingOperationalReportId) return;
  const report = operationalReports.find((item) => item.id === pendingOperationalReportId);
  pendingOperationalReportId = '';
  if (!report || location.hash !== '#' + report.source) return;
  const main = app.querySelector('.admin-main');
  if (main) {
    const banner = document.createElement('section');
    banner.className = 'operational-report-origin';
    const summary = document.createElement('div');
    const title = document.createElement('strong');
    const note = document.createElement('span');
    const back = document.createElement('a');
    title.textContent = report.title;
    note.textContent = 'Relatório aberto pela Central de Relatórios.';
    back.href = '#relatorios';
    back.textContent = 'Voltar aos relatórios';
    summary.append(title, note);
    banner.append(summary, back);
    main.prepend(banner);
  }
  try {
    await report.generate();
    watchOperationalReportClose();
  } catch (error) {
    alert(error.message);
    returnToOperationalReports();
  }
};

async function renderRelatorios() {
  await loadData();
  const retreat = selectedRetreat();
  const visibleReports = retreat
    ? operationalReports
      .filter((report) => operationalReportAvailable(report, retreat))
      .sort((first, second) => operationalReportCollator.compare(first.topic, second.topic) || operationalReportCollator.compare(first.title, second.title))
    : [];
  const topics = [...new Set(visibleReports.map((report) => report.topic))];
  const retreatContext = retreat ? `Retiro em foco: <strong>${escapeHtml(retreat.nome || 'Retiro sem nome')}</strong>` : 'Nenhum retiro em foco';
  layout(`<section class="page-heading report-center-heading"><div><p class="eyebrow">Consultas e impressões</p><h1>Central de Relatórios</h1><p>Todos os relatórios disponíveis para o seu acesso, usando os mesmos geradores das telas de origem.</p><p class="report-center-focus">${retreatContext}</p></div></section><section class="report-center-summary panel"><strong></strong><span></span></section><div class="report-center-topics"></div>`, 'relatorios');
  app.querySelector('.report-center-summary strong').textContent = visibleReports.length;
  app.querySelector('.report-center-summary span').textContent = retreat
    ? `relatório(s) disponível(is) para ${retreat.nome || 'o retiro em foco'}`
    : 'relatório(s) disponível(is) sem um retiro em foco';
  const topicsRoot = app.querySelector('.report-center-topics');
  if (!topics.length) {
    const empty = document.createElement('section');
    empty.className = 'panel empty-state';
    if (!retreat) {
      empty.append('Nenhum retiro está em foco. Selecione um retiro na opção ', Object.assign(document.createElement('a'), { href: '#inicio', textContent: 'Início' }), '.');
    } else {
      empty.textContent = 'Nenhum relatório está disponível com as suas permissões para este retiro.';
    }
    topicsRoot.append(empty);
  }
  topics.forEach((topic) => {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    const grid = document.createElement('div');
    section.className = 'report-center-topic';
    grid.className = 'report-center-grid';
    heading.textContent = topic;
    section.append(heading, grid);
    visibleReports.filter((report) => report.topic === topic).forEach((report) => {
      const card = document.createElement('article');
      const cardHeading = document.createElement('div');
      const reportTitle = document.createElement('h3');
      const formats = document.createElement('span');
      const toggle = document.createElement('button');
      const description = document.createElement('p');
      const launch = document.createElement('button');
      card.className = 'report-center-card';
      cardHeading.className = 'report-center-card-heading';
      reportTitle.textContent = report.title;
      formats.textContent = report.formats.join(' · ');
      toggle.type = 'button';
      toggle.className = 'report-description-toggle';
      toggle.dataset.reportDescription = report.id;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Ver descrição';
      description.id = 'report-description-' + report.id;
      description.className = 'report-center-description';
      description.hidden = true;
      description.textContent = report.description;
      toggle.setAttribute('aria-controls', description.id);
      launch.type = 'button';
      launch.className = 'primary-button report-launch-button';
      launch.dataset.reportLaunch = report.id;
      launch.textContent = report.actionLabel || 'Visualizar relatório';
      cardHeading.append(reportTitle, formats);
      card.append(cardHeading, toggle, description, launch);
      grid.append(card);
    });
    topicsRoot.append(section);
  });
  app.querySelectorAll('[data-report-description]').forEach((button) => {
    button.addEventListener('click', () => {
      const description = app.querySelector('#report-description-' + CSS.escape(button.dataset.reportDescription));
      if (!description) return;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? 'Ver descrição' : 'Ocultar descrição';
      description.hidden = expanded;
    });
  });
  app.querySelectorAll('[data-report-launch]').forEach((button) => {
    button.addEventListener('click', () => launchOperationalReport(button.dataset.reportLaunch));
  });
}

async function renderBackup() {
  if (!hasGlobalRetreatAccess()) return renderDenied();
  layout(`<section class="page-heading"><div><p class="eyebrow">Administra&ccedil;&atilde;o</p><h1>Backup e restaura&ccedil;&atilde;o</h1><p>Proteja todos os dados cadastrados no sistema e recupere uma fotografia anterior quando necess&aacute;rio.</p></div></section>
    <section class="backup-alert" role="alert"><strong>Arquivo confidencial</strong><p>O JSON cont&eacute;m dados pessoais, informa&ccedil;&otilde;es de sa&uacute;de, pagamentos e hashes de senha. Guarde-o em local privado e n&atilde;o envie por canais sem prote&ccedil;&atilde;o.</p></section>
    <div class="backup-grid">
      <section class="panel backup-panel"><div class="panel-heading"><div><p class="eyebrow">C&oacute;pia integral</p><h2>Gerar Backup</h2><p>A opera&ccedil;&atilde;o somente consulta o banco e baixa uma fotografia consistente em JSON.</p></div></div>
        <dl class="backup-summary"><div><dt>&Uacute;ltimo backup nesta sess&atilde;o</dt><dd id="last-backup-at">${lastBackupGeneratedAt ? escapeHtml(new Date(lastBackupGeneratedAt).toLocaleString('pt-BR')) : 'Nenhum'}</dd></div></dl>
        <p class="form-message" id="backup-export-message"></p>
        <div class="form-actions"><p>Nenhum cadastro atual ser&aacute; alterado.</p><button type="button" id="generate-backup">Gerar e baixar JSON <span>→</span></button></div>
      </section>
      <section class="panel backup-panel backup-restore-panel"><div class="panel-heading"><div><p class="eyebrow">A&ccedil;&atilde;o destrutiva</p><h2>Restaurar Backup</h2><p>Os dados atuais ser&atilde;o substitu&iacute;dos pelo estado existente no arquivo.</p></div></div>
        <label class="field"><span>Arquivo JSON de backup <b>*</b></span><input id="restore-backup-file" type="file" accept="application/json,.json"></label>
        <div id="backup-preview" class="backup-preview" hidden></div>
        <label class="field backup-confirm-field" hidden><span>Digite <b>RESTAURAR BACKUP</b> para confirmar</span><input id="restore-backup-confirmation" autocomplete="off"></label>
        <p class="form-message" id="backup-restore-message"></p>
        <div class="form-actions"><p>Um backup de seguran&ccedil;a do estado atual ser&aacute; baixado primeiro.</p><button type="button" class="danger-button" id="restore-backup" disabled>Restaurar dados <span>→</span></button></div>
      </section>
    </div>`, 'backup');

  const exportButton = app.querySelector('#generate-backup');
  const exportMessage = app.querySelector('#backup-export-message');
  exportButton.addEventListener('click', async () => {
    if (!confirm('ATENCAO: o JSON contera todos os dados pessoais e confidenciais do sistema. Deseja gerar e baixar o backup agora?')) return;
    exportButton.disabled = true;
    exportMessage.textContent = 'Preparando uma fotografia completa do banco...';
    try {
      const backup = await generateCompleteBackup();
      app.querySelector('#last-backup-at').textContent = new Date(backup.createdAt).toLocaleString('pt-BR');
      exportMessage.textContent = `Backup concluido com ${Object.values(backup.counts).reduce((total, count) => total + Number(count || 0), 0)} registros. Confirme o arquivo na pasta de downloads.`;
    } catch (error) {
      exportMessage.textContent = `Nao foi possivel gerar o backup. ${error.message || ''}`;
    } finally {
      exportButton.disabled = false;
    }
  });

  const fileInput = app.querySelector('#restore-backup-file');
  const previewBox = app.querySelector('#backup-preview');
  const confirmationField = app.querySelector('.backup-confirm-field');
  const confirmationInput = app.querySelector('#restore-backup-confirmation');
  const restoreButton = app.querySelector('#restore-backup');
  const restoreMessage = app.querySelector('#backup-restore-message');
  fileInput.addEventListener('change', async () => {
    restoreButton.disabled = true;
    previewBox.hidden = true;
    confirmationField.hidden = true;
    confirmationInput.value = '';
    restoreMessage.textContent = '';
    if (pendingRestoreOperationId) {
      await dataService.cancelBackupOperation(pendingRestoreOperationId).catch(() => null);
      pendingRestoreOperationId = '';
    }
    const file = fileInput.files?.[0];
    if (!file) return;
    restoreMessage.textContent = 'Validando o arquivo sem alterar o banco...';
    try {
      const backup = JSON.parse(await file.text());
      await validateBackupFile(backup);
      pendingRestoreOperationId = await stageBackupRestore(backup);
      const preview = await dataService.previewBackupRestore(pendingRestoreOperationId);
      const changedRows = Object.entries(preview.differences).filter(([, difference]) => difference.added || difference.changed || difference.deleted);
      const warnings = (preview.warnings || []).map((warning) => `<p class="backup-legacy-warning" role="alert"><strong>Aviso:</strong> ${escapeHtml(warning)}</p>`).join('');
      previewBox.innerHTML = `<h3>Pr&eacute;via da restaura&ccedil;&atilde;o</h3>${warnings}<p>Backup de <strong>${escapeHtml(new Date(preview.backupCreatedAt).toLocaleString('pt-BR'))}</strong>. Confira o impacto antes de continuar.</p><div class="table-wrapper"><table><thead><tr><th>Tabela</th><th>Atual</th><th>Backup</th><th>Novos</th><th>Alterados</th><th>Exclu&iacute;dos</th></tr></thead><tbody>${changedRows.length ? changedRows.map(([name, difference]) => `<tr><td>${escapeHtml(name)}</td><td>${difference.current}</td><td>${difference.backup}</td><td>${difference.added}</td><td>${difference.changed}</td><td class="backup-delete-count">${difference.deleted}</td></tr>`).join('') : '<tr><td colspan="6">O banco j&aacute; corresponde ao conte&uacute;do do backup.</td></tr>'}</tbody></table></div>`;
      previewBox.hidden = false;
      confirmationField.hidden = false;
      restoreMessage.textContent = 'Arquivo validado. A restauracao ainda nao alterou nenhum cadastro.';
    } catch (error) {
      if (pendingRestoreOperationId) await dataService.cancelBackupOperation(pendingRestoreOperationId).catch(() => null);
      pendingRestoreOperationId = '';
      restoreMessage.textContent = `Arquivo recusado. ${error.message || 'Confira o JSON selecionado.'}`;
    }
  });
  confirmationInput.addEventListener('input', () => { restoreButton.disabled = !pendingRestoreOperationId || confirmationInput.value.trim() !== 'RESTAURAR BACKUP'; });
  restoreButton.addEventListener('click', async () => {
    if (!pendingRestoreOperationId || confirmationInput.value.trim() !== 'RESTAURAR BACKUP') return;
    if (!confirm('PERIGO: esta acao substituira os dados atuais e removera tudo que nao existia no backup. Deseja preparar o backup de seguranca e continuar?')) return;
    restoreButton.disabled = true;
    fileInput.disabled = true;
    confirmationInput.disabled = true;
    restoreMessage.textContent = 'Gerando e baixando o backup de seguranca do estado atual...';
    try {
      await generateCompleteBackup({ safety: true });
      if (!confirm('O backup de seguranca foi enviado para a pasta de downloads. Confirma que o arquivo foi salvo e deseja iniciar a substituicao agora?')) {
        restoreMessage.textContent = 'Restauracao cancelada. Os dados atuais nao foram alterados.';
        restoreButton.disabled = false;
        fileInput.disabled = false;
        confirmationInput.disabled = false;
        return;
      }
      restoreMessage.textContent = 'Restaurando o banco. Nao feche esta pagina...';
      const result = await dataService.commitBackupRestore(pendingRestoreOperationId);
      pendingRestoreOperationId = '';
      const warningText = result.warnings?.length ? `\n\nAviso: ${result.warnings.join(' ')}` : '';
      alert(`Restauracao concluida com sucesso. Entre novamente no sistema para carregar os dados restaurados.${warningText}`);
      currentUser = null;
      authChecked = false;
      location.href = 'index.html';
    } catch (error) {
      restoreMessage.textContent = `A restauracao nao foi concluida. ${error.message || 'Os dados foram revertidos.'}`;
      restoreButton.disabled = false;
      fileInput.disabled = false;
      confirmationInput.disabled = false;
    }
  });
}

async function renderQuadrante() {
  const retreat = selectedRetreat();
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Relatório</p><h1>Quadrante</h1><p>Crie ou publique um retiro para gerar o relatório.</p></div></section>', 'quadrante'); return; }
  const [communities, students, savedQuadranteOrder] = await Promise.all([dataService.listComunidades(retreat.id), dataService.listCursistas(retreat.id), loadQuadranteOrderSetting()]);
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
      const groupRows = group.map((row, index) => {
        const sharedAddress = group.length > 1 && row.casalId;
        const addressCell = sharedAddress
          ? (index === 0 ? `<td class="shared-couple-address" rowspan="${group.length}">${escapeHtml(group[0].address)}</td>` : '')
          : `<td>${escapeHtml(row.address)}</td>`;
        const classes = [className, groupCoordinator ? 'sector-coordinator' : ''].filter(Boolean).join(' ');
        return `<tr${rowClass(classes)}>${nameCell(row.person, className)}${addressCell}${detailCells(row.person)}</tr>`;
      }).join('');
      return `<tbody class="quadrante-person-group">${groupRows}</tbody>`;
    }).join('');
  };
  const presentSectors = [...new Set(entries.flatMap((entry) => entry.setores || []))].filter((sector) => normalizeText(sector) !== 'tios de comunidade');
  const configuredSectors = uniqueSectors(retreat.setores || []).filter((sector) => normalizeText(sector) !== 'tios de comunidade');
  const orderSource = savedQuadranteOrder || retreat.ordemQuadrante || retreatQuadranteOrderFallback();
  const sectors = quadranteOrderForSectors(configuredSectors, orderSource);
  const orderableSectors = allQuadranteSectors([...orderSource, ...configuredSectors, ...presentSectors]);
  const orderableOrder = quadranteOrderForSectors(orderableSectors, orderSource);
  const secretFriendRows = sectors
    .filter((sector) => sectorArea(sector) === 'escondida')
    .flatMap((sector) => entries
      .filter((entry) => entryHasSector(entry, sector))
      .map((entry) => ({ person: personForEntry(entry), sector }))
      .sort((first, second) => byName(first.person, second.person)));
  const sectorSections = sectors.map((sector) => {
    const sectorEntries = entries
      .filter((entry) => entryHasSector(entry, sector))
      .map((entry) => { const person = personForEntry(entry); return { person, casalId: entry.casalId, address: addressForPerson(person), coordenacaoSetor: Boolean(entry.coordenacaoSetor) }; });
    return `<article class="quadrante-sector"><h3>${escapeHtml(sector)}</h3><table>${quadranteColgroup}${groupedParticipantRows(sectorEntries)}</table></article>`;
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
    return `<article><h3>${escapeHtml(community.nome)}</h3><table>${quadranteColgroup}${groupedParticipantRows(monitorEntries, 'community-monitor')}${groupedParticipantRows(leaderEntries, 'community-tio')}${groupedParticipantRows(members) || (!leaderEntries.length && !monitorEntries.length ? '<tbody class="quadrante-person-group"><tr><td colspan="4">Nenhum cursista alocado.</td></tr></tbody>' : '')}</table></article>`;
  }).join('');
  const reportHeader = `<table class="quadrante-column-head">${quadranteColgroup}<thead><tr><th>Nome</th><th>Endereço</th><th>ANIV</th><th>Contato</th></tr></thead></table>`;
  const quadranteActions = [
    canAccess('quadrante.editar') && canModifyRetreat(retreat) ? '<button class="secondary-button" id="order-quadrante" type="button">Ordenar quadrante</button>' : '',
    canAccess('quadrante.imprimir') ? '<div class="quadrante-print-actions"><button class="primary-button" id="print-quadrante" type="button">Imprimir relatório completo</button><button class="primary-button" id="print-secret-friend" type="button">Imprimir relatório para amigo secreto</button></div>' : '',
  ].join('');
  const quadrantePrintDocument = (content) => `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quadrante - ${escapeHtml(retreat.nome)}</title>
  <style>
    @page { size:A4 portrait; margin:9mm 10mm; }
    * { box-sizing:border-box; }
    html,body { margin:0; padding:0; background:#fff; color:#1f2c3f; }
    body { font-family:"Times New Roman",Times,serif; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    h1 { margin:0 0 4mm; font-size:16pt; line-height:1.15; }
    .quadrante-report { width:100%; margin:0; padding:0; border:0; background:#fff; box-shadow:none; overflow:visible; }
    .quadrante-report table { width:100%; margin:0; border-collapse:collapse; table-layout:fixed; font-size:9pt; line-height:1.2; break-inside:auto; page-break-inside:auto; }
    .quadrante-report th,.quadrante-report td { height:auto; padding:.6mm 1mm; border:0; text-align:left; vertical-align:top; white-space:normal; overflow-wrap:anywhere; word-break:normal; }
    .quadrante-report th { padding-top:0; padding-bottom:.8mm; border-bottom:.25mm solid #aeb7ae; color:#4f5b52; font-size:7.5pt; text-transform:uppercase; letter-spacing:.03em; }
    .quadrante-column-head { margin-bottom:1.5mm !important; }
    .quadrante-name-col { width:29%; }
    .quadrante-address-col { width:45%; }
    .quadrante-birthday-col { width:9%; }
    .quadrante-contact-col { width:17%; }
    .quadrante-sector,.quadrante-communities article { margin:0 0 1.2mm; padding:.6mm 0 0; border:0; break-inside:auto; page-break-inside:auto; }
    .quadrante-sector h3,.quadrante-communities h3 { width:100%; margin:0 0 .6mm; padding:0 0 .35mm; border-bottom:.25mm solid #7f927f; color:#285130; font-size:12pt; line-height:1.15; break-after:avoid; page-break-after:avoid; }
    .quadrante-sector>table,.quadrante-communities article>table { break-before:avoid; page-break-before:avoid; }
    .quadrante-person-group,.quadrante-person-group tr { break-inside:avoid; page-break-inside:avoid; }
    .quadrante-report .community-tio td,.quadrante-report .community-monitor td,.quadrante-report .sector-coordinator td { font-weight:700; }
    .quadrante-report .shared-couple-address { vertical-align:middle; }
    .quadrante-communities { margin:0; padding:0; border:0; }
    .empty-state { margin:1mm 0; }
  </style>
</head>
<body><h1>Quadrante - ${escapeHtml(retreat.nome)}</h1>${content}</body>
</html>`;
  const printQuadrante = () => {
    const report = app.querySelector('#quadrante-report');
    if (!report) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
    printWindow.document.open();
    printWindow.document.write(quadrantePrintDocument(report.outerHTML));
    printWindow.document.close();
    const triggerPrint = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.addEventListener('load', () => setTimeout(triggerPrint, 120), { once: true });
  };
  const secretFriendPrintDocument = () => {
    const rows = secretFriendRows.map(({ person, sector }) => `<tr><td>${escapeHtml(person.nome || 'Nome não informado')}</td><td>${escapeHtml(sector)}</td></tr>`).join('');
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório para amigo secreto - ${escapeHtml(retreat.nome)}</title>
  <style>
    @page { size:A4 portrait; margin:12mm; }
    * { box-sizing:border-box; }
    html,body { margin:0; padding:0; background:#fff; color:#1f2c3f; }
    body { font-family:"Times New Roman",Times,serif; font-size:20pt; line-height:1.2; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    h1 { margin:0 0 7mm; font-size:20pt; line-height:1.2; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:20pt; line-height:1.2; }
    th,td { padding:2mm 2.5mm; border-bottom:.25mm solid #aeb7ae; text-align:left; vertical-align:top; white-space:normal; overflow-wrap:anywhere; }
    th { color:#285130; }
    th:first-child,td:first-child { width:62%; }
    tr { break-inside:avoid; page-break-inside:avoid; }
  </style>
</head>
<body><h1>Relatório para amigo secreto - ${escapeHtml(retreat.nome)}</h1><table><thead><tr><th>Nome completo</th><th>Setor de trabalho</th></tr></thead><tbody>${rows}</tbody></table></body>
</html>`;
  };
  const printSecretFriendReport = () => {
    if (!secretFriendRows.length) { alert('Não há pessoas da Equipe escondida para imprimir neste retiro.'); return; }
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
    printWindow.document.open();
    printWindow.document.write(secretFriendPrintDocument());
    printWindow.document.close();
    const triggerPrint = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.addEventListener('load', () => setTimeout(triggerPrint, 120), { once: true });
  };
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
  app.querySelector('#print-quadrante')?.addEventListener('click', printQuadrante);
  app.querySelector('#print-secret-friend')?.addEventListener('click', printSecretFriendReport);
}

function choices(name, options, multiple = true) { const visibleOptions = name === 'camiseta' && !options.includes('16') ? options.flatMap((option) => option === 'PP' ? ['16', option] : [option]) : options; return `<div class="inline-choices ${name === 'camiseta' ? 'compact-choices' : ''}">${visibleOptions.map((option) => `<label class="choice"><input type="${multiple ? 'checkbox' : 'radio'}" name="${name}" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join('')}</div>`; }
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
    [enrolments, people] = await Promise.all([dataService.listAdesoes(id), dataService.listPessoas(id)]);
  }
  if (retreat.status === 'preparacao') {
    const message = teamRegistrationClosedMessage(retreat);
    mount.innerHTML = embedded
      ? `<main class="public-shell embedded-registration-shell"><section class="admin-registration-tools student-registration-tools panel"><div class="panel-heading"><div><h2>Cadastro da equipe de trabalho</h2><p>${escapeHtml(message)}</p></div><span class="status ${escapeHtml(retreat.status || '')}">${escapeHtml(statusLabel(retreat.status))}</span></div></section></main>`
      : `<main class="public-shell external-registration-shell"><header class="hero"><div><p class="eyebrow">Equipe de trabalho</p><h1>${escapeHtml(retreat.nome || 'Retiro')}</h1><p class="hero-copy">${escapeHtml(message)}</p></div></header></main>`;
    return;
  }
  const requestedSectorToken = !embedded ? String(sectorToken || '').trim() : '';
  const sectorLink = requestedSectorToken ? (retreat.linksSetores || retreat.setorLinks || []).find((item) => item.cadastroToken === requestedSectorToken || item.token === requestedSectorToken) : null;
  const activeSectorByKey = new Map((retreat.setores || []).map((sector) => [normalizeText(sector), sector]));
  const forcedSector = sectorLink ? activeSectorByKey.get(normalizeText(sectorLink.setor || sectorLink.sector)) : '';
  if (requestedSectorToken && !forcedSector) {
    mount.innerHTML = '<main class="public-shell"><h1>Link de setor indisponível</h1><p>Confira se este setor está ativo no retiro ou solicite um novo link à coordenação.</p></main>';
    return;
  }
  if (requestedSectorToken && sectorRegistrationClosed(retreat, forcedSector)) {
    mount.innerHTML = `<main class="public-shell"><h1>Inscrições encerradas</h1><p>Inscrições para o setor ${escapeHtml(forcedSector)} estão encerradas.</p></main>`;
    return;
  }
  const binaryChoices = (name, options) => choices(name, options, false);
  const contributionOptions = ['R$ 60,00 se o voluntário for o único da família', 'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro'];
  const kidsFields = Array.from({ length: 5 }, (_, index) => {
    const kidNumber = index + 1;
    return `<details class="team-kid-panel" data-team-kid-panel="${kidNumber}" ${index === 0 ? 'open' : ''}><summary><strong>Criança ${kidNumber}</strong><span class="team-kid-summary-value">Não preenchida</span></summary><div class="kids-row"><span>${kidNumber}</span><label class="field"><span>Nome</span><input name="kidNome${kidNumber}" placeholder="Nome da criança"></label><label class="field"><span>Data de nascimento</span><input name="kidNascimento${kidNumber}" type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/aaaa"></label><div class="team-kid-care"><div class="team-kid-care-row"><fieldset><legend>Possui algum problema de saúde?</legend>${binaryChoices(`kidProblemaSaude${kidNumber}`, ['Sim', 'Não'])}</fieldset><label class="field"><span>Descreva</span><input name="kidDescricaoSaude${kidNumber}" placeholder="Descreva o problema de saúde"></label></div><div class="team-kid-care-row"><fieldset><legend>Possui alguma intolerância alimentar?</legend>${binaryChoices(`kidIntolerancia${kidNumber}`, ['Sim', 'Não'])}</fieldset><label class="field"><span>Descreva</span><input name="kidDescricaoIntolerancia${kidNumber}" placeholder="Descreva a intolerância alimentar"></label></div></div></div></details>`;
  }).join('');
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
    ? `<label class="field cpf-field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field name-field"><span>Nome completo <b>*</b></span><input name="nome" autocomplete="off" required></label><label class="field full badge-name-field"><span>Nome para crach&aacute;</span><input name="badgeName" autocomplete="off"></label><label class="field birthdate-field"><span>Data de nascimento <b>*</b></span><input name="nascimento" inputmode="numeric" placeholder="dd/mm/aaaa" required></label><label class="field phone-field"><span>Telefone <b>*</b></span><input name="telefone" required></label>`
    : `<label class="field cpf-field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field birthdate-field"><span>Data de nascimento <b>*</b></span><input name="nascimento" inputmode="numeric" placeholder="dd/mm/aaaa" required></label><label class="field name-field"><span>Nome completo <b>*</b></span><input name="nome" autocomplete="off" required></label><label class="field phone-field"><span>Telefone <b>*</b></span><input name="telefone" required></label>`;
  const spouseFields = embedded
    ? `<label class="field spouse-cpf-field"><span>CPF <b>*</b></span><input name="spouseCpf"></label><label class="field spouse-name-field"><span>Nome completo <b>*</b></span><input name="spouseNome" autocomplete="off"></label><label class="field full spouse-badge-name-field"><span>Nome para crach&aacute;</span><input name="spouseBadgeName" autocomplete="off"></label><label class="field spouse-birthdate-field"><span>Data de nascimento <b>*</b></span><input name="spouseNascimento" inputmode="numeric" placeholder="dd/mm/aaaa"></label><label class="field spouse-phone-field"><span>Telefone <b>*</b></span><input name="spouseTelefone"></label>`
    : `<label class="field spouse-cpf-field"><span>CPF <b>*</b></span><input name="spouseCpf"></label><label class="field spouse-birthdate-field"><span>Data de nascimento <b>*</b></span><input name="spouseNascimento" inputmode="numeric" placeholder="dd/mm/aaaa"></label><label class="field spouse-name-field"><span>Nome completo <b>*</b></span><input name="spouseNome" autocomplete="off"></label><label class="field spouse-phone-field"><span>Telefone <b>*</b></span><input name="spouseTelefone"></label>`;
  const sectorAreasForRegistration = forcedSector ? [sectorArea(forcedSector)] : ['escondida', 'sala'];
  const publicSectors = sectorAreasForRegistration.map((area) => `<section class="public-sector-area"><h4>${area === 'escondida' ? 'Equipe escondida' : 'Equipe Sala'}</h4><div class="choice-grid sectors">${sortSectors(sectorsForRegistration.filter((sector) => sectorArea(sector) === area)).map((sector) => `<label class="choice"><input type="radio" name="setores" value="${escapeHtml(sector)}"><span>${escapeHtml(sector)}</span></label>`).join('') || '<p class="hint">Nenhum setor configurado nesta área.</p>'}</div></section>`).join('');
  const sectorCoordinatorOption = embedded ? '<label class="choice sector-coordinator-option"><input type="checkbox" name="coordenacaoSetor" value="sim"><span>Coordenação do setor</span></label>' : '';
  const sectorRegistrationSection = forcedSector
    ? `<input type="hidden" name="setores" value="${escapeHtml(forcedSector)}">`
    : `<section class="form-section"><div class="section-heading"><span>05</span><div><h2>Setor de trabalho <b>*</b></h2></div></div><div class="choice-block">${publicSectors}${sectorCoordinatorOption}</div></section>`;
  const kidsAgeLimitHint = Number(retreat.idadeMaximaEspacoKids) > 0 ? ` Idade máxima: ${Number(retreat.idadeMaximaEspacoKids)} ano(s).` : '';
  const kidsAgeLimitMessage = 'A idade da criança supera a idade máxima para ocupar o espaço kids neste retiro. Por gentileza consulte a coordenação';
  const internalKidsAgeLimitMessage = 'Idade superior á definida para esse retiro';
  const canUseInternalKidAgeLimitException = embedded && canAccess('pessoas.editar') && canModifyRetreat(retreat);
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
  const volunteerTermRequired = !embedded;
  const adminSearchPanel = embedded ? `<section class="admin-registration-tools student-registration-tools panel"><div class="panel-heading"><div><h2>Cadastro da equipe de trabalho</h2><p>Busque por nome, CPF ou setor para editar ou consultar a ficha do retiro em foco.</p></div><div class="student-registration-actions">${canEditEmbeddedRegistration ? '<button type="button" id="new-registration">Incluir novo</button>' : '<span class="status concluido">Somente consulta</span>'}</div></div><label class="field registration-search-field"><span>Busca</span><input id="registration-search" autocomplete="off" placeholder="Digite nome, CPF ou setor"></label><div id="registration-search-results" class="registration-search-results" hidden></div></section>` : '';
  mount.innerHTML = `<main class="${publicShellClass}"><header class="hero"><div><p class="eyebrow">Equipe de trabalho</p><h1>${escapeHtml(retreat.nome)}</h1><p class="hero-copy">Preencha seus dados para organizarmos sua participação com carinho e antecedência.</p></div></header>${adminSearchPanel}<form id="public-form" novalidate autocomplete="${embedded ? 'on' : 'off'}">${stateDatalist()}
    <section class="form-section form-type-section common-section"><fieldset class="choice-block form-type-choice full"><legend>Esta ficha é: <b>*</b></legend>${binaryChoices('tipoFicha', ['Individual', 'Casal'])}</fieldset></section>
    <section class="form-section"><div class="section-heading student-personal-heading"><span>01</span><div><h2>Seus Dados</h2></div>${embedded ? '<div class="student-heading-actions registration-heading-actions" hidden><button type="button" id="edit-selected-registration">Editar</button><button type="button" id="delete-selected-registration">Excluir participação no retiro</button></div>' : ''}</div><div class="fields two-columns">${personalFields}<fieldset class="choice-block full"><legend>Gênero <b>*</b></legend>${binaryChoices('genero', ['Masculino', 'Feminino'])}</fieldset></div></section>
    <section class="form-section"><div class="section-heading"><span>02</span><div><h2>Quais retiros fez como CURSISTA na Família EPC?</h2></div></div><div class="choice-block"><h3>Retiro(s) que fez <b>*</b></h3>${choices('retiros', ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'])}</div><div class="choice-block day-confirmation-block"><h3>Dias confirmados para trabalhar <b>*</b></h3>${dayConfirmations('dias', serviceDays)}</div></section>
    <section class="form-section couple-only" hidden><div class="section-heading"><span>03</span><div><h2>Segundo cônjuge</h2><p>Dados específicos da segunda pessoa do casal.</p></div></div><div class="fields two-columns">${spouseFields}<fieldset class="choice-block full"><legend>Gênero <b>*</b></legend>${binaryChoices('spouseGenero', ['Masculino', 'Feminino'])}</fieldset></div><div class="choice-block"><h3>Retiro(s) que fez <b>*</b></h3>${choices('spouseRetiros', ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'])}</div><div class="choice-block day-confirmation-block"><h3>Dias confirmados para trabalhar <b>*</b></h3>${dayConfirmations('spouseDias', serviceDays)}</div></section>
    <section class="form-section common-section"><div class="section-heading"><span>04</span><div><h2>Endereço</h2></div></div><div class="fields address-fields"><label class="field cep-field"><span>CEP <b>*</b></span><input name="cep" inputmode="numeric" placeholder="00000-000" required></label><label class="field street-field"><span>Rua / Avenida <b>*</b></span><input name="endereco" required></label><label class="field number-field"><span>Número <b>*</b></span><input name="numero" required></label><label class="field bairro-field"><span>Bairro <b>*</b></span><input name="bairro" required></label><label class="field city-field"><span>Cidade <b>*</b></span><input name="cidade" required></label><label class="field state-field"><span>Estado <b>*</b></span><input name="estado" maxlength="2" required></label></div></section>
    ${sectorRegistrationSection}
    <section class="form-section compact-section"><div class="section-heading"><span>06</span><div><h2>Itens e contribuição</h2><p>Escolhas necessárias para sua inscrição.</p></div></div><div class="fields choice-cards"><div class="choice-block quadrante-print-option"><h3>Quer quadrante impresso? <b>*</b></h3>${binaryChoices('quadrante', ['Sim', 'Não'])}<p class="hint">O quadrante (relação de todas a pessoas que serviram no retiro com os seus contatos) é disponibilizado em PDF após o retiro, mas se você quiser levar impresso no dia do retiro, selecione Sim.</p></div><div class="field choice-block contribution-field"><span data-contribution-label>Valor da inscrição</span><h3>Quer a foto oficial do retiro? <b>*</b></h3>${binaryChoices('foto', ['Sim', 'Não'])}<p class="hint">Valor da foto: ${currency(retreat.valorFoto ?? 10)}.</p><input name="contribuicao" value="${currency(retreat.valorInscricaoVoluntario)}" readonly><p class="hint payment-instructions"><strong><u>Fazer pix CNPJ 52.109.946/0001-94</u></strong> e encaminhar o comprovante no privado para o coordenador do setor que você vai servir.</p></div></div></section>
    <section class="form-section"><div class="section-heading"><span>07</span><div><h2>Espaço Kids <b>*</b></h2><p>Informe suas crianças ou marque que não necessita deste espaço.</p></div></div><div class="choice-block"><div class="kids-heading"><h3>Espaço Kids</h3><label><input type="checkbox" name="kidsNotNeeded"> Não necessito do Espaço Kids</label></div><p class="hint kids-hint">Informe o nome de suas crianças que utilizarão o Espaço Kids ou marque que não necessita. Deixe em branco as linhas não utilizadas.${kidsAgeLimitHint}</p><div class="kids-list">${kidsFields}</div></div></section>
    <section class="form-section"><div class="section-heading"><span>08</span><div><h2>Termo de adesão de voluntariado${volunteerTermRequired ? ' <b>*</b>' : ''}</h2><p>${volunteerTermRequired ? 'Leia e aceite o termo para concluir sua inscrição.' : 'No cadastro interno, a leitura e o aceite são opcionais.'}</p></div></div><div class="volunteer-term-topic"><div><h3>Termo de adesão de voluntariado</h3></div><button type="button" id="read-volunteer-term">Ler termo</button></div></section>
    <p id="form-message" class="form-message"></p><div class="form-actions"><p><b>*</b> Campos obrigatórios</p><button type="submit">${includeSubmitText} <span>→</span></button></div></form></main>`;
  mount.querySelector('.hero h1').textContent = publicHeading;
  mount.querySelector('.hero-copy').textContent = publicLead;
  if (!embedded) document.title = publicHeading;
  const form = mount.querySelector('#public-form');
  if (!embedded) {
    form.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((control) => {
      control.setAttribute('autocomplete', 'new-password');
      control.setAttribute('autocapitalize', 'off');
      control.setAttribute('spellcheck', 'false');
      control.setAttribute('aria-autocomplete', 'none');
      control.setAttribute('data-lpignore', 'true');
      control.setAttribute('data-1p-ignore', 'true');
    });
  }
  syncChoiceStates(form);
  wireStateFields(form);
  wireCepLookup(form);
  wireCpfFields(form);
  wireTypedBirthDates(form);
  let internalKidAgeLimitExceptionAllowed = false;
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
  const showInternalKidAgeLimitDialog = () => new Promise((resolve) => {
    mount.querySelector('.hidden-team-alert-overlay')?.remove();
    const overlay = document.createElement('section');
    overlay.className = 'hidden-team-alert-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'kids-age-limit-title');
    overlay.innerHTML = `<div class="hidden-team-alert-dialog kids-age-limit-dialog"><p class="eyebrow">Espaço Kids</p><h2 id="kids-age-limit-title">${internalKidsAgeLimitMessage}</h2><label class="kids-age-limit-option"><input type="checkbox" data-allow-kids-age-limit><span>Permitir incluir crianças com idade acima da definida para esse retiro</span></label><div class="spouse-registered-actions"><button type="button" data-kids-age-limit-cancel>Cancelar</button><button type="button" data-kids-age-limit-confirm disabled>Continuar</button></div></div>`;
    const checkbox = overlay.querySelector('[data-allow-kids-age-limit]');
    const confirmButton = overlay.querySelector('[data-kids-age-limit-confirm]');
    const close = (allowed) => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(allowed);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') close(false);
    };
    checkbox.addEventListener('change', () => {
      confirmButton.disabled = !checkbox.checked;
    });
    overlay.querySelector('[data-kids-age-limit-cancel]').addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(Boolean(checkbox.checked)));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKeydown);
    mount.append(overlay);
    checkbox.focus();
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
  form.addEventListener('click', (event) => {
    const choice = event.target.closest?.('label.choice');
    if (!choice || !form.contains(choice)) return;
    const input = choice.querySelector('input');
    if (!input || input.disabled || input.readOnly) return;
    if (event.target !== input) {
      event.preventDefault();
      if (input.type === 'radio') {
        form.querySelectorAll(`input[type="radio"][name="${input.name}"]`).forEach((item) => { item.checked = false; });
        input.checked = true;
      } else if (input.type === 'checkbox') {
        input.checked = !input.checked;
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    queueMicrotask(() => syncChoiceStates(form));
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
  const checkedValues = (source, name) => [...source.querySelectorAll(`[name="${name}"]:checked`)]
    .filter((input) => !input.disabled)
    .map((input) => input.value);
  const checkedValue = (source, name) => checkedValues(source, name)[0] || new FormData(source).get(name) || '';
  const dayConfirmationInputs = (name, source = form) => {
    const data = new FormData(source);
    return serviceDays.map((day, index) => {
      const fieldName = dayConfirmationName(name, index);
      const value = data.get(fieldName);
      return { day, value, input: source.querySelector(`[name="${fieldName}"]:checked`) };
    });
  };
  const selectedConfirmedDays = (name, source = form) => dayConfirmationInputs(name, source).filter((item) => item.value === 'Sim' || item.input?.value === 'Sim').map((item) => item.day);
  const allDaysAnswered = (name, source = form) => dayConfirmationInputs(name, source).every((item) => Boolean(item.value || item.input));
  const selectedRegistrationSectors = (source = form) => forcedSector ? [forcedSector] : sortSectors(checkedValues(source, 'setores'));
  const isSpiritualDirectionRegistration = (source = form) => selectedRegistrationSectors(source).some((sector) => normalizeText(sector) === normalizeText('Direção Espiritual'));
  const firstUnansweredDay = (name, source = form) => {
    const index = dayConfirmationInputs(name, source).findIndex((item) => !item.value && !item.input);
    return index >= 0 ? source.querySelector(`[name="${dayConfirmationName(name, index)}"]`) : null;
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
  const isCouple = () => checkedValue(form, 'tipoFicha') === 'Casal';
  const syncContributionAmount = () => {
    const amount = volunteerContributionAmount(retreat, { casalId: isCouple() ? 'casal' : '', foto: checkedValue(form, 'foto') });
    form.elements.contribuicao.value = currency(amount);
    form.querySelector('[data-contribution-label]').textContent = isCouple() ? 'Valor da inscrição do casal' : 'Valor da inscrição';
  };
  const updateSubmitButton = () => {
    const label = editingEntry ? editSubmitText : includeSubmitText;
    form.querySelector('button[type="submit"]').innerHTML = `${isCouple() && embedded ? `${label} do casal` : label} <span>→</span>`;
  };
  const syncSpouseGender = () => {
    const selected = checkedValue(form, 'genero');
    const opposite = selected === 'Masculino' ? 'Feminino' : selected === 'Feminino' ? 'Masculino' : '';
    form.querySelectorAll('[name="spouseGenero"]').forEach((input) => {
      input.checked = Boolean(opposite) && input.value === opposite;
      input.disabled = !isCouple() || Boolean(opposite);
    });
  };
  const spouseGenderValue = () => {
    const selected = checkedValue(form, 'genero');
    return selected === 'Masculino' ? 'Feminino' : selected === 'Feminino' ? 'Masculino' : checkedValue(form, 'spouseGenero');
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
  const teamKidPanels = [...form.querySelectorAll('[data-team-kid-panel]')];
  const syncTeamKidPanels = ({ resetOpen = false } = {}) => {
    let firstPanelWithData = -1;
    teamKidPanels.forEach((panel, index) => {
      const kidNumber = panel.dataset.teamKidPanel;
      const name = String(form.elements[`kidNome${kidNumber}`]?.value || '').trim();
      const hasData = [...panel.querySelectorAll('input')].some((control) => control.type === 'radio' ? control.checked : Boolean(String(control.value || '').trim()));
      if (hasData && firstPanelWithData < 0) firstPanelWithData = index;
      const summary = panel.querySelector('.team-kid-summary-value');
      if (summary) summary.textContent = name || (hasData ? 'Dados preenchidos' : 'Não preenchida');
    });
    if (!resetOpen || !teamKidPanels.length) return;
    const openIndex = firstPanelWithData >= 0 ? firstPanelWithData : 0;
    teamKidPanels.forEach((panel, index) => { panel.open = index === openIndex; });
  };
  const markExistingTeamKids = (kids = []) => {
    teamKidPanels.forEach((panel, index) => {
      const kid = kids[index];
      const hasCareProperties = kid && ['problemaSaude', 'descricaoSaude', 'intoleranciaAlimentar', 'descricaoIntolerancia'].some((field) => Object.hasOwn(kid, field));
      panel.dataset.legacyKidCare = kid && (kid.cuidadosLegados === true || !hasCareProperties) ? 'true' : 'false';
    });
  };
  const clearExistingTeamKids = () => markExistingTeamKids([]);
  const syncTeamKidCareRequirements = () => {
    for (let kidNumber = 1; kidNumber <= 5; kidNumber += 1) {
      [
        { answer: `kidProblemaSaude${kidNumber}`, description: `kidDescricaoSaude${kidNumber}` },
        { answer: `kidIntolerancia${kidNumber}`, description: `kidDescricaoIntolerancia${kidNumber}` },
      ].forEach(({ answer, description }) => {
        const input = form.elements[description];
        if (!input) return;
        const required = checkedValue(form, answer) === 'Sim';
        input.required = required;
        const label = input.closest('.field')?.querySelector('span');
        if (label) label.innerHTML = `Descreva${required ? ' <b>*</b>' : ''}`;
      });
    }
  };
  const syncKidsNeed = () => {
    const notNeeded = form.elements.kidsNotNeeded?.checked;
    form.querySelectorAll('.kids-list input').forEach((field) => {
      if (notNeeded) {
        if (field.type === 'radio') field.checked = false;
        else field.value = '';
      }
      field.disabled = Boolean(notNeeded);
    });
    form.querySelector('.kids-list')?.classList.toggle('is-disabled', Boolean(notNeeded));
    form.querySelector('.kids-list')?.toggleAttribute('hidden', Boolean(notNeeded));
    form.querySelector('.kids-hint')?.toggleAttribute('hidden', Boolean(notNeeded));
    if (notNeeded) teamKidPanels.forEach((panel) => { panel.open = false; });
    else syncTeamKidPanels({ resetOpen: true });
    syncChoiceStates(form);
    syncTeamKidCareRequirements();
  };
  form.elements.kidsNotNeeded?.addEventListener('change', syncKidsNeed);
  form.addEventListener('input', (event) => { if (event.target.closest('[data-team-kid-panel]')) syncTeamKidPanels(); });
  form.addEventListener('change', (event) => {
    if (!event.target.closest('[data-team-kid-panel]')) return;
    syncTeamKidPanels();
    syncTeamKidCareRequirements();
  });
  clearExistingTeamKids();
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
    const selectedType = checkedValue(form, 'tipoFicha');
    form.querySelector('.inline-partner-registration')?.remove();
    form.reset();
    volunteerTermAccepted = false;
    syncVolunteerTermState();
    form.elements.nome.value = nome;
    form.elements.cpf.value = cpf;
    if (selectedType) setChoices('tipoFicha', selectedType);
    editingEntry = null;
    editingSpouseEntry = null;
    clearExistingTeamKids();
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
    clearExistingTeamKids();
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
  const askMostRecentEpcSmp = (participantName = '', currentValue = '') => new Promise((resolve) => {
    mount.querySelector('.recent-retreat-overlay')?.remove();
    const overlay = document.createElement('section');
    overlay.className = 'hidden-team-alert-overlay recent-retreat-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'recent-retreat-title');
    overlay.innerHTML = `<div class="hidden-team-alert-dialog spouse-registered-dialog"><p class="eyebrow">Retiro mais recente</p><h2 id="recent-retreat-title">Qual retiro você fez mais recente?</h2>${participantName ? `<p>${escapeHtml(participantName)}</p>` : ''}<div class="spouse-registered-actions"><button type="button" data-recent-retreat="SMP" class="${normalizeText(currentValue) === 'smp' ? 'is-selected' : ''}">SMP</button><button type="button" data-recent-retreat="EPC" class="${normalizeText(currentValue) === 'epc' ? 'is-selected' : ''}">EPC</button></div><button type="button" class="hidden-team-alert-close">Cancelar</button></div>`;
    const finish = (value) => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') finish('');
    };
    overlay.querySelectorAll('[data-recent-retreat]').forEach((button) => button.addEventListener('click', () => finish(button.dataset.recentRetreat)));
    overlay.querySelector('.hidden-team-alert-close').addEventListener('click', () => finish(''));
    document.addEventListener('keydown', onKeydown);
    mount.append(overlay);
    overlay.querySelector(`[data-recent-retreat="${normalizeText(currentValue) === 'epc' ? 'EPC' : 'SMP'}"]`)?.focus();
  });
  const selectedMostRecentEpcSmp = async (fieldName, participantName, currentValue = '') => {
    if (isSpiritualDirectionRegistration(form)) return '';
    const previousRetreats = checkedValues(form, fieldName);
    const normalized = new Set(previousRetreats.map(normalizeText));
    if (!normalized.has(normalizeText('EPC')) || !normalized.has(normalizeText('SMP'))) return '';
    return askMostRecentEpcSmp(participantName, currentValue);
  };
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
    form.elements.badgeName.value = entry.badgeName || '';
    form.elements.cep.value = person.cep || '';
    setChoices('retiros', entry.retirosAnteriores || []); setDayConfirmations('dias', entry.dias || []); setChoices('setores', entry.setores || []); setChoices('quadrante', entry.quadrante); setChoices('foto', entry.foto); setChoices('tipoFicha', entry.casalId ? 'Casal' : 'Individual'); setChoices('genero', person.genero); setChoices('coordenacaoSetor', entry.coordenacaoSetor || editingSpouseEntry?.coordenacaoSetor ? 'sim' : '');
    if (form.elements.coordenacao) form.elements.coordenacao.value = entry.coordenacao || '';
    form.elements.kidsNotNeeded.checked = Boolean(entry.espacoKidsNaoNecessito);
    markExistingTeamKids(entry.espacoKids || []);
    (entry.espacoKids || []).forEach((kid, index) => {
      if (index >= 5) return;
      const kidNumber = index + 1;
      form.elements[`kidNome${kidNumber}`].value = kid.nome || '';
      form.elements[`kidNascimento${kidNumber}`].value = formatDateInput(kid.nascimento) || kid.nascimento || '';
      setChoices(`kidProblemaSaude${kidNumber}`, kid.problemaSaude || '');
      form.elements[`kidDescricaoSaude${kidNumber}`].value = kid.descricaoSaude || '';
      setChoices(`kidIntolerancia${kidNumber}`, kid.intoleranciaAlimentar || '');
      form.elements[`kidDescricaoIntolerancia${kidNumber}`].value = kid.descricaoIntolerancia || '';
    });
    syncKidsNeed();
    if (editingSpouseEntry) {
      const spouse = people.find((item) => item.id === editingSpouseEntry.pessoaId);
      form.elements.spouseBadgeName.value = editingSpouseEntry.badgeName || '';
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
  if (embedded) {
    const searchInput = mount.querySelector('#registration-search');
    const searchResults = mount.querySelector('#registration-search-results');
    let registrationSearchRequest = 0;
    const renderRegistrationSearch = async () => {
      const currentRequest = ++registrationSearchRequest;
      searchResults.hidden = false;
      searchResults.innerHTML = '<p>Carregando cadastros...</p>';
      try {
        [enrolments, people] = await Promise.all([dataService.listAdesoes(id), dataService.listPessoas(id)]);
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
            form.elements.nome.focus({ preventScroll: true });
          }
        }));
      };
      renderRows();
      try {
        const [latestEnrolments, latestPeople] = await Promise.all([dataService.listAdesoes(id), dataService.listPessoas(id)]);
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
      return await dataService.listCursistas(id);
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
    const hasConflict = students.some((student) => student.retiroId === id && normalizeCpf(student.cpf) === cpf);
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
    const latestEnrolments = await dataService.listAdesoes(id).catch(() => enrolments);
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
    const studentConflict = students.some((student) => student.retiroId === id && normalizeCpf(student.cpf) === cpf);
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
  const normalizeAutofilledDate = (control) => {
    if (!control?.value) return;
    const normalized = normalizeDateInput(control.value);
    if (normalized) {
      control.value = formatDateInput(normalized);
      control.setCustomValidity('');
      return;
    }
    const digits = String(control.value || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length === 8) {
      control.value = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
      control.setCustomValidity(normalizeDateInput(control.value) ? '' : 'Digite a data no formato dd/mm/aaaa.');
    }
  };
  const syncAutofilledPublicForm = async ({ loadExistingPerson = false } = {}) => {
    [form.elements.cpf, form.elements.spouseCpf].filter(Boolean).forEach((control) => {
      if (control.value) control.value = formatCpf(control.value);
    });
    [form.elements.nascimento, form.elements.spouseNascimento].filter(Boolean).forEach(normalizeAutofilledDate);
    if (form.elements.estado?.value) form.elements.estado.value = String(form.elements.estado.value).trim().toUpperCase();
    if (form.elements.spouseTelefone?.value && isCouple()) form.elements.spouseTelefone.value = String(form.elements.spouseTelefone.value).trim();
    ['nome', 'telefone', 'endereco', 'numero', 'bairro', 'cep', 'cidade', 'spouseNome'].forEach((name) => {
      if (form.elements[name]?.value) form.elements[name].value = String(form.elements[name].value).trim();
    });
    setCoupleMode(isCouple());
    syncKidsNeed();
    syncTypeSelectionLock();
    syncChoiceStates(form);
    syncContributionAmount();
    if (loadExistingPerson && !embedded && isValidCpf(form.elements.cpf?.value)) await loadPersonByCpf();
  };
  form.cpf.addEventListener('change', () => loadPersonByCpf());
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
      if (canUseInternalKidAgeLimitException) {
        internalKidAgeLimitExceptionAllowed = await showInternalKidAgeLimitDialog();
        if (internalKidAgeLimitExceptionAllowed) form.querySelector('#form-message')?.replaceChildren('');
        return;
      }
      if (embedded) {
        form.querySelector('#form-message')?.replaceChildren(internalKidsAgeLimitMessage);
        return;
      }
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
    source.querySelectorAll(namedFieldSelector(['nascimento', 'spouseNascimento', ...teamKidDateFieldNames])).forEach((input) => {
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
        const careValues = [checkedValue(source, `kidProblemaSaude${index}`), source.elements[`kidDescricaoSaude${index}`]?.value.trim(), checkedValue(source, `kidIntolerancia${index}`), source.elements[`kidDescricaoIntolerancia${index}`]?.value.trim()];
        const hasAnyData = nome?.value.trim() || nascimento?.value.trim() || careValues.some(Boolean);
        if (hasAnyData && !nome.value.trim()) return nome;
        if (hasAnyData && !nascimento.value.trim()) return nascimento;
      }
      return null;
    };
    const teamKidCareIssue = (kid, index) => {
      const panel = source.querySelector(`[data-team-kid-panel="${index}"]`);
      const historicalWithoutCare = panel?.dataset.legacyKidCare === 'true' && !kid.problemaSaude && !kid.descricaoSaude && !kid.intoleranciaAlimentar && !kid.descricaoIntolerancia;
      if (historicalWithoutCare) return null;
      if (!kid.problemaSaude) return { control: firstByName(`kidProblemaSaude${index}`), message: `Informe se a criança ${index} possui algum problema de saúde.` };
      if (kid.problemaSaude === 'Sim' && !kid.descricaoSaude) return { control: source.elements[`kidDescricaoSaude${index}`], message: `Descreva o problema de saúde da criança ${index}.` };
      if (!kid.intoleranciaAlimentar) return { control: firstByName(`kidIntolerancia${index}`), message: `Informe se a criança ${index} possui alguma intolerância alimentar.` };
      if (kid.intoleranciaAlimentar === 'Sim' && !kid.descricaoIntolerancia) return { control: source.elements[`kidDescricaoIntolerancia${index}`], message: `Descreva a intolerância alimentar da criança ${index}.` };
      return null;
    };
    const spiritualDirectionRegistration = isSpiritualDirectionRegistration(source);
    const firstSpouseMissing = () => {
      const missingField = [
        ['spouseNome', () => !String(data.get('spouseNome') || '').trim()],
        ['spouseCpf', () => !isValidCpf(data.get('spouseCpf'))],
        ['spouseNascimento', () => !normalizeDateInput(data.get('spouseNascimento'))],
        ['spouseTelefone', () => !String(data.get('spouseTelefone') || '').trim()],
        ['genero', () => !spouseGenderValue()],
        ['spouseRetiros', () => !spiritualDirectionRegistration && !checkedValues(source, 'spouseRetiros').length],
      ].find(([, missing]) => missing())?.[0];
      if (missingField) return missingField;
      if (!allDaysAnswered('spouseDias', source)) return firstUnansweredDay('spouseDias', source)?.name;
      if (!selectedConfirmedDays('spouseDias', source).length) return dayConfirmationName('spouseDias', 0);
      return null;
    };
    if (embedded && !editingEntry && requireType && !checkedValue(source, 'tipoFicha')) {
      source.querySelector('#form-message')?.replaceChildren('Escolha se esta ficha é Individual ou Casal antes de salvar.');
      focusControl(firstByName('tipoFicha'));
      return false;
    }
    const sectors = selectedRegistrationSectors(source);
    const days = selectedConfirmedDays('dias', source);
    const daysComplete = allDaysAnswered('dias', source);
    const spouseDays = selectedConfirmedDays('spouseDias', source);
    const spouseDaysComplete = !isCouple() || allDaysAnswered('spouseDias', source);
    const required = ['cpf', 'genero', ...(spiritualDirectionRegistration ? [] : ['retiros']), 'quadrante', 'foto', 'contribuicao', ...(requireType ? ['tipoFicha'] : [])].filter((name) => source.elements[name]);
    const kidsNotNeeded = data.get('kidsNotNeeded') === 'on';
    const kids = kidsNotNeeded ? [] : Array.from({ length: 5 }, (_, index) => ({ index: index + 1, nome: String(data.get(`kidNome${index + 1}`) || '').trim(), nascimento: String(data.get(`kidNascimento${index + 1}`) || '').trim(), problemaSaude: String(data.get(`kidProblemaSaude${index + 1}`) || ''), descricaoSaude: String(data.get(`kidDescricaoSaude${index + 1}`) || '').trim(), intoleranciaAlimentar: String(data.get(`kidIntolerancia${index + 1}`) || ''), descricaoIntolerancia: String(data.get(`kidDescricaoIntolerancia${index + 1}`) || '').trim() })).filter((kid) => kid.nome || kid.nascimento || kid.problemaSaude || kid.descricaoSaude || kid.intoleranciaAlimentar || kid.descricaoIntolerancia);
    const hasKidsChoice = kidsNotNeeded || kids.length > 0;
    const hasIncompleteKid = !kidsNotNeeded && kids.some((kid) => !kid.nome || !kid.nascimento);
    const kidCareIssue = !kidsNotNeeded && !hasIncompleteKid ? kids.map((kid) => teamKidCareIssue(kid, kid.index)).find(Boolean) : null;
    const ageLimitViolation = !kidsNotNeeded ? kidAgeLimitViolation(source) : null;
    const blocksKidAgeLimit = ageLimitViolation && (!canUseInternalKidAgeLimitException || !internalKidAgeLimitExceptionAllowed);
    const spouseValid = !isCouple() || (String(data.get('spouseNome') || '').trim() && isValidCpf(data.get('spouseCpf')) && normalizeDateInput(data.get('spouseNascimento')) && String(data.get('spouseTelefone') || '').trim() && spouseGenderValue() && (spiritualDirectionRegistration || checkedValues(source, 'spouseRetiros').length) && spouseDaysComplete && spouseDays.length);
    const firstInvalid = source.querySelector(':invalid');
    const browserValid = source.checkValidity();
    const missingRequired = required.filter((name) => {
      if (['genero', 'retiros', 'quadrante', 'foto', 'tipoFicha'].includes(name)) return !checkedValues(source, name).length;
      return !data.get(name);
    });
    const valid = browserValid && (!requireSector || sectors.length) && daysComplete && days.length && !missingRequired.length && hasKidsChoice && !hasIncompleteKid && !kidCareIssue && !blocksKidAgeLimit && spouseValid && (!volunteerTermRequired || volunteerTermAccepted);
    if (!valid) {
      const labels = { genero: 'gênero', retiros: 'retiro(s) que fez', quadrante: 'quadrante impresso', foto: 'foto oficial do retiro', contribuicao: 'valor da inscrição', tipoFicha: 'Individual ou Casal' };
      const missing = [
        ...(!browserValid ? ['campos marcados com *'] : []),
        ...(requireSector && !sectors.length ? ['setor de trabalho'] : []),
        ...(!daysComplete ? ['Sim ou Não em todos os dias'] : []),
        ...(daysComplete && !days.length ? ['pelo menos um dia confirmado para trabalhar'] : []),
        ...(volunteerTermRequired && !volunteerTermAccepted ? ['termo de adesão de voluntariado'] : []),
        ...missingRequired.map((name) => labels[name] || name),
      ];
      let message = missing.length ? `Revise: ${[...new Set(missing)].join(', ')}.` : 'Revise os campos obrigatórios.';
      if (!daysComplete) message = 'Em Dias confirmados para trabalhar, responda Sim ou Não para todos os dias.';
      else if (!days.length) message = 'Em Dias confirmados para trabalhar, confirme pelo menos um dia com Sim.';
      else if (!hasKidsChoice) message = 'No Espaço Kids, marque que não necessita ou informe pelo menos uma criança com nome e data de nascimento.';
      else if (hasIncompleteKid) message = 'No Espaço Kids, preencha nome e data de nascimento de cada criança informada.';
      else if (blocksKidAgeLimit) message = embedded ? internalKidsAgeLimitMessage : kidsAgeLimitMessage;
      else if (kidCareIssue) message = kidCareIssue.message;
      else if (isCouple() && !spouseValid) message = 'Em cadastro de casal, preencha também os dados, retiros e dias do segundo cônjuge.';
      else if (volunteerTermRequired && !volunteerTermAccepted) message = 'Leia o Termo de adesão de voluntariado e clique em "Lí e concordo" antes de enviar.';
      source.querySelector('#form-message')?.replaceChildren(message);
      const candidateControls = [
        firstInvalid,
        ...missingRequired.map(firstByName),
        !daysComplete ? firstUnansweredDay('dias', source) : null,
        daysComplete && !days.length ? firstByName(dayConfirmationName('dias', 0)) : null,
        requireSector && !sectors.length ? firstByName('setores') : null,
        !hasKidsChoice ? firstByName('kidsNotNeeded') || firstByName('kidNome1') : null,
        hasIncompleteKid ? firstIncompleteKid() : null,
        kidCareIssue?.control,
        blocksKidAgeLimit ? ageLimitViolation.control : null,
        volunteerTermRequired && !volunteerTermAccepted ? source.querySelector('#read-volunteer-term') : null,
        isCouple() && !spouseValid ? firstByName(firstSpouseMissing()) : null,
      ].filter(Boolean);
      const nextControl = candidateControls.sort((first, second) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1)[0];
      focusControl(nextControl);
      if (blocksKidAgeLimit && !embedded) alert(kidsAgeLimitMessage);
    }
    return valid;
  };
  const buildFormRecords = (source, casalId, papelNoCasal, existingEntry = null, prefix = '', retiroMaisRecenteEpcSmp = '') => {
    const data = new FormData(source);
    const fieldName = (name) => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
    const nome = data.get(fieldName('nome')).trim();
    const cpf = normalizeCpf(data.get(fieldName('cpf')));
    if (!existingEntry) existingEntry = enrolments.find((entry) => entry.retiroId === id && entry.pessoaId === cpf);
    const kidsNotNeeded = data.get('kidsNotNeeded') === 'on';
    const kids = kidsNotNeeded ? [] : Array.from({ length: 5 }, (_, index) => {
      const kidNumber = index + 1;
      const rawNascimento = String(data.get(`kidNascimento${kidNumber}`) || '').trim();
      const normalizedNascimento = normalizeDateInput(rawNascimento);
      if (rawNascimento && !normalizedNascimento) throw new Error(`Revise a data de nascimento da criança ${kidNumber}.`);
      const kid = { nome: String(data.get(`kidNome${kidNumber}`) || '').trim(), nascimento: normalizedNascimento };
      if (!kid.nome && !kid.nascimento) return kid;
      const care = { problemaSaude: String(data.get(`kidProblemaSaude${kidNumber}`) || ''), descricaoSaude: String(data.get(`kidDescricaoSaude${kidNumber}`) || '').trim(), intoleranciaAlimentar: String(data.get(`kidIntolerancia${kidNumber}`) || ''), descricaoIntolerancia: String(data.get(`kidDescricaoIntolerancia${kidNumber}`) || '').trim() };
      const panel = source.querySelector(`[data-team-kid-panel="${kidNumber}"]`);
      const preserveLegacyBlankCare = panel?.dataset.legacyKidCare === 'true' && !Object.values(care).some(Boolean);
      return preserveLegacyBlankCare ? kid : { ...kid, ...care };
    }).filter((kid) => kid.nome || kid.nascimento);
    const allowInternalKidsChange = embedded && canAccess('pessoas.editar') && canModifyRetreat(retreat) && existingEntry && Boolean(existingEntry.espacoKidsNaoNecessito) !== kidsNotNeeded;
    let person = people.find((item) => item.id === cpf || normalizeCpf(item.cpf) === cpf);
    if (!person && existingEntry) person = people.find((item) => item.id === existingEntry.pessoaId);
    person = person ? { ...person } : { createdAt: new Date().toISOString() };
    const previousPersonId = existingEntry?.pessoaId && existingEntry.pessoaId !== cpf ? existingEntry.pessoaId : null;
    Object.assign(person, { id: cpf, cpf, nome, nomeNormalizado: nome.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '), nascimento: normalizeDateInput(data.get(fieldName('nascimento'))), genero: prefix === 'spouse' ? spouseGenderValue() : checkedValue(source, fieldName('genero')), telefone: data.get(fieldName('telefone')), endereco: data.get('endereco'), numero: data.get('numero'), bairro: data.get('bairro'), cep: data.get('cep'), cidade: data.get('cidade'), estado: String(data.get('estado') || '').toUpperCase(), updatedAt: new Date().toISOString() });
    const coordenacaoSetor = embedded ? data.get('coordenacaoSetor') === 'sim' : Boolean(existingEntry?.coordenacaoSetor);
    const quadrante = checkedValue(source, 'quadrante') === 'Sim' ? 'Sim' : 'Não';
    const foto = checkedValue(source, 'foto') === 'Sim' ? 'Sim' : 'Não';
    const contribuicao = currency(volunteerContributionAmount(retreat, { casalId, foto }));
    const dispensaRetirosAnteriores = isSpiritualDirectionRegistration(source);
    const internalBadgeName = embedded ? { badgeName: String(data.get(fieldName('badgeName')) || '').trim() } : {};
    const termAccepted = existingEntry?.termoVoluntariadoAceito === true || volunteerTermAccepted;
    const termAcceptedAt = existingEntry?.termoVoluntariadoAceitoEm || (termAccepted ? new Date().toISOString() : null);
    const enrolment = { ...(existingEntry || {}), id: existingEntry?.id || createId(), retiroId: id, pessoaId: person.id, nome: person.nome, dadosPessoais: personalDataSnapshot(person), dias: selectedConfirmedDays(fieldName('dias'), source), setores: selectedRegistrationSectors(source), retirosAnteriores: dispensaRetirosAnteriores ? [] : checkedValues(source, fieldName('retiros')), dispensaRetirosAnteriores, retiroMaisRecenteEpcSmp: dispensaRetirosAnteriores ? '' : retiroMaisRecenteEpcSmp, quadrante, foto, contribuicao, coordenacao: form.elements.coordenacao ? data.get('coordenacao') : (existingEntry?.coordenacao || ''), coordenacaoSetor, espacoKids: kids, espacoKidsNaoNecessito: kidsNotNeeded, termoVoluntariadoAceito: termAccepted, termoVoluntariadoAceitoEm: termAcceptedAt, tipoFicha: 'Individual', casalId, papelNoCasal, status: existingEntry?.status || 'pendente_validacao', enviadoEm: existingEntry?.enviadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString(), ...internalBadgeName, __userSubmittedRegistration: true, ...(allowInternalKidsChange ? { __allowRegistrationDataLoss: true } : {}) };
    return { person, enrolment, previousPersonId };
  };
  const saveForm = async (...args) => {
    const { person, enrolment, previousPersonId } = buildFormRecords(...args);
    await dataService.savePessoa(person);
    await dataService.saveAdesao(enrolment);
    if (previousPersonId) {
      const entriesToMigrate = (await dataService.listAdesoes(id)).filter((item) => item.pessoaId === previousPersonId);
      await Promise.all(entriesToMigrate.map((entry) => dataService.saveAdesao({ ...entry, pessoaId: person.id, nome: entry.nome || person.nome })));
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
  const blockDuplicateEnrolmentCpfBeforeSave = async () => {
    const data = new FormData(form);
    const checks = [
      { cpf: normalizeCpf(data.get('cpf')), control: form.elements.cpf, excludeEntryId: editingEntry?.id || '' },
      ...(isCouple() ? [{ cpf: normalizeCpf(data.get('spouseCpf')), control: form.elements.spouseCpf, excludeEntryId: editingSpouseEntry?.id || '' }] : []),
    ].filter((item) => isValidCpf(item.cpf));
    if (!checks.length) return false;
    const latestEnrolments = await dataService.listAdesoes(id).catch(() => enrolments);
    if (Array.isArray(latestEnrolments)) enrolments = latestEnrolments;
    for (const item of checks) {
      const duplicateEntry = enrolments.find((entry) => entry.retiroId === id && entry.id !== item.excludeEntryId && entryMatchesCpf(entry, item.cpf));
      if (duplicateEntry) {
        showCpfLockMessage(item.control, 'Este CPF ja possui adesao neste retiro.');
        item.control.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => item.control.focus({ preventScroll: true }), 180);
        return true;
      }
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
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    setPublicSubmitting(true);
    if (retreat.status === 'preparacao' || (!embedded && !isTeamRegistrationOpen(retreat))) {
      form.querySelector('#form-message')?.replaceChildren(teamRegistrationClosedMessage(retreat));
      form.dataset.submitting = 'false';
      setPublicSubmitting(false);
      return;
    }
    if (embedded && !ensureRetreatCanBeChanged(retreat, 'salvar fichas da equipe')) {
      form.dataset.submitting = 'false';
      setPublicSubmitting(false);
      return;
    }
    await syncAutofilledPublicForm();
    if (canUseInternalKidAgeLimitException && kidAgeLimitViolation(form) && !internalKidAgeLimitExceptionAllowed) {
      internalKidAgeLimitExceptionAllowed = await showInternalKidAgeLimitDialog();
      if (!internalKidAgeLimitExceptionAllowed) {
        form.querySelector('#form-message')?.replaceChildren(internalKidsAgeLimitMessage);
        form.dataset.submitting = 'false';
        setPublicSubmitting(false);
        return;
      }
      form.querySelector('#form-message')?.replaceChildren('');
    }
    try {
      syncContributionAmount();
      if (!validateForm(form)) {
        return;
      }
      if (await blockPublicCpfIssues()) {
        return;
      }
      if (await blockDuplicateEnrolmentCpfBeforeSave()) {
        return;
      }
      const firstName = String(new FormData(form).get('nome') || '').trim();
      const firstRecentRetreat = await selectedMostRecentEpcSmp('retiros', firstName, editingEntry?.retiroMaisRecenteEpcSmp || '');
      if (!isSpiritualDirectionRegistration(form) && checkedValues(form, 'retiros').map(normalizeText).includes('epc') && checkedValues(form, 'retiros').map(normalizeText).includes('smp') && !firstRecentRetreat) return;
      const spouseName = String(new FormData(form).get('spouseNome') || '').trim();
      const spouseRecentRetreat = isCouple() ? await selectedMostRecentEpcSmp('spouseRetiros', spouseName, editingSpouseEntry?.retiroMaisRecenteEpcSmp || '') : '';
      if (isCouple() && !isSpiritualDirectionRegistration(form) && checkedValues(form, 'spouseRetiros').map(normalizeText).includes('epc') && checkedValues(form, 'spouseRetiros').map(normalizeText).includes('smp') && !spouseRecentRetreat) return;
      if (isCouple()) {
        const casalId = editingEntry?.casalId || createId();
        const firstPrepared = buildFormRecords(form, casalId, 'Primeira pessoa', editingEntry, '', firstRecentRetreat);
        const secondPrepared = buildFormRecords(form, casalId, 'Segunda pessoa', editingSpouseEntry, 'spouse', spouseRecentRetreat);
        const linkedAt = new Date().toISOString();
        firstPrepared.person = { ...firstPrepared.person, casalId, conjugeId: secondPrepared.person.id, updatedAt: linkedAt };
        secondPrepared.person = { ...secondPrepared.person, casalId, conjugeId: firstPrepared.person.id, updatedAt: linkedAt };
        const savedCouple = await dataService.saveTeamCouple({
          casalId,
          pessoas: [firstPrepared.person, secondPrepared.person],
          adesoes: [firstPrepared.enrolment, secondPrepared.enrolment],
        });
        const [first, second] = savedCouple.pessoas;
        await finishSave([
          { nome: first.nome, dias: selectedConfirmedDays('dias', form) },
          { nome: second.nome, dias: selectedConfirmedDays('spouseDias', form) },
        ]);
        return;
      }
      if (editingEntry?.casalId) {
        const spouseEntry = editingSpouseEntry || enrolments.find((item) => item.casalId === editingEntry.casalId && item.retiroId === editingEntry.retiroId && item.pessoaId !== editingEntry.pessoaId);
        if (spouseEntry) {
          await dataService.deleteAdesao(spouseEntry.id);
        }
      }
      const person = await saveForm(form, null, null, editingEntry, '', firstRecentRetreat);
      await finishSave([{ nome: person.nome, dias: selectedConfirmedDays('dias', form) }]);
      return;
    } catch (error) {
      console.error(error);
      const messageTarget = form.querySelector('#form-message');
      messageTarget?.replaceChildren(`Não foi possível salvar a inscrição. ${error.message || 'Confira os dados e tente novamente.'}`);
    } finally {
      form.dataset.submitting = 'false';
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

async function renderUsuariosSeguranca({ selectedUserId = '', messageText = '' } = {}) {
  if (!ensureViewPermission('usuarios')) return;
  const [accessData, allRetreats] = await Promise.all([dataService.getAccessData(), dataService.listRetiros().catch(() => [])]);
  const { usuarios = [], perfis = [], permissoes = [], perfilPermissoes = [], usuarioPermissoes = [], usuarioRetiros = [] } = accessData;
  const profileById = new Map(perfis.map((profile) => [profile.id, profile]));
  const sortedUsers = [...usuarios].sort((first, second) => String(first.nome || first.login).localeCompare(String(second.nome || second.login), 'pt-BR', { sensitivity: 'base' }));
  const activeCount = usuarios.filter((user) => user.ativo !== false).length;
  const inactiveCount = usuarios.length - activeCount;
  const adminCount = usuarios.filter((user) => profileById.get(user.perfilId)?.codigo === 'admin').length;
  const currentDatabaseUserId = usuarios.some((user) => user.id === currentUser?.id) ? currentUser.id : '';
  const effectivePermissions = (user = {}) => {
    const profile = profileById.get(user.perfilId);
    const allowed = new Set(perfilPermissoes.filter((item) => item.perfilId === user.perfilId && item.permitido !== false).map((item) => item.permissaoId));
    usuarioPermissoes.filter((item) => item.usuarioId === user.id).forEach((item) => {
      if (item.permitido === false) allowed.delete(item.permissaoId); else allowed.add(item.permissaoId);
    });
    if (profile?.codigo === 'admin') permissoes.forEach((permission) => allowed.add(permission.id));
    return allowed;
  };
  const permissionActionLabels = { ver: 'Visualizar', criar: 'Criar', editar: 'Editar', publicar: 'Publicar', encerrar: 'Encerrar', excluir: 'Excluir', validar: 'Validar', imprimir: 'Imprimir' };
  const permissionPresentation = (permission) => {
    const action = permission.id.split('.').pop();
    const moduleName = permission.id === 'retiros.ver' || permission.id.startsWith('links-cadastro.') ? 'Links de cadastro' : (permission.id.startsWith('retiros.') ? 'Configurações' : (permission.modulo || 'Sistema'));
    const description = permission.id === 'retiros.ver' ? 'Ver links de cadastro' : permission.descricao;
    return { ...permission, descricao: description, moduleName, action, actionLabel: permissionActionLabels[action] || description || action };
  };
  const permissionGroups = permissoes.map(permissionPresentation).reduce((groups, permission) => {
    groups[permission.moduleName] = groups[permission.moduleName] || [];
    groups[permission.moduleName].push(permission);
    return groups;
  }, {});
  Object.values(permissionGroups).forEach((items) => items.sort((first, second) => first.id.localeCompare(second.id, 'pt-BR')));
  const initials = (user = {}) => String(user.nome || user.login || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  const profileOptions = perfis.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.nome)}</option>`).join('');
  const retreatChecks = allRetreats.map((retreat) => `<label class="access-v2-check"><input type="checkbox" name="retiroIds" value="${escapeHtml(retreat.id)}"><span><strong>${escapeHtml(retreat.nome)}</strong><small>${dateRange(retreat.dataInicio, retreat.dataTermino)}</small></span></label>`).join('');
  const summaryIcon = (symbol) => `<span class="access-v2-summary-icon" aria-hidden="true">${symbol}</span>`;
  layout(`<section class="page-heading access-v2-heading"><div><p class="eyebrow">Segurança e acessos</p><h1>Usuários e permissões</h1><p>Controle quem acessa o sistema e o que cada pessoa pode fazer.</p></div><div class="detail-actions"><a class="secondary-button" href="#alterar-senha">Alterar minha senha</a>${canAccess('usuarios.criar') ? '<button class="primary-button" type="button" id="new-access-user-v2">+ Novo usuário</button>' : ''}</div></section>
    <section class="access-v2-summary" aria-label="Resumo dos usuários">
      <article>${summaryIcon('A')}<div><span>Usuários ativos</span><strong>${activeCount}</strong></div></article>
      <article>${summaryIcon('I')}<div><span>Inativos</span><strong>${inactiveCount}</strong></div></article>
      <article>${summaryIcon('ADM')}<div><span>Administradores</span><strong>${adminCount}</strong></div></article>
    </section>
    <section class="access-v2-layout">
      <article class="panel access-v2-directory"><div class="panel-heading"><div><h2>Usuários</h2><p><span data-access-visible-count>${usuarios.length}</span> de ${usuarios.length} usuário(s)</p></div></div>
        <label class="access-v2-search"><span class="sr-only">Buscar usuário</span><input type="search" id="access-user-search" placeholder="Buscar por nome ou login" autocomplete="off"></label>
        <div class="access-v2-filters" role="group" aria-label="Filtrar usuários"><button type="button" class="is-active" data-access-filter="all">Todos</button><button type="button" data-access-filter="active">Ativos</button><button type="button" data-access-filter="inactive">Inativos</button></div>
        <div class="access-v2-user-list" id="access-v2-user-list"></div>
        <nav class="access-v2-pagination" aria-label="Paginação dos usuários"></nav>
      </article>
      <form id="access-user-form-v2" class="panel access-v2-editor">
        <input type="hidden" name="id">
        <header class="access-v2-user-heading"><span class="access-v2-avatar" data-access-avatar>?</span><div><h2 id="access-v2-user-title">Novo usuário</h2><p><span data-access-login>Novo acesso</span> <span class="status publicado" data-access-status>Ativo</span></p></div></header>
        <div class="access-v2-tabs" role="tablist" aria-label="Dados do usuário"><button type="button" role="tab" aria-selected="false" data-access-tab="data">Dados do usuário</button><button type="button" role="tab" aria-selected="false" data-access-tab="retreats">Retiros vinculados</button><button type="button" role="tab" aria-selected="true" data-access-tab="permissions">Permissões</button></div>
        <section class="access-v2-tab-panel" data-access-panel="data" role="tabpanel" hidden><div class="fields two-columns"><label class="field"><span>Nome <b>*</b></span><input name="nome" required></label><label class="field"><span>Login <b>*</b></span><input name="login" autocomplete="username" required></label><label class="field"><span>Senha</span><input name="password" type="password" autocomplete="new-password" placeholder="Obrigatória para novo usuário"></label><label class="field"><span>Perfil base <b>*</b></span><select name="perfilId" required>${profileOptions}</select></label><label class="access-v2-active"><input type="checkbox" name="ativo" checked><span>Usuário ativo</span><small data-access-self-active-note></small></label></div></section>
        <section class="access-v2-tab-panel" data-access-panel="retreats" role="tabpanel" hidden><div class="access-v2-section-heading"><h3>Retiros vinculados</h3><p>Limite o usuário aos retiros que ele realmente administra. Administradores podem permanecer sem vínculos.</p></div><div class="access-v2-retreat-grid">${retreatChecks || '<p class="empty-state">Nenhum retiro cadastrado.</p>'}</div></section>
        <section class="access-v2-tab-panel" data-access-panel="permissions" role="tabpanel"><div class="access-v2-security-note"><strong>Princípio do menor privilégio</strong><span>Conceda somente os acessos necessários para a função deste usuário.</span></div>
          <div class="access-v2-permission-tools"><label class="field"><span>Perfil base</span><select id="access-v2-base-profile">${profileOptions}</select></label><button type="button" id="apply-profile-permissions-v2">Aplicar perfil</button><button type="button" class="secondary-button" id="copy-user-access-v2">Copiar acessos de outro usuário</button></div>
          <div class="access-v2-permission-groups">${Object.entries(permissionGroups).map(([moduleName, items], index) => `<details class="access-v2-permission-group" data-permission-group="${escapeHtml(moduleName)}" ${moduleName === 'Configurações' || index < 2 ? 'open' : ''}><summary><div><strong>${escapeHtml(moduleName)}</strong><small>${items.length} permissão(ões)</small></div><label class="access-v2-master-switch" title="Ativar ou retirar todas as permissões deste módulo"><input type="checkbox" data-permission-master="${escapeHtml(moduleName)}"><span></span></label></summary><div class="access-v2-permission-items">${items.map((permission) => `<label class="access-v2-permission-item ${permission.action === 'excluir' ? 'is-danger' : ''}"><span><strong>${escapeHtml(permission.actionLabel)}</strong><small>${escapeHtml(permission.descricao || '')}</small></span><input type="checkbox" name="permission" value="${escapeHtml(permission.id)}" data-permission-module="${escapeHtml(moduleName)}"><i aria-hidden="true"></i></label>`).join('')}</div></details>`).join('')}</div>
        </section>
        <p id="access-message-v2" class="form-message">${escapeHtml(messageText)}</p>
        <footer class="access-v2-editor-actions"><p>Alterações de acesso entram em vigor no próximo carregamento.</p><div><button type="button" class="secondary-button" id="cancel-access-user-v2">Cancelar</button><button type="submit" ${canAccess('usuarios.criar') || canAccess('usuarios.editar') ? '' : 'disabled'}>Salvar alterações</button></div></footer>
      </form>
    </section>`, 'usuarios');

  const form = app.querySelector('#access-user-form-v2');
  const message = app.querySelector('#access-message-v2');
  const list = app.querySelector('#access-v2-user-list');
  const pagination = app.querySelector('.access-v2-pagination');
  const search = app.querySelector('#access-user-search');
  const pageSize = 6;
  let currentFilter = 'all';
  let currentPage = 1;
  let editingUser = sortedUsers.find((user) => user.id === selectedUserId) || sortedUsers[0] || null;
  let activeTab = editingUser ? 'permissions' : 'data';
  let openUserMenuId = '';
  const selectedPermissionIds = () => new Set([...form.querySelectorAll('input[name="permission"]:checked')].map((input) => input.value));
  const applyPermissions = (permissionIds = []) => {
    const selected = new Set(permissionIds);
    form.querySelectorAll('input[name="permission"]').forEach((input) => { input.checked = selected.has(input.value); });
    syncPermissionGroups();
  };
  const applyRetreats = (retreatIds = []) => {
    const selected = new Set(retreatIds);
    form.querySelectorAll('input[name="retiroIds"]').forEach((input) => { input.checked = selected.has(input.value); });
  };
  const profilePermissionIds = (profileId) => perfilPermissoes.filter((item) => item.perfilId === profileId && item.permitido !== false).map((item) => item.permissaoId);
  const syncPermissionGroups = () => {
    form.querySelectorAll('[data-permission-master]').forEach((master) => {
      const inputs = [...form.querySelectorAll(`input[data-permission-module="${CSS.escape(master.dataset.permissionMaster)}"]`)];
      const checked = inputs.filter((input) => input.checked).length;
      master.checked = Boolean(inputs.length) && checked === inputs.length;
      master.indeterminate = checked > 0 && checked < inputs.length;
      master.disabled = inputs.length > 0 && inputs.every((input) => input.disabled);
    });
  };
  const switchTab = (tab) => {
    activeTab = tab;
    form.querySelectorAll('[data-access-tab]').forEach((button) => { const selected = button.dataset.accessTab === tab; button.classList.toggle('is-active', selected); button.setAttribute('aria-selected', String(selected)); });
    form.querySelectorAll('[data-access-panel]').forEach((panel) => { panel.hidden = panel.dataset.accessPanel !== tab; });
  };
  const protectCurrentUserControls = () => {
    const isSelf = Boolean(editingUser && editingUser.id === currentDatabaseUserId);
    const isAdmin = profileById.get(editingUser?.perfilId)?.codigo === 'admin';
    form.elements.ativo.disabled = isSelf;
    form.elements.perfilId.disabled = isSelf;
    form.querySelector('[data-access-self-active-note]').textContent = isSelf ? 'Seu próprio acesso não pode ser desativado aqui.' : '';
    form.querySelectorAll('input[name="permission"]').forEach((input) => {
      const protectedSelfPermission = isSelf && input.value.startsWith('usuarios.');
      input.disabled = Boolean(isAdmin || protectedSelfPermission);
      input.closest('.access-v2-permission-item')?.classList.toggle('is-locked', input.disabled);
      if (isAdmin || protectedSelfPermission) input.checked = true;
    });
    syncPermissionGroups();
  };
  const fillForm = (user = null) => {
    editingUser = user;
    form.reset();
    form.elements.id.value = user?.id || '';
    form.elements.nome.value = user?.nome || '';
    form.elements.login.value = user?.login || '';
    form.elements.password.value = '';
    form.elements.password.required = !user;
    form.elements.perfilId.value = user?.perfilId || perfis[0]?.id || '';
    form.elements.ativo.checked = user?.ativo !== false;
    app.querySelector('#access-v2-base-profile').value = form.elements.perfilId.value;
    applyRetreats(user ? usuarioRetiros.filter((item) => item.usuarioId === user.id).map((item) => item.retiroId) : []);
    applyPermissions(user ? [...effectivePermissions(user)] : profilePermissionIds(form.elements.perfilId.value));
    app.querySelector('[data-access-avatar]').textContent = initials(user || { nome: 'Novo usuário' });
    app.querySelector('#access-v2-user-title').textContent = user?.nome || 'Novo usuário';
    app.querySelector('[data-access-login]').textContent = user?.login || 'Novo acesso';
    const status = app.querySelector('[data-access-status]');
    status.textContent = user?.ativo === false ? 'Inativo' : 'Ativo';
    status.className = `status ${user?.ativo === false ? 'encerrado' : 'publicado'}`;
    message.textContent = '';
    protectCurrentUserControls();
    switchTab(user ? 'permissions' : 'data');
    renderList();
  };
  const filteredUsers = () => {
    const term = normalizeText(search.value);
    return sortedUsers.filter((user) => {
      const statusMatches = currentFilter === 'all' || (currentFilter === 'active' ? user.ativo !== false : user.ativo === false);
      return statusMatches && (!term || normalizeText(`${user.nome || ''} ${user.login || ''} ${profileById.get(user.perfilId)?.nome || ''}`).includes(term));
    });
  };
  const renderList = () => {
    const filtered = filteredUsers();
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const pageUsers = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    app.querySelector('[data-access-visible-count]').textContent = filtered.length;
    list.innerHTML = pageUsers.length ? pageUsers.map((user) => {
      const profile = profileById.get(user.perfilId);
      const isSelf = user.id === currentDatabaseUserId;
      return `<article class="access-v2-user-row ${editingUser?.id === user.id ? 'is-selected' : ''}" data-access-user-row="${escapeHtml(user.id)}"><button type="button" class="access-v2-user-select" data-select-access-user="${escapeHtml(user.id)}"><span class="access-v2-list-avatar">${escapeHtml(initials(user))}</span><span><strong>${escapeHtml(user.nome || user.login)}</strong><small>${escapeHtml(user.login)} · ${escapeHtml(profile?.nome || 'Sem perfil')}</small></span><em class="${user.ativo === false ? 'is-inactive' : ''}">${user.ativo === false ? 'Inativo' : 'Ativo'}</em></button><div class="access-v2-overflow"><button type="button" data-access-menu="${escapeHtml(user.id)}" aria-label="Ações de ${escapeHtml(user.nome || user.login)}" aria-expanded="${openUserMenuId === user.id}">⋮</button><div class="access-v2-overflow-menu" ${openUserMenuId === user.id ? '' : 'hidden'}><button type="button" data-edit-access-user="${escapeHtml(user.id)}">Editar</button>${canAccess('usuarios.excluir') ? `<button type="button" class="is-danger" data-delete-access-user="${escapeHtml(user.id)}" ${isSelf ? 'disabled title="Você não pode excluir o próprio usuário"' : ''}>Excluir</button>` : ''}</div></div></article>`;
    }).join('') : '<p class="empty-state">Nenhum usuário encontrado.</p>';
    pagination.innerHTML = `<button type="button" data-access-page="prev" ${currentPage <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>${Array.from({ length: totalPages }, (_, index) => `<button type="button" data-access-page="${index + 1}" class="${currentPage === index + 1 ? 'is-active' : ''}">${index + 1}</button>`).join('')}<button type="button" data-access-page="next" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="Próxima página">›</button><span>${filtered.length ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)}` : '0'} de ${filtered.length}</span>`;
    wireListActions();
  };
  const wireListActions = () => {
    list.querySelectorAll('[data-select-access-user],[data-edit-access-user]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.selectAccessUser || button.dataset.editAccessUser;
      const user = sortedUsers.find((item) => item.id === id);
      openUserMenuId = '';
      if (user) fillForm(user);
    }));
    list.querySelectorAll('[data-access-menu]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      openUserMenuId = openUserMenuId === button.dataset.accessMenu ? '' : button.dataset.accessMenu;
      renderList();
      if (openUserMenuId) {
        setTimeout(() => document.addEventListener('click', () => { openUserMenuId = ''; renderList(); }, { once: true }), 0);
      }
    }));
    list.querySelectorAll('[data-delete-access-user]').forEach((button) => button.addEventListener('click', async () => {
      const user = sortedUsers.find((item) => item.id === button.dataset.deleteAccessUser);
      if (!user || user.id === currentDatabaseUserId || !confirm(`Excluir o usuário ${user.nome || user.login}?\n\nOs vínculos de permissões e retiros deste usuário também serão removidos.`)) return;
      try { await dataService.deleteAccessUser(user.id); await renderUsuariosSeguranca({ messageText: 'Usuário excluído.' }); } catch (error) { message.textContent = error.message || 'Não foi possível excluir o usuário.'; }
    }));
  };
  form.querySelectorAll('[data-access-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.accessTab)));
  form.querySelectorAll('[data-permission-master]').forEach((master) => master.addEventListener('change', () => {
    form.querySelectorAll(`input[data-permission-module="${CSS.escape(master.dataset.permissionMaster)}"]:not(:disabled)`).forEach((input) => { input.checked = master.checked; });
    syncPermissionGroups();
  }));
  form.querySelectorAll('.access-v2-master-switch').forEach((label) => label.addEventListener('click', (event) => event.stopPropagation()));
  form.querySelectorAll('input[name="permission"]').forEach((input) => input.addEventListener('change', syncPermissionGroups));
  app.querySelector('#apply-profile-permissions-v2').addEventListener('click', () => {
    const profileId = app.querySelector('#access-v2-base-profile').value;
    if (!form.elements.perfilId.disabled) form.elements.perfilId.value = profileId;
    applyPermissions(profilePermissionIds(profileId));
    protectCurrentUserControls();
    message.textContent = 'Permissões do perfil aplicadas. Salve para confirmar.';
  });
  app.querySelector('#copy-user-access-v2').addEventListener('click', () => {
    const overlay = document.createElement('section');
    overlay.className = 'receiver-sector-overlay access-v2-copy-overlay';
    const choices = sortedUsers.filter((user) => user.id !== editingUser?.id);
    overlay.innerHTML = `<div class="receiver-sector-dialog access-v2-copy-dialog"><div class="panel-heading"><div><p class="eyebrow">Copiar acessos</p><h2>Escolha o usuário de origem</h2><p>Perfil, retiros e permissões serão copiados para o formulário atual.</p></div></div><label class="field"><span>Buscar usuário</span><input type="search" data-copy-user-search placeholder="Nome ou login" autofocus></label><div class="access-v2-copy-list">${choices.map((user) => `<button type="button" data-copy-access-user="${escapeHtml(user.id)}"><strong>${escapeHtml(user.nome || user.login)}</strong><span>${escapeHtml(user.login)} · ${escapeHtml(profileById.get(user.perfilId)?.nome || 'Sem perfil')}</span></button>`).join('') || '<p class="empty-state">Nenhum outro usuário disponível.</p>'}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
    const close = () => overlay.remove();
    overlay.querySelector('.close-sector-view').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-copy-user-search]')?.addEventListener('input', (event) => { const term = normalizeText(event.target.value); overlay.querySelectorAll('[data-copy-access-user]').forEach((button) => { button.hidden = term && !normalizeText(button.textContent).includes(term); }); });
    overlay.querySelectorAll('[data-copy-access-user]').forEach((button) => button.addEventListener('click', () => {
      const source = sortedUsers.find((user) => user.id === button.dataset.copyAccessUser);
      if (!source) return;
      if (!form.elements.perfilId.disabled) form.elements.perfilId.value = source.perfilId || perfis[0]?.id || '';
      app.querySelector('#access-v2-base-profile').value = form.elements.perfilId.value;
      applyPermissions([...effectivePermissions(source)]);
      applyRetreats(usuarioRetiros.filter((item) => item.usuarioId === source.id).map((item) => item.retiroId));
      protectCurrentUserControls();
      message.textContent = `Acessos de ${source.nome || source.login} copiados. Salve para confirmar.`;
      close();
    }));
    app.append(overlay);
  });
  app.querySelector('#new-access-user-v2')?.addEventListener('click', () => { editingUser = null; fillForm(null); form.elements.nome.focus(); });
  app.querySelector('#cancel-access-user-v2').addEventListener('click', () => fillForm(editingUser || sortedUsers[0] || null));
  app.querySelectorAll('[data-access-filter]').forEach((button) => button.addEventListener('click', () => { currentFilter = button.dataset.accessFilter; currentPage = 1; app.querySelectorAll('[data-access-filter]').forEach((item) => item.classList.toggle('is-active', item === button)); renderList(); }));
  search.addEventListener('input', () => { currentPage = 1; renderList(); });
  pagination.addEventListener('click', (event) => { const button = event.target.closest('[data-access-page]'); if (!button) return; const pages = Math.max(1, Math.ceil(filteredUsers().length / pageSize)); currentPage = button.dataset.accessPage === 'prev' ? Math.max(1, currentPage - 1) : button.dataset.accessPage === 'next' ? Math.min(pages, currentPage + 1) : Number(button.dataset.accessPage); renderList(); });
  form.addEventListener('keydown', (event) => { if (event.key === 'Escape' && openUserMenuId) { openUserMenuId = ''; renderList(); } });
  list.addEventListener('keydown', (event) => { if (event.key === 'Escape' && openUserMenuId) { openUserMenuId = ''; renderList(); } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) { switchTab('data'); return; }
    const data = new FormData(form);
    const isSelf = editingUser?.id === currentDatabaseUserId;
    const permissions = permissoes.map((permission) => ({ permissaoId: permission.id, permitido: selectedPermissionIds().has(permission.id) }));
    try {
      const saved = await dataService.saveAccessUser({ id: data.get('id') || undefined, nome: data.get('nome'), login: data.get('login'), password: data.get('password'), perfilId: isSelf ? editingUser.perfilId : data.get('perfilId'), ativo: isSelf ? true : data.get('ativo') === 'on', retiroIds: data.getAll('retiroIds'), permissions });
      await renderUsuariosSeguranca({ selectedUserId: saved.id, messageText: 'Alterações salvas com segurança.' });
    } catch (error) { message.textContent = error.message || 'Não foi possível salvar o usuário.'; }
  });
  fillForm(editingUser);
  if (messageText) message.textContent = messageText;
}

async function ensureAuthenticated() {
  if (publicRetreatId) return true;
  if (authChecked) return Boolean(currentUser);
  try {
    const session = await dataService.getSession();
    currentUser = session.authenticated ? session.user : null;
    authenticationBackendError = '';
    if (!legacyLocalDataWarningShown) {
      const legacyStatus = await dataService.inspectLegacyLocalData().catch(() => ({ total: 0, counts: {} }));
      if (legacyStatus.total) {
        legacyLocalDataWarningShown = true;
        const summary = Object.entries(legacyStatus.counts).map(([storeName, count]) => `${storeName}: ${count}`).join(', ');
        alert(`Atencao: este navegador possui ${legacyStatus.total} registro(s) legado(s) que nao estao no Supabase (${summary}). Eles foram preservados, nao serao usados nem enviados automaticamente. Procure o administrador antes de limpar os dados deste navegador.`);
      }
    }
  } catch (error) {
    currentUser = null;
    authenticationBackendError = error.message || 'Nao foi possivel conectar ao Supabase.';
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
    if (publicStudentRegistrationToken) return renderSharedPublicStudentRegistration();
    if (publicRetreatId) return renderPublicForm(publicRetreatId, false, publicSectorToken);
    if (publicReceiverToken) {
      if (!publicReceiverRetreatId) {
        app.innerHTML = '<section class="page-heading"><div><p class="eyebrow">Recebedor</p><h1>Link indisponivel</h1><p>Confira o link enviado pelo financeiro.</p></div></section>';
        return;
      }
      await loadData();
      return renderRecebedor();
    }
    if (!(await ensureAuthenticated())) return renderLogin(authenticationBackendError || (location.hash === '#login' ? '' : 'Faca login para acessar a area restrita.'));
    const rawTarget = location.hash.slice(1) || firstAllowedSection();
    const [target, targetQuery = ''] = rawTarget.split('?');
    const targetParams = new URLSearchParams(targetQuery);
    const requestedStudentFileNumber = Math.max(0, Math.trunc(Number(targetParams.get('ficha')) || 0));
    const requestedRetreatSector = targetParams.get('setor') || '';
    if (target === 'usuarios') { await ensureRetreatFocusLoaded(); return renderUsuariosSeguranca(); }
    if (target === 'backup') { await ensureRetreatFocusLoaded(); return renderBackup(); }
    if (target === 'relatorios') { await ensureRetreatFocusLoaded(); if (!ensureViewPermission('relatorios')) return; return renderRelatorios(); }
    if (target === 'financeiro') { await ensureRetreatFocusLoaded(); if (!ensureViewPermission('financeiro')) return; return renderFinanceiro({ retreat: selectedRetreat(), layout, dataService, canAccess, currentUser }); }
    const section = target.startsWith('configuracoes/') ? 'configuracoes' : target.startsWith('retiros/') ? 'retiros' : target.startsWith('pessoas/') ? 'pessoas' : target.startsWith('cursista/') ? 'cursista' : target;
    if (!ensureViewPermission(section)) return;
    if (target === 'cursista-epc') {
      await loadData();
      return renderCursistaEpc(requestedStudentFileNumber);
    }
    if (target === 'cursista-smp') {
      await loadData();
      return renderCursistaSmp(requestedStudentFileNumber);
    }
    await loadData();
    if (target === 'inicio') return renderHome();
    if (target === 'retiros') return renderRetiros();
    if (target === 'configuracoes') return renderConfiguracoes();
    if (target === 'configuracoes/novo') return canAccess('retiros.criar') ? renderNewRetreat('#configuracoes') : renderDenied();
    if (target === 'configuracoes/editar') {
      if (!canAccess('retiros.editar')) return renderDenied();
      const retreat = selectedRetreat();
      return retreat ? renderEditRetreat(retreat.id, '#configuracoes') : renderConfiguracoes();
    }
    if (target === 'retiros/novo') return canAccess('retiros.criar') ? renderNewRetreat('#configuracoes') : renderDenied();
    if (target.endsWith('/editar')) return canAccess('retiros.editar') ? renderEditRetreat(target.split('/')[1], '#configuracoes') : renderDenied();
    if (target.startsWith('retiros/')) return renderRetreat(target.split('/')[1], requestedRetreatSector);
    if (target === 'validacao-inscricoes') return renderValidacaoInscricoes(); if (target === 'recebedor') return renderRecebedor(); if (target === 'comunidades') return renderComunidades(); if (target === 'recado-equipe') return renderRecadoEquipe(); if (target === 'alterar-senha') return renderAlterarSenha(); if (target === 'crachas') return renderCrachas(); if (target === 'quadrante') return renderQuadrante(); if (target.startsWith('cursista/')) return renderCursistaDetalhe(target.split('/')[1]);
    if (target === 'cursista') {
      await renderCursista(); const form = app.querySelector('#student-form'); const studentFileNumberInput = app.querySelector('.student-file-number input'); const activeRetreat = selectedRetreat(); const canEditStudentRetreat = canModifyRetreat(activeRetreat);
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
      form.dataset.studentPaymentTouched = 'true';
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
      form.dataset.studentPaymentTouched = 'true';
      setStudentPaymentDetails({ paidAmount: 0 });
      recalculateBalance();
      app.querySelector('#student-message').textContent = 'Pagamento removido. Clique em Salvar alterações para gravar.';
    });
    recalculateBalance();
    const studentHeadingActions = app.querySelector('.student-heading-actions');
    const editSelectedStudent = app.querySelector('#edit-selected-student');
    const printSelectedStudent = app.querySelector('#print-selected-student');
    const deleteSelectedStudent = app.querySelector('#delete-selected-student');
    if (!canEditStudentRetreat) {
      editSelectedStudent?.remove();
      deleteSelectedStudent?.remove();
      form.querySelector('.delete-student')?.remove();
    }
    let selectedStudentId = '';
    let selectedStudentRecord = null;
    form.dataset.studentPaymentTouched = 'false';
    let studentFileLookupTimer = 0;
    let studentFileLookupRequest = 0;
    const cancelStudentFileLookup = () => {
      window.clearTimeout(studentFileLookupTimer);
      studentFileLookupTimer = 0;
      studentFileLookupRequest += 1;
    };
    const normalizeStudentFileLookup = (value) => {
      const number = Number(String(value || '').trim());
      return Number.isInteger(number) && number > 0 ? number : 0;
    };
    const studentFileLookupEnabled = () => Boolean(form.querySelector('button[type="submit"]')?.disabled);
    const setStudentFormLocked = (locked) => {
      const effectiveLocked = locked || !canEditStudentRetreat;
      form.querySelectorAll('input, select, textarea').forEach((control) => {
        if (control.type !== 'hidden') control.disabled = effectiveLocked;
      });
      if (studentFileNumberInput) studentFileNumberInput.disabled = false;
      form.querySelector('button[type="submit"]').disabled = effectiveLocked;
      app.querySelector('#set-student-payment').disabled = effectiveLocked;
      app.querySelector('#clear-student-payment').disabled = effectiveLocked;
      form._studentPhotoController?.setEditable(!effectiveLocked);
    };
    const clearStudentForm = ({ focus = true, message = '' } = {}) => { selectedStudentId = ''; selectedStudentRecord = null; studentHeadingActions.hidden = true; form.dataset.studentPaymentTouched = 'false'; setStudentFormLocked(false); form._studentPhotoController?.reset(); form.reset(); form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning')); form.querySelector('input[name="id"]')?.remove(); form.elements.retiroId.value = activeRetreat?.id || ''; form.elements.valorInscricao.value = currency(activeRetreat?.valorInscricaoCursista); setStudentPaymentDetails({ paidAmount: 0 }); form.querySelector('.delete-student')?.setAttribute('hidden', ''); form.querySelector('button[type="submit"]').innerHTML = 'Salvar cadastro <span>→</span>'; form.querySelector('#student-message').textContent = message; recalculateBalance(); if (focus) form.elements.cpf.focus(); };
    const deleteStudentRecord = async (id) => {
      if (!ensureRetreatCanBeChanged(activeRetreat, 'excluir cursistas')) return;
      if (!id || !confirm('Excluir este cursista?')) return;
      const students = await dataService.listCursistas(activeRetreat?.id || '');
      const student = students.find((item) => item.id === id) || id;
      form.querySelector('#student-message').textContent = 'Excluindo cursista e foto...';
      try {
        await dataService.deleteCursista(id);
        await removeStudentFromCommunities(student).catch(() => null);
        clearStudentForm({ focus: false, message: 'Cursista e foto excluídos com sucesso.' });
        setStudentFormLocked(true);
      } catch (error) {
        form.querySelector('#student-message').textContent = error.message || 'Não foi possível concluir a exclusão do cursista e da foto. Recarregue a ficha e tente novamente.';
      }
    };
    const loadStudent = (student) => { selectedStudentId = student.id || ''; selectedStudentRecord = student; studentHeadingActions.hidden = !selectedStudentId; printSelectedStudent.hidden = !selectedStudentId; form.dataset.studentPaymentTouched = 'false'; setStudentFormLocked(false); form.reset(); if (studentFileNumberInput) studentFileNumberInput.value = student.numeroFichaIndividual || ''; if (!form.elements.id) form.insertAdjacentHTML('beforeend', '<input type="hidden" name="id">'); Object.entries(student).forEach(([key, value]) => { const field = form.elements[key]; if (!field) return; if (field.type === 'radio') form.querySelectorAll(`[name="${key}"]`).forEach((input) => { input.checked = input.value === value; }); else field.value = key === 'nascimento' ? (formatDateInput(value) || value || '') : (value || ''); }); form.elements.retiroId.value = student.retiroId || activeRetreat?.id || ''; const receiverPaid = Math.max(0, parseCurrency(student.recebedorValorPago) - parseCurrency(student.valorPago)); const advanceMethod = student.formaPagamento || (parseCurrency(student.valorPago) > 0 && receiverPaid <= 0 ? student.recebedorFormaPagamento : ''); const advanceObservation = student.observacaoPagamento || (parseCurrency(student.valorPago) > 0 && receiverPaid <= 0 ? student.recebedorObservacao : ''); setStudentPaymentDetails({ method: advanceMethod, observation: advanceObservation, paidAmount: parseCurrency(student.valorPago) }); form.elements.recebedorValorPago.value = student.recebedorValorPago || parseCurrency(student.valorPago) || 0; form.elements.recebedorTaxaPaga.value = student.recebedorTaxaPaga ? 'true' : ''; form.elements.recebedorFormaPagamento.value = receiverPaid > 0 ? (student.recebedorFormaPagamento || '') : ''; form.elements.recebedorObservacao.value = receiverPaid > 0 ? (student.recebedorObservacao || '') : ''; form.querySelector('button[type="submit"]').innerHTML = 'Salvar alterações <span>→</span>'; form.querySelector('.delete-student')?.setAttribute('hidden', ''); recalculateBalance(); setStudentFormLocked(true); form.querySelector('#student-message').textContent = canEditStudentRetreat ? 'Cadastro de cursista carregado. Clique em Editar para alterar.' : 'Retiro concluido: cadastro de cursista carregado apenas para consulta.'; };
    const ensureLoadedStudentMedicationDefault = (student = {}) => {
      if (!['Sim', 'Não'].includes(student.medicamentoContinuo)) {
        form.querySelectorAll('[name="medicamentoContinuo"]').forEach((input) => {
          input.checked = input.value === 'Não';
        });
      }
      form.querySelector('[name="medicamentoContinuo"]')?.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const studentSearchInput = app.querySelector('#student-search');
    const studentSearchResults = app.querySelector('#student-search-results');
    let studentSearchRequest = 0;
    let studentSearchOpen = false;
    const closeStudentSearchResults = () => {
      studentSearchOpen = false;
      studentSearchRequest += 1;
      studentSearchInput.value = '';
      studentSearchResults.hidden = true;
      studentSearchResults.innerHTML = '';
    };
    form.addEventListener('student-form-cleared-after-save', () => {
      cancelStudentFileLookup();
      selectedStudentId = '';
      selectedStudentRecord = null;
      closeStudentSearchResults();
    });
    const renderStudentSearch = async () => {
      studentSearchOpen = true;
      const currentRequest = ++studentSearchRequest;
      const term = normalizeText(studentSearchInput.value);
      const students = (await dataService.listCursistas(activeRetreat?.id || ''))
        .filter((student) => (!activeRetreat || student.retiroId === activeRetreat.id))
        .filter((student) => {
          const cpf = normalizeCpf(student.cpf);
          const fileNumber = student.numeroFichaIndividual ? `Ficha ${student.numeroFichaIndividual}` : '';
          const haystack = normalizeText([student.numeroFichaIndividual, fileNumber, student.nome, cpf, cpf && formatCpf(cpf), student.telefone, student.nomePai, student.nomeMae].filter(Boolean).join(' '));
          return !term || haystack.includes(term);
        })
        .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR'));
      if (!studentSearchOpen || currentRequest !== studentSearchRequest) return;
      studentSearchResults.hidden = false;
      studentSearchResults.innerHTML = students.length ? students.map((student) => {
        const cpf = normalizeCpf(student.cpf);
        const fileNumber = student.numeroFichaIndividual ? `Ficha ${escapeHtml(student.numeroFichaIndividual)}` : 'Sem número';
        return `<article><button type="button" class="student-search-choice" data-student-select="${student.id}"><div class="student-search-choice-heading"><strong class="student-search-choice-name">${escapeHtml(student.nome || 'Sem nome')}</strong><span class="student-search-choice-file-number">${fileNumber}</span></div><span class="student-search-choice-details">${cpf ? formatCpf(cpf) : 'CPF não informado'} · ${escapeHtml(student.telefone || 'Sem telefone')}</span></button></article>`;
      }).join('') : '<p>Nenhum cursista encontrado neste retiro.</p>';
      studentSearchResults.querySelectorAll('[data-student-select]').forEach((button) => button.addEventListener('click', () => {
        const student = students.find((item) => item.id === button.dataset.studentSelect);
        if (student) {
          closeStudentSearchResults();
          loadStudent(student);
          form._studentPhotoController?.load(student);
          ensureLoadedStudentMedicationDefault(student);
          setTimeout(() => {
            editSelectedStudent?.focus({ preventScroll: true });
          }, 0);
        }
      }));
    };
    const resetStudentFileLookupState = (fileNumber, message) => {
      selectedStudentId = '';
      selectedStudentRecord = null;
      form._studentPhotoController?.reset();
      studentHeadingActions.hidden = true;
      form.dataset.studentPaymentTouched = 'false';
      form.reset();
      form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
      form.querySelector('input[name="id"]')?.remove();
      form.elements.retiroId.value = activeRetreat?.id || '';
      form.elements.valorInscricao.value = '';
      setStudentPaymentDetails({ paidAmount: 0 });
      form.querySelector('.delete-student')?.setAttribute('hidden', '');
      form.querySelector('button[type="submit"]').innerHTML = 'Salvar cadastro <span>→</span>';
      setStudentFormLocked(true);
      if (studentFileNumberInput) studentFileNumberInput.value = fileNumber;
      form.querySelector('#student-message').textContent = message;
    };
    const executeStudentFileLookup = async (typedFileNumber, currentRequest) => {
      const fileNumber = normalizeStudentFileLookup(typedFileNumber);
      if (!fileNumber) {
        if (currentRequest === studentFileLookupRequest) resetStudentFileLookupState(typedFileNumber, 'Informe um número da ficha válido.');
        return;
      }
      try {
        const students = await dataService.listCursistas(activeRetreat?.id || '');
        if (currentRequest !== studentFileLookupRequest) return;
        const student = students.find((item) => (
          item.retiroId === activeRetreat?.id
          && Number(item.numeroFichaIndividual) === fileNumber
        ));
        if (!student) {
          resetStudentFileLookupState(typedFileNumber, 'Nenhuma ficha encontrada neste retiro.');
          return;
        }
        loadStudent(student);
        form._studentPhotoController?.load(student);
        ensureLoadedStudentMedicationDefault(student);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => editSelectedStudent?.focus({ preventScroll: true }), 0);
      } catch (error) {
        if (currentRequest === studentFileLookupRequest) resetStudentFileLookupState(typedFileNumber, error.message || 'Não foi possível consultar o número da ficha.');
      }
    };
    const lookupStudentByFileNumber = ({ immediate = false } = {}) => {
      if (!studentFileNumberInput || !studentFileLookupEnabled()) return;
      closeStudentSearchResults();
      const typedFileNumber = studentFileNumberInput.value;
      cancelStudentFileLookup();
      const currentRequest = studentFileLookupRequest;
      resetStudentFileLookupState(typedFileNumber, typedFileNumber.trim() ? 'Buscando ficha...' : (canEditStudentRetreat ? 'Clique em Incluir novo para iniciar um cadastro.' : 'Retiro concluido: cursistas disponiveis apenas para consulta.'));
      if (!typedFileNumber.trim()) return;
      if (immediate) {
        void executeStudentFileLookup(typedFileNumber, currentRequest);
        return;
      }
      studentFileLookupTimer = window.setTimeout(() => {
        void executeStudentFileLookup(typedFileNumber, currentRequest);
      }, 350);
    };
    setStudentFormLocked(true);
    form.querySelector('#student-message').textContent = canEditStudentRetreat ? 'Clique em Incluir novo para iniciar um cadastro.' : 'Retiro concluido: cursistas disponiveis apenas para consulta.';
    app.querySelector('#new-student')?.addEventListener('click', async () => {
      if (!ensureRetreatCanBeChanged(activeRetreat, 'incluir cursistas')) return;
      cancelStudentFileLookup();
      clearStudentForm({ focus: false });
      const students = await dataService.listCursistas(activeRetreat?.id || '');
      if (!studentFileNumberInput) return;
      studentFileNumberInput.value = nextAvailableStudentFileNumber(students, activeRetreat?.id || '');
      studentFileNumberInput.closest('.student-file-number')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      studentFileNumberInput.focus({ preventScroll: true });
    });
    editSelectedStudent?.addEventListener('click', () => { if (!ensureRetreatCanBeChanged(activeRetreat, 'editar cursistas')) return; if (selectedStudentId) { cancelStudentFileLookup(); printSelectedStudent.hidden = true; setStudentFormLocked(false); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.nome.focus({ preventScroll: true }); form.querySelector('#student-message').textContent = 'Editando cadastro de cursista.'; } });
    printSelectedStudent?.addEventListener('click', () => {
      if (!selectedStudentRecord) return;
      printStudentRegistrationSheet({ retreat: activeRetreat, record: selectedStudentRecord, studentFormType: 'cursista' });
    });
    deleteSelectedStudent?.addEventListener('click', () => deleteStudentRecord(selectedStudentId));
    studentFileNumberInput?.addEventListener('input', () => lookupStudentByFileNumber());
    studentFileNumberInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !studentFileLookupEnabled()) return;
      event.preventDefault();
      lookupStudentByFileNumber({ immediate: true });
    });
    studentSearchInput.addEventListener('focus', () => { cancelStudentFileLookup(); renderStudentSearch(); });
    studentSearchInput.addEventListener('input', () => { cancelStudentFileLookup(); renderStudentSearch(); });
    const studentSearchField = studentSearchInput.closest('.registration-search-field');
    const hideStudentSearch = () => {
      studentSearchOpen = false;
      studentSearchRequest += 1;
      studentSearchResults.hidden = true;
    };
    const closeStudentSearch = (event) => {
      if (!studentSearchField.contains(event.target) && !studentSearchResults.contains(event.target)) hideStudentSearch();
    };
    studentSearchField.addEventListener('focusout', (event) => { if (!studentSearchField.contains(event.relatedTarget) && !studentSearchResults.contains(event.relatedTarget)) hideStudentSearch(); });
    studentSearchResults.addEventListener('focusout', (event) => { if (!studentSearchField.contains(event.relatedTarget) && !studentSearchResults.contains(event.relatedTarget)) hideStudentSearch(); });
    document.addEventListener('pointerdown', closeStudentSearch, true);
    document.addEventListener('focusin', closeStudentSearch, true);
    form.querySelector('.delete-student')?.addEventListener('click', () => deleteStudentRecord(form.elements.id?.value));
    if (requestedStudentFileNumber && studentFileNumberInput) {
      const students = await dataService.listCursistas(activeRetreat?.id || '');
      const requestedStudent = students.find((student) => student.retiroId === activeRetreat?.id && Number(student.numeroFichaIndividual) === requestedStudentFileNumber);
      if (requestedStudent) {
        loadStudent(requestedStudent);
        form._studentPhotoController?.load(requestedStudent);
        ensureLoadedStudentMedicationDefault(requestedStudent);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (canEditStudentRetreat && canAccess('cursista.criar')) {
        clearStudentForm({ focus: false, message: `Nova ficha ${requestedStudentFileNumber} - Cursista Individual.` });
        form._studentPhotoController?.reset();
        studentFileNumberInput.value = String(requestedStudentFileNumber);
        setStudentFormLocked(false);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        resetStudentFileLookupState(String(requestedStudentFileNumber), canEditStudentRetreat ? 'Você não tem permissão para cadastrar cursistas.' : 'Retiro concluído: ficha não cadastrada.');
      }
    }
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
async function routeAndLaunchOperationalReport() {
  await route();
  await launchPendingOperationalReport();
  await restoreOperationalReportPosition();
}
window.addEventListener('hashchange', routeAndLaunchOperationalReport);
routeAndLaunchOperationalReport();
