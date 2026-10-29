create or replace function public.limpar_rate_limit_login(p_hash text)
returns void language sql security definer set search_path = '' as $$
  update public.rate_limits set contador = 0 where chave = 'login:' || p_hash and p_hash ~ '^[0-9a-f]{64}$';
$$;
revoke execute on function public.limpar_rate_limit_login(text) from public, anon;
grant execute on function public.limpar_rate_limit_login(text) to authenticated;

-- ---------------------------------------------------------------------
-- Segurança: trilha de acesso (downloads, exportações, login, LGPD)
-- ---------------------------------------------------------------------
create or replace function public.registrar_acesso(p_acao text, p_tabela text, p_registro text, p_detalhes jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if p_acao not in ('LOGIN', 'LOGOUT', 'LOGOUT_GLOBAL', 'DOWNLOAD', 'EXPORTACAO', 'VISUALIZACAO_SIGILOSA', 'LGPD_EXPORTACAO', 'LGPD_ANONIMIZACAO', 'INTEGRACAO') then
    raise exception 'ação de auditoria inválida';
  end if;
  insert into public.audit_logs (actor_id, actor_email, acao, tabela, registro_id, dados_novos)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), p_acao, left(p_tabela, 60), left(p_registro, 100),
          case when pg_column_size(p_detalhes) < 4000 then p_detalhes end);
end $$;
revoke execute on function public.registrar_acesso(text, text, text, jsonb) from public, anon;
grant execute on function public.registrar_acesso(text, text, text, jsonb) to authenticated;

-- Auditoria sem ruído: ignora atualizações que só mexem em campos técnicos de sincronização
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_id text := coalesce(v_new->>'id', v_old->>'id', v_new->>'user_id', v_old->>'user_id', v_new->>'chave');
  v_tecnicos text[] := array['updated_at', 'datajud_sincronizado_em', 'datajud_atualizado_em', 'datajud_status', 'datajud_erro',
    'drive_folder_id', 'drive_file_id', 'drive_url', 'drive_status', 'drive_erro', 'drive_tentativas', 'drive_sincronizado_em', 'google_event_id'];
begin
  -- nunca registrar segredos
  v_old := v_old - 'access_token_enc' - 'refresh_token_enc';
  v_new := v_new - 'access_token_enc' - 'refresh_token_enc';
  if tg_op = 'UPDATE' and (v_old - v_tecnicos) = (v_new - v_tecnicos) then
    return new;
  end if;
  insert into public.audit_logs (actor_id, actor_email, acao, tabela, registro_id, dados_antigos, dados_novos)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), tg_op, tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- LGPD: anonimização do titular (art. 16 / 18, IV e VI)
-- Só administradores; bloqueada se houver processo ativo ou contrato vigente.
-- ---------------------------------------------------------------------
create or replace function public.anonimizar_cliente(p_cliente uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_rotulo text := 'Titular anonimizado ' || upper(substr(md5(p_cliente::text || clock_timestamp()::text), 1, 8));
begin
  if not public.is_admin() then raise exception 'Somente administradores podem anonimizar titulares.'; end if;
  if exists (select 1 from public.processos where cliente_id = p_cliente and status in ('ativo', 'suspenso')) then
    raise exception 'Há processos ativos deste cliente: encerre-os antes (guarda obrigatória dos dados).';
  end if;
  if exists (select 1 from public.contratos_honorarios where cliente_id = p_cliente and status = 'ativo') then
    raise exception 'Há contrato de honorários ativo deste cliente.';
  end if;
  update public.clientes set
    nome = v_rotulo, documento = null, rg = null, data_nascimento = null, email = null, telefone = null, whatsapp = null,
    cep = null, endereco = null, numero = null, complemento = null, bairro = null, profissao = null, renda_mensal = null,
    observacoes = null, tags = '{}', status = 'inativo'
  where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  update public.atendimentos set nome_contato = v_rotulo, telefone = null, email = null, relato = null where cliente_id = p_cliente;
  update public.interacoes set descricao = '[conteúdo removido — anonimização LGPD]' where cliente_id = p_cliente;
  return v_rotulo;
end $$;
revoke execute on function public.anonimizar_cliente(uuid) from public, anon;
grant execute on function public.anonimizar_cliente(uuid) to authenticated;

-- Retenção de dados técnicos (rate_limits, integracoes_log, notificações lidas):
-- executada pela rotina /api/cron/sincronizar (tarefa "limpeza") com o service role.

-- ---------------------------------------------------------------------
-- Agendador: chama o endpoint de sincronização da aplicação (pg_net).
-- URL e segredo ficam no Vault (nomes geeasy_site_url / geeasy_cron_secret).
-- ---------------------------------------------------------------------
create or replace function public.disparar_sincronizacao(p_tarefa text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'geeasy_site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'geeasy_cron_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '/api/cron/sincronizar?tarefa=' || p_tarefa,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke execute on function public.disparar_sincronizacao(text) from public, anon, authenticated;

select cron.schedule('geeasy-datajud', '15 * * * *', $$select public.disparar_sincronizacao('datajud')$$);
select cron.schedule('geeasy-djen', '5 10,15,21 * * *', $$select public.disparar_sincronizacao('djen')$$);
select cron.schedule('geeasy-drive-agenda', '40 * * * *', $$select public.disparar_sincronizacao('drive,agenda')$$);
select cron.schedule('geeasy-limpeza', '30 6 * * *', $$select public.disparar_sincronizacao('limpeza')$$);
