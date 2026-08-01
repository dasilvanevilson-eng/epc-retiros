-- EPC Retiros - numero da ficha para Cursista Individual
-- Antes de executar em producao:
-- 1. Fazer backup/snapshot do banco.
-- 2. Conferir a auditoria abaixo.
-- 3. Executar este patch em uma janela controlada.
--
-- Auditoria previa sugerida:
-- select retiro_id, count(*) as total_cursistas
-- from public.cursistas
-- group by retiro_id
-- order by total_cursistas desc;

begin;

alter table public.cursistas
add column if not exists numero_ficha_individual integer;

do $$
begin
  if exists (
    select 1
    from public.cursistas
    group by retiro_id
    having count(*) > 30
  ) then
    raise exception 'Backfill bloqueado: existe retiro com mais de 30 cursistas individuais.';
  end if;

  if exists (
    select 1
    from public.cursistas
    where numero_ficha_individual is not null
  ) and exists (
    select 1
    from public.cursistas
    where numero_ficha_individual is null
  ) then
    raise exception 'Backfill bloqueado: existe numeracao parcial em cursistas.';
  end if;

  if exists (
    select 1
    from public.cursistas
    where numero_ficha_individual is not null
    group by retiro_id, numero_ficha_individual
    having count(*) > 1
  ) then
    raise exception 'Backfill bloqueado: ja existe Numero da ficha duplicado no mesmo retiro.';
  end if;
end $$;

with numbered as (
  select
    id,
    row_number() over (
      partition by retiro_id
      order by criado_em nulls last, created_at nulls last, nome, cpf, id
    ) as numero
  from public.cursistas
  where numero_ficha_individual is null
    and not exists (
      select 1
      from public.cursistas
      where numero_ficha_individual is not null
    )
)
update public.cursistas c
set numero_ficha_individual = numbered.numero
from numbered
where c.id = numbered.id;

alter table public.cursistas
drop constraint if exists cursistas_numero_ficha_individual_positive;

alter table public.cursistas
add constraint cursistas_numero_ficha_individual_positive
check (numero_ficha_individual is null or numero_ficha_individual > 0);

create unique index if not exists cursistas_retiro_numero_ficha_individual_unique
on public.cursistas(retiro_id, numero_ficha_individual)
where numero_ficha_individual is not null;

commit;

-- Auditoria posterior sugerida:
-- select retiro_id, numero_ficha_individual, nome, cpf
-- from public.cursistas
-- order by retiro_id, numero_ficha_individual;
