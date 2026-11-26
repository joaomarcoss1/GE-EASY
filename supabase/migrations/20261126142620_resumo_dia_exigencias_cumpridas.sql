-- Resumo do dia: exigências cumpridas (setor de Exigências)
alter table public.resumos_diarios
  add column if not exists exigencias_cumpridas integer not null default 0 check (exigencias_cumpridas between 0 and 500);
