// Endpoint de teste — verifica se Resend está configurado e envia um email de teste
// Uso: GET /api/testar-email?para=seu@email.com

export default async function handler(req, res) {
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_KEY) {
    return res.status(500).json({ erro: 'RESEND_API_KEY não configurada no ambiente.' });
  }

  const para = req.query.para || 'matheus.avela@gmail.com';

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
        <div style="background:#1a2e6b;padding:24px 28px">
          <div style="font-size:18px;font-weight:700;color:#fff">Meu Processo</div>
          <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">meuprocesso.app.br</div>
        </div>
        <div style="padding:28px">
          <div style="font-size:22px;margin-bottom:8px">✅ Email funcionando!</div>
          <div style="font-size:14px;color:#374151;line-height:1.6">
            O sistema de notificações do <strong>Meu Processo</strong> está configurado corretamente.<br><br>
            A partir de agora, quando houver novas movimentações nos processos monitorados,
            você receberá um email automaticamente de <strong>notificacoes@meuprocesso.app.br</strong>.
          </div>
          <div style="margin-top:24px;padding:16px;background:#f0fdf4;border-left:4px solid #1a7a4a;border-radius:6px;font-size:13px;color:#166534">
            <strong>Configuração ativa:</strong><br>
            · Verificação 6x ao dia (7h, 9h, 12h, 15h, 18h, 22h)<br>
            · Sincronização automática a cada 10min no dashboard<br>
            · Domínio verificado: meuprocesso.app.br (São Paulo)
          </div>
        </div>
        <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">
          Teste enviado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
        </div>
      </div>
    </body>
    </html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'notificacoes@meuprocesso.app.br',
        to:      para,
        subject: '[Meu Processo] ✅ Teste de notificação — tudo funcionando!',
        html,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(502).json({ erro: 'Resend retornou erro', detalhe: data });
    }

    return res.status(200).json({
      ok: true,
      mensagem: `Email de teste enviado para ${para}`,
      id: data.id,
    });

  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
