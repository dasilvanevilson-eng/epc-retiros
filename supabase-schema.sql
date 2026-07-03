create table if not exists public.epc_store (
  store text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store, id)
);

create or replace function public.set_epc_store_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists epc_store_updated_at on public.epc_store;
create trigger epc_store_updated_at
before update on public.epc_store
for each row
execute function public.set_epc_store_updated_at();

alter table public.epc_store enable row level security;

drop policy if exists "EPC service role full access" on public.epc_store;
create policy "EPC service role full access"
on public.epc_store
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
