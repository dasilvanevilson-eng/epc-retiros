const { findPublicReceiverRetreat } = require('./publicLinkResolver');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character]));

function receiverPageHtml({ retreat, token }) {
  const title = `Recebedor - ${retreat.nome || 'Retiro'}`;
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <link rel="stylesheet" href="/styles.css?v=20260713-setor-lider" />
    <style>
      .main-nav,.admin-header{display:none!important}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
      window.EPC_PUBLIC_RECEIVER = ${JSON.stringify({ token, retiroId: retreat.id })};
    </script>
    <script type="module" src="/adminApp.js?v=20260713-setor-lider"></script>
  </body>
</html>`;
}

async function sendPublicReceiverPage(req, res, token) {
  const receiverToken = decodeURIComponent(String(token || '').trim());
  const result = await findPublicReceiverRetreat(receiverToken);
  if (!result) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="pt-BR"><body><h1>Link nao encontrado</h1><p>Confira o link enviado pela equipe.</p></body></html>');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(receiverPageHtml({ retreat: result.retreat, token: receiverToken }));
}

module.exports = { receiverPageHtml, sendPublicReceiverPage };
