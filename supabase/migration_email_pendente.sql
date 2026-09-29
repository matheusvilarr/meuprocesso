-- ============================================================
-- Migração: e-mail separado do aviso no site (set/2026)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Antes: o envio do e-mail zerava notificacao_pendente, e o aviso de
-- "nova movimentação" sumia do site antes do advogado abrir o processo.
-- Agora: email_pendente controla só o e-mail; notificacao_pendente só
-- é limpo quando o advogado abre o processo.
--
-- Só ADICIONA uma coluna — não apaga nem altera nenhum dado existente
-- (o UPDATE abaixo só preenche a coluna nova). Roda numa transação.
-- ============================================================

BEGIN;

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS email_pendente boolean NOT NULL DEFAULT false;

-- Novidades que ainda não viraram e-mail (o fluxo antigo zerava
-- notificacao_pendente ao enviar, então todo "true" hoje ainda não foi enviado)
UPDATE public.processos SET email_pendente = true WHERE notificacao_pendente = true;

-- Trigger de segurança (migration_seguranca_v2): parceiro com nível
-- "comentario" também pode limpar email_pendente ao abrir o processo.
CREATE OR REPLACE FUNCTION public.proteger_processo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_nivel text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / crons

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Não é permitido transferir o processo para outra conta.';
  END IF;

  IF auth.uid() = OLD.user_id THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.colaboradores c
    WHERE c.user_id = auth.uid()
      AND c.escritorio_id = OLD.user_id
      AND c.status = 'ativo'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT pc.nivel_acesso INTO v_nivel
  FROM public.processo_compartilhamentos pc
  WHERE pc.processo_id = OLD.id
    AND pc.shared_with_id = auth.uid()
    AND pc.status = 'aceito'
  LIMIT 1;

  IF v_nivel = 'total' THEN RETURN NEW; END IF;

  IF (to_jsonb(NEW) - ARRAY['comentarios','historico','notificacao_pendente','email_pendente','novos_movimentos','updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['comentarios','historico','notificacao_pendente','email_pendente','novos_movimentos','updated_at']) THEN
    RAISE EXCEPTION 'Seu nível de acesso permite apenas comentar neste processo.';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
