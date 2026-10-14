-- ============================================================
-- Migração: status "bloqueado" em assinaturas (bloqueio manual pelo admin)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Antes, "Bloquear acesso" no admin usava o banimento nativo do Supabase
-- Auth (banned_until) — isso impede o login por completo, inclusive via
-- Google, e o Google/Supabase redireciona o erro pro domínio raiz do site
-- de um jeito que não dá pra interceptar de forma confiável.
--
-- Agora o bloqueio usa o mesmo mecanismo já existente pra trial/plano
-- vencido: o usuário consegue logar normalmente, e o auth-guard.js já
-- manda pra tela /assinatura-vencida quando assinaturas.status não é
-- 'ativo'. Só precisa aceitar 'bloqueado' como valor válido.
--
-- Aditiva: só troca a CHECK constraint, não mexe em nenhuma linha.
-- ============================================================

ALTER TABLE public.assinaturas DROP CONSTRAINT IF EXISTS assinaturas_status_check;
ALTER TABLE public.assinaturas ADD CONSTRAINT assinaturas_status_check
  CHECK (status in ('ativo','vencido','cancelado','bloqueado'));

NOTIFY pgrst, 'reload schema';

-- ── CONFERÊNCIA ──────────────────────────────────────────────
-- Deve listar os 4 valores aceitos.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'assinaturas_status_check';

-- ============================================================
-- COMO DESFAZER:
-- ALTER TABLE public.assinaturas DROP CONSTRAINT IF EXISTS assinaturas_status_check;
-- ALTER TABLE public.assinaturas ADD CONSTRAINT assinaturas_status_check
--   CHECK (status in ('ativo','vencido','cancelado'));
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
