-- ============================================================
-- Migração: perfil do cliente (atualização + comentários)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Só ACRESCENTA colunas e funções. Não altera nem apaga dado existente.
-- ============================================================

BEGIN;

-- updated_at: pra mostrar "criado em / atualizado em" no card do cliente.
-- Default now() só pro cliente que nunca foi editado mostrar igual ao
-- created_at em vez de ficar nulo.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Comentários do cliente — mesmo formato jsonb usado em processos, mesmo
-- motivo de usar função no banco em vez de ler+regravar pelo app (ver
-- migration_notas_comentarios_atomicos.sql): evita um comentário de alguém
-- sumir se duas pessoas comentarem no mesmo cliente ao mesmo tempo.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS comentarios jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.anexar_comentario_cliente(p_cliente uuid, p_comentario jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.clientes
     SET comentarios = COALESCE(comentarios, '[]'::jsonb) || jsonb_build_array(p_comentario)
   WHERE id = p_cliente
  RETURNING comentarios;
$$;

CREATE OR REPLACE FUNCTION public.remover_comentario_cliente(p_cliente uuid, p_comentario_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.clientes
     SET comentarios = COALESCE((
           SELECT jsonb_agg(item)
             FROM jsonb_array_elements(COALESCE(comentarios, '[]'::jsonb)) AS item
            WHERE NOT (
              COALESCE(item->>'id' = p_comentario_id
                       AND item->>'autor_id' = auth.uid()::text, false)
            )
         ), '[]'::jsonb)
   WHERE id = p_cliente
  RETURNING comentarios;
$$;

GRANT EXECUTE ON FUNCTION public.anexar_comentario_cliente(uuid, jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_comentario_cliente(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── CONFERÊNCIA ──────────────────────────────────────────────
SELECT routine_name
  FROM information_schema.routines
 WHERE routine_schema = 'public'
   AND routine_name IN ('anexar_comentario_cliente','remover_comentario_cliente')
 ORDER BY routine_name;

-- ============================================================
-- COMO DESFAZER:
-- DROP FUNCTION IF EXISTS public.anexar_comentario_cliente(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.remover_comentario_cliente(uuid, text);
-- ALTER TABLE public.clientes DROP COLUMN IF EXISTS comentarios;
-- ALTER TABLE public.clientes DROP COLUMN IF EXISTS updated_at;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
