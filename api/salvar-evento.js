import { createClient } from '@supabase/supabase-js';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';
const RESEND_KEY    = process.env.RESEND_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const token = req.headers['authorization']?.slice(7);
  if (!token) return res.status(401).json({ erro: 'Não autorizado.' });

  const userClient = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ erro: 'Token inválido.' });

  const { titulo, tipo, data, processo_id, urgencia, notificar_antes } = req.body || {};
  if (!titulo || !data) return res.status(400).json({ erro: 'Título e data são obrigatórios.' });

  const authed = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: evento, error: insErr } = await authed.from('eventos').insert({
    user_id:         user.id,
    titulo,
    tipo:            tipo            || 'lembrete',
    data,
    processo_id:     processo_id     || null,
    urgencia:        urgencia        || 'baixa',
    notificar_antes: notificar_antes ?? 1,
  }).select().single();

  if (insErr) return res.status(500).json({ erro: insErr.message });

  if (RESEND_KEY) {
    const nome     = user.user_metadata?.full_name || user.user_metadata?.nome || user.email.split('@')[0];
    const dataFmt  = new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const tipoLabel = { prazo_processual: 'Prazo Processual', audiencia: 'Audiência', lembrete: 'Lembrete', reuniao: 'Reunião' };

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'notificacoes@meuprocesso.app.br',
        to:      user.email,
        subject: `[Meu Processo] Prazo registrado — ${titulo}`,
        html: `
<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  <div style="background:#1a2e6b;padding:24px 28px">
    <div style="font-size:18px;font-weight:700;color:#fff">Meu Processo</div>
    <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">meuprocesso.app.br</div>
  </div>
  <div style="padding:24px 28px">
    <div style="font-size:15px;color:#111827;margin-bottom:6px">Olá, <strong>${nome}</strong>!</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:20px">Um novo prazo foi registrado no seu calendário.</div>
    <div style="background:#f8f9fa;border-left:4px solid #1a2e6b;border-radius:6px;padding:14px 16px">
      <div style="font-weight:700;color:#1a2e6b;font-size:14px;margin-bottom:8px">📅 ${titulo}</div>
      <div style="font-size:13px;color:#374151"><strong>Data:</strong> ${dataFmt}</div>
      <div style="font-size:13px;color:#374151;margin-top:4px"><strong>Tipo:</strong> ${tipoLabel[tipo] || 'Lembrete'}</div>
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://meuprocesso.app.br/dashboard" style="display:inline-block;background:#1a2e6b;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600">Ver no Dashboard →</a>
    </div>
  </div>
  <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">
    Você recebe este e-mail porque tem uma conta no Meu Processo.
  </div>
</div>`,
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, evento });
}
