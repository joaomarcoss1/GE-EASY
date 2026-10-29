-- ---------------------------------------------------------------------
-- Portabilidade e exclusão agendada (LGPD)
-- ---------------------------------------------------------------------
create or replace function public.agendar_exclusao_empresa(p_confirmacao text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_slug text; v_quando timestamptz := now() + interval '30 days';
begin
  if not public.is_admin_master() then raise exception 'Somente o administrador master.' using errcode = '42501'; end if;
  select slug into v_slug from public.empresas where id = v_emp;
  if lower(trim(coalesce(p_confirmacao, ''))) <> v_slug then raise exception 'Digite o endereço da empresa (%) para confirmar.', v_slug; end if;
  perform set_config('geeasy.exclusao', 'on', true);
  update public.empresas set exclusao_agendada_para = v_quando, exclusao_solicitada_por = auth.uid() where id = v_emp;
  perform set_config('geeasy.exclusao', 'off', true);
  perform public.registrar_acesso('EXPORTACAO_EMPRESA', 'empresas', v_emp::text, jsonb_build_object('acao', 'exclusao_agendada', 'para', v_quando));
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
  select v_emp, m.user_id, 'Exclusão dos dados agendada', 'Os dados da empresa serão anonimizados em ' || to_char(v_quando at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '. Exporte antes, se precisar.', '/configuracoes?tab=dados'
    from public.empresa_membros m where m.empresa_id = v_emp and m.ativo and m.admin_master;
  return v_quando;
end $$;

create or replace function public.cancelar_exclusao_empresa()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin_master() then raise exception 'Somente o administrador master.' using errcode = '42501'; end if;
  perform set_config('geeasy.exclusao', 'on', true);
  update public.empresas set exclusao_agendada_para = null, exclusao_solicitada_por = null where id = public.empresa_atual() and anonimizada_em is null;
  perform set_config('geeasy.exclusao', 'off', true);
end $$;
revoke execute on function public.agendar_exclusao_empresa(text), public.cancelar_exclusao_empresa() from public, anon;
grant execute on function public.agendar_exclusao_empresa(text), public.cancelar_exclusao_empresa() to authenticated;

/**
 * Executa a exclusão vencida: anonimiza dados pessoais (clientes, leads, funcionários), apaga conversas de
 * WhatsApp, dados sensíveis e dependentes, desativa os acessos e encerra a empresa. Os arquivos do Storage
 * são removidos pelo servidor antes de chamar esta função. A trilha de auditoria é mantida (obrigação legal).
 */
create or replace function public.anonimizar_empresa(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.empresas; n_cli int; n_lead int; n_func int;
begin
  select * into e from public.empresas where id = p_empresa for update;
  if not found or e.exclusao_agendada_para is null or e.exclusao_agendada_para > now() or e.anonimizada_em is not null then raise exception 'Exclusão não agendada ou ainda no prazo.'; end if;
  perform set_config('geeasy.rotina_documentacao', 'on', true);
  update public.clientes set nome = 'Titular removido', documento = null, rg = null, data_nascimento = null, email = null, telefone = null, whatsapp = null,
         cep = null, endereco = null, numero = null, complemento = null, bairro = null, profissao = null, renda_mensal = null, observacoes = null
   where empresa_id = p_empresa;
  get diagnostics n_cli = row_count;
  update public.leads set nome = 'Titular removido', telefone = null, email = null, documento = null, observacoes = null, dados = null, utm = null where empresa_id = p_empresa;
  get diagnostics n_lead = row_count;
  delete from public.wa_campanha_envios where empresa_id = p_empresa;
  delete from public.wa_mensagens where empresa_id = p_empresa;
  delete from public.wa_ids where empresa_id = p_empresa;
  delete from public.wa_conversas where empresa_id = p_empresa;
  delete from public.wa_contatos where empresa_id = p_empresa;
  delete from public.wa_credenciais where empresa_id = p_empresa;
  delete from public.meta_pagina_tokens where empresa_id = p_empresa;
  delete from public.funcionario_dependentes where empresa_id = p_empresa;
  delete from public.funcionario_sensiveis where empresa_id = p_empresa;
  update public.funcionarios set nome = 'Funcionário removido', email = null, telefone = null, observacoes = null where empresa_id = p_empresa;
  get diagnostics n_func = row_count;
  delete from public.push_assinaturas where empresa_id = p_empresa;
  update public.empresa_membros set ativo = false where empresa_id = p_empresa and ativo;
  perform set_config('geeasy.exclusao', 'on', true);
  update public.empresas set status = 'cancelada', anonimizada_em = now(), dominio = null where id = p_empresa;
  update public.assinaturas set status = 'cancelada', atualizado_em = now() where empresa_id = p_empresa;
  return jsonb_build_object('clientes', n_cli, 'leads', n_lead, 'funcionarios', n_func);
end $$;
revoke execute on function public.anonimizar_empresa(uuid) from public, anon, authenticated;
grant execute on function public.anonimizar_empresa(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Acesso de suporte temporário
-- ---------------------------------------------------------------------
alter table public.empresa_membros add column if not exists suporte_ate timestamptz;

create table public.acessos_suporte (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  suporte_user_id uuid not null references public.profiles(id) on delete cascade,
  motivo text not null check (char_length(motivo) between 5 and 1000),
  status text not null default 'pendente' check (status in ('pendente', 'ativo', 'recusado', 'expirado', 'revogado')),
  solicitado_em timestamptz not null default now(),
  autorizado_por uuid references public.profiles(id) on delete set null,
  autorizado_em timestamptz,
  expira_em timestamptz,
  encerrado_em timestamptz
);
create index on public.acessos_suporte (empresa_id, status);
alter table public.acessos_suporte enable row level security;
revoke all on public.acessos_suporte from anon;
create policy suporte_select on public.acessos_suporte for select to authenticated
  using ((select public.is_plataforma_admin()) or (empresa_id = (select public.empresa_atual()) and (select public.is_admin_master())));
create trigger trg_audit_acessos_suporte after insert or update or delete on public.acessos_suporte for each row execute function public.audit_trigger();

create or replace function public.solicitar_suporte(p_empresa uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_plataforma_admin() then raise exception 'Somente a equipe da plataforma.' using errcode = '42501'; end if;
  insert into public.acessos_suporte (empresa_id, suporte_user_id, motivo) values (p_empresa, auth.uid(), left(p_motivo, 1000)) returning id into v_id;
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
  select p_empresa, m.user_id, 'Pedido de acesso do suporte', left(p_motivo, 300), '/configuracoes?tab=dados'
    from public.empresa_membros m where m.empresa_id = p_empresa and m.ativo and m.admin_master;
  return v_id;
end $$;

create or replace function public.decidir_suporte(p_id uuid, p_autorizar boolean, p_horas int default 24)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.acessos_suporte; v_ate timestamptz := now() + make_interval(hours => greatest(1, least(coalesce(p_horas, 24), 72)));
begin
  if not public.is_admin_master() then raise exception 'Somente o administrador master autoriza o suporte.' using errcode = '42501'; end if;
  select * into s from public.acessos_suporte where id = p_id and empresa_id = public.empresa_atual() for update;
  if not found or s.status <> 'pendente' then raise exception 'Pedido não encontrado ou já decidido.'; end if;
  if not p_autorizar then
    update public.acessos_suporte set status = 'recusado', autorizado_por = auth.uid(), autorizado_em = now(), encerrado_em = now() where id = p_id;
    return;
  end if;
  update public.acessos_suporte set status = 'ativo', autorizado_por = auth.uid(), autorizado_em = now(), expira_em = v_ate where id = p_id;
  perform set_config('geeasy.suporte', 'on', true);
  insert into public.empresa_membros (empresa_id, user_id, role, ativo, admin_master, suporte_ate, convidado_por)
  values (s.empresa_id, s.suporte_user_id, 'gestor', true, false, v_ate, auth.uid())
  on conflict (empresa_id, user_id) do update set ativo = true, suporte_ate = excluded.suporte_ate, role = case when public.empresa_membros.suporte_ate is not null then 'gestor' else public.empresa_membros.role end;
  perform set_config('geeasy.suporte', 'off', true);
  perform public.registrar_acesso('SUPORTE', 'acessos_suporte', p_id::text, jsonb_build_object('ate', v_ate, 'suporte', s.suporte_user_id));
end $$;

create or replace function public.encerrar_suporte(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.acessos_suporte;
begin
  select * into s from public.acessos_suporte where id = p_id for update;
  if not found or s.status <> 'ativo' then raise exception 'Acesso não está ativo.'; end if;
  if not (public.is_plataforma_admin() or (s.empresa_id = public.empresa_atual() and public.is_admin_master())) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.acessos_suporte set status = 'revogado', encerrado_em = now() where id = p_id;
  perform set_config('geeasy.suporte', 'on', true);
  update public.empresa_membros set ativo = false where empresa_id = s.empresa_id and user_id = s.suporte_user_id and suporte_ate is not null;
  perform set_config('geeasy.suporte', 'off', true);
end $$;

