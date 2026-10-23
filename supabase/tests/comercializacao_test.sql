-- =====================================================================
-- Teste da Fase 10: planos/assinatura/cobrança, cadastro self-service, domínio próprio, exclusão agendada
-- com anonimização e acesso de suporte autorizado. Rollback ao final (RAISE).
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
  dono uuid; plat uuid; e uuid; e2 uuid; cons uuid; outro uuid; cli uuid; sup uuid; j jsonb; n int; r text := '';
begin
  -- ---------------- cadastro self-service (servidor)
  dono := pg_temp.usuario('t-cdono@test.local', '{}');
  outro := pg_temp.usuario('t-coutro@test.local', '{}');
  perform pg_temp.como(null);
  e := public.cadastrar_empresa_publica('Corretora Nova', 'corretora-nova', '', 'essencial', dono);
  r := r || pg_temp.ok((select status = 'trial' and plano = 'essencial' and (limites->>'max_usuarios')::int = 5 and modulos = array['consultor', 'administrativo'] from public.empresas where id = e)
                       and (select status = 'trial' and trial_ate = current_date + 14 from public.assinaturas where empresa_id = e), '1 cadastro cria empresa em teste com o plano e a assinatura');
  r := r || pg_temp.ok(exists (select 1 from public.empresa_membros where empresa_id = e and user_id = dono and admin_master and ativo)
                       and exists (select 1 from public.departamentos where empresa_id = e), '2 dono vira admin master e a empresa é provisionada');
  begin
    perform public.cadastrar_empresa_publica('Outra', 'corretora-nova', '', 'essencial', outro);
    r := r || pg_temp.ok(false, '3 endereço repetido');
  exception when others then r := r || pg_temp.ok(true, '3 endereço repetido ou reservado é recusado');
  end;
  r := r || pg_temp.ok(not public.slug_disponivel('api') and not public.slug_disponivel('corretora-nova') and public.slug_disponivel('livre-123'), '4 verificação de endereço disponível');
  perform pg_temp.como(dono, e);
  begin
    perform public.cadastrar_empresa_publica('X', 'xyz-abc', '', 'essencial', dono);
    r := r || pg_temp.ok(false, '5 usuário chama o cadastro direto');
  exception when others then r := r || pg_temp.ok(true, '5 cadastro só pelo servidor');
  end;
  begin
    update public.empresas set plano = 'empresarial' where id = e;
    r := r || pg_temp.ok(false, '6 admin master troca o próprio plano');
  exception when others then r := r || pg_temp.ok(true, '6 plano só pela plataforma/cobrança');
  end;

  -- ---------------- limite do plano
  perform pg_temp.como(dono, e);
  for n in 1..4 loop
    perform pg_temp.como(null);
    cons := pg_temp.usuario('t-cu' || n || '@test.local', '{}');
    perform pg_temp.como(dono, e);
    insert into public.empresa_membros (empresa_id, user_id, role) values (e, cons, 'consultor_externo');
  end loop;
  perform pg_temp.como(null);
  cons := pg_temp.usuario('t-cu5@test.local', '{}');
  perform pg_temp.como(dono, e);
  begin
    insert into public.empresa_membros (empresa_id, user_id, role) values (e, cons, 'consultor_externo');
    r := r || pg_temp.ok(false, '7 passar do limite de usuários');
  exception when others then r := r || pg_temp.ok(true, '7 limite de usuários do plano respeitado');
  end;

  -- ---------------- cobrança
  perform pg_temp.como(null);
  perform public.registrar_assinatura_asaas(e, 'profissional', 'cus_1', 'sub_1', 499, current_date + 5);
  r := r || pg_temp.ok((select plano = 'profissional' and (limites->>'max_usuarios')::int = 20 from public.empresas where id = e), '8 assinatura registrada aplica o plano escolhido');
  j := public.aplicar_evento_cobranca('sub_1', 'PAYMENT_CONFIRMED', current_date, 499);
  r := r || pg_temp.ok((select status from public.assinaturas where empresa_id = e) = 'ativa' and (select status from public.empresas where id = e) = 'ativa', '9 pagamento confirmado ativa a empresa');
  perform public.aplicar_evento_cobranca('sub_1', 'PAYMENT_OVERDUE', current_date - 10, 499);
  perform public.processar_assinaturas(7);
  r := r || pg_temp.ok((select status from public.empresas where id = e) = 'suspensa' and (select status from public.assinaturas where empresa_id = e) = 'suspensa', '10 vencido além da tolerância suspende');
  perform public.aplicar_evento_cobranca('sub_1', 'PAYMENT_RECEIVED', current_date, 499);
  r := r || pg_temp.ok((select status from public.empresas where id = e) = 'ativa', '11 pagamento regulariza e reativa');
  j := public.aplicar_evento_cobranca('sub_desconhecida', 'PAYMENT_CONFIRMED', current_date, 1);
  r := r || pg_temp.ok((j->>'ignorado')::boolean, '12 evento de assinatura desconhecida é ignorado');
  perform pg_temp.como(outro, null);
  r := r || pg_temp.ok(not exists (select 1 from public.assinaturas where empresa_id = e), '13 quem não é da empresa não vê a assinatura');

  -- ---------------- domínio próprio
  perform pg_temp.como(dono, e);
  begin
    update public.empresas set dominio = 'meu.dominio.com' where id = e;
    r := r || pg_temp.ok(false, '14 domínio alterado direto');
  exception when others then r := r || pg_temp.ok(true, '14 domínio só pela função');
  end;
  perform public.definir_dominio('Corretora.Exemplo.com.br');
  r := r || pg_temp.ok((select dominio = 'corretora.exemplo.com.br' and dominio_status = 'pendente' from public.empresas where id = e), '15 admin master define o domínio (plano permite)');
  begin
    perform public.definir_dominio('não é domínio');
    r := r || pg_temp.ok(false, '16 domínio inválido');
  exception when others then r := r || pg_temp.ok(true, '16 domínio inválido recusado');
  end;

  -- ---------------- suporte
  perform pg_temp.como(null);
  plat := (select user_id from public.plataforma_admins limit 1);
  if plat is null then
    plat := pg_temp.usuario('t-cplat@test.local', '{}');
    insert into public.plataforma_admins (user_id) values (plat);
  end if;
  perform pg_temp.como(plat, null);
  sup := public.solicitar_suporte(e, 'Cliente relatou erro na importação');
  perform pg_temp.como(dono, e);
  perform public.decidir_suporte(sup, true, 2);
  r := r || pg_temp.ok((select ativo and suporte_ate > now() and not admin_master from public.empresa_membros where empresa_id = e and user_id = plat), '17 suporte autorizado ganha acesso temporário sem ser master');
  r := r || pg_temp.ok(not exists (select 1 from public.funcionarios where empresa_id = e and user_id = plat), '18 suporte não vira funcionário');
  r := r || pg_temp.ok(exists (select 1 from public.audit_logs where acao = 'SUPORTE' and registro_id = sup::text) or exists (select 1 from public.audit_logs where tabela = 'acessos_suporte'), '19 autorização registrada na auditoria');
  perform pg_temp.como(null);
  update public.empresa_membros set suporte_ate = now() - interval '1 minute' where empresa_id = e and user_id = plat;
  update public.acessos_suporte set expira_em = now() - interval '1 minute' where id = sup;
  perform public.expirar_suporte();
  r := r || pg_temp.ok((select not ativo from public.empresa_membros where empresa_id = e and user_id = plat) and (select status from public.acessos_suporte where id = sup) = 'expirado', '20 acesso de suporte expira sozinho');
  perform pg_temp.como(dono, e);
  begin
    update public.empresa_membros set ativo = true where empresa_id = e and user_id = plat;
    r := r || pg_temp.ok((select not ativo from public.empresa_membros where empresa_id = e and user_id = plat), '21 suporte só volta com novo pedido autorizado');
  exception when others then r := r || pg_temp.ok(true, '21 suporte só volta com novo pedido autorizado');
  end;

  -- ---------------- exclusão agendada
  perform pg_temp.como(dono, e);
  insert into public.clientes (nome, documento, email, telefone) values ('Maria Teste', '52998224725', 'maria@test.local', '85999990000') returning id into cli;
  begin
    perform public.agendar_exclusao_empresa('errado');
    r := r || pg_temp.ok(false, '22 exclusão sem confirmação');
  exception when others then r := r || pg_temp.ok(true, '22 exclusão exige digitar o endereço');
  end;
  perform public.agendar_exclusao_empresa('corretora-nova');
  r := r || pg_temp.ok((select exclusao_agendada_para > now() + interval '29 days' from public.empresas where id = e), '23 exclusão agendada para 30 dias');
  perform pg_temp.como(null);
  begin
    perform public.anonimizar_empresa(e);
    r := r || pg_temp.ok(false, '24 anonimizar antes do prazo');
  exception when others then r := r || pg_temp.ok(true, '24 nada é apagado antes do prazo');
  end;
  perform set_config('geeasy.exclusao', 'on', true);
  update public.empresas set exclusao_agendada_para = now() - interval '1 minute' where id = e;
  j := public.anonimizar_empresa(e);
  r := r || pg_temp.ok((select nome = 'Titular removido' and documento is null and email is null from public.clientes where id = cli)
                       and (select status = 'cancelada' and anonimizada_em is not null from public.empresas where id = e)
                       and not exists (select 1 from public.empresa_membros where empresa_id = e and ativo), '25 vencido o prazo, dados pessoais anonimizados e acessos encerrados');

  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
