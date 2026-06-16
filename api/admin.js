import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function getAdminClient() {
  return createClient(SUPA_URL, SUPA_SERVICE_KEY);
}

// Verifica o token do usuário logado e confirma que ele está na tabela admins.
// Retorna null se não for admin — nunca confiar em flags vindas do client.
async function requireAdmin(req, admin) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id, nivel')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (!adminRow) return null;
  return { user: userData.user, nivel: adminRow.nivel };
}

async function acaoDados(req, res, admin, adminUser) {
  const { data: usersList, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return res.status(500).json({ erro: usersErr.message });
  const users = usersList?.users || [];

  const { data: processosRows } = await admin
    .from('processos')
    .select('user_id')
    .neq('status', 'Arquivado');
  const contagem = {};
  for (const p of processosRows || []) {
    contagem[p.user_id] = (contagem[p.user_id] || 0) + 1;
  }

  const { data: adminsRows } = await admin.from('admins').select('user_id, nivel');
  const adminMap = {};
  for (const a of adminsRows || []) adminMap[a.user_id] = a.nivel;

  const advogados = users
    .map(u => ({
      id:           u.id,
      nome:         u.user_metadata?.full_name || u.user_metadata?.nome || '—',
      email:        u.email,
      oab:          u.user_metadata?.oab || '—',
      criadoEm:     u.created_at,
      ultimoLogin:  u.last_sign_in_at || null,
      bloqueado:    !!(u.banned_until && new Date(u.banned_until) > new Date()),
      numProcessos: contagem[u.id] || 0,
      nivelAdmin:   adminMap[u.id] || null,
    }))
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  const { data: codigos } = await admin
    .from('codigos_acesso')
    .select('id, codigo, descricao, ativo, usos_max, usos_atual, created_at')
    .order('created_at', { ascending: false });

  return res.json({ ok: true, advogados, codigos: codigos || [], meuNivel: adminUser.nivel });
}

async function acaoGerarCodigo(req, res, admin, adminUser) {
  const { descricao, usosMax } = req.body || {};
  const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();

  const { data, error } = await admin
    .from('codigos_acesso')
    .insert({
      codigo,
      descricao:  descricao || null,
      usos_max:   usosMax || null,
      criado_por: adminUser.user.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true, codigo: data });
}

async function acaoGerenciarAdmin(req, res, admin, adminUser) {
  const { email, tipo } = req.body || {}; // tipo: 'promover' | 'remover'
  if (!email || !tipo) return res.status(400).json({ erro: 'email e tipo são obrigatórios.' });

  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const target = usersList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase().trim());
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  if (tipo === 'promover') {
    const { error } = await admin
      .from('admins')
      .upsert({ user_id: target.id, criado_por: adminUser.user.id }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ erro: error.message });
  } else if (tipo === 'remover') {
    if (target.id === adminUser.user.id) {
      return res.status(400).json({ erro: 'Você não pode remover seu próprio acesso admin.' });
    }
    const { error } = await admin.from('admins').delete().eq('user_id', target.id);
    if (error) return res.status(500).json({ erro: error.message });
  } else {
    return res.status(400).json({ erro: 'tipo inválido.' });
  }

  return res.json({ ok: true });
}

async function acaoToggleCodigo(req, res, admin) {
  const { id, ativo } = req.body || {};
  if (!id) return res.status(400).json({ erro: 'id obrigatório.' });

  const { error } = await admin.from('codigos_acesso').update({ ativo: !!ativo }).eq('id', id);
  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true });
}

async function acaoToggleStatus(req, res, admin, adminUser) {
  const { userId, bloquear } = req.body || {};
  if (!userId) return res.status(400).json({ erro: 'userId obrigatório.' });
  if (userId === adminUser.user.id) {
    return res.status(400).json({ erro: 'Você não pode bloquear sua própria conta.' });
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: bloquear ? '876000h' : 'none',
  });
  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true });
}

export default async function handler(req, res) {
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (!adminUser) return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

  const acao = req.method === 'GET' ? req.query?.acao : (req.body || {}).acao;

  if (acao === 'dados') return acaoDados(req, res, admin, adminUser);

  if (req.method !== 'POST') return res.status(405).end();

  if (acao === 'gerar-codigo')     return acaoGerarCodigo(req, res, admin, adminUser);
  if (acao === 'gerenciar-admin')  return acaoGerenciarAdmin(req, res, admin, adminUser);
  if (acao === 'toggle-codigo')    return acaoToggleCodigo(req, res, admin);
  if (acao === 'toggle-status')    return acaoToggleStatus(req, res, admin, adminUser);

  return res.status(400).json({ erro: 'acao inválida.' });
}
