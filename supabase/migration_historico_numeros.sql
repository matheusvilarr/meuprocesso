-- ============================================================
-- Migração: Histórico de números do processo (1ª instância, STJ, STF...)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- Só aditivo — não apaga nem altera dados existentes
-- ============================================================

-- Uma causa pode ter vários números ao longo da vida (1ª instância, um novo
-- na 2ª se subiu por agravo no meio do processo, outro no STJ, outro no
-- STF...). Em vez de só guardar o número atual, isso é uma lista que só
-- cresce — nunca apaga uma entrada antiga — pra manter o rastro completo e
-- deixar qualquer um desses números pesquisável no sistema.
-- Formato de cada item: { numero, etiqueta, origem, data }
alter table public.processos
  add column if not exists historico_numeros jsonb not null default '[]';

NOTIFY pgrst, 'reload schema';
