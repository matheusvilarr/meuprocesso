-- ============================================================
-- Migração: Campo favorito nos processos
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS favorito boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
