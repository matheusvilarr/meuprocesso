-- Adiciona descrição e checklist às tarefas
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS descricao text DEFAULT '';
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS checklist jsonb DEFAULT '[]'::jsonb;
NOTIFY pgrst, 'reload schema';
