-- =====================================================================
-- Teste da Fase 6: leads (deduplicação, pontuação, distribuição, SLA, conversão) e WhatsApp
-- (entrada idempotente, roteamento pela carteira, janela de 24 h, opt-in, visibilidade, 45 dias,
-- desligamento, fila de webhooks). Rollback ao final (RAISE).
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
  e uuid; e2 uuid; master uuid; c1 uuid; c2 uuid; adm uuid; outro uuid;
  cli uuid; num uuid; num2 uuid; regra uuid; l1 uuid; l2 uuid; j jsonb; j2 jsonb; cv uuid; cv2 uuid; ct uuid; md uuid; mk uuid; camp uuid;
  n int; r text := ''; v_dep_adm uuid; ev bigint;
begin
  insert into public.empresas (nome, slug) values ('Empresa WA', 'empresa-wa') returning id into e;
  insert into public.empresas (nome, slug) values ('Outra WA', 'outra-wa') returning id into e2;
  perform public.provisionar_empresa(e);
  perform public.provisionar_empresa(e2);
  master := pg_temp.usuario('t-wam@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'admin', 'ge_admin_master', true));
  c1 := pg_temp.usuario('t-wac1@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  c2 := pg_temp.usuario('t-wac2@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'consultor_externo'));
  adm := pg_temp.usuario('t-waadm@test.local', jsonb_build_object('ge_empresa_id', e, 'ge_role', 'administrativo'));
  outro := pg_temp.usuario('t-wao@test.local', jsonb_build_object('ge_empresa_id', e2, 'ge_role', 'admin', 'ge_admin_master', true));
  select id into v_dep_adm from public.departamentos where empresa_id = e and tipo = 'administrativo' order by created_at limit 1;
  perform pg_temp.como(master, e);
  insert into public.departamento_membros (departamento_id, user_id, nivel_id)
  select v_dep_adm, adm, id from public.departamento_niveis where departamento_id = v_dep_adm and nome = 'Supervisor'
  on conflict (departamento_id, user_id) do update set nivel_id = excluded.nivel_id, ativo = true;

  -- ---------------- leads: distribuição, pontuação, deduplicação
  insert into public.distribuicao_regras (ordem, nome, criterio, membros, modo) values (1, 'Rodízio geral', 'qualquer', array[c1, c2], 'rodizio') returning id into regra;
  execute 'reset role';
  j := public.capturar_lead(e, '{"nome":"Lead Um","telefone":"(85) 99999-0001","cidade":"Fortaleza","interesse":"consórcio","renda":"9000"}', 'site');
  j2 := public.capturar_lead(e, '{"nome":"Lead Dois","telefone":"85999990002"}', 'lead_ads');
  l1 := (j->>'lead_id')::uuid; l2 := (j2->>'lead_id')::uuid;
  r := r || pg_temp.ok((j->>'novo')::boolean and (select telefone from public.leads where id = l1) = '5585999990001', '1 lead captado com telefone normalizado (E.164)');
  r := r || pg_temp.ok((select responsavel_id from public.leads where id = l1) is distinct from (select responsavel_id from public.leads where id = l2)
                       and (select responsavel_id from public.leads where id = l1) in (c1, c2), '2 rodízio distribui entre os membros');
  r := r || pg_temp.ok((select score from public.leads where id = l1) > (select score from public.leads where id = l2), '3 pontuação considera renda, interesse e cidade');
  r := r || pg_temp.ok((select sla_ate from public.leads where id = l1) > now() and exists (select 1 from public.notificacoes where chave like 'lead:' || l1 || ':%'), '4 SLA aberto e responsável avisado');
  j := public.capturar_lead(e, '{"nome":"Lead Um de novo","telefone":"5585999990001","email":"Um@Exemplo.com"}', 'whatsapp');
  r := r || pg_temp.ok(not (j->>'novo')::boolean and (j->>'lead_id')::uuid = l1 and (select email from public.leads where id = l1) = 'um@exemplo.com', '5 mesmo telefone não duplica o lead (atualiza)');
  j := public.capturar_lead(e2, '{"nome":"Lead Um","telefone":"5585999990001"}', 'site');
  r := r || pg_temp.ok((j->>'novo')::boolean, '6 deduplicação é por empresa');

  -- visibilidade de leads
  perform pg_temp.como((select responsavel_id from public.leads where id = l1), e);
  r := r || pg_temp.ok(exists (select 1 from public.leads where id = l1) and not exists (select 1 from public.leads where id = l2), '7 consultor vê só os próprios leads');
  perform pg_temp.como(outro, e2);
  r := r || pg_temp.ok(not exists (select 1 from public.leads where id = l1), '8 outra empresa não vê o lead');
  perform pg_temp.como(adm, e);
  r := r || pg_temp.ok(exists (select 1 from public.leads where id = l1) and exists (select 1 from public.leads where id = l2), '9 administrativo com distribuição vê todos');

  -- descarte exige motivo; primeiro contato
  perform pg_temp.como((select responsavel_id from public.leads where id = l2), e);
  begin
    update public.leads set status = 'descartado' where id = l2;
    r := r || pg_temp.ok(false, '10 descarte sem motivo');
  exception when others then r := r || pg_temp.ok(true, '10 descarte exige motivo');
  end;
  update public.leads set status = 'em_contato' where id = l2;
  r := r || pg_temp.ok((select primeiro_contato_em from public.leads where id = l2) is not null, '11 primeiro contato registrado ao mudar de etapa');

  -- SLA estourado redistribui
  execute 'reset role';
  update public.leads set sla_ate = now() - interval '1 minute' where id = l1;
  perform public.processar_sla_leads();
  r := r || pg_temp.ok((select redistribuicoes = 1 from public.leads where id = l1)
                       and (select sla_estourado from public.leads where id = l1), '12 SLA estourado marca e redistribui');

  -- conversão
  perform pg_temp.como((select responsavel_id from public.leads where id = l1), e);
  cli := public.converter_lead(l1);
  r := r || pg_temp.ok(cli is not null and (select status from public.leads where id = l1) = 'convertido'
                       and (select origem from public.clientes where id = cli) like 'lead_site%', '13 conversão cria o cliente mantendo a origem');
  perform pg_temp.como(c1, e);
  begin
    perform public.capturar_lead(e, '{"nome":"x","telefone":"85999990009"}', 'site');
    r := r || pg_temp.ok(false, '14 usuário chama a captação direta');
  exception when others then r := r || pg_temp.ok(true, '14 captação direta só pelo servidor');
  end;

  -- ---------------- WhatsApp: número, entrada, roteamento pela carteira
  perform pg_temp.como(master, e);
  insert into public.wa_numeros (nome, numero, phone_number_id, departamento_id, msg_boas_vindas, horario)
  values ('Comercial', '5585988887777', '100200300', v_dep_adm, 'Olá! Recebemos sua mensagem.', '{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"23:59"}') returning id into num;
  insert into public.clientes (nome, whatsapp, consultor_id) values ('Cliente WA', '(85) 97777-1234', c2) returning id into cli;
  execute 'reset role';
  j := public.wa_receber_mensagem(num, '5585977771234', 'Cliente WA', 'wamid.1', 'texto', 'Oi, quero falar com meu consultor', null, null, null, now(), null);
  cv := (j->>'conversa_id')::uuid;
  r := r || pg_temp.ok((select atendente_id from public.wa_conversas where id = cv) = c2, '15 conversa de cliente vai para o dono da carteira');
  r := r || pg_temp.ok(exists (select 1 from public.wa_mensagens where conversa_id = cv and direcao = 'saida' and status = 'pendente'), '16 boas-vindas enfileirada');
  j2 := public.wa_receber_mensagem(num, '5585977771234', 'Cliente WA', 'wamid.1', 'texto', 'Oi, quero falar com meu consultor', null, null, null, now(), null);
  r := r || pg_temp.ok((j2->>'repetida')::boolean and (select count(*) from public.wa_mensagens where conversa_id = cv and direcao = 'entrada') = 1, '17 webhook repetido não duplica a mensagem');
  j := public.wa_receber_mensagem(num, '5585966665555', 'Desconhecido', 'wamid.2', 'texto', 'Quero saber de seguro', null, null, null, now(), null);
  cv2 := (j->>'conversa_id')::uuid;
  r := r || pg_temp.ok(exists (select 1 from public.leads l join public.wa_contatos c on c.lead_id = l.id where c.id = (j->>'contato_id')::uuid and l.origem = 'whatsapp'), '18 número desconhecido vira lead de WhatsApp');

  -- visibilidade
  perform pg_temp.como(c1, e);
  r := r || pg_temp.ok(not exists (select 1 from public.wa_conversas where id = cv) and not exists (select 1 from public.wa_mensagens where conversa_id = cv), '19 consultor não vê conversa da carteira de outro');
  perform pg_temp.como(c2, e);
  r := r || pg_temp.ok(exists (select 1 from public.wa_conversas where id = cv) and exists (select 1 from public.wa_mensagens where conversa_id = cv), '20 dono da carteira vê a conversa e as mensagens');
  perform pg_temp.como(outro, e2);
  r := r || pg_temp.ok(not exists (select 1 from public.wa_conversas where id = cv), '21 outra empresa não vê a conversa');

  -- envio dentro e fora da janela de 24 h
  perform pg_temp.como(c2, e);
  perform public.wa_enviar(cv, 'Olá, tudo bem?');
  r := r || pg_temp.ok((select status from public.wa_conversas where id = cv) = 'aguardando_cliente' and (select primeira_resposta_em from public.wa_conversas where id = cv) is not null, '22 resposta registra primeira resposta');
  execute 'reset role';
  update public.wa_conversas set janela_ate = now() - interval '1 hour' where id = cv;
  perform pg_temp.como(c2, e);
  begin
    perform public.wa_enviar(cv, 'Mensagem livre fora da janela');
    r := r || pg_temp.ok(false, '23 texto livre fora da janela');
  exception when others then r := r || pg_temp.ok(true, '23 fora da janela de 24 h só modelo');
  end;
  perform pg_temp.como(master, e);
  insert into public.wa_modelos (nome, categoria, corpo, variaveis) values ('lembrete_documentos', 'utility', 'Olá {{1}}, faltam documentos.', 1) returning id into md;
  insert into public.wa_modelos (nome, categoria, corpo) values ('promo_mes', 'marketing', 'Oferta do mês!') returning id into mk;
  perform pg_temp.como(c2, e);
  perform public.wa_enviar(cv, null, md, '["Maria"]');
  r := r || pg_temp.ok(exists (select 1 from public.wa_mensagens where conversa_id = cv and tipo = 'modelo' and conteudo = 'Olá Maria, faltam documentos.'), '24 modelo aprovado com variáveis fora da janela');
  begin
    perform public.wa_enviar(cv, null, mk, null);
    r := r || pg_temp.ok(false, '25 marketing sem opt-in');
  exception when others then r := r || pg_temp.ok(true, '25 marketing exige opt-in');
  end;

  -- regra dos 45 dias: conversa vai para o administrativo
  execute 'reset role';
  perform set_config('geeasy.rotina_documentacao', 'on', true);
  update public.clientes set carteira = 'administrativo', responsavel_admin_id = adm where id = cli;
  perform set_config('geeasy.rotina_documentacao', 'off', true);
  r := r || pg_temp.ok((select atendente_id = adm and departamento_id = v_dep_adm from public.wa_conversas where id = cv), '26 transferência da carteira leva a conversa ao administrativo');
  perform pg_temp.como(c2, e);
  r := r || pg_temp.ok(not exists (select 1 from public.wa_conversas where id = cv), '27 consultor deixa de ver a conversa transferida');

  -- desligamento transfere conversas e leads
  execute 'reset role';
  update public.wa_conversas set atendente_id = c1 where id = cv2;
  update public.leads set responsavel_id = c1, status = 'novo' where id = l2;
  perform pg_temp.como(master, e);
  perform public.desligar_membro_destino(c1, c2, 'Teste de desligamento');
  r := r || pg_temp.ok((select atendente_id from public.wa_conversas where id = cv2) = c2 and (select responsavel_id from public.leads where id = l2) = c2, '28 desligamento transfere conversas e leads ao destino');

  -- encerramento e métricas
  perform pg_temp.como(master, e);
  perform public.wa_encerrar(cv2, 'duvida', 'Respondido');
  j := public.wa_metricas(current_date - 1, current_date);
  r := r || pg_temp.ok((j->>'conversas')::int = 2 and (j->'resultados'->>'duvida')::int = 1, '29 métricas por resultado');
  perform pg_temp.como(c2, e);
  begin
    perform public.wa_metricas(current_date - 1, current_date);
    r := r || pg_temp.ok(false, '30 consultor vê métricas gerais');
  exception when others then r := r || pg_temp.ok(true, '30 métricas só para supervisão');
  end;

  -- campanhas respeitam opt-in/opt-out
  perform pg_temp.como(master, e);
  update public.wa_contatos set optin_em = now(), optin_origem = 'teste' where empresa_id = e;
  update public.wa_contatos set optout_em = now() where empresa_id = e and telefone = '5585966665555';
  insert into public.wa_campanhas (nome, numero_id, modelo_id) values ('Campanha teste', num, mk) returning id into camp;
  n := public.wa_preparar_campanha(camp);
  r := r || pg_temp.ok(n = 1, '31 campanha ignora quem pediu descadastro');

  -- descadastro por palavra-chave e formulário público
  execute 'reset role';
  perform public.wa_receber_mensagem(num, '5585977771234', null, 'wamid.3', 'texto', ' Sair ', null, null, null, now(), null);
  r := r || pg_temp.ok((select optout_em is not null from public.wa_contatos where empresa_id = e and telefone = '5585977771234'), '37 "SAIR" registra o descadastro');
  perform pg_temp.como(c1, e);
  begin
    insert into public.lead_formularios (slug, titulo) values ('form-intruso', 'Intruso');
    r := r || pg_temp.ok(false, '38 consultor cria formulário público');
  exception when others then r := r || pg_temp.ok(true, '38 formulário público só com permissão de distribuição');
  end;
  execute 'reset role';
  r := r || pg_temp.ok(public.rate_limit_publico('teste-ip', 2, 60) and public.rate_limit_publico('teste-ip', 2, 60) and not public.rate_limit_publico('teste-ip', 2, 60), '39 limite por IP nos endpoints públicos');

  -- parâmetros do módulo gravados por quem distribui (não só o admin); abrir conversa pela ficha
  perform pg_temp.como(adm, e);
  insert into public.configuracoes (chave, valor) values ('leads', '{"sla_minutos":20}') on conflict (empresa_id, chave) do update set valor = excluded.valor;
  r := r || pg_temp.ok((select (valor->>'sla_minutos')::int = 20 from public.configuracoes where empresa_id = e and chave = 'leads'), '40 parâmetros de leads gravados por quem distribui');
  begin
    insert into public.configuracoes (chave, valor) values ('empresa', '{"nome":"Invasor"}') on conflict (empresa_id, chave) do update set valor = excluded.valor;
    r := r || pg_temp.ok(false, '41 não-admin grava dados da empresa');
  exception when others then r := r || pg_temp.ok(true, '41 dados da empresa continuam só com o admin');
  end;
  perform pg_temp.como(master, e);
  r := r || pg_temp.ok(public.wa_abrir_conversa_cliente(cli) is not null, '42 conversa aberta a partir da ficha do cliente');

  -- fila de webhooks: idempotente e reserva com bloqueio
  execute 'reset role';
  insert into public.webhook_eventos (origem, externo_id, payload) values ('whatsapp', 'evt-1', '{}') returning id into ev;
  insert into public.webhook_eventos (origem, externo_id, payload) values ('whatsapp', 'evt-1', '{}') on conflict do nothing;
  r := r || pg_temp.ok((select count(*) from public.webhook_eventos where externo_id = 'evt-1') = 1, '32 evento repetido não entra duas vezes');
  r := r || pg_temp.ok((select count(*) from public.reservar_eventos('whatsapp', 10)) = 1 and (select count(*) from public.reservar_eventos('whatsapp', 10)) = 0, '33 evento reservado não é entregue duas vezes');
  perform public.concluir_evento(ev, false, 'falha simulada');
  r := r || pg_temp.ok((select status = 'erro' and proximo_em > now() from public.webhook_eventos where id = ev), '34 falha agenda nova tentativa');
  perform pg_temp.como(master, e);
  begin
    perform 1 from public.webhook_eventos limit 1;
    r := r || pg_temp.ok(false, '35 usuário lê a fila de webhooks');
  exception when others then r := r || pg_temp.ok(true, '35 fila de webhooks só para o servidor');
  end;
  begin
    perform 1 from public.wa_credenciais limit 1;
    r := r || pg_temp.ok(false, '36 usuário lê o token da Meta');
  exception when others then r := r || pg_temp.ok(true, '36 token da Meta só para o servidor');
  end;

  execute 'reset role';
  raise exception '%', case when r like '%FALHOU%' then 'RESULTADO: FALHOU' else 'RESULTADO: OK' end || r;
end $$;
