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
    recebedor: 'recebedorToken',
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

module.exports = { findPublicSectorLink, normalizeText };
