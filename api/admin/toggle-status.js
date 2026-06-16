import { getAdminClient, requireAdmin } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (!adminUser) return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

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
