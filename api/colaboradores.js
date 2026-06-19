// Endpoints do workspace colaborativo (convite, aceite e busca de usuário por e-mail).
//   POST /api/colaboradores?acao=convidar   { email, cargo, nivel_acesso, processo_id }
//   POST /api/colaboradores?acao=aceitar    { token }
//   GET  /api/colaboradores?acao=buscar-usuario&email=...

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';

export default async function handler(req, res) {
  const acao = req.query?.acao;
  if (acao === 'convidar')       return convidar(req, res);
  if (acao === 'aceitar')        return aceitar(req, res);
  if (acao === 'buscar-usuario') return buscarUsuario(req, res);
  return res.status(400).json({ erro: 'acao inválida.' });
}

// Cria um convite de colaborador e retorna o link para o titular copiar.
// Usa JWT do titular — não precisa de service role key. Limite: 3 colaboradores ativos por escritório.
async function convidar(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado' });

  const token = auth.slice(7);

  const supaAnon = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: authErr } = await supaAnon.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ erro: 'Token inválido' });

  const { email, cargo = 'Advogado Associado', nivel_acesso = 'total', processo_id = null } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido' });
  }

  const supaAuth = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { count } = await supaAuth
    .from('colaboradores')
    .select('id', { count: 'exact', head: true })
    .eq('escritorio_id', user.id)
    .eq('status', 'ativo');

  if (count >= 3) {
    return res.status(422).json({ erro: 'Limite de 3 colaboradores por licença atingido.' });
  }

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

// Valida o token do convite e registra o colaborador via função SQL (sem service role key).
async function aceitar(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado' });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ erro: 'Token obrigatório' });

  const jwtToken = auth.slice(7);
  const supaAnon = createClient(SUPA_URL, SUPA_ANON_KEY);

  const { data: { user }, error: authErr } = await supaAnon.auth.getUser(jwtToken);
  if (authErr || !user) return res.status(401).json({ erro: 'Token de sessão inválido' });

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

  const SUPA_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
  let titularNome = 'Titular do escritório';
  if (SUPA_SVC_KEY) {
    const supaAdmin = createClient(SUPA_URL, SUPA_SVC_KEY);
    const { data: titularUser } = await supaAdmin.auth.admin.getUserById(data.escritorio_id);
    titularNome = titularUser?.user?.user_metadata?.full_name
      || titularUser?.user?.user_metadata?.nome
      || titularUser?.user?.email?.split('@')[0]
      || 'Titular do escritório';
  }

  return res.status(200).json({
    ok:             true,
    already_member: data.already_member || false,
    escritorio_id:  data.escritorio_id,
    titular_nome:   titularNome,
    cargo:          data.cargo,
  });
}

async function buscarUsuario(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const SUPA_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
  const { email } = req.query;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }

  const token = req.headers['authorization']?.slice(7);
  if (!token) return res.status(401).end();

  const userClient = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ erro: 'Token inválido.' });

  const supaAdmin = createClient(SUPA_URL, SUPA_SVC_KEY);

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
