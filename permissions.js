const allPermissions = [
  ['inicio.ver', 'Inicio', 'Ver painel inicial'],
  ['retiros.ver', 'Retiros', 'Ver retiros'],
  ['retiros.criar', 'Retiros', 'Criar retiros'],
  ['retiros.editar', 'Retiros', 'Editar retiros'],
  ['retiros.publicar', 'Retiros', 'Publicar link'],
  ['retiros.excluir', 'Retiros', 'Excluir retiros'],
  ['pessoas.ver', 'Equipe de trabalho', 'Ver voluntarios'],
  ['pessoas.criar', 'Equipe de trabalho', 'Cadastrar voluntarios'],
  ['pessoas.editar', 'Equipe de trabalho', 'Editar voluntarios'],
  ['pessoas.excluir', 'Equipe de trabalho', 'Excluir adesoes'],
  ['validacao-inscricoes.ver', 'Validacao', 'Ver validacao'],
  ['validacao-inscricoes.validar', 'Validacao', 'Validar inscricoes'],
  ['cursista.ver', 'Cursista', 'Ver cursistas'],
  ['cursista.criar', 'Cursista', 'Cadastrar cursistas'],
  ['cursista.editar', 'Cursista', 'Editar cursistas'],
  ['cursista.excluir', 'Cursista', 'Excluir cursistas'],
  ['comunidades.ver', 'Comunidades', 'Ver comunidades'],
  ['comunidades.criar', 'Comunidades', 'Criar comunidades'],
  ['comunidades.editar', 'Comunidades', 'Editar comunidades'],
  ['comunidades.excluir', 'Comunidades', 'Excluir comunidades'],
  ['crachas.ver', 'Crachas', 'Ver crachas'],
  ['crachas.editar', 'Crachas', 'Editar modelos'],
  ['crachas.imprimir', 'Crachas', 'Imprimir crachas'],
  ['crachas.excluir', 'Crachas', 'Excluir modelos'],
  ['quadrante.ver', 'Quadrante', 'Ver quadrante'],
  ['quadrante.imprimir', 'Quadrante', 'Imprimir quadrante'],
  ['recebedor.ver', 'Recebedor', 'Ver recebedor'],
  ['recebedor.editar', 'Recebedor', 'Editar pagamentos'],
  ['usuarios.ver', 'Usuarios e permissoes', 'Ver usuarios e permissoes'],
  ['usuarios.criar', 'Usuarios e permissoes', 'Criar usuarios'],
  ['usuarios.editar', 'Usuarios e permissoes', 'Editar usuarios e permissoes'],
  ['usuarios.excluir', 'Usuarios e permissoes', 'Excluir usuarios'],
];

const permissionIds = allPermissions.map(([id]) => id);
const allPermissionSet = new Set(permissionIds);

const defaultProfiles = [
  {
    id: 'admin',
    nome: 'Admin',
    codigo: 'admin',
    descricao: 'Acesso irrestrito ao sistema.',
    permissions: permissionIds,
  },
  {
    id: 'coordenador_geral',
    nome: 'Coordenador Geral',
    codigo: 'coordenador_geral',
    descricao: 'Acesso amplo, exceto exclusoes sensiveis de usuarios.',
    permissions: permissionIds.filter((id) => id !== 'usuarios.excluir'),
  },
  {
    id: 'coordenador_retiro',
    nome: 'Coordenador do retiro',
    codigo: 'coordenador_retiro',
    descricao: 'Acesso operacional ao retiro vinculado.',
    permissions: [
      'inicio.ver',
      'retiros.ver',
      'retiros.editar',
      'pessoas.ver',
      'pessoas.criar',
      'pessoas.editar',
      'pessoas.excluir',
      'validacao-inscricoes.ver',
      'validacao-inscricoes.validar',
      'cursista.ver',
      'cursista.criar',
      'cursista.editar',
      'comunidades.ver',
      'comunidades.criar',
      'comunidades.editar',
      'crachas.ver',
      'crachas.editar',
      'crachas.imprimir',
      'quadrante.ver',
      'quadrante.imprimir',
      'recebedor.ver',
      'recebedor.editar',
    ],
  },
];

const defaultPerfilPermissoes = defaultProfiles.flatMap((profile) =>
  permissionIds.map((permissaoId) => ({
    id: `${profile.id}:${permissaoId}`,
    perfilId: profile.id,
    permissaoId,
    permitido: profile.permissions.includes(permissaoId),
  }))
);

function normalizeRole(role = '') {
  const normalized = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'gestor') return 'coordenador_geral';
  if (normalized === 'consulta') return 'coordenador_retiro';
  return normalized || 'coordenador_retiro';
}

function permissionsForRole(role = '') {
  if (role === 'admin') return [...permissionIds];
  const profile = defaultProfiles.find((item) => item.id === normalizeRole(role) || item.codigo === normalizeRole(role));
  return profile ? [...profile.permissions] : [];
}

function can(user = {}, permission) {
  if (!permission) return true;
  if (user.role === 'admin' || user.perfilCodigo === 'admin') return true;
  const permissions = new Set(user.permissions || []);
  return permissions.has(permission);
}

function safeUser(user = {}) {
  const { password, passwordHash, passwordSalt, passwordIterations, ...safe } = user;
  return safe;
}

module.exports = {
  allPermissions,
  allPermissionSet,
  can,
  defaultPerfilPermissoes,
  defaultProfiles,
  permissionIds,
  permissionsForRole,
  normalizeRole,
  safeUser,
};
