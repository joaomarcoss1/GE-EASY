-- =====================================================================
-- Teste da Fase 5: rota de teste com posições simuladas — km, tempos e custos pelas fórmulas,
-- check-in a 500 m fora do raio, localização simulada sinalizada, despesas, aprovação e reagendamento.
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
  e uuid; master uuid; plan uuid; cons uuid; cons2 uuid; sup uuid;
  vei uuid; rota uuid; rota2 uuid; rota3 uuid; p1 uuid; p2 uuid; p3 uuid; px uuid; desp uuid;
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid(); c5 uuid := gen_random_uuid();
  lat0 double precision := -2.5307; lng0 double precision := -44.3068; t0 timestamptz := now() - interval '3 hours';
  j jsonb; n int; s text; v_km numeric; r text := ''; v_dep uuid; v_nivel uuid;
begin
  insert into public.empresas (nome, slug) values ('Empresa Rotas', 'empresa-rotas') returning id into e;
  perform public.provisionar_empresa(e);
  master := pg_temp.usuario('t-rm@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  plan := pg_temp.usuario('t-rp@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'administrativo'));
  cons := pg_temp.usuario('t-rc@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  cons2 := pg_temp.usuario('t-rc2@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  sup := pg_temp.usuario('t-rs@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor'));
  perform pg_temp.como(master, e);
  select d.id, n.id into v_dep, v_nivel from public.departamentos d join public.departamento_niveis n on n.departamento_id = d.id and n.nome = 'Supervisor'
   where d.empresa_id = e and d.tipo = 'administrativo';
  update public.departamento_membros set nivel_id = v_nivel where departamento_id = v_dep and user_id = plan;
  insert into public.equipe_membros (supervisor_id, membro_id) values (sup, cons);

  -- ---------------- planejamento
  perform pg_temp.como(cons, e);
  begin
    insert into public.rotas (nome, data, consultor_id) values ('Rota do próprio consultor', current_date, cons);
    r := r || pg_temp.ok(false, '1 consultor planeja rota');
  exception when others then r := r || pg_temp.ok(true, '1 só o planejamento cria rotas');
  end;
  perform pg_temp.como(plan, e);
  insert into public.veiculos (descricao, consumo_km_l) values ('Moto da equipe', 10) returning id into vei;
  insert into public.rotas (nome, data, consultor_id, veiculo_id, km_planejado) values ('Rota Centro', current_date, cons, vei, 5) returning id into rota;
  insert into public.rota_paradas (rota_id, ordem, titulo, lat, lng, raio_m) values (rota, 1, 'Parada 1', lat0 + 0.01, lng0, 150) returning id into p1;
  insert into public.rota_paradas (rota_id, ordem, titulo, lat, lng, raio_m) values (rota, 2, 'Parada 2', lat0 + 0.02, lng0, 150) returning id into p2;
  insert into public.rota_paradas (rota_id, ordem, titulo, lat, lng, raio_m) values (rota, 3, 'Parada 3', lat0 + 0.03, lng0, 150) returning id into p3;
  r := r || pg_temp.ok(rota is not null and p3 is not null, '2 administrativo planeja rota com paradas');

  perform pg_temp.como(cons2, e);
  r := r || pg_temp.ok(not exists (select 1 from public.rotas where id = rota), '3 outro consultor não vê a rota');
  perform pg_temp.como(sup, e);
  r := r || pg_temp.ok(exists (select 1 from public.rotas where id = rota), '4 supervisor da equipe vê a rota');

  -- ---------------- execução
  perform pg_temp.como(cons, e);
  begin
    perform public.registrar_checkin(c1, p1, 'chegada', lat0 + 0.01, lng0);
    r := r || pg_temp.ok(false, '5 check-in sem iniciar');
  exception when others then r := r || pg_temp.ok(true, '5 check-in exige rota iniciada');
  end;
  perform public.iniciar_rota(rota, lat0, lng0);
  perform pg_temp.como(null);
  update public.rotas set iniciada_em = t0 where id = rota;

  perform pg_temp.como(cons, e);
  j := public.registrar_checkin(c1, p1, 'chegada', lat0 + 0.01, lng0, 8, now());
  r := r || pg_temp.ok((j->>'dentro_do_raio')::boolean and (j->>'distancia_m')::int = 0, '6 chegada dentro do raio: ' || j::text);
  j := public.registrar_checkin(c1, p1, 'chegada', lat0 + 0.01, lng0, 8, now());
  r := r || pg_temp.ok((j->>'repetido')::boolean and (select count(*) from public.checkins where id = c1) = 1, '7 reenvio do mesmo check-in não duplica');
  perform pg_temp.como(null);
  update public.checkins set registrado_em = t0 + interval '30 minutes' where id = c1;
  perform pg_temp.como(cons, e);
  j := public.registrar_checkin(c2, p1, 'saida', lat0 + 0.01, lng0, 8, now() - interval '1 hour', 'venda');
  r := r || pg_temp.ok(j->'flags' ? 'horario_divergente', '8 horário do aparelho divergente sinalizado');
  perform pg_temp.como(null);
  update public.checkins set registrado_em = t0 + interval '50 minutes' where id = c2;

  perform pg_temp.como(cons, e);
  begin
    perform public.registrar_checkin(c3, p2, 'chegada', lat0 + 0.0245, lng0, 10, now());
    r := r || pg_temp.ok(false, '9 chegada a 500 m sem justificativa');
  exception when others then r := r || pg_temp.ok(sqlerrm like '%Informe a justificativa%', '9 chegada a 500 m exige justificativa');
  end;
  j := public.registrar_checkin(c3, p2, 'chegada', lat0 + 0.0245, lng0, 10, now(), null, null, 'Portão fechado, atendi na esquina');
  r := r || pg_temp.ok(not (j->>'dentro_do_raio')::boolean and (j->>'distancia_m')::int between 480 and 520, '10 check-in a 500 m marcado fora do raio: ' || j::text);
  r := r || pg_temp.ok((select revisao from public.checkins where id = c3) = 'pendente', '11 fora do raio vai para revisão');
  perform pg_temp.como(null);
  update public.checkins set registrado_em = t0 + interval '80 minutes' where id = c3;
  perform pg_temp.como(cons, e);
  j := public.registrar_checkin(c4, p2, 'saida', lat0 + 0.0245, lng0, 10, now(), 'visitado', null, null, true);
  r := r || pg_temp.ok(j->'flags' ? 'localizacao_simulada', '12 localização simulada sinalizada');
  perform pg_temp.como(null);
  update public.checkins set registrado_em = t0 + interval '100 minutes' where id = c4;

  -- ---------------- despesas
  perform pg_temp.como(cons, e);
  insert into public.despesas_rota (rota_id, tipo, valor) values (rota, 'combustivel', 50.00) returning id into desp;
  begin
    perform public.aprovar_despesa(desp, true);
    r := r || pg_temp.ok(false, '13 consultor aprova a própria despesa');
  exception when others then r := r || pg_temp.ok(true, '13 consultor não aprova despesa');
  end;
  perform pg_temp.como(master, e);
  perform public.aprovar_despesa(desp, true);
  r := r || pg_temp.ok((select status::text from public.despesas_rota where id = desp) = 'aprovada', '14 gestão aprova a despesa');

  -- ---------------- finalizar e conferir as fórmulas
  perform pg_temp.como(cons, e);
  perform public.finalizar_rota(rota, lat0 + 0.02, lng0);
  perform pg_temp.como(null);
  update public.rotas set finalizada_em = t0 + interval '120 minutes' where id = rota;
  v_km := round(((public.geo_distancia_m(lat0, lng0, lat0 + 0.01, lng0) + public.geo_distancia_m(lat0 + 0.01, lng0, lat0 + 0.0245, lng0)
                + public.geo_distancia_m(lat0 + 0.0245, lng0, lat0 + 0.02, lng0)) / 1000 * 1.3)::numeric, 2);
  perform pg_temp.como(cons, e);
  j := public.resumo_da_rota(rota);
  r := r || pg_temp.ok((j->>'km')::numeric = v_km and j->>'metodo_km' = 'linha_reta', '15 km = soma das distâncias × fator 1,3: ' || (j->>'km') || ' (esperado ' || v_km || ')');
  r := r || pg_temp.ok((j->>'tempo_locomocao_min')::int = 80 and (j->>'tempo_visita_min')::int = 40, '16 tempos: locomoção 80 min, visita 40 min (' || (j->>'tempo_locomocao_min') || '/' || (j->>'tempo_visita_min') || ')');
  r := r || pg_temp.ok((j->>'custo_km')::numeric = round(v_km * 0.9, 2) and (j->>'custo_total')::numeric = round(v_km * 0.9, 2) + 50, '17 custo = km × R$ 0,90 + despesas aprovadas: ' || (j->>'custo_total'));
  r := r || pg_temp.ok((j->>'visitadas')::int = 2 and (j->>'nao_realizadas')::int = 1 and (j->>'adquiridos')::int = 1, '18 visitadas, não realizadas e adquiridos');
  r := r || pg_temp.ok((j->>'custo_por_visitado')::numeric = round((j->>'custo_total')::numeric / 2, 2) and (j->>'custo_por_adquirido')::numeric = (j->>'custo_total')::numeric, '19 custo por cliente visitado e adquirido');
  r := r || pg_temp.ok((j->>'fora_do_raio')::int = 1 and (j->>'inconsistencias')::int = 2, '20 indicadores de fora do raio e inconsistências: ' || (j->>'fora_do_raio') || '/' || (j->>'inconsistencias') || ' ' || (select string_agg(array_to_string(flags, ','), ' | ') from public.checkins where rota_id = rota));

  -- ---------------- consumo do veículo
  perform pg_temp.como(null);
  insert into public.configuracoes (empresa_id, chave, valor) values (e, 'rotas', '{"reembolso_modo":"consumo","preco_combustivel":6}');
  perform pg_temp.como(cons, e);
  j := public.resumo_da_rota(rota);
  r := r || pg_temp.ok((j->>'custo_km')::numeric = round(v_km / 10 * 6, 2), '21 reembolso por consumo (km ÷ 10 km/l × R$ 6)');

  -- ---------------- supervisão
  perform pg_temp.como(cons, e);
  begin
    perform public.aprovar_rota(rota);
    r := r || pg_temp.ok(false, '22 consultor aprova a própria rota');
  exception when others then r := r || pg_temp.ok(true, '22 consultor não aprova rota');
  end;
  perform pg_temp.como(master, e);
  perform public.revisar_checkin(c3, true);
  j := public.aprovar_rota(rota);
  r := r || pg_temp.ok((select status::text from public.rotas where id = rota) = 'aprovada' and (select revisao from public.checkins where id = c3) = 'aprovado', '23 gestão revisa check-in e aprova a rota');
  select count(*) into n from public.relatorio_rotas(current_date, current_date) x where x.rota_id = rota and (x.resumo->>'km')::numeric = v_km;
  r := r || pg_temp.ok(n = 1, '24 relatório de rotas bate com o resumo');

  -- ---------------- reagendamento
  perform pg_temp.como(plan, e);
  insert into public.rotas (nome, data, consultor_id) values ('Rota de amanhã', current_date + 1, cons) returning id into rota2;
  n := public.reagendar_paradas(array[p3], rota2);
  r := r || pg_temp.ok(n = 1 and exists (select 1 from public.rota_paradas where rota_id = rota2 and titulo = 'Parada 3')
                       and (select status::text from public.rota_paradas where id = p3) = 'reagendada', '25 parada não realizada reagendada com um clique');

  -- ---------------- fora do raio bloqueado (configuração da empresa)
  perform pg_temp.como(null);
  update public.configuracoes set valor = '{"fora_do_raio":"bloquear"}' where empresa_id = e and chave = 'rotas';
  perform pg_temp.como(plan, e);
  insert into public.rotas (nome, data, consultor_id) values ('Rota com bloqueio', current_date, cons) returning id into rota3;
  insert into public.rota_paradas (rota_id, titulo, lat, lng) values (rota3, 'Parada bloqueio', lat0, lng0) returning id into px;
  perform pg_temp.como(cons, e);
  perform public.iniciar_rota(rota3, lat0, lng0);
  begin
    perform public.registrar_checkin(c5, px, 'chegada', lat0 + 0.0045, lng0, 5, now(), null, null, 'justificativa');
    r := r || pg_temp.ok(false, '26 chegada fora do raio com bloqueio');
  exception when others then r := r || pg_temp.ok(sqlerrm like '%não é permitido%', '26 empresa pode bloquear check-in fora do raio');
  end;
  begin
    update public.checkins set lat = 0 where id = c1;
    get diagnostics n = row_count;
    r := r || pg_temp.ok(n = 0, '27 check-in não é alterado pela API');
  exception when others then r := r || pg_temp.ok(true, '27 check-in não é alterado pela API');
  end;

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
