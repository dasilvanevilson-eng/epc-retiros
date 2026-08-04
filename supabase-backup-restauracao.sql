-- EPC Retiros - suporte transacional para backup e restauracao integral.
-- Migracao aditiva: nao altera nenhuma tabela historica durante a instalacao.
-- ATENCAO: public.epc_backup_restore(uuid) substitui os dados somente quando
-- chamada deliberadamente pelo backend com uma operacao previamente validada.

begin;

create extension if not exists pgcrypto;

create table if not exists public.epc_backup_operations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('export', 'restore')),
  status text not null default 'staged' check (status in ('staged', 'restoring', 'completed', 'failed')),
  actor text not null,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour')
);

create table if not exists public.epc_backup_chunks (
  operation_id uuid not null references public.epc_backup_operations(id) on delete cascade,
  table_name text not null,
  chunk_index integer not null check (chunk_index >= 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  created_at timestamptz not null default now(),
  primary key (operation_id, table_name, chunk_index)
);

create index if not exists epc_backup_operations_expiry_idx
on public.epc_backup_operations (expires_at);

alter table public.epc_backup_operations enable row level security;
alter table public.epc_backup_chunks enable row level security;

-- Nao sao criadas policies: service_role acessa pelo backend e os demais papeis ficam bloqueados.

create or replace function public.epc_backup_table_registry()
returns table(table_name text, sort_order integer, required boolean)
language sql
stable
set search_path = public
as $$
  values
    ('perfis', 10, true),
    ('permissoes', 20, true),
    ('retiros', 30, true),
    ('retiro_dias', 40, true),
    ('retiro_setores', 50, true),
    ('retiro_contribuicoes', 60, true),
    ('pessoas', 70, true),
    ('casais', 80, true),
    ('adesoes', 90, true),
    ('casal_membros', 100, true),
    ('adesao_dias', 110, true),
    ('adesao_setores', 120, true),
    ('adesao_retiros_anteriores', 130, true),
    ('adesao_espaco_kids', 140, true),
    ('cursistas', 150, true),
    ('cursista_smp', 160, true),
    ('cursista_epc', 165, true),
    ('comunidades', 170, true),
    ('comunidade_monitores', 180, true),
    ('comunidade_cursistas', 190, true),
    ('comunidade_cursistas_smp', 200, true),
    ('comunidade_cursistas_epc', 205, true),
    ('crachas', 210, true),
    ('configuracoes', 220, true),
    ('usuarios', 230, true),
    ('perfil_permissoes', 240, true),
    ('usuario_permissoes', 250, true),
    ('usuario_retiros', 260, true),
    ('epc_store', 270, false);
$$;

create or replace function public.epc_backup_create_snapshot(p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid := gen_random_uuid();
  v_created_at timestamptz := clock_timestamp();
  v_counts jsonb := '{}'::jsonb;
  v_table_names jsonb := '[]'::jsonb;
  v_snapshot_parts text[] := array[]::text[];
  v_snapshot_sql text;
  v_count bigint;
  v_table record;
  v_manifest jsonb;
begin
  -- Limpeza oportunista. Exclui somente operacoes auxiliares ja expiradas.
  delete from public.epc_backup_operations where expires_at < now();

  insert into public.epc_backup_operations(id, type, status, actor, created_at, expires_at)
  values (v_operation_id, 'export', 'staged', coalesce(nullif(p_actor, ''), 'admin'), v_created_at, v_created_at + interval '1 hour');

  -- Primeiro valida a existencia de todas as tabelas e monta uma unica consulta.
  -- Todos os dados sao lidos pelo mesmo comando SQL e, portanto, pelo mesmo
  -- snapshot MVCC, sem bloquear cadastros normais durante a exportacao.
  for v_table in
    select * from public.epc_backup_table_registry() order by sort_order
  loop
    if to_regclass(format('public.%I', v_table.table_name)) is null then
      if v_table.required then
        raise exception 'Tabela obrigatoria ausente para backup: %', v_table.table_name;
      end if;
      continue;
    end if;

    v_table_names := v_table_names || jsonb_build_array(v_table.table_name);
    v_snapshot_parts := array_append(v_snapshot_parts, format($part$
      select
        %L::text as table_name,
        ((ordered_rows.row_number - 1) / 200)::integer as chunk_index,
        ordered_rows.row_number,
        ordered_rows.row_data
      from (
        select
          row_number() over (order by ctid) as row_number,
          to_jsonb(source_row) as row_data
        from public.%I source_row
      ) ordered_rows
    $part$, v_table.table_name, v_table.table_name));
  end loop;

  if coalesce(array_length(v_snapshot_parts, 1), 0) = 0 then
    raise exception 'Nenhuma tabela disponivel para gerar o backup.';
  end if;

  v_snapshot_sql := array_to_string(v_snapshot_parts, E'\nunion all\n');
  execute format($statement$
    insert into public.epc_backup_chunks(operation_id, table_name, chunk_index, rows)
    select $1, table_name, chunk_index, jsonb_agg(row_data order by row_number)
    from (%s) snapshot_rows
    group by table_name, chunk_index
    order by table_name, chunk_index
  $statement$, v_snapshot_sql)
  using v_operation_id;

  -- As contagens sao calculadas sobre a copia temporaria congelada, nunca por
  -- uma segunda leitura das tabelas de producao.
  for v_table in
    select * from public.epc_backup_table_registry() order by sort_order
  loop
    if not (v_table_names ? v_table.table_name) then continue; end if;
    select coalesce(sum(jsonb_array_length(rows)), 0) into v_count
    from public.epc_backup_chunks
    where operation_id = v_operation_id and table_name = v_table.table_name;
    v_counts := v_counts || jsonb_build_object(v_table.table_name, v_count);
    if v_count = 0 then
      insert into public.epc_backup_chunks(operation_id, table_name, chunk_index, rows)
      values (v_operation_id, v_table.table_name, 0, '[]'::jsonb);
    end if;
  end loop;

  v_manifest := jsonb_build_object(
    'operationId', v_operation_id,
    'format', 'familia-epc-backup',
    'version', 1,
    'schemaVersion', 'supabase-relational-2026-08-v2',
    'storage', 'supabase-relational',
    'createdAt', to_char(v_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'counts', v_counts,
    'tableNames', v_table_names
  );
  update public.epc_backup_operations set manifest = v_manifest where id = v_operation_id;
  return v_manifest;
exception when others then
  delete from public.epc_backup_operations where id = v_operation_id;
  raise;
end;
$$;

create or replace function public.epc_backup_create_restore(p_actor text, p_manifest jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_manifest) is distinct from 'object'
    or p_manifest->>'format' is distinct from 'familia-epc-backup'
    or p_manifest->>'version' is distinct from '1'
    or p_manifest->>'schemaVersion' is distinct from 'supabase-relational-2026-08-v2'
    or p_manifest->>'storage' is distinct from 'supabase-relational'
    or jsonb_typeof(p_manifest->'counts') is distinct from 'object'
    or jsonb_typeof(p_manifest->'tableNames') is distinct from 'array'
    or coalesce(p_manifest->>'checksum', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Manifesto de backup invalido ou incompativel.';
  end if;

  -- Limpa somente operacoes auxiliares expiradas; nenhuma tabela historica e tocada.
  delete from public.epc_backup_operations where expires_at < now();

  insert into public.epc_backup_operations(id, type, status, actor, manifest, expires_at)
  values (v_operation_id, 'restore', 'staged', coalesce(nullif(p_actor, ''), 'admin'), p_manifest, now() + interval '1 hour');
  return jsonb_build_object('operationId', v_operation_id);
end;
$$;

create or replace function public.epc_backup_restore(p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.epc_backup_operations%rowtype;
  v_table record;
  v_chunk record;
  v_expected bigint;
  v_received bigint;
  v_unknown_table text;
  v_unknown_column text;
  v_lock_list text;
begin
  perform pg_advisory_xact_lock(hashtext('familia-epc-backup-restore'));

  select * into v_operation
  from public.epc_backup_operations
  where id = p_operation_id and type = 'restore'
  for update;

  if not found or v_operation.status <> 'restoring' or v_operation.expires_at <= now() then
    raise exception 'Operacao de restauracao invalida, nao confirmada ou expirada.';
  end if;

  if jsonb_typeof(v_operation.manifest) is distinct from 'object'
    or v_operation.manifest->>'format' is distinct from 'familia-epc-backup'
    or v_operation.manifest->>'version' is distinct from '1'
    or v_operation.manifest->>'schemaVersion' is distinct from 'supabase-relational-2026-08-v2'
    or v_operation.manifest->>'storage' is distinct from 'supabase-relational'
    or jsonb_typeof(v_operation.manifest->'counts') is distinct from 'object'
    or jsonb_typeof(v_operation.manifest->'tableNames') is distinct from 'array'
    or coalesce(v_operation.manifest->>'checksum', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Versao do backup incompativel.';
  end if;

  if jsonb_array_length(v_operation.manifest->'tableNames') <> (
    select count(distinct table_name)
    from jsonb_array_elements_text(v_operation.manifest->'tableNames') table_names(table_name)
  ) then
    raise exception 'O manifesto possui nomes de tabelas duplicados.';
  end if;

  select table_names.table_name into v_unknown_table
  from jsonb_array_elements_text(v_operation.manifest->'tableNames') table_names(table_name)
  left join public.epc_backup_table_registry() registry on registry.table_name = table_names.table_name
  where registry.table_name is null
  limit 1;
  if v_unknown_table is not null then
    raise exception 'Tabela desconhecida no manifesto: %', v_unknown_table;
  end if;

  select chunks.table_name into v_unknown_table
  from public.epc_backup_chunks chunks
  left join public.epc_backup_table_registry() registry on registry.table_name = chunks.table_name
  where chunks.operation_id = p_operation_id
    and (registry.table_name is null or not (v_operation.manifest->'tableNames' ? chunks.table_name))
  limit 1;
  if v_unknown_table is not null then
    raise exception 'Tabela nao permitida no backup: %', v_unknown_table;
  end if;

  for v_table in select * from public.epc_backup_table_registry() order by sort_order
  loop
    if v_table.required and not (v_operation.manifest->'tableNames' ? v_table.table_name) then
      raise exception 'Tabela obrigatoria ausente no backup: %', v_table.table_name;
    end if;
    if v_operation.manifest->'tableNames' ? v_table.table_name then
      if to_regclass(format('public.%I', v_table.table_name)) is null then
        raise exception 'Tabela do backup nao existe no banco atual: %', v_table.table_name;
      end if;
      if not exists (
        select 1 from public.epc_backup_chunks
        where operation_id = p_operation_id and table_name = v_table.table_name
      ) then
        raise exception 'Nenhum bloco recebido para a tabela: %', v_table.table_name;
      end if;
      v_expected := coalesce((v_operation.manifest->'counts'->>v_table.table_name)::bigint, -1);
      select coalesce(sum(jsonb_array_length(rows)), 0) into v_received
      from public.epc_backup_chunks
      where operation_id = p_operation_id and table_name = v_table.table_name;
      if v_expected < 0 or v_expected <> v_received then
        raise exception 'Quantidade de registros divergente em %: esperado %, recebido %', v_table.table_name, v_expected, v_received;
      end if;
    end if;
  end loop;

  select table_name into v_unknown_table
  from public.epc_backup_chunks
  where operation_id = p_operation_id
  group by table_name
  having min(chunk_index) <> 0
    or max(chunk_index) + 1 <> count(*)
    or bool_or(jsonb_array_length(rows) > 200)
  limit 1;
  if v_unknown_table is not null then
    raise exception 'Sequencia ou tamanho de blocos invalido na tabela: %', v_unknown_table;
  end if;

  select chunks.table_name into v_unknown_table
  from public.epc_backup_chunks chunks
  cross join lateral jsonb_array_elements(chunks.rows) as restored_rows(restored_row)
  where chunks.operation_id = p_operation_id
    and jsonb_typeof(restored_rows.restored_row) is distinct from 'object'
  limit 1;
  if v_unknown_table is not null then
    raise exception 'A tabela % contem registro que nao e um objeto JSON.', v_unknown_table;
  end if;

  select chunks.table_name, keys.key into v_unknown_table, v_unknown_column
  from public.epc_backup_chunks chunks
  cross join lateral jsonb_array_elements(chunks.rows) as restored_rows(restored_row)
  cross join lateral jsonb_object_keys(restored_rows.restored_row) keys(key)
  where chunks.operation_id = p_operation_id
    and not exists (
      select 1
      from pg_attribute attribute
      where attribute.attrelid = to_regclass(format('public.%I', chunks.table_name))
        and attribute.attname = keys.key
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
  limit 1;
  if v_unknown_column is not null then
    raise exception 'Coluna nao permitida no backup: %.%', v_unknown_table, v_unknown_column;
  end if;

  select string_agg(format('public.%I', registry.table_name), ', ' order by registry.sort_order)
  into v_lock_list
  from public.epc_backup_table_registry() registry
  where v_operation.manifest->'tableNames' ? registry.table_name
    and to_regclass(format('public.%I', registry.table_name)) is not null;
  if v_lock_list is not null then execute 'lock table ' || v_lock_list || ' in access exclusive mode'; end if;

  for v_table in select * from public.epc_backup_table_registry() order by sort_order desc
  loop
    if v_operation.manifest->'tableNames' ? v_table.table_name then
      execute format('delete from public.%I', v_table.table_name);
    end if;
  end loop;

  for v_table in select * from public.epc_backup_table_registry() order by sort_order
  loop
    if v_operation.manifest->'tableNames' ? v_table.table_name then
      for v_chunk in
        select rows from public.epc_backup_chunks
        where operation_id = p_operation_id and table_name = v_table.table_name
        order by chunk_index
      loop
        if jsonb_array_length(v_chunk.rows) > 0 then
          execute format(
            'insert into public.%I select (jsonb_populate_record(null::public.%I, restored_rows.restored_row)).* from jsonb_array_elements($1) as restored_rows(restored_row)',
            v_table.table_name,
            v_table.table_name
          ) using v_chunk.rows;
        end if;
      end loop;
    end if;
  end loop;

  update public.epc_backup_operations set status = 'completed' where id = p_operation_id;
end;
$$;

create or replace function public.epc_backup_cleanup_expired()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.epc_backup_operations where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on public.epc_backup_operations from anon, authenticated;
revoke all on public.epc_backup_chunks from anon, authenticated;
revoke all on function public.epc_backup_table_registry() from public, anon, authenticated;
revoke all on function public.epc_backup_create_snapshot(text) from public, anon, authenticated;
revoke all on function public.epc_backup_create_restore(text, jsonb) from public, anon, authenticated;
revoke all on function public.epc_backup_restore(uuid) from public, anon, authenticated;
revoke all on function public.epc_backup_cleanup_expired() from public, anon, authenticated;

grant all on public.epc_backup_operations to service_role;
grant all on public.epc_backup_chunks to service_role;
grant execute on function public.epc_backup_table_registry() to service_role;
grant execute on function public.epc_backup_create_snapshot(text) to service_role;
grant execute on function public.epc_backup_create_restore(text, jsonb) to service_role;
grant execute on function public.epc_backup_restore(uuid) to service_role;
grant execute on function public.epc_backup_cleanup_expired() to service_role;

commit;

notify pgrst, 'reload schema';

-- Auditoria obrigatoria antes e depois da aplicacao:
-- select 'retiros' tabela, count(*) total from public.retiros
-- union all select 'pessoas', count(*) from public.pessoas
-- union all select 'adesoes', count(*) from public.adesoes
-- union all select 'cursistas', count(*) from public.cursistas
-- union all select 'cursista_smp', count(*) from public.cursista_smp
-- union all select 'cursista_epc', count(*) from public.cursista_epc
-- union all select 'comunidade_cursistas_epc', count(*) from public.comunidade_cursistas_epc
-- union all select 'comunidades', count(*) from public.comunidades;
