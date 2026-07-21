const { findPublicSectorLink } = require('./publicLinkResolver');
const { getRecord } = require('./databaseAdapter');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character]));

const normalizeText = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const hiddenTeamSectors = new Set(['camareiro(a)', 'camareiros(as)', 'cozinha', 'espaco kids', 'espiritual', 'externo', 'refeitorio', 'secretaria', 'zeladoria']);
const sectorArea = (sector = '') => hiddenTeamSectors.has(normalizeText(sector)) ? 'escondida' : 'sala';
const teamMessageConfigId = 'recado-equipe';
const messageHtml = (value = '') => escapeHtml(value).replace(/\r?\n/g, '<br>');
const sectorRegistrationClosed = (retreat = {}, link = {}, sector = '') => link.inscricoesEncerradas === true
  || (retreat.setoresInscricoesEncerradas || []).some((item) => normalizeText(item) === normalizeText(sector));

function closedInvitePageHtml({ retreat, sector }) {
  const title = `Inscricoes encerradas para o setor ${sector}`;
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      *{box-sizing:border-box}
      body{min-height:100vh;margin:0;display:grid;place-items:center;padding:18px;background:#eaf2ea;color:#26382c;font-family:Arial,sans-serif}
      .invite-card{width:min(480px,100%);padding:30px 26px;border:1px solid #d9cdb7;border-radius:18px;background:#fffdf7;box-shadow:0 24px 70px rgba(54,80,57,.2);text-align:center}
      .invite-card h1{margin:0;color:#203c26;font-family:Georgia,serif;font-size:clamp(26px,7vw,36px);line-height:1.05}
      .invite-card p{margin:14px 0 0;color:#68746b;font-size:15px;line-height:1.5}
      .invite-sector{display:block;margin:18px 0 0;padding:13px 14px;border:1px solid #dfe6dc;border-radius:10px;background:#f6faf3;color:#285130;font-size:18px;font-weight:900}
    </style>
  </head>
  <body>
    <main class="invite-card" aria-labelledby="invite-title">
      <h1 id="invite-title">Inscrições encerradas</h1>
      <p>Inscrições para o setor</p>
      <strong class="invite-sector">${escapeHtml(sector)}</strong>
      <p>estão encerradas.</p>
      <p>${escapeHtml(retreat.nome || 'Retiro')}</p>
    </main>
  </body>
</html>`;
}

function invitePageHtml({ retreat, sector, retreatId, token, origin = '', teamMessage = '' }) {
  const baseOrigin = String(origin || '').replace(/\/$/, '');
  const registrationUrl = `${baseOrigin}/adesao/${encodeURIComponent(retreatId)}?setor=${encodeURIComponent(token)}`;
  const title = `Ficha de inscricao para o setor ${sector} para o ${retreat.nome || 'retiro'}`;
  const isHiddenTeam = sectorArea(sector) === 'escondida';
  const warningLabel = isHiddenTeam ? 'Equipe escondida' : 'Equipe Sala';
  const warningTitle = isHiddenTeam ? 'Atenção, querido(a) servo(a) do Senhor!!' : 'Querido servo do Senhor';
  const defaultWarningText = isHiddenTeam
    ? 'Servindo neste setor, você deve <span class="invite-danger">TOMAR O MÁXIMO DE CUIDADO PARA NÃO SER VISTO POR NENHUM CURSISTA</span>. Evite chegar nos horários em que eles estiverem chegando ou saindo do retiro e estacione seu veículo em um local escondido, principalmente se você tiver algum conhecido fazendo o curso.'
    : 'Neste retiro, você será a imagem do movimento EPC para os cursistas e, mais ainda, será a imagem de Deus para eles. Por isso: sorriso no rosto, cante com determinação, use roupas adequadas, reze muito e seja cordial em todos os momentos.';
  const customWarningText = String(teamMessage || '').trim();
  const warningText = customWarningText ? messageHtml(customWarningText) : defaultWarningText;
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <style>
      *{box-sizing:border-box}
      body{min-height:100vh;margin:0;display:grid;place-items:center;padding:18px;background:#eaf2ea;color:#26382c;font-family:Arial,sans-serif}
      .invite-card{width:min(480px,100%);overflow:hidden;border:1px solid #d9cdb7;border-radius:18px;background:#fffdf7;box-shadow:0 24px 70px rgba(54,80,57,.2)}
      .invite-top{padding:18px 24px;background:#47724e;color:#fff;text-align:center}
      .invite-top .eyebrow{margin:0;color:#eaf4e8;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
      .invite-body{padding:26px 26px 28px;text-align:center}
      .invite-mark{display:grid;place-items:center;width:54px;height:54px;margin:0 auto 14px;border-radius:50%;background:#edf5e9;color:#285130;font-family:Georgia,serif;font-size:22px;font-weight:800}
      .invite-card h1{margin:0;color:#203c26;font-family:Georgia,serif;font-size:clamp(26px,7vw,36px);line-height:1.05}
      .invite-card p{margin:13px 0 0;color:#68746b;font-size:15px;line-height:1.5}
      .invite-retreat{display:block;margin-top:8px;color:#203c26;font-weight:800}
      .invite-sector{display:block;margin:18px 0 0;padding:13px 14px;border:1px solid #dfe6dc;border-radius:10px;background:#f6faf3;color:#285130;font-size:18px;font-weight:900}
      .invite-button{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:50px;margin-top:24px;padding:13px 22px;border-radius:8px;background:#47724e;color:#fff;font-size:16px;font-weight:900;text-decoration:none;box-shadow:0 10px 22px rgba(71,114,78,.24)}
      .invite-button:hover{background:#365e3e}
      .invite-note{margin-top:13px;font-size:12px;color:#68746b}
      .invite-warning-overlay{position:fixed;inset:0;display:none;place-items:center;padding:18px;background:rgba(38,56,44,.6)}
      .invite-warning-overlay.is-open{display:grid}
      .invite-warning-dialog{width:min(460px,100%);padding:24px;border-radius:16px;background:#fffdf7;box-shadow:0 24px 70px rgba(0,0,0,.28);text-align:center}
      .invite-warning-dialog h2{margin:0;color:#203c26;font-family:Georgia,serif;font-size:26px;line-height:1.1}
      .invite-warning-dialog p{margin:12px 0 0;color:#68746b;line-height:1.5}
      .invite-warning-dialog .eyebrow{margin:0 0 10px;color:#47724e;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
      .invite-warning-dialog button{width:100%;min-height:46px;margin-top:20px;border:0;border-radius:8px;background:#47724e;color:#fff;font-size:15px;font-weight:900;cursor:pointer}
      .invite-danger{color:#b94137;font-weight:900}
    </style>
  </head>
  <body>
    <main class="invite-card" aria-labelledby="invite-title">
      <header class="invite-top">
        <p class="eyebrow">Equipe de trabalho</p>
      </header>
      <section class="invite-body">
        <div class="invite-mark" aria-hidden="true">EPC</div>
        <h1 id="invite-title">Ficha de inscrição</h1>
        <p>Setor</p>
        <strong class="invite-sector">${escapeHtml(sector)}</strong>
        <p>no retiro <span class="invite-retreat">${escapeHtml(retreat.nome || 'retiro')}</span></p>
        <a class="invite-button" id="access-registration" href="${escapeHtml(registrationUrl)}">Acessar cadastro</a>
      </section>
    </main>
    <section class="invite-warning-overlay" id="sector-warning" aria-hidden="true">
      <div class="invite-warning-dialog" role="dialog" aria-modal="true" aria-labelledby="sector-warning-title">
        <p class="eyebrow">${escapeHtml(warningLabel)}</p>
        <h2 id="sector-warning-title">${escapeHtml(warningTitle)}</h2>
        <p>${warningText}</p>
        <button type="button" id="continue-registration">Li e entendi</button>
      </div>
    </section>
    <script>
      const registrationUrl = ${JSON.stringify(registrationUrl)};
      const accessButton = document.getElementById('access-registration');
      const warning = document.getElementById('sector-warning');
      const continueButton = document.getElementById('continue-registration');
      accessButton.addEventListener('click', (event) => {
        event.preventDefault();
        warning.classList.add('is-open');
        warning.setAttribute('aria-hidden', 'false');
        continueButton.focus();
      });
      continueButton.addEventListener('click', () => {
        location.href = registrationUrl;
      });
    </script>
  </body>
</html>`;
}

async function sendPublicSectorInvitePage(req, res, retreatId, token) {
  const sectorToken = decodeURIComponent(String(token || retreatId || '').trim());
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const protocol = req.headers['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');
  const origin = host ? `${protocol}://${host}` : '';
  const result = await findPublicSectorLink({ retreatId, token: sectorToken, type: 'cadastro' });
  if (!result) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="pt-BR"><body><h1>Link nao encontrado</h1><p>Confira o link enviado pela equipe.</p></body></html>');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (sectorRegistrationClosed(result.retreat, result.link, result.sector)) {
    res.end(closedInvitePageHtml({ retreat: result.retreat, sector: result.sector }));
    return;
  }
  const setting = await getRecord('configuracoes', teamMessageConfigId).catch(() => null);
  const teamMessage = setting?.mensagens?.[normalizeText(result.sector)] || '';
  res.end(invitePageHtml({ retreat: result.retreat, sector: result.sector, retreatId: result.retreatId, token: result.link.token, origin, teamMessage }));
}

module.exports = { invitePageHtml, sendPublicSectorInvitePage };
