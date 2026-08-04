-- EPC Retiros - Construtor de relatorios e modelos salvos.
-- Migracao aditiva: nao altera fichas, retiros, adesoes, cursistas ou pagamentos.

begin;

create extension if not exists pgcrypto;

create table if not exists public.relatorio_modelos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  nome text not null,
  descricao text,
  configuracao jsonb not null default '{}'::jsonb,
  compartilhado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relatorio_modelos_nome_not_blank check (length(btrim(nome)) > 0),
  constraint relatorio_modelos_configuracao_object check (jsonb_typeof(configuracao) = 'object')
);

create index if not exists relatorio_modelos_usuario_idx
on public.relatorio_modelos (usuario_id, updated_at desc);

create index if not exists relatorio_modelos_compartilhado_idx
on public.relatorio_modelos (compartilhado, updated_at desc)
where compartilhado is true;

drop trigger if exists relatorio_modelos_updated_at on public.relatorio_modelos;
create trigger relatorio_modelos_updated_at
before update on public.relatorio_modelos
for each row execute function public.set_updated_at();

alter table public.relatorio_modelos enable row level security;
drop policy if exists "EPC service role full access" on public.relatorio_modelos;
create policy "EPC service role full access" on public.relatorio_modelos
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
revoke all on public.relatorio_modelos from anon, authenticated;
grant all on public.relatorio_modelos to service_role;

insert into public.permissoes(id, modulo, descricao)
values ('relatorios.ver', 'Relatorios', 'Acessar todas as opcoes de relatorios')
on conflict (id) do update set
  modulo = excluded.modulo,
  descricao = excluded.descricao;

insert into public.perfil_permissoes(perfil_id, permissao_id, permitido)
select id, 'relatorios.ver', true
from public.perfis
where codigo = 'admin'
on conflict (perfil_id, permissao_id) do update set permitido = true;

commit;

notify pgrst, 'reload schema';

-- Auditoria anterior e posterior (as contagens devem permanecer iguais):
-- select 'retiros' tabela, count(*) total from public.retiros
-- union all select 'pessoas', count(*) from public.pessoas
-- union all select 'adesoes', count(*) from public.adesoes
-- union all select 'cursistas', count(*) from public.cursistas
-- union all select 'cursista_smp', count(*) from public.cursista_smp
-- union all select 'cursista_epc', count(*) from public.cursista_epc
-- union all select 'comunidades', count(*) from public.comunidades;
