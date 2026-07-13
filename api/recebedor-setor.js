const { sendError } = require('../apiCore');
const { sendPublicReceiverPage } = require('../publicReceiverPage');

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'https://epc-retiros.local');
    const retreatId = url.searchParams.get('retiro') || '';
    const token = url.searchParams.get('token') || '';
    await sendPublicReceiverPage(req, res, retreatId, token);
  } catch (error) {
    sendError(res, 500, error.message || 'Erro interno.');
  }
};
