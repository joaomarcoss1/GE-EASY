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

