const { getRecord } = require('./databaseAdapter');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character]));

function pageHtml(retreatId, retreat, origin = '') {
  const name = retreat?.nome || 'Retiro';
  const title = `Cadastro da equipe de trabalho para: ${name}`;
  const canonical = `${String(origin || '').replace(/\/$/, '')}/adesao/${encodeURIComponent(retreatId)}`;
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="stylesheet" href="/styles.css?v=20260713-setores" />
  </head>
  <body><div id="app"></div><script type="module" src="/adminApp.js?v=20260713-setores"></script></body>
</html>`;
}

async function sendPublicRegistrationPage(req, res, retreatId) {
  const id = decodeURIComponent(String(retreatId || '').trim());
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const protocol = req.headers['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');
  const origin = host ? `${protocol}://${host}` : '';
  const retreat = id ? await getRecord('retiros', id).catch(() => null) : null;
  const html = pageHtml(id, retreat, origin);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=300',
  });
  res.end(html);
}

module.exports = { pageHtml, sendPublicRegistrationPage };
