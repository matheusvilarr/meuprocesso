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

    // listUsers devolve no máximo 1000 por página — sem paginar, a partir de
    // 1000 contas a checagem passaria a dizer "não existe" para todo mundo.
    let existe = false;
    for (let page = 1; page <= 50 && !existe; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
      if (error) return res.status(500).json({ erro: error.message });
      const lote = data?.users || [];
      existe = lote.some(u => oabsDoUsuario(u.user_metadata?.oab).includes(oab));
      if (lote.length < 1000) break;
    }

    return res.json({ existe });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

// Quem tem mais de uma OAB guarda assim: "GO 50723, DF 70946". Normalizar a
// string inteira dava "GO50723DF70946", que nunca batia com uma OAB sozinha —
// então a checagem de duplicidade simplesmente não funcionava para essas
// contas. Compara item por item.
function oabsDoUsuario(raw) {
  return String(raw || '').split(',').map(normalizarOab).filter(o => o.length >= 4);
}
