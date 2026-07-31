-- Fila de processamento dos "cadernos" diários do DJEN (1 download = todas as
-- comunicações de um tribunal no dia, em vez de 1 requisição por OAB por
-- usuário — evita o limite de 20 req/min por IP da API e escala independente
-- do número de usuários). Ver api/cron/djen-cadernos.js.
CREATE TABLE IF NOT EXISTS public.djen_cadernos_fila (
  id                     bigserial PRIMARY KEY,
  tribunal               text NOT NULL,
  data                   date NOT NULL,
  status                 text NOT NULL DEFAULT 'pendente', -- pendente | processando | concluido | erro
  comunicacoes_encontradas integer,
  tentativas             integer NOT NULL DEFAULT 0,
  erro_msg               text,
  iniciado_em            timestamptz,
  concluido_em           timestamptz,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tribunal, data)
);

CREATE INDEX IF NOT EXISTS idx_djen_cadernos_fila_status ON public.djen_cadernos_fila (status, criado_em);

NOTIFY pgrst, 'reload schema';
