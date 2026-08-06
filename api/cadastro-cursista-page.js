const { sendError } = require('../apiCore');
const { sendPublicStudentRegistrationPage } = require('../publicStudentRegistrationPage');

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'https://familiaepcindaial.local');
    await sendPublicStudentRegistrationPage(req, res, url.searchParams.get('token') || '');
  } catch (error) {
    sendError(res, 500, error.message || 'Erro interno.');
  }
};
