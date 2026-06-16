import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export function getAdminClient() {
  return createClient(SUPA_URL, SUPA_SERVICE_KEY);
}

// Verifica o token do usuário logado e confirma que ele está na tabela admins.
// Retorna null se não for admin — nunca confiar em flags vindas do client.
export async function requireAdmin(req, admin) {
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
