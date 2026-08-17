-- Movimentacao atomica de um cursista/casal entre comunidades.
-- Esta migracao e somente estrutural: nao altera vinculos existentes ao ser aplicada.
-- A funcao remove somente os vinculos do integrante informado dentro do retiro
-- e insere o destino na mesma transacao. Qualquer erro desfaz toda a operacao.

begin;

create or replace function public.epc_move_community_member_atomic(
  p_retiro_id uuid,
  p_comunidade_destino_id uuid,
  p_tipo text,
  p_cursista_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tipo text := lower(btrim(coalesce(p_tipo, '')));
  v_cursista_id text := btrim(coalesce(p_cursista_id, ''));
  v_cursista_uuid uuid;
  v_removidos integer := 0;
  v_retiro_status text;
begin
  if p_retiro_id is null or p_comunidade_destino_id is null or v_cursista_id = '' then
    raise exception 'Retiro, comunidade de destino e integrante sao obrigatorios.';
  end if;

  if v_tipo not in ('individual', 'smp', 'epc') then
    raise exception 'Tipo de ficha de cursista invalido.';
  end if;

  select status into v_retiro_status
  from public.retiros
  where id = p_retiro_id
  for share;
  if not found then
    raise exception 'Retiro nao encontrado.';
  end if;
  if v_retiro_status = 'concluido' then
    raise exception 'Retiro encerrado: comunidades disponiveis apenas para consulta.';
  end if;

  perform 1
  from public.comunidades
  where id = p_comunidade_destino_id
    and retiro_id = p_retiro_id
  for update;
  if not found then
    raise exception 'A comunidade de destino nao pertence ao retiro informado.';
  end if;

  if v_tipo = 'individual' then
    begin
      v_cursista_uuid := v_cursista_id::uuid;
    exception when invalid_text_representation then
      raise exception 'Identificador do cursista individual invalido.';
    end;

    perform 1
    from public.cursistas
    where id = v_cursista_uuid
      and retiro_id = p_retiro_id
    for update;
    if not found then
      raise exception 'Cursista individual nao encontrado neste retiro.';
    end if;

    delete from public.comunidade_cursistas vinculo
    using public.comunidades comunidade
    where vinculo.comunidade_id = comunidade.id
      and comunidade.retiro_id = p_retiro_id
      and vinculo.cursista_id = v_cursista_uuid;
    get diagnostics v_removidos = row_count;

    insert into public.comunidade_cursistas (comunidade_id, cursista_id)
    values (p_comunidade_destino_id, v_cursista_uuid);
  elsif v_tipo = 'smp' then
    perform 1
    from public.cursista_smp
    where retiro_id = p_retiro_id
      and id = v_cursista_id
    for update;
    if not found then
      raise exception 'Ficha SMP nao encontrada neste retiro.';
    end if;

    delete from public.comunidade_cursistas_smp
    where retiro_id = p_retiro_id
      and cursista_id = v_cursista_id;
    get diagnostics v_removidos = row_count;

    insert into public.comunidade_cursistas_smp (comunidade_id, retiro_id, cursista_id)
    values (p_comunidade_destino_id, p_retiro_id, v_cursista_id);
  else
    perform 1
    from public.cursista_epc
    where retiro_id = p_retiro_id
      and id = v_cursista_id
    for update;
    if not found then
      raise exception 'Ficha EPC nao encontrada neste retiro.';
    end if;

    delete from public.comunidade_cursistas_epc
    where retiro_id = p_retiro_id
      and cursista_id = v_cursista_id;
    get diagnostics v_removidos = row_count;

    insert into public.comunidade_cursistas_epc (comunidade_id, retiro_id, cursista_id)
    values (p_comunidade_destino_id, p_retiro_id, v_cursista_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'retiroId', p_retiro_id,
    'comunidadeDestinoId', p_comunidade_destino_id,
    'tipo', v_tipo,
    'cursistaId', v_cursista_id,
    'vinculosAnterioresRemovidos', v_removidos
  );
end;
$$;

revoke all on function public.epc_move_community_member_atomic(uuid, uuid, text, text) from public;
revoke all on function public.epc_move_community_member_atomic(uuid, uuid, text, text) from anon, authenticated;
grant execute on function public.epc_move_community_member_atomic(uuid, uuid, text, text) to service_role;

commit;

notify pgrst, 'reload schema';

-- Auditoria recomendada antes e depois da aplicacao. As contagens devem permanecer iguais.
-- select count(*) as comunidades from public.comunidades;
-- select count(*) as vinculos_individuais from public.comunidade_cursistas;
-- select count(*) as vinculos_smp from public.comunidade_cursistas_smp;
-- select count(*) as vinculos_epc from public.comunidade_cursistas_epc;

-- Auditoria de integrantes atualmente vinculados a mais de uma comunidade no mesmo retiro.
-- select c.retiro_id, cc.cursista_id::text, count(*)
-- from public.comunidade_cursistas cc join public.comunidades c on c.id = cc.comunidade_id
-- group by c.retiro_id, cc.cursista_id having count(*) > 1;
-- select retiro_id, cursista_id, count(*) from public.comunidade_cursistas_smp
-- group by retiro_id, cursista_id having count(*) > 1;
-- select retiro_id, cursista_id, count(*) from public.comunidade_cursistas_epc
-- group by retiro_id, cursista_id having count(*) > 1;
