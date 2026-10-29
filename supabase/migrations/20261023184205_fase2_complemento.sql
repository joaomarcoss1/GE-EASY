-- =====================================================================
-- GE EASY — Fase 2 (complemento): o que faltava de acessos e auditoria + ajustes da revisão
--
-- * catálogo de funcionalidades completo (módulos das fases 4 a 10) com padrões por nível;
-- * escopo "equipe": supervisor enxerga a carteira dos consultores da sua equipe;
-- * dispositivos do app (revogação remota) e desligamento de funcionário (encerra sessões, revoga
--   dispositivos, transfere carteira/tarefas/negócios e mantém o histórico);
-- * "ver como este usuário" (contexto efetivo de outro usuário, auditado);
-- * falhas de login e acesso de IP novo na auditoria, com alertas;
-- * desempenho: políticas permissivas "FOR ALL" divididas por comando e índices de FKs usadas em filtros.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Catálogo de funcionalidades (fases 4 a 10)
-- ---------------------------------------------------------------------
insert into public.funcionalidades (chave, nome, area, sensivel, ordem) values
  ('rotas.ver', 'Ver rotas da equipe', 'administrativo', false, 90),
  ('rotas.definir', 'Planejar rotas e paradas', 'administrativo', false, 91),
  ('rotas.executar', 'Executar rota e fazer check-in', 'consultor', false, 92),
  ('rotas.aprovar', 'Aprovar rotas concluídas e revisar check-ins', 'administrativo', false, 93),
  ('despesas.lancar', 'Lançar despesas de rota', 'consultor', false, 94),
  ('despesas.aprovar', 'Aprovar despesas e reembolsos', 'administrativo', true, 95),
  ('leads.view', 'Ver leads', null, false, 100),
  ('leads.write', 'Cadastrar e qualificar leads', null, false, 101),
  ('leads.distribuir', 'Distribuir leads e regras de distribuição', 'administrativo', false, 102),
  ('whatsapp.atender', 'Atender conversas de WhatsApp', null, false, 110),
  ('whatsapp.supervisionar', 'Supervisionar filas de WhatsApp', 'administrativo', true, 111),
  ('whatsapp.campanhas', 'Campanhas e modelos de WhatsApp', 'administrativo', true, 112),
  ('whatsapp.configurar', 'Conectar números de WhatsApp', null, true, 113),
  ('ponto.registrar', 'Registrar o próprio ponto', null, false, 120),
  ('ponto.gerir', 'Gerir ponto, jornadas e ajustes', 'rh', true, 121),
  ('rh.funcionarios.editar', 'Cadastrar e editar funcionários', 'rh', true, 122),
  ('rh.dados_sensiveis', 'Ver salários, dados bancários e atestados', 'rh', true, 123),
  ('folha.gerir', 'Pré-folha (consolidar, aprovar, exportar)', 'rh', true, 124),
  ('financeiro.pagar', 'Baixar pagamentos e aprovar por alçada', 'financeiro', true, 130),
  ('financeiro.conciliar', 'Conciliação bancária e recorrências', 'financeiro', true, 131),
  ('dispositivos.gerir', 'Gerir e revogar dispositivos do app', null, true, 140),
  ('empresa.exportar', 'Exportar todos os dados da empresa', null, true, 141)
on conflict (chave) do nothing;

insert into public.funcionalidades_padrao (tipo, nivel, ordem, funcionalidade)
select v.tipo::public.departamento_tipo, v.nivel, v.ordem, f
  from (values
    ('consultor', 'Operador', 1, array['rotas.executar','despesas.lancar','leads.view','leads.write','whatsapp.atender','ponto.registrar']),
    ('consultor', 'Supervisor', 2, array['rotas.executar','despesas.lancar','leads.view','leads.write','whatsapp.atender','ponto.registrar','rotas.ver','leads.distribuir']),
    ('consultor', 'Gestor', 3, array['rotas.executar','despesas.lancar','leads.view','leads.write','whatsapp.atender','ponto.registrar','rotas.ver','leads.distribuir','rotas.aprovar','despesas.aprovar','whatsapp.supervisionar']),
    ('administrativo', 'Operador', 1, array['rotas.ver','leads.view','leads.write','whatsapp.atender','ponto.registrar']),
    ('administrativo', 'Supervisor', 2, array['rotas.ver','leads.view','leads.write','whatsapp.atender','ponto.registrar','rotas.definir','despesas.aprovar','leads.distribuir']),
    ('administrativo', 'Gestor', 3, array['rotas.ver','leads.view','leads.write','whatsapp.atender','ponto.registrar','rotas.definir','despesas.aprovar','leads.distribuir','rotas.aprovar','whatsapp.supervisionar','whatsapp.campanhas']),
    ('juridico', 'Operador', 1, array['whatsapp.atender','ponto.registrar']),
    ('juridico', 'Supervisor', 2, array['whatsapp.atender','ponto.registrar']),
    ('juridico', 'Gestor', 3, array['whatsapp.atender','ponto.registrar']),
    ('rh', 'Operador', 1, array['ponto.registrar']),
    ('rh', 'Supervisor', 2, array['ponto.registrar','ponto.gerir','rh.funcionarios.editar']),
    ('rh', 'Gestor', 3, array['ponto.registrar','ponto.gerir','rh.funcionarios.editar','rh.dados_sensiveis','folha.gerir','dispositivos.gerir']),
    ('financeiro', 'Operador', 1, array['ponto.registrar']),
    ('financeiro', 'Supervisor', 2, array['ponto.registrar','financeiro.pagar','financeiro.conciliar']),
    ('financeiro', 'Gestor', 3, array['ponto.registrar','financeiro.pagar','financeiro.conciliar']),
    ('personalizado', 'Operador', 1, array['ponto.registrar']),
    ('personalizado', 'Supervisor', 2, array['ponto.registrar']),
    ('personalizado', 'Gestor', 3, array['ponto.registrar'])
  ) as v(tipo, nivel, ordem, fs), unnest(v.fs) as f
on conflict do nothing;

-- empresas existentes: os níveis com o nome padrão recebem as novas funcionalidades do seu tipo
insert into public.nivel_funcionalidades (empresa_id, nivel_id, funcionalidade)
select n.empresa_id, n.id, fp.funcionalidade
  from public.departamento_niveis n
  join public.departamentos d on d.id = n.departamento_id
  join public.funcionalidades_padrao fp on fp.tipo = d.tipo and fp.nivel = n.nome
  join public.funcionalidades f on f.chave = fp.funcionalidade and f.ordem >= 90
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2) Equipes (escopo "equipe": supervisor → consultores)
-- ---------------------------------------------------------------------
create table public.equipe_membros (
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  membro_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (empresa_id, supervisor_id, membro_id),
  check (supervisor_id <> membro_id)
);
create index on public.equipe_membros (empresa_id, membro_id);
create trigger zz_empresa_vinculos before insert or update on public.equipe_membros
  for each row execute function public.empresa_vinculos('supervisor_id:@', 'membro_id:@');
create trigger trg_audit_equipe_membros after insert or update or delete on public.equipe_membros for each row execute function public.audit_trigger();

alter table public.equipe_membros enable row level security;
create policy equipe_select on public.equipe_membros for select to authenticated using ((select public.is_active_user()));
create policy equipe_insert on public.equipe_membros for insert to authenticated
  with check ((select public.is_admin_master()) or (select public.tem_permissao('departamentos.manage')));
create policy equipe_delete on public.equipe_membros for delete to authenticated
  using ((select public.is_admin_master()) or (select public.tem_permissao('departamentos.manage')));
create policy equipe_membros_empresa on public.equipe_membros as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
revoke all on public.equipe_membros from anon;

create or replace function public.is_supervisor_de(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.equipe_membros e
     where e.empresa_id = public.empresa_atual() and e.supervisor_id = auth.uid() and e.membro_id = p_user)
$$;
revoke execute on function public.is_supervisor_de(uuid) from public, anon;
grant execute on function public.is_supervisor_de(uuid) to authenticated;

create or replace function public.can_access_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes c
     where c.id = p_cliente and c.empresa_id = public.empresa_atual() and c.excluido_em is null
       and (public.is_backoffice() or public.is_juridico() or public.tem_permissao('clientes.ver_todos')
            or c.responsavel_admin_id = auth.uid()
            or (c.carteira = 'consultor' and (c.consultor_id = auth.uid() or public.is_supervisor_de(c.consultor_id))))
  )
$$;

-- leitura da carteira da equipe (somente leitura: edição continua com o dono ou a gestão)
create policy clientes_equipe on public.clientes for select to authenticated
  using (carteira = 'consultor' and public.is_supervisor_de(consultor_id));
do $$
declare t text;
begin
  foreach t in array array['oportunidades', 'consorcio_cotas', 'seguro_apolices', 'comissoes', 'visitas'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_supervisor_de(consultor_id))', t || '_equipe', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) Dispositivos do app (revogação remota; o app apaga os dados locais ao ser revogado)
-- ---------------------------------------------------------------------
create table public.dispositivos (
  id uuid primary key, -- gerado no aparelho
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  nome text check (char_length(nome) <= 120),
  plataforma text check (char_length(plataforma) <= 120),
  app_versao text check (char_length(app_versao) <= 30),
  fila_pendente int not null default 0 check (fila_pendente >= 0),
  ultimo_sync_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.dispositivos (empresa_id, user_id);
create trigger zz_empresa_vinculos before insert or update on public.dispositivos
  for each row execute function public.empresa_vinculos('user_id:@');
create trigger trg_audit_dispositivos after insert or update or delete on public.dispositivos for each row execute function public.audit_trigger();

-- o próprio usuário registra e atualiza o aparelho; só quem gere dispositivos revoga
create or replace function public.dispositivos_protecao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(current_setting('geeasy.desligamento', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception 'Dispositivo não muda de usuário.' using errcode = '42501'; end if;
    if new.revogado_em is distinct from old.revogado_em then
      if not (public.is_admin_master() or public.tem_permissao('dispositivos.gerir')) then
        raise exception 'Sem permissão para revogar dispositivos.' using errcode = '42501';
      end if;
      new.revogado_por := case when new.revogado_em is null then null else auth.uid() end;
    elsif old.revogado_em is not null then
      raise exception 'Dispositivo revogado.' using errcode = '42501';
    end if;
  elsif new.user_id <> auth.uid() then
    raise exception 'O dispositivo é registrado pelo próprio usuário.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.dispositivos_protecao() from public, anon, authenticated;
create trigger trg_dispositivos_protecao before insert or update on public.dispositivos for each row execute function public.dispositivos_protecao();

alter table public.dispositivos enable row level security;
create policy dispositivos_select on public.dispositivos for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin_master()) or (select public.tem_permissao('dispositivos.gerir')));
create policy dispositivos_insert on public.dispositivos for insert to authenticated with check (user_id = (select auth.uid()));
create policy dispositivos_update on public.dispositivos for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin_master()) or (select public.tem_permissao('dispositivos.gerir')));
create policy dispositivos_empresa on public.dispositivos as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
revoke all on public.dispositivos from anon;

-- ---------------------------------------------------------------------
-- 4) Desligamento: encerra o acesso e transfere o que estava com a pessoa
-- ---------------------------------------------------------------------
create or replace function public.desligar_membro(p_user uuid, p_destino uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cli int := 0; v_tar int := 0; v_neg int := 0; v_disp int := 0; v_sess int := 0;
  v_nome text;
begin
  if not (public.is_admin_master() or public.tem_permissao('usuarios.manage')) then
    raise exception 'Sem permissão para desligar funcionários.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'Você não pode desligar a si mesmo.' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do desligamento.'; end if;
  if not exists (select 1 from public.empresa_membros where empresa_id = v_emp and user_id = p_user) then
    raise exception 'Funcionário não pertence à empresa.' using errcode = '42501';
  end if;
  if p_destino is not null and (p_destino = p_user or not exists (
       select 1 from public.empresa_membros where empresa_id = v_emp and user_id = p_destino and ativo)) then
    raise exception 'Escolha um destinatário ativo da empresa (ou deixe em branco para a base administrativa).';
  end if;
  select full_name into v_nome from public.profiles where id = p_user;
  -- as travas de carteira, nível e dispositivo reconhecem a transferência do desligamento
  perform set_config('geeasy.desligamento', 'on', true);

  -- carteira (histórico com motivo "desligamento"; com novo consultor e documentação pendente, novo prazo)
  perform set_config('geeasy.motivo_carteira', 'desligamento', true);
  perform set_config('geeasy.obs_carteira', left(p_motivo, 1000), true);
  perform set_config('geeasy.rotina_documentacao', 'on', true);
  update public.clientes
     set carteira = case when p_destino is null then 'administrativo' else 'consultor' end::public.cliente_carteira,
         consultor_id = p_destino,
         consultor_original_id = coalesce(consultor_original_id, p_user)
   where empresa_id = v_emp and consultor_id = p_user and excluido_em is null;
  get diagnostics v_cli = row_count;
  perform set_config('geeasy.rotina_documentacao', 'off', true);
  perform set_config('geeasy.motivo_carteira', '', true);
  perform set_config('geeasy.obs_carteira', '', true);

  update public.tarefas set responsavel_id = p_destino
   where empresa_id = v_emp and responsavel_id = p_user and status <> 'concluida';
  get diagnostics v_tar = row_count;
  update public.oportunidades set consultor_id = p_destino
   where empresa_id = v_emp and consultor_id = p_user and etapa not in ('ganho', 'perdido') and excluido_em is null;
  get diagnostics v_neg = row_count;

  perform set_config('geeasy.acesso_padrao', 'on', true);
  update public.departamento_membros set ativo = false where empresa_id = v_emp and user_id = p_user;
  perform set_config('geeasy.acesso_padrao', 'off', true);
  delete from public.equipe_membros where empresa_id = v_emp and (supervisor_id = p_user or membro_id = p_user);
  update public.dispositivos set revogado_em = now() where empresa_id = v_emp and user_id = p_user and revogado_em is null;
  get diagnostics v_disp = row_count;
  update public.empresa_membros set ativo = false where empresa_id = v_emp and user_id = p_user;
  perform set_config('geeasy.desligamento', 'off', true);

  -- sem outra empresa ativa: encerra as sessões (o vínculo inativo já bloqueia os dados nesta empresa)
  if not exists (select 1 from public.empresa_membros where user_id = p_user and ativo and empresa_id <> v_emp) then
    begin
      delete from auth.sessions where user_id = p_user;
      get diagnostics v_sess = row_count;
    exception when others then
      v_sess := -1; -- sem privilégio no schema auth: o servidor encerra pela API administrativa
    end;
  end if;

  if p_destino is not null then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (v_emp, p_destino, 'Carteira transferida para você',
            left(coalesce(v_nome, 'Funcionário') || ' foi desligado(a): ' || v_cli || ' cliente(s), ' || v_tar || ' tarefa(s), ' || v_neg || ' negócio(s).', 300), '/consultor');
  end if;
  insert into public.audit_logs (empresa_id, actor_id, actor_email, acao, tabela, registro_id, dados_novos)
  values (v_emp, auth.uid(), (select email from public.profiles where id = auth.uid()), 'DESLIGAMENTO', 'empresa_membros', p_user::text,
          jsonb_build_object('destino', p_destino, 'motivo', left(p_motivo, 500), 'clientes', v_cli, 'tarefas', v_tar, 'negocios', v_neg,
                             'dispositivos', v_disp, 'sessoes', v_sess));
  return jsonb_build_object('clientes', v_cli, 'tarefas', v_tar, 'negocios', v_neg, 'dispositivos', v_disp, 'sessoes', v_sess);
end $$;
revoke execute on function public.desligar_membro(uuid, uuid, text) from public, anon;

-- Consultores só atribuem a si; transferências de carteira pela gestão, pela rotina ou pelo desligamento
create or replace function public.enforce_own_consultor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_manager() or coalesce(current_setting('geeasy.desligamento', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if tg_table_name = 'clientes' and public.current_app_role() = 'administrativo' then
      if not public.tem_permissao('clientes.transfer') then new.consultor_id := null; end if;
    else
      new.consultor_id := auth.uid();
    end if;
  elsif new.consultor_id is distinct from old.consultor_id
        and not (tg_table_name = 'clientes' and (public.tem_permissao('clientes.transfer') or coalesce(current_setting('geeasy.rotina_documentacao', true), '') = 'on')) then
    raise exception 'Somente a gestão pode transferir a carteira' using errcode = '42501';
  end if;
  -- IF aninhado: NEW.carteira só existe em clientes (o gatilho também roda em oportunidades, cotas e apólices)
  if tg_table_name = 'clientes' and tg_op = 'UPDATE' then
    if new.carteira is distinct from old.carteira
       and not (public.tem_permissao('clientes.transfer') or coalesce(current_setting('geeasy.rotina_documentacao', true), '') = 'on') then
      raise exception 'Somente a gestão pode mudar a carteira do cliente' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
grant execute on function public.desligar_membro(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) "Ver como este usuário": contexto efetivo de outra pessoa (somente leitura, auditado)
-- ---------------------------------------------------------------------
create or replace function public.contexto_de_usuario(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_perms text[];
begin
  if not (public.is_admin_master() or public.tem_permissao('rh.funcionarios.ver')) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  if not exists (select 1 from public.empresa_membros where empresa_id = v_emp and user_id = p_user) then raise exception 'Usuário não pertence à empresa.'; end if;
  select coalesce(array_agg(p order by p), '{}') into v_perms from public.permissoes_de(p_user, v_emp) p;
  return jsonb_build_object(
    'permissoes', to_jsonb(v_perms),
    'areas', to_jsonb(coalesce((select array_agg(distinct f.area::text order by f.area::text)
                                  from public.funcionalidades f join public.empresas e on e.id = v_emp
                                 where f.chave = any(v_perms) and f.area is not null and f.area::text = any(e.modulos)), '{}')),
    'membro', (select jsonb_build_object('role', m.role, 'ativo', m.ativo, 'admin_master', m.admin_master)
                 from public.empresa_membros m where m.empresa_id = v_emp and m.user_id = p_user),
    'departamentos', coalesce((select jsonb_agg(jsonb_build_object('departamento', d.nome, 'nivel', n.nome, 'ativo', dm.ativo, 'valido_ate', dm.valido_ate) order by d.nome)
                                 from public.departamento_membros dm join public.departamentos d on d.id = dm.departamento_id
                                 left join public.departamento_niveis n on n.id = dm.nivel_id
                                where dm.empresa_id = v_emp and dm.user_id = p_user), '[]'::jsonb),
    'equipe', coalesce((select jsonb_agg(e.membro_id) from public.equipe_membros e where e.empresa_id = v_emp and e.supervisor_id = p_user), '[]'::jsonb)
  );
end $$;
revoke execute on function public.contexto_de_usuario(uuid) from public, anon;
grant execute on function public.contexto_de_usuario(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Ações de auditoria novas e falhas de login
-- ---------------------------------------------------------------------
create or replace function public.registrar_acesso(p_acao text, p_tabela text, p_registro text, p_detalhes jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb := public.contexto_requisicao();
begin
  if auth.uid() is null then return; end if;
  if p_acao not in ('LOGIN', 'LOGOUT', 'LOGOUT_GLOBAL', 'DOWNLOAD', 'EXPORTACAO', 'IMPRESSAO', 'VISUALIZACAO_SIGILOSA', 'LGPD_EXPORTACAO',
                    'LGPD_ANONIMIZACAO', 'INTEGRACAO', 'TROCA_EMPRESA', 'TROCA_AREA', 'ACESSO_NEGADO', 'SIMULACAO', 'IMPORTACAO',
                    'EXPORTACAO_EMPRESA', 'SUPORTE', 'DISPOSITIVO_REVOGADO', 'SINCRONIZACAO') then
    raise exception 'ação de auditoria inválida';
  end if;
  if not public._rate_limit('acesso:' || auth.uid(), 600, 3600) then return; end if;
  insert into public.audit_logs (empresa_id, actor_id, actor_email, acao, tabela, registro_id, dados_novos, area, origem, ip, user_agent, request_id)
  values (public.empresa_atual(), auth.uid(), (select email from public.profiles where id = auth.uid()), p_acao, left(p_tabela, 60), left(p_registro, 100),
          case when pg_column_size(p_detalhes) < 4000 then p_detalhes end,
          v_ctx->>'area', v_ctx->>'origem', v_ctx->>'ip', v_ctx->>'user_agent', v_ctx->>'request_id');
end $$;

-- Chamada só pelo servidor (service role) quando o login falha: registra nas empresas da conta, se ela existir
create or replace function public.auditoria_falha_login(p_email text, p_ip text, p_ua text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then return; end if;
  insert into public.audit_logs (empresa_id, actor_id, actor_email, acao, tabela, registro_id, dados_novos, origem, ip, user_agent)
  select m.empresa_id, null, lower(trim(p_email)), 'LOGIN_FALHA', 'auth', v_user::text, null, 'web', left(p_ip, 64), left(p_ua, 300)
    from public.empresa_membros m where m.user_id = v_user and m.ativo;
end $$;
revoke execute on function public.auditoria_falha_login(text, text, text) from public, anon, authenticated;
grant execute on function public.auditoria_falha_login(text, text, text) to service_role;

-- Alertas: + falhas de login (≥ 5 em 15 min) e login de IP não visto nos últimos 90 dias
create or replace function public.auditoria_alertas()
returns int language plpgsql security definer set search_path = '' as $$
declare e record; n int := 0; k int; v_cfg jsonb; v_lim int; v_ini time; v_fim time;
begin
  for e in select id, fuso from public.empresas where status in ('trial', 'ativa') loop
    select valor into v_cfg from public.configuracoes where empresa_id = e.id and chave = 'alertas_auditoria';
    continue when coalesce((v_cfg->>'ativos')::boolean, true) = false;
    v_lim := greatest(3, coalesce((v_cfg->>'exclusoes_limite')::int, 20));
    v_ini := coalesce((v_cfg->>'horario_inicio')::time, '07:00');
    v_fim := coalesce((v_cfg->>'horario_fim')::time, '20:00');

    with eventos as (
      select a.* from public.audit_logs a where a.empresa_id = e.id and a.created_at > now() - interval '15 minutes'
    ), alertas as (
      select 'exclusao:' || x.actor_id || ':' || to_char(now() at time zone e.fuso, 'YYYYMMDDHH24') as chave,
             'Exclusões em massa' as titulo, coalesce(max(x.actor_email), 'Usuário') || ' excluiu ' || count(*) || ' registro(s) em 15 minutos' as msg
        from eventos x where x.actor_id is not null and x.acao in ('DELETE', 'EXCLUSAO') group by x.actor_id having count(*) >= v_lim
      union all
      select 'export:' || x.id, 'Exportação de dados', coalesce(x.actor_email, 'Usuário') || ' exportou ' || x.tabela || coalesce(' (' || (x.dados_novos->>'linhas') || ' linhas)', '')
        from eventos x where x.acao in ('EXPORTACAO', 'LGPD_EXPORTACAO', 'EXPORTACAO_EMPRESA')
      union all
      select 'acesso:' || x.actor_id || ':' || to_char(now() at time zone e.fuso, 'YYYYMMDDHH24'), 'Mudança de permissões',
             coalesce(max(x.actor_email), 'Usuário') || ' alterou ' || count(*) || ' configuração(ões) de acesso'
        from eventos x where x.actor_id is not null
         and x.tabela in ('empresa_membros', 'departamento_membros', 'usuario_permissoes_extra', 'nivel_funcionalidades', 'departamento_niveis', 'equipe_membros')
       group by x.actor_id
      union all
      select 'horario:' || x.actor_id || ':' || to_char(now() at time zone e.fuso, 'YYYYMMDD'), 'Atividade fora do horário',
             coalesce(max(x.actor_email), 'Usuário') || ' registrou atividade fora do horário (' || to_char(v_ini, 'HH24:MI') || '–' || to_char(v_fim, 'HH24:MI') || ')'
        from eventos x where x.actor_id is not null and (x.created_at at time zone e.fuso)::time not between v_ini and v_fim group by x.actor_id
      union all
      select 'falha-login:' || x.registro_id || ':' || to_char(now() at time zone e.fuso, 'YYYYMMDDHH24'), 'Muitas falhas de login',
             count(*) || ' tentativa(s) de login sem sucesso na conta ' || coalesce(max(x.actor_email), '') || ' em 15 minutos'
        from eventos x where x.acao = 'LOGIN_FALHA' group by x.registro_id having count(*) >= 5
      union all
      select 'ip-novo:' || x.id, 'Login de local incomum',
             coalesce(x.actor_email, 'Usuário') || ' entrou de um IP não usado nos últimos 90 dias (' || coalesce(x.ip, x.dados_novos->>'ip', '?') || ')'
        from eventos x
       where x.acao = 'LOGIN' and coalesce(x.ip, x.dados_novos->>'ip') is not null
         and exists (select 1 from public.audit_logs p where p.empresa_id = e.id and p.actor_id = x.actor_id and p.acao = 'LOGIN'
                       and p.created_at between now() - interval '90 days' and x.created_at - interval '1 second')
         and not exists (select 1 from public.audit_logs p where p.empresa_id = e.id and p.actor_id = x.actor_id and p.acao = 'LOGIN'
                       and p.created_at between now() - interval '90 days' and x.created_at - interval '1 second'
                       and coalesce(p.ip, p.dados_novos->>'ip') = coalesce(x.ip, x.dados_novos->>'ip'))
    )
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
    select e.id, m.user_id, al.titulo, left(al.msg, 300), '/auditoria', 'auditoria:' || al.chave
      from alertas al join public.empresa_membros m on m.empresa_id = e.id and m.ativo and m.admin_master
    on conflict (user_id, chave) where chave is not null do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function public.auditoria_alertas() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) Desempenho
-- ---------------------------------------------------------------------
-- Políticas permissivas "FOR ALL" de escrita que repetiam a leitura: uma por comando de escrita
do $$
declare p record; v_cmd text;
begin
  for p in
    select pol.schemaname, pol.tablename, pol.policyname, pol.qual, pol.with_check, pol.roles
      from pg_policies pol
     where pol.schemaname = 'public' and pol.cmd = 'ALL' and pol.permissive = 'PERMISSIVE'
       and exists (select 1 from pg_policies s where s.schemaname = 'public' and s.tablename = pol.tablename
                     and s.cmd = 'SELECT' and s.permissive = 'PERMISSIVE')
  loop
    foreach v_cmd in array array['insert', 'update', 'delete'] loop
      execute format('create policy %I on public.%I for %s to authenticated %s %s',
        left(p.policyname, 55) || '_' || left(v_cmd, 3), p.tablename, v_cmd,
        case when v_cmd = 'insert' then '' else format('using (%s)', p.qual) end,
        case when v_cmd = 'delete' then '' else format('with check (%s)', coalesce(p.with_check, p.qual)) end);
    end loop;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- FKs usadas em filtros e junções frequentes
create index if not exists clientes_responsavel_admin_idx on public.clientes (empresa_id, responsavel_admin_id) where responsavel_admin_id is not null;
create index if not exists clientes_consultor_original_idx on public.clientes (consultor_original_id) where consultor_original_id is not null;
create index if not exists departamento_membros_nivel_idx on public.departamento_membros (nivel_id);
create index if not exists cliente_carteira_historico_cliente_idx on public.cliente_carteira_historico (cliente_id);
create index if not exists cliente_carteira_historico_para_idx on public.cliente_carteira_historico (para_usuario);
create index if not exists documentos_analisado_por_idx on public.documentos (analisado_por);
create index if not exists atendimentos_cliente_idx on public.atendimentos (cliente_id);
create index if not exists visitas_cliente_idx on public.visitas (cliente_id);
create index if not exists comissoes_cliente_idx on public.comissoes (cliente_id);
create index if not exists usuario_permissoes_extra_user_idx on public.usuario_permissoes_extra (user_id);

-- vínculos e permissões mudam => contexto da requisição recalculado (equipes)
create trigger zz_contexto_invalidar after insert or update or delete on public.equipe_membros
  for each statement execute function public.contexto_invalidar();

-- check-in de visitas: distância até o cliente (raio) e justificativa fora do raio
alter table public.visitas
  add column if not exists distancia_m int check (distancia_m is null or distancia_m >= 0),
  add column if not exists fora_do_raio boolean not null default false,
  add column if not exists justificativa text check (char_length(justificativa) <= 500);
