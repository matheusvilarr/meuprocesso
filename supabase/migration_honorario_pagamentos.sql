-- ============================================================
-- Pagamentos de honorários (parcial, adiantado, entrada)
-- ============================================================
-- Cada pagamento recebido vira uma linha aqui; a tela abate da cobrança
-- mais antiga em aberto (js/honorarios-calc.js). Ex.: mensal de R$ 1.500
-- com R$ 500 adiantados → R$ 1.000 pendentes no mês; um pagamento maior
-- quita o mês e adianta os seguintes.
--
-- ADITIVA: não altera nenhum honorário existente. "Entrada" e "pago" do
-- jeito antigo continuam valendo como pagamento pela própria tela.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================

-- Já existe no banco (foi criada direto no painel, sem migration);
-- registrada aqui pra quem recriar o banco do zero.
ALTER TABLE public.honorarios ADD COLUMN IF NOT EXISTS valor_entrada numeric(12,2);

CREATE TABLE IF NOT EXISTS public.honorario_pagamentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  honorario_id   uuid NOT NULL REFERENCES public.honorarios(id) ON DELETE CASCADE,
  -- escritório (titular), igual a honorarios.user_id
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  valor          numeric(12,2) NOT NULL CHECK (valor > 0),
  data_pagamento date NOT NULL,
  observacao     text,
  created_by     uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS honorario_pagamentos_honorario_idx ON public.honorario_pagamentos (honorario_id);
CREATE INDEX IF NOT EXISTS honorario_pagamentos_user_data_idx ON public.honorario_pagamentos (user_id, data_pagamento);

ALTER TABLE public.honorario_pagamentos ENABLE ROW LEVEL SECURITY;

-- Mesmas regras de honorarios (migration_rls_fix_v2.sql): titular tem tudo,
-- colaborador ativo do escritório também. Na gravação, o pagamento só pode
-- apontar pra honorário do MESMO escritório — a chave estrangeira sozinha
-- não confere dono.
DROP POLICY IF EXISTS "hon_pag_select"        ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "hon_pag_insert"        ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "hon_pag_update"        ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "hon_pag_delete"        ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "hon_pag_collab_select" ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "hon_pag_collab_insert" ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "hon_pag_collab_update" ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "hon_pag_collab_delete" ON public.honorario_pagamentos;
DROP POLICY IF EXISTS "exige_assinatura"      ON public.honorario_pagamentos;

CREATE POLICY "hon_pag_select" ON public.honorario_pagamentos
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "hon_pag_insert" ON public.honorario_pagamentos
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.honorarios h WHERE h.id = honorario_id AND h.user_id = honorario_pagamentos.user_id)
  );

CREATE POLICY "hon_pag_update" ON public.honorario_pagamentos
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.honorarios h WHERE h.id = honorario_id AND h.user_id = honorario_pagamentos.user_id)
  );

CREATE POLICY "hon_pag_delete" ON public.honorario_pagamentos
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "hon_pag_collab_select" ON public.honorario_pagamentos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.colaboradores c
            WHERE c.escritorio_id = honorario_pagamentos.user_id AND c.user_id = auth.uid() AND c.status = 'ativo')
  );

CREATE POLICY "hon_pag_collab_insert" ON public.honorario_pagamentos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.colaboradores c
            WHERE c.escritorio_id = honorario_pagamentos.user_id AND c.user_id = auth.uid() AND c.status = 'ativo')
    AND EXISTS (SELECT 1 FROM public.honorarios h WHERE h.id = honorario_id AND h.user_id = honorario_pagamentos.user_id)
  );

CREATE POLICY "hon_pag_collab_update" ON public.honorario_pagamentos
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.colaboradores c
            WHERE c.escritorio_id = honorario_pagamentos.user_id AND c.user_id = auth.uid() AND c.status = 'ativo')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.colaboradores c
            WHERE c.escritorio_id = honorario_pagamentos.user_id AND c.user_id = auth.uid() AND c.status = 'ativo')
    AND EXISTS (SELECT 1 FROM public.honorarios h WHERE h.id = honorario_id AND h.user_id = honorario_pagamentos.user_id)
  );

CREATE POLICY "hon_pag_collab_delete" ON public.honorario_pagamentos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.colaboradores c
            WHERE c.escritorio_id = honorario_pagamentos.user_id AND c.user_id = auth.uid() AND c.status = 'ativo')
  );

-- Assinatura vencida bloqueia igual às outras tabelas (migration_assinatura_no_servidor.sql)
CREATE POLICY "exige_assinatura" ON public.honorario_pagamentos AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

-- Desde 30/10/2026 o Supabase não libera tabela nova pra API sozinho
GRANT SELECT, INSERT, UPDATE, DELETE ON public.honorario_pagamentos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.honorario_pagamentos TO service_role;

NOTIFY pgrst, 'reload schema';
