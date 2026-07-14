-- EPC Retiros - schema relacional
-- Primeiro passo da migracao: cria a estrutura relacional sem remover epc_store.
-- Execute no SQL Editor do Supabase quando quiser provisionar o novo modelo.

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

create table if not exists public.retiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  data_inicio date,
  data_termino date,
  local text,
  coordenacao_geral text,
  coordenacao_retiro text,
  valor_inscricao_cursista numeric(10,2) not null default 0,
  valor_inscricao_voluntario numeric(10,2) not null default 0,
  valor_foto numeric(10,2) not null default 0,
  desconto_parentesco numeric(10,2) not null default 0,
  idade_maxima_espaco_kids integer not null default 0,
  recebedor_token text unique,
  status text not null default 'preparacao',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extras jsonb not null default '{}'::jsonb
);

create table if not exists public.retiro_dias (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  unique (retiro_id, nome)
);

create table if not exists public.retiro_setores (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  nome text not null,
  nome_normalizado text,
  publico boolean not null default false,
  ordem_quadrante integer,
  cadastro_token text unique,
  acompanhamento_token text unique,
  legacy_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (retiro_id, nome)
);

create table if not exists public.retiro_contribuicoes (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  descricao text not null,
  valor numeric(10,2),
  ordem integer not null default 0
);

create table if not exists public.pessoas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_normalizado text,
  cpf text unique,
  nascimento date,
  genero text,
  telefone text,
  cep text,
  endereco text,
  numero text,
  bairro text,
  cidade text,
  estado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extras jsonb not null default '{}'::jsonb
);

create table if not exists public.casais (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid references public.retiros(id) on delete cascade,
  nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extras jsonb not null default '{}'::jsonb
);

create table if not exists public.adesoes (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  casal_id uuid references public.casais(id) on delete set null,
  nome text,
  tipo_ficha text not null default 'Individual',
  papel_no_casal text,
  quadrante boolean not null default false,
  foto boolean not null default false,
  contribuicao text,
  coordenacao text,
  coordenacao_setor text,
  espaco_kids_nao_necessito boolean not null default false,
  observacao text,
  termo_voluntariado_aceito boolean not null default false,
  termo_voluntariado_aceito_em timestamptz,
  tipo_financeiro text,
  taxa_paga boolean not null default false,
  valor_pago numeric(10,2) not null default 0,
  forma_pagamento text,
  recebedor_observacao text,
  status text not null default 'pendente_validacao',
  validada boolean not null default false,
  validado_em timestamptz,
  enviado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dados_pessoais jsonb not null default '{}'::jsonb,
  extras jsonb not null default '{}'::jsonb
);

create table if not exists public.casal_membros (
  casal_id uuid not null references public.casais(id) on delete cascade,
  adesao_id uuid not null references public.adesoes(id) on delete cascade,
  papel text,
  primary key (casal_id, adesao_id)
);

create table if not exists public.adesao_dias (
  adesao_id uuid not null references public.adesoes(id) on delete cascade,
  dia_id uuid not null references public.retiro_dias(id) on delete cascade,
  primary key (adesao_id, dia_id)
);

create table if not exists public.adesao_setores (
  adesao_id uuid not null references public.adesoes(id) on delete cascade,
  setor_id uuid not null references public.retiro_setores(id) on delete cascade,
  primary key (adesao_id, setor_id)
);

create table if not exists public.adesao_retiros_anteriores (
  id uuid primary key default gen_random_uuid(),
  adesao_id uuid not null references public.adesoes(id) on delete cascade,
  nome text not null,
  ordem integer not null default 0
);

create table if not exists public.adesao_espaco_kids (
  id uuid primary key default gen_random_uuid(),
  adesao_id uuid not null references public.adesoes(id) on delete cascade,
  nome text,
  nascimento date,
  ordem integer not null default 0
);

create table if not exists public.cursistas (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  cpf text unique,
  nome text not null,
  nascimento date,
  telefone text,
  cep text,
  rua text,
  numero text,
  bairro text,
  cidade text,
  estado text,
  batizado boolean,
  primeira_comunhao boolean,
  estuda boolean,
  serie text,
  escola text,
  fez_retiro boolean,
  qual_retiro text,
  nome_pai text,
  telefone_pai text,
  nome_mae text,
  telefone_mae text,
  pais_movimento boolean,
  qual_movimento text,
  convidou text,
  camiseta text,
  camiseta_outro text,
  intolerancia_alimentos boolean,
  qual_intolerancia text,
  alergia_medicamento boolean,
  qual_alergia text,
  medicamento_cabeca text,
  medicamento_estomago text,
  valor_inscricao numeric(10,2) not null default 0,
  valor_pago numeric(10,2) not null default 0,
  saldo_pagar numeric(10,2) not null default 0,
  recebedor_valor_pago numeric(10,2) not null default 0,
  recebedor_taxa_paga boolean not null default false,
  recebedor_forma_pagamento text,
  recebedor_observacao text,
  criado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extras jsonb not null default '{}'::jsonb
);

create table if not exists public.comunidades (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  lider_casal_id uuid references public.casais(id) on delete set null,
  monitor_casal_id uuid references public.casais(id) on delete set null,
  criado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  extras jsonb not null default '{}'::jsonb,
  unique (retiro_id, ordem)
);

create table if not exists public.comunidade_monitores (
  comunidade_id uuid not null references public.comunidades(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  primary key (comunidade_id, pessoa_id)
);

create table if not exists public.comunidade_cursistas (
  comunidade_id uuid not null references public.comunidades(id) on delete cascade,
  cursista_id uuid not null references public.cursistas(id) on delete cascade,
  primary key (comunidade_id, cursista_id)
);

create table if not exists public.crachas (
  id uuid primary key default gen_random_uuid(),
  retiro_id uuid references public.retiros(id) on delete cascade,
  nome text not null,
  tipo text,
  configuracao jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.configuracoes (
  id text primary key,
  valor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.perfis (
  id text primary key,
  nome text not null,
  codigo text not null unique,
  descricao text,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissoes (
  id text primary key,
  modulo text not null,
  descricao text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.perfil_permissoes (
  perfil_id text not null references public.perfis(id) on delete cascade,
  permissao_id text not null references public.permissoes(id) on delete cascade,
  permitido boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (perfil_id, permissao_id)
);

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  login text not null unique,
  perfil_id text references public.perfis(id) on delete set null,
  ativo boolean not null default true,
  password_hash text,
  password_salt text,
  password_iterations integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usuario_permissoes (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  permissao_id text not null references public.permissoes(id) on delete cascade,
  permitido boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (usuario_id, permissao_id)
);

create table if not exists public.usuario_retiros (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  retiro_id uuid not null references public.retiros(id) on delete cascade,
  papel text,
  created_at timestamptz not null default now(),
  primary key (usuario_id, retiro_id)
);

create index if not exists idx_retiros_status on public.retiros(status);
create index if not exists idx_retiros_recebedor_token on public.retiros(recebedor_token);
create index if not exists idx_retiro_setores_retiro on public.retiro_setores(retiro_id);
create index if not exists idx_pessoas_nome_normalizado on public.pessoas(nome_normalizado);
create index if not exists idx_pessoas_cpf on public.pessoas(cpf);
create index if not exists idx_adesoes_retiro on public.adesoes(retiro_id);
create index if not exists idx_adesoes_pessoa on public.adesoes(pessoa_id);
create index if not exists idx_adesoes_status on public.adesoes(status);
create index if not exists idx_adesao_setores_setor on public.adesao_setores(setor_id);
create index if not exists idx_cursistas_retiro on public.cursistas(retiro_id);
create index if not exists idx_cursistas_cpf on public.cursistas(cpf);
create index if not exists idx_cursistas_nome on public.cursistas(nome);
create index if not exists idx_comunidades_retiro on public.comunidades(retiro_id);
create index if not exists idx_usuarios_login on public.usuarios(login);
create index if not exists idx_usuario_retiros_retiro on public.usuario_retiros(retiro_id);

drop trigger if exists retiros_updated_at on public.retiros;
create trigger retiros_updated_at before update on public.retiros for each row execute function public.set_updated_at();

drop trigger if exists retiro_setores_updated_at on public.retiro_setores;
create trigger retiro_setores_updated_at before update on public.retiro_setores for each row execute function public.set_updated_at();

drop trigger if exists pessoas_updated_at on public.pessoas;
create trigger pessoas_updated_at before update on public.pessoas for each row execute function public.set_updated_at();

drop trigger if exists casais_updated_at on public.casais;
create trigger casais_updated_at before update on public.casais for each row execute function public.set_updated_at();

drop trigger if exists adesoes_updated_at on public.adesoes;
create trigger adesoes_updated_at before update on public.adesoes for each row execute function public.set_updated_at();

drop trigger if exists cursistas_updated_at on public.cursistas;
create trigger cursistas_updated_at before update on public.cursistas for each row execute function public.set_updated_at();

drop trigger if exists comunidades_updated_at on public.comunidades;
create trigger comunidades_updated_at before update on public.comunidades for each row execute function public.set_updated_at();

drop trigger if exists crachas_updated_at on public.crachas;
create trigger crachas_updated_at before update on public.crachas for each row execute function public.set_updated_at();

drop trigger if exists configuracoes_updated_at on public.configuracoes;
create trigger configuracoes_updated_at before update on public.configuracoes for each row execute function public.set_updated_at();

drop trigger if exists perfis_updated_at on public.perfis;
create trigger perfis_updated_at before update on public.perfis for each row execute function public.set_updated_at();

drop trigger if exists perfil_permissoes_updated_at on public.perfil_permissoes;
create trigger perfil_permissoes_updated_at before update on public.perfil_permissoes for each row execute function public.set_updated_at();

drop trigger if exists usuarios_updated_at on public.usuarios;
create trigger usuarios_updated_at before update on public.usuarios for each row execute function public.set_updated_at();

drop trigger if exists usuario_permissoes_updated_at on public.usuario_permissoes;
create trigger usuario_permissoes_updated_at before update on public.usuario_permissoes for each row execute function public.set_updated_at();

alter table public.retiros enable row level security;
alter table public.retiro_dias enable row level security;
alter table public.retiro_setores enable row level security;
alter table public.retiro_contribuicoes enable row level security;
alter table public.pessoas enable row level security;
alter table public.casais enable row level security;
alter table public.adesoes enable row level security;
alter table public.casal_membros enable row level security;
alter table public.adesao_dias enable row level security;
alter table public.adesao_setores enable row level security;
alter table public.adesao_retiros_anteriores enable row level security;
alter table public.adesao_espaco_kids enable row level security;
alter table public.cursistas enable row level security;
alter table public.comunidades enable row level security;
alter table public.comunidade_monitores enable row level security;
alter table public.comunidade_cursistas enable row level security;
alter table public.crachas enable row level security;
alter table public.configuracoes enable row level security;
alter table public.perfis enable row level security;
alter table public.permissoes enable row level security;
alter table public.perfil_permissoes enable row level security;
alter table public.usuarios enable row level security;
alter table public.usuario_permissoes enable row level security;
alter table public.usuario_retiros enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'retiros',
    'retiro_dias',
    'retiro_setores',
    'retiro_contribuicoes',
    'pessoas',
    'casais',
    'adesoes',
    'casal_membros',
    'adesao_dias',
    'adesao_setores',
    'adesao_retiros_anteriores',
    'adesao_espaco_kids',
    'cursistas',
    'comunidades',
    'comunidade_monitores',
    'comunidade_cursistas',
    'crachas',
    'configuracoes',
    'perfis',
    'permissoes',
    'perfil_permissoes',
    'usuarios',
    'usuario_permissoes',
    'usuario_retiros'
  ]
  loop
    execute format('drop policy if exists "EPC service role full access" on public.%I', table_name);
    execute format(
      'create policy "EPC service role full access" on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
      table_name
    );
  end loop;
end;
$$;

insert into public.perfis (id, nome, codigo, descricao, locked)
values
  ('admin', 'Admin', 'admin', 'Acesso irrestrito ao sistema.', true),
  ('coordenador_geral', 'Coordenador Geral', 'coordenador_geral', 'Acesso amplo, exceto exclusoes sensiveis de usuarios.', false),
  ('coordenador_retiro', 'Coordenador do retiro', 'coordenador_retiro', 'Acesso operacional ao retiro vinculado.', false)
on conflict (id) do update set
  nome = excluded.nome,
  codigo = excluded.codigo,
  descricao = excluded.descricao,
  locked = excluded.locked;

with permission_seed(id, modulo, descricao) as (
  values
    ('inicio.ver','Inicio','Ver painel inicial'),
    ('retiros.ver','Retiros','Ver retiros'),
    ('retiros.criar','Retiros','Criar retiros'),
    ('retiros.editar','Retiros','Editar retiros'),
    ('retiros.publicar','Retiros','Publicar link'),
    ('retiros.excluir','Retiros','Excluir retiros'),
    ('pessoas.ver','Equipe de trabalho','Ver voluntarios'),
    ('pessoas.criar','Equipe de trabalho','Cadastrar voluntarios'),
    ('pessoas.editar','Equipe de trabalho','Editar voluntarios'),
    ('pessoas.excluir','Equipe de trabalho','Excluir adesoes'),
    ('validacao-inscricoes.ver','Validacao','Ver validacao'),
    ('validacao-inscricoes.validar','Validacao','Validar inscricoes'),
    ('cursista.ver','Cursista','Ver cursistas'),
    ('cursista.criar','Cursista','Cadastrar cursistas'),
    ('cursista.editar','Cursista','Editar cursistas'),
    ('cursista.excluir','Cursista','Excluir cursistas'),
    ('comunidades.ver','Comunidades','Ver comunidades'),
    ('comunidades.criar','Comunidades','Criar comunidades'),
    ('comunidades.editar','Comunidades','Editar comunidades'),
    ('comunidades.excluir','Comunidades','Excluir comunidades'),
    ('crachas.ver','Crachas','Ver crachas'),
    ('crachas.editar','Crachas','Editar modelos'),
    ('crachas.imprimir','Crachas','Imprimir crachas'),
    ('crachas.excluir','Crachas','Excluir modelos'),
    ('quadrante.ver','Quadrante','Ver quadrante'),
    ('quadrante.imprimir','Quadrante','Imprimir quadrante'),
    ('recebedor.ver','Recebedor','Ver recebedor'),
    ('recebedor.editar','Recebedor','Editar pagamentos'),
    ('usuarios.ver','Usuarios e permissoes','Ver usuarios e permissoes'),
    ('usuarios.criar','Usuarios e permissoes','Criar usuarios'),
    ('usuarios.editar','Usuarios e permissoes','Editar usuarios e permissoes'),
    ('usuarios.excluir','Usuarios e permissoes','Excluir usuarios')
)
insert into public.permissoes (id, modulo, descricao)
select id, modulo, descricao
from permission_seed
on conflict (id) do update set
  modulo = excluded.modulo,
  descricao = excluded.descricao;

with permission_seed(id) as (
  values
    ('inicio.ver'),('retiros.ver'),('retiros.criar'),('retiros.editar'),('retiros.publicar'),('retiros.excluir'),
    ('pessoas.ver'),('pessoas.criar'),('pessoas.editar'),('pessoas.excluir'),
    ('validacao-inscricoes.ver'),('validacao-inscricoes.validar'),
    ('cursista.ver'),('cursista.criar'),('cursista.editar'),('cursista.excluir'),
    ('comunidades.ver'),('comunidades.criar'),('comunidades.editar'),('comunidades.excluir'),
    ('crachas.ver'),('crachas.editar'),('crachas.imprimir'),('crachas.excluir'),
    ('quadrante.ver'),('quadrante.imprimir'),('recebedor.ver'),('recebedor.editar'),
    ('usuarios.ver'),('usuarios.criar'),('usuarios.editar'),('usuarios.excluir')
),
profile_seed(perfil_id, permissao_id, permitido) as (
  select 'admin', id, true from permission_seed
  union all
  select 'coordenador_geral', id, id <> 'usuarios.excluir' from permission_seed
  union all
  select 'coordenador_retiro', id, id in (
    'inicio.ver','retiros.ver','retiros.editar','pessoas.ver','pessoas.criar','pessoas.editar','pessoas.excluir',
    'validacao-inscricoes.ver','validacao-inscricoes.validar','cursista.ver','cursista.criar','cursista.editar',
    'comunidades.ver','comunidades.criar','comunidades.editar','crachas.ver','crachas.editar','crachas.imprimir',
    'quadrante.ver','quadrante.imprimir','recebedor.ver','recebedor.editar'
  ) from permission_seed
)
insert into public.perfil_permissoes (perfil_id, permissao_id, permitido)
select perfil_id, permissao_id, permitido
from profile_seed
on conflict (perfil_id, permissao_id) do update set
  permitido = excluded.permitido;
