-- ============================================================
-- Migração: fila de sincronização do DataJud (set/2026)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Só ADICIONA colunas e um índice — não altera nem apaga nenhum dado.
--
-- ultima_verificacao      → última consulta ao DataJud que DEU CERTO (inalterada)
-- sync_ultima_tentativa   → última tentativa (com sucesso ou não) — ordena a fila
-- sync_falhas             → falhas seguidas (zera quando uma consulta dá certo)
-- sync_ultimo_erro        → mensagem do último erro, pro painel admin
-- ============================================================

BEGIN;

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS sync_ultima_tentativa timestamptz,
  ADD COLUMN IF NOT EXISTS sync_falhas           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_ultimo_erro      text;

CREATE INDEX IF NOT EXISTS processos_fila_sync_idx
  ON public.processos (sync_ultima_tentativa ASC NULLS FIRST)
  WHERE status IS DISTINCT FROM 'Arquivado' AND datajud_index IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
