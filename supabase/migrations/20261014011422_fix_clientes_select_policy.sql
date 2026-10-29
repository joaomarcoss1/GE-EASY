-- A política de SELECT de clientes usava can_access_cliente(id), que consulta a própria
-- tabela com o snapshot do início do comando: em INSERT ... RETURNING a linha recém-criada
-- ainda não é visível e o Postgres rejeitava a inserção. A regra passa a usar as colunas
-- da própria linha (mesma semântica).
alter policy clientes_select on public.clientes
  using (public.is_backoffice() or (public.is_active_user() and (consultor_id = auth.uid() or created_by = auth.uid())));
