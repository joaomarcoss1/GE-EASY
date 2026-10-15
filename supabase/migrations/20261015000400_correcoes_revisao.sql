-- =====================================================================
-- Correções da revisão de segurança/correção das integrações
-- =====================================================================

-- 1) Publicação sem processo cadastrado não pode perder o responsável (SELECT INTO zera os campos sem linha)
create or replace function public.publicacao_vincular()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dig text; v_proc uuid; v_resp uuid;
begin
  if new.processo_id is null and new.numero_processo is not null then
    v_dig := regexp_replace(new.numero_processo, '\D', '', 'g');
    if length(v_dig) = 20 then
      select p.id, p.responsavel_id into v_proc, v_resp
        from public.processos p where regexp_replace(coalesce(p.numero_cnj, ''), '\D', '', 'g') = v_dig limit 1;
      if found then
        new.processo_id := v_proc;
        new.responsavel_id := coalesce(new.responsavel_id, v_resp);
      end if;
    end if;
  end if;
  if new.status in ('tratada', 'descartada') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.tratado_por := coalesce(new.tratado_por, auth.uid());
    new.tratado_em := coalesce(new.tratado_em, now());
  elsif new.status = 'nova' then
    new.tratado_por := null; new.tratado_em := null;
  end if;
  return new;
end $$;

create or replace function public.publicacao_andamento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.processo_id is not null and (tg_op = 'INSERT' or old.processo_id is distinct from new.processo_id) then
    insert into public.processo_andamentos (processo_id, data, tipo, descricao, autor_id, origem)
    values (new.processo_id, new.data_publicacao, 'publicacao', left(new.conteudo, 10000), auth.uid(), 'publicacao');
  end if;
  return new;
end $$;

-- 2) Documentos: o caminho no Storage precisa pertencer ao cliente/processo da linha; usuários não
--    alteram caminho, vínculo nem campos do Drive (somente o servidor com service role).
--    Documento de processo não leva cliente_id (o acesso segue o processo, não a carteira do cliente).
create or replace function public.documentos_integridade()
returns trigger language plpgsql set search_path = '' as $$
declare v_servidor boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
begin
  if tg_op = 'INSERT' then
    if new.processo_id is not null then new.cliente_id := null; end if;
    if new.storage_path is not null and not (
         (new.processo_id is not null and new.storage_path like 'processos/' || new.processo_id::text || '/%')
      or (new.processo_id is null and new.cliente_id is not null and new.storage_path like 'clientes/' || new.cliente_id::text || '/%')
    ) then
      raise exception 'Caminho do arquivo incompatível com o cliente/processo do documento.' using errcode = '42501';
    end if;
    if not v_servidor then
      new.drive_file_id := null; new.drive_url := null; new.drive_status := 'pendente';
      new.drive_erro := null; new.drive_tentativas := 0; new.drive_sincronizado_em := null; new.drive_bloqueado_ate := null;
    end if;
  elsif not v_servidor then
    new.storage_path := old.storage_path; new.cliente_id := old.cliente_id; new.processo_id := old.processo_id;
    new.mime_type := old.mime_type; new.tamanho := old.tamanho; new.enviado_por := old.enviado_por;
    new.drive_file_id := old.drive_file_id; new.drive_url := old.drive_url; new.drive_status := old.drive_status;
    new.drive_erro := old.drive_erro; new.drive_tentativas := old.drive_tentativas;
    new.drive_sincronizado_em := old.drive_sincronizado_em; new.drive_bloqueado_ate := old.drive_bloqueado_ate;
  end if;
  return new;
end $$;

alter table public.documentos add column if not exists drive_bloqueado_ate timestamptz;
create trigger trg_documentos_integridade before insert or update on public.documentos
  for each row execute function public.documentos_integridade();

-- Documento de processo: visível só para quem acessa o processo
alter policy documentos_select on public.documentos
  using (
    case when processo_id is not null then public.can_access_processo(processo_id)
         else public.is_backoffice() or (cliente_id is not null and public.can_access_cliente(cliente_id)) end
  );

-- 3) RPCs: limites contra abuso
create or replace function public.registrar_integracao(p_tipo text, p_status text, p_mensagem text, p_detalhes jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_user() then return; end if;
  if p_tipo not in ('datajud', 'djen', 'drive', 'agenda') or p_status not in ('ok', 'erro', 'parcial') then return; end if;
  if not public._rate_limit('log:' || auth.uid(), 120, 3600) then return; end if;
  insert into public.integracoes_log (tipo, status, mensagem, detalhes, user_id)
  values (p_tipo, p_status, left(p_mensagem, 1000), case when pg_column_size(p_detalhes) < 8000 then p_detalhes end, auth.uid());
end $$;

create or replace function public.notificar_movimentacoes(p_processo uuid, p_qtd int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_proc record; v_user uuid;
begin
  if p_qtd is null or p_qtd <= 0 or not public.can_edit_processo(p_processo) then return; end if;
  if not public._rate_limit('notif:' || auth.uid() || ':' || p_processo, 6, 3600) then return; end if;
  select id, titulo, responsavel_id, equipe into v_proc from public.processos where id = p_processo;
  if not found then return; end if;
  for v_user in select distinct u from unnest(array_append(v_proc.equipe, v_proc.responsavel_id)) u where u is not null and u <> auth.uid() loop
    insert into public.notificacoes (user_id, titulo, mensagem, link)
    values (v_user, 'Novas movimentações no processo', left(least(p_qtd, 100000) || ' movimentação(ões) do DataJud em ' || v_proc.titulo, 300), '/processos/' || p_processo);
  end loop;
end $$;

-- 4) Login: contagem ATÔMICA antes de testar a senha (vale para tentativas paralelas).
--    Teto global contra inundação da tabela por chamadas anônimas com chaves aleatórias.
create or replace function public.tentativa_login(p_hash text, p_max int)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  if not exists (select 1 from public.rate_limits where chave = 'login:' || p_hash)
     and (select count(*) from public.rate_limits where chave like 'login:%' and janela_inicio > now() - interval '1 minute') > 5000 then
    return false;
  end if;
  return public._rate_limit('login:' || p_hash, greatest(1, least(p_max, 50)), 900);
end $$;
revoke execute on function public.tentativa_login(text, int) from public;
grant execute on function public.tentativa_login(text, int) to anon, authenticated;
comment on function public.tentativa_login(text, int) is 'Intencionalmente executável por anon (antes do login). Chave = HMAC calculado no servidor.';

-- a versão anterior deixa de ser usada
revoke execute on function public.rate_limit_login(text, boolean) from anon, authenticated;
