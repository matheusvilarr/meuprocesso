-- Corrige colisão: migration_quadro_compartilhamentos_v1.sql (versão antiga, já commitada)
-- recriava public.buscar_usuario_por_email(text) com parâmetro/retorno diferentes,
-- sobrescrevendo a função usada em "compartilhar processo" (migration_compartilhamentos.sql).
-- Rode este script SE VOCÊ JÁ EXECUTOU migration_quadro_compartilhamentos_v1.sql no Supabase
-- antes desta correção. Se ainda não rodou nenhuma das duas, pode ignorar este arquivo —
-- basta rodar a versão já corrigida de migration_quadro_compartilhamentos_v1.sql.

-- 1. Restaura a função original (compartilhar processo)
-- DROP necessário: se a versão com bug já rodou, o retorno virou TABLE e o Postgres
-- não deixa trocar o tipo de retorno via CREATE OR REPLACE (erro 42P13).
DROP FUNCTION IF EXISTS public.buscar_usuario_por_email(text);

CREATE OR REPLACE FUNCTION public.buscar_usuario_por_email(email_input TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id',    u.id,
    'email', u.email,
    'nome',  COALESCE(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1))
  )
  INTO result
  FROM auth.users u
  WHERE LOWER(u.email) = LOWER(TRIM(email_input))
    AND u.id != auth.uid()
  LIMIT 1;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_usuario_por_email(TEXT) TO authenticated;

-- 2. Recria a função do quadro com nome próprio (não colide mais)
CREATE OR REPLACE FUNCTION buscar_usuario_quadro_por_email(p_email text)
RETURNS TABLE (id uuid, nome text, email text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1))::text AS nome,
    u.email::text
  FROM auth.users u
  WHERE lower(u.email) = lower(p_email)
    AND u.id != auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION buscar_usuario_quadro_por_email(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
