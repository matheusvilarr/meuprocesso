import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { codigo } = req.body || {};
  if (!codigo || !SUPA_SERVICE_KEY) return res.status(200).json({ ok: false });

  try {
    const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
    const { data } = await admin
      .from('codigos_acesso')
      .select('id, usos_atual')
      .eq('codigo', codigo.toUpperCase().trim())
      .maybeSingle();

    if (data) {
      await admin.from('codigos_acesso').update({ usos_atual: data.usos_atual + 1 }).eq('id', data.id);
    }
    return res.status(200).json({ ok: true });
  } catch (_) {
    return res.status(200).json({ ok: false });
  }
}
