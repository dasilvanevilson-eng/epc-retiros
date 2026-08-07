-- EPC Retiros - fotos privadas e versionadas das fichas de cursistas.
-- Migracao estritamente aditiva: nao atualiza nem exclui cursistas existentes.
-- Execute somente depois de um snapshot confirmado e da auditoria das fichas.

begin;

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cursista-fotos', 'cursista-fotos', false, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg'];

create table if not exists public.cursista_fotos (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null references public.retiros(id),
  tipo text not null check (tipo in ('individual', 'smp', 'epc')),
  registro_id text not null,
  numero_ficha text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type = 'image/jpeg'),
  largura integer not null check (largura > 0),
  altura integer not null check (altura > 0),
  tamanho_bytes integer not null check (tamanho_bytes between 1 and 2097152),
  ativo boolean not null default false,
  origem text not null check (origem in ('publico', 'logado')),
  autor_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists cursista_fotos_uma_ativa_idx
on public.cursista_fotos (retiro_id, tipo, registro_id)
where ativo;

create index if not exists cursista_fotos_ficha_idx
on public.cursista_fotos (retiro_id, tipo, registro_id, created_at desc);

alter table public.cursista_fotos enable row level security;
-- Sem policies: anon/authenticated nao acessam diretamente. O backend usa service_role.

create or replace function public.epc_ativar_foto_cursista(p_foto_id uuid, p_permitir_substituir boolean)
returns public.cursista_fotos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foto public.cursista_fotos%rowtype;
begin
  select * into v_foto from public.cursista_fotos where id = p_foto_id for update;
  if not found then raise exception 'Foto candidata nao encontrada.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_foto.retiro_id::text || ':' || v_foto.tipo || ':' || v_foto.registro_id));
  if not p_permitir_substituir and exists (
    select 1 from public.cursista_fotos
    where retiro_id = v_foto.retiro_id and tipo = v_foto.tipo and registro_id = v_foto.registro_id and ativo
  ) then
    raise exception 'Esta ficha ja possui foto.' using errcode = '23505';
  end if;

  update public.cursista_fotos set ativo = false
  where retiro_id = v_foto.retiro_id and tipo = v_foto.tipo and registro_id = v_foto.registro_id and ativo;
  update public.cursista_fotos set ativo = true where id = p_foto_id returning * into v_foto;
  return v_foto;
end;
$$;

revoke all on function public.epc_ativar_foto_cursista(uuid, boolean) from public, anon, authenticated;
grant execute on function public.epc_ativar_foto_cursista(uuid, boolean) to service_role;

-- Inclui os metadados nos snapshots do backup relacional. O binario do bucket
-- continua exigindo copia propria do Storage.
create or replace function public.epc_backup_table_registry()
returns table(table_name text, sort_order integer, required boolean)
language sql
stable
set search_path = public
as $$
  values
    ('perfis', 10, true), ('permissoes', 20, true), ('retiros', 30, true),
    ('retiro_dias', 40, true), ('retiro_setores', 50, true), ('retiro_contribuicoes', 60, true),
    ('pessoas', 70, true), ('casais', 80, true), ('adesoes', 90, true),
    ('casal_membros', 100, true), ('adesao_dias', 110, true), ('adesao_setores', 120, true),
    ('adesao_retiros_anteriores', 130, true), ('adesao_espaco_kids', 140, true),
    ('cursistas', 150, true), ('cursista_smp', 160, true), ('cursista_epc', 165, true),
    ('cursista_fotos', 168, false), ('comunidades', 170, true),
    ('comunidade_monitores', 180, true), ('comunidade_cursistas', 190, true),
    ('comunidade_cursistas_smp', 200, true), ('comunidade_cursistas_epc', 205, true),
    ('crachas', 210, true), ('configuracoes', 220, true), ('usuarios', 230, true),
    ('perfil_permissoes', 240, true), ('usuario_permissoes', 250, true),
    ('usuario_retiros', 260, true), ('epc_store', 270, false);
$$;

commit;
