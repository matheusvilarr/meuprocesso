import { createClient } from '@supabase/supabase-js';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const SUPA_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
  const { email } = req.query;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }

  // Valida que o solicitante é um usuário autenticado
  const token = req.headers['authorization']?.slice(7);
  if (!token) return res.status(401).end();

  const userClient = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ erro: 'Token inválido.' });

  const supaAdmin = createClient(SUPA_URL, SUPA_SVC_KEY);

  // Lista usuários e filtra pelo e-mail (plataforma pequena, funciona bem)
  const { data: { users }, error } = await supaAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return res.status(500).json({ erro: error.message });

  const found = (users || []).find(u => u.email?.toLowerCase() === email.toLowerCase().trim());

  if (!found) {
    return res.status(404).json({ erro: 'Usuário não encontrado. Verifique se o e-mail está cadastrado na plataforma.' });
  }
  if (found.id === user.id) {
    return res.status(400).json({ erro: 'Você não pode compartilhar um processo com você mesmo.' });
  }

  return res.status(200).json({
    id:    found.id,
    email: found.email,
    nome:  found.user_metadata?.nome || found.email.split('@')[0],
  });
}
