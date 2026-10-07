-- ============================================================
-- Migração: Fila de conversão STJ (AREsp/REsp -> número CNJ)
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- Só aditivo — não apaga nem altera dados existentes
-- ============================================================

-- 1. Fila: números no formato tradicional do STJ/STF (ex: "AREsp 3254978")
-- que o advogado colou na busca. Um worker local (fora da Vercel, roda
-- navegador real) resolve pro número único CNJ via scraping do site do
-- tribunal, porque a API pública do DataJud só aceita o número unificado.
create table if not exists public.fila_consulta_stj (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        references auth.users not null,
  entrada_original        text        not null,              -- "AREsp 2722519 - AL", como o advogado digitou
  termo_busca             text        not null,               -- "AREsp 2722519" normalizado, usado na consulta
  tribunal                text        not null default 'stj', -- 'stj' | 'stf' (stf ainda não implementado)
  status                  text        not null default 'pendente',
    -- pendente | processando | resolvido | nao_encontrado | erro | importado
  numero_cnj              text,                               -- "NÚMERO ÚNICO" resolvido
  classe_descricao        text,                                -- ex: "AREsp nº 3254978 / AL"
  numero_registro_tribunal text,                               -- ex: "2026/0177615-0"
  processo_id             uuid        references public.processos(id),
  erro_mensagem           text,
  criado_em               timestamptz not null default now(),
  processado_em           timestamptz,
  unique (user_id, termo_busca)
);

alter table public.fila_consulta_stj enable row level security;

drop policy if exists "fila_consulta_stj_escritorio" on public.fila_consulta_stj;

-- Mesmo padrão de processos/tarefas: dono do escritório + colaboradores ativos
create policy "fila_consulta_stj_escritorio"
  on public.fila_consulta_stj for all
  using (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = fila_consulta_stj.user_id
        AND c.status = 'ativo'
    )
  )
  with check (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.colaboradores c
      WHERE c.user_id = auth.uid()
        AND c.escritorio_id = fila_consulta_stj.user_id
        AND c.status = 'ativo'
    )
  );

create index if not exists fila_consulta_stj_pendente_idx
  on public.fila_consulta_stj (status) where status = 'pendente';

-- 2. Campos novos em processos: o número de registro no STJ/STF (ex: "AREsp
-- 3254978") é usado pelo advogado pra consultar direto no site do tribunal —
-- nunca é apagado por um sync normal, porque nenhum código escreve nessa
-- coluna fora do fluxo da fila. aviso_stj_pendente liga quando a importação
-- automática acontece e desliga quando o advogado vê o aviso no dashboard.
alter table public.processos
  add column if not exists numero_registro_superior text,
  add column if not exists aviso_stj_pendente boolean not null default false;

NOTIFY pgrst, 'reload schema';
