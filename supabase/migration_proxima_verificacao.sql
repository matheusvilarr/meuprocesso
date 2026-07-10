-- Adiciona proxima_verificacao para controle inteligente de sync.
-- Processos ativos → checados frequentemente; dormentes → raramente.
-- Rode no SQL Editor do Supabase.

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS proxima_verificacao timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_mov_data     date;

-- Índice para o cron buscar só o que está due
CREATE INDEX IF NOT EXISTS processos_proxima_verificacao_idx
  ON public.processos (proxima_verificacao ASC NULLS FIRST)
  WHERE status != 'Arquivado' AND numero IS NOT NULL;
