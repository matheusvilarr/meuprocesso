-- ============================================================
-- MEU PROCESSO — Schema v2 com monitoramento DataJud + RLS
-- Rode no SQL Editor do Supabase
-- ============================================================

-- 1. LIMPAR TABELAS ANTIGAS (ordem inversa de dependência)
drop table if exists public.tarefas       cascade;
drop table if exists public.prazos        cascade;
drop table if exists public.colaboradores cascade;
drop table if exists public.processos     cascade;

-- 2. TABELAS

-- PROCESSOS
create table public.processos (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        references auth.users not null,
  -- Dados básicos
  numero                text,
  nome                  text        not null,
  cliente               text,
  parte_contraria       text,
  area                  text,
  status                text        default 'Ativo',
  -- Dados do DataJud (preenchidos na importação)
  tribunal              text,
  datajud_index         text,        -- ex: api_publica_tjdft
  classe                text,
  orgao_julgador        text,
  data_ajuizamento      date,
  -- Monitoramento de atualizações
  movimentos_recentes   jsonb,       -- array dos últimos movimentos
  movimentos_hash       text,        -- string para detectar mudanças
  ultima_verificacao    timestamptz,
  notificacao_pendente  boolean      default false,
  novos_movimentos      jsonb,       -- movimentos novos desde última leitura
  -- Metadados
  apelido               text,        -- nome personalizado pelo usuário
  valor_causa           numeric,
  vara                  text,
  notas_manuais         jsonb        default '[]'::jsonb,  -- notas adicionadas pelo advogado
  created_at            timestamptz  default now(),
  updated_at            timestamptz  default now()
);

-- PRAZOS
create table public.prazos (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        references auth.users not null,
  processo_id    uuid        references public.processos on delete cascade,
  descricao      text        not null,
  tipo           text        default 'Prazo Processual',
  data_prazo     date        not null,
  urgencia       text        default 'Média',
  notificar_dias int         default 1,
  created_at     timestamptz default now()
);

-- TAREFAS
create table public.tarefas (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users not null,
  processo_id uuid        references public.processos on delete set null,
  titulo      text        not null,
  coluna      text        default 'a_fazer',  -- a_fazer | em_andamento | revisao | concluida
  prioridade  text        default 'baixa',    -- baixa | media | urgente
  prazo       date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- COLABORADORES
create table public.colaboradores (
  id            uuid        primary key default gen_random_uuid(),
  escritorio_id uuid        references auth.users not null,
  nome          text        not null,
  email         text        not null,
  oab           text,
  cargo         text        default 'Advogado Associado',
  created_at    timestamptz default now()
);

-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.processos     enable row level security;
alter table public.prazos        enable row level security;
alter table public.tarefas       enable row level security;
alter table public.colaboradores enable row level security;

-- Políticas (drop first to avoid duplicates on re-run)
drop policy if exists "processos_proprio_usuario"        on public.processos;
drop policy if exists "prazos_proprio_usuario"           on public.prazos;
drop policy if exists "tarefas_proprio_usuario"          on public.tarefas;
drop policy if exists "colaboradores_proprio_escritorio" on public.colaboradores;

create policy "processos_proprio_usuario"
  on public.processos for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "prazos_proprio_usuario"
  on public.prazos for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "tarefas_proprio_usuario"
  on public.tarefas for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "colaboradores_proprio_escritorio"
  on public.colaboradores for all
  using (auth.uid() = escritorio_id) with check (auth.uid() = escritorio_id);

-- ============================================================
-- 4. TRIGGER updated_at
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists processos_updated_at on public.processos;
create trigger processos_updated_at
  before update on public.processos
  for each row execute procedure public.set_updated_at();
