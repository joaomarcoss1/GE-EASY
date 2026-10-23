-- =====================================================================
-- Teste da Fase 7: funcionários e dados sensíveis, ponto inalterável (NSR/hash, cerca, offline, sequência),
-- ajustes e ausências com aprovação, cálculo diário/espelho com ciência e pré-folha → contas a pagar.
-- Rollback ao final (RAISE).
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
  e uuid; e2 uuid; master uuid; rh uuid; func uuid; cons uuid; outro uuid; v_dep uuid; v_nivel uuid;
  fu uuid; fc uuid; jor uuid; m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); aj uuid; aus uuid; esp uuid; comp uuid;
  j jsonb; d date := (date_trunc('month', now()) - interval '1 month')::date + 2; -- um dia do mês passado
  n int; r text := ''; v_fuso text := 'America/Sao_Paulo';
begin
  insert into public.empresas (nome, slug) values ('Empresa RH', 'empresa-rh') returning id into e;
  insert into public.empresas (nome, slug) values ('Outra RH', 'outra-rh') returning id into e2;
  perform public.provisionar_empresa(e);
  perform public.provisionar_empresa(e2);
  master := pg_temp.usuario('t-rhm@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  rh := pg_temp.usuario('t-rhg@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'administrativo'));
  func := pg_temp.usuario('t-rhf@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'administrativo'));
  cons := pg_temp.usuario('t-rhc@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  outro := pg_temp.usuario('t-rho@test.local', jsonb_build_object('ge_empresa_id', e2, 'ge_role', 'admin', 'ge_admin_master', true));
  perform pg_temp.como(master, e);
  select d2.id, nv.id into v_dep, v_nivel from public.departamentos d2 join public.departamento_niveis nv on nv.departamento_id = d2.id and nv.nome = 'Gestor' where d2.empresa_id = e and d2.tipo = 'rh';
  insert into public.departamento_membros (departamento_id, user_id, nivel_id) values (v_dep, rh, v_nivel);

  -- ---------------- funcionários
  r := r || pg_temp.ok((select count(*) from public.funcionarios where empresa_id = e) >= 4, '1 usuários da empresa viram funcionários');
  select id into fu from public.funcionarios where empresa_id = e and user_id = func;
  select id into fc from public.funcionarios where empresa_id = e and user_id = cons;
  perform pg_temp.como(rh, e);
  insert into public.jornadas (nome, entrada, saida, intervalo_min, tolerancia_min, dias) values ('Comercial', '08:00', '17:00', 60, 10, array[extract(isodow from d)::int, extract(isodow from d + 1)::int]) returning id into jor;
  update public.funcionarios set jornada_id = jor, tipo_contrato = 'clt', admissao = d - 30 where id in (fu, fc);
  update public.funcionarios set ponto_externo = true where id = fc;
  insert into public.funcionario_sensiveis (funcionario_id, cpf, salario_base) values (fu, '52998224725', 2200);
  insert into public.cercas (nome, lat, lng, raio_m) values ('Sede', -3.7319, -38.5267, 150);
  r := r || pg_temp.ok(exists (select 1 from public.funcionario_sensiveis where funcionario_id = fu), '2 RH com dados sensíveis lê salário e CPF');
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(not exists (select 1 from public.funcionario_sensiveis where funcionario_id = fu) and not exists (select 1 from public.funcionarios where id = fu), '3 colega não vê ficha nem salário de outro');
  perform pg_temp.como(func, e);
  r := r || pg_temp.ok(exists (select 1 from public.funcionario_sensiveis where funcionario_id = fu), '4 funcionário vê os próprios dados');
  update public.funcionario_sensiveis set salario_base = 99999 where funcionario_id = fu; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 0, '5 funcionário não altera o próprio salário');
  perform pg_temp.como(outro, e2);
  r := r || pg_temp.ok(not exists (select 1 from public.funcionarios where id = fu), '6 outra empresa não vê funcionários');

  -- ---------------- marcação
  perform pg_temp.como(func, e);
  j := public.registrar_ponto(m1, 'entrada', -3.7320, -38.5268, 10, now(), 'disp-1', true);
  r := r || pg_temp.ok((j->>'nsr')::bigint = 1 and not (j->>'offline')::boolean and not (j->>'fora_cerca')::boolean, '7 entrada dentro da cerca com NSR 1 e horário do servidor');
  j := public.registrar_ponto(m1, 'entrada', -3.7320, -38.5268, 10, now(), 'disp-1', true);
  r := r || pg_temp.ok((j->>'repetida')::boolean and (select count(*) from public.ponto_marcacoes where funcionario_id = fu) = 1, '8 reenvio da fila offline não duplica');
  begin
    perform public.registrar_ponto(gen_random_uuid(), 'entrada', -3.7320, -38.5268, 10, now(), 'disp-1', true);
    r := r || pg_temp.ok(false, '9 marcação repetida em seguida');
  exception when others then r := r || pg_temp.ok(true, '9 marcação igual em menos de 2 min é recusada');
  end;
  j := public.registrar_ponto(m2, 'intervalo_inicio', -3.80, -38.60, 10, now(), 'disp-1', true);
  r := r || pg_temp.ok((j->>'fora_cerca')::boolean, '10 fora da cerca registra com sinal');
  execute 'reset role';
  r := r || pg_temp.ok((select hash from public.ponto_marcacoes where id = m2) <> (select hash from public.ponto_marcacoes where id = m1)
                       and (select ultimo_hash from public.ponto_nsr where empresa_id = e) = (select hash from public.ponto_marcacoes where id = m2), '11 hash encadeado por empresa');
  perform pg_temp.como(func, e);
  begin
    update public.ponto_marcacoes set horario = horario - interval '1 hour' where id = m1; get diagnostics n = row_count;
    r := r || pg_temp.ok(n = 0, '12 marcação é inalterável (usuário)');
  exception when others then r := r || pg_temp.ok(true, '12 marcação é inalterável');
  end;
  execute 'reset role';
  begin
    delete from public.ponto_marcacoes where id = m1;
    r := r || pg_temp.ok(false, '13 marcação apagada (nem pelo servidor)');
  exception when others then r := r || pg_temp.ok(true, '13 nem o servidor apaga marcações');
  end;
  perform pg_temp.como(cons, e);
  j := public.registrar_ponto(gen_random_uuid(), 'entrada', -5.0, -39.0, 10, now() - interval '3 hours', 'disp-2', true);
  r := r || pg_temp.ok((j->>'offline')::boolean and not (j->>'fora_cerca')::boolean
                       and (select horario from public.ponto_marcacoes where funcionario_id = fc order by nsr desc limit 1) < now() - interval '2 hours', '14 externo marca em qualquer lugar; offline usa o horário do aparelho e sinaliza');
  r := r || pg_temp.ok(not exists (select 1 from public.ponto_marcacoes where funcionario_id = fu), '15 colega não vê as marcações de outro');

  -- ---------------- ajuste com aprovação (dia do mês passado)
  perform pg_temp.como(func, e);
  insert into public.ponto_ajustes (funcionario_id, acao, tipo, horario, justificativa) values (fu, 'incluir', 'entrada', (d + time '08:00') at time zone v_fuso, 'Esqueci de marcar') returning id into aj;
  begin
    perform public.decidir_ajuste(aj, true, null);
    r := r || pg_temp.ok(false, '16 funcionário aprova o próprio ajuste');
  exception when others then r := r || pg_temp.ok(true, '16 funcionário não aprova o próprio ajuste');
  end;
  perform pg_temp.como(rh, e);
  perform public.decidir_ajuste(aj, true, 'ok');
  insert into public.ponto_ajustes (funcionario_id, acao, tipo, horario, justificativa) values (fu, 'incluir', 'saida', (d + time '19:00') at time zone v_fuso, 'Saída não registrada') returning id into aj;
  perform public.decidir_ajuste(aj, true, 'ok');
  r := r || pg_temp.ok((select count(*) from public.ponto_marcacoes where funcionario_id = fu and origem = 'ajuste') = 2, '17 ajuste aprovado inclui marcação de origem "ajuste"');

  -- ---------------- cálculo do dia e espelho
  execute 'reset role';
  j := public.ponto_dia(fu, d);
  r := r || pg_temp.ok((j->>'trabalhado_min')::int = 660 and (j->>'esperado_min')::int = 480 and (j->>'extras_min')::int = 180 and 'intervalo_nao_cumprido' = any(array(select jsonb_array_elements_text(j->'alertas'))),
                       '18 dia: 11 h trabalhadas, 3 h extras e intervalo não cumprido');
  execute 'reset role';
  j := public.ponto_dia(fu, d + 1);
  r := r || pg_temp.ok((j->>'falta')::boolean and (j->>'debito_min')::int = 480, '19 dia útil sem marcação é falta');
  perform pg_temp.como(func, e);
  insert into public.ausencias (funcionario_id, tipo, inicio, fim, observacao) values (fu, 'atestado', d + 1, d + 1, 'Consulta') returning id into aus;
  perform pg_temp.como(rh, e);
  perform public.decidir_ausencia(aus, true);
  execute 'reset role';
  j := public.ponto_dia(fu, d + 1);
  r := r || pg_temp.ok(not (j->>'falta')::boolean and j->>'ausencia' = 'atestado', '20 atestado aprovado abona o dia');
  perform pg_temp.como(rh, e);
  esp := public.fechar_espelho(fu, d);
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(not exists (select 1 from public.ponto_espelhos where id = esp), '21 colega não vê o espelho de outro');
  begin
    perform public.ciencia_espelho(esp);
    r := r || pg_temp.ok(false, '22 outro dá ciência no espelho');
  exception when others then r := r || pg_temp.ok(true, '22 só o próprio funcionário dá ciência');
  end;
  perform pg_temp.como(func, e);
  perform public.ciencia_espelho(esp);
  r := r || pg_temp.ok((select ciencia_em is not null and hash is not null from public.ponto_espelhos where id = esp), '23 ciência registrada no espelho com hash');

  -- ---------------- pré-folha
  perform pg_temp.como(func, e);
  begin
    perform public.gerar_pre_folha(d);
    r := r || pg_temp.ok(false, '24 funcionário gera a folha');
  exception when others then r := r || pg_temp.ok(true, '24 pré-folha só com permissão de folha');
  end;
  perform pg_temp.como(rh, e);
  comp := public.gerar_pre_folha(d);
  r := r || pg_temp.ok((select salario_base = 2200 and horas_extras_min > 0 and valor_extras = round(horas_extras_min / 60.0 * 10 * 1.5, 2) from public.folha_itens where competencia_id = comp and funcionario_id = fu),
                       '25 pré-folha calcula salário e extras (valor-hora = salário/220, +50%)');
  update public.folha_itens set outros_descontos = 100 where competencia_id = comp and funcionario_id = fu;
  n := public.aprovar_folha(comp);
  execute 'reset role';
  r := r || pg_temp.ok(n >= 1 and exists (select 1 from public.financeiro_lancamentos l join public.folha_itens i on i.lancamento_id = l.id where i.funcionario_id = fu and l.valor = i.total and l.categoria = 'folha'),
                       '26 folha aprovada vira contas a pagar no financeiro');
  perform pg_temp.como(rh, e);
  begin
    update public.folha_itens set outros_descontos = 0 where competencia_id = comp; get diagnostics n = row_count;
    r := r || pg_temp.ok(n = 0, '27 folha aprovada não muda');
  exception when others then r := r || pg_temp.ok(true, '27 folha aprovada não muda');
  end;
  begin
    perform public.gerar_pre_folha(d);
    r := r || pg_temp.ok(false, '28 regerar folha aprovada');
  exception when others then r := r || pg_temp.ok(true, '28 folha aprovada não é regerada');
  end;

  -- desligamento encerra o funcionário
  perform pg_temp.como(master, e);
  perform public.desligar_membro_destino(cons, null, 'Teste');
  r := r || pg_temp.ok((select status = 'desligado' and desligamento = current_date from public.funcionarios where id = fc), '29 desligamento encerra o cadastro do funcionário');

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
