-- Migração v2 — adiciona colunas ausentes (não destrói dados existentes)
-- Execute este arquivo no SQL Editor do Supabase

-- processos: apelido (nome personalizado pelo advogado)
alter table public.processos add column if not exists apelido text;

alter table public.tarefas
  add column if not exists titulo    text,
  add column if not exists coluna    text default 'a_fazer',
  add column if not exists prazo     date;

-- Migra dados antigos se existirem
update public.tarefas set titulo = descricao where titulo is null and descricao is not null;
update public.tarefas set coluna = case
  when lower(status) like '%fazer%'      then 'a_fazer'
  when lower(status) like '%andamento%'  then 'em_andamento'
  when lower(status) like '%revis%'      then 'revisao'
  when lower(status) like '%conclu%'     then 'concluida'
  else 'a_fazer'
end where coluna is null or coluna = 'a_fazer';
