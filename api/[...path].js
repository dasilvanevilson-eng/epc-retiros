const { handleApi, sendError } = require('../apiCore');

module.exports = async function handler(req, res) {
  try {
    const pathname = new URL(req.url || '/api/health', 'https://epc-retiros.local').pathname;
    await handleApi(req, res, pathname);
  } catch (error) {
    sendError(res, 500, error.message || 'Erro interno.');
  }
};
