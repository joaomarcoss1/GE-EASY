-- =====================================================================
-- Teste de segurança das integrações e da camada LGPD (rollback ao final via RAISE).
-- Resultado esperado (15/10/2026): 15 linhas "ok".
-- =====================================================================
do $$
declare
  adv1 uuid := gen_random_uuid(); adv2 uuid := gen_random_uuid();
  dep_cont uuid; dep_trab uuid; p1 uuid; n int; b boolean; r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
    (adv1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-int-adv1@test.local', '{"ge_role":"advogado","ge_active":true}', '{}', now(), now()),
    (adv2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-int-adv2@test.local', '{"ge_role":"advogado","ge_active":true}', '{}', now(), now());
  select id into dep_cont from public.departamentos where sigla = 'CONT';
  select id into dep_trab from public.departamentos where sigla = 'TRAB';
  insert into public.departamento_membros (departamento_id, user_id) values (dep_cont, adv1), (dep_trab, adv2);
  insert into public.processos (titulo, numero_cnj, departamento_id, responsavel_id) values ('Processo integração', '0000002-23.2026.8.26.0100', dep_cont, adv1) returning id into p1;

  -- ---------------------------------------------------------------- adv2 (sem acesso ao processo)
  perform set_config('request.jwt.claims', json_build_object('sub', adv2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  b := public.rate_limit('teste', 2, 60); b := b and public.rate_limit('teste', 2, 60);
  r := r || E'\n1 rate_limit libera dentro do limite: ' || case when b then 'ok' else 'FALHOU' end;
  b := public.rate_limit('teste', 2, 60);
  r := r || E'\n2 rate_limit bloqueia acima do limite: ' || case when not b then 'ok' else 'FALHOU' end;

  select count(*) into n from public.rate_limits;
  r := r || E'\n3 tabela rate_limits invisível: ' || case when n = 0 then 'ok' else 'FALHOU' end;

  begin perform public.registrar_acesso('HACK', 'x', null, null); r := r || E'\n4 ação de auditoria inválida: FALHOU';
  exception when others then r := r || E'\n4 ação de auditoria inválida bloqueada: ok'; end;

  perform public.registrar_acesso('DOWNLOAD', 'documentos', 'abc', '{"nome":"x.pdf"}');
  select count(*) into n from public.audit_logs;
  r := r || E'\n5 advogado não lê audit_logs: ' || case when n = 0 then 'ok' else 'FALHOU' end;

  begin perform public.anonimizar_cliente(gen_random_uuid()); r := r || E'\n6 anonimizar sem ser admin: FALHOU';
  exception when others then r := r || E'\n6 anonimizar sem ser admin bloqueado: ok'; end;

  begin insert into public.documentos (nome, processo_id, enviado_por) values ('x.pdf', p1, adv2); r := r || E'\n7 documento em processo alheio: FALHOU';
  exception when others then r := r || E'\n7 documento em processo alheio bloqueado: ok'; end;

  r := r || E'\n8 storage de processo alheio: ' || case when not public.storage_can_access('processos/' || p1 || '/a.pdf') then 'ok' else 'FALHOU' end;

  perform public.notificar_movimentacoes(p1, 3);

  -- 10: pg_net (schema "net") não é exposto pela API REST; grants do supabase_admin não são revogáveis (ver migração 0300)
  r := r || E'\n10 disparar_sincronizacao sem EXECUTE para o usuário: ' || case when not has_function_privilege('authenticated', 'public.disparar_sincronizacao(text)', 'execute') then 'ok' else 'FALHOU' end;

  select count(*) into n from public.integracoes_log; r := r || E'\n11 log de integrações invisível ao advogado: ' || case when n = 0 then 'ok' else 'FALHOU' end;
  select count(*) into n from public.drive_pastas; r := r || E'\n12 cache de pastas invisível: ' || case when n = 0 then 'ok' else 'FALHOU' end;
  execute 'reset role';
  select count(*) into n from public.notificacoes where user_id = adv1;
  r := r || E'\n9 notificar processo alheio não gera aviso: ' || case when n = 0 then 'ok' else 'FALHOU' end;

  -- ---------------------------------------------------------------- adv1 (responsável)
  perform set_config('request.jwt.claims', json_build_object('sub', adv1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.documentos (nome, processo_id, enviado_por) values ('peticao.pdf', p1, adv1);
  r := r || E'\n13 responsável anexa documento ao processo: ok';
  r := r || E'\n14 storage do próprio processo: ' || case when public.storage_can_access('processos/' || p1 || '/a.pdf') then 'ok' else 'FALHOU' end;
  insert into public.processo_andamentos (processo_id, descricao, origem, externo_id, autor_id) values (p1, 'Movimento DataJud', 'datajud', 'dj:G1:1:x', null);
  begin insert into public.processo_andamentos (processo_id, descricao, origem, externo_id, autor_id) values (p1, 'Duplicado', 'datajud', 'dj:G1:1:x', null);
    r := r || E'\n15 movimento duplicado: FALHOU';
  exception when unique_violation then r := r || E'\n15 movimento duplicado bloqueado: ok'; end;
  execute 'reset role';

  raise exception 'RESULTADO:%', r;
end $$;
