-- Índices para toda chave estrangeira sem índice cobrindo (apontados pelo advisor do Supabase).
-- Evita varredura completa em joins, filtros por relacionamento e nas exclusões em cascata,
-- o que pesa com várias empresas usando o sistema ao mesmo tempo.
do $$
declare r record; v_nome text;
begin
  for r in
    select c.conrelid::regclass as tabela, c.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as colunas,
           (select string_agg(a.attname, '_' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as sufixo
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and t.relname not like 'audit_logs_%'
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[])
  loop
    v_nome := left(regexp_replace(r.tabela::text, '^public\.', '') || '_' || r.sufixo || '_idx', 63);
    execute format('create index if not exists %I on %s (%s)', v_nome, r.tabela, r.colunas);
  end loop;
end $$;
