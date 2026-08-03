-- EPC Retiros - patch incremental para o schema relacional ja executado
-- Compatibilidade: CPF e dado pessoal pesquisavel, nao identificador externo.
-- A unicidade e definida por retiro em supabase-cursista-individual-identidade.sql.

alter table public.cursistas
add column if not exists cpf text;

create index if not exists idx_cursistas_cpf
on public.cursistas(cpf);
