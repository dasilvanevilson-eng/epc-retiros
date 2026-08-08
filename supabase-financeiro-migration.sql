-- Modulo Financeiro EPC - migracao exclusivamente aditiva.
-- Nao altera nem remove dados das tabelas de retiros, adesoes ou cursistas.

create extension if not exists pgcrypto;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'financeiro_categorias',
    'financeiro_fornecedores',
    'financeiro_produtos',
    'financeiro_despesas',
    'financeiro_cotacoes',
    'financeiro_movimentos',
    'financeiro_auditoria'
  ] loop
    execute format($sql$
      create table if not exists public.%I (
        id uuid primary key default gen_random_uuid(),
        retiro_id uuid,
        dados jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $sql$, table_name);
    execute format('create index if not exists %I on public.%I (retiro_id)', table_name || '_retiro_idx', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end $$;

insert into public.permissoes (id, modulo, descricao)
values
  ('financeiro.ver', 'Financeiro', 'Visualizar compras, despesas e estoque'),
  ('financeiro.editar', 'Financeiro', 'Cadastrar e editar dados financeiros'),
  ('financeiro.excluir', 'Financeiro', 'Excluir lancamentos com auditoria')
on conflict (id) do update set modulo = excluded.modulo, descricao = excluded.descricao;

insert into public.perfil_permissoes (perfil_id, permissao_id, permitido)
select 'admin', permissao.id, true
from public.permissoes permissao
where permissao.id in ('financeiro.ver', 'financeiro.editar', 'financeiro.excluir')
on conflict (perfil_id, permissao_id) do update set permitido = excluded.permitido;

-- Atualiza o registro do backup sem tornar as novas tabelas obrigatorias para
-- arquivos antigos. Quando presentes no manifesto, elas sao exportadas e restauradas.
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
    ('perfil_permissoes', 240, true), ('usuario_permissoes', 250, true), ('usuario_retiros', 260, true),
    ('financeiro_categorias', 270, false), ('financeiro_fornecedores', 280, false),
    ('financeiro_produtos', 290, false), ('financeiro_despesas', 300, false),
    ('financeiro_cotacoes', 310, false), ('financeiro_movimentos', 320, false),
    ('financeiro_auditoria', 330, false), ('epc_store', 340, false);
$$;
