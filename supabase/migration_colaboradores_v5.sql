-- ============================================================
-- Migração v5: Colaboradores veem todos os membros da equipe
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- Função auxiliar SECURITY DEFINER para evitar recursão infinita na policy
-- (policies não podem referenciar a própria tabela diretamente)
CREATE OR REPLACE FUNCTION public.is_membro_escritorio(p_escritorio_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.colaboradores
    WHERE user_id       = auth.uid()
      AND escritorio_id = p_escritorio_id
      AND status        = 'ativo'
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_membro_escritorio(uuid) TO authenticated;

-- Atualiza policy para colaboradores poderem ver todos os membros do escritório
DROP POLICY IF EXISTS "colaboradores_escritorio" ON public.colaboradores;

CREATE POLICY "colaboradores_escritorio"
  ON public.colaboradores FOR ALL
  USING (
    auth.uid() = escritorio_id
    OR auth.uid() = user_id
    OR public.is_membro_escritorio(escritorio_id)
  )
  WITH CHECK (auth.uid() = escritorio_id);

NOTIFY pgrst, 'reload schema';
