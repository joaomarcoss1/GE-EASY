-- Quem recebeu um processo por ficha (análise, habilitação) lê o cadastro desse cliente.
create policy clientes_select_encaminhado on public.clientes for select to authenticated
  using (exists (select 1 from public.fichas_pendencia f
                  where f.cliente_id = clientes.id and f.status = 'encerrada' and f.encaminhado_para = (select auth.uid())));
