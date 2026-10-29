-- Auditoria da criação de acessos e da senha definida pelo administrador (criação de usuários no sistema)
create or replace function public.registrar_acesso(p_acao text, p_tabela text, p_registro text, p_detalhes jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ctx jsonb := public.contexto_requisicao();
begin
  if auth.uid() is null then return; end if;
  if p_acao not in ('LOGIN', 'LOGOUT', 'LOGOUT_GLOBAL', 'DOWNLOAD', 'EXPORTACAO', 'IMPRESSAO', 'VISUALIZACAO_SIGILOSA', 'LGPD_EXPORTACAO',
                    'LGPD_ANONIMIZACAO', 'INTEGRACAO', 'TROCA_EMPRESA', 'TROCA_AREA', 'ACESSO_NEGADO', 'SIMULACAO', 'IMPORTACAO',
                    'EXPORTACAO_EMPRESA', 'SUPORTE', 'DISPOSITIVO_REVOGADO', 'SINCRONIZACAO', 'USUARIO_CRIADO', 'SENHA_REDEFINIDA') then
    raise exception 'ação de auditoria inválida';
  end if;
  if not public._rate_limit('acesso:' || auth.uid(), 600, 3600) then return; end if;
  insert into public.audit_logs (empresa_id, actor_id, actor_email, acao, tabela, registro_id, dados_novos, area, origem, ip, user_agent, request_id)
  values (public.empresa_atual(), auth.uid(), (select email from public.profiles where id = auth.uid()), p_acao, left(p_tabela, 60), left(p_registro, 100),
          case when pg_column_size(p_detalhes) < 4000 then p_detalhes end,
          v_ctx->>'area', v_ctx->>'origem', v_ctx->>'ip', v_ctx->>'user_agent', v_ctx->>'request_id');
end $$;
