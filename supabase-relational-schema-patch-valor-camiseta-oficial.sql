-- EPC Retiros - patch incremental para adicionar o valor da camiseta oficial do retiro

alter table public.retiros
add column if not exists valor_camiseta_oficial numeric(10,2) not null default 0;
