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
const entryDays = (entry = {}) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).map((day) => String(day || '').trim()).filter(Boolean);

function sectorPageHtml({ retreat, sector, entries }) {
  const title = `Inscritos do setor ${sector} - ${retreat.nome}`;
  const people = entries
    .map((entry) => ({ name: String(entry.nome || '').trim(), days: entryDays(entry) }))
    .filter((entry) => entry.name)
    .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' }));
  const configuredDays = Array.isArray(retreat.dias) && retreat.dias.length
    ? retreat.dias
    : [...new Set(people.flatMap((entry) => entry.days))];
  const daySummary = configuredDays
    .map((day) => ({ day, count: people.filter((entry) => entry.days.some((entryDay) => normalizeText(entryDay) === normalizeText(day))).length }))
    .filter((item) => item.day);
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <link rel="stylesheet" href="/styles.css?v=20260709-publico" />
    <style>
      body{min-height:100vh;display:grid;place-items:center;padding:18px;background:#eef4ee;font-family:'DM Sans',sans-serif}
      .sector-public-modal{width:min(560px,100%);max-height:calc(100vh - 36px);display:flex;flex-direction:column;padding:24px;border:1px solid #d9cdb7;border-radius:14px;background:#fffdf7;box-shadow:0 24px 70px rgba(54,80,57,.2)}
      .sector-public-modal h1{margin:0;font:700 28px 'Fraunces',serif;line-height:1.08;color:#203c26}
      .sector-public-modal p{margin:8px 0 0;color:#6c7469;line-height:1.45}
      .sector-public-list{overflow-y:auto;margin:18px 0;padding:0;border-top:1px solid #e7ddca;border-bottom:1px solid #e7ddca}
      .sector-public-list li{list-style:none;padding:12px 4px;border-bottom:1px solid #eee6d8;color:#203c26}
      .sector-public-list li:last-child{border-bottom:0}
      .sector-public-list strong{display:block;font-weight:800}
      .sector-public-list span{display:block;margin-top:4px;color:#6c7469;font-size:13px;line-height:1.4}
      .sector-public-summary{margin:0 0 18px;padding:14px;border:1px solid #e7ddca;border-radius:10px;background:#fff8ec}
      .sector-public-summary h2{margin:0 0 10px;font:700 17px 'Fraunces',serif;color:#203c26}
      .sector-public-summary div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:7px 0;border-top:1px solid #eee0c8;color:#203c26}
      .sector-public-summary div:first-of-type{border-top:0}
      .sector-public-summary span{color:#6c7469}
      .sector-public-summary strong{font-weight:800}
      .sector-public-empty{padding:18px 4px;color:#6c7469}
      .sector-public-close{align-self:flex-end;min-height:42px;padding:10px 16px;border:0;border-radius:8px;background:#315c38;color:white;font-weight:800;cursor:pointer}
    </style>
  </head>
  <body>
    <section class="sector-public-modal" role="dialog" aria-modal="true" aria-labelledby="sector-title">
      <p class="eyebrow">Acompanhamento do setor</p>
      <h1 id="sector-title">${escapeHtml(sector)}</h1>
      <p>${escapeHtml(retreat.nome)} - ${people.length} pessoa(s) inscrita(s) neste setor.</p>
      ${people.length ? `<ul class="sector-public-list">${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.days.length ? person.days.join(', ') : 'Dias não informados')}</span></li>`).join('')}</ul><footer class="sector-public-summary"><h2>Resumo por dia</h2>${daySummary.map((item) => `<div><span>${escapeHtml(item.day)}</span><strong>${item.count} pessoa(s)</strong></div>`).join('')}</footer>` : '<div class="sector-public-empty">Nenhuma pessoa inscrita neste setor ate o momento.</div>'}
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
