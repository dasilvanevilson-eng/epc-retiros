const { listRecords } = require('./databaseAdapter');
const { findPublicSectorLink, normalizeText } = require('./publicLinkResolver');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character]));

const entryHasSector = (entry = {}, sector = '') => (entry.setores || []).some((item) => normalizeText(item) === normalizeText(sector));
const entryDays = (entry = {}) => (Array.isArray(entry.dias) ? entry.dias : [entry.dias]).map((day) => String(day || '').trim()).filter(Boolean);
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003C');

function sectorPrintPageHtml({ title, retreat, sector, people, daySummary }) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page{size:A4;margin:12mm}
      *{box-sizing:border-box}
      body{margin:0;color:#203c26;background:#fff;font-family:Arial,sans-serif}
      h1{margin:0 0 6px;font-size:24px;line-height:1.12}
      p{margin:0 0 16px;color:#5f685f;font-size:13px;line-height:1.35}
      .eyebrow{margin:0 0 5px;color:#2b76b7;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
      .sector-public-list{margin:16px 0 18px;padding:0;list-style:none;border-top:1px solid #e1d6c5}
      .sector-public-list li{padding:10px 0;border-bottom:1px solid #e1d6c5;break-inside:avoid;page-break-inside:avoid}
      .sector-public-list strong{display:block;font-size:15px;line-height:1.2}
      .sector-public-list span{display:block;margin-top:4px;color:#5f685f;font-size:12px;line-height:1.35}
      .sector-public-summary{margin-top:18px;padding:14px;border:1px solid #d9cdb7;border-radius:8px;background:#fff8ec;break-inside:avoid;page-break-inside:avoid}
      .sector-public-summary h2{margin:0 0 10px;font-size:17px;line-height:1.2}
      .sector-public-summary div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:7px 0;border-top:1px solid #eadcc5}
      .sector-public-summary div:first-of-type{border-top:0}
      .sector-public-summary span{color:#5f685f}
      .sector-public-summary strong{font-weight:800}
      .sector-public-empty{padding:18px 0;color:#5f685f}
    </style>
  </head>
  <body>
    <p class="eyebrow">Acompanhamento do setor</p>
    <h1>${escapeHtml(sector)}</h1>
    <p>${escapeHtml(retreat.nome)} - ${people.length} pessoa(s) inscrita(s) neste setor.</p>
    ${people.length ? `<ul class="sector-public-list">${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><span>Dias de trabalho: ${escapeHtml(person.days.length ? person.days.join(', ') : 'dias nao informados')}</span></li>`).join('')}</ul><section class="sector-public-summary"><h2>Somatorio por dia de trabalho</h2>${daySummary.map((item) => `<div><span>${escapeHtml(item.day)}</span><strong>${item.count} pessoa(s)</strong></div>`).join('')}</section>` : '<div class="sector-public-empty">Nenhuma pessoa inscrita neste setor ate o momento.</div>'}
    <script>
      window.addEventListener('load', () => setTimeout(() => window.print(), 150), { once: true });
    </script>
  </body>
</html>`;
}

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
  const printableReport = sectorPrintPageHtml({ title, retreat, sector, people, daySummary });
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <link rel="stylesheet" href="/styles.css?v=20260713-convite-setor" />
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
      .sector-public-actions{display:flex;justify-content:flex-end;gap:10px}
      .sector-public-close{align-self:flex-end;min-height:42px;padding:10px 16px;border:0;border-radius:8px;background:#315c38;color:white;font-weight:800;cursor:pointer}
      .sector-public-print{align-self:flex-end;min-height:42px;padding:10px 16px;border:1px solid #315c38;border-radius:8px;background:#fff;color:#315c38;font-weight:800;cursor:pointer}
      @media print{
        body{display:block;min-height:auto;padding:0;background:#fff}
        .sector-public-modal{display:block;width:auto;max-height:none;padding:0;border:0;border-radius:0;box-shadow:none}
        .sector-public-list{overflow:visible;margin-bottom:18px}
        .sector-public-summary{break-inside:avoid;page-break-inside:avoid;margin-top:0}
        .sector-public-actions{display:none}
      }
    </style>
  </head>
  <body>
    <section class="sector-public-modal" role="dialog" aria-modal="true" aria-labelledby="sector-title">
      <p class="eyebrow">Acompanhamento do setor</p>
      <h1 id="sector-title">${escapeHtml(sector)}</h1>
      <p>${escapeHtml(retreat.nome)} - ${people.length} pessoa(s) inscrita(s) neste setor.</p>
      ${people.length ? `<ul class="sector-public-list">${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><span>Dias de trabalho: ${escapeHtml(person.days.length ? person.days.join(', ') : 'dias nao informados')}</span></li>`).join('')}</ul><section class="sector-public-summary"><h2>Somatorio por dia de trabalho</h2>${daySummary.map((item) => `<div><span>${escapeHtml(item.day)}</span><strong>${item.count} pessoa(s)</strong></div>`).join('')}</section>` : '<div class="sector-public-empty">Nenhuma pessoa inscrita neste setor ate o momento.</div>'}
      <div class="sector-public-actions">
        <button type="button" class="sector-public-print" id="print-sector-view">Imprimir</button>
        <button type="button" class="sector-public-close" id="close-sector-view">Fechar visualização</button>
      </div>
    </section>
    <script>
      const printableReport = ${scriptJson(printableReport)};
      document.getElementById('print-sector-view').addEventListener('click', () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          window.print();
          return;
        }
        printWindow.document.open();
        printWindow.document.write(printableReport);
        printWindow.document.close();
      });
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
  const sectorToken = decodeURIComponent(String(token || retreatId || '').trim());
  const result = await findPublicSectorLink({ retreatId, token: sectorToken, type: 'acompanhamento' });
  if (!result) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="pt-BR"><body><h1>Link nao encontrado</h1><p>Confira o link enviado pela equipe.</p></body></html>');
    return;
  }
  const entries = (await listRecords('adesoes')).filter((entry) => entry.retiroId === result.retreatId && entryHasSector(entry, result.sector));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(sectorPageHtml({ retreat: result.retreat, sector: result.sector, entries }));
}

module.exports = { sectorPageHtml, sendPublicSectorPage };
