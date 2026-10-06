-- Campo livre "Nome da parte" no prazo/lembrete do calendário — sugerido a
-- partir de cliente/parte contrária dos processos, mas nunca obrigatório.
-- Rode no SQL Editor do Supabase. Só aditivo, não mexe em dado existente.

ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS nome_parte text;

NOTIFY pgrst, 'reload schema';
