const { sendError } = require('../apiCore');
const { sendPublicSectorPage } = require('../publicSectorPage');

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'https://familiaepcindaial.local');
    const retreatId = url.searchParams.get('retiro') || '';
    const token = url.searchParams.get('token') || '';
    await sendPublicSectorPage(req, res, retreatId, token);
  } catch (error) {
    sendError(res, 500, error.message || 'Erro interno.');
  }
};
