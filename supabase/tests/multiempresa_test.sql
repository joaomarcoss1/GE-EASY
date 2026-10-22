-- =====================================================================
-- Teste de isolamento multiempresa (Fase 1) — duas empresas convivendo.
-- Tudo dentro de um bloco que termina com RAISE EXCEPTION (rollback): nada é gravado.
-- Passa quando a mensagem final começa com "RESULTADO: OK". Roda no SQL Editor ou em scripts/db-test.sh.
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
  ea uuid := (select id from public.empresas where slug = 'easy');
  eb uuid;
  dono uuid; adm_a uuid; adv_a uuid; cons_a uuid; adm_b uuid; cons_b uuid; multi uuid;
  cli_a uuid; cli_b uuid; proc_a uuid; proc_b uuid; n int; v uuid; s text; r text := ''; ok boolean;
begin
  -- dono da plataforma: bootstrap se o banco está vazio; senão usa um master existente
  select user_id into dono from public.plataforma_admins limit 1;
  if dono is null then dono := pg_temp.usuario('t-dono@test.local', '{}'); end if;

  insert into public.empresas (nome, slug, status) values ('Empresa B Teste', 'empresa-b-teste', 'ativa') returning id into eb;
  perform public.provisionar_empresa(eb);

  adm_a := pg_temp.usuario('t-adm-a@test.local', jsonb_build_object('ge_empresa_id', ea, 'ge_role', 'admin', 'ge_admin_master', true));
  adv_a := pg_temp.usuario('t-adv-a@test.local', jsonb_build_object('ge_empresa_id', ea, 'ge_role', 'advogado'));
  cons_a := pg_temp.usuario('t-cons-a@test.local', jsonb_build_object('ge_empresa_id', ea, 'ge_role', 'consultor_externo'));
  adm_b := pg_temp.usuario('t-adm-b@test.local', jsonb_build_object('ge_empresa_id', eb, 'ge_role', 'admin', 'ge_admin_master', true));
  cons_b := pg_temp.usuario('t-cons-b@test.local', jsonb_build_object('ge_empresa_id', eb, 'ge_role', 'consultor_externo'));
  multi := pg_temp.usuario('t-multi@test.local', jsonb_build_object('ge_empresa_id', ea, 'ge_role', 'consultor'));
  insert into public.empresa_membros (empresa_id, user_id, role) values (eb, multi, 'gestor');

  -- dados de cada empresa (mesmo CPF e mesmo CNJ nas duas)
  perform pg_temp.como(adm_a);
  insert into public.clientes (nome, documento) values ('Cliente A', '111.444.777-35') returning id into cli_a;
  insert into public.processos (titulo, numero_cnj, cliente_id) values ('Processo A', '00012345620248100001', cli_a) returning id into proc_a;
  perform pg_temp.como(adm_b);
  insert into public.clientes (nome, documento) values ('Cliente B', '111.444.777-35') returning id into cli_b;
  r := r || pg_temp.ok(cli_b is not null, '1 mesmo CPF permitido em outra empresa');
  insert into public.processos (titulo, numero_cnj, cliente_id) values ('Processo B', '00012345620248100001', cli_b) returning id into proc_b;
  r := r || pg_temp.ok(proc_b is not null, '2 mesmo CNJ permitido em outra empresa');
  select count(*) into n from public.clientes where id = cli_a;
  r := r || pg_temp.ok(n = 0, '3 admin B não vê cliente da empresa A');

  -- leitura e escrita cruzadas
  perform pg_temp.como(adm_a);
  select count(*) into n from public.clientes where id = cli_b;
  r := r || pg_temp.ok(n = 0, '4 admin A não vê cliente da empresa B');
  update public.clientes set nome = 'hack' where id = cli_b; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 0, '5 admin A não altera cliente de B');
  delete from public.clientes where id = cli_b; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 0, '6 admin A não exclui cliente de B');
  begin
    insert into public.oportunidades (cliente_id, titulo, linha) values (cli_b, 'Cross', 'consorcio');
    r := r || pg_temp.ok(false, '7 oportunidade ligada a cliente de B');
  exception when others then r := r || pg_temp.ok(true, '7 oportunidade ligada a cliente de B bloqueada');
  end;
  begin
    insert into public.clientes (nome, empresa_id) values ('Forçado em B', eb);
    r := r || pg_temp.ok(false, '8 inserir informando empresa_id de B');
  exception when others then r := r || pg_temp.ok(true, '8 inserir com empresa_id de B bloqueado');
  end;
  begin
    update public.clientes set empresa_id = eb where id = cli_a;
    r := r || pg_temp.ok(false, '9 mover registro para B');
  exception when others then r := r || pg_temp.ok(true, '9 mover registro para outra empresa bloqueado');
  end;
  begin
    insert into public.tarefas (titulo, responsavel_id) values ('Tarefa para usuário de B', adm_b);
    r := r || pg_temp.ok(false, '10 atribuir tarefa a usuário de B');
  exception when others then r := r || pg_temp.ok(true, '10 atribuir a usuário de outra empresa bloqueado');
  end;
  select count(*) into n from public.busca_global('Cliente') b where b.id = cli_b;
  r := r || pg_temp.ok(n = 0, '11 busca global não retorna dados de B');
  select count(*) into n from public.profiles where id in (adm_b, cons_b);
  r := r || pg_temp.ok(n = 0, '12 perfis de B invisíveis para A');
  select count(*) into n from public.membros;
  r := r || pg_temp.ok(n >= 4 and not exists (select 1 from public.membros where id = adm_b), '13 visão membros só com a empresa A');
  select count(*) into n from public.empresa_membros where empresa_id = eb;
  r := r || pg_temp.ok(n = 0, '14 vínculos de B invisíveis');
  select count(*) into n from public.empresas where id = eb;
  r := r || pg_temp.ok(n = 0, '15 empresa B invisível');
  update public.empresas set nome = 'hack' where id = eb; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 0, '16 admin A não altera empresa B');
  select count(*) into n from public.configuracoes where chave = 'empresa';
  r := r || pg_temp.ok(n = 1, '17 configurações separadas por empresa');
  select count(*) into n from public.departamentos where empresa_id = eb;
  r := r || pg_temp.ok(n = 0, '18 departamentos de B invisíveis');
  r := r || pg_temp.ok(not public.storage_can_access('empresas/' || eb || '/clientes/' || cli_b || '/x.pdf'), '19 storage de B (caminho novo) negado');
  r := r || pg_temp.ok(not public.storage_can_access('clientes/' || cli_b || '/x.pdf'), '20 storage de B (caminho legado) negado');
  r := r || pg_temp.ok(not public.storage_can_access('empresas/' || eb || '/clientes/' || cli_a || '/x.pdf'), '21 prefixo de outra empresa negado mesmo com cliente próprio');
  r := r || pg_temp.ok(public.storage_can_access('empresas/' || ea || '/clientes/' || cli_a || '/x.pdf'), '22 storage da própria empresa liberado');
  begin
    perform public.anonimizar_cliente(cli_b);
    r := r || pg_temp.ok(false, '23 anonimizar cliente de B');
  exception when others then r := r || pg_temp.ok(true, '23 anonimizar cliente de B bloqueado');
  end;
  select count(*) into n from public.audit_logs where empresa_id = eb;
  r := r || pg_temp.ok(n = 0, '24 auditoria de B invisível');
  begin
    update public.profiles set empresa_padrao_id = eb where id = adm_a;
    r := r || pg_temp.ok(false, '25 escolher empresa sem vínculo');
  exception when others then r := r || pg_temp.ok(true, '25 escolher empresa padrão sem vínculo bloqueado');
  end;
  begin
    perform public.plataforma_criar_empresa('Intrusa', 'intrusa');
    r := r || pg_temp.ok(false, '26 admin de empresa cria empresa');
  exception when others then r := r || pg_temp.ok(true, '26 só a plataforma cria empresas');
  end;
  begin
    update public.empresas set plano = 'premium' where id = ea;
    r := r || pg_temp.ok(false, '27 admin muda o próprio plano');
  exception when others then r := r || pg_temp.ok(true, '27 plano/limites só pela plataforma');
  end;
  begin
    update public.empresa_membros set role = 'consultor' where empresa_id = ea and user_id = adm_a;
    r := r || pg_temp.ok(false, '28 alterar o próprio acesso');
  exception when others then r := r || pg_temp.ok(true, '28 alterar o próprio acesso bloqueado');
  end;
  update public.empresa_membros set ativo = false where empresa_id = ea and user_id = adv_a; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 1, '29 admin A desativa vínculo de usuário de A');

  -- cabeçalho de outra empresa: nada visível
  perform pg_temp.como(adm_b, ea);
  r := r || pg_temp.ok(public.empresa_atual() is null, '30 cabeçalho de empresa sem vínculo => sem empresa');
  select count(*) into n from public.clientes;
  r := r || pg_temp.ok(n = 0, '31 sem empresa válida nada é visível');
  perform pg_temp.como(adm_b, null);
  begin
    perform set_config('request.headers', '{"x-empresa-id":"nao-e-uuid"}', true);
    r := r || pg_temp.ok(public.empresa_atual() is null, '32 cabeçalho malformado => sem empresa');
  end;

  -- usuário de duas empresas
  perform pg_temp.como(multi);
  r := r || pg_temp.ok(public.empresa_atual() = ea, '33 sem cabeçalho vale a empresa padrão');
  r := r || pg_temp.ok(public.current_app_role() = 'consultor', '34 papel na empresa A = consultor');
  perform pg_temp.como(multi, eb);
  r := r || pg_temp.ok(public.empresa_atual() = eb and public.current_app_role() = 'gestor', '35 com cabeçalho B: empresa B e papel gestor');
  select count(*) into n from public.clientes where id = cli_b;
  r := r || pg_temp.ok(n = 1, '36 gestor em B vê cliente de B');
  select count(*) into n from public.clientes where id = cli_a;
  r := r || pg_temp.ok(n = 0, '37 trabalhando em B não vê cliente de A');
  select jsonb_array_length(public.contexto_sessao()->'empresas') into n;
  r := r || pg_temp.ok(n = 2, '38 contexto lista as duas empresas do usuário');

  -- desativado em A
  perform pg_temp.como(adv_a);
  select count(*) into n from public.processos;
  r := r || pg_temp.ok(n = 0 and public.empresa_atual() is null, '39 vínculo desativado perde acesso na próxima requisição');

  -- gravação do servidor (service role / rotina, sem usuário)
  perform pg_temp.como(null);
  insert into public.processo_andamentos (processo_id, descricao, origem) values (proc_b, 'Movimento do DataJud', 'datajud') returning empresa_id into v;
  r := r || pg_temp.ok(v = eb, '40 rotina herda a empresa do processo');
  begin
    insert into public.parceiros (tipo, nome) values ('administradora', 'Sem empresa');
    r := r || pg_temp.ok(false, '41 gravação do servidor sem empresa');
  exception when others then r := r || pg_temp.ok(sqlerrm like 'Empresa não definida%', '41 gravação do servidor sem empresa recusada');
  end;
  insert into public.publicacoes (empresa_id, numero_processo, conteudo, origem, hash) values (eb, '0001234-56.2024.8.10.0001', 'Intimação teste', 'djen', 'djen:t1') returning processo_id into v;
  r := r || pg_temp.ok(v = proc_b, '42 publicação vincula ao processo da mesma empresa');

  -- empresa suspensa
  update public.empresas set status = 'suspensa' where id = eb;
  perform pg_temp.como(cons_b);
  select count(*) into n from public.clientes;
  r := r || pg_temp.ok(n = 0 and public.empresa_atual() is null, '43 empresa suspensa: usuários sem acesso');

  -- último master
  perform pg_temp.como(null);
  update public.empresas set status = 'ativa' where id = eb;
  perform pg_temp.como(multi, eb);
  begin
    update public.empresa_membros set admin_master = false where empresa_id = eb and user_id = adm_b; get diagnostics n = row_count;
    r := r || pg_temp.ok(n = 0, '44 gestor não retira master (RLS)');
  exception when others then r := r || pg_temp.ok(true, '44 gestor não retira master');
  end;
  perform pg_temp.como(null);
  update public.empresa_membros set role = 'admin' where empresa_id = eb and user_id = multi;
  perform pg_temp.como(multi, eb);
  begin
    update public.empresa_membros set admin_master = false where empresa_id = eb and user_id = adm_b; get diagnostics n = row_count;
    r := r || pg_temp.ok(n = 0, '44b admin comum (sem gestão de usuários) não retira master');
  exception when others then r := r || pg_temp.ok(sqlerrm like 'Somente o administrador master%', '44b só o master concede/retira master');
  end;
  perform pg_temp.como(null);
  update public.empresa_membros set admin_master = true where empresa_id = eb and user_id = multi;
  perform pg_temp.como(multi, eb);
  update public.empresa_membros set ativo = false where empresa_id = eb and user_id = adm_b; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 1, '44c master desativa outro master (sobra um)');
  perform pg_temp.como(null);
  update public.empresa_membros set ativo = true where empresa_id = eb and user_id = adm_b;
  update public.empresa_membros set admin_master = false where empresa_id = eb and user_id = multi;
  perform pg_temp.como(adm_b);
  begin
    update public.empresa_membros set ativo = false where empresa_id = eb and user_id = multi; get diagnostics n = row_count;
    r := r || pg_temp.ok(n = 1, '44d master desativa membro comum');
  exception when others then r := r || pg_temp.ok(false, '44d master desativa membro comum: ' || sqlerrm);
  end;

  -- plataforma
  perform pg_temp.como(dono);
  select count(*) into n from public.plataforma_uso() u where u.empresa_id in (ea, eb);
  r := r || pg_temp.ok(n = 2, '45 dono da plataforma vê o uso das empresas');
  select count(*) into n from public.empresa_publica('empresa-b-teste', null);
  r := r || pg_temp.ok(n = 1, '46 empresa encontrada pelo subdomínio');

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
