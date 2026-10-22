-- Novo perfil de escopo para a equipe administrativa (central de documentação, base administrativa).
-- Enum precisa ser alterado em migração própria (o valor só pode ser usado após o commit).
alter type public.app_role add value if not exists 'administrativo' after 'assistente_juridico';
