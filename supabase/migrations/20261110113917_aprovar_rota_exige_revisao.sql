-- A rota só é aprovada depois que os check-ins marcados para revisão (fora do raio / inconsistência)
-- forem aceitos ou rejeitados pelo supervisor.
create or replace function public.aprovar_rota(p_rota uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.rotas; v_resumo jsonb; v_pend int;
begin
  if not (public.tem_permissao('rotas.aprovar') or public.is_manager()) then raise exception 'Sem permissão para aprovar rotas.' using errcode = '42501'; end if;
  select * into r from public.rotas where id = p_rota and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Rota não encontrada.'; end if;
  if r.consultor_id = auth.uid() then raise exception 'Você não aprova a sua própria rota.' using errcode = '42501'; end if;
  if r.status <> 'concluida' then raise exception 'Somente rotas concluídas são aprovadas.'; end if;
  select count(*) into v_pend from public.checkins where rota_id = p_rota and revisao = 'pendente';
  if v_pend > 0 then
    raise exception 'Revise antes os % check-in(s) aguardando revisão (aceitar ou rejeitar).', v_pend using errcode = '23514';
  end if;
  v_resumo := public.rota_resumo(p_rota);
  update public.rotas set status = 'aprovada', aprovada_por = auth.uid(), aprovada_em = now(), resumo = v_resumo where id = p_rota;
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
  values (r.empresa_id, r.consultor_id, 'Rota aprovada', left(r.nome, 300), '/rotas/' || r.id);
  return v_resumo;
end $$;
