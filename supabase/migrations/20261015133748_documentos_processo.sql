-- Documentos ligados a processos: caminho "processos/<id>/..." no Storage e regras de acesso.

create or replace function public.storage_can_access(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/'); v_id uuid;
begin
  if not public.is_active_user() then return false; end if;
  if v_parts[1] = 'clientes' and array_length(v_parts, 1) >= 3 then
    begin v_id := v_parts[2]::uuid; exception when others then return false; end;
    return public.can_access_cliente(v_id);
  elsif v_parts[1] = 'processos' and array_length(v_parts, 1) >= 3 then
    begin v_id := v_parts[2]::uuid; exception when others then return false; end;
    return public.can_access_processo(v_id);
  elsif v_parts[1] = 'geral' then
    return public.is_backoffice();
  end if;
  return false;
end $$;

-- Inserção: em processo, exige poder editar o processo; sem processo, regra anterior (cliente da carteira)
alter policy documentos_insert on public.documentos
  with check (
    public.is_active_user() and enviado_por = auth.uid() and (
      (processo_id is not null and public.can_edit_processo(processo_id))
      or (processo_id is null and ((cliente_id is null and public.is_backoffice()) or public.can_access_cliente(cliente_id)))
    )
  );

-- Upload no Storage em pasta de processo: só quem edita o processo
alter policy documentos_storage_insert on storage.objects
  with check (
    bucket_id = 'documentos' and public.storage_can_access(name)
    and (split_part(name, '/', 1) <> 'processos' or public.can_edit_processo(nullif(split_part(name, '/', 2), '')::uuid))
  );
