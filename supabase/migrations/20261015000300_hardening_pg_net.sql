-- pg_net: as permissões do schema "net" são concedidas pelo supabase_admin (padrão da plataforma)
-- e não podem ser revogadas pelo papel postgres. O schema "net" NÃO é exposto pela API REST
-- (somente "public"), então usuários não conseguem chamá-lo; só a função SECURITY DEFINER
-- disparar_sincronizacao (sem EXECUTE para anon/authenticated) faz requisições.
revoke execute on all functions in schema net from anon, authenticated, public; -- melhor esforço (sem efeito sobre grants do supabase_admin)
comment on function public.rate_limit_login(text, boolean) is 'Intencionalmente executável por anon: verificação de tentativas de login antes da autenticação. A chave é um HMAC calculado no servidor (não é possível bloquear terceiros).';
