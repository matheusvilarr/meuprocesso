-- ============================================================
-- Migração v2: compartilhamentos — correções e expansão
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- 1. Adicionar status 'saiu' ao CHECK constraint
ALTER TABLE public.processo_compartilhamentos
  DROP CONSTRAINT IF EXISTS processo_compartilhamentos_status_check;

ALTER TABLE public.processo_compartilhamentos
  ADD CONSTRAINT processo_compartilhamentos_status_check
  CHECK (status IN ('pendente', 'aceito', 'recusado', 'saiu'));

-- 2. Coluna updated_at para rastrear quando o status mudou
ALTER TABLE public.processo_compartilhamentos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 3. RLS para eventos de processo compartilhado
--    (habilita RLS caso ainda não esteja ativo)
ALTER TABLE IF EXISTS public.eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eventos_shared_select" ON public.eventos;
CREATE POLICY "eventos_shared_select" ON public.eventos
  FOR SELECT USING (
    processo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = eventos.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
    )
  );

-- 4. RLS para tarefas de processo compartilhado
DROP POLICY IF EXISTS "tarefas_shared_select" ON public.tarefas;
CREATE POLICY "tarefas_shared_select" ON public.tarefas
  FOR SELECT USING (
    processo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = tarefas.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
    )
  );

-- 5. RLS para prazos de processo compartilhado
DROP POLICY IF EXISTS "prazos_shared_select" ON public.prazos;
CREATE POLICY "prazos_shared_select" ON public.prazos
  FOR SELECT USING (
    processo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = prazos.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
    )
  );

-- 6. Função RPC: retorna convites pendentes com dados do processo
--    (SECURITY DEFINER para bypassar RLS e ler processos do dono)
CREATE OR REPLACE FUNCTION public.buscar_convites_pendentes()
RETURNS TABLE (
  id              uuid,
  processo_id     uuid,
  processo_nome   text,
  processo_numero text,
  cliente_nome    text,
  owner_nome      text,
  owner_id        uuid,
  nivel_acesso    text,
  created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.id,
    pc.processo_id,
    COALESCE(p.apelido, p.nome, 'Processo')::text  AS processo_nome,
    COALESCE(p.numero, '')::text                    AS processo_numero,
    COALESCE(p.cliente, '')::text                   AS cliente_nome,
    pc.owner_nome,
    pc.owner_id,
    pc.nivel_acesso,
    pc.created_at
  FROM public.processo_compartilhamentos pc
  LEFT JOIN public.processos p ON p.id = pc.processo_id
  WHERE pc.shared_with_id = auth.uid()
    AND pc.status = 'pendente';
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_convites_pendentes() TO authenticated;

-- Recarregar schema do PostgREST
NOTIFY pgrst, 'reload schema';
