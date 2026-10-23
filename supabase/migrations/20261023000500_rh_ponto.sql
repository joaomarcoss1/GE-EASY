-- =====================================================================
-- GE EASY — Fase 7: RH, ponto e pré-folha
--
-- * funcionários (dados contratuais) separados dos dados sensíveis (CPF, salário, dados bancários
--   criptografados pela aplicação, dependentes, atestados) — só rh.dados_sensiveis lê, tudo auditado;
-- * jornadas, cercas virtuais e marcações de ponto INALTERÁVEIS (horário do servidor, NSR sequencial por
--   empresa, encadeamento por hash SHA-256, localização só no ato da marcação);
-- * ajustes só com justificativa e aprovação (a marcação original é mantida), ausências com aprovação;
-- * cálculo diário (trabalhado, extras, atrasos, faltas, intervalo), espelho mensal com ciência do funcionário;
-- * pré-folha: salário, extras, faltas, comissões, reembolsos de rota → revisão → aprovação → contas a pagar.
--
-- Nota legal: é um controle interno de jornada. Para valer como REP-P (Portaria MTP 671/2021) faltam o
-- registro do programa no INPI, o certificado e o AFD assinado — validar com a assessoria trabalhista.
-- =====================================================================

create type public.ponto_tipo as enum ('entrada', 'intervalo_inicio', 'intervalo_fim', 'saida');
create type public.aprovacao_status as enum ('pendente', 'aprovado', 'recusado');

-- ---------------------------------------------------------------------
-- Funcionários
-- ---------------------------------------------------------------------
create table public.jornadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 120),
  entrada time not null default '08:00',
  saida time not null default '18:00',
  intervalo_min int not null default 60 check (intervalo_min between 0 and 600),
  tolerancia_min int not null default 10 check (tolerancia_min between 0 and 60), -- CLT art. 58 §1º: até 10 min/dia
  dias int[] not null default '{1,2,3,4,5}', -- ISO: 1 = segunda … 7 = domingo
  banco_horas boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete set null,
  nome text not null check (char_length(nome) between 2 and 200),
  matricula text check (char_length(matricula) <= 30),
  cargo text check (char_length(cargo) <= 120),
  departamento_id uuid references public.departamentos(id) on delete set null,
  jornada_id uuid references public.jornadas(id) on delete set null,
  tipo_contrato text not null default 'nao_informado' check (tipo_contrato in ('clt', 'pj', 'estagio', 'temporario', 'autonomo', 'socio', 'nao_informado')),
  admissao date,
  desligamento date,
  status text not null default 'ativo' check (status in ('ativo', 'afastado', 'ferias', 'desligado')),
  ponto_externo boolean not null default false, -- consultor externo: marca em qualquer lugar (registra a posição)
  controla_ponto boolean not null default true,
  email text check (char_length(email) <= 200),
  telefone text check (char_length(telefone) <= 30),
  observacoes text check (char_length(observacoes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index funcionarios_user_uniq on public.funcionarios (empresa_id, user_id) where user_id is not null;
create unique index funcionarios_matricula_uniq on public.funcionarios (empresa_id, matricula) where matricula is not null;
create index on public.funcionarios (empresa_id, status);
create trigger trg_funcionarios_updated before update on public.funcionarios for each row execute function public.set_updated_at();

-- Dados sensíveis: só rh.dados_sensiveis (e o próprio funcionário, para leitura)
create table public.funcionario_sensiveis (
  funcionario_id uuid primary key references public.funcionarios(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  cpf text check (cpf is null or cpf ~ '^\d{11}$'),
  rg text check (char_length(rg) <= 30),
  nascimento date,
  pis text check (pis is null or pis ~ '^\d{11}$'),
  salario_base numeric(19,2) check (salario_base is null or salario_base >= 0),
  adicionais_fixos numeric(19,2) not null default 0 check (adicionais_fixos >= 0),
  dados_bancarios_enc text, -- AES-256-GCM pela aplicação (banco, agência, conta, PIX)
  endereco text check (char_length(endereco) <= 400),
  contato_emergencia text check (char_length(contato_emergencia) <= 200),
  updated_at timestamptz not null default now()
);
create unique index funcionario_cpf_uniq on public.funcionario_sensiveis (empresa_id, cpf) where cpf is not null;
create trigger trg_func_sens_updated before update on public.funcionario_sensiveis for each row execute function public.set_updated_at();

create table public.funcionario_dependentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 200),
  parentesco text not null check (char_length(parentesco) <= 40),
  nascimento date,
  cpf text check (cpf is null or cpf ~ '^\d{11}$'),
  ir boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.funcionario_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  tipo text not null check (char_length(tipo) between 2 and 80),
  descricao text check (char_length(descricao) <= 300),
  validade date,
  storage_path text not null,
  mime text not null,
  tamanho int not null check (tamanho > 0),
  enviado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  excluido_em timestamptz,
  excluido_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.funcionario_documentos (funcionario_id);
create index on public.funcionario_documentos (empresa_id, validade) where validade is not null and excluido_em is null;
create trigger trg_exclusao_logica before delete on public.funcionario_documentos for each row execute function public.exclusao_logica();

-- ---------------------------------------------------------------------
-- Cercas e marcações
-- ---------------------------------------------------------------------
create table public.cercas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 120),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  raio_m int not null default 150 check (raio_m between 20 and 5000),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.ponto_nsr (empresa_id uuid primary key references public.empresas(id) on delete cascade, ultimo bigint not null default 0, ultimo_hash text);

create table public.ponto_marcacoes (
  id uuid primary key, -- gerado no aparelho (idempotência da fila offline)
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete set null,
  tipo public.ponto_tipo not null,
  horario timestamptz not null,        -- horário considerado (servidor; offline: aparelho, sinalizado)
  registrado_em timestamptz not null default now(), -- recebimento no servidor (inalterável)
  dispositivo_em timestamptz,
  offline boolean not null default false,
  lat double precision, lng double precision, precisao double precision,
  cerca_id uuid references public.cercas(id) on delete set null,
  distancia_m int,
  fora_cerca boolean not null default false,
  flags text[] not null default '{}',
  origem text not null default 'app' check (origem in ('app', 'web', 'ajuste', 'importacao')),
  ajuste_id uuid,
  dispositivo text, ip text,
  nsr bigint not null,
  hash text not null,
  unique (empresa_id, nsr)
);
create index on public.ponto_marcacoes (funcionario_id, horario);
create index on public.ponto_marcacoes (empresa_id, horario);

create table public.ponto_ajustes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  acao text not null check (acao in ('incluir', 'desconsiderar')),
  marcacao_id uuid references public.ponto_marcacoes(id) on delete restrict,
  tipo public.ponto_tipo,
  horario timestamptz,
  justificativa text not null check (char_length(justificativa) between 5 and 1000),
  status public.aprovacao_status not null default 'pendente',
  solicitado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_em timestamptz,
  observacao_decisao text check (char_length(observacao_decisao) <= 500),
  created_at timestamptz not null default now(),
  check ((acao = 'incluir' and tipo is not null and horario is not null) or (acao = 'desconsiderar' and marcacao_id is not null))
);
create index on public.ponto_ajustes (empresa_id, status);
create index on public.ponto_ajustes (funcionario_id, horario);

create table public.ausencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  tipo text not null check (tipo in ('ferias', 'atestado', 'afastamento', 'licenca', 'falta_justificada', 'folga_banco')),
  inicio date not null,
  fim date not null,
  observacao text check (char_length(observacao) <= 1000),
  anexo_path text,
  anexo_mime text,
  status public.aprovacao_status not null default 'pendente',
  solicitado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_em timestamptz,
  created_at timestamptz not null default now(),
  check (fim >= inicio and fim - inicio <= 366)
);
create index on public.ausencias (funcionario_id, inicio, fim);
create index on public.ausencias (empresa_id, status);

create table public.ponto_espelhos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  resumo jsonb not null,
  hash text not null,
  gerado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  gerado_em timestamptz not null default now(),
  ciencia_em timestamptz,
  ciencia_ip text,
  contestacao text check (char_length(contestacao) <= 2000),
  unique (funcionario_id, competencia)
);

create table public.folha_competencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  competencia date not null check (extract(day from competencia) = 1),
  status text not null default 'em_revisao' check (status in ('em_revisao', 'aprovada', 'exportada', 'cancelada')),
  totais jsonb not null default '{}'::jsonb,
  gerada_por uuid references public.profiles(id) on delete set null default auth.uid(),
  gerada_em timestamptz not null default now(),
  aprovada_por uuid references public.profiles(id) on delete set null,
  aprovada_em timestamptz,
  exportada_em timestamptz,
  unique (empresa_id, competencia)
);
create table public.folha_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  competencia_id uuid not null references public.folha_competencias(id) on delete cascade,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  salario_base numeric(19,2) not null default 0,
  adicionais numeric(19,2) not null default 0,
  horas_extras_min int not null default 0,
  valor_extras numeric(19,2) not null default 0,
  faltas_min int not null default 0,
  desconto_faltas numeric(19,2) not null default 0,
  comissoes numeric(19,2) not null default 0,
  reembolsos numeric(19,2) not null default 0,
  outros_descontos numeric(19,2) not null default 0,
  outros_proventos numeric(19,2) not null default 0,
  total numeric(19,2) generated always as (salario_base + adicionais + valor_extras + comissoes + reembolsos + outros_proventos - desconto_faltas - outros_descontos) stored,
  detalhes jsonb not null default '{}'::jsonb,
  observacoes text check (char_length(observacoes) <= 1000),
  lancamento_id uuid references public.financeiro_lancamentos(id) on delete set null,
  unique (competencia_id, funcionario_id)
);

-- ---------------------------------------------------------------------
-- Integridade, auditoria, inalterabilidade
-- ---------------------------------------------------------------------
create trigger zz_empresa_vinculos before insert or update on public.funcionarios for each row execute function public.empresa_vinculos('departamento_id:departamentos', 'jornada_id:jornadas', 'user_id:@');
create trigger zz_empresa_vinculos before insert or update on public.funcionario_sensiveis for each row execute function public.empresa_vinculos('funcionario_id:funcionarios');
create trigger zz_empresa_vinculos before insert or update on public.funcionario_dependentes for each row execute function public.empresa_vinculos('funcionario_id:funcionarios');
create trigger zz_empresa_vinculos before insert or update on public.funcionario_documentos for each row execute function public.empresa_vinculos('funcionario_id:funcionarios');
create trigger zz_empresa_vinculos before insert or update on public.ponto_ajustes for each row execute function public.empresa_vinculos('funcionario_id:funcionarios', 'marcacao_id:ponto_marcacoes');
create trigger zz_empresa_vinculos before insert or update on public.ausencias for each row execute function public.empresa_vinculos('funcionario_id:funcionarios');
create trigger zz_empresa_vinculos before insert or update on public.folha_itens for each row execute function public.empresa_vinculos('competencia_id:folha_competencias', 'funcionario_id:funcionarios');
create trigger zz_empresa_vinculos before insert or update on public.jornadas for each row execute function public.empresa_vinculos();
create trigger zz_empresa_vinculos before insert or update on public.cercas for each row execute function public.empresa_vinculos();
create trigger zz_empresa_vinculos before insert or update on public.folha_competencias for each row execute function public.empresa_vinculos();
do $$
declare t text;
begin
  foreach t in array array['jornadas', 'funcionarios', 'funcionario_sensiveis', 'funcionario_dependentes', 'funcionario_documentos', 'cercas',
                           'ponto_marcacoes', 'ponto_ajustes', 'ausencias', 'ponto_espelhos', 'folha_competencias', 'folha_itens'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()))', t || '_empresa', t);
  end loop;
end $$;
alter table public.ponto_nsr enable row level security;
revoke all on public.ponto_nsr from anon, authenticated;

create or replace function public.ponto_inalteravel()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Marcações de ponto são inalteráveis. Use um ajuste com justificativa.' using errcode = '42501';
end $$;
create trigger trg_ponto_inalteravel before update or delete on public.ponto_marcacoes for each row execute function public.ponto_inalteravel();
create trigger trg_espelho_protecao before delete on public.ponto_espelhos for each row execute function public.ponto_inalteravel();

-- funcionário do usuário logado na empresa atual
create or replace function public.meu_funcionario()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.funcionarios where empresa_id = public.empresa_atual() and user_id = auth.uid() and status <> 'desligado' limit 1
$$;
revoke execute on function public.meu_funcionario() from public, anon;
grant execute on function public.meu_funcionario() to authenticated;

create or replace function public.pode_ver_funcionario(p_func uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_master() or public.tem_permissao('rh.funcionarios.ver') or public.tem_permissao('ponto.gerir') or public.tem_permissao('folha.gerir')
      or exists (select 1 from public.funcionarios f where f.id = p_func and (f.user_id = auth.uid() or (f.user_id is not null and public.is_supervisor_de(f.user_id))))
$$;
revoke execute on function public.pode_ver_funcionario(uuid) from public, anon;
grant execute on function public.pode_ver_funcionario(uuid) to authenticated;

-- RLS
create policy funcionarios_select on public.funcionarios for select to authenticated using (public.pode_ver_funcionario(id));
create policy funcionarios_insert on public.funcionarios for insert to authenticated with check ((select public.tem_permissao('rh.funcionarios.editar')));
create policy funcionarios_update on public.funcionarios for update to authenticated using ((select public.tem_permissao('rh.funcionarios.editar')));
create policy func_sens_select on public.funcionario_sensiveis for select to authenticated
  using ((select public.tem_permissao('rh.dados_sensiveis')) or funcionario_id = (select public.meu_funcionario()));
create policy func_sens_insert on public.funcionario_sensiveis for insert to authenticated with check ((select public.tem_permissao('rh.dados_sensiveis')));
create policy func_sens_update on public.funcionario_sensiveis for update to authenticated using ((select public.tem_permissao('rh.dados_sensiveis')));
create policy dependentes_select on public.funcionario_dependentes for select to authenticated
  using ((select public.tem_permissao('rh.dados_sensiveis')) or funcionario_id = (select public.meu_funcionario()));
create policy dependentes_insert on public.funcionario_dependentes for insert to authenticated with check ((select public.tem_permissao('rh.dados_sensiveis')));
create policy dependentes_update on public.funcionario_dependentes for update to authenticated using ((select public.tem_permissao('rh.dados_sensiveis')));
create policy dependentes_delete on public.funcionario_dependentes for delete to authenticated using ((select public.tem_permissao('rh.dados_sensiveis')));
create policy func_docs_select on public.funcionario_documentos for select to authenticated
  using (excluido_em is null and ((select public.tem_permissao('rh.funcionarios.editar')) or (select public.tem_permissao('rh.dados_sensiveis')) or funcionario_id = (select public.meu_funcionario())));
create policy func_docs_insert on public.funcionario_documentos for insert to authenticated with check ((select public.tem_permissao('rh.funcionarios.editar')));
create policy func_docs_delete on public.funcionario_documentos for delete to authenticated using ((select public.tem_permissao('rh.funcionarios.editar')));
create policy jornadas_select on public.jornadas for select to authenticated using ((select public.is_active_user()));
create policy jornadas_insert on public.jornadas for insert to authenticated with check ((select public.tem_permissao('ponto.gerir')));
create policy jornadas_update on public.jornadas for update to authenticated using ((select public.tem_permissao('ponto.gerir')));
create policy cercas_select on public.cercas for select to authenticated using ((select public.is_active_user()));
create policy cercas_insert on public.cercas for insert to authenticated with check ((select public.tem_permissao('ponto.gerir')));
create policy cercas_update on public.cercas for update to authenticated using ((select public.tem_permissao('ponto.gerir')));
create policy marcacoes_select on public.ponto_marcacoes for select to authenticated
  using ((select public.tem_permissao('ponto.gerir')) or user_id = (select auth.uid()) or (user_id is not null and public.is_supervisor_de(user_id)));
create policy ajustes_select on public.ponto_ajustes for select to authenticated
  using ((select public.tem_permissao('ponto.gerir')) or funcionario_id = (select public.meu_funcionario()) or public.pode_ver_funcionario(funcionario_id));
create policy ajustes_insert on public.ponto_ajustes for insert to authenticated
  with check (status = 'pendente' and ((select public.tem_permissao('ponto.gerir')) or funcionario_id = (select public.meu_funcionario())));
create policy ausencias_select on public.ausencias for select to authenticated
  using ((select public.tem_permissao('ponto.gerir')) or (select public.tem_permissao('rh.dados_sensiveis')) or funcionario_id = (select public.meu_funcionario()) or public.pode_ver_funcionario(funcionario_id));
create policy ausencias_insert on public.ausencias for insert to authenticated
  with check (status = 'pendente' and ((select public.tem_permissao('ponto.gerir')) or funcionario_id = (select public.meu_funcionario())));
create policy espelhos_select on public.ponto_espelhos for select to authenticated
  using ((select public.tem_permissao('ponto.gerir')) or funcionario_id = (select public.meu_funcionario()));
create policy folha_comp_select on public.folha_competencias for select to authenticated using ((select public.tem_permissao('folha.gerir')));
-- só a marcação de exportada (aprovada → exportada); a aprovação é pela função aprovar_folha
create policy folha_comp_update on public.folha_competencias for update to authenticated
  using ((select public.tem_permissao('folha.gerir')) and status in ('aprovada', 'exportada')) with check (status in ('aprovada', 'exportada'));
create policy folha_itens_select on public.folha_itens for select to authenticated using ((select public.tem_permissao('folha.gerir')));
create policy folha_itens_update on public.folha_itens for update to authenticated
  using ((select public.tem_permissao('folha.gerir')) and exists (select 1 from public.folha_competencias c where c.id = competencia_id and c.status = 'em_revisao'));

-- Todo usuário da empresa vira um registro de funcionário (o RH completa o contrato); desligamento encerra
insert into public.funcionarios (empresa_id, user_id, nome, cargo, email, tipo_contrato)
select m.empresa_id, m.user_id, coalesce(nullif(p.full_name, ''), p.email, 'Funcionário'), p.cargo, p.email, 'nao_informado'
  from public.empresa_membros m join public.profiles p on p.id = m.user_id
 where m.ativo
on conflict do nothing;

create or replace function public.membro_funcionario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.ativo then
    insert into public.funcionarios (empresa_id, user_id, nome, cargo, email)
    select new.empresa_id, new.user_id, left(coalesce(nullif(p.full_name, ''), p.email, 'Funcionário'), 200), p.cargo, p.email from public.profiles p where p.id = new.user_id
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.ativo and not new.ativo then
    update public.funcionarios set status = 'desligado', desligamento = coalesce(desligamento, current_date)
     where empresa_id = new.empresa_id and user_id = new.user_id and status <> 'desligado';
  elsif tg_op = 'UPDATE' and not old.ativo and new.ativo then
    update public.funcionarios set status = 'ativo', desligamento = null where empresa_id = new.empresa_id and user_id = new.user_id and status = 'desligado';
  end if;
  return new;
end $$;
revoke execute on function public.membro_funcionario() from public, anon, authenticated;
create trigger trg_membro_funcionario after insert or update of ativo on public.empresa_membros for each row execute function public.membro_funcionario();

-- ---------------------------------------------------------------------
-- Marcação de ponto
-- ---------------------------------------------------------------------
create or replace function public.parametros_ponto(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('fora_cerca', 'registrar', 'precisao_max_m', 150, 'offline_max_h', 72, 'exigir_gps', false)
         || coalesce((select c.valor from public.configuracoes c where c.empresa_id = p_empresa and c.chave = 'ponto'), '{}'::jsonb)
$$;
revoke execute on function public.parametros_ponto(uuid) from public, anon, authenticated;

-- grava a marcação com NSR e hash encadeado (uso interno; chamado por registrar_ponto e pelos ajustes)
create or replace function public._gravar_marcacao(p_id uuid, p_emp uuid, p_func uuid, p_user uuid, p_tipo public.ponto_tipo, p_horario timestamptz,
  p_disp_em timestamptz, p_offline boolean, p_lat double precision, p_lng double precision, p_prec double precision, p_cerca uuid, p_dist int,
  p_fora boolean, p_flags text[], p_origem text, p_ajuste uuid, p_disp text, p_ip text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_nsr bigint; v_prev text; v_hash text;
begin
  insert into public.ponto_nsr (empresa_id) values (p_emp) on conflict do nothing;
  update public.ponto_nsr set ultimo = ultimo + 1 where empresa_id = p_emp returning ultimo, ultimo_hash into v_nsr, v_prev;
  v_hash := encode(sha256(convert_to(concat_ws('|', coalesce(v_prev, ''), v_nsr, p_id, p_func, p_tipo, to_char(p_horario at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), p_lat, p_lng, p_origem), 'UTF8')), 'hex');
  insert into public.ponto_marcacoes (id, empresa_id, funcionario_id, user_id, tipo, horario, dispositivo_em, offline, lat, lng, precisao, cerca_id, distancia_m,
                                      fora_cerca, flags, origem, ajuste_id, dispositivo, ip, nsr, hash)
  values (p_id, p_emp, p_func, p_user, p_tipo, p_horario, p_disp_em, p_offline, p_lat, p_lng, p_prec, p_cerca, p_dist, p_fora, p_flags, p_origem, p_ajuste, left(p_disp, 120), left(p_ip, 64), v_nsr, v_hash);
  update public.ponto_nsr set ultimo_hash = v_hash where empresa_id = p_emp;
  return v_nsr;
end $$;
revoke execute on function public._gravar_marcacao(uuid, uuid, uuid, uuid, public.ponto_tipo, timestamptz, timestamptz, boolean, double precision, double precision, double precision, uuid, int, boolean, text[], text, uuid, text, text) from public, anon, authenticated;

/**
 * Marcação pelo app/web. Horário: o do servidor; se o aparelho registrou sem internet (diferença > 2 min,
 * até o limite configurado), vale o horário do aparelho, sinalizado como offline para conferência.
 * Cerca: fora da cerca registra com sinal (ou bloqueia, se configurado); funcionário externo marca em qualquer lugar.
 */
create or replace function public.registrar_ponto(p_id uuid, p_tipo text, p_lat double precision, p_lng double precision, p_precisao double precision,
  p_dispositivo_em timestamptz, p_dispositivo text, p_offline boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := public.empresa_atual(); f public.funcionarios; v_cfg jsonb; v_horario timestamptz := now(); v_offline boolean := false;
  v_flags text[] := '{}'; v_cerca uuid; v_dist int; v_raio int; v_fora boolean := false; v_ultima record; v_nsr bigint; v_ip text;
begin
  if not public.tem_permissao('ponto.registrar') then raise exception 'Sem permissão para registrar ponto.' using errcode = '42501'; end if;
  if p_tipo is null or p_tipo not in ('entrada', 'intervalo_inicio', 'intervalo_fim', 'saida') then raise exception 'Tipo de marcação inválido.'; end if;
  if exists (select 1 from public.ponto_marcacoes where id = p_id) then
    return (select jsonb_build_object('id', id, 'nsr', nsr, 'horario', horario, 'repetida', true) from public.ponto_marcacoes where id = p_id and user_id = auth.uid());
  end if;
  select * into f from public.funcionarios where empresa_id = v_emp and user_id = auth.uid() and status <> 'desligado';
  if not found then raise exception 'Seu cadastro de funcionário não foi encontrado. Procure o RH.'; end if;
  if not f.controla_ponto then raise exception 'Seu contrato não tem controle de ponto.'; end if;
  v_cfg := public.parametros_ponto(v_emp);

  if p_dispositivo_em is not null and now() - p_dispositivo_em > interval '2 minutes' then
    if now() - p_dispositivo_em <= make_interval(hours => (v_cfg->>'offline_max_h')::int) then
      v_horario := p_dispositivo_em; v_offline := true;
    else v_flags := array_append(v_flags, 'horario_aparelho_antigo');
    end if;
  elsif p_dispositivo_em is not null and p_dispositivo_em - now() > interval '2 minutes' then
    v_flags := array_append(v_flags, 'relogio_adiantado');
  end if;

  if p_lat is null or p_lng is null then
    if (v_cfg->>'exigir_gps')::boolean then raise exception 'Ative a localização para registrar o ponto.'; end if;
    v_flags := array_append(v_flags, 'sem_localizacao');
  else
    if p_precisao > (v_cfg->>'precisao_max_m')::numeric then v_flags := array_append(v_flags, 'precisao_ruim'); end if;
    select c.id, round(public.geo_distancia_m(p_lat, p_lng, c.lat, c.lng))::int, c.raio_m into v_cerca, v_dist, v_raio
      from public.cercas c where c.empresa_id = v_emp and c.ativo order by public.geo_distancia_m(p_lat, p_lng, c.lat, c.lng) limit 1;
    if v_cerca is not null and v_dist > v_raio and not f.ponto_externo then
      if v_cfg->>'fora_cerca' = 'bloquear' then raise exception 'Você está fora da área permitida para o ponto (a % m).', v_dist; end if;
      v_fora := true;
    end if;
  end if;

  select tipo, horario into v_ultima from public.ponto_marcacoes where funcionario_id = f.id and horario > v_horario - interval '16 hours' and horario <= v_horario order by horario desc limit 1;
  if v_ultima.tipo is not null and v_ultima.tipo::text = p_tipo and v_horario - v_ultima.horario < interval '2 minutes' then
    raise exception 'Marcação repetida: % já registrada às %.', p_tipo, to_char(v_ultima.horario at time zone 'America/Fortaleza', 'HH24:MI');
  end if;
  if (p_tipo = 'entrada' and v_ultima.tipo in ('entrada', 'intervalo_inicio', 'intervalo_fim'))
     or (p_tipo = 'intervalo_inicio' and coalesce(v_ultima.tipo::text, 'saida') not in ('entrada', 'intervalo_fim'))
     or (p_tipo = 'intervalo_fim' and coalesce(v_ultima.tipo::text, '') <> 'intervalo_inicio')
     or (p_tipo = 'saida' and coalesce(v_ultima.tipo::text, 'saida') = 'saida') then
    v_flags := array_append(v_flags, 'fora_sequencia');
  end if;

  v_ip := left(split_part(coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''), ',', 1), 64);
  v_nsr := public._gravar_marcacao(p_id, v_emp, f.id, auth.uid(), p_tipo::public.ponto_tipo, v_horario, p_dispositivo_em, v_offline, p_lat, p_lng, p_precisao,
                                   v_cerca, v_dist, v_fora, v_flags, case when p_dispositivo is null then 'web' else 'app' end, null, p_dispositivo, nullif(v_ip, ''));
  return jsonb_build_object('id', p_id, 'nsr', v_nsr, 'horario', v_horario, 'offline', v_offline, 'fora_cerca', v_fora, 'flags', v_flags);
end $$;
revoke execute on function public.registrar_ponto(uuid, text, double precision, double precision, double precision, timestamptz, text, boolean) from public, anon;
grant execute on function public.registrar_ponto(uuid, text, double precision, double precision, double precision, timestamptz, text, boolean) to authenticated;

-- Ajustes e ausências: decisão do gestor de ponto (não pode decidir o próprio)
create or replace function public.decidir_ajuste(p_ajuste uuid, p_aprovar boolean, p_obs text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.ponto_ajustes; f public.funcionarios;
begin
  if not public.tem_permissao('ponto.gerir') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into a from public.ponto_ajustes where id = p_ajuste and empresa_id = public.empresa_atual() for update;
  if not found or a.status <> 'pendente' then raise exception 'Ajuste não encontrado ou já decidido.'; end if;
  select * into f from public.funcionarios where id = a.funcionario_id;
  if f.user_id = auth.uid() then raise exception 'Você não pode aprovar o próprio ajuste.' using errcode = '42501'; end if;
  if not p_aprovar and coalesce(trim(p_obs), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  update public.ponto_ajustes set status = case when p_aprovar then 'aprovado' else 'recusado' end::public.aprovacao_status,
         decidido_por = auth.uid(), decidido_em = now(), observacao_decisao = left(p_obs, 500)
   where id = p_ajuste;
  if p_aprovar and a.acao = 'incluir' then
    perform public._gravar_marcacao(gen_random_uuid(), a.empresa_id, a.funcionario_id, f.user_id, a.tipo, a.horario, null, false, null, null, null, null, null, false,
                                    array['ajuste_aprovado'], 'ajuste', a.id, null, null);
  end if;
  if f.user_id is not null then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (a.empresa_id, f.user_id, case when p_aprovar then 'Ajuste de ponto aprovado' else 'Ajuste de ponto recusado' end,
            left(coalesce(p_obs, a.justificativa), 300), '/ponto');
  end if;
end $$;

create or replace function public.decidir_ausencia(p_ausencia uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.ausencias; v_user uuid;
begin
  if not public.tem_permissao('ponto.gerir') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into a from public.ausencias where id = p_ausencia and empresa_id = public.empresa_atual() for update;
  if not found or a.status <> 'pendente' then raise exception 'Solicitação não encontrada ou já decidida.'; end if;
  select user_id into v_user from public.funcionarios where id = a.funcionario_id;
  if v_user = auth.uid() then raise exception 'Você não pode aprovar a própria solicitação.' using errcode = '42501'; end if;
  update public.ausencias set status = case when p_aprovar then 'aprovado' else 'recusado' end::public.aprovacao_status, decidido_por = auth.uid(), decidido_em = now() where id = p_ausencia;
  if p_aprovar and a.inicio <= current_date and a.fim >= current_date and a.tipo in ('ferias', 'afastamento', 'licenca') then
    update public.funcionarios set status = case when a.tipo = 'ferias' then 'ferias' else 'afastado' end where id = a.funcionario_id and status = 'ativo';
  end if;
  if v_user is not null then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (a.empresa_id, v_user, case when p_aprovar then 'Solicitação aprovada' else 'Solicitação recusada' end, a.tipo || ' de ' || to_char(a.inicio, 'DD/MM') || ' a ' || to_char(a.fim, 'DD/MM'), '/ponto');
  end if;
end $$;

-- status de férias/afastamento acompanha o calendário (rotina diária)
create or replace function public.atualizar_status_funcionarios()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.funcionarios f set status = 'ativo'
   where f.status in ('ferias', 'afastado')
     and not exists (select 1 from public.ausencias a where a.funcionario_id = f.id and a.status = 'aprovado' and current_date between a.inicio and a.fim and a.tipo in ('ferias', 'afastamento', 'licenca'));
  get diagnostics n = row_count;
  update public.funcionarios f set status = case when a.tipo = 'ferias' then 'ferias' else 'afastado' end
    from public.ausencias a
   where a.funcionario_id = f.id and f.status = 'ativo' and a.status = 'aprovado' and current_date between a.inicio and a.fim and a.tipo in ('ferias', 'afastamento', 'licenca');
  return n;
end $$;
revoke execute on function public.atualizar_status_funcionarios() from public, anon, authenticated;
select cron.schedule('geeasy-rh-status', '10 3 * * *', $$select public.atualizar_status_funcionarios()$$);

-- ---------------------------------------------------------------------
-- Cálculo diário e espelho
-- ---------------------------------------------------------------------
/**
 * Dia de trabalho: marcações válidas (sem as desconsideradas por ajuste aprovado), pares entrada/saída,
 * intervalo, esperado pela jornada (dias da semana; ausência aprovada zera o esperado), extras e atraso
 * descontada a tolerância (CLT art. 58 §1º), falta e intervalo não cumprido (CLT art. 71: > 6 h exige 1 h).
 */
create or replace function public.ponto_dia(p_func uuid, p_data date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f public.funcionarios; j public.jornadas; v_fuso text; v_ini timestamptz; v_fim timestamptz; m record;
  v_aberta timestamptz; v_trab int := 0; v_interv int := 0; v_saida_interv timestamptz; v_primeira timestamptz; v_n int := 0;
  v_esperado int := 0; v_extras int := 0; v_atraso int := 0; v_falta boolean := false; v_ausencia text; v_marc jsonb := '[]'; v_alertas text[] := '{}';
begin
  select * into f from public.funcionarios where id = p_func;
  select * into j from public.jornadas where id = f.jornada_id;
  select fuso into v_fuso from public.empresas where id = f.empresa_id;
  v_fuso := coalesce(v_fuso, 'America/Sao_Paulo');
  v_ini := (p_data::timestamp) at time zone v_fuso;
  v_fim := ((p_data + 1)::timestamp) at time zone v_fuso;
  select a.tipo into v_ausencia from public.ausencias a where a.funcionario_id = p_func and a.status = 'aprovado' and p_data between a.inicio and a.fim limit 1;
  if j.id is not null and extract(isodow from p_data)::int = any(j.dias) and v_ausencia is null
     and (f.admissao is null or p_data >= f.admissao) and (f.desligamento is null or p_data <= f.desligamento) then
    v_esperado := greatest(0, (extract(epoch from (j.saida - j.entrada)) / 60)::int - j.intervalo_min);
  end if;
  for m in select pm.id, pm.tipo, pm.horario, pm.offline, pm.fora_cerca, pm.origem, pm.flags from public.ponto_marcacoes pm
            where pm.funcionario_id = p_func and pm.horario >= v_ini and pm.horario < v_fim
              and not exists (select 1 from public.ponto_ajustes a where a.marcacao_id = pm.id and a.acao = 'desconsiderar' and a.status = 'aprovado')
            order by pm.horario loop
    v_n := v_n + 1;
    v_marc := v_marc || jsonb_build_object('tipo', m.tipo, 'hora', to_char(m.horario at time zone v_fuso, 'HH24:MI'), 'offline', m.offline, 'fora_cerca', m.fora_cerca, 'ajuste', m.origem = 'ajuste');
    if v_primeira is null then v_primeira := m.horario; end if;
    if m.tipo in ('entrada', 'intervalo_fim') then
      if m.tipo = 'intervalo_fim' and v_saida_interv is not null then v_interv := v_interv + (extract(epoch from m.horario - v_saida_interv) / 60)::int; v_saida_interv := null; end if;
      v_aberta := coalesce(v_aberta, m.horario);
    elsif m.tipo in ('intervalo_inicio', 'saida') and v_aberta is not null then
      v_trab := v_trab + (extract(epoch from m.horario - v_aberta) / 60)::int;
      v_aberta := null;
      if m.tipo = 'intervalo_inicio' then v_saida_interv := m.horario; end if;
    end if;
  end loop;
  if v_aberta is not null then v_alertas := array_append(v_alertas, 'sem_saida'); end if;
  if v_saida_interv is not null then v_alertas := array_append(v_alertas, 'intervalo_sem_retorno'); end if;
  if v_esperado > 0 and v_n = 0 and p_data < (now() at time zone v_fuso)::date then v_falta := true; end if;
  if v_trab > 360 and v_interv < 60 then v_alertas := array_append(v_alertas, 'intervalo_nao_cumprido'); end if;
  if j.id is not null and v_primeira is not null and v_esperado > 0 then
    v_atraso := greatest(0, (extract(epoch from (v_primeira at time zone v_fuso)::time - j.entrada) / 60)::int);
    if v_atraso <= j.tolerancia_min then v_atraso := 0; end if;
  end if;
  if abs(v_trab - v_esperado) > coalesce(j.tolerancia_min, 10) then v_extras := greatest(0, v_trab - v_esperado); end if;
  return jsonb_build_object('data', p_data, 'marcacoes', v_marc, 'trabalhado_min', v_trab, 'intervalo_min', v_interv, 'esperado_min', v_esperado,
    'extras_min', v_extras, 'atraso_min', v_atraso, 'falta', v_falta,
    'debito_min', case when v_falta then v_esperado when v_esperado > v_trab + coalesce(j.tolerancia_min, 10) and v_n > 0 then v_esperado - v_trab else 0 end,
    'ausencia', v_ausencia, 'alertas', v_alertas);
end $$;
revoke execute on function public.ponto_dia(uuid, date) from public, anon, authenticated;

create or replace function public.espelho_ponto(p_func uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ini date := date_trunc('month', p_competencia)::date; v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  d date; dia jsonb; v_dias jsonb := '[]'; t_trab int := 0; t_ext int := 0; t_atr int := 0; t_deb int := 0; t_faltas int := 0; f public.funcionarios;
begin
  if not public.pode_ver_funcionario(p_func) then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  select * into f from public.funcionarios where id = p_func and empresa_id = public.empresa_atual();
  if not found then raise exception 'Funcionário não encontrado.'; end if;
  d := v_ini;
  while d <= v_fim loop
    dia := public.ponto_dia(p_func, d);
    v_dias := v_dias || dia;
    t_trab := t_trab + (dia->>'trabalhado_min')::int; t_ext := t_ext + (dia->>'extras_min')::int; t_atr := t_atr + (dia->>'atraso_min')::int;
    t_deb := t_deb + (dia->>'debito_min')::int; t_faltas := t_faltas + case when (dia->>'falta')::boolean then 1 else 0 end;
    d := d + 1;
  end loop;
  return jsonb_build_object('funcionario', jsonb_build_object('id', f.id, 'nome', f.nome, 'matricula', f.matricula, 'cargo', f.cargo),
    'competencia', v_ini, 'dias', v_dias,
    'totais', jsonb_build_object('trabalhado_min', t_trab, 'extras_min', t_ext, 'atraso_min', t_atr, 'debito_min', t_deb, 'faltas', t_faltas,
                                 'saldo_min', t_ext - t_deb));
end $$;
revoke execute on function public.espelho_ponto(uuid, date) from public, anon;
grant execute on function public.espelho_ponto(uuid, date) to authenticated;

-- Fecha o espelho do mês (fica guardado com hash) para a ciência do funcionário
create or replace function public.fechar_espelho(p_func uuid, p_competencia date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_id uuid; v_comp date := date_trunc('month', p_competencia)::date; v_user uuid;
begin
  if not public.tem_permissao('ponto.gerir') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if v_comp >= date_trunc('month', now())::date then raise exception 'Só é possível fechar meses encerrados.'; end if;
  v_res := public.espelho_ponto(p_func, v_comp);
  if exists (select 1 from public.ponto_espelhos where funcionario_id = p_func and competencia = v_comp and ciencia_em is not null) then
    raise exception 'O funcionário já deu ciência neste espelho.';
  end if;
  insert into public.ponto_espelhos (empresa_id, funcionario_id, competencia, resumo, hash)
  values (public.empresa_atual(), p_func, v_comp, v_res, encode(sha256(convert_to(v_res::text, 'UTF8')), 'hex'))
  on conflict (funcionario_id, competencia) do update set resumo = excluded.resumo, hash = excluded.hash, gerado_em = now(), gerado_por = auth.uid(), contestacao = null
  returning id into v_id;
  select user_id into v_user from public.funcionarios where id = p_func;
  if v_user is not null then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (public.empresa_atual(), v_user, 'Espelho de ponto disponível', 'Confira o espelho de ' || to_char(v_comp, 'MM/YYYY') || ' e registre sua ciência.', '/ponto?tab=espelho');
  end if;
  return v_id;
end $$;

create or replace function public.ciencia_espelho(p_espelho uuid, p_contestacao text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.ponto_espelhos;
begin
  select * into e from public.ponto_espelhos where id = p_espelho and empresa_id = public.empresa_atual() for update;
  if not found or e.funcionario_id is distinct from public.meu_funcionario() then raise exception 'Espelho não encontrado.' using errcode = '42501'; end if;
  if e.ciencia_em is not null then raise exception 'Ciência já registrada.'; end if;
  if nullif(trim(p_contestacao), '') is not null then
    update public.ponto_espelhos set contestacao = left(p_contestacao, 2000) where id = p_espelho;
  else
    update public.ponto_espelhos set ciencia_em = now(),
           ciencia_ip = left(split_part(coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''), ',', 1), 64) where id = p_espelho;
  end if;
end $$;
-- espelhos só mudam por fechar_espelho/ciencia_espelho
create policy espelhos_bloqueio_update on public.ponto_espelhos as restrictive for update to authenticated using (false);

-- ---------------------------------------------------------------------
-- Pré-folha
-- ---------------------------------------------------------------------
/**
 * Consolida a competência: salário base + adicionais fixos; extras (valor-hora = salário/220, adicional de 50%);
 * faltas e débitos (valor-hora); comissões do consultor recebidas pela empresa na competência (a comissão fica
 * com quem fechou a venda — a regra dos 45 dias move a carteira, não a comissão já gerada); reembolsos de
 * despesas de rota aprovadas no mês. Refazer só enquanto estiver em revisão (ajustes manuais são preservados).
 */
create or replace function public.gerar_pre_folha(p_competencia date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_comp date := date_trunc('month', p_competencia)::date; v_id uuid; c public.folha_competencias;
  f record; v_esp jsonb; v_sal numeric; v_hora numeric; v_ext int; v_deb int; v_com numeric; v_reemb numeric; v_det jsonb;
begin
  if not public.tem_permissao('folha.gerir') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into c from public.folha_competencias where empresa_id = v_emp and competencia = v_comp for update;
  if found and c.status <> 'em_revisao' then raise exception 'A folha desta competência já foi aprovada.'; end if;
  if not found then
    insert into public.folha_competencias (empresa_id, competencia) values (v_emp, v_comp) returning * into c;
  end if;
  for f in select fu.id, fu.user_id, fu.nome, fu.controla_ponto, fu.jornada_id, coalesce(s.salario_base, 0) as salario, coalesce(s.adicionais_fixos, 0) as adicionais
             from public.funcionarios fu left join public.funcionario_sensiveis s on s.funcionario_id = fu.id
            where fu.empresa_id = v_emp
              and (fu.status <> 'desligado' or fu.desligamento >= v_comp)
              and (fu.admissao is null or fu.admissao <= (v_comp + interval '1 month - 1 day')::date) loop
    v_sal := f.salario; v_hora := case when v_sal > 0 then v_sal / 220 else 0 end;
    v_ext := 0; v_deb := 0;
    if f.controla_ponto and f.jornada_id is not null then
      v_esp := public.espelho_ponto(f.id, v_comp);
      v_ext := (v_esp->'totais'->>'extras_min')::int; v_deb := (v_esp->'totais'->>'debito_min')::int;
    end if;
    select coalesce(sum(cm.valor_consultor), 0) into v_com from public.comissoes cm
     where cm.empresa_id = v_emp and cm.consultor_id = f.user_id and f.user_id is not null and cm.status = 'recebida'
       and date_trunc('month', coalesce(cm.data_recebimento, cm.competencia))::date = v_comp;
    select coalesce(sum(d.valor), 0) into v_reemb from public.despesas_rota d
     where d.empresa_id = v_emp and d.consultor_id = f.user_id and f.user_id is not null and d.status = 'aprovada'
       and date_trunc('month', d.data)::date = v_comp;
    v_det := jsonb_build_object('valor_hora', round(v_hora, 4), 'extras_min', v_ext, 'debito_min', v_deb);
    insert into public.folha_itens (empresa_id, competencia_id, funcionario_id, salario_base, adicionais, horas_extras_min, valor_extras, faltas_min, desconto_faltas, comissoes, reembolsos, detalhes)
    values (v_emp, c.id, f.id, v_sal, f.adicionais, v_ext, round(v_ext / 60.0 * v_hora * 1.5, 2), v_deb, round(v_deb / 60.0 * v_hora, 2), v_com, v_reemb, v_det)
    on conflict (competencia_id, funcionario_id) do update set
      salario_base = excluded.salario_base, adicionais = excluded.adicionais, horas_extras_min = excluded.horas_extras_min, valor_extras = excluded.valor_extras,
      faltas_min = excluded.faltas_min, desconto_faltas = excluded.desconto_faltas, comissoes = excluded.comissoes, reembolsos = excluded.reembolsos, detalhes = excluded.detalhes;
  end loop;
  update public.folha_competencias set gerada_em = now(), gerada_por = auth.uid(),
         totais = (select jsonb_build_object('funcionarios', count(*), 'total', coalesce(sum(total), 0), 'extras', coalesce(sum(valor_extras), 0),
                                             'comissoes', coalesce(sum(comissoes), 0), 'reembolsos', coalesce(sum(reembolsos), 0))
                     from public.folha_itens where competencia_id = c.id)
   where id = c.id;
  return c.id;
end $$;

-- Aprovação (quem aprova não pode ser quem gerou, se houver outro gestor): vira contas a pagar no financeiro
create or replace function public.aprovar_folha(p_competencia_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.folha_competencias; i record; v_lanc uuid; n int := 0; v_venc date; v_dep uuid;
begin
  if not public.tem_permissao('folha.gerir') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into c from public.folha_competencias where id = p_competencia_id and empresa_id = public.empresa_atual() for update;
  if not found or c.status <> 'em_revisao' then raise exception 'Folha não encontrada ou já aprovada.'; end if;
  -- quinto dia útil do mês seguinte (sem feriados; ajuste manual no financeiro se preciso)
  select d::date into v_venc from generate_series((c.competencia + interval '1 month')::date, (c.competencia + interval '1 month' + interval '14 days')::date, interval '1 day') d
   where extract(isodow from d) < 6 order by d offset 4 limit 1;
  select id into v_dep from public.departamentos where empresa_id = c.empresa_id and tipo = 'rh' order by created_at limit 1;
  for i in select fi.*, fu.nome from public.folha_itens fi join public.funcionarios fu on fu.id = fi.funcionario_id where fi.competencia_id = c.id and fi.total > 0 loop
    insert into public.financeiro_lancamentos (empresa_id, tipo, categoria, descricao, valor, vencimento, departamento_id, fornecedor, documento_ref, observacoes)
    values (c.empresa_id, 'despesa', 'Folha e pró-labore', left('Folha ' || to_char(c.competencia, 'MM/YYYY') || ' — ' || i.nome, 300), i.total, v_venc, v_dep, left(i.nome, 200),
            'folha:' || i.id, 'Gerado pela aprovação da pré-folha (salário, extras, comissões e reembolsos de rota).')
    returning id into v_lanc;
    update public.folha_itens set lancamento_id = v_lanc where id = i.id;
    n := n + 1;
  end loop;
  update public.folha_competencias set status = 'aprovada', aprovada_por = auth.uid(), aprovada_em = now() where id = c.id;
  return n;
end $$;

revoke execute on function public.decidir_ajuste(uuid, boolean, text), public.decidir_ausencia(uuid, boolean), public.fechar_espelho(uuid, date),
  public.ciencia_espelho(uuid, text), public.gerar_pre_folha(date), public.aprovar_folha(uuid) from public, anon;
grant execute on function public.decidir_ajuste(uuid, boolean, text), public.decidir_ausencia(uuid, boolean), public.fechar_espelho(uuid, date),
  public.ciencia_espelho(uuid, text), public.gerar_pre_folha(date), public.aprovar_folha(uuid) to authenticated;

-- parâmetros do ponto e da folha gravados por quem gere (além do admin)
create or replace function public.pode_configurar(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_chave
    when 'rotas' then public.tem_permissao('rotas.definir')
    when 'leads' then public.tem_permissao('leads.distribuir')
    when 'whatsapp' then public.tem_permissao('whatsapp.configurar')
    when 'ponto' then public.tem_permissao('ponto.gerir')
    else false end
$$;
