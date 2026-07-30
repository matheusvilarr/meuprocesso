-- Assinaturas: trial de 7 dias automático + controle manual pelo admin.
-- Vinculada a escritorio_id (titular), nunca a colaborador individual —
-- colaborador herda o status de assinatura do titular via window._escritorioId.
-- Rode no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.assinaturas (
  id              uuid primary key default gen_random_uuid(),
  escritorio_id   uuid not null unique references auth.users(id) on delete cascade,
  plano           text not null default 'trial' check (plano in ('trial','mensal','semestral','anual','legado')),
  status          text not null default 'ativo' check (status in ('ativo','vencido','cancelado')),
  data_inicio     timestamptz not null default now(),
  data_expiracao  timestamptz not null,
  valor_pago      numeric,
  forma_pagamento text,           -- 'pix' | 'cartao' | null (trial/legado)
  observacoes     text,           -- nota livre do admin (ex: "pago via Pix, comprovante por e-mail")
  atualizado_por  uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

-- Só o próprio titular lê a própria assinatura; toda escrita é via service
-- role (api/admin.js) — mesmo padrão de admins/codigos_acesso.
DROP POLICY IF EXISTS "assinaturas_select_own" ON public.assinaturas;
CREATE POLICY "assinaturas_select_own" ON public.assinaturas FOR SELECT USING (auth.uid() = escritorio_id);

DROP TRIGGER IF EXISTS assinaturas_updated_at ON public.assinaturas;
CREATE TRIGGER assinaturas_updated_at BEFORE UPDATE ON public.assinaturas
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Trial automático pra qualquer novo cadastro — cobre os dois fluxos de
-- signup (registro.html e a aba de cadastro do login.html) num só lugar,
-- porque o trigger roda no INSERT em auth.users independente de qual tela
-- originou o cadastro.
CREATE OR REPLACE FUNCTION public.criar_trial_novo_usuario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.assinaturas (escritorio_id, plano, status, data_inicio, data_expiracao)
  VALUES (NEW.id, 'trial', 'ativo', now(), now() + interval '7 days')
  ON CONFLICT (escritorio_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_trial ON auth.users;
CREATE TRIGGER on_auth_user_created_trial
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.criar_trial_novo_usuario();

-- Grandfather: quem já tinha conta antes desta migration ganha um plano
-- "legado" com validade generosa — sem isso, todo mundo cairia bloqueado
-- na hora que isso for pra produção.
INSERT INTO public.assinaturas (escritorio_id, plano, status, data_inicio, data_expiracao, observacoes)
SELECT id, 'legado', 'ativo', now(), now() + interval '180 days', 'Conta anterior ao sistema de assinaturas'
FROM auth.users
ON CONFLICT (escritorio_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
