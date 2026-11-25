-- Documentos do processo e dossiê para o INSS ou a Justiça.
-- 1) documento_tipos ganha escopo: 'cadastro' (o que já existia: completa o cadastro do cliente) ou 'processo'
--    (o que o benefício exige). Tipos do processo valem para os tipos de ação listados (vazio = todos) e para os
--    destinos listados (inss/justica; vazio = ambos). A situação documental do cadastro só olha o escopo 'cadastro'.
-- 2) checklist_processo(caso, destino): o que o processo exige, o que já foi enviado e a situação de cada item.
-- 3) dossies: cada pacote gerado (ZIP com resumo, PDF único e documentos), quem gerou e o que faltava.

alter table public.documento_tipos add column escopo text not null default 'cadastro' check (escopo in ('cadastro', 'processo'));
alter table public.documento_tipos add column tipos_acao text[] not null default '{}';
alter table public.documento_tipos add column destinos text[] not null default '{}'
  check (destinos <@ array['inss', 'justica']::text[]);

create or replace function public.situacao_documental(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cli record; v jsonb;
begin
  select c.id, c.empresa_id, c.tipo_pessoa into v_cli from public.clientes c where c.id = p_cliente;
  if not found or (auth.uid() is not null and not public.can_access_cliente(p_cliente)) then return null; end if;
  select jsonb_build_object(
    'exigidos', coalesce(jsonb_agg(jsonb_build_object('categoria', t.categoria, 'nome', t.nome, 'obrigatorio', t.obrigatorio,
                  'situacao', coalesce(d.situacao, 'faltando')) order by t.ordem, t.nome), '[]'::jsonb),
    'faltando', coalesce(jsonb_agg(t.nome order by t.ordem, t.nome) filter (where t.obrigatorio and coalesce(d.situacao, 'faltando') <> 'aprovado'), '[]'::jsonb),
    'completo', bool_and(not t.obrigatorio or coalesce(d.situacao, '') = 'aprovado') is not false)
    into v
    from public.documento_tipos t
    left join lateral (
      select case
               when bool_or(x.analise_status = 'aprovado' and (x.validade is null or x.validade >= current_date)) then 'aprovado'
               when bool_or(x.analise_status in ('enviado', 'em_analise')) then 'em_analise'
               when bool_or(x.analise_status = 'recusado') then 'recusado'
               when bool_or(x.analise_status = 'vencido' or x.validade < current_date) then 'vencido'
             end as situacao
        from public.documentos x
       where x.cliente_id = v_cli.id and x.categoria = t.categoria and x.excluido_em is null
    ) d on true
   where t.empresa_id = v_cli.empresa_id and t.ativo and t.escopo = 'cadastro'
     and ((v_cli.tipo_pessoa = 'PF' and t.aplica_pf) or (v_cli.tipo_pessoa = 'PJ' and t.aplica_pj));
  return v;
end $$;

-- Checklist do processo: documentos do cadastro (obrigatórios) + os do benefício/destino
create or replace function public.checklist_processo(p_caso uuid, p_destino text default 'inss')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare k record; v jsonb;
begin
  select c.id, c.cliente_id, c.tipo, c.empresa_id, cl.tipo_pessoa into k
    from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id
   where c.id = p_caso;
  if not found then return null; end if;
  select jsonb_build_object(
    'itens', coalesce(jsonb_agg(jsonb_build_object(
        'categoria', t.categoria, 'nome', t.nome, 'obrigatorio', t.obrigatorio, 'escopo', t.escopo,
        'situacao', coalesce(d.situacao, 'faltando'), 'arquivos', coalesce(d.n, 0)) order by t.escopo, t.ordem, t.nome), '[]'::jsonb),
    'faltando', coalesce(jsonb_agg(t.nome order by t.escopo, t.ordem, t.nome)
                  filter (where t.obrigatorio and coalesce(d.situacao, 'faltando') in ('faltando', 'recusado', 'vencido')), '[]'::jsonb))
    into v
    from public.documento_tipos t
    left join lateral (
      select count(*) n,
             case
               when bool_or(x.analise_status = 'aprovado' and (x.validade is null or x.validade >= current_date)) then 'aprovado'
               when bool_or(x.analise_status in ('enviado', 'em_analise') or x.analise_status is null) then 'enviado'
               when bool_or(x.analise_status = 'recusado') then 'recusado'
               when bool_or(x.analise_status = 'vencido' or x.validade < current_date) then 'vencido'
             end as situacao
        from public.documentos x
       where x.cliente_id = k.cliente_id and x.categoria = t.categoria and x.excluido_em is null
    ) d on true
   where t.empresa_id = k.empresa_id and t.ativo
     and ((k.tipo_pessoa = 'PF' and t.aplica_pf) or (k.tipo_pessoa = 'PJ' and t.aplica_pj))
     and ((t.escopo = 'cadastro' and t.obrigatorio)
          or (t.escopo = 'processo' and (cardinality(t.tipos_acao) = 0 or k.tipo = any (t.tipos_acao))
              and (cardinality(t.destinos) = 0 or p_destino = any (t.destinos))));
  return v;
end $$;
revoke execute on function public.checklist_processo(uuid, text) from public, anon;
grant execute on function public.checklist_processo(uuid, text) to authenticated;

-- Documentos que o processo exige (EASY). Editáveis em Configurações › Documentação.
insert into public.documento_tipos (empresa_id, categoria, nome, obrigatorio, aplica_pf, aplica_pj, ativo, ordem, escopo, tipos_acao, destinos)
select e.id, x.categoria, x.nome, x.obrig, true, false, true, x.ordem, 'processo', x.tipos::text[], x.destinos::text[]
  from public.empresas e
  cross join (values
    ('procuracao', 'Procuração assinada', true, 10, '{}', '{}'),
    ('contrato_assinado', 'Contrato de honorários assinado', true, 11, '{}', '{}'),
    ('cnis', 'Extrato do CNIS', false, 12, '{}', '{}'),
    ('certidao_nascimento', 'Certidão de nascimento da criança', true, 20, '{"Salário Materno"}', '{}'),
    ('autodeclaracao_rural', 'Autodeclaração do segurado especial (rural)', false, 21, '{"Salário Materno","Aposentadoria","Auxílio Doença","Pensão por Morte"}', '{}'),
    ('prova_rural', 'Provas da atividade rural (documentos em nome do segurado)', false, 22, '{"Salário Materno","Aposentadoria","Auxílio Doença","Pensão por Morte"}', '{}'),
    ('ctps', 'Carteira de trabalho (CTPS)', false, 23, '{"Aposentadoria","Auxílio Doença","Pensão por Morte","Trabalhista"}', '{}'),
    ('laudo', 'Laudos, atestados e exames médicos', true, 30, '{"Auxílio Doença","BPC Deficiente"}', '{}'),
    ('cadunico', 'Cadastro Único (CadÚnico) atualizado', true, 31, '{"BPC Deficiente","BPC Idoso"}', '{}'),
    ('composicao_familiar', 'Documentos e renda do grupo familiar', false, 32, '{"BPC Deficiente","BPC Idoso"}', '{}'),
    ('certidao_obito', 'Certidão de óbito do instituidor', true, 40, '{"Pensão por Morte"}', '{}'),
    ('vinculo_dependente', 'Prova do vínculo (casamento, união estável ou filiação)', true, 41, '{"Pensão por Morte"}', '{}'),
    ('decisao_inss', 'Decisão de indeferimento do INSS', true, 50, '{}', '{justica}'),
    ('declaracao_hipossuficiencia', 'Declaração de hipossuficiência', false, 51, '{}', '{justica}')
  ) as x(categoria, nome, obrig, ordem, tipos, destinos)
 where e.id = 'bdee63cf-d92f-4c1c-bc07-c48d30ffb7d6'
on conflict (empresa_id, categoria) do nothing;

-- Dossiês gerados
create table public.dossies (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  caso_id uuid not null references public.cliente_casos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  destino text not null check (destino in ('inss', 'justica')),
  storage_path text not null check (char_length(storage_path) <= 400),
  arquivos int not null default 0,
  tamanho bigint not null default 0,
  faltando jsonb not null default '[]'::jsonb,
  gerado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.dossies (caso_id, created_at desc);
create index on public.dossies (empresa_id);
create index on public.dossies (cliente_id);
create index on public.dossies (gerado_por);
create trigger zz_empresa_vinculos before insert or update on public.dossies
  for each row execute function public.empresa_vinculos('caso_id:cliente_casos', 'cliente_id:clientes', 'gerado_por:@');
create trigger trg_audit_dossies after insert or update or delete on public.dossies
  for each row execute function public.audit_trigger();
alter table public.dossies enable row level security;
create policy dossies_empresa on public.dossies as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy dossies_select on public.dossies for select to authenticated
  using (public.can_access_cliente(cliente_id));
create policy dossies_insert on public.dossies for insert to authenticated
  with check (gerado_por = (select auth.uid()) and public.can_access_cliente(cliente_id));
