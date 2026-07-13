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

function invitePageHtml({ retreat, sector, retreatId, token, origin = '' }) {
  const baseOrigin = String(origin || '').replace(/\/$/, '');
  const registrationUrl = `${baseOrigin}/adesao/${encodeURIComponent(retreatId)}?setor=${encodeURIComponent(token)}`;
  const title = `Ficha de inscricao para o setor ${sector} para o ${retreat.nome || 'retiro'}`;
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
        <p>Você foi convidado(a) para servir no setor</p>
        <strong class="invite-sector">${escapeHtml(sector)}</strong>
        <p>no retiro <span class="invite-retreat">${escapeHtml(retreat.nome || 'retiro')}</span></p>
        <a class="invite-button" href="${escapeHtml(registrationUrl)}">Acessar cadastro</a>
        <p class="invite-note">O formulário abrirá somente com este setor disponível.</p>
      </section>
    </main>
  </body>
</html>`;
}

async function sendPublicSectorInvitePage(req, res, retreatId, token) {
  const id = decodeURIComponent(String(retreatId || '').trim());
  const sectorToken = decodeURIComponent(String(token || '').trim());
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const protocol = req.headers['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');
  const origin = host ? `${protocol}://${host}` : '';
  const retreat = id ? await getRecord('retiros', id).catch(() => null) : null;
  const link = (retreat?.linksSetores || retreat?.setorLinks || []).find((item) => item.token === sectorToken);
  const activeSector = link && (retreat.setores || []).find((sector) => normalizeText(sector) === normalizeText(link.setor || link.sector));
  if (!retreat || !link || !activeSector) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="pt-BR"><body><h1>Link nao encontrado</h1><p>Confira o link enviado pela equipe.</p></body></html>');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(invitePageHtml({ retreat, sector: activeSector, retreatId: id, token: sectorToken, origin }));
}

module.exports = { invitePageHtml, sendPublicSectorInvitePage };
