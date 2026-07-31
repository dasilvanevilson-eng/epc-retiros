-- Impede que o mesmo CPF/pessoa tenha mais de uma adesao no mesmo retiro.
-- A migracao interrompe a execucao se ainda existirem duplicidades.

select
  retiro_id,
  pessoa_id,
  count(*) as total,
  array_agg(id order by enviado_em, created_at) as adesao_ids
from public.adesoes
where pessoa_id is not null
group by retiro_id, pessoa_id
having count(*) > 1;

do $$
begin
  if exists (
    select 1
    from public.adesoes
    where pessoa_id is not null
    group by retiro_id, pessoa_id
    having count(*) > 1
  ) then
    raise exception 'Existem adesoes duplicadas por retiro_id + pessoa_id. Resolva as duplicidades antes de criar o indice unico.';
  end if;
end $$;

create unique index if not exists adesoes_retiro_pessoa_unique
on public.adesoes (retiro_id, pessoa_id)
where pessoa_id is not null;
