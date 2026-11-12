-- =====================================================================
-- Busca precisa na base de clientes e de processos
-- * nome sem acento/minúsculo (clientes.nome_busca) para buscar "jose" = "José" e palavras em qualquer ordem;
-- * cidade sem acento (cliente_casos.cidade_chave): "Sao Pedro" = "São Pedro";
-- * consultor principal (1º nome do campo corretor) x consultores que participam do processo;
-- * indicadores fiéis às colunas da planilha, independentes da situação principal:
--   exigência (aberta/cumprida), assinaturas (completas/faltando), habilitação (com data).
-- =====================================================================

create or replace function public.sem_acento(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(coalesce(p, '')),
    'áàâãäåéèêëíìîïóòôõöúùûüçñ',
    'aaaaaaeeeeiiiiooooouuuucn')
$$;

alter table public.clientes add column if not exists nome_busca text generated always as (public.sem_acento(nome)) stored;
create index if not exists clientes_nome_busca_trgm on public.clientes using gin (nome_busca extensions.gin_trgm_ops);

alter table public.cliente_casos
  add column if not exists cidade_chave text generated always as (nullif(public.sem_acento(trim(cidade)), '')) stored,
  add column if not exists corretor_principal text generated always as (nullif(upper(trim(split_part(coalesce(corretor, ''), '/', 1))), '')) stored,
  add column if not exists exigencia_estado text check (exigencia_estado in ('aberta', 'cumprida')),
  add column if not exists assinaturas text check (assinaturas in ('completas', 'faltando'));
create index if not exists cliente_casos_cidade_chave on public.cliente_casos (empresa_id, cidade_chave);
create index if not exists cliente_casos_corretor_principal on public.cliente_casos (empresa_id, corretor_principal);

-- recalcula também os indicadores
create or replace function public.cliente_caso_status()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_sit text := upper(coalesce(trim(new.situacao_planilha), ''));
  v_obs text := upper(coalesce(new.observacoes, ''));
  v_tem_exig boolean := new.exigencia_em is not null or nullif(trim(new.exigencia_texto), '') is not null or nullif(trim(new.exigencia_situacao), '') is not null;
begin
  new.exigencia_cumprida := upper(coalesce(new.exigencia_situacao, '') || ' ' || coalesce(new.exigencia_texto, '')) like '%CUMPRIDA%';
  new.exigencia_estado := case when not v_tem_exig then null when new.exigencia_cumprida then 'cumprida' else 'aberta' end;
  new.assinaturas := case
    when new.contrato_assinado is false or new.procuracao_assinada is false then 'faltando'
    when new.contrato_assinado is true and new.procuracao_assinada is true then 'completas'
  end;
  new.pendencia := case
    when v_obs ~ 'DESIST' then 'desistencia'
    when new.assinaturas = 'faltando' then 'assinatura'
    when v_obs ~ '(DOCUMENTA|DOCUMENTO)' then 'documentacao'
    when v_obs ~ '(SEM CONTATO|SEM RETORNO|NÃO MORA|NAO MORA|NÃO FOI ENCONTRAD|NAO FOI ENCONTRAD)' then 'contato'
  end;
  new.status := case
    when v_sit = 'ARQUIVO MORTO' then 'arquivo_morto'
    when v_sit = 'COMERCIAL' then 'comercial'
    when v_sit ~ '^20[0-9]{2}$' or v_obs ~ 'AGUARDANDO IDADE' then 'aguardando_idade'
    when new.exigencia_estado = 'aberta' then 'exigencia'
    when new.pericia_em is not null or new.avaliacao_em is not null then 'pericia'
    when new.habilitado_em is not null then 'habilitado'
    when new.pendencia is not null then 'pendencia'
    else 'em_preparacao'
  end;
  new.corretores := coalesce((
    select array_agg(distinct x) from (
      select upper(trim(t)) x from regexp_split_to_table(coalesce(new.corretor, ''), '/') t
    ) s where x <> ''), '{}');
  new.updated_at := now();
  return new;
end $$;

-- grafia da mesma cidade unificada (veio com e sem acento na planilha)
update public.cliente_casos set cidade = 'São Pedro da Agua Branca' where cidade = 'Sao Pedro da Agua Branca';
update public.clientes set cidade = 'São Pedro da Agua Branca' where cidade = 'Sao Pedro da Agua Branca';
-- recalcula todos os processos com a regra nova
update public.cliente_casos set updated_at = updated_at;

drop function if exists public.cliente_casos_resumo(text, text, text, text, int, text, text);

-- Resumo com os mesmos filtros da tela (p_busca já vem sem acento; cada palavra precisa aparecer no nome)
create or replace function public.cliente_casos_resumo(
  p_status text default null, p_tipo text default null, p_corretor text default null, p_principal boolean default false,
  p_cidade text default null, p_ano int default null, p_pendencia text default null, p_busca text default null,
  p_habilitado boolean default null, p_exigencia text default null, p_assinaturas text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with f as (
    select c.* from public.cliente_casos c
    join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
    where (p_status is null or c.status = p_status)
      and (p_tipo is null or c.tipo = p_tipo)
      and (p_corretor is null or (case when p_principal then c.corretor_principal = upper(p_corretor) else upper(p_corretor) = any (c.corretores) end))
      and (p_cidade is null or c.cidade_chave = public.sem_acento(p_cidade))
      and (p_ano is null or c.ano = p_ano)
      and (p_pendencia is null or c.pendencia = p_pendencia)
      and (p_habilitado is null or (c.habilitado_em is not null) = p_habilitado)
      and (p_exigencia is null or (p_exigencia = 'nenhuma' and c.exigencia_estado is null) or c.exigencia_estado = p_exigencia)
      and (p_assinaturas is null or c.assinaturas = p_assinaturas)
      and (p_busca is null
           or (length(regexp_replace(p_busca, '\D', '', 'g')) >= 3 and cl.documento like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%')
           or not exists (select 1 from regexp_split_to_table(public.sem_acento(p_busca), '\s+') w where w <> '' and cl.nome_busca not like '%' || w || '%'))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'clientes', (select count(distinct cliente_id) from f),
    'por_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from f group by 1) s), '{}'),
    'indicadores', jsonb_build_object(
      'habilitados', (select count(*) from f where habilitado_em is not null),
      'exigencia_aberta', (select count(*) from f where exigencia_estado = 'aberta'),
      'exigencia_cumprida', (select count(*) from f where exigencia_estado = 'cumprida'),
      'sem_assinatura', (select count(*) from f where assinaturas = 'faltando'),
      'pericia_agendada', (select count(*) from f where pericia_em is not null or avaliacao_em is not null),
      'arquivo_morto', (select count(*) from f where status = 'arquivo_morto')),
    'por_tipo', coalesce((select jsonb_agg(jsonb_build_object('chave', tipo, 'total', n, 'status', st) order by n desc) from (
        select tipo, sum(k)::int n, jsonb_object_agg(status, k) st from (
          select tipo, status, count(*) k from f group by 1, 2) x
        group by tipo) s), '[]'),
    'por_corretor', coalesce((select jsonb_agg(jsonb_build_object('chave', cor, 'total', n, 'principal', coalesce(pr.np, 0), 'status', st) order by n desc) from (
        select cor, sum(k)::int n, jsonb_object_agg(status, k) st from (
          select cor, status, count(*) k from f, unnest(case when cardinality(f.corretores) = 0 then array['(SEM CONSULTOR)'] else f.corretores end) cor group by 1, 2) x
        group by cor) s
        left join (select corretor_principal cp, count(*) np from f group by 1) pr on pr.cp = s.cor), '[]'),
    'por_cidade', coalesce((select jsonb_agg(jsonb_build_object('chave', rot, 'total', n, 'status', st) order by n desc) from (
        select max(rot) rot, sum(k)::int n, jsonb_object_agg(status, k) st from (
          select coalesce(cidade_chave, '') ch, coalesce(max(cidade), '(sem cidade)') rot, status, count(*) k from f group by 1, 3) x
        group by ch) s), '[]'),
    'por_ano', coalesce((select jsonb_object_agg(coalesce(ano::text, '—'), n) from (select ano, count(*) n from f group by 1) s), '{}'),
    'por_pendencia', coalesce((select jsonb_object_agg(pendencia, n) from (select pendencia, count(*) n from f where pendencia is not null group by 1) s), '{}'),
    'sem_assinatura', (select count(*) from f where assinaturas = 'faltando')
  )
$$;
revoke execute on function public.cliente_casos_resumo(text, text, text, boolean, text, int, text, text, boolean, text, text) from public, anon;
grant execute on function public.cliente_casos_resumo(text, text, text, boolean, text, int, text, text, boolean, text, text) to authenticated;

-- Opções dos filtros: cidade única por grafia (sem acento), consultores com a quantidade
create or replace function public.cliente_casos_opcoes()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'tipos', coalesce((select jsonb_agg(t order by t) from (select distinct tipo t from public.cliente_casos) s), '[]'),
    'cidades', coalesce((select jsonb_agg(c order by c) from (select max(cidade) c from public.cliente_casos where cidade_chave is not null group by cidade_chave) s), '[]'),
    'corretores', coalesce((select jsonb_agg(jsonb_build_object('nome', c, 'n', n) order by c) from (select unnest(corretores) c, count(*) n from public.cliente_casos group by 1) s), '[]'),
    'anos', coalesce((select jsonb_agg(a order by a desc) from (select distinct ano a from public.cliente_casos where ano is not null) s), '[]')
  )
$$;
