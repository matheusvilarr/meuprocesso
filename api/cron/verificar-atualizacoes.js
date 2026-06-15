// Cron de notificações inteligentes — 3 turnos/dia (dias úteis e fins de semana)
// BRT = UTC-3 → 11h UTC = 8h BRT (morning) | 16h UTC = 13h BRT (afternoon) | 20h UTC = 17h BRT (evening)
// Regras: morning sempre envia se há algo; afternoon só DJEN novo + prazo amanhã; evening só prazos urgentes hoje/amanhã

import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DATAJUD_KEY      = process.env.DATAJUD_API_KEY
  || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const RESEND_KEY       = process.env.RESEND_API_KEY;
const CRON_SECRET      = process.env.CRON_SECRET;
const DJEN_API         = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

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

  // Detecta turno pelo horário UTC ou override manual (?tipo=morning|afternoon|evening)
  const tipoOverride = req.query?.tipo;
  const horaUTC      = new Date().getUTCHours();
  const tipo = tipoOverride || (horaUTC < 14 ? 'morning' : horaUTC < 18 ? 'afternoon' : 'evening');

  if (tipo === 'morning')   return rodarMorning(admin, res, hoje);
  if (tipo === 'afternoon') return rodarAfternoon(admin, res, hoje);
  return rodarEvening(admin, res, hoje);
}

// ── MORNING (8h BRT) — Digest completo: agenda da semana + processos atualizados ──

async function rodarMorning(admin, res, hoje) {
  const { data: processos, error } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, datajud_index, movimentos_hash, created_at, favorito')
    .not('numero', 'is', null)
    .neq('status', 'Arquivado')
    .order('favorito', { ascending: false });
  if (error) return res.status(500).json({ erro: error.message });

  const userIds = [...new Set((processos || []).map(p => p.user_id))];
  const oabsPorUsuario = await buscarOabsUsuarios(admin, userIds);

  // DataJud e DJEN devem rodar sequencialmente — ambos fazem UPDATE em movimentos_recentes
  const atualizacoesDatajud = await verificarDatajud(processos, admin, hoje);
  const atualizacoesDJEN    = await verificarDJEN(processos, oabsPorUsuario, admin, hoje);
  const agendaPorUsuario    = await buscarAgendaSemana(admin, userIds, hoje);

  const todosUserIds = [...new Set([
    ...Object.keys(atualizacoesDatajud),
    ...Object.keys(atualizacoesDJEN),
    ...Object.keys(agendaPorUsuario),
  ])];

  let emailsEnviados = 0;
  const processosNotificados = [];

  for (const userId of todosUserIds) {
    if (await jaNotificouHoje(admin, userId, 'morning', hoje)) continue;

    const { data: ud } = await admin.auth.admin.getUserById(userId);
    const email = ud?.user?.email;
    if (!email) continue;
    const nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];

    const atualizacoes = [
      ...(atualizacoesDatajud[userId] || []),
      ...(atualizacoesDJEN[userId] || []),
    ];
    const agenda = agendaPorUsuario[userId] || [];
    if (!atualizacoes.length && !agenda.length) continue;

    try {
      await enviarDigestMorning(email, nome, agenda, atualizacoes);
      emailsEnviados++;
      await logNotif(admin, userId, 'morning', hoje);
      processosNotificados.push(...atualizacoes.map(a => a.processoId).filter(Boolean));
    } catch (_) {}
  }

  if (processosNotificados.length) {
    await admin.from('processos')
      .update({ ultima_notif_email: new Date().toISOString() })
      .in('id', processosNotificados);
  }

  return res.status(200).json({ ok: true, tipo: 'morning', emailsEnviados, hoje });
}

// ── AFTERNOON (13h BRT) — DJEN do dia + prazo vencendo amanhã ────────────────

async function rodarAfternoon(admin, res, hoje) {
  // Só busca processos NÃO notificados esta manhã (ultima_notif_email < 11h UTC de hoje)
  const cutoffMorning = `${hoje}T11:00:00Z`;
  const { data: processos } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, movimentos_hash, created_at, favorito')
    .not('numero', 'is', null)
    .neq('status', 'Arquivado')
    .or(`ultima_notif_email.is.null,ultima_notif_email.lt.${cutoffMorning}`)
    .order('favorito', { ascending: false });

  const userIds = processos?.length ? [...new Set(processos.map(p => p.user_id))] : [];
  const oabsPorUsuario = userIds.length ? await buscarOabsUsuarios(admin, userIds) : {};
  const atualizacoesDJEN = processos?.length
    ? await verificarDJEN(processos, oabsPorUsuario, admin, hoje)
    : {};

  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data: eventosAmanha } = await admin
    .from('eventos')
    .select('user_id, titulo, tipo, data, urgencia')
    .gte('data', hoje)
    .lte('data', amanha);

  const prazosPorUsuario = {};
  for (const e of eventosAmanha || []) {
    if (!prazosPorUsuario[e.user_id]) prazosPorUsuario[e.user_id] = [];
    prazosPorUsuario[e.user_id].push({ descricao: e.titulo, data_prazo: e.data, urgencia: e.urgencia });
  }

  const todosUserIds = [...new Set([
    ...Object.keys(atualizacoesDJEN),
    ...Object.keys(prazosPorUsuario),
  ])];

  let emailsEnviados = 0;
  for (const userId of todosUserIds) {
    if (await jaNotificouHoje(admin, userId, 'afternoon', hoje)) continue;

    const djen   = atualizacoesDJEN[userId] || [];
    const prazos = prazosPorUsuario[userId] || [];
    if (!djen.length && !prazos.length) continue;

    const { data: ud } = await admin.auth.admin.getUserById(userId);
    const email = ud?.user?.email;
    if (!email) continue;
    const nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];

    try {
      await enviarAlertaAfternoon(email, nome, djen, prazos);
      emailsEnviados++;
      await logNotif(admin, userId, 'afternoon', hoje);
    } catch (_) {}
  }

  return res.status(200).json({ ok: true, tipo: 'afternoon', emailsEnviados, hoje });
}

// ── EVENING (17h BRT) — Só prazos urgentes vencendo hoje ou amanhã ───────────

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

    const { data: ud } = await admin.auth.admin.getUserById(userId);
    const email = ud?.user?.email;
    if (!email) continue;
    const nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];

    try {
      await enviarAlertaEvening(email, nome, lista, hoje);
      emailsEnviados++;
      await logNotif(admin, userId, 'evening', hoje);
    } catch (_) {}
  }

  return res.status(200).json({ ok: true, tipo: 'evening', emailsEnviados, hoje });
}

// ── DADOS ─────────────────────────────────────────────────────────────────────

async function buscarOabsUsuarios(admin, userIds) {
  const result = {};
  for (const uid of userIds) {
    try {
      const { data: ud } = await admin.auth.admin.getUserById(uid);
      const oabRaw = ud?.user?.user_metadata?.oab || '';
      if (!oabRaw) continue;
      result[uid] = oabRaw.split(',').map(s => s.trim()).filter(Boolean).map(o => {
        const m = o.toUpperCase().replace(/\./g, '').match(/^(?:OAB[/ ]?)?([A-Z]{2})[/ ]?(\d{3,6})$/);
        return m ? { uf: m[1], num: m[2] } : null;
      }).filter(Boolean);
    } catch (_) {}
  }
  return result;
}

async function verificarDatajud(processos, admin, hoje) {
  const porUsuario = {};
  // Favoritos têm prioridade — são verificados primeiro
  const ordenados = [...processos].sort((a, b) => (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0));
  for (const proc of ordenados.filter(p => p.datajud_index)) {
    if ((proc.created_at || '').slice(0, 10) === hoje) continue; // importado hoje: não notifica
    try {
      const hits = await buscarNoDatajud(proc.datajud_index, proc.numero);
      if (!hits?.length) continue;

      const todosMovs = (hits[0]._source.movimentos || [])
        .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
        .slice(0, 100)
        .map(m => ({ nome: m.nome, data: parsarData(m.dataHora) }));

      const novoHash = todosMovs.slice(0, 6).map(m => m.data + m.nome).join('|');
      if (novoHash === proc.movimentos_hash) continue;

      const importadoEm = (proc.created_at || '').slice(0, 10);
      const todosNovos  = proc.movimentos_hash
        ? todosMovs.filter(m => !proc.movimentos_hash.includes(m.data + m.nome))
        : todosMovs.slice(0, 1);
      const novosRecentes = todosNovos.filter(m => m.data && (!importadoEm || m.data >= importadoEm));

      const update = { movimentos_recentes: todosMovs, movimentos_hash: novoHash, ultima_verificacao: new Date().toISOString() };
      if (novosRecentes.length) {
        update.notificacao_pendente = true;
        update.novos_movimentos     = novosRecentes;
      }
      await admin.from('processos').update(update).eq('id', proc.id);

      if (novosRecentes.length) {
        if (!porUsuario[proc.user_id]) porUsuario[proc.user_id] = [];
        porUsuario[proc.user_id].push({ processoId: proc.id, nome: proc.apelido || proc.nome, novos: novosRecentes.slice(0, 3), fonte: 'CNJ DataJud' });
      }
    } catch (_) {}
  }
  return porUsuario;
}

async function verificarDJEN(processos, oabsPorUsuario, admin, hoje) {
  const porUsuario = {};
  const ontem      = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const numeroSet  = new Set(processos.map(p => p.numero).filter(Boolean));
  const userIds    = [...new Set(processos.map(p => p.user_id))];

  for (const uid of userIds) {
    const oabs = oabsPorUsuario[uid];
    if (!oabs?.length) continue;
    try {
      const reqs = oabs.map(oab =>
        fetch(`${DJEN_API}?${new URLSearchParams({ numeroOab: oab.num, ufOab: oab.uf, dataDisponibilizacaoInicio: ontem, dataDisponibilizacaoFim: hoje, pagina: 1, tamanhoPagina: 100 })}`)
          .then(r => r.ok ? r.json() : { items: [] })
      );
      const items = (await Promise.all(reqs)).flatMap(r => r.items || []);

      for (const item of items) {
        const PADRAO = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
        const nums = [...new Set(
          (item.numeroprocessocommascara ? [item.numeroprocessocommascara] : [])
            .concat((item.texto || '').match(PADRAO) || [])
        )];

        for (const num of nums) {
          if (!numeroSet.has(num)) continue;
          const proc = processos.find(p => p.numero === num && p.user_id === uid);
          if (!proc) continue;
          if ((proc.created_at || '').slice(0, 10) === hoje) continue; // importado hoje: não notifica

          const movDJEN = { nome: `DJEN — ${item.tipoComunicacao || 'Publicação'}`, data: (item.data_disponibilizacao || hoje) + 'T00:00:00' };
          const { data: atual } = await admin.from('processos').select('movimentos_recentes').eq('id', proc.id).single();
          const movsAtuais = atual?.movimentos_recentes || [];
          if (movsAtuais.some(m => m.data === movDJEN.data && m.nome === movDJEN.nome)) continue;

          await admin.from('processos').update({
            movimentos_recentes:  [movDJEN, ...movsAtuais].slice(0, 100),
            ultima_verificacao:   new Date().toISOString(),
            notificacao_pendente: true,
            novos_movimentos:     [movDJEN],
          }).eq('id', proc.id);

          if (!porUsuario[uid]) porUsuario[uid] = [];
          porUsuario[uid].push({ processoId: proc.id, nome: proc.apelido || proc.nome, novos: [movDJEN], fonte: 'DJEN' });
        }
      }
    } catch (_) {}
  }
  return porUsuario;
}

async function buscarAgendaSemana(admin, userIds, hoje) {
  if (!userIds.length) return {};
  const seteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const agenda   = {};

  const [{ data: eventos }, { data: honorarios }] = await Promise.all([
    admin.from('eventos').select('user_id, titulo, tipo, data, urgencia').in('user_id', userIds).gte('data', hoje).lte('data', seteDias).order('data'),
    admin.from('honorarios').select('user_id, descricao, data_vencimento, status').in('user_id', userIds).gte('data_vencimento', hoje).lte('data_vencimento', seteDias).in('status', ['pendente', 'vencido']).order('data_vencimento'),
  ]);

  for (const e of eventos || []) {
    if (!agenda[e.user_id]) agenda[e.user_id] = [];
    agenda[e.user_id].push({ tipo: 'evento', descricao: e.titulo, data: e.data, urgencia: e.urgencia });
  }
  for (const h of honorarios || []) {
    if (!agenda[h.user_id]) agenda[h.user_id] = [];
    agenda[h.user_id].push({ tipo: 'honorario', descricao: `💰 Honorário: ${h.descricao}`, data: h.data_vencimento, urgencia: h.status === 'vencido' ? 'urgente' : 'baixa' });
  }
  for (const uid of Object.keys(agenda)) {
    agenda[uid].sort((a, b) => a.data.localeCompare(b.data));
  }
  return agenda;
}

// ── LOG / DEDUPLICAÇÃO ────────────────────────────────────────────────────────

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

async function enviarDigestMorning(para, nome, agenda, atualizacoes) {
  const diaSemana = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });
  const assunto   = atualizacoes.length
    ? `Bom dia! ${atualizacoes.length} atualização(ões) + agenda da semana`
    : `Bom dia! Sua agenda da semana — ${diaSemana}`;

  const blocoAgenda = agenda.length ? `
<div style="padding:20px 28px 8px">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">📅 Sua semana</div>
  ${agenda.slice(0, 8).map(item => {
    const dataFmt = new Date(item.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const badge   = item.urgencia === 'urgente'
      ? '<span style="font-size:10px;background:#fef2f2;color:#dc2626;padding:2px 7px;border-radius:4px;font-weight:700;margin-left:6px">URGENTE</span>'
      : '';
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:8px 0;border-bottom:1px solid #f3f4f6"><tr>
      <td width="72" style="font-size:11px;color:#9ca3af;vertical-align:top;padding-top:2px;white-space:nowrap">${dataFmt}</td>
      <td style="font-size:13px;color:#111827;padding-left:10px">${item.descricao}${badge}</td>
    </tr></table>`;
  }).join('')}
</div>` : '';

  const blocoAtualizacoes = atualizacoes.length ? `
<div style="padding:20px 28px 8px;${agenda.length ? 'border-top:1px solid #e5e7eb' : ''}">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">⚖️ Atualizações nos processos</div>
  ${atualizacoes.slice(0, 5).map(item => `
  <div style="background:#f8f9fa;border-left:4px solid #1a2e6b;border-radius:6px;padding:12px 14px;margin-bottom:10px">
    <div style="font-weight:700;color:#1a2e6b;font-size:13px;margin-bottom:6px">${item.nome}</div>
    ${item.novos.map(m => `<div style="font-size:12px;color:#374151;padding:3px 0;border-bottom:1px solid #e5e7eb"><span style="color:#9ca3af">${formatarData(m.data)}</span> — ${m.nome}</div>`).join('')}
    <div style="font-size:10px;color:#9ca3af;margin-top:6px">${item.fonte}</div>
  </div>`).join('')}
</div>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho('Resumo do dia')}
  <div style="padding:20px 28px 8px;font-size:15px;color:#111827">Bom dia, <strong>${nome}</strong>! Aqui está o resumo de ${diaSemana}.</div>
  ${blocoAgenda}
  ${blocoAtualizacoes}
  ${btnDashboard('#1a2e6b')}
  ${rodape()}
</div>
</body></html>`;

  await enviarEmail(para, assunto, html);
}

async function enviarAlertaAfternoon(para, nome, djen, prazos) {
  const partes  = [];
  if (djen.length)   partes.push(`${djen.length} publicação(ões) no DJEN`);
  if (prazos.length) partes.push(`prazo${prazos.length > 1 ? 's' : ''} vencendo amanhã`);
  const assunto = `[Meu Processo] ${partes.join(' + ')}`;

  const blocoDJEN = djen.length ? `
<div style="padding:20px 28px 8px">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">📢 Publicações no DJEN</div>
  ${djen.map(item => `
  <div style="background:#f8f9fa;border-left:4px solid #1a2e6b;border-radius:6px;padding:12px 14px;margin-bottom:8px">
    <div style="font-weight:700;color:#1a2e6b;font-size:13px;margin-bottom:4px">${item.nome}</div>
    ${item.novos.map(m => `<div style="font-size:12px;color:#374151">${m.nome}</div>`).join('')}
  </div>`).join('')}
</div>` : '';

  const blocoPrazos = prazos.length ? `
<div style="padding:20px 28px 8px;${djen.length ? 'border-top:1px solid #e5e7eb' : ''}">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em">⏰ Prazo amanhã</div>
  ${prazos.map(p => `
  <div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:6px;padding:12px 14px;margin-bottom:8px">
    <div style="font-size:13px;color:#92400e;font-weight:600">${p.descricao}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">${formatarData(p.data_prazo)}</div>
  </div>`).join('')}
</div>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho('Alerta do dia')}
  <div style="padding:20px 28px 8px;font-size:15px;color:#111827">Olá, <strong>${nome}</strong>! Há novidades desde esta manhã.</div>
  ${blocoDJEN}
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
    body: JSON.stringify({ from: 'notificacoes@meuprocesso.app.br', to: para, subject: assunto, html }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => 'erro desconhecido');
    throw new Error(`Resend ${r.status}: ${msg}`);
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

async function buscarNoDatajud(index, numero) {
  const numeroLimpo = numero.replace(/[.\-\/ ]/g, '');
  try {
    const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
      method: 'POST',
      headers: { 'Authorization': `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: 1, query: { match: { numeroProcesso: numeroLimpo } } }),
    });
    if (!r.ok) return null;
    const buffer = await r.arrayBuffer();
    return JSON.parse(decodificarBuffer(buffer)).hits?.hits || null;
  } catch { return null; }
}

function decodificarBuffer(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

function parsarData(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{14}$/.test(str)) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}T${str.slice(8,10)}:${str.slice(10,12)}:${str.slice(12,14)}`;
  if (/^\d{8}$/.test(str))  return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
  return s;
}

function formatarData(iso) {
  if (!iso) return '—';
  try { return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}
