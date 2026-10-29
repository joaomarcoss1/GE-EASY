-- Quem pode editar um processo também mantém os eventos de agenda ligados a ele
-- (audiências agendadas para colegas), sem precisar do service role.
alter policy eventos_insert on public.agenda_eventos
  with check (public.is_active_user() and (
    ((public.is_manager() or responsavel_id = auth.uid()) and (cliente_id is null or public.can_access_cliente(cliente_id)))
    or (processo_id is not null and public.can_edit_processo(processo_id))));
alter policy eventos_update on public.agenda_eventos
  using (public.is_manager() or (public.is_active_user() and (responsavel_id = auth.uid() or created_by = auth.uid()))
         or (processo_id is not null and public.can_edit_processo(processo_id)))
  with check (public.is_manager() or responsavel_id = auth.uid() or created_by = auth.uid()
         or (processo_id is not null and public.can_edit_processo(processo_id)));
alter policy eventos_delete on public.agenda_eventos
  using (public.is_manager() or created_by = auth.uid() or responsavel_id = auth.uid()
         or (processo_id is not null and public.can_edit_processo(processo_id)));
alter policy eventos_select on public.agenda_eventos
  using (public.is_manager() or (public.is_active_user() and (responsavel_id = auth.uid() or created_by = auth.uid() or auth.uid() = any(participantes)))
         or (processo_id is not null and public.can_access_processo(processo_id)));
