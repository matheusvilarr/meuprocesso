-- Migration: sistema de notificações inteligentes
-- Rode no SQL Editor do Supabase

-- Campo nos processos para rastrear quando foi incluído num email
ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS ultima_notif_email timestamptz;

-- Tabela de log: evita enviar o mesmo turno duas vezes no mesmo dia
CREATE TABLE IF NOT EXISTS public.notif_log (
  user_id uuid  NOT NULL,
  tipo    text  NOT NULL,   -- 'morning' | 'afternoon' | 'evening'
  data    date  NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, tipo, data)
);

ALTER TABLE public.notif_log ENABLE ROW LEVEL SECURITY;
-- Sem políticas: só o service role acessa (bypass RLS)
