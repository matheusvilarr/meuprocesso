import { getAdminClient, requireAdmin } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (!adminUser) return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

  const { id, ativo } = req.body || {};
  if (!id) return res.status(400).json({ erro: 'id obrigatório.' });

  const { error } = await admin.from('codigos_acesso').update({ ativo: !!ativo }).eq('id', id);
  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true });
}
