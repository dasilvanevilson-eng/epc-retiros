import { dataService, retreatDefaults } from './dataService.js';

const app = document.querySelector('#app');
const publicPathRetreatId = location.pathname.match(/^\/adesao\/([^/?#]+)/)?.[1];
const publicRetreatId = new URLSearchParams(location.search).get('adesao') || (publicPathRetreatId ? decodeURIComponent(publicPathRetreatId) : '');
let retreats = [];
let enrolments = [];
let people = [];
let participantSort = { key: 'nome', direction: 'asc' };
let participantsVisible = false;
let receiverSort = { key: 'nome', direction: 'asc' };
let receiverFocusSector = null;
let badgePrintEntries = [];
let badgePrintTitle = '';
let currentUser = null;
let authChecked = false;

const viewPermissions = {
  inicio: 'inicio.ver',
  retiros: 'retiros.ver',
  pessoas: 'pessoas.ver',
  'validacao-inscricoes': 'validacao-inscricoes.ver',
  cursista: 'cursista.ver',
  comunidades: 'comunidades.ver',
  crachas: 'crachas.ver',
  quadrante: 'quadrante.ver',
  recebedor: 'recebedor.ver',
  usuarios: 'usuarios.ver',
};

const canAccess = (permission) => !permission || currentUser?.role === 'admin' || currentUser?.perfilCodigo === 'admin' || (currentUser?.permissions || []).includes(permission);
const canView = (section) => canAccess(viewPermissions[section]);
const firstAllowedSection = () => Object.keys(viewPermissions).find((section) => canView(section)) || 'inicio';
const ensureViewPermission = (section) => {
  if (canView(section)) return true;
  layout('<section class="page-heading"><div><p class="eyebrow">Acesso restrito</p><h1>Sem permissao</h1><p>Seu usuario nao tem permissao para acessar esta area.</p></div></section>', firstAllowedSection());
  return false;
};
const renderDenied = () => layout('<section class="page-heading"><div><p class="eyebrow">Acesso restrito</p><h1>Sem permissao</h1><p>Seu usuario nao tem permissao para executar esta acao.</p></div></section>', firstAllowedSection());
const sectorToken = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 18);
};
const syncSectorLinks = (retreat = {}, sectors = retreat.setores || []) => {
  const existing = new Map((retreat.linksSetores || retreat.setorLinks || []).map((item) => [normalizeText(item.setor || item.sector), item]));
  return sortSectors(sectors).map((setor) => {
    const current = existing.get(normalizeText(setor));
    return { setor, token: current?.token || sectorToken() };
  });
};
const ensureSectorLinks = async (retreat) => {
  const nextLinks = syncSectorLinks(retreat);
  const current = JSON.stringify(retreat.linksSetores || []);
  const next = JSON.stringify(nextLinks);
  if (current === next) return nextLinks;
  retreat.linksSetores = nextLinks;
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

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const date = (value) => value ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${value}T12:00:00`)) : 'A definir';
const dateRange = (start, end) => start && end && end !== start ? `${date(start)} a ${date(end)}` : date(start);
const birthday = (value) => value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00`)) : 'A definir';
const parseLocalDate = (value) => value ? new Date(`${value}T12:00:00`) : null;
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
const hiddenTeamSectors = new Set(['camareiro(a)', 'camareiros(as)', 'cozinha', 'espaço kids', 'espiritual', 'externo', 'refeitório', 'secretaria', 'zeladoria']);
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
const entryHasSector = (entry, sector) => (Array.isArray(entry.setores) ? entry.setores : [entry.setores]).some((item) => normalizeText(item) === normalizeText(sector));
const isEnrolmentValidated = (entry = {}) => entry.status === 'confirmada' || entry.status === 'validada' || entry.validada === true || Boolean(entry.validadoEm);
const isCoupleMateValidated = (entry = {}, items = enrolments) => Boolean(entry.casalId && items.some((item) => item.id !== entry.id && item.retiroId === entry.retiroId && item.casalId === entry.casalId && isEnrolmentValidated(item)));
const isEnrolmentEffectivelyValidated = (entry = {}, items = enrolments) => isEnrolmentValidated(entry) || isCoupleMateValidated(entry, items);
const validatedEnrolments = (items = enrolments) => items.filter((entry) => isEnrolmentEffectivelyValidated(entry, items));
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
      const normalized = uniqueSectors(saved);
      if (normalized.length !== saved.length) saveStandardSectors(normalized);
      return normalized;
    }
  } catch {}
  return uniqueSectors([...retreatDefaults.setores, ...retreats.flatMap((retreat) => retreat.setores || [])]);
}
const saveStandardSectors = (sectors) => localStorage.setItem(standardSectorsKey, JSON.stringify(uniqueSectors(sectors)));
const addStandardSector = (sector) => saveStandardSectors([...standardSectors(), sector]);
const renameStandardSector = (from, to) => saveStandardSectors(standardSectors().map((sector) => normalizeText(sector) === normalizeText(from) ? to : sector));
const deleteStandardSector = (sectorToDelete) => saveStandardSectors(standardSectors().filter((sector) => normalizeText(sector) !== normalizeText(sectorToDelete)));
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

async function loadData() {
  [retreats, enrolments, people] = await Promise.all([dataService.listRetiros(), dataService.listAdesoes(), dataService.listPessoas()]);
  retreats.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
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
  const navItems = [
    ['inicio', 'Início', '⌂'],
    ['retiros', 'Retiros', '▣'],
    ['pessoas', 'Equipe de trabalho', '♁'],
    ['validacao-inscricoes', 'Validação', '✓'],
    ['cursista', 'Cursista', '♙'],
    ['comunidades', 'Comunidades', '♧'],
    ['crachas', 'Crach&aacute;s', '▣'],
    ['quadrante', 'Quadrante', '✣'],
    ['recebedor', 'Recebedor', '▱'],
    ['usuarios', 'Usuarios e permissoes', 'UP'],
  ].filter(([id]) => canView(id));
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
  menuToggle.addEventListener('click', () => {
    const open = mainNav.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mainNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    mainNav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }));
  app.querySelector('#logout-button')?.addEventListener('click', async () => {
    await dataService.logout().catch(() => null);
    currentUser = null;
    authChecked = false;
    location.href = 'index.html';
  });
  app.querySelectorAll('.statistics-grid span').forEach((label) => { if (label.textContent === 'Idade média') label.textContent = 'Idade média geral'; });
  if (active === 'cursista') app.querySelector('#student-message')?.insertAdjacentHTML('beforebegin', '<section class="form-section student-registration-value"><div class="section-heading"><span>06</span><div><h2>Inscrição</h2><p>Informe os valores financeiros do cursista.</p></div></div><div class="fields three-columns"><label class="field"><span>Valor da inscrição</span><input name="valorInscricao" type="text" inputmode="decimal" placeholder="R$ 0,00"></label><label class="field"><span>Valor pago</span><input name="valorPago" type="text" inputmode="decimal" placeholder="R$ 0,00"></label><label class="field"><span>Saldo a pagar</span><input name="saldoPagar" type="text" readonly placeholder="R$ 0,00"></label></div></section>');
}

function statusLabel(status) { return ({ preparacao: 'Em preparação', publicado: 'Publicado', encerrado: 'Encerrado' })[status] || status; }

function openHomeInfoWindow(label, content) {
  app.querySelector('.home-stat-overlay')?.remove();
  const overlay = document.createElement('section');
  overlay.className = 'home-stat-overlay';
  overlay.innerHTML = `<div class="home-stat-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}"><button type="button" class="home-stat-close" aria-label="Fechar">×</button><div class="home-stat-scroll">${content}</div></div>`;
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') overlay.remove(); });
  overlay.querySelector('.home-stat-close').addEventListener('click', () => overlay.remove());
  app.append(overlay);
  overlay.querySelector('.home-stat-close').focus();
}

function setupHomeStatTabs() {
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
    openHomeInfoWindow(label, panel.innerHTML);
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

async function renderHome() {
  const active = retreats.find((retreat) => retreat.status === 'publicado') || retreats.find((retreat) => retreat.status === 'preparacao');
  const allStudents = await dataService.listCursistas();
  const activeStudents = active ? allStudents.filter((student) => student.retiroId === active.id) : [];
  const activeEnrolments = active ? validatedEnrolments(enrolments.filter((item) => item.retiroId === active.id)) : [];
  const activeEntries = active ? enrolments.filter((item) => item.retiroId === active.id) : [];
  const pendingEntries = activeEntries.filter((entry) => !isEnrolmentEffectivelyValidated(entry, activeEntries));
  const serviceDays = active ? retreatServiceDays(active) : [];
  const sectorCounts = active ? sortSectors(uniqueSectors([...(active.setores || []), ...activeEnrolments.flatMap((entry) => entry.setores || [])]))
    .map((sector) => [sector, activeEnrolments.filter((entry) => entryHasSector(entry, sector)).length])
    .filter(([sector, count]) => count > 0 || active?.setores?.includes(sector)) : [];
  const dayCount = (day) => activeEnrolments.filter((entry) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).some((item) => normalizeText(item) === normalizeText(day))).length + activeStudents.length;
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
    .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR'));
  const allergyStudents = activeStudents
    .filter((student) => normalizeText(student.alergiaMedicamento) === 'sim' || String(student.qualAlergia || '').trim())
    .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR'));
  const groupedPreferenceRows = (entries, field) => {
    const usedCouples = new Set();
    return entries.reduce((rows, entry) => {
      if (entry.casalId) {
        if (usedCouples.has(entry.casalId)) return rows;
        const couple = entries.filter((item) => item.casalId === entry.casalId);
        usedCouples.add(entry.casalId);
        if (!couple.some((item) => normalizeText(item[field]) === 'sim')) return rows;
        rows.push({ name: couple.map((item) => item.nome).filter(Boolean).join(' e '), detail: 'Ficha de casal' });
        return rows;
      }
      if (normalizeText(entry[field]) !== 'sim') return rows;
      rows.push({ name: entry.nome || 'Sem nome', detail: entry.setores?.join(', ') || 'Ficha individual' });
      return rows;
    }, []).sort((first, second) => first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' }));
  };
  const quadranteRows = groupedPreferenceRows(activeEnrolments, 'quadrante');
  const photoRows = groupedPreferenceRows(activeEnrolments, 'foto');
  const sectorRows = sectorCounts.length ? sectorCounts.map(([sector, count]) => `<div><span>${escapeHtml(sector)}</span><strong>${count}</strong></div>`).join('') : '<p class="empty-state">Nenhum setor com equipe validada.</p>';
  const dayRows = serviceDays.length ? serviceDays.map((day) => `<div><span>${escapeHtml(day)}</span><strong>${dayCount(day)}</strong><small>pessoa(s)</small></div>`).join('') : '<p class="empty-state">Nenhum dia configurado.</p>';
  const shirtGrid = shirtRows.length ? shirtRows.map(([size, count]) => `<div><span>${escapeHtml(size)}</span><strong>${count}</strong><small>camiseta(s)</small></div>`).join('') : '<p class="empty-state">Nenhum tamanho informado.</p>';
  const healthRows = (students, field, fallback) => students.length ? `<div class="student-health-list">${students.map((student) => `<div><strong>${escapeHtml(student.nome || 'Sem nome')}</strong><span>${escapeHtml(String(student[field] || '').trim() || fallback)}</span></div>`).join('')}</div>` : '<p class="empty-state">Nenhum cursista informado.</p>';
  const preferenceRows = (rows, fallback) => rows.length ? `<div class="student-health-list">${rows.map((row) => `<div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.detail)}</span></div>`).join('')}</div>` : `<p class="empty-state">${fallback}</p>`;
  layout(`<section class="dashboard-hero"><div class="hero-cross" aria-hidden="true"></div><h1>${active ? escapeHtml(active.nome) : 'Retiro em foco'}</h1><p>${active ? `${dateRange(active.dataInicio, active.dataTermino)}${active.local ? ` · ${escapeHtml(active.local)}` : ''}` : 'Crie ou publique um retiro para acompanhar as estatísticas.'}</p><div class="gold-divider" aria-hidden="true"></div></section>
    <section class="metric-grid dashboard-metrics">
      <article class="metric-card static-metric"><span>Cursistas</span><strong>${activeStudents.length}</strong><small>pessoa(s)</small></article>
      <article class="metric-card static-metric"><span>Equipe de trabalho</span><strong>${activeEnrolments.length}</strong><small>pessoa(s) validada(s)</small></article>
      <article class="metric-card static-metric"><span>Fichas da equipe de trabalho aguardando validação</span><strong>${pendingEntries.length}</strong><small>ficha(s)</small></article>
    </section>
    <section class="student-health-grid" aria-label="Cuidados de saúde dos cursistas">
      <article class="student-health-card"><div><span>Cursistas com Intolerância a alimentos</span><strong>${intoleranceStudents.length}</strong></div><button type="button" data-home-health="intolerance">Visualizar</button></article>
      <article class="student-health-card"><div><span>Cursistas Alérgicos a Medicamentos</span><strong>${allergyStudents.length}</strong></div><button type="button" data-home-health="allergy">Visualizar</button></article>
      <article class="student-health-card"><div><span>Quadrante impresso Equipe de trabalho</span><strong>${quadranteRows.length}</strong></div><button type="button" data-home-health="quadrante">Visualizar</button></article>
      <article class="student-health-card"><div><span>Fotos solicitadas pela equipe de trabalho</span><strong>${photoRows.length}</strong></div><button type="button" data-home-health="photo">Visualizar</button></article>
    </section>
    <section class="dashboard-grid retreat-stats-grid">
      <article class="panel dashboard-panel shirt-stat-panel"><div class="panel-heading"><div><h2>Camisetas dos cursistas</h2><p>Quantidade por tamanho informado na ficha do cursista.</p></div></div><div class="stat-tile-grid shirt-stat-grid">${shirtGrid}</div></article>
      <article class="panel dashboard-panel presence-stat-panel"><div class="panel-heading"><div><h2>Presença por dia</h2><p>Cursistas + equipe de trabalho prevista em cada dia.</p></div></div><div class="stat-tile-grid presence-stat-grid">${dayRows}</div></article>
      <article class="panel dashboard-panel sector-stat-panel"><div class="panel-heading"><div><h2>Pessoas por setor</h2><p>Equipe de trabalho validada por setor.</p></div></div><div class="sector-simple-list">${sectorRows}</div></article>
    </section>
    <footer class="dashboard-blessing">Deus seja louvado!</footer>`, 'inicio');
  setupHomeStatTabs();
  const healthContent = {
    intolerance: `<div class="panel-heading"><div><h2>Cursistas com Intolerância a alimentos</h2><p>Nome do cursista e alimento informado na ficha.</p></div></div>${healthRows(intoleranceStudents, 'qualIntolerancia', 'Intolerância não detalhada')}`,
    allergy: `<div class="panel-heading"><div><h2>Cursistas Alérgicos a Medicamentos</h2><p>Nome do cursista e medicamento informado na ficha.</p></div></div>${healthRows(allergyStudents, 'qualAlergia', 'Medicamento não detalhado')}`,
    quadrante: `<div class="panel-heading"><div><h2>Quadrante impresso Equipe de trabalho</h2><p>Inscrições da equipe que responderam Sim. Casais aparecem juntos e contam como uma ficha.</p></div></div>${preferenceRows(quadranteRows, 'Nenhuma inscrição solicitou quadrante impresso.')}`,
    photo: `<div class="panel-heading"><div><h2>Fotos solicitadas pela equipe de trabalho</h2><p>Inscrições da equipe que pediram foto. Casais aparecem juntos e contam como uma foto.</p></div></div>${preferenceRows(photoRows, 'Nenhuma inscrição solicitou foto.')}`,
  };
  app.querySelectorAll('[data-home-health]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.homeHealth;
      openHomeInfoWindow(button.closest('.student-health-card')?.querySelector('span')?.textContent || 'Cursistas', healthContent[key] || '');
    });
  });
}

async function renderRetiros() {
  layout(`<section class="page-heading"><div><p class="eyebrow">Configuração de eventos</p><h1>Retiros</h1><p>Cada retiro possui sua própria estrutura, voluntários e histórico.</p></div><a class="primary-button" href="#retiros/novo">+ Novo retiro</a></section>
  <section class="retreat-list">${retreats.length ? retreats.map((retreat) => `<a class="retreat-card" href="#retiros/${retreat.id}"><div><span class="status ${retreat.status}">${statusLabel(retreat.status)}</span><h2>${escapeHtml(retreat.nome)}</h2><p>${dateRange(retreat.dataInicio, retreat.dataTermino)}${retreat.local ? ` · ${escapeHtml(retreat.local)}` : ''}</p></div><div class="retreat-card-meta"><strong>${validatedEnrolments(enrolments.filter((item) => item.retiroId === retreat.id)).length}</strong><span>voluntários</span></div><span class="arrow">→</span></a>`).join('') : '<div class="empty-state">Nenhum retiro criado. Comece configurando o próximo evento.</div>'}</section>`, 'retiros');
}

const sectorOptionHtml = (sector, selected = false, publicSelected = false) => `<div class="sector-option" data-sector-option="${escapeHtml(sector)}"><label><input type="checkbox" name="setores" value="${escapeHtml(sector)}" ${selected ? 'checked' : ''}> <span data-sector-name>${escapeHtml(sector)}</span></label><label class="sector-public-option"><input type="checkbox" name="setoresPublicos" value="${escapeHtml(sector)}" ${publicSelected ? 'checked' : ''}> Público</label><div class="sector-actions"><button type="button" data-edit-sector title="Editar setor" aria-label="Editar ${escapeHtml(sector)}">✎</button><button type="button" data-delete-sector title="Excluir setor" aria-label="Excluir ${escapeHtml(sector)}">🗑</button></div></div>`;

function sectorGroups(sectors, selectedSectors = sectors, publicSectors = sectors) {
  const selected = new Set(selectedSectors.map(normalizeText));
  const publicSelected = new Set(publicSectors.map(normalizeText));
  const group = (area, title) => `<section class="sector-area"><h3>${title}</h3><div class="sector-checks" data-area="${area}">${sortSectors(sectors.filter((sector) => sectorArea(sector) === area)).map((sector) => sectorOptionHtml(sector, selected.has(normalizeText(sector)), publicSelected.has(normalizeText(sector)))).join('')}</div></section>`;
  return `${group('escondida', 'Equipe escondida')}${group('sala', 'Equipe Sala')}`;
}

function quadranteOrderList(sectors = [], order = []) {
  const active = [...new Set([...order.filter((sector) => sectors.includes(sector)), ...sectors])];
  return `<div class="quadrante-order-list">${active.map((sector) => `<div class="quadrante-order-row" draggable="true" data-sector="${escapeHtml(sector)}"><input type="hidden" name="ordemQuadrante" value="${escapeHtml(sector)}"><span class="drag-handle" aria-hidden="true">↕</span><span>${escapeHtml(sector)}</span></div>`).join('')}</div>`;
}

const quadranteOrderForSectors = (sectors = [], savedOrder = []) => {
  const baseOrder = savedOrder.length ? savedOrder : retreatDefaults.setores;
  return [...new Set([...baseOrder.filter((sector) => sectors.includes(sector)), ...sortSectors(sectors.filter((sector) => !baseOrder.includes(sector)))])];
};

const knownSectors = (extra = []) => uniqueSectors([...standardSectors(), ...extra]);
function structureOptions(retreat) {
  const sectors = knownSectors(retreat?.setores || []);
  const selected = retreat ? retreat.setores : retreatDefaults.setores;
  return sectorGroups(sectors, selected, retreat?.setoresPublicos ?? selected);
}

function wirePublicSectorToggles(form) {
  const sync = (sectorInput) => { const publicInput = sectorInput.closest('.sector-option')?.querySelector('input[name="setoresPublicos"]'); if (!publicInput) return; if (!sectorInput.checked) { publicInput.checked = false; publicInput.disabled = true; } else publicInput.disabled = false; };
  form.addEventListener('change', (event) => { if (event.target.name === 'setores') sync(event.target); });
  form.querySelectorAll('input[name="setores"]').forEach(sync);
}

function setupQuadranteOrderEditor(form, initialOrder = []) {
  const container = form.querySelector('[data-quadrante-order]');
  if (!container) return;
  let currentOrder = [...initialOrder];
  let draggedSector = null;
  const orderSectors = () => form.querySelectorAll('input[name="setores"]');
  const syncFromRows = () => { currentOrder = [...container.querySelectorAll('.quadrante-order-row')].map((row) => row.dataset.sector); };
  const render = () => {
    const sectors = [...orderSectors()].map((input) => input.value);
    currentOrder = [...new Set([...currentOrder.filter((sector) => sectors.includes(sector)), ...sectors])];
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
    const target = event.target.closest('.quadrante-order-row');
    const dragged = container.querySelector('.is-dragging');
    if (!target || !dragged || target === dragged) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const afterTarget = event.clientY > rect.top + rect.height / 2;
    target.parentNode.insertBefore(dragged, afterTarget ? target.nextSibling : target);
  });
  container.addEventListener('drop', (event) => {
    if (!draggedSector) return;
    event.preventDefault();
    syncFromRows();
  });
  container.addEventListener('dragend', () => {
    container.querySelectorAll('.is-dragging').forEach((row) => row.classList.remove('is-dragging'));
    draggedSector = null;
    syncFromRows();
  });
  form.addEventListener('change', (event) => { if (event.target.name === 'setores') render(); });
  form.addEventListener('sectors:updated', (event) => { if (event.detail?.order) currentOrder = [...event.detail.order]; render(); });
  render();
}

function setupSectorManagement(form, retreatId = null) {
  form._sectorRenames = new Map();
  const sectorIsUsed = (sector) => retreatId && enrolments.some((entry) => entry.retiroId === retreatId && entryHasSector(entry, sector));
  const refreshQuadranteOrder = () => form.querySelector('input[name="setores"]')?.dispatchEvent(new Event('change', { bubbles: true }));
  const renameSectorInOrder = (oldName, newName) => {
    form.querySelectorAll('input[name="ordemQuadrante"]').forEach((input) => { if (input.value === oldName) input.value = newName; });
    form.querySelectorAll('.quadrante-order-row').forEach((row) => {
      if (row.dataset.sector !== oldName) return;
      row.dataset.sector = newName;
      row.querySelector('span:last-child').textContent = newName;
    });
  };
  form.addEventListener('click', (event) => {
    const row = event.target.closest('.sector-option');
    if (!row) return;
    const sectorInput = row.querySelector('input[name="setores"]');
    const publicInput = row.querySelector('input[name="setoresPublicos"]');
    const currentName = sectorInput.value;
    if (event.target.closest('[data-edit-sector]')) {
      const nextName = prompt('Novo nome do setor:', currentName)?.trim();
      if (!nextName || nextName === currentName) return;
      const exists = [...form.querySelectorAll('input[name="setores"]')].some((input) => input !== sectorInput && normalizeText(input.value) === normalizeText(nextName));
      if (exists) { alert('Já existe um setor com esse nome.'); return; }
      const originalName = [...form._sectorRenames.entries()].find(([, value]) => value === currentName)?.[0] || currentName;
      form._sectorRenames.set(originalName, nextName);
      renameStandardSector(currentName, nextName);
      sectorInput.value = nextName;
      publicInput.value = nextName;
      row.dataset.sectorOption = nextName;
      row.querySelector('[data-sector-name]').textContent = nextName;
      renameSectorInOrder(currentName, nextName);
      refreshQuadranteOrder();
    }
    if (event.target.closest('[data-delete-sector]')) {
      if (sectorIsUsed(currentName)) { alert('Este setor possui pessoas cadastradas neste retiro. Remova ou transfira essas pessoas antes de excluir o setor.'); return; }
      if (!confirm(`Excluir o setor "${currentName}" desta lista?`)) return;
      deleteStandardSector(currentName);
      row.remove();
      form.querySelectorAll('input[name="ordemQuadrante"]').forEach((input) => { if (input.value === currentName) input.closest('.quadrante-order-row')?.remove(); });
      refreshQuadranteOrder();
    }
  });
}

function setupCustomSector(form) {
  const input = form.querySelector('[data-new-sector]');
  const button = form.querySelector('[data-add-sector]');
  const addSector = () => {
    const list = form.querySelector('.sector-checks[data-area="sala"]');
    const sector = input.value.trim();
    if (!sector) { input.focus(); return; }
    const normalized = sector.toLocaleLowerCase('pt-BR');
    const exists = [...list.querySelectorAll('input[name="setores"]')].some((item) => item.value.toLocaleLowerCase('pt-BR') === normalized);
    if (exists) { input.setCustomValidity('Este setor já está na lista.'); input.reportValidity(); input.setCustomValidity(''); return; }
    list.insertAdjacentHTML('beforeend', sectorOptionHtml(sector, true, true));
    addStandardSector(sector);
    const checkbox = list.querySelector(`.sector-option:last-child input[name="setores"]`);
    [...list.querySelectorAll('.sector-option')]
      .sort((first, second) => first.querySelector('input[name="setores"]').value.localeCompare(second.querySelector('input[name="setores"]').value, 'pt-BR', { sensitivity: 'base' }))
      .forEach((item) => list.append(item));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new CustomEvent('sectors:updated', { bubbles: true }));
    input.value = '';
    input.focus();
  };
  button.addEventListener('click', addSector);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addSector(); } });
}

async function renderNewRetreat() {
  layout(`<section class="page-heading compact"><div><p class="eyebrow">Novo evento</p><h1>Criar retiro</h1><p>Os voluntários começam sempre vazios. Você só pode reaproveitar a estrutura.</p></div><a class="text-link" href="#retiros">← Voltar</a></section>
  <form id="retreat-form" class="panel editor-form"><div class="fields two-columns"><label class="field full"><span>Nome do retiro <b>*</b></span><input name="nome" required placeholder="Ex.: Retiro de Casais 2027"></label><label class="field"><span>Data de início</span><input name="dataInicio" type="date"></label><label class="field"><span>Data de término</span><input name="dataTermino" type="date"></label><label class="field"><span>Local</span><input name="local" placeholder="Ex.: Casa de Retiros"></label><label class="field"><span>Coordenação geral</span><input name="coordenacaoGeral" placeholder="Nome(s) responsável(is)"></label><label class="field"><span>Coordenação do retiro</span><input name="coordenacaoRetiro" placeholder="Nome(s) responsável(is)"></label><div class="fields three-columns retreat-value-fields full"><label class="field"><span>Inscrição do cursista</span><input name="valorInscricaoCursista" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Inscrição do voluntário</span><input name="valorInscricaoVoluntario" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label><label class="field"><span>Valor da foto</span><input name="valorFoto" type="text" inputmode="decimal" data-currency-input placeholder="R$ 0,00"></label></div></div>
  <fieldset><legend>Estrutura inicial</legend><p class="hint">A opção abaixo copia setores e opções, mas nunca os voluntários cadastrados.</p><div class="source-options"><label class="source-option"><input type="radio" name="origem" value="vazio" checked> Começar com a estrutura padrão</label>${retreats.map((retreat) => `<label class="source-option"><input type="radio" name="origem" value="${retreat.id}"> Usar a estrutura de <b>${escapeHtml(retreat.nome)}</b></label>`).join('')}</div></fieldset>
  <fieldset><legend>Setores de trabalho</legend><p class="hint">Marque <b>Público</b> somente nos setores que podem aparecer no link de cadastro. Os demais ficam disponíveis apenas em acesso restrito.</p><div class="sector-groups" id="sector-checks">${structureOptions()}</div><div class="add-sector"><input data-new-sector placeholder="Nome de um novo setor"><button type="button" data-add-sector>+ Adicionar setor</button></div></fieldset><fieldset><legend>Ordem dos setores no quadrante</legend><p class="hint">Esta ordem será usada apenas no Quadrante e na impressão. Ela não altera os cadastros, filtros ou listas de setores.</p><div data-quadrante-order></div></fieldset><div class="form-actions"><p>O retiro ficará salvo como <b>Em preparação</b>.</p><button type="submit">Criar retiro <span>→</span></button></div></form>`, 'retiros');
  const form = app.querySelector('#retreat-form');
  wireCurrencyInputs(form);
  wirePublicSectorToggles(form);
  setupSectorManagement(form);
  const originInputs = form.querySelectorAll('input[name="origem"]');
  originInputs.forEach((input) => input.addEventListener('change', () => {
    const source = retreats.find((retreat) => retreat.id === input.value);
    app.querySelector('#sector-checks').innerHTML = structureOptions(source);
    wirePublicSectorToggles(form);
    form.dispatchEvent(new CustomEvent('sectors:updated', { bubbles: true, detail: { order: source?.ordemQuadrante || retreatDefaults.setores } }));
  }));
  setupCustomSector(form);
  setupQuadranteOrderEditor(form, quadranteOrderForSectors(knownSectors(retreatDefaults.setores), retreatDefaults.setores));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Salvando...';
    try {
      const values = new FormData(form);
      const selectedSectors = values.getAll('setores');
      const quadranteSectors = [...form.querySelectorAll('input[name="setores"]')].map((input) => input.value);
      if (!selectedSectors.length) { alert('Selecione ao menos um setor de trabalho.'); submitButton.disabled = false; submitButton.innerHTML = 'Criar retiro <span>→</span>'; return; }
      if (values.get('dataInicio') && values.get('dataTermino') && values.get('dataTermino') < values.get('dataInicio')) { alert('A data de término deve ser igual ou posterior à data de início.'); submitButton.disabled = false; submitButton.innerHTML = 'Criar retiro <span>→</span>'; return; }
      const serviceDays = retreatDaysFromDates(values.get('dataInicio'), values.get('dataTermino'));
      const sortedSectors = sortSectors(selectedSectors);
      const retreat = { id: crypto.randomUUID(), nome: values.get('nome').trim(), dataInicio: values.get('dataInicio'), dataTermino: values.get('dataTermino'), local: values.get('local').trim(), coordenacaoGeral: String(values.get('coordenacaoGeral') || '').trim(), coordenacaoRetiro: String(values.get('coordenacaoRetiro') || '').trim(), valorInscricaoCursista: parseCurrency(values.get('valorInscricaoCursista')), valorInscricaoVoluntario: parseCurrency(values.get('valorInscricaoVoluntario')), valorFoto: parseCurrency(values.get('valorFoto')), setores: sortedSectors, setoresPublicos: sortSectors(values.getAll('setoresPublicos').filter((sector) => selectedSectors.includes(sector))), ordemQuadrante: quadranteOrderForSectors(quadranteSectors, values.getAll('ordemQuadrante')), dias: serviceDays.length ? serviceDays : [...retreatDefaults.dias], contribuicoes: [...retreatDefaults.contribuicoes], linksSetores: syncSectorLinks({}, sortedSectors), status: 'preparacao', createdAt: new Date().toISOString() };
      await dataService.saveRetiro(retreat);
      if (values.get('origem') && values.get('origem') !== 'vazio') await copyBadgeProfilesToRetreat(values.get('origem'), retreat.id);
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
  const canDeleteRetreat = canAccess('retiros.excluir');
  const registeredStudents = (await dataService.listCursistas()).filter((student) => student.retiroId === id);
  const retreatEnrolments = validatedEnrolments(enrolments.filter((item) => item.retiroId === id));
  const publicUrl = `${location.origin}/adesao/${encodeURIComponent(id)}`;
  const storedSectorLinks = retreat.linksSetores || retreat.setorLinks || [];
  const sectorLinks = storedSectorLinks.length || !canAccess('retiros.editar') ? storedSectorLinks : await ensureSectorLinks(retreat);
  const serviceDays = retreatServiceDays(retreat);
  const participantPeople = retreatEnrolments.map((entry) => people.find((person) => person.id === entry.pessoaId)).filter(Boolean);
  const ages = [...participantPeople, ...registeredStudents].map((person) => ageFromBirth(person.nascimento)).filter((age) => age !== null);
  const averageAge = ages.length ? `${(ages.reduce((sum, age) => sum + age, 0) / ages.length).toFixed(1).replace('.', ',')} anos` : 'Sem dados';
  const retreatCoordinators = retreatEnrolments.filter((entry) => entryHasSector(entry, 'Coordenação do retiro')).map((entry) => entry.nome);
  const sectorCount = (sector) => retreatEnrolments.filter((entry) => entryHasSector(entry, sector)).length;
  const dayCount = (day) => retreatEnrolments.filter((entry) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).some((item) => normalizeText(item) === normalizeText(day))).length + registeredStudents.length;
  const spaceKids = retreatEnrolments.flatMap((entry) => {
    const responsible = people.find((person) => person.id === entry.pessoaId) || entry.dadosPessoais || {};
    return (entry.espacoKids || []).map((kid) => ({ ...kid, volunteer: entry.nome, contact: responsible.telefone || '', sectors: entry.setores || [] }));
  });
  const shirtCounts = registeredStudents.reduce((counts, student) => { const size = String(student.camiseta || '').trim(); if (size) counts[size] = (counts[size] || 0) + 1; return counts; }, {});
  const shirtOrder = ['P', 'M', 'G', 'GG'];
  const shirtRows = Object.entries(shirtCounts).sort(([first], [second]) => { const firstIndex = shirtOrder.indexOf(first); const secondIndex = shirtOrder.indexOf(second); if (firstIndex !== -1 || secondIndex !== -1) return (firstIndex === -1 ? 99 : firstIndex) - (secondIndex === -1 ? 99 : secondIndex); return first.localeCompare(second, 'pt-BR', { numeric: true, sensitivity: 'base' }); });
  const sortedParticipants = [...retreatEnrolments].sort((first, second) => {
    const value = participantSort.key === 'setor' ? first.setores.join(', ') : first.nome;
    const otherValue = participantSort.key === 'setor' ? second.setores.join(', ') : second.nome;
    const result = String(value).localeCompare(String(otherValue), 'pt-BR', { sensitivity: 'base' });
    return participantSort.direction === 'asc' ? result : -result;
  });
  const sortIndicator = (key) => participantSort.key === key ? (participantSort.direction === 'asc' ? '↑' : '↓') : '↕';
  layout(`<section class="page-heading compact"><div><a class="back-link" href="#retiros">← Retiros</a><p class="eyebrow">${statusLabel(retreat.status)}</p><h1>${escapeHtml(retreat.nome)}</h1><p>${dateRange(retreat.dataInicio, retreat.dataTermino)}${retreat.local ? ` · ${escapeHtml(retreat.local)}` : ''}</p></div><div class="detail-actions"><a class="secondary-button" href="#retiros/${retreat.id}/editar">Editar configuração</a><button class="primary-button" id="publish-retreat">${retreat.status === 'publicado' ? 'Retiro publicado' : 'Publicar link'}</button></div></section>
    <section class="statistics-panel panel"><div class="panel-heading"><div><h2>Estatísticas do retiro</h2><p>Resumo dos voluntários registrados para este evento.</p></div></div><div class="statistics-grid"><div><span>Total equipe de trabalho</span><strong>${retreatEnrolments.length} <small>Pessoa(s)</small></strong></div><div><span>Total de cursistas</span><strong>${registeredStudents.length} <small>Pessoa(s)</small></strong></div><div><span>Idade média</span><strong>${averageAge}</strong></div></div><h3 class="day-presence-heading">Presença prevista por dia</h3><div class="day-presence-grid">${serviceDays.map((day) => `<div><span>${escapeHtml(day)}</span><strong>${dayCount(day)} <small>pessoa(s)</small></strong></div>`).join('')}</div><h3 class="day-presence-heading">Camisetas dos cursistas</h3><div class="shirt-size-grid">${shirtRows.length ? shirtRows.map(([size, count]) => `<div><span>${escapeHtml(size)}</span><strong>${count} <small>camiseta(s)</small></strong></div>`).join('') : '<p class="empty-state">Nenhum tamanho informado.</p>'}</div></section>
    <section class="detail-grid"><article class="panel"><h2>Estrutura</h2><p class="hint">${retreat.setores.length} setores configurados; nenhum voluntário é trazido de outro retiro.</p><div class="structure-summary"><div><strong>Equipe escondida</strong><div class="sector-tags">${sortSectors(retreat.setores.filter((sector) => sectorArea(sector) === 'escondida')).map((sector) => sectorCount(sector) ? `<button type="button" data-sector-participants="${escapeHtml(sector)}">${escapeHtml(sector)} <b>${sectorCount(sector)}</b></button>` : `<span>${escapeHtml(sector)} <b>0</b></span>`).join('') || '<em>Nenhum setor</em>'}<button type="button" id="view-space-kids">Crianças Espaço Kids <b>${spaceKids.length}</b></button></div></div><div><strong>Equipe Sala</strong><div class="sector-tags">${sortSectors(retreat.setores.filter((sector) => sectorArea(sector) === 'sala')).map((sector) => sectorCount(sector) ? `<button type="button" data-sector-participants="${escapeHtml(sector)}">${escapeHtml(sector)} <b>${sectorCount(sector)}</b></button>` : `<span>${escapeHtml(sector)} <b>0</b></span>`).join('') || '<em>Nenhum setor</em>'}</div></div></div></article><article class="panel"><h2>Link de cadastro</h2><p class="hint">Envie este link somente após publicar o retiro.</p><div class="copy-field"><input readonly value="${publicUrl}"><button id="copy-link" type="button">Copiar</button></div></article></section>
    <section class="participants-panel panel"><button class="participants-toggle" id="toggle-participants" type="button">${participantsVisible ? 'Fechar visualização dos participantes' : 'Visualizar participantes'}</button>${participantsVisible ? `<div class="participants-content"><h3 class="participants-heading">Participantes</h3><div class="participants-column-heading"><button type="button" data-participant-sort="nome">Nome <span>${sortIndicator('nome')}</span></button><button type="button" data-participant-sort="setor">Setor de trabalho <span>${sortIndicator('setor')}</span></button></div><div class="participants-scroll">${retreatEnrolments.length ? sortedParticipants.map((entry) => `<a href="#pessoas/${entry.pessoaId}/${id}"><strong>${escapeHtml(entry.nome)}</strong><span>${escapeHtml(entry.setores.join(', '))}</span></a>`).join('') : '<p>Nenhum voluntário registrado.</p>'}</div></div>` : ''}</section>
    `, 'retiros');
  if (canDeleteRetreat) {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-retreat';
    deleteButton.id = 'delete-retreat';
    deleteButton.type = 'button';
    deleteButton.textContent = 'Excluir retiro';
    app.querySelector('.detail-actions')?.append(deleteButton);
  }
  if (sectorLinks.length) {
    const sectorLinksPanel = document.createElement('article');
    sectorLinksPanel.className = 'panel sector-links-panel';
    sectorLinksPanel.innerHTML = `<h2>Links por setor</h2><p class="hint">Envie ao coordenador do setor para acompanhar os nomes inscritos naquela equipe.</p><div class="sector-link-list">${sectorLinks.map((link) => {
      const url = `${location.origin}/setor/${encodeURIComponent(id)}/${encodeURIComponent(link.token)}`;
      return `<div class="sector-link-row"><strong>${escapeHtml(link.setor)}</strong><div class="copy-field"><input readonly value="${escapeHtml(url)}"><button type="button" data-copy-sector-link="${escapeHtml(url)}">Copiar</button></div></div>`;
    }).join('')}</div>`;
    app.querySelector('.detail-grid')?.append(sectorLinksPanel);
  }
  if (!canAccess('retiros.editar')) app.querySelector(`a[href="#retiros/${retreat.id}/editar"]`)?.remove();
  if (!canAccess('retiros.publicar')) app.querySelector('#publish-retreat')?.remove();
  app.querySelector('#publish-retreat')?.addEventListener('click', async () => { if (retreat.status !== 'publicado') { retreat.status = 'publicado'; await dataService.saveRetiro(retreat); await loadData(); renderRetreat(id); } });
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
  app.querySelector('#copy-link').addEventListener('click', async () => { await navigator.clipboard.writeText(publicUrl); app.querySelector('#copy-link').textContent = 'Copiado!'; });
  app.querySelectorAll('[data-copy-sector-link]').forEach((button) => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.copySectorLink);
    button.textContent = 'Copiado!';
  }));
  app.querySelector('#toggle-participants').addEventListener('click', () => { participantsVisible = !participantsVisible; renderRetreat(id); });
  app.querySelectorAll('[data-participant-sort]').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.participantSort; participantSort = { key, direction: participantSort.key === key && participantSort.direction === 'asc' ? 'desc' : 'asc' }; renderRetreat(id); }));
  app.querySelector('#view-space-kids').addEventListener('click', () => { const overlay = document.createElement('section'); overlay.className = 'sector-participants-overlay'; overlay.innerHTML = `<div class="sector-participants-dialog"><div class="panel-heading"><div><p class="eyebrow">Espaço Kids</p><h2>Crianças cadastradas</h2><p>${spaceKids.length} criança(s) informada(s) para este retiro.</p></div></div><div class="kids-participants-list">${spaceKids.length ? spaceKids.map((kid) => `<div><strong>${escapeHtml(kid.nome)}</strong><span>${escapeHtml(ageInYearsAndMonths(kid.nascimento))}</span><small>Cadastrada por: ${escapeHtml(kid.volunteer)}${kid.contact ? ` · Contato: ${escapeHtml(kid.contact)}` : ' · Contato não informado'} · Setor: ${escapeHtml(kid.sectors?.join(', ') || 'Não informado')}</small></div>`).join('') : '<p>Nenhuma criança cadastrada.</p>'}</div><button type="button" class="close-sector-view">Fechar visualização</button></div>`; overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove()); app.append(overlay); });
  app.querySelectorAll('[data-sector-participants]').forEach((button) => button.addEventListener('click', () => {
    const sector = button.dataset.sectorParticipants;
    const selected = retreatEnrolments.filter((entry) => entryHasSector(entry, sector));
    const overlay = document.createElement('section');
    overlay.className = 'sector-participants-overlay';
    overlay.innerHTML = `<div class="sector-participants-dialog"><div class="panel-heading"><div><p class="eyebrow">Participantes do setor</p><h2>${escapeHtml(sector)}</h2><p>${selected.length} voluntário(s) neste retiro.</p></div></div><div class="sector-participants-list">${selected.map((entry) => `<a href="#pessoas/${entry.pessoaId}/${id}"><strong>${escapeHtml(entry.nome)}</strong><span>${escapeHtml(entry.dias.join(', '))}</span></a>`).join('')}</div><button type="button" class="close-sector-view">Fechar visualização</button></div>`;
    overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove());
    app.append(overlay);
  }));
}

async function renderEditRetreat(id) {
  const retreat = retreats.find((item) => item.id === id);
  if (!retreat) return renderRetiros();
  layout(`<section class="page-heading compact"><div><p class="eyebrow">Configuração do evento</p><h1>Editar retiro</h1><p>Estas alterações afetam somente este retiro, nunca o histórico dos anteriores.</p></div><a class="text-link" href="#retiros/${retreat.id}">← Voltar</a></section>
  <form id="edit-retreat-form" class="panel editor-form"><div class="fields two-columns"><label class="field full"><span>Nome do retiro <b>*</b></span><input name="nome" required value="${escapeHtml(retreat.nome)}"></label><label class="field"><span>Data de início</span><input name="dataInicio" type="date" value="${escapeHtml(retreat.dataInicio || '')}"></label><label class="field"><span>Data de término</span><input name="dataTermino" type="date" value="${escapeHtml(retreat.dataTermino || '')}"></label><label class="field"><span>Local</span><input name="local" value="${escapeHtml(retreat.local || '')}"></label><label class="field"><span>Coordenação geral</span><input name="coordenacaoGeral" value="${escapeHtml(retreat.coordenacaoGeral || '')}"></label><label class="field"><span>Coordenação do retiro</span><input name="coordenacaoRetiro" value="${escapeHtml(retreat.coordenacaoRetiro || '')}"></label><div class="fields three-columns retreat-value-fields full"><label class="field"><span>Inscrição do cursista</span><input name="valorInscricaoCursista" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorInscricaoCursista)}"></label><label class="field"><span>Inscrição do voluntário</span><input name="valorInscricaoVoluntario" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorInscricaoVoluntario)}"></label><label class="field"><span>Valor da foto</span><input name="valorFoto" type="text" inputmode="decimal" data-currency-input value="${currency(retreat.valorFoto ?? 10)}"></label></div></div>
  <fieldset><legend>Setores de trabalho</legend><p class="hint">Marque <b>Público</b> somente nos setores que podem aparecer no link de cadastro. Os demais ficam disponíveis apenas em acesso restrito.</p>${sectorGroups(knownSectors(retreat.setores), retreat.setores, retreat.setoresPublicos ?? retreat.setores)}<div class="add-sector"><input data-new-sector placeholder="Nome de um novo setor"><button type="button" data-add-sector>+ Adicionar setor</button></div></fieldset><fieldset><legend>Ordem dos setores no quadrante</legend><p class="hint">Esta ordem será usada apenas no Quadrante e na impressão. Ela não altera os cadastros, filtros ou listas de setores.</p><div data-quadrante-order></div></fieldset><div class="form-actions"><p>As alterações são salvas neste retiro.</p><button type="submit">Salvar alterações <span>→</span></button></div></form>`, 'retiros');
  const form = app.querySelector('#edit-retreat-form');
  wireCurrencyInputs(form);
  wirePublicSectorToggles(form);
  setupCustomSector(form);
  setupSectorManagement(form, retreat.id);
  setupQuadranteOrderEditor(form, quadranteOrderForSectors(knownSectors([...(retreat.setores || []), ...(retreat.ordemQuadrante || [])]), retreat.ordemQuadrante || []));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const selectedSectors = values.getAll('setores');
    const quadranteSectors = [...form.querySelectorAll('input[name="setores"]')].map((input) => input.value);
    if (!selectedSectors.length) { alert('Selecione ao menos um setor de trabalho.'); return; }
    if (values.get('dataInicio') && values.get('dataTermino') && values.get('dataTermino') < values.get('dataInicio')) { alert('A data de término deve ser igual ou posterior à data de início.'); return; }
    const serviceDays = values.get('dataInicio') && values.get('dataTermino') ? retreatDaysFromDates(values.get('dataInicio'), values.get('dataTermino')) : [];
    delete retreat.descontoParentesco;
    const sortedSectors = sortSectors(selectedSectors);
    Object.assign(retreat, { nome: values.get('nome').trim(), dataInicio: values.get('dataInicio'), dataTermino: values.get('dataTermino'), local: String(values.get('local') || '').trim(), coordenacaoGeral: String(values.get('coordenacaoGeral') || '').trim(), coordenacaoRetiro: String(values.get('coordenacaoRetiro') || '').trim(), valorInscricaoCursista: parseCurrency(values.get('valorInscricaoCursista')), valorInscricaoVoluntario: parseCurrency(values.get('valorInscricaoVoluntario')), valorFoto: parseCurrency(values.get('valorFoto')), setores: sortedSectors, setoresPublicos: sortSectors(values.getAll('setoresPublicos').filter((sector) => selectedSectors.includes(sector))), ordemQuadrante: quadranteOrderForSectors(quadranteSectors, values.getAll('ordemQuadrante')), dias: serviceDays.length ? serviceDays : (retreat.dias?.length ? retreat.dias : [...retreatDefaults.dias]), linksSetores: syncSectorLinks(retreat, sortedSectors), updatedAt: new Date().toISOString() });
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
function parseCurrency(value) { return Number(String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0; }
function volunteerContributionAmount(retreat = {}, entry = {}, amount = suggestedAmount(entry.contribuicao)) {
  const baseAmount = Number(retreat.valorInscricaoVoluntario) || 0;
  const photoAmount = normalizeText(entry.foto) === 'sim' ? Number(retreat.valorFoto ?? 10) || 0 : 0;
  if (entry.casalId) return (baseAmount * 2) + photoAmount;
  if (photoAmount) return amount && amount > baseAmount ? amount : baseAmount + photoAmount;
  return amount || baseAmount;
}
function wireCurrencyInputs(root) {
  root.querySelectorAll('[data-currency-input]').forEach((input) => {
    const formatValue = () => { input.value = currency(parseCurrency(input.value)); };
    input.addEventListener('focus', formatValue);
    input.addEventListener('change', formatValue);
  });
}
async function renderRecebedor() {
  const retreat = retreats.find((item) => item.status === 'publicado') || retreats.find((item) => item.status === 'preparacao');
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Financeiro do retiro</p><h1>Módulo Recebedor</h1><p>Publique ou crie um retiro para acompanhar as contribuições.</p></div></section>', 'recebedor'); return; }
  const students = (await dataService.listCursistas()).filter((student) => student.retiroId === retreat.id);
  const entries = [
    ...validatedEnrolments(enrolments.filter((entry) => entry.retiroId === retreat.id)).map((entry) => ({ ...entry, tipoFinanceiro: 'voluntario' })),
    ...students.map((student) => ({ ...student, setores: ['Cursista'], contribuicao: student.saldoPagar || student.valorInscricao || student.contribuicao || '', tipoFinanceiro: 'cursista' })),
  ];
  const effectiveSuggested = (entry) => {
    const amount = suggestedAmount(entry.contribuicao);
    if (amount) return entry.tipoFinanceiro === 'voluntario' ? volunteerContributionAmount(retreat, entry, amount) : amount;
    const spouse = entry.casalId && entries.find((item) => item.casalId === entry.casalId && item.id !== entry.id);
    const spouseAmount = suggestedAmount(spouse?.contribuicao);
    return entry.tipoFinanceiro === 'voluntario' ? volunteerContributionAmount(retreat, entry, spouseAmount) : spouseAmount;
  };
  const saveFinancialEntry = async (entry) => { if (entry.tipoFinanceiro === 'cursista') await dataService.saveCursista(entry); else await dataService.saveAdesao(entry); };
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const orderedCoupleEntries = (items) => [...items].sort((first, second) => {
    const firstMale = normalizeText(peopleById.get(first.pessoaId)?.genero) === 'masculino';
    const secondMale = normalizeText(peopleById.get(second.pessoaId)?.genero) === 'masculino';
    if (firstMale !== secondMale) return firstMale ? -1 : 1;
    return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
  });
  const receiverRows = [];
  const usedCouples = new Set();
  entries.forEach((entry) => {
    if (!entry.casalId || entry.tipoFinanceiro === 'cursista') { receiverRows.push({ id: entry.id, entries: [entry], nome: entry.nome, setores: entry.setores || [] }); return; }
    if (usedCouples.has(entry.casalId)) return;
    const couple = orderedCoupleEntries(entries.filter((item) => item.tipoFinanceiro === entry.tipoFinanceiro && item.casalId === entry.casalId));
    usedCouples.add(entry.casalId);
    receiverRows.push({ id: `casal-${entry.casalId}`, entries: couple, nome: couple.map((item) => item.nome).filter(Boolean).join(' e '), setores: uniqueSectors(couple.flatMap((item) => item.setores || [])) });
  });
  const rowSuggested = (row) => {
    const isCoupleRow = row.entries.some((entry) => entry.tipoFinanceiro === 'voluntario' && entry.casalId);
    if (isCoupleRow) {
      const values = row.entries.map(effectiveSuggested).filter((value) => value > 0);
      const configuredTotal = (Number(retreat.valorInscricaoVoluntario) || 0) * 2;
      const informedValue = Math.max(...values, 0);
      if (configuredTotal || Number(retreat.valorFoto)) return volunteerContributionAmount(retreat, { casalId: row.id, foto: row.entries.some((entry) => normalizeText(entry.foto) === 'sim') ? 'Sim' : 'Não' }, informedValue);
      return configuredTotal && informedValue >= configuredTotal ? informedValue : informedValue * 2;
    }
    return row.entries.reduce((sum, entry) => sum + effectiveSuggested(entry), 0);
  };
  const rowPaid = (row) => row.entries.reduce((sum, entry) => sum + (Number(entry.valorPago) || 0), 0);
  const rowPaidStatus = (row) => row.entries.every((entry) => entry.taxaPaga);
  const rowHasSector = (row, sector) => row.entries.some((entry) => entryHasSector(entry, sector));
  const values = (row, key) => ({ nome: row.nome, setor: row.setores.join(', '), sugerido: rowSuggested(row), pago: rowPaid(row), taxa: rowPaidStatus(row) ? 1 : 0 })[key];
  const paidCount = receiverRows.filter(rowPaidStatus).length;
  const totalPaid = receiverRows.reduce((sum, row) => sum + (rowPaidStatus(row) ? rowPaid(row) : 0), 0);
  const paidSuggested = receiverRows.reduce((sum, row) => sum + (rowPaidStatus(row) ? rowSuggested(row) : 0), 0);
  const balance = totalPaid - paidSuggested;
  const remaining = receiverRows.reduce((sum, row) => sum + (rowPaidStatus(row) ? 0 : rowSuggested(row)), 0);
  const rows = [...receiverRows].sort((first, second) => { const result = String(values(first, receiverSort.key)).localeCompare(String(values(second, receiverSort.key)), 'pt-BR', { numeric: true, sensitivity: 'base' }); return receiverSort.direction === 'asc' ? result : -result; });
  const indicator = (key) => receiverSort.key === key ? (receiverSort.direction === 'asc' ? '↑' : '↓') : '↕';
  layout(`<section class="page-heading"><div><p class="eyebrow">Financeiro do retiro</p><h1>Módulo Recebedor</h1><p>${escapeHtml(retreat.nome)} · Registre as contribuições recebidas.</p></div></section><section class="receiver-summary"><article><span>Já contribuíram</span><strong>${paidCount}</strong><small>registro(s)</small></article><article><span>Falta contribuir</span><strong>${receiverRows.length - paidCount}</strong><small>registro(s)</small></article><article><span>Total das contribuições</span><strong>${currency(totalPaid)}</strong></article><article><span>Valor a receber</span><strong>${currency(remaining)}</strong></article><article><span>Saldo</span><strong>${currency(balance)}</strong></article></section><section class="panel receiver-panel"><div class="receiver-table"><div class="receiver-head"><button data-receiver-sort="nome">Nome completo <span>${indicator('nome')}</span></button><button data-receiver-sort="setor">Setor <span>${indicator('setor')}</span></button><button data-receiver-sort="sugerido">Valor sugerido <span>${indicator('sugerido')}</span></button><button data-receiver-sort="pago">Valor pago <span>${indicator('pago')}</span></button><button data-receiver-sort="taxa">Contribuição <span>${indicator('taxa')}</span></button></div>${rows.length ? rows.map((row) => `<div class="receiver-row"><strong>${escapeHtml(row.nome)}</strong><span>${escapeHtml(row.setores.join(', '))}</span><span>${currency(rowSuggested(row))}</span><input data-paid-entry="${row.id}" type="text" inputmode="decimal" value="${currency(rowPaid(row))}" ${rowPaidStatus(row) ? 'disabled' : ''} aria-label="Valor pago de ${escapeHtml(row.nome)}"><label class="payment-check"><input data-fee-entry="${row.id}" type="checkbox" ${rowPaidStatus(row) ? 'checked' : ''}><span>Pago</span></label></div>`).join('') : '<p class="empty-state">Nenhum voluntário para este retiro.</p>'}</div></section>`, 'recebedor');
  const viewOptions = document.createElement('div');
  viewOptions.className = 'receiver-view-options';
  viewOptions.innerHTML = '<button type="button" id="receiver-by-sector">Buscar setor</button>';
  app.querySelector('.receiver-summary').insertAdjacentElement('afterend', viewOptions);
  if (balance < 0) app.querySelector('.receiver-summary article:last-child').classList.add('is-negative');
  if (receiverFocusSector) { const firstIndex = rows.findIndex((row) => rowHasSector(row, receiverFocusSector)); const row = app.querySelectorAll('.receiver-row')[firstIndex]; if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' }); receiverFocusSector = null; }
  app.querySelector('#receiver-by-sector').addEventListener('click', () => {
    const sectors = [...new Set(receiverRows.flatMap((row) => row.setores))].sort((first, second) => first.localeCompare(second, 'pt-BR'));
    const overlay = document.createElement('section'); overlay.className = 'receiver-sector-overlay';
    const renderSectorList = () => { overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Recebedor por setor</p><h2>Escolha um setor</h2><p>A planilha será ordenada e posicionada no primeiro registro do setor.</p></div></div><div class="receiver-sector-list">${sectors.map((sector) => `<button type="button" data-receiver-sector="${escapeHtml(sector)}"><strong>${escapeHtml(sector)}</strong><span>${receiverRows.filter((row) => rowHasSector(row, sector)).length} registro(s)</span></button>`).join('')}</div><button type="button" class="close-sector-view">Fechar visualização</button></div>`; overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove()); overlay.querySelectorAll('[data-receiver-sector]').forEach((button) => button.addEventListener('click', () => { receiverFocusSector = button.dataset.receiverSector; receiverSort = { key: 'setor', direction: 'asc' }; overlay.remove(); renderRecebedor(); })); };
    const renderSector = (sector) => { const sectorEntries = receiverRows.filter((row) => rowHasSector(row, sector)); overlay.innerHTML = `<div class="receiver-sector-dialog"><button type="button" class="receiver-sector-back">← Todos os setores</button><div class="panel-heading"><div><p class="eyebrow">Recebedor por setor</p><h2>${escapeHtml(sector)}</h2><p>${sectorEntries.length} registro(s) neste setor.</p></div></div><div class="receiver-sector-volunteers">${sectorEntries.map((row) => `<div><strong>${escapeHtml(row.nome)}</strong><span>Sugerido: ${currency(rowSuggested(row))} · Pago: ${rowPaidStatus(row) ? currency(rowPaid(row)) : 'Não pago'}</span><label>Anotações<input data-receiver-note="${row.id}" value="${escapeHtml(row.entries[0]?.recebedorObservacao || '')}" placeholder="Registrar observação"></label></div>`).join('')}</div><button type="button" class="close-sector-view">Fechar visualização</button></div>`; overlay.querySelector('.receiver-sector-back').addEventListener('click', renderSectorList); overlay.querySelector('.close-sector-view').addEventListener('click', () => overlay.remove()); overlay.querySelectorAll('[data-receiver-note]').forEach((input) => input.addEventListener('change', async () => { const row = receiverRows.find((item) => item.id === input.dataset.receiverNote); await Promise.all((row?.entries || []).map((entry) => { entry.recebedorObservacao = input.value.trim(); return saveFinancialEntry(entry); })); await loadData(); })); };
    renderSectorList(); app.append(overlay);
  });
  app.querySelectorAll('[data-receiver-sort]').forEach((button) => button.addEventListener('click', () => { const key = button.dataset.receiverSort; receiverSort = { key, direction: receiverSort.key === key && receiverSort.direction === 'asc' ? 'desc' : 'asc' }; renderRecebedor(); }));
  app.querySelectorAll('[data-paid-entry]').forEach((input) => { input.addEventListener('focus', () => { const row = receiverRows.find((item) => item.id === input.dataset.paidEntry); input.value = row ? rowPaid(row) || '' : ''; }); input.addEventListener('change', async () => { const row = receiverRows.find((item) => item.id === input.dataset.paidEntry); const total = parseCurrency(input.value); const suggestedTotal = rowSuggested(row); await Promise.all((row?.entries || []).map((entry) => { const suggested = effectiveSuggested(entry); entry.valorPago = suggestedTotal ? total * (suggested / suggestedTotal) : total / row.entries.length; return saveFinancialEntry(entry); })); input.value = currency(total); await loadData(); }); });
  app.querySelectorAll('[data-fee-entry]').forEach((input) => input.addEventListener('change', async () => { const row = receiverRows.find((item) => item.id === input.dataset.feeEntry); await Promise.all((row?.entries || []).map((entry) => { entry.taxaPaga = input.checked; if (input.checked && !entry.valorPago) entry.valorPago = effectiveSuggested(entry); if (!input.checked) entry.valorPago = 0; return saveFinancialEntry(entry); })); await loadData(); renderRecebedor(); }));
}
async function renderPessoas() { layout(`<section class="page-heading"><div><p class="eyebrow">Histórico reutilizável</p><h1>Pessoas</h1><p>Dados pessoais são reaproveitados; a participação é sempre nova em cada retiro.</p></div></section><section class="panel">${people.length ? `<div class="simple-list">${people.map((person) => `<div><strong>${escapeHtml(person.nome)}</strong><span>Nascimento: ${date(person.nascimento)} · ${escapeHtml(person.telefone || 'Sem telefone')}</span><small>${enrolments.filter((entry) => entry.pessoaId === person.id).length} retiro(s)</small></div>`).join('')}</div>` : '<div class="empty-state">O histórico de pessoas será formado quando chegarem os primeiros cadastros.</div>'}</section>`, 'pessoas'); }

async function renderValidacaoInscricoes() {
  const retreat = retreats.find((item) => item.status === 'publicado') || retreats.find((item) => item.status === 'preparacao');
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
  const validationGroups = [];
  const groupedCouples = new Set();
  retreatEntries.forEach((entry) => {
    if (entry.casalId) {
      const key = `${entry.retiroId}:${entry.casalId}`;
      if (groupedCouples.has(key)) return;
      groupedCouples.add(key);
      validationGroups.push(allRetreatEntries.filter((item) => item.casalId === entry.casalId).sort(byName));
      return;
    }
    validationGroups.push([entry]);
  });
  const groupValidated = (group) => group.every(isEnrolmentValidated);
  const pendingCount = validationGroups.filter((group) => !groupValidated(group)).length;
  const validatedCount = validationGroups.length - pendingCount;
  const validationGroupHtml = (group) => {
    const representative = group[0];
    const validated = groupValidated(group);
    const label = group.length > 1 ? 'Casal' : 'Individual';
    const peopleHtml = group.map((entry) => {
      const person = peopleById.get(entry.pessoaId);
      const cpf = normalizeCpf(person?.cpf || entry.pessoaId);
      return `<div class="validation-person"><div><strong>${escapeHtml(entry.nome || person?.nome || 'Sem nome')}</strong><span>${cpf ? formatCpf(cpf) : 'CPF n\u00e3o informado'} · ${escapeHtml((entry.setores || []).join(', ') || 'Sem setor')}</span><small class="personal-history-notice">${escapeHtml(personalHistoryNotice(entry))}</small></div><a href="#pessoas/${entry.pessoaId}/${entry.retiroId}/validacao-inscricoes">Consultar</a></div>`;
    }).join('');
    return `<article class="${group.length > 1 ? 'is-couple-validation' : ''}"><div class="validation-people"><small class="validation-group-label">${label}</small>${peopleHtml}</div><span class="validation-status ${validated ? 'is-valid' : 'is-pending'}">${validated ? 'Validada' : 'Pendente'}</span><div class="registration-actions"><button type="button" data-validate-entry="${representative.id}" ${validated ? 'disabled' : ''}>Validar</button></div></article>`;
  };
  layout(`<section class="page-heading"><div><p class="eyebrow">Equipe de trabalho</p><h1>Valida\u00e7\u00e3o das inscri\u00e7\u00f5es</h1><p>${escapeHtml(retreat.nome)} · Confira os cadastros recebidos antes de liberar nas estat\u00edsticas.</p></div></section><section class="receiver-summary validation-summary"><article><span>Pendentes</span><strong>${pendingCount}</strong><small>ficha(s)</small></article><article><span>Validadas</span><strong>${validatedCount}</strong><small>ficha(s)</small></article><article><span>Total recebido</span><strong>${validationGroups.length}</strong><small>ficha(s)</small></article></section><section class="panel validation-list">${validationGroups.length ? validationGroups.map(validationGroupHtml).join('') : '<p class="empty-state">Nenhuma inscrição da equipe foi recebida para este retiro.</p>'}</section>`, 'validacao-inscricoes');
  app.querySelectorAll('[data-validate-entry]').forEach((button) => button.addEventListener('click', async () => {
    const entry = enrolments.find((item) => item.id === button.dataset.validateEntry);
    if (!entry) return;
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
  const address = (item) => [[item.endereco, item.numero].filter(Boolean).join(', '), item.bairro, item.cidade, item.estado].filter(Boolean).join(' · ');
  layout(`<section class="page-heading compact"><div><a class="back-link" href="${backHref}">← Voltar</a><p class="eyebrow">${entry?.casalId ? 'Cadastro individual vinculado a casal' : 'Cadastro individual'}</p><h1>${escapeHtml(person.nome)}</h1><p>${retreat ? `Ficha enviada para ${escapeHtml(retreat.nome)}` : 'Cadastro no histórico'}</p></div></section><section class="panel"><h2>Dados pessoais</h2><div class="simple-list">${field('Nascimento', date(person.nascimento))}${field('Telefone', person.telefone)}${field('Endereço', address(person))}</div></section>${entry ? `<section class="panel"><h2>Participação neste retiro</h2><div class="simple-list">${field('Setor de trabalho', entry.setores.join(', '))}${field('Dias disponíveis', entry.dias.join(', '))}${field('Retiros que fez', entry.retirosAnteriores?.join(', '))}${field('Quadrante impresso', entry.quadrante)}${field('Foto', entry.foto)}${field('Contribuição', entry.contribuicao)}${field('Coordenação informada', entry.coordenacao)}${field('Observação', entry.observacao)}</div>${entry.espacoKids?.length ? `<h3 class="participants-heading">Espaço Kids</h3><div class="simple-list">${entry.espacoKids.map((kid) => field(kid.nome, date(kid.nascimento))).join('')}</div>` : ''}${spouse ? `<h3 class="participants-heading">Cônjuge neste retiro</h3><div class="simple-list"><div><strong>${escapeHtml(spouse.nome)}</strong><span>${escapeHtml(spouseEntry.setores.join(', '))}</span><a href="#pessoas/${spouse.id}/${entry.retiroId}${sourceSuffix}">Abrir ficha do cônjuge</a></div></div>` : ''}</section>` : ''}<section class="panel"><h2>Histórico de retiros</h2><div class="simple-list">${entries.map((item) => `<div><strong>${escapeHtml(retreats.find((retreat) => retreat.id === item.retiroId)?.nome || 'Retiro')}</strong><span>${escapeHtml(item.setores.join(', '))}</span></div>`).join('') || '<p class="empty-state">Sem participações registradas.</p>'}</div></section>${entry ? '<section class="panel"><div class="form-actions"><p>Esta ação remove o cadastro deste retiro.</p><button type="button" id="delete-consulted-registration" class="delete-registration">Excluir cadastro</button></div></section>' : ''}`, 'pessoas');
  app.querySelector('#delete-consulted-registration')?.addEventListener('click', async () => {
    if (!confirm(`Excluir o cadastro de ${entry.nome} deste retiro?`)) return;
    const entriesToDelete = [entry, spouseEntry].filter(Boolean);
    for (const entryToDelete of entriesToDelete) {
      await dataService.deleteAdesao(entryToDelete.id);
      const remaining = (await dataService.listAdesoes()).filter((item) => item.pessoaId === entryToDelete.pessoaId);
      if (!remaining.length) await dataService.deletePessoa(entryToDelete.pessoaId);
    }
    await loadData();
    location.hash = backHref;
  });
}
async function renderCursista() {
  const yesNo = (name) => choices(name, ['Sim', 'Não'], false);
  layout(`<section class="page-heading"><div><p class="eyebrow">Cadastro de participante</p><h1>Cursista</h1><p>Registre as informações necessárias para acolher e acompanhar o cursista.</p></div></section><section class="admin-registration-tools student-registration-tools panel"><div class="panel-heading"><div><p class="eyebrow">Cadastro de cursista</p><h2>Consultar cadastro</h2><p>Busque por nome, CPF ou telefone para editar ou consultar a ficha do retiro em foco.</p></div><button type="button" id="new-student">Incluir novo</button></div><label class="field registration-search-field"><span>Busca</span><input id="student-search" autocomplete="off" placeholder="Digite nome, CPF ou telefone"></label><div id="student-search-results" class="registration-search-results" hidden></div></section><form id="student-form" class="panel student-form">${stateDatalist()}<section class="form-section"><div class="section-heading"><span>01</span><div><h2>Dados pessoais</h2><p>Informações básicas de identificação e contato.</p></div></div><div class="fields two-columns"><label class="field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field full"><span>Nome completo <b>*</b></span><input name="nome" required></label><label class="field"><span>Data de nascimento <b>*</b></span><input name="nascimento" type="date" required></label><label class="field"><span>Telefone <b>*</b></span><input name="telefone" required></label></div></section><section class="form-section"><div class="section-heading"><span>02</span><div><h2>Endereço</h2></div></div><div class="fields address-fields"><label class="field"><span>CEP <b>*</b></span><input name="cep" inputmode="numeric" placeholder="00000-000" required></label><label class="field street-field"><span>Rua <b>*</b></span><input name="rua" required></label><label class="field number-field"><span>Número <b>*</b></span><input name="numero" required></label><label class="field"><span>Bairro <b>*</b></span><input name="bairro" required></label><label class="field"><span>Cidade <b>*</b></span><input name="cidade" required></label><label class="field"><span>Estado <b>*</b></span><input name="estado" maxlength="2" required></label></div></section><section class="form-section"><div class="section-heading"><span>03</span><div><h2>Formação e vivência</h2></div></div><div class="student-questions"><fieldset><legend>É batizado(a)? <b>*</b></legend>${yesNo('batizado')}</fieldset><fieldset><legend>Fez primeira comunhão? <b>*</b></legend>${yesNo('primeiraComunhao')}</fieldset><fieldset><legend>Estuda? <b>*</b></legend>${yesNo('estuda')}<div class="fields two-columns"><label class="field"><span>Série</span><input name="serie"></label><label class="field"><span>Escola</span><input name="escola"></label></div></fieldset><fieldset><legend>Fez algum retiro? <b>*</b></legend>${yesNo('fezRetiro')}<label class="field"><span>Qual?</span><input name="qualRetiro"></label></fieldset></div></section><section class="form-section"><div class="section-heading"><span>04</span><div><h2>Família e convite</h2></div></div><div class="fields two-columns"><label class="field"><span>Nome do pai</span><input name="nomePai"></label><label class="field"><span>Telefone de contato</span><input name="telefonePai"></label><label class="field"><span>Nome da mãe</span><input name="nomeMae"></label><label class="field"><span>Telefone de contato</span><input name="telefoneMae"></label></div><fieldset class="student-fieldset"><legend>Os pais participam de algum movimento na igreja? <b>*</b></legend>${yesNo('paisMovimento')}<label class="field"><span>Qual?</span><input name="qualMovimento"></label></fieldset><div class="fields"><label class="field"><span>Quem o(a) convidou?</span><input name="convidou"></label><fieldset class="student-fieldset full"><legend>Tamanho da camiseta <b>*</b></legend>${choices('camiseta', ['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4'], false)}</fieldset></div></section><section class="form-section"><div class="section-heading"><span>05</span><div><h2>Saúde e cuidados</h2></div></div><div class="student-questions"><fieldset><legend>Tem intolerância a alimentos? <b>*</b></legend>${yesNo('intoleranciaAlimentos')}<label class="field"><span>Qual?</span><input name="qualIntolerancia"></label></fieldset><fieldset><legend>É alérgico(a) a algum medicamento? <b>*</b></legend>${yesNo('alergiaMedicamento')}<label class="field"><span>Qual?</span><input name="qualAlergia"></label></fieldset></div><div class="fields two-columns"><label class="field"><span>Medicamento para dor de cabeça</span><input name="medicamentoCabeca"></label><label class="field"><span>Medicamento para dor no estômago</span><input name="medicamentoEstomago"></label></div></section><p id="student-message" class="form-message"></p><div class="form-actions"><p><b>*</b> Campos obrigatórios</p><button type="submit">Salvar cadastro <span>→</span></button></div></form>`, 'cursista');
  const form = app.querySelector('#student-form');
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
  const duplicateStudentCpfMessage = 'CPF já cadastrado';
  const studentTeamConflictMessage = 'Este CPF já está cadastrado na equipe de trabalho deste retiro.';
  const studentArchiveMessage = 'Dados encontrados no acervo da equipe. Revise antes de salvar.';
  const focusStudentRetreat = retreats.find((retreat) => retreat.status === 'publicado') || retreats.find((retreat) => retreat.status === 'preparacao');
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
    const values = new FormData(form);
    const submitCpf = normalizeCpf(values.get('cpf'));
    if (isValidCpf(submitCpf) && await checkStudentCpf(true)) return;
    const requiredChoices = ['batizado', 'primeiraComunhao', 'estuda', 'fezRetiro', 'paisMovimento', 'camiseta', 'intoleranciaAlimentos', 'alergiaMedicamento'];
    const firstInvalid = form.querySelector(':invalid');
    const missingChoice = requiredChoices.find((name) => !values.get(name));
    if (!form.checkValidity() || missingChoice) {
      app.querySelector('#student-message').textContent = 'Revise os campos obrigatórios antes de salvar.';
      focusStudentIssue(firstInvalid || form.querySelector(`[name="${missingChoice}"]`));
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
    form.querySelector('input[name="id"]')?.remove();
    form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning'));
    form.querySelector('button[type="submit"]').innerHTML = 'Salvar cadastro <span>→</span>';
    form.querySelector('.delete-student')?.setAttribute('hidden', '');
    app.querySelector('#student-message').textContent = 'Cadastro do cursista salvo com sucesso.';
  });
}
async function renderCursistaDetalhe(id) {
  const [students, allRetreats] = await Promise.all([dataService.listCursistas(), dataService.listRetiros()]);
  const student = students.find((item) => item.id === id);
  if (!student) { location.hash = '#cursista'; return; }
  const retreat = allRetreats.find((item) => item.id === student.retiroId);
  const field = (label, value) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || 'Não informado')}</span></div>`;
  const address = [student.rua, student.numero, student.bairro, student.cidade, student.estado].filter(Boolean).join(' · ');
  layout(`<section class="page-heading compact"><div><a class="back-link" href="#cursista">← Voltar</a><p class="eyebrow">Consulta de cursista</p><h1>${escapeHtml(student.nome || 'Cursista')}</h1><p>${retreat ? `Ficha cadastrada para ${escapeHtml(retreat.nome)}` : 'Cadastro de cursista'}</p></div></section><section class="panel"><h2>Dados pessoais</h2><div class="simple-list">${field('CPF', formatCpf(student.cpf || student.id))}${field('Nascimento', date(student.nascimento))}${field('Telefone', student.telefone)}${field('Endereço', address)}</div></section><section class="panel"><h2>Formação e vivência</h2><div class="simple-list">${field('É batizado(a)?', student.batizado)}${field('Fez primeira comunhão?', student.primeiraComunhao)}${field('Estuda?', student.estuda)}${field('Série', student.serie)}${field('Escola', student.escola)}${field('Fez algum retiro?', student.fezRetiro)}${field('Qual retiro?', student.qualRetiro)}</div></section><section class="panel"><h2>Família e convite</h2><div class="simple-list">${field('Pai', student.nomePai)}${field('Telefone do pai', student.telefonePai)}${field('Mãe', student.nomeMae)}${field('Telefone da mãe', student.telefoneMae)}${field('Movimento dos pais', student.paisMovimento)}${field('Qual movimento?', student.qualMovimento)}${field('Quem convidou?', student.convidou)}${field('Camiseta', student.camiseta)}</div></section><section class="panel"><h2>Saúde e inscrição</h2><div class="simple-list">${field('Intolerância a alimentos', student.intoleranciaAlimentos)}${field('Qual intolerância?', student.qualIntolerancia)}${field('Alergia a medicamento', student.alergiaMedicamento)}${field('Qual alergia?', student.qualAlergia)}${field('Medicamento para dor de cabeça', student.medicamentoCabeca)}${field('Medicamento para dor no estômago', student.medicamentoEstomago)}${field('Valor da inscrição', student.valorInscricao)}${field('Valor pago', student.valorPago)}${field('Saldo a pagar', student.saldoPagar)}</div></section><section class="panel"><div class="form-actions"><p>Esta ação remove o cadastro do cursista.</p><button type="button" id="delete-consulted-student" class="delete-student">Excluir cursista</button></div></section>`, 'cursista');
  app.querySelector('#delete-consulted-student').addEventListener('click', async () => {
    if (!confirm('Excluir este cursista?')) return;
    await removeStudentFromCommunities(student);
    await dataService.deleteCursista(student.id);
    location.hash = '#cursista';
  });
}
async function renderComunidades() {
  const retreat = retreats.find((item) => item.status === 'publicado') || retreats.find((item) => item.status === 'preparacao');
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Grupos do retiro</p><h1>Comunidades</h1><p>Crie ou publique um retiro para montar as comunidades.</p></div></section>', 'comunidades'); return; }
  const [students, allCommunities] = await Promise.all([dataService.listCursistas(), dataService.listComunidades()]);
  const communities = sortCommunitiesByPosition(allCommunities.filter((community) => community.retiroId === retreat.id));
  const entries = validatedEnrolments(enrolments.filter((entry) => entry.retiroId === retreat.id));
  const leaders = [...new Set(entries.filter((entry) => entry.casalId && entryHasSector(entry, 'Tios de comunidade')).map((entry) => entry.casalId))].map((casalId) => { const pair = entries.filter((entry) => entry.casalId === casalId); return { casalId, label: pair.map((entry) => entry.nome).join(' e ') }; });
  const monitorCandidates = [...new Set(entries.filter((entry) => entry.casalId && (entry.setores || []).some((sector) => normalizeText(sector).includes('monitor'))).map((entry) => entry.casalId))].map((casalId) => { const pair = entries.filter((entry) => entry.casalId === casalId); return { casalId, label: pair.map((entry) => entry.nome).join(' e ') }; });
  const retreatStudents = students.filter((student) => student.retiroId === retreat.id);
  const assignedStudentIds = new Set(communities.flatMap((community) => community.membroIds || []));
  const studentsWithoutCommunity = retreatStudents.filter((student) => !assignedStudentIds.has(student.id)).length;
  const communitiesWithoutLeaders = communities.filter((community) => !community.liderCasalId).length;
  const communitiesWithoutMonitor = communities.filter((community) => !community.monitorCasalId && !(community.monitorIds || []).length).length;
  const leaderOptions = (selected) => `<option value="">Buscar tios da comunidade</option>${leaders.map((leader) => `<option value="${leader.casalId}" ${leader.casalId === selected ? 'selected' : ''}>${escapeHtml(leader.label)}</option>`).join('')}`;
  const monitorOptions = (selected) => `<option value="">Buscar monitores da comunidade</option>${monitorCandidates.map((monitor) => `<option value="${monitor.casalId}" ${monitor.casalId === selected ? 'selected' : ''}>${escapeHtml(monitor.label)}</option>`).join('')}`;
  const moveOptions = (currentCommunityId) => `<option value="">Mover para...</option>${communities.filter((community) => community.id !== currentCommunityId).map((community) => `<option value="${community.id}">${escapeHtml(community.nome || `Comunidade ${community.ordem || ''}`)}</option>`).join('')}`;
  layout(`<section class="page-heading"><div><p class="eyebrow">Grupos do retiro</p><h1>Comunidades</h1><p>${escapeHtml(retreat.nome)} · Forme grupos e distribua os cursistas.</p><div class="community-overview"><article><span>Cursistas sem comunidade</span><strong>${studentsWithoutCommunity}</strong></article><article><span>Comunidades sem tios</span><strong>${communitiesWithoutLeaders}</strong></article><article><span>Comunidades sem monitor</span><strong>${communitiesWithoutMonitor}</strong></article></div></div><div class="detail-actions"><button class="primary-button" id="add-community" type="button">Incluir comunidade</button><button class="secondary-button" id="distribute-students" type="button" ${communities.length ? '' : 'disabled'}>Distribuir cursistas</button></div></section><section class="community-grid">${communities.map((community, index) => { const members = retreatStudents.filter((student) => (community.membroIds || []).includes(student.id)).sort((first, second) => new Date(second.nascimento) - new Date(first.nascimento)); return `<article class="community-card"><div class="community-card-heading"><label class="field"><span>Nome da comunidade</span><input class="community-rename" data-community-name="${community.id}" value="${escapeHtml(community.nome || `Comunidade ${index + 1}`)}"></label><div class="community-order-summary"><label class="field community-order-field"><span>Ordem</span><input data-community-order="${community.id}" type="number" min="1" step="1" value="${Number(community.ordem) || index + 1}"></label><div class="community-count"><span>Cursistas</span><strong>${members.length}</strong></div></div></div><div class="community-role-grid"><label class="field"><span>Buscar tios da comunidade</span><div class="community-role-control"><select data-community-leader="${community.id}">${leaderOptions(community.liderCasalId)}</select>${community.liderCasalId ? `<button type="button" data-remove-community-leader="${community.id}">Remover</button>` : ''}</div></label><label class="field"><span>Buscar monitores da comunidade</span><div class="community-role-control"><select data-community-monitor="${community.id}">${monitorOptions(community.monitorCasalId || community.monitorIds?.[0] || '')}</select>${community.monitorCasalId ? `<button type="button" data-remove-community-monitor="${community.id}">Remover</button>` : ''}</div></label></div><div class="community-members">${members.length ? members.map((student) => `<div><span>${escapeHtml(student.nome)} <small>${ageInYearsAndMonths(student.nascimento)}</small></span><select data-move-student="${student.id}" data-current-community="${community.id}">${moveOptions(community.id)}</select><button type="button" data-remove-member="${community.id}" data-student="${student.id}">Remover</button></div>`).join('') : '<p>Nenhum cursista alocado.</p>'}</div><button type="button" class="delete-community" data-delete-community="${community.id}" ${members.length ? 'disabled' : ''}>Excluir comunidade</button></article>`; }).join('') || '<div class="empty-state">Nenhuma comunidade criada ainda. Use Incluir comunidade para iniciar.</div>'}</section>`, 'comunidades');
  app.querySelector('#add-community').addEventListener('click', async () => {
    const latestCommunities = sortCommunitiesByPosition((await dataService.listComunidades()).filter((community) => community.retiroId === retreat.id));
    const nextOrder = Math.max(0, ...latestCommunities.map((community) => Number(community.ordem) || 0)) + 1;
    await dataService.saveComunidade({ id: crypto.randomUUID(), retiroId: retreat.id, nome: `Comunidade ${nextOrder}`, liderCasalId: '', monitorCasalId: '', monitorIds: [], membroIds: [], ordem: nextOrder, criadoEm: new Date().toISOString() });
    renderComunidades();
  });
  app.querySelectorAll('[data-community-name]').forEach((input) => input.addEventListener('change', async () => { const community = communities.find((item) => item.id === input.dataset.communityName); community.nome = input.value.trim() || `Comunidade ${community.ordem}`; await dataService.saveComunidade(community); input.value = community.nome; }));
  app.querySelectorAll('[data-community-order]').forEach((input) => input.addEventListener('change', async () => { const community = communities.find((item) => item.id === input.dataset.communityOrder); const ordem = Number(input.value); if (!community || !Number.isInteger(ordem) || ordem <= 0) { input.value = Number(community?.ordem) || 1; return; } community.ordem = ordem; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-community-leader]').forEach((select) => select.addEventListener('change', async () => { const community = communities.find((item) => item.id === select.dataset.communityLeader); community.liderCasalId = select.value; await dataService.saveComunidade(community); }));
  app.querySelectorAll('[data-community-monitor]').forEach((select) => select.addEventListener('change', async () => { const community = communities.find((item) => item.id === select.dataset.communityMonitor); community.monitorCasalId = select.value; community.monitorIds = []; await dataService.saveComunidade(community); }));
  app.querySelectorAll('[data-remove-community-leader]').forEach((button) => button.addEventListener('click', async () => { const community = communities.find((item) => item.id === button.dataset.removeCommunityLeader); community.liderCasalId = ''; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-remove-community-monitor]').forEach((button) => button.addEventListener('click', async () => { const community = communities.find((item) => item.id === button.dataset.removeCommunityMonitor); community.monitorCasalId = ''; community.monitorIds = []; await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-move-student]').forEach((select) => select.addEventListener('change', async () => {
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
  app.querySelectorAll('[data-remove-member]').forEach((button) => button.addEventListener('click', async () => { const community = communities.find((item) => item.id === button.dataset.removeMember); community.membroIds = (community.membroIds || []).filter((id) => id !== button.dataset.student); await dataService.saveComunidade(community); renderComunidades(); }));
  app.querySelectorAll('[data-delete-community]').forEach((button) => button.addEventListener('click', async () => { const community = communities.find((item) => item.id === button.dataset.deleteCommunity); if (!confirm(`Excluir ${community.nome}?`)) return; await dataService.deleteComunidade(community.id); renderComunidades(); }));
  app.querySelector('#distribute-students').addEventListener('click', () => {
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
    id: profile.id || id || crypto.randomUUID(),
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
    id: crypto.randomUUID(),
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
const entryNeedsUnclePrefix = (entry) => Boolean(entry.casalId || enrolments.some((item) => item.pessoaId === entry.pessoaId && item.casalId));
const genderedLabel = (person, feminine, masculine) => normalizeText(person?.genero) === 'feminino' ? feminine : masculine;
const badgeDisplayName = (entry) => {
  const person = personForBadge(entry);
  const name = firstName(person.nome || entry.nome);
  return entryNeedsUnclePrefix(entry) ? `${genderedLabel(person, 'Tia', 'Tio')} ${name}` : name;
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

async function renderCrachas() {
  const retreat = retreats.find((item) => item.status === 'publicado') || retreats.find((item) => item.status === 'preparacao');
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Identifica&ccedil;&atilde;o</p><h1>Crach&aacute;s</h1><p>Crie ou publique um retiro para gerar os crach&aacute;s.</p></div></section>', 'crachas'); return; }
  let settings = loadBadgeSettings();
  const [allCommunities, allStudents] = await Promise.all([dataService.listComunidades(), dataService.listCursistas()]);
  const badgeCommunities = sortCommunitiesByPosition(allCommunities.filter((community) => community.retiroId === retreat.id));
  const badgeStudents = allStudents.filter((student) => student.retiroId === retreat.id);
  const entries = validatedEnrolments(enrolments.filter((entry) => entry.retiroId === retreat.id && entry.setores?.length))
    .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }));
  const sectors = sortSectors(uniqueSectors([...(retreat.setores || []), ...entries.flatMap((entry) => entry.setores || [])]));
  const badgeSectorCount = (sector) => entries.filter((entry) => entryHasSector(entry, sector)).length;
  let badgeProfiles = await loadBadgeProfiles(retreat.id);
  let selectedProfileId = '';
  let blankPreview = false;
  let selectedCommunityId = badgeCommunities[0]?.id || '';
  let activePrintMode = 'all';
  let sectorPickerOpen = false;
  let personPickerOpen = false;
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
  layout(`<section class="page-heading badge-page-heading"><div><p class="eyebrow">Modelos de identifica&ccedil;&atilde;o</p><h1>Crach&aacute;s</h1><p>${escapeHtml(retreat.nome)} - Cadastre, altere e consulte modelos de crach&aacute; para usar na impress&atilde;o.</p></div><div class="badge-heading-tools">
      <label class="field"><span>Modelo do crach&aacute;</span><select id="badge-config-select">${profileOptions()}</select></label>
      <div class="badge-print-controls">
        <label class="field badge-print-mode-field"><span>O que imprimir</span><select id="badge-mode"><option value="">Selecione...</option><option value="all">Todos</option><option value="sector">Por setor</option><option value="individual">Individual</option><option value="community">Comunidade</option></select></label>
        <p class="badge-print-comment" id="badge-print-comment"></p>
        <select id="badge-sector" hidden>${sectors.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)} (${badgeSectorCount(sector)})</option>`).join('')}</select>
        <select id="badge-person" hidden>${entries.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.nome)} - ${escapeHtml((entry.setores || []).join(', '))}</option>`).join('')}</select>
      </div>
      <div class="badge-print-actions"><button class="secondary-button" id="badge-print" type="button">Imprimir</button><button class="primary-button" id="badge-pdf" type="button">Gerar PDF</button></div>
      <div class="badge-model-toolbar"><button class="primary-button" id="badge-new-config" type="button">Novo modelo</button></div>
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
        <button type="button" id="badge-save-tab">Salvar</button>
        <button type="button" class="badge-delete-tab" id="badge-delete-tab">Excluir</button>
      </div>
      <input id="badge-config-name" type="hidden">
      <fieldset data-badge-panel="logo"><legend>Logo</legend><div class="badge-logo-picker">${logoOptions}</div><div class="badge-range-grid">${stepper('Tamanho', 'logoSize', 10, 32, 0.5, settings.logoSize)}${stepper('Horizontal', 'logoX', 0, 100, 1, settings.logoX)}${stepper('Vertical', 'logoY', 0, 100, 1, settings.logoY)}</div></fieldset>
      <fieldset data-badge-panel="wallpaper" hidden><legend>Papel de parede</legend><input name="wallpaperUrl" type="hidden" value="${escapeHtml(settings.wallpaperUrl)}"><div class="fields three-columns"><label class="field"><span>Op&ccedil;&atilde;o</span><select name="wallpaper">${wallpaperOptions}</select></label><label class="field badge-color-button"><span>Cor do papel</span><span class="color-caption" data-color-caption="accent" style="background:${escapeHtml(settings.accent)}"></span><input name="accent" type="color" value="${escapeHtml(settings.accent)}"></label><label class="field badge-color-button"><span>Cor da borda</span><span class="color-caption" data-color-caption="border" style="background:${escapeHtml(settings.border)}"></span><input name="border" type="color" value="${escapeHtml(settings.border)}"></label></div><div class="badge-range-grid">${stepper('Curvatura do canto', 'corner', 0, 18, 0.5, settings.corner, true)}${stepper('Largura da borda', 'borderWidth', 0, 2.5, 0.1, settings.borderWidth, true)}</div></fieldset>
      <fieldset data-badge-panel="watermark" hidden><legend>Marca d'agua</legend><div class="fields two-columns"><label class="field"><span>Imagem</span><select name="watermark">${watermarkOptions}</select></label><label class="field"><span>Caminho/URL da imagem</span><input name="watermarkUrl" value="${escapeHtml(settings.watermarkUrl)}" placeholder="assets/minha-imagem.png"></label></div><div class="badge-range-grid">${stepper('Opacidade', 'watermarkOpacity', 0, 35, 1, settings.watermarkOpacity, true)}${stepper('Tamanho', 'watermarkSize', 30, 110, 1, settings.watermarkSize, true)}${stepper('Horizontal', 'watermarkX', 0, 100, 1, settings.watermarkX, true)}${stepper('Vertical', 'watermarkY', 0, 100, 1, settings.watermarkY, true)}</div></fieldset>
      <fieldset data-badge-panel="text" hidden><legend>Texto/tamanho</legend><label class="field"><span>Slogan do rodap&eacute;</span><input name="slogan" value="${escapeHtml(settings.slogan)}"></label><div class="fields three-columns"><label class="field"><span>Alterar</span><select name="textTarget"><option value="name" ${settings.textTarget === 'name' ? 'selected' : ''}>Nome</option><option value="sector" ${settings.textTarget === 'sector' ? 'selected' : ''}>Setor</option><option value="slogan" ${settings.textTarget === 'slogan' ? 'selected' : ''}>Slogan</option></select></label><label class="field"><span>Fonte</span><select name="font">${fontOptions}</select></label><label class="field"><span>Alinhamento</span><select name="align"><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label><label class="field badge-color-button"><span>Cor</span><span class="color-caption" data-color-caption="textColor" style="background:${escapeHtml(activeTextColor)}"></span><input name="textColor" type="color"></label>${stepper('Tamanho', 'textSize', 2.5, 16, 0.1, settings.textTarget === 'sector' ? settings.sectorSize : settings.textTarget === 'slogan' ? settings.sloganSize : settings.nameSize, true)}<label class="field badge-color-button"><span>Fundo</span><span class="color-caption" data-color-caption="background" style="background:${escapeHtml(settings.background)}"></span><input name="background" type="color" value="${escapeHtml(settings.background)}"></label></div></fieldset>
    </form>
  </section><section class="badge-print-area" id="badge-print-area"></section>`, 'crachas');

  const form = app.querySelector('#badge-editor');
  const preview = app.querySelector('#badge-preview');
  const printArea = app.querySelector('#badge-print-area');
  const mode = app.querySelector('#badge-mode');
  const sectorSelect = app.querySelector('#badge-sector');
  const personSelect = app.querySelector('#badge-person');
  const printComment = app.querySelector('#badge-print-comment');
  const configSelect = app.querySelector('#badge-config-select');
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
  const openBadgePanel = (panel) => {
    tabButtons.forEach((button) => {
      const active = button.dataset.badgeTab === panel;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    tabPanels.forEach((item) => { item.hidden = item.dataset.badgePanel !== panel; });
  };
  tabButtons.forEach((button) => button.addEventListener('click', () => openBadgePanel(button.dataset.badgeTab)));
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
    syncTextTargetControls(source);
    syncColorCaptions(source);
  };
  const refreshProfileOptions = (selectedId = '') => {
    if (!configSelect) return;
    configSelect.innerHTML = profileOptions();
    configSelect.value = selectedId;
    selectedProfileId = selectedId;
  };
  const setActiveProfile = (profile, openEditor = false) => {
    if (!profile) return;
    blankPreview = false;
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
    const keys = textTargetKeys[target] || textTargetKeys.name;
    next.textTarget = target;
    if (data.has('font')) next[keys.font] = data.get('font');
    if (data.has('align')) next[keys.align] = data.get('align');
    if (data.has('textSize')) next[keys.size] = Number(data.get('textSize'));
    if (data.has('textColor')) next[keys.color] = data.get('textColor');
    next.logo = data.get('logo') || next.logo;
    return next;
  };
  const selectedEntries = () => {
    if (activePrintMode === 'sector') return entries.filter((entry) => entryHasSector(entry, sectorSelect.value)).map((entry) => ({ entry, sector: sectorSelect.value }));
    if (activePrintMode === 'individual') return entries.filter((entry) => entry.id === personSelect.value).map((entry) => ({ entry, sector: (entry.setores || [])[0] || '' }));
    if (activePrintMode === 'community') return communityBadgeEntries(selectedCommunityId);
    return entries.map((entry) => ({ entry, sector: '' }));
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
    overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por setor</p><h2>Selecione o setor</h2><p>Escolha qual setor ser&aacute; usado na impress&atilde;o dos crach&aacute;s.</p></div></div><div class="receiver-sector-list">${sectors.map((sector) => `<button type="button" data-badge-sector-choice="${escapeHtml(sector)}"><strong>${escapeHtml(sector)}</strong><span>${badgeSectorCount(sector)} crach&aacute;(s)</span></button>`).join('')}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
    const close = () => {
      sectorPickerOpen = false;
      overlay.remove();
    };
    overlay.querySelector('.close-sector-view').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelectorAll('[data-badge-sector-choice]').forEach((button) => button.addEventListener('click', () => {
      sectorSelect.value = button.dataset.badgeSectorChoice;
      close();
      renderBadges();
    }));
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
    overlay.innerHTML = `<div class="receiver-sector-dialog"><div class="panel-heading"><div><p class="eyebrow">Impress&atilde;o por comunidade</p><h2>Selecione a comunidade</h2><p>Ser&atilde;o impressos os crach&aacute;s dos cursistas, tios e monitores definidos na comunidade.</p></div></div><div class="receiver-sector-list">${badgeCommunities.map((community) => {
      const count = communityBadgeEntries(community.id).length;
      return `<button type="button" data-badge-community-choice="${escapeHtml(community.id)}"><strong>${escapeHtml(communityName(community))}</strong><span>${count} crach&aacute;(s) de cursistas/tios/monitores</span></button>`;
    }).join('')}</div><div class="form-actions"><button type="button" class="close-sector-view">Cancelar</button></div></div>`;
    const close = () => {
      communityPickerOpen = false;
      overlay.remove();
    };
    overlay.querySelector('.close-sector-view').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelectorAll('[data-badge-community-choice]').forEach((button) => button.addEventListener('click', () => {
      selectedCommunityId = button.dataset.badgeCommunityChoice;
      close();
      renderBadges();
    }));
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
    preview.innerHTML = blankPreview ? blankBadgeCard(next) : first ? badgeCard(first.entry, next, first.sector) : '<p class="empty-state">Nenhum volunt&aacute;rio validado para crach&aacute;.</p>';
    badgePrintEntries = selected;
    const selectedCommunity = badgeCommunities.find((community) => community.id === selectedCommunityId);
    badgePrintTitle = activePrintMode === 'sector' ? `Crach\u00e1s - ${sectorSelect.value}` : activePrintMode === 'individual' ? `Crach\u00e1 - ${first?.entry?.nome || ''}` : activePrintMode === 'community' ? `Crach\u00e1s - ${communityName(selectedCommunity)}` : `Crach\u00e1s - ${retreat.nome}`;
    const pages = [];
    for (let index = 0; index < selected.length; index += 8) pages.push(selected.slice(index, index + 8));
    printArea.innerHTML = pages.map((page) => `<div class="badge-print-sheet">${page.map(({ entry, sector }) => badgeCard(entry, next, sector)).join('')}</div>`).join('');
    app.querySelector('#badge-print-summary').textContent = `${selected.length} crach\u00e1(s) selecionado(s).`;
    sectorSelect.hidden = true;
    personSelect.hidden = true;
    if (printComment) {
      printComment.textContent = activePrintMode === 'sector'
        ? `Selecionado: ${sectorSelect.value || 'Setor'}`
        : activePrintMode === 'individual'
          ? `Selecionado: ${personSelect.options[personSelect.selectedIndex]?.textContent || 'Volunt\u00e1rio'}`
          : activePrintMode === 'community'
            ? `Selecionado: ${communityName(selectedCommunity)}`
            : 'Selecionado: Todos';
    }
  };
  const loadSelectedProfile = () => {
    const profile = badgeProfiles.find((item) => item.id === configSelect.value);
    if (!profile) {
      selectedProfileId = '';
      blankPreview = false;
      renderBadges();
      return;
    }
    setActiveProfile(profile);
  };
  const saveCurrentProfile = async (profileName) => {
    const name = String(profileName || '').trim();
    if (!name) {
      if (configMessage) configMessage.textContent = 'Informe um nome para salvar esta configura\u00e7\u00e3o.';
      return;
    }
    const current = readSettings();
    const selected = badgeProfiles.find((profile) => profile.id === selectedProfileId || profile.id === configSelect?.value);
    const isUpdatingLoadedProfile = selected && normalizeText(selected.name) === normalizeText(name);
    const id = isUpdatingLoadedProfile ? selected.id : crypto.randomUUID();
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
    selectedProfileId = '';
    blankPreview = true;
    settings = { ...defaultBadgeSettings };
    applySettingsToForm(settings);
    refreshProfileOptions('');
    if (configName) configName.value = '';
    if (configMessage) configMessage.textContent = 'Novo modelo iniciado. Ajuste as caracter\u00edsticas e salve com um nome.';
    openBadgePanel('logo');
    renderBadges();
  };
  const printBadges = (pdf = false) => {
    const profile = badgeProfiles.find((item) => item.id === configSelect?.value);
    if (!profile) { alert('Selecione o modelo do crach\u00e1 que ser\u00e1 usado na impress\u00e3o.'); configSelect?.focus(); return; }
    setActiveProfile(profile);
    if (!badgePrintEntries.length) { alert('Nenhum crach\u00e1 selecionado para gerar.'); return; }
    document.title = badgePrintTitle || 'Crach\u00e1s';
    if (pdf) app.querySelector('#badge-print-summary').textContent = 'Na janela de impress\u00e3o, escolha "Salvar como PDF".';
    window.print();
  };
  form.elements.textTarget?.addEventListener('change', () => {
    syncTextTargetControls(settings);
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
    renderBadges();
    if (activePrintMode === 'sector') openBadgeSectorPicker();
    if (activePrintMode === 'individual') openBadgePersonPicker();
    if (activePrintMode === 'community') openBadgeCommunityPicker();
    mode.value = '';
  });
  [sectorSelect, personSelect].forEach((control) => control.addEventListener('change', renderBadges));
  configSelect?.addEventListener('change', loadSelectedProfile);
  app.querySelector('#badge-new-config')?.addEventListener('click', startNewProfile);
  app.querySelector('#badge-save-tab')?.addEventListener('click', openSaveBadgeDialog);
  app.querySelector('#badge-delete-tab')?.addEventListener('click', deleteCurrentProfile);
  app.querySelector('#badge-print').addEventListener('click', () => printBadges(false));
  app.querySelector('#badge-pdf').addEventListener('click', () => printBadges(true));
  openBadgePanel('logo');
  syncTextTargetControls(settings);
  renderBadges();
}

async function renderQuadrante() {
  const retreat = retreats.find((item) => item.status === 'publicado') || retreats.find((item) => item.status === 'preparacao');
  if (!retreat) { layout('<section class="page-heading"><div><p class="eyebrow">Relatório</p><h1>Quadrante</h1><p>Crie ou publique um retiro para gerar o relatório.</p></div></section>', 'quadrante'); return; }
  const [communities, students] = await Promise.all([dataService.listComunidades(), dataService.listCursistas()]);
  const entries = validatedEnrolments(enrolments.filter((entry) => entry.retiroId === retreat.id && entry.setores?.length));
  const retreatStudents = students.filter((student) => student.retiroId === retreat.id);
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
  const order = quadranteOrderForSectors(knownSectors([...(retreat.setores || []), ...(retreat.ordemQuadrante || []), ...presentSectors]), retreat.ordemQuadrante || []);
  const sectors = [...order.filter((sector) => presentSectors.some((item) => normalizeText(item) === normalizeText(sector))), ...sortSectors(presentSectors.filter((sector) => !order.some((item) => normalizeText(item) === normalizeText(sector))))];
  const sectorSections = sectors.map((sector) => {
    const sectorEntries = entries
      .filter((entry) => entryHasSector(entry, sector))
      .map((entry) => { const person = personForEntry(entry); return { person, casalId: entry.casalId, address: addressForPerson(person), coordenacaoSetor: Boolean(entry.coordenacaoSetor) }; });
    return `<article class="quadrante-sector"><h3>${escapeHtml(sector)}</h3><table>${quadranteColgroup}<tbody>${groupedParticipantRows(sectorEntries)}</tbody></table></article>`;
  }).join('');
  const assignedStudentIds = new Set(reportCommunities.flatMap((community) => community.membroIds || []));
  const unassignedStudents = retreatStudents.filter((student) => !assignedStudentIds.has(student.id));
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
    const members = retreatStudents
      .filter((student) => (community.membroIds || []).includes(student.id))
      .sort(byName)
      .map((student) => ({ person: student, address: addressForStudent(student) }));
    return `<article><h3>${escapeHtml(community.nome)}</h3><table>${quadranteColgroup}<tbody>${groupedParticipantRows(monitorEntries, 'community-monitor')}${groupedParticipantRows(leaderEntries, 'community-tio')}${groupedParticipantRows(members) || (!leaderEntries.length && !monitorEntries.length ? '<tr><td colspan="4">Nenhum cursista alocado.</td></tr>' : '')}</tbody></table></article>`;
  }).join('');
  const reportHeader = `<table class="quadrante-column-head">${quadranteColgroup}<thead><tr><th>Nome</th><th>Endereço</th><th>ANIV</th><th>Contato</th></tr></thead></table>`;
  layout(`<section class="page-heading"><div><h1>Quadrante - ${escapeHtml(retreat.nome)}</h1></div><button class="primary-button" id="print-quadrante">Imprimir relatório</button></section><section class="quadrante-report" id="quadrante-report">${reportHeader}${sectorSections || '<p class="empty-state">Nenhum voluntário com setor atribuído.</p>'}<section class="quadrante-communities">${communitySections || '<p>Nenhuma comunidade criada.</p>'}</section></section>`, 'quadrante');
  app.querySelector('#print-quadrante').addEventListener('click', () => window.print());
}

function choices(name, options, multiple = true) { const visibleOptions = options; return `<div class="inline-choices ${name === 'camiseta' ? 'compact-choices' : ''}">${visibleOptions.map((option) => `<label class="choice"><input type="${multiple ? 'checkbox' : 'radio'}" name="${name}" value="${escapeHtml(option)}"><span>${escapeHtml(option)}</span></label>`).join('')}</div>`; }
async function renderPublicForm(id, embedded = false) {
  const retreat = await dataService.getRetiro(id);
  if (embedded) layout('<div id="registration-root"></div>', 'pessoas');
  const mount = embedded ? app.querySelector('#registration-root') : app;
  if (!retreat) { mount.innerHTML = '<main class="public-shell"><h1>Retiro não encontrado</h1><p>Confira o link que foi enviado pela equipe.</p></main>'; return; }
  if (!embedded && (!people.length || !enrolments.length)) {
    [enrolments, people] = await Promise.all([dataService.listAdesoes(), dataService.listPessoas()]);
  }
  const binaryChoices = (name, options) => choices(name, options, false);
  const contributionOptions = ['R$ 60,00 se o voluntário for o único da família', 'R$ 55,00 se o voluntário tiver mais pessoas da mesma família trabalhando no retiro'];
  const kidsFields = Array.from({ length: 5 }, (_, index) => `<div class="kids-row"><span>${index + 1}</span><label class="field"><span>Nome</span><input name="kidNome${index + 1}" placeholder="Nome da criança"></label><label class="field"><span>Data de nascimento</span><input name="kidNascimento${index + 1}" type="date"></label></div>`).join('');
  const sectorsForRegistration = embedded ? retreat.setores : (retreat.setoresPublicos ?? retreat.setores);
  const publicHeading = embedded ? String(retreat.nome || '') : `Cadastro da equipe de trabalho para: ${retreat.nome || ''}`;
  const publicLead = embedded ? 'Preencha os dados para organizar a participacao da equipe neste retiro.' : 'Este e o formulario oficial da equipe de organizacao. Confira o nome do retiro antes de informar seus dados.';
  const serviceDays = retreatServiceDays(retreat);
  const includeSubmitText = embedded ? 'Salvar inclusão' : 'Confirmar Inscrição';
  const editSubmitText = embedded ? 'Salvar Alteração' : 'Salvar alterações';
  const publicSectors = ['escondida', 'sala'].map((area) => `<section class="public-sector-area"><h4>${area === 'escondida' ? 'Equipe escondida' : 'Equipe Sala'}</h4>${area === 'escondida' ? '<aside class="hidden-team-notice"><strong>Atenção, querido servo do Senhor</strong><p>Se você vai participar de alguma área deste setor, fique ciente de que <b>não poderá ser visto por nenhum cursista</b>. Evite chegar nos horários em que eles estiverem chegando ou saindo do retiro e estacione seu veículo em um local escondido, principalmente se você tiver algum conhecido fazendo o curso.</p></aside>' : '<aside class="room-team-notice"><strong>Querido servo do Senhor</strong><p>Neste retiro, você será a imagem do movimento EPC para os cursistas e, mais ainda, será a imagem de Deus para eles. Por isso: sorriso no rosto, cante com determinação, use roupas adequadas, reze muito e seja cordial em todos os momentos.</p></aside>'}<div class="choice-grid sectors">${sortSectors(sectorsForRegistration.filter((sector) => sectorArea(sector) === area)).map((sector) => `<label class="choice"><input type="radio" name="setores" value="${escapeHtml(sector)}"><span>${escapeHtml(sector)}</span></label>`).join('') || '<p class="hint">Nenhum setor configurado nesta área.</p>'}</div></section>`).join('');
  const sectorCoordinatorOption = embedded ? '<label class="choice sector-coordinator-option"><input type="checkbox" name="coordenacaoSetor" value="sim"><span>Coordenação do setor</span></label>' : '';
  const adminSearchPanel = embedded ? `<section class="admin-registration-tools panel"><div class="panel-heading"><div><p class="eyebrow">Cadastro da equipe</p><h2>Consultar cadastro</h2><p>Busque por nome, CPF ou setor para editar ou consultar a ficha do retiro em foco.</p></div><button type="button" id="new-registration">Incluir novo</button></div><label class="field registration-search-field"><span>Busca</span><input id="registration-search" autocomplete="off" placeholder="Digite nome, CPF ou setor"></label><div id="registration-search-results" class="registration-search-results" hidden></div></section>` : '';
  mount.innerHTML = `<main class="public-shell"><header class="hero"><div><p class="eyebrow">Equipe de trabalho</p><h1>${escapeHtml(retreat.nome)}</h1><p class="hero-copy">Preencha seus dados para organizarmos sua participação com carinho e antecedência.</p></div></header>${adminSearchPanel}<form id="public-form">${stateDatalist()}
    <section class="form-section"><div class="section-heading"><span>01</span><div><h2>Seus Dados</h2></div></div><div class="fields two-columns"><label class="field"><span>CPF <b>*</b></span><input name="cpf" required></label><label class="field"><span>Nome completo <b>*</b></span><input name="nome" autocomplete="off" required></label><label class="field"><span>Data de nascimento <b>*</b></span><input name="nascimento" type="date" required></label><label class="field"><span>Telefone <b>*</b></span><input name="telefone" required></label><fieldset class="choice-block full"><legend>Gênero <b>*</b></legend>${binaryChoices('genero', ['Masculino', 'Feminino'])}</fieldset><fieldset class="choice-block form-type-choice full"><legend>Esta ficha é: <b>*</b></legend>${binaryChoices('tipoFicha', ['Individual', 'Casal'])}</fieldset></div></section>
    <section class="form-section"><div class="section-heading"><span>02</span><div><h2>Sua participação</h2><p>Conte-nos quais retiros você já fez na família EPC.</p></div></div><div class="choice-block"><h3>Retiro(s) que fez <b>*</b></h3>${choices('retiros', ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'])}</div><div class="choice-block"><h3>Que dias vai trabalhar <b>*</b></h3>${choices('dias', serviceDays)}</div></section>
    <section class="form-section couple-only" hidden><div class="section-heading"><span>03</span><div><h2>Segundo cônjuge</h2><p>Dados específicos da segunda pessoa do casal.</p></div></div><div class="fields two-columns"><label class="field"><span>CPF <b>*</b></span><input name="spouseCpf"></label><label class="field"><span>Nome completo <b>*</b></span><input name="spouseNome" autocomplete="off"></label><label class="field"><span>Data de nascimento <b>*</b></span><input name="spouseNascimento" type="date"></label><label class="field"><span>Telefone <b>*</b></span><input name="spouseTelefone"></label><fieldset class="choice-block full"><legend>Gênero <b>*</b></legend>${binaryChoices('spouseGenero', ['Masculino', 'Feminino'])}</fieldset></div><div class="choice-block"><h3>Retiro(s) que fez <b>*</b></h3>${choices('spouseRetiros', ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'])}</div><div class="choice-block"><h3>Que dias vai trabalhar <b>*</b></h3>${choices('spouseDias', serviceDays)}</div></section>
    <section class="form-section common-section"><div class="section-heading"><span>04</span><div><h2>Endereço</h2></div></div><div class="fields address-fields"><label class="field"><span>CEP <b>*</b></span><input name="cep" inputmode="numeric" placeholder="00000-000" required></label><label class="field street-field"><span>Rua / Avenida <b>*</b></span><input name="endereco" required></label><label class="field number-field"><span>Número <b>*</b></span><input name="numero" required></label><label class="field"><span>Bairro <b>*</b></span><input name="bairro" required></label><label class="field"><span>Cidade <b>*</b></span><input name="cidade" required></label><label class="field"><span>Estado <b>*</b></span><input name="estado" maxlength="2" required></label></div></section>
    <section class="form-section"><div class="section-heading"><span>05</span><div><h2>Setor de trabalho <b>*</b></h2></div></div><div class="choice-block">${publicSectors}${sectorCoordinatorOption}</div></section>
    <section class="form-section compact-section"><div class="section-heading"><span>06</span><div><h2>Itens e contribuição</h2><p>Escolhas necessárias para sua inscrição.</p></div></div><div class="fields choice-cards"><div class="quadrante-print-option"><label class="kinship-discount-option"><input type="checkbox" name="quadrante" value="Sim"> Quer quadrante impresso?</label><p class="hint">O quadrante (relação de todas a pessoas que serviram no retiro com os seus contatos) é disponibilizado em PDF após o retiro, mas se você quiser levar impresso no dia do retiro, selecione a opção acima.</p></div><div class="field choice-block contribution-field"><span data-contribution-label>Valor da inscrição</span><label class="kinship-discount-option photo-contribution-option"><input type="checkbox" name="foto" value="Sim"> Quer foto? Valor: ${currency(retreat.valorFoto ?? 10)}</label><input name="contribuicao" value="${currency(retreat.valorInscricaoVoluntario)}" readonly><p class="hint payment-instructions">Fazer pix CNPJ 52.109.946/0001-94 e encaminhar o comprovante no privado para o coordenador do setor que você vai servir.</p></div></div></section>
    <section class="form-section"><div class="section-heading"><span>07</span><div><h2>Informações adicionais</h2><p>Ajude-nos a cuidar bem de você e de sua família.</p></div></div><div class="choice-block"><div class="kids-heading"><h3>Espaço Kids <b>*</b></h3><label><input type="checkbox" name="kidsNotNeeded"> Não necessito do Espaço Kids</label></div><p class="hint kids-hint">Informe o nome de suas crianças que utilizarão o Espaço Kids ou marque que não necessita. Deixe em branco as linhas não utilizadas.</p><div class="kids-list">${kidsFields}</div></div><div class="fields"><label class="field"><span>Observação</span><textarea name="observacao" rows="4"></textarea></label></div></section>
    <p id="form-message" class="form-message"></p><div class="form-actions"><p><b>*</b> Campos obrigatórios</p><button type="submit">${includeSubmitText} <span>→</span></button></div></form></main>`;
  mount.querySelector('.hero h1').textContent = publicHeading;
  mount.querySelector('.hero-copy').textContent = publicLead;
  if (!embedded) document.title = publicHeading;
  const form = mount.querySelector('#public-form');
  wireStateFields(form);
  wireCepLookup(form);
  wireCpfFields(form);
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
  let editingEntry = null;
  let editingSpouseEntry = null;
  let newRecordNeedsType = false;
  const setChoices = (name, values) => {
    const selected = new Set(Array.isArray(values) ? values : [values]);
    form.querySelectorAll(`[name="${name}"]`).forEach((input) => { input.checked = selected.has(input.value); });
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
  const setNewRecordTypeLock = (locked) => {
    newRecordNeedsType = locked;
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      field.disabled = locked && !['nome', 'cpf', 'tipoFicha'].includes(field.name);
    });
    form.querySelector('button[type="submit"]').disabled = locked;
  };
  const resetFormForInclusion = (nome = form.elements.nome.value, cpf = form.elements.cpf.value) => {
    const selectedType = new FormData(form).get('tipoFicha');
    form.querySelector('.inline-partner-registration')?.remove();
    form.reset();
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
  };
  const startNewRegistration = () => {
    form.querySelector('.inline-partner-registration')?.remove();
    form.reset();
    editingEntry = null;
    editingSpouseEntry = null;
    form.querySelector('#delete-registration')?.remove();
    setNewRecordTypeLock(false);
    setCoupleMode(false);
    syncKidsNeed();
    form.querySelector('#form-message').textContent = 'Novo cadastro para o retiro em foco.';
    form.elements.cpf.focus();
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
  const loadLinkedSpouse = async (person) => {
    if (!isCouple() || !person) return false;
    const linked = linkedSpouseForPerson(person.id);
    if (!linked) return false;
    const currentSpouseEntry = enrolments.find((entry) => entry.retiroId === id && entryMatchesCpf(entry, normalizeCpf(linked.spouse.cpf || linked.spouse.id)));
    if (currentSpouseEntry) editingSpouseEntry = currentSpouseEntry;
    const spouseCpf = normalizeCpf(linked.spouse.cpf || linked.spouse.id);
    form.elements.spouseCpf.value = isValidCpf(spouseCpf) ? formatCpf(spouseCpf) : '';
    form.elements.spouseNome.value = linked.spouse.nome || '';
    form.elements.spouseNascimento.value = linked.spouse.nascimento || '';
    form.elements.spouseTelefone.value = linked.spouse.telefone || '';
    form.elements.spouseTelefone.dispatchEvent(new Event('input'));
    setChoices('spouseGenero', linked.spouse.genero);
    setChoices('spouseRetiros', (currentSpouseEntry || linked.spouseEntry).retirosAnteriores || []);
    setChoices('spouseDias', (currentSpouseEntry || linked.spouseEntry).dias || []);
    form.elements.spouseCpf.dispatchEvent(new Event('change'));
    if (form.querySelector('#form-message').textContent !== duplicatePublicCpfMessage) {
      form.querySelector('#form-message').textContent = 'Encontramos o cônjuge vinculado a este CPF. Revise os dados antes de enviar.';
    }
    return true;
  };
  const deleteRegistration = async (entry) => {
    if (!entry || !confirm(`Excluir o cadastro de ${entry.nome} deste retiro?`)) return;
    const entriesToDelete = [entry, entry.casalId && enrolments.find((item) => item.casalId === entry.casalId && item.retiroId === entry.retiroId && item.pessoaId !== entry.pessoaId)].filter(Boolean);
    for (const entryToDelete of entriesToDelete) {
      await dataService.deleteAdesao(entryToDelete.id);
      const remaining = (await dataService.listAdesoes()).filter((item) => item.pessoaId === entryToDelete.pessoaId);
      if (!remaining.length) await dataService.deletePessoa(entryToDelete.pessoaId);
    }
    await loadData();
    renderPublicForm(id, true);
  };
  const loadEntryForEdit = (entry) => {
    const person = people.find((item) => item.id === entry.pessoaId);
    if (!person) return;
    form.reset();
    editingEntry = entry;
    editingSpouseEntry = entry.casalId && enrolments.find((item) => item.casalId === entry.casalId && item.retiroId === entry.retiroId && item.pessoaId !== entry.pessoaId);
    setNewRecordTypeLock(false);
    ['nome', 'cpf', 'nascimento', 'telefone', 'endereco', 'numero', 'bairro', 'cidade', 'estado'].forEach((name) => { form.elements[name].value = name === 'cpf' ? formatCpf(person.cpf || person.id) : (person[name] || ''); });
    form.elements.cep.value = person.cep || '';
    setChoices('retiros', entry.retirosAnteriores || []); setChoices('dias', entry.dias || []); setChoices('setores', entry.setores || []); setChoices('quadrante', entry.quadrante); setChoices('foto', entry.foto); setChoices('tipoFicha', entry.casalId ? 'Casal' : 'Individual'); setChoices('genero', person.genero); setChoices('coordenacaoSetor', entry.coordenacaoSetor || editingSpouseEntry?.coordenacaoSetor ? 'sim' : '');
    if (form.elements.coordenacao) form.elements.coordenacao.value = entry.coordenacao || '';
    form.elements.observacao.value = entry.observacao || '';
    form.elements.kidsNotNeeded.checked = Boolean(entry.espacoKidsNaoNecessito);
    (entry.espacoKids || []).forEach((kid, index) => { if (index < 5) { form.elements[`kidNome${index + 1}`].value = kid.nome || ''; form.elements[`kidNascimento${index + 1}`].value = kid.nascimento || ''; } });
    syncKidsNeed();
    if (editingSpouseEntry) {
      const spouse = people.find((item) => item.id === editingSpouseEntry.pessoaId);
      if (spouse) {
        form.elements.spouseNome.value = spouse.nome || '';
        form.elements.spouseCpf.value = formatCpf(spouse.cpf || spouse.id);
        form.elements.spouseNascimento.value = spouse.nascimento || '';
        form.elements.spouseTelefone.value = spouse.telefone || '';
        setChoices('spouseGenero', spouse.genero);
      }
      setChoices('spouseRetiros', editingSpouseEntry.retirosAnteriores || []);
      setChoices('spouseDias', editingSpouseEntry.dias || []);
    }
    setCoupleMode(Boolean(entry.casalId));
    if (!form.querySelector('#delete-registration')) { const remove = document.createElement('button'); remove.type = 'button'; remove.id = 'delete-registration'; remove.className = 'delete-registration'; remove.textContent = 'Excluir cadastro'; form.querySelector('.form-actions').append(remove); remove.addEventListener('click', async () => { if (!editingEntry || !confirm('Excluir este cadastro deste retiro?')) return; const entriesToDelete = [editingEntry, editingSpouseEntry].filter(Boolean); for (const entryToDelete of entriesToDelete) { await dataService.deleteAdesao(entryToDelete.id); const remaining = (await dataService.listAdesoes()).filter((item) => item.pessoaId === entryToDelete.pessoaId); if (!remaining.length) await dataService.deletePessoa(entryToDelete.pessoaId); } await loadData(); renderPublicForm(id, true); }); }
    form.querySelector('#form-message').textContent = 'Editando o cadastro já enviado para este retiro.';
  };
  if (embedded) {
    const nameField = form.nome.closest('.field');
    const cascade = document.createElement('div'); cascade.className = 'person-cascade'; cascade.hidden = true; nameField.append(cascade);
    const renderCascade = () => { const currentName = form.nome.value; const term = currentName.trim().toLocaleLowerCase('pt-BR'); const entries = enrolments.filter((entry) => entry.retiroId === id && (!term || entry.nome.toLocaleLowerCase('pt-BR').includes(term))); const selectedType = new FormData(form).get('tipoFicha'); if (term && !entries.length) resetFormForInclusion(currentName); cascade.innerHTML = entries.length ? entries.map((entry) => `<button type="button" data-existing-entry="${entry.id}"><strong>${escapeHtml(entry.nome)}</strong><span>${escapeHtml(entry.setores.join(', '))}</span></button>`).join('') : `<p>${term && !selectedType ? 'Nenhuma pessoa encontrada. Escolha se esta ficha é Individual ou Casal antes de salvar.' : 'Nenhuma pessoa encontrada. Continue para incluir um novo cadastro.'}</p>`; cascade.hidden = false; cascade.querySelectorAll('[data-existing-entry]').forEach((button) => button.addEventListener('click', () => { const entry = enrolments.find((item) => item.id === button.dataset.existingEntry); if (entry) { loadEntryForEdit(entry); cascade.hidden = true; } })); };
    const closeNameCascade = (event) => { if (!nameField.contains(event.target)) cascade.hidden = true; };
    form.nome.addEventListener('focus', renderCascade); form.nome.addEventListener('input', renderCascade);
    nameField.addEventListener('focusout', (event) => { if (!nameField.contains(event.relatedTarget)) cascade.hidden = true; });
    document.addEventListener('pointerdown', closeNameCascade, true);
    document.addEventListener('focusin', closeNameCascade, true);
  }
  if (embedded) {
    const searchInput = mount.querySelector('#registration-search');
    const searchResults = mount.querySelector('#registration-search-results');
    const renderRegistrationSearch = () => {
      const term = normalizeText(searchInput.value);
      const entries = enrolments
        .filter((entry) => entry.retiroId === id)
        .filter((entry) => {
          const person = people.find((item) => item.id === entry.pessoaId);
          const cpf = normalizeCpf(person?.cpf || person?.id);
          const haystack = normalizeText([entry.nome, cpf, cpf && formatCpf(cpf), person?.telefone, entry.setores?.join(' '), entry.dias?.join(' ')].filter(Boolean).join(' '));
          return !term || haystack.includes(term);
        })
        .sort((first, second) => first.nome.localeCompare(second.nome, 'pt-BR'));
      searchResults.hidden = false;
      searchResults.innerHTML = entries.length ? entries.map((entry) => {
        const person = people.find((item) => item.id === entry.pessoaId);
        const cpf = normalizeCpf(person?.cpf || person?.id);
        return `<article><div><strong>${escapeHtml(entry.nome)}</strong><span>${cpf ? formatCpf(cpf) : 'CPF não informado'} · ${escapeHtml(entry.setores.join(', ') || 'Sem setor')}</span></div><div class="registration-actions"><button type="button" data-registration-edit="${entry.id}">Editar</button><a href="#pessoas/${entry.pessoaId}/${entry.retiroId}/equipe">Consultar</a></div></article>`;
      }).join('') : '<p>Nenhum cadastro encontrado neste retiro.</p>';
      searchResults.querySelectorAll('[data-registration-edit]').forEach((button) => button.addEventListener('click', () => {
        const entry = enrolments.find((item) => item.id === button.dataset.registrationEdit);
        if (entry) {
          loadEntryForEdit(entry);
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          searchResults.hidden = true;
        }
      }));
    };
    mount.querySelector('#new-registration').addEventListener('click', startNewRegistration);
    searchInput.addEventListener('focus', renderRegistrationSearch);
    searchInput.addEventListener('input', renderRegistrationSearch);
    const registrationSearchField = searchInput.closest('.registration-search-field');
    const hideRegistrationSearch = () => { searchResults.hidden = true; };
    const closeRegistrationSearch = (event) => {
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
      field.disabled = locked && !canCorrectCpf;
    });
    if (!locked) {
      setCoupleMode(isCouple());
      syncKidsNeed();
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
    if (publicCpfMessages.includes(form.querySelector('#form-message').textContent)) form.querySelector('#form-message').textContent = '';
    setDuplicateCpfLock(false);
  };
  const warnPublicStudentConflict = async (control, focus = false) => {
    if (!control) return false;
    const cpf = normalizeCpf(control.value);
    if (cpf.length !== 11 || !isValidCpf(cpf)) {
      clearDuplicateCpfMessage();
      return false;
    }
    const students = await dataService.listCursistas();
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
  const warnSpouseCpfConflict = async (control, focus = false) => {
    if (!control || control.name !== 'spouseCpf' || !isCouple()) return false;
    const cpf = normalizeCpf(control.value);
    if (cpf.length !== 11 || !isValidCpf(cpf)) {
      if (form.querySelector('#form-message').textContent === spouseCpfConflictMessage) clearDuplicateCpfMessage();
      return false;
    }
    const mainCpf = normalizeCpf(form.elements.cpf.value);
    const teamConflict = enrolments.some((entry) => entry.retiroId === id && entry.id !== editingSpouseEntry?.id && entryMatchesCpf(entry, cpf));
    const students = await dataService.listCursistas();
    const studentConflict = students.some((student) => student.retiroId === id && normalizeCpf(student.cpf || student.id) === cpf);
    const sameAsMainCpf = mainCpf && mainCpf === cpf;
    if (!teamConflict && !studentConflict && !sameAsMainCpf) {
      if (form.querySelector('#form-message').textContent === spouseCpfConflictMessage) clearDuplicateCpfMessage();
      return false;
    }
    setTimeout(() => showCpfLockMessage(control, spouseCpfConflictMessage));
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
    const existingEntries = await dataService.listAdesoes();
    const hasDuplicate = existingEntries.some((entry) => entry.retiroId === id && entry.pessoaId === cpf);
    if (!hasDuplicate) clearDuplicateCpfMessage();
    if (!hasDuplicate) return false;
    setTimeout(() => showDuplicateCpfMessage(control));
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
    form.nome.value = form.nome.value || person.nome || '';
    form.nascimento.value = person.nascimento || '';
    form.telefone.value = person.telefone || '';
    form.endereco.value = person.endereco || '';
    form.numero.value = person.numero || '';
    form.bairro.value = person.bairro || '';
    form.cep.value = person.cep || '';
    form.cidade.value = person.cidade || '';
    form.estado.value = person.estado || '';
    const spouseLoaded = await loadLinkedSpouse(person);
    if (!spouseLoaded) mount.querySelector('#form-message').textContent = 'Encontramos seus dados pelo CPF. Revise antes de enviar este cadastro.';
  };
  form.cpf.addEventListener('change', loadPersonByCpf);
  [form.elements.cpf, form.elements.spouseCpf].filter(Boolean).forEach((control) => {
    control.addEventListener('input', () => {
      if (normalizeCpf(control.value).length === 11 && isValidCpf(control.value)) checkPublicCpf(control);
    });
    control.addEventListener('change', () => checkPublicCpf(control));
  });
  form.addEventListener('change', async (event) => {
    event.target.closest('.field, .choice-block, .form-section')?.classList.remove('field-warning');
    if (event.target.name === 'tipoFicha') {
      if (newRecordNeedsType) setNewRecordTypeLock(false);
      setCoupleMode(event.target.value === 'Casal');
      syncKidsNeed();
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
    const firstSpouseMissing = () => [
      ['spouseNome', () => !String(data.get('spouseNome') || '').trim()],
      ['spouseCpf', () => !isValidCpf(data.get('spouseCpf'))],
      ['spouseNascimento', () => !data.get('spouseNascimento')],
      ['spouseTelefone', () => !String(data.get('spouseTelefone') || '').trim()],
      ['genero', () => !spouseGenderValue()],
      ['spouseRetiros', () => !data.getAll('spouseRetiros').length],
      ['spouseDias', () => !data.getAll('spouseDias').length],
    ].find(([, missing]) => missing())?.[0];
    if (embedded && !editingEntry && requireType && !data.get('tipoFicha')) {
      source.querySelector('#form-message')?.replaceChildren('Escolha se esta ficha é Individual ou Casal antes de salvar.');
      focusControl(firstByName('tipoFicha'));
      return false;
    }
    const sectors = data.getAll('setores');
    const days = data.getAll('dias');
    const required = ['cpf', 'genero', 'retiros', 'contribuicao', ...(requireType ? ['tipoFicha'] : [])].filter((name) => source.elements[name]);
    const kidsNotNeeded = data.get('kidsNotNeeded') === 'on';
    const kids = kidsNotNeeded ? [] : Array.from({ length: 5 }, (_, index) => ({ nome: String(data.get(`kidNome${index + 1}`) || '').trim(), nascimento: String(data.get(`kidNascimento${index + 1}`) || '').trim() })).filter((kid) => kid.nome || kid.nascimento);
    const hasKidsChoice = kidsNotNeeded || kids.length > 0;
    const hasIncompleteKid = !kidsNotNeeded && kids.some((kid) => !kid.nome || !kid.nascimento);
    const spouseValid = !isCouple() || (String(data.get('spouseNome') || '').trim() && isValidCpf(data.get('spouseCpf')) && data.get('spouseNascimento') && String(data.get('spouseTelefone') || '').trim() && spouseGenderValue() && data.getAll('spouseRetiros').length && data.getAll('spouseDias').length);
    const firstInvalid = source.querySelector(':invalid');
    const browserValid = source.checkValidity();
    const missingRequired = required.filter((name) => !data.get(name));
    const valid = browserValid && (!requireSector || sectors.length) && days.length && !missingRequired.length && hasKidsChoice && !hasIncompleteKid && spouseValid;
    if (!valid) {
      const labels = { genero: 'gênero', retiros: 'retiro(s) que fez', contribuicao: 'valor da inscrição', tipoFicha: 'Individual ou Casal' };
      const missing = [
        ...(!browserValid ? ['campos marcados com *'] : []),
        ...(requireSector && !sectors.length ? ['setor de trabalho'] : []),
        ...(!days.length ? ['dias que vai trabalhar'] : []),
        ...missingRequired.map((name) => labels[name] || name),
      ];
      let message = missing.length ? `Revise: ${[...new Set(missing)].join(', ')}.` : 'Revise os campos obrigatórios.';
      if (!hasKidsChoice) message = 'No Espaço Kids, marque que não necessita ou informe pelo menos uma criança com nome e data de nascimento.';
      else if (hasIncompleteKid) message = 'No Espaço Kids, preencha nome e data de nascimento de cada criança informada.';
      else if (isCouple() && !spouseValid) message = 'Em cadastro de casal, preencha também os dados, retiros e dias do segundo cônjuge.';
      source.querySelector('#form-message')?.replaceChildren(message);
      const candidateControls = [
        firstInvalid,
        ...missingRequired.map(firstByName),
        !days.length ? firstByName('dias') : null,
        requireSector && !sectors.length ? firstByName('setores') : null,
        !hasKidsChoice ? firstByName('kidsNotNeeded') || firstByName('kidNome1') : null,
        hasIncompleteKid ? firstIncompleteKid() : null,
        isCouple() && !spouseValid ? firstByName(firstSpouseMissing()) : null,
      ].filter(Boolean);
      const nextControl = candidateControls.sort((first, second) => first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1)[0];
      focusControl(nextControl);
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
    Object.assign(person, { id: cpf, cpf, nome, nomeNormalizado: nome.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '), nascimento: data.get(fieldName('nascimento')), genero: prefix === 'spouse' ? spouseGenderValue() : data.get(fieldName('genero')), telefone: data.get(fieldName('telefone')), endereco: data.get('endereco'), numero: data.get('numero'), bairro: data.get('bairro'), cep: data.get('cep'), cidade: data.get('cidade'), estado: String(data.get('estado') || '').toUpperCase(), updatedAt: new Date().toISOString() });
    await dataService.savePessoa(person);
    const coordenacaoSetor = embedded ? data.get('coordenacaoSetor') === 'sim' : Boolean(existingEntry?.coordenacaoSetor);
    const quadrante = data.get('quadrante') === 'Sim' ? 'Sim' : 'Não';
    const foto = data.get('foto') === 'Sim' ? 'Sim' : 'Não';
    const contribuicao = currency(volunteerContributionAmount(retreat, { casalId, foto }, parseCurrency(data.get('contribuicao'))));
    await dataService.saveAdesao({ ...(existingEntry || {}), id: existingEntry?.id || crypto.randomUUID(), retiroId: id, pessoaId: person.id, nome: person.nome, dadosPessoais: personalDataSnapshot(person), dias: data.getAll(fieldName('dias')), setores: sortSectors(data.getAll('setores')), retirosAnteriores: data.getAll(fieldName('retiros')), quadrante, foto, contribuicao, coordenacao: form.elements.coordenacao ? data.get('coordenacao') : (existingEntry?.coordenacao || ''), coordenacaoSetor, espacoKids: kids, espacoKidsNaoNecessito: kidsNotNeeded, observacao: data.get('observacao'), tipoFicha: 'Individual', casalId, papelNoCasal, status: existingEntry?.status || 'pendente_validacao', enviadoEm: existingEntry?.enviadoEm || new Date().toISOString(), atualizadoEm: new Date().toISOString() });
    if (previousPersonId) {
      const entriesToMigrate = (await dataService.listAdesoes()).filter((item) => item.pessoaId === previousPersonId);
      await Promise.all(entriesToMigrate.map((entry) => dataService.saveAdesao({ ...entry, pessoaId: cpf, nome: entry.nome || nome })));
      await dataService.deletePessoa(previousPersonId);
    }
    return person;
  };
  const showSuccess = (name) => { mount.innerHTML = `<main class="public-shell"><section class="success-card"><div class="success-icon">✓</div><h1>Cadastro recebido!</h1><p>Obrigado, ${escapeHtml(name)}. Sua participação foi registrada para ${escapeHtml(retreat.nome)}.</p></section></main>`; };
  const finishSave = async (name) => {
    if (!embedded) { showSuccess(name); return; }
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
  let publicConfirmationReady = false;
  const reviewValue = (value) => escapeHtml(value || 'Não informado');
  const reviewList = (values) => reviewValue(values.length ? values.join(', ') : '');
  const reviewRow = (label, value) => `<div><strong>${escapeHtml(label)}</strong><span>${value}</span></div>`;
  const showPublicConfirmation = () => {
    const data = new FormData(form);
    const kidsNotNeeded = data.get('kidsNotNeeded') === 'on';
    const kids = kidsNotNeeded ? [] : Array.from({ length: 5 }, (_, index) => ({ nome: String(data.get(`kidNome${index + 1}`) || '').trim(), nascimento: String(data.get(`kidNascimento${index + 1}`) || '').trim() })).filter((kid) => kid.nome || kid.nascimento);
    const section = document.createElement('section');
    section.className = 'registration-review';
    section.innerHTML = `<div class="section-heading"><span>✓</span><div><h2 class="review-alert-title">Revise os seus dados antes de confirmar a inscrição</h2><p>Confira todos os dados antes de enviar sua inscrição para a coordenação.</p></div></div>
      <div class="review-group"><h3>Seus dados</h3><div class="review-list">
        ${reviewRow('CPF', reviewValue(formatCpf(data.get('cpf'))))}
        ${reviewRow('Nome completo', reviewValue(data.get('nome')))}
        ${reviewRow('Data de nascimento', reviewValue(date(data.get('nascimento'))))}
        ${reviewRow('Telefone', reviewValue(data.get('telefone')))}
        ${reviewRow('Gênero', reviewValue(data.get('genero')))}
        ${reviewRow('Ficha', reviewValue(data.get('tipoFicha')))}
      </div></div>
      ${isCouple() ? `<div class="review-group"><h3>Segundo cônjuge</h3><div class="review-list">
        ${reviewRow('CPF', reviewValue(formatCpf(data.get('spouseCpf'))))}
        ${reviewRow('Nome completo', reviewValue(data.get('spouseNome')))}
        ${reviewRow('Data de nascimento', reviewValue(date(data.get('spouseNascimento'))))}
        ${reviewRow('Telefone', reviewValue(data.get('spouseTelefone')))}
        ${reviewRow('Gênero', reviewValue(spouseGenderValue()))}
        ${reviewRow('Retiro(s) que fez', reviewList(data.getAll('spouseRetiros')))}
        ${reviewRow('Dias que vai trabalhar', reviewList(data.getAll('spouseDias')))}
      </div></div>` : ''}
      <div class="review-group"><h3>Participação</h3><div class="review-list">
        ${reviewRow('Retiro(s) que fez', reviewList(data.getAll('retiros')))}
        ${reviewRow('Dias que vai trabalhar', reviewList(data.getAll('dias')))}
        ${reviewRow('Setor de trabalho', reviewList(data.getAll('setores')))}
        ${reviewRow('Quadrante impresso', reviewValue(data.get('quadrante') === 'Sim' ? 'Sim' : 'Não'))}
        ${reviewRow('Foto', reviewValue(data.get('foto') === 'Sim' ? 'Sim' : 'Não'))}
        ${reviewRow('Valor da inscrição', reviewValue(data.get('contribuicao')))}
      </div></div>
      <div class="review-group"><h3>Endereço</h3><div class="review-list">
        ${reviewRow('CEP', reviewValue(data.get('cep')))}
        ${reviewRow('Rua / Avenida', reviewValue(data.get('endereco')))}
        ${reviewRow('Número', reviewValue(data.get('numero')))}
        ${reviewRow('Bairro', reviewValue(data.get('bairro')))}
        ${reviewRow('Cidade', reviewValue(data.get('cidade')))}
        ${reviewRow('Estado', reviewValue(data.get('estado')))}
      </div></div>
      <div class="review-group"><h3>Informações adicionais</h3><div class="review-list">
        ${reviewRow('Espaço Kids', kidsNotNeeded ? 'Não necessito do Espaço Kids' : reviewValue(kids.map((kid) => `${kid.nome} (${date(kid.nascimento)})`).join(', ')))}
        ${reviewRow('Observação', reviewValue(data.get('observacao')))}
      </div></div>
      <div class="review-actions"><button type="button" id="back-to-registration">Voltar ao cadastro</button><button type="button" id="confirm-registration">Confirmar e enviar inscrição</button></div>`;
    form.hidden = true;
    mount.querySelector('.registration-review')?.remove();
    form.after(section);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.querySelector('#back-to-registration').addEventListener('click', () => {
      section.remove();
      form.hidden = false;
      publicConfirmationReady = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    section.querySelector('#confirm-registration').addEventListener('click', () => {
      publicConfirmationReady = true;
      form.requestSubmit();
    });
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    syncContributionAmount();
    if (!validateForm(form)) return;
    if (await blockPublicCpfIssues()) return;
    if (!embedded && !publicConfirmationReady) {
      showPublicConfirmation();
      return;
    }
    publicConfirmationReady = false;
    if (isCouple()) {
      const casalId = editingEntry?.casalId || crypto.randomUUID();
      const first = await saveForm(form, casalId, 'Primeira pessoa', editingEntry);
      const second = await saveForm(form, casalId, 'Segunda pessoa', editingSpouseEntry, 'spouse');
      await linkCouplePeople(first, second, casalId);
      await finishSave(first.nome);
      return;
    }
    if (editingEntry?.casalId) {
      const spouseEntry = editingSpouseEntry || enrolments.find((item) => item.casalId === editingEntry.casalId && item.retiroId === editingEntry.retiroId && item.pessoaId !== editingEntry.pessoaId);
      if (spouseEntry) {
        await dataService.deleteAdesao(spouseEntry.id);
      }
    }
    const person = await saveForm(form, null, null, editingEntry);
    await finishSave(person.nome);
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
  const retreatChecks = allRetreats.map((retreat) => `<label class="access-check"><input type="checkbox" name="retiroIds" value="${escapeHtml(retreat.id)}"><span>${escapeHtml(retreat.nome)}</span></label>`).join('');
  const permissionGroups = Object.entries(groupedPermissions).map(([moduleName, items]) => `<section class="access-permission-group"><h3>${escapeHtml(moduleName)}</h3>${items.map((permission) => `<label class="access-check"><input type="checkbox" name="permission" value="${escapeHtml(permission.id)}"><span><strong>${escapeHtml(permission.id)}</strong><small>${escapeHtml(permission.descricao || '')}</small></span></label>`).join('')}</section>`).join('');
  layout(`<section class="page-heading"><div><p class="eyebrow">Seguranca</p><h1>Usuarios e permissoes</h1><p>Gerencie perfis, acessos por tela e acoes permitidas para cada usuario.</p></div></section>
  <section class="access-layout">
    <article class="panel access-list-panel"><div class="panel-heading"><div><h2>Usuarios</h2><p>${usuarios.length} usuario(s) cadastrado(s) no banco.</p></div><button type="button" id="new-access-user" ${canAccess('usuarios.criar') ? '' : 'disabled'}>Novo usuario</button></div><div class="access-user-list">${userRows || '<p class="empty-state">Nenhum usuario cadastrado no banco.</p>'}</div></article>
    <form id="access-user-form" class="panel access-user-form"><div class="panel-heading"><div><p class="eyebrow">Cadastro</p><h2 id="access-form-title">Novo usuario</h2><p>Senhas sao armazenadas com hash no servidor.</p></div></div><input type="hidden" name="id"><div class="fields two-columns"><label class="field"><span>Nome <b>*</b></span><input name="nome" required></label><label class="field"><span>Login <b>*</b></span><input name="login" autocomplete="username" required></label><label class="field"><span>Senha</span><input name="password" type="password" autocomplete="new-password" placeholder="Obrigatoria para novo usuario"></label><label class="field"><span>Perfil <b>*</b></span><select name="perfilId" required>${profileOptions}</select></label><label class="access-active-option"><input type="checkbox" name="ativo" checked> Usuario ativo</label></div><section class="access-retreats"><h3>Retiros vinculados</h3><p class="hint">Use para Coordenador do retiro. Admin e Coordenador Geral podem ficar sem restricao.</p><div class="access-check-grid">${retreatChecks || '<p class="empty-state">Nenhum retiro cadastrado.</p>'}</div></section><section class="access-permissions"><div class="panel-heading compact-heading"><div><h3>Permissoes do usuario</h3><p>Marque exatamente o que este usuario pode acessar e executar.</p></div><button type="button" id="apply-profile-permissions">Aplicar perfil</button></div><div class="access-permission-grid">${permissionGroups}</div></section><p id="access-message" class="form-message"></p><div class="form-actions"><p>As permissoes sao aplicadas no menu e validadas na API.</p><button type="submit" ${canAccess('usuarios.criar') || canAccess('usuarios.editar') ? '' : 'disabled'}>Salvar usuario <span>→</span></button></div></form>
  </section>`, 'usuarios');
  const form = app.querySelector('#access-user-form');
  const message = app.querySelector('#access-message');
  const applyPermissions = (permissionIds = []) => {
    const selected = new Set(permissionIds);
    form.querySelectorAll('input[name="permission"]').forEach((input) => { input.checked = selected.has(input.value); });
  };
  const profilePermissionIds = (profileId) => perfilPermissoes.filter((item) => item.perfilId === profileId && item.permitido !== false).map((item) => item.permissaoId);
  const clearForm = () => {
    form.reset();
    form.elements.id.value = '';
    form.elements.ativo.checked = true;
    form.elements.password.required = true;
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
        <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
        <p id="login-message" class="form-message">${escapeHtml(message)}</p>
        <button type="submit" class="primary-button">Entrar <span>→</span></button>
      </form>
    </section>
  </main>`;
  const form = app.querySelector('#login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
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
  if (publicRetreatId) return renderPublicForm(publicRetreatId);
  if (!(await ensureAuthenticated())) return renderLogin(location.hash === '#login' ? '' : 'Faca login para acessar a area restrita.');
  const target = location.hash.slice(1) || firstAllowedSection();
  if (target === 'usuarios') return renderUsuarios();
  const section = target.startsWith('retiros/') ? 'retiros' : target.startsWith('pessoas/') ? 'pessoas' : target.startsWith('cursista/') ? 'cursista' : target;
  if (!ensureViewPermission(section)) return;
  await loadData();
  if (target === 'inicio') return renderHome(); if (target === 'retiros') return renderRetiros(); if (target === 'retiros/novo') return canAccess('retiros.criar') ? renderNewRetreat() : renderDenied(); if (target.endsWith('/editar')) return canAccess('retiros.editar') ? renderEditRetreat(target.split('/')[1]) : renderDenied(); if (target.startsWith('retiros/')) return renderRetreat(target.split('/')[1]); if (target === 'validacao-inscricoes') return renderValidacaoInscricoes(); if (target === 'recebedor') return renderRecebedor(); if (target === 'comunidades') return renderComunidades(); if (target === 'crachas') return renderCrachas(); if (target === 'quadrante') return renderQuadrante(); if (target.startsWith('cursista/')) return renderCursistaDetalhe(target.split('/')[1]);
  if (target === 'cursista') {
    await renderCursista(); const form = app.querySelector('#student-form'); const activeRetreat = retreats.find((retreat) => retreat.status === 'publicado') || retreats.find((retreat) => retreat.status === 'preparacao');
    form.noValidate = true; form.reportValidity = () => true;
    form.insertAdjacentHTML('beforeend', `<input type="hidden" name="retiroId" value="${activeRetreat?.id || ''}">`);
    form.elements.valorInscricao.value = currency(activeRetreat?.valorInscricaoCursista);
    const recalculateBalance = () => { const value = Math.max(0, parseCurrency(form.elements.valorInscricao.value) - parseCurrency(form.elements.valorPago.value)); form.elements.saldoPagar.value = currency(value); };
    ['valorInscricao', 'valorPago'].forEach((name) => { form.elements[name].addEventListener('focus', () => { form.elements[name].value = parseCurrency(form.elements[name].value) || ''; }); form.elements[name].addEventListener('input', recalculateBalance); form.elements[name].addEventListener('change', () => { form.elements[name].value = currency(parseCurrency(form.elements[name].value)); recalculateBalance(); }); });
    recalculateBalance();
    const actions = form.querySelector('.form-actions'); actions.insertAdjacentHTML('beforeend', '<button type="button" class="clear-student-form">Limpar tela</button><button type="button" class="delete-student" hidden>Excluir cursista</button>');
    const clearStudentForm = () => { form.reset(); form.querySelectorAll('.field-warning').forEach((item) => item.classList.remove('field-warning')); form.querySelector('input[name="id"]')?.remove(); form.elements.retiroId.value = activeRetreat?.id || ''; form.elements.valorInscricao.value = currency(activeRetreat?.valorInscricaoCursista); form.querySelector('.delete-student').hidden = true; form.querySelector('button[type="submit"]').innerHTML = 'Salvar cadastro <span>→</span>'; form.querySelector('#student-message').textContent = ''; recalculateBalance(); form.elements.cpf.focus(); };
    const deleteStudentRecord = async (id) => { if (!id || !confirm('Excluir este cursista?')) return; const students = await dataService.listCursistas(); const student = students.find((item) => item.id === id) || id; await removeStudentFromCommunities(student); await dataService.deleteCursista(id); clearStudentForm(); form.querySelector('#student-message').textContent = 'Cursista excluído com sucesso.'; };
    const nameField = form.nome.closest('.field'); const cascade = document.createElement('div'); cascade.className = 'person-cascade'; cascade.hidden = true; nameField.append(cascade);
    const loadStudent = (student) => { form.reset(); if (!form.elements.id) form.insertAdjacentHTML('beforeend', '<input type="hidden" name="id">'); Object.entries(student).forEach(([key, value]) => { const field = form.elements[key]; if (!field) return; if (field.type === 'radio') form.querySelectorAll(`[name="${key}"]`).forEach((input) => { input.checked = input.value === value; }); else field.value = value || ''; }); form.elements.retiroId.value = student.retiroId || activeRetreat?.id || ''; form.querySelector('button[type="submit"]').innerHTML = 'Salvar alterações <span>→</span>'; form.querySelector('.delete-student').hidden = false; recalculateBalance(); form.querySelector('#student-message').textContent = 'Editando cadastro de cursista.'; };
    const renderCascade = () => { const term = form.nome.value.trim().toLocaleLowerCase('pt-BR'); dataService.listCursistas().then((students) => { const filtered = students.filter((student) => (!activeRetreat || student.retiroId === activeRetreat.id) && (!term || student.nome.toLocaleLowerCase('pt-BR').includes(term))); cascade.innerHTML = filtered.length ? filtered.map((student) => `<button type="button" data-student-id="${student.id}"><strong>${escapeHtml(student.nome)}</strong><span>${date(student.nascimento)}</span></button>`).join('') : '<p>Nenhum cursista encontrado. Continue para criar um novo cadastro.</p>'; cascade.hidden = false; cascade.querySelectorAll('[data-student-id]').forEach((button) => button.addEventListener('click', async () => { const students = await dataService.listCursistas(); const student = students.find((item) => item.id === button.dataset.studentId); if (student) { loadStudent(student); cascade.hidden = true; } })); }); };
    const closeStudentNameCascade = (event) => { if (!nameField.contains(event.target)) cascade.hidden = true; };
    form.nome.addEventListener('focus', renderCascade); form.nome.addEventListener('input', renderCascade);
    nameField.addEventListener('focusout', (event) => { if (!nameField.contains(event.relatedTarget)) cascade.hidden = true; });
    document.addEventListener('pointerdown', closeStudentNameCascade, true);
    document.addEventListener('focusin', closeStudentNameCascade, true);
    const studentSearchInput = app.querySelector('#student-search');
    const studentSearchResults = app.querySelector('#student-search-results');
    const renderStudentSearch = async () => { const term = normalizeText(studentSearchInput.value); const students = (await dataService.listCursistas()).filter((student) => (!activeRetreat || student.retiroId === activeRetreat.id)).filter((student) => { const cpf = normalizeCpf(student.cpf || student.id); const haystack = normalizeText([student.nome, cpf, cpf && formatCpf(cpf), student.telefone, student.nomePai, student.nomeMae].filter(Boolean).join(' ')); return !term || haystack.includes(term); }).sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR')); studentSearchResults.hidden = false; studentSearchResults.innerHTML = students.length ? students.map((student) => { const cpf = normalizeCpf(student.cpf || student.id); return `<article><div><strong>${escapeHtml(student.nome || 'Sem nome')}</strong><span>${cpf ? formatCpf(cpf) : 'CPF não informado'} · ${escapeHtml(student.telefone || 'Sem telefone')}</span></div><div class="registration-actions"><button type="button" data-student-edit="${student.id}">Editar</button><a href="#cursista/${student.id}">Consultar</a></div></article>`; }).join('') : '<p>Nenhum cursista encontrado neste retiro.</p>'; studentSearchResults.querySelectorAll('[data-student-edit]').forEach((button) => button.addEventListener('click', async () => { const students = await dataService.listCursistas(); const student = students.find((item) => item.id === button.dataset.studentEdit); if (student) { loadStudent(student); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); studentSearchResults.hidden = true; } })); };
    app.querySelector('#new-student').addEventListener('click', clearStudentForm);
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
    form.querySelector('.clear-student-form').addEventListener('click', clearStudentForm);
    form.querySelector('.delete-student').addEventListener('click', () => deleteStudentRecord(form.elements.id?.value));
    return;
  }
  if (target === 'pessoas') { const focusRetreat = retreats.find((retreat) => retreat.status === 'publicado') || retreats.find((retreat) => retreat.status === 'preparacao'); return focusRetreat ? renderPublicForm(focusRetreat.id, true) : renderPessoas(); } if (target.startsWith('pessoas/')) { const [, personId, personRetreatId, source] = target.split('/'); return renderPessoa(personId, personRetreatId, source); } renderHome();
}
document.addEventListener('focusin', (event) => { if (['telefone', 'spouseTelefone', 'telefonePai', 'telefoneMae'].includes(event.target.name)) { event.target.type = 'tel'; event.target.inputMode = 'numeric'; event.target.placeholder = '(00) 00000-0000'; } });
document.addEventListener('input', (event) => { if (!['telefone', 'spouseTelefone', 'telefonePai', 'telefoneMae'].includes(event.target.name)) return; const digits = event.target.value.replace(/\D/g, '').slice(0, 11); event.target.value = digits.length <= 10 ? digits.replace(/^(\d{2})(\d{0,4})(\d{0,4}).*/, (_, area, first, last) => `${area ? `(${area}` : ''}${area.length === 2 ? ') ' : ''}${first}${last ? `-${last}` : ''}`) : digits.replace(/^(\d{2})(\d{0,5})(\d{0,4}).*/, (_, area, first, last) => `(${area}) ${first}${last ? `-${last}` : ''}`); });
window.addEventListener('hashchange', route);
route();





