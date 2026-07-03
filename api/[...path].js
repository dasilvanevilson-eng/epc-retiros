const { handleApi, sendError } = require('../apiCore');

module.exports = async function handler(req, res) {
  try {
    const pathname = `/api/${Array.isArray(req.query.path) ? req.query.path.join('/') : (req.query.path || '')}`;
    await handleApi(req, res, pathname);
  } catch (error) {
    sendError(res, 500, error.message || 'Erro interno.');
  }
};
