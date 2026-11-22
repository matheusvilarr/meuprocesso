-- ============================================================
-- Migração: aviso do sistema para os advogados (controlado pelo admin)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Por que existe: na pane do DataJud (nov/2026) o único jeito de avisar os
-- clientes era uma faixa automática no código — e uma regra automática não
-- sabe dosar o tom numa crise. Com esta tabela, o admin escreve o aviso no
-- painel (/admin → "Aviso aos advogados"), liga e desliga. Enquanto houver um
-- aviso ativo, a faixa automática do CNJ não aparece.
--
-- Só ACRESCENTA uma tabela. Não mexe em nada existente.
-- Antes de rodar, o site funciona normalmente — só não mostra aviso nenhum.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.avisos_sistema (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 120),
  mensagem      text NOT NULL CHECK (char_length(mensagem) BETWEEN 1 AND 600),
  nivel         text NOT NULL DEFAULT 'atencao' CHECK (nivel IN ('info', 'atencao', 'critico')),
  ativo         boolean NOT NULL DEFAULT true,
  criado_por    uuid REFERENCES auth.users(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  desativado_em timestamptz,
  desativado_por uuid REFERENCES auth.users(id)
);

-- Um aviso ativo por vez (o painel desativa o anterior ao publicar um novo);
-- os desativados ficam como histórico.
CREATE UNIQUE INDEX IF NOT EXISTS avisos_sistema_um_ativo_idx
  ON public.avisos_sistema (ativo) WHERE ativo;

ALTER TABLE public.avisos_sistema ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário logado lê o aviso ATIVO (é o que aparece na tela dele).
-- Escrita só pelo painel admin, com a chave de serviço (api/admin.js).
DROP POLICY IF EXISTS "avisos_sistema_ler_ativo" ON public.avisos_sistema;
CREATE POLICY "avisos_sistema_ler_ativo" ON public.avisos_sistema
  FOR SELECT TO authenticated USING (ativo);

-- Desde 30/10/2026 tabela nova precisa de GRANT explícito (ver CLAUDE.md).
GRANT SELECT ON public.avisos_sistema TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avisos_sistema TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ── CONFERÊNCIA ──────────────────────────────────────────────
-- Deve devolver 0, sem erro.
SELECT count(*) AS avisos FROM public.avisos_sistema;


-- ============================================================
-- COMO DESFAZER:
-- DROP TABLE IF EXISTS public.avisos_sistema;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
