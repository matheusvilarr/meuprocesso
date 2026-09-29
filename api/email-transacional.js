// E-mail transacional de "cadastro recebido".
// POST /api/email-transacional  { tipo: 'cadastro' }  (Authorization: Bearer <jwt>)
// Só envia para o e-mail do próprio usuário autenticado — antes aceitava
// qualquer "para", o que permitia usar o domínio como relay de spam.
// O e-mail de "acesso liberado" é enviado pelo api/admin.js.

import { createClient } from '@supabase/supabase-js';

const SUPA_URL      = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_ANON_KEY = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';
const RESEND_KEY    = process.env.RESEND_API_KEY;
const FROM          = 'Meu Processo <contato@meuprocesso.app.br>';

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESCAPE_MAP[c]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado.' });

  const supaAnon = createClient(SUPA_URL, SUPA_ANON_KEY);
  const { data: { user }, error: authErr } = await supaAnon.auth.getUser(auth.slice(7));
  if (authErr || !user?.email) return res.status(401).json({ erro: 'Token inválido.' });

  const { tipo } = req.body || {};
  if (tipo !== 'cadastro') return res.status(400).json({ erro: 'tipo inválido.' });

  const nome         = user.user_metadata?.full_name || user.user_metadata?.nome || '';
  const primeiroNome = nome.split(' ')[0] || 'Advogado(a)';

  await enviarEmail(user.email, 'Recebemos seu cadastro — Meu Processo', templateCadastro(esc(primeiroNome)));
  return res.json({ ok: true });
}

async function enviarEmail(para, assunto, html) {
  if (!RESEND_KEY) return;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: para, subject: assunto, html }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.status);
    throw new Error(`Resend ${r.status}: ${msg}`);
  }
}

function templateCadastro(nome) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cadastro recebido</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#1d4ed8 100%);border-radius:16px 16px 0 0;padding:36px 40px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.5px">Meu Processo</div>
        <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">Gestão jurídica inteligente</div>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:40px 40px 32px;border-radius:0 0 16px 16px">

        <p style="font-size:18px;font-weight:700;color:#111827;margin:0 0 16px">Olá, ${nome}! 👋</p>

        <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">
          Recebemos seu cadastro no <strong>Meu Processo</strong> com sucesso.
        </p>

        <div style="background:#f0f4ff;border-left:4px solid #1d4ed8;border-radius:0 10px 10px 0;padding:18px 20px;margin:0 0 24px">
          <p style="font-size:14px;color:#1e3a5f;line-height:1.75;margin:0">
            O <strong>Meu Processo</strong> nasceu com uma ideia simples: <strong>facilitar o dia a dia do advogado</strong> —
            monitoramento automático de processos, alertas de novas movimentações, controle de prazos,
            kanban de tarefas e muito mais, tudo em um lugar só.
          </p>
        </div>

        <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">
          Por enquanto, os acessos estão sendo liberados <strong>gradativamente</strong> para garantirmos
          a melhor experiência possível. Em breve entraremos em contato pessoalmente para conhecer
          melhor a sua rotina e liberar o seu acesso.
        </p>

        <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 32px">
          Qualquer dúvida, basta responder este e-mail. Estamos à disposição!
        </p>

        <div style="border-top:1px solid #e5e7eb;padding-top:24px;text-align:center">
          <p style="font-size:13px;color:#6b7280;margin:0">
            Atenciosamente,<br>
            <strong style="color:#111827">Matheus Vilar</strong><br>
            <span style="color:#9ca3af">Fundador · Meu Processo</span>
          </p>
        </div>

      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:20px 0;text-align:center">
        <p style="font-size:12px;color:#9ca3af;margin:0">
          Meu Processo · <a href="https://meuprocesso.app.br" style="color:#6b7280;text-decoration:none">meuprocesso.app.br</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}
