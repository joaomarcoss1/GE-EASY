-- =====================================================================
-- Teste da Fase 9: situação de venda, indicadores diários, relatório operacional e relatório mensal
-- (ranking, pontos de atenção, comparação, isolamento). Rollback ao final (RAISE).
-- =====================================================================
create function pg_temp.como(p_uid uuid, p_emp uuid default null) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.headers', case when p_emp is null then '' else json_build_object('x-empresa-id', p_emp)::text end, true);
  if p_uid is not null then execute 'set local role authenticated'; end if;
end $$;
create function pg_temp.ok(p boolean, p_label text) returns text language sql as $$
  select E'\n' || case when coalesce(p, false) then 'ok      ' else 'FALHOU  ' end || p_label
$$;
create function pg_temp.usuario(p_email text, p_meta jsonb) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, p_meta, '{}');
  return v;
end $$;

do $$
declare
  e uuid; e2 uuid; master uuid; c1 uuid; c2 uuid; outro uuid; cli uuid; op uuid; rel uuid; j jsonb; r text := '';
  mes_passado date := (date_trunc('month', current_date) - interval '1 month')::date; v_dia date;
begin
  insert into public.empresas (nome, slug) values ('Empresa BI', 'empresa-bi') returning id into e;
  insert into public.empresas (nome, slug) values ('Outra BI', 'outra-bi') returning id into e2;
  perform public.provisionar_empresa(e);
  perform public.provisionar_empresa(e2);
  master := pg_temp.usuario('t-bim@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  c1 := pg_temp.usuario('t-bic1@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  c2 := pg_temp.usuario('t-bic2@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  outro := pg_temp.usuario('t-bio@test.local', jsonb_build_object('ge_empresa_id', e2, 'ge_role', 'admin', 'ge_admin_master', true));
  v_dia := mes_passado + 4;

  -- ---------------- dados do mês passado (inseridos pelo servidor com datas retroativas)
  execute 'reset role';
  insert into public.clientes (empresa_id, nome, consultor_id, origem, cidade, created_at) values
    (e, 'Cliente A', c1, 'lead_site', 'Fortaleza', (v_dia + time '10:00') at time zone 'America/Sao_Paulo'),
    (e, 'Cliente B', c1, 'indicacao', 'Fortaleza', (v_dia + time '11:00') at time zone 'America/Sao_Paulo'),
    (e, 'Cliente C', c2, 'lead_site', 'Caucaia', (v_dia + time '12:00') at time zone 'America/Sao_Paulo');
  select id into cli from public.clientes where empresa_id = e and nome = 'Cliente A';
  insert into public.oportunidades (empresa_id, cliente_id, titulo, linha, valor, etapa, consultor_id) values (e, cli, 'Consórcio imóvel', 'consorcio', 100000, 'proposta', c1) returning id into op;
  r := r || pg_temp.ok((select situacao_venda from public.oportunidades where id = op) = 'enviada', '1 situação da venda deriva da etapa do funil');
  update public.oportunidades set etapa = 'ganho' where id = op;
  r := r || pg_temp.ok((select situacao_venda from public.oportunidades where id = op) = 'aprovada', '2 venda ganha fica aprovada');
  update public.oportunidades set situacao_venda = 'pendente_confirmacao' where id = op;
  r := r || pg_temp.ok((select situacao_venda from public.oportunidades where id = op) = 'pendente_confirmacao', '3 situação pode ser informada manualmente');
  update public.oportunidades set situacao_em = (v_dia + time '15:00') at time zone 'America/Sao_Paulo' where id = op;

  -- ---------------- agregação
  perform public.agregar_indicadores(e, v_dia);
  r := r || pg_temp.ok((select (m->>'clientes_novos')::int from public.indicadores_diarios where empresa_id = e and dia = v_dia and consultor_id is null) = 3
                       and (select (m->>'clientes_novos')::int from public.indicadores_diarios where empresa_id = e and dia = v_dia and consultor_id = c1) = 2, '4 indicadores do dia: total e por consultor');
  perform public.agregar_indicadores(e, v_dia);
  r := r || pg_temp.ok((select count(*) from public.indicadores_diarios where empresa_id = e and dia = v_dia) = 3, '5 reagregar o mesmo dia não duplica');
  perform pg_temp.como(c1, e);
  r := r || pg_temp.ok(not exists (select 1 from public.indicadores_diarios where consultor_id = c2) and exists (select 1 from public.indicadores_diarios where consultor_id = c1), '6 consultor vê só os próprios indicadores');
  perform pg_temp.como(outro, e2);
  r := r || pg_temp.ok(not exists (select 1 from public.indicadores_diarios where empresa_id = e), '7 outra empresa não vê indicadores');

  -- ---------------- relatório operacional
  perform pg_temp.como(master, e);
  j := public.relatorio_operacional(mes_passado, (mes_passado + interval '1 month - 1 day')::date);
  r := r || pg_temp.ok((j->'total'->>'clientes_novos')::int = 3 and jsonb_array_length(j->'consultores') = 2, '8 relatório operacional soma o período');
  perform pg_temp.como(c1, e);
  begin
    perform public.relatorio_operacional(mes_passado, current_date);
    r := r || pg_temp.ok(false, '9 consultor vê relatório geral');
  exception when others then r := r || pg_temp.ok(true, '9 relatório geral só para gestão');
  end;

  -- ---------------- relatório mensal
  perform pg_temp.como(master, e);
  rel := public.gerar_relatorio_mensal(e, mes_passado);
  select dados into j from public.relatorios_mensais where id = rel;
  r := r || pg_temp.ok((j->'indicadores'->>'clientes_novos')::int = 3 and (j->'clientes'->'por_origem'->>'lead_site')::int = 2, '10 mensal: clientes novos por origem');
  r := r || pg_temp.ok(jsonb_array_length(j->'ranking') = 2 and (j->'ranking'->0->>'nome') like 't-bic1%' or (j->'ranking'->0->>'consultor_id')::uuid = c1, '11 ranking ponderado ordena os consultores');
  r := r || pg_temp.ok(exists (select 1 from jsonb_array_elements(j->'vendas'->'lista') x where x->>'situacao' = 'pendente_confirmacao' and x->>'cliente' = 'Cliente A'), '12 lista nominal de vendas pendentes de confirmação');
  r := r || pg_temp.ok(j ? 'anterior' and j ? 'atencao' and j ? 'gastos', '13 comparação com o mês anterior e pontos de atenção');
  r := r || pg_temp.ok(exists (select 1 from public.notificacoes where chave = 'relatorio-mensal:' || rel and user_id = master), '14 gestor é avisado');
  perform public.gerar_relatorio_mensal(e, mes_passado);
  r := r || pg_temp.ok((select count(*) from public.relatorios_mensais where empresa_id = e) = 1, '15 regerar atualiza o mesmo relatório');
  begin
    perform public.gerar_relatorio_mensal(e, current_date);
    r := r || pg_temp.ok(false, '16 relatório do mês corrente');
  exception when others then r := r || pg_temp.ok(true, '16 só meses encerrados');
  end;
  perform pg_temp.como(outro, e2);
  r := r || pg_temp.ok(not exists (select 1 from public.relatorios_mensais where id = rel), '17 outra empresa não vê o relatório');
  begin
    perform public.gerar_relatorio_mensal(e, mes_passado);
    r := r || pg_temp.ok(false, '18 gerar relatório de outra empresa');
  exception when others then r := r || pg_temp.ok(true, '18 não gera relatório de outra empresa');
  end;
  execute 'reset role';
  perform public.processar_relatorios_mensais();
  r := r || pg_temp.ok((select count(*) from public.relatorios_mensais where empresa_id = e) = 1, '19 rotina automática não refaz o que já existe');

  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
