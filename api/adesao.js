const { sendError } = require('../apiCore');
const { sendPublicRegistrationPage } = require('../publicRegistrationPage');

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'https://familiaepcindaial.local');
    const id = url.searchParams.get('id') || url.pathname.split('/').filter(Boolean).pop();
    await sendPublicRegistrationPage(req, res, id);
  } catch (error) {
    sendError(res, 500, error.message || 'Erro interno.');
  }
};
