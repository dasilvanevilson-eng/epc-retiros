-- EPC Retiros - patch incremental para o schema relacional ja executado
-- Necessario porque o fluxo atual usa CPF como identificador externo de cursistas.

alter table public.cursistas
add column if not exists cpf text;

create unique index if not exists cursistas_cpf_unique
on public.cursistas(cpf)
where cpf is not null;

create index if not exists idx_cursistas_cpf
on public.cursistas(cpf);
