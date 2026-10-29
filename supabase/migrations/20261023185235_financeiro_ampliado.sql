-- =====================================================================
-- GE EASY — Fase 8: financeiro ampliado
--
-- * centros de custo (departamento, rota, equipe, campanha) e contas bancárias;
-- * contas fixas recorrentes geradas automaticamente todo mês (idempotente);
-- * aprovação por alçada: despesa a partir do valor configurado só é paga depois de aprovada por outra pessoa;
--   baixa de pagamentos exige financeiro.pagar;
-- * extrato bancário (OFX) e conciliação (sugestão automática por valor/data, confirmação manual);
-- * relatórios: fluxo de caixa previsto × realizado, DRE gerencial, despesas por centro de custo, inadimplência.
-- A folha aprovada pelo RH (fase 7) já entra como contas a pagar; reembolsos de rota vão na folha.
-- =====================================================================

create table public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 120),
  tipo text not null default 'departamento' check (tipo in ('departamento', 'rota', 'equipe', 'campanha', 'projeto', 'outro')),
  departamento_id uuid references public.departamentos(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table public.contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 120),
  banco text check (char_length(banco) <= 80),
  agencia text check (char_length(agencia) <= 20),
  conta text check (char_length(conta) <= 30),
  saldo_inicial numeric(19,2) not null default 0,
  saldo_inicial_em date not null default current_date,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.financeiro_recorrencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  tipo public.fin_tipo not null default 'despesa',
  categoria text not null check (char_length(categoria) between 2 and 80),
  descricao text not null check (char_length(descricao) between 2 and 300),
  valor numeric(19,2) not null check (valor > 0),
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  fornecedor text check (char_length(fornecedor) <= 200),
  cliente_id uuid references public.clientes(id) on delete set null,
  departamento_id uuid references public.departamentos(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  conta_id uuid references public.contas_bancarias(id) on delete set null,
  inicio date not null default date_trunc('month', current_date)::date,
  fim date,
  ativo boolean not null default true,
  ultima_competencia date,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.financeiro_lancamentos
  add column if not exists centro_custo_id uuid references public.centros_custo(id) on delete set null,
  add column if not exists conta_id uuid references public.contas_bancarias(id) on delete set null,
  add column if not exists recorrencia_id uuid references public.financeiro_recorrencias(id) on delete set null,
  add column if not exists aprovacao text not null default 'dispensada' check (aprovacao in ('dispensada', 'pendente', 'aprovada', 'recusada')),
  add column if not exists aprovado_por uuid references public.profiles(id) on delete set null,
  add column if not exists aprovado_em timestamptz,
  add column if not exists aprovacao_obs text check (char_length(aprovacao_obs) <= 500),
  add column if not exists conciliado boolean not null default false;
create unique index if not exists fin_recorrencia_mes_uniq on public.financeiro_lancamentos (recorrencia_id, vencimento) where recorrencia_id is not null;
create index if not exists fin_aprovacao_idx on public.financeiro_lancamentos (empresa_id, aprovacao) where aprovacao = 'pendente';
create index if not exists fin_centro_idx on public.financeiro_lancamentos (empresa_id, centro_custo_id, vencimento);

create table public.extrato_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  conta_id uuid not null references public.contas_bancarias(id) on delete cascade,
  data date not null,
  valor numeric(19,2) not null check (valor <> 0), -- positivo = crédito, negativo = débito
  descricao text check (char_length(descricao) <= 300),
  fitid text not null check (char_length(fitid) between 1 and 120),
  lancamento_id uuid references public.financeiro_lancamentos(id) on delete set null,
  conciliado_em timestamptz,
  conciliado_por uuid references public.profiles(id) on delete set null,
  importado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (conta_id, fitid)
);
create index on public.extrato_movimentos (empresa_id, conta_id, data) where lancamento_id is null;

create trigger zz_empresa_vinculos before insert or update on public.centros_custo for each row execute function public.empresa_vinculos('departamento_id:departamentos');
create trigger zz_empresa_vinculos before insert or update on public.contas_bancarias for each row execute function public.empresa_vinculos();
create trigger zz_empresa_vinculos before insert or update on public.financeiro_recorrencias for each row
  execute function public.empresa_vinculos('cliente_id:clientes', 'departamento_id:departamentos', 'centro_custo_id:centros_custo', 'conta_id:contas_bancarias');
create trigger zz_empresa_vinculos before insert or update on public.extrato_movimentos for each row execute function public.empresa_vinculos('conta_id:contas_bancarias', 'lancamento_id:financeiro_lancamentos');
-- os novos vínculos do lançamento também são conferidos
create trigger zz_empresa_vinculos_fin8 before insert or update of centro_custo_id, conta_id, recorrencia_id on public.financeiro_lancamentos for each row
  execute function public.empresa_vinculos('centro_custo_id:centros_custo', 'conta_id:contas_bancarias', 'recorrencia_id:financeiro_recorrencias');
do $$
declare t text;
begin
  foreach t in array array['centros_custo', 'contas_bancarias', 'financeiro_recorrencias', 'extrato_movimentos'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()))', t || '_empresa', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.tem_permissao(''financeiro.view'')))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.tem_permissao(''financeiro.conciliar'')))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.tem_permissao(''financeiro.conciliar'')))', t || '_update', t);
  end loop;
end $$;
-- centros de custo também podem ser lidos por quem lança despesas de processo (jurídico)
create policy centros_custo_select_juridico on public.centros_custo for select to authenticated using ((select public.tem_permissao('processos.write')));

-- ---------------------------------------------------------------------
-- Alçada de aprovação e baixa
-- ---------------------------------------------------------------------
create or replace function public.parametros_financeiro(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('alcada_aprovacao', 5000) || coalesce((select c.valor from public.configuracoes c where c.empresa_id = p_empresa and c.chave = 'financeiro'), '{}'::jsonb)
$$;
revoke execute on function public.parametros_financeiro(uuid) from public, anon, authenticated;

create or replace function public.fin_alcada()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_alc numeric;
begin
  if new.tipo <> 'despesa' then return new; end if;
  v_alc := (public.parametros_financeiro(new.empresa_id)->>'alcada_aprovacao')::numeric;
  -- folha aprovada pelo RH já chega aprovada
  if tg_op = 'INSERT' and coalesce(new.documento_ref, '') like 'folha:%' then
    new.aprovacao := 'aprovada'; new.aprovado_em := now(); new.aprovado_por := auth.uid();
  elsif v_alc > 0 and new.valor >= v_alc and (tg_op = 'INSERT' or new.valor > old.valor) and new.status <> 'cancelado' then
    new.aprovacao := 'pendente'; new.aprovado_por := null; new.aprovado_em := null;
  elsif tg_op = 'INSERT' then
    new.aprovacao := 'dispensada';
  end if;
  -- só funções de aprovação mudam a situação da aprovação
  if tg_op = 'UPDATE' and new.aprovacao is distinct from old.aprovacao and coalesce(current_setting('geeasy.fin_aprovacao', true), '') <> 'on'
     and not (new.aprovacao = 'pendente' and new.valor > old.valor) then
    new.aprovacao := old.aprovacao; new.aprovado_por := old.aprovado_por; new.aprovado_em := old.aprovado_em;
  end if;
  if new.status = 'pago' and (tg_op = 'INSERT' or old.status <> 'pago') then
    if new.aprovacao in ('pendente', 'recusada') then
      raise exception 'Despesa acima da alçada: precisa de aprovação antes do pagamento.' using errcode = '23514';
    end if;
    if auth.uid() is not null and coalesce(current_setting('geeasy.fin_conciliacao', true), '') <> 'on' and not public.tem_permissao('financeiro.pagar') then
      raise exception 'Baixar pagamentos exige a permissão de pagar.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.fin_alcada() from public, anon, authenticated;
create trigger trg_fin_alcada before insert or update on public.financeiro_lancamentos for each row execute function public.fin_alcada();

create or replace function public.aprovar_lancamento(p_id uuid, p_aprovar boolean, p_obs text)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.financeiro_lancamentos;
begin
  if not public.tem_permissao('financeiro.pagar') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into l from public.financeiro_lancamentos where id = p_id and empresa_id = public.empresa_atual() for update;
  if not found or l.aprovacao <> 'pendente' then raise exception 'Lançamento não encontrado ou sem aprovação pendente.'; end if;
  if l.created_by = auth.uid() then raise exception 'Quem lançou não pode aprovar a própria despesa.' using errcode = '42501'; end if;
  if not p_aprovar and coalesce(trim(p_obs), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  perform set_config('geeasy.fin_aprovacao', 'on', true);
  update public.financeiro_lancamentos set aprovacao = case when p_aprovar then 'aprovada' else 'recusada' end, aprovado_por = auth.uid(), aprovado_em = now(), aprovacao_obs = left(p_obs, 500)
   where id = p_id;
  perform set_config('geeasy.fin_aprovacao', 'off', true);
  if l.created_by is not null then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (l.empresa_id, l.created_by, case when p_aprovar then 'Despesa aprovada' else 'Despesa recusada' end, left(l.descricao || coalesce(' — ' || p_obs, ''), 300), '/financeiro?aba=pagar');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Recorrências (rotina diária: gera o mês corrente e o próximo, sem duplicar)
-- ---------------------------------------------------------------------
create or replace function public.gerar_recorrencias(p_empresa uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r public.financeiro_recorrencias; v_mes date; v_ate date := (date_trunc('month', current_date) + interval '1 month')::date; v_venc date; n int := 0; v_ultimo int;
begin
  if p_empresa is not null and not (public.tem_permissao('financeiro.conciliar') and p_empresa = public.empresa_atual()) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  for r in select * from public.financeiro_recorrencias x where x.ativo and (p_empresa is null or x.empresa_id = p_empresa) for update skip locked loop
    v_mes := greatest(date_trunc('month', r.inicio)::date, coalesce((r.ultima_competencia + interval '1 month')::date, date_trunc('month', r.inicio)::date));
    while v_mes <= v_ate and (r.fim is null or v_mes <= r.fim) loop
      v_ultimo := extract(day from (v_mes + interval '1 month - 1 day'))::int;
      v_venc := v_mes + (least(r.dia_vencimento, v_ultimo) - 1);
      insert into public.financeiro_lancamentos (empresa_id, tipo, categoria, descricao, valor, vencimento, fornecedor, cliente_id, departamento_id, centro_custo_id, conta_id, recorrencia_id, created_by, observacoes)
      values (r.empresa_id, r.tipo, r.categoria, left(r.descricao || ' — ' || to_char(v_mes, 'MM/YYYY'), 300), r.valor, v_venc, r.fornecedor, r.cliente_id, r.departamento_id, r.centro_custo_id, r.conta_id, r.id, r.created_by,
              'Gerado automaticamente pela recorrência.')
      on conflict (recorrencia_id, vencimento) where recorrencia_id is not null do nothing;
      if found then n := n + 1; end if;
      update public.financeiro_recorrencias set ultima_competencia = v_mes where id = r.id;
      v_mes := (v_mes + interval '1 month')::date;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.gerar_recorrencias(uuid) from public, anon;
grant execute on function public.gerar_recorrencias(uuid) to authenticated;
select cron.schedule('geeasy-fin-recorrencias', '20 4 * * *', $$select public.gerar_recorrencias()$$);

-- ---------------------------------------------------------------------
-- Conciliação bancária
-- ---------------------------------------------------------------------
create or replace function public.conciliar_movimento(p_mov uuid, p_lanc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.extrato_movimentos; l public.financeiro_lancamentos;
begin
  if not public.tem_permissao('financeiro.conciliar') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into m from public.extrato_movimentos where id = p_mov and empresa_id = public.empresa_atual() for update;
  select * into l from public.financeiro_lancamentos where id = p_lanc and empresa_id = public.empresa_atual() for update;
  if m.id is null or l.id is null then raise exception 'Movimento ou lançamento não encontrado.'; end if;
  if m.lancamento_id is not null or l.conciliado then raise exception 'Já conciliado.'; end if;
  if l.status = 'cancelado' then raise exception 'Lançamento cancelado.'; end if;
  if (m.valor > 0) <> (l.tipo = 'receita') then raise exception 'Crédito concilia com receita; débito com despesa.'; end if;
  if abs(abs(m.valor) - coalesce(l.valor_pago, l.valor)) > 0.01 then raise exception 'Os valores não conferem (extrato % × lançamento %).', abs(m.valor), coalesce(l.valor_pago, l.valor); end if;
  perform set_config('geeasy.fin_conciliacao', 'on', true);
  update public.financeiro_lancamentos set status = 'pago', data_pagamento = coalesce(data_pagamento, m.data), valor_pago = coalesce(valor_pago, abs(m.valor)),
         conta_id = coalesce(conta_id, m.conta_id), conciliado = true
   where id = l.id;
  perform set_config('geeasy.fin_conciliacao', 'off', true);
  update public.extrato_movimentos set lancamento_id = l.id, conciliado_em = now(), conciliado_por = auth.uid() where id = m.id;
end $$;

-- sugestões: mesmo sentido, mesmo valor, vencimento/pagamento a até 5 dias; um lançamento por movimento
create or replace function public.sugerir_conciliacao(p_conta uuid)
returns table (movimento_id uuid, lancamento_id uuid, dias int) language sql stable security definer set search_path = '' as $$
  with m as (
    select * from public.extrato_movimentos where conta_id = p_conta and empresa_id = public.empresa_atual() and lancamento_id is null
  ), c as (
    select m.id as movimento_id, l.id as lancamento_id, abs(coalesce(l.data_pagamento, l.vencimento) - m.data) as dias,
           row_number() over (partition by m.id order by abs(coalesce(l.data_pagamento, l.vencimento) - m.data), l.created_at) as rm,
           row_number() over (partition by l.id order by abs(coalesce(l.data_pagamento, l.vencimento) - m.data), m.data) as rl
      from m join public.financeiro_lancamentos l
        on l.empresa_id = m.empresa_id and not l.conciliado and l.status <> 'cancelado'
       and l.tipo = case when m.valor > 0 then 'receita' else 'despesa' end::public.fin_tipo
       and abs(coalesce(l.valor_pago, l.valor) - abs(m.valor)) <= 0.01
       and abs(coalesce(l.data_pagamento, l.vencimento) - m.data) <= 5
       and (l.aprovacao not in ('pendente', 'recusada'))
  )
  select movimento_id, lancamento_id, dias from c where rm = 1 and rl = 1 and public.tem_permissao('financeiro.view')
$$;
revoke execute on function public.conciliar_movimento(uuid, uuid), public.sugerir_conciliacao(uuid), public.aprovar_lancamento(uuid, boolean, text) from public, anon;
grant execute on function public.conciliar_movimento(uuid, uuid), public.sugerir_conciliacao(uuid), public.aprovar_lancamento(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Relatórios
-- ---------------------------------------------------------------------
create or replace function public.relatorio_financeiro(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual();
begin
  if not (public.tem_permissao('financeiro.view') or public.tem_permissao('relatorios.view')) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'fluxo', (select coalesce(jsonb_agg(x order by x.mes), '[]') from (
        select to_char(mes, 'YYYY-MM') as mes,
               (select coalesce(sum(valor), 0) from public.financeiro_lancamentos where empresa_id = v_emp and tipo = 'receita' and status <> 'cancelado' and date_trunc('month', vencimento) = mes) as receita_prevista,
               (select coalesce(sum(coalesce(valor_pago, valor)), 0) from public.financeiro_lancamentos where empresa_id = v_emp and tipo = 'receita' and status = 'pago' and date_trunc('month', data_pagamento) = mes) as receita_realizada,
               (select coalesce(sum(valor), 0) from public.financeiro_lancamentos where empresa_id = v_emp and tipo = 'despesa' and status <> 'cancelado' and date_trunc('month', vencimento) = mes) as despesa_prevista,
               (select coalesce(sum(coalesce(valor_pago, valor)), 0) from public.financeiro_lancamentos where empresa_id = v_emp and tipo = 'despesa' and status = 'pago' and date_trunc('month', data_pagamento) = mes) as despesa_realizada
          from generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') mes) x),
    'dre', (select jsonb_build_object(
        'receitas', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', v) order by v desc) from (select categoria, sum(valor) v from public.financeiro_lancamentos
            where empresa_id = v_emp and tipo = 'receita' and status <> 'cancelado' and vencimento between p_inicio and p_fim group by 1) a), '[]'),
        'despesas', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', v) order by v desc) from (select categoria, sum(valor) v from public.financeiro_lancamentos
            where empresa_id = v_emp and tipo = 'despesa' and status <> 'cancelado' and vencimento between p_inicio and p_fim group by 1) a), '[]'),
        'total_receitas', (select coalesce(sum(valor), 0) from public.financeiro_lancamentos where empresa_id = v_emp and tipo = 'receita' and status <> 'cancelado' and vencimento between p_inicio and p_fim),
        'total_despesas', (select coalesce(sum(valor), 0) from public.financeiro_lancamentos where empresa_id = v_emp and tipo = 'despesa' and status <> 'cancelado' and vencimento between p_inicio and p_fim))),
    'centros', (select coalesce(jsonb_agg(x order by x.despesas desc), '[]') from (
        select coalesce(c.nome, 'Sem centro de custo') as centro, sum(l.valor) filter (where l.tipo = 'despesa') as despesas, sum(l.valor) filter (where l.tipo = 'receita') as receitas
          from public.financeiro_lancamentos l left join public.centros_custo c on c.id = l.centro_custo_id
         where l.empresa_id = v_emp and l.status <> 'cancelado' and l.vencimento between p_inicio and p_fim group by 1) x),
    'inadimplencia', (select jsonb_build_object(
        'ate_30', coalesce(sum(valor) filter (where current_date - vencimento between 1 and 30), 0),
        'de_31_60', coalesce(sum(valor) filter (where current_date - vencimento between 31 and 60), 0),
        'de_61_90', coalesce(sum(valor) filter (where current_date - vencimento between 61 and 90), 0),
        'acima_90', coalesce(sum(valor) filter (where current_date - vencimento > 90), 0),
        'devedores', coalesce((select jsonb_agg(d order by d.valor desc) from (
            select cl.id, cl.nome, sum(l2.valor) as valor, min(l2.vencimento) as desde from public.financeiro_lancamentos l2 join public.clientes cl on cl.id = l2.cliente_id
             where l2.empresa_id = v_emp and l2.tipo = 'receita' and l2.status = 'aberto' and l2.vencimento < current_date group by 1, 2 order by 3 desc limit 15) d), '[]'))
        from public.financeiro_lancamentos where empresa_id = v_emp and tipo = 'receita' and status = 'aberto' and vencimento < current_date),
    'saldos', (select coalesce(jsonb_agg(x order by x.nome), '[]') from (
        select cb.nome, cb.saldo_inicial + coalesce((select sum(case when l.tipo = 'receita' then coalesce(l.valor_pago, l.valor) else -coalesce(l.valor_pago, l.valor) end)
                 from public.financeiro_lancamentos l where l.conta_id = cb.id and l.status = 'pago' and l.data_pagamento >= cb.saldo_inicial_em), 0) as saldo
          from public.contas_bancarias cb where cb.empresa_id = v_emp and cb.ativo) x)
  );
end $$;
revoke execute on function public.relatorio_financeiro(date, date) from public, anon;
grant execute on function public.relatorio_financeiro(date, date) to authenticated;

-- parâmetros do financeiro (alçada) gravados por quem concilia/paga
create or replace function public.pode_configurar(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_chave
    when 'rotas' then public.tem_permissao('rotas.definir')
    when 'leads' then public.tem_permissao('leads.distribuir')
    when 'whatsapp' then public.tem_permissao('whatsapp.configurar')
    when 'ponto' then public.tem_permissao('ponto.gerir')
    when 'financeiro' then public.tem_permissao('financeiro.pagar') and public.tem_permissao('financeiro.conciliar')
    else false end
$$;
