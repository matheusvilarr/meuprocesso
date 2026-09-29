-- ============================================================
-- Migração: Segurança v2 (set/2026)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- NÃO altera nem apaga nenhum dado: só troca políticas de acesso (RLS)
-- e adiciona triggers que BLOQUEIAM escritas indevidas. Tudo roda numa
-- transação — se qualquer comando falhar, nada é aplicado.
-- Triggers ignoram o service role (auth.uid() nulo), então os crons
-- continuam funcionando normalmente.
-- ============================================================

BEGIN;

-- ── 1. CONVITES ─────────────────────────────────────────────
-- A policy "convites_leitura_token" (USING true) deixava qualquer um ler
-- todos os tokens e entrar no escritório de outra pessoa. A aceitação
-- é feita pela função SECURITY DEFINER abaixo, que não precisa dela.
DROP POLICY IF EXISTS "convites_leitura_token" ON public.convites;

-- Versão antiga de 2 parâmetros ainda estava executável.
DROP FUNCTION IF EXISTS public.aceitar_convite_fn(text, uuid);

-- Mesma assinatura da v4, mas usa auth.uid() em vez de confiar no
-- p_user_id enviado pelo cliente.
CREATE OR REPLACE FUNCTION public.aceitar_convite_fn(p_token text, p_user_id uuid, p_email text default null, p_nome text default null)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_convite   record;
  v_count     int;
  v_ja_existe boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'Não autenticado.');
  END IF;

  SELECT * INTO v_convite
  FROM public.convites
  WHERE token = p_token
    AND status = 'pendente'
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'erro', 'Convite não encontrado ou já utilizado.');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.colaboradores
    WHERE escritorio_id = v_convite.escritorio_id
      AND user_id = v_uid
      AND status = 'ativo'
  ) INTO v_ja_existe;

  IF v_ja_existe THEN
    RETURN json_build_object('ok', true, 'already_member', true, 'escritorio_id', v_convite.escritorio_id, 'cargo', v_convite.cargo);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.colaboradores
  WHERE escritorio_id = v_convite.escritorio_id AND status = 'ativo';

  IF v_count >= 3 THEN
    RETURN json_build_object('ok', false, 'erro', 'O escritório atingiu o limite de 3 colaboradores.');
  END IF;

  INSERT INTO public.colaboradores (escritorio_id, user_id, cargo, nivel_acesso, status, processo_id, email, nome)
  VALUES (v_convite.escritorio_id, v_uid, v_convite.cargo, v_convite.nivel_acesso, 'ativo', v_convite.processo_id, p_email, p_nome);

  UPDATE public.convites SET status = 'aceito' WHERE id = v_convite.id;

  RETURN json_build_object('ok', true, 'already_member', false, 'escritorio_id', v_convite.escritorio_id, 'cargo', v_convite.cargo);
END;
$$;

GRANT EXECUTE ON FUNCTION public.aceitar_convite_fn(text, uuid, text, text) TO authenticated;


-- ── 2. COMPARTILHAMENTO DE PROCESSOS ────────────────────────
-- "comp_owner_all" só checava owner_id = auth.uid(): qualquer um podia
-- criar um compartilhamento de processo alheio para si mesmo, já aceito.
DROP POLICY IF EXISTS "comp_owner_all"    ON public.processo_compartilhamentos;
DROP POLICY IF EXISTS "comp_owner_select" ON public.processo_compartilhamentos;
DROP POLICY IF EXISTS "comp_owner_insert" ON public.processo_compartilhamentos;
DROP POLICY IF EXISTS "comp_owner_update" ON public.processo_compartilhamentos;
DROP POLICY IF EXISTS "comp_owner_delete" ON public.processo_compartilhamentos;

CREATE POLICY "comp_owner_select" ON public.processo_compartilhamentos
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "comp_owner_delete" ON public.processo_compartilhamentos
  FOR DELETE USING (auth.uid() = owner_id);

-- Só compartilha processo que é seu (ou do escritório onde é colaborador),
-- sempre começando como "pendente".
CREATE POLICY "comp_owner_insert" ON public.processo_compartilhamentos
  FOR INSERT WITH CHECK (
    auth.uid() = owner_id
    AND status = 'pendente'
    AND shared_with_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.processos p
      WHERE p.id = processo_id
        AND (
          p.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.colaboradores c
            WHERE c.user_id = auth.uid()
              AND c.escritorio_id = p.user_id
              AND c.status = 'ativo'
          )
        )
    )
  );

CREATE POLICY "comp_owner_update" ON public.processo_compartilhamentos
  FOR UPDATE USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Destinatário (policy "comp_shared_update" continua) só pode mudar o
-- status: antes podia trocar o próprio nível para "total" ou o processo_id.
CREATE OR REPLACE FUNCTION public.proteger_compartilhamento_processo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / crons

  IF NEW.processo_id    IS DISTINCT FROM OLD.processo_id
  OR NEW.owner_id       IS DISTINCT FROM OLD.owner_id
  OR NEW.shared_with_id IS DISTINCT FROM OLD.shared_with_id THEN
    RAISE EXCEPTION 'Não é permitido alterar processo, dono ou destinatário do compartilhamento.';
  END IF;

  IF auth.uid() = OLD.owner_id THEN RETURN NEW; END IF;

  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'Você só pode aceitar, recusar ou sair do compartilhamento.';
  END IF;
  IF NEW.status NOT IN ('aceito', 'recusado', 'saiu') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;
  -- Depois de revogado/recusado, só o dono pode reenviar o convite
  IF NEW.status = 'aceito' AND OLD.status NOT IN ('pendente', 'aceito') THEN
    RAISE EXCEPTION 'Este convite não está mais disponível.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proteger_compartilhamento_processo_trg ON public.processo_compartilhamentos;
CREATE TRIGGER proteger_compartilhamento_processo_trg
  BEFORE UPDATE ON public.processo_compartilhamentos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_compartilhamento_processo();


-- ── 3. COMPARTILHAMENTO DE PASTAS (QUADROS) ─────────────────
DROP POLICY IF EXISTS "qc_insert" ON public.quadro_compartilhamentos;
CREATE POLICY "qc_insert" ON public.quadro_compartilhamentos FOR INSERT WITH CHECK (
  dono_id = auth.uid()
  AND status = 'pendente'
  AND membro_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.quadros q
    WHERE q.id = quadro_id
      AND (
        q.escritorio_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.colaboradores c
          WHERE c.user_id = auth.uid()
            AND c.escritorio_id = q.escritorio_id
            AND c.status = 'ativo'
        )
      )
  )
);

-- Convidado (qc_update) só pode aceitar/recusar — antes podia trocar o
-- quadro_id e ganhar acesso a qualquer outra pasta.
CREATE OR REPLACE FUNCTION public.proteger_compartilhamento_quadro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Você só pode aceitar ou recusar o convite da pasta.';
  END IF;
  IF NEW.status NOT IN ('aceito', 'recusado') THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proteger_compartilhamento_quadro_trg ON public.quadro_compartilhamentos;
CREATE TRIGGER proteger_compartilhamento_quadro_trg
  BEFORE UPDATE ON public.quadro_compartilhamentos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_compartilhamento_quadro();


-- ── 4. PROCESSOS ────────────────────────────────────────────
-- (a) Ninguém (além do service role) pode trocar o dono (user_id) de um
--     processo — antes um parceiro com acesso podia "tomar" o processo.
-- (b) Parceiro com nível "comentario" só pode mexer em comentários/histórico.
--     Dono, colaboradores do escritório e parceiros "total" não são afetados.
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

  IF (to_jsonb(NEW) - ARRAY['comentarios','historico','notificacao_pendente','novos_movimentos','updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['comentarios','historico','notificacao_pendente','novos_movimentos','updated_at']) THEN
    RAISE EXCEPTION 'Seu nível de acesso permite apenas comentar neste processo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proteger_processo_trg ON public.processos;
CREATE TRIGGER proteger_processo_trg
  BEFORE UPDATE ON public.processos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_processo();


-- ── 5. FILA DJEN ────────────────────────────────────────────
-- Estava sem RLS (acessível com a chave pública). Só o service role
-- (cron e painel admin) usa essa tabela, e ele ignora RLS.
ALTER TABLE public.djen_cadernos_fila ENABLE ROW LEVEL SECURITY;


NOTIFY pgrst, 'reload schema';

COMMIT;

-- Conferência (opcional, rode depois): deve listar as novas policies/triggers
-- SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('convites','processo_compartilhamentos','quadro_compartilhamentos') ORDER BY 1,2;
-- SELECT event_object_table, trigger_name FROM information_schema.triggers
--   WHERE trigger_name LIKE 'proteger_%';
