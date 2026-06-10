// Upload de avatar server-side usando service key (evita RLS no Storage)
import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY    = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });
  if (!SUPA_SERVICE_KEY) return res.status(500).json({ erro: 'Servidor não configurado.' });

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autorizado.' });
  const token = authHeader.slice(7);

  // Verifica o token do usuário
  const userClient = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ erro: 'Token inválido.' });

  const { base64, contentType, ext } = req.body || {};
  if (!base64 || !contentType) return res.status(400).json({ erro: 'Dados inválidos.' });

  const buffer = Buffer.from(base64, 'base64');
  const path   = `${user.id}/avatar.${ext || 'jpg'}`;

  // Upload usando service key (bypassa RLS)
  const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
  const { error: upErr } = await admin.storage
    .from('avatars')
    .upload(path, buffer, { upsert: true, contentType });

  if (upErr) return res.status(500).json({ erro: upErr.message });

  const { data: urlData } = admin.storage.from('avatars').getPublicUrl(path);
  return res.status(200).json({ url: urlData.publicUrl + '?t=' + Date.now() });
}
