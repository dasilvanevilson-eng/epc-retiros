const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const originalUrl = process.env.SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalAnonKey = process.env.SUPABASE_ANON_KEY;
const originalFetch = global.fetch;

const retreatId = '11111111-1111-4111-8111-111111111111';
const coupleId = '22222222-2222-4222-8222-222222222222';
const personIds = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const enrolmentIds = ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
const cpfs = ['12345678909', '98765432100'];
const calls = [];

const payload = {
  casalId: coupleId,
  pessoas: cpfs.map((cpf, index) => ({
    id: cpf,
    cpf,
    nome: `Pessoa ${index + 1}`,
    nascimento: '1980-01-01',
    genero: index ? 'Feminino' : 'Masculino',
    casalId: coupleId,
    conjugeId: cpfs[index ? 0 : 1],
  })),
  adesoes: enrolmentIds.map((id, index) => ({
    id,
    retiroId: retreatId,
    pessoaId: cpfs[index],
    nome: `Pessoa ${index + 1}`,
    casalId: coupleId,
    papelNoCasal: index ? 'Segunda pessoa' : 'Primeira pessoa',
    dias: ['Sábado'],
    setores: ['Cozinha'],
    retirosAnteriores: ['EPC'],
    espacoKids: [],
    termoVoluntariadoAceito: true,
  })),
};

const restoreEnvironment = () => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalAnonKey;
  global.fetch = originalFetch;
};

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const tableRows = (url) => {
  const parsed = new URL(url);
  const table = parsed.pathname.split('/').pop();
  if (table === 'pessoas') {
    const cpfFilter = parsed.searchParams.get('cpf');
    if (cpfFilter) {
      const index = cpfs.indexOf(cpfFilter.replace(/^eq\./, ''));
      return index < 0 ? [] : [{ id: personIds[index], cpf: cpfs[index], nome: `Pessoa ${index + 1}`, extras: { casalId: coupleId, conjugeId: cpfs[index ? 0 : 1] } }];
    }
    return personIds.map((id, index) => ({ id, cpf: cpfs[index], nome: `Pessoa ${index + 1}`, extras: {} }));
  }
  if (table === 'adesoes') {
    const idFilter = parsed.searchParams.get('id');
    const index = enrolmentIds.indexOf(String(idFilter || '').replace(/^eq\./, ''));
    if (index < 0) return [];
    return [{ id: enrolmentIds[index], retiro_id: retreatId, pessoa_id: personIds[index], casal_id: coupleId, nome: `Pessoa ${index + 1}`, papel_no_casal: index ? 'Segunda pessoa' : 'Primeira pessoa', extras: {} }];
  }
  if (['adesao_dias', 'adesao_setores', 'adesao_retiros_anteriores', 'adesao_espaco_kids'].includes(table)) return [];
  return [];
};

async function main() {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  delete process.env.SUPABASE_ANON_KEY;
  delete require.cache[require.resolve('../databaseAdapter')];
  const { saveTeamCoupleAtomic } = require('../databaseAdapter');

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
    if (String(url).includes('/rpc/epc_save_team_couple_atomic')) return response({ error: 'falha simulada no segundo integrante' }, 500);
    throw new Error('Nenhuma consulta adicional deveria ocorrer depois da falha transacional.');
  };
  await assert.rejects(saveTeamCoupleAtomic(payload), /falha simulada no segundo integrante/);
  assert.equal(calls.length, 1, 'Uma falha atomica nao pode deixar o adaptador executar gravacoes separadas.');
  assert.equal(calls[0].method, 'POST');
  assert(calls[0].url.endsWith('/rest/v1/rpc/epc_save_team_couple_atomic'));
  const rpcBody = JSON.parse(calls[0].body);
  assert.equal(rpcBody.p_payload.participants.length, 2, 'Os dois integrantes devem seguir juntos na mesma chamada.');

  calls.length = 0;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
    if (String(url).includes('/rpc/epc_save_team_couple_atomic')) return response({ ok: true });
    return response(tableRows(url));
  };
  const saved = await saveTeamCoupleAtomic(payload);
  assert.equal(saved.pessoas.length, 2);
  assert.equal(saved.adesoes.length, 2);
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1, 'Somente a funcao transacional pode gravar o casal.');
  assert(calls.filter(({ method }) => method === 'POST')[0].url.includes('/rpc/epc_save_team_couple_atomic'));

  calls.length = 0;
  const repeated = await saveTeamCoupleAtomic(payload);
  assert.equal(repeated.adesoes.length, 2, 'Repetir a mesma solicitacao deve continuar retornando o casal completo.');
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1, 'A repeticao tambem deve usar uma unica transacao.');

  const admin = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');
  const sql = fs.readFileSync(path.join(root, 'supabase-adesao-casal-atomica.sql'), 'utf8');
  const coupleBranch = admin.slice(admin.indexOf('if (isCouple()) {', admin.indexOf("form.addEventListener('submit'")), admin.indexOf("if (editingEntry?.casalId)", admin.indexOf("form.addEventListener('submit'")));
  assert.match(coupleBranch, /dataService\.saveTeamCouple\(/, 'A tela deve usar a rota unica para casal.');
  assert.doesNotMatch(coupleBranch, /savePessoa|saveAdesao|saveForm\(/, 'A tela nao pode voltar a salvar os integrantes separadamente.');
  assert.match(service, /api\('\/adesoes-casal', \{ method: 'POST'/);
  assert.match(api, /saveTeamCoupleAtomic\(\{ casalId, pessoas, adesoes: protectedEnrolments \}\)/);
  assert.match(sql, /for v_index in 0\.\.1 loop/);
  assert.match(sql, /if v_saved_count <> 2 then[\s\S]*raise exception/);
  assert.match(sql, /revoke all on function public\.epc_save_team_couple_atomic\(jsonb\) from public/);
  assert.match(sql, /grant execute on function public\.epc_save_team_couple_atomic\(jsonb\) to service_role/);
  assert.doesNotMatch(sql, /drop table|truncate table/i, 'A migracao nao pode remover nem limpar dados historicos.');

  console.log(JSON.stringify({
    ok: true,
    verified: [
      'os dois integrantes seguem na mesma chamada transacional',
      'falha simulada nao dispara gravacoes parciais',
      'repeticao usa os mesmos identificadores sem criar fluxo paralelo',
      'funcao acessivel somente pelo service_role do servidor',
      'migracao nao limpa nem remove tabelas historicas',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(restoreEnvironment);
