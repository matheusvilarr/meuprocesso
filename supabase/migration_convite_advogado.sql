-- Permite ao admin convidar um advogado específico por email: o código de
-- acesso passa a poder ser vinculado a um destinatário e rastrear se foi
-- enviado e se já foi usado (sem isso o admin não tinha visibilidade de
-- quem ainda não se cadastrou). Rodar no SQL Editor do Supabase.

ALTER TABLE public.codigos_acesso ADD COLUMN IF NOT EXISTS email_convidado text;
ALTER TABLE public.codigos_acesso ADD COLUMN IF NOT EXISTS enviado_em      timestamptz;
ALTER TABLE public.codigos_acesso ADD COLUMN IF NOT EXISTS usado_em        timestamptz;

CREATE INDEX IF NOT EXISTS codigos_acesso_email_idx ON public.codigos_acesso (email_convidado);
