// Cria um convite de colaborador e retorna o link para o titular copiar.
// Usa JWT do titular — não precisa de service role key.
// Limite: 3 colaboradores ativos por escritório.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado' });

  const token = auth.slice(7);

  // Verifica o usuário pelo JWT (anon key é suficiente para isso)
  const supaAnon = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: authErr } = await supaAnon.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ erro: 'Token inválido' });

  const { email, cargo = 'Advogado Associado', nivel_acesso = 'total', processo_id = null } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido' });
  }

  // Cliente autenticado como o titular (RLS permite que ele veja/crie seus próprios convites)
  const supaAuth = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Verifica limite de 3 colaboradores ativos
  const { count } = await supaAuth
    .from('colaboradores')
    .select('id', { count: 'exact', head: true })
    .eq('escritorio_id', user.id)
    .eq('status', 'ativo');

  if (count >= 3) {
    return res.status(422).json({ erro: 'Limite de 3 colaboradores por licença atingido.' });
  }

  // Verifica convite pendente para o mesmo e-mail
  const { data: existente } = await supaAuth
    .from('convites')
    .select('id, token, status')
    .eq('escritorio_id', user.id)
    .eq('email', email.toLowerCase())
    .eq('status', 'pendente')
    .maybeSingle();

  let inviteToken;

  if (existente) {
    inviteToken = existente.token;
    await supaAuth.from('convites').update({
      cargo,
      nivel_acesso,
      expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    }).eq('id', existente.id);
  } else {
    inviteToken = crypto.randomBytes(32).toString('hex');
    const { error } = await supaAuth.from('convites').insert({
      escritorio_id: user.id,
      email:         email.toLowerCase(),
      cargo,
      nivel_acesso,
      token:         inviteToken,
      processo_id:   processo_id || null,
    });
    if (error) return res.status(500).json({ erro: 'Erro ao criar convite: ' + error.message });
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3002';

  return res.status(200).json({
    ok:   true,
    link: `${baseUrl}/aceitar-convite?token=${inviteToken}`,
  });
}
