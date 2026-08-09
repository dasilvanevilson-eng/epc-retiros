-- Financeiro por retiro e setor.
-- MIGRACAO DESTRUTIVA SOMENTE PARA AS SETE TABELAS FINANCEIRAS LEGADAS.
-- A execucao aborta se nao existir snapshot integral recente contendo todas elas.

begin;
create extension if not exists pgcrypto;

do $$
declare
  legacy_tables text[] := array[
    'financeiro_categorias', 'financeiro_fornecedores', 'financeiro_produtos',
    'financeiro_despesas', 'financeiro_cotacoes', 'financeiro_movimentos', 'financeiro_auditoria'
  ];
  existing_count integer;
  protected_before jsonb;
  snapshot_manifest jsonb;
  table_name text;
  row_count bigint;
begin
  select count(*) into existing_count
  from unnest(legacy_tables) name
  where to_regclass(format('public.%I', name)) is not null;

  if existing_count > 0 then
    if to_regclass('public.epc_backup_operations') is null then
      raise exception 'Backup obrigatorio: epc_backup_operations nao existe.';
    end if;
    select manifest into snapshot_manifest
    from public.epc_backup_operations
    where type = 'export' and status = 'staged' and created_at >= now() - interval '24 hours'
    order by created_at desc limit 1;
    if snapshot_manifest is null then
      raise exception 'Backup obrigatorio: gere e baixe um snapshot integral nas ultimas 24 horas.';
    end if;
    foreach table_name in array legacy_tables loop
      if to_regclass(format('public.%I', table_name)) is not null
         and not coalesce(snapshot_manifest->'tableNames', '[]'::jsonb) ? table_name then
        raise exception 'O snapshot recente nao contem a tabela financeira %.', table_name;
      end if;
      if to_regclass(format('public.%I', table_name)) is not null then
        execute format('select count(*) from public.%I', table_name) into row_count;
        raise notice 'Auditoria Financeiro legado: % = % registro(s)', table_name, row_count;
      end if;
    end loop;
  end if;

  select jsonb_build_object(
    'retiros', (select count(*) from public.retiros),
    'pessoas', (select count(*) from public.pessoas),
    'casais', (select count(*) from public.casais),
    'adesoes', (select count(*) from public.adesoes),
    'cursistas', (select count(*) from public.cursistas),
    'comunidades', (select count(*) from public.comunidades)
  ) into protected_before;
  perform set_config('epc.financeiro_protected_counts', protected_before::text, true);
end $$;

drop table if exists public.financeiro_categorias;
drop table if exists public.financeiro_fornecedores;
drop table if exists public.financeiro_produtos;
drop table if exists public.financeiro_despesas;
drop table if exists public.financeiro_cotacoes;
drop table if exists public.financeiro_movimentos;
drop table if exists public.financeiro_auditoria;

create table if not exists public.financeiro_planilhas (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null,
  setor_chave text not null,
  dados jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (retiro_id, setor_chave)
);

create table if not exists public.financeiro_planilha_auditoria (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null,
  dados jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financeiro_planilhas_retiro_idx on public.financeiro_planilhas(retiro_id);
create index if not exists financeiro_planilha_auditoria_retiro_idx on public.financeiro_planilha_auditoria(retiro_id);
drop trigger if exists financeiro_planilhas_set_updated_at on public.financeiro_planilhas;
create trigger financeiro_planilhas_set_updated_at before update on public.financeiro_planilhas for each row execute function public.set_updated_at();
drop trigger if exists financeiro_planilha_auditoria_set_updated_at on public.financeiro_planilha_auditoria;
create trigger financeiro_planilha_auditoria_set_updated_at before update on public.financeiro_planilha_auditoria for each row execute function public.set_updated_at();
alter table public.financeiro_planilhas enable row level security;
alter table public.financeiro_planilha_auditoria enable row level security;

insert into public.permissoes (id, modulo, descricao) values
  ('financeiro.ver', 'Financeiro', 'Visualizar planilhas e balancos financeiros'),
  ('financeiro.editar', 'Financeiro', 'Cadastrar e editar planilhas financeiras'),
  ('financeiro.excluir', 'Financeiro', 'Excluir itens financeiros com auditoria')
on conflict (id) do update set modulo = excluded.modulo, descricao = excluded.descricao;

insert into public.perfil_permissoes (perfil_id, permissao_id, permitido)
select 'admin', id, true from public.permissoes where id like 'financeiro.%'
on conflict (perfil_id, permissao_id) do update set permitido = excluded.permitido;

create or replace function public.epc_backup_table_registry()
returns table(table_name text, sort_order integer, required boolean)
language sql stable set search_path = public as $$
  values
    ('perfis',10,true),('permissoes',20,true),('retiros',30,true),('retiro_dias',40,true),
    ('retiro_setores',50,true),('retiro_contribuicoes',60,true),('pessoas',70,true),('casais',80,true),
    ('adesoes',90,true),('casal_membros',100,true),('adesao_dias',110,true),('adesao_setores',120,true),
    ('adesao_retiros_anteriores',130,true),('adesao_espaco_kids',140,true),('cursistas',150,true),
    ('cursista_smp',160,true),('cursista_epc',165,true),('cursista_fotos',168,false),('comunidades',170,true),
    ('comunidade_monitores',180,true),('comunidade_cursistas',190,true),('comunidade_cursistas_smp',200,true),
    ('comunidade_cursistas_epc',205,true),('crachas',210,true),('configuracoes',220,true),('usuarios',230,true),
    ('perfil_permissoes',240,true),('usuario_permissoes',250,true),('usuario_retiros',260,true),
    ('financeiro_planilhas',270,false),('financeiro_planilha_auditoria',280,false),('epc_store',340,false);
$$;

do $$
declare current_counts jsonb;
begin
  select jsonb_build_object(
    'retiros', (select count(*) from public.retiros), 'pessoas', (select count(*) from public.pessoas),
    'casais', (select count(*) from public.casais), 'adesoes', (select count(*) from public.adesoes),
    'cursistas', (select count(*) from public.cursistas), 'comunidades', (select count(*) from public.comunidades)
  ) into current_counts;
  if current_counts::text <> current_setting('epc.financeiro_protected_counts', true) then
    raise exception 'Integridade abortada: contagens historicas mudaram durante a migracao.';
  end if;
end $$;
commit;
