// Cron de e-mails — lê o que sincronizar.js já gravou no banco e envia.
// BRT = UTC-3 → 11h UTC = 8h BRT (morning) | 16h UTC = 13h BRT (afternoon) | 20h UTC = 17h BRT (evening)
// Roda 30 min DEPOIS de sincronizar.js — não faz chamadas ao DataJud/DJEN.

import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY       = process.env.RESEND_API_KEY;
const CRON_SECRET      = process.env.CRON_SECRET;

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado.' });
  }
  if (!SUPA_SERVICE_KEY) {
    return res.status(500).json({ erro: 'SUPABASE_SERVICE_KEY não configurada.' });
  }

  const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
  const hoje  = new Date().toISOString().slice(0, 10);

  const tipoOverride = req.query?.tipo;
  const horaUTC      = new Date().getUTCHours();
  const tipo = tipoOverride || (horaUTC < 14 ? 'morning' : horaUTC < 18 ? 'afternoon' : 'evening');

  try {
    if (tipo === 'morning')   return await rodarMorning(admin, res, hoje);
    if (tipo === 'afternoon') return await rodarAfternoon(admin, res, hoje);
    return await rodarEvening(admin, res, hoje);
  } catch (e) {
    await logErro(admin, `cron:email-${tipo}`, e.message, { stack: e.stack });
    return res.status(500).json({ erro: e.message });
  }
}

async function logErro(admin, origem, mensagem, detalhes, userId) {
  try {
    await admin.from('error_log').insert({ origem, mensagem, detalhes: detalhes || null, user_id: userId || null });
  } catch (_) {}
}

// ── MORNING ───────────────────────────────────────────────────────────────────
// Só envia se sincronizar.js marcou notificacao_pendente = true no banco.

async function rodarMorning(admin, res, hoje) {
  const { data: pendentes } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, cliente, tribunal, datajud_index, ultima_verificacao, novos_movimentos')
    .eq('notificacao_pendente', true)
    .neq('status', 'Arquivado');

  if (!pendentes?.length) {
    return res.status(200).json({ ok: true, tipo: 'morning', emailsEnviados: 0, hoje, motivo: 'nada pendente' });
  }

  // Agrupa por usuário — separa atualizações de processos novos auto-importados
  const porUsuario = {};
  for (const p of pendentes) {
    if (!porUsuario[p.user_id]) porUsuario[p.user_id] = { atualizacoes: [], novosProcessos: [] };
    const novos        = (p.novos_movimentos || []).slice(0, 3);
    const autoImportado = novos.some(m => m._auto_importado);
    const item = {
      processoId:        p.id,
      numero:            p.numero,
      nome:              p.apelido || p.nome,
      cliente:           p.cliente || null,
      tribunal:          p.tribunal || extrairTribunal(p.datajud_index),
      ultimaVerificacao: p.ultima_verificacao,
      novos,
    };
    if (autoImportado) porUsuario[p.user_id].novosProcessos.push(item);
    else               porUsuario[p.user_id].atualizacoes.push(item);
  }

  const userIds          = Object.keys(porUsuario);
  const agendaPorUsuario = await buscarAgendaSemana(admin, userIds, hoje);

  let emailsEnviados = 0;
  const processosNotificados = [];

  for (const userId of userIds) {
    if (await jaNotificouHoje(admin, userId, 'morning', hoje)) continue;

    let email, nome;
    try {
      const { data: ud } = await admin.auth.admin.getUserById(userId);
      email = ud?.user?.email;
      if (!email) continue;
      nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];
    } catch (e) {
      await logErro(admin, 'cron:email-morning', e.message, { userId }, userId);
      continue;
    }

    const { atualizacoes, novosProcessos } = porUsuario[userId];
    try {
      await enviarDigestMorning(email, nome, agendaPorUsuario[userId] || [], atualizacoes, novosProcessos);
      emailsEnviados++;
      await logNotif(admin, userId, 'morning', hoje);
      processosNotificados.push(...[...atualizacoes, ...novosProcessos].map(a => a.processoId));
    } catch (e) {
      await logErro(admin, 'cron:email-morning', e.message, { email }, userId);
    }
  }

  if (processosNotificados.length) {
    await admin.from('processos')
      .update({ notificacao_pendente: false, ultima_notif_email: new Date().toISOString() })
      .in('id', processosNotificados);
  }

  return res.status(200).json({ ok: true, tipo: 'morning', emailsEnviados, hoje });
}

// ── AFTERNOON ─────────────────────────────────────────────────────────────────
// Picks up any pendentes from afternoon sync + prazos vencendo amanhã.

async function rodarAfternoon(admin, res, hoje) {
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // Pendentes que surgiram APÓS o morning (ultima_notif_email não é de hoje)
  const cutoffMorning = `${hoje}T11:30:00Z`;
  const [{ data: pendentes }, { data: eventosAmanha }] = await Promise.all([
    admin.from('processos')
      .select('id, user_id, numero, nome, apelido, cliente, tribunal, datajud_index, ultima_verificacao, novos_movimentos')
      .eq('notificacao_pendente', true)
      .neq('status', 'Arquivado')
      .or(`ultima_notif_email.is.null,ultima_notif_email.lt.${cutoffMorning}`),
    admin.from('eventos')
      .select('user_id, titulo, tipo, data, urgencia')
      .gte('data', hoje)
      .lte('data', amanha),
  ]);

  const porUsuario = {};
  for (const p of pendentes || []) {
    if (!porUsuario[p.user_id]) porUsuario[p.user_id] = { atualizacoes: [], novosProcessos: [], prazos: [] };
    const novos        = (p.novos_movimentos || []).slice(0, 3);
    const autoImportado = novos.some(m => m._auto_importado);
    const item = {
      processoId:        p.id,
      numero:            p.numero,
      nome:              p.apelido || p.nome,
      cliente:           p.cliente || null,
      tribunal:          p.tribunal || extrairTribunal(p.datajud_index),
      ultimaVerificacao: p.ultima_verificacao,
      novos,
    };
    if (autoImportado) porUsuario[p.user_id].novosProcessos.push(item);
    else               porUsuario[p.user_id].atualizacoes.push(item);
  }
  for (const e of eventosAmanha || []) {
    if (!porUsuario[e.user_id]) porUsuario[e.user_id] = { atualizacoes: [], novosProcessos: [], prazos: [] };
    porUsuario[e.user_id].prazos.push({ descricao: e.titulo, data_prazo: e.data, urgencia: e.urgencia });
  }

  let emailsEnviados = 0;
  const processosNotificados = [];

  for (const [userId, dados] of Object.entries(porUsuario)) {
    if (!dados.atualizacoes.length && !dados.novosProcessos.length && !dados.prazos.length) continue;
    if (await jaNotificouHoje(admin, userId, 'afternoon', hoje)) continue;

    let email, nome;
    try {
      const { data: ud } = await admin.auth.admin.getUserById(userId);
      email = ud?.user?.email;
      if (!email) continue;
      nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];
    } catch (e) {
      await logErro(admin, 'cron:email-afternoon', e.message, { userId }, userId);
      continue;
    }

    try {
      await enviarAlertaAfternoon(email, nome, dados.atualizacoes, dados.prazos, dados.novosProcessos);
      emailsEnviados++;
      await logNotif(admin, userId, 'afternoon', hoje);
      processosNotificados.push(...[...dados.atualizacoes, ...dados.novosProcessos].map(a => a.processoId));
    } catch (e) {
      await logErro(admin, 'cron:email-afternoon', e.message, { email }, userId);
    }
  }

  if (processosNotificados.length) {
    await admin.from('processos')
      .update({ notificacao_pendente: false, ultima_notif_email: new Date().toISOString() })
      .in('id', processosNotificados);
  }

  return res.status(200).json({ ok: true, tipo: 'afternoon', emailsEnviados, hoje });
}

// ── EVENING ───────────────────────────────────────────────────────────────────

async function rodarEvening(admin, res, hoje) {
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data: eventos } = await admin
    .from('eventos')
    .select('user_id, titulo, tipo, data, urgencia')
    .gte('data', hoje)
    .lte('data', amanha)
    .eq('urgencia', 'urgente');

  if (!eventos?.length) return res.status(200).json({ ok: true, tipo: 'evening', emailsEnviados: 0 });

  const prazosPorUsuario = {};
  for (const e of eventos) {
    if (!prazosPorUsuario[e.user_id]) prazosPorUsuario[e.user_id] = [];
    prazosPorUsuario[e.user_id].push({ descricao: e.titulo, data_prazo: e.data, urgencia: e.urgencia });
  }

  let emailsEnviados = 0;
  for (const [userId, lista] of Object.entries(prazosPorUsuario)) {
    if (await jaNotificouHoje(admin, userId, 'evening', hoje)) continue;

    let email, nome;
    try {
      const { data: ud } = await admin.auth.admin.getUserById(userId);
      email = ud?.user?.email;
      if (!email) continue;
      nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];
    } catch (e) {
      await logErro(admin, 'cron:email-evening', e.message, { userId }, userId);
      continue;
    }

    try {
      await enviarAlertaEvening(email, nome, lista, hoje);
      emailsEnviados++;
      await logNotif(admin, userId, 'evening', hoje);
    } catch (e) {
      await logErro(admin, 'cron:email-evening', e.message, { email }, userId);
    }
  }

  return res.status(200).json({ ok: true, tipo: 'evening', emailsEnviados, hoje });
}

// ── AGENDA ────────────────────────────────────────────────────────────────────

async function buscarAgendaSemana(admin, userIds, hoje) {
  if (!userIds.length) return {};
  const seteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const agenda   = {};

  const [{ data: eventos }, { data: honorarios }, { data: tarefas }] = await Promise.all([
    admin.from('eventos').select('user_id, titulo, tipo, data, urgencia').in('user_id', userIds).gte('data', hoje).lte('data', seteDias).order('data'),
    admin.from('honorarios').select('user_id, descricao, data_vencimento, status').in('user_id', userIds).gte('data_vencimento', hoje).lte('data_vencimento', seteDias).in('status', ['pendente', 'vencido']).order('data_vencimento'),
    admin.from('tarefas').select('user_id, titulo, prazo, prioridade').in('user_id', userIds).gte('prazo', hoje).lte('prazo', seteDias).neq('coluna', 'concluida').order('prazo'),
  ]);

  for (const e of eventos || []) {
    if (!agenda[e.user_id]) agenda[e.user_id] = [];
    agenda[e.user_id].push({ tipo: 'evento', descricao: e.titulo, data: e.data, urgencia: e.urgencia });
  }
  for (const h of honorarios || []) {
    if (!agenda[h.user_id]) agenda[h.user_id] = [];
    agenda[h.user_id].push({ tipo: 'honorario', descricao: h.descricao, data: h.data_vencimento, urgencia: h.status === 'vencido' ? 'urgente' : 'baixa' });
  }
  for (const t of tarefas || []) {
    if (!agenda[t.user_id]) agenda[t.user_id] = [];
    agenda[t.user_id].push({ tipo: 'tarefa', descricao: t.titulo, data: t.prazo, urgencia: t.prioridade });
  }
  for (const uid of Object.keys(agenda)) {
    agenda[uid].sort((a, b) => a.data.localeCompare(b.data));
  }
  return agenda;
}

// ── LOG ───────────────────────────────────────────────────────────────────────

async function jaNotificouHoje(admin, userId, tipo, hoje) {
  const { data } = await admin.from('notif_log')
    .select('user_id').eq('user_id', userId).eq('tipo', tipo).eq('data', hoje).maybeSingle();
  return !!data;
}

async function logNotif(admin, userId, tipo, hoje) {
  await admin.from('notif_log').upsert(
    { user_id: userId, tipo, data: hoje },
    { onConflict: 'user_id,tipo,data' }
  );
}

// ── EMAILS ────────────────────────────────────────────────────────────────────

function cabecalho(subtitulo) {
  return `<div style="background:#1a2e6b;padding:24px 28px"><div style="font-size:18px;font-weight:700;color:#fff">Meu Processo</div><div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">${subtitulo}</div></div>`;
}

function rodape() {
  return `<div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb"><div style="font-size:11px;color:#9ca3af;text-align:center">Notificações automáticas do Meu Processo · <a href="https://meuprocesso.app.br/dashboard" style="color:#9ca3af">dashboard</a></div></div>`;
}

function btnDashboard(cor) {
  return `<div style="text-align:center;margin-top:20px;padding:0 28px 24px"><a href="https://meuprocesso.app.br/dashboard" style="display:inline-block;background:${cor};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600">Abrir dashboard →</a></div>`;
}

async function enviarDigestMorning(para, nome, agenda, atualizacoes, novosProcessos = []) {
  const diaSemana = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });
  const totalItens = atualizacoes.length + novosProcessos.length;
  const assunto = novosProcessos.length && !atualizacoes.length
    ? `[Meu Processo] ${novosProcessos.length} novo(s) processo(s) encontrado(s) no seu nome`
    : totalItens > 1
      ? `[Meu Processo] ${totalItens} atualizações nos seus processos`
      : `[Meu Processo] Atualização: ${atualizacoes[0]?.nome || novosProcessos[0]?.numero || 'processo'}`;

  const tipoIcon = { evento: '📅', tarefa: '✅', honorario: '💰' };

  const blocoNovosProcessos = novosProcessos.length ? `
<div style="padding:20px 28px 8px;border-top:3px solid #f59e0b;background:#fffbeb">
  <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">🔔 Novo processo encontrado no seu nome</div>
  <div style="font-size:12px;color:#78350f;margin-bottom:12px">Identificamos publicações no DJEN com a sua OAB referentes a processos que ainda não estavam na sua conta. Eles foram adicionados automaticamente.</div>
  ${novosProcessos.slice(0, 5).map(item => `
  <div style="background:#fff;border:1.5px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:8px">
    <div style="font-weight:700;color:#92400e;font-size:13px;font-family:monospace">${item.numero}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:3px">${[item.tribunal, item.novos?.[0]?.nome?.replace('DJEN — ','') || 'Publicação DJEN'].filter(Boolean).join(' · ')}</div>
    <div style="font-size:11px;color:#d97706;margin-top:4px;font-weight:600">→ Acesse o dashboard para ver os detalhes e acompanhar este processo.</div>
  </div>`).join('')}
</div>` : '';

  const blocoAtualizacoes = atualizacoes.length ? `
<div style="padding:20px 28px 8px">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">⚖️ Atualizações nos processos</div>
  ${atualizacoes.slice(0, 5).map(item => {
    const novos = (item.novos || []).slice(0, 3);
    const detectadoEm = novos[0]?._detectadoEm;
    const movDate     = (novos[0]?.data || '').slice(0, 10);
    const atrasado    = detectadoEm && movDate && movDate < detectadoEm
      ? `<div style="font-size:10px;color:#6366f1;margin-top:3px;margin-bottom:2px">📡 Identificado hoje no DataJud · pub. tribunal: ${formatarDataCurta(movDate + 'T12:00:00')}</div>`
      : '';
    return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px">
    <tr>
      <td width="72" valign="top" style="padding-right:10px;text-align:center">
        <div style="background:#eef2ff;border-radius:6px;padding:6px 4px">
          <div style="font-size:14px;font-weight:700;color:#1a2e6b;line-height:1">${item.ultimaVerificacao ? formatarHora(item.ultimaVerificacao) : '—'}</div>
          <div style="font-size:10px;color:#6366f1;margin-top:2px">${item.ultimaVerificacao ? formatarDataCurta(item.ultimaVerificacao) : ''}</div>
        </div>
      </td>
      <td valign="top">
        <div style="background:#f8f9fa;border-left:3px solid #1a2e6b;border-radius:0 6px 6px 0;padding:8px 12px">
          <div style="font-weight:700;color:#1a2e6b;font-size:13px">${item.nome}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">
            ${[item.cliente ? `👤 ${item.cliente}` : '', item.tribunal || '', item.numero || ''].filter(Boolean).join(' · ')}
          </div>
          ${atrasado}
          <div style="margin-top:4px">
            ${novos.map(m => `
            <div style="font-size:11px;color:#374151;padding:2px 0;border-bottom:1px solid #e5e7eb">
              <span style="color:#9ca3af">${formatarData(m.data)}</span> — ${m.nome}
            </div>`).join('')}
          </div>
        </div>
      </td>
    </tr>
  </table>`;
  }).join('')}
</div>` : '';

  const blocoAgenda = agenda.length ? `
<div style="padding:20px 28px 8px;${atualizacoes.length ? 'border-top:1px solid #e5e7eb' : ''}">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">📋 Esta semana</div>
  ${agenda.slice(0, 10).map(item => {
    const dataFmt = new Date(item.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const badge   = item.urgencia === 'urgente'
      ? '<span style="font-size:10px;background:#fef2f2;color:#dc2626;padding:2px 7px;border-radius:4px;font-weight:700;margin-left:6px">URGENTE</span>'
      : '';
    const icon = tipoIcon[item.tipo] || '•';
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:8px 0;border-bottom:1px solid #f3f4f6"><tr>
      <td width="72" style="font-size:11px;color:#9ca3af;vertical-align:top;padding-top:2px;white-space:nowrap">${dataFmt}</td>
      <td style="font-size:13px;color:#111827;padding-left:10px">${icon} ${item.descricao}${badge}</td>
    </tr></table>`;
  }).join('')}
</div>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho('Resumo do dia')}
  <div style="padding:20px 28px 8px;font-size:15px;color:#111827">Bom dia, <strong>${nome}</strong>! Atualizações de ${diaSemana}.</div>
  ${blocoNovosProcessos}
  ${blocoAtualizacoes}
  ${blocoAgenda}
  ${btnDashboard('#1a2e6b')}
  ${rodape()}
</div>
</body></html>`;

  await enviarEmail(para, assunto, html);
}

async function enviarAlertaAfternoon(para, nome, atualizacoes, prazos, novosProcessos = []) {
  const partes  = [];
  if (novosProcessos.length) partes.push(`${novosProcessos.length} processo(s) novo(s) encontrado(s)`);
  if (atualizacoes.length)   partes.push(`${atualizacoes.length} atualização(ões)`);
  if (prazos.length)         partes.push(`prazo${prazos.length > 1 ? 's' : ''} vencendo amanhã`);
  const assunto = `[Meu Processo] ${partes.join(' + ')}`;

  const blocoAtualizacoes = atualizacoes.length ? `
<div style="padding:20px 28px 8px">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">⚖️ Novidades desde esta manhã</div>
  ${atualizacoes.map(item => {
    const novos = (item.novos || []).slice(0, 3);
    const detectadoEm = novos[0]?._detectadoEm;
    const movDate     = (novos[0]?.data || '').slice(0, 10);
    const atrasado    = detectadoEm && movDate && movDate < detectadoEm
      ? `<div style="font-size:10px;color:#6366f1;margin-top:3px;margin-bottom:2px">📡 Identificado hoje no DataJud · pub. tribunal: ${formatarDataCurta(movDate + 'T12:00:00')}</div>`
      : '';
    return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px">
    <tr>
      <td width="72" valign="top" style="padding-right:10px;text-align:center">
        <div style="background:#eef2ff;border-radius:6px;padding:6px 4px">
          <div style="font-size:14px;font-weight:700;color:#1a2e6b;line-height:1">${item.ultimaVerificacao ? formatarHora(item.ultimaVerificacao) : '—'}</div>
          <div style="font-size:10px;color:#6366f1;margin-top:2px">${item.ultimaVerificacao ? formatarDataCurta(item.ultimaVerificacao) : ''}</div>
        </div>
      </td>
      <td valign="top">
        <div style="background:#f8f9fa;border-left:3px solid #1a2e6b;border-radius:0 6px 6px 0;padding:8px 12px">
          <div style="font-weight:700;color:#1a2e6b;font-size:13px">${item.nome}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">
            ${[item.cliente ? `👤 ${item.cliente}` : '', item.tribunal || '', item.numero || ''].filter(Boolean).join(' · ')}
          </div>
          ${atrasado}
          <div style="margin-top:4px">
            ${novos.map(m => `
            <div style="font-size:11px;color:#374151;padding:2px 0;border-bottom:1px solid #e5e7eb">
              <span style="color:#9ca3af">${formatarData(m.data)}</span> — ${m.nome}
            </div>`).join('')}
          </div>
        </div>
      </td>
    </tr>
  </table>`;
  }).join('')}
</div>` : '';

  const blocoPrazos = prazos.length ? `
<div style="padding:20px 28px 8px;${atualizacoes.length || novosProcessos.length ? 'border-top:1px solid #e5e7eb' : ''}">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">⏰ Prazo amanhã</div>
  ${prazos.map(p => `
  <div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:6px;padding:12px 14px;margin-bottom:8px">
    <div style="font-size:13px;color:#92400e;font-weight:600">${p.descricao}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">${formatarData(p.data_prazo)}</div>
  </div>`).join('')}
</div>` : '';

  const blocoNovosProcessos = novosProcessos.length ? `
<div style="padding:20px 28px 8px;border-top:3px solid #f59e0b;background:#fffbeb">
  <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">🔔 Novo processo encontrado no seu nome</div>
  <div style="font-size:12px;color:#78350f;margin-bottom:12px">Identificamos publicações no DJEN com a sua OAB referentes a processos que ainda não estavam na sua conta. Eles foram adicionados automaticamente.</div>
  ${novosProcessos.slice(0, 5).map(item => `
  <div style="background:#fff;border:1.5px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:8px">
    <div style="font-weight:700;color:#92400e;font-size:13px;font-family:monospace">${item.numero}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:3px">${[item.tribunal, item.novos?.[0]?.nome?.replace('DJEN — ','') || 'Publicação DJEN'].filter(Boolean).join(' · ')}</div>
    <div style="font-size:11px;color:#d97706;margin-top:4px;font-weight:600">→ Acesse o dashboard para ver os detalhes e acompanhar este processo.</div>
  </div>`).join('')}
</div>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho('Alerta do dia')}
  <div style="padding:20px 28px 8px;font-size:15px;color:#111827">Olá, <strong>${nome}</strong>!</div>
  ${blocoNovosProcessos}
  ${blocoAtualizacoes}
  ${blocoPrazos}
  ${btnDashboard('#1a2e6b')}
  ${rodape()}
</div>
</body></html>`;

  await enviarEmail(para, assunto, html);
}

async function enviarAlertaEvening(para, nome, prazos, hoje) {
  const temHoje = prazos.some(p => p.data_prazo === hoje);
  const assunto = `⚠️ [Meu Processo] Prazo urgente vencendo ${temHoje ? 'hoje' : 'amanhã'}`;

  const blocos = prazos.map(p => {
    const ehHoje = p.data_prazo === hoje;
    return `<div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:6px;padding:14px 16px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:#991b1b">${ehHoje ? '🔴 HOJE' : '🟠 AMANHÃ'} — ${p.descricao}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px">${formatarData(p.data_prazo)}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  <div style="background:#dc2626;padding:24px 28px"><div style="font-size:18px;font-weight:700;color:#fff">Meu Processo</div><div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:2px">Alerta de prazo urgente</div></div>
  <div style="padding:24px 28px">
    <div style="font-size:15px;color:#111827;margin-bottom:16px"><strong>${nome}</strong>, você tem ${prazos.length > 1 ? 'prazos urgentes' : 'um prazo urgente'} vencendo em breve.</div>
    ${blocos}
  </div>
  ${btnDashboard('#dc2626')}
  ${rodape()}
</div>
</body></html>`;

  await enviarEmail(para, assunto, html);
}

async function enviarEmail(para, assunto, html) {
  if (!RESEND_KEY) return;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ from: 'notificacoes@meuprocesso.app.br', to: para, subject: assunto, html }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => 'erro desconhecido');
    throw new Error(`Resend ${r.status}: ${msg}`);
  }
}

function formatarData(iso) {
  if (!iso) return '—';
  try { return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function formatarHora(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); }
  catch { return '—'; }
}

function formatarDataCurta(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' }); }
  catch { return ''; }
}

function extrairTribunal(datajudIndex) {
  if (!datajudIndex) return null;
  // api_publica_tjdft → TJDFT | api_publica_trf1 → TRF1 | api_publica_stj → STJ
  const m = datajudIndex.match(/api_publica_(.+)$/);
  return m ? m[1].toUpperCase().replace(/-/g, '') : null;
}
