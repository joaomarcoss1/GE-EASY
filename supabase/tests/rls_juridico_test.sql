-- =====================================================================
-- Teste de segurança do núcleo jurídico (rollback ao final via RAISE).
-- Resultado esperado (14/10/2026): 1 ok | 2 1 | 3 true | 4 bloqueado | 5 sem erro
--   6 0 | 7 0 | 8 bloqueado | 9 0 | 10 bloqueado | 11 1 | 12 ok | 13 0 | 14 2 | 15 1 | 16 1
-- =====================================================================
do $$
declare
  adv1 uuid := gen_random_uuid(); adv2 uuid := gen_random_uuid(); com uuid := gen_random_uuid(); fin uuid := gen_random_uuid();
  dep_cont uuid; dep_trab uuid; p1 uuid; pz uuid; n int; r text := ''; s text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
    (adv1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-adv1@test.local', '{"ge_role":"advogado","ge_active":true}', '{}', now(), now()),
    (adv2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-adv2@test.local', '{"ge_role":"advogado","ge_active":true}', '{}', now(), now()),
    (com,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-com@test.local',  '{"ge_role":"consultor_externo","ge_active":true}', '{}', now(), now()),
    (fin,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-fin@test.local',  '{"ge_role":"financeiro","ge_active":true}', '{}', now(), now());
  select id into dep_cont from public.departamentos where sigla = 'CONT';
  select id into dep_trab from public.departamentos where sigla = 'TRAB';
  insert into public.departamento_membros (departamento_id, user_id) values (dep_cont, adv1), (dep_trab, adv2);

  perform set_config('request.jwt.claims', json_build_object('sub', adv1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.processos (titulo, numero_cnj, departamento_id, responsavel_id) values ('Ação revisional teste', '0000001-23.2026.8.26.0100', dep_cont, adv1) returning id into p1;
  r := r || E'\n1 advogado cria processo no seu depto: ok';
  insert into public.prazos (processo_id, descricao, data_fim) values (p1, 'Contestação', current_date + 2) returning id into pz;
  select count(*) into n from public.processo_andamentos where processo_id = p1; r := r || E'\n2 andamento automático do prazo: ' || n;
  select (departamento_id = dep_cont)::text into s from public.prazos where id = pz; r := r || E'\n3 prazo herdou departamento: ' || s;
  begin insert into public.processos (titulo, departamento_id) values ('Fora do depto', dep_trab); r := r || E'\n4 criar em outro depto: FALHOU';
  exception when others then r := r || E'\n4 criar processo em outro depto bloqueado: ' || sqlerrm; end;
  select count(*) into n from public.clientes; r := r || E'\n5 advogado lê clientes (sem erro): ' || n;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', adv2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.processos where id = p1; r := r || E'\n6 advogado de outro depto vê processo: ' || n;
  select count(*) into n from public.prazos where id = pz; r := r || E'\n7 advogado de outro depto vê prazo: ' || n;
  begin insert into public.processo_andamentos (processo_id, descricao) values (p1, 'invasão'); r := r || E'\n8 andamento em processo alheio: FALHOU';
  exception when others then r := r || E'\n8 andamento em processo alheio bloqueado: ' || sqlerrm; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', com, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.processos; r := r || E'\n9 consultor comercial vê processos: ' || n;
  begin insert into public.processos (titulo) values ('x'); r := r || E'\n10 consultor cria processo: FALHOU';
  exception when others then r := r || E'\n10 consultor cria processo bloqueado: ' || sqlerrm; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', fin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.processos where id = p1; r := r || E'\n11 financeiro lê processo: ' || n;
  insert into public.processo_lancamentos (processo_id, tipo, valor) values (p1, 'custas', 350); r := r || E'\n12 financeiro lança custas: ok';
  update public.processos set titulo = 'hack' where id = p1; get diagnostics n = row_count; r := r || E'\n13 financeiro altera processo (linhas): ' || n;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', adv1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.processos set fase = 'recursal' where id = p1;
  select count(*) into n from public.processo_andamentos where processo_id = p1; r := r || E'\n14 andamentos após mudar fase: ' || n;
  select count(*) into n from public.busca_global('revisional'); r := r || E'\n15 busca global acha processo: ' || n;
  select count(*) into n from public.busca_global('00000012320268260100'); r := r || E'\n16 busca por CNJ só dígitos: ' || n;
  execute 'reset role';

  raise exception 'RESULTADO (rollback):%', r;
end $$;
