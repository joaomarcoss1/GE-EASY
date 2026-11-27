-- =====================================================================
-- Painel administrativo: números dos processos dos clientes num único JSON (status, filas dos setores com entradas,
-- saídas e tempo parado, benefícios, prazos de exigência e pontos de atenção). Invoker: respeita o RLS de quem vê.
-- =====================================================================
create or replace function public.painel_processos_adm()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with c as (
    select cc.id, cc.cliente_id, cc.status, cc.tipo, cc.pendencia, cc.assessor_id, cc.assinaturas, cc.protocolo_inss,
           cc.habilitado_em, cc.exigencia_prazo, cc.exigencia_prorrogada, cc.created_at, cl.nome
      from public.cliente_casos cc join public.clientes cl on cl.id = cc.cliente_id and cl.excluido_em is null
     where cc.empresa_id = (select public.empresa_atual())
  ),
  ult as (
    select h.caso_id, max(h.em) as em from public.cliente_casos_historico h
     where h.empresa_id = (select public.empresa_atual()) group by h.caso_id
  ),
  mov as (
    select h.de, h.para from public.cliente_casos_historico h
     where h.empresa_id = (select public.empresa_atual())
       and h.em >= (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  ),
  parado as (select c.status, now() - coalesce(u.em, c.created_at) as tempo from c left join ult u on u.caso_id = c.id)
  select jsonb_build_object(
    'total', (select count(*) from c),
    'por_status', coalesce((select jsonb_object_agg(s.status, s.n) from (select status, count(*) n from c group by status) s), '{}'::jsonb),
    'pendencias', coalesce((select jsonb_object_agg(s.p, s.n) from (select coalesce(pendencia, 'outra') p, count(*) n from c where status = 'pendencia' group by 1) s), '{}'::jsonb),
    'hab_mes', (select count(*) from c where habilitado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date),
    'setores', (select jsonb_agg(jsonb_build_object(
        'status', st,
        'fila', (select count(*) from c where c.status = st),
        'entraram', (select count(*) from mov where mov.para = st and mov.de is distinct from st),
        'sairam', (select count(*) from mov where mov.de = st and mov.para <> st),
        'parados15', (select count(*) from parado p where p.status = st and p.tempo > interval '15 days'),
        'dias_medio', (select round(extract(epoch from avg(p.tempo)) / 86400) from parado p where p.status = st)
      ) order by ord) from unnest(array['em_analise', 'pendencia', 'exigencia', 'habilitacao']) with ordinality as t(st, ord)),
    'por_tipo', coalesce((select jsonb_agg(jsonb_build_object('tipo', s.tipo, 'n', s.n) order by s.n desc)
        from (select coalesce(tipo, 'Não informado') tipo, count(*) n from c where status not in ('arquivo_morto', 'indeferido') group by 1) s), '[]'::jsonb),
    'exigencias', jsonb_build_object(
        'vencidas', (select count(*) from c where status = 'exigencia' and exigencia_prazo < (now() at time zone 'America/Sao_Paulo')::date),
        'tres_dias', (select count(*) from c where status = 'exigencia' and exigencia_prazo between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date + 3),
        'prorrogadas', (select count(*) from c where status = 'exigencia' and exigencia_prorrogada),
        'lista', coalesce((select jsonb_agg(jsonb_build_object('caso_id', x.id, 'cliente_id', x.cliente_id, 'nome', x.nome, 'tipo', x.tipo, 'prazo', x.exigencia_prazo, 'prorrogada', x.exigencia_prorrogada))
            from (select * from c where status = 'exigencia' order by exigencia_prazo nulls last limit 5) x), '[]'::jsonb)),
    'atencao', jsonb_build_object(
        'hab_sem_protocolo', (select count(*) from c where status = 'habilitado' and nullif(trim(protocolo_inss), '') is null),
        'sem_assinatura', (select count(*) from c where assinaturas = 'faltando' and status not in ('arquivo_morto', 'indeferido')),
        'sem_assessor', (select count(*) from c where assessor_id is null and status not in ('arquivo_morto', 'indeferido')))
  )
$$;
revoke execute on function public.painel_processos_adm() from public, anon;
grant execute on function public.painel_processos_adm() to authenticated;
