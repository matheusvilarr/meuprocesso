-- ============================================================
-- Migração: Clientes e Honorários
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- ── CLIENTES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  cpf_cnpj      text,
  email         text,
  telefone      text,
  endereco      text,
  observacoes   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clientes_owner" ON public.clientes;
CREATE POLICY "clientes_owner" ON public.clientes
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Colaboradores do escritório veem os clientes do titular
DROP POLICY IF EXISTS "clientes_shared_select" ON public.clientes;
CREATE POLICY "clientes_shared_select" ON public.clientes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = clientes.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

-- ── HONORÁRIOS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.honorarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente_id      uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  processo_id     uuid REFERENCES public.processos(id) ON DELETE SET NULL,
  descricao       text NOT NULL,
  tipo            text NOT NULL DEFAULT 'fixo',
    -- 'fixo' | 'exito' | 'hora' | 'recorrente'
  valor           numeric(12,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pendente',
    -- 'pendente' | 'pago' | 'vencido' | 'cancelado'
  data_vencimento date,
  data_pagamento  date,
  recorrente      boolean NOT NULL DEFAULT false,
  periodicidade   text,
    -- 'semanal' | 'quinzenal' | 'mensal' | 'bimestral' | 'trimestral' | 'anual'
  parcela_atual   int,
  parcelas_total  int,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.honorarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "honorarios_owner" ON public.honorarios;
CREATE POLICY "honorarios_owner" ON public.honorarios
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "honorarios_shared_select" ON public.honorarios;
CREATE POLICY "honorarios_shared_select" ON public.honorarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = honorarios.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

-- ── CAMPO cliente_id EM PROCESSOS ─────────────────────────
ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL;

-- ── RELOAD SCHEMA ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
