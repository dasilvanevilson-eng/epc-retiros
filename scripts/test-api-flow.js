const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const baseUrl = process.argv[2] || 'http://localhost:5173';
const runId = crypto.randomUUID();
const suffix = runId.slice(0, 8);
const retreatId = crypto.randomUUID();
const personCpf = `90200${suffix.replace(/\D/g, '').padEnd(6, '2')}`.slice(0, 11);
const enrolmentId = crypto.randomUUID();
const studentCpf = `90300${suffix.replace(/\D/g, '').padEnd(6, '3')}`.slice(0, 11);
const publicToken = () => crypto.randomBytes(24).toString('hex');
const receiverToken = publicToken();
const legacySectorToken = publicToken();
const registrationToken = publicToken();
const followupToken = publicToken();
let cookie = '';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${response.status}: ${text}`);
  return data;
}

async function cleanup() {
  const safe = async (method, pathname) => {
    try {
      await api(pathname, { method });
    } catch {
      // Best-effort cleanup.
    }
  };
  await safe('DELETE', `/api/adesoes/${encodeURIComponent(enrolmentId)}`);
  await safe('DELETE', `/api/cursistas/${encodeURIComponent(studentCpf)}`);
  await safe('DELETE', `/api/pessoas/${encodeURIComponent(personCpf)}`);
  await safe('DELETE', `/api/retiros/${encodeURIComponent(retreatId)}`);
}

async function main() {
  const health = await api('/api/health');
  assert(health.ok && health.database === 'supabase-relational', 'Health nao esta usando Supabase relacional.');

  assert(process.env.EPC_ADMIN_USER && process.env.EPC_ADMIN_PASSWORD, 'EPC_ADMIN_USER/EPC_ADMIN_PASSWORD nao configurados.');
  await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: process.env.EPC_ADMIN_USER, password: process.env.EPC_ADMIN_PASSWORD }),
  });
  assert(cookie.includes('epc_session='), 'Login nao retornou cookie de sessao.');

  await cleanup();

  const retreat = await api(`/api/retiros/${encodeURIComponent(retreatId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: retreatId,
      nome: `API Smoke ${suffix}`,
      dataInicio: '2026-09-01',
      dataTermino: '2026-09-03',
      local: 'Local API',
      valorInscricaoCursista: 180,
      valorInscricaoVoluntario: 60,
      valorFoto: 15,
      idadeMaximaEspacoKids: 9,
      recebedorToken: receiverToken,
      setores: ['Secretaria', 'Cozinha'],
      setoresPublicos: ['Secretaria'],
      ordemQuadrante: ['Secretaria', 'Cozinha'],
      dias: ['Sexta-feira', 'Sabado'],
      contribuicoes: ['R$ 60,00'],
      linksSetores: [{ setor: 'Secretaria', token: legacySectorToken, cadastroToken: registrationToken, acompanhamentoToken: followupToken }],
      status: 'publicado',
      createdAt: new Date().toISOString(),
    }),
  });
  assert(retreat.id === retreatId && retreat.linksSetores.length, 'API nao salvou retiro corretamente.');

  const publicRetreat = await api(`/api/retiros/${encodeURIComponent(retreatId)}`);
  assert(publicRetreat.id === retreatId, 'GET publico de retiro falhou.');

  const person = await api(`/api/pessoas/${encodeURIComponent(personCpf)}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: personCpf,
      cpf: personCpf,
      nome: `Pessoa API ${suffix}`,
      nomeNormalizado: `pessoa api ${suffix}`,
      nascimento: '1988-02-02',
      genero: 'Feminino',
      telefone: '(47) 95555-0000',
    }),
  });
  assert(person.id === personCpf, 'API nao salvou pessoa com CPF externo.');

  const enrolment = await api(`/api/adesoes/${encodeURIComponent(enrolmentId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: enrolmentId,
      retiroId: retreatId,
      pessoaId: personCpf,
      nome: person.nome,
      dias: ['Sexta-feira'],
      setores: ['Secretaria'],
      retirosAnteriores: ['EPC'],
      quadrante: 'Sim',
      foto: 'Nao',
      contribuicao: 'R$ 60,00',
      espacoKidsNaoNecessito: true,
      termoVoluntariadoAceito: true,
      termoVoluntariadoAceitoEm: new Date().toISOString(),
      status: 'pendente_validacao',
      enviadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    }),
  });
  assert(enrolment.pessoaId === personCpf && enrolment.setores.includes('Secretaria'), 'API nao salvou adesao relacional.');

  const student = await api(`/api/cursistas/${encodeURIComponent(studentCpf)}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: studentCpf,
      cpf: studentCpf,
      retiroId: retreatId,
      nome: `Cursista API ${suffix}`,
      nascimento: '2013-03-03',
      telefone: '(47) 94444-0000',
      batizado: 'Sim',
      primeiraComunhao: 'Sim',
      estuda: 'Sim',
      fezRetiro: 'Nao',
      paisMovimento: 'Nao',
      camiseta: 'M',
      intoleranciaAlimentos: 'Nao',
      alergiaMedicamento: 'Nao',
      valorInscricao: 'R$ 180,00',
      valorPago: 'R$ 0,00',
      saldoPagar: 'R$ 180,00',
      criadoEm: new Date().toISOString(),
    }),
  });
  assert(student.id === studentCpf && student.valorInscricao === 180, 'API nao salvou cursista relacional.');

  const receiverRows = await api('/api/adesoes', {
    headers: { 'X-Public-Receiver-Token': receiverToken },
  });
  assert(receiverRows.some((item) => item.id === enrolmentId), 'API publica do recebedor nao listou adesao.');

  const receiverUpdate = await api(`/api/adesoes/${encodeURIComponent(enrolmentId)}`, {
    method: 'PUT',
    headers: { 'X-Public-Receiver-Token': receiverToken },
    body: JSON.stringify({ valorPago: 60, taxaPaga: true, formaPagamento: 'Pix', recebedorObservacao: 'Recebedor API' }),
  });
  assert(receiverUpdate.taxaPaga === true && receiverUpdate.valorPago === 60, 'API publica do recebedor nao atualizou pagamento.');

  await cleanup();

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    tested: [
      'health',
      'login',
      'api retiros',
      'api pessoas',
      'api adesoes',
      'api cursistas',
      'api recebedor publico',
      'cleanup',
    ],
  }, null, 2));
}

main().catch(async (error) => {
  await cleanup();
  console.error(error.stack || error.message || error);
  process.exit(1);
});
