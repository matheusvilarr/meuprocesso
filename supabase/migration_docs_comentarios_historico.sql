-- Migration: Documentos, Comentários e Histórico
-- Rode no SQL Editor do Supabase

-- Campos novos nos processos
ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS comentarios jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS historico   jsonb DEFAULT '[]'::jsonb;

-- Tabela de documentos (arquivos anexados)
CREATE TABLE IF NOT EXISTS public.documentos (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  processo_id   uuid        NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
  escritorio_id uuid        NOT NULL,
  nome          text        NOT NULL,
  storage_path  text        NOT NULL,
  tamanho       bigint      DEFAULT 0,
  tipo_mime     text        DEFAULT '',
  uploader_id   uuid        NOT NULL,
  uploader_nome text        NOT NULL DEFAULT '',
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documentos_escritorio" ON public.documentos
  FOR ALL USING (
    auth.uid() = escritorio_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores
      WHERE colaboradores.escritorio_id = documentos.escritorio_id
        AND colaboradores.user_id        = auth.uid()
        AND colaboradores.status         = 'ativo'
    )
  );

-- Recarregar schema do PostgREST após migration
NOTIFY pgrst, 'reload schema';
