-- Admin master: conta proprietária do sistema. Nenhum outro usuário (nem outro admin)
-- pode rebaixar, desativar, alterar a comissão/e-mail ou retirar o status de master dela.
-- O flag is_master só pode ser definido pelo service role / migrações (auth.uid() nulo).
alter table public.profiles add column if not exists is_master boolean not null default false;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new; -- service role / migrações
  end if;
  if new.is_master is distinct from old.is_master then
    raise exception 'O status de administrador master não pode ser alterado pelo sistema' using errcode = '42501';
  end if;
  if old.is_master and auth.uid() <> old.id and (
       new.role is distinct from old.role or new.active is distinct from old.active
       or new.email is distinct from old.email or new.comissao_percentual is distinct from old.comissao_percentual) then
    raise exception 'O administrador master não pode ser alterado por outros usuários' using errcode = '42501';
  end if;
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.comissao_percentual is distinct from old.comissao_percentual
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'Sem permissão para alterar papel, status, e-mail ou comissão' using errcode = '42501';
    end if;
  end if;
  if new.id = auth.uid() and old.role = 'admin' and (new.role <> 'admin' or not new.active) then
    raise exception 'Você não pode remover seu próprio acesso de administrador' using errcode = '42501';
  end if;
  return new;
end $$;

update public.profiles set is_master = true, role = 'admin', active = true
 where email = 'joaomarcosgpp@hotmail.com';
