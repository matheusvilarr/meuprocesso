// Verifica se um número de OAB já está cadastrado em outra conta — usado no
// cadastro pra evitar que o mesmo advogado crie várias contas (e vários
// trials) com a mesma OAB só formatada diferente.
//   GET /api/verificar-oab?oab=SP123456 -> { existe: true|false }

import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function normalizarOab(oab) {
  return String(oab || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const oab = normalizarOab(req.query?.oab);
  if (!oab || oab.length < 4) return res.status(400).json({ erro: 'OAB inválida.' });
  if (!SUPA_SERVICE_KEY) return res.status(500).json({ erro: 'Configuração ausente.' });

  try {
    const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) return res.status(500).json({ erro: error.message });

    const existe = (data?.users || []).some(u => normalizarOab(u.user_metadata?.oab) === oab);
    return res.json({ existe });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
