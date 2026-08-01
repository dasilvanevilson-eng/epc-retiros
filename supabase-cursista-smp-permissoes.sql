-- EPC Retiros - Permissoes completas para Cursista SMP
-- Execute apos backup/auditoria das permissoes atuais.
-- Este patch nao altera fichas, cursistas, retiros ou pagamentos.

begin;

with permission_seed(id, modulo, descricao) as (
  values
    ('cursista-smp.ver','Cursista SMP','Ver Cursista SMP'),
    ('cursista-smp.criar','Cursista SMP','Cadastrar Cursista SMP'),
    ('cursista-smp.editar','Cursista SMP','Editar Cursista SMP'),
    ('cursista-smp.excluir','Cursista SMP','Excluir Cursista SMP')
)
insert into public.permissoes (id, modulo, descricao)
select id, modulo, descricao
from permission_seed
on conflict (id) do update set
  modulo = excluded.modulo,
  descricao = excluded.descricao;

with new_permissions(id) as (
  values
    ('cursista-smp.criar'),
    ('cursista-smp.editar'),
    ('cursista-smp.excluir')
),
profile_holders(perfil_id) as (
  select id
  from public.perfis
  where codigo = 'admin'
  union
  select perfil_id
  from public.perfil_permissoes
  where permissao_id = 'cursista-smp.ver'
    and permitido is true
)
insert into public.perfil_permissoes (perfil_id, permissao_id, permitido)
select profile_holders.perfil_id, new_permissions.id, true
from profile_holders
cross join new_permissions
on conflict (perfil_id, permissao_id) do update set
  permitido = true;

with new_permissions(id) as (
  values
    ('cursista-smp.criar'),
    ('cursista-smp.editar'),
    ('cursista-smp.excluir')
),
user_holders(usuario_id) as (
  select usuario_id
  from public.usuario_permissoes
  where permissao_id = 'cursista-smp.ver'
    and permitido is true
)
insert into public.usuario_permissoes (usuario_id, permissao_id, permitido)
select user_holders.usuario_id, new_permissions.id, true
from user_holders
cross join new_permissions
on conflict (usuario_id, permissao_id) do update set
  permitido = true;

commit;
