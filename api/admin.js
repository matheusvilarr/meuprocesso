import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { repararDatajudIndex, sincronizarDatajudUm, comPool } from './cron/sincronizar.js';
import emailHandler from './cron/verificar-atualizacoes.js';
import djenCadernosHandler from '../lib/djen-cadernos.js';
import { ehMovDJEN, abrirExecucao, fecharExecucao } from '../lib/sync-comum.js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function getAdminClient() {
  return createClient(SUPA_URL, SUPA_SERVICE_KEY);
}

// Verifica o token do usuário logado e confirma que ele está na tabela admins.
// Retorna null se não for admin — nunca confiar em flags vindas do client.
// Devolve { user, nivel } ou { negado: motivo } — o motivo aparece na tela
// de "acesso restrito" pra dar pra diagnosticar sem abrir o console.
async function requireAdmin(req, admin) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { negado: 'Sessão não encontrada neste navegador — faça login de novo.' };

  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) {
    return { negado: `Login inválido ou expirado (${error?.message || 'sem usuário'}) — saia e entre de novo.` };
  }

  const { data: adminRow, error: adminErr } = await admin
    .from('admins')
    .select('user_id, nivel')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (adminErr) return { negado: `Erro ao consultar a lista de administradores: ${adminErr.message}` };
  if (!adminRow) return { negado: `A conta ${userData.user.email} não está na lista de administradores.` };
  return { user: userData.user, nivel: adminRow.nivel };
}

// O Supabase devolve no máximo 1000 linhas por consulta — pagina até o fim
// pra contagens do painel não ficarem erradas quando a base crescer.
async function todasAsLinhas(montarQuery) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montarQuery().range(de, de + 999);
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

async function todosOsUsuarios(admin) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
    if (error) throw error;
    users.push(...(data?.users || []));
    if ((data?.users || []).length < 1000) break;
  }
  return users;
}

async function acaoDados(req, res, admin, adminUser) {
  let users, processosRows, tarefasRows;
  try {
    [users, processosRows, tarefasRows] = await Promise.all([
      todosOsUsuarios(admin),
      todasAsLinhas(() => admin.from('processos').select('user_id, datajud_index, ultima_verificacao, notificacao_pendente').neq('status', 'Arquivado').order('id')),
      todasAsLinhas(() => admin.from('tarefas').select('user_id').neq('coluna', 'concluida').order('id')),
    ]);
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }

  const [
    { data: colaboradoresRows },
    { data: adminsRows },
    { data: codigos },
    { data: assinaturasRows },
    { data: cronErros },
  ] = await Promise.all([
    admin.from('colaboradores').select('escritorio_id, user_id').eq('status', 'ativo'),
    admin.from('admins').select('user_id, nivel'),
    admin.from('codigos_acesso')
      .select('id, codigo, descricao, ativo, usos_max, usos_atual, email_convidado, enviado_em, usado_em, created_at')
      .order('created_at', { ascending: false }),
    admin.from('assinaturas').select('escritorio_id, plano, status, data_expiracao, valor_pago, forma_pagamento, observacoes'),
    // Erros de sincronização (DataJud/DJEN/OAB scan) — cron:email tem tela própria na aba E-mails
    admin.from('error_log')
      .select('id, origem, mensagem, user_id, created_at')
      .ilike('origem', 'cron:%')
      .not('origem', 'ilike', 'cron:email%')
      .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  const h48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const contagemProcessos = {};
  const syncStats = {};
  for (const p of processosRows || []) {
    contagemProcessos[p.user_id] = (contagemProcessos[p.user_id] || 0) + 1;
    if (!syncStats[p.user_id]) syncStats[p.user_id] = { sincronizados: 0, semIndice: 0, comNotificacao: 0, desatualizados: 0, ultimaSync: null };
    const s = syncStats[p.user_id];
    if (p.datajud_index) s.sincronizados++;
    else s.semIndice++;
    if (p.datajud_index && (!p.ultima_verificacao || p.ultima_verificacao < h48)) s.desatualizados++;
    if (p.notificacao_pendente) s.comNotificacao++;
    if (p.ultima_verificacao && (!s.ultimaSync || p.ultima_verificacao > s.ultimaSync)) s.ultimaSync = p.ultima_verificacao;
  }

  const contagemTarefas = {};
  for (const t of tarefasRows || []) {
    contagemTarefas[t.user_id] = (contagemTarefas[t.user_id] || 0) + 1;
  }

  const colaboradoresPorTitular = {};
  for (const c of colaboradoresRows || []) {
    colaboradoresPorTitular[c.escritorio_id] = (colaboradoresPorTitular[c.escritorio_id] || 0) + 1;
  }

  const adminMap = {};
  for (const a of adminsRows || []) adminMap[a.user_id] = a.nivel;

  const assinaturaMap = {};
  for (const s of assinaturasRows || []) assinaturaMap[s.escritorio_id] = s;

  // Conta quantas contas usam cada OAB (normalizada) — pra sinalizar
  // duplicidade no painel (advogado tentando ter vários trials).
  const normalizarOab = oab => String(oab || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const contagemOab = {};
  for (const u of users) {
    const oabNorm = normalizarOab(u.user_metadata?.oab);
    if (oabNorm) contagemOab[oabNorm] = (contagemOab[oabNorm] || 0) + 1;
  }

  const advogados = users
    .map(u => {
      const oabNorm = normalizarOab(u.user_metadata?.oab);
      return {
        id:             u.id,
        nome:           u.user_metadata?.full_name || u.user_metadata?.nome || '—',
        email:          u.email,
        oab:            u.user_metadata?.oab || '—',
        oabDuplicado:   oabNorm ? contagemOab[oabNorm] > 1 : false,
        criadoEm:       u.created_at,
        // ultimo_acesso (gravado pelo auth-guard a cada dia de uso) reflete o
        // uso real; last_sign_in_at só muda quando a pessoa digita a senha de novo.
        ultimoLogin:    u.user_metadata?.ultimo_acesso || u.last_sign_in_at || null,
        ultimoSignIn:   u.last_sign_in_at || null,
        emailConfirmado: !!u.email_confirmed_at,
        bloqueado:      !!(u.banned_until && new Date(u.banned_until) > new Date()),
        numProcessos:     contagemProcessos[u.id] || 0,
        numSincronizados: syncStats[u.id]?.sincronizados || 0,
        numNotificacoes:  syncStats[u.id]?.comNotificacao || 0,
        numDesatualizados: syncStats[u.id]?.desatualizados || 0,
        numSemIndice:      syncStats[u.id]?.semIndice || 0,
        ultimaSync:       syncStats[u.id]?.ultimaSync || null,
        numTarefas:       contagemTarefas[u.id] || 0,
        numColaboradores: colaboradoresPorTitular[u.id] || 0,
        nivelAdmin:       adminMap[u.id] || null,
        plano:            assinaturaMap[u.id]?.plano || null,
        statusAssinatura: assinaturaMap[u.id]?.status || null,
        dataExpiracao:    assinaturaMap[u.id]?.data_expiracao || null,
        valorPago:        assinaturaMap[u.id]?.valor_pago ?? null,
        formaPagamento:   assinaturaMap[u.id]?.forma_pagamento || null,
        obsAssinatura:    assinaturaMap[u.id]?.observacoes || null,
      };
    })
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  const totalSincronizados = (processosRows || []).filter(p => p.datajud_index).length;
  const totalNotificacoes  = (processosRows || []).filter(p => p.notificacao_pendente).length;
  const semAntes7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const stats = {
    totalAdvogados:     advogados.length,
    totalBloqueados:    advogados.filter(a => a.bloqueado).length,
    totalSemConfirmar:  advogados.filter(a => !a.emailConfirmado).length,
    totalOabDuplicada:  advogados.filter(a => a.oabDuplicado).length,
    totalProcessos:     processosRows?.length || 0,
    totalSincronizados,
    totalNotificacoes,
    totalErrosCronSemana: (cronErros || []).filter(e => e.created_at >= semAntes7d).length,
    convitesPendentes:  (codigos || []).filter(c => c.email_convidado && !c.usado_em).length,
  };

  return res.json({ ok: true, advogados, codigos: codigos || [], stats, cronErros: cronErros || [], meuNivel: adminUser.nivel });
}

async function acaoGerarCodigo(req, res, admin, adminUser) {
  const { descricao, usosMax } = req.body || {};
  const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();

  const { data, error } = await admin
    .from('codigos_acesso')
    .insert({
      codigo,
      descricao:  descricao || null,
      usos_max:   usosMax || null,
      criado_por: adminUser.user.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true, codigo: data });
}

async function acaoGerenciarAdmin(req, res, admin, adminUser) {
  const { email, tipo } = req.body || {}; // tipo: 'promover' | 'remover'
  if (!email || !tipo) return res.status(400).json({ erro: 'email e tipo são obrigatórios.' });

  const target = (await todosOsUsuarios(admin)).find(u => u.email?.toLowerCase() === email.toLowerCase().trim());
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  if (tipo === 'promover') {
    const { error } = await admin
      .from('admins')
      .upsert({ user_id: target.id, criado_por: adminUser.user.id }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ erro: error.message });
  } else if (tipo === 'remover') {
    if (target.id === adminUser.user.id) {
      return res.status(400).json({ erro: 'Você não pode remover seu próprio acesso admin.' });
    }
    const { error } = await admin.from('admins').delete().eq('user_id', target.id);
    if (error) return res.status(500).json({ erro: error.message });
  } else {
    return res.status(400).json({ erro: 'tipo inválido.' });
  }

  return res.json({ ok: true });
}

const PLANOS_VALIDOS  = ['trial', 'mensal', 'semestral', 'anual', 'legado'];
const STATUS_VALIDOS  = ['ativo', 'vencido', 'cancelado'];

async function acaoAtualizarAssinatura(req, res, admin, adminUser) {
  const { escritorioId, plano, status, dataExpiracao, valorPago, formaPagamento, observacoes } = req.body || {};
  if (!escritorioId) return res.status(400).json({ erro: 'escritorioId é obrigatório.' });
  if (plano && !PLANOS_VALIDOS.includes(plano)) return res.status(400).json({ erro: 'plano inválido.' });
  if (status && !STATUS_VALIDOS.includes(status)) return res.status(400).json({ erro: 'status inválido.' });
  if (!dataExpiracao) return res.status(400).json({ erro: 'dataExpiracao é obrigatória.' });

  const { error } = await admin.from('assinaturas').upsert({
    escritorio_id:   escritorioId,
    plano:            plano || 'mensal',
    status:            status || 'ativo',
    data_expiracao:    dataExpiracao,
    valor_pago:        valorPago ?? null,
    forma_pagamento:   formaPagamento || null,
    observacoes:       observacoes || null,
    atualizado_por:    adminUser.user.id,
  }, { onConflict: 'escritorio_id' });

  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true });
}

async function acaoToggleCodigo(req, res, admin) {
  const { id, ativo } = req.body || {};
  if (!id) return res.status(400).json({ erro: 'id obrigatório.' });

  const { error } = await admin.from('codigos_acesso').update({ ativo: !!ativo }).eq('id', id);
  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true });
}

async function acaoConvidarAdvogado(req, res, admin, adminUser) {
  const { email, descricao } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }
  const emailNorm = email.toLowerCase().trim();

  if ((await todosOsUsuarios(admin)).some(u => u.email?.toLowerCase() === emailNorm)) {
    return res.status(422).json({ erro: 'Esse e-mail já tem conta cadastrada.' });
  }

  const { data: existente } = await admin
    .from('codigos_acesso')
    .select('id, codigo, enviado_em')
    .eq('email_convidado', emailNorm)
    .is('usado_em', null)
    .eq('ativo', true)
    .maybeSingle();

  // Convidar a mesma pessoa de novo não é erro: é quase sempre "o e-mail não
  // chegou, manda de novo". Antes isso devolvia 422 e parecia que o convite
  // tinha falhado, quando na verdade já existia e estava válido.
  if (existente) {
    let avisoEmail = null;
    try {
      await enviarEmailConvite(emailNorm, existente.codigo);
      await admin.from('codigos_acesso').update({ enviado_em: new Date().toISOString() }).eq('id', existente.id);
    } catch (e) {
      avisoEmail = 'O convite já existia, mas o e-mail não pôde ser reenviado: ' + e.message;
    }
    return res.json({
      ok: true,
      jaExistia: true,
      codigo: existente,
      link: linkConvite(existente.codigo, emailNorm),
      ...(avisoEmail ? { avisoEmail } : {}),
    });
  }

  const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
  const { data: novoCodigo, error } = await admin
    .from('codigos_acesso')
    .insert({
      codigo,
      descricao:       descricao || null,
      usos_max:        1,
      criado_por:       adminUser.user.id,
      email_convidado: emailNorm,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ erro: error.message });

  const link = linkConvite(codigo, emailNorm);
  try {
    await enviarEmailConvite(emailNorm, codigo);
    await admin.from('codigos_acesso').update({ enviado_em: new Date().toISOString() }).eq('id', novoCodigo.id);
  } catch (e) {
    return res.status(200).json({ ok: true, codigo: novoCodigo, link, avisoEmail: 'Código gerado, mas o e-mail não pôde ser enviado: ' + e.message });
  }

  return res.json({ ok: true, codigo: novoCodigo, link });
}

// O link é devolvido para o painel porque e-mail não é garantia de entrega —
// Hotmail e Outlook jogam muita coisa em lixo eletrônico. Com o link em mãos
// dá para mandar por WhatsApp e não depender disso.
function linkConvite(codigo, email) {
  const base = process.env.VERCEL ? 'https://meuprocesso.app.br' : 'http://localhost:3002';
  return `${base}/registro?codigo=${encodeURIComponent(codigo)}&email=${encodeURIComponent(email)}`;
}

async function acaoReenviarConvite(req, res, admin) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ erro: 'id obrigatório.' });

  const { data: row } = await admin
    .from('codigos_acesso')
    .select('id, codigo, email_convidado, usado_em')
    .eq('id', id)
    .maybeSingle();

  if (!row) return res.status(404).json({ erro: 'Convite não encontrado.' });
  if (!row.email_convidado) return res.status(400).json({ erro: 'Esse código não foi gerado como convite por e-mail.' });
  if (row.usado_em) return res.status(422).json({ erro: 'Esse convite já foi usado.' });

  const link = linkConvite(row.codigo, row.email_convidado);

  // Mesmo se o e-mail falhar, devolve o link: dá para mandar pelo WhatsApp e
  // o convite continua válido.
  try {
    await enviarEmailConvite(row.email_convidado, row.codigo);
  } catch (e) {
    return res.status(502).json({ erro: 'Falha ao enviar e-mail: ' + e.message, link });
  }

  await admin.from('codigos_acesso').update({ enviado_em: new Date().toISOString() }).eq('id', id);
  return res.json({ ok: true, link });
}

async function enviarEmailConvite(email, codigo) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY não configurada.');

  // VERCEL_URL é o endereço interno do deploy (muda a cada publicação e não
  // aceita login), então o link do convite tem que usar o domínio de verdade.
  const baseUrl = process.env.VERCEL ? 'https://meuprocesso.app.br' : 'http://localhost:3002';
  const link = `${baseUrl}/registro?codigo=${codigo}&email=${encodeURIComponent(email)}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Você foi convidado — MeuProcesso.App</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    Você foi convidado para usar o MeuProcesso.App. Clique no botão abaixo para criar sua conta.
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:540px;">

          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#1a2e6b;border-radius:12px;padding:14px 28px;">
                    <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">MeuProcesso</span><span style="font-size:20px;font-weight:400;color:#e8b400;">.App</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color:#ffffff;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background-color:#e8b400;height:4px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:40px 40px 32px;">

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#eef1f9;border-radius:50%;width:56px;height:56px;text-align:center;vertical-align:middle;">
                          <span style="font-size:28px;line-height:56px;">⚖️</span>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:24px 0 8px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">
                      Você foi convidado
                    </p>

                    <p style="margin:0 0 20px;font-size:15px;color:#6b7280;line-height:1.6;">
                      Você foi convidado para usar o <strong style="color:#1a2e6b;">MeuProcesso.App</strong>, sistema de gestão jurídica para advogados. Clique no botão abaixo para criar sua conta.
                    </p>

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="border-top:1px solid #f3f4f6;padding-bottom:28px;font-size:0;">&nbsp;</td>
                      </tr>
                    </table>

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="border-radius:10px;background-color:#1a2e6b;">
                          <a href="${link}"
                             target="_blank"
                             style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                            Criar minha conta
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;line-height:1.5;">
                      Ou use o código de acesso <strong style="color:#1a2e6b;letter-spacing:.06em;">${codigo}</strong> na tela de cadastro. Se você não esperava este convite, pode ignorar este email com segurança.
                    </p>

                  </td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background-color:#f9fafb;border-top:1px solid #f3f4f6;padding:20px 40px;border-radius:0 0 16px 16px;">
                    <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;">
                      Se o botão não funcionar, copie e cole este link no seu navegador:
                    </p>
                    <p style="margin:0;font-size:11px;color:#6b7280;word-break:break-all;line-height:1.6;">
                      <a href="${link}" style="color:#1a2e6b;text-decoration:underline;">${link}</a>
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="padding:28px 0 8px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;line-height:1.6;">
                MeuProcesso.App · Sistema de gestão jurídica
              </p>
              <p style="margin:0;font-size:11px;color:#d1d5db;">
                Você está recebendo este email porque foi convidado para
                <a href="https://meuprocesso.app.br" style="color:#9ca3af;text-decoration:none;">meuprocesso.app.br</a>
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      from:    'notificacoes@meuprocesso.app.br',
      to:      email,
      subject: 'Você foi convidado para o Meu Processo',
      html,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => 'erro desconhecido');
    throw new Error(`Resend ${r.status}: ${msg}`);
  }
}

async function acaoToggleStatus(req, res, admin, adminUser) {
  const { userId, bloquear } = req.body || {};
  if (!userId) return res.status(400).json({ erro: 'userId obrigatório.' });
  if (userId === adminUser.user.id) {
    return res.status(400).json({ erro: 'Você não pode bloquear sua própria conta.' });
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: bloquear ? '876000h' : 'none',
  });
  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true });
}

async function acaoEmails(req, res, admin) {
  const desde14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const desde14ts = new Date(Date.now() - 14 * 86400000).toISOString();

  const [{ data: logs }, { data: erros }] = await Promise.all([
    admin.from('notif_log')
      .select('user_id, tipo, data')
      .gte('data', desde14)
      .order('data', { ascending: false }),
    admin.from('error_log')
      .select('id, origem, mensagem, user_id, created_at')
      .ilike('origem', 'cron:email%')
      .gte('created_at', desde14ts)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  return res.json({ ok: true, logs: logs || [], erros: erros || [] });
}

async function acaoDjenCadernos(req, res, admin) {
  const desde14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const { data: fila, error } = await admin
    .from('djen_cadernos_fila')
    .select('tribunal, data, status, comunicacoes_encontradas, tentativas, erro_msg, criado_em, concluido_em')
    .gte('data', desde14)
    .order('data', { ascending: false })
    .order('tribunal', { ascending: true })
    .limit(300);

  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true, fila: fila || [] });
}

async function acaoRodarDjenCadernos(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const fakeReq = {
    headers: { authorization: cronSecret ? `Bearer ${cronSecret}` : '' },
    query: {},
  };
  let resultado = null;
  const fakeRes = {
    status(code) { this._code = code; return this; },
    json(data)   { resultado = data; return this; },
  };
  try {
    await djenCadernosHandler(fakeReq, fakeRes);
    return res.json({ ok: true, resultado });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

// Mesma função do cron — antes havia uma cópia local aqui que divergia
// (size 1, janela de "novos" diferente) e gerava resultados diferentes.
async function acaoSincronizarProcessos(req, res, admin, adminUser) {
  const { userId } = req.body || {};
  const startAt = Date.now();
  // O que roda pelo botão também entra no histórico — senão o painel mostra
  // uma vazão menor do que a real.
  const execId  = await abrirExecucao(admin, userId ? 'datajud-manual-usuario' : 'datajud-manual');

  // Backfill: preenche datajud_index para processos que têm numero mas não têm index
  const reparados = await repararDatajudIndex(admin);

  // Ordena pelos menos sincronizados primeiro — garante rotação entre todos
  let q = admin.from('processos')
    .select('id, user_id, numero, nome, datajud_index, movimentos_hash, movimentos_recentes, notificacao_pendente, novos_movimentos, sync_falhas, created_at')
    .not('datajud_index', 'is', null)
    .neq('status', 'Arquivado')
    .order('sync_ultima_tentativa', { ascending: true, nullsFirst: true });
  if (userId) q = q.eq('user_id', userId);

  const { data: processos, error } = await q;
  if (error) {
    await fecharExecucao(admin, execId, { inicioMs: startAt, erro: error.message });
    return res.status(500).json({ erro: error.message });
  }

  const hoje = new Date().toISOString().slice(0, 10);
  let atualizados = 0, comNovidade = 0, semMudanca = 0, naoEncontrado = 0, erros = 0, parou = false;

  // Mesmo pool contínuo do cron (api/cron/sincronizar.js): 20 em voo, novas
  // consultas até 55s, cada uma esperando até 45s pela resposta do CNJ.
  const resultados = await comPool(processos, 20, startAt + 55000,
    proc => sincronizarDatajudUm(proc, admin, hoje));
  parou = resultados.length < processos.length;
  for (const r of resultados) {
    if (r === 'novos')               { atualizados++; comNovidade++; }
    else if (r === 'atualizado')     atualizados++;
    else if (r === 'sem-mudanca')    semMudanca++;
    else if (r === 'nao-encontrado') naoEncontrado++;
    else if (r === 'erro')           erros++;
  }

  // Dispara e-mails imediatamente se houve novidades — sem esperar o próximo cron agendado
  let emailsDisparados = 0;
  if (comNovidade > 0) {
    const cronSecret = process.env.CRON_SECRET;
    const fakeReq = { headers: { authorization: cronSecret ? `Bearer ${cronSecret}` : '' }, query: {} }; // tipo auto-detectado pela hora atual
    let emailResult = null;
    const fakeRes = {
      status(c) { return this; },
      json(d)   { emailResult = d; return this; },
    };
    try {
      await emailHandler(fakeReq, fakeRes);
      emailsDisparados = emailResult?.emailsEnviados ?? 0;
    } catch (_) {}
  }

  await fecharExecucao(admin, execId, {
    inicioMs: startAt,
    fila: processos.length,
    processados: resultados.length,
    resultados: { novos: comNovidade, verificados: atualizados + semMudanca + naoEncontrado, falhas: erros, reparados },
  });

  return res.json({
    ok: true,
    reparados,
    total: processos.length,
    atualizados,
    semMudanca,
    naoEncontrado,
    erros,
    emailsDisparados,
    parou,
    elapsed: Math.round((Date.now() - startAt) / 1000) + 's',
  });
}

async function acaoRodarEmails(req, res) {
  const { tipo = 'morning' } = req.body || {};
  const cronSecret = process.env.CRON_SECRET;
  const fakeReq = { headers: { authorization: cronSecret ? `Bearer ${cronSecret}` : '' }, query: { tipo } };
  let resultado = null;
  const fakeRes = {
    status(code) { this._code = code; return this; },
    json(data)   { resultado = data; return this; },
  };
  try {
    await emailHandler(fakeReq, fakeRes);
    return res.json({ ok: true, resultado });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

export default async function handler(req, res) {
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (adminUser.negado) return res.status(403).json({ erro: 'Acesso restrito a administradores.', motivo: adminUser.negado });

  const acao = req.method === 'GET' ? req.query?.acao : (req.body || {}).acao;

  if (acao === 'saude')            return acaoSaude(req, res, admin);
  if (acao === 'execucoes')        return acaoExecucoes(req, res, admin);
  if (acao === 'licencas')         return acaoLicencas(req, res, admin);
  if (acao === 'detalhe-usuario')  return acaoDetalheUsuario(req, res, admin);
  if (acao === 'dados')         return acaoDados(req, res, admin, adminUser);
  if (acao === 'emails')        return acaoEmails(req, res, admin);
  if (acao === 'pendentes')     return acaoPendentes(req, res, admin);
  if (acao === 'djen-cadernos') return acaoDjenCadernos(req, res, admin);

  if (req.method !== 'POST') return res.status(405).end();

  if (acao === 'gerar-codigo')       return acaoGerarCodigo(req, res, admin, adminUser);
  if (acao === 'gerenciar-admin')    return acaoGerenciarAdmin(req, res, admin, adminUser);
  if (acao === 'toggle-codigo')      return acaoToggleCodigo(req, res, admin);
  if (acao === 'toggle-status')      return acaoToggleStatus(req, res, admin, adminUser);
  if (acao === 'convidar-advogado')     return acaoConvidarAdvogado(req, res, admin, adminUser);
  if (acao === 'reenviar-convite')      return acaoReenviarConvite(req, res, admin);
  if (acao === 'sincronizar-processos') return acaoSincronizarProcessos(req, res, admin, adminUser);
  if (acao === 'rodar-djen-cadernos')   return acaoRodarDjenCadernos(req, res);
  if (acao === 'rodar-emails')          return acaoRodarEmails(req, res);
  if (acao === 'aprovar-usuario')       return acaoAprovarUsuario(req, res, admin);
  if (acao === 'rejeitar-usuario')      return acaoRejeitarUsuario(req, res, admin);
  if (acao === 'atualizar-assinatura')  return acaoAtualizarAssinatura(req, res, admin, adminUser);
  if (acao === 'atender-pedido')        return acaoAtenderPedido(req, res, admin, adminUser);

  return res.status(400).json({ erro: 'acao inválida.' });
}

// ── SAÚDE DO SISTEMA ─────────────────────────────────────────────────────────
// Diagnóstico automático: configuração, DataJud, DJEN, e-mails e assinaturas.
// Gera alertas prontos pro painel — a ideia é que um problema como os deploys
// quebrados de ago–set/2026 apareça aqui no mesmo dia, não dois meses depois.

function dataBrasilia(deltaDias = 0) {
  return new Date(Date.now() - 3 * 3600 * 1000 + deltaDias * 86400000).toISOString().slice(0, 10);
}

async function contar(query) {
  const { count, error } = await query;
  return error ? null : (count ?? 0);
}

async function acaoSaude(req, res, admin) {
  const agora = Date.now();
  const h24   = new Date(agora - 24 * 3600 * 1000).toISOString();
  const h48   = new Date(agora - 48 * 3600 * 1000).toISOString();
  const em7d  = new Date(agora + 7 * 86400000).toISOString();
  const hoje  = dataBrasilia(0);
  const ontem = dataBrasilia(-1);
  const base  = () => admin.from('processos').select('id', { count: 'exact', head: true }).neq('status', 'Arquivado');

  const seteDias = dataBrasilia(-6);
  const h7d = new Date(agora - 7 * 86400000).toISOString();
  const h6  = new Date(agora - 6 * 3600 * 1000).toISOString();
  const [
    verificados6h, verificados24h,
    semIndice, atrasados7d,
    totalAtivos, comIndice, desatualizados, nuncaVerificados, avisosSite, emailsPendentes, falhando,
    { data: ultimaVerif }, { data: fila }, { data: erros24h }, { data: ultimoEmail }, { data: assinaturas },
    execucoes24h, pedidosLicenca,
  ] = await Promise.all([
    // Vazão real: quantos processos tiveram consulta bem-sucedida na janela.
    contar(base().gte('ultima_verificacao', h6)),
    contar(base().gte('ultima_verificacao', h24)),
    // Sem índice do tribunal = impossível consultar no DataJud. Fica fora da
    // fila para sempre, então nunca atualiza — é a falha mais grave possível.
    contar(base().is('datajud_index', null)),
    contar(base().not('datajud_index', 'is', null).lt('ultima_verificacao', h7d)),
    contar(base()),
    contar(base().not('datajud_index', 'is', null)),
    contar(base().not('datajud_index', 'is', null).lt('ultima_verificacao', h48)),
    contar(base().not('datajud_index', 'is', null).is('ultima_verificacao', null)),
    contar(base().eq('notificacao_pendente', true)),
    contar(base().eq('email_pendente', true)),
    contar(base().not('datajud_index', 'is', null).gte('sync_falhas', 3)),
    admin.from('processos').select('ultima_verificacao').not('ultima_verificacao', 'is', null)
      .order('ultima_verificacao', { ascending: false }).limit(1),
    admin.from('djen_cadernos_fila').select('tribunal, data, status, comunicacoes_encontradas, concluido_em').gte('data', seteDias),
    admin.from('error_log').select('origem').gte('created_at', h24).limit(1000),
    admin.from('notif_log').select('tipo, data').order('data', { ascending: false }).limit(1),
    admin.from('assinaturas').select('escritorio_id, plano, status, data_expiracao'),
    admin.from('cron_execucoes').select('cron, iniciado_em, terminou_em, duracao_ms, processados, resultados, erro')
      .gte('iniciado_em', h24).order('iniciado_em', { ascending: false })
      .then(r => r.data || [], () => []),   // tabela pode não existir ainda
    admin.from('solicitacoes_licenca').select('id, valor', { count: 'exact' }).eq('status', 'pendente')
      .then(r => r.data || [], () => []),
  ]);

  const djen = {
    hoje:  { total: 0, concluidos: 0, pendentes: 0, erros: 0, publicacoes: 0 },
    ontem: { total: 0, concluidos: 0, pendentes: 0, erros: 0, publicacoes: 0 },
    anteriores: { total: 0, concluidos: 0, pendentes: 0, erros: 0, publicacoes: 0 }, // 2 a 6 dias atrás
    ultimaConclusao: null,
  };
  for (const f of fila || []) {
    const d = f.data === hoje ? djen.hoje : f.data === ontem ? djen.ontem : djen.anteriores;
    d.total++;
    if (f.status === 'concluido') d.concluidos++;
    else if (f.status === 'erro') d.erros++;
    else d.pendentes++;
    d.publicacoes += f.comunicacoes_encontradas || 0;
    if (f.concluido_em && (!djen.ultimaConclusao || f.concluido_em > djen.ultimaConclusao)) djen.ultimaConclusao = f.concluido_em;
  }

  const errosPorOrigem = {};
  for (const e of erros24h || []) errosPorOrigem[e.origem] = (errosPorOrigem[e.origem] || 0) + 1;

  // Cobertura: a pergunta que importa é "em quantos dias a fila dá a volta?".
  // Com 439+ processos e o DataJud lento, não é 1 dia — e é melhor saber o
  // número do que supor.
  const limiteViva  = new Date(agora - 5 * 60000).toISOString();
  const execs       = execucoes24h || [];
  const morreram24h = execs.filter(e => !e.terminou_em && e.iniciado_em < limiteViva).length;
  const voltaDias   = verificados24h > 0 ? +(comIndice / verificados24h).toFixed(1) : null;
  const cobertura = {
    verificados6h, verificados24h,
    porcento24h: comIndice ? Math.round((verificados24h / comIndice) * 100) : null,
    voltaDias,
    execucoes24h: execs.length,
    morreram24h,
    duracaoMediaS: execs.filter(e => e.duracao_ms).length
      ? Math.round(execs.filter(e => e.duracao_ms).reduce((s, e) => s + e.duracao_ms, 0) / execs.filter(e => e.duracao_ms).length / 1000)
      : null,
    registroAtivo: execs.length > 0,
  };

  const vencendo7d = (assinaturas || []).filter(a => a.status === 'ativo' && a.data_expiracao >= new Date(agora).toISOString() && a.data_expiracao <= em7d).length;
  const vencidas   = (assinaturas || []).filter(a => a.status !== 'ativo' || a.data_expiracao < new Date(agora).toISOString()).length;
  const emTrial    = (assinaturas || []).filter(a => a.plano === 'trial' && a.status === 'ativo' && a.data_expiracao >= new Date(agora).toISOString()).length;

  const config = {
    cronSecret: !!process.env.CRON_SECRET,
    resend:     !!process.env.RESEND_API_KEY,
    regiao:     process.env.VERCEL_REGION || null,
    deploy:     (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
  };

  // nivel: 'critico' | 'atencao' | 'info'
  const alertas = [];
  const add = (nivel, titulo, detalhe, acao) => alertas.push({ nivel, titulo, detalhe, acao: acao || null });

  if (!config.cronSecret) add('critico', 'CRON_SECRET não configurado',
    'Qualquer pessoa consegue disparar os crons pela URL. Na Vercel: Settings → Environment Variables → adicione CRON_SECRET com uma senha longa e faça um novo deploy.');
  if (!config.resend) add('critico', 'RESEND_API_KEY ausente', 'Nenhum e-mail está sendo enviado.');
  if (config.regiao && config.regiao !== 'gru1') add('atencao', `Funções rodando em ${config.regiao}`,
    'A API do DJEN bloqueia IPs fora do Brasil (403). Confira "regions": ["gru1"] no vercel.json.');

  const djenHorasSemConcluir = djen.ultimaConclusao ? (agora - new Date(djen.ultimaConclusao)) / 3600000 : null;
  if (djenHorasSemConcluir === null || djenHorasSemConcluir > 24) add('critico', 'DJEN parado',
    djen.ultimaConclusao ? `Nenhum caderno concluído há ${Math.round(djenHorasSemConcluir)}h.` : 'Nenhum caderno de hoje/ontem foi concluído.',
    { tipo: 'aba', aba: 'djen-cadernos', label: 'Ver cadernos' });
  const errosDjen = djen.hoje.erros + djen.ontem.erros + djen.anteriores.erros;
  if (errosDjen) add('atencao', `${errosDjen} caderno(s) do DJEN desistidos após muitas tentativas`, 'Veja a aba Cadernos DJEN — publicações desses tribunais/dias podem ter ficado de fora (dá pra buscar manualmente pela OAB no dashboard).',
    { tipo: 'aba', aba: 'djen-cadernos', label: 'Ver cadernos' });
  if (djen.anteriores.pendentes) add('atencao', `${djen.anteriores.pendentes} caderno(s) de dias anteriores ainda na fila do DJEN`,
    'A fila recupera atrasos em ordem (mais antigo primeiro), cerca de 14 por execução. Se o número não cair, o DJEN pode estar bloqueando — veja os erros.',
    { tipo: 'aba', aba: 'djen-cadernos', label: 'Ver fila' });

  if (semIndice) add('critico', `${semIndice} processo(s) SEM tribunal identificado — nunca serão atualizados`,
    'Sem o índice do DataJud o processo fica fora da fila de sincronização. Em geral é número de processo incompleto ou fora do padrão CNJ. O cron tenta preencher sozinho a cada execução; o que sobrar precisa do número corrigido no cadastro.',
    { tipo: 'filtro', filtro: 'semindice', label: 'Ver advogados' });
  if (atrasados7d) add('critico', `${atrasados7d} processo(s) sem atualização há mais de 7 dias`,
    'A fila não está dando a volta completa. Veja a vazão por execução no card do DataJud.',
    { tipo: 'aba', aba: 'sincronizacoes', label: 'Ver sincronizações' });
  if (desatualizados) add('atencao', `${desatualizados} processo(s) sem consulta bem-sucedida ao DataJud há mais de 48h`,
    'Eles continuam na fila e são tentados a cada execução. Se o número não cair, rode "DataJud agora" ou veja os erros.',
    { tipo: 'aba', aba: 'sincronizacoes', label: 'Ver sincronizações' });
  if (falhando) add('atencao', `${falhando} processo(s) falhando repetidamente no DataJud (3+ tentativas seguidas)`,
    'Continuam na fila. O erro de cada um aparece na ficha do advogado.',
    { tipo: 'filtro', filtro: 'desatualizados', label: 'Ver advogados' });
  if (nuncaVerificados) add('info', `${nuncaVerificados} processo(s) aguardando a primeira consulta ao DataJud`,
    'Normal logo após importação — o cron pega esses primeiro.');

  // Vende primeiro, conserta depois: pedido de licença esperando vai no topo,
  // porque é dinheiro parado e depende só de você responder.
  const pedidos = pedidosLicenca || [];
  if (pedidos.length) {
    const total = pedidos.reduce((s, p) => s + Number(p.valor || 0), 0);
    add('critico', `${pedidos.length} advogado(s) pedindo licença — R$ ${total} esperando`,
      'Eles escolheram o plano e estão aguardando você passar o Pix. Combine o pagamento e libere na aba Licenças.',
      { tipo: 'aba', aba: 'licencas', label: 'Ver pedidos' });
  }

  if (morreram24h) add('critico', `${morreram24h} execução(ões) automática(s) morreram no meio nas últimas 24h`,
    'A função começou e não chegou ao fim — quase sempre estouro do tempo máximo da Vercel (120s). Os processos que ficaram de fora voltam para a fila, mas a vazão cai.',
    { tipo: 'aba', aba: 'execucoes', label: 'Ver execuções' });

  if (cobertura.voltaDias && cobertura.voltaDias > 2) add('atencao',
    `No ritmo atual a fila leva ${cobertura.voltaDias} dias para consultar todos os processos`,
    `Nas últimas 24h foram ${verificados24h} de ${comIndice} processos. Enquanto isso, um movimento novo pode demorar esse tempo para aparecer. A saída estrutural é usar o DJEN como detector principal.`,
    { tipo: 'aba', aba: 'execucoes', label: 'Ver vazão' });

  const errosNossos = errosPorOrigem['cron:datajud-sistema'] || 0;
  if (errosNossos) add('critico', `${errosNossos} falha(s) do nosso sistema na sincronização (24h)`,
    'Não é instabilidade do CNJ — é algo que precisa ser corrigido no código ou nos dados (ex: número de processo inválido, erro ao gravar). Veja os erros.',
    { tipo: 'aba', aba: 'sincronizacoes', label: 'Ver erros' });

  const totalErros24h = Object.values(errosPorOrigem).reduce((s, n) => s + n, 0);
  if (totalErros24h >= 20) add('atencao', `${totalErros24h} erros de sincronização nas últimas 24h`,
    Object.entries(errosPorOrigem).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([o, n]) => `${o}: ${n}`).join(' · '),
    { tipo: 'aba', aba: 'sincronizacoes', label: 'Ver erros' });

  const ultimoEmailData = ultimoEmail?.[0]?.data || null;
  if (emailsPendentes && ultimoEmailData && ultimoEmailData < ontem) add('atencao', `${emailsPendentes} novidade(s) esperando e-mail`,
    `Nenhum e-mail enviado desde ${ultimoEmailData.split('-').reverse().join('/')}.`, { tipo: 'aba', aba: 'emails', label: 'Ver e-mails' });

  if (vencendo7d) add('info', `${vencendo7d} assinatura(s) vencem nos próximos 7 dias`, 'Bom momento para lembrar o cliente.',
    { tipo: 'filtro', filtro: 'vencendo', label: 'Ver quem' });
  if (vencidas) add('info', `${vencidas} conta(s) com assinatura vencida`, 'Esses usuários estão travados na tela de cobrança.',
    { tipo: 'filtro', filtro: 'vencidos', label: 'Ver quem' });

  return res.json({
    ok: true,
    geradoEm: new Date().toISOString(),
    config,
    datajud: { totalAtivos, comIndice, semIndice, desatualizados, atrasados7d, nuncaVerificados, falhando, ultimaVerificacao: ultimaVerif?.[0]?.ultima_verificacao || null },
    cobertura,
    djen,
    emails: { pendentes: emailsPendentes, avisosSite, ultimoEnvio: ultimoEmailData, ultimoTipo: ultimoEmail?.[0]?.tipo || null },
    erros24h: errosPorOrigem,
    assinaturas: { vencendo7d, vencidas, emTrial, pedidosPendentes: (pedidosLicenca || []).length },
    alertas,
  });
}

// ── LICENÇAS ─────────────────────────────────────────────────────────────────
// Uma tela só para a parte comercial: quem pediu licença e está esperando,
// quem vence nos próximos dias e quem já venceu.

const DIAS_DO_PLANO = { mensal: 30, semestral: 182, anual: 365 };

async function acaoLicencas(req, res, admin) {
  const agora = Date.now();

  const [{ data: pedidos, error: errPed }, { data: assinaturas }, usuarios] = await Promise.all([
    admin.from('solicitacoes_licenca').select('*').order('criado_em', { ascending: false }).limit(200),
    admin.from('assinaturas').select('*'),
    todosOsUsuarios(admin),
  ]);

  // Tabela recém-criada (migration ainda não rodou) não pode derrubar a aba.
  const indisponivel = errPed ? errPed.message : null;

  const porId = {};
  for (const u of usuarios || []) {
    porId[u.id] = {
      nome:     u.user_metadata?.full_name || u.user_metadata?.nome || '',
      email:    u.email || '',
      telefone: u.user_metadata?.telefone || '',
      oab:      u.user_metadata?.oab || '',
    };
  }

  const comDono = (p) => ({ ...p, ...(porId[p.escritorio_id] || {}) });

  const lista = (pedidos || []).map(comDono);
  const assinaturasComDono = (assinaturas || []).map(a => {
    const dias = Math.ceil((new Date(a.data_expiracao) - agora) / 86400000);
    const vencida = a.status !== 'ativo' || dias < 0;
    return { ...a, ...(porId[a.escritorio_id] || {}), diasRestantes: dias, vencida };
  }).sort((x, y) => x.diasRestantes - y.diasRestantes);

  return res.json({
    ok: true,
    indisponivel,
    pedidos: {
      pendentes: lista.filter(p => p.status === 'pendente'),
      historico: lista.filter(p => p.status !== 'pendente').slice(0, 60),
    },
    assinaturas: assinaturasComDono,
    resumo: {
      pedindo:    lista.filter(p => p.status === 'pendente').length,
      emTeste:    assinaturasComDono.filter(a => a.plano === 'trial' && !a.vencida).length,
      pagantes:   assinaturasComDono.filter(a => ['mensal','semestral','anual'].includes(a.plano) && !a.vencida).length,
      vencendo7d: assinaturasComDono.filter(a => !a.vencida && a.diasRestantes <= 7).length,
      vencidas:   assinaturasComDono.filter(a => a.vencida).length,
      receberNoAno: lista.filter(p => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0),
    },
  });
}

// Marca o pedido como pago e, de uma vez, estende a licença — são as duas
// metades da mesma ação, e separá-las deixaria pedido pago sem licença ativa.
async function acaoAtenderPedido(req, res, admin, adminUser) {
  const { id, decisao, notaInterna } = req.body || {};
  if (!id) return res.status(400).json({ erro: 'id do pedido é obrigatório.' });
  if (!['pago', 'cancelada'].includes(decisao)) {
    return res.status(400).json({ erro: 'decisao deve ser "pago" ou "cancelada".' });
  }

  const { data: pedido, error: errBusca } = await admin
    .from('solicitacoes_licenca').select('*').eq('id', id).maybeSingle();
  if (errBusca) return res.status(500).json({ erro: errBusca.message });
  if (!pedido)  return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.status !== 'pendente') {
    return res.status(422).json({ erro: `Este pedido já foi marcado como "${pedido.status}".` });
  }

  if (decisao === 'pago') {
    const dias = DIAS_DO_PLANO[pedido.plano];
    if (!dias) return res.status(422).json({ erro: `Plano "${pedido.plano}" sem duração definida.` });

    // Se a licença atual ainda está válida, soma a partir dela — quem renova
    // antes de vencer não perde os dias que já pagou.
    const { data: atual } = await admin.from('assinaturas')
      .select('data_expiracao, status').eq('escritorio_id', pedido.escritorio_id).maybeSingle();
    const base = (atual?.status === 'ativo' && new Date(atual.data_expiracao) > new Date())
      ? new Date(atual.data_expiracao)
      : new Date();
    const expiracao = new Date(base.getTime() + dias * 86400000);

    const { error: errAssin } = await admin.from('assinaturas').upsert({
      escritorio_id:   pedido.escritorio_id,
      plano:           pedido.plano,
      status:          'ativo',
      data_expiracao:  expiracao.toISOString(),
      valor_pago:      pedido.valor,
      forma_pagamento: 'pix',
      observacoes:     notaInterna || `Pedido de ${new Date(pedido.criado_em).toLocaleDateString('pt-BR')} liberado pelo painel`,
      atualizado_por:  adminUser.user.id,
    }, { onConflict: 'escritorio_id' });
    if (errAssin) return res.status(500).json({ erro: 'Erro ao liberar a licença: ' + errAssin.message });
  }

  const { error: errPedido } = await admin.from('solicitacoes_licenca').update({
    status:       decisao,
    atendido_em:  new Date().toISOString(),
    atendido_por: adminUser.user.id,
    nota_interna: notaInterna || null,
  }).eq('id', id);
  if (errPedido) return res.status(500).json({ erro: errPedido.message });

  return res.json({ ok: true, decisao });
}

// ── HISTÓRICO DAS EXECUÇÕES AUTOMÁTICAS ──────────────────────────────────────
// Responde às perguntas que a fotografia do momento não responde: o cron
// rodou? rendeu quanto? morreu no meio? está melhorando ou piorando?

async function acaoExecucoes(req, res, admin) {
  const agora = Date.now();
  const d7    = new Date(agora - 7 * 86400000).toISOString();

  const { data: execs, error } = await admin
    .from('cron_execucoes').select('*')
    .gte('iniciado_em', d7)
    .order('iniciado_em', { ascending: false })
    .limit(400);

  // Tabela recém-criada (migration ainda não rodou) não pode derrubar o painel.
  if (error) return res.json({ ok: true, indisponivel: error.message, execucoes: [], porDia: [], resumo: null });

  // Execução sem terminou_em e iniciada há mais de 5 min = morreu no meio.
  // Abaixo disso pode ser uma que está rodando agora.
  const limiteViva = new Date(agora - 5 * 60000).toISOString();
  const lista = (execs || []).map(e => ({
    ...e,
    morreu: !e.terminou_em && e.iniciado_em < limiteViva,
    rodando: !e.terminou_em && e.iniciado_em >= limiteViva,
  }));

  const porDia = {};
  for (const e of lista) {
    const dia = new Date(new Date(e.iniciado_em).getTime() - 3 * 3600000).toISOString().slice(0, 10);
    const d = (porDia[dia] ||= { dia, execucoes: 0, morreram: 0, comErro: 0, processados: 0, novos: 0, falhas: 0, publicacoes: 0 });
    d.execucoes++;
    if (e.morreu) d.morreram++;
    if (e.erro) d.comErro++;
    d.processados += e.processados || 0;
    d.novos       += e.resultados?.novos || 0;
    d.falhas      += e.resultados?.falhas || 0;
    d.publicacoes += e.resultados?.publicacoes || 0;
  }

  const ult24 = lista.filter(e => e.iniciado_em >= new Date(agora - 86400000).toISOString());
  const resumo = {
    ultimas24h:   ult24.length,
    morreram24h:  ult24.filter(e => e.morreu).length,
    processados24h: ult24.reduce((s, e) => s + (e.processados || 0), 0),
    novos24h:     ult24.reduce((s, e) => s + (e.resultados?.novos || 0), 0),
    duracaoMedia: ult24.filter(e => e.duracao_ms).length
      ? Math.round(ult24.filter(e => e.duracao_ms).reduce((s, e) => s + e.duracao_ms, 0) / ult24.filter(e => e.duracao_ms).length / 1000)
      : null,
    ultima: lista[0]?.iniciado_em || null,
  };

  return res.json({
    ok: true,
    execucoes: lista.slice(0, 60),
    porDia: Object.values(porDia).sort((a, b) => b.dia.localeCompare(a.dia)),
    resumo,
  });
}

// ── FICHA DE UM ADVOGADO ─────────────────────────────────────────────────────

async function acaoDetalheUsuario(req, res, admin) {
  const userId = req.query?.userId;
  if (!userId) return res.status(400).json({ erro: 'userId obrigatório.' });

  const h48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const [
    { data: ud, error: udErr },
    { data: procs },
    { data: assinatura },
    { data: erros },
    { data: colabs },
    { data: ultimosEmails },
  ] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from('processos')
      .select('id, numero, nome, apelido, cliente, tribunal, status, datajud_index, ultima_verificacao, notificacao_pendente, email_pendente, movimentos_recentes, sync_falhas, sync_ultimo_erro, sync_ultima_tentativa, created_at')
      .eq('user_id', userId).limit(2000),
    admin.from('assinaturas').select('plano, status, data_inicio, data_expiracao, valor_pago, forma_pagamento, observacoes').eq('escritorio_id', userId).maybeSingle(),
    admin.from('error_log').select('origem, mensagem, created_at').eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(15),
    admin.from('colaboradores').select('user_id, nome, email, cargo').eq('escritorio_id', userId).eq('status', 'ativo'),
    admin.from('notif_log').select('tipo, data').eq('user_id', userId).order('data', { ascending: false }).limit(5),
  ]);
  if (udErr || !ud?.user) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const u    = ud.user;
  const meta = u.user_metadata || {};
  const lista = procs || [];
  const ativos = lista.filter(p => p.status !== 'Arquivado');

  let ultimaPublicacaoDjen = null;
  const recentes = [];
  for (const p of ativos) {
    const movs = p.movimentos_recentes || [];
    const djen = movs.filter(ehMovDJEN).map(m => String(m.data || '').slice(0, 10)).sort().pop();
    if (djen && (!ultimaPublicacaoDjen || djen > ultimaPublicacaoDjen)) ultimaPublicacaoDjen = djen;
    const ultima = [...movs].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))[0];
    if (ultima) recentes.push({
      numero: p.numero, nome: p.apelido || p.nome, cliente: p.cliente || null,
      mov: ultima.nome, data: ultima.data, fonte: ehMovDJEN(ultima) ? 'DJEN' : 'DataJud',
      novo: !!p.notificacao_pendente,
    });
  }
  recentes.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  return res.json({
    ok: true,
    usuario: {
      id: u.id, email: u.email,
      nome: meta.full_name || meta.nome || '—',
      oabs: String(meta.oab || '').split(',').map(s => s.trim()).filter(Boolean),
      telefone: meta.telefone || null,
      criadoEm: u.created_at,
      ultimoLogin: meta.ultimo_acesso || u.last_sign_in_at || null,
      ultimoSignIn: u.last_sign_in_at || null,
      emailConfirmado: !!u.email_confirmed_at,
      bloqueado: !!(u.banned_until && new Date(u.banned_until) > new Date()),
      provider: u.app_metadata?.provider || 'email',
    },
    assinatura: assinatura || null,
    processos: {
      total: lista.length,
      ativos: ativos.length,
      arquivados: lista.length - ativos.length,
      monitorados: ativos.filter(p => p.datajud_index).length,
      semNumeroCnj: ativos.filter(p => !p.datajud_index).length,
      desatualizados48h: ativos.filter(p => p.datajud_index && (!p.ultima_verificacao || p.ultima_verificacao < h48)).length,
      avisosSite: ativos.filter(p => p.notificacao_pendente).length,
      emailsPendentes: ativos.filter(p => p.email_pendente).length,
      autoImportados: ativos.filter(p => (p.movimentos_recentes || []).some(m => m._auto_importado)).length,
    },
    ultimaPublicacaoDjen,
    recentes: recentes.slice(0, 8),
    // Fora da fila: sem índice do tribunal, nunca são consultados
    semIndice: ativos
      .filter(p => !p.datajud_index)
      .slice(0, 15)
      .map(p => ({ numero: p.numero, nome: p.apelido || p.nome, criadoEm: p.created_at })),
    falhando: ativos
      .filter(p => p.datajud_index && (p.sync_falhas || 0) > 0)
      .sort((a, b) => (b.sync_falhas || 0) - (a.sync_falhas || 0))
      .slice(0, 10)
      .map(p => ({
        numero: p.numero, nome: p.apelido || p.nome, falhas: p.sync_falhas,
        erro: p.sync_ultimo_erro, ultimaTentativa: p.sync_ultima_tentativa, ultimaVerificacao: p.ultima_verificacao,
      })),
    colaboradores: colabs || [],
    ultimosEmails: ultimosEmails || [],
    erros: erros || [],
  });
}

async function acaoPendentes(req, res, admin) {
  let page = 1;
  const todos = [];
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
    if (error) return res.status(500).json({ erro: error.message });
    todos.push(...(data?.users || []));
    if ((data?.users || []).length < 1000) break;
    page++;
  }
  // Desde as assinaturas, quem tem linha em "assinaturas" (trial ou pago) já
  // entra direto — só quem NÃO tem fica travado na tela /aguardando. Antes a
  // lista mostrava todo mundo sem o status antigo "aprovado", inclusive
  // usuários ativos em trial, ao lado de um botão que apaga a conta.
  const { data: assinaturas } = await admin.from('assinaturas').select('escritorio_id');
  const comAssinatura = new Set((assinaturas || []).map(a => a.escritorio_id));
  const { data: colabs } = await admin.from('colaboradores').select('user_id').eq('status', 'ativo');
  const ehColaborador = new Set((colabs || []).map(c => c.user_id));

  const pendentes = todos
    .filter(u => u.user_metadata?.status !== 'aprovado' && !comAssinatura.has(u.id) && !ehColaborador.has(u.id))
    .map(u => ({
      id:         u.id,
      email:      u.email,
      nome:       u.user_metadata?.full_name || u.user_metadata?.nome || '',
      oab:        u.user_metadata?.oab || '',
      provider:   u.app_metadata?.provider || 'email',
      created_at: u.created_at,
    }))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return res.json({ ok: true, pendentes });
}

async function acaoAprovarUsuario(req, res, admin) {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ erro: 'userId obrigatório.' });
  const { data: { user }, error: getErr } = await admin.auth.admin.getUserById(userId);
  if (getErr || !user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const { error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { ...user.user_metadata, status: 'aprovado' },
  });
  if (error) return res.status(500).json({ erro: error.message });

  // Notifica o usuário por e-mail
  const nome  = user.user_metadata?.full_name || user.user_metadata?.nome || '';
  const email = user.email;
  if (email) {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Meu Processo <contato@meuprocesso.app.br>',
          to: email,
          subject: 'Seu acesso foi liberado — Meu Processo',
          html: emailAprovado(nome ? nome.split(' ')[0] : 'Advogado(a)'),
        }),
      }).catch(() => {});
    }
  }

  return res.json({ ok: true });
}

function emailAprovado(nome) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#1d4ed8 100%);border-radius:16px 16px 0 0;padding:36px 40px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-.5px">Meu Processo</div>
        <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">Gestão jurídica inteligente</div>
      </td></tr>
      <tr><td style="background:#fff;padding:40px 40px 32px;border-radius:0 0 16px 16px">
        <div style="text-align:center;margin-bottom:28px">
          <div style="font-size:48px">🎉</div>
          <p style="font-size:20px;font-weight:700;color:#111827;margin:12px 0 8px">Seu acesso foi liberado!</p>
          <p style="font-size:15px;color:#6b7280;margin:0">Bem-vindo(a) ao Meu Processo, ${nome}.</p>
        </div>
        <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 28px;text-align:center">
          Agora você tem acesso completo à plataforma — monitore seus processos, acompanhe prazos e receba alertas automáticos de movimentações.
        </p>
        <div style="text-align:center;margin-bottom:32px">
          <a href="https://meuprocesso.app.br/login" style="display:inline-block;background:linear-gradient(135deg,#1e3a5f,#1d4ed8);color:#fff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 40px;border-radius:12px">
            Acessar minha conta →
          </a>
        </div>
        <div style="border-top:1px solid #e5e7eb;padding-top:24px;text-align:center">
          <p style="font-size:13px;color:#6b7280;margin:0">
            Qualquer dúvida, responda este e-mail.<br>
            <strong style="color:#111827">Matheus Vilar</strong> · Fundador, Meu Processo
          </p>
        </div>
      </td></tr>
      <tr><td style="padding:20px 0;text-align:center">
        <p style="font-size:12px;color:#9ca3af;margin:0">Meu Processo · <a href="https://meuprocesso.app.br" style="color:#6b7280;text-decoration:none">meuprocesso.app.br</a></p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

async function acaoRejeitarUsuario(req, res, admin) {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ erro: 'userId obrigatório.' });

  // Trava de segurança: excluir conta é irreversível. Só permite para conta
  // vazia (sem processos, tarefas, clientes nem assinatura). Pra suspender
  // alguém que já usa o sistema, use "Bloquear".
  const vazio = t => admin.from(t).select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const [nProc, nTar, nCli, { data: assin }] = await Promise.all([
    contar(vazio('processos')), contar(vazio('tarefas')), contar(vazio('clientes')),
    admin.from('assinaturas').select('escritorio_id').eq('escritorio_id', userId).maybeSingle(),
  ]);
  if (nProc === null || nTar === null || nCli === null) {
    return res.status(500).json({ erro: 'Não foi possível confirmar que a conta está vazia — exclusão cancelada.' });
  }
  if (nProc || nTar || nCli || assin) {
    return res.status(422).json({
      erro: `Conta em uso (${nProc} processo(s), ${nTar} tarefa(s), ${nCli} cliente(s)${assin ? ', com assinatura' : ''}) — não pode ser excluída. Use "Bloquear" se precisar suspender o acesso.`,
    });
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return res.status(500).json({ erro: error.message });
  return res.json({ ok: true });
}
