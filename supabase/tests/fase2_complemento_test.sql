-- =====================================================================
-- Teste do complemento da Fase 2: catálogo, equipes, desligamento, dispositivos, "ver como",
-- falhas de login e divisão das políticas de escrita. Rollback ao final (RAISE).
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
  e uuid; master uuid; sup uuid; cons uuid; cons2 uuid; rh uuid; dest uuid;
  c1 uuid; c2 uuid; t1 uuid; disp uuid := gen_random_uuid(); n int; j jsonb; s text; r text := '';
  v_dep uuid; v_nivel uuid;
begin
  insert into public.empresas (nome, slug) values ('Empresa Fase 2', 'empresa-fase-2') returning id into e;
  perform public.provisionar_empresa(e);
  master := pg_temp.usuario('t-f2m@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  sup := pg_temp.usuario('t-f2s@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor'));
  cons := pg_temp.usuario('t-f2c@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  cons2 := pg_temp.usuario('t-f2c2@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  dest := pg_temp.usuario('t-f2d@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  rh := pg_temp.usuario('t-f2rh@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'administrativo'));
  perform pg_temp.como(master, e);
  select d.id, n.id into v_dep, v_nivel from public.departamentos d join public.departamento_niveis n on n.departamento_id = d.id and n.nome = 'Gestor'
   where d.empresa_id = e and d.tipo = 'rh';
  insert into public.departamento_membros (departamento_id, user_id, nivel_id) values (v_dep, rh, v_nivel);

  -- ---------------- catálogo e padrões
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(public.tem_permissao('rotas.executar') and public.tem_permissao('ponto.registrar') and public.tem_permissao('whatsapp.atender')
                       and not public.tem_permissao('rotas.definir') and not public.tem_permissao('despesas.aprovar'), '1 consultor Operador recebe as funcionalidades de campo');
  perform pg_temp.como(rh, e);
  r := r || pg_temp.ok(public.tem_permissao('folha.gerir') and public.tem_permissao('dispositivos.gerir') and public.tem_permissao('rh.dados_sensiveis'), '2 RH Gestor recebe folha, dispositivos e dados sensíveis');
  r := r || pg_temp.ok(exists (select 1 from public.departamento_niveis n join public.departamentos d on d.id = n.departamento_id
                                 join public.nivel_funcionalidades nf on nf.nivel_id = n.id
                                where d.empresa_id = (select id from public.empresas where slug = 'easy') and d.tipo = 'consultor' and nf.funcionalidade = 'rotas.executar')
                       or not exists (select 1 from public.empresas where slug = 'easy'), '3 empresas existentes recebem as novas funcionalidades nos níveis');

  -- ---------------- equipe
  perform pg_temp.como(cons, e);
  insert into public.clientes (nome) values ('Cliente da equipe') returning id into c1;
  perform pg_temp.como(cons2, e);
  insert into public.clientes (nome) values ('Cliente fora da equipe') returning id into c2;
  perform pg_temp.como(sup, e);
  r := r || pg_temp.ok(not exists (select 1 from public.clientes where id = c1), '4 sem equipe o supervisor não vê a carteira do consultor');
  begin
    insert into public.equipe_membros (supervisor_id, membro_id) values (sup, cons);
    r := r || pg_temp.ok(false, '5 consultor monta a própria equipe');
  exception when others then r := r || pg_temp.ok(true, '5 só a gestão define equipes');
  end;
  perform pg_temp.como(master, e);
  insert into public.equipe_membros (supervisor_id, membro_id) values (sup, cons);
  perform pg_temp.como(sup, e);
  r := r || pg_temp.ok(exists (select 1 from public.clientes where id = c1) and public.can_access_cliente(c1), '6 supervisor vê a carteira da equipe');
  r := r || pg_temp.ok(not exists (select 1 from public.clientes where id = c2), '7 supervisor não vê consultor fora da equipe');
  update public.clientes set nome = 'Editado pelo supervisor' where id = c1; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 0, '8 escopo de equipe é só leitura');

  -- ---------------- dispositivos
  perform pg_temp.como(cons, e);
  insert into public.dispositivos (id, nome, plataforma) values (disp, 'Celular', 'Android');
  begin
    insert into public.dispositivos (id, user_id, nome) values (gen_random_uuid(), cons2, 'Intruso');
    r := r || pg_temp.ok(false, '9 registrar aparelho de outra pessoa');
  exception when others then r := r || pg_temp.ok(true, '9 aparelho registrado só pelo próprio usuário');
  end;
  begin
    update public.dispositivos set revogado_em = now() where id = disp;
    r := r || pg_temp.ok(false, '10 consultor revoga o próprio aparelho');
  exception when others then r := r || pg_temp.ok(true, '10 revogação exige dispositivos.gerir');
  end;

  -- ---------------- tarefas e negócios a transferir
  perform pg_temp.como(cons, e);
  insert into public.tarefas (titulo) values ('Ligar para o cliente') returning id into t1;

  -- ---------------- desligamento
  perform pg_temp.como(cons2, e);
  begin
    perform public.desligar_membro(cons, dest, 'teste');
    r := r || pg_temp.ok(false, '11 consultor desliga colega');
  exception when others then r := r || pg_temp.ok(true, '11 desligamento exige gestão de usuários');
  end;
  perform pg_temp.como(rh, e);
  begin
    perform public.desligar_membro(rh, null, 'teste');
    r := r || pg_temp.ok(false, '12 desligar a si mesmo');
  exception when others then r := r || pg_temp.ok(true, '12 ninguém desliga a si mesmo');
  end;
  j := public.desligar_membro(cons, dest, 'Pedido de demissão');
  r := r || pg_temp.ok((j->>'clientes')::int = 1 and (j->>'tarefas')::int = 1 and (j->>'dispositivos')::int = 1, '13 RH desliga: ' || j::text);
  perform pg_temp.como(null);
  select carteira::text || '/' || coalesce(consultor_id::text, '-') into s from public.clientes where id = c1;
  r := r || pg_temp.ok(s = 'consultor/' || dest, '14 carteira transferida ao destinatário');
  r := r || pg_temp.ok(exists (select 1 from public.cliente_carteira_historico where cliente_id = c1 and motivo = 'desligamento' and de_usuario = cons), '15 histórico com motivo desligamento');
  r := r || pg_temp.ok((select responsavel_id from public.tarefas where id = t1) = dest, '16 tarefas abertas transferidas');
  r := r || pg_temp.ok((select revogado_em is not null from public.dispositivos where id = disp), '17 aparelho revogado');
  r := r || pg_temp.ok(not (select ativo from public.empresa_membros where empresa_id = e and user_id = cons), '18 vínculo desativado');
  r := r || pg_temp.ok(not exists (select 1 from public.equipe_membros where membro_id = cons), '19 saiu das equipes');
  r := r || pg_temp.ok(exists (select 1 from public.audit_logs where empresa_id = e and acao = 'DESLIGAMENTO' and registro_id = cons::text), '20 desligamento auditado');
  r := r || pg_temp.ok(exists (select 1 from public.notificacoes where user_id = dest and titulo = 'Carteira transferida para você'), '21 destinatário avisado');
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(public.empresa_atual() is null and not exists (select 1 from public.clientes), '22 desligado perde o acesso na próxima requisição');

  -- desligar para a base administrativa (sem destinatário)
  perform pg_temp.como(master, e);
  perform public.desligar_membro(cons2, null, 'Fim de contrato');
  perform pg_temp.como(null);
  r := r || pg_temp.ok((select carteira::text from public.clientes where id = c2) = 'administrativo' and (select consultor_id from public.clientes where id = c2) is null, '23 sem destinatário: base administrativa');

  -- ---------------- ver como
  perform pg_temp.como(master, e);
  j := public.contexto_de_usuario(sup);
  r := r || pg_temp.ok(j->'permissoes' ? 'rotas.executar' and j->'areas' ? 'consultor' and jsonb_array_length(j->'equipe') = 0, '24 ver como: permissões, áreas e equipe');
  perform pg_temp.como(sup, e);
  begin
    perform public.contexto_de_usuario(master);
    r := r || pg_temp.ok(false, '25 consultor vê o contexto de outro');
  exception when others then r := r || pg_temp.ok(true, '25 ver como restrito ao master/RH');
  end;

  -- ---------------- falhas de login e alerta
  perform pg_temp.como(null);
  for n in 1..5 loop perform public.auditoria_falha_login('t-f2s@test.local', '10.0.0.' || n, 'teste'); end loop;
  r := r || pg_temp.ok((select count(*) from public.audit_logs where empresa_id = e and acao = 'LOGIN_FALHA' and registro_id = sup::text) = 5, '26 falhas de login registradas na empresa');
  perform public.auditoria_alertas();
  r := r || pg_temp.ok(exists (select 1 from public.notificacoes where user_id = master and chave like 'auditoria:falha-login:%'), '27 alerta de falhas de login ao master');
  r := r || pg_temp.ok(not has_function_privilege('authenticated', 'public.auditoria_falha_login(text, text, text)', 'execute'), '28 falha de login só pelo servidor');

  -- ---------------- políticas de escrita divididas
  r := r || pg_temp.ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('parceiros', 'comissoes', 'metas', 'configuracoes', 'departamentos', 'documento_tipos')
                                     and cmd = 'ALL' and permissive = 'PERMISSIVE'), '29 sem políticas permissivas FOR ALL duplicando a leitura');
  perform pg_temp.como(master, e);
  insert into public.parceiros (tipo, nome) values ('administradora', 'Administradora Teste');
  r := r || pg_temp.ok(found, '30 gestão continua gravando parceiros');
  perform pg_temp.como(sup, e);
  begin
    insert into public.parceiros (tipo, nome) values ('administradora', 'Intrusa');
    r := r || pg_temp.ok(false, '31 consultor grava parceiro');
  exception when others then r := r || pg_temp.ok(true, '31 consultor não grava parceiros');
  end;

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
