// Valida o token do convite e registra o colaborador via função SQL (sem service role key).

import { createClient } from '@supabase/supabase-js';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado' });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ erro: 'Token obrigatório' });

  const jwtToken  = auth.slice(7);
  const supaAnon  = createClient(SUPA_URL, SUPA_ANON_KEY);

  // Verifica o usuário logado
  const { data: { user }, error: authErr } = await supaAnon.auth.getUser(jwtToken);
  if (authErr || !user) return res.status(401).json({ erro: 'Token de sessão inválido' });

  // Chama a função SQL SECURITY DEFINER — bypassa RLS sem precisar de service role
  const supaAuth = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwtToken}` } },
  });

  const nomeUser = user.user_metadata?.full_name || user.user_metadata?.nome || user.email?.split('@')[0] || '';

  const { data, error } = await supaAuth.rpc('aceitar_convite_fn', {
    p_token:   token,
    p_user_id: user.id,
    p_email:   user.email || null,
    p_nome:    nomeUser || null,
  });

  if (error) return res.status(500).json({ erro: error.message });

  if (!data.ok) return res.status(422).json({ erro: data.erro });

  // Tenta buscar o nome do titular (melhor esforço)
  let titularNome = 'Titular';
  const { data: titularProc } = await supaAuth
    .from('processos')
    .select('user_id')
    .eq('user_id', data.escritorio_id)
    .limit(1)
    .maybeSingle();

  if (!titularProc) {
    // Fallback: busca pelo email na tabela auth via RPC não disponível — usa id truncado
    titularNome = 'Titular do escritório';
  }

  return res.status(200).json({
    ok:             true,
    already_member: data.already_member || false,
    escritorio_id:  data.escritorio_id,
    titular_nome:   titularNome,
    cargo:          data.cargo,
  });
}
