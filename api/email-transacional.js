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
// Endereço fixo de propósito: é o que impede esta rota de ser usada para
// disparar e-mail do domínio para qualquer destinatário.
const AVISOS_PARA   = 'contato@meuprocesso.app.br';

const PLANOS = {
  mensal:    { nome: 'Mensal',    valor: 29, periodo: '1 mês'   },
  semestral: { nome: 'Semestral', valor: 69, periodo: '6 meses' },
  anual:     { nome: 'Anual',     valor: 97, periodo: '12 meses' },
};

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
  const nome         = user.user_metadata?.full_name || user.user_metadata?.nome || '';
  const primeiroNome = nome.split(' ')[0] || 'Advogado(a)';

  if (tipo === 'cadastro') {
    await enviarEmail(user.email, 'Recebemos seu cadastro — Meu Processo', templateCadastro(esc(primeiroNome)));
    return res.json({ ok: true });
  }

  // Pedido de licença: avisa o escritório para a venda não se perder.
  // O destino é FIXO (nunca vem do cliente) — por isso não serve de relay.
  if (tipo === 'licenca-solicitada') {
    const plano = String(req.body?.plano || '');
    const p = PLANOS[plano];
    if (!p) return res.status(400).json({ erro: 'plano inválido.' });

    const dados = {
      nome:     nome || '(sem nome)',
      email:    user.email,
      telefone: user.user_metadata?.telefone || '(não informado)',
      oab:      user.user_metadata?.oab || '(não informada)',
      plano:    p.nome,
      valor:    p.valor,
    };

    // Um e-mail falhar não pode esconder o outro: o pedido já está salvo no
    // banco e aparece no painel admin de qualquer forma.
    const envios = await Promise.allSettled([
      enviarEmail(AVISOS_PARA, `Pedido de licença: ${dados.nome} — plano ${p.nome} (R$ ${p.valor})`, templatePedidoInterno(dados)),
      enviarEmail(user.email, 'Recebemos seu pedido — Meu Processo', templatePedidoCliente(esc(primeiroNome), p)),
    ]);
    const falhas = envios.filter(e => e.status === 'rejected').map(e => String(e.reason?.message || e.reason));
    return res.json({ ok: true, ...(falhas.length ? { avisos: falhas } : {}) });
  }

  return res.status(400).json({ erro: 'tipo inválido.' });
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

// Aviso interno: tudo que você precisa para fechar a venda sem abrir o sistema.
function templatePedidoInterno(d) {
  const linha = (rot, val) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:130px">${esc(rot)}</td>
      <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:600">${esc(val)}</td>
    </tr>`;
  const zap = String(d.telefone).replace(/\D/g, '');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pedido de licença</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:36px 0"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">
    <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#1d4ed8 100%);border-radius:14px 14px 0 0;padding:26px 32px">
      <div style="font-size:12px;color:rgba(255,255,255,.65);letter-spacing:.08em;text-transform:uppercase">Pedido de licença</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-top:5px">${esc(d.plano)} · R$ ${esc(d.valor)}</div>
    </td></tr>
    <tr><td style="background:#fff;padding:28px 32px;border-radius:0 0 14px 14px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${linha('Advogado',  d.nome)}
        ${linha('E-mail',    d.email)}
        ${linha('Telefone',  d.telefone)}
        ${linha('OAB',       d.oab)}
      </table>
      <div style="margin-top:24px">
        ${zap.length >= 10
          ? `<a href="https://wa.me/55${zap}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700;text-decoration:none;margin-right:8px">Falar no WhatsApp</a>`
          : ''}
        <a href="https://meuprocesso.app.br/admin" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:700;text-decoration:none">Abrir o painel</a>
      </div>
      <p style="font-size:12.5px;color:#6b7280;line-height:1.65;margin:22px 0 0">
        Combine o Pix e depois libere a licença no painel, em <strong>Licenças</strong>.
        O pedido fica como pendente até você marcar como pago.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// Confirmação para o advogado: ele precisa saber que o pedido chegou.
function templatePedidoCliente(nome, p) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Recebemos seu pedido</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0"><tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%">
    <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#1d4ed8 100%);border-radius:16px 16px 0 0;padding:36px 40px;text-align:center">
      <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-.5px">Meu Processo</div>
      <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">Gestão jurídica inteligente</div>
    </td></tr>
    <tr><td style="background:#fff;padding:40px 40px 32px;border-radius:0 0 16px 16px">
      <p style="font-size:18px;font-weight:700;color:#111827;margin:0 0 16px">Olá, ${nome}!</p>
      <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 20px">
        Recebemos seu pedido do plano <strong>${esc(p.nome)}</strong>, de R$ ${esc(p.valor)} por ${esc(p.periodo)}.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eff6ff;border-radius:10px;margin:0 0 20px">
        <tr><td style="padding:18px 20px;font-size:14px;color:#1e3a5f;line-height:1.7">
          <strong>O que acontece agora:</strong><br>
          Vamos te enviar os dados para pagamento por Pix neste e-mail ou pelo seu telefone.
          Assim que o pagamento for confirmado, sua licença é liberada e você continua de onde parou.
        </td></tr>
      </table>
      <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 6px">
        Nada foi cobrado de você agora, e não existe cobrança automática.
      </p>
      <p style="font-size:13px;color:#6b7280;line-height:1.7;margin:20px 0 0">
        Dúvidas? Responda este e-mail ou escreva para
        <a href="mailto:contato@meuprocesso.app.br" style="color:#1d4ed8;font-weight:600;text-decoration:none">contato@meuprocesso.app.br</a>.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
