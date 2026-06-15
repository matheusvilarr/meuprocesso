-- ============================================================
-- Migração v2: Convite por processo específico
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- Adiciona processo_id em colaboradores e convites (NULL = acesso total ao escritório)
alter table public.colaboradores add column if not exists processo_id uuid references public.processos;
alter table public.convites      add column if not exists processo_id uuid references public.processos;

-- Atualiza RLS de processos: colaborador por processo só vê aquele processo
drop policy if exists "processos_escritorio" on public.processos;

create policy "processos_escritorio"
  on public.processos for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = processos.user_id
        AND c.status = 'ativo'
        AND (c.processo_id IS NULL OR c.processo_id = processos.id)
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = processos.user_id
        AND c.status = 'ativo'
        AND c.processo_id IS NULL
    )
  );

-- Tarefas: acesso total se processo_id IS NULL, senão só tarefas do processo
drop policy if exists "tarefas_escritorio" on public.tarefas;

create policy "tarefas_escritorio"
  on public.tarefas for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = tarefas.user_id
        AND c.status = 'ativo'
        AND (c.processo_id IS NULL OR c.processo_id = tarefas.processo_id)
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = tarefas.user_id
        AND c.status = 'ativo'
        AND (c.processo_id IS NULL OR c.processo_id = tarefas.processo_id)
    )
  );

-- Eventos: mesmo padrão
drop policy if exists "eventos_escritorio" on public.eventos;

create policy "eventos_escritorio"
  on public.eventos for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = eventos.user_id
        AND c.status = 'ativo'
        AND (c.processo_id IS NULL OR c.processo_id = eventos.processo_id)
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = eventos.user_id
        AND c.status = 'ativo'
        AND (c.processo_id IS NULL OR c.processo_id = eventos.processo_id)
    )
  );

-- Prazos não têm processo_id — colaboradores por processo não acessam prazos globais
drop policy if exists "prazos_escritorio" on public.prazos;

create policy "prazos_escritorio"
  on public.prazos for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = prazos.user_id
        AND c.status = 'ativo'
        AND c.processo_id IS NULL
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = prazos.user_id
        AND c.status = 'ativo'
        AND c.processo_id IS NULL
    )
  );

NOTIFY pgrst, 'reload schema';
