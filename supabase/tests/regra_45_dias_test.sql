-- =====================================================================
-- Teste da Fase 3: ciclo do cadastro, documentação e regra dos 45 dias.
-- Cenários do critério de aceite: D-1, D0, D+1, envio parcial, prorrogação, devolução,
-- documentação completa no dia 44 e rotina executada duas vezes no mesmo dia (sem duplicar).
-- Rollback ao final (RAISE). Passa quando a mensagem começa com "RESULTADO: OK".
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
-- documento aprovado de uma categoria (como a análise faria)
create function pg_temp.doc(p_cliente uuid, p_cat text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.documentos (cliente_id, nome, categoria, storage_path, enviado_por)
  values (p_cliente, p_cat || '.pdf', p_cat, 'clientes/' || p_cliente || '/' || gen_random_uuid() || '-' || p_cat || '.pdf', auth.uid()) returning id into v;
  return v;
end $$;

do $$
declare
  e uuid; dono uuid; master uuid; cons uuid; cons2 uuid; analista uuid; gest uuid; sup uuid;
  c1 uuid; c2 uuid; c3 uuid; d uuid; n int; t timestamptz; t2 timestamptz; s text; j jsonb; r text := '';
  v_dep uuid; v_nivel uuid;
begin
  select user_id into dono from public.plataforma_admins limit 1;
  if dono is null then dono := pg_temp.usuario('t-dono3@test.local', '{}'); end if;
  insert into public.empresas (nome, slug) values ('Empresa Prazo', 'empresa-prazo') returning id into e;
  perform public.provisionar_empresa(e);
  master := pg_temp.usuario('t-m45@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  cons := pg_temp.usuario('t-c45@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  cons2 := pg_temp.usuario('t-c45b@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  analista := pg_temp.usuario('t-a45@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'administrativo'));
  gest := pg_temp.usuario('t-g45@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'gestor'));
  sup := pg_temp.usuario('t-s45@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor'));
  -- supervisor do comercial (nível Supervisor no mesmo departamento do consultor)
  perform pg_temp.como(master, e);
  select dm.departamento_id into v_dep from public.departamento_membros dm where dm.user_id = cons;
  select id into v_nivel from public.departamento_niveis where departamento_id = v_dep and nome = 'Supervisor';
  update public.departamento_membros set nivel_id = v_nivel where departamento_id = v_dep and user_id = sup;

  -- ---------------- abertura do prazo
  perform pg_temp.como(cons, e);
  insert into public.clientes (nome, documento, status_cadastro) values ('Cliente Prazo', '39053344705', 'pendente_documentacao') returning id into c1;
  select prazo_documentacao, carteira::text into t, s from public.clientes where id = c1;
  r := r || pg_temp.ok(s = 'consultor' and abs(extract(epoch from (t - (now() + interval '45 days')))) < 60, '1 pendente na carteira do consultor abre prazo de 45 dias corridos');
  begin
    insert into public.clientes (nome, status_cadastro) values ('Já ativo', 'ativo');
    r := r || pg_temp.ok(false, '2 consultor cadastra já ativo');
  exception when others then r := r || pg_temp.ok(true, '2 cadastro novo não pula a análise');
  end;
  begin
    update public.clientes set status_cadastro = 'documentacao_completa' where id = c1;
    r := r || pg_temp.ok(false, '3 consultor conclui o próprio cadastro');
  exception when others then r := r || pg_temp.ok(true, '3 só a análise documental conclui o cadastro');
  end;
  begin
    update public.clientes set status_cadastro = 'transferido_administrativo' where id = c1;
    r := r || pg_temp.ok(false, '4 consultor transfere');
  exception when others then r := r || pg_temp.ok(true, '4 consultor não transfere para o administrativo');
  end;

  -- envio parcial não reinicia o prazo
  d := pg_temp.doc(c1, 'rg_cnh');
  select prazo_documentacao into t2 from public.clientes where id = c1;
  r := r || pg_temp.ok(t2 = t, '5 envio parcial não reinicia o prazo');
  j := public.situacao_documental(c1);
  r := r || pg_temp.ok(not (j->>'completo')::boolean and jsonb_array_length(j->'faltando') = 3, '6 situação documental lista o que falta: ' || (j->'faltando')::text);

  -- ---------------- D-1: aviso, sem transferência
  perform pg_temp.como(null);
  update public.clientes set prazo_documentacao = now() + interval '1 day' where id = c1;
  perform public.processar_prazos_documentacao();
  r := r || pg_temp.ok((select count(*) from public.notificacoes where chave = 'doc-prazo:' || c1 || ':1' and user_id in (cons, sup)) = 2, '7 D-1: aviso ao consultor e ao supervisor');
  r := r || pg_temp.ok((select carteira from public.clientes where id = c1) = 'consultor', '8 D-1: continua com o consultor');

  -- ---------------- prorrogação (gestão), limite
  perform pg_temp.como(cons, e);
  begin
    perform public.prorrogar_documentacao(c1, 15, 'pedido do consultor');
    r := r || pg_temp.ok(false, '9 consultor prorroga');
  exception when others then r := r || pg_temp.ok(true, '9 consultor não prorroga o próprio prazo');
  end;
  perform pg_temp.como(gest, e);
  t := public.prorrogar_documentacao(c1, 15, 'Cliente viajando');
  r := r || pg_temp.ok(t > now() + interval '15 days', '10 gestor prorroga com motivo (+15 dias)');
  perform public.prorrogar_documentacao(c1, 15, 'Segunda prorrogação');
  begin
    perform public.prorrogar_documentacao(c1, 15, 'Terceira');
    r := r || pg_temp.ok(false, '11 terceira prorrogação');
  exception when others then r := r || pg_temp.ok(true, '11 limite de prorrogações respeitado');
  end;
  r := r || pg_temp.ok((select count(*) from public.cliente_carteira_historico where cliente_id = c1 and motivo = 'prorrogacao') = 2, '12 prorrogações no histórico');

  -- ---------------- D0 / D+1: transferência
  perform pg_temp.como(null);
  update public.clientes set prazo_documentacao = now() - interval '1 minute' where id = c1;
  j := public.processar_prazos_documentacao();
  select carteira::text || '/' || status_cadastro::text || '/' || coalesce(consultor_id::text, 'sem consultor') || '/' || (consultor_original_id = cons)::text into s from public.clientes where id = c1;
  r := r || pg_temp.ok(s = 'administrativo/transferido_administrativo/sem consultor/true', '13 prazo esgotado: transferido para a base administrativa (' || s || ')');
  r := r || pg_temp.ok((select count(*) from public.cliente_carteira_historico where cliente_id = c1 and motivo = 'regra_prazo_documentacao') = 1, '14 histórico com motivo regra_prazo_documentacao');
  r := r || pg_temp.ok((select count(*) from public.tarefas where cliente_id = c1 and titulo like 'Concluir documentação%') = 1, '15 tarefa "Concluir documentação" criada');
  -- segunda execução no mesmo dia: nada duplica
  perform public.processar_prazos_documentacao();
  r := r || pg_temp.ok((select count(*) from public.tarefas where cliente_id = c1 and titulo like 'Concluir documentação%') = 1
                   and (select count(*) from public.cliente_carteira_historico where cliente_id = c1 and motivo = 'regra_prazo_documentacao') = 1
                   and (select count(*) from public.notificacoes where chave = 'doc-transf:' || c1 || ':' || cons) = 1, '16 rotina repetida não duplica');

  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(not exists (select 1 from public.clientes where id = c1), '17 consultor perde o acesso ao cliente transferido');
  r := r || pg_temp.ok(not public.storage_can_access('clientes/' || c1 || '/x.pdf') and not exists (select 1 from public.documentos where cliente_id = c1), '18 consultor perde acesso aos documentos');
  r := r || pg_temp.ok(exists (select 1 from public.meus_clientes_transferidos() m where m.cliente_nome = 'Cliente Prazo'), '19 consultor vê só o registro "transferido" no histórico');
  r := r || pg_temp.ok(exists (select 1 from public.notificacoes where user_id = cons and chave = 'doc-transf:' || c1 || ':' || cons), '20 consultor notificado');
  perform pg_temp.como(analista, e);
  r := r || pg_temp.ok(exists (select 1 from public.clientes where id = c1), '21 administrativo vê o cliente na base administrativa');

  -- ---------------- duplicidade
  perform pg_temp.como(cons2, e);
  j := public.verificar_documento_cliente('390.533.447-05');
  r := r || pg_temp.ok((j->>'existe')::boolean and not (j->>'acessivel')::boolean and j->>'carteira' = 'administrativo' and not j ? 'cliente_id', '22 CPF existente: informa a carteira sem expor dados');
  begin
    insert into public.clientes (nome, documento) values ('Duplicado', '39053344705');
    r := r || pg_temp.ok(false, '23 cadastro duplicado');
  exception when unique_violation then r := r || pg_temp.ok(true, '23 cadastro duplicado bloqueado');
  end;

  -- ---------------- devolução ao consultor (novo prazo)
  perform pg_temp.como(gest, e);
  perform public.redistribuir_clientes(array[c1], cons, 'Consultor recuperou contato', true);
  select carteira::text || '/' || status_cadastro::text, prazo_documentacao into s, t from public.clientes where id = c1;
  r := r || pg_temp.ok(s = 'consultor/pendente_documentacao' and t > now() + interval '44 days', '24 devolução reabre o prazo com o consultor (' || s || ')');
  r := r || pg_temp.ok(exists (select 1 from public.cliente_carteira_historico where cliente_id = c1 and motivo = 'devolucao'), '25 devolução no histórico');

  -- ---------------- documentação completa no dia 44: não transfere
  perform pg_temp.como(cons, e);
  insert into public.clientes (nome, documento, status_cadastro) values ('Cliente Dia 44', '11144477735', 'pendente_documentacao') returning id into c2;
  perform pg_temp.doc(c2, 'rg_cnh'); perform pg_temp.doc(c2, 'cpf_cnpj'); d := pg_temp.doc(c2, 'comprovante_residencia');
  perform pg_temp.como(analista, e);
  begin
    perform public.analisar_documento(d, 'recusado', null);
    r := r || pg_temp.ok(false, '26 recusar sem motivo');
  exception when others then r := r || pg_temp.ok(true, '26 recusa exige motivo');
  end;
  perform public.analisar_documento(d, 'recusado', 'Comprovante ilegível');
  perform pg_temp.como(null);
  r := r || pg_temp.ok(exists (select 1 from public.notificacoes where user_id = cons and titulo = 'Documento recusado'), '27 consultor avisado da recusa');
  perform pg_temp.como(cons, e);
  d := pg_temp.doc(c2, 'comprovante_residencia');
  perform pg_temp.como(analista, e);
  perform public.analisar_documento(x.id, 'aprovado') from public.documentos x where x.cliente_id = c2 and x.analise_status = 'enviado';
  select status_cadastro::text, prazo_documentacao into s, t from public.clientes where id = c2;
  r := r || pg_temp.ok(s = 'documentacao_completa' and t is null, '28 último obrigatório aprovado conclui o cadastro (' || s || ')');
  r := r || pg_temp.ok((select validade from public.documentos where id = d) = current_date + 90, '29 validade do comprovante (90 dias)');
  perform pg_temp.como(null);
  perform public.processar_prazos_documentacao();
  r := r || pg_temp.ok((select carteira from public.clientes where id = c2) = 'consultor', '30 cadastro completo no dia 44 não é transferido');

  -- consultor não analisa documentos
  perform pg_temp.como(cons, e);
  begin
    perform public.analisar_documento(d, 'aprovado');
    r := r || pg_temp.ok(false, '31 consultor aprova documento');
  exception when others then r := r || pg_temp.ok(true, '31 consultor não aprova documentos');
  end;
  d := pg_temp.doc(c2, 'comprovante_renda');
  update public.documentos set analise_status = 'aprovado', analisado_por = cons where id = d; -- tentativa direta: o gatilho preserva a análise
  r := r || pg_temp.ok((select analise_status::text || coalesce(analisado_por::text, '') from public.documentos where id = d) = 'enviado', '32 campos da análise só mudam pela análise');

  -- transições inválidas
  insert into public.clientes (nome) values ('Pré') returning id into c3;
  begin
    update public.clientes set status_cadastro = 'ativo' where id = c3;
    r := r || pg_temp.ok(false, '33 pré-cadastro direto para ativo');
  exception when others then r := r || pg_temp.ok(true, '33 transição inválida bloqueada');
  end;
  begin
    update public.clientes set status_cadastro = 'perdido' where id = c3;
    r := r || pg_temp.ok(false, '34 perda sem motivo');
  exception when others then r := r || pg_temp.ok(true, '34 perda exige motivo');
  end;

  -- encaminhamento ao jurídico
  perform pg_temp.como(gest, e);
  d := public.encaminhar_ao_juridico(c2, 'Revisão de contrato', 'consumidor', 'Cliente relata cobrança indevida');
  r := r || pg_temp.ok((select situacao_encaminhamento from public.processos where id = d) = 'encaminhado', '35 encaminhamento ao jurídico cria processo encaminhado');
  perform pg_temp.como(cons, e);
  begin
    perform public.encaminhar_ao_juridico(c2, 'Tentativa', 'civel');
    r := r || pg_temp.ok(false, '36 consultor encaminha sem permissão');
  exception when others then r := r || pg_temp.ok(true, '36 encaminhar exige a funcionalidade');
  end;

  -- dias úteis
  perform pg_temp.como(null);
  r := r || pg_temp.ok(extract(isodow from public.somar_prazo('2026-10-23 12:00-03'::timestamptz, 1, 'uteis')) = 1, '37 contagem em dias úteis pula o fim de semana');

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
