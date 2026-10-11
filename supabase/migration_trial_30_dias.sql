-- ============================================================
-- Migração: trial grátis de 7 para 30 dias
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- Só substitui a função do trigger — não mexe em tabela nem em dado
-- existente. Afeta só CONTA NOVA a partir de agora; quem já está em
-- trial continua com a data de expiração de quando se cadastrou.
-- ============================================================

CREATE OR REPLACE FUNCTION public.criar_trial_novo_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.assinaturas (escritorio_id, plano, status, data_inicio, data_expiracao)
  VALUES (NEW.id, 'trial', 'ativo', now(), now() + interval '30 days')
  ON CONFLICT (escritorio_id) DO NOTHING;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ── CONFERÊNCIA ──────────────────────────────────────────────
-- Deve mostrar "30 days" na definição da função.
SELECT prosrc FROM pg_proc WHERE proname = 'criar_trial_novo_usuario';

-- ============================================================
-- COMO DESFAZER (volta pra 7 dias):
-- CREATE OR REPLACE FUNCTION public.criar_trial_novo_usuario()
-- RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   INSERT INTO public.assinaturas (escritorio_id, plano, status, data_inicio, data_expiracao)
--   VALUES (NEW.id, 'trial', 'ativo', now(), now() + interval '7 days')
--   ON CONFLICT (escritorio_id) DO NOTHING;
--   RETURN NEW;
-- END;
-- $$;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
