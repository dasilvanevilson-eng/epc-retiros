-- EPC Retiros - saude e intolerancia alimentar das criancas do Cursista SMP
--
-- Antes de executar em producao:
-- 1. Fazer backup/snapshot da tabela public.cursista_smp.
-- 2. Executar a auditoria previa abaixo e guardar o resultado.
-- 3. Aplicar este patch antes de publicar o codigo da tela.
--
-- Auditoria previa sugerida:
-- select
--   count(*) as total_fichas,
--   count(*) filter (where comum_kid_1_nome is not null or comum_kid_1_nascimento is not null) as fichas_com_kid_1,
--   count(*) filter (where comum_kid_2_nome is not null or comum_kid_2_nascimento is not null) as fichas_com_kid_2,
--   count(*) filter (where comum_kid_3_nome is not null or comum_kid_3_nascimento is not null) as fichas_com_kid_3,
--   count(*) filter (where comum_kid_4_nome is not null or comum_kid_4_nascimento is not null) as fichas_com_kid_4,
--   count(*) filter (where comum_kid_5_nome is not null or comum_kid_5_nascimento is not null) as fichas_com_kid_5
-- from public.cursista_smp;

begin;

alter table public.cursista_smp
  add column if not exists comum_kid_1_problema_saude boolean,
  add column if not exists comum_kid_1_descricao_saude text,
  add column if not exists comum_kid_1_intolerancia_alimentar boolean,
  add column if not exists comum_kid_1_descricao_intolerancia text,
  add column if not exists comum_kid_2_problema_saude boolean,
  add column if not exists comum_kid_2_descricao_saude text,
  add column if not exists comum_kid_2_intolerancia_alimentar boolean,
  add column if not exists comum_kid_2_descricao_intolerancia text,
  add column if not exists comum_kid_3_problema_saude boolean,
  add column if not exists comum_kid_3_descricao_saude text,
  add column if not exists comum_kid_3_intolerancia_alimentar boolean,
  add column if not exists comum_kid_3_descricao_intolerancia text,
  add column if not exists comum_kid_4_problema_saude boolean,
  add column if not exists comum_kid_4_descricao_saude text,
  add column if not exists comum_kid_4_intolerancia_alimentar boolean,
  add column if not exists comum_kid_4_descricao_intolerancia text,
  add column if not exists comum_kid_5_problema_saude boolean,
  add column if not exists comum_kid_5_descricao_saude text,
  add column if not exists comum_kid_5_intolerancia_alimentar boolean,
  add column if not exists comum_kid_5_descricao_intolerancia text;

commit;

-- Auditoria posterior sugerida: deve retornar 20 colunas.
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'cursista_smp'
--   and column_name ~ '^comum_kid_[1-5]_(problema_saude|descricao_saude|intolerancia_alimentar|descricao_intolerancia)$'
-- order by column_name;
