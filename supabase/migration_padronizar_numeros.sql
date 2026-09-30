-- ============================================================
-- Migração OPCIONAL: padroniza o número dos processos já cadastrados
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
--
-- NÃO é obrigatória. Desde 30/09/2026 o código grava sempre no formato do
-- CNJ e deriva o tribunal a partir dos 20 dígitos (com ou sem pontuação),
-- então os processos antigos já voltam sozinhos para a fila na próxima
-- execução do cron. Esta migração serve só para deixar o cadastro visualmente
-- uniforme e evitar duplicata futura.
--
-- Não apaga nada. Só reescreve o campo "numero" de
-- "07155530920268070020" para "0715553-09.2026.8.07.0020".
-- ============================================================

-- ── PASSO 1 (só leitura): existe o mesmo processo gravado nos dois formatos?
-- Se esta consulta devolver linhas, NÃO rode o passo 2 ainda — me mande o
-- resultado, porque aí é preciso decidir qual registro fica.
SELECT user_id,
       regexp_replace(numero, '\D', '', 'g') AS digitos,
       count(*)                              AS qtd,
       array_agg(numero)                     AS formatos,
       array_agg(id)                         AS ids
FROM public.processos
WHERE numero IS NOT NULL
  AND length(regexp_replace(numero, '\D', '', 'g')) = 20
GROUP BY user_id, regexp_replace(numero, '\D', '', 'g')
HAVING count(*) > 1;


-- ── PASSO 2: padroniza (rode só se o passo 1 não devolveu nada)
-- O WHERE NOT EXISTS é uma trava a mais: nenhuma linha é alterada se isso
-- fosse criar número repetido para o mesmo usuário.
BEGIN;

WITH alvo AS (
  SELECT p.id,
         regexp_replace(p.numero, '\D', '', 'g') AS d
  FROM public.processos p
  WHERE p.numero IS NOT NULL
    AND length(regexp_replace(p.numero, '\D', '', 'g')) = 20
    AND p.numero <> (
      substr(regexp_replace(p.numero, '\D', '', 'g'), 1, 7)  || '-' ||
      substr(regexp_replace(p.numero, '\D', '', 'g'), 8, 2)  || '.' ||
      substr(regexp_replace(p.numero, '\D', '', 'g'), 10, 4) || '.' ||
      substr(regexp_replace(p.numero, '\D', '', 'g'), 14, 1) || '.' ||
      substr(regexp_replace(p.numero, '\D', '', 'g'), 15, 2) || '.' ||
      substr(regexp_replace(p.numero, '\D', '', 'g'), 17, 4)
    )
)
UPDATE public.processos p
SET numero = substr(a.d,1,7)||'-'||substr(a.d,8,2)||'.'||substr(a.d,10,4)||'.'||
             substr(a.d,14,1)||'.'||substr(a.d,15,2)||'.'||substr(a.d,17,4)
FROM alvo a
WHERE p.id = a.id
  AND NOT EXISTS (
    SELECT 1 FROM public.processos x
    WHERE x.user_id = p.user_id
      AND x.id <> p.id
      AND x.numero = substr(a.d,1,7)||'-'||substr(a.d,8,2)||'.'||substr(a.d,10,4)||'.'||
                     substr(a.d,14,1)||'.'||substr(a.d,15,2)||'.'||substr(a.d,17,4)
  );

COMMIT;


-- ── PASSO 3 (conferência): quantos ainda estão fora do padrão?
-- O esperado é 0. Se sobrar algo, são números que não têm 20 dígitos
-- (cadastro incompleto) e precisam ser corrigidos a mão no sistema.
SELECT count(*) AS fora_do_padrao
FROM public.processos
WHERE numero IS NOT NULL AND numero <> ''
  AND numero !~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$';
