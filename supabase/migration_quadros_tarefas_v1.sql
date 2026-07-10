-- Migration: quadros (pastas de tarefas) + tarefa_comentarios
-- Rode no SQL Editor do Supabase

-- 1. Tabela de quadros (pastas)
CREATE TABLE IF NOT EXISTS quadros (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  created_at     timestamptz DEFAULT now()
);

-- 2. Coluna quadro_id na tabela tarefas (se não existir)
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS quadro_id uuid REFERENCES quadros(id) ON DELETE SET NULL;

-- 3. Tabela de comentários de tarefas
CREATE TABLE IF NOT EXISTS tarefa_comentarios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id  uuid NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  autor_nome text NOT NULL DEFAULT '',
  texto      text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4. RLS: quadros — titular e colaboradores ativos
ALTER TABLE quadros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quadros_select" ON quadros;
CREATE POLICY "quadros_select" ON quadros FOR SELECT USING (
  escritorio_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM colaboradores c
    WHERE c.escritorio_id = quadros.escritorio_id
      AND c.user_id = auth.uid()
      AND c.status = 'ativo'
  )
);

DROP POLICY IF EXISTS "quadros_insert" ON quadros;
CREATE POLICY "quadros_insert" ON quadros FOR INSERT WITH CHECK (
  escritorio_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM colaboradores c
    WHERE c.escritorio_id = quadros.escritorio_id
      AND c.user_id = auth.uid()
      AND c.status = 'ativo'
  )
);

DROP POLICY IF EXISTS "quadros_delete" ON quadros;
CREATE POLICY "quadros_delete" ON quadros FOR DELETE USING (
  escritorio_id = auth.uid()
);

-- 5. RLS: tarefa_comentarios — titular e colaboradores do escritório da tarefa
ALTER TABLE tarefa_comentarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tc_select" ON tarefa_comentarios;
CREATE POLICY "tc_select" ON tarefa_comentarios FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tarefas t
    WHERE t.id = tarefa_comentarios.tarefa_id
      AND (
        t.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM colaboradores c
          WHERE c.escritorio_id = t.user_id
            AND c.user_id = auth.uid()
            AND c.status = 'ativo'
        )
      )
  )
);

DROP POLICY IF EXISTS "tc_insert" ON tarefa_comentarios;
CREATE POLICY "tc_insert" ON tarefa_comentarios FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM tarefas t
    WHERE t.id = tarefa_comentarios.tarefa_id
      AND (
        t.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM colaboradores c
          WHERE c.escritorio_id = t.user_id
            AND c.user_id = auth.uid()
            AND c.status = 'ativo'
        )
      )
  )
);

DROP POLICY IF EXISTS "tc_delete" ON tarefa_comentarios;
CREATE POLICY "tc_delete" ON tarefa_comentarios FOR DELETE USING (
  user_id = auth.uid()
);

-- 6. Recarrega schema cache do PostgREST
NOTIFY pgrst, 'reload schema';
