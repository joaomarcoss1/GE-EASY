-- Quem gerou o dossiê também pode apagar os próprios arquivos (além da gestão).
drop policy dossies_storage_delete on storage.objects;
create policy dossies_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dossies' and ((select public.is_manager()) or owner_id = (select auth.uid())::text) and public.storage_can_access(name));
