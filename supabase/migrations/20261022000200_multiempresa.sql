-- =====================================================================
-- GE EASY — Fase 1: fundação multiempresa (SaaS)
--
-- * empresas, empresa_membros (papel e status POR EMPRESA) e plataforma_admins;
-- * empresa ativa da requisição: cabeçalho x-empresa-id (por aba/subdomínio) ou empresa padrão
--   do perfil — sempre validada contra um vínculo ativo (empresa_atual());
-- * empresa_id em todas as tabelas de negócio + política RLS RESTRITIVA de isolamento;
-- * gatilho de integridade: nenhum vínculo entre empresas diferentes; herda empresa_id do pai
--   quando o servidor (service role) grava sem informar;
-- * chaves únicas por empresa (CPF/CNPJ, CNJ, configurações...);
-- * dados atuais migrados como "Empresa 1" (slug easy).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Empresas, vínculos e administradores da plataforma
-- ---------------------------------------------------------------------
create type public.empresa_status as enum ('trial', 'ativa', 'suspensa', 'cancelada');

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 160),
  cnpj text,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  dominio text unique check (dominio is null or dominio ~ '^[a-z0-9.-]{4,253}$'),
  plano text not null default 'padrao',
  status public.empresa_status not null default 'ativa',
  limites jsonb not null default '{}'::jsonb,
  marca jsonb not null default '{}'::jsonb,
  fuso text not null default 'America/Sao_Paulo',
  modulos text[] not null default array['consultor', 'administrativo', 'juridico', 'rh', 'financeiro'],
  encarregado_lgpd jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_empresas_updated before update on public.empresas for each row execute function public.set_updated_at();

create table public.empresa_membros (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'consultor_externo',
  ativo boolean not null default true,
  admin_master boolean not null default false,
  convidado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index on public.empresa_membros (user_id);
create trigger trg_empresa_membros_updated before update on public.empresa_membros for each row execute function public.set_updated_at();

alter table public.profiles add column if not exists empresa_padrao_id uuid references public.empresas(id) on delete set null;

-- Donos da plataforma (painel de empresas, planos e uso). Separados dos admins das empresas.
create table public.plataforma_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) Empresa ativa e papel na empresa
-- ---------------------------------------------------------------------
-- Cabeçalho x-empresa-id (enviado pelo servidor Next.js conforme o subdomínio/cookie). Sem cabeçalho
-- (Realtime, Storage), vale a empresa padrão do perfil. Cabeçalho inválido ou sem vínculo => NULL
-- (nenhuma linha visível): nunca cai para outra empresa.
create or replace function public.empresa_atual()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_hdr text; v_id uuid;
begin
  if v_uid is null then return null; end if;
  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::json ->> 'x-empresa-id';
  exception when others then
    return null;
  end;
  if v_hdr is not null then
    if v_hdr !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
    v_id := v_hdr::uuid;
  else
    select p.empresa_padrao_id into v_id from public.profiles p where p.id = v_uid;
  end if;
  if v_id is not null and exists (
    select 1 from public.empresa_membros m
      join public.empresas e on e.id = m.empresa_id
      join public.profiles p on p.id = m.user_id
     where m.empresa_id = v_id and m.user_id = v_uid and m.ativo and p.active and e.status in ('trial', 'ativa')
  ) then
    return v_id;
  end if;
  return null;
end $$;

create or replace function public.is_plataforma_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plataforma_admins a join public.profiles p on p.id = a.user_id where a.user_id = auth.uid() and p.active)
$$;

-- Papel/estado agora vêm do vínculo com a empresa ativa (profiles.role/active ficam como legado)
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select m.role from public.empresa_membros m where m.empresa_id = public.empresa_atual() and m.user_id = auth.uid() and m.ativo
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.empresa_atual() is not null
$$;

create or replace function public.has_role(roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.empresa_membros m where m.empresa_id = public.empresa_atual() and m.user_id = auth.uid() and m.ativo and m.role = any(roles))
$$;

create or replace function public.is_admin_master()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.empresa_membros m where m.empresa_id = public.empresa_atual() and m.user_id = auth.uid() and m.ativo and m.admin_master)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin']::public.app_role[]) or public.is_admin_master()
$$;

-- Usuário pertence à empresa ativa (qualquer status): usado para limitar a visão de perfis
create or replace function public.is_membro_empresa(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.empresa_membros m where m.empresa_id = public.empresa_atual() and m.user_id = p_user)
$$;

-- ---------------------------------------------------------------------
-- 3) Empresa 1 (dados atuais) e empresa_id em todas as tabelas de negócio
-- ---------------------------------------------------------------------
do $$
declare
  v_emp uuid;
  v_nome text;
  t text;
  -- tabelas com empresa obrigatória
  v_obrig text[] := array['parceiros','produtos','clientes','interacoes','oportunidades','consorcio_cotas','consorcio_lances',
    'seguro_apolices','seguro_sinistros','comissoes','metas','agenda_eventos','tarefas','visitas','documentos','configuracoes',
    'departamentos','departamento_membros','processos','processo_partes','processo_andamentos','prazos','audiencias',
    'processo_lancamentos','contratos_honorarios','financeiro_lancamentos','horas_lancamentos','atendimentos','publicacoes',
    'modelos_documentos','drive_pastas'];
  -- tabelas técnicas/por usuário em que a empresa pode faltar (eventos antes de escolher a empresa)
  v_opc text[] := array['notificacoes','audit_logs','integracoes_log'];
begin
  select nullif(valor->>'nome', '') into v_nome from public.configuracoes where chave = 'empresa';
  insert into public.empresas (nome, slug, status) values (coalesce(v_nome, 'EASY'), 'easy', 'ativa') returning id into v_emp;

  insert into public.empresa_membros (empresa_id, user_id, role, ativo, admin_master)
  select v_emp, p.id, p.role, p.active, p.is_master or p.role = 'admin' from public.profiles p;
  update public.profiles set empresa_padrao_id = v_emp;
  insert into public.plataforma_admins (user_id) select id from public.profiles where is_master on conflict do nothing;

  foreach t in array v_obrig loop
    -- default constante = preenchimento instantâneo das linhas existentes, sem disparar gatilhos
    execute format('alter table public.%I add column empresa_id uuid not null default %L references public.empresas(id) on delete restrict', t, v_emp);
    execute format('alter table public.%I alter column empresa_id set default public.empresa_atual()', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()))', t || '_empresa', t);
  end loop;
  foreach t in array v_opc loop
    execute format('alter table public.%I add column empresa_id uuid default %L references public.empresas(id) on delete restrict', t, v_emp);
    execute format('alter table public.%I alter column empresa_id set default public.empresa_atual()', t);
  end loop;

  -- índices começando por empresa_id
  foreach t in array v_obrig || v_opc loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'created_at') then
      execute format('create index on public.%I (empresa_id, created_at desc)', t);
    else
      execute format('create index on public.%I (empresa_id)', t);
    end if;
  end loop;
end $$;

-- isolamento das tabelas com empresa opcional
create policy notificacoes_empresa on public.notificacoes as restrictive for all to authenticated
  using (empresa_id is null or empresa_id = (select public.empresa_atual()))
  with check (empresa_id is null or empresa_id = (select public.empresa_atual()));
create policy audit_logs_empresa on public.audit_logs as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy integracoes_log_empresa on public.integracoes_log as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));

-- chaves únicas passam a ser por empresa
drop index public.clientes_documento_uniq;
create unique index clientes_documento_uniq on public.clientes (empresa_id, documento) where documento is not null and documento <> '';
drop index public.processos_cnj_uniq;
create unique index processos_cnj_uniq on public.processos (empresa_id, numero_cnj) where numero_cnj is not null and numero_cnj <> '';
drop index public.metas_uniq;
create unique index metas_uniq on public.metas (empresa_id, coalesce(consultor_id, '00000000-0000-0000-0000-000000000000'::uuid), periodo, tipo);
alter table public.parceiros drop constraint parceiros_tipo_nome_key, add constraint parceiros_tipo_nome_key unique (empresa_id, tipo, nome);
alter table public.departamentos drop constraint departamentos_nome_key, add constraint departamentos_nome_key unique (empresa_id, nome);
alter table public.publicacoes drop constraint publicacoes_hash_key, add constraint publicacoes_hash_key unique (empresa_id, hash);
alter table public.configuracoes drop constraint configuracoes_pkey, add primary key (empresa_id, chave);
alter table public.drive_pastas drop constraint drive_pastas_pkey, add primary key (empresa_id, chave);

-- ---------------------------------------------------------------------
-- 4) Integridade entre empresas
-- Argumentos: 'coluna:tabela_pai' (FK de negócio) ou 'coluna:@' (usuário/array de usuários que
-- precisa pertencer à empresa). Roda depois dos demais gatilhos BEFORE (nome com prefixo zz_).
-- ---------------------------------------------------------------------
create or replace function public.empresa_vinculos()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_emp uuid := (v_new->>'empresa_id')::uuid;
  v_arg text; v_col text; v_ref text; v_par uuid; v_ids uuid[];
begin
  if tg_op = 'UPDATE' and new.empresa_id is distinct from old.empresa_id then
    raise exception 'Registros não mudam de empresa.' using errcode = '42501';
  end if;
  -- vínculos com registros: herda/valida a empresa
  foreach v_arg in array coalesce(tg_argv, '{}') loop
    v_col := split_part(v_arg, ':', 1);
    v_ref := split_part(v_arg, ':', 2);
    continue when v_ref = '@' or v_new->>v_col is null;
    continue when tg_op = 'UPDATE' and (v_new->>v_col) is not distinct from (v_old->>v_col);
    execute format('select empresa_id from public.%I where id = $1', v_ref) into v_par using (v_new->>v_col)::uuid;
    continue when v_par is null; -- inexistente: a FK recusa
    if v_emp is null then
      v_emp := v_par;
      new.empresa_id := v_par;
    elsif v_emp <> v_par then
      raise exception 'Vínculo com registro de outra empresa (%).', v_col using errcode = '42501';
    end if;
  end loop;
  if v_emp is null then
    raise exception 'Empresa não definida para o registro em %.', tg_table_name using errcode = '42501';
  end if;
  -- usuários referenciados precisam pertencer à empresa
  foreach v_arg in array coalesce(tg_argv, '{}') loop
    v_col := split_part(v_arg, ':', 1);
    continue when split_part(v_arg, ':', 2) <> '@' or v_new->v_col is null or jsonb_typeof(v_new->v_col) = 'null';
    continue when tg_op = 'UPDATE' and (v_new->v_col) is not distinct from (v_old->v_col);
    if jsonb_typeof(v_new->v_col) = 'array' then
      select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(v_new->v_col) x;
    else
      v_ids := array[(v_new->>v_col)::uuid];
    end if;
    if exists (select 1 from unnest(coalesce(v_ids, '{}')) u
                where not exists (select 1 from public.empresa_membros m where m.empresa_id = v_emp and m.user_id = u)) then
      raise exception 'Usuário informado em % não pertence à empresa.', v_col using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.empresa_vinculos() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select * from (values
    ('parceiros', ''),
    ('produtos', 'parceiro_id:parceiros'),
    ('clientes', 'consultor_id:@'),
    ('interacoes', 'cliente_id:clientes'),
    ('oportunidades', 'cliente_id:clientes,produto_id:produtos,consultor_id:@'),
    ('consorcio_cotas', 'cliente_id:clientes,administradora_id:parceiros,produto_id:produtos,oportunidade_id:oportunidades,consultor_id:@'),
    ('consorcio_lances', 'cota_id:consorcio_cotas'),
    ('seguro_apolices', 'cliente_id:clientes,seguradora_id:parceiros,produto_id:produtos,oportunidade_id:oportunidades,renovacao_de:seguro_apolices,consultor_id:@'),
    ('seguro_sinistros', 'apolice_id:seguro_apolices'),
    ('comissoes', 'cota_id:consorcio_cotas,apolice_id:seguro_apolices,cliente_id:clientes,consultor_id:@'),
    ('metas', 'consultor_id:@'),
    ('agenda_eventos', 'processo_id:processos,cliente_id:clientes,oportunidade_id:oportunidades,responsavel_id:@,participantes:@'),
    ('tarefas', 'processo_id:processos,cliente_id:clientes,departamento_id:departamentos,responsavel_id:@'),
    ('visitas', 'cliente_id:clientes,evento_id:agenda_eventos,consultor_id:@'),
    ('documentos', 'processo_id:processos,cliente_id:clientes,cota_id:consorcio_cotas,apolice_id:seguro_apolices'),
    ('configuracoes', ''),
    ('departamentos', 'responsavel_id:@'),
    ('departamento_membros', 'departamento_id:departamentos,user_id:@'),
    ('processos', 'cliente_id:clientes,departamento_id:departamentos,responsavel_id:@,equipe:@'),
    ('processo_partes', 'processo_id:processos'),
    ('processo_andamentos', 'processo_id:processos'),
    ('prazos', 'processo_id:processos,departamento_id:departamentos,responsavel_id:@'),
    ('audiencias', 'processo_id:processos,agenda_evento_id:agenda_eventos,responsavel_id:@'),
    ('processo_lancamentos', 'processo_id:processos'),
    ('contratos_honorarios', 'cliente_id:clientes,processo_id:processos,departamento_id:departamentos,responsavel_id:@'),
    ('financeiro_lancamentos', 'contrato_id:contratos_honorarios,processo_id:processos,cliente_id:clientes,departamento_id:departamentos'),
    ('horas_lancamentos', 'processo_id:processos,cliente_id:clientes,contrato_id:contratos_honorarios,lancamento_id:financeiro_lancamentos,user_id:@'),
    ('atendimentos', 'cliente_id:clientes,departamento_id:departamentos,processo_id:processos,contrato_id:contratos_honorarios,responsavel_id:@'),
    ('publicacoes', 'processo_id:processos,prazo_id:prazos,responsavel_id:@'),
    ('modelos_documentos', 'departamento_id:departamentos'),
    ('drive_pastas', '')
  ) as v(tabela, args) loop
    execute format('create trigger zz_empresa_vinculos before insert or update on public.%I for each row execute function public.empresa_vinculos(%s)',
      r.tabela, (select coalesce(string_agg(quote_literal(a), ','), '') from unnest(string_to_array(nullif(r.args, ''), ',')) a));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) Funções existentes passam a respeitar a empresa
-- ---------------------------------------------------------------------
create or replace function public.can_access_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes c
     where c.id = p_cliente and c.empresa_id = public.empresa_atual()
       and (public.is_backoffice() or public.is_juridico() or c.consultor_id = auth.uid() or c.created_by = auth.uid())
  )
$$;

create or replace function public.can_access_processo(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.processos p
     where p.id = p_id and p.empresa_id = public.empresa_atual() and (
       public.has_role(array['admin','gestor','financeiro']::public.app_role[])
       or p.responsavel_id = auth.uid() or p.created_by = auth.uid() or auth.uid() = any(p.equipe)
       or public.is_membro_departamento(p.departamento_id)
     )
  )
$$;

create or replace function public.can_edit_processo(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.processos p
     where p.id = p_id and p.empresa_id = public.empresa_atual() and public.is_juridico() and (
       public.is_manager()
       or p.responsavel_id = auth.uid() or p.created_by = auth.uid() or auth.uid() = any(p.equipe)
       or public.is_membro_departamento(p.departamento_id)
     )
  )
$$;

create or replace function public.is_membro_departamento(p_dep uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_dep is not null and exists (
    select 1 from public.departamentos d
     where d.id = p_dep and d.empresa_id = public.empresa_atual()
       and (d.responsavel_id = auth.uid()
            or exists (select 1 from public.departamento_membros m where m.departamento_id = d.id and m.user_id = auth.uid()))
  )
$$;

create or replace function public.is_responsavel_departamento(p_dep uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_dep is not null and exists (
    select 1 from public.departamentos d
     where d.id = p_dep and d.empresa_id = public.empresa_atual()
       and (d.responsavel_id = auth.uid()
            or exists (select 1 from public.departamento_membros m where m.departamento_id = d.id and m.user_id = auth.uid() and m.funcao = 'responsavel'))
  )
$$;

-- Caminho no Storage: empresas/<empresa_id>/<clientes|processos|geral>/... (novo) ou o legado sem prefixo.
create or replace function public.storage_caminho_relativo(p_name text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/');
begin
  if v_parts[1] <> 'empresas' then return p_name; end if;
  begin
    if v_parts[2]::uuid is distinct from public.empresa_atual() then return null; end if;
  exception when others then
    return null;
  end;
  return array_to_string(v_parts[3:], '/');
end $$;

create or replace function public.storage_can_access(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_rel text := public.storage_caminho_relativo(p_name); v_parts text[]; v_id uuid;
begin
  if v_rel is null or not public.is_active_user() then return false; end if;
  v_parts := string_to_array(v_rel, '/');
  if v_parts[1] in ('clientes', 'processos') and array_length(v_parts, 1) >= 3 then
    begin v_id := v_parts[2]::uuid; exception when others then return false; end;
    return case v_parts[1] when 'clientes' then public.can_access_cliente(v_id) else public.can_access_processo(v_id) end;
  elsif v_parts[1] = 'geral' then
    return public.is_backoffice();
  end if;
  return false;
end $$;

alter policy documentos_storage_insert on storage.objects
  with check (
    bucket_id = 'documentos' and public.storage_can_access(name)
    and (split_part(public.storage_caminho_relativo(name), '/', 1) <> 'processos'
         or public.can_edit_processo(nullif(split_part(public.storage_caminho_relativo(name), '/', 2), '')::uuid))
  );

create or replace function public.documentos_integridade()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_servidor boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  v_rel text;
begin
  if tg_op = 'INSERT' then
    if new.processo_id is not null then new.cliente_id := null; end if;
    if new.storage_path is not null then
      v_rel := case
        when new.storage_path like 'empresas/' || new.empresa_id::text || '/%' then substr(new.storage_path, length('empresas/' || new.empresa_id::text || '/') + 1)
        when new.storage_path like 'empresas/%' then null
        else new.storage_path end;
      if v_rel is null or not (
           (new.processo_id is not null and v_rel like 'processos/' || new.processo_id::text || '/%')
        or (new.processo_id is null and new.cliente_id is not null and v_rel like 'clientes/' || new.cliente_id::text || '/%')
      ) then
        raise exception 'Caminho do arquivo incompatível com o cliente/processo do documento.' using errcode = '42501';
      end if;
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

-- Publicação só se vincula a processo da mesma empresa
create or replace function public.publicacao_vincular()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dig text; v_proc uuid; v_resp uuid;
begin
  if new.processo_id is null and new.numero_processo is not null then
    v_dig := regexp_replace(new.numero_processo, '\D', '', 'g');
    if length(v_dig) = 20 then
      select p.id, p.responsavel_id into v_proc, v_resp
        from public.processos p
       where p.empresa_id = new.empresa_id and regexp_replace(coalesce(p.numero_cnj, ''), '\D', '', 'g') = v_dig limit 1;
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

create or replace function public.anonimizar_cliente(p_cliente uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_rotulo text := 'Titular anonimizado ' || upper(substr(md5(p_cliente::text || clock_timestamp()::text), 1, 8));
  v_emp uuid := public.empresa_atual();
begin
  if not public.is_admin() then raise exception 'Somente administradores podem anonimizar titulares.'; end if;
  if not exists (select 1 from public.clientes where id = p_cliente and empresa_id = v_emp) then raise exception 'Cliente não encontrado.'; end if;
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
  where id = p_cliente and empresa_id = v_emp;
  update public.atendimentos set nome_contato = v_rotulo, telefone = null, email = null, relato = null where cliente_id = p_cliente;
  update public.interacoes set descricao = '[conteúdo removido — anonimização LGPD]' where cliente_id = p_cliente;
  return v_rotulo;
end $$;

create or replace function public.notificar_movimentacoes(p_processo uuid, p_qtd int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_proc record; v_user uuid;
begin
  if p_qtd is null or p_qtd <= 0 or not public.can_edit_processo(p_processo) then return; end if;
  if not public._rate_limit('notif:' || auth.uid() || ':' || p_processo, 6, 3600) then return; end if;
  select id, titulo, responsavel_id, equipe, empresa_id into v_proc from public.processos where id = p_processo;
  if not found then return; end if;
  for v_user in select distinct u from unnest(array_append(v_proc.equipe, v_proc.responsavel_id)) u where u is not null and u <> auth.uid() loop
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (v_proc.empresa_id, v_user, 'Novas movimentações no processo', left(least(p_qtd, 100000) || ' movimentação(ões) do DataJud em ' || v_proc.titulo, 300), '/processos/' || p_processo);
  end loop;
end $$;

create or replace function public.registrar_integracao(p_tipo text, p_status text, p_mensagem text, p_detalhes jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_user() then return; end if;
  if p_tipo not in ('datajud', 'djen', 'drive', 'agenda') or p_status not in ('ok', 'erro', 'parcial') then return; end if;
  if not public._rate_limit('log:' || auth.uid(), 120, 3600) then return; end if;
  insert into public.integracoes_log (empresa_id, tipo, status, mensagem, detalhes, user_id)
  values (public.empresa_atual(), p_tipo, p_status, left(p_mensagem, 1000), case when pg_column_size(p_detalhes) < 8000 then p_detalhes end, auth.uid());
end $$;

create or replace function public.registrar_acesso(p_acao text, p_tabela text, p_registro text, p_detalhes jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if p_acao not in ('LOGIN', 'LOGOUT', 'LOGOUT_GLOBAL', 'DOWNLOAD', 'EXPORTACAO', 'VISUALIZACAO_SIGILOSA', 'LGPD_EXPORTACAO', 'LGPD_ANONIMIZACAO', 'INTEGRACAO', 'TROCA_EMPRESA') then
    raise exception 'ação de auditoria inválida';
  end if;
  insert into public.audit_logs (empresa_id, actor_id, actor_email, acao, tabela, registro_id, dados_novos)
  values (public.empresa_atual(), auth.uid(), (select email from public.profiles where id = auth.uid()), p_acao, left(p_tabela, 60), left(p_registro, 100),
          case when pg_column_size(p_detalhes) < 4000 then p_detalhes end);
end $$;

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_id text := coalesce(v_new->>'id', v_old->>'id', v_new->>'user_id', v_old->>'user_id', v_new->>'chave');
  v_tecnicos text[] := array['updated_at', 'datajud_sincronizado_em', 'datajud_atualizado_em', 'datajud_status', 'datajud_erro',
    'drive_folder_id', 'drive_file_id', 'drive_url', 'drive_status', 'drive_erro', 'drive_tentativas', 'drive_sincronizado_em', 'google_event_id'];
begin
  v_old := v_old - 'access_token_enc' - 'refresh_token_enc';
  v_new := v_new - 'access_token_enc' - 'refresh_token_enc';
  if tg_op = 'UPDATE' and (v_old - v_tecnicos) = (v_new - v_tecnicos) then
    return new;
  end if;
  insert into public.audit_logs (empresa_id, actor_id, actor_email, acao, tabela, registro_id, dados_antigos, dados_novos)
  values (coalesce((v_new->>'empresa_id')::uuid, (v_old->>'empresa_id')::uuid, public.empresa_atual()),
          auth.uid(), (select email from public.profiles where id = auth.uid()), tg_op, tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

-- Alertas diários por empresa (gestão = membros admin/gestor da empresa do registro)
create or replace function public.gerar_alertas()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select pz.empresa_id, m.user_id,
         case when pz.data_fim = v_hoje then 'Prazo vence HOJE' else 'Prazo próximo' end,
         pz.descricao || coalesce(' · ' || pr.titulo, '') || ' — vence ' || to_char(pz.data_fim, 'DD/MM/YYYY'),
         coalesce('/processos/' || pz.processo_id, '/prazos'),
         'prazo:' || pz.id || ':' || pz.data_fim
    from public.prazos pz
    left join public.processos pr on pr.id = pz.processo_id
    join public.empresa_membros m on m.empresa_id = pz.empresa_id and m.ativo and (m.user_id = pz.responsavel_id or m.role in ('admin','gestor'))
   where pz.status = 'pendente' and pz.data_fim between v_hoje and v_hoje + 3
  on conflict (user_id, chave) where chave is not null do nothing;
  get diagnostics n = row_count;

  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select pz.empresa_id, pz.responsavel_id, 'Prazo VENCIDO sem baixa', pz.descricao || ' — venceu ' || to_char(pz.data_fim, 'DD/MM/YYYY'),
         coalesce('/processos/' || pz.processo_id, '/prazos'), 'prazo-vencido:' || pz.id || ':' || v_hoje
    from public.prazos pz
   where pz.status = 'pendente' and pz.data_fim < v_hoje and pz.responsavel_id is not null
  on conflict (user_id, chave) where chave is not null do nothing;

  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select a.empresa_id, m.user_id, 'Audiência amanhã',
         pr.titulo || ' — ' || to_char(a.data_hora at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
         '/processos/' || a.processo_id, 'aud:' || a.id || ':' || a.data_hora::date
    from public.audiencias a
    join public.processos pr on pr.id = a.processo_id
    join public.empresa_membros m on m.empresa_id = a.empresa_id and m.ativo and (m.user_id = a.responsavel_id or m.user_id = pr.responsavel_id)
   where a.status = 'agendada' and (a.data_hora at time zone 'America/Sao_Paulo')::date = v_hoje + 1
  on conflict (user_id, chave) where chave is not null do nothing;

  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select a.empresa_id, m.user_id, 'Renovação próxima',
         'Seguro ' || a.ramo || ' de ' || c.nome || ' vence em ' || to_char(a.fim_vigencia, 'DD/MM/YYYY'),
         '/seguros/' || a.id, 'renov:' || a.id
    from public.seguro_apolices a
    join public.clientes c on c.id = a.cliente_id
    join public.empresa_membros m on m.empresa_id = a.empresa_id and m.ativo and (m.user_id = a.consultor_id or m.role in ('admin','gestor'))
   where a.status = 'vigente' and a.fim_vigencia between v_hoje and v_hoje + 30
  on conflict (user_id, chave) where chave is not null do nothing;

  update public.seguro_apolices set status = 'vencida' where status = 'vigente' and fim_vigencia < v_hoje;

  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select t.empresa_id, t.responsavel_id, 'Tarefa atrasada', t.titulo, '/tarefas', 'tarefa:' || t.id
    from public.tarefas t
   where t.status <> 'concluida' and t.vencimento < v_hoje and t.responsavel_id is not null
  on conflict (user_id, chave) where chave is not null do nothing;
  return n;
end $$;
revoke execute on function public.gerar_alertas() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) Novos usuários e proteção de privilégios
-- ---------------------------------------------------------------------
-- O vínculo com a empresa vem do convite (app_metadata definido pelo service role, nunca pelo cliente):
-- ge_empresa_id, ge_role, ge_active, ge_admin_master, ge_convidado_por. Sem convite: conta sem empresa
-- (tela "acesso pendente"). Bootstrap: o primeiro usuário da plataforma vira dono da plataforma e
-- administrador master da primeira empresa.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, email, role, active)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)), coalesce(new.email, ''),
          coalesce((v_meta->>'ge_role')::public.app_role, 'consultor_externo'), true);

  if not exists (select 1 from public.plataforma_admins) then
    insert into public.plataforma_admins (user_id) values (new.id);
    select id into v_emp from public.empresas order by created_at limit 1;
    if v_emp is not null then
      insert into public.empresa_membros (empresa_id, user_id, role, ativo, admin_master) values (v_emp, new.id, 'admin', true, true);
    end if;
  elsif v_meta ? 'ge_empresa_id' then
    v_emp := (v_meta->>'ge_empresa_id')::uuid;
    insert into public.empresa_membros (empresa_id, user_id, role, ativo, admin_master, convidado_por)
    values (v_emp, new.id, coalesce((v_meta->>'ge_role')::public.app_role, 'consultor_externo'),
            coalesce((v_meta->>'ge_active')::boolean, true), coalesce((v_meta->>'ge_admin_master')::boolean, false),
            nullif(v_meta->>'ge_convidado_por', '')::uuid);
  end if;
  if v_emp is not null then
    update public.profiles set empresa_padrao_id = v_emp where id = new.id;
  end if;
  return new;
end $$;

-- Perfil (global): ninguém altera o próprio e-mail/master; dados de outra pessoa só o admin da empresa
-- em que ela é membro (RLS); empresa padrão só entre as empresas do próprio usuário.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new; -- service role / migrações
  end if;
  if new.is_master is distinct from old.is_master or new.id is distinct from old.id then
    raise exception 'O status de administrador master não pode ser alterado pelo sistema' using errcode = '42501';
  end if;
  if old.is_master and auth.uid() <> old.id and (
       new.role is distinct from old.role or new.active is distinct from old.active
       or new.email is distinct from old.email or new.comissao_percentual is distinct from old.comissao_percentual) then
    raise exception 'O administrador master não pode ser alterado por outros usuários' using errcode = '42501';
  end if;
  -- papel e status por empresa ficam em empresa_membros; profiles.role é legado e profiles.active é o bloqueio global
  if new.role is distinct from old.role then
    raise exception 'O papel é definido no vínculo com a empresa (Configurações › Usuários)' using errcode = '42501';
  end if;
  if new.active is distinct from old.active and not public.is_plataforma_admin() then
    raise exception 'Somente a plataforma bloqueia uma conta; desative o vínculo com a empresa' using errcode = '42501';
  end if;
  if not public.is_admin() and (new.comissao_percentual is distinct from old.comissao_percentual or new.email is distinct from old.email) then
    raise exception 'Sem permissão para alterar e-mail ou comissão' using errcode = '42501';
  end if;
  if new.empresa_padrao_id is distinct from old.empresa_padrao_id then
    if auth.uid() <> old.id then
      raise exception 'Somente o próprio usuário escolhe a empresa padrão' using errcode = '42501';
    end if;
    if new.empresa_padrao_id is not null and not exists (
      select 1 from public.empresa_membros m where m.empresa_id = new.empresa_padrao_id and m.user_id = old.id and m.ativo) then
      raise exception 'Você não tem acesso a esta empresa' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Vínculos: ninguém altera o próprio acesso; o master da plataforma (profiles.is_master) é intocável
-- por outros; só administrador master concede/retira master; a empresa mantém ao menos 1 master ativo;
-- vínculo não é excluído (desativa-se). Limite de usuários do plano.
create or replace function public.protect_empresa_membros()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limite int;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then raise exception 'Vínculos não são excluídos: desative o acesso.' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' or (new.ativo and not old.ativo) then
    select nullif(e.limites->>'max_usuarios', '')::int into v_limite from public.empresas e where e.id = new.empresa_id;
    if v_limite is not null and (select count(*) from public.empresa_membros m where m.empresa_id = new.empresa_id and m.ativo and m.user_id <> new.user_id) >= v_limite then
      raise exception 'Limite de usuários do plano atingido (%).', v_limite using errcode = '42501';
    end if;
  end if;
  if auth.uid() is null then return new; end if; -- service role / migrações
  if tg_op = 'INSERT' then
    if new.admin_master and not public.is_admin_master() then
      raise exception 'Somente o administrador master concede o perfil master' using errcode = '42501';
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
  if new.admin_master is distinct from old.admin_master and not public.is_admin_master() then
    raise exception 'Somente o administrador master concede ou retira o perfil master' using errcode = '42501';
  end if;
  if old.admin_master and old.ativo and (not new.admin_master or not new.ativo) and not exists (
    select 1 from public.empresa_membros m where m.empresa_id = old.empresa_id and m.user_id <> old.user_id and m.ativo and m.admin_master) then
    raise exception 'A empresa precisa de pelo menos um administrador master ativo' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_empresa_membros_protect before insert or update or delete on public.empresa_membros
  for each row execute function public.protect_empresa_membros();

-- Empresa: o admin master edita nome/marca/fuso/LGPD; plano, status, limites, slug, domínio e módulos são da plataforma
create or replace function public.protect_empresa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_plataforma_admin() then return new; end if;
  if (new.slug, new.dominio, new.plano, new.status, new.limites, new.modulos)
     is distinct from (old.slug, old.dominio, old.plano, old.status, old.limites, old.modulos) then
    raise exception 'Plano, situação, limites, endereço e módulos são definidos pela plataforma' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_empresas_protect before update on public.empresas for each row execute function public.protect_empresa();

revoke execute on function public.protect_empresa_membros(), public.protect_empresa() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) RLS das novas tabelas e da visão de perfis
-- ---------------------------------------------------------------------
alter table public.empresas enable row level security;
alter table public.empresa_membros enable row level security;
alter table public.plataforma_admins enable row level security;

create policy empresas_select on public.empresas for select to authenticated
  using (public.is_plataforma_admin() or exists (select 1 from public.empresa_membros m where m.empresa_id = empresas.id and m.user_id = auth.uid() and m.ativo));
create policy empresas_update on public.empresas for update to authenticated
  using (public.is_plataforma_admin() or (id = public.empresa_atual() and public.is_admin_master()))
  with check (public.is_plataforma_admin() or (id = public.empresa_atual() and public.is_admin_master()));
create policy empresas_insert on public.empresas for insert to authenticated with check (public.is_plataforma_admin());

create policy membros_select on public.empresa_membros for select to authenticated
  using (user_id = auth.uid() or (empresa_id = public.empresa_atual()) or public.is_plataforma_admin());
create policy membros_insert on public.empresa_membros for insert to authenticated
  with check (empresa_id = public.empresa_atual() and public.is_admin());
create policy membros_update on public.empresa_membros for update to authenticated
  using (empresa_id = public.empresa_atual() and public.is_admin())
  with check (empresa_id = public.empresa_atual() and public.is_admin());

create policy plataforma_admins_select on public.plataforma_admins for select to authenticated using (user_id = auth.uid());

-- Perfis: só os da própria empresa (antes: todos os usuários ativos do sistema)
alter policy profiles_select on public.profiles
  using (id = auth.uid() or public.is_membro_empresa(id) or public.is_plataforma_admin());
alter policy profiles_update_admin on public.profiles
  using (public.is_admin() and public.is_membro_empresa(id))
  with check (public.is_admin() and public.is_membro_empresa(id));

-- Usuários da empresa ativa com papel/estado do vínculo (substitui listas de profiles no app)
create view public.membros with (security_invoker = true) as
  select p.id, p.full_name, p.email, p.phone, m.role, (m.ativo and p.active) as active, p.avatar_url, p.cargo, p.territorio,
         p.comissao_percentual, p.is_master, p.oab, p.created_at, m.admin_master, m.empresa_id
    from public.empresa_membros m
    join public.profiles p on p.id = m.user_id
   where m.empresa_id = public.empresa_atual();

revoke all on public.empresas, public.empresa_membros, public.plataforma_admins, public.membros from anon;
grant select on public.membros to authenticated;

-- ---------------------------------------------------------------------
-- 8) Contexto da sessão, empresa por endereço e painel da plataforma
-- ---------------------------------------------------------------------
-- Tudo o que o servidor precisa para montar a sessão numa única chamada
create or replace function public.contexto_sessao()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual();
begin
  if auth.uid() is null then return null; end if;
  return jsonb_build_object(
    'empresa', (select jsonb_build_object('id', e.id, 'nome', e.nome, 'slug', e.slug, 'marca', e.marca, 'fuso', e.fuso, 'modulos', e.modulos, 'status', e.status)
                  from public.empresas e where e.id = v_emp),
    'membro', (select jsonb_build_object('role', m.role, 'ativo', m.ativo, 'admin_master', m.admin_master)
                 from public.empresa_membros m where m.empresa_id = v_emp and m.user_id = auth.uid()),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'slug', e.slug, 'status', e.status) order by e.nome)
                            from public.empresa_membros m join public.empresas e on e.id = m.empresa_id
                           where m.user_id = auth.uid() and m.ativo and e.status in ('trial', 'ativa')), '[]'::jsonb),
    'plataforma_admin', public.is_plataforma_admin()
  );
end $$;

-- Login por subdomínio (<slug>.dominio-raiz) ou domínio próprio: somente dados públicos da marca
create or replace function public.empresa_publica(p_slug text default null, p_dominio text default null)
returns table (id uuid, nome text, slug text, marca jsonb)
language sql stable security definer set search_path = '' as $$
  select e.id, e.nome, e.slug, e.marca from public.empresas e
   where e.status in ('trial', 'ativa')
     and ((p_slug is not null and e.slug = lower(p_slug)) or (p_dominio is not null and e.dominio = lower(p_dominio)))
   limit 1
$$;

-- Dados padrão de uma empresa nova (ampliado nas migrações seguintes)
create or replace function public.provisionar_empresa(p_empresa uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  select nome into v_nome from public.empresas where id = p_empresa;
  insert into public.configuracoes (empresa_id, chave, valor) values
    (p_empresa, 'empresa', jsonb_build_object('nome', v_nome, 'sistema', 'GE EASY')),
    (p_empresa, 'comercial', jsonb_build_object('dias_alerta_renovacao', 30, 'moeda', 'BRL'))
  on conflict do nothing;
  insert into public.departamentos (empresa_id, nome, sigla, descricao, cor) values
    (p_empresa, 'Comercial', 'COM', 'Consultores e captação de clientes', 'amber'),
    (p_empresa, 'Administrativo', 'ADM', 'Documentação, cadastros e base de clientes', 'slate'),
    (p_empresa, 'Jurídico', 'JUR', 'Processos, intimações e audiências', 'brand'),
    (p_empresa, 'Recursos Humanos', 'RH', 'Funcionários, acessos e folha', 'sky'),
    (p_empresa, 'Financeiro', 'FIN', 'Contas, recebimentos e folha de pagamento', 'green')
  on conflict do nothing;
end $$;
revoke execute on function public.provisionar_empresa(uuid) from public, anon, authenticated;

create or replace function public.plataforma_criar_empresa(p_nome text, p_slug text, p_cnpj text default null, p_plano text default 'padrao', p_status public.empresa_status default 'trial')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_plataforma_admin() then raise exception 'Somente a plataforma cria empresas.' using errcode = '42501'; end if;
  insert into public.empresas (nome, slug, cnpj, plano, status) values (trim(p_nome), lower(trim(p_slug)), nullif(trim(p_cnpj), ''), coalesce(p_plano, 'padrao'), coalesce(p_status, 'trial'))
  returning id into v_id;
  perform public.provisionar_empresa(v_id);
  return v_id;
end $$;

-- Vincula um usuário (já existente) a uma empresa — usado pelo painel da plataforma e por convites
create or replace function public.plataforma_vincular_usuario(p_empresa uuid, p_user uuid, p_role public.app_role, p_admin_master boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_plataforma_admin() then raise exception 'Somente a plataforma.' using errcode = '42501'; end if;
  insert into public.empresa_membros (empresa_id, user_id, role, ativo, admin_master, convidado_por)
  values (p_empresa, p_user, p_role, true, coalesce(p_admin_master, false), auth.uid())
  on conflict (empresa_id, user_id) do update set role = excluded.role, ativo = true, admin_master = excluded.admin_master;
  update public.profiles set empresa_padrao_id = coalesce(empresa_padrao_id, p_empresa) where id = p_user;
end $$;

create or replace function public.plataforma_uso()
returns table (empresa_id uuid, nome text, slug text, status public.empresa_status, plano text, limites jsonb, criada_em timestamptz,
               usuarios_ativos bigint, clientes bigint, processos bigint, documentos bigint, armazenamento_bytes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_plataforma_admin() then raise exception 'Somente a plataforma.' using errcode = '42501'; end if;
  return query
  select e.id, e.nome, e.slug, e.status, e.plano, e.limites, e.created_at,
         (select count(*) from public.empresa_membros m where m.empresa_id = e.id and m.ativo),
         (select count(*) from public.clientes c where c.empresa_id = e.id),
         (select count(*) from public.processos p where p.empresa_id = e.id),
         (select count(*) from public.documentos d where d.empresa_id = e.id),
         (select coalesce(sum(d.tamanho), 0)::bigint from public.documentos d where d.empresa_id = e.id)
    from public.empresas e order by e.nome;
end $$;

revoke execute on function public.empresa_atual(), public.is_plataforma_admin(), public.is_admin_master(), public.is_membro_empresa(uuid),
  public.storage_caminho_relativo(text), public.contexto_sessao(), public.plataforma_criar_empresa(text, text, text, text, public.empresa_status),
  public.plataforma_vincular_usuario(uuid, uuid, public.app_role, boolean), public.plataforma_uso() from public, anon;
grant execute on function public.empresa_atual(), public.is_plataforma_admin(), public.is_admin_master(), public.is_membro_empresa(uuid),
  public.storage_caminho_relativo(text), public.contexto_sessao(), public.plataforma_criar_empresa(text, text, text, text, public.empresa_status),
  public.plataforma_vincular_usuario(uuid, uuid, public.app_role, boolean), public.plataforma_uso() to authenticated;
revoke execute on function public.empresa_publica(text, text) from public;
grant execute on function public.empresa_publica(text, text) to anon, authenticated;
