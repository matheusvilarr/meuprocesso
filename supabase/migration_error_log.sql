-- Log de erros dos crons/jobs server-side — hoje os erros são engolidos
-- silenciosamente (catch vazio), o que já mascarou bugs por dias/semanas.
-- Rodar no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.error_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  origem     text NOT NULL,        -- ex: 'cron:djen', 'cron:datajud', 'cron:email-morning'
  mensagem   text NOT NULL,
  detalhes   jsonb,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS error_log_created_at_idx ON public.error_log (created_at DESC);

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

-- Só admins conseguem ler (via client); escrita só pela service role (crons).
DROP POLICY IF EXISTS "error_log_admin_select" ON public.error_log;
CREATE POLICY "error_log_admin_select" ON public.error_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid())
  );
