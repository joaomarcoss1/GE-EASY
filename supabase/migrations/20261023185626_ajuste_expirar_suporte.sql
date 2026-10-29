create or replace function public.expirar_suporte()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform set_config('geeasy.suporte', 'on', true);
  update public.empresa_membros set ativo = false where suporte_ate is not null and suporte_ate < now() and ativo;
  get diagnostics n = row_count;
  perform set_config('geeasy.suporte', 'off', true);
  update public.acessos_suporte set status = 'expirado', encerrado_em = now() where status = 'ativo' and expira_em < now();
  return n;
end $$;
revoke execute on function public.solicitar_suporte(uuid, text), public.decidir_suporte(uuid, boolean, int), public.encerrar_suporte(uuid) from public, anon;
grant execute on function public.solicitar_suporte(uuid, text), public.decidir_suporte(uuid, boolean, int), public.encerrar_suporte(uuid) to authenticated;
revoke execute on function public.expirar_suporte() from public, anon, authenticated;
select cron.schedule('geeasy-suporte', '*/15 * * * *', $$select public.expirar_suporte()$$);

-- vínculo de suporte não conta no limite de usuários, não vira funcionário e só é mexido pelas funções de suporte
create or replace function public.protect_empresa_membros()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limite int;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then raise exception 'Vínculos não são excluídos: desative o acesso.' using errcode = '42501'; end if;
    return old;
  end if;
  if coalesce(current_setting('geeasy.suporte', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and old.suporte_ate is not null and auth.uid() is not null and not public.is_plataforma_admin() and (new.ativo and not old.ativo or new.suporte_ate is distinct from old.suporte_ate) then
    raise exception 'Acesso de suporte só pelo pedido autorizado.' using errcode = '42501';
  end if;
  if new.suporte_ate is not null and (tg_op = 'INSERT' or old.suporte_ate is null) and not public.is_plataforma_admin() and auth.uid() is not null then
    raise exception 'Acesso de suporte só pelo pedido autorizado.' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or (new.ativo and not old.ativo)) and new.suporte_ate is null then
    select nullif(e.limites->>'max_usuarios', '')::int into v_limite from public.empresas e where e.id = new.empresa_id;
    if v_limite is not null and (select count(*) from public.empresa_membros m where m.empresa_id = new.empresa_id and m.ativo and m.suporte_ate is null and m.user_id <> new.user_id) >= v_limite then
      raise exception 'Limite de usuários do plano atingido (%).', v_limite using errcode = '42501';
    end if;
  end if;
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if (new.admin_master or new.role in ('admin', 'gestor')) and not public.is_admin_master() then
      raise exception 'Somente o administrador master concede perfis de gestão' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.empresa_id <> old.empresa_id or new.user_id <> old.user_id then
    raise exception 'Vínculo não pode mudar de empresa ou de usuário' using errcode = '42501';
  end if;
  if (new.role, new.ativo, new.admin_master) is not distinct from (old.role, old.ativo, old.admin_master) then
    return new;
  end if;
  if old.user_id = auth.uid() then
    raise exception 'Você não pode alterar o seu próprio acesso' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = old.user_id and p.is_master) then
    raise exception 'O administrador master da plataforma não pode ser alterado por outros usuários' using errcode = '42501';
  end if;
  if not public.is_admin_master() and (
       new.admin_master is distinct from old.admin_master or new.role is distinct from old.role and (new.role in ('admin', 'gestor') or old.role in ('admin', 'gestor'))
       or old.admin_master or old.role in ('admin', 'gestor')) then
    raise exception 'Somente o administrador master altera perfis de gestão' using errcode = '42501';
  end if;
  if old.admin_master and old.ativo and (not new.admin_master or not new.ativo) and not exists (
    select 1 from public.empresa_membros m where m.empresa_id = old.empresa_id and m.user_id <> old.user_id and m.ativo and m.admin_master) then
    raise exception 'A empresa precisa de pelo menos um administrador master ativo' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.membro_funcionario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.suporte_ate is not null then return new; end if;
  if tg_op = 'INSERT' and new.ativo then
    insert into public.funcionarios (empresa_id, user_id, nome, cargo, email)
    select new.empresa_id, new.user_id, left(coalesce(nullif(p.full_name, ''), p.email, 'Funcionário'), 200), p.cargo, p.email from public.profiles p where p.id = new.user_id
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.ativo and not new.ativo then
    update public.funcionarios set status = 'desligado', desligamento = coalesce(desligamento, current_date)
     where empresa_id = new.empresa_id and user_id = new.user_id and status <> 'desligado';
  elsif tg_op = 'UPDATE' and not old.ativo and new.ativo then
    update public.funcionarios set status = 'ativo', desligamento = null where empresa_id = new.empresa_id and user_id = new.user_id and status = 'desligado';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Marca (logos públicos, só imagens raster; o upload passa pelo servidor)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('marcas', 'marcas', true) on conflict (id) do nothing;

-- servidor: remove os arquivos e anonimiza as empresas com exclusão vencida (diariamente)
select cron.schedule('geeasy-exclusoes', '30 5 * * *', $$select public.disparar_sincronizacao('exclusoes')$$);
