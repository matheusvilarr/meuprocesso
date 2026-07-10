-- Migration: compartilhamento de pasta de tarefas entre advogados
-- Rode no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)

-- 1. Tabela de convites/compartilhamentos de quadro
CREATE TABLE IF NOT EXISTS quadro_compartilhamentos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quadro_id  uuid NOT NULL REFERENCES quadros(id) ON DELETE CASCADE,
  dono_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dono_nome  text NOT NULL DEFAULT '',
  membro_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pendente'
               CHECK (status IN ('pendente', 'aceito', 'recusado')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (quadro_id, membro_id)
);

ALTER TABLE quadro_compartilhamentos ENABLE ROW LEVEL SECURITY;

-- dono vê os que ele criou; membro vê os seus convites
DROP POLICY IF EXISTS "qc_select" ON quadro_compartilhamentos;
CREATE POLICY "qc_select" ON quadro_compartilhamentos FOR SELECT USING (
  dono_id = auth.uid() OR membro_id = auth.uid()
);

DROP POLICY IF EXISTS "qc_insert" ON quadro_compartilhamentos;
CREATE POLICY "qc_insert" ON quadro_compartilhamentos FOR INSERT WITH CHECK (
  dono_id = auth.uid()
);

DROP POLICY IF EXISTS "qc_update" ON quadro_compartilhamentos;
CREATE POLICY "qc_update" ON quadro_compartilhamentos FOR UPDATE USING (
  membro_id = auth.uid()   -- só o convidado pode aceitar/recusar
);

DROP POLICY IF EXISTS "qc_delete" ON quadro_compartilhamentos;
CREATE POLICY "qc_delete" ON quadro_compartilhamentos FOR DELETE USING (
  dono_id = auth.uid() OR membro_id = auth.uid()
);

-- 2. Atualiza RLS de quadros: membro com aceito também pode ver
DROP POLICY IF EXISTS "quadros_select" ON quadros;
CREATE POLICY "quadros_select" ON quadros FOR SELECT USING (
  escritorio_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM colaboradores c
    WHERE c.escritorio_id = quadros.escritorio_id
      AND c.user_id = auth.uid()
      AND c.status = 'ativo'
  )
  OR EXISTS (
    SELECT 1 FROM quadro_compartilhamentos qc
    WHERE qc.quadro_id = quadros.id
      AND qc.membro_id = auth.uid()
      AND qc.status = 'aceito'
  )
);

-- 3. Atualiza RLS de tarefas: membro do quadro pode ver/editar/criar
DROP POLICY IF EXISTS "tarefas_quadro_shared_select" ON tarefas;
CREATE POLICY "tarefas_quadro_shared_select" ON tarefas FOR SELECT USING (
  quadro_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM quadro_compartilhamentos qc
    WHERE qc.quadro_id = tarefas.quadro_id
      AND qc.membro_id = auth.uid()
      AND qc.status = 'aceito'
  )
);

DROP POLICY IF EXISTS "tarefas_quadro_shared_insert" ON tarefas;
CREATE POLICY "tarefas_quadro_shared_insert" ON tarefas FOR INSERT WITH CHECK (
  quadro_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM quadro_compartilhamentos qc
    WHERE qc.quadro_id = tarefas.quadro_id
      AND qc.membro_id = auth.uid()
      AND qc.status = 'aceito'
  )
);

DROP POLICY IF EXISTS "tarefas_quadro_shared_update" ON tarefas;
CREATE POLICY "tarefas_quadro_shared_update" ON tarefas FOR UPDATE USING (
  quadro_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM quadro_compartilhamentos qc
    WHERE qc.quadro_id = tarefas.quadro_id
      AND qc.membro_id = auth.uid()
      AND qc.status = 'aceito'
  )
);

-- 4. Atualiza RLS de tarefa_comentarios: membro do quadro pode comentar
DROP POLICY IF EXISTS "tc_quadro_shared_select" ON tarefa_comentarios;
CREATE POLICY "tc_quadro_shared_select" ON tarefa_comentarios FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tarefas t
    JOIN quadro_compartilhamentos qc ON qc.quadro_id = t.quadro_id
    WHERE t.id = tarefa_comentarios.tarefa_id
      AND qc.membro_id = auth.uid()
      AND qc.status = 'aceito'
  )
);

DROP POLICY IF EXISTS "tc_quadro_shared_insert" ON tarefa_comentarios;
CREATE POLICY "tc_quadro_shared_insert" ON tarefa_comentarios FOR INSERT WITH CHECK (
  user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM tarefas t
    JOIN quadro_compartilhamentos qc ON qc.quadro_id = t.quadro_id
    WHERE t.id = tarefa_comentarios.tarefa_id
      AND qc.membro_id = auth.uid()
      AND qc.status = 'aceito'
  )
);

-- 5. RPC: buscar usuário por e-mail (SECURITY DEFINER acessa auth.users)
CREATE OR REPLACE FUNCTION buscar_usuario_por_email(p_email text)
RETURNS TABLE (id uuid, nome text, email text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1))::text AS nome,
    u.email::text
  FROM auth.users u
  WHERE lower(u.email) = lower(p_email)
    AND u.id != auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION buscar_usuario_por_email(text) TO authenticated;

-- 6. Recarrega schema
NOTIFY pgrst, 'reload schema';
