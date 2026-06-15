-- ============================================================
-- Migração: Workspace Colaborativo — Fase 1
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- NÃO destrói dados existentes
-- ============================================================

-- 1. Recriar tabela colaboradores com user_id real
drop table if exists public.colaboradores cascade;

create table public.colaboradores (
  id            uuid        primary key default gen_random_uuid(),
  escritorio_id uuid        references auth.users not null,  -- titular (dono)
  user_id       uuid        references auth.users,           -- colaborador (conta real)
  cargo         text        default 'Advogado Associado',
  nivel_acesso  text        default 'total',                 -- total | restrito
  status        text        default 'ativo',                 -- ativo | removido
  created_at    timestamptz default now()
);

-- 2. Tabela de convites
create table if not exists public.convites (
  id            uuid        primary key default gen_random_uuid(),
  escritorio_id uuid        references auth.users not null,
  email         text        not null,
  cargo         text        default 'Advogado Associado',
  nivel_acesso  text        default 'total',
  token         text        not null unique,
  status        text        default 'pendente',              -- pendente | aceito | expirado
  expires_at    timestamptz default (now() + interval '7 days'),
  created_at    timestamptz default now()
);

-- 3. RLS
alter table public.colaboradores enable row level security;
alter table public.convites      enable row level security;

drop policy if exists "colaboradores_escritorio" on public.colaboradores;
drop policy if exists "convites_escritorio"      on public.convites;

-- Titular vê/gerencia seus colaboradores; colaborador vê seu próprio registro
create policy "colaboradores_escritorio"
  on public.colaboradores for all
  using (auth.uid() = escritorio_id OR auth.uid() = user_id)
  with check (auth.uid() = escritorio_id);

-- Titular gerencia seus convites; qualquer um pode ler pelo token (via service role no aceitar-convite)
create policy "convites_escritorio"
  on public.convites for all
  using (auth.uid() = escritorio_id)
  with check (auth.uid() = escritorio_id);

-- 4. Atualizar RLS de processos para colaboradores verem dados do titular
drop policy if exists "processos_proprio_usuario" on public.processos;

create policy "processos_escritorio"
  on public.processos for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = processos.user_id
        AND c.status = 'ativo'
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = processos.user_id
        AND c.status = 'ativo'
    )
  );

-- 5. Mesma lógica para tarefas e prazos
drop policy if exists "tarefas_proprio_usuario" on public.tarefas;

create policy "tarefas_escritorio"
  on public.tarefas for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = tarefas.user_id
        AND c.status = 'ativo'
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = tarefas.user_id
        AND c.status = 'ativo'
    )
  );

drop policy if exists "prazos_proprio_usuario" on public.prazos;

create policy "prazos_escritorio"
  on public.prazos for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = prazos.user_id
        AND c.status = 'ativo'
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = prazos.user_id
        AND c.status = 'ativo'
    )
  );

-- 6. Mesma lógica para eventos (calendário / prazos)
drop policy if exists "eventos_proprio_usuario" on public.eventos;

create policy "eventos_escritorio"
  on public.eventos for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = eventos.user_id
        AND c.status = 'ativo'
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = eventos.user_id
        AND c.status = 'ativo'
    )
  );

-- Recarregar cache do PostgREST
NOTIFY pgrst, 'reload schema';
