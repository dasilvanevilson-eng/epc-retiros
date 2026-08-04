-- EPC Retiros - tabela propria da ficha Cursista EPC.
-- Migracao aditiva: nao copia, atualiza ou exclui fichas existentes.
-- Execute somente depois da auditoria e de um backup externo/JSON confirmado.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_cursista_epc_retiro()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tipo_ficha text;
begin
  select r.extras->>'tipoFichaCursista'
    into tipo_ficha
  from public.retiros r
  where r.id = new.retiro_id;

  if tipo_ficha is distinct from 'cursista-epc' then
    raise exception 'O retiro % nao esta configurado para Cursista EPC.', new.retiro_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create table if not exists public.cursista_epc (
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  id text not null,

  ele_nome text,
  ele_nascimento date,
  ele_cpf text,
  ele_profissao text,
  ele_fone text,
  ele_crisma boolean,
  ele_movimento_igreja boolean,
  ele_qual_movimento text,
  ele_problema_saude boolean,
  ele_qual_problema_saude text,
  ele_intolerancia_alimentar boolean,
  ele_qual_intolerancia_alimentar text,
  ele_manequim text,

  ela_nome text,
  ela_nascimento date,
  ela_cpf text,
  ela_profissao text,
  ela_fone text,
  ela_crisma boolean,
  ela_movimento_igreja boolean,
  ela_qual_movimento text,
  ela_problema_saude boolean,
  ela_qual_problema_saude text,
  ela_intolerancia_alimentar boolean,
  ela_qual_intolerancia_alimentar text,
  ela_manequim text,

  comum_cep text,
  comum_endereco text,
  comum_numero text,
  comum_nr_apto text,
  comum_bairro text,
  comum_cidade text,
  comum_estado text,
  comum_email text,
  comum_data_casamento_religioso date,
  comum_local_casamento text,
  comum_precisa_acolhimento boolean,
  comum_tem_filhos boolean,
  comum_idade_filhos text,
  comum_espaco_kids_nao_necessita boolean not null default false,

  comum_kid_1_nome text,
  comum_kid_1_nascimento date,
  comum_kid_1_problema_saude boolean,
  comum_kid_1_descricao_saude text,
  comum_kid_1_intolerancia_alimentar boolean,
  comum_kid_1_descricao_intolerancia text,
  comum_kid_2_nome text,
  comum_kid_2_nascimento date,
  comum_kid_2_problema_saude boolean,
  comum_kid_2_descricao_saude text,
  comum_kid_2_intolerancia_alimentar boolean,
  comum_kid_2_descricao_intolerancia text,
  comum_kid_3_nome text,
  comum_kid_3_nascimento date,
  comum_kid_3_problema_saude boolean,
  comum_kid_3_descricao_saude text,
  comum_kid_3_intolerancia_alimentar boolean,
  comum_kid_3_descricao_intolerancia text,
  comum_kid_4_nome text,
  comum_kid_4_nascimento date,
  comum_kid_4_problema_saude boolean,
  comum_kid_4_descricao_saude text,
  comum_kid_4_intolerancia_alimentar boolean,
  comum_kid_4_descricao_intolerancia text,
  comum_kid_5_nome text,
  comum_kid_5_nascimento date,
  comum_kid_5_problema_saude boolean,
  comum_kid_5_descricao_saude text,
  comum_kid_5_intolerancia_alimentar boolean,
  comum_kid_5_descricao_intolerancia text,

  comum_nome_apresentante text,
  comum_fone_apresentante text,
  comum_contato_emergencia text,
  comum_fone_emergencia text,
  comum_valor_inscricao numeric(10,2) not null default 0,
  comum_valor_pago numeric(10,2) not null default 0,
  comum_saldo_pagar numeric(10,2) not null default 0,
  comum_recebedor_valor_pago numeric(10,2) not null default 0,
  comum_recebedor_taxa_paga boolean not null default false,
  comum_recebedor_forma_pagamento text,
  comum_recebedor_observacao text,

  criado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extras jsonb not null default '{}'::jsonb,

  primary key (retiro_id, id),
  constraint cursista_epc_id_not_blank check (length(btrim(id)) > 0),
  constraint cursista_epc_estado_length check (comum_estado is null or length(btrim(comum_estado)) <= 2)
);

comment on table public.cursista_epc is 'Ficha de casal exclusiva da opcao Cursista EPC.';
comment on column public.cursista_epc.id is 'Numero da ficha, exclusivo dentro do retiro.';

create index if not exists cursista_epc_retiro_idx on public.cursista_epc (retiro_id);
create index if not exists cursista_epc_numero_ficha_idx on public.cursista_epc (id);
create index if not exists cursista_epc_ele_cpf_idx on public.cursista_epc (ele_cpf);
create index if not exists cursista_epc_ela_cpf_idx on public.cursista_epc (ela_cpf);
create index if not exists cursista_epc_ele_nome_idx on public.cursista_epc (ele_nome);
create index if not exists cursista_epc_ela_nome_idx on public.cursista_epc (ela_nome);

drop trigger if exists cursista_epc_updated_at on public.cursista_epc;
create trigger cursista_epc_updated_at
before update on public.cursista_epc
for each row execute function public.set_updated_at();

drop trigger if exists cursista_epc_validate_retiro on public.cursista_epc;
create trigger cursista_epc_validate_retiro
before insert or update of retiro_id on public.cursista_epc
for each row execute function public.validate_cursista_epc_retiro();

alter table public.cursista_epc enable row level security;
drop policy if exists "EPC service role full access" on public.cursista_epc;
create policy "EPC service role full access" on public.cursista_epc
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
revoke all on public.cursista_epc from anon, authenticated;
grant all on public.cursista_epc to service_role;

-- Vinculo exclusivo entre comunidades e fichas EPC. Nenhum vinculo SMP e reutilizado.
create unique index if not exists comunidades_id_retiro_unique
on public.comunidades (id, retiro_id);

create table if not exists public.comunidade_cursistas_epc (
  comunidade_id uuid not null,
  retiro_id uuid not null,
  cursista_id text not null,
  created_at timestamptz not null default now(),
  primary key (comunidade_id, retiro_id, cursista_id),
  foreign key (comunidade_id, retiro_id)
    references public.comunidades(id, retiro_id)
    on delete cascade,
  foreign key (retiro_id, cursista_id)
    references public.cursista_epc(retiro_id, id)
    on delete cascade
);

create index if not exists comunidade_cursistas_epc_retiro_idx
on public.comunidade_cursistas_epc (retiro_id, cursista_id);

alter table public.comunidade_cursistas_epc enable row level security;
drop policy if exists "EPC service role full access" on public.comunidade_cursistas_epc;
create policy "EPC service role full access" on public.comunidade_cursistas_epc
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
revoke all on public.comunidade_cursistas_epc from anon, authenticated;
grant all on public.comunidade_cursistas_epc to service_role;

-- A partir desta versao, a tabela SMP aceita somente retiros SMP.
create or replace function public.validate_cursista_smp_retiro()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tipo_ficha text;
begin
  select r.extras->>'tipoFichaCursista' into tipo_ficha
  from public.retiros r where r.id = new.retiro_id;
  if tipo_ficha is distinct from 'cursista-smp' then
    raise exception 'O retiro % nao esta configurado para Cursista SMP.', new.retiro_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';

-- Auditoria somente leitura antes e depois:
-- select 'cursista_smp' tabela, count(*) total from public.cursista_smp
-- union all select 'cursista_epc', count(*) from public.cursista_epc
-- union all select 'comunidade_cursistas_epc', count(*) from public.comunidade_cursistas_epc
-- union all select 'cursistas', count(*) from public.cursistas
-- union all select 'adesoes', count(*) from public.adesoes;
-- Confirmacao da premissa (deve retornar zero antes da migracao):
-- select count(*) from public.cursista_smp cs
-- join public.retiros r on r.id = cs.retiro_id
-- where r.extras->>'tipoFichaCursista' = 'cursista-epc';
