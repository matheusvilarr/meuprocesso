import { getAdminClient, requireAdmin } from './_lib.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (!adminUser) return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

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
