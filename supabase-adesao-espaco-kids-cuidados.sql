-- EPC Retiros - dados de saude das criancas da Equipe de Trabalho
--
-- Esta migracao e exclusivamente aditiva. Ela nao altera o conteudo das
-- criancas ja cadastradas; as novas colunas permanecem NULL nesses registros.
--
-- Antes de executar em producao:
-- 1. Fazer backup/snapshot da tabela public.adesao_espaco_kids.
-- 2. Guardar o resultado da auditoria previa abaixo.
-- 3. Aplicar este patch antes de publicar o codigo da tela.
--
-- Auditoria previa sugerida:
-- select count(*) as total_criancas,
--        count(distinct adesao_id) as total_adesoes_com_criancas,
--        md5(string_agg(concat_ws('|', id, adesao_id, nome, nascimento, ordem), '||' order by id)) as checksum_historico
-- from public.adesao_espaco_kids;

begin;

alter table public.adesao_espaco_kids
  add column if not exists problema_saude boolean,
  add column if not exists descricao_saude text,
  add column if not exists intolerancia_alimentar boolean,
  add column if not exists descricao_intolerancia text;

commit;

-- Auditoria posterior:
-- 1. Repetir a consulta previa e confirmar os mesmos totais e checksum.
-- 2. Confirmar as quatro colunas com a consulta abaixo (todas anulaveis):
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'adesao_espaco_kids'
--   and column_name in ('problema_saude', 'descricao_saude', 'intolerancia_alimentar', 'descricao_intolerancia')
-- order by column_name;
