const { listCursistasEpc, listCursistasSmp, listRecords } = require('./databaseAdapter');
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
const registrationRetreatOrder = ['Taschinha', 'Girassol', 'Onda', 'EJA', 'EJU', 'EPC', 'SMP', 'Eis-me aqui'];
const registrationRetreatOrderIndex = new Map(registrationRetreatOrder.map((retreat, index) => [normalizeText(retreat), index]));
const entryRetreatsDone = (entry = {}) => (Array.isArray(entry.retirosAnteriores) ? entry.retirosAnteriores : [entry.retirosAnteriores])
  .map((retreat, index) => ({ name: String(retreat || '').trim(), index }))
  .filter((retreat) => retreat.name)
  .sort((first, second) => {
    const firstOrder = registrationRetreatOrderIndex.has(normalizeText(first.name)) ? registrationRetreatOrderIndex.get(normalizeText(first.name)) : registrationRetreatOrder.length + first.index;
    const secondOrder = registrationRetreatOrderIndex.has(normalizeText(second.name)) ? registrationRetreatOrderIndex.get(normalizeText(second.name)) : registrationRetreatOrder.length + second.index;
    return firstOrder - secondOrder;
  })
  .map((retreat) => retreat.name);
const personRetreatsDoneText = (person = {}) => person.retreatsDone?.length ? person.retreatsDone.join(', ') : 'nao informado';
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003C');
const intoleranceSectors = new Set(['animacao/jovem de sala', 'cozinha']);
const supportsIntoleranceView = (sector = '') => intoleranceSectors.has(normalizeText(sector));
const hasIntolerance = (answer, detail) => answer === true || normalizeText(answer) === 'sim' || String(detail || '').trim().length > 0;
const memberCommunity = (communities, memberField, identifiers = []) => {
  const expected = new Set(identifiers.map((value) => String(value || '').trim()).filter(Boolean));
  const community = communities.find((item) => (item[memberField] || []).some((value) => expected.has(String(value || '').trim())));
  return String(community?.nome || '').trim() || 'Sem comunidade';
};

function buildIntoleranceRows({ retreat, individualStudents = [], smpStudents = [], epcStudents = [], communities = [] }) {
  const retreatCommunities = communities.filter((community) => community.retiroId === retreat.id);
  let rows = [];
  if ((retreat.tipoFichaCursista || 'cursista-individual') === 'cursista-individual') {
    rows = individualStudents.filter((student) => student.retiroId === retreat.id && hasIntolerance(student.intoleranciaAlimentos, student.qualIntolerancia)).map((student) => ({
      name: String(student.nome || '').trim() || 'Nome n\u00e3o informado',
      community: memberCommunity(retreatCommunities, 'membroIds', [student.id, student.cpf]),
      intolerance: String(student.qualIntolerancia || '').trim() || 'Intoler\u00e2ncia n\u00e3o detalhada',
    }));
  } else {
    const isEpc = retreat.tipoFichaCursista === 'cursista-epc';
    const memberField = isEpc ? 'membroEpcIds' : 'membroSmpIds';
    const records = isEpc ? epcStudents : smpStudents;
    records.filter((record) => record.retiroId === retreat.id).forEach((record) => {
      const identifiers = [record.id, record.numeroFichaSmp];
      const community = memberCommunity(retreatCommunities, memberField, identifiers);
      [
        { name: record.nomeDele, answer: record.intoleranciaAlimentarDele, detail: record.qualIntoleranciaAlimentarDele },
        { name: record.nomeDela, answer: record.intoleranciaAlimentarDela, detail: record.qualIntoleranciaAlimentarDela },
      ].filter((person) => hasIntolerance(person.answer, person.detail)).forEach((person) => rows.push({
        name: String(person.name || '').trim() || 'Nome n\u00e3o informado',
        community,
        intolerance: String(person.detail || '').trim() || 'Intoler\u00e2ncia n\u00e3o detalhada',
      }));
    });
  }
  return rows.sort((first, second) => first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' }));
}

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
    ${people.length ? `<ul class="sector-public-list">${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><span>Retiros que fez: ${escapeHtml(personRetreatsDoneText(person))}</span><span>Dias de trabalho: ${escapeHtml(person.days.length ? person.days.join(', ') : 'dias nao informados')}</span></li>`).join('')}</ul><section class="sector-public-summary"><h2>Somatorio por dia de trabalho</h2>${daySummary.map((item) => `<div><span>${escapeHtml(item.day)}</span><strong>${item.count} pessoa(s)</strong></div>`).join('')}</section>` : '<div class="sector-public-empty">Nenhuma pessoa inscrita neste setor ate o momento.</div>'}
    <script>
      window.addEventListener('load', () => setTimeout(() => window.print(), 150), { once: true });
    </script>
  </body>
</html>`;
}

function intolerancePrintPageHtml({ retreat, sector, intolerances, intoleranceLoadError = '' }) {
  const title = `Intoler\u00e2ncia alimentar dos cursistas - ${retreat.nome}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#203c26;background:#fff;font-family:Arial,sans-serif}h1{margin:0 0 6px;font-size:24px}p{margin:0 0 16px;color:#5f685f;font-size:13px}.eyebrow{margin:0 0 5px;color:#2b76b7;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.intolerance-list{margin:16px 0;padding:0;list-style:none;border-top:1px solid #e1d6c5}.intolerance-list li{padding:10px 0;border-bottom:1px solid #e1d6c5;break-inside:avoid}.intolerance-list strong,.intolerance-list span,.intolerance-list small{display:block}.intolerance-list span{margin-top:4px;color:#203c26;font-size:13px}.intolerance-list small{margin-top:3px;color:#5f685f}.sector-public-empty{padding:18px 0;color:#5f685f}</style></head><body><p class="eyebrow">Acompanhamento do setor ${escapeHtml(sector)}</p><h1>Intoler&acirc;ncia alimentar dos cursistas</h1>${intoleranceLoadError ? `<div class="sector-public-empty">${escapeHtml(intoleranceLoadError)}</div>` : `<p>${escapeHtml(retreat.nome)} - ${intolerances.length} cursista(s) com intoler&acirc;ncia informada.</p>${intolerances.length ? `<ul class="intolerance-list">${intolerances.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.intolerance)}</span><small>Comunidade: ${escapeHtml(person.community)}</small></li>`).join('')}</ul>` : '<div class="sector-public-empty">Nenhum cursista com intoler&acirc;ncia alimentar informada neste retiro.</div>'}`}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150),{once:true});</script></body></html>`;
}

function sectorPageHtml({ retreat, sector, entries, intolerances = [], intoleranceLoadError = '', showIntoleranceView = supportsIntoleranceView(sector) }) {
  const title = `Inscritos do setor ${sector} - ${retreat.nome}`;
  const people = entries
    .map((entry) => ({ name: String(entry.nome || '').trim(), days: entryDays(entry), retreatsDone: entryRetreatsDone(entry) }))
    .filter((entry) => entry.name)
    .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR', { sensitivity: 'base' }));
  const configuredDays = Array.isArray(retreat.dias) && retreat.dias.length
    ? retreat.dias
    : [...new Set(people.flatMap((entry) => entry.days))];
  const daySummary = configuredDays
    .map((day) => ({ day, count: people.filter((entry) => entry.days.some((entryDay) => normalizeText(entryDay) === normalizeText(day))).length }))
    .filter((item) => item.day);
  const printableReport = sectorPrintPageHtml({ title, retreat, sector, people, daySummary });
  const printableIntolerances = intolerancePrintPageHtml({ retreat, sector, intolerances, intoleranceLoadError });
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
      .sector-public-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:18px 0 4px;padding:4px;border-radius:10px;background:#edf2ed}
      .sector-public-tabs button{min-height:42px;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:#315c38;font-weight:800;cursor:pointer}
      .sector-public-tabs button[aria-selected="true"]{background:#315c38;color:#fff;box-shadow:0 3px 9px rgba(49,92,56,.18)}
      .sector-public-view{min-height:0;display:flex;flex-direction:column}
      .sector-public-view[hidden]{display:none}
      .intolerance-public-list{overflow-y:auto;margin:18px 0;padding:0;border-top:1px solid #e7ddca;border-bottom:1px solid #e7ddca}
      .intolerance-public-list li{list-style:none;padding:12px 4px;border-bottom:1px solid #eee6d8;color:#203c26}
      .intolerance-public-list li:last-child{border-bottom:0}
      .intolerance-public-list strong,.intolerance-public-list span,.intolerance-public-list small{display:block}
      .intolerance-public-list span{margin-top:4px;color:#203c26;font-size:13px;font-weight:700}
      .intolerance-public-list small{margin-top:4px;color:#6c7469;font-size:13px}
      @media print{
        body{display:block;min-height:auto;padding:0;background:#fff}
        .sector-public-modal{display:block;width:auto;max-height:none;padding:0;border:0;border-radius:0;box-shadow:none}
        .sector-public-list{overflow:visible;margin-bottom:18px}
        .sector-public-summary{break-inside:avoid;page-break-inside:avoid;margin-top:0}
        .sector-public-actions{display:none}
        .sector-public-tabs{display:none}
      }
      @media(max-width:520px){.sector-public-tabs{grid-template-columns:1fr}.sector-public-actions{display:grid;grid-template-columns:1fr}.sector-public-actions button{width:100%}}
    </style>
  </head>
  <body>
    <section class="sector-public-modal" role="dialog" aria-modal="true" aria-labelledby="sector-title">
      <p class="eyebrow">Acompanhamento do setor</p>
      <h1 id="sector-title">${escapeHtml(sector)}</h1>
      ${showIntoleranceView ? '<div class="sector-public-tabs" role="tablist" aria-label="Visualiza&ccedil;&atilde;o do acompanhamento"><button type="button" id="sector-tab-entries" role="tab" aria-selected="true" aria-controls="sector-view-entries">Ades&otilde;es deste setor</button><button type="button" id="sector-tab-intolerances" role="tab" aria-selected="false" aria-controls="sector-view-intolerances" tabindex="-1">Intoler&acirc;ncia alimentar dos cursistas</button></div>' : ''}
      <div class="sector-public-view" id="sector-view-entries" ${showIntoleranceView ? 'role="tabpanel" aria-labelledby="sector-tab-entries"' : ''}>
        <p>${escapeHtml(retreat.nome)} - ${people.length} pessoa(s) inscrita(s) neste setor.</p>
        ${people.length ? `<ul class="sector-public-list">${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><span>Retiros que fez: ${escapeHtml(personRetreatsDoneText(person))}</span><span>Dias de trabalho: ${escapeHtml(person.days.length ? person.days.join(', ') : 'dias nao informados')}</span></li>`).join('')}</ul><section class="sector-public-summary"><h2>Somatorio por dia de trabalho</h2>${daySummary.map((item) => `<div><span>${escapeHtml(item.day)}</span><strong>${item.count} pessoa(s)</strong></div>`).join('')}</section>` : '<div class="sector-public-empty">Nenhuma pessoa inscrita neste setor ate o momento.</div>'}
      </div>
      ${showIntoleranceView ? `<div class="sector-public-view" id="sector-view-intolerances" role="tabpanel" aria-labelledby="sector-tab-intolerances" hidden>${intoleranceLoadError ? `<div class="sector-public-empty">${escapeHtml(intoleranceLoadError)}</div>` : `<p>${escapeHtml(retreat.nome)} - ${intolerances.length} cursista(s) com intoler&acirc;ncia informada.</p>${intolerances.length ? `<ul class="intolerance-public-list">${intolerances.map((person) => `<li><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.intolerance)}</span><small>Comunidade: ${escapeHtml(person.community)}</small></li>`).join('')}</ul>` : '<div class="sector-public-empty">Nenhum cursista com intoler&acirc;ncia alimentar informada neste retiro.</div>'}`}</div>` : ''}
      <div class="sector-public-actions">
        <button type="button" class="sector-public-print" id="print-sector-view">Imprimir</button>
        <button type="button" class="sector-public-close" id="close-sector-view">Fechar visualização</button>
      </div>
    </section>
    <script>
      const printableReports = { entries: ${scriptJson(printableReport)}, intolerances: ${scriptJson(printableIntolerances)} };
      let activeSectorView = 'entries';
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const activateView = (view) => {
        activeSectorView = view;
        tabs.forEach((tab) => { const active = tab.id === 'sector-tab-' + view; tab.setAttribute('aria-selected', active ? 'true' : 'false'); tab.tabIndex = active ? 0 : -1; });
        document.getElementById('sector-view-entries').hidden = view !== 'entries';
        const intoleranceView = document.getElementById('sector-view-intolerances');
        if (intoleranceView) intoleranceView.hidden = view !== 'intolerances';
      };
      tabs.forEach((tab) => tab.addEventListener('click', () => activateView(tab.id.replace('sector-tab-', ''))));
      document.querySelector('.sector-public-tabs')?.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const next = activeSectorView === 'entries' ? 'intolerances' : 'entries'; activateView(next); document.getElementById('sector-tab-' + next)?.focus();
      });
      document.getElementById('print-sector-view').addEventListener('click', () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          window.print();
          return;
        }
        printWindow.document.open();
        printWindow.document.write(printableReports[activeSectorView]);
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
  const showIntoleranceView = supportsIntoleranceView(result.sector);
  const entriesPromise = listRecords('adesoes');
  let intolerances = [];
  let intoleranceLoadError = '';
  if (showIntoleranceView) {
    try {
      const communitiesPromise = listRecords('comunidades');
      let individualStudents = [];
      let smpStudents = [];
      let epcStudents = [];
      if ((result.retreat.tipoFichaCursista || 'cursista-individual') === 'cursista-individual') individualStudents = await listRecords('cursistas');
      else if (result.retreat.tipoFichaCursista === 'cursista-smp') smpStudents = await listCursistasSmp(result.retreatId);
      else if (result.retreat.tipoFichaCursista === 'cursista-epc') epcStudents = await listCursistasEpc(result.retreatId);
      intolerances = buildIntoleranceRows({ retreat: result.retreat, individualStudents, smpStudents, epcStudents, communities: await communitiesPromise });
    } catch {
      intoleranceLoadError = 'N\u00e3o foi poss\u00edvel carregar as intoler\u00e2ncias neste momento. A visualiza\u00e7\u00e3o das ades\u00f5es continua dispon\u00edvel.';
    }
  }
  const entries = (await entriesPromise).filter((entry) => entry.retiroId === result.retreatId && entryHasSector(entry, result.sector));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(sectorPageHtml({ retreat: result.retreat, sector: result.sector, entries, intolerances, intoleranceLoadError, showIntoleranceView }));
}

module.exports = { buildIntoleranceRows, sectorPageHtml, sendPublicSectorPage, supportsIntoleranceView };
