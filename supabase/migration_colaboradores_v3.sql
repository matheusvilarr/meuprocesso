-- ============================================================
-- Migração v3: Função para aceitar convite sem service role key
-- Execute no SQL Editor do Supabase (projeto ctsjhsdblallguftycqs)
-- ============================================================

-- Permite que qualquer usuário leia convites pelo token (o token funciona como senha)
drop policy if exists "convites_leitura_token" on public.convites;
create policy "convites_leitura_token"
  on public.convites for select
  using (true);

-- Função SECURITY DEFINER: roda com permissões elevadas, bypassa RLS
-- Valida o token, cria o colaborador e marca o convite como aceito
create or replace function public.aceitar_convite_fn(p_token text, p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convite  record;
  v_count    int;
  v_ja_existe boolean;
begin
  -- Busca o convite pendente e não expirado
  select * into v_convite
  from public.convites
  where token = p_token
    and status = 'pendente'
    and expires_at > now();

  if not found then
    return json_build_object('ok', false, 'erro', 'Convite não encontrado ou já utilizado.');
  end if;

  -- Verifica se já é colaborador ativo
  select exists(
    select 1 from public.colaboradores
    where escritorio_id = v_convite.escritorio_id
      and user_id = p_user_id
      and status = 'ativo'
  ) into v_ja_existe;

  if v_ja_existe then
    return json_build_object(
      'ok', true,
      'already_member', true,
      'escritorio_id', v_convite.escritorio_id,
      'cargo', v_convite.cargo
    );
  end if;

  -- Verifica limite de 3 colaboradores
  select count(*) into v_count
  from public.colaboradores
  where escritorio_id = v_convite.escritorio_id and status = 'ativo';

  if v_count >= 3 then
    return json_build_object('ok', false, 'erro', 'O escritório atingiu o limite de 3 colaboradores.');
  end if;

  -- Cria o colaborador
  insert into public.colaboradores (escritorio_id, user_id, cargo, nivel_acesso, status, processo_id)
  values (v_convite.escritorio_id, p_user_id, v_convite.cargo, v_convite.nivel_acesso, 'ativo', v_convite.processo_id);

  -- Marca convite como aceito
  update public.convites set status = 'aceito' where id = v_convite.id;

  return json_build_object(
    'ok', true,
    'already_member', false,
    'escritorio_id', v_convite.escritorio_id,
    'cargo', v_convite.cargo
  );
end;
$$;

-- Permite que qualquer usuário autenticado chame a função
grant execute on function public.aceitar_convite_fn(text, uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
