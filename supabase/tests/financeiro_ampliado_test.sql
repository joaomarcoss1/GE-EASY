-- =====================================================================
-- Teste da Fase 8: centros de custo, recorrências, alçada de aprovação, permissão de pagar,
-- extrato/conciliação e relatórios. Rollback ao final (RAISE).
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
  e uuid; e2 uuid; master uuid; fin_op uuid; fin_ger uuid; outro uuid; v_dep uuid; v_op uuid; v_ger uuid;
  cc uuid; conta uuid; rec uuid; l_grande uuid; l_peq uuid; l_rec uuid; mov uuid; n int; j jsonb; r text := '';
begin
  insert into public.empresas (nome, slug) values ('Empresa Fin', 'empresa-fin') returning id into e;
  insert into public.empresas (nome, slug) values ('Outra Fin', 'outra-fin') returning id into e2;
  perform public.provisionar_empresa(e);
  perform public.provisionar_empresa(e2);
  master := pg_temp.usuario('t-fm@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  fin_op := pg_temp.usuario('t-fo@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'financeiro'));
  fin_ger := pg_temp.usuario('t-fg@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'financeiro'));
  outro := pg_temp.usuario('t-fx@test.local', jsonb_build_object('ge_empresa_id', e2, 'ge_role', 'admin', 'ge_admin_master', true));
  perform pg_temp.como(master, e);
  select d.id into v_dep from public.departamentos d where d.empresa_id = e and d.tipo = 'financeiro';
  select id into v_op from public.departamento_niveis where departamento_id = v_dep and nome = 'Operador';
  select id into v_ger from public.departamento_niveis where departamento_id = v_dep and nome = 'Gestor';
  insert into public.departamento_membros (departamento_id, user_id, nivel_id) values (v_dep, fin_op, v_op), (v_dep, fin_ger, v_ger)
  on conflict (departamento_id, user_id) do update set nivel_id = excluded.nivel_id, ativo = true;

  -- ---------------- cadastros
  perform pg_temp.como(fin_ger, e);
  insert into public.centros_custo (nome, tipo) values ('Rotas de campo', 'rota') returning id into cc;
  insert into public.contas_bancarias (nome, banco, saldo_inicial, saldo_inicial_em) values ('Conta principal', 'Banco Teste', 1000, current_date - 60) returning id into conta;
  r := r || pg_temp.ok(cc is not null and conta is not null, '1 gestor financeiro cadastra centro de custo e conta');
  perform pg_temp.como(fin_op, e);
  begin
    insert into public.contas_bancarias (nome) values ('Conta intrusa');
    r := r || pg_temp.ok(false, '2 operador cadastra conta bancária');
  exception when others then r := r || pg_temp.ok(true, '2 operador não cadastra contas bancárias');
  end;
  perform pg_temp.como(outro, e2);
  r := r || pg_temp.ok(not exists (select 1 from public.centros_custo where id = cc), '3 outra empresa não vê centros de custo');

  -- ---------------- recorrência
  perform pg_temp.como(fin_ger, e);
  insert into public.financeiro_recorrencias (categoria, descricao, valor, dia_vencimento, centro_custo_id, inicio)
  values ('Aluguel e condomínio', 'Aluguel da sede', 3000, 31, cc, (date_trunc('month', current_date) - interval '1 month')::date) returning id into rec;
  n := public.gerar_recorrencias(e);
  r := r || pg_temp.ok(n = 3, '4 recorrência gera mês anterior, atual e próximo');
  n := public.gerar_recorrencias(e);
  r := r || pg_temp.ok(n = 0 and (select count(*) from public.financeiro_lancamentos where recorrencia_id = rec) = 3, '5 rodar de novo não duplica');
  r := r || pg_temp.ok((select bool_and(extract(day from vencimento) = extract(day from (date_trunc('month', vencimento) + interval '1 month - 1 day'))) from public.financeiro_lancamentos where recorrencia_id = rec),
                       '6 dia 31 vira o último dia de meses curtos');

  -- ---------------- alçada e permissão de pagar
  perform pg_temp.como(fin_op, e);
  insert into public.financeiro_lancamentos (tipo, categoria, descricao, valor, vencimento, centro_custo_id) values ('despesa', 'Marketing', 'Campanha grande', 8000, current_date, cc) returning id into l_grande;
  insert into public.financeiro_lancamentos (tipo, categoria, descricao, valor, vencimento) values ('despesa', 'Marketing', 'Material', 200, current_date) returning id into l_peq;
  r := r || pg_temp.ok((select aprovacao from public.financeiro_lancamentos where id = l_grande) = 'pendente' and (select aprovacao from public.financeiro_lancamentos where id = l_peq) = 'dispensada',
                       '7 despesa acima da alçada fica pendente de aprovação');
  update public.financeiro_lancamentos set aprovacao = 'aprovada' where id = l_grande;
  r := r || pg_temp.ok((select aprovacao from public.financeiro_lancamentos where id = l_grande) = 'pendente', '8 aprovação não muda por edição direta');
  begin
    update public.financeiro_lancamentos set status = 'pago' where id = l_peq;
    r := r || pg_temp.ok(false, '9 operador sem permissão de pagar dá baixa');
  exception when others then r := r || pg_temp.ok(true, '9 baixa de pagamento exige permissão de pagar');
  end;
  perform pg_temp.como(fin_ger, e);
  begin
    update public.financeiro_lancamentos set status = 'pago' where id = l_grande;
    r := r || pg_temp.ok(false, '10 pagar despesa pendente de aprovação');
  exception when others then r := r || pg_temp.ok(true, '10 despesa pendente não é paga');
  end;
  perform public.aprovar_lancamento(l_grande, true, null);
  update public.financeiro_lancamentos set status = 'pago' where id = l_grande;
  r := r || pg_temp.ok((select status = 'pago' and aprovado_por = fin_ger from public.financeiro_lancamentos where id = l_grande), '11 aprovada por outra pessoa, a despesa é paga');
  insert into public.financeiro_lancamentos (tipo, categoria, descricao, valor, vencimento) values ('despesa', 'Marketing', 'Outra grande', 9000, current_date) returning id into l_grande;
  begin
    perform public.aprovar_lancamento(l_grande, true, null);
    r := r || pg_temp.ok(false, '12 aprovar a própria despesa');
  exception when others then r := r || pg_temp.ok(true, '12 quem lançou não aprova');
  end;
  update public.financeiro_lancamentos set valor = 300 where id = l_peq;
  update public.financeiro_lancamentos set valor = 6000 where id = l_peq;
  r := r || pg_temp.ok((select aprovacao from public.financeiro_lancamentos where id = l_peq) = 'pendente', '13 aumentar o valor acima da alçada volta a exigir aprovação');

  -- ---------------- extrato e conciliação
  insert into public.financeiro_lancamentos (tipo, categoria, descricao, valor, vencimento, cliente_id) values ('receita', 'Honorários', 'Honorário teste', 1500, current_date - 2, null) returning id into l_rec;
  insert into public.extrato_movimentos (conta_id, data, valor, descricao, fitid) values (conta, current_date, 1500, 'PIX RECEBIDO', 'F1') returning id into mov;
  insert into public.extrato_movimentos (conta_id, data, valor, descricao, fitid) values (conta, current_date, 1500, 'PIX RECEBIDO', 'F1') on conflict do nothing;
  r := r || pg_temp.ok((select count(*) from public.extrato_movimentos where conta_id = conta) = 1, '14 extrato importado de novo não duplica (FITID)');
  r := r || pg_temp.ok(exists (select 1 from public.sugerir_conciliacao(conta) s where s.movimento_id = mov and s.lancamento_id = l_rec), '15 sugere o lançamento de mesmo valor e data próxima');
  begin
    perform public.conciliar_movimento(mov, (select id from public.financeiro_lancamentos where recorrencia_id = rec limit 1));
    r := r || pg_temp.ok(false, '16 crédito conciliado com despesa');
  exception when others then r := r || pg_temp.ok(true, '16 crédito só concilia com receita de mesmo valor');
  end;
  perform public.conciliar_movimento(mov, l_rec);
  r := r || pg_temp.ok((select status = 'pago' and conciliado and data_pagamento = current_date and conta_id = conta from public.financeiro_lancamentos where id = l_rec), '17 conciliação dá baixa com a data do extrato');

  -- ---------------- relatórios
  j := public.relatorio_financeiro((date_trunc('month', current_date) - interval '1 month')::date, (date_trunc('month', current_date) + interval '2 month - 1 day')::date);
  r := r || pg_temp.ok(jsonb_array_length(j->'fluxo') = 3 and (j->'dre'->>'total_despesas')::numeric >= 9000 + 8000 + 6000
                       and exists (select 1 from jsonb_array_elements(j->'centros') x where x->>'centro' = 'Rotas de campo' and (x->>'despesas')::numeric = 9000 + 8000)
                       and exists (select 1 from jsonb_array_elements(j->'saldos') x where (x->>'saldo')::numeric = 2500), '18 DRE, fluxo, centros de custo e saldo da conta');
  perform pg_temp.como(outro, e2);
  j := public.relatorio_financeiro(current_date - 60, current_date + 60);
  r := r || pg_temp.ok((j->'dre'->>'total_despesas')::numeric = 0, '19 relatório não mistura empresas');

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
