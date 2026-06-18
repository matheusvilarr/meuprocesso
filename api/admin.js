import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function getAdminClient() {
  return createClient(SUPA_URL, SUPA_SERVICE_KEY);
}

// Verifica o token do usuário logado e confirma que ele está na tabela admins.
// Retorna null se não for admin — nunca confiar em flags vindas do client.
async function requireAdmin(req, admin) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id, nivel')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (!adminRow) return null;
  return { user: userData.user, nivel: adminRow.nivel };
}

async function acaoDados(req, res, admin, adminUser) {
  const { data: usersList, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return res.status(500).json({ erro: usersErr.message });
  const users = usersList?.users || [];

  const [
    { data: processosRows },
    { data: tarefasRows },
    { data: colaboradoresRows },
    { data: adminsRows },
    { data: codigos },
  ] = await Promise.all([
    admin.from('processos').select('user_id, datajud_index, ultima_verificacao, notificacao_pendente').neq('status', 'Arquivado'),
    admin.from('tarefas').select('user_id').neq('coluna', 'concluida'),
    admin.from('colaboradores').select('escritorio_id, user_id').eq('status', 'ativo'),
    admin.from('admins').select('user_id, nivel'),
    admin.from('codigos_acesso')
      .select('id, codigo, descricao, ativo, usos_max, usos_atual, email_convidado, enviado_em, usado_em, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const contagemProcessos = {};
  const syncStats = {};
  for (const p of processosRows || []) {
    contagemProcessos[p.user_id] = (contagemProcessos[p.user_id] || 0) + 1;
    if (!syncStats[p.user_id]) syncStats[p.user_id] = { sincronizados: 0, comNotificacao: 0, ultimaSync: null };
    const s = syncStats[p.user_id];
    if (p.datajud_index) s.sincronizados++;
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

  const advogados = users
    .map(u => ({
      id:             u.id,
      nome:           u.user_metadata?.full_name || u.user_metadata?.nome || '—',
      email:          u.email,
      oab:            u.user_metadata?.oab || '—',
      criadoEm:       u.created_at,
      ultimoLogin:    u.last_sign_in_at || null,
      emailConfirmado: !!u.email_confirmed_at,
      bloqueado:      !!(u.banned_until && new Date(u.banned_until) > new Date()),
      numProcessos:     contagemProcessos[u.id] || 0,
      numSincronizados: syncStats[u.id]?.sincronizados || 0,
      numNotificacoes:  syncStats[u.id]?.comNotificacao || 0,
      ultimaSync:       syncStats[u.id]?.ultimaSync || null,
      numTarefas:       contagemTarefas[u.id] || 0,
      numColaboradores: colaboradoresPorTitular[u.id] || 0,
      nivelAdmin:       adminMap[u.id] || null,
    }))
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  const totalSincronizados = (processosRows || []).filter(p => p.datajud_index).length;
  const totalNotificacoes  = (processosRows || []).filter(p => p.notificacao_pendente).length;
  const stats = {
    totalAdvogados:     advogados.length,
    totalBloqueados:    advogados.filter(a => a.bloqueado).length,
    totalSemConfirmar:  advogados.filter(a => !a.emailConfirmado).length,
    totalProcessos:     processosRows?.length || 0,
    totalSincronizados,
    totalNotificacoes,
    convitesPendentes:  (codigos || []).filter(c => c.email_convidado && !c.usado_em).length,
  };

  return res.json({ ok: true, advogados, codigos: codigos || [], stats, meuNivel: adminUser.nivel });
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

  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const target = usersList?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase().trim());
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

  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersList?.users?.some(u => u.email?.toLowerCase() === emailNorm)) {
    return res.status(422).json({ erro: 'Esse e-mail já tem conta cadastrada.' });
  }

  const { data: existente } = await admin
    .from('codigos_acesso')
    .select('id, codigo, enviado_em')
    .eq('email_convidado', emailNorm)
    .is('usado_em', null)
    .eq('ativo', true)
    .maybeSingle();

  if (existente) {
    return res.status(422).json({ erro: `Já existe um convite pendente para esse e-mail (código ${existente.codigo}). Use "Reenviar".` });
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

  try {
    await enviarEmailConvite(emailNorm, codigo);
    await admin.from('codigos_acesso').update({ enviado_em: new Date().toISOString() }).eq('id', novoCodigo.id);
  } catch (e) {
    return res.status(200).json({ ok: true, codigo: novoCodigo, avisoEmail: 'Código gerado, mas o e-mail não pôde ser enviado: ' + e.message });
  }

  return res.json({ ok: true, codigo: novoCodigo });
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

  try {
    await enviarEmailConvite(row.email_convidado, row.codigo);
  } catch (e) {
    return res.status(502).json({ erro: 'Falha ao enviar e-mail: ' + e.message });
  }

  await admin.from('codigos_acesso').update({ enviado_em: new Date().toISOString() }).eq('id', id);
  return res.json({ ok: true });
}

async function enviarEmailConvite(email, codigo) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY não configurada.');

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3002';
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

// ── Helpers DataJud (cópia local para a ação de sync admin) ──────────────────

function _decodeBuf(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

function _parsarData(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{14}$/.test(str)) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}T${str.slice(8,10)}:${str.slice(10,12)}:${str.slice(12,14)}`;
  if (/^\d{8}$/.test(str))  return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
  return s;
}

async function _buscarDatajud(index, numero) {
  const key = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
  const numeroLimpo = numero.replace(/[.\-\/ ]/g, '');
  try {
    const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
      method: 'POST',
      headers: { 'Authorization': `ApiKey ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ size: 1, query: { match: { numeroProcesso: numeroLimpo } } }),
    });
    if (!r.ok) return null;
    return JSON.parse(_decodeBuf(await r.arrayBuffer())).hits?.hits || null;
  } catch { return null; }
}

async function acaoSincronizarProcessos(req, res, admin, adminUser) {
  const { userId } = req.body || {};
  const startAt = Date.now();

  // Ordena pelos menos sincronizados primeiro — garante rotação entre todos
  let q = admin.from('processos')
    .select('id, user_id, numero, datajud_index, movimentos_hash, created_at')
    .not('datajud_index', 'is', null)
    .neq('status', 'Arquivado')
    .order('ultima_verificacao', { ascending: true, nullsFirst: true });
  if (userId) q = q.eq('user_id', userId);

  const { data: processos, error } = await q;
  if (error) return res.status(500).json({ erro: error.message });

  const hoje = new Date().toISOString().slice(0, 10);
  let atualizados = 0, semMudanca = 0, erros = 0, parou = false;

  for (let i = 0; i < processos.length; i += 10) {
    if (Date.now() - startAt > 75000) { parou = true; break; }

    const lote = processos.slice(i, i + 10);
    await Promise.all(lote.map(async proc => {
      if ((proc.created_at || '').slice(0, 10) === hoje) return;
      const hits = await _buscarDatajud(proc.datajud_index, proc.numero);
      if (!hits?.length) { erros++; return; }

      const movimentos = (hits[0]._source.movimentos || [])
        .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
        .slice(0, 100)
        .map(m => ({ nome: m.nome, data: _parsarData(m.dataHora) }));

      const novoHash = movimentos.slice(0, 6).map(m => m.data + m.nome).join('|');
      if (novoHash === proc.movimentos_hash) { semMudanca++; return; }

      const novos = proc.movimentos_hash
        ? movimentos.filter(m => !proc.movimentos_hash.includes(m.data + m.nome))
        : movimentos.slice(0, 1);
      const novosValidos = novos.filter(m => m.data && m.data >= (proc.created_at || '').slice(0, 10));

      const update = { movimentos_recentes: movimentos, movimentos_hash: novoHash, ultima_verificacao: new Date().toISOString() };
      if (novosValidos.length) { update.notificacao_pendente = true; update.novos_movimentos = novosValidos; }

      const { error: upErr } = await admin.from('processos').update(update).eq('id', proc.id);
      if (upErr) erros++;
      else atualizados++;
    }));
  }

  return res.json({
    ok: true,
    total: processos.length,
    atualizados,
    semMudanca,
    erros,
    parou,
    elapsed: Math.round((Date.now() - startAt) / 1000) + 's',
  });
}

export default async function handler(req, res) {
  const admin = getAdminClient();
  const adminUser = await requireAdmin(req, admin);
  if (!adminUser) return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

  const acao = req.method === 'GET' ? req.query?.acao : (req.body || {}).acao;

  if (acao === 'dados')   return acaoDados(req, res, admin, adminUser);
  if (acao === 'emails')  return acaoEmails(req, res, admin);

  if (req.method !== 'POST') return res.status(405).end();

  if (acao === 'gerar-codigo')       return acaoGerarCodigo(req, res, admin, adminUser);
  if (acao === 'gerenciar-admin')    return acaoGerenciarAdmin(req, res, admin, adminUser);
  if (acao === 'toggle-codigo')      return acaoToggleCodigo(req, res, admin);
  if (acao === 'toggle-status')      return acaoToggleStatus(req, res, admin, adminUser);
  if (acao === 'convidar-advogado')     return acaoConvidarAdvogado(req, res, admin, adminUser);
  if (acao === 'reenviar-convite')      return acaoReenviarConvite(req, res, admin);
  if (acao === 'sincronizar-processos') return acaoSincronizarProcessos(req, res, admin, adminUser);
  if (acao === 'emails' || req.query?.acao === 'emails') return acaoEmails(req, res, admin);

  return res.status(400).json({ erro: 'acao inválida.' });
}
