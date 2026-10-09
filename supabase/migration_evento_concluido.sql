-- ============================================================
-- Migração: Marcar evento/prazo do calendário como concluído
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- Só aditivo — não apaga nem altera dados existentes
-- ============================================================

-- Evento marcado como concluído nunca some do calendário (só muda o visual,
-- ex: risco no título) — pedido explícito: "o evento não pode sumir".
alter table public.eventos
  add column if not exists concluido boolean not null default false,
  add column if not exists concluido_em timestamptz;

NOTIFY pgrst, 'reload schema';
