-- =====================================================================
-- Reestruturação: Comercial (antigo Consultor), assessores, novos status dos processos,
-- processos restritos (pendência/exigência/análise) e financeiro só para o administrador master.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Assessores (quem traz o cliente). Cadastro próprio, com ou sem acesso ao sistema.
-- ---------------------------------------------------------------------
create table public.assessores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 200),
  cpf text check (cpf ~ '^\d{11}$'),
  telefone text check (char_length(telefone) <= 20),
  email text check (char_length(email) <= 160),
  comprovante_path text check (char_length(comprovante_path) <= 400),
  comprovante_mime text check (char_length(comprovante_mime) <= 100),
  acordo_comercial boolean not null default false,
  ativo boolean not null default true,
  observacoes text check (char_length(observacoes) <= 2000),
  user_id uuid references public.profiles(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, cpf)
);
create index on public.assessores (empresa_id, nome);
create index on public.assessores (user_id);
create index on public.assessores (created_by);

create trigger trg_assessores_updated before update on public.assessores for each row execute function public.set_updated_at();
create trigger zz_empresa_vinculos before insert or update on public.assessores
  for each row execute function public.empresa_vinculos('user_id:@');
create trigger trg_audit_assessores after insert or update or delete on public.assessores
  for each row execute function public.audit_trigger();

alter table public.assessores enable row level security;
create policy assessores_empresa on public.assessores as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy assessores_select on public.assessores for select to authenticated
  using ((select public.tem_permissao('clientes.view')) or (select public.tem_permissao('consultores.manage')));
create policy assessores_insert on public.assessores for insert to authenticated
  with check ((select public.tem_permissao('consultores.manage')));
create policy assessores_update on public.assessores for update to authenticated
  using ((select public.tem_permissao('consultores.manage'))) with check ((select public.tem_permissao('consultores.manage')));
create policy assessores_delete on public.assessores for delete to authenticated
  using ((select public.tem_permissao('consultores.manage')));

update public.funcionalidades set nome = 'Gerir assessores' where chave = 'consultores.manage';

-- Comprovante do assessor no bucket "documentos": empresas/<empresa>/assessores/<assessor>/<arquivo>
create or replace function public.storage_can_access(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_rel text := public.storage_caminho_relativo(p_name); v_parts text[]; v_id uuid;
begin
  if v_rel is null or not public.is_active_user() then return false; end if;
  v_parts := string_to_array(v_rel, '/');
  if v_parts[1] in ('clientes', 'processos', 'rotas', 'despesas', 'assessores') and array_length(v_parts, 1) >= 3 then
    begin v_id := v_parts[2]::uuid; exception when others then return false; end;
    return case v_parts[1]
      when 'clientes' then public.can_access_cliente(v_id)
      when 'processos' then public.can_access_processo(v_id)
      when 'rotas' then exists (select 1 from public.rotas r where r.id = v_id and r.empresa_id = public.empresa_atual() and public.pode_ver_rota(r.consultor_id))
      when 'assessores' then public.tem_permissao('consultores.manage')
        and exists (select 1 from public.assessores a where a.id = v_id and a.empresa_id = public.empresa_atual())
      else v_id = auth.uid() or public.tem_permissao('despesas.aprovar') or public.is_supervisor_de(v_id)
    end;
  elsif v_parts[1] = 'geral' then
    return public.is_backoffice();
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------
-- 2. Cadastro do cliente pelo comercial: telefone de recado, senha gov (cifrada), tipo de ação, assessor
-- ---------------------------------------------------------------------
alter table public.clientes
  add column telefone_recado text check (char_length(telefone_recado) <= 20),
  add column senha_gov_enc text check (char_length(senha_gov_enc) <= 600),
  add column tipo_acao text check (char_length(tipo_acao) <= 80),
  add column assessor_id uuid references public.assessores(id) on delete set null;
create index on public.clientes (assessor_id);

drop trigger zz_empresa_vinculos on public.clientes;
create trigger zz_empresa_vinculos before insert or update on public.clientes
  for each row execute function public.empresa_vinculos('consultor_id:@', 'responsavel_admin_id:@', 'consultor_original_id:@', 'assessor_id:assessores');

-- ---------------------------------------------------------------------
-- 3. Status dos processos: nova classificação, definida pela equipe (não mais derivada da planilha)
-- ---------------------------------------------------------------------
alter table public.cliente_casos drop constraint cliente_casos_status_check;

-- Na importação (status vazio) o status é sugerido pela planilha; depois disso, só muda quando alguém escolhe.
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
  if new.status is null then
    new.status := case
      when v_sit = 'ARQUIVO MORTO' then 'arquivo_morto'
      when v_sit = 'COMERCIAL' then 'outros'
      when v_sit ~ '^20[0-9]{2}$' or v_obs ~ 'AGUARDANDO IDADE' then 'aguardando_idade'
      when new.exigencia_estado = 'aberta' then 'exigencia'
      when new.habilitado_em is not null and new.pericia_em is null and new.avaliacao_em is null then 'habilitado'
      when new.pendencia is not null then 'pendencia'
      else 'em_analise'
    end;
  end if;
  new.corretores := coalesce((
    select array_agg(distinct x) from (
      select upper(trim(t)) x from regexp_split_to_table(coalesce(new.corretor, ''), '/') t
    ) s where x <> ''), '{}');
  new.updated_at := now();
  return new;
end $$;

update public.cliente_casos set status = case status
    when 'em_preparacao' then 'em_analise'
    when 'pericia' then 'em_analise'
    when 'comercial' then 'outros'
    else status end
  where status in ('em_preparacao', 'pericia', 'comercial');
alter table public.cliente_casos alter column status drop default;
alter table public.cliente_casos add constraint cliente_casos_status_check check (status in (
  'arquivo_morto', 'habilitado', 'pendencia', 'exigencia', 'em_analise', 'deferido', 'indeferido',
  'aguardando_idade', 'judicializado', 'outros'));

-- Processos em pendência, exigência ou análise: só para quem tem a funcionalidade (definida pelo master)
insert into public.funcionalidades (chave, nome, area, sensivel, ordem)
values ('processos.status_restritos', 'Ver processos em pendência, exigência e análise', 'administrativo', true, 34)
on conflict (chave) do update set nome = excluded.nome, area = excluded.area, sensivel = excluded.sensivel;

create policy cliente_casos_status_restritos on public.cliente_casos as restrictive for select to authenticated
  using (status not in ('pendencia', 'exigencia', 'em_analise') or (select public.tem_permissao('processos.status_restritos')));

-- ---------------------------------------------------------------------
-- 4. Financeiro só para o administrador master: funcionalidades da área financeira
--    não valem para quem não é master, mesmo que estejam no nível ou numa exceção.
-- ---------------------------------------------------------------------
create or replace function public.permissoes_de(p_user uuid, p_empresa uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  with membro as (
    select m.admin_master from public.empresa_membros m join public.profiles p on p.id = m.user_id
     where m.empresa_id = p_empresa and m.user_id = p_user and m.ativo and p.active
  ),
  base as (
    select nf.funcionalidade
      from public.departamento_membros dm
      join public.departamentos d on d.id = dm.departamento_id and d.ativo
      join public.nivel_funcionalidades nf on nf.nivel_id = dm.nivel_id
     where dm.user_id = p_user and dm.empresa_id = p_empresa and dm.ativo and (dm.valido_ate is null or dm.valido_ate >= current_date)
    union
    select x.funcionalidade from public.usuario_permissoes_extra x
     where x.user_id = p_user and x.empresa_id = p_empresa and x.tipo = 'concessao' and (x.valido_ate is null or x.valido_ate > now())
  )
  select f.chave from public.funcionalidades f where exists (select 1 from membro where admin_master)
  union
  select b.funcionalidade from base b
   where exists (select 1 from membro)
     and not exists (select 1 from public.funcionalidades f where f.chave = b.funcionalidade and f.area = 'financeiro')
     and not exists (select 1 from public.usuario_permissoes_extra x
                      where x.user_id = p_user and x.empresa_id = p_empresa and x.tipo = 'revogacao' and x.funcionalidade = b.funcionalidade
                        and (x.valido_ate is null or x.valido_ate > now()))
$$;
revoke execute on function public.permissoes_de(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Gerente administrativa (Vanuza, empresa EASY): comercial + administrativo + todos os status, sem financeiro
-- ---------------------------------------------------------------------
do $$
declare v_user uuid; v_emp uuid; v_dep record; v_nivel uuid;
begin
  select m.user_id, m.empresa_id into v_user, v_emp
    from public.empresa_membros m join public.profiles p on p.id = m.user_id
    join public.empresas e on e.id = m.empresa_id
   where p.full_name ilike 'Vanuza Barbosa%' and e.nome ilike 'EASY%' limit 1;
  if v_user is null then return; end if;
  for v_dep in select id from public.departamentos where empresa_id = v_emp and tipo in ('consultor', 'administrativo') and ativo loop
    select id into v_nivel from public.departamento_niveis where departamento_id = v_dep.id and nome = 'Gestor';
    if v_nivel is null then continue; end if;
    insert into public.departamento_membros (empresa_id, departamento_id, user_id, funcao, nivel_id, ativo)
    values (v_emp, v_dep.id, v_user, 'membro', v_nivel, true)
    on conflict (departamento_id, user_id) do update set nivel_id = excluded.nivel_id, ativo = true, valido_ate = null;
  end loop;
  delete from public.usuario_permissoes_extra where empresa_id = v_emp and user_id = v_user
    and funcionalidade in ('processos.status_restritos', 'clientes.ver_todos', 'comissoes.view');
  insert into public.usuario_permissoes_extra (empresa_id, user_id, funcionalidade, tipo, motivo) values
    (v_emp, v_user, 'processos.status_restritos', 'concessao', 'Gerente administrativa: vê todos os status dos processos'),
    (v_emp, v_user, 'clientes.ver_todos', 'concessao', 'Gerente administrativa: vê toda a base e o comercial'),
    (v_emp, v_user, 'comissoes.view', 'revogacao', 'Gerente administrativa: sem acesso a valores financeiros');
end $$;
