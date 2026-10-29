-- =====================================================================
-- GE EASY — Otimização: índices por empresa, políticas permissivas unificadas e situação do 2FA da equipe
--
-- * empresa_id sem índice: a política restritiva filtra toda consulta por empresa_id;
-- * duas políticas permissivas na mesma ação são avaliadas linha a linha: viram uma só (a OR b), mesmo efeito;
-- * seguranca_2fa_equipe(): 2FA e último acesso só dos membros da empresa ativa (antes: listUsers da plataforma toda).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Índices por empresa
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cercas', 'contas_bancarias', 'financeiro_recorrencias', 'folha_itens', 'funcionario_dependentes',
    'jornadas', 'lead_formularios', 'meta_pagina_tokens', 'meta_paginas', 'ponto_espelhos', 'wa_campanha_envios',
    'wa_campanhas', 'wa_credenciais', 'wa_ids', 'wa_numeros', 'webhook_eventos']
  loop
    execute format('create index if not exists %I on public.%I (empresa_id)', t || '_empresa_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Políticas permissivas unificadas (mesma regra de antes)
-- ---------------------------------------------------------------------
drop policy centros_custo_select on public.centros_custo;
drop policy centros_custo_select_juridico on public.centros_custo;
create policy centros_custo_select on public.centros_custo for select to authenticated
  using ((select public.tem_permissao('financeiro.view')) or (select public.tem_permissao('processos.write')));

drop policy clientes_equipe on public.clientes;
drop policy clientes_select on public.clientes;
create policy clientes_select on public.clientes for select to authenticated
  using ((select public.is_backoffice()) or (select public.is_juridico()) or (select public.tem_permissao('clientes.ver_todos'))
    or responsavel_admin_id = (select auth.uid())
    or (carteira = 'consultor' and (consultor_id = (select auth.uid()) or public.is_supervisor_de(consultor_id))));

drop policy comissoes_equipe on public.comissoes;
drop policy comissoes_select on public.comissoes;
create policy comissoes_select on public.comissoes for select to authenticated
  using ((select public.is_backoffice()) or ((select public.is_active_user()) and consultor_id = (select auth.uid()))
    or public.is_supervisor_de(consultor_id));

drop policy consorcio_cotas_equipe on public.consorcio_cotas;
drop policy consorcio_cotas_select on public.consorcio_cotas;
create policy consorcio_cotas_select on public.consorcio_cotas for select to authenticated
  using ((select public.is_backoffice()) or ((select public.is_active_user()) and (consultor_id = (select auth.uid()) or created_by = (select auth.uid())))
    or public.is_supervisor_de(consultor_id));

drop policy oportunidades_equipe on public.oportunidades;
drop policy oportunidades_select on public.oportunidades;
create policy oportunidades_select on public.oportunidades for select to authenticated
  using ((select public.is_backoffice()) or ((select public.is_active_user()) and (consultor_id = (select auth.uid()) or created_by = (select auth.uid())))
    or public.is_supervisor_de(consultor_id));

drop policy seguro_apolices_equipe on public.seguro_apolices;
drop policy seguro_apolices_select on public.seguro_apolices;
create policy seguro_apolices_select on public.seguro_apolices for select to authenticated
  using ((select public.is_backoffice()) or ((select public.is_active_user()) and (consultor_id = (select auth.uid()) or created_by = (select auth.uid())))
    or public.is_supervisor_de(consultor_id));

drop policy visitas_equipe on public.visitas;
drop policy visitas_select on public.visitas;
create policy visitas_select on public.visitas for select to authenticated
  using ((select public.is_manager()) or consultor_id = (select auth.uid()) or public.is_supervisor_de(consultor_id));

drop policy config_modulo_ins on public.configuracoes;
drop policy config_write_ins on public.configuracoes;
create policy config_write_ins on public.configuracoes for insert to authenticated
  with check ((select public.is_admin()) or public.pode_configurar(chave));
drop policy config_modulo_upd on public.configuracoes;
drop policy config_write_upd on public.configuracoes;
create policy config_write_upd on public.configuracoes for update to authenticated
  using ((select public.is_admin()) or public.pode_configurar(chave))
  with check ((select public.is_admin()) or public.pode_configurar(chave));

-- planos: a leitura do admin da plataforma (inclusive inativos) passa para planos_select; planos_admin fica só na escrita
drop policy planos_admin on public.planos;
drop policy planos_select on public.planos;
create policy planos_select on public.planos for select to anon, authenticated
  using ((ativo and publico) or (select public.is_plataforma_admin()));
create policy planos_admin_ins on public.planos for insert to authenticated with check ((select public.is_plataforma_admin()));
create policy planos_admin_upd on public.planos for update to authenticated
  using ((select public.is_plataforma_admin())) with check ((select public.is_plataforma_admin()));
create policy planos_admin_del on public.planos for delete to authenticated using ((select public.is_plataforma_admin()));

drop policy profiles_update_admin on public.profiles;
drop policy profiles_update_self on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or ((select public.is_admin()) and public.is_membro_empresa(id)))
  with check (id = (select auth.uid()) or ((select public.is_admin()) and public.is_membro_empresa(id)));

-- ---------------------------------------------------------------------
-- Situação do 2FA da equipe (painel de segurança do administrador)
-- ---------------------------------------------------------------------
create or replace function public.seguranca_2fa_equipe()
returns table (user_id uuid, dois_fatores boolean, ultimo_acesso timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id,
         exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'),
         u.last_sign_in_at
  from public.empresa_membros m
  join auth.users u on u.id = m.user_id
  where m.empresa_id = public.empresa_atual() and public.is_admin();
$$;
revoke execute on function public.seguranca_2fa_equipe() from public, anon;
grant execute on function public.seguranca_2fa_equipe() to authenticated;
