-- Processos novos encontrados via busca por OAB no DataJud (cron diário),
-- ainda não cadastrados pelo advogado. Ele decide importar ou ignorar;
-- uma vez decidido, o cron nunca mais notifica aquele número.

CREATE TABLE IF NOT EXISTS public.processos_descobertos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  numero           text not null,
  tribunal         text not null,
  dados            jsonb not null,
  data_ajuizamento date,
  status           text not null default 'pendente' check (status in ('pendente','importado','ignorado')),
  encontrado_em    timestamptz not null default now(),
  decidido_em      timestamptz,
  unique (user_id, numero)
);

CREATE INDEX IF NOT EXISTS processos_descobertos_user_idx ON public.processos_descobertos (user_id, status);

ALTER TABLE public.processos_descobertos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS descobertos_select_own ON public.processos_descobertos;
CREATE POLICY descobertos_select_own ON public.processos_descobertos
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS descobertos_update_own ON public.processos_descobertos;
CREATE POLICY descobertos_update_own ON public.processos_descobertos
  FOR UPDATE USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
