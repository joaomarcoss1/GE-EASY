-- =====================================================================
-- Teste de segurança (RLS + triggers) — GE EASY
-- Executa tudo dentro de um bloco que termina com RAISE EXCEPTION, então
-- NADA é gravado (rollback). O resultado aparece na mensagem de erro.
-- Rode no SQL Editor do Supabase. Resultado esperado (14/10/2026):
--   1 true | 2 bloqueado | 3 bloqueado | 4 1 (4000.00/1600.00) | 5 0 | 6 1 | 7 0
--   8 0 | 9 0 | 10 0 | 11 0 | 12 bloqueado | 13 0 | 14 bloqueado | 15 1 | 16 >0
--   17 1 | 18 bloqueado | 19 estornada | 20 permission denied
-- =====================================================================
do $$
declare
  a uuid := gen_random_uuid(); e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); ina uuid := gen_random_uuid();
  c1 uuid; prod uuid; adm uuid; v_cota uuid; n int; r text := ''; ok boolean; s text;
begin
  if exists (select 1 from public.profiles where role = 'admin' and active) then
    raise notice 'Já existe admin: o usuário "a" deste teste não será admin; os itens 15-18 refletem isso.';
  end if;
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-admin@test.local', '{}', '{"full_name":"Admin Teste"}', now(), now());
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (e1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-e1@test.local', '{"ge_role":"consultor_externo","ge_active":true}', '{}', now(), now()),
         (e2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-e2@test.local', '{"ge_role":"consultor_externo","ge_active":true}', '{}', now(), now()),
         (ina, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-ina@test.local', '{}', '{}', now(), now());
  update public.profiles set comissao_percentual = 40 where id = e1;
  insert into public.parceiros (tipo, nome, comissao_padrao) values ('administradora', 'Adm Teste RLS', 1) returning id into adm;
  insert into public.produtos (parceiro_id, linha, categoria, nome, comissao_percentual) values (adm, 'consorcio', 'imovel', 'Imóvel Teste', 2) returning id into prod;

  perform set_config('request.jwt.claims', json_build_object('sub', e1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.clientes (nome, consultor_id) values ('Cliente do E1', e2) returning id into c1;
  select consultor_id = e1 into ok from public.clientes where id = c1;
  r := r || E'\n1 consultor forçado como dono: ' || ok;
  begin update public.profiles set role = 'admin' where id = e1; r := r || E'\n2 auto-escalonamento: FALHOU';
  exception when others then r := r || E'\n2 auto-escalonamento bloqueado: ' || sqlerrm; end;
  begin update public.clientes set consultor_id = e2 where id = c1; r := r || E'\n3 transferência: FALHOU';
  exception when others then r := r || E'\n3 transferência bloqueada: ' || sqlerrm; end;
  insert into public.consorcio_cotas (cliente_id, administradora_id, produto_id, valor_credito, prazo_meses, parcela_valor, status)
  values (c1, adm, prod, 200000, 180, 1500, 'ativa') returning id into v_cota;
  select count(*) into n from public.comissoes where cota_id = v_cota; r := r || E'\n4 comissão gerada/visível ao dono: ' || n;
  select valor_corretora || '/' || valor_consultor into s from public.comissoes where cota_id = v_cota; r := r || E'\n  corretora/consultor: ' || s;
  select count(*) into n from public.audit_logs; r := r || E'\n5 consultor lê auditoria: ' || n;
  select count(*) into n from public.interacoes where cliente_id = c1; r := r || E'\n6 linha do tempo automática: ' || n;
  begin update public.comissoes set status = 'paga' where cota_id = v_cota; get diagnostics n = row_count; r := r || E'\n7 consultor altera comissão (linhas): ' || n;
  exception when others then r := r || E'\n7 consultor altera comissão bloqueado: ' || sqlerrm; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', e2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.clientes where id = c1; r := r || E'\n8 E2 vê cliente do E1: ' || n;
  select count(*) into n from public.consorcio_cotas where id = v_cota; r := r || E'\n9 E2 vê cota do E1: ' || n;
  select count(*) into n from public.comissoes where cota_id = v_cota; r := r || E'\n10 E2 vê comissão do E1: ' || n;
  update public.clientes set nome = 'hack' where id = c1; get diagnostics n = row_count; r := r || E'\n11 E2 altera cliente do E1 (linhas): ' || n;
  begin insert into public.consorcio_cotas (cliente_id, valor_credito, prazo_meses) values (c1, 1000, 10); r := r || E'\n12 E2 cria cota em cliente alheio: FALHOU';
  exception when others then r := r || E'\n12 E2 cota em cliente alheio bloqueada: ' || sqlerrm; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', ina, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.parceiros; r := r || E'\n13 inativo vê cadastros: ' || n;
  begin insert into public.clientes (nome) values ('x inativo'); r := r || E'\n14 inativo cria cliente: FALHOU';
  exception when others then r := r || E'\n14 inativo cria cliente bloqueado: ' || sqlerrm; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.clientes where id = c1; r := r || E'\n15 admin vê cliente: ' || n;
  select count(*) into n from public.audit_logs; r := r || E'\n16 admin vê auditoria: ' || n;
  update public.clientes set consultor_id = e2 where id = c1; get diagnostics n = row_count; r := r || E'\n17 admin transfere carteira: ' || n;
  begin update public.profiles set role = 'gestor' where id = a; r := r || E'\n18 admin se rebaixa: FALHOU';
  exception when others then r := r || E'\n18 admin se rebaixa bloqueado: ' || sqlerrm; end;
  update public.consorcio_cotas set status = 'cancelada' where id = v_cota;
  select status::text into s from public.comissoes where cota_id = v_cota; r := r || E'\n19 estorno no cancelamento: ' || s;
  execute 'reset role';

  execute 'set local role anon';
  begin select count(*) into n from public.clientes; r := r || E'\n20 anon lê clientes: ' || n;
  exception when others then r := r || E'\n20 anon bloqueado: ' || sqlerrm; end;
  execute 'reset role';

  raise exception 'RESULTADO (rollback):%', r;
end $$;
