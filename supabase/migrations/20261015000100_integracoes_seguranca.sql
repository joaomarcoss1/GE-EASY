-- =====================================================================
-- GE EASY — Integrações jurídicas (DataJud, DJEN, Google Agenda, Drive)
-- e camada adicional de segurança / proteção de dados (LGPD)
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Processos: monitoramento DataJud e pasta no Drive
-- ---------------------------------------------------------------------
alter table public.processos
  add column if not exists datajud_monitorar boolean not null default true,
  add column if not exists datajud_sincronizado_em timestamptz,
  add column if not exists datajud_atualizado_em timestamptz,
  add column if not exists datajud_status text check (datajud_status is null or datajud_status in ('ok', 'nao_encontrado', 'erro', 'indisponivel')),
  add column if not exists datajud_erro text,
  add column if not exists drive_folder_id text;
create index if not exists processos_datajud_fila on public.processos (datajud_sincronizado_em nulls first)
  where datajud_monitorar and numero_cnj is not null;

-- Andamentos: origem + id externo (não duplica movimentos do DataJud)
alter table public.processo_andamentos
  add column if not exists origem text not null default 'manual' check (origem in ('manual', 'sistema', 'datajud', 'publicacao')),
  add column if not exists externo_id text,
  add column if not exists data_hora timestamptz;
create unique index if not exists processo_andamentos_externo_uniq on public.processo_andamentos (processo_id, externo_id) where externo_id is not null;

-- Prazos: evento no Google Agenda do responsável
alter table public.prazos add column if not exists google_event_id text;

-- Publicações: dados de origem do DJEN
alter table public.publicacoes
  add column if not exists origem text not null default 'manual' check (origem in ('manual', 'djen')),
  add column if not exists tribunal text,
  add column if not exists orgao text,
  add column if not exists tipo_comunicacao text,
  add column if not exists link text,
  add column if not exists oab text;

-- Documentos: estado do arquivamento no Drive do escritório
alter table public.documentos
  add column if not exists drive_status text not null default 'pendente' check (drive_status in ('pendente', 'sincronizado', 'erro', 'ignorado')),
  add column if not exists drive_erro text,
  add column if not exists drive_tentativas int not null default 0,
  add column if not exists drive_sincronizado_em timestamptz;
create index if not exists documentos_drive_fila on public.documentos (created_at) where drive_status in ('pendente', 'erro');

-- Cache das pastas do Drive (chave lógica -> id da pasta). Só o service role usa.
create table if not exists public.drive_pastas (
  chave text primary key check (char_length(chave) <= 200),
  folder_id text not null,
  created_at timestamptz not null default now()
);
alter table public.drive_pastas enable row level security;
create policy drive_pastas_select on public.drive_pastas for select to authenticated using (public.is_admin());

-- Registro das execuções de integração (painel do administrador)
create table if not exists public.integracoes_log (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('datajud', 'djen', 'drive', 'agenda', 'cron')),
  status text not null check (status in ('ok', 'erro', 'parcial')),
  mensagem text check (char_length(mensagem) <= 1000),
  detalhes jsonb,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists integracoes_log_recentes on public.integracoes_log (created_at desc);
alter table public.integracoes_log enable row level security;
create policy integracoes_log_select on public.integracoes_log for select to authenticated using (public.is_manager());

create or replace function public.registrar_integracao(p_tipo text, p_status text, p_mensagem text, p_detalhes jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_user() then return; end if;
  if p_tipo not in ('datajud', 'djen', 'drive', 'agenda') or p_status not in ('ok', 'erro', 'parcial') then return; end if;
  insert into public.integracoes_log (tipo, status, mensagem, detalhes, user_id)
  values (p_tipo, p_status, left(p_mensagem, 1000), case when pg_column_size(p_detalhes) < 8000 then p_detalhes end, auth.uid());
end $$;
revoke execute on function public.registrar_integracao(text, text, text, jsonb) from public, anon;
grant execute on function public.registrar_integracao(text, text, text, jsonb) to authenticated;

-- Notifica responsável e equipe quando chegam movimentações (chamado após a sincronização manual)
create or replace function public.notificar_movimentacoes(p_processo uuid, p_qtd int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_proc record; v_user uuid;
begin
  if p_qtd is null or p_qtd <= 0 or not public.can_access_processo(p_processo) then return; end if;
  select id, titulo, responsavel_id, equipe into v_proc from public.processos where id = p_processo;
  if not found then return; end if;
  for v_user in select distinct u from unnest(array_append(v_proc.equipe, v_proc.responsavel_id)) u where u is not null and u <> auth.uid() loop
    insert into public.notificacoes (user_id, titulo, mensagem, link)
    values (v_user, 'Novas movimentações no processo', left(p_qtd || ' movimentação(ões) do DataJud em ' || v_proc.titulo, 300), '/processos/' || p_processo);
  end loop;
end $$;
revoke execute on function public.notificar_movimentacoes(uuid, int) from public, anon;
grant execute on function public.notificar_movimentacoes(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- Segurança: limitador de requisições persistente (vale entre instâncias)
-- ---------------------------------------------------------------------
create table if not exists public.rate_limits (
  chave text primary key check (char_length(chave) <= 200),
  janela_inicio timestamptz not null default now(),
  contador int not null default 0
);
alter table public.rate_limits enable row level security; -- sem políticas: acesso só pelas funções abaixo

create or replace function public._rate_limit(p_chave text, p_max int, p_janela_seg int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.rate_limits as r (chave, janela_inicio, contador) values (p_chave, now(), 1)
  on conflict (chave) do update set
    contador = case when r.janela_inicio < now() - make_interval(secs => p_janela_seg) then 1 else r.contador + 1 end,
    janela_inicio = case when r.janela_inicio < now() - make_interval(secs => p_janela_seg) then now() else r.janela_inicio end
  returning contador into v_count;
  return v_count <= p_max;
end $$;
revoke execute on function public._rate_limit(text, int, int) from public, anon, authenticated;

-- Usuário autenticado: a chave sempre inclui o próprio id (não dá para bloquear outra pessoa)
create or replace function public.rate_limit(p_acao text, p_max int, p_janela_seg int)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return public._rate_limit('u:' || auth.uid() || ':' || left(p_acao, 60), greatest(1, least(p_max, 10000)), greatest(1, least(p_janela_seg, 86400)));
end $$;
revoke execute on function public.rate_limit(text, int, int) from public, anon;
grant execute on function public.rate_limit(text, int, int) to authenticated;

-- Login: chave = hash(ip + e-mail) calculado no servidor (não guarda o e-mail em claro)
create or replace function public.rate_limit_login(p_hash text, p_registrar_falha boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.rate_limits;
begin
  if p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  if p_registrar_falha then
    perform public._rate_limit('login:' || p_hash, 5, 900);
    return true;
  end if;
  select * into v_row from public.rate_limits where chave = 'login:' || p_hash;
  return not found or v_row.janela_inicio < now() - interval '15 minutes' or v_row.contador < 5;
end $$;
revoke execute on function public.rate_limit_login(text, boolean) from public;
grant execute on function public.rate_limit_login(text, boolean) to anon, authenticated;

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
