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
      body{min-height:100vh;margin:0;display:grid;place-items:center;padding:20px;background:#eef4ee;color:#26382c;font-family:Arial,sans-serif}
      .invite-card{width:min(440px,100%);padding:28px;border:1px solid #d9cdb7;border-radius:16px;background:#fffdf7;box-shadow:0 22px 60px rgba(54,80,57,.18);text-align:center}
      .invite-card .eyebrow{margin:0 0 10px;color:#47724e;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
      .invite-card h1{margin:0;color:#203c26;font-family:Georgia,serif;font-size:clamp(25px,7vw,34px);line-height:1.08}
      .invite-card p{margin:14px 0 0;color:#68746b;font-size:15px;line-height:1.5}
      .invite-sector{display:block;margin:18px 0 0;padding:12px;border:1px solid #dfe6dc;border-radius:10px;background:#f6faf3;color:#285130;font-weight:800}
      .invite-button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;margin-top:24px;padding:12px 22px;border-radius:8px;background:#47724e;color:#fff;font-weight:800;text-decoration:none;box-shadow:0 10px 22px rgba(71,114,78,.24)}
      .invite-button:hover{background:#365e3e}
      .invite-note{margin-top:14px;font-size:12px;color:#68746b}
    </style>
  </head>
  <body>
    <main class="invite-card" aria-labelledby="invite-title">
      <p class="eyebrow">Equipe de trabalho</p>
      <h1 id="invite-title">Ficha de inscrição</h1>
      <p>Ficha de inscrição para o setor</p>
      <strong class="invite-sector">${escapeHtml(sector)}</strong>
      <p>para o ${escapeHtml(retreat.nome || 'retiro')}.</p>
      <a class="invite-button" href="${escapeHtml(registrationUrl)}">Clique aqui</a>
      <p class="invite-note">O formulário abrirá somente com este setor disponível.</p>
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
