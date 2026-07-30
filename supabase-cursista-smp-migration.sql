-- EPC Retiros - migracao Cursista SMP
-- Cria a estrutura inicial da ficha de casal SMP sem alterar dados existentes.
-- A parte funcional da tela sera implementada em etapa futura.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_cursista_smp_retiro()
returns trigger
language plpgsql
as $$
declare
  tipo_ficha text;
begin
  select r.extras->>'tipoFichaCursista'
    into tipo_ficha
  from public.retiros r
  where r.id = new.retiro_id;

  if tipo_ficha is distinct from 'cursista-smp' then
    raise exception 'O retiro % nao esta configurado para Cursista SMP.', new.retiro_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create table if not exists public.cursista_smp (
  -- O id e o Numero da ficha informado na tela.
  -- Ele e exclusivo dentro de cada retiro por causa da chave primaria composta.
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  id text not null,

  ele_nome text,
  ele_nascimento date,
  ele_cpf text,
  ele_profissao text,
  ele_fone text,
  ele_crisma boolean,
  ele_religiao text,
  ele_participa_missas text,
  ele_movimento_igreja boolean,
  ele_qual_movimento text,
  ele_data_primeiro_casamento date,
  ele_filhos_primeiro_casamento text,
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
  ela_religiao text,
  ela_participa_missas text,
  ela_movimento_igreja boolean,
  ela_qual_movimento text,
  ela_data_primeiro_casamento date,
  ela_filhos_primeiro_casamento text,
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
  comum_data_uniao_casal date,
  comum_filhos_uniao text,
  comum_outras_unioes boolean,
  comum_espaco_kids_nao_necessito boolean not null default false,
  comum_kid_1_nome text,
  comum_kid_1_nascimento date,
  comum_kid_2_nome text,
  comum_kid_2_nascimento date,
  comum_kid_3_nome text,
  comum_kid_3_nascimento date,
  comum_kid_4_nome text,
  comum_kid_4_nascimento date,
  comum_kid_5_nome text,
  comum_kid_5_nascimento date,
  comum_precisa_acolhimento boolean,
  comum_nome_apresentante text,
  comum_fone_apresentante text,
  comum_curso_apresentante text,
  comum_cidade_apresentante text,
  comum_paroquia_apresentante text,
  comum_nome_familiar_amigo text,
  comum_fone_familiar_amigo text,

  -- Colunas preparadas para a futura funcionalidade de inscricao,
  -- seguindo as caracteristicas financeiras da ficha Cursista Individual.
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
  constraint cursista_smp_id_not_blank check (length(btrim(id)) > 0),
  constraint cursista_smp_estado_length check (comum_estado is null or length(btrim(comum_estado)) <= 2)
);

comment on table public.cursista_smp is 'Ficha de casal da opcao Cursista SMP. Estrutura inicial; sem funcionalidade ligada na aplicacao.';
comment on column public.cursista_smp.id is 'Numero da ficha SMP, exclusivo dentro do retiro.';
comment on column public.cursista_smp.retiro_id is 'Retiro ao qual a ficha SMP pertence. O retiro deve estar configurado com tipoFichaCursista = cursista-smp.';

create index if not exists cursista_smp_ele_cpf_idx on public.cursista_smp (ele_cpf);
create index if not exists cursista_smp_ela_cpf_idx on public.cursista_smp (ela_cpf);
create index if not exists cursista_smp_ele_nome_idx on public.cursista_smp (ele_nome);
create index if not exists cursista_smp_ela_nome_idx on public.cursista_smp (ela_nome);

drop trigger if exists cursista_smp_updated_at on public.cursista_smp;
create trigger cursista_smp_updated_at
before update on public.cursista_smp
for each row
execute function public.set_updated_at();

drop trigger if exists cursista_smp_validate_retiro on public.cursista_smp;
create trigger cursista_smp_validate_retiro
before insert or update of retiro_id on public.cursista_smp
for each row
execute function public.validate_cursista_smp_retiro();

alter table public.cursista_smp enable row level security;

drop policy if exists "EPC service role full access" on public.cursista_smp;
create policy "EPC service role full access"
on public.cursista_smp
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
