-- Migracao aditiva: vincula fichas de casal SMP a comunidades.
-- Esta migracao nao altera nem remove registros existentes.

begin;

create unique index if not exists comunidades_id_retiro_unique
on public.comunidades (id, retiro_id);

create table if not exists public.comunidade_cursistas_smp (
  comunidade_id uuid not null,
  retiro_id uuid not null,
  cursista_id text not null,
  created_at timestamptz not null default now(),
  primary key (comunidade_id, retiro_id, cursista_id),
  foreign key (comunidade_id, retiro_id)
    references public.comunidades(id, retiro_id)
    on delete cascade,
  foreign key (retiro_id, cursista_id)
    references public.cursista_smp(retiro_id, id)
    on delete cascade
);

create index if not exists comunidade_cursistas_smp_retiro_idx
on public.comunidade_cursistas_smp (retiro_id, cursista_id);

alter table public.comunidade_cursistas_smp enable row level security;

drop policy if exists "EPC service role full access" on public.comunidade_cursistas_smp;
create policy "EPC service role full access"
on public.comunidade_cursistas_smp
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

commit;

notify pgrst, 'reload schema';

-- Auditoria posterior: as contagens abaixo devem permanecer inalteradas.
-- select count(*) as comunidades from public.comunidades;
-- select count(*) as vinculos_individuais from public.comunidade_cursistas;
-- select count(*) as fichas_smp from public.cursista_smp;
