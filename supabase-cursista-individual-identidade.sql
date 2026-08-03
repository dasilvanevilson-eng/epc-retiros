-- EPC Retiros - identidade do Cursista Individual por retiro
-- Este patch altera somente constraints/indices. Nao atualiza, renumera ou exclui fichas.
-- Antes de executar em producao:
-- 1. Fazer snapshot/backup do Supabase.
-- 2. Executar as auditorias abaixo e confirmar que ambas retornam zero linhas.
-- 3. Registrar as contagens de cursistas e vinculos de comunidade para conferencia posterior.
--
-- Auditoria de CPF duplicado no mesmo retiro:
-- select retiro_id, cpf, count(*)
-- from public.cursistas
-- where cpf is not null
-- group by retiro_id, cpf
-- having count(*) > 1;
--
-- Auditoria de numero de ficha duplicado no mesmo retiro:
-- select retiro_id, numero_ficha_individual, count(*)
-- from public.cursistas
-- where numero_ficha_individual is not null
-- group by retiro_id, numero_ficha_individual
-- having count(*) > 1;

begin;

do $$
begin
  if exists (
    select 1
    from public.cursistas
    where cpf is not null
    group by retiro_id, cpf
    having count(*) > 1
  ) then
    raise exception 'Migracao bloqueada: existe CPF duplicado no mesmo retiro.';
  end if;

  if exists (
    select 1
    from public.cursistas
    where numero_ficha_individual is not null
    group by retiro_id, numero_ficha_individual
    having count(*) > 1
  ) then
    raise exception 'Migracao bloqueada: existe numero de ficha duplicado no mesmo retiro.';
  end if;
end $$;

alter table public.cursistas
drop constraint if exists cursistas_cpf_key;

drop index if exists public.cursistas_cpf_unique;

create unique index if not exists cursistas_retiro_cpf_unique
on public.cursistas(retiro_id, cpf)
where cpf is not null;

create unique index if not exists cursistas_retiro_numero_ficha_individual_unique
on public.cursistas(retiro_id, numero_ficha_individual)
where numero_ficha_individual is not null;

commit;

-- Auditoria posterior (deve preservar as contagens anteriores):
-- select count(*) as cursistas from public.cursistas;
-- select count(*) as vinculos_comunidade from public.comunidade_cursistas;
