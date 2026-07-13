const { getRecord, listRecords } = require('./databaseAdapter');

const normalizeText = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

async function findPublicSectorLink({ retreatId = '', token = '', type = 'cadastro' } = {}) {
  const cleanRetreatId = decodeURIComponent(String(retreatId || '').trim());
  const cleanToken = decodeURIComponent(String(token || '').trim());
  if (!cleanToken) return null;

  const fieldByType = {
    cadastro: 'cadastroToken',
    acompanhamento: 'acompanhamentoToken',
  };
  const tokenField = fieldByType[type] || fieldByType.cadastro;
  const retreats = cleanRetreatId
    ? [await getRecord('retiros', cleanRetreatId).catch(() => null)].filter(Boolean)
    : await listRecords('retiros');

  for (const retreat of retreats) {
    const links = retreat.linksSetores || retreat.setorLinks || [];
    const link = links.find((item) => item?.[tokenField] === cleanToken || (type !== 'recebedor' && item?.token === cleanToken));
    const activeSector = link && (retreat.setores || []).find((sector) => normalizeText(sector) === normalizeText(link.setor || link.sector));
    if (link && activeSector) return { retreat, retreatId: retreat.id, link, sector: activeSector };
  }
  return null;
}

async function findPublicReceiverRetreat(token = '') {
  const cleanToken = decodeURIComponent(String(token || '').trim());
  if (!cleanToken) return null;
  const retreats = await listRecords('retiros');
  const retreat = retreats.find((item) => item?.recebedorToken === cleanToken);
  return retreat ? { retreat, retreatId: retreat.id } : null;
}

module.exports = { findPublicSectorLink, findPublicReceiverRetreat, normalizeText };
