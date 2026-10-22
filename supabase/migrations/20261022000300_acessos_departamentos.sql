-- =====================================================================
-- GE EASY — Fase 2a: departamentos × níveis × funcionalidades
--
-- * departamentos ganham tipo (área): consultor | administrativo | juridico | rh | financeiro | personalizado;
-- * funcionalidades: catálogo global (mantido pela plataforma);
-- * níveis por departamento (Operador/Supervisor/Gestor) com funcionalidades padrão;
-- * departamento_membros ganha nível, ativo e validade; concessões/revogações individuais;
-- * permissão efetiva = ⋃ funcionalidades dos níveis + concessões − revogações (admin master = todas);
-- * tem_permissao() aplicada em políticas RESTRITIVAS (retirar a funcionalidade bloqueia no banco);
-- * o papel (app_role) continua definindo o ESCOPO dos dados (próprio, departamento, empresa).
-- =====================================================================

create type public.departamento_tipo as enum ('consultor', 'administrativo', 'juridico', 'rh', 'financeiro', 'personalizado');

alter table public.departamentos add column if not exists tipo public.departamento_tipo not null default 'personalizado';
update public.departamentos set tipo = case
    when sigla in ('CONT', 'CONS', 'RCR', 'TRAB', 'JUR') or nome ilike 'jur%' then 'juridico'
    when sigla = 'ADM' or nome ilike 'administrativo%' then 'administrativo'
    when sigla = 'FIN' or nome ilike 'financeiro%' then 'financeiro'
    when sigla = 'COM' or nome ilike 'comercial%' then 'consultor'
    when sigla = 'RH' or nome ilike '%recursos humanos%' then 'rh'
    else 'personalizado' end::public.departamento_tipo;

-- ---------------------------------------------------------------------
-- Catálogo de funcionalidades (global)
-- ---------------------------------------------------------------------
create table public.funcionalidades (
  chave text primary key check (chave ~ '^[a-z_]+(\.[a-z_]+)+$'),
  nome text not null,
  area public.departamento_tipo, -- área que a funcionalidade "abre" na entrada por departamento (null = geral)
  sensivel boolean not null default false,
  ordem int not null default 0
);
insert into public.funcionalidades (chave, nome, area, sensivel, ordem) values
  ('dashboard.view', 'Ver painéis', null, false, 1),
  ('clientes.view', 'Ver clientes', null, false, 10),
  ('clientes.write', 'Cadastrar e editar clientes', null, false, 11),
  ('clientes.delete', 'Excluir clientes', null, true, 12),
  ('clientes.ver_todos', 'Ver a base completa de clientes da empresa', 'administrativo', true, 13),
  ('clientes.transfer', 'Transferir/redistribuir carteira', 'administrativo', true, 14),
  ('clientes.exportar', 'Exportar a base de clientes', 'administrativo', true, 15),
  ('documentacao.analisar', 'Analisar documentação (aprovar/recusar)', 'administrativo', false, 20),
  ('documentacao.prorrogar', 'Prorrogar prazo de documentação', 'administrativo', true, 21),
  ('juridico.encaminhar', 'Encaminhar cliente/venda ao jurídico', null, false, 22),
  ('cadastros.manage', 'Cadastros auxiliares e parâmetros', 'administrativo', false, 23),
  ('lgpd.exportar', 'Relatório LGPD do titular', 'administrativo', true, 24),
  ('comercial.view', 'Ver módulo comercial', 'consultor', false, 30),
  ('negocios.write', 'Registrar negócios (funil, consórcios, seguros)', 'consultor', false, 31),
  ('negocios.delete', 'Excluir negócios', 'consultor', true, 32),
  ('visitas.checkin', 'Check-in de visitas', 'consultor', false, 33),
  ('comissoes.view', 'Ver comissões', null, false, 34),
  ('metas.manage', 'Definir metas', 'consultor', false, 35),
  ('consultores.manage', 'Gerir consultores', 'consultor', false, 36),
  ('processos.view', 'Ver processos', 'juridico', false, 40),
  ('processos.write', 'Cadastrar e editar processos', 'juridico', false, 41),
  ('processos.delete', 'Excluir processos', 'juridico', true, 42),
  ('publicacoes.view', 'Publicações e intimações', 'juridico', false, 43),
  ('atendimentos.view', 'Atendimentos e triagem', null, false, 44),
  ('contratos.view', 'Ver contratos de honorários', null, false, 45),
  ('contratos.write', 'Editar contratos de honorários', null, false, 46),
  ('horas.lancar', 'Lançar horas', null, false, 47),
  ('modelos.view', 'Ver modelos de documentos', null, false, 48),
  ('modelos.write', 'Editar modelos de documentos', null, false, 49),
  ('departamentos.view', 'Ver departamentos', null, false, 50),
  ('departamentos.manage', 'Gerir departamentos e equipes', null, false, 51),
  ('financeiro.view', 'Financeiro (receber/pagar)', 'financeiro', true, 60),
  ('processos.financeiro', 'Custas e honorários dos processos', 'financeiro', false, 61),
  ('comissoes.manage', 'Gerir comissões (baixa e repasse)', 'financeiro', true, 62),
  ('horas.gerir', 'Faturar horas', 'financeiro', false, 63),
  ('relatorios.view', 'Relatórios gerenciais', 'financeiro', false, 64),
  ('rh.funcionarios.ver', 'Ver funcionários e acessos', 'rh', true, 70),
  ('usuarios.manage', 'Convidar, ativar e desativar usuários', 'rh', true, 71),
  ('auditoria.view', 'Auditoria e relatórios de alterações', null, true, 80),
  ('lixeira.gerir', 'Lixeira (restaurar excluídos)', null, true, 81),
  ('integracoes.manage', 'Integrações (Google, DataJud, DJEN)', null, true, 82),
  ('lgpd.anonimizar', 'Anonimizar titular (LGPD)', null, true, 83);

-- Funcionalidades padrão de cada nível por tipo de departamento (referência para novas empresas e "restaurar padrão")
create table public.funcionalidades_padrao (
  tipo public.departamento_tipo not null,
  nivel text not null,
  ordem int not null,
  funcionalidade text not null references public.funcionalidades(chave) on delete cascade,
  primary key (tipo, nivel, funcionalidade)
);
insert into public.funcionalidades_padrao (tipo, nivel, ordem, funcionalidade)
select v.tipo::public.departamento_tipo, v.nivel, v.ordem, f
  from (values
    ('consultor', 'Operador', 1, array['dashboard.view','clientes.view','clientes.write','departamentos.view','comercial.view','atendimentos.view','modelos.view','negocios.write','comissoes.view','visitas.checkin']),
    ('consultor', 'Supervisor', 2, array['dashboard.view','clientes.view','clientes.write','departamentos.view','comercial.view','atendimentos.view','modelos.view','negocios.write','comissoes.view','visitas.checkin','metas.manage','consultores.manage']),
    ('consultor', 'Gestor', 3, array['dashboard.view','clientes.view','clientes.write','departamentos.view','comercial.view','atendimentos.view','modelos.view','negocios.write','comissoes.view','visitas.checkin','metas.manage','consultores.manage','negocios.delete','clientes.transfer','clientes.delete','relatorios.view']),
    ('administrativo', 'Operador', 1, array['dashboard.view','clientes.view','clientes.write','clientes.ver_todos','documentacao.analisar','departamentos.view','modelos.view','atendimentos.view']),
    ('administrativo', 'Supervisor', 2, array['dashboard.view','clientes.view','clientes.write','clientes.ver_todos','documentacao.analisar','departamentos.view','modelos.view','atendimentos.view','documentacao.prorrogar','clientes.transfer','juridico.encaminhar']),
    ('administrativo', 'Gestor', 3, array['dashboard.view','clientes.view','clientes.write','clientes.ver_todos','documentacao.analisar','departamentos.view','modelos.view','atendimentos.view','documentacao.prorrogar','clientes.transfer','juridico.encaminhar','clientes.exportar','cadastros.manage','lgpd.exportar','clientes.delete','relatorios.view']),
    ('juridico', 'Operador', 1, array['dashboard.view','clientes.view','clientes.write','processos.view','processos.write','departamentos.view','contratos.view','horas.lancar','atendimentos.view','publicacoes.view','modelos.view','modelos.write']),
    ('juridico', 'Supervisor', 2, array['dashboard.view','clientes.view','clientes.write','processos.view','processos.write','departamentos.view','contratos.view','horas.lancar','atendimentos.view','publicacoes.view','modelos.view','modelos.write','processos.financeiro','contratos.write']),
    ('juridico', 'Gestor', 3, array['dashboard.view','clientes.view','clientes.write','processos.view','processos.write','departamentos.view','contratos.view','horas.lancar','atendimentos.view','publicacoes.view','modelos.view','modelos.write','processos.financeiro','contratos.write','processos.delete','departamentos.manage','clientes.delete','relatorios.view','juridico.encaminhar']),
    ('rh', 'Operador', 1, array['dashboard.view','departamentos.view','rh.funcionarios.ver']),
    ('rh', 'Supervisor', 2, array['dashboard.view','departamentos.view','rh.funcionarios.ver','modelos.view']),
    ('rh', 'Gestor', 3, array['dashboard.view','departamentos.view','rh.funcionarios.ver','modelos.view','usuarios.manage']),
    ('financeiro', 'Operador', 1, array['dashboard.view','clientes.view','processos.view','processos.financeiro','departamentos.view','comercial.view','financeiro.view','contratos.view','horas.lancar','modelos.view','comissoes.view']),
    ('financeiro', 'Supervisor', 2, array['dashboard.view','clientes.view','processos.view','processos.financeiro','departamentos.view','comercial.view','financeiro.view','contratos.view','horas.lancar','modelos.view','comissoes.view','contratos.write','horas.gerir','modelos.write','comissoes.manage']),
    ('financeiro', 'Gestor', 3, array['dashboard.view','clientes.view','processos.view','processos.financeiro','departamentos.view','comercial.view','financeiro.view','contratos.view','horas.lancar','modelos.view','comissoes.view','contratos.write','horas.gerir','modelos.write','comissoes.manage','relatorios.view']),
    ('personalizado', 'Operador', 1, array['dashboard.view']),
    ('personalizado', 'Supervisor', 2, array['dashboard.view']),
    ('personalizado', 'Gestor', 3, array['dashboard.view'])
  ) as v(tipo, nivel, ordem, fs), unnest(v.fs) as f;

-- ---------------------------------------------------------------------
-- Níveis, vínculos e exceções por empresa
-- ---------------------------------------------------------------------
create table public.departamento_niveis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 60),
  ordem int not null default 1 check (ordem between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (departamento_id, nome)
);
create index on public.departamento_niveis (empresa_id, departamento_id);
create trigger trg_niveis_updated before update on public.departamento_niveis for each row execute function public.set_updated_at();

create table public.nivel_funcionalidades (
  nivel_id uuid not null references public.departamento_niveis(id) on delete cascade,
  funcionalidade text not null references public.funcionalidades(chave) on delete cascade,
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (nivel_id, funcionalidade)
);
create index on public.nivel_funcionalidades (empresa_id);

alter table public.departamento_membros
  add column if not exists nivel_id uuid references public.departamento_niveis(id) on delete set null,
  add column if not exists ativo boolean not null default true,
  add column if not exists valido_ate date;

create table public.usuario_permissoes_extra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  funcionalidade text not null references public.funcionalidades(chave) on delete cascade,
  tipo text not null check (tipo in ('concessao', 'revogacao')),
  motivo text not null check (char_length(motivo) between 3 and 500),
  valido_ate timestamptz,
  concedido_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (empresa_id, user_id, funcionalidade)
);
create index on public.usuario_permissoes_extra (empresa_id, user_id);

create trigger zz_empresa_vinculos before insert or update on public.departamento_niveis for each row execute function public.empresa_vinculos('departamento_id:departamentos');
create trigger zz_empresa_vinculos before insert or update on public.nivel_funcionalidades for each row execute function public.empresa_vinculos('nivel_id:departamento_niveis');
create trigger zz_empresa_vinculos before insert or update on public.usuario_permissoes_extra for each row execute function public.empresa_vinculos('user_id:@');
-- nível precisa ser do mesmo departamento do vínculo
create or replace function public.dep_membro_nivel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.nivel_id is not null and not exists (select 1 from public.departamento_niveis n where n.id = new.nivel_id and n.departamento_id = new.departamento_id) then
    raise exception 'O nível informado não pertence a este departamento.' using errcode = '23514';
  end if;
  -- só o administrador master define níveis de acesso (responsáveis apenas incluem membros na equipe)
  if auth.uid() is not null and not public.is_admin_master() and coalesce(current_setting('geeasy.acesso_padrao', true), '') <> 'on'
     and (tg_op = 'INSERT' and new.nivel_id is not null or tg_op = 'UPDATE' and (new.nivel_id, new.ativo, new.valido_ate) is distinct from (old.nivel_id, old.ativo, old.valido_ate)) then
    raise exception 'Somente o administrador master define níveis de acesso.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.dep_membro_nivel() from public, anon, authenticated;
create trigger trg_dep_membro_nivel before insert or update on public.departamento_membros for each row execute function public.dep_membro_nivel();

-- ---------------------------------------------------------------------
-- Permissão efetiva
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
     and not exists (select 1 from public.usuario_permissoes_extra x
                      where x.user_id = p_user and x.empresa_id = p_empresa and x.tipo = 'revogacao' and x.funcionalidade = b.funcionalidade
                        and (x.valido_ate is null or x.valido_ate > now()))
$$;
revoke execute on function public.permissoes_de(uuid, uuid) from public, anon, authenticated;

create or replace function public.tem_permissao(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.permissoes_de(auth.uid(), public.empresa_atual()) p where p = p_chave)
$$;

create or replace function public.minhas_permissoes()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p order by p), '{}') from public.permissoes_de(auth.uid(), public.empresa_atual()) p
$$;

-- Áreas de trabalho disponíveis = áreas das funcionalidades efetivas (respeitando os módulos da empresa)
create or replace function public.minhas_areas()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct f.area::text order by f.area::text), '{}')
    from public.permissoes_de(auth.uid(), public.empresa_atual()) p
    join public.funcionalidades f on f.chave = p
    join public.empresas e on e.id = public.empresa_atual()
   where f.area is not null and f.area::text = any(e.modulos)
$$;

-- Visão de permissões de outro usuário (tela de acessos / "copiar perfil")
create or replace function public.permissoes_do_usuario(p_user uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin_master() or public.tem_permissao('rh.funcionarios.ver')) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return (select coalesce(array_agg(p order by p), '{}') from public.permissoes_de(p_user, public.empresa_atual()) p);
end $$;

-- Copia níveis e exceções de um usuário para outro ("igual ao fulano")
create or replace function public.copiar_acessos(p_origem uuid, p_destino uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual();
begin
  if not public.is_admin_master() then raise exception 'Somente o administrador master.' using errcode = '42501'; end if;
  if p_destino = auth.uid() then raise exception 'Você não pode alterar o seu próprio acesso.' using errcode = '42501'; end if;
  if not exists (select 1 from public.empresa_membros where empresa_id = v_emp and user_id = p_origem)
     or not exists (select 1 from public.empresa_membros where empresa_id = v_emp and user_id = p_destino) then
    raise exception 'Usuário não pertence à empresa.' using errcode = '42501';
  end if;
  update public.departamento_membros set nivel_id = null where empresa_id = v_emp and user_id = p_destino;
  insert into public.departamento_membros (empresa_id, departamento_id, user_id, funcao, nivel_id, ativo, valido_ate)
  select v_emp, departamento_id, p_destino, 'membro', nivel_id, ativo, valido_ate from public.departamento_membros
   where empresa_id = v_emp and user_id = p_origem
  on conflict (departamento_id, user_id) do update set nivel_id = excluded.nivel_id, ativo = excluded.ativo, valido_ate = excluded.valido_ate;
  delete from public.usuario_permissoes_extra where empresa_id = v_emp and user_id = p_destino;
  insert into public.usuario_permissoes_extra (empresa_id, user_id, funcionalidade, tipo, motivo, valido_ate)
  select v_emp, p_destino, funcionalidade, tipo, 'Copiado de outro usuário: ' || motivo, valido_ate from public.usuario_permissoes_extra
   where empresa_id = v_emp and user_id = p_origem;
end $$;

-- Níveis padrão de um departamento conforme o tipo
create or replace function public.criar_niveis_padrao(p_departamento uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_dep record; v_nivel uuid; r record;
begin
  select id, empresa_id, tipo into v_dep from public.departamentos where id = p_departamento;
  for r in select distinct nivel, ordem from public.funcionalidades_padrao where tipo = v_dep.tipo order by ordem loop
    insert into public.departamento_niveis (empresa_id, departamento_id, nome, ordem) values (v_dep.empresa_id, v_dep.id, r.nivel, r.ordem)
    on conflict (departamento_id, nome) do update set ordem = excluded.ordem returning id into v_nivel;
    insert into public.nivel_funcionalidades (empresa_id, nivel_id, funcionalidade)
    select v_dep.empresa_id, v_nivel, fp.funcionalidade from public.funcionalidades_padrao fp where fp.tipo = v_dep.tipo and fp.nivel = r.nivel
    on conflict do nothing;
  end loop;
end $$;
revoke execute on function public.criar_niveis_padrao(uuid) from public, anon, authenticated;

-- Departamento novo já nasce com os níveis padrão do seu tipo
create or replace function public.departamento_novo_niveis()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.criar_niveis_padrao(new.id);
  return new;
end $$;
revoke execute on function public.departamento_novo_niveis() from public, anon, authenticated;
create trigger trg_departamento_niveis after insert on public.departamentos for each row execute function public.departamento_novo_niveis();

create or replace function public.provisionar_empresa(p_empresa uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  select nome into v_nome from public.empresas where id = p_empresa;
  insert into public.configuracoes (empresa_id, chave, valor) values
    (p_empresa, 'empresa', jsonb_build_object('nome', v_nome, 'sistema', 'GE EASY')),
    (p_empresa, 'comercial', jsonb_build_object('dias_alerta_renovacao', 30, 'moeda', 'BRL'))
  on conflict do nothing;
  insert into public.departamentos (empresa_id, nome, sigla, descricao, cor, tipo) values
    (p_empresa, 'Comercial', 'COM', 'Consultores e captação de clientes', 'amber', 'consultor'),
    (p_empresa, 'Administrativo', 'ADM', 'Documentação, cadastros e base de clientes', 'slate', 'administrativo'),
    (p_empresa, 'Jurídico', 'JUR', 'Processos, intimações e audiências', 'brand', 'juridico'),
    (p_empresa, 'Recursos Humanos', 'RH', 'Funcionários, acessos e folha', 'sky', 'rh'),
    (p_empresa, 'Financeiro', 'FIN', 'Contas, recebimentos e folha de pagamento', 'green', 'financeiro')
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Migração dos dados atuais (sem perder acesso)
-- ---------------------------------------------------------------------
do $$
declare r record; v_dep uuid; v_nivel uuid; g record;
begin
  -- RH em cada empresa que ainda não tem
  insert into public.departamentos (empresa_id, nome, sigla, descricao, cor, tipo)
  select e.id, 'Recursos Humanos', 'RH', 'Funcionários, acessos e folha', 'sky', 'rh' from public.empresas e
   where not exists (select 1 from public.departamentos d where d.empresa_id = e.id and d.tipo = 'rh')
  on conflict do nothing;
  -- níveis padrão nos departamentos existentes (os novos já ganharam pelo gatilho)
  for r in select id from public.departamentos d where not exists (select 1 from public.departamento_niveis n where n.departamento_id = d.id) loop
    perform public.criar_niveis_padrao(r.id);
  end loop;

  -- papel antigo -> departamento/nível (admins já são administradores master)
  for r in
    select m.empresa_id, m.user_id, m.role,
      case m.role when 'consultor' then 'consultor' when 'consultor_externo' then 'consultor' when 'financeiro' then 'financeiro'
                  when 'advogado' then 'juridico' when 'assistente_juridico' then 'juridico' end as tipo,
      case m.role when 'financeiro' then 'Gestor' when 'advogado' then 'Supervisor' else 'Operador' end as nivel
      from public.empresa_membros m
     where not m.admin_master and m.role <> 'gestor' and m.role <> 'admin'
  loop
    continue when r.tipo is null;
    if r.tipo = 'juridico' then
      -- advogado/assistente: nível nos departamentos jurídicos de que já é membro (não amplia o escopo de processos)
      update public.departamento_membros dm set nivel_id = n.id
        from public.departamento_niveis n, public.departamentos d
       where dm.user_id = r.user_id and dm.empresa_id = r.empresa_id and d.id = dm.departamento_id and d.tipo = 'juridico'
         and n.departamento_id = d.id and n.nome = r.nivel;
    else
      select d.id into v_dep from public.departamentos d where d.empresa_id = r.empresa_id and d.tipo = r.tipo::public.departamento_tipo order by d.created_at, d.nome limit 1;
      select n.id into v_nivel from public.departamento_niveis n where n.departamento_id = v_dep and n.nome = r.nivel;
      insert into public.departamento_membros (empresa_id, departamento_id, user_id, funcao, nivel_id)
      values (r.empresa_id, v_dep, r.user_id, 'membro', v_nivel)
      on conflict (departamento_id, user_id) do update set nivel_id = excluded.nivel_id;
    end if;
  end loop;

  -- gestores: nível Gestor em um departamento de cada área (gestão já enxerga todos os registros)
  for r in select m.empresa_id, m.user_id from public.empresa_membros m where m.role = 'gestor' and not m.admin_master loop
    for g in select distinct on (d.tipo) d.id as dep, n.id as nivel from public.departamentos d
               join public.departamento_niveis n on n.departamento_id = d.id and n.nome = 'Gestor'
              where d.empresa_id = r.empresa_id and d.tipo in ('consultor', 'administrativo', 'juridico', 'financeiro')
              order by d.tipo, d.created_at, d.nome loop
      insert into public.departamento_membros (empresa_id, departamento_id, user_id, funcao, nivel_id)
      values (r.empresa_id, g.dep, r.user_id, 'membro', g.nivel)
      on conflict (departamento_id, user_id) do update set nivel_id = coalesce(public.departamento_membros.nivel_id, excluded.nivel_id);
    end loop;
  end loop;

  -- rede de segurança: concede exatamente o que faltar em relação ao conjunto antigo do papel
  insert into public.usuario_permissoes_extra (empresa_id, user_id, funcionalidade, tipo, motivo)
  select m.empresa_id, m.user_id, a.perm, 'concessao', 'Migração do papel ' || m.role
    from public.empresa_membros m
    join (values
      ('consultor', array['dashboard.view','clientes.view','clientes.write','departamentos.view','comercial.view','atendimentos.view','modelos.view','negocios.write','comissoes.view','visitas.checkin']),
      ('consultor_externo', array['dashboard.view','clientes.view','clientes.write','departamentos.view','comercial.view','atendimentos.view','modelos.view','negocios.write','comissoes.view','visitas.checkin']),
      ('advogado', array['dashboard.view','clientes.view','clientes.write','processos.view','processos.write','processos.financeiro','departamentos.view','contratos.view','contratos.write','horas.lancar','atendimentos.view','publicacoes.view','modelos.view','modelos.write']),
      ('assistente_juridico', array['dashboard.view','clientes.view','clientes.write','processos.view','processos.write','departamentos.view','contratos.view','horas.lancar','atendimentos.view','publicacoes.view','modelos.view','modelos.write']),
      ('financeiro', array['dashboard.view','clientes.view','processos.view','processos.financeiro','departamentos.view','comercial.view','financeiro.view','contratos.view','contratos.write','horas.lancar','horas.gerir','modelos.view','modelos.write','comissoes.view','comissoes.manage','relatorios.view']),
      ('gestor', array['dashboard.view','clientes.view','clientes.write','processos.view','processos.write','processos.delete','processos.financeiro','departamentos.view','departamentos.manage','comercial.view','financeiro.view','contratos.view','contratos.write','horas.lancar','horas.gerir','atendimentos.view','publicacoes.view','modelos.view','modelos.write','clientes.delete','clientes.transfer','negocios.write','negocios.delete','comissoes.view','comissoes.manage','metas.manage','consultores.manage','relatorios.view','cadastros.manage','lgpd.exportar','visitas.checkin'])
    ) as old(role, perms) on old.role = m.role::text
    cross join lateral unnest(old.perms) as a(perm)
   where not m.admin_master
     and a.perm not in (select public.permissoes_de(m.user_id, m.empresa_id))
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Acesso padrão de um novo vínculo, conforme o perfil (o admin master ajusta depois na tela de acessos)
-- ---------------------------------------------------------------------
create or replace function public.atribuir_acesso_padrao(p_empresa uuid, p_user uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if exists (select 1 from public.departamento_membros where empresa_id = p_empresa and user_id = p_user) then return; end if;
  perform set_config('geeasy.acesso_padrao', 'on', true);
  for r in
    select distinct on (d.tipo) d.id as dep, n.id as nivel
      from (values
        ('consultor', 'consultor', 'Operador'), ('consultor_externo', 'consultor', 'Operador'),
        ('administrativo', 'administrativo', 'Operador'),
        ('advogado', 'juridico', 'Supervisor'), ('assistente_juridico', 'juridico', 'Operador'),
        ('financeiro', 'financeiro', 'Gestor'),
        ('gestor', 'consultor', 'Gestor'), ('gestor', 'administrativo', 'Gestor'), ('gestor', 'juridico', 'Gestor'), ('gestor', 'financeiro', 'Gestor'),
        ('admin', 'consultor', 'Gestor'), ('admin', 'administrativo', 'Gestor'), ('admin', 'juridico', 'Gestor'), ('admin', 'financeiro', 'Gestor'), ('admin', 'rh', 'Gestor')
      ) as v(role, tipo, nivel)
      join public.departamentos d on d.empresa_id = p_empresa and d.tipo::text = v.tipo and d.ativo
      join public.departamento_niveis n on n.departamento_id = d.id and n.nome = v.nivel
     where v.role = p_role::text
     order by d.tipo, d.created_at, d.nome
  loop
    insert into public.departamento_membros (empresa_id, departamento_id, user_id, funcao, nivel_id)
    values (p_empresa, r.dep, p_user, 'membro', r.nivel)
    on conflict (departamento_id, user_id) do nothing;
  end loop;
  perform set_config('geeasy.acesso_padrao', 'off', true);
end $$;
revoke execute on function public.atribuir_acesso_padrao(uuid, uuid, public.app_role) from public, anon, authenticated;

create or replace function public.membro_novo_acesso()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.atribuir_acesso_padrao(new.empresa_id, new.user_id, new.role);
  return new;
end $$;
revoke execute on function public.membro_novo_acesso() from public, anon, authenticated;
create trigger trg_membro_novo_acesso after insert on public.empresa_membros for each row execute function public.membro_novo_acesso();

-- ---------------------------------------------------------------------
-- Departamentos: vínculo ativo/validade
-- ---------------------------------------------------------------------
create or replace function public.is_membro_departamento(p_dep uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_dep is not null and exists (
    select 1 from public.departamentos d
     where d.id = p_dep and d.empresa_id = public.empresa_atual()
       and (d.responsavel_id = auth.uid()
            or exists (select 1 from public.departamento_membros m where m.departamento_id = d.id and m.user_id = auth.uid()
                        and m.ativo and (m.valido_ate is null or m.valido_ate >= current_date)))
  )
$$;

create or replace function public.is_responsavel_departamento(p_dep uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_dep is not null and exists (
    select 1 from public.departamentos d
     where d.id = p_dep and d.empresa_id = public.empresa_atual()
       and (d.responsavel_id = auth.uid()
            or exists (select 1 from public.departamento_membros m where m.departamento_id = d.id and m.user_id = auth.uid()
                        and m.funcao = 'responsavel' and m.ativo and (m.valido_ate is null or m.valido_ate >= current_date)))
  )
$$;

-- ---------------------------------------------------------------------
-- Gestão de usuários e acessos: RH (usuarios.manage) convida/ativa/desativa; papéis de gestão e
-- todos os níveis/funcionalidades só o administrador master.
-- ---------------------------------------------------------------------
alter policy membros_insert on public.empresa_membros
  with check (empresa_id = public.empresa_atual() and (public.is_admin_master() or public.tem_permissao('usuarios.manage')));
alter policy membros_update on public.empresa_membros
  using (empresa_id = public.empresa_atual() and (public.is_admin_master() or public.tem_permissao('usuarios.manage')))
  with check (empresa_id = public.empresa_atual() and (public.is_admin_master() or public.tem_permissao('usuarios.manage')));

create or replace function public.protect_empresa_membros()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limite int;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then raise exception 'Vínculos não são excluídos: desative o acesso.' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' or (new.ativo and not old.ativo) then
    select nullif(e.limites->>'max_usuarios', '')::int into v_limite from public.empresas e where e.id = new.empresa_id;
    if v_limite is not null and (select count(*) from public.empresa_membros m where m.empresa_id = new.empresa_id and m.ativo and m.user_id <> new.user_id) >= v_limite then
      raise exception 'Limite de usuários do plano atingido (%).', v_limite using errcode = '42501';
    end if;
  end if;
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if (new.admin_master or new.role in ('admin', 'gestor')) and not public.is_admin_master() then
      raise exception 'Somente o administrador master concede perfis de gestão' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.empresa_id <> old.empresa_id or new.user_id <> old.user_id then
    raise exception 'Vínculo não pode mudar de empresa ou de usuário' using errcode = '42501';
  end if;
  if (new.role, new.ativo, new.admin_master) is not distinct from (old.role, old.ativo, old.admin_master) then
    return new;
  end if;
  if old.user_id = auth.uid() then
    raise exception 'Você não pode alterar o seu próprio acesso' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = old.user_id and p.is_master) then
    raise exception 'O administrador master da plataforma não pode ser alterado por outros usuários' using errcode = '42501';
  end if;
  if not public.is_admin_master() and (
       new.admin_master is distinct from old.admin_master or new.role is distinct from old.role and (new.role in ('admin', 'gestor') or old.role in ('admin', 'gestor'))
       or old.admin_master or old.role in ('admin', 'gestor')) then
    raise exception 'Somente o administrador master altera perfis de gestão' using errcode = '42501';
  end if;
  if old.admin_master and old.ativo and (not new.admin_master or not new.ativo) and not exists (
    select 1 from public.empresa_membros m where m.empresa_id = old.empresa_id and m.user_id <> old.user_id and m.ativo and m.admin_master) then
    raise exception 'A empresa precisa de pelo menos um administrador master ativo' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- RLS das novas tabelas
-- ---------------------------------------------------------------------
alter table public.funcionalidades enable row level security;
alter table public.funcionalidades_padrao enable row level security;
alter table public.departamento_niveis enable row level security;
alter table public.nivel_funcionalidades enable row level security;
alter table public.usuario_permissoes_extra enable row level security;

create policy funcionalidades_select on public.funcionalidades for select to authenticated using (true);
create policy funcionalidades_padrao_select on public.funcionalidades_padrao for select to authenticated using (true);

create policy niveis_select on public.departamento_niveis for select to authenticated using (public.is_active_user());
create policy niveis_write on public.departamento_niveis for all to authenticated using (public.is_admin_master()) with check (public.is_admin_master());
create policy nivel_func_select on public.nivel_funcionalidades for select to authenticated using (public.is_active_user());
create policy nivel_func_write on public.nivel_funcionalidades for all to authenticated using (public.is_admin_master()) with check (public.is_admin_master());
create policy extras_select on public.usuario_permissoes_extra for select to authenticated
  using (user_id = auth.uid() or public.is_admin_master() or public.tem_permissao('rh.funcionarios.ver'));
create policy extras_write on public.usuario_permissoes_extra for all to authenticated
  using (public.is_admin_master() and user_id <> auth.uid()) with check (public.is_admin_master() and user_id <> auth.uid());
do $$
declare t text;
begin
  foreach t in array array['departamento_niveis', 'nivel_funcionalidades', 'usuario_permissoes_extra'] loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()))', t || '_empresa', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
create trigger trg_audit_empresa_membros after insert or update or delete on public.empresa_membros for each row execute function public.audit_trigger();
create trigger trg_audit_empresas after insert or update or delete on public.empresas for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- Funcionalidade exigida no banco (camada restritiva sobre as regras de escopo existentes)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    -- tabela, select, insert, update, delete (null = sem exigência adicional)
    ('clientes', 'clientes.view', 'clientes.write', 'clientes.write', 'clientes.delete'),
    ('interacoes', 'clientes.view', 'clientes.write', null, null),
    ('processos', 'processos.view', 'processos.write', 'processos.write', 'processos.delete'),
    ('processo_partes', 'processos.view', 'processos.write', 'processos.write', 'processos.write'),
    ('processo_andamentos', 'processos.view', 'processos.write', 'processos.write', 'processos.write'),
    ('audiencias', 'processos.view', 'processos.write', 'processos.write', 'processos.write'),
    ('oportunidades', 'comercial.view', 'negocios.write', 'negocios.write', 'negocios.delete'),
    ('consorcio_cotas', 'comercial.view', 'negocios.write', 'negocios.write', 'negocios.delete'),
    ('consorcio_lances', 'comercial.view', 'negocios.write', 'negocios.write', 'negocios.delete'),
    ('seguro_apolices', 'comercial.view', 'negocios.write', 'negocios.write', 'negocios.delete'),
    ('seguro_sinistros', 'comercial.view', 'negocios.write', 'negocios.write', 'negocios.delete'),
    ('comissoes', 'comissoes.view', 'comissoes.manage', 'comissoes.manage', 'comissoes.manage'),
    ('metas', null, 'metas.manage', 'metas.manage', 'metas.manage'),
    ('contratos_honorarios', 'contratos.view', 'contratos.write', 'contratos.write', 'contratos.write'),
    ('publicacoes', 'publicacoes.view', 'publicacoes.view', 'publicacoes.view', 'publicacoes.view'),
    ('atendimentos', 'atendimentos.view', 'atendimentos.view', 'atendimentos.view', 'atendimentos.view'),
    ('modelos_documentos', 'modelos.view', 'modelos.write', 'modelos.write', 'modelos.write'),
    ('visitas', null, 'visitas.checkin', 'visitas.checkin', null),
    ('departamentos', null, 'departamentos.manage', 'departamentos.manage', 'departamentos.manage')
  ) as v(tabela, s, i, u, d) loop
    if r.s is not null then execute format('create policy %I on public.%I as restrictive for select to authenticated using ((select public.tem_permissao(%L)))', r.tabela || '_perm_select', r.tabela, r.s); end if;
    if r.i is not null then execute format('create policy %I on public.%I as restrictive for insert to authenticated with check ((select public.tem_permissao(%L)))', r.tabela || '_perm_insert', r.tabela, r.i); end if;
    if r.u is not null then execute format('create policy %I on public.%I as restrictive for update to authenticated using ((select public.tem_permissao(%L)))', r.tabela || '_perm_update', r.tabela, r.u); end if;
    if r.d is not null then execute format('create policy %I on public.%I as restrictive for delete to authenticated using ((select public.tem_permissao(%L)))', r.tabela || '_perm_delete', r.tabela, r.d); end if;
  end loop;
end $$;
-- financeiro do escritório e lançamentos dos processos: financeiro OU custas/honorários do processo
create policy fin_perm on public.financeiro_lancamentos as restrictive for all to authenticated
  using ((select public.tem_permissao('financeiro.view')) or (select public.tem_permissao('processos.financeiro')) or (select public.tem_permissao('processos.write')))
  with check ((select public.tem_permissao('financeiro.view')) or (select public.tem_permissao('processos.financeiro')) or (select public.tem_permissao('processos.write')));
create policy processo_lancamentos_perm on public.processo_lancamentos as restrictive for all to authenticated
  using ((select public.tem_permissao('processos.view')) or (select public.tem_permissao('processos.financeiro')))
  with check ((select public.tem_permissao('processos.write')) or (select public.tem_permissao('processos.financeiro')));
create policy horas_perm on public.horas_lancamentos as restrictive for all to authenticated
  using ((select public.tem_permissao('horas.lancar')) or (select public.tem_permissao('horas.gerir')))
  with check ((select public.tem_permissao('horas.lancar')) or (select public.tem_permissao('horas.gerir')));

-- Contexto da sessão com permissões e áreas
create or replace function public.contexto_sessao()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual();
begin
  if auth.uid() is null then return null; end if;
  return jsonb_build_object(
    'empresa', (select jsonb_build_object('id', e.id, 'nome', e.nome, 'slug', e.slug, 'marca', e.marca, 'fuso', e.fuso, 'modulos', e.modulos, 'status', e.status)
                  from public.empresas e where e.id = v_emp),
    'membro', (select jsonb_build_object('role', m.role, 'ativo', m.ativo, 'admin_master', m.admin_master)
                 from public.empresa_membros m where m.empresa_id = v_emp and m.user_id = auth.uid()),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome, 'slug', e.slug, 'status', e.status) order by e.nome)
                            from public.empresa_membros m join public.empresas e on e.id = m.empresa_id
                           where m.user_id = auth.uid() and m.ativo and e.status in ('trial', 'ativa')), '[]'::jsonb),
    'plataforma_admin', public.is_plataforma_admin(),
    'permissoes', to_jsonb(case when v_emp is null then '{}'::text[] else public.minhas_permissoes() end),
    'areas', to_jsonb(case when v_emp is null then '{}'::text[] else public.minhas_areas() end)
  );
end $$;

revoke execute on function public.tem_permissao(text), public.minhas_permissoes(), public.minhas_areas(),
  public.permissoes_do_usuario(uuid), public.copiar_acessos(uuid, uuid) from public, anon;
grant execute on function public.tem_permissao(text), public.minhas_permissoes(), public.minhas_areas(),
  public.permissoes_do_usuario(uuid), public.copiar_acessos(uuid, uuid) to authenticated;
revoke all on public.funcionalidades, public.funcionalidades_padrao, public.departamento_niveis, public.nivel_funcionalidades,
  public.usuario_permissoes_extra from anon;
