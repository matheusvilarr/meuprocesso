-- Permite preencher número do processo e cliente manualmente na tarefa,
-- sem precisar vincular a um processo cadastrado (processo_id).
-- O campo "prazo" (date) já existe na tabela desde a v2 — só passou a ser
-- editável na UI agora (prazo fatal com alerta visual no card).
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS numero_processo_manual text;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS cliente_manual text;
NOTIFY pgrst, 'reload schema';
