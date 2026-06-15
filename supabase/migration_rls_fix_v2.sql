-- ============================================================
-- Fix RLS v2: adiciona políticas de INSERT para colaboradores
-- e garante que todas as políticas estão corretas
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- ── HONORÁRIOS ────────────────────────────────────────────

DROP POLICY IF EXISTS "honorarios_owner"         ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_select"        ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_insert"        ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_update"        ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_delete"        ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_shared_select" ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_collab_insert" ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_collab_update" ON public.honorarios;
DROP POLICY IF EXISTS "honorarios_collab_delete" ON public.honorarios;

-- Owner: acesso total
CREATE POLICY "honorarios_select" ON public.honorarios
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "honorarios_insert" ON public.honorarios
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "honorarios_update" ON public.honorarios
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "honorarios_delete" ON public.honorarios
  FOR DELETE USING (user_id = auth.uid());

-- Colaboradores: leitura
CREATE POLICY "honorarios_shared_select" ON public.honorarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = honorarios.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

-- Colaboradores: escrita (inserem dados com user_id = escritório do titular)
CREATE POLICY "honorarios_collab_insert" ON public.honorarios
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = honorarios.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

CREATE POLICY "honorarios_collab_update" ON public.honorarios
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = honorarios.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

CREATE POLICY "honorarios_collab_delete" ON public.honorarios
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = honorarios.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.honorarios TO authenticated;

-- ── CLIENTES ──────────────────────────────────────────────

DROP POLICY IF EXISTS "clientes_owner"         ON public.clientes;
DROP POLICY IF EXISTS "clientes_select"        ON public.clientes;
DROP POLICY IF EXISTS "clientes_insert"        ON public.clientes;
DROP POLICY IF EXISTS "clientes_update"        ON public.clientes;
DROP POLICY IF EXISTS "clientes_delete"        ON public.clientes;
DROP POLICY IF EXISTS "clientes_shared_select" ON public.clientes;
DROP POLICY IF EXISTS "clientes_collab_insert" ON public.clientes;
DROP POLICY IF EXISTS "clientes_collab_update" ON public.clientes;
DROP POLICY IF EXISTS "clientes_collab_delete" ON public.clientes;

-- Owner: acesso total
CREATE POLICY "clientes_select" ON public.clientes
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "clientes_insert" ON public.clientes
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "clientes_update" ON public.clientes
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "clientes_delete" ON public.clientes
  FOR DELETE USING (user_id = auth.uid());

-- Colaboradores: leitura
CREATE POLICY "clientes_shared_select" ON public.clientes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = clientes.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

-- Colaboradores: escrita
CREATE POLICY "clientes_collab_insert" ON public.clientes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = clientes.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

CREATE POLICY "clientes_collab_update" ON public.clientes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = clientes.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

CREATE POLICY "clientes_collab_delete" ON public.clientes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.escritorio_id = clientes.user_id
        AND c.user_id       = auth.uid()
        AND c.status        = 'ativo'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;

-- ── RELOAD SCHEMA ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
