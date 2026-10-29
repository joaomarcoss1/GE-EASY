-- =====================================================================
-- GE EASY — Fase 9: relatórios e BI
--
-- * vendas: situação (em negociação, enviada, aprovada, cancelada, pendente de confirmação) e vínculo com
--   lead, rota e campanha;
-- * indicadores diários por empresa e consultor (rotina diária; refaz os últimos dias para dados atrasados),
--   para que relatórios do mês não varram milhões de linhas;
-- * relatório mensal geral gerado sozinho no 1º dia útil do mês seguinte (e sob demanda): gastos, rotas,
--   clientes novos e custo por cliente, documentação e 45 dias, vendas/processos com lista nominal, WhatsApp,
--   ranking ponderado configurável e pontos de atenção automáticos; comparação com o mês anterior;
-- * relatório operacional por período/consultor (check-ins, km, gastos, locomoção, CAC de campo...).
-- =====================================================================

alter table public.oportunidades
  add column if not exists situacao_venda text check (situacao_venda in ('em_negociacao', 'enviada', 'aprovada', 'cancelada', 'pendente_confirmacao')),
  add column if not exists lead_id uuid references public.leads(id) on delete set null,
  add column if not exists rota_id uuid references public.rotas(id) on delete set null,
  add column if not exists campanha text check (char_length(campanha) <= 200),
  add column if not exists situacao_em timestamptz;
create index if not exists oportunidades_situacao_idx on public.oportunidades (empresa_id, situacao_venda, situacao_em);

create or replace function public.oportunidade_situacao()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- sem situação informada, deriva da etapa do funil
  if new.situacao_venda is null or (tg_op = 'UPDATE' and new.etapa is distinct from old.etapa and new.situacao_venda is not distinct from old.situacao_venda) then
    new.situacao_venda := case new.etapa when 'ganho' then 'aprovada' when 'perdido' then 'cancelada' when 'proposta' then 'enviada' when 'negociacao' then 'em_negociacao'
                          else coalesce(new.situacao_venda, 'em_negociacao') end;
  end if;
  if tg_op = 'INSERT' or new.situacao_venda is distinct from old.situacao_venda then new.situacao_em := now(); end if;
  return new;
end $$;
create trigger trg_oportunidade_situacao before insert or update on public.oportunidades for each row execute function public.oportunidade_situacao();
create trigger zz_empresa_vinculos_bi before insert or update of lead_id, rota_id on public.oportunidades for each row execute function public.empresa_vinculos('lead_id:leads', 'rota_id:rotas');
alter table public.oportunidades disable trigger trg_oportunidade_situacao;
update public.oportunidades set situacao_venda = case etapa when 'ganho' then 'aprovada' when 'perdido' then 'cancelada' when 'proposta' then 'enviada' else 'em_negociacao' end,
       situacao_em = coalesce(fechado_em, updated_at) where situacao_venda is null;
alter table public.oportunidades enable trigger trg_oportunidade_situacao;

-- ---------------------------------------------------------------------
-- Indicadores diários
-- ---------------------------------------------------------------------
create table public.indicadores_diarios (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dia date not null,
  consultor_id uuid references public.profiles(id) on delete cascade, -- null = total da empresa
  chave uuid generated always as (coalesce(consultor_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  m jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, dia, chave)
);
create index on public.indicadores_diarios (empresa_id, consultor_id, dia);
alter table public.indicadores_diarios enable row level security;
revoke all on public.indicadores_diarios from anon;
create policy indicadores_select on public.indicadores_diarios for select to authenticated
  using (empresa_id = (select public.empresa_atual()) and ((select public.tem_permissao('relatorios.view')) or (select public.is_manager()) or consultor_id = (select auth.uid())));

create or replace function public.agregar_indicadores(p_empresa uuid, p_dia date)
returns int language plpgsql security definer set search_path = '' as $$
declare v_fuso text; v_ini timestamptz; v_fim timestamptz; n int;
begin
  select coalesce(fuso, 'America/Sao_Paulo') into v_fuso from public.empresas where id = p_empresa;
  v_ini := (p_dia::timestamp) at time zone v_fuso;
  v_fim := ((p_dia + 1)::timestamp) at time zone v_fuso;
  delete from public.indicadores_diarios where empresa_id = p_empresa and dia = p_dia;
  with rs as (
    select r.id, r.consultor_id, r.status, coalesce(r.resumo, public.rota_resumo(r.id)) as s
      from public.rotas r where r.empresa_id = p_empresa and r.data = p_dia and r.status <> 'cancelada'
  ), base(consultor_id, k, v) as (
              select consultor_id, 'rotas', count(*)::numeric from rs group by 1
    union all select consultor_id, 'rotas_concluidas', count(*) filter (where status in ('concluida', 'aprovada')) from rs group by 1
    union all select consultor_id, 'paradas', sum((s->>'paradas')::numeric) from rs group by 1
    union all select consultor_id, 'paradas_visitadas', sum((s->>'visitadas')::numeric) from rs group by 1
    union all select consultor_id, 'km', sum((s->>'km')::numeric) from rs group by 1
    union all select consultor_id, 'tempo_locomocao_min', sum((s->>'tempo_locomocao_min')::numeric) from rs group by 1
    union all select consultor_id, 'tempo_visita_min', sum((s->>'tempo_visita_min')::numeric) from rs group by 1
    union all select consultor_id, 'custo_rotas', sum((s->>'custo_total')::numeric) from rs group by 1
    union all select consultor_id, 'adquiridos_rota', sum((s->>'adquiridos')::numeric) from rs group by 1
    union all select c.consultor_id, 'checkins', count(*) from public.checkins c where c.empresa_id = p_empresa and c.tipo = 'chegada' and c.registrado_em >= v_ini and c.registrado_em < v_fim group by 1
    union all select c.consultor_id, 'checkins_fora_raio', count(*) filter (where c.dentro_do_raio = false) from public.checkins c where c.empresa_id = p_empresa and c.tipo = 'chegada' and c.registrado_em >= v_ini and c.registrado_em < v_fim group by 1
    union all select c.consultor_id, 'checkins_inconsistentes', count(*) filter (where cardinality(c.flags) > 0) from public.checkins c where c.empresa_id = p_empresa and c.registrado_em >= v_ini and c.registrado_em < v_fim group by 1
    union all select d.consultor_id, 'despesas_rota', sum(d.valor) from public.despesas_rota d where d.empresa_id = p_empresa and d.data = p_dia and d.status <> 'recusada' group by 1
    union all select cl.consultor_id, 'clientes_novos', count(*) from public.clientes cl where cl.empresa_id = p_empresa and cl.created_at >= v_ini and cl.created_at < v_fim and cl.excluido_em is null group by 1
    union all select l.responsavel_id, 'leads', count(*) from public.leads l where l.empresa_id = p_empresa and l.created_at >= v_ini and l.created_at < v_fim group by 1
    union all select l.responsavel_id, 'leads_convertidos', count(*) from public.leads l where l.empresa_id = p_empresa and l.convertido_em >= v_ini and l.convertido_em < v_fim group by 1
    union all select l.responsavel_id, 'leads_sla_estourado', count(*) filter (where l.sla_estourado) from public.leads l where l.empresa_id = p_empresa and l.created_at >= v_ini and l.created_at < v_fim group by 1
    union all select h.de_usuario, 'transferidos_45', count(*) from public.cliente_carteira_historico h where h.empresa_id = p_empresa and h.motivo = 'regra_prazo_documentacao' and h.created_at >= v_ini and h.created_at < v_fim group by 1
    union all select dc.enviado_por, 'docs_enviados', count(*) from public.documentos dc where dc.empresa_id = p_empresa and dc.created_at >= v_ini and dc.created_at < v_fim group by 1
    union all select null::uuid, 'docs_aprovados', count(*) filter (where dc.analise_status = 'aprovado') from public.documentos dc where dc.empresa_id = p_empresa and dc.analisado_em >= v_ini and dc.analisado_em < v_fim
    union all select null::uuid, 'docs_recusados', count(*) filter (where dc.analise_status = 'recusado') from public.documentos dc where dc.empresa_id = p_empresa and dc.analisado_em >= v_ini and dc.analisado_em < v_fim
    union all select w.atendente_id, 'wa_conversas', count(*) from public.wa_conversas w where w.empresa_id = p_empresa and w.created_at >= v_ini and w.created_at < v_fim group by 1
    union all select w.atendente_id, 'wa_sla_estourado', count(*) filter (where w.sla_ate is not null and coalesce(w.primeira_resposta_em, now()) > w.sla_ate) from public.wa_conversas w where w.empresa_id = p_empresa and w.created_at >= v_ini and w.created_at < v_fim group by 1
    union all select w.atendente_id, 'wa_resolvidas', count(*) from public.wa_conversas w where w.empresa_id = p_empresa and w.resolvida_em >= v_ini and w.resolvida_em < v_fim group by 1
    union all select o.consultor_id, 'vendas_aprovadas', count(*) from public.oportunidades o where o.empresa_id = p_empresa and o.situacao_venda = 'aprovada' and o.situacao_em >= v_ini and o.situacao_em < v_fim group by 1
    union all select o.consultor_id, 'valor_vendas', sum(o.valor) from public.oportunidades o where o.empresa_id = p_empresa and o.situacao_venda = 'aprovada' and o.situacao_em >= v_ini and o.situacao_em < v_fim group by 1
    union all select o.consultor_id, 'vendas_canceladas', count(*) from public.oportunidades o where o.empresa_id = p_empresa and o.situacao_venda = 'cancelada' and o.situacao_em >= v_ini and o.situacao_em < v_fim group by 1
    union all select null::uuid, 'processos_encaminhados', count(*) from public.processos p where p.empresa_id = p_empresa and p.encaminhado_em >= v_ini and p.encaminhado_em < v_fim
  ), limpo as (
    select consultor_id, k, coalesce(v, 0) as v from base where coalesce(v, 0) <> 0
  ), por_consultor as (
    select consultor_id, jsonb_object_agg(k, v) as m from (select consultor_id, k, sum(v) as v from limpo where consultor_id is not null group by 1, 2) x group by 1
  ), total as (
    select jsonb_object_agg(k, v) as m from (select k, sum(v) as v from limpo group by 1) x
  )
  insert into public.indicadores_diarios (empresa_id, dia, consultor_id, m)
  select p_empresa, p_dia, pc.consultor_id, pc.m from por_consultor pc
   where exists (select 1 from public.profiles pr where pr.id = pc.consultor_id)
  union all
  select p_empresa, p_dia, null, coalesce(t.m, '{}'::jsonb) from total t;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.agregar_indicadores(uuid, date) from public, anon, authenticated;

-- rotina diária: refaz os últimos dias de todas as empresas (dados que chegam atrasados pelo app offline)
create or replace function public.agregar_todas(p_dias int default 3)
returns int language plpgsql security definer set search_path = '' as $$
declare e record; d int; n int := 0;
begin
  for e in select id, fuso from public.empresas where status in ('trial', 'ativa') loop
    for d in 0..greatest(0, p_dias) loop
      n := n + public.agregar_indicadores(e.id, ((now() at time zone coalesce(e.fuso, 'America/Sao_Paulo'))::date - d));
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.agregar_todas(int) from public, anon, authenticated;
select cron.schedule('geeasy-indicadores', '30 2 * * *', $$select public.agregar_todas(3)$$);

-- soma dos indicadores de um período (total e por consultor)
create or replace function public._somar_indicadores(p_empresa uuid, p_inicio date, p_fim date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', coalesce((select jsonb_object_agg(k, v) from (select k, sum(v::numeric) as v from public.indicadores_diarios i, jsonb_each_text(i.m) as x(k, v)
                       where i.empresa_id = p_empresa and i.consultor_id is null and i.dia between p_inicio and p_fim group by 1) t), '{}'::jsonb),
    'consultores', coalesce((select jsonb_agg(jsonb_build_object('consultor_id', consultor_id, 'nome', nome, 'm', m) order by nome) from (
        select i.consultor_id, coalesce(p.full_name, p.email) as nome, jsonb_object_agg(k, v) as m
          from (select i2.consultor_id, k, sum(v::numeric) as v from public.indicadores_diarios i2, jsonb_each_text(i2.m) as x(k, v)
                 where i2.empresa_id = p_empresa and i2.consultor_id is not null and i2.dia between p_inicio and p_fim group by 1, 2) i
          join public.profiles p on p.id = i.consultor_id group by 1, 2) c), '[]'::jsonb))
$$;
revoke execute on function public._somar_indicadores(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Relatório operacional (tela de relatórios): período e, opcionalmente, um consultor
-- ---------------------------------------------------------------------
create or replace function public.relatorio_operacional(p_inicio date, p_fim date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); d date;
begin
  if not (public.tem_permissao('relatorios.view') or public.is_manager()) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if p_fim - p_inicio > 400 then raise exception 'Período máximo de 400 dias.'; end if;
  -- o dia de hoje (e dias nunca agregados do período) são calculados na hora
  d := p_inicio;
  while d <= least(p_fim, current_date) loop
    if d = current_date or not exists (select 1 from public.indicadores_diarios where empresa_id = v_emp and dia = d and consultor_id is null) then
      perform public.agregar_indicadores(v_emp, d);
    end if;
    d := d + 1;
  end loop;
  return public._somar_indicadores(v_emp, p_inicio, p_fim);
end $$;
revoke execute on function public.relatorio_operacional(date, date) from public, anon;
grant execute on function public.relatorio_operacional(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Relatório mensal geral
-- ---------------------------------------------------------------------
create table public.relatorios_mensais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  dados jsonb not null,
  gerado_em timestamptz not null default now(),
  gerado_por uuid references public.profiles(id) on delete set null,
  automatico boolean not null default false,
  email_enviado_em timestamptz,
  unique (empresa_id, competencia)
);
alter table public.relatorios_mensais enable row level security;
revoke all on public.relatorios_mensais from anon;
create policy relatorios_mensais_select on public.relatorios_mensais for select to authenticated
  using (empresa_id = (select public.empresa_atual()) and ((select public.tem_permissao('relatorios.view')) or (select public.is_manager())));
create trigger trg_audit_relatorios_mensais after insert or update or delete on public.relatorios_mensais for each row execute function public.audit_trigger();

create or replace function public.parametros_relatorios(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pesos', jsonb_build_object('clientes_novos', 3, 'vendas_aprovadas', 5, 'paradas_visitadas', 1, 'leads_convertidos', 2, 'checkins_fora_raio', -1, 'transferidos_45', -2),
    'limite_fora_raio_pct', 20, 'fator_custo_cliente', 2, 'destinatarios', '[]'::jsonb)
    || coalesce((select c.valor from public.configuracoes c where c.empresa_id = p_empresa and c.chave = 'relatorios'), '{}'::jsonb)
$$;
revoke execute on function public.parametros_relatorios(uuid) from public, anon, authenticated;

create or replace function public.gerar_relatorio_mensal(p_empresa uuid, p_competencia date, p_automatico boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ini date := date_trunc('month', p_competencia)::date; v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_ant_ini date := (date_trunc('month', p_competencia) - interval '1 month')::date; v_ant_fim date := (date_trunc('month', p_competencia) - interval '1 day')::date;
  d date; v_atual jsonb; v_ant jsonb; t jsonb; v_cfg jsonb; v_rank jsonb; v_atencao jsonb := '[]'; v_media_cac numeric; v_dados jsonb; v_id uuid; c jsonb; v_fora_pct numeric;
begin
  if not p_automatico and not ((public.tem_permissao('relatorios.view') or public.is_manager()) and p_empresa = public.empresa_atual()) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_ini >= date_trunc('month', current_date)::date then raise exception 'Só meses encerrados.'; end if;
  v_cfg := public.parametros_relatorios(p_empresa);
  d := v_ant_ini;
  while d <= v_fim loop
    if not exists (select 1 from public.indicadores_diarios where empresa_id = p_empresa and dia = d and consultor_id is null) then perform public.agregar_indicadores(p_empresa, d); end if;
    d := d + 1;
  end loop;
  v_atual := public._somar_indicadores(p_empresa, v_ini, v_fim);
  v_ant := public._somar_indicadores(p_empresa, v_ant_ini, v_ant_fim);
  t := v_atual->'total';

  -- ranking ponderado
  select coalesce(jsonb_agg(x order by x.pontos desc), '[]') into v_rank from (
    select cs->>'consultor_id' as consultor_id, cs->>'nome' as nome, cs->'m' as m,
           round(coalesce((select sum(coalesce((cs->'m'->>pk)::numeric, 0) * pv::numeric) from jsonb_each_text(v_cfg->'pesos') as p(pk, pv)), 0), 1) as pontos,
           case when coalesce((cs->'m'->>'clientes_novos')::numeric, 0) > 0 then round(coalesce((cs->'m'->>'custo_rotas')::numeric, 0) / (cs->'m'->>'clientes_novos')::numeric, 2) end as custo_por_cliente
      from jsonb_array_elements(v_atual->'consultores') cs) x;

  -- pontos de atenção
  select avg((r->>'custo_por_cliente')::numeric) into v_media_cac from jsonb_array_elements(v_rank) r where r->>'custo_por_cliente' is not null;
  for c in select * from jsonb_array_elements(v_rank) loop
    if v_media_cac > 0 and (c->>'custo_por_cliente')::numeric > v_media_cac * (v_cfg->>'fator_custo_cliente')::numeric then
      v_atencao := v_atencao || jsonb_build_object('tipo', 'custo_cliente', 'texto', (c->>'nome') || ': custo por cliente de R$ ' || (c->>'custo_por_cliente') || ', acima de ' || (v_cfg->>'fator_custo_cliente') || '× a média (R$ ' || round(v_media_cac, 2) || ')');
    end if;
    if coalesce((c->'m'->>'checkins')::numeric, 0) >= 5 then
      v_fora_pct := round(100 * coalesce((c->'m'->>'checkins_fora_raio')::numeric, 0) / (c->'m'->>'checkins')::numeric, 1);
      if v_fora_pct > (v_cfg->>'limite_fora_raio_pct')::numeric then
        v_atencao := v_atencao || jsonb_build_object('tipo', 'fora_raio', 'texto', (c->>'nome') || ': ' || v_fora_pct || '% dos check-ins fora do raio');
      end if;
    end if;
  end loop;
  if coalesce((t->>'leads')::numeric, 0) >= 10 and coalesce((t->>'leads_sla_estourado')::numeric, 0) / (t->>'leads')::numeric > 0.3 then
    v_atencao := v_atencao || jsonb_build_object('tipo', 'sla_leads', 'texto', 'Mais de 30% dos leads ficaram sem primeiro contato no prazo');
  end if;
  if coalesce((t->>'wa_conversas')::numeric, 0) >= 10 and coalesce((t->>'wa_sla_estourado')::numeric, 0) / (t->>'wa_conversas')::numeric > 0.3 then
    v_atencao := v_atencao || jsonb_build_object('tipo', 'sla_whatsapp', 'texto', 'Mais de 30% das conversas de WhatsApp tiveram a 1ª resposta fora do prazo');
  end if;
  if coalesce((t->>'transferidos_45')::numeric, 0) > coalesce((v_ant->'total'->>'transferidos_45')::numeric, 0) * 1.5 and coalesce((t->>'transferidos_45')::numeric, 0) >= 5 then
    v_atencao := v_atencao || jsonb_build_object('tipo', 'transferencias', 'texto', 'Transferências pela regra dos 45 dias cresceram mais de 50% sobre o mês anterior');
  end if;

  v_dados := jsonb_build_object(
    'competencia', v_ini, 'gerado_em', now(),
    'indicadores', t, 'anterior', v_ant->'total',
    'gastos', jsonb_build_object(
      'rotas', coalesce((t->>'custo_rotas')::numeric, 0),
      'despesas_rota', coalesce((select jsonb_object_agg(tipo, v) from (select tipo, sum(valor) v from public.despesas_rota where empresa_id = p_empresa and data between v_ini and v_fim and status <> 'recusada' group by 1) x), '{}'),
      'financeiro', coalesce((select jsonb_object_agg(categoria, v) from (select categoria, sum(valor) v from public.financeiro_lancamentos where empresa_id = p_empresa and tipo = 'despesa' and status <> 'cancelado' and vencimento between v_ini and v_fim group by 1) x), '{}'),
      'financeiro_total', (select coalesce(sum(valor), 0) from public.financeiro_lancamentos where empresa_id = p_empresa and tipo = 'despesa' and status <> 'cancelado' and vencimento between v_ini and v_fim),
      'financeiro_total_anterior', (select coalesce(sum(valor), 0) from public.financeiro_lancamentos where empresa_id = p_empresa and tipo = 'despesa' and status <> 'cancelado' and vencimento between v_ant_ini and v_ant_fim)),
    'clientes', jsonb_build_object(
      'por_origem', coalesce((select jsonb_object_agg(coalesce(origem, 'não informada'), n) from (select origem, count(*) n from public.clientes where empresa_id = p_empresa and excluido_em is null and created_at::date between v_ini and v_fim group by 1) x), '{}'),
      'por_cidade', coalesce((select jsonb_agg(jsonb_build_object('cidade', cidade, 'n', n) order by n desc) from (select coalesce(cidade, '—') cidade, count(*) n from public.clientes where empresa_id = p_empresa and excluido_em is null and created_at::date between v_ini and v_fim group by 1 order by 2 desc limit 10) x), '[]'),
      'custo_por_cliente', case when coalesce((t->>'clientes_novos')::numeric, 0) > 0 then round(coalesce((t->>'custo_rotas')::numeric, 0) / (t->>'clientes_novos')::numeric, 2) end),
    'documentacao', jsonb_build_object(
      'pendentes_hoje', (select count(*) from public.clientes where empresa_id = p_empresa and excluido_em is null and status_cadastro = 'pendente_documentacao'),
      'completas_no_mes', (select count(*) from public.clientes where empresa_id = p_empresa and excluido_em is null and status_cadastro in ('documentacao_completa', 'ativo') and updated_at::date between v_ini and v_fim),
      'transferidos_45', coalesce((t->>'transferidos_45')::numeric, 0)),
    'vendas', jsonb_build_object(
      'por_situacao', coalesce((select jsonb_object_agg(situacao_venda, n) from (select situacao_venda, count(*) n from public.oportunidades where empresa_id = p_empresa and situacao_em::date between v_ini and v_fim group by 1) x), '{}'),
      'lista', coalesce((select jsonb_agg(x order by x.situacao, x.cliente) from (
          select o.situacao_venda as situacao, cl.nome as cliente, o.titulo, o.valor, coalesce(p.full_name, '—') as consultor
            from public.oportunidades o join public.clientes cl on cl.id = o.cliente_id left join public.profiles p on p.id = o.consultor_id
           where o.empresa_id = p_empresa and o.situacao_venda in ('cancelada', 'pendente_confirmacao', 'enviada') and o.situacao_em::date between v_ini and v_fim limit 200) x), '[]')),
    'processos', jsonb_build_object(
      'por_situacao', coalesce((select jsonb_object_agg(situacao_encaminhamento, n) from (select situacao_encaminhamento, count(*) n from public.processos where empresa_id = p_empresa and situacao_encaminhamento is not null and coalesce(encaminhado_em, created_at)::date between v_ini and v_fim group by 1) x), '{}'),
      'lista', coalesce((select jsonb_agg(x order by x.situacao, x.titulo) from (
          select p.situacao_encaminhamento as situacao, p.titulo, coalesce(cl.nome, '—') as cliente
            from public.processos p left join public.clientes cl on cl.id = p.cliente_id
           where p.empresa_id = p_empresa and p.situacao_encaminhamento in ('encaminhado', 'cancelado', 'pendente_confirmacao', 'em_analise') and coalesce(p.encaminhado_em, p.created_at)::date between v_ini and v_fim limit 200) x), '[]')),
    'whatsapp', jsonb_build_object('conversas', coalesce((t->>'wa_conversas')::numeric, 0), 'sla_estourado', coalesce((t->>'wa_sla_estourado')::numeric, 0), 'resolvidas', coalesce((t->>'wa_resolvidas')::numeric, 0),
      'leads', coalesce((t->>'leads')::numeric, 0), 'leads_convertidos', coalesce((t->>'leads_convertidos')::numeric, 0)),
    'ranking', v_rank, 'pesos', v_cfg->'pesos', 'atencao', v_atencao);

  insert into public.relatorios_mensais (empresa_id, competencia, dados, gerado_por, automatico)
  values (p_empresa, v_ini, v_dados, auth.uid(), p_automatico)
  on conflict (empresa_id, competencia) do update set dados = excluded.dados, gerado_em = now(), gerado_por = excluded.gerado_por
  returning id into v_id;

  -- aviso aos gestores (admin master da empresa)
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select p_empresa, m.user_id, 'Relatório mensal disponível', 'Fechamento de ' || to_char(v_ini, 'MM/YYYY') || case when jsonb_array_length(v_atencao) > 0 then ' — ' || jsonb_array_length(v_atencao) || ' ponto(s) de atenção' else '' end,
         '/relatorios/mensal?c=' || v_id, 'relatorio-mensal:' || v_id
    from public.empresa_membros m where m.empresa_id = p_empresa and m.ativo and m.admin_master
  on conflict (user_id, chave) where chave is not null do nothing;
  return v_id;
end $$;
revoke execute on function public.gerar_relatorio_mensal(uuid, date, boolean) from public, anon;
grant execute on function public.gerar_relatorio_mensal(uuid, date, boolean) to authenticated;

-- 1º dia útil do mês: gera o fechamento do mês anterior de cada empresa (sem refazer o que já existe)
create or replace function public.processar_relatorios_mensais()
returns int language plpgsql security definer set search_path = '' as $$
declare e record; v_hoje date; v_primeiro_util date; n int := 0;
begin
  for e in select id, fuso from public.empresas where status in ('trial', 'ativa') loop
    v_hoje := (now() at time zone coalesce(e.fuso, 'America/Sao_Paulo'))::date;
    select min(dd)::date into v_primeiro_util from generate_series(date_trunc('month', v_hoje), date_trunc('month', v_hoje) + interval '6 days', interval '1 day') dd where extract(isodow from dd) < 6;
    if v_hoje >= v_primeiro_util and not exists (select 1 from public.relatorios_mensais where empresa_id = e.id and competencia = (date_trunc('month', v_hoje) - interval '1 month')::date) then
      perform public.gerar_relatorio_mensal(e.id, (date_trunc('month', v_hoje) - interval '1 month')::date, true);
      n := n + 1;
    end if;
  end loop;
  if n > 0 then perform public.disparar_sincronizacao('relatorios'); end if;
  return n;
end $$;
revoke execute on function public.processar_relatorios_mensais() from public, anon, authenticated;
select cron.schedule('geeasy-relatorio-mensal', '0 9 * * *', $$select public.processar_relatorios_mensais()$$);

-- parâmetros dos relatórios (pesos do ranking, limites, destinatários) por quem vê relatórios
create or replace function public.pode_configurar(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_chave
    when 'rotas' then public.tem_permissao('rotas.definir')
    when 'leads' then public.tem_permissao('leads.distribuir')
    when 'whatsapp' then public.tem_permissao('whatsapp.configurar')
    when 'ponto' then public.tem_permissao('ponto.gerir')
    when 'financeiro' then public.tem_permissao('financeiro.pagar') and public.tem_permissao('financeiro.conciliar')
    when 'relatorios' then public.tem_permissao('relatorios.view') and public.is_manager()
    else false end
$$;
