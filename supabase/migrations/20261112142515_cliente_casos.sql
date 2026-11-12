-- =====================================================================
-- GE EASY — Processos administrativos dos clientes (benefícios INSS)
--
-- Um registro por processo (linha da planilha de processos): tipo de ação, corretor/consultor,
-- cidade, datas (recebimento, habilitação, exigência, perícia, avaliação), assinaturas e situação.
-- O STATUS é calculado pelo banco a partir desses campos (gatilho), então qualquer edição
-- recalcula a situação. Função de resumo para os relatórios do gestor (respeita o RLS).
-- =====================================================================

create table public.cliente_casos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  origem text,                                   -- ex.: "planilha 2024", "planilha 2025", "manual"
  ano int check (ano between 2000 and 2100),
  item int,
  linha int,
  tipo text not null check (char_length(tipo) between 2 and 80),   -- ação: Salário Materno, Aposentadoria...
  corretor text check (char_length(corretor) <= 120),
  corretores text[] not null default '{}',       -- nomes normalizados (para busca por consultor/corretor)
  cidade text,
  uf char(2),
  retroativo text,
  contrato_assinado boolean,
  procuracao_assinada boolean,
  recebido_em date,
  habilitado_em date,
  exigencia_em date,
  exigencia_texto text check (char_length(exigencia_texto) <= 300),
  exigencia_situacao text check (char_length(exigencia_situacao) <= 300),
  pericia_em date,
  avaliacao_em date,
  situacao_planilha text check (char_length(situacao_planilha) <= 120),
  observacoes text check (char_length(observacoes) <= 4000),
  -- calculados pelo gatilho
  status text not null default 'em_preparacao' check (status in (
    'arquivo_morto', 'comercial', 'aguardando_idade', 'exigencia', 'pericia', 'habilitado', 'pendencia', 'em_preparacao')),
  pendencia text check (pendencia in ('assinatura', 'documentacao', 'contato', 'desistencia')),
  exigencia_cumprida boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.cliente_casos (empresa_id, status);
create index on public.cliente_casos (empresa_id, tipo);
create index on public.cliente_casos (empresa_id, cidade);
create index on public.cliente_casos (empresa_id, ano);
create index on public.cliente_casos (cliente_id);
create index cliente_casos_corretores on public.cliente_casos using gin (corretores);

-- Status a partir dos dados do processo (ordem de prioridade)
create or replace function public.cliente_caso_status()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_sit text := upper(coalesce(trim(new.situacao_planilha), ''));
  v_obs text := upper(coalesce(new.observacoes, ''));
begin
  new.exigencia_cumprida := upper(coalesce(new.exigencia_situacao, '') || ' ' || coalesce(new.exigencia_texto, '')) like '%CUMPRIDA%';
  new.pendencia := case
    when v_obs ~ 'DESIST' then 'desistencia'
    when new.contrato_assinado is false or new.procuracao_assinada is false then 'assinatura'
    when v_obs ~ '(DOCUMENTA|DOCUMENTO)' then 'documentacao'
    when v_obs ~ '(SEM CONTATO|SEM RETORNO|NÃO MORA|NAO MORA|NÃO FOI ENCONTRAD|NAO FOI ENCONTRAD)' then 'contato'
  end;
  new.status := case
    when v_sit = 'ARQUIVO MORTO' then 'arquivo_morto'
    when v_sit = 'COMERCIAL' then 'comercial'
    when v_sit ~ '^20[0-9]{2}$' or v_obs ~ 'AGUARDANDO IDADE' then 'aguardando_idade'
    when (new.exigencia_em is not null or nullif(trim(new.exigencia_texto), '') is not null) and not new.exigencia_cumprida then 'exigencia'
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

create trigger trg_cliente_casos_status before insert or update on public.cliente_casos
  for each row execute function public.cliente_caso_status();
create trigger zz_empresa_vinculos before insert or update on public.cliente_casos
  for each row execute function public.empresa_vinculos('cliente_id:clientes');
create trigger trg_audit_cliente_casos after insert or update or delete on public.cliente_casos
  for each row execute function public.audit_trigger();

alter table public.cliente_casos enable row level security;
create policy cliente_casos_empresa on public.cliente_casos as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy cliente_casos_select on public.cliente_casos for select to authenticated
  using ((select public.tem_permissao('clientes.ver_todos')) or (select public.is_backoffice()) or public.can_access_cliente(cliente_id));
create policy cliente_casos_insert on public.cliente_casos for insert to authenticated
  with check ((select public.tem_permissao('clientes.write')) and public.can_access_cliente(cliente_id));
create policy cliente_casos_update on public.cliente_casos for update to authenticated
  using ((select public.tem_permissao('clientes.write')) and public.can_access_cliente(cliente_id))
  with check ((select public.tem_permissao('clientes.write')) and public.can_access_cliente(cliente_id));
create policy cliente_casos_delete on public.cliente_casos for delete to authenticated
  using ((select public.tem_permissao('clientes.delete')));

-- ---------------------------------------------------------------------
-- Resumo para relatórios: contagens por dimensão com os mesmos filtros da tela (respeita o RLS)
-- ---------------------------------------------------------------------
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
      and (p_busca is null or cl.nome ilike '%' || p_busca || '%' or cl.documento like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%')
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
revoke execute on function public.cliente_casos_resumo(text, text, text, text, int, text, text) from public, anon;
grant execute on function public.cliente_casos_resumo(text, text, text, text, int, text, text) to authenticated;

-- Opções dos filtros (distintos) — também respeita o RLS
create or replace function public.cliente_casos_opcoes()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'tipos', coalesce((select jsonb_agg(t order by t) from (select distinct tipo t from public.cliente_casos) s), '[]'),
    'cidades', coalesce((select jsonb_agg(c order by c) from (select distinct cidade c from public.cliente_casos where coalesce(cidade, '') <> '') s), '[]'),
    'corretores', coalesce((select jsonb_agg(c order by c) from (select distinct unnest(corretores) c from public.cliente_casos) s), '[]'),
    'anos', coalesce((select jsonb_agg(a order by a desc) from (select distinct ano a from public.cliente_casos where ano is not null) s), '[]')
  )
$$;
revoke execute on function public.cliente_casos_opcoes() from public, anon;
grant execute on function public.cliente_casos_opcoes() to authenticated;
