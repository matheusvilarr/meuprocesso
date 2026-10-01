-- ============================================================
-- Migração: anotações e comentários param de se apagar entre si
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- O problema: anotações e comentários ficam numa lista única dentro do
-- processo (colunas jsonb). Para acrescentar um item, a tela lia a lista que
-- estava aberta, somava o novo e gravava a lista inteira de volta. Se o
-- colaborador tivesse comentado enquanto o titular estava com o processo
-- aberto, o comentário dele era sobrescrito e desaparecia sem aviso.
--
-- A correção: o acréscimo e a remoção passam a acontecer DENTRO do banco,
-- sobre o valor que está lá naquele instante. Não há mais janela para perder
-- o que a outra pessoa escreveu.
--
-- As funções são SECURITY INVOKER (o padrão), de propósito: elas rodam com as
-- permissões de quem chamou, então as regras de acesso que já existem
-- continuam valendo — ninguém passa a mexer em processo que não podia.
--
-- Só ACRESCENTA funções. Não altera tabelas nem dados.
-- ============================================================

BEGIN;

-- ── ANOTAÇÕES DA TIMELINE ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.anexar_nota_processo(p_processo uuid, p_nota jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.processos
     SET notas_manuais = COALESCE(notas_manuais, '[]'::jsonb) || jsonb_build_array(p_nota)
   WHERE id = p_processo
  RETURNING notas_manuais;
$$;

CREATE OR REPLACE FUNCTION public.remover_nota_processo(p_processo uuid, p_nota_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.processos
     SET notas_manuais = COALESCE((
           SELECT jsonb_agg(item)
             FROM jsonb_array_elements(COALESCE(notas_manuais, '[]'::jsonb)) AS item
            WHERE item->>'id' IS DISTINCT FROM p_nota_id
         ), '[]'::jsonb)
   WHERE id = p_processo
  RETURNING notas_manuais;
$$;

-- ── COMENTÁRIOS DA EQUIPE ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.anexar_comentario_processo(p_processo uuid, p_comentario jsonb)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.processos
     SET comentarios = COALESCE(comentarios, '[]'::jsonb) || jsonb_build_array(p_comentario)
   WHERE id = p_processo
  RETURNING comentarios;
$$;

-- Excluir comentário estava QUEBRADO em produção: a tela chamava uma função
-- "excluir_comentario" que nunca existiu no banco, então o advogado só via
-- "Erro ao excluir comentário". Esta é a função que faltava.
--
-- Duas regras garantidas aqui, e não só na tela (esconder o botão não impede
-- ninguém de chamar a API direto):
--   1. só o autor apaga o próprio comentário;
--   2. apagar um comentário leva as respostas dele junto, senão sobrariam
--      respostas penduradas em algo que não existe mais.
CREATE OR REPLACE FUNCTION public.remover_comentario_processo(p_processo uuid, p_comentario_id text)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.processos
     SET comentarios = COALESCE((
           SELECT jsonb_agg(item)
             FROM jsonb_array_elements(COALESCE(comentarios, '[]'::jsonb)) AS item
            WHERE NOT (
              -- o próprio comentário, se quem pede for o autor
              (item->>'id' = p_comentario_id AND item->>'autor_id' = auth.uid()::text)
              -- e as respostas a ele, desde que o autor realmente possa apagá-lo
              OR (item->>'reply_to_id' = p_comentario_id AND EXISTS (
                   SELECT 1
                     FROM jsonb_array_elements(COALESCE(comentarios, '[]'::jsonb)) AS pai
                    WHERE pai->>'id' = p_comentario_id
                      AND pai->>'autor_id' = auth.uid()::text))
            )
         ), '[]'::jsonb)
   WHERE id = p_processo
  RETURNING comentarios;
$$;

GRANT EXECUTE ON FUNCTION public.anexar_nota_processo(uuid, jsonb)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_nota_processo(uuid, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.anexar_comentario_processo(uuid, jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_comentario_processo(uuid, text)    TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ── CONFERÊNCIA ──────────────────────────────────────────────
-- Deve listar as 4 funções.
SELECT routine_name
  FROM information_schema.routines
 WHERE routine_schema = 'public'
   AND routine_name IN ('anexar_nota_processo','remover_nota_processo',
                        'anexar_comentario_processo','remover_comentario_processo')
 ORDER BY routine_name;


-- ============================================================
-- COMO DESFAZER:
-- DROP FUNCTION IF EXISTS public.anexar_nota_processo(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.remover_nota_processo(uuid, text);
-- DROP FUNCTION IF EXISTS public.anexar_comentario_processo(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.remover_comentario_processo(uuid, text);
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
