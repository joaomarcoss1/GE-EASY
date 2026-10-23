-- =====================================================================
-- GE EASY — Fase 4: app de campo (PWA offline) — suporte no banco
--
-- * sincronização do aparelho (telemetria, revogação remota, versão mínima do app);
-- * notificações push (Web Push) a partir das notificações do sistema;
-- * cache de geocodificação por empresa (custo de mapas);
-- * tempo real (Realtime) para check-ins, rotas e notificações, sempre filtrado pelo RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sincronização do aparelho
-- ---------------------------------------------------------------------
-- Registra/atualiza o aparelho e informa se foi revogado (o app apaga os dados locais) e a versão mínima.
create or replace function public.sincronizar_dispositivo(p_id uuid, p_nome text, p_plataforma text, p_versao text, p_fila int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); d public.dispositivos; v_min text;
begin
  if auth.uid() is null or v_emp is null then return jsonb_build_object('revogado', true, 'motivo', 'sem_acesso'); end if;
  select * into d from public.dispositivos where id = p_id;
  if found and (d.user_id <> auth.uid() or d.empresa_id <> v_emp) then
    return jsonb_build_object('revogado', true, 'motivo', 'aparelho_de_outro_usuario');
  end if;
  if found and d.revogado_em is not null then
    return jsonb_build_object('revogado', true, 'motivo', 'revogado');
  end if;
  if not found then
    insert into public.dispositivos (id, empresa_id, user_id, nome, plataforma, app_versao, fila_pendente, ultimo_sync_em)
    values (p_id, v_emp, auth.uid(), left(p_nome, 120), left(p_plataforma, 120), left(p_versao, 30), greatest(coalesce(p_fila, 0), 0), now());
  else
    update public.dispositivos set nome = left(p_nome, 120), plataforma = left(p_plataforma, 120), app_versao = left(p_versao, 30),
           fila_pendente = greatest(coalesce(p_fila, 0), 0), ultimo_sync_em = now()
     where id = p_id;
  end if;
  select c.valor->>'versao_minima' into v_min from public.configuracoes c where c.empresa_id = v_emp and c.chave = 'app';
  return jsonb_build_object('revogado', false, 'versao_minima', v_min);
end $$;
revoke execute on function public.sincronizar_dispositivo(uuid, text, text, text, int) from public, anon;
grant execute on function public.sincronizar_dispositivo(uuid, text, text, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- Push (Web Push / VAPID)
-- ---------------------------------------------------------------------
create table public.push_assinaturas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  dispositivo_id uuid references public.dispositivos(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  ativo boolean not null default true,
  falhas int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.push_assinaturas (empresa_id, user_id) where ativo;
create trigger zz_empresa_vinculos before insert or update on public.push_assinaturas
  for each row execute function public.empresa_vinculos('user_id:@', 'dispositivo_id:dispositivos');
alter table public.push_assinaturas enable row level security;
create policy push_select on public.push_assinaturas for select to authenticated using (user_id = (select auth.uid()));
create policy push_insert on public.push_assinaturas for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_update on public.push_assinaturas for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_delete on public.push_assinaturas for delete to authenticated using (user_id = (select auth.uid()));
create policy push_assinaturas_empresa on public.push_assinaturas as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
revoke all on public.push_assinaturas from anon;

alter table public.notificacoes
  add column if not exists push_enviado_em timestamptz,
  add column if not exists push_tentativas int not null default 0;
create index if not exists notificacoes_push_fila on public.notificacoes (created_at) where push_enviado_em is null and push_tentativas < 3;

select cron.schedule('geeasy-push', '* * * * *', $$select public.disparar_sincronizacao('push')$$);

-- ---------------------------------------------------------------------
-- Cache de geocodificação (por empresa: só o hash do endereço e as coordenadas)
-- ---------------------------------------------------------------------
create table public.geocodificacoes (
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  chave text not null check (chave ~ '^[0-9a-f]{64}$'),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  fonte text not null check (char_length(fonte) <= 40),
  created_at timestamptz not null default now(),
  primary key (empresa_id, chave)
);
alter table public.geocodificacoes enable row level security;
create policy geocod_select on public.geocodificacoes for select to authenticated using ((select public.is_active_user()));
create policy geocod_insert on public.geocodificacoes for insert to authenticated with check ((select public.is_active_user()));
create policy geocod_update on public.geocodificacoes for update to authenticated using ((select public.is_active_user()));
create policy geocodificacoes_empresa on public.geocodificacoes as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
revoke all on public.geocodificacoes from anon;

-- ---------------------------------------------------------------------
-- Tempo real (mapa do campo, notificações): o Realtime respeita o RLS de cada tabela
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['checkins', 'rotas', 'notificacoes'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
