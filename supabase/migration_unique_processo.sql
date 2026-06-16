-- Impede duplicação de processos pelo mesmo usuário/escritório.
-- Necessário rodar a limpeza de duplicatas existentes ANTES desta migration
-- (já foi feito manualmente em 2026-06-16 — 35 linhas duplicadas removidas).

create unique index if not exists processos_user_numero_unique
  on public.processos (user_id, numero)
  where numero is not null and numero <> '';
