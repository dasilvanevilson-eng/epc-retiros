-- Remocao definitiva do construtor personalizavel de relatorios.
-- Antes de executar, gere um backup integral v4, valide o checksum SHA-256 e,
-- na mesma sessao, informe-o com:
-- select set_config('app.familia_epc_backup_checksum', '<checksum de 64 caracteres>', false);
-- Execute antes deste arquivo a versao atual de supabase-backup-restauracao.sql.

begin;

do $$
declare
  v_total bigint;
  v_checksum text := current_setting('app.familia_epc_backup_checksum', true);
begin
  if coalesce(v_checksum, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Migration bloqueada: gere e valide um backup completo e informe seu checksum SHA-256 nesta sessao.';
  end if;

  if to_regclass('public.relatorio_modelos') is null then
    raise exception 'Migration bloqueada: public.relatorio_modelos nao existe ou ja foi removida.';
  end if;

  execute 'select count(*) from public.relatorio_modelos' into v_total;
  if v_total <> 0 then
    raise exception 'Migration bloqueada: public.relatorio_modelos possui % registro(s). Gere novo backup, audite os modelos e obtenha nova confirmacao.', v_total;
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'epc_backup_create_snapshot'
      and pg_get_functiondef(procedure.oid) like '%supabase-relational-2026-08-v4%'
  ) then
    raise exception 'Migration bloqueada: aplique primeiro a atualizacao v4 de supabase-backup-restauracao.sql.';
  end if;
end;
$$;

update public.permissoes
set modulo = 'Relatorios',
    descricao = 'Acessar a Central de Relatorios'
where id = 'relatorios.ver';

drop table public.relatorio_modelos;

commit;

notify pgrst, 'reload schema';
