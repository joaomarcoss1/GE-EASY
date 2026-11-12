-- Busca do resumo: o CPF só entra quando o termo tem ao menos 3 dígitos (antes, "Maria" casava todos os CPFs).
create or replace function public.cliente_casos_resumo(
  p_status text default null, p_tipo text default null, p_corretor text default null,
  p_cidade text default null, p_ano int default null, p_pendencia text default null, p_busca text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with f as (
    select c.* from public.cliente_casos c
    join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
    where (p_status is null or c.status = p_status)
      and (p_tipo is null or c.tipo = p_tipo)
      and (p_corretor is null or upper(p_corretor) = any (c.corretores))
      and (p_cidade is null or c.cidade = p_cidade)
      and (p_ano is null or c.ano = p_ano)
      and (p_pendencia is null or c.pendencia = p_pendencia)
      and (p_busca is null or cl.nome ilike '%' || p_busca || '%'
           or (length(regexp_replace(p_busca, '\D', '', 'g')) >= 3 and cl.documento like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'clientes', (select count(distinct cliente_id) from f),
    'por_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from f group by 1) s), '{}'),
    'por_tipo', coalesce((select jsonb_agg(jsonb_build_object('chave', tipo, 'total', n, 'status', st) order by n desc) from (
        select tipo, sum(k)::int n, jsonb_object_agg(status, k) st from (
          select tipo, status, count(*) k from f group by 1, 2) x
        group by tipo) s), '[]'),
    'por_corretor', coalesce((select jsonb_agg(jsonb_build_object('chave', cor, 'total', n, 'status', st) order by n desc) from (
        select cor, sum(k)::int n, jsonb_object_agg(status, k) st from (
          select cor, status, count(*) k from f, unnest(case when cardinality(f.corretores) = 0 then array['(SEM CORRETOR)'] else f.corretores end) cor group by 1, 2) x
        group by cor) s), '[]'),
    'por_cidade', coalesce((select jsonb_agg(jsonb_build_object('chave', cid, 'total', n, 'status', st) order by n desc) from (
        select cid, sum(k)::int n, jsonb_object_agg(status, k) st from (
          select coalesce(nullif(cidade, ''), '(sem cidade)') cid, status, count(*) k from f group by 1, 2) x
        group by cid) s), '[]'),
    'por_ano', coalesce((select jsonb_object_agg(coalesce(ano::text, '—'), n) from (select ano, count(*) n from f group by 1) s), '{}'),
    'por_pendencia', coalesce((select jsonb_object_agg(pendencia, n) from (select pendencia, count(*) n from f where pendencia is not null group by 1) s), '{}'),
    'sem_assinatura', (select count(*) from f where contrato_assinado is false or procuracao_assinada is false)
  )
$$;
