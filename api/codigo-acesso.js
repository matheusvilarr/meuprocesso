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
  const { codigo, email } = req.body || {};
  if (!codigo || !SUPA_SERVICE_KEY) return res.status(200).json({ ok: false });

  // Esta rota é pública por necessidade: ela roda logo depois do signUp, e
  // nesse instante ainda não existe sessão (o e-mail não foi confirmado).
  // Por isso ela NÃO pode aceitar só o código: antes, qualquer pessoa que
  // soubesse um código conseguia marcá-lo como usado e queimar o convite de
  // outra pessoa. Agora só marca se a conta daquele e-mail existir de fato —
  // isso é checado aqui no servidor e não pode ser fingido pelo navegador.
  const emailNorm = String(email || '').toLowerCase().trim();
  if (!emailNorm) return res.status(400).json({ ok: false, erro: 'email é obrigatório.' });

  try {
    const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);

    const { data } = await admin
      .from('codigos_acesso')
      .select('id, usos_atual, usos_max, usado_em, ativo, email_convidado')
      .eq('codigo', codigo.toUpperCase().trim())
      .maybeSingle();

    if (!data || !data.ativo) return res.status(200).json({ ok: false });
    if (data.usos_max != null && data.usos_atual >= data.usos_max) {
      return res.status(200).json({ ok: false });
    }
    // Convite nominal só pode ser consumido pela pessoa convidada.
    if (data.email_convidado && data.email_convidado.toLowerCase() !== emailNorm) {
      return res.status(403).json({ ok: false, erro: 'Este convite é de outro e-mail.' });
    }

    // A prova de que o cadastro aconteceu: a conta tem que existir.
    const existe = await contaExiste(admin, emailNorm);
    if (!existe) return res.status(409).json({ ok: false, erro: 'Nenhuma conta encontrada para esse e-mail.' });

    await admin.from('codigos_acesso').update({
      usos_atual: data.usos_atual + 1,
      usado_em:   data.usado_em || new Date().toISOString(),
    }).eq('id', data.id);

    return res.status(200).json({ ok: true });
  } catch (_) {
    return res.status(200).json({ ok: false });
  }
}

async function contaExiste(admin, email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
    if (error) throw error;
    if ((data.users || []).some(u => (u.email || '').toLowerCase() === email)) return true;
    if ((data.users || []).length < 1000) return false;
  }
  return false;
}
