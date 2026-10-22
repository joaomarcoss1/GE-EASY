-- =====================================================================
-- Teste da Fase 2: departamentos × níveis × funcionalidades, auditoria imutável e lixeira.
-- Rollback ao final (RAISE). Passa quando a mensagem começa com "RESULTADO: OK".
-- =====================================================================
create function pg_temp.como(p_uid uuid, p_emp uuid default null) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.headers', case when p_emp is null then '' else json_build_object('x-empresa-id', p_emp, 'x-geeasy-area', 'administrativo', 'x-geeasy-origem', 'web', 'x-geeasy-ip', '200.1.2.3')::text end, true);
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
  e uuid;
  dono uuid; master uuid; cons uuid; rh uuid; gest uuid; adv uuid;
  cli uuid; cli2 uuid; doc uuid; n int; b boolean; s text; v_dep uuid; v_nivel uuid; r text := '';
begin
  select user_id into dono from public.plataforma_admins limit 1;
  if dono is null then dono := pg_temp.usuario('t-dono2@test.local', '{}'); end if;
  insert into public.empresas (nome, slug) values ('Empresa Acessos', 'empresa-acessos') returning id into e;
  perform public.provisionar_empresa(e);

  master := pg_temp.usuario('t-master@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  cons := pg_temp.usuario('t-cons@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  gest := pg_temp.usuario('t-gest@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'gestor'));
  adv := pg_temp.usuario('t-adv@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'advogado'));
  rh := pg_temp.usuario('t-rh@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'administrativo'));
  -- RH: nível Gestor no departamento de RH (feito pelo master)
  perform pg_temp.como(master, e);
  select d.id, n.id into v_dep, v_nivel from public.departamentos d join public.departamento_niveis n on n.departamento_id = d.id and n.nome = 'Gestor'
   where d.empresa_id = e and d.tipo = 'rh';
  insert into public.departamento_membros (departamento_id, user_id, nivel_id) values (v_dep, rh, v_nivel);

  -- ---------------- permissões efetivas e áreas
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(public.tem_permissao('clientes.write') and public.tem_permissao('comercial.view') and not public.tem_permissao('processos.view'), '1 consultor: perfil padrão (Comercial/Operador)');
  r := r || pg_temp.ok(public.minhas_areas() = array['consultor'], '2 consultor entra só na área Consultor');
  perform pg_temp.como(adv, e);
  r := r || pg_temp.ok(public.tem_permissao('processos.write') and 'juridico' = any(public.minhas_areas()), '3 advogado: Jurídico/Supervisor');
  perform pg_temp.como(gest, e);
  r := r || pg_temp.ok(public.minhas_areas() @> array['administrativo', 'consultor', 'financeiro', 'juridico'], '4 gestor com várias áreas de trabalho');
  perform pg_temp.como(master, e);
  r := r || pg_temp.ok((select count(*) from unnest(public.minhas_permissoes())) = (select count(*) from public.funcionalidades), '5 admin master tem todas as funcionalidades');

  -- ---------------- retirar uma funcionalidade bloqueia no banco
  perform pg_temp.como(cons, e);
  insert into public.clientes (nome) values ('Cliente antes da revogação') returning id into cli;
  r := r || pg_temp.ok(cli is not null, '6 consultor cadastra cliente');
  perform pg_temp.como(master, e);
  insert into public.usuario_permissoes_extra (user_id, funcionalidade, tipo, motivo) values (cons, 'clientes.write', 'revogacao', 'Teste de revogação');
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(not public.tem_permissao('clientes.write'), '7 revogação vale na próxima requisição');
  begin
    insert into public.clientes (nome) values ('Depois da revogação');
    r := r || pg_temp.ok(false, '8 cadastrar sem a funcionalidade');
  exception when others then r := r || pg_temp.ok(true, '8 sem clientes.write o banco recusa o cadastro');
  end;
  update public.clientes set nome = 'Editado' where id = cli; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 0, '9 sem clientes.write o banco recusa a edição');
  perform pg_temp.como(master, e);
  delete from public.usuario_permissoes_extra where user_id = cons and funcionalidade = 'clientes.write';
  insert into public.usuario_permissoes_extra (user_id, funcionalidade, tipo, motivo, valido_ate) values (cons, 'processos.view', 'concessao', 'Acesso temporário', now() + interval '1 day');
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(public.tem_permissao('processos.view') and public.tem_permissao('clientes.write'), '10 concessão temporária e restauração');
  perform pg_temp.como(null);
  update public.usuario_permissoes_extra set valido_ate = now() - interval '1 minute' where user_id = cons;
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(not public.tem_permissao('processos.view'), '11 concessão vencida deixa de valer');

  -- nível: tirar a funcionalidade do nível afeta todos os membros
  perform pg_temp.como(master, e);
  delete from public.nivel_funcionalidades nf using public.departamento_niveis n, public.departamentos d
   where nf.nivel_id = n.id and n.departamento_id = d.id and d.empresa_id = e and d.tipo = 'consultor' and n.nome = 'Operador' and nf.funcionalidade = 'visitas.checkin';
  perform pg_temp.como(cons, e);
  r := r || pg_temp.ok(not public.tem_permissao('visitas.checkin'), '12 funcionalidade retirada do nível');

  -- ---------------- quem pode mexer em acessos
  perform pg_temp.como(gest, e);
  begin
    insert into public.usuario_permissoes_extra (user_id, funcionalidade, tipo, motivo) values (cons, 'auditoria.view', 'concessao', 'tentativa');
    r := r || pg_temp.ok(false, '13 gestor concede funcionalidade');
  exception when others then r := r || pg_temp.ok(true, '13 só o master concede funcionalidades');
  end;
  begin
    update public.departamento_membros set nivel_id = (select id from public.departamento_niveis where departamento_id = v_dep and nome = 'Gestor')
     where user_id = cons; get diagnostics n = row_count;
    r := r || pg_temp.ok(n = 0, '14 gestor não muda nível de acesso');
  exception when others then r := r || pg_temp.ok(true, '14 gestor não muda nível de acesso');
  end;
  perform pg_temp.como(master, e);
  begin
    insert into public.usuario_permissoes_extra (user_id, funcionalidade, tipo, motivo) values (master, 'auditoria.view', 'concessao', 'auto');
    r := r || pg_temp.ok(false, '15 master concede a si mesmo');
  exception when others then r := r || pg_temp.ok(true, '15 ninguém altera o próprio acesso');
  end;
  perform pg_temp.como(rh, e);
  r := r || pg_temp.ok(public.tem_permissao('usuarios.manage') and 'rh' = any(public.minhas_areas()), '16 RH Gestor gere usuários');
  update public.empresa_membros set ativo = false where empresa_id = e and user_id = cons; get diagnostics n = row_count;
  r := r || pg_temp.ok(n = 1, '17 RH desativa consultor');
  begin
    update public.empresa_membros set role = 'gestor' where empresa_id = e and user_id = adv;
    r := r || pg_temp.ok(false, '18 RH promove a gestor');
  exception when others then r := r || pg_temp.ok(true, '18 RH não concede perfil de gestão');
  end;
  begin
    update public.empresa_membros set ativo = false where empresa_id = e and user_id = master;
    r := r || pg_temp.ok(false, '19 RH desativa master');
  exception when others then r := r || pg_temp.ok(true, '19 RH não mexe no master');
  end;
  perform pg_temp.como(null);
  update public.empresa_membros set ativo = true where empresa_id = e and user_id = cons;

  -- copiar perfil
  perform pg_temp.como(master, e);
  perform public.copiar_acessos(adv, rh);
  r := r || pg_temp.ok(public.permissoes_do_usuario(rh) @> array['processos.write'], '20 copiar acessos ("igual ao fulano")');

  -- ---------------- auditoria
  perform pg_temp.como(master, e);
  insert into public.clientes (nome, documento) values ('Auditado', '52998224725') returning id into cli2;
  update public.clientes set nome = 'Auditado Alterado', cidade = 'Codó' where id = cli2;
  select a.campos_alterados::text, a.area || '/' || a.origem || '/' || a.ip into s from public.audit_logs a where a.tabela = 'clientes' and a.registro_id = cli2::text and a.acao = 'UPDATE';
  r := r || pg_temp.ok(s like '{cidade,nome}%', '21 auditoria registra campos alterados: ' || coalesce(s, 'null'));
  select a.area || '/' || a.origem || '/' || a.ip into s from public.audit_logs a where a.tabela = 'clientes' and a.registro_id = cli2::text and a.acao = 'UPDATE';
  r := r || pg_temp.ok(s = 'administrativo/web/200.1.2.3', '22 auditoria registra área, origem e IP');
  select dados_antigos->>'nome' into s from public.audit_logs where tabela = 'clientes' and registro_id = cli2::text and acao = 'UPDATE';
  r := r || pg_temp.ok(s = 'Auditado', '23 valor anterior preservado');

  -- lixeira
  delete from public.clientes where id = cli2; get diagnostics n = row_count;
  r := r || pg_temp.ok(not exists (select 1 from public.clientes where id = cli2), '24 cliente excluído some das listas');
  r := r || pg_temp.ok(exists (select 1 from public.audit_logs where registro_id = cli2::text and acao = 'EXCLUSAO'), '25 exclusão lógica auditada como EXCLUSAO');
  perform pg_temp.como(null);
  r := r || pg_temp.ok(exists (select 1 from public.clientes where id = cli2 and excluido_em is not null and excluido_por = master), '26 registro preservado com quem excluiu');
  perform pg_temp.como(master, e);
  select count(*) into n from public.lixeira_listar('clientes') l where l.id = cli2;
  r := r || pg_temp.ok(n = 1, '27 lixeira lista o excluído');
  perform public.lixeira_restaurar('clientes', cli2);
  r := r || pg_temp.ok(exists (select 1 from public.clientes where id = cli2), '28 restauração devolve o cliente');
  r := r || pg_temp.ok(exists (select 1 from public.audit_logs where registro_id = cli2::text and acao = 'RESTAURACAO'), '29 restauração auditada');
  perform pg_temp.como(cons, e);
  begin
    perform public.lixeira_listar(null);
    r := r || pg_temp.ok(false, '30 consultor vê a lixeira');
  exception when others then r := r || pg_temp.ok(true, '30 consultor sem acesso à lixeira');
  end;
  select count(*) into n from public.audit_logs;
  r := r || pg_temp.ok(n = 0, '31 consultor não lê auditoria');
  begin
    execute 'select count(*) from public.audit_logs_padrao';
    r := r || pg_temp.ok(false, '32 partição acessível diretamente');
  exception when others then r := r || pg_temp.ok(true, '32 partições sem acesso direto');
  end;

  -- relatório por funcionário bate com a contagem bruta
  perform pg_temp.como(master, e);
  select f.inclusoes + f.alteracoes + f.exclusoes + f.restauracoes + f.acessos into n from public.auditoria_por_funcionario(now() - interval '1 hour', now() + interval '1 hour') f where f.actor_id = master;
  r := r || pg_temp.ok(n = (select count(*) from public.audit_logs where actor_id = master), '33 relatório por funcionário = contagem bruta');

  -- imutabilidade e selo
  perform pg_temp.como(null);
  begin
    update public.audit_logs set acao = 'X' where registro_id = cli2::text;
    r := r || pg_temp.ok(false, '34 alterar auditoria (até como dono do banco)');
  exception when others then r := r || pg_temp.ok(true, '34 auditoria imutável (UPDATE)');
  end;
  begin
    delete from public.audit_logs where registro_id = cli2::text;
    r := r || pg_temp.ok(false, '35 apagar auditoria');
  exception when others then r := r || pg_temp.ok(true, '35 auditoria imutável (DELETE)');
  end;
  begin
    truncate public.audit_logs;
    r := r || pg_temp.ok(false, '36 truncar auditoria');
  exception when others then r := r || pg_temp.ok(true, '36 auditoria imutável (TRUNCATE)');
  end;
  perform public.auditoria_selar(100000, '0 seconds');
  perform pg_temp.como(master, e);
  select integra into b from public.auditoria_verificar();
  r := r || pg_temp.ok(b, '37 cadeia de selos íntegra');
  perform pg_temp.como(null);
  alter table public.audit_logs disable trigger trg_audit_imutavel;
  update public.audit_logs set dados_novos = jsonb_set(dados_novos, '{nome}', '"Adulterado"') where tabela = 'clientes' and registro_id = cli2::text and acao = 'INSERT';
  alter table public.audit_logs enable trigger trg_audit_imutavel;
  perform pg_temp.como(master, e);
  select integra into b from public.auditoria_verificar();
  r := r || pg_temp.ok(not b, '38 adulteração detectada pela verificação');

  -- alerta de exclusões em massa
  perform pg_temp.como(null);
  insert into public.configuracoes (empresa_id, chave, valor) values (e, 'alertas_auditoria', '{"exclusoes_limite": 3}');
  perform pg_temp.como(master, e);
  insert into public.clientes (nome) select 'Massa ' || g from generate_series(1, 4) g;
  delete from public.clientes where nome like 'Massa %';
  perform pg_temp.como(null);
  perform public.auditoria_alertas();
  r := r || pg_temp.ok(exists (select 1 from public.notificacoes where user_id = master and chave like 'auditoria:exclusao:%'), '39 alerta de exclusões em massa ao master');

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
