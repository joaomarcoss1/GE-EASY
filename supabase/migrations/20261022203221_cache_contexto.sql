-- =====================================================================
-- GE EASY — Desempenho: contexto da requisição calculado uma vez por transação
--
-- As funções de autorização (empresa_atual, has_role, tem_permissao...) são chamadas linha a linha
-- pelas políticas RLS. O contexto (empresa, papel, master, permissões) passa a ser calculado uma vez
-- e guardado em parâmetros LOCAIS da transação (somem no fim da requisição). A chave inclui o usuário,
-- os cabeçalhos e uma versão que é incrementada sempre que vínculos/permissões mudam na transação.
-- =====================================================================

-- VOLATILE de propósito: uma função STABLE pode ser avaliada pelo planejador (estimativa) com um snapshot
-- anterior às gravações da própria transação e o cache guardaria um contexto velho. Volátil, cada consulta
-- interna usa snapshot novo; o custo por linha continua baixo porque o acerto do cache não executa SQL.
create or replace function public._contexto()
returns text[] language plpgsql volatile security definer set search_path = '' as $$
declare
  v_jwt text := coalesce(current_setting('request.jwt.claims', true), '');
  v_hdr text := coalesce(current_setting('request.headers', true), '');
  v_ver text := coalesce(current_setting('geeasy.ctx_versao', true), '0');
  v_uid uuid;
  v_id uuid;
  v_txt text;
  v_role text;
  v_master boolean;
  v_perms text := ',';
begin
  -- acerto do cache: só comparações de texto (sem SQL, sem parse de JSON)
  if current_setting('geeasy.ctx_jwt', true) = v_jwt and current_setting('geeasy.ctx_hdr', true) = v_hdr
     and current_setting('geeasy.ctx_ver', true) = v_ver then
    return array[nullif(current_setting('geeasy.ctx_empresa', true), ''), nullif(current_setting('geeasy.ctx_papel', true), ''),
                 nullif(current_setting('geeasy.ctx_master', true), ''), coalesce(current_setting('geeasy.ctx_perms', true), ',')];
  end if;
  v_uid := auth.uid();
  if v_uid is null then return array[null, null, null, ',']::text[]; end if;

  begin
    v_txt := nullif(v_hdr, '')::json ->> 'x-empresa-id';
  exception when others then
    v_txt := 'invalido';
  end;
  if v_txt is not null then
    if v_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id := v_txt::uuid; end if;
  else
    select p.empresa_padrao_id into v_id from public.profiles p where p.id = v_uid;
  end if;

  if v_id is not null then
    select m.role::text, m.admin_master into v_role, v_master
      from public.empresa_membros m
      join public.empresas e on e.id = m.empresa_id
      join public.profiles p on p.id = m.user_id
     where m.empresa_id = v_id and m.user_id = v_uid and m.ativo and p.active and e.status in ('trial', 'ativa');
    if not found then
      v_id := null;
    else
      v_perms := ',' || coalesce((select string_agg(x, ',') from public.permissoes_de(v_uid, v_id) x), '') || ',';
    end if;
  end if;

  perform set_config('geeasy.ctx_jwt', v_jwt, true);
  perform set_config('geeasy.ctx_hdr', v_hdr, true);
  perform set_config('geeasy.ctx_ver', v_ver, true);
  perform set_config('geeasy.ctx_empresa', coalesce(v_id::text, ''), true);
  perform set_config('geeasy.ctx_papel', coalesce(v_role, ''), true);
  perform set_config('geeasy.ctx_master', coalesce(v_master::text, ''), true);
  perform set_config('geeasy.ctx_perms', v_perms, true);
  return array[v_id::text, v_role, v_master::text, v_perms];
end $$;
revoke execute on function public._contexto() from public, anon, authenticated;

create or replace function public.empresa_atual()
returns uuid language sql stable security definer set search_path = '' as $$
  select (public._contexto())[1]::uuid
$$;

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select nullif((public._contexto())[2], '')::public.app_role
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select (public._contexto())[1] is not null
$$;

create or replace function public.has_role(roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(nullif((public._contexto())[2], '')::public.app_role = any(roles), false)
$$;

create or replace function public.is_admin_master()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((public._contexto())[3] = 'true', false)
$$;

create or replace function public.tem_permissao(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select position(',' || p_chave || ',' in (public._contexto())[4]) > 0
$$;

-- Qualquer mudança de vínculo/permissão na transação invalida o contexto calculado
create or replace function public.contexto_invalidar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('geeasy.ctx_versao', (coalesce(nullif(current_setting('geeasy.ctx_versao', true), ''), '0')::bigint + 1)::text, true);
  return null;
end $$;
revoke execute on function public.contexto_invalidar() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['empresas', 'empresa_membros', 'profiles', 'departamentos', 'departamento_membros', 'departamento_niveis',
                           'nivel_funcionalidades', 'usuario_permissoes_extra', 'plataforma_admins'] loop
    execute format('create trigger zz_contexto_invalidar after insert or update or delete on public.%I for each statement execute function public.contexto_invalidar()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Políticas: funções sem dependência da linha passam a ser avaliadas UMA vez por consulta
-- (padrão recomendado pelo Supabase: "(select auth.uid())"). Reescreve as políticas existentes;
-- novas políticas devem seguir o mesmo padrão.
-- ---------------------------------------------------------------------
create or replace function pg_temp.otimizar(p_expr text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(regexp_replace(p_expr,
    '(?<!SELECT )(public\.)?\m(is_active_user|is_manager|is_backoffice|is_admin|is_juridico|is_financeiro_escritorio|is_admin_master|is_plataforma_admin|current_app_role|empresa_atual)\(\)',
    '(SELECT public.\2())', 'g'),
    '(?<!SELECT )(public\.)?\mhas_role\((ARRAY\[[^\]]*\](::[a-z_.]+\[\])?)\)', '(SELECT public.has_role(\2))', 'g'),
    '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g')
$f$;

do $$
declare p record; v_q text; v_c text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' or (schemaname = 'storage' and policyname like 'documentos_storage_%') loop
    v_q := pg_temp.otimizar(p.qual);
    v_c := pg_temp.otimizar(p.with_check);
    if v_q is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, v_q);
    end if;
    if v_c is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, v_c);
    end if;
  end loop;
end $$;
