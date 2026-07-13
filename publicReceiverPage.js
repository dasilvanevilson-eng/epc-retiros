const { listRecords, saveRecord } = require('./databaseAdapter');
const { findPublicSectorLink, normalizeText } = require('./publicLinkResolver');

const paymentMethods = ['Cartão de crédito', 'Cartão de débito', 'Pix', 'Dinheiro', 'Acerto'];

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[character]));

const entryHasSector = (entry = {}, sector = '') => (entry.setores || []).some((item) => normalizeText(item) === normalizeText(sector));
const parseCurrency = (value) => Number(String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const currency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const volunteerContributionAmount = (retreat = {}, row = {}) => {
  const baseAmount = Number(retreat.valorInscricaoVoluntario) || 0;
  const photoAmount = row.entries?.some((entry) => normalizeText(entry.foto) === 'sim') ? Number(retreat.valorFoto ?? 10) || 0 : 0;
  return row.entries?.length > 1 ? (baseAmount * row.entries.length) + photoAmount : baseAmount + photoAmount;
};

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) return new URLSearchParams(req.body);
  if (typeof req.body === 'string' || req.body instanceof Buffer) return new URLSearchParams(String(req.body));
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function receiverRowsFor(entries, sector) {
  const rows = [];
  const usedCouples = new Set();
  entries
    .filter((entry) => entryHasSector(entry, sector))
    .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }))
    .forEach((entry) => {
      if (!entry.casalId) {
        rows.push({ id: entry.id, name: entry.nome || 'Sem nome', entries: [entry] });
        return;
      }
      if (usedCouples.has(entry.casalId)) return;
      const couple = entries
        .filter((item) => item.casalId === entry.casalId && entryHasSector(item, sector))
        .sort((first, second) => String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' }));
      usedCouples.add(entry.casalId);
      rows.push({ id: `casal-${entry.casalId}`, name: couple.map((item) => item.nome).filter(Boolean).join(' e ') || 'Ficha de casal', entries: couple });
    });
  return rows;
}

function rowPaid(row) {
  const values = row.entries.map((entry) => parseCurrency(entry.valorPago));
  const sum = values.reduce((total, value) => total + value, 0);
  if (row.entries.length < 2) return sum;
  const max = Math.max(...values);
  return values.filter(Boolean).length > 1 && values.every((value) => !value || Math.abs(value - max) < 0.01) ? max : sum;
}

const rowPaidStatus = (row) => row.entries.every((entry) => Boolean(entry.taxaPaga));
const rowPaymentMethod = (row) => row.entries.map((entry) => entry.formaPagamento || entry.recebedorFormaPagamento || '').find(Boolean) || '';

function receiverPageHtml({ retreat, sector, rows, token, message = '' }) {
  const title = `Recebedor - ${sector} - ${retreat.nome}`;
  const totalPaid = rows.reduce((sum, row) => rowPaidStatus(row) ? sum + rowPaid(row) : sum, 0);
  const totalOpen = rows.reduce((sum, row) => rowPaidStatus(row) ? sum : sum + volunteerContributionAmount(retreat, row), 0);
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      *{box-sizing:border-box}
      body{min-height:100vh;margin:0;padding:18px;background:#eef4ee;color:#26382c;font-family:Arial,sans-serif}
      .receiver-public{width:min(980px,100%);margin:0 auto;padding:22px;border:1px solid #d9cdb7;border-radius:14px;background:#fffdf7;box-shadow:0 24px 70px rgba(54,80,57,.16)}
      .receiver-public h1{margin:4px 0 0;font:700 30px Georgia,serif;color:#203c26}
      .receiver-public p{margin:7px 0 0;color:#68746b;line-height:1.45}
      .eyebrow{margin:0;color:#47724e;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
      .receiver-public-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:20px 0}
      .receiver-public-summary article{padding:14px;border:1px solid #e5dccb;border-radius:10px;background:#f8fbf5}
      .receiver-public-summary span{display:block;color:#68746b;font-size:12px;font-weight:800;text-transform:uppercase}
      .receiver-public-summary strong{display:block;margin-top:5px;color:#203c26;font-size:22px}
      .receiver-public-list{display:grid;gap:10px}
      .receiver-public-row{display:grid;grid-template-columns:minmax(180px,1fr) 120px 120px minmax(150px,180px) auto;gap:10px;align-items:end;padding:12px;border:1px solid #e5dccb;border-radius:10px;background:#fff}
      .receiver-public-row strong{display:block;color:#203c26}
      .receiver-public-row small{display:block;margin-top:4px;color:#68746b}
      .receiver-public-row label span{display:block;margin:0 0 4px;color:#68746b;font-size:12px;font-weight:800}
      .receiver-public-row input,.receiver-public-row select{width:100%;min-height:40px;border:1px solid #d8d0c1;border-radius:8px;padding:9px;background:white;color:#203c26}
      .receiver-public-actions{display:flex;gap:8px;align-items:center}
      .receiver-public-actions button{min-height:40px;border:0;border-radius:8px;padding:9px 12px;font-weight:900;cursor:pointer}
      .receiver-public-actions button:first-child{background:#47724e;color:#fff}
      .receiver-public-actions button:last-child{background:#f3e5df;color:#963328}
      .receiver-public-message{margin:16px 0 0;padding:10px 12px;border-radius:8px;background:#eef7ea;color:#285130;font-weight:800}
      .receiver-public-empty{padding:20px;border:1px dashed #d8d0c1;border-radius:10px;color:#68746b;text-align:center}
      @media (max-width:760px){
        .receiver-public-summary,.receiver-public-row{grid-template-columns:1fr}
        .receiver-public-actions{align-items:stretch}
        .receiver-public-actions button{flex:1}
      }
    </style>
  </head>
  <body>
    <main class="receiver-public">
      <p class="eyebrow">Recebedor por setor</p>
      <h1>${escapeHtml(sector)}</h1>
      <p>${escapeHtml(retreat.nome || 'Retiro')} - acesso restrito aos pagamentos deste setor.</p>
      ${message ? `<div class="receiver-public-message">${escapeHtml(message)}</div>` : ''}
      <section class="receiver-public-summary">
        <article><span>Registros</span><strong>${rows.length}</strong></article>
        <article><span>Total recebido</span><strong>${currency(totalPaid)}</strong></article>
        <article><span>Valor em aberto</span><strong>${currency(totalOpen)}</strong></article>
      </section>
      <section class="receiver-public-list">
        ${rows.length ? rows.map((row) => {
          const suggested = volunteerContributionAmount(retreat, row);
          const paid = rowPaid(row);
          const paidStatus = rowPaidStatus(row);
          const method = rowPaymentMethod(row);
          return `<form class="receiver-public-row" method="post">
            <input type="hidden" name="token" value="${escapeHtml(token)}">
            <input type="hidden" name="rowId" value="${escapeHtml(row.id)}">
            <div><strong>${escapeHtml(row.name)}</strong><small>${paidStatus ? `Pago - ${escapeHtml(method || 'forma nao informada')}` : 'Pagamento pendente'}</small></div>
            <div><small>Sugerido</small><strong>${currency(suggested)}</strong></div>
            <label><span>Valor pago</span><input name="valorPago" inputmode="decimal" value="${escapeHtml(currency(paid || suggested))}"></label>
            <label><span>Forma</span><select name="formaPagamento" ${paidStatus ? '' : 'required'}><option value="">Selecione</option>${paymentMethods.map((item) => `<option value="${escapeHtml(item)}" ${method === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label>
            <div class="receiver-public-actions"><button type="submit" name="action" value="pay">Confirmar</button>${paidStatus ? '<button type="submit" name="action" value="delete">Excluir</button>' : ''}</div>
          </form>`;
        }).join('') : '<div class="receiver-public-empty">Nenhum voluntario encontrado neste setor.</div>'}
      </section>
    </main>
  </body>
</html>`;
}

async function sendPublicReceiverPage(req, res, retreatId, token) {
  const receiverToken = decodeURIComponent(String(token || retreatId || '').trim());
  const result = await findPublicSectorLink({ retreatId, token: receiverToken, type: 'recebedor' });
  if (!result) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="pt-BR"><body><h1>Link nao encontrado</h1><p>Confira o link enviado pela equipe.</p></body></html>');
    return;
  }

  let message = '';
  const entries = (await listRecords('adesoes')).filter((entry) => entry.retiroId === result.retreatId && entryHasSector(entry, result.sector));
  let rows = receiverRowsFor(entries, result.sector);

  if (req.method === 'POST') {
    const body = await readBody(req);
    const row = rows.find((item) => item.id === body.get('rowId'));
    const action = body.get('action');
    if (row && action === 'pay') {
      const method = String(body.get('formaPagamento') || '').trim();
      const total = parseCurrency(body.get('valorPago'));
      if (method && total > 0) {
        const share = total / row.entries.length;
        await Promise.all(row.entries.map((entry) => saveRecord('adesoes', { ...entry, valorPago: currency(share), taxaPaga: true, formaPagamento: method })));
        message = 'Pagamento confirmado.';
      } else {
        message = 'Informe o valor e a forma de pagamento.';
      }
    }
    if (row && action === 'delete') {
      await Promise.all(row.entries.map((entry) => saveRecord('adesoes', { ...entry, valorPago: '', taxaPaga: false, formaPagamento: '' })));
      message = 'Pagamento excluido.';
    }
    const updatedEntries = (await listRecords('adesoes')).filter((entry) => entry.retiroId === result.retreatId && entryHasSector(entry, result.sector));
    rows = receiverRowsFor(updatedEntries, result.sector);
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(receiverPageHtml({ retreat: result.retreat, sector: result.sector, rows, token: receiverToken, message }));
}

module.exports = { receiverPageHtml, sendPublicReceiverPage };
