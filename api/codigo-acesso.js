// Validação e registro de uso de códigos de acesso (cadastro com convite).
//   POST /api/codigo-acesso?acao=validar   { codigo } -> { valido }
//   POST /api/codigo-acesso?acao=registrar { codigo } -> { ok }

import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const acao = req.query?.acao;
  if (acao === 'validar')   return validar(req, res);
  if (acao === 'registrar') return registrar(req, res);
  return res.status(400).json({ erro: 'acao inválida.' });
}

async function validar(req, res) {
  const { codigo } = req.body || {};
  if (!codigo) return res.status(400).json({ valido: false });
  if (!SUPA_SERVICE_KEY) return res.status(500).json({ valido: false });

  try {
    const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
    const { data } = await admin
      .from('codigos_acesso')
      .select('id, usos_max, usos_atual')
      .eq('codigo', codigo.toUpperCase().trim())
      .eq('ativo', true)
      .maybeSingle();

    if (!data) return res.json({ valido: false });
    if (data.usos_max != null && data.usos_atual >= data.usos_max) {
      return res.json({ valido: false });
    }

    return res.json({ valido: true });
  } catch (_) {
    return res.status(500).json({ valido: false });
  }
}

async function registrar(req, res) {
  const { codigo } = req.body || {};
  if (!codigo || !SUPA_SERVICE_KEY) return res.status(200).json({ ok: false });

  try {
    const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
    const { data } = await admin
      .from('codigos_acesso')
      .select('id, usos_atual, usado_em')
      .eq('codigo', codigo.toUpperCase().trim())
      .maybeSingle();

    if (data) {
      await admin.from('codigos_acesso').update({
        usos_atual: data.usos_atual + 1,
        usado_em:   data.usado_em || new Date().toISOString(),
      }).eq('id', data.id);
    }
    return res.status(200).json({ ok: true });
  } catch (_) {
    return res.status(200).json({ ok: false });
  }
}
