-- Migração: lembretes recorrentes no calendário
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)

ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS recorrencia_id uuid;

CREATE INDEX IF NOT EXISTS eventos_recorrencia_idx ON public.eventos (recorrencia_id);

NOTIFY pgrst, 'reload schema';
