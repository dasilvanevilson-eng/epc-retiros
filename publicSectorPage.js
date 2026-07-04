const { getRecord, listRecords } = require('./databaseAdapter');

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

const entryHasSector = (entry = {}, sector = '') => (entry.setores || []).some((item) => normalizeText(item) === normalizeText(sector));

function sectorPageHtml({ retreat, sector, entries }) {
  const title = `Inscritos do setor ${sector} - ${retreat.nome}`;
  const names = entries
    .map((entry) => String(entry.nome || '').trim())
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second, 'pt-BR', { sensitivity: 'base' }));
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/styles.css" />
    <style>
      body{min-height:100vh;display:grid;place-items:center;padding:18px;background:#eef4ee;font-family:'DM Sans',sans-serif}
      .sector-public-modal{width:min(560px,100%);max-height:calc(100vh - 36px);display:flex;flex-direction:column;padding:24px;border:1px solid #d9cdb7;border-radius:14px;background:#fffdf7;box-shadow:0 24px 70px rgba(54,80,57,.2)}
      .sector-public-modal h1{margin:0;font:700 28px 'Fraunces',serif;line-height:1.08;color:#203c26}
      .sector-public-modal p{margin:8px 0 0;color:#6c7469;line-height:1.45}
      .sector-public-list{overflow-y:auto;margin:18px 0;padding:0;border-top:1px solid #e7ddca;border-bottom:1px solid #e7ddca}
      .sector-public-list li{list-style:none;padding:12px 4px;border-bottom:1px solid #eee6d8;color:#203c26;font-weight:700}
      .sector-public-list li:last-child{border-bottom:0}
      .sector-public-empty{padding:18px 4px;color:#6c7469}
      .sector-public-close{align-self:flex-end;min-height:42px;padding:10px 16px;border:0;border-radius:8px;background:#315c38;color:white;font-weight:800;cursor:pointer}
    </style>
  </head>
  <body>
    <section class="sector-public-modal" role="dialog" aria-modal="true" aria-labelledby="sector-title">
      <p class="eyebrow">Acompanhamento do setor</p>
      <h1 id="sector-title">${escapeHtml(sector)}</h1>
      <p>${escapeHtml(retreat.nome)} - ${names.length} pessoa(s) inscrita(s) neste setor.</p>
      ${names.length ? `<ul class="sector-public-list">${names.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>` : '<div class="sector-public-empty">Nenhuma pessoa inscrita neste setor ate o momento.</div>'}
      <button type="button" class="sector-public-close" id="close-sector-view">Fechar visualização</button>
    </section>
    <script>
      document.getElementById('close-sector-view').addEventListener('click', () => {
        if (window.opener) {
          window.close();
          return;
        }
        if (history.length > 1) {
          history.back();
          return;
        }
        document.querySelector('.sector-public-modal').setAttribute('hidden', '');
      });
    </script>
  </body>
</html>`;
}

async function sendPublicSectorPage(req, res, retreatId, token) {
  const id = decodeURIComponent(String(retreatId || '').trim());
  const sectorToken = decodeURIComponent(String(token || '').trim());
  const retreat = id ? await getRecord('retiros', id).catch(() => null) : null;
  const link = (retreat?.linksSetores || retreat?.setorLinks || []).find((item) => item.token === sectorToken);
  if (!retreat || !link) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="pt-BR"><body><h1>Link nao encontrado</h1><p>Confira o link enviado pela equipe.</p></body></html>');
    return;
  }
  const entries = (await listRecords('adesoes')).filter((entry) => entry.retiroId === id && entryHasSector(entry, link.setor));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(sectorPageHtml({ retreat, sector: link.setor, entries }));
}

module.exports = { sectorPageHtml, sendPublicSectorPage };
