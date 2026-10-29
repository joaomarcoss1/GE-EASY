-- =====================================================================
-- GE EASY — Núcleo jurídico e gestão por departamentos
-- Processos, partes, andamentos, prazos, audiências, financeiro do processo,
-- departamentos e membros. Acesso por departamento/equipe via RLS.
-- =====================================================================

create type public.processo_area as enum ('civel', 'consumidor', 'trabalhista', 'tributario', 'previdenciario', 'familia', 'criminal', 'administrativo', 'empresarial', 'bancario', 'outro');
create type public.processo_status as enum ('ativo', 'suspenso', 'arquivado', 'encerrado');
create type public.processo_fase as enum ('pre_processual', 'conhecimento', 'recursal', 'execucao', 'cumprimento_sentenca', 'acordo', 'transito_julgado');
create type public.processo_risco as enum ('provavel', 'possivel', 'remoto');
create type public.processo_polo as enum ('ativo', 'passivo', 'terceiro');
create type public.parte_tipo as enum ('autor', 'reu', 'terceiro', 'advogado_contrario', 'perito', 'testemunha');
create type public.andamento_tipo as enum ('publicacao', 'despacho', 'decisao', 'sentenca', 'acordao', 'peticao', 'audiencia', 'juntada', 'citacao', 'intimacao', 'outro');
create type public.prazo_status as enum ('pendente', 'cumprido', 'perdido', 'cancelado');
create type public.prazo_contagem as enum ('uteis', 'corridos');
create type public.audiencia_tipo as enum ('conciliacao', 'instrucao', 'una', 'julgamento', 'mediacao', 'outra');
create type public.audiencia_status as enum ('agendada', 'realizada', 'redesignada', 'cancelada');
create type public.lancamento_tipo as enum ('custas', 'despesa', 'honorarios_contratuais', 'honorarios_sucumbenciais', 'honorarios_exito', 'acordo', 'condenacao', 'deposito_judicial');
create type public.lancamento_status as enum ('previsto', 'pago', 'recebido', 'cancelado');

-- ---------------------------------------------------------------------
-- Departamentos
-- ---------------------------------------------------------------------
create table public.departamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (char_length(nome) between 2 and 120),
  sigla text,
  descricao text,
  cor text not null default 'brand',
  responsavel_id uuid references public.profiles(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_departamentos_updated before update on public.departamentos for each row execute function public.set_updated_at();

create table public.departamento_membros (
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  funcao text not null default 'membro' check (funcao in ('responsavel', 'membro')),
  created_at timestamptz not null default now(),
  primary key (departamento_id, user_id)
);
create index on public.departamento_membros (user_id);

alter table public.profiles add column if not exists oab text;

create or replace function public.is_juridico()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin','gestor','advogado','assistente_juridico']::public.app_role[])
$$;

create or replace function public.is_membro_departamento(p_dep uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_dep is not null and public.is_active_user() and (
    exists (select 1 from public.departamento_membros m where m.departamento_id = p_dep and m.user_id = auth.uid())
    or exists (select 1 from public.departamentos d where d.id = p_dep and d.responsavel_id = auth.uid())
  )
$$;

create or replace function public.is_responsavel_departamento(p_dep uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_dep is not null and public.is_active_user() and (
    exists (select 1 from public.departamentos d where d.id = p_dep and d.responsavel_id = auth.uid())
    or exists (select 1 from public.departamento_membros m where m.departamento_id = p_dep and m.user_id = auth.uid() and m.funcao = 'responsavel')
  )
$$;

-- ---------------------------------------------------------------------
-- Processos
-- ---------------------------------------------------------------------
create table public.processos (
  id uuid primary key default gen_random_uuid(),
  numero_cnj text,
  numero_interno text,
  titulo text not null check (char_length(titulo) between 2 and 250),
  cliente_id uuid references public.clientes(id) on delete set null,
  polo_cliente public.processo_polo not null default 'ativo',
  parte_contraria text,
  area public.processo_area not null default 'civel',
  classe text,
  assunto text,
  tribunal text,
  orgao text,
  comarca text,
  uf char(2),
  instancia smallint not null default 1 check (instancia between 1 and 4),
  fase public.processo_fase not null default 'conhecimento',
  status public.processo_status not null default 'ativo',
  risco public.processo_risco,
  valor_causa numeric(16,2) check (valor_causa is null or valor_causa >= 0),
  valor_provisionado numeric(16,2) check (valor_provisionado is null or valor_provisionado >= 0),
  data_distribuicao date,
  data_encerramento date,
  resultado text,
  segredo_justica boolean not null default false,
  link_autos text,
  departamento_id uuid references public.departamentos(id) on delete set null,
  responsavel_id uuid references public.profiles(id) on delete set null default auth.uid(),
  equipe uuid[] not null default '{}',
  tags text[] not null default '{}',
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index processos_cnj_uniq on public.processos (numero_cnj) where numero_cnj is not null and numero_cnj <> '';
create index on public.processos (cliente_id);
create index on public.processos (departamento_id);
create index on public.processos (responsavel_id);
create index on public.processos (status, area);
create index processos_titulo_trgm on public.processos using gin (titulo extensions.gin_trgm_ops);
create trigger trg_processos_updated before update on public.processos for each row execute function public.set_updated_at();

create or replace function public.processo_encerramento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('arquivado','encerrado') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.data_encerramento := coalesce(new.data_encerramento, (now() at time zone 'America/Sao_Paulo')::date);
  elsif new.status in ('ativo','suspenso') then
    new.data_encerramento := null;
  end if;
  return new;
end $$;
create trigger trg_processo_encerramento before insert or update of status on public.processos
  for each row execute function public.processo_encerramento();

-- Acesso ao processo: gestão vê tudo; demais jurídicos veem os do seu departamento,
-- os que são responsáveis/equipe ou que criaram; financeiro lê todos.
create or replace function public.can_access_processo(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.processos p
     where p.id = p_id and public.is_active_user() and (
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
     where p.id = p_id and public.is_juridico() and (
       public.is_manager()
       or p.responsavel_id = auth.uid() or p.created_by = auth.uid() or auth.uid() = any(p.equipe)
       or public.is_membro_departamento(p.departamento_id)
     )
  )
$$;

create table public.processo_partes (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  tipo public.parte_tipo not null default 'reu',
  nome text not null check (char_length(nome) between 2 and 200),
  documento text,
  oab text,
  contato text,
  observacoes text,
  created_at timestamptz not null default now()
);
create index on public.processo_partes (processo_id);

create table public.processo_andamentos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  tipo public.andamento_tipo not null default 'outro',
  descricao text not null check (char_length(descricao) between 2 and 10000),
  autor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.processo_andamentos (processo_id, data desc);

create table public.prazos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid references public.processos(id) on delete cascade,
  descricao text not null check (char_length(descricao) between 2 and 300),
  data_publicacao date,
  dias int check (dias is null or dias between 0 and 365),
  contagem public.prazo_contagem not null default 'uteis',
  data_fim date not null,
  fatal boolean not null default true,
  prioridade public.prioridade not null default 'alta',
  status public.prazo_status not null default 'pendente',
  responsavel_id uuid references public.profiles(id) on delete set null default auth.uid(),
  departamento_id uuid references public.departamentos(id) on delete set null,
  cumprido_em timestamptz,
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.prazos (status, data_fim);
create index on public.prazos (responsavel_id, data_fim);
create index on public.prazos (processo_id);
create trigger trg_prazos_updated before update on public.prazos for each row execute function public.set_updated_at();

create or replace function public.prazo_cumprimento()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.cumprido_em := case when new.status = 'cumprido' then coalesce(new.cumprido_em, now()) else null end;
  -- herda o departamento do processo
  if new.departamento_id is null and new.processo_id is not null then
    select p.departamento_id into new.departamento_id from public.processos p where p.id = new.processo_id;
  end if;
  return new;
end $$;
create trigger trg_prazo_cumprimento before insert or update on public.prazos for each row execute function public.prazo_cumprimento();

create table public.audiencias (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  tipo public.audiencia_tipo not null default 'conciliacao',
  data_hora timestamptz not null,
  duracao_min int not null default 60 check (duracao_min between 5 and 720),
  modalidade text not null default 'presencial' check (modalidade in ('presencial', 'virtual', 'hibrida')),
  local text,
  link text,
  responsavel_id uuid references public.profiles(id) on delete set null default auth.uid(),
  preposto text,
  status public.audiencia_status not null default 'agendada',
  resultado text,
  agenda_evento_id uuid references public.agenda_eventos(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.audiencias (data_hora);
create index on public.audiencias (processo_id);
create trigger trg_audiencias_updated before update on public.audiencias for each row execute function public.set_updated_at();

create table public.processo_lancamentos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  tipo public.lancamento_tipo not null,
  descricao text,
  valor numeric(16,2) not null check (valor >= 0),
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  vencimento date,
  status public.lancamento_status not null default 'previsto',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.processo_lancamentos (processo_id);
create trigger trg_lancamentos_updated before update on public.processo_lancamentos for each row execute function public.set_updated_at();

-- Vínculos com módulos existentes
alter table public.tarefas add column if not exists processo_id uuid references public.processos(id) on delete set null;
alter table public.tarefas add column if not exists departamento_id uuid references public.departamentos(id) on delete set null;
alter table public.documentos add column if not exists processo_id uuid references public.processos(id) on delete set null;
alter table public.agenda_eventos add column if not exists processo_id uuid references public.processos(id) on delete set null;
create index on public.tarefas (departamento_id);
create index on public.tarefas (processo_id);
create index on public.documentos (processo_id);
create index on public.agenda_eventos (processo_id);

-- Andamento automático na linha do tempo do processo
create or replace function public.registrar_andamento_sistema()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_msg text; v_proc uuid; v_tipo public.andamento_tipo := 'outro';
begin
  if tg_table_name = 'audiencias' then
    v_proc := new.processo_id; v_tipo := 'audiencia';
    if tg_op = 'INSERT' then v_msg := 'Audiência (' || new.tipo || ') agendada para ' || to_char(new.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    elsif old.status is distinct from new.status then v_msg := 'Audiência de ' || to_char(new.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ': ' || new.status || coalesce(' — ' || new.resultado, '');
    elsif old.data_hora is distinct from new.data_hora then v_msg := 'Audiência redesignada para ' || to_char(new.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    end if;
  elsif tg_table_name = 'prazos' and new.processo_id is not null then
    v_proc := new.processo_id;
    if tg_op = 'INSERT' then v_msg := 'Prazo cadastrado: ' || new.descricao || ' (vence ' || to_char(new.data_fim, 'DD/MM/YYYY') || ')';
    elsif old.status is distinct from new.status then v_msg := 'Prazo "' || new.descricao || '": ' || new.status;
    end if;
  elsif tg_table_name = 'processos' and tg_op = 'UPDATE' then
    v_proc := new.id;
    if old.fase is distinct from new.fase then v_msg := 'Fase alterada para ' || new.fase;
    elsif old.status is distinct from new.status then v_msg := 'Situação alterada para ' || new.status;
    end if;
  end if;
  if v_msg is not null and v_proc is not null then
    insert into public.processo_andamentos (processo_id, tipo, descricao, autor_id) values (v_proc, v_tipo, v_msg, auth.uid());
  end if;
  return new;
end $$;
create trigger trg_andamento_audiencias after insert or update on public.audiencias for each row execute function public.registrar_andamento_sistema();
create trigger trg_andamento_prazos after insert or update on public.prazos for each row execute function public.registrar_andamento_sistema();
create trigger trg_andamento_processos after update on public.processos for each row execute function public.registrar_andamento_sistema();

-- Auditoria nas novas tabelas
do $$
declare t text;
begin
  foreach t in array array['departamentos','departamento_membros','processos','processo_partes','prazos','audiencias','processo_lancamentos'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Clientes: equipe jurídica enxerga a base de clientes
-- ---------------------------------------------------------------------
create or replace function public.can_access_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_backoffice() or public.is_juridico() or exists (
    select 1 from public.clientes c
    where c.id = p_cliente and public.is_active_user()
      and (c.consultor_id = auth.uid() or c.created_by = auth.uid())
  )
$$;
alter policy clientes_select on public.clientes
  using (public.is_backoffice() or public.is_juridico() or (public.is_active_user() and (consultor_id = auth.uid() or created_by = auth.uid())));

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.departamentos enable row level security;
alter table public.departamento_membros enable row level security;
alter table public.processos enable row level security;
alter table public.processo_partes enable row level security;
alter table public.processo_andamentos enable row level security;
alter table public.prazos enable row level security;
alter table public.audiencias enable row level security;
alter table public.processo_lancamentos enable row level security;

create policy departamentos_select on public.departamentos for select to authenticated using (public.is_active_user());
create policy departamentos_write on public.departamentos for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy dep_membros_select on public.departamento_membros for select to authenticated using (public.is_active_user());
create policy dep_membros_write on public.departamento_membros for all to authenticated
  using (public.is_manager() or public.is_responsavel_departamento(departamento_id))
  with check (public.is_manager() or public.is_responsavel_departamento(departamento_id));

-- processos (colunas da própria linha — compatível com INSERT ... RETURNING)
create policy processos_select on public.processos for select to authenticated
  using (public.is_active_user() and (
    public.has_role(array['admin','gestor','financeiro']::public.app_role[])
    or responsavel_id = auth.uid() or created_by = auth.uid() or auth.uid() = any(equipe)
    or public.is_membro_departamento(departamento_id)));
create policy processos_insert on public.processos for insert to authenticated
  with check (public.is_juridico() and (public.is_manager() or departamento_id is null or public.is_membro_departamento(departamento_id)));
create policy processos_update on public.processos for update to authenticated
  using (public.is_juridico() and (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid() or auth.uid() = any(equipe) or public.is_membro_departamento(departamento_id)))
  with check (public.is_juridico() and (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid() or auth.uid() = any(equipe) or public.is_membro_departamento(departamento_id)));
create policy processos_delete on public.processos for delete to authenticated using (public.is_manager());

-- tabelas filhas herdam o acesso do processo
do $$
declare t text;
begin
  foreach t in array array['processo_partes','processo_andamentos','audiencias','processo_lancamentos'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated using (public.can_access_processo(processo_id));
      create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_edit_processo(processo_id));
      create policy %1$s_update on public.%1$I for update to authenticated using (public.can_edit_processo(processo_id)) with check (public.can_edit_processo(processo_id));
    $f$, t);
  end loop;
end $$;
create policy processo_partes_delete on public.processo_partes for delete to authenticated
  using (public.can_edit_processo(processo_id));
create policy processo_andamentos_delete on public.processo_andamentos for delete to authenticated
  using (public.is_manager() or (public.can_edit_processo(processo_id) and autor_id = auth.uid()));
create policy audiencias_delete on public.audiencias for delete to authenticated
  using (public.is_manager() or (public.can_edit_processo(processo_id) and created_by = auth.uid()));
create policy processo_lancamentos_delete on public.processo_lancamentos for delete to authenticated
  using (public.is_manager() or (public.can_edit_processo(processo_id) and created_by = auth.uid()));
-- lançamentos financeiros: financeiro também gerencia
alter policy processo_lancamentos_insert on public.processo_lancamentos
  with check (public.can_edit_processo(processo_id) or (public.has_role(array['financeiro']::public.app_role[]) and public.can_access_processo(processo_id)));
alter policy processo_lancamentos_update on public.processo_lancamentos
  using (public.can_edit_processo(processo_id) or (public.has_role(array['financeiro']::public.app_role[]) and public.can_access_processo(processo_id)))
  with check (public.can_edit_processo(processo_id) or (public.has_role(array['financeiro']::public.app_role[]) and public.can_access_processo(processo_id)));

-- prazos podem existir sem processo (prazos administrativos do departamento)
create policy prazos_select on public.prazos for select to authenticated
  using (public.is_active_user() and (
    public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid()
    or public.is_membro_departamento(departamento_id)
    or (processo_id is not null and public.can_access_processo(processo_id))));
create policy prazos_insert on public.prazos for insert to authenticated
  with check (public.is_active_user() and (
    (processo_id is not null and public.can_edit_processo(processo_id))
    or (processo_id is null and (public.is_manager() or responsavel_id = auth.uid() or public.is_membro_departamento(departamento_id)))));
create policy prazos_update on public.prazos for update to authenticated
  using (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid() or public.is_membro_departamento(departamento_id)
         or (processo_id is not null and public.can_edit_processo(processo_id)))
  with check (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid() or public.is_membro_departamento(departamento_id)
         or (processo_id is not null and public.can_edit_processo(processo_id)));
create policy prazos_delete on public.prazos for delete to authenticated
  using (public.is_manager() or created_by = auth.uid());

-- tarefas: membros do departamento também enxergam as demandas do departamento
alter policy tarefas_select on public.tarefas
  using (public.is_manager() or (public.is_active_user() and (responsavel_id = auth.uid() or created_by = auth.uid() or public.is_membro_departamento(departamento_id))));
alter policy tarefas_update on public.tarefas
  using (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid() or public.is_responsavel_departamento(departamento_id))
  with check (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid() or public.is_responsavel_departamento(departamento_id));
alter policy tarefas_insert on public.tarefas
  with check (public.is_active_user() and (public.is_manager() or responsavel_id = auth.uid() or public.is_responsavel_departamento(departamento_id)));

-- documentos ligados a processo
alter policy documentos_select on public.documentos
  using (public.is_backoffice() or (cliente_id is not null and public.can_access_cliente(cliente_id)) or (processo_id is not null and public.can_access_processo(processo_id)));

-- Grants das funções auxiliares
revoke execute on function public.is_juridico(), public.is_membro_departamento(uuid), public.is_responsavel_departamento(uuid),
  public.can_access_processo(uuid), public.can_edit_processo(uuid) from public, anon;
grant execute on function public.is_juridico(), public.is_membro_departamento(uuid), public.is_responsavel_departamento(uuid),
  public.can_access_processo(uuid), public.can_edit_processo(uuid) to authenticated;
revoke execute on function public.processo_encerramento(), public.prazo_cumprimento(), public.registrar_andamento_sistema() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Alertas diários: prazos e audiências
-- ---------------------------------------------------------------------
create or replace function public.gerar_alertas()
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Prazos que vencem em até 3 dias (responsável + gestão)
  insert into public.notificacoes (user_id, titulo, mensagem, link, chave)
  select u.id,
         case when pz.data_fim = v_hoje then 'Prazo vence HOJE' else 'Prazo próximo' end,
         pz.descricao || coalesce(' · ' || pr.titulo, '') || ' — vence ' || to_char(pz.data_fim, 'DD/MM/YYYY'),
         coalesce('/processos/' || pz.processo_id, '/prazos'),
         'prazo:' || pz.id || ':' || pz.data_fim
    from public.prazos pz
    left join public.processos pr on pr.id = pz.processo_id
    join public.profiles u on u.active and (u.id = pz.responsavel_id or u.role in ('admin','gestor'))
   where pz.status = 'pendente' and pz.data_fim between v_hoje and v_hoje + 3
  on conflict (user_id, chave) where chave is not null do nothing;
  get diagnostics n = row_count;

  -- Prazos vencidos e não baixados: alerta diário ao responsável (não altera o status automaticamente)
  insert into public.notificacoes (user_id, titulo, mensagem, link, chave)
  select pz.responsavel_id, 'Prazo VENCIDO sem baixa', pz.descricao || ' — venceu ' || to_char(pz.data_fim, 'DD/MM/YYYY'),
         coalesce('/processos/' || pz.processo_id, '/prazos'), 'prazo-vencido:' || pz.id || ':' || v_hoje
    from public.prazos pz
   where pz.status = 'pendente' and pz.data_fim < v_hoje and pz.responsavel_id is not null
  on conflict (user_id, chave) where chave is not null do nothing;

  -- Audiências de amanhã
  insert into public.notificacoes (user_id, titulo, mensagem, link, chave)
  select u.id, 'Audiência amanhã',
         pr.titulo || ' — ' || to_char(a.data_hora at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
         '/processos/' || a.processo_id, 'aud:' || a.id || ':' || a.data_hora::date
    from public.audiencias a
    join public.processos pr on pr.id = a.processo_id
    join public.profiles u on u.active and (u.id = a.responsavel_id or u.id = pr.responsavel_id)
   where a.status = 'agendada' and (a.data_hora at time zone 'America/Sao_Paulo')::date = v_hoje + 1
  on conflict (user_id, chave) where chave is not null do nothing;

  -- Renovações de seguro (módulo comercial)
  insert into public.notificacoes (user_id, titulo, mensagem, link, chave)
  select u.id, 'Renovação próxima',
         'Seguro ' || a.ramo || ' de ' || c.nome || ' vence em ' || to_char(a.fim_vigencia, 'DD/MM/YYYY'),
         '/seguros/' || a.id, 'renov:' || a.id
    from public.seguro_apolices a
    join public.clientes c on c.id = a.cliente_id
    join public.profiles u on u.active and (u.id = a.consultor_id or u.role in ('admin','gestor'))
   where a.status = 'vigente' and a.fim_vigencia between v_hoje and v_hoje + 30
  on conflict (user_id, chave) where chave is not null do nothing;

  update public.seguro_apolices set status = 'vencida' where status = 'vigente' and fim_vigencia < v_hoje;

  insert into public.notificacoes (user_id, titulo, mensagem, link, chave)
  select t.responsavel_id, 'Tarefa atrasada', t.titulo, '/tarefas', 'tarefa:' || t.id
    from public.tarefas t
   where t.status <> 'concluida' and t.vencimento < v_hoje and t.responsavel_id is not null
  on conflict (user_id, chave) where chave is not null do nothing;
  return n;
end $$;
revoke execute on function public.gerar_alertas() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Busca global inclui processos
-- ---------------------------------------------------------------------
create or replace function public.busca_global(termo text)
returns table (tipo text, id uuid, titulo text, subtitulo text, link text)
language sql stable security invoker set search_path = '' as $$
  (select 'processo', p.id, p.titulo, coalesce(p.numero_cnj, p.numero_interno, '') || coalesce(' · ' || p.parte_contraria, ''), '/processos/' || p.id
     from public.processos p
    where p.titulo ilike '%' || termo || '%' or p.numero_cnj ilike '%' || termo || '%' or p.numero_interno ilike '%' || termo || '%'
       or p.parte_contraria ilike '%' || termo || '%'
       or regexp_replace(coalesce(p.numero_cnj, ''), '\D', '', 'g') like '%' || regexp_replace(termo, '\D', '', 'g') || '%' and length(regexp_replace(termo, '\D', '', 'g')) >= 6
    order by p.updated_at desc limit 8)
  union all
  (select 'cliente', c.id, c.nome, coalesce(c.documento, c.email, c.telefone, ''), '/clientes/' || c.id
     from public.clientes c
    where c.nome ilike '%' || termo || '%' or c.documento ilike '%' || termo || '%' or c.email ilike '%' || termo || '%'
    order by c.nome limit 6)
  union all
  (select 'consorcio', q.id, 'Consórcio ' || coalesce(q.grupo,'') || '/' || coalesce(q.cota,''), q.categoria, '/consorcios/' || q.id
     from public.consorcio_cotas q
    where q.grupo ilike '%' || termo || '%' or q.cota ilike '%' || termo || '%' or q.numero_contrato ilike '%' || termo || '%'
    limit 3)
  union all
  (select 'seguro', a.id, 'Apólice ' || coalesce(a.numero_apolice, a.numero_proposta, 's/n'), a.ramo || coalesce(' · ' || a.item_segurado, ''), '/seguros/' || a.id
     from public.seguro_apolices a
    where a.numero_apolice ilike '%' || termo || '%' or a.numero_proposta ilike '%' || termo || '%' or a.item_segurado ilike '%' || termo || '%'
    limit 3)
$$;

-- ---------------------------------------------------------------------
-- Departamentos iniciais
-- ---------------------------------------------------------------------
insert into public.departamentos (nome, sigla, descricao, cor) values
  ('Jurídico Contencioso', 'CONT', 'Processos judiciais e administrativos', 'brand'),
  ('Jurídico Consultivo', 'CONS', 'Pareceres, contratos e orientação preventiva', 'violet'),
  ('Recuperação de Crédito', 'RCR', 'Cobranças, execuções e acordos', 'accent'),
  ('Trabalhista', 'TRAB', 'Reclamações trabalhistas e consultivo trabalhista', 'sky'),
  ('Administrativo', 'ADM', 'Rotinas administrativas e protocolo', 'slate'),
  ('Financeiro', 'FIN', 'Custas, honorários e repasses', 'green'),
  ('Comercial — Consórcios & Seguros', 'COM', 'Vendas de consórcio e seguros', 'amber')
on conflict (nome) do nothing;
