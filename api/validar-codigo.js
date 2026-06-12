import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { codigo } = req.body || {};
  if (!codigo) return res.status(400).json({ valido: false });

  if (!SUPA_SERVICE_KEY) return res.status(500).json({ valido: false });

  try {
    const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
    const { data } = await admin
      .from('codigos_acesso')
      .select('id')
      .eq('codigo', codigo.toUpperCase().trim())
      .eq('ativo', true)
      .maybeSingle();

    return res.json({ valido: !!data });
  } catch (_) {
    return res.status(500).json({ valido: false });
  }
}
