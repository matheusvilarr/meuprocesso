-- Aprovação de usuários: todos os usuários existentes recebem status 'aprovado'
-- para não serem bloqueados pelo novo fluxo de aprovação.
-- Novos usuários criados após esta migration entrarão como 'pendente' por padrão.

UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data || '{"status": "aprovado"}'::jsonb;
