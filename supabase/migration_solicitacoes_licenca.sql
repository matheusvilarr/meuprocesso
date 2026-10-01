-- ============================================================
-- Migração: o advogado pede a licença de dentro do sistema
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Por que existe: hoje, quando o teste de 7 dias acaba, o advogado cai numa
-- tela de cobrança e não tem o que fazer ali — a venda depende dele lembrar
-- de mandar um e-mail. Esta tabela transforma isso num pedido registrado:
-- ele escolhe o plano e clica, e o pedido aparece no painel admin.
--
-- O pagamento continua sendo combinado direto com você (Pix). Isto não cobra
-- nada e não integra com nenhum meio de pagamento — só registra a intenção
-- e o contato, para nenhuma venda se perder.
--
-- Só ACRESCENTA uma tabela. Não mexe em nada existente.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.solicitacoes_licenca (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plano          text NOT NULL CHECK (plano IN ('mensal','semestral','anual')),
  valor          numeric NOT NULL,
  status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','pago','cancelada')),
  -- preenchidos pelo advogado, para você ter como falar com ele
  telefone       text,
  observacao     text,
  -- preenchidos por você ao atender
  atendido_em    timestamptz,
  atendido_por   uuid REFERENCES auth.users(id),
  nota_interna   text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solicitacoes_licenca_pendentes_idx
  ON public.solicitacoes_licenca (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS solicitacoes_licenca_escritorio_idx
  ON public.solicitacoes_licenca (escritorio_id, criado_em DESC);

-- Um pedido pendente por escritório: sem isso, clicar duas vezes no botão
-- enchia o painel de pedidos repetidos do mesmo advogado.
CREATE UNIQUE INDEX IF NOT EXISTS solicitacoes_licenca_um_pendente_idx
  ON public.solicitacoes_licenca (escritorio_id)
  WHERE status = 'pendente';

ALTER TABLE public.solicitacoes_licenca ENABLE ROW LEVEL SECURITY;

-- O advogado vê os pedidos do próprio escritório (para a tela mostrar
-- "pedido enviado") e pode criar um. Não pode alterar nem apagar: quem
-- atende é você, pelo painel, com a chave de serviço.
DROP POLICY IF EXISTS "solicitacoes_ver_proprias" ON public.solicitacoes_licenca;
CREATE POLICY "solicitacoes_ver_proprias" ON public.solicitacoes_licenca
  FOR SELECT USING (auth.uid() = escritorio_id);

DROP POLICY IF EXISTS "solicitacoes_criar_propria" ON public.solicitacoes_licenca;
CREATE POLICY "solicitacoes_criar_propria" ON public.solicitacoes_licenca
  FOR INSERT WITH CHECK (
    auth.uid() = escritorio_id
    -- status e campos de atendimento não podem vir do cliente
    AND status = 'pendente'
    AND atendido_em IS NULL
    AND atendido_por IS NULL
    AND nota_interna IS NULL
  );

-- Pedir licença é justamente o que a pessoa faz quando a assinatura venceu,
-- então esta tabela NÃO entra na regra de "exige_assinatura"
-- (migration_assinatura_no_servidor.sql). Se entrasse, quem mais precisa
-- pedir seria o único que não conseguiria.

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ── CONFERÊNCIA ──────────────────────────────────────────────
-- Deve devolver 0 linhas, sem erro.
SELECT count(*) AS pedidos FROM public.solicitacoes_licenca;


-- ============================================================
-- COMO DESFAZER:
-- DROP TABLE IF EXISTS public.solicitacoes_licenca;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
