-- Novos papéis do núcleo jurídico (enum precisa ser alterado em migração própria)
alter type public.app_role add value if not exists 'advogado' after 'financeiro';
alter type public.app_role add value if not exists 'assistente_juridico' after 'advogado';
alter type public.evento_tipo add value if not exists 'audiencia';
alter type public.evento_tipo add value if not exists 'prazo';
