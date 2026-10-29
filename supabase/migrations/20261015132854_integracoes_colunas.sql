-- =====================================================================
-- GE EASY — Integrações jurídicas (DataJud, DJEN, Google Agenda, Drive)
-- e camada adicional de segurança / proteção de dados (LGPD)
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Processos: monitoramento DataJud e pasta no Drive
-- ---------------------------------------------------------------------
alter table public.processos
  add column if not exists datajud_monitorar boolean not null default true,
  add column if not exists datajud_sincronizado_em timestamptz,
  add column if not exists datajud_atualizado_em timestamptz,
  add column if not exists datajud_status text check (datajud_status is null or datajud_status in ('ok', 'nao_encontrado', 'erro', 'indisponivel')),
  add column if not exists datajud_erro text,
  add column if not exists drive_folder_id text;
create index if not exists processos_datajud_fila on public.processos (datajud_sincronizado_em nulls first)
  where datajud_monitorar and numero_cnj is not null;

-- Andamentos: origem + id externo (não duplica movimentos do DataJud)
alter table public.processo_andamentos
  add column if not exists origem text not null default 'manual' check (origem in ('manual', 'sistema', 'datajud', 'publicacao')),
  add column if not exists externo_id text,
  add column if not exists data_hora timestamptz;
create unique index if not exists processo_andamentos_externo_uniq on public.processo_andamentos (processo_id, externo_id) where externo_id is not null;

-- Prazos: evento no Google Agenda do responsável
alter table public.prazos add column if not exists google_event_id text;

-- Publicações: dados de origem do DJEN
alter table public.publicacoes
  add column if not exists origem text not null default 'manual' check (origem in ('manual', 'djen')),
  add column if not exists tribunal text,
  add column if not exists orgao text,
  add column if not exists tipo_comunicacao text,
  add column if not exists link text,
  add column if not exists oab text;

-- Documentos: estado do arquivamento no Drive do escritório
alter table public.documentos
  add column if not exists drive_status text not null default 'pendente' check (drive_status in ('pendente', 'sincronizado', 'erro', 'ignorado')),
  add column if not exists drive_erro text,
  add column if not exists drive_tentativas int not null default 0,
  add column if not exists drive_sincronizado_em timestamptz;
create index if not exists documentos_drive_fila on public.documentos (created_at) where drive_status in ('pendente', 'erro');

-- Cache das pastas do Drive (chave lógica -> id da pasta). Só o service role usa.
create table if not exists public.drive_pastas (
  chave text primary key check (char_length(chave) <= 200),
  folder_id text not null,
  created_at timestamptz not null default now()
);
alter table public.drive_pastas enable row level security;
create policy drive_pastas_select on public.drive_pastas for select to authenticated using (public.is_admin());

-- Registro das execuções de integração (painel do administrador)
create table if not exists public.integracoes_log (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('datajud', 'djen', 'drive', 'agenda', 'cron')),
  status text not null check (status in ('ok', 'erro', 'parcial')),
  mensagem text check (char_length(mensagem) <= 1000),
  detalhes jsonb,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists integracoes_log_recentes on public.integracoes_log (created_at desc);
alter table public.integracoes_log enable row level security;
create policy integracoes_log_select on public.integracoes_log for select to authenticated using (public.is_manager());

