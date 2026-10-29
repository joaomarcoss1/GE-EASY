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
