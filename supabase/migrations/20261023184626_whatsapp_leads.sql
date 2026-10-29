-- =====================================================================
-- GE EASY — Fase 6: captação de leads e atendimento por WhatsApp (Cloud API oficial da Meta)
--
-- * leads de todas as fontes com deduplicação (telefone/CPF/e-mail), pontuação por regras,
--   distribuição automática (carteira, cidade, DDD, origem, interesse; rodízio ou menor carga),
--   SLA de primeiro contato com redistribuição e aviso ao supervisor, conversão em cliente;
-- * WhatsApp: números da empresa (token só para o servidor), contatos com opt-in/opt-out,
--   conversas com fila/atendente/janela de 24 h/SLA, mensagens particionadas por mês, modelos
--   aprovados, campanhas com opt-in e limite por hora, fila de webhooks idempotente;
-- * regra dos 45 dias e desligamento também movem conversas e leads.
-- =====================================================================

create type public.lead_status as enum ('novo', 'em_contato', 'qualificado', 'convertido', 'descartado');
create type public.wa_conversa_status as enum ('aberta', 'aguardando_cliente', 'aguardando_atendente', 'resolvida', 'arquivada');

-- telefone normalizado (E.164 sem "+"; números brasileiros ganham o 55)
create or replace function public.telefone_e164(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) in (10, 11) then '55' || regexp_replace(p, '\D', '', 'g')
    when length(regexp_replace(p, '\D', '', 'g')) between 12 and 15 then regexp_replace(p, '\D', '', 'g')
    else null end
$$;

-- ---------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 1 and 200),
  telefone text check (telefone is null or telefone ~ '^\d{12,15}$'),
  email text check (email is null or char_length(email) <= 200),
  documento text check (documento is null or documento ~ '^\d{11}$|^\d{14}$'),
  cidade text check (char_length(cidade) <= 120),
  uf char(2),
  origem text not null default 'outro' check (origem in ('whatsapp', 'site', 'lead_ads', 'indicacao', 'consultor', 'importacao', 'outro')),
  campanha text check (char_length(campanha) <= 200),
  utm jsonb,
  interesse text check (char_length(interesse) <= 500),
  renda_informada numeric(19,2) check (renda_informada is null or renda_informada >= 0),
  score int not null default 0 check (score between 0 and 100),
  status public.lead_status not null default 'novo',
  motivo_descarte text check (char_length(motivo_descarte) <= 500),
  responsavel_id uuid references public.profiles(id) on delete set null,
  departamento_id uuid references public.departamentos(id) on delete set null,
  atribuido_em timestamptz,
  primeiro_contato_em timestamptz,
  sla_ate timestamptz,
  sla_estourado boolean not null default false,
  redistribuicoes int not null default 0,
  cliente_id uuid references public.clientes(id) on delete set null,
  convertido_em timestamptz,
  observacoes text check (char_length(observacoes) <= 4000),
  dados jsonb,
  excluido_em timestamptz,
  excluido_por uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.leads (empresa_id, created_at desc);
create index on public.leads (empresa_id, status, responsavel_id);
create index on public.leads (empresa_id, telefone) where telefone is not null;
create index on public.leads (empresa_id, documento) where documento is not null;
create index on public.leads (empresa_id, origem, campanha);
create index on public.leads (sla_ate) where status = 'novo' and primeiro_contato_em is null;
create trigger trg_leads_updated before update on public.leads for each row execute function public.set_updated_at();
create trigger zz_empresa_vinculos before insert or update on public.leads
  for each row execute function public.empresa_vinculos('cliente_id:clientes', 'departamento_id:departamentos', 'responsavel_id:@');
create trigger trg_audit_leads after insert or update or delete on public.leads for each row execute function public.audit_trigger();
create policy leads_nao_excluido on public.leads as restrictive for select to authenticated using (excluido_em is null);
create trigger trg_exclusao_logica before delete on public.leads for each row execute function public.exclusao_logica();

-- Regras de distribuição (leads e conversas de WhatsApp), em ordem
create table public.distribuicao_regras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  ordem int not null default 1 check (ordem between 1 and 1000),
  nome text not null check (char_length(nome) between 2 and 120),
  criterio text not null check (criterio in ('qualquer', 'cidade', 'ddd', 'origem', 'interesse', 'campanha')),
  valor text check (char_length(valor) <= 200),
  aplica_leads boolean not null default true,
  aplica_whatsapp boolean not null default true,
  departamento_id uuid references public.departamentos(id) on delete set null,
  membros uuid[] not null default '{}',
  modo text not null default 'rodizio' check (modo in ('rodizio', 'menor_carga')),
  ultimo_indice int not null default -1,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.distribuicao_regras (empresa_id, ordem) where ativo;
create trigger zz_empresa_vinculos before insert or update on public.distribuicao_regras
  for each row execute function public.empresa_vinculos('departamento_id:departamentos', 'membros:@');
create trigger trg_audit_distribuicao_regras after insert or update or delete on public.distribuicao_regras for each row execute function public.audit_trigger();

create or replace function public.parametros_leads(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('sla_minutos', 15, 'max_redistribuicoes', 3)
         || coalesce((select c.valor from public.configuracoes c where c.empresa_id = p_empresa and c.chave = 'leads'), '{}'::jsonb)
$$;
revoke execute on function public.parametros_leads(uuid) from public, anon, authenticated;

-- Pontuação (0–100) por regras simples e configuráveis no futuro: origem, dados completos, renda, interesse
create or replace function public.lead_pontuar(l public.leads)
returns int language sql immutable set search_path = '' as $$
  select least(100,
      case l.origem when 'indicacao' then 30 when 'consultor' then 25 when 'whatsapp' then 20 when 'site' then 15 when 'lead_ads' then 10 else 5 end
    + case when l.documento is not null then 15 else 0 end
    + case when l.email is not null then 5 else 0 end
    + case when l.telefone is not null then 10 else 0 end
    + case when l.renda_informada >= 8000 then 25 when l.renda_informada >= 3000 then 15 when l.renda_informada > 0 then 5 else 0 end
    + case when coalesce(trim(l.interesse), '') <> '' then 10 else 0 end
    + case when l.cidade is not null then 5 else 0 end)
$$;

