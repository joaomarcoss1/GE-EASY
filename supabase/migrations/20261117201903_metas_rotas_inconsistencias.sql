-- =====================================================================
-- Metas de processos editáveis, atribuição do processo ao assessor, protocolo INSS, inconsistências,
-- rotas por cidade/objetivo, checklist do veículo, avaria e assinaturas do relatório da rota.
-- Especificação: docs/especificacao-metas-rotas-2026-11.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Assessores: categoria e nomes usados na planilha
-- ---------------------------------------------------------------------
alter table public.assessores
  add column categoria text not null default 'corretor' check (categoria in ('consultor', 'corretor', 'diretoria')),
  add column apelidos text[] not null default '{}';

-- ---------------------------------------------------------------------
-- 2. Processo: assessor, protocolo do INSS e estado atual
-- ---------------------------------------------------------------------
alter table public.cliente_casos
  add column assessor_id uuid references public.assessores(id) on delete set null,
  add column protocolo_inss text check (char_length(protocolo_inss) <= 40),
  add column situacao_atual text check (char_length(situacao_atual) <= 300);
create index on public.cliente_casos (empresa_id, assessor_id);
create index on public.cliente_casos (empresa_id, recebido_em);
create index on public.cliente_casos (empresa_id, habilitado_em);
create index on public.cliente_casos_historico (empresa_id, para, em);

drop trigger zz_empresa_vinculos on public.cliente_casos;
create trigger zz_empresa_vinculos before insert or update on public.cliente_casos
  for each row execute function public.empresa_vinculos('cliente_id:clientes', 'assessor_id:assessores');

create or replace function public.chave_apelido(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(public.sem_acento(trim(coalesce(p, '')))), '')
$$;

-- Quem gerou o processo: assessor do cliente; senão, o nome principal da planilha
create or replace function public.cliente_caso_assessor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  if new.assessor_id is null then
    select cl.assessor_id into new.assessor_id from public.clientes cl where cl.id = new.cliente_id;
  end if;
  if new.assessor_id is null then
    v_nome := public.chave_apelido(split_part(coalesce(new.corretor, ''), '/', 1));
    if v_nome is not null then
      select a.id into new.assessor_id from public.assessores a
       where a.empresa_id = new.empresa_id and v_nome = any (a.apelidos) order by a.ativo desc, a.created_at limit 1;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.cliente_caso_assessor() from public, anon, authenticated;
create trigger trg_cliente_casos_assessor before insert or update of cliente_id, corretor, assessor_id on public.cliente_casos
  for each row execute function public.cliente_caso_assessor();

-- Habilitação: data automática; protocolo e estado atual obrigatórios para quem habilita pelo sistema
create or replace function public.cliente_caso_habilitacao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'habilitado' and (tg_op = 'INSERT' or old.status is distinct from 'habilitado') then
    new.habilitado_em := coalesce(new.habilitado_em, (now() at time zone 'America/Sao_Paulo')::date);
    if auth.uid() is not null and (nullif(trim(new.protocolo_inss), '') is null or nullif(trim(new.situacao_atual), '') is null) then
      raise exception 'Para habilitar, informe o número do protocolo do INSS e o estado atual do processo.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_cliente_casos_xhabilitacao before insert or update on public.cliente_casos
  for each row execute function public.cliente_caso_habilitacao();

-- Mudou o assessor do cliente: leva junto os processos que eram do assessor anterior (ou sem assessor)
create or replace function public.cliente_propagar_assessor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.cliente_casos set assessor_id = new.assessor_id
   where cliente_id = new.id and (assessor_id is null or assessor_id is not distinct from old.assessor_id)
     and assessor_id is distinct from new.assessor_id;
  return null;
end $$;
revoke execute on function public.cliente_propagar_assessor() from public, anon, authenticated;
create trigger trg_clientes_assessor after update of assessor_id on public.clientes
  for each row when (new.assessor_id is distinct from old.assessor_id) execute function public.cliente_propagar_assessor();

-- Apelidos do assessor: normaliza e atribui os processos da planilha sem assessor
create or replace function public.assessor_normalizar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.apelidos := coalesce((select array_agg(distinct x) from (select public.chave_apelido(a) x from unnest(new.apelidos) a) s where x is not null), '{}');
  return new;
end $$;
create trigger trg_assessores_normalizar before insert or update of apelidos on public.assessores
  for each row execute function public.assessor_normalizar();

create or replace function public.assessor_atribuir_planilha()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.apelidos) > 0 then
    update public.cliente_casos c set assessor_id = new.id
     where c.empresa_id = new.empresa_id and c.assessor_id is null
       and public.chave_apelido(split_part(coalesce(c.corretor, ''), '/', 1)) = any (new.apelidos);
  end if;
  return null;
end $$;
revoke execute on function public.assessor_atribuir_planilha() from public, anon, authenticated;
create trigger trg_assessores_atribuir after insert or update of apelidos on public.assessores
  for each row execute function public.assessor_atribuir_planilha();

-- ---------------------------------------------------------------------
-- 3. Metas de processos (recorrentes e editáveis)
-- ---------------------------------------------------------------------
create table public.metas_processos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 120),
  indicador text not null check (indicador in ('processos_novos', 'habilitados', 'judicializados', 'analises', 'ligacoes')),
  periodicidade text not null check (periodicidade in ('diaria', 'mensal', 'anual')),
  alvo text not null check (alvo in ('empresa', 'assessor', 'categoria')),
  assessor_id uuid references public.assessores(id) on delete cascade,
  categoria text check (categoria in ('consultor', 'corretor', 'diretoria')),
  valor integer not null check (valor > 0 and valor <= 1000000),
  ativo boolean not null default true,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((alvo = 'assessor') = (assessor_id is not null)),
  check ((alvo = 'categoria') = (categoria is not null))
);
create index on public.metas_processos (empresa_id, ativo);
create index on public.metas_processos (assessor_id);
create index on public.metas_processos (created_by);
create trigger trg_metas_processos_updated before update on public.metas_processos for each row execute function public.set_updated_at();
create trigger zz_empresa_vinculos before insert or update on public.metas_processos
  for each row execute function public.empresa_vinculos('assessor_id:assessores');
create trigger trg_audit_metas_processos after insert or update or delete on public.metas_processos
  for each row execute function public.audit_trigger();
alter table public.metas_processos enable row level security;
create policy metas_processos_empresa on public.metas_processos as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy metas_processos_select on public.metas_processos for select to authenticated
  using ((select public.tem_permissao('clientes.view')) or (select public.tem_permissao('metas.manage')));
create policy metas_processos_insert on public.metas_processos for insert to authenticated with check ((select public.tem_permissao('metas.manage')));
create policy metas_processos_update on public.metas_processos for update to authenticated
  using ((select public.tem_permissao('metas.manage'))) with check ((select public.tem_permissao('metas.manage')));
create policy metas_processos_delete on public.metas_processos for delete to authenticated using ((select public.tem_permissao('metas.manage')));

-- Realizado de um indicador num período (contagem; assessor nulo = empresa toda)
create or replace function public.realizado_indicador(p_emp uuid, p_indicador text, p_assessor uuid, p_ini date, p_fim date)
returns integer language sql stable security definer set search_path = '' as $$
  select (case p_indicador
    when 'processos_novos' then (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
        where c.empresa_id = p_emp and c.recebido_em between p_ini and p_fim and (p_assessor is null or c.assessor_id = p_assessor))
    when 'habilitados' then (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
        where c.empresa_id = p_emp and c.habilitado_em between p_ini and p_fim and (p_assessor is null or c.assessor_id = p_assessor))
    when 'judicializados' then (select count(distinct h.caso_id) from public.cliente_casos_historico h join public.cliente_casos c on c.id = h.caso_id
        where h.empresa_id = p_emp and h.para = 'judicializado' and (h.em at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
          and (p_assessor is null or c.assessor_id = p_assessor))
    when 'analises' then (select count(*) from public.cliente_casos_historico h join public.cliente_casos c on c.id = h.caso_id
        where h.empresa_id = p_emp and h.de = 'em_analise' and h.para <> 'em_analise' and (h.em at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
          and (p_assessor is null or c.assessor_id = p_assessor))
    when 'ligacoes' then (select count(*) from public.interacoes i
        where i.empresa_id = p_emp and i.tipo = 'ligacao' and (i.created_at at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
          and (p_assessor is null or i.autor_id = (select a.user_id from public.assessores a where a.id = p_assessor)))
  end)::int
$$;
revoke execute on function public.realizado_indicador(uuid, text, uuid, date, date) from public, anon, authenticated;

-- Painel de metas: uma linha por meta (categoria = uma linha por assessor da categoria), com o realizado do período
create or replace function public.metas_processos_painel(p_ref date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_ref date := coalesce(p_ref, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if v_emp is null or not public.is_active_user() or not (public.tem_permissao('clientes.view') or public.tem_permissao('metas.manage')) then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.ordem, x.periodo_ordem, x.assessor_nome nulls first, x.nome)
      from (
        select m.id meta_id, m.nome, m.indicador, m.periodicidade, m.alvo, m.categoria, m.valor, a.id assessor_id, a.nome assessor_nome,
               a.user_id is not null assessor_tem_usuario, per.ini inicio, per.fim,
               public.realizado_indicador(v_emp, m.indicador, a.id, per.ini, per.fim) realizado,
               case m.alvo when 'empresa' then 0 when 'assessor' then 1 else 2 end ordem,
               case m.periodicidade when 'diaria' then 0 when 'mensal' then 1 else 2 end periodo_ordem
          from public.metas_processos m
          left join public.assessores a on a.empresa_id = v_emp and a.ativo
               and ((m.alvo = 'assessor' and a.id = m.assessor_id) or (m.alvo = 'categoria' and a.categoria = m.categoria))
          cross join lateral (select case m.periodicidade when 'diaria' then v_ref when 'mensal' then date_trunc('month', v_ref)::date else date_trunc('year', v_ref)::date end ini,
                                     case m.periodicidade when 'diaria' then v_ref when 'mensal' then (date_trunc('month', v_ref) + interval '1 month - 1 day')::date
                                          else (date_trunc('year', v_ref) + interval '1 year - 1 day')::date end fim) per
         where m.empresa_id = v_emp and m.ativo and (m.alvo = 'empresa' or a.id is not null)
      ) x), '[]'::jsonb);
end $$;
revoke execute on function public.metas_processos_painel(date) from public, anon;
grant execute on function public.metas_processos_painel(date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Inconsistências (security invoker: cada um vê só o que pode ver)
-- ---------------------------------------------------------------------
create or replace function public.inconsistencias_processos()
returns table (chave text, caso_id uuid, cliente_id uuid, cliente_nome text, tipo text, status text, detalhe text)
language sql stable security invoker set search_path = '' as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
  c as (
    select c.*, cl.nome cliente_nome from public.cliente_casos c
      join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
  )
  select 'habilitado_sem_protocolo', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status, 'Habilitado sem protocolo do INSS'
    from c where c.status = 'habilitado' and nullif(trim(c.protocolo_inss), '') is null
  union all
  select 'habilitado_sem_data', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status, 'Habilitado sem data de habilitação'
    from c where c.status = 'habilitado' and c.habilitado_em is null
  union all
  select 'exigencia_vencida', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status, 'Prazo da exigência venceu em ' || to_char(c.exigencia_prazo, 'DD/MM/YYYY')
    from c, hoje where c.status = 'exigencia' and c.exigencia_prazo < hoje.d
  union all
  select 'exigencia_sem_status', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status, 'A planilha indica exigência em aberto, mas o status é outro'
    from c where c.exigencia_estado = 'aberta' and c.status not in ('exigencia', 'arquivo_morto', 'indeferido', 'judicializado')
  union all
  select 'sem_assinatura', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status,
         'Falta ' || concat_ws(' e ', case when c.contrato_assinado is not true then 'contrato' end, case when c.procuracao_assinada is not true then 'procuração' end) || ' assinado(a)'
    from c where c.assinaturas = 'faltando' and c.status not in ('arquivo_morto', 'indeferido')
  union all
  select 'sem_assessor', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status, 'Processo sem assessor/corretor'
    from c where c.assessor_id is null and nullif(trim(coalesce(c.corretor, '')), '') is null
  union all
  select 'analise_parada', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status, 'Em análise desde ' || to_char(coalesce(c.recebido_em, c.created_at::date), 'DD/MM/YYYY')
    from c, hoje where c.status = 'em_analise' and coalesce(c.recebido_em, c.created_at::date) < hoje.d - 60
  union all
  select 'datas_invalidas', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status,
         case when c.recebido_em > hoje.d then 'Data de recebimento no futuro' else 'Habilitação anterior ao recebimento' end
    from c, hoje where c.recebido_em > hoje.d or (c.habilitado_em is not null and c.recebido_em is not null and c.habilitado_em < c.recebido_em)
  union all
  select 'duplicado', c.id, c.cliente_id, c.cliente_nome, c.tipo, c.status, 'Mais de um processo ativo do mesmo tipo para o cliente'
    from c where c.status not in ('arquivo_morto', 'indeferido')
     and exists (select 1 from public.cliente_casos o where o.cliente_id = c.cliente_id and o.id <> c.id and o.tipo = c.tipo and o.status not in ('arquivo_morto', 'indeferido'))
  union all
  select 'cliente_sem_cpf', null, cl.id, cl.nome, null, null,
         case when cl.documento is null then 'Cliente sem CPF' else 'CPF/CNPJ com quantidade de dígitos inválida' end
    from public.clientes cl where cl.excluido_em is null and (cl.documento is null or length(cl.documento) not in (11, 14))
  union all
  select 'cliente_sem_telefone', null, cl.id, cl.nome, null, null, 'Cliente sem telefone'
    from public.clientes cl where cl.excluido_em is null and cl.telefone is null and cl.whatsapp is null and cl.telefone_recado is null
  union all
  select 'documentacao_vencida', null, cl.id, cl.nome, null, null, 'Documentação do cadastro venceu em ' || to_char(cl.prazo_documentacao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
    from public.clientes cl where cl.excluido_em is null and cl.status_cadastro = 'pendente_documentacao' and cl.prazo_documentacao < now()
$$;
grant execute on function public.inconsistencias_processos() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Rotas: cidades, objetivo, corretores atendidos, participantes
-- ---------------------------------------------------------------------
alter table public.rotas
  add column objetivo_tipo text check (objetivo_tipo in ('prospeccao', 'atender_corretor', 'pendencias')),
  add column cidades text[] not null default '{}',
  add column corretores uuid[] not null default '{}',
  add column participantes uuid[] not null default '{}',
  add column exige_checklist boolean not null default true;
update public.rotas set exige_checklist = false;

drop trigger if exists zz_empresa_vinculos on public.rotas;
create trigger zz_empresa_vinculos before insert or update on public.rotas
  for each row execute function public.empresa_vinculos('consultor_id:@', 'veiculo_id:veiculos', 'participantes:@');

-- Checklist do veículo (saída e chegada)
create table public.rota_checklists (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  rota_id uuid not null references public.rotas(id) on delete cascade,
  momento text not null check (momento in ('saida', 'chegada')),
  usuario_id uuid default auth.uid() references public.profiles(id) on delete set null,
  km integer not null check (km between 0 and 9999999),
  nivel_tanque text not null check (nivel_tanque in ('reserva', '1/4', '1/2', '3/4', 'cheio')),
  foto_painel text not null check (char_length(foto_painel) <= 400),
  avaria boolean not null default false,
  avaria_descricao text check (char_length(avaria_descricao) <= 2000),
  assinatura_path text check (char_length(assinatura_path) <= 400),
  registrado_em timestamptz not null default now(),
  unique (rota_id, momento),
  check (momento = 'chegada' or not avaria),
  check (not avaria or (char_length(trim(coalesce(avaria_descricao, ''))) >= 10 and assinatura_path is not null))
);
create index on public.rota_checklists (empresa_id, registrado_em);
create index on public.rota_checklists (usuario_id);
create trigger zz_empresa_vinculos before insert or update on public.rota_checklists
  for each row execute function public.empresa_vinculos('rota_id:rotas', 'usuario_id:@');
create trigger trg_audit_rota_checklists after insert or update or delete on public.rota_checklists
  for each row execute function public.audit_trigger();

create or replace function public.rota_checklist_validar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.rotas; v_saida int;
begin
  select * into r from public.rotas where id = new.rota_id;
  if not found then raise exception 'Rota não encontrada.' using errcode = '42501'; end if;
  if new.momento = 'saida' and r.status <> 'planejada' then raise exception 'O checklist de saída é feito antes de iniciar a rota.'; end if;
  if new.momento = 'chegada' then
    if r.status <> 'em_andamento' then raise exception 'O checklist de chegada é feito com a rota em andamento, antes de finalizar.'; end if;
    select km into v_saida from public.rota_checklists where rota_id = new.rota_id and momento = 'saida';
    if v_saida is not null and new.km < v_saida then raise exception 'A quilometragem de chegada (%) é menor que a de saída (%).', new.km, v_saida; end if;
  end if;
  return new;
end $$;
revoke execute on function public.rota_checklist_validar() from public, anon, authenticated;
create trigger trg_rota_checklist_validar before insert on public.rota_checklists for each row execute function public.rota_checklist_validar();

alter table public.rota_checklists enable row level security;
create policy rota_checklists_empresa on public.rota_checklists as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy rota_checklists_select on public.rota_checklists for select to authenticated
  using (exists (select 1 from public.rotas r where r.id = rota_id and public.pode_ver_rota(r.consultor_id)));
create policy rota_checklists_insert on public.rota_checklists for insert to authenticated
  with check (usuario_id = (select auth.uid()) and exists (select 1 from public.rotas r where r.id = rota_id
                and (r.consultor_id = (select auth.uid()) or (select auth.uid()) = any (r.participantes))));

-- Assinaturas do relatório da rota (todos que foram na rota)
create table public.rota_assinaturas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  rota_id uuid not null references public.rotas(id) on delete cascade,
  usuario_id uuid references public.profiles(id) on delete set null,
  nome text not null check (char_length(nome) between 2 and 160),
  papel text not null default 'participante' check (papel in ('responsavel', 'participante', 'gestor')),
  assinatura_path text not null check (char_length(assinatura_path) <= 400),
  registrado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  assinado_em timestamptz not null default now()
);
create index on public.rota_assinaturas (rota_id);
create index on public.rota_assinaturas (empresa_id);
create index on public.rota_assinaturas (usuario_id);
create index on public.rota_assinaturas (registrado_por);
create trigger zz_empresa_vinculos before insert or update on public.rota_assinaturas
  for each row execute function public.empresa_vinculos('rota_id:rotas', 'usuario_id:@');
create trigger trg_audit_rota_assinaturas after insert or update or delete on public.rota_assinaturas
  for each row execute function public.audit_trigger();

create or replace function public.rota_assinatura_validar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status public.rota_status;
begin
  select status into v_status from public.rotas where id = new.rota_id;
  if v_status is null or v_status not in ('em_andamento', 'concluida', 'aprovada') then
    raise exception 'O relatório da rota é assinado ao final da rota.';
  end if;
  return new;
end $$;
revoke execute on function public.rota_assinatura_validar() from public, anon, authenticated;
create trigger trg_rota_assinatura_validar before insert on public.rota_assinaturas for each row execute function public.rota_assinatura_validar();

alter table public.rota_assinaturas enable row level security;
create policy rota_assinaturas_empresa on public.rota_assinaturas as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy rota_assinaturas_select on public.rota_assinaturas for select to authenticated
  using (exists (select 1 from public.rotas r where r.id = rota_id and public.pode_ver_rota(r.consultor_id)));
create policy rota_assinaturas_insert on public.rota_assinaturas for insert to authenticated
  with check (registrado_por = (select auth.uid()) and exists (select 1 from public.rotas r where r.id = rota_id
                and (r.consultor_id = (select auth.uid()) or (select auth.uid()) = any (r.participantes) or (select public.tem_permissao('rotas.aprovar')))));

-- Iniciar exige checklist de saída; finalizar exige checklist de chegada (rotas novas com veículo)
create or replace function public.rota_exigir_checklist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.exige_checklist and new.veiculo_id is not null then
    if old.status = 'planejada' and new.status = 'em_andamento'
       and not exists (select 1 from public.rota_checklists where rota_id = new.id and momento = 'saida') then
      raise exception 'Faça o checklist de saída do veículo (km, tanque e foto do painel) antes de iniciar a rota.';
    end if;
    if old.status = 'em_andamento' and new.status = 'concluida'
       and not exists (select 1 from public.rota_checklists where rota_id = new.id and momento = 'chegada') then
      raise exception 'Faça o checklist de chegada do veículo (km, tanque, avarias e foto do painel) antes de finalizar.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.rota_exigir_checklist() from public, anon, authenticated;
create trigger trg_rotas_checklist before update of status on public.rotas
  for each row execute function public.rota_exigir_checklist();

-- inconsistência de rota: concluída sem checklist
create or replace function public.inconsistencias_rotas()
returns table (rota_id uuid, nome text, data date, detalhe text)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.nome, r.data,
         'Rota ' || r.status || ' sem checklist de ' || concat_ws(' e ',
           case when not exists (select 1 from public.rota_checklists k where k.rota_id = r.id and k.momento = 'saida') then 'saída' end,
           case when not exists (select 1 from public.rota_checklists k where k.rota_id = r.id and k.momento = 'chegada') then 'chegada' end)
    from public.rotas r
   where r.status in ('concluida', 'aprovada') and r.exige_checklist and r.veiculo_id is not null
     and ((select count(*) from public.rota_checklists k where k.rota_id = r.id) < 2)
$$;
grant execute on function public.inconsistencias_rotas() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Sementes da EASY: assessores e metas pedidas pela diretoria
-- ---------------------------------------------------------------------
do $$
declare v_emp uuid; v_dir uuid; v_jose uuid; v_santana uuid; v_vitoria uuid; v_vania uuid; v_alyson uuid;
begin
  select id into v_emp from public.empresas where nome ilike 'EASY%' order by created_at limit 1;
  if v_emp is null then return; end if;
  select m.user_id into v_alyson from public.empresa_membros m join public.profiles p on p.id = m.user_id
   where m.empresa_id = v_emp and p.full_name ilike 'Alyson Barbosa%' limit 1;

  insert into public.assessores (empresa_id, nome, categoria, apelidos, user_id, acordo_comercial)
  values (v_emp, 'Diretoria (Alyson Barbosa)', 'diretoria', array['ALYSON', 'DIRETORIA'], v_alyson, false) returning id into v_dir;
  insert into public.assessores (empresa_id, nome, categoria, apelidos) values (v_emp, 'José', 'consultor', array['JOSE']) returning id into v_jose;
  insert into public.assessores (empresa_id, nome, categoria, apelidos) values (v_emp, 'Santana', 'consultor', array['SANTANA']) returning id into v_santana;
  insert into public.assessores (empresa_id, nome, categoria, apelidos) values (v_emp, 'Vitória', 'consultor', array['VITORIA']) returning id into v_vitoria;
  insert into public.assessores (empresa_id, nome, categoria, apelidos) values (v_emp, 'Vânia', 'consultor', array['VANIA']) returning id into v_vania;

  insert into public.metas_processos (empresa_id, nome, indicador, periodicidade, alvo, assessor_id, categoria, valor) values
    (v_emp, 'Diretoria — processos no mês', 'processos_novos', 'mensal', 'assessor', v_dir, null, 10),
    (v_emp, 'Diretoria — processos no ano', 'processos_novos', 'anual', 'assessor', v_dir, null, 100),
    (v_emp, 'Habilitações no INSS no mês', 'habilitados', 'mensal', 'empresa', null, null, 55),
    (v_emp, 'Processos judicializados no mês', 'judicializados', 'mensal', 'empresa', null, null, 30),
    (v_emp, 'José — processos/clientes novos no mês', 'processos_novos', 'mensal', 'assessor', v_jose, null, 50),
    (v_emp, 'José — processos no ano', 'processos_novos', 'anual', 'assessor', v_jose, null, 660),
    (v_emp, 'Santana — processos/clientes novos no mês', 'processos_novos', 'mensal', 'assessor', v_santana, null, 30),
    (v_emp, 'Santana — processos no ano', 'processos_novos', 'anual', 'assessor', v_santana, null, 360),
    (v_emp, 'Corretores — processos no mês (cada)', 'processos_novos', 'mensal', 'categoria', null, 'corretor', 20),
    (v_emp, 'Corretores — processos no ano (cada)', 'processos_novos', 'anual', 'categoria', null, 'corretor', 360),
    (v_emp, 'Vitória — processos no mês', 'processos_novos', 'mensal', 'assessor', v_vitoria, null, 10),
    (v_emp, 'Vitória — ligações para clientes por dia', 'ligacoes', 'diaria', 'assessor', v_vitoria, null, 20),
    (v_emp, 'Vânia — processos no mês', 'processos_novos', 'mensal', 'assessor', v_vania, null, 20),
    (v_emp, 'Vânia — ligações para clientes por dia', 'ligacoes', 'diaria', 'assessor', v_vania, null, 20);
end $$;
