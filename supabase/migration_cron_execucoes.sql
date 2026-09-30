-- ============================================================
-- Migração: registro de cada execução automática (crons)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Por que existe: hoje o painel mostra só a fotografia do momento. Não dá
-- para responder "o cron das 3h rodou?", "quanto rendeu?", "está melhorando
-- ou piorando?". Sem isso não há como descobrir o que está acontecendo.
--
-- Cada execução grava UMA linha no começo e a completa no fim. Execução que
-- some sem terminar (estourou o tempo da Vercel) fica com terminou_em vazio —
-- e é justamente esse o sinal mais importante.
--
-- Só ACRESCENTA uma tabela. Não mexe em nada existente.
-- A limpeza automática apaga o que tem mais de 30 dias.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_execucoes (
  id           bigserial PRIMARY KEY,
  cron         text        NOT NULL,      -- 'datajud' | 'djen' | 'oab'
  iniciado_em  timestamptz NOT NULL DEFAULT now(),
  terminou_em  timestamptz,               -- vazio = morreu no meio
  duracao_ms   integer,
  fila         integer,                   -- itens disponíveis para processar
  processados  integer,                   -- quantos foram efetivamente tentados
  resultados   jsonb,                     -- {novos, verificados, falhas, ...}
  erro         text,
  regiao       text,
  deploy       text
);

CREATE INDEX IF NOT EXISTS cron_execucoes_iniciado_idx
  ON public.cron_execucoes (iniciado_em DESC);

-- RLS ligado e NENHUMA policy: só a chave de serviço (crons e painel admin)
-- enxerga. Nenhum advogado logado consegue ler.
ALTER TABLE public.cron_execucoes ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ── CONFERÊNCIA ──────────────────────────────────────────────
-- Deve devolver a tabela vazia (0 linhas), sem erro.
SELECT count(*) AS linhas FROM public.cron_execucoes;


-- ============================================================
-- COMO DESFAZER:
-- DROP TABLE IF EXISTS public.cron_execucoes;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
