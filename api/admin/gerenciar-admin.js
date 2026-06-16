import { getAdminClient, requireAdmin } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (!adminUser) return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

  const { email, acao } = req.body || {}; // acao: 'promover' | 'remover'
  if (!email || !acao) return res.status(400).json({ erro: 'email e acao são obrigatórios.' });

  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const target = usersList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase().trim());
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  if (acao === 'promover') {
    const { error } = await admin
      .from('admins')
      .upsert({ user_id: target.id, criado_por: adminUser.user.id }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ erro: error.message });
  } else if (acao === 'remover') {
    if (target.id === adminUser.user.id) {
      return res.status(400).json({ erro: 'Você não pode remover seu próprio acesso admin.' });
    }
    const { error } = await admin.from('admins').delete().eq('user_id', target.id);
    if (error) return res.status(500).json({ erro: error.message });
  } else {
    return res.status(400).json({ erro: 'acao inválida.' });
  }

  return res.json({ ok: true });
}
