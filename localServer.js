const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const root = __dirname;
const databaseDir = path.join(root, 'database');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function sendStaticError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: message }));
}

async function loadLocalEnv() {
  if (process.env.VERCEL) return;
  try {
    const content = await fs.readFile(path.join(root, '.env'), 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    });
  } catch {
    // Arquivo .env e opcional no desenvolvimento local.
  }
}

async function handleStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(root, decodeURIComponent(requested)));
  if (!filePath.startsWith(root) || filePath.startsWith(databaseDir)) return sendStaticError(res, 403, 'Acesso negado.');

  try {
    const data = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    const headers = { 'Content-Type': mimeTypes[extension] || 'application/octet-stream' };
    if (['.html', '.js', '.css'].includes(extension)) headers['Cache-Control'] = 'no-store, must-revalidate';
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    sendStaticError(res, 404, 'Arquivo nao encontrado.');
  }
}

loadLocalEnv().then(async () => {
  const port = Number(process.env.PORT) || 5173;
  const { handleApi, sendError } = require('./apiCore');
  const { ensureFileDatabase } = require('./databaseAdapter');
  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, `http://${req.headers.host}`);
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else if (pathname.startsWith('/adesao/')) {
        const { sendPublicRegistrationPage } = require('./publicRegistrationPage');
        await sendPublicRegistrationPage(req, res, pathname.replace(/^\/adesao\/?/, ''));
      }
      else if (pathname.startsWith('/setor/')) {
        const { sendPublicSectorPage } = require('./publicSectorPage');
        const parts = pathname.match(/^\/setor\/([^/]+)(?:\/([^/]+))?/) || [];
        const retreatId = parts[2] ? parts[1] : '';
        const token = parts[2] || parts[1];
        await sendPublicSectorPage(req, res, retreatId, token);
      }
      else if (pathname.startsWith('/convite-setor/')) {
        const { sendPublicSectorInvitePage } = require('./publicSectorInvitePage');
        const parts = pathname.match(/^\/convite-setor\/([^/]+)(?:\/([^/]+))?/) || [];
        const retreatId = parts[2] ? parts[1] : '';
        const token = parts[2] || parts[1];
        await sendPublicSectorInvitePage(req, res, retreatId, token);
      }
      else if (pathname.startsWith('/recebedor-setor/')) {
        const { sendPublicReceiverPage } = require('./publicReceiverPage');
        const parts = pathname.match(/^\/recebedor-setor\/([^/]+)(?:\/([^/]+))?/) || [];
        const retreatId = parts[2] ? parts[1] : '';
        const token = parts[2] || parts[1];
        await sendPublicReceiverPage(req, res, retreatId, token);
      }
      else await handleStatic(req, res, pathname);
    } catch (error) {
      sendError(res, 500, error.message || 'Erro interno.');
    }
  });
  await ensureFileDatabase();
  server.listen(port, () => console.log(`EPC Retiros em http://localhost:${port}`));
});
