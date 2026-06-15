-- ============================================================
-- Migração: Segurança server-side na exclusão de comentários
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- Função RPC: exclui comentário verificando propriedade no servidor
-- Impede que um usuário exclua comentários de outro usuário mesmo via console
CREATE OR REPLACE FUNCTION public.excluir_comentario(
  p_processo_id uuid,
  p_comment_id  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comentarios jsonb;
  v_alvo        jsonb;
  v_novo        jsonb;
BEGIN
  -- Lê comentários do processo (RLS garante que o usuário tem acesso a ele)
  SELECT comentarios INTO v_comentarios
  FROM processos
  WHERE id = p_processo_id
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM processo_compartilhamentos pc
        WHERE pc.processo_id    = p_processo_id
          AND pc.shared_with_id = auth.uid()
          AND pc.status         = 'aceito'
          AND pc.nivel_acesso  IN ('comentario', 'total')
      )
    );

  IF NOT FOUND OR v_comentarios IS NULL THEN
    RAISE EXCEPTION 'Acesso negado ao processo.';
  END IF;

  -- Verifica que o comentário pertence a quem está pedindo a exclusão
  SELECT elem INTO v_alvo
  FROM jsonb_array_elements(v_comentarios) elem
  WHERE elem->>'id' = p_comment_id
  LIMIT 1;

  IF v_alvo IS NULL THEN
    RAISE EXCEPTION 'Comentário não encontrado.';
  END IF;

  IF (v_alvo->>'autor_id') != auth.uid()::text THEN
    RAISE EXCEPTION 'Você não pode excluir o comentário de outro usuário.';
  END IF;

  -- Remove o comentário e todas as respostas a ele
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_novo
  FROM jsonb_array_elements(v_comentarios) elem
  WHERE elem->>'id'          != p_comment_id
    AND elem->>'reply_to_id' != p_comment_id;

  UPDATE processos SET comentarios = v_novo WHERE id = p_processo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_comentario(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
