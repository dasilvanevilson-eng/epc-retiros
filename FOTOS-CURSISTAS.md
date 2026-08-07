# Implantação das fotos de cursistas

As fotos são dados privados e históricos. O arquivo `supabase-cursista-fotos.sql` é aditivo, mas deve ser aplicado somente em uma janela controlada.

## Antes da migração

1. Gere e baixe um snapshot pela tela administrativa de backup.
2. Registre as contagens atuais:

```sql
select 'individual' as tipo, count(*) from public.cursistas
union all select 'smp', count(*) from public.cursista_smp
union all select 'epc', count(*) from public.cursista_epc;
```

3. Execute `npm.cmd run audit:registrations` e mantenha o resultado junto ao snapshot.
4. Aplique `supabase-cursista-fotos.sql` no SQL Editor do Supabase.

## Verificação posterior

Confirme que:

- as três contagens continuam idênticas;
- o bucket `cursista-fotos` está marcado como privado;
- o limite do bucket é 2 MB e o único MIME permitido é `image/jpeg`;
- `public.cursista_fotos` está vazia antes do primeiro upload;
- não existem policies públicas criadas especificamente para o bucket ou a tabela;
- a aplicação consegue salvar uma ficha sem foto, como antes.

## Backup

O backup relacional da aplicação inclui a tabela `cursista_fotos`, isto é, os vínculos e o histórico das versões. Os binários permanecem no Supabase Storage e precisam de uma cópia própria do bucket. Não restaure metadados de fotos em outro projeto sem restaurar também os mesmos caminhos do bucket.

As substituições criam uma nova versão e não removem objetos anteriores. A ação logada **Excluir foto** remove definitivamente a foto ativa, todas as versões anteriores daquela ficha e seus metadados. Ela exige confirmação explícita e não fica disponível no acesso público.
