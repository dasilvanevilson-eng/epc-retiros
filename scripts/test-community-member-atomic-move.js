const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const originalUrl = process.env.SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalAnonKey = process.env.SUPABASE_ANON_KEY;
const originalFetch = global.fetch;

const retreatId = '11111111-1111-4111-8111-111111111111';
const targetCommunityId = '22222222-2222-4222-8222-222222222222';
const individualStudentId = '33333333-3333-4333-8333-333333333333';
const calls = [];

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

async function main() {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
  delete process.env.SUPABASE_ANON_KEY;
  delete require.cache[require.resolve('../databaseAdapter')];
  const { moveCommunityMemberAtomic } = require('../databaseAdapter');

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
    return response({ ok: true, vinculosAnterioresRemovidos: 1 });
  };

  const result = await moveCommunityMemberAtomic({
    retreatId,
    targetCommunityId,
    membershipType: 'individual',
    studentId: individualStudentId,
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, 'Mover um integrante deve executar somente uma chamada ao Supabase.');
  assert.equal(calls[0].method, 'POST');
  assert(calls[0].url.endsWith('/rest/v1/rpc/epc_move_community_member_atomic'));
  assert.deepEqual(JSON.parse(calls[0].body), {
    p_retiro_id: retreatId,
    p_comunidade_destino_id: targetCommunityId,
    p_tipo: 'individual',
    p_cursista_id: individualStudentId,
  });

  calls.length = 0;
  const postgresUuidWithoutRfcVersion = '77777777-7777-7777-7777-777777777777';
  await moveCommunityMemberAtomic({
    retreatId: postgresUuidWithoutRfcVersion,
    targetCommunityId: postgresUuidWithoutRfcVersion,
    membershipType: 'individual',
    studentId: postgresUuidWithoutRfcVersion,
  });
  assert.equal(calls.length, 1, 'O adaptador não deve rejeitar antecipadamente UUID aceito pelo PostgreSQL.');

  calls.length = 0;
  await assert.rejects(moveCommunityMemberAtomic({ retreatId, targetCommunityId, membershipType: 'invalido', studentId: '1' }), /Tipo de ficha/);
  assert.equal(calls.length, 0, 'Entrada inválida deve ser bloqueada antes de acessar o banco.');
  await assert.rejects(moveCommunityMemberAtomic({ retreatId: '', targetCommunityId, membershipType: 'smp', studentId: '12' }), /identificador do retiro/);
  await assert.rejects(moveCommunityMemberAtomic({ retreatId, targetCommunityId: '', membershipType: 'smp', studentId: '12' }), /comunidade de destino/);
  await assert.rejects(moveCommunityMemberAtomic({ retreatId, targetCommunityId, membershipType: 'smp', studentId: '' }), /cursista ou casal/);

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
    return response({ message: 'falha simulada durante a transacao' }, 500);
  };
  await assert.rejects(moveCommunityMemberAtomic({ retreatId, targetCommunityId, membershipType: 'smp', studentId: '12' }), /falha simulada/);
  assert.equal(calls.length, 1, 'Uma falha atômica não pode iniciar salvamentos alternativos.');

  const admin = fs.readFileSync(path.join(root, 'adminApp.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'apiCore.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'dataService.js'), 'utf8');
  const sql = fs.readFileSync(path.join(root, 'supabase-comunidade-mover-membro-atomico.sql'), 'utf8');
  const moveHandler = admin.slice(admin.indexOf("app.querySelectorAll('[data-move-student]')"), admin.indexOf("app.querySelectorAll('[data-remove-member]')"));

  assert.match(moveHandler, /dataService\.moveComunidadeMembro\(\{ retreatId: retreat\.id, targetCommunityId, membershipType, studentId \}\)/);
  assert.doesNotMatch(moveHandler, /listComunidades|saveComunidadeMembros|for \(const community/, 'Mover não pode voltar a salvar todas as comunidades.');
  assert.match(service, /api\('\/comunidades-mover-membro', \{[\s\S]*method: 'POST'/);
  assert.match(api, /const retreatId = String\(body\.retreatId \|\| body\.retiroId \|\| ''\)\.trim\(\);/, 'A API deve aceitar o nome atual e o nome legado do identificador do retiro.');
  assert.match(api, /denyIfMissingPermission\(res, session, 'comunidades\.editar'\)/);
  assert.match(api, /canAccessRetreat\(session, retreatId\)/);
  assert.match(sql, /v_tipo not in \('individual', 'smp', 'epc'\)/);
  assert.match(sql, /delete from public\.comunidade_cursistas vinculo[\s\S]*insert into public\.comunidade_cursistas/);
  assert.match(sql, /delete from public\.comunidade_cursistas_smp[\s\S]*insert into public\.comunidade_cursistas_smp/);
  assert.match(sql, /delete from public\.comunidade_cursistas_epc[\s\S]*insert into public\.comunidade_cursistas_epc/);
  assert.match(sql, /v_retiro_status = 'concluido'/, 'Retiro concluído deve permanecer somente para consulta.');
  assert.match(sql, /revoke all on function public\.epc_move_community_member_atomic\(uuid, uuid, text, text\) from public/);
  assert.match(sql, /grant execute on function public\.epc_move_community_member_atomic\(uuid, uuid, text, text\) to service_role/);
  assert.doesNotMatch(sql, /drop table|truncate table/i, 'A migração não pode apagar estruturas ou dados históricos.');

  console.log(JSON.stringify({
    ok: true,
    verified: [
      'uma movimentacao usa uma unica chamada transacional',
      'falha nao inicia salvamentos parciais ou alternativos',
      'individual, SMP e EPC possuem operacoes isoladas',
      'permissao, retiro e destino sao validados',
      'nenhuma outra comunidade ou monitor e regravado',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(restoreEnvironment);
