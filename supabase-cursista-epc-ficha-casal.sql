-- EPC Retiros - permissoes da ficha Cursista EPC (arquivo historico).
-- A persistencia EPC agora pertence a public.cursista_epc, criada por
-- supabase-cursista-epc-migration.sql. Este arquivo nao habilita mais EPC em SMP.
-- Execute apos backup/auditoria das permissoes atuais.
-- Este patch nao altera fichas, cursistas, retiros ou pagamentos.

begin;

create or replace function public.validate_cursista_smp_retiro()
returns trigger
language plpgsql
as $$
declare
  tipo_ficha text;
begin
  select r.extras->>'tipoFichaCursista'
    into tipo_ficha
  from public.retiros r
  where r.id = new.retiro_id;

  if tipo_ficha is distinct from 'cursista-smp' then
    raise exception 'O retiro % nao esta configurado para Cursista SMP.', new.retiro_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

with permission_seed(id, modulo, descricao) as (
  values
    ('cursista-epc.ver','Cursista EPC','Ver Cursista EPC'),
    ('cursista-epc.criar','Cursista EPC','Cadastrar Cursista EPC'),
    ('cursista-epc.editar','Cursista EPC','Editar Cursista EPC'),
    ('cursista-epc.excluir','Cursista EPC','Excluir Cursista EPC')
)
insert into public.permissoes (id, modulo, descricao)
select id, modulo, descricao
from permission_seed
on conflict (id) do update set
  modulo = excluded.modulo,
  descricao = excluded.descricao;

with new_permissions(id) as (
  values
    ('cursista-epc.criar'),
    ('cursista-epc.editar'),
    ('cursista-epc.excluir')
),
profile_holders(perfil_id) as (
  select id
  from public.perfis
  where codigo = 'admin'
  union
  select perfil_id
  from public.perfil_permissoes
  where permissao_id = 'cursista-epc.ver'
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
    ('cursista-epc.criar'),
    ('cursista-epc.editar'),
    ('cursista-epc.excluir')
),
user_holders(usuario_id) as (
  select usuario_id
  from public.usuario_permissoes
  where permissao_id = 'cursista-epc.ver'
    and permitido is true
)
insert into public.usuario_permissoes (usuario_id, permissao_id, permitido)
select user_holders.usuario_id, new_permissions.id, true
from user_holders
cross join new_permissions
on conflict (usuario_id, permissao_id) do update set
  permitido = true;

commit;
