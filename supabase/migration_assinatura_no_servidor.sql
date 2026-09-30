-- ============================================================
-- Migração: assinatura passa a ser verificada no SERVIDOR
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- Hoje o bloqueio de assinatura vencida existe só na tela (auth-guard.js).
-- Quem está vencido continua conseguindo ler os dados chamando a API direto.
-- Esta migração fecha isso no banco.
--
-- Não apaga nem altera nenhum dado. Só ACRESCENTA uma regra de acesso por
-- tabela, sem mexer nas regras que já existem — por isso desfazer é simples
-- (o comando está no fim do arquivo).
--
-- Os crons NÃO são afetados: eles usam a chave de serviço, que passa por
-- cima de qualquer regra. O monitoramento continua rodando mesmo para quem
-- está vencido, então quando a pessoa pagar os dados estão em dia.
-- ============================================================


-- ── PASSO 1 (só leitura): QUEM PERDERIA ACESSO se isso fosse aplicado agora?
-- O esperado é NENHUMA LINHA. Se aparecer alguém, PARE e me avise.
SELECT u.email,
       u.raw_user_meta_data->>'full_name' AS nome,
       COALESCE(a.plano, '— sem assinatura —') AS plano,
       a.status,
       a.data_expiracao::date,
       (SELECT count(*) FROM public.processos p WHERE p.user_id = u.id) AS processos
FROM auth.users u
LEFT JOIN public.assinaturas a ON a.escritorio_id = u.id
WHERE NOT EXISTS (SELECT 1 FROM public.admins ad WHERE ad.user_id = u.id)
  AND (a.id IS NULL OR a.status <> 'ativo' OR a.data_expiracao <= now());


-- ── PASSO 2: aplicar (rode só se o passo 1 não devolveu ninguém)
BEGIN;

-- Precisa ser SECURITY DEFINER: para um processo compartilhado, é preciso
-- consultar a assinatura de OUTRO escritório, e a regra da tabela
-- assinaturas só deixa cada um ver a própria linha.
CREATE OR REPLACE FUNCTION public.assinatura_ativa(p_escritorio uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    -- administrador do sistema nunca é bloqueado
    EXISTS (SELECT 1 FROM public.admins ad WHERE ad.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.assinaturas a
      WHERE a.escritorio_id = p_escritorio
        AND a.status = 'ativo'
        AND a.data_expiracao > now()
    );
$$;

GRANT EXECUTE ON FUNCTION public.assinatura_ativa(uuid) TO authenticated;

-- AS RESTRICTIVE = soma-se às regras existentes em vez de substituí-las.
-- Ou seja: continua valendo tudo que já valia, E mais a assinatura ativa.
-- O dono do dado é sempre o escritório, então é a assinatura DELE que conta
-- (colaborador e parceiro seguem a assinatura do titular, como deve ser).

DROP POLICY IF EXISTS "exige_assinatura" ON public.processos;
CREATE POLICY "exige_assinatura" ON public.processos AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.tarefas;
CREATE POLICY "exige_assinatura" ON public.tarefas AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.eventos;
CREATE POLICY "exige_assinatura" ON public.eventos AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.clientes;
CREATE POLICY "exige_assinatura" ON public.clientes AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.honorarios;
CREATE POLICY "exige_assinatura" ON public.honorarios AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.prazos;
CREATE POLICY "exige_assinatura" ON public.prazos AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.processos_descobertos;
CREATE POLICY "exige_assinatura" ON public.processos_descobertos AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(user_id)) WITH CHECK (public.assinatura_ativa(user_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.documentos;
CREATE POLICY "exige_assinatura" ON public.documentos AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(escritorio_id)) WITH CHECK (public.assinatura_ativa(escritorio_id));

DROP POLICY IF EXISTS "exige_assinatura" ON public.quadros;
CREATE POLICY "exige_assinatura" ON public.quadros AS RESTRICTIVE FOR ALL
  USING (public.assinatura_ativa(escritorio_id)) WITH CHECK (public.assinatura_ativa(escritorio_id));


-- ── Documento enviado por parceiro: o DONO do processo não conseguia ver ──
-- O parceiro gravava o documento com o id do escritório DELE, então o dono
-- ficava sem acesso ao arquivo do próprio processo. Agora o documento é
-- gravado no escritório do dono (ver js/dashboard.js) e esta regra dá ao
-- parceiro com acesso total a permissão de ler e enviar nesse processo.
DROP POLICY IF EXISTS "documentos_parceiro" ON public.documentos;
CREATE POLICY "documentos_parceiro" ON public.documentos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = documentos.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
        AND pc.nivel_acesso   = 'total'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.processo_compartilhamentos pc
      WHERE pc.processo_id    = documentos.processo_id
        AND pc.shared_with_id = auth.uid()
        AND pc.status         = 'aceito'
        AND pc.nivel_acesso   = 'total'
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ── PASSO 3 (conferência): a função responde certo?
-- Rode logado no SQL Editor. Deve devolver "true" para a sua conta.
SELECT public.assinatura_ativa(id) AS tem_acesso,
       u.email
FROM auth.users u
ORDER BY u.email;


-- ============================================================
-- COMO DESFAZER (se algo der errado, cole e rode só isto):
--
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.processos;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.tarefas;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.eventos;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.clientes;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.honorarios;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.prazos;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.processos_descobertos;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.documentos;
-- DROP POLICY IF EXISTS "exige_assinatura" ON public.quadros;
-- NOTIFY pgrst, 'reload schema';
-- ============================================================
