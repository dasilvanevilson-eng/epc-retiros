const params = new URLSearchParams(location.search);
const legacyAdesao = params.get('adesao');

if (legacyAdesao && (location.pathname.endsWith('/index.html') || location.pathname === '/')) {
  location.replace(`familiaepcindaial.html?adesao=${encodeURIComponent(legacyAdesao)}`);
}

const movements = {
  eja: {
    title: 'EJA',
    subtitle: 'Encontro de Jovens Amigos',
    lead: 'Um espaço de amizade, escuta e fé para jovens que desejam caminhar com Cristo no cotidiano.',
    curiosities: ['Valoriza a convivência em grupo e a descoberta vocacional.', 'Costuma reunir música, partilha, oração e serviço.', 'Ajuda jovens a criarem laços com a comunidade.'],
    history: ['Página preparada para receber fotos antigas, registros dos encontros e testemunhos da caminhada do EJA em Indaial.'],
    logo: 'logo-eja',
    image: 'assets/eja.png',
  },
  'eis-me-aqui': {
    title: 'Eis-me Aqui',
    subtitle: 'Serviço, resposta e missão',
    lead: 'Um chamado para colocar dons a serviço da evangelização, com prontidão, oração e alegria.',
    curiosities: ['O nome lembra a resposta de quem se coloca disponível para servir.', 'A espiritualidade incentiva presença, humildade e responsabilidade.', 'É uma ponte bonita entre oração e ação concreta.'],
    history: ['Este espaço guardará imagens das equipes, momentos de envio e memórias dos serviços realizados.'],
    logo: 'logo-ema',
    image: 'assets/clean/eis-me-aqui-central.png',
  },
  onda: {
    title: 'ONDA',
    subtitle: 'Objetivos Novos do Apostolado',
    lead: 'Movimento de formação e convivência que convida a juventude a renovar objetivos e viver a fé com entusiasmo.',
    curiosities: ['A identidade visual remete ao movimento, à água e à renovação.', 'Trabalha pertencimento, amizade e compromisso cristão.', 'Pode reunir atividades formativas, dinâmicas e celebrações.'],
    history: ['Aqui entrarão fotos históricas, nomes de equipes e lembranças dos encontros ONDA.'],
    logo: 'logo-onda',
    image: 'assets/onda.png',
  },
  epc: {
    title: 'EPC',
    subtitle: 'Encontro de Pais com Cristo',
    lead: 'O coração da família EPC: pais e famílias buscando fortalecer a fé, o matrimônio, a comunidade e a missão.',
    curiosities: ['O movimento acolhe famílias em diferentes momentos da caminhada.', 'A vivência fortalece oração, diálogo e compromisso comunitário.', 'Cada retiro cria uma história que continua depois do encontro.'],
    history: ['Este será o acervo do EPC com fotos de retiros, equipes, coordenações e fatos marcantes.'],
    logo: 'logo-epc',
    image: 'assets/epc.png',
  },
  eju: {
    title: 'EJU',
    subtitle: 'Encontro de Jovens Unidos',
    lead: 'Uma experiência de unidade, alegria e evangelização voltada à juventude de Indaial e região.',
    curiosities: ['A marca destaca pessoas caminhando juntas.', 'A proposta reforça amizade, espiritualidade e serviço.', 'É um caminho para jovens participarem mais da Igreja.'],
    history: ['Neste painel poderão entrar galerias, curiosidades e registros dos encontros do EJU Indaial-SC.'],
    logo: 'logo-eju',
    image: 'assets/eju.png',
  },
  'o-senhor-e-meu-pastor': {
    title: 'O Senhor é meu Pastor',
    subtitle: 'Cuidado, confiança e caminhada',
    lead: 'Uma expressão de fé que recorda o cuidado de Cristo por cada pessoa e por toda a comunidade.',
    curiosities: ['A imagem pastoral fala de proteção e orientação.', 'É uma referência direta à confiança em Deus.', 'Combina muito com momentos de acolhida e espiritualidade.'],
    history: ['Espaço reservado para imagens devocionais, histórias e lembranças ligadas a esta inspiração.'],
    logo: 'logo-pastor',
    image: 'assets/pastor.png',
  },
  girassol: {
    title: 'Girassol',
    subtitle: 'Ama pra valer',
    lead: 'Um sinal de alegria, cuidado e presença amorosa na missão de evangelizar.',
    curiosities: ['O girassol lembra luz, direção e esperança.', 'A frase “Ama pra valer” reforça serviço com afeto concreto.', 'É uma identidade visual muito acolhedora para ações com crianças, jovens e famílias.'],
    history: ['Aqui poderão ser publicadas fotos, atividades e histórias do Girassol na família EPC.'],
    logo: 'logo-girassol',
    image: 'assets/girassol.png',
  },
  'nossa-senhora': {
    title: 'Nossa Senhora',
    subtitle: 'Caminhando com Cristo e Maria',
    lead: 'Presença materna no centro da nossa caminhada, inspirando acolhida, oração e perseverança.',
    curiosities: ['A imagem central recorda a proteção de Maria sobre a família EPC.', 'As rosas simbolizam carinho, beleza e entrega.', 'O centro visual da página aponta para a espiritualidade que sustenta todo o trabalho.'],
    history: ['Este espaço poderá reunir imagens, devoções, celebrações marianas e memórias de fé da comunidade.'],
    logo: 'logo-maria',
    image: 'assets/clean/eis-me-aqui-central.png',
  },
};

function markMissingImages() {
  document.querySelectorAll('.movement-image, .main-devotion img, .detail-logo-image').forEach((image) => {
    const markMissing = () => image.classList.add('is-missing');
    const markLoaded = () => image.classList.remove('is-missing');
    image.addEventListener('error', markMissing, { once: true });
    image.addEventListener('load', markLoaded, { once: true });
    if (image.complete && !image.naturalWidth) markMissing();
  });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function publicApi(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || 'Nao foi possivel acessar a area restrita.');
  }
  if (response.status === 204) return null;
  return response.json();
}

function openRestrictedLogin() {
  document.querySelector('.public-login-overlay')?.remove();
  const overlay = document.createElement('section');
  overlay.className = 'public-login-overlay';
  overlay.innerHTML = `
    <div class="public-login-dialog" role="dialog" aria-modal="true" aria-label="Login da area restrita">
      <button type="button" class="public-login-close" aria-label="Fechar">×</button>
      <form id="public-login-form">
        <label><span>Login</span><input name="username" autocomplete="username" required></label>
        <label><span>Senha</span><div class="password-field"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="password-toggle" data-password-toggle aria-label="Mostrar senha" title="Mostrar senha">👁</button></div></label>
        <p class="public-login-message" aria-live="polite"></p>
        <button type="submit">Entrar</button>
      </form>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  overlay.querySelector('.public-login-close').addEventListener('click', close);
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  overlay.querySelector('[data-password-toggle]').addEventListener('click', (event) => {
    const button = event.currentTarget;
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
  overlay.querySelector('#public-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector('.public-login-message');
    button.disabled = true;
    message.textContent = 'Validando acesso...';
    try {
      await publicApi('/auth/login', { method: 'POST', body: JSON.stringify({ username: form.elements.username.value.trim(), password: form.elements.password.value }) });
      location.href = 'familiaepcindaial.html?v=20260709-restrita-timeout#inicio';
    } catch (error) {
      message.textContent = error.message || 'Login ou senha invalidos.';
      button.disabled = false;
    }
  });
  document.body.append(overlay);
  overlay.querySelector('input[name="username"]').focus();
}

function setupRestrictedAccessLinks() {
  document.querySelectorAll('a[href^="familiaepcindaial.html"]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        const session = await publicApi('/auth/session');
        if (session.authenticated) {
          location.href = 'familiaepcindaial.html?v=20260709-restrita-timeout#inicio';
          return;
        }
      } catch {}
      openRestrictedLogin();
    });
  });
}

function renderMovementPage() {
  const mount = document.querySelector('#movement-page');
  if (!mount) return;
  const id = params.get('id') || 'epc';
  const item = movements[id] || movements.epc;
  document.title = `${item.title} - Família EPC`;
  mount.innerHTML = `
    <section class="movement-detail">
      <nav class="detail-nav">
        <a href="index.html">Voltar</a>
      </nav>
      <aside class="construction-warning" role="note">
        Esse sistema está em construção e os dados constantes nesta página são fictícios.
      </aside>
      <header class="detail-hero">
        <span class="detail-logo">
          <img class="detail-logo-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" />
        </span>
        <div>
          <p class="detail-kicker">Família EPC - Indaial</p>
          <h1>${escapeHtml(item.title)}</h1>
          <p>${escapeHtml(item.lead)}</p>
        </div>
      </header>
      <section class="detail-grid">
        <article>
          <h2>Informações</h2>
          <p>${escapeHtml(item.subtitle)}</p>
          <p>Esta página foi criada para divulgar o trabalho, reunir informações do movimento e organizar memórias para consulta pública.</p>
        </article>
        <article>
          <h2>Curiosidades</h2>
          <ul>${item.curiosities.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
        </article>
        <article class="wide">
          <h2>Histórico de imagens do retiro</h2>
          <p>${escapeHtml(item.history[0])}</p>
          <div class="photo-placeholder">
            <span>Galeria em preparação</span>
            <small>Fotos, legendas, datas e histórias poderão ser adicionadas aqui.</small>
          </div>
        </article>
      </section>
    </section>`;
}

renderMovementPage();
markMissingImages();
setupRestrictedAccessLinks();
