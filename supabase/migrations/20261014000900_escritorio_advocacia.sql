-- =====================================================================
-- GE EASY — Administração do escritório de advocacia
-- Contratos de honorários, financeiro (receber/pagar), controle de horas,
-- atendimentos/triagem, publicações/intimações e modelos de documentos.
-- =====================================================================

create type public.contrato_tipo as enum ('fixo', 'mensal', 'exito', 'por_ato', 'hora', 'misto');
create type public.contrato_status as enum ('proposta', 'ativo', 'suspenso', 'encerrado', 'cancelado');
create type public.fin_tipo as enum ('receita', 'despesa');
create type public.fin_status as enum ('aberto', 'pago', 'cancelado');
create type public.atendimento_status as enum ('novo', 'em_analise', 'proposta_enviada', 'contratado', 'recusado', 'arquivado');
create type public.publicacao_status as enum ('nova', 'tratada', 'descartada');

-- Quem administra o financeiro do escritório
create or replace function public.is_financeiro_escritorio()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin','gestor','financeiro']::public.app_role[])
$$;

-- ---------------------------------------------------------------------
-- Contratos de honorários
-- ---------------------------------------------------------------------
create table public.contratos_honorarios (
  id uuid primary key default gen_random_uuid(),
  numero text,
  titulo text not null check (char_length(titulo) between 2 and 200),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  processo_id uuid references public.processos(id) on delete set null,
  tipo public.contrato_tipo not null default 'fixo',
  valor_fixo numeric(16,2) check (valor_fixo is null or valor_fixo >= 0),
  valor_mensal numeric(16,2) check (valor_mensal is null or valor_mensal >= 0),
  percentual_exito numeric(6,3) check (percentual_exito is null or percentual_exito between 0 and 100),
  valor_hora numeric(12,2) check (valor_hora is null or valor_hora >= 0),
  parcelas int not null default 1 check (parcelas between 1 and 120),
  dia_vencimento int check (dia_vencimento between 1 and 31),
  data_inicio date not null default (now() at time zone 'America/Sao_Paulo')::date,
  data_fim date,
  indice_reajuste text,
  status public.contrato_status not null default 'ativo',
  responsavel_id uuid references public.profiles(id) on delete set null default auth.uid(),
  departamento_id uuid references public.departamentos(id) on delete set null,
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.contratos_honorarios (cliente_id);
create index on public.contratos_honorarios (processo_id);
create index on public.contratos_honorarios (status);
create trigger trg_contratos_updated before update on public.contratos_honorarios for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Financeiro do escritório (contas a receber e a pagar)
-- ---------------------------------------------------------------------
create table public.financeiro_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tipo public.fin_tipo not null,
  categoria text not null default 'outros',
  descricao text not null check (char_length(descricao) between 2 and 300),
  valor numeric(16,2) not null check (valor > 0),
  vencimento date not null,
  data_pagamento date,
  valor_pago numeric(16,2),
  status public.fin_status not null default 'aberto',
  forma_pagamento text,
  cliente_id uuid references public.clientes(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  contrato_id uuid references public.contratos_honorarios(id) on delete cascade,
  departamento_id uuid references public.departamentos(id) on delete set null,
  fornecedor text,
  parcela int,
  total_parcelas int,
  reembolsavel boolean not null default false,
  documento_ref text,
  observacoes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.financeiro_lancamentos (tipo, status, vencimento);
create index on public.financeiro_lancamentos (cliente_id);
create index on public.financeiro_lancamentos (processo_id);
create index on public.financeiro_lancamentos (contrato_id);
create trigger trg_fin_updated before update on public.financeiro_lancamentos for each row execute function public.set_updated_at();

create or replace function public.fin_baixa()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'pago' then
    new.data_pagamento := coalesce(new.data_pagamento, (now() at time zone 'America/Sao_Paulo')::date);
    new.valor_pago := coalesce(new.valor_pago, new.valor);
  elsif new.status = 'aberto' then
    new.data_pagamento := null;
    new.valor_pago := null;
  end if;
  return new;
end $$;
create trigger trg_fin_baixa before insert or update on public.financeiro_lancamentos for each row execute function public.fin_baixa();

-- ---------------------------------------------------------------------
-- Controle de horas (timesheet)
-- ---------------------------------------------------------------------
create table public.horas_lancamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  minutos int not null check (minutos between 1 and 1440),
  descricao text not null check (char_length(descricao) between 2 and 2000),
  processo_id uuid references public.processos(id) on delete set null,
  cliente_id uuid references public.clientes(id) on delete set null,
  contrato_id uuid references public.contratos_honorarios(id) on delete set null,
  faturavel boolean not null default true,
  valor_hora numeric(12,2),
  faturado boolean not null default false,
  lancamento_id uuid references public.financeiro_lancamentos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.horas_lancamentos (user_id, data desc);
create index on public.horas_lancamentos (processo_id);
create index on public.horas_lancamentos (cliente_id);
create trigger trg_horas_updated before update on public.horas_lancamentos for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Atendimentos / triagem de novos casos e consultas
-- ---------------------------------------------------------------------
create table public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  nome_contato text not null check (char_length(nome_contato) between 2 and 200),
  telefone text,
  email text,
  canal text not null default 'presencial' check (canal in ('presencial', 'telefone', 'whatsapp', 'email', 'videochamada', 'indicacao', 'site')),
  data timestamptz not null default now(),
  area public.processo_area not null default 'civel',
  assunto text not null check (char_length(assunto) between 2 and 250),
  relato text,
  urgencia public.prioridade not null default 'media',
  status public.atendimento_status not null default 'novo',
  valor_estimado numeric(16,2),
  responsavel_id uuid references public.profiles(id) on delete set null default auth.uid(),
  departamento_id uuid references public.departamentos(id) on delete set null,
  processo_id uuid references public.processos(id) on delete set null,
  contrato_id uuid references public.contratos_honorarios(id) on delete set null,
  motivo_recusa text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.atendimentos (status, data desc);
create index on public.atendimentos (responsavel_id);
create trigger trg_atendimentos_updated before update on public.atendimentos for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Publicações e intimações (caixa de entrada)
-- ---------------------------------------------------------------------
create table public.publicacoes (
  id uuid primary key default gen_random_uuid(),
  data_publicacao date not null default (now() at time zone 'America/Sao_Paulo')::date,
  data_disponibilizacao date,
  fonte text,
  numero_processo text,
  processo_id uuid references public.processos(id) on delete set null,
  conteudo text not null check (char_length(conteudo) between 5 and 50000),
  status public.publicacao_status not null default 'nova',
  prazo_id uuid references public.prazos(id) on delete set null,
  responsavel_id uuid references public.profiles(id) on delete set null,
  tratado_por uuid references public.profiles(id) on delete set null,
  tratado_em timestamptz,
  observacoes text,
  hash text unique,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.publicacoes (status, data_publicacao desc);
create index on public.publicacoes (processo_id);

-- Vincula automaticamente a publicação ao processo pelo número CNJ (somente dígitos)
create or replace function public.publicacao_vincular()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dig text;
begin
  if new.processo_id is null and new.numero_processo is not null then
    v_dig := regexp_replace(new.numero_processo, '\D', '', 'g');
    if length(v_dig) = 20 then
      select p.id, coalesce(new.responsavel_id, p.responsavel_id) into new.processo_id, new.responsavel_id
        from public.processos p where regexp_replace(coalesce(p.numero_cnj, ''), '\D', '', 'g') = v_dig limit 1;
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
create trigger trg_publicacao_vincular before insert or update on public.publicacoes for each row execute function public.publicacao_vincular();

-- Publicação vinculada vira andamento do processo
create or replace function public.publicacao_andamento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.processo_id is not null and (tg_op = 'INSERT' or old.processo_id is distinct from new.processo_id) then
    insert into public.processo_andamentos (processo_id, data, tipo, descricao, autor_id)
    values (new.processo_id, new.data_publicacao, 'publicacao', left(new.conteudo, 10000), auth.uid());
  end if;
  return new;
end $$;
create trigger trg_publicacao_andamento after insert or update of processo_id on public.publicacoes for each row execute function public.publicacao_andamento();

-- ---------------------------------------------------------------------
-- Modelos de documentos (petições, procurações, contratos…)
-- ---------------------------------------------------------------------
create table public.modelos_documentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 2 and 200),
  categoria text not null default 'peticao' check (categoria in ('peticao', 'procuracao', 'contrato', 'declaracao', 'notificacao', 'parecer', 'recibo', 'oficio', 'outro')),
  area public.processo_area,
  descricao text,
  conteudo text not null check (char_length(conteudo) between 2 and 200000),
  departamento_id uuid references public.departamentos(id) on delete set null,
  ativo boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_modelos_updated before update on public.modelos_documentos for each row execute function public.set_updated_at();

-- Auditoria
do $$
declare t text;
begin
  foreach t in array array['contratos_honorarios','financeiro_lancamentos','horas_lancamentos','atendimentos','publicacoes','modelos_documentos'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.contratos_honorarios enable row level security;
alter table public.financeiro_lancamentos enable row level security;
alter table public.horas_lancamentos enable row level security;
alter table public.atendimentos enable row level security;
alter table public.publicacoes enable row level security;
alter table public.modelos_documentos enable row level security;

-- contratos: financeiro e jurídico leem; gestão/financeiro e o advogado responsável editam
create policy contratos_select on public.contratos_honorarios for select to authenticated
  using (public.is_financeiro_escritorio() or (public.is_juridico() and (responsavel_id = auth.uid() or created_by = auth.uid()
    or public.is_membro_departamento(departamento_id) or (processo_id is not null and public.can_access_processo(processo_id)))));
create policy contratos_insert on public.contratos_honorarios for insert to authenticated
  with check (public.is_financeiro_escritorio() or public.is_juridico());
create policy contratos_update on public.contratos_honorarios for update to authenticated
  using (public.is_financeiro_escritorio() or (public.is_juridico() and (responsavel_id = auth.uid() or created_by = auth.uid())))
  with check (public.is_financeiro_escritorio() or (public.is_juridico() and (responsavel_id = auth.uid() or created_by = auth.uid())));
create policy contratos_delete on public.contratos_honorarios for delete to authenticated using (public.is_manager());

-- financeiro: gestão/financeiro tudo; jurídico vê lançamentos dos processos que acessa e lança despesas neles
create policy fin_select on public.financeiro_lancamentos for select to authenticated
  using (public.is_financeiro_escritorio() or (public.is_juridico() and (created_by = auth.uid() or (processo_id is not null and public.can_access_processo(processo_id)))));
create policy fin_insert on public.financeiro_lancamentos for insert to authenticated
  with check (public.is_financeiro_escritorio() or (public.is_juridico() and tipo = 'despesa' and processo_id is not null and public.can_edit_processo(processo_id)));
create policy fin_update on public.financeiro_lancamentos for update to authenticated
  using (public.is_financeiro_escritorio() or (public.is_juridico() and created_by = auth.uid() and status = 'aberto'))
  with check (public.is_financeiro_escritorio() or (public.is_juridico() and created_by = auth.uid() and status = 'aberto'));
create policy fin_delete on public.financeiro_lancamentos for delete to authenticated
  using (public.is_manager() or (public.is_financeiro_escritorio() and status = 'aberto'));

-- horas: cada um lança as suas; gestão/financeiro veem e faturam todas
create policy horas_select on public.horas_lancamentos for select to authenticated
  using (user_id = auth.uid() or public.is_financeiro_escritorio());
create policy horas_insert on public.horas_lancamentos for insert to authenticated
  with check (public.is_active_user() and user_id = auth.uid() and (processo_id is null or public.can_access_processo(processo_id)));
create policy horas_update on public.horas_lancamentos for update to authenticated
  using ((user_id = auth.uid() and not faturado) or public.is_financeiro_escritorio())
  with check ((user_id = auth.uid() and not faturado) or public.is_financeiro_escritorio());
create policy horas_delete on public.horas_lancamentos for delete to authenticated
  using ((user_id = auth.uid() and not faturado) or public.is_manager());

-- atendimentos: equipe jurídica compartilha a triagem
create policy atend_select on public.atendimentos for select to authenticated
  using (public.is_juridico() or public.has_role(array['financeiro']::public.app_role[]) or responsavel_id = auth.uid() or created_by = auth.uid());
create policy atend_insert on public.atendimentos for insert to authenticated
  with check (public.is_active_user() and public.current_app_role() <> 'financeiro');
create policy atend_update on public.atendimentos for update to authenticated
  using (public.is_juridico() or responsavel_id = auth.uid() or created_by = auth.uid())
  with check (public.is_juridico() or responsavel_id = auth.uid() or created_by = auth.uid());
create policy atend_delete on public.atendimentos for delete to authenticated using (public.is_manager());

-- publicações: jurídico vê as não vinculadas e as dos processos que acessa
create policy pub_select on public.publicacoes for select to authenticated
  using (public.is_juridico() and (processo_id is null or public.can_access_processo(processo_id) or responsavel_id = auth.uid()));
create policy pub_insert on public.publicacoes for insert to authenticated with check (public.is_juridico());
create policy pub_update on public.publicacoes for update to authenticated
  using (public.is_juridico() and (processo_id is null or public.can_edit_processo(processo_id) or responsavel_id = auth.uid()))
  with check (public.is_juridico());
create policy pub_delete on public.publicacoes for delete to authenticated using (public.is_manager());

-- modelos: todos os usuários ativos leem; jurídico cria; autor/gestão alteram
create policy modelos_select on public.modelos_documentos for select to authenticated using (public.is_active_user());
create policy modelos_insert on public.modelos_documentos for insert to authenticated with check (public.is_juridico() or public.is_financeiro_escritorio());
create policy modelos_update on public.modelos_documentos for update to authenticated
  using (public.is_manager() or created_by = auth.uid()) with check (public.is_manager() or created_by = auth.uid());
create policy modelos_delete on public.modelos_documentos for delete to authenticated using (public.is_manager() or created_by = auth.uid());

revoke execute on function public.is_financeiro_escritorio() from public, anon;
grant execute on function public.is_financeiro_escritorio() to authenticated;
revoke execute on function public.fin_baixa(), public.publicacao_vincular(), public.publicacao_andamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Modelos iniciais (placeholders {{...}} preenchidos pelo sistema)
-- ---------------------------------------------------------------------
insert into public.modelos_documentos (titulo, categoria, descricao, conteudo, created_by) values
('Procuração ad judicia', 'procuracao', 'Procuração com poderes gerais e especiais para o foro',
'PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE: {{cliente.nome}}, inscrito(a) no CPF/CNPJ sob o nº {{cliente.documento}}, residente e domiciliado(a) em {{cliente.endereco_completo}}.

OUTORGADO(S): {{escritorio.nome}}, por seus advogados, {{responsavel.nome}}, OAB {{responsavel.oab}}.

PODERES: pelo presente instrumento, o(a) outorgante confere ao(s) outorgado(s) amplos poderes para o foro em geral, com a cláusula ad judicia et extra, em qualquer juízo, instância ou tribunal, podendo propor contra quem de direito as ações competentes e defendê-lo(a) nas contrárias, seguindo umas e outras até final decisão, usando os recursos legais e acompanhando-os, conferindo-lhe ainda poderes especiais para confessar, desistir, transigir, firmar compromissos ou acordos, receber e dar quitação, agindo em conjunto ou separadamente, podendo ainda substabelecer esta em outrem, com ou sem reservas de iguais poderes.

{{cidade}}, {{data_extenso}}.

_____________________________________
{{cliente.nome}}', null),
('Contrato de prestação de serviços advocatícios', 'contrato', 'Contrato de honorários padrão',
'CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: {{cliente.nome}}, CPF/CNPJ {{cliente.documento}}, com endereço em {{cliente.endereco_completo}}.
CONTRATADO: {{escritorio.nome}}.

CLÁUSULA 1ª — DO OBJETO: prestação de serviços jurídicos referentes a: {{processo.titulo}} {{processo.numero_cnj}}.

CLÁUSULA 2ª — DOS HONORÁRIOS: {{contrato.descricao_honorarios}}.

CLÁUSULA 3ª — DAS DESPESAS: custas processuais, emolumentos e despesas de diligência correrão por conta do(a) CONTRATANTE.

CLÁUSULA 4ª — DO FORO: fica eleito o foro da comarca de {{cidade}}.

{{cidade}}, {{data_extenso}}.

_____________________________________          _____________________________________
CONTRATANTE                                                    CONTRATADO', null),
('Declaração de hipossuficiência', 'declaracao', 'Para pedido de justiça gratuita',
'DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, {{cliente.nome}}, inscrito(a) no CPF sob o nº {{cliente.documento}}, residente em {{cliente.endereco_completo}}, DECLARO, para os fins do art. 98 e seguintes do Código de Processo Civil, que não possuo condições de arcar com as custas processuais e honorários advocatícios sem prejuízo do meu sustento e de minha família.

{{cidade}}, {{data_extenso}}.

_____________________________________
{{cliente.nome}}', null);
