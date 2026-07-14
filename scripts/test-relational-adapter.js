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

const db = require('../databaseAdapter');
const { findPublicReceiverRetreat, findPublicSectorLink } = require('../publicLinkResolver');

const runId = crypto.randomUUID();
const suffix = runId.slice(0, 8);
const retreatId = crypto.randomUUID();
const personCpf = `90000${suffix.replace(/\D/g, '').padEnd(6, '0')}`.slice(0, 11);
const studentCpf = `90100${suffix.replace(/\D/g, '').padEnd(6, '1')}`.slice(0, 11);
const enrolmentId = crypto.randomUUID();
const communityId = crypto.randomUUID();
const badgeId = crypto.randomUUID();
const userId = crypto.randomUUID();
const settingId = `smoke:${suffix}`;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function cleanup() {
  const safeDelete = async (store, id) => {
    try {
      if (id) await db.deleteRecord(store, id);
    } catch {
      // Best-effort cleanup.
    }
  };
  await safeDelete('usuario_retiros', `${userId}:${retreatId}`);
  await safeDelete('usuario_permissoes', `${userId}:retiros.ver`);
  await safeDelete('usuarios', userId);
  await safeDelete('configuracoes', settingId);
  await safeDelete('crachas', badgeId);
  await safeDelete('comunidades', communityId);
  await safeDelete('adesoes', enrolmentId);
  await safeDelete('cursistas', studentCpf);
  await safeDelete('pessoas', personCpf);
  await safeDelete('retiros', retreatId);
}

async function main() {
  await cleanup();

  const connection = await db.checkDatabaseConnection();
  assert(connection.ok && connection.database === 'supabase-relational', 'Conexao relacional com Supabase falhou.');

  const retreat = await db.saveRecord('retiros', {
    id: retreatId,
    nome: `Smoke Relacional ${suffix}`,
    dataInicio: '2026-08-01',
    dataTermino: '2026-08-03',
    local: 'Casa de Teste',
    coordenacaoGeral: 'Coord Geral',
    coordenacaoRetiro: 'Coord Retiro',
    valorInscricaoCursista: 180,
    valorInscricaoVoluntario: 60,
    valorFoto: 15,
    descontoParentesco: 5,
    idadeMaximaEspacoKids: 10,
    recebedorToken: `recebedor-${suffix}`,
    setores: ['Secretaria', 'Cozinha', 'Espaco Kids'],
    setoresPublicos: ['Secretaria', 'Cozinha'],
    ordemQuadrante: ['Cozinha', 'Secretaria', 'Espaco Kids'],
    dias: ['Sexta-feira', 'Sabado', 'Domingo'],
    contribuicoes: ['R$ 60,00 teste', 'R$ 55,00 teste'],
    linksSetores: [
      { setor: 'Secretaria', token: `legacy-sec-${suffix}`, cadastroToken: `cad-sec-${suffix}`, acompanhamentoToken: `aco-sec-${suffix}` },
      { setor: 'Cozinha', token: `legacy-coz-${suffix}`, cadastroToken: `cad-coz-${suffix}`, acompanhamentoToken: `aco-coz-${suffix}` },
    ],
    status: 'preparacao',
    createdAt: new Date().toISOString(),
  });
  assert(retreat.setores.length === 3, 'Retiro nao retornou setores.');
  assert(retreat.linksSetores.some((item) => item.cadastroToken === `cad-sec-${suffix}`), 'Links de setor nao retornaram.');

  const retreatUpdated = await db.saveRecord('retiros', {
    ...retreat,
    status: 'publicado',
    setores: ['Secretaria', 'Cozinha'],
    setoresPublicos: ['Secretaria'],
    dias: ['Sexta-feira', 'Sabado'],
    linksSetores: retreat.linksSetores.filter((item) => item.setor !== 'Espaco Kids'),
    updatedAt: new Date().toISOString(),
  });
  assert(retreatUpdated.status === 'publicado', 'Atualizacao de retiro falhou.');
  assert(retreatUpdated.setores.length === 2, 'Sincronizacao de setores do retiro falhou.');

  const person = await db.saveRecord('pessoas', {
    id: personCpf,
    cpf: personCpf,
    nome: `Pessoa Smoke ${suffix}`,
    nomeNormalizado: `pessoa smoke ${suffix}`,
    nascimento: '1990-01-01',
    genero: 'Masculino',
    telefone: '(47) 99999-0000',
    cep: '89000-000',
    endereco: 'Rua Teste',
    numero: '123',
    bairro: 'Centro',
    cidade: 'Teste',
    estado: 'SC',
    createdAt: new Date().toISOString(),
  });
  assert(person.id === personCpf, 'Pessoa nao preservou CPF como id externo.');

  const enrolment = await db.saveRecord('adesoes', {
    id: enrolmentId,
    retiroId: retreatId,
    pessoaId: personCpf,
    nome: person.nome,
    dias: ['Sexta-feira', 'Sabado'],
    setores: ['Secretaria'],
    retirosAnteriores: ['EPC', 'Girassol'],
    quadrante: 'Sim',
    foto: 'Nao',
    contribuicao: 'R$ 60,00',
    coordenacao: 'Equipe',
    coordenacaoSetor: true,
    espacoKids: [{ nome: 'Crianca Smoke', nascimento: '2020-01-01' }],
    espacoKidsNaoNecessito: false,
    observacao: 'Observacao teste',
    termoVoluntariadoAceito: true,
    termoVoluntariadoAceitoEm: new Date().toISOString(),
    tipoFicha: 'Individual',
    status: 'pendente_validacao',
    enviadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    dadosPessoais: { cpf: personCpf, nome: person.nome },
  });
  assert(enrolment.pessoaId === personCpf, 'Adesao nao retornou pessoaId externo.');
  assert(enrolment.dias.length === 2 && enrolment.setores[0] === 'Secretaria', 'Relacionamentos da adesao falharam.');
  assert(enrolment.espacoKids.length === 1 && enrolment.retirosAnteriores.length === 2, 'Listas auxiliares da adesao falharam.');

  const enrolmentPaid = await db.saveRecord('adesoes', {
    ...enrolment,
    taxaPaga: true,
    valorPago: 60,
    formaPagamento: 'Pix',
    recebedorObservacao: 'Pago no teste',
    status: 'confirmada',
    validada: true,
    validadoEm: new Date().toISOString(),
  });
  assert(enrolmentPaid.taxaPaga === true && enrolmentPaid.valorPago === 60, 'Atualizacao financeira da adesao falhou.');

  const student = await db.saveRecord('cursistas', {
    id: studentCpf,
    cpf: studentCpf,
    retiroId: retreatId,
    nome: `Cursista Smoke ${suffix}`,
    nascimento: '2012-05-10',
    telefone: '(47) 98888-0000',
    cep: '89000-001',
    rua: 'Rua Cursista',
    numero: '55',
    bairro: 'Bairro',
    cidade: 'Teste',
    estado: 'SC',
    batizado: 'Sim',
    primeiraComunhao: 'Nao',
    estuda: 'Sim',
    serie: '7 ano',
    escola: 'Escola Teste',
    fezRetiro: 'Nao',
    nomePai: 'Pai Smoke',
    telefonePai: '(47) 97777-0000',
    nomeMae: 'Mae Smoke',
    telefoneMae: '(47) 96666-0000',
    paisMovimento: 'Sim',
    qualMovimento: 'EPC',
    convidou: 'Convite Smoke',
    camiseta: 'M',
    intoleranciaAlimentos: 'Sim',
    qualIntolerancia: 'Lactose',
    alergiaMedicamento: 'Nao',
    medicamentoCabeca: 'Paracetamol',
    medicamentoEstomago: 'Buscopan',
    valorInscricao: 'R$ 180,00',
    valorPago: 'R$ 90,00',
    saldoPagar: 'R$ 90,00',
    criadoEm: new Date().toISOString(),
  });
  assert(student.id === studentCpf && student.cpf === studentCpf, 'Cursista nao preservou CPF como id externo.');
  assert(student.valorInscricao === 180 && student.saldoPagar === 90, 'Valores do cursista nao foram convertidos.');

  const studentPaid = await db.saveRecord('cursistas', {
    ...student,
    recebedorValorPago: 180,
    recebedorTaxaPaga: true,
    recebedorFormaPagamento: 'Dinheiro',
    recebedorObservacao: 'Quitado',
  });
  assert(studentPaid.recebedorTaxaPaga === true && studentPaid.recebedorValorPago === 180, 'Recebedor do cursista falhou.');

  const community = await db.saveRecord('comunidades', {
    id: communityId,
    retiroId: retreatId,
    nome: `Comunidade Smoke ${suffix}`,
    monitorIds: [personCpf],
    membroIds: [studentCpf],
    ordem: 1,
    criadoEm: new Date().toISOString(),
  });
  assert(community.monitorIds.includes(personCpf), 'Monitor da comunidade nao retornou.');
  assert(community.membroIds.includes(studentCpf), 'Cursista da comunidade nao retornou.');

  const registrationLink = await findPublicSectorLink({ token: `cad-sec-${suffix}`, type: 'cadastro' });
  assert(registrationLink?.retreatId === retreatId && registrationLink.sector === 'Secretaria', 'Resolucao do link publico de cadastro falhou.');
  const followupLink = await findPublicSectorLink({ token: `aco-sec-${suffix}`, type: 'acompanhamento' });
  assert(followupLink?.retreatId === retreatId && followupLink.sector === 'Secretaria', 'Resolucao do link publico de acompanhamento falhou.');
  const receiverLink = await findPublicReceiverRetreat(`recebedor-${suffix}`);
  assert(receiverLink?.retreatId === retreatId, 'Resolucao do link publico do recebedor falhou.');

  const badge = await db.saveRecord('crachas', {
    id: badgeId,
    retiroId: retreatId,
    name: `Cracha Smoke ${suffix}`,
    settings: { accent: '#123456', showSector: true },
    updatedAt: new Date().toISOString(),
  });
  assert(badge.id === badgeId && badge.retiroId === retreatId, 'Cracha falhou.');

  const setting = await db.saveRecord('configuracoes', {
    id: settingId,
    setores: ['Secretaria', 'Cozinha'],
    updatedAt: new Date().toISOString(),
  });
  assert(setting.setores.length === 2, 'Configuracao falhou.');

  const access = await Promise.all([
    db.listRecords('perfis'),
    db.listRecords('permissoes'),
    db.listRecords('perfil_permissoes'),
  ]);
  assert(access[0].some((item) => item.id === 'admin'), 'Perfil admin nao encontrado.');
  assert(access[1].some((item) => item.id === 'retiros.ver'), 'Permissao retiros.ver nao encontrada.');
  assert(access[2].some((item) => item.perfilId === 'admin'), 'Permissoes do perfil admin nao encontradas.');

  const user = await db.saveRecord('usuarios', {
    id: userId,
    nome: `Usuario Smoke ${suffix}`,
    login: `smoke-${suffix}`,
    perfilId: 'coordenador_retiro',
    ativo: true,
    passwordHash: 'hash-test',
    passwordSalt: 'salt-test',
    passwordIterations: 1,
    createdAt: new Date().toISOString(),
  });
  await db.saveRecord('usuario_permissoes', { id: `${userId}:retiros.ver`, usuarioId: userId, permissaoId: 'retiros.ver', permitido: true });
  await db.saveRecord('usuario_retiros', { id: `${userId}:${retreatId}`, usuarioId: userId, retiroId: retreatId, papel: 'coordenador_retiro' });
  const [users, userPermissions, userRetreats] = await Promise.all([
    db.listRecords('usuarios'),
    db.listRecords('usuario_permissoes'),
    db.listRecords('usuario_retiros'),
  ]);
  assert(users.some((item) => item.id === user.id), 'Usuario falhou.');
  assert(userPermissions.some((item) => item.usuarioId === userId && item.permissaoId === 'retiros.ver'), 'Permissao do usuario falhou.');
  assert(userRetreats.some((item) => item.usuarioId === userId && item.retiroId === retreatId), 'Retiro do usuario falhou.');

  const database = await db.readDatabase();
  assert(database.retiros.some((item) => item.id === retreatId), 'readDatabase nao retornou retiro de teste.');
  assert(database.adesoes.some((item) => item.id === enrolmentId), 'readDatabase nao retornou adesao de teste.');

  await cleanup();

  const leftovers = await Promise.all([
    db.getRecord('retiros', retreatId),
    db.getRecord('pessoas', personCpf),
    db.getRecord('cursistas', studentCpf),
    db.getRecord('comunidades', communityId),
    db.getRecord('crachas', badgeId),
    db.getRecord('configuracoes', settingId),
    db.getRecord('usuarios', userId),
  ]);
  assert(leftovers.every((item) => !item), 'Cleanup deixou registros temporarios.');

  console.log(JSON.stringify({
    ok: true,
    database: connection.database,
    tested: [
      'retiros',
      'pessoas',
      'adesoes',
      'cursistas',
      'comunidades',
      'crachas',
      'configuracoes',
      'usuarios',
      'permissoes',
      'links publicos',
      'readDatabase',
      'cleanup',
    ],
  }, null, 2));
}

main().catch(async (error) => {
  await cleanup();
  console.error(error.stack || error.message || error);
  process.exit(1);
});
