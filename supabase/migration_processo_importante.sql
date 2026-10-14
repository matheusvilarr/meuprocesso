-- ============================================================
-- Migração: marcar processo como importante (destaque no dashboard)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- Só ADICIONA uma coluna com default false — não mexe em dado existente.
-- ============================================================

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS importante boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- ── CONFERÊNCIA ──────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'processos' AND column_name = 'importante';

-- ============================================================
-- COMO DESFAZER:
-- ALTER TABLE public.processos DROP COLUMN IF EXISTS importante;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
