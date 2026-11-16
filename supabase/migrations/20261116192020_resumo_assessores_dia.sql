-- Resumo diário por assessor (só números: processos novos por tipo, clientes novos e rotas do dia).
-- Gestão do comercial (consultores.manage) vê todos; o assessor com acesso vê só o dele.
create or replace function public.resumo_assessores_dia(p_data date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_todos boolean := public.tem_permissao('consultores.manage');
begin
  if v_emp is null or not public.is_active_user() then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'processos')::int desc, x->>'nome')
      from (
        select jsonb_build_object(
          'id', a.id, 'nome', a.nome, 'acordo', a.acordo_comercial, 'tem_usuario', a.user_id is not null,
          'processos', (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
                         where cl.assessor_id = a.id and (c.created_at at time zone 'America/Sao_Paulo')::date = p_data),
          'por_tipo', coalesce((select jsonb_object_agg(tipo, n) from (
                         select c.tipo, count(*) n from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
                          where cl.assessor_id = a.id and (c.created_at at time zone 'America/Sao_Paulo')::date = p_data group by 1) t), '{}'),
          'clientes', (select count(*) from public.clientes cl where cl.assessor_id = a.id and cl.excluido_em is null
                         and (cl.created_at at time zone 'America/Sao_Paulo')::date = p_data),
          'rotas', (select count(*) from public.rotas r where r.empresa_id = v_emp and r.consultor_id = a.user_id and r.data = p_data and r.status <> 'cancelada'),
          'rotas_concluidas', (select count(*) from public.rotas r where r.empresa_id = v_emp and r.consultor_id = a.user_id and r.data = p_data and r.status in ('concluida', 'aprovada')),
          'paradas', (select count(*) from public.rota_paradas p join public.rotas r on r.id = p.rota_id
                       where r.empresa_id = v_emp and r.consultor_id = a.user_id and r.data = p_data and r.status <> 'cancelada'),
          'visitadas', (select count(*) from public.rota_paradas p join public.rotas r on r.id = p.rota_id
                       where r.empresa_id = v_emp and r.consultor_id = a.user_id and r.data = p_data and r.status <> 'cancelada' and p.status = 'visitada'),
          'nao_realizadas', (select count(*) from public.rota_paradas p join public.rotas r on r.id = p.rota_id
                       where r.empresa_id = v_emp and r.consultor_id = a.user_id and r.data = p_data and r.status <> 'cancelada' and p.status = 'nao_realizada'),
          'km_planejado', (select coalesce(sum(r.km_planejado), 0) from public.rotas r where r.empresa_id = v_emp and r.consultor_id = a.user_id and r.data = p_data and r.status <> 'cancelada')
        ) x
          from public.assessores a
         where a.empresa_id = v_emp and a.ativo and (v_todos or a.user_id = auth.uid())
      ) s), '[]'::jsonb);
end $$;
revoke execute on function public.resumo_assessores_dia(date) from public, anon;
grant execute on function public.resumo_assessores_dia(date) to authenticated;
