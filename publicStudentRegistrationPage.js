const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));

function publicStudentRegistrationPageHtml(token = '', fileNumber = '') {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Cadastro de cursista</title>
    <link rel="stylesheet" href="/styles.css?v=20260806-cursista-ficha" />
  </head>
  <body data-public-student-token="${escapeHtml(token)}" data-public-student-file-number="${escapeHtml(fileNumber)}">
    <div id="app"><main class="public-student-shell"><section class="panel"><p>Carregando cadastro...</p></section></main></div>
    <script type="module" src="/publicStudentApp.js?v=20260806-cursista-ficha"></script>
  </body>
</html>`;
}

async function sendPublicStudentRegistrationPage(req, res, token, fileNumber = '') {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(publicStudentRegistrationPageHtml(
    decodeURIComponent(String(token || '').trim()),
    String(fileNumber || '').trim(),
  ));
}

module.exports = { publicStudentRegistrationPageHtml, sendPublicStudentRegistrationPage };
