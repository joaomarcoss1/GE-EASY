-- Agenda, tarefas e visitas também entram na trilha de auditoria (antes ficavam de fora)
create trigger trg_audit_agenda_eventos after insert or update or delete on public.agenda_eventos for each row execute function public.audit_trigger();
create trigger trg_audit_tarefas after insert or update or delete on public.tarefas for each row execute function public.audit_trigger();
create trigger trg_audit_visitas after insert or update or delete on public.visitas for each row execute function public.audit_trigger();
