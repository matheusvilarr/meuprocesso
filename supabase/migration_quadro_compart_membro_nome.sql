-- Bug: a lista "quem já tem acesso" no compartilhar de quadro mostrava o
-- nome do DONO em toda linha (só existia dono_nome) — todo convidado
-- aparecia com o nome de quem convidou, em vez do próprio nome.
ALTER TABLE quadro_compartilhamentos ADD COLUMN IF NOT EXISTS membro_nome text DEFAULT '';
NOTIFY pgrst, 'reload schema';
