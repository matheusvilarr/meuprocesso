-- ============================================================
-- Migração: Tarefas compartilhadas por processo
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- 1. Rastrear quem moveu/editou a tarefa
ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS updated_by_nome text DEFAULT '';

-- 2. Parceiro pode VER tarefas do processo compartilhado (já existe em v2, garante aqui)
DROP POLICY IF EXISTS "tarefas_shared_select" ON public.tarefas;
CREATE POLICY "tarefas_shared_select" ON public.tarefas
  FOR SELECT USING (
    processo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = tarefas.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
    )
  );

-- 3. Parceiro pode MOVER e EDITAR tarefas do processo compartilhado
DROP POLICY IF EXISTS "tarefas_shared_update" ON public.tarefas;
CREATE POLICY "tarefas_shared_update" ON public.tarefas
  FOR UPDATE USING (
    processo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = tarefas.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
    )
  );

-- 4. Parceiro pode CRIAR tarefas no processo compartilhado
DROP POLICY IF EXISTS "tarefas_shared_insert" ON public.tarefas;
CREATE POLICY "tarefas_shared_insert" ON public.tarefas
  FOR INSERT WITH CHECK (
    processo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = tarefas.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
    )
  );

-- Recarregar schema
NOTIFY pgrst, 'reload schema';
