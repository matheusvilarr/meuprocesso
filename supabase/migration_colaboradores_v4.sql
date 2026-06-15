-- Migração v4: salvar nome e email do colaborador para exibir avatar
alter table public.colaboradores add column if not exists nome  text;
alter table public.colaboradores add column if not exists email text;

-- Atualiza a função para receber e salvar nome/email
create or replace function public.aceitar_convite_fn(p_token text, p_user_id uuid, p_email text default null, p_nome text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convite   record;
  v_count     int;
  v_ja_existe boolean;
begin
  select * into v_convite
  from public.convites
  where token = p_token
    and status = 'pendente'
    and expires_at > now();

  if not found then
    return json_build_object('ok', false, 'erro', 'Convite não encontrado ou já utilizado.');
  end if;

  select exists(
    select 1 from public.colaboradores
    where escritorio_id = v_convite.escritorio_id
      and user_id = p_user_id
      and status = 'ativo'
  ) into v_ja_existe;

  if v_ja_existe then
    return json_build_object('ok', true, 'already_member', true, 'escritorio_id', v_convite.escritorio_id, 'cargo', v_convite.cargo);
  end if;

  select count(*) into v_count
  from public.colaboradores
  where escritorio_id = v_convite.escritorio_id and status = 'ativo';

  if v_count >= 3 then
    return json_build_object('ok', false, 'erro', 'O escritório atingiu o limite de 3 colaboradores.');
  end if;

  insert into public.colaboradores (escritorio_id, user_id, cargo, nivel_acesso, status, processo_id, email, nome)
  values (v_convite.escritorio_id, p_user_id, v_convite.cargo, v_convite.nivel_acesso, 'ativo', v_convite.processo_id, p_email, p_nome);

  update public.convites set status = 'aceito' where id = v_convite.id;

  return json_build_object('ok', true, 'already_member', false, 'escritorio_id', v_convite.escritorio_id, 'cargo', v_convite.cargo);
end;
$$;

grant execute on function public.aceitar_convite_fn(text, uuid, text, text) to authenticated;

NOTIFY pgrst, 'reload schema';
