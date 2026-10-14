-- =====================================================================
-- GE EASY — Gestão Especializada EASY
-- Migração 0001: esquema principal, papéis (RBAC), RLS, auditoria,
-- comissões automáticas e alertas de renovação.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'gestor', 'financeiro', 'consultor', 'consultor_externo');
create type public.tipo_pessoa as enum ('PF', 'PJ');
create type public.cliente_status as enum ('lead', 'ativo', 'inativo');
create type public.linha_negocio as enum ('consorcio', 'seguro');
create type public.parceiro_tipo as enum ('administradora', 'seguradora');
create type public.oportunidade_etapa as enum ('novo', 'contato', 'qualificacao', 'proposta', 'negociacao', 'ganho', 'perdido');
create type public.cota_status as enum ('proposta', 'ativa', 'contemplada', 'quitada', 'cancelada', 'inadimplente');
create type public.contemplacao_forma as enum ('sorteio', 'lance_livre', 'lance_fixo', 'lance_embutido');
create type public.lance_resultado as enum ('pendente', 'contemplado', 'nao_contemplado');
create type public.apolice_status as enum ('cotacao', 'proposta', 'vigente', 'renovada', 'cancelada', 'vencida');
create type public.sinistro_status as enum ('aberto', 'em_analise', 'aprovado', 'negado', 'pago');
create type public.comissao_status as enum ('prevista', 'recebida', 'paga', 'estornada');
create type public.evento_tipo as enum ('reuniao', 'visita', 'ligacao', 'assembleia', 'renovacao', 'tarefa', 'outro');
create type public.evento_status as enum ('agendado', 'concluido', 'cancelado');
create type public.tarefa_status as enum ('pendente', 'em_andamento', 'concluida');
create type public.prioridade as enum ('baixa', 'media', 'alta', 'urgente');
create type public.meta_tipo as enum ('consorcio_credito', 'seguro_premio', 'novos_clientes', 'comissao');
create type public.interacao_tipo as enum ('nota', 'ligacao', 'email', 'whatsapp', 'visita', 'sistema');

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  role public.app_role not null default 'consultor_externo',
  active boolean not null default false,
  avatar_url text,
  cargo text,
  territorio text,
  comissao_percentual numeric(5,2) not null default 0 check (comissao_percentual between 0 and 100),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- Helpers de autorização (SECURITY DEFINER, search_path vazio, estáveis)
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

create or replace function public.has_role(roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = any(roles))
$$;

-- Gestão: vê tudo
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin','gestor']::public.app_role[])
$$;

-- Back-office: gestão + financeiro (leitura ampla)
create or replace function public.is_backoffice()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin','gestor','financeiro']::public.app_role[])
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin']::public.app_role[])
$$;

-- Novo usuário: cria o perfil. O primeiro usuário vira admin ativo
-- (bootstrap). Demais entram INATIVOS, salvo quando criados por um admin
-- pelo painel (app_metadata definido via service role, nunca pelo cliente).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := 'consultor_externo';
  v_active boolean := false;
  v_has_admin boolean;
begin
  select exists (select 1 from public.profiles where role = 'admin' and active) into v_has_admin;
  if not v_has_admin then
    v_role := 'admin';
    v_active := true;
  elsif new.raw_app_meta_data ? 'ge_role' then
    v_role := (new.raw_app_meta_data->>'ge_role')::public.app_role;
    v_active := coalesce((new.raw_app_meta_data->>'ge_active')::boolean, true);
  end if;

  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    v_role,
    v_active
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Impede auto-escalonamento: só admin altera papel/ativo/comissão
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new; -- service role / migrações
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
  -- Admin não pode remover o próprio acesso de admin (evita lockout)
  if new.id = auth.uid() and old.role = 'admin' and (new.role <> 'admin' or not new.active) then
    raise exception 'Você não pode remover seu próprio acesso de administrador' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- ---------------------------------------------------------------------
-- Cadastros base: parceiros (administradoras/seguradoras) e produtos
-- ---------------------------------------------------------------------
create table public.parceiros (
  id uuid primary key default gen_random_uuid(),
  tipo public.parceiro_tipo not null,
  nome text not null check (char_length(nome) between 2 and 160),
  cnpj text,
  contato text,
  email text,
  telefone text,
  site text,
  comissao_padrao numeric(6,3) not null default 0 check (comissao_padrao between 0 and 100),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipo, nome)
);
create trigger trg_parceiros_updated before update on public.parceiros for each row execute function public.set_updated_at();

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  parceiro_id uuid references public.parceiros(id) on delete set null,
  linha public.linha_negocio not null,
  categoria text not null,
  nome text not null check (char_length(nome) between 2 and 160),
  descricao text,
  comissao_percentual numeric(6,3) not null default 0 check (comissao_percentual between 0 and 100),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.produtos (parceiro_id);
create trigger trg_produtos_updated before update on public.produtos for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Clientes / CRM
-- ---------------------------------------------------------------------
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  tipo_pessoa public.tipo_pessoa not null default 'PF',
  nome text not null check (char_length(nome) between 2 and 200),
  documento text,
  rg text,
  data_nascimento date,
  email text,
  telefone text,
  whatsapp text,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf char(2),
  profissao text,
  renda_mensal numeric(14,2),
  origem text,
  status public.cliente_status not null default 'lead',
  tags text[] not null default '{}',
  consultor_id uuid references public.profiles(id) on delete set null,
  drive_folder_id text,
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clientes_documento_uniq on public.clientes (documento) where documento is not null and documento <> '';
create index on public.clientes (consultor_id);
create index on public.clientes (created_by);
create index on public.clientes (status);
create index clientes_nome_trgm on public.clientes using gin (nome extensions.gin_trgm_ops);
create trigger trg_clientes_updated before update on public.clientes for each row execute function public.set_updated_at();

-- Acesso ao cliente: back-office vê todos; consultores veem a própria carteira
create or replace function public.can_access_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_backoffice() or exists (
    select 1 from public.clientes c
    where c.id = p_cliente and public.is_active_user()
      and (c.consultor_id = auth.uid() or c.created_by = auth.uid())
  )
$$;

-- Consultores só podem atribuir clientes/negócios a si mesmos
create or replace function public.enforce_own_consultor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.consultor_id := auth.uid();
  elsif new.consultor_id is distinct from old.consultor_id then
    raise exception 'Somente a gestão pode transferir a carteira' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_clientes_own before insert or update on public.clientes
  for each row execute function public.enforce_own_consultor();

create table public.interacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  tipo public.interacao_tipo not null default 'nota',
  descricao text not null check (char_length(descricao) between 1 and 5000),
  autor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.interacoes (cliente_id, created_at desc);

-- ---------------------------------------------------------------------
-- Oportunidades (funil de vendas)
-- ---------------------------------------------------------------------
create table public.oportunidades (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 2 and 200),
  linha public.linha_negocio not null,
  produto_id uuid references public.produtos(id) on delete set null,
  valor numeric(14,2) not null default 0 check (valor >= 0),
  etapa public.oportunidade_etapa not null default 'novo',
  probabilidade int not null default 10 check (probabilidade between 0 and 100),
  previsao_fechamento date,
  motivo_perda text,
  consultor_id uuid references public.profiles(id) on delete set null,
  fechado_em timestamptz,
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.oportunidades (cliente_id);
create index on public.oportunidades (consultor_id);
create index on public.oportunidades (etapa);
create trigger trg_oport_updated before update on public.oportunidades for each row execute function public.set_updated_at();
create trigger trg_oport_own before insert or update on public.oportunidades for each row execute function public.enforce_own_consultor();

create or replace function public.oportunidade_fechamento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.etapa in ('ganho','perdido') and (tg_op = 'INSERT' or old.etapa is distinct from new.etapa) then
    new.fechado_em := now();
    new.probabilidade := case when new.etapa = 'ganho' then 100 else 0 end;
  elsif new.etapa not in ('ganho','perdido') then
    new.fechado_em := null;
  end if;
  return new;
end $$;
create trigger trg_oport_fechamento before insert or update on public.oportunidades
  for each row execute function public.oportunidade_fechamento();

-- ---------------------------------------------------------------------
-- Consórcio
-- ---------------------------------------------------------------------
create table public.consorcio_cotas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  administradora_id uuid references public.parceiros(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  oportunidade_id uuid references public.oportunidades(id) on delete set null,
  categoria text not null default 'imovel',
  grupo text,
  cota text,
  numero_contrato text,
  valor_credito numeric(14,2) not null check (valor_credito > 0),
  prazo_meses int not null check (prazo_meses between 1 and 400),
  parcela_valor numeric(14,2) not null default 0 check (parcela_valor >= 0),
  taxa_adm numeric(6,3) not null default 0 check (taxa_adm between 0 and 100),
  fundo_reserva numeric(6,3) not null default 0 check (fundo_reserva between 0 and 100),
  data_adesao date not null default current_date,
  dia_vencimento int check (dia_vencimento between 1 and 31),
  parcelas_pagas int not null default 0 check (parcelas_pagas >= 0),
  status public.cota_status not null default 'proposta',
  contemplada_em date,
  forma_contemplacao public.contemplacao_forma,
  valor_lance numeric(14,2),
  consultor_id uuid references public.profiles(id) on delete set null,
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.consorcio_cotas (cliente_id);
create index on public.consorcio_cotas (consultor_id);
create index on public.consorcio_cotas (status);
create index on public.consorcio_cotas (administradora_id);
create trigger trg_cotas_updated before update on public.consorcio_cotas for each row execute function public.set_updated_at();
create trigger trg_cotas_own before insert or update on public.consorcio_cotas for each row execute function public.enforce_own_consultor();

create table public.consorcio_lances (
  id uuid primary key default gen_random_uuid(),
  cota_id uuid not null references public.consorcio_cotas(id) on delete cascade,
  data_assembleia date not null,
  tipo public.contemplacao_forma not null default 'lance_livre',
  percentual numeric(6,3),
  valor numeric(14,2),
  resultado public.lance_resultado not null default 'pendente',
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.consorcio_lances (cota_id);

-- Lance contemplado => cota contemplada
create or replace function public.lance_contempla_cota()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.resultado = 'contemplado' and (tg_op = 'INSERT' or old.resultado is distinct from new.resultado) then
    update public.consorcio_cotas
       set status = 'contemplada', contemplada_em = new.data_assembleia,
           forma_contemplacao = new.tipo, valor_lance = new.valor
     where id = new.cota_id;
  end if;
  return new;
end $$;
create trigger trg_lance_contempla after insert or update on public.consorcio_lances
  for each row execute function public.lance_contempla_cota();

-- ---------------------------------------------------------------------
-- Seguros
-- ---------------------------------------------------------------------
create table public.seguro_apolices (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  seguradora_id uuid references public.parceiros(id) on delete set null,
  produto_id uuid references public.produtos(id) on delete set null,
  oportunidade_id uuid references public.oportunidades(id) on delete set null,
  renovacao_de uuid references public.seguro_apolices(id) on delete set null,
  ramo text not null default 'auto',
  numero_apolice text,
  numero_proposta text,
  item_segurado text,
  inicio_vigencia date not null,
  fim_vigencia date not null,
  premio_liquido numeric(14,2) not null default 0 check (premio_liquido >= 0),
  premio_total numeric(14,2) not null default 0 check (premio_total >= 0),
  forma_pagamento text,
  parcelas int not null default 1 check (parcelas between 1 and 24),
  comissao_percentual numeric(6,3) not null default 0 check (comissao_percentual between 0 and 100),
  status public.apolice_status not null default 'cotacao',
  consultor_id uuid references public.profiles(id) on delete set null,
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fim_vigencia >= inicio_vigencia)
);
create index on public.seguro_apolices (cliente_id);
create index on public.seguro_apolices (consultor_id);
create index on public.seguro_apolices (status, fim_vigencia);
create index on public.seguro_apolices (seguradora_id);
create trigger trg_apolices_updated before update on public.seguro_apolices for each row execute function public.set_updated_at();
create trigger trg_apolices_own before insert or update on public.seguro_apolices for each row execute function public.enforce_own_consultor();

create table public.seguro_sinistros (
  id uuid primary key default gen_random_uuid(),
  apolice_id uuid not null references public.seguro_apolices(id) on delete cascade,
  numero_sinistro text,
  data_ocorrencia date not null,
  descricao text not null,
  status public.sinistro_status not null default 'aberto',
  valor_indenizacao numeric(14,2),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.seguro_sinistros (apolice_id);
create trigger trg_sinistros_updated before update on public.seguro_sinistros for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Comissões (geradas automaticamente) e metas
-- ---------------------------------------------------------------------
create table public.comissoes (
  id uuid primary key default gen_random_uuid(),
  linha public.linha_negocio not null,
  cota_id uuid references public.consorcio_cotas(id) on delete cascade,
  apolice_id uuid references public.seguro_apolices(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  consultor_id uuid references public.profiles(id) on delete set null,
  descricao text,
  competencia date not null default date_trunc('month', current_date)::date,
  base_calculo numeric(14,2) not null default 0,
  percentual_corretora numeric(6,3) not null default 0,
  valor_corretora numeric(14,2) not null default 0,
  percentual_consultor numeric(6,3) not null default 0,
  valor_consultor numeric(14,2) not null default 0,
  status public.comissao_status not null default 'prevista',
  data_recebimento date,
  data_pagamento date,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index comissoes_cota_uniq on public.comissoes (cota_id) where cota_id is not null;
create unique index comissoes_apolice_uniq on public.comissoes (apolice_id) where apolice_id is not null;
create index on public.comissoes (consultor_id, competencia);
create index on public.comissoes (status);
create trigger trg_comissoes_updated before update on public.comissoes for each row execute function public.set_updated_at();

create or replace function public.gerar_comissao_cota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pct numeric := 0;
  v_cons numeric := 0;
begin
  if new.status in ('ativa','contemplada','quitada') and (tg_op = 'INSERT' or old.status = 'proposta') then
    select coalesce(pr.comissao_percentual, pa.comissao_padrao, 0) into v_pct
      from (select 1) x
      left join public.produtos pr on pr.id = new.produto_id
      left join public.parceiros pa on pa.id = new.administradora_id;
    select coalesce(p.comissao_percentual, 0) into v_cons from public.profiles p where p.id = new.consultor_id;
    insert into public.comissoes (linha, cota_id, cliente_id, consultor_id, descricao, base_calculo,
      percentual_corretora, valor_corretora, percentual_consultor, valor_consultor)
    values ('consorcio', new.id, new.cliente_id, new.consultor_id,
      'Consórcio grupo ' || coalesce(new.grupo,'-') || ' cota ' || coalesce(new.cota,'-'),
      new.valor_credito, coalesce(v_pct,0), round(new.valor_credito * coalesce(v_pct,0) / 100, 2),
      coalesce(v_cons,0), round(new.valor_credito * coalesce(v_pct,0) / 100 * coalesce(v_cons,0) / 100, 2))
    on conflict (cota_id) where cota_id is not null do nothing;
  elsif new.status = 'cancelada' and tg_op = 'UPDATE' and old.status <> 'cancelada' then
    update public.comissoes set status = 'estornada' where cota_id = new.id and status = 'prevista';
  end if;
  return new;
end $$;
create trigger trg_cota_comissao after insert or update of status on public.consorcio_cotas
  for each row execute function public.gerar_comissao_cota();

create or replace function public.gerar_comissao_apolice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cons numeric := 0;
  v_valor numeric;
begin
  if new.status = 'vigente' and (tg_op = 'INSERT' or old.status in ('cotacao','proposta')) then
    select coalesce(p.comissao_percentual, 0) into v_cons from public.profiles p where p.id = new.consultor_id;
    v_valor := round(new.premio_liquido * new.comissao_percentual / 100, 2);
    insert into public.comissoes (linha, apolice_id, cliente_id, consultor_id, descricao, base_calculo,
      percentual_corretora, valor_corretora, percentual_consultor, valor_consultor, competencia)
    values ('seguro', new.id, new.cliente_id, new.consultor_id,
      'Seguro ' || new.ramo || coalesce(' apólice ' || new.numero_apolice, ''),
      new.premio_liquido, new.comissao_percentual, v_valor,
      coalesce(v_cons,0), round(v_valor * coalesce(v_cons,0) / 100, 2),
      date_trunc('month', new.inicio_vigencia)::date)
    on conflict (apolice_id) where apolice_id is not null do nothing;
  elsif new.status = 'cancelada' and tg_op = 'UPDATE' and old.status <> 'cancelada' then
    update public.comissoes set status = 'estornada' where apolice_id = new.id and status = 'prevista';
  end if;
  return new;
end $$;
create trigger trg_apolice_comissao after insert or update of status on public.seguro_apolices
  for each row execute function public.gerar_comissao_apolice();

create table public.metas (
  id uuid primary key default gen_random_uuid(),
  consultor_id uuid references public.profiles(id) on delete cascade,
  periodo date not null,
  tipo public.meta_tipo not null,
  valor_meta numeric(14,2) not null check (valor_meta > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index metas_uniq on public.metas (coalesce(consultor_id, '00000000-0000-0000-0000-000000000000'::uuid), periodo, tipo);
create trigger trg_metas_updated before update on public.metas for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Agenda, tarefas, visitas (check-in do consultor externo)
-- ---------------------------------------------------------------------
create table public.agenda_eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 2 and 200),
  descricao text,
  tipo public.evento_tipo not null default 'reuniao',
  status public.evento_status not null default 'agendado',
  inicio timestamptz not null,
  fim timestamptz not null,
  dia_inteiro boolean not null default false,
  local text,
  link_reuniao text,
  cliente_id uuid references public.clientes(id) on delete set null,
  oportunidade_id uuid references public.oportunidades(id) on delete set null,
  responsavel_id uuid references public.profiles(id) on delete set null default auth.uid(),
  participantes uuid[] not null default '{}',
  lembrete_minutos int default 30,
  google_event_id text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fim >= inicio)
);
create index on public.agenda_eventos (responsavel_id, inicio);
create index on public.agenda_eventos (inicio);
create index on public.agenda_eventos (cliente_id);
create trigger trg_eventos_updated before update on public.agenda_eventos for each row execute function public.set_updated_at();

create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 2 and 200),
  descricao text,
  status public.tarefa_status not null default 'pendente',
  prioridade public.prioridade not null default 'media',
  vencimento date,
  responsavel_id uuid references public.profiles(id) on delete set null default auth.uid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  concluida_em timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.tarefas (responsavel_id, status);
create index on public.tarefas (cliente_id);
create trigger trg_tarefas_updated before update on public.tarefas for each row execute function public.set_updated_at();

create or replace function public.tarefa_conclusao()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.concluida_em := case when new.status = 'concluida' then coalesce(new.concluida_em, now()) else null end;
  return new;
end $$;
create trigger trg_tarefa_conclusao before insert or update on public.tarefas for each row execute function public.tarefa_conclusao();

create table public.visitas (
  id uuid primary key default gen_random_uuid(),
  consultor_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  evento_id uuid references public.agenda_eventos(id) on delete set null,
  checkin_em timestamptz not null default now(),
  checkin_lat double precision check (checkin_lat between -90 and 90),
  checkin_lng double precision check (checkin_lng between -180 and 180),
  checkin_precisao double precision,
  checkout_em timestamptz,
  resultado text,
  observacoes text,
  created_at timestamptz not null default now()
);
create index on public.visitas (consultor_id, checkin_em desc);

-- ---------------------------------------------------------------------
-- Documentos (Supabase Storage + Google Drive)
-- ---------------------------------------------------------------------
create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  cota_id uuid references public.consorcio_cotas(id) on delete set null,
  apolice_id uuid references public.seguro_apolices(id) on delete set null,
  nome text not null check (char_length(nome) between 1 and 255),
  categoria text not null default 'outros',
  storage_path text unique,
  mime_type text,
  tamanho bigint check (tamanho is null or tamanho <= 26214400),
  drive_file_id text,
  drive_url text,
  enviado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.documentos (cliente_id);

-- ---------------------------------------------------------------------
-- Notificações, integrações, auditoria
-- ---------------------------------------------------------------------
create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  mensagem text,
  link text,
  lida boolean not null default false,
  chave text,
  created_at timestamptz not null default now()
);
create index on public.notificacoes (user_id, lida, created_at desc);
create unique index notificacoes_chave_uniq on public.notificacoes (user_id, chave) where chave is not null;

-- Tokens OAuth do Google: criptografados na aplicação (AES-256-GCM) e
-- acessíveis SOMENTE pelo service role (RLS habilitado sem políticas).
create table public.integracoes_google (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  google_email text,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  scopes text,
  calendar_id text not null default 'primary',
  drive_root_folder_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_integracoes_updated before update on public.integracoes_google for each row execute function public.set_updated_at();

create or replace function public.google_integracao_status()
returns table (conectado boolean, google_email text, atualizado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select true, g.google_email, g.updated_at from public.integracoes_google g where g.user_id = auth.uid()
$$;

create table public.configuracoes (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid()
);
create trigger trg_config_updated before update on public.configuracoes for each row execute function public.set_updated_at();

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  acao text not null,
  tabela text not null,
  registro_id text,
  dados_antigos jsonb,
  dados_novos jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (created_at desc);
create index on public.audit_logs (tabela, registro_id);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  v_id text := coalesce(v_new->>'id', v_old->>'id', v_new->>'user_id', v_old->>'user_id', v_new->>'chave');
begin
  -- nunca registrar segredos
  v_old := v_old - 'access_token_enc' - 'refresh_token_enc';
  v_new := v_new - 'access_token_enc' - 'refresh_token_enc';
  insert into public.audit_logs (actor_id, actor_email, acao, tabela, registro_id, dados_antigos, dados_novos)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), tg_op, tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','parceiros','produtos','clientes','oportunidades','consorcio_cotas',
    'consorcio_lances','seguro_apolices','seguro_sinistros','comissoes','metas','documentos','configuracoes']
  loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- Interação automática na linha do tempo do cliente
create or replace function public.registrar_interacao_sistema()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_msg text;
begin
  if tg_table_name = 'consorcio_cotas' then
    if tg_op = 'INSERT' then v_msg := 'Cota de consórcio cadastrada (' || new.categoria || ', crédito R$ ' || to_char(new.valor_credito, 'FM999G999G990D00') || ')';
    elsif old.status is distinct from new.status then v_msg := 'Cota de consórcio: status alterado para ' || new.status;
    end if;
  elsif tg_table_name = 'seguro_apolices' then
    if tg_op = 'INSERT' then v_msg := 'Seguro ' || new.ramo || ' cadastrado (vigência até ' || to_char(new.fim_vigencia, 'DD/MM/YYYY') || ')';
    elsif old.status is distinct from new.status then v_msg := 'Seguro ' || new.ramo || ': status alterado para ' || new.status;
    end if;
  elsif tg_table_name = 'oportunidades' then
    if tg_op = 'INSERT' then v_msg := 'Oportunidade criada: ' || new.titulo;
    elsif old.etapa is distinct from new.etapa then v_msg := 'Oportunidade "' || new.titulo || '" movida para ' || new.etapa;
    end if;
  end if;
  if v_msg is not null then
    insert into public.interacoes (cliente_id, tipo, descricao, autor_id) values (new.cliente_id, 'sistema', v_msg, auth.uid());
  end if;
  return new;
end $$;
create trigger trg_hist_cotas after insert or update on public.consorcio_cotas for each row execute function public.registrar_interacao_sistema();
create trigger trg_hist_apolices after insert or update on public.seguro_apolices for each row execute function public.registrar_interacao_sistema();
create trigger trg_hist_oport after insert or update on public.oportunidades for each row execute function public.registrar_interacao_sistema();

-- ---------------------------------------------------------------------
-- Alertas automáticos (renovações em 30 dias, tarefas vencidas)
-- ---------------------------------------------------------------------
create or replace function public.gerar_alertas()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; r record;
begin
  for r in
    select a.id, a.ramo, a.fim_vigencia, a.consultor_id, c.nome
      from public.seguro_apolices a join public.clientes c on c.id = a.cliente_id
     where a.status = 'vigente' and a.fim_vigencia between current_date and current_date + 30
  loop
    insert into public.notificacoes (user_id, titulo, mensagem, link, chave)
    select u.id, 'Renovação próxima',
      'Seguro ' || r.ramo || ' de ' || r.nome || ' vence em ' || to_char(r.fim_vigencia, 'DD/MM/YYYY'),
      '/seguros/' || r.id, 'renov:' || r.id
      from public.profiles u
     where u.active and (u.id = r.consultor_id or u.role in ('admin','gestor'))
    on conflict (user_id, chave) where chave is not null do nothing;
    get diagnostics n = row_count;
  end loop;

  update public.seguro_apolices set status = 'vencida'
   where status = 'vigente' and fim_vigencia < current_date;

  insert into public.notificacoes (user_id, titulo, mensagem, link, chave)
  select t.responsavel_id, 'Tarefa atrasada', t.titulo, '/tarefas', 'tarefa:' || t.id
    from public.tarefas t
   where t.status <> 'concluida' and t.vencimento < current_date and t.responsavel_id is not null
  on conflict (user_id, chave) where chave is not null do nothing;
  return n;
end $$;
revoke execute on function public.gerar_alertas() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Busca global e indicadores do painel (respeitam RLS: SECURITY INVOKER)
-- ---------------------------------------------------------------------
create or replace function public.busca_global(termo text)
returns table (tipo text, id uuid, titulo text, subtitulo text, link text)
language sql stable security invoker set search_path = '' as $$
  (select 'cliente', c.id, c.nome, coalesce(c.documento, c.email, c.telefone, ''), '/clientes/' || c.id
     from public.clientes c
    where c.nome ilike '%' || termo || '%' or c.documento ilike '%' || termo || '%' or c.email ilike '%' || termo || '%'
    order by c.nome limit 8)
  union all
  (select 'consorcio', q.id, 'Consórcio ' || coalesce(q.grupo,'') || '/' || coalesce(q.cota,''), q.categoria, '/consorcios/' || q.id
     from public.consorcio_cotas q
    where q.grupo ilike '%' || termo || '%' or q.cota ilike '%' || termo || '%' or q.numero_contrato ilike '%' || termo || '%'
    limit 5)
  union all
  (select 'seguro', a.id, 'Apólice ' || coalesce(a.numero_apolice, a.numero_proposta, 's/n'), a.ramo || coalesce(' · ' || a.item_segurado, ''), '/seguros/' || a.id
     from public.seguro_apolices a
    where a.numero_apolice ilike '%' || termo || '%' or a.numero_proposta ilike '%' || termo || '%' or a.item_segurado ilike '%' || termo || '%'
    limit 5)
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.parceiros enable row level security;
alter table public.produtos enable row level security;
alter table public.clientes enable row level security;
alter table public.interacoes enable row level security;
alter table public.oportunidades enable row level security;
alter table public.consorcio_cotas enable row level security;
alter table public.consorcio_lances enable row level security;
alter table public.seguro_apolices enable row level security;
alter table public.seguro_sinistros enable row level security;
alter table public.comissoes enable row level security;
alter table public.metas enable row level security;
alter table public.agenda_eventos enable row level security;
alter table public.tarefas enable row level security;
alter table public.visitas enable row level security;
alter table public.documentos enable row level security;
alter table public.notificacoes enable row level security;
alter table public.integracoes_google enable row level security;
alter table public.configuracoes enable row level security;
alter table public.audit_logs enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- parceiros / produtos: leitura para usuários ativos; escrita gestão
create policy parceiros_select on public.parceiros for select to authenticated using (public.is_active_user());
create policy parceiros_write on public.parceiros for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy produtos_select on public.produtos for select to authenticated using (public.is_active_user());
create policy produtos_write on public.produtos for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- clientes
create policy clientes_select on public.clientes for select to authenticated using (public.can_access_cliente(id));
create policy clientes_insert on public.clientes for insert to authenticated
  with check (public.is_active_user() and public.current_app_role() <> 'financeiro' or public.is_manager());
create policy clientes_update on public.clientes for update to authenticated
  using (public.is_manager() or (public.is_active_user() and (consultor_id = auth.uid() or created_by = auth.uid())))
  with check (public.is_manager() or (public.is_active_user() and (consultor_id = auth.uid() or created_by = auth.uid())));
create policy clientes_delete on public.clientes for delete to authenticated using (public.is_manager());

-- interações
create policy interacoes_select on public.interacoes for select to authenticated using (public.can_access_cliente(cliente_id));
create policy interacoes_insert on public.interacoes for insert to authenticated
  with check (public.can_access_cliente(cliente_id) and autor_id = auth.uid());
create policy interacoes_delete on public.interacoes for delete to authenticated
  using (public.is_manager() or (autor_id = auth.uid() and tipo <> 'sistema'));

-- Política padrão para tabelas de negócio com consultor_id
do $$
declare t text;
begin
  foreach t in array array['oportunidades','consorcio_cotas','seguro_apolices'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using (public.is_backoffice() or (public.is_active_user() and (consultor_id = auth.uid() or created_by = auth.uid())));
      create policy %1$s_insert on public.%1$I for insert to authenticated
        with check (public.is_manager() or (public.has_role(array['consultor','consultor_externo']::public.app_role[]) and public.can_access_cliente(cliente_id)));
      create policy %1$s_update on public.%1$I for update to authenticated
        using (public.is_manager() or (public.is_active_user() and public.current_app_role() <> 'financeiro' and (consultor_id = auth.uid() or created_by = auth.uid())))
        with check (public.is_manager() or (public.is_active_user() and (consultor_id = auth.uid() or created_by = auth.uid())));
      create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_manager());
    $f$, t);
  end loop;
end $$;

-- lances / sinistros: herdam o acesso do registro pai
create policy lances_select on public.consorcio_lances for select to authenticated
  using (exists (select 1 from public.consorcio_cotas q where q.id = cota_id));
create policy lances_write on public.consorcio_lances for insert to authenticated
  with check (exists (select 1 from public.consorcio_cotas q where q.id = cota_id) and public.current_app_role() <> 'financeiro');
create policy lances_update on public.consorcio_lances for update to authenticated
  using (exists (select 1 from public.consorcio_cotas q where q.id = cota_id) and public.current_app_role() <> 'financeiro');
create policy lances_delete on public.consorcio_lances for delete to authenticated using (public.is_manager());

create policy sinistros_select on public.seguro_sinistros for select to authenticated
  using (exists (select 1 from public.seguro_apolices a where a.id = apolice_id));
create policy sinistros_insert on public.seguro_sinistros for insert to authenticated
  with check (exists (select 1 from public.seguro_apolices a where a.id = apolice_id));
create policy sinistros_update on public.seguro_sinistros for update to authenticated
  using (exists (select 1 from public.seguro_apolices a where a.id = apolice_id));
create policy sinistros_delete on public.seguro_sinistros for delete to authenticated using (public.is_manager());

-- comissões: back-office vê e edita; consultor vê as próprias
create policy comissoes_select on public.comissoes for select to authenticated
  using (public.is_backoffice() or (public.is_active_user() and consultor_id = auth.uid()));
create policy comissoes_write on public.comissoes for all to authenticated
  using (public.has_role(array['admin','gestor','financeiro']::public.app_role[]))
  with check (public.has_role(array['admin','gestor','financeiro']::public.app_role[]));

-- metas
create policy metas_select on public.metas for select to authenticated
  using (public.is_backoffice() or (public.is_active_user() and (consultor_id = auth.uid() or consultor_id is null)));
create policy metas_write on public.metas for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- agenda
create policy eventos_select on public.agenda_eventos for select to authenticated
  using (public.is_manager() or (public.is_active_user() and (responsavel_id = auth.uid() or created_by = auth.uid() or auth.uid() = any(participantes))));
create policy eventos_insert on public.agenda_eventos for insert to authenticated
  with check (public.is_active_user() and (public.is_manager() or responsavel_id = auth.uid())
              and (cliente_id is null or public.can_access_cliente(cliente_id)));
create policy eventos_update on public.agenda_eventos for update to authenticated
  using (public.is_manager() or (public.is_active_user() and (responsavel_id = auth.uid() or created_by = auth.uid())))
  with check (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid());
create policy eventos_delete on public.agenda_eventos for delete to authenticated
  using (public.is_manager() or created_by = auth.uid() or responsavel_id = auth.uid());

-- tarefas
create policy tarefas_select on public.tarefas for select to authenticated
  using (public.is_manager() or (public.is_active_user() and (responsavel_id = auth.uid() or created_by = auth.uid())));
create policy tarefas_insert on public.tarefas for insert to authenticated
  with check (public.is_active_user() and (public.is_manager() or responsavel_id = auth.uid()));
create policy tarefas_update on public.tarefas for update to authenticated
  using (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid())
  with check (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid());
create policy tarefas_delete on public.tarefas for delete to authenticated
  using (public.is_manager() or created_by = auth.uid());

-- visitas
create policy visitas_select on public.visitas for select to authenticated
  using (public.is_manager() or consultor_id = auth.uid());
create policy visitas_insert on public.visitas for insert to authenticated
  with check (public.is_active_user() and consultor_id = auth.uid() and (cliente_id is null or public.can_access_cliente(cliente_id)));
create policy visitas_update on public.visitas for update to authenticated
  using (consultor_id = auth.uid() or public.is_manager()) with check (consultor_id = auth.uid() or public.is_manager());

-- documentos
create policy documentos_select on public.documentos for select to authenticated
  using (public.is_backoffice() or (cliente_id is not null and public.can_access_cliente(cliente_id)));
create policy documentos_insert on public.documentos for insert to authenticated
  with check (public.is_active_user() and enviado_por = auth.uid() and (cliente_id is null and public.is_backoffice() or public.can_access_cliente(cliente_id)));
create policy documentos_update on public.documentos for update to authenticated
  using (public.is_manager() or enviado_por = auth.uid()) with check (public.is_manager() or enviado_por = auth.uid());
create policy documentos_delete on public.documentos for delete to authenticated
  using (public.is_manager() or enviado_por = auth.uid());

-- notificações
create policy notificacoes_select on public.notificacoes for select to authenticated using (user_id = auth.uid());
create policy notificacoes_update on public.notificacoes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notificacoes_delete on public.notificacoes for delete to authenticated using (user_id = auth.uid());

-- configurações e auditoria
create policy config_select on public.configuracoes for select to authenticated using (public.is_active_user());
create policy config_write on public.configuracoes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy audit_select on public.audit_logs for select to authenticated using (public.is_admin());
-- integracoes_google: sem políticas => somente service role.

-- Permissões: anon não acessa nada do schema public; funções só para authenticated
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;
grant execute on function public.current_app_role(), public.is_active_user(), public.has_role(public.app_role[]),
  public.is_manager(), public.is_backoffice(), public.is_admin(), public.can_access_cliente(uuid),
  public.busca_global(text), public.google_integracao_status() to authenticated;
revoke execute on function public.handle_new_user(), public.audit_trigger(), public.gerar_alertas(),
  public.protect_profile_privileges(), public.enforce_own_consultor(), public.gerar_comissao_cota(),
  public.gerar_comissao_apolice(), public.lance_contempla_cota(), public.registrar_interacao_sistema()
  from authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket privado de documentos
-- caminho: clientes/<cliente_id>/<arquivo>  ou  geral/<arquivo>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 26214400,
  array['application/pdf','image/png','image/jpeg','image/webp','image/heic',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain','text/csv'])
on conflict (id) do nothing;

create or replace function public.storage_can_access(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_id uuid;
begin
  if not public.is_active_user() then return false; end if;
  if v_parts[1] = 'clientes' and array_length(v_parts, 1) >= 3 then
    begin v_id := v_parts[2]::uuid; exception when others then return false; end;
    return public.can_access_cliente(v_id);
  elsif v_parts[1] = 'geral' then
    return public.is_backoffice();
  end if;
  return false;
end $$;

grant execute on function public.storage_can_access(text) to authenticated;
revoke execute on function public.storage_can_access(text) from public, anon;

create policy documentos_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.storage_can_access(name));
create policy documentos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.storage_can_access(name));
create policy documentos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (public.is_manager() or owner = auth.uid()) and public.storage_can_access(name));

-- ---------------------------------------------------------------------
-- Dados iniciais
-- ---------------------------------------------------------------------
insert into public.configuracoes (chave, valor) values
  ('empresa', jsonb_build_object('nome', 'EASY Consórcio & Seguros', 'sistema', 'GE EASY — Gestão Especializada EASY')),
  ('comercial', jsonb_build_object('dias_alerta_renovacao', 30, 'moeda', 'BRL'))
on conflict do nothing;
