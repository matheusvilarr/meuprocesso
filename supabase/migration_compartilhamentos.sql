-- ============================================================
-- Migração: Compartilhamento de Processos (peer-to-peer)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- 1. Tabela de compartilhamentos
CREATE TABLE IF NOT EXISTS public.processo_compartilhamentos (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  processo_id       uuid        NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
  owner_id          uuid        NOT NULL,
  owner_nome        text        NOT NULL DEFAULT '',
  shared_with_id    uuid        NOT NULL,
  shared_with_email text        NOT NULL DEFAULT '',
  shared_with_nome  text        NOT NULL DEFAULT '',
  nivel_acesso      text        NOT NULL DEFAULT 'leitura'
                                CHECK (nivel_acesso IN ('leitura', 'comentario', 'total')),
  status            text        NOT NULL DEFAULT 'pendente'
                                CHECK (status IN ('pendente', 'aceito', 'recusado')),
  created_at        timestamptz DEFAULT now(),
  UNIQUE(processo_id, shared_with_id)
);

ALTER TABLE public.processo_compartilhamentos ENABLE ROW LEVEL SECURITY;

-- Owner: controle total sobre os compartilhamentos que criou
CREATE POLICY "comp_owner_all" ON public.processo_compartilhamentos
  FOR ALL USING (auth.uid() = owner_id);

-- Destinatário: pode ver os compartilhamentos que recebeu
CREATE POLICY "comp_shared_select" ON public.processo_compartilhamentos
  FOR SELECT USING (auth.uid() = shared_with_id);

-- Destinatário: pode atualizar o status (aceitar/recusar)
CREATE POLICY "comp_shared_update" ON public.processo_compartilhamentos
  FOR UPDATE USING (auth.uid() = shared_with_id)
  WITH CHECK (auth.uid() = shared_with_id);

-- 2. Acesso SELECT nos processos compartilhados (compartilhamento aceito)
CREATE POLICY "processos_shared_select" ON public.processos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = processos.id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
    )
  );

-- 3. Acesso UPDATE nos processos (para comentarios/historico jsonb)
--    Apenas níveis 'comentario' e 'total'
CREATE POLICY "processos_shared_update" ON public.processos
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = processos.id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
        AND pc.nivel_acesso  IN ('comentario', 'total')
    )
  );

-- 4. Acesso nos documentos (apenas nível 'total') — tabela não existe ainda, ignorar
-- CREATE POLICY "documentos_shared" ON public.documentos ...

-- 5. Função RPC para buscar usuário por e-mail (sem precisar de service role)
CREATE OR REPLACE FUNCTION public.buscar_usuario_por_email(email_input TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id',    u.id,
    'email', u.email,
    'nome',  COALESCE(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1))
  )
  INTO result
  FROM auth.users u
  WHERE LOWER(u.email) = LOWER(TRIM(email_input))
    AND u.id != auth.uid()
  LIMIT 1;

  RETURN result;  -- NULL se não encontrado
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_usuario_por_email(TEXT) TO authenticated;

-- Recarregar schema do PostgREST
NOTIFY pgrst, 'reload schema';
