-- Painel de administração: tabela de admins + reforço da tabela de códigos de acesso
-- Rodar no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS public.admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nivel      text NOT NULL DEFAULT 'admin' CHECK (nivel IN ('admin', 'super_admin')),
  criado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_self_select" ON public.admins;
CREATE POLICY "admins_self_select" ON public.admins
  FOR SELECT USING (auth.uid() = user_id);
-- Sem policy de INSERT/UPDATE/DELETE para o client — só a service role (APIs admin) gerencia.

-- codigos_acesso já existe em produção (usada por /api/validar-codigo) — só garantimos as colunas extras
CREATE TABLE IF NOT EXISTS public.codigos_acesso (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     text NOT NULL UNIQUE,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.codigos_acesso ADD COLUMN IF NOT EXISTS descricao  text;
ALTER TABLE public.codigos_acesso ADD COLUMN IF NOT EXISTS usos_max   int;
ALTER TABLE public.codigos_acesso ADD COLUMN IF NOT EXISTS usos_atual int NOT NULL DEFAULT 0;
ALTER TABLE public.codigos_acesso ADD COLUMN IF NOT EXISTS criado_por uuid REFERENCES auth.users(id);

ALTER TABLE public.codigos_acesso ENABLE ROW LEVEL SECURITY;
-- Sem policies para o client comum — só as APIs admin (service role) leem/escrevem.

-- Promove a conta de teste a super_admin (ajuste o email se necessário)
INSERT INTO public.admins (user_id, nivel)
SELECT id, 'super_admin' FROM auth.users WHERE email = 'teste@meuprocesso.com'
ON CONFLICT (user_id) DO NOTHING;
