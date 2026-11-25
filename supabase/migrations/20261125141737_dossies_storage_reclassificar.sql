-- 1) Espaço próprio e privado para os dossiês (ZIP e PDF único), até 50 MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dossies', 'dossies', false, 52428800, array['application/zip', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy dossies_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'dossies' and public.storage_can_access(name));
create policy dossies_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dossies' and public.storage_can_access(name));
create policy dossies_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dossies' and (select public.is_manager()) and public.storage_can_access(name));

alter table public.dossies add column pdf_path text check (char_length(pdf_path) <= 400);

-- 2) Reclassificar um documento (só a categoria): quem confere documentos, a gestão ou quem enviou.
create or replace function public.reclassificar_documento(p_doc uuid, p_categoria text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if p_categoria is null or char_length(p_categoria) not between 2 and 60 or p_categoria !~ '^[a-z_]+$' then
    raise exception 'Categoria inválida.' using errcode = '22023';
  end if;
  select id, cliente_id, enviado_por into d from public.documentos
   where id = p_doc and empresa_id = public.empresa_atual() and excluido_em is null;
  if not found or d.cliente_id is null or not public.can_access_cliente(d.cliente_id) then
    raise exception 'Documento não encontrado ou sem acesso.' using errcode = '42501';
  end if;
  if not (public.tem_permissao('documentacao.analisar') or public.is_manager() or d.enviado_por = auth.uid()) then
    raise exception 'Somente quem confere documentos pode reclassificar.' using errcode = '42501';
  end if;
  update public.documentos set categoria = p_categoria where id = p_doc;
  return true;
end $$;
revoke execute on function public.reclassificar_documento(uuid, text) from public, anon;
grant execute on function public.reclassificar_documento(uuid, text) to authenticated;
