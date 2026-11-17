-- Visão de membros da empresa ativa com o nome de usuário (login sem e-mail)
create or replace view public.membros with (security_invoker = true) as
 SELECT p.id, p.full_name, p.email, p.phone, m.role, m.ativo AND p.active AS active, p.avatar_url, p.cargo, p.territorio,
    p.comissao_percentual, p.is_master, p.oab, p.created_at, m.admin_master, m.empresa_id, p.usuario
   FROM public.empresa_membros m
     JOIN public.profiles p ON p.id = m.user_id
  WHERE m.empresa_id = public.empresa_atual();
