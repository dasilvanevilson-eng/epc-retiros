-- Salvamento atomico da ficha de casal da equipe de trabalho.
-- Esta migracao e somente estrutural: nao altera fichas existentes.
-- A funcao executa em uma unica transacao; qualquer erro desfaz todas as etapas.

create or replace function public.epc_save_team_couple_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_couple_id uuid;
  v_retreat_id uuid;
  v_participant jsonb;
  v_person jsonb;
  v_enrolment jsonb;
  v_kid jsonb;
  v_name text;
  v_cpf text;
  v_person_id uuid;
  v_enrolment_id uuid;
  v_day_id uuid;
  v_sector_id uuid;
  v_index integer;
  v_order integer;
  v_saved_ids uuid[] := array[]::uuid[];
  v_saved_count integer;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'participants') <> 'array'
     or jsonb_array_length(p_payload->'participants') <> 2 then
    raise exception 'A ficha de casal deve conter exatamente dois integrantes.';
  end if;

  v_couple_id := nullif(p_payload->>'couple_id', '')::uuid;
  v_retreat_id := nullif(p_payload->>'retreat_id', '')::uuid;
  if v_couple_id is null or v_retreat_id is null then
    raise exception 'Casal ou retiro nao informado.';
  end if;
  perform 1 from public.retiros where id = v_retreat_id for share;
  if not found then
    raise exception 'Retiro nao encontrado.';
  end if;
  if exists (
    select 1 from public.casais
    where id = v_couple_id and retiro_id is distinct from v_retreat_id
  ) then
    raise exception 'O casal informado pertence a outro retiro.';
  end if;

  insert into public.casais (id, retiro_id, nome, extras)
  values (
    v_couple_id,
    v_retreat_id,
    concat_ws(' e ', p_payload#>>'{participants,0,person,nome}', p_payload#>>'{participants,1,person,nome}'),
    '{}'::jsonb
  )
  on conflict (id) do update set
    retiro_id = excluded.retiro_id,
    nome = excluded.nome,
    updated_at = now();

  for v_index in 0..1 loop
    v_participant := p_payload->'participants'->v_index;
    v_person := v_participant->'person';
    v_enrolment := v_participant->'enrolment';
    v_cpf := regexp_replace(coalesce(v_person->>'cpf', ''), '\D', '', 'g');
    if length(v_cpf) <> 11 then
      raise exception 'CPF invalido no integrante %.', v_index + 1;
    end if;
    if v_index = 1 and v_cpf = regexp_replace(coalesce(p_payload#>>'{participants,0,person,cpf}', ''), '\D', '', 'g') then
      raise exception 'Os integrantes devem possuir CPFs diferentes.';
    end if;
    if nullif(v_enrolment->>'retiro_id', '')::uuid is distinct from v_retreat_id then
      raise exception 'Os integrantes devem pertencer ao mesmo retiro.';
    end if;

    v_enrolment_id := nullif(v_enrolment->>'id', '')::uuid;
    if v_enrolment_id is null then
      raise exception 'Identificador da adesao nao informado no integrante %.', v_index + 1;
    end if;
    select pessoa_id into v_person_id
    from public.adesoes
    where id = v_enrolment_id;

    if v_person_id is not null then
      if exists (select 1 from public.pessoas where cpf = v_cpf and id <> v_person_id) then
        raise exception 'O novo CPF ja esta vinculado a outra pessoa.';
      end if;
      update public.pessoas set
        cpf = v_cpf,
        nome = coalesce(nullif(v_person->>'nome', ''), 'Sem nome'),
        nome_normalizado = coalesce(v_person->>'nome_normalizado', ''),
        nascimento = nullif(v_person->>'nascimento', '')::date,
        genero = coalesce(v_person->>'genero', ''),
        telefone = coalesce(v_person->>'telefone', ''),
        cep = coalesce(v_person->>'cep', ''),
        endereco = coalesce(v_person->>'endereco', ''),
        numero = coalesce(v_person->>'numero', ''),
        bairro = coalesce(v_person->>'bairro', ''),
        cidade = coalesce(v_person->>'cidade', ''),
        estado = coalesce(v_person->>'estado', ''),
        updated_at = coalesce(nullif(v_person->>'updated_at', '')::timestamptz, now()),
        extras = coalesce(v_person->'extras', '{}'::jsonb)
      where id = v_person_id
      returning id into v_person_id;
    else
      insert into public.pessoas (
      cpf, nome, nome_normalizado, nascimento, genero, telefone, cep, endereco,
      numero, bairro, cidade, estado, created_at, updated_at, extras
      ) values (
        v_cpf,
        coalesce(nullif(v_person->>'nome', ''), 'Sem nome'),
        coalesce(v_person->>'nome_normalizado', ''),
        nullif(v_person->>'nascimento', '')::date,
        coalesce(v_person->>'genero', ''),
        coalesce(v_person->>'telefone', ''),
        coalesce(v_person->>'cep', ''),
        coalesce(v_person->>'endereco', ''),
        coalesce(v_person->>'numero', ''),
        coalesce(v_person->>'bairro', ''),
        coalesce(v_person->>'cidade', ''),
        coalesce(v_person->>'estado', ''),
        coalesce(nullif(v_person->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(v_person->>'updated_at', '')::timestamptz, now()),
        coalesce(v_person->'extras', '{}'::jsonb)
      )
      on conflict (cpf) do update set
        nome = excluded.nome,
        nome_normalizado = excluded.nome_normalizado,
        nascimento = excluded.nascimento,
        genero = excluded.genero,
        telefone = excluded.telefone,
        cep = excluded.cep,
        endereco = excluded.endereco,
        numero = excluded.numero,
        bairro = excluded.bairro,
        cidade = excluded.cidade,
        estado = excluded.estado,
        updated_at = excluded.updated_at,
        extras = excluded.extras
      returning id into v_person_id;
    end if;
    if exists (
      select 1 from public.adesoes
      where retiro_id = v_retreat_id
        and pessoa_id = v_person_id
        and id <> v_enrolment_id
    ) then
      raise exception 'Este CPF ja possui adesao neste retiro.';
    end if;

    insert into public.adesoes (
      id, retiro_id, pessoa_id, casal_id, nome, tipo_ficha, papel_no_casal,
      quadrante, foto, contribuicao, coordenacao, coordenacao_setor,
      espaco_kids_nao_necessito, observacao, termo_voluntariado_aceito,
      termo_voluntariado_aceito_em, tipo_financeiro, taxa_paga, valor_pago,
      forma_pagamento, recebedor_observacao, status, validada, validado_em,
      enviado_em, atualizado_em, created_at, updated_at, dados_pessoais, extras
    ) values (
      v_enrolment_id,
      v_retreat_id,
      v_person_id,
      v_couple_id,
      coalesce(v_enrolment->>'nome', v_person->>'nome', ''),
      coalesce(nullif(v_enrolment->>'tipo_ficha', ''), 'Casal'),
      coalesce(v_enrolment->>'papel_no_casal', ''),
      coalesce((v_enrolment->>'quadrante')::boolean, false),
      coalesce((v_enrolment->>'foto')::boolean, false),
      coalesce(v_enrolment->>'contribuicao', ''),
      coalesce(v_enrolment->>'coordenacao', ''),
      coalesce(v_enrolment->>'coordenacao_setor', ''),
      coalesce((v_enrolment->>'espaco_kids_nao_necessito')::boolean, false),
      coalesce(v_enrolment->>'observacao', ''),
      coalesce((v_enrolment->>'termo_voluntariado_aceito')::boolean, false),
      nullif(v_enrolment->>'termo_voluntariado_aceito_em', '')::timestamptz,
      coalesce(v_enrolment->>'tipo_financeiro', ''),
      coalesce((v_enrolment->>'taxa_paga')::boolean, false),
      coalesce(nullif(v_enrolment->>'valor_pago', '')::numeric, 0),
      coalesce(v_enrolment->>'forma_pagamento', ''),
      coalesce(v_enrolment->>'recebedor_observacao', ''),
      coalesce(nullif(v_enrolment->>'status', ''), 'pendente_validacao'),
      coalesce((v_enrolment->>'validada')::boolean, false),
      nullif(v_enrolment->>'validado_em', '')::timestamptz,
      coalesce(nullif(v_enrolment->>'enviado_em', '')::timestamptz, now()),
      nullif(v_enrolment->>'atualizado_em', '')::timestamptz,
      coalesce(nullif(v_enrolment->>'created_at', '')::timestamptz, now()),
      coalesce(nullif(v_enrolment->>'updated_at', '')::timestamptz, now()),
      coalesce(v_enrolment->'dados_pessoais', '{}'::jsonb),
      coalesce(v_enrolment->'extras', '{}'::jsonb)
    )
    on conflict (id) do update set
      retiro_id = excluded.retiro_id,
      pessoa_id = excluded.pessoa_id,
      casal_id = excluded.casal_id,
      nome = excluded.nome,
      tipo_ficha = excluded.tipo_ficha,
      papel_no_casal = excluded.papel_no_casal,
      quadrante = excluded.quadrante,
      foto = excluded.foto,
      contribuicao = excluded.contribuicao,
      coordenacao = excluded.coordenacao,
      coordenacao_setor = excluded.coordenacao_setor,
      espaco_kids_nao_necessito = excluded.espaco_kids_nao_necessito,
      observacao = excluded.observacao,
      termo_voluntariado_aceito = excluded.termo_voluntariado_aceito,
      termo_voluntariado_aceito_em = excluded.termo_voluntariado_aceito_em,
      tipo_financeiro = excluded.tipo_financeiro,
      taxa_paga = excluded.taxa_paga,
      valor_pago = excluded.valor_pago,
      forma_pagamento = excluded.forma_pagamento,
      recebedor_observacao = excluded.recebedor_observacao,
      status = excluded.status,
      validada = excluded.validada,
      validado_em = excluded.validado_em,
      enviado_em = excluded.enviado_em,
      atualizado_em = excluded.atualizado_em,
      updated_at = excluded.updated_at,
      dados_pessoais = excluded.dados_pessoais,
      extras = excluded.extras;

    delete from public.casal_membros where adesao_id = v_enrolment_id;
    delete from public.adesao_dias where adesao_id = v_enrolment_id;
    delete from public.adesao_setores where adesao_id = v_enrolment_id;
    delete from public.adesao_retiros_anteriores where adesao_id = v_enrolment_id;
    delete from public.adesao_espaco_kids where adesao_id = v_enrolment_id;

    for v_name in select jsonb_array_elements_text(coalesce(v_enrolment->'dias', '[]'::jsonb)) loop
      insert into public.retiro_dias (retiro_id, nome, ordem)
      values (v_retreat_id, v_name, 999)
      on conflict (retiro_id, nome) do update set nome = excluded.nome
      returning id into v_day_id;
      insert into public.adesao_dias (adesao_id, dia_id)
      values (v_enrolment_id, v_day_id)
      on conflict do nothing;
    end loop;

    for v_name in select jsonb_array_elements_text(coalesce(v_enrolment->'setores', '[]'::jsonb)) loop
      insert into public.retiro_setores (retiro_id, nome, nome_normalizado, publico, ordem_quadrante)
      values (v_retreat_id, v_name, lower(trim(v_name)), true, 999)
      on conflict (retiro_id, nome) do update set nome = excluded.nome
      returning id into v_sector_id;
      insert into public.adesao_setores (adesao_id, setor_id)
      values (v_enrolment_id, v_sector_id)
      on conflict do nothing;
    end loop;

    v_order := 0;
    for v_name in select jsonb_array_elements_text(coalesce(v_enrolment->'retiros_anteriores', '[]'::jsonb)) loop
      v_order := v_order + 1;
      insert into public.adesao_retiros_anteriores (adesao_id, nome, ordem)
      values (v_enrolment_id, v_name, v_order);
    end loop;

    for v_kid in select value from jsonb_array_elements(coalesce(v_enrolment->'espaco_kids', '[]'::jsonb)) loop
      insert into public.adesao_espaco_kids (
        adesao_id, nome, nascimento, problema_saude, descricao_saude,
        intolerancia_alimentar, descricao_intolerancia, ordem
      ) values (
        v_enrolment_id,
        coalesce(v_kid->>'nome', ''),
        nullif(v_kid->>'nascimento', '')::date,
        nullif(v_kid->>'problema_saude', '')::boolean,
        nullif(v_kid->>'descricao_saude', ''),
        nullif(v_kid->>'intolerancia_alimentar', '')::boolean,
        nullif(v_kid->>'descricao_intolerancia', ''),
        coalesce(nullif(v_kid->>'ordem', '')::integer, 0)
      );
    end loop;

    insert into public.casal_membros (casal_id, adesao_id, papel)
    values (v_couple_id, v_enrolment_id, coalesce(v_enrolment->>'papel_no_casal', ''))
    on conflict (casal_id, adesao_id) do update set papel = excluded.papel;
    v_saved_ids := array_append(v_saved_ids, v_enrolment_id);
  end loop;

  select count(*) into v_saved_count
  from public.adesoes
  where id = any(v_saved_ids)
    and retiro_id = v_retreat_id
    and casal_id = v_couple_id;
  if v_saved_count <> 2 then
    raise exception 'A confirmacao dos dois integrantes falhou; nenhuma alteracao foi aplicada.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'couple_id', v_couple_id,
    'retreat_id', v_retreat_id,
    'enrolment_ids', to_jsonb(v_saved_ids)
  );
end;
$$;

revoke all on function public.epc_save_team_couple_atomic(jsonb) from public;
grant execute on function public.epc_save_team_couple_atomic(jsonb) to service_role;
