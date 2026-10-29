-- Agenda a rotina diária de alertas (renovações, apólices vencidas, tarefas atrasadas)
-- 11:00 UTC = 08:00 (America/Sao_Paulo)
create extension if not exists pg_cron;

select cron.schedule('ge-easy-alertas-diarios', '0 11 * * *', $$select public.gerar_alertas();$$);
