-- ============================================================
-- Migração: registro de e-mails enviados (out/2026)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- O plano grátis da Resend aceita 100 e-mails/dia e 3.000/mês — passou
-- disso, o resto do dia é recusado (inclusive aviso de prazo). Sem um
-- registro por envio não dá pra saber quão perto do limite estamos; o
-- notif_log guarda no máximo 1 linha por tipo/dia e subconta.
--
-- Só CRIA uma tabela nova — não altera nem apaga nada existente.
-- Só o servidor (service role) lê e grava: RLS ligado e sem política.
-- Linhas com mais de 35 dias são apagadas pelo próprio cron
-- (limparLogsAntigos em lib/sync-comum.js).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_envios (
  id         bigserial   PRIMARY KEY,
  para       text        NOT NULL,
  assunto    text,
  enviado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_envios_enviado_em_idx ON public.email_envios (enviado_em);

ALTER TABLE public.email_envios ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
