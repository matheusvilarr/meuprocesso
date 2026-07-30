-- Captura nivelSigilo e grau, que o DataJud já manda na resposta mas a gente
-- não guardava. nivelSigilo é o dado real/confiável pra saber se um
-- processo é sigiloso (0 = público; >0 = algum grau de sigilo) — mais
-- confiável do que tentar adivinhar pelo que veio vazio.
ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS nivel_sigilo integer,
  ADD COLUMN IF NOT EXISTS grau         text;

NOTIFY pgrst, 'reload schema';
