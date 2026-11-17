-- Login por nome de usuário (sem e-mail): funcionários e assessores do app de campo.
-- A conta usa um e-mail técnico <usuario>@usuarios.geeasy.invalid (domínio reservado, nunca recebe mensagens).
alter table public.profiles add column usuario text check (usuario ~ '^[a-z0-9][a-z0-9._]{2,29}$');
create unique index profiles_usuario_key on public.profiles (usuario) where usuario is not null;

-- Só o servidor (service role, depois de autorizar a gestão) define o nome de usuário
create or replace function public.profiles_proteger_usuario()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and new.usuario is distinct from old.usuario then
    raise exception 'O nome de usuário é definido pela gestão.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_usuario before update of usuario on public.profiles
  for each row execute function public.profiles_proteger_usuario();
