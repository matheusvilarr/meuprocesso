// Cron de e-mails — lê o que sincronizar.js já gravou no banco e envia.
// BRT = UTC-3 → 11h UTC = 8h BRT (morning) | 16h UTC = 13h BRT (afternoon) | 20h UTC = 17h BRT (evening)
// Roda 30 min DEPOIS de sincronizar.js — não faz chamadas ao DataJud/DJEN.

import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
// Títulos antigos vieram gravados como 'APELAçãO CíVEL' (importação de jun/2026);
// o painel normaliza na tela e o e-mail precisa normalizar igual.
import { usuariosComAcesso, enviarAvisoReativacao, enviarEmail, tituloProcesso, novidadesParaEmail,
         tokenDescadastro, linkDescadastro, definirDescadastro, lerOab } from '../../lib/sync-comum.js';
// Conta de parcelas/pagamentos de honorários — o MESMO arquivo que a tela usa
// (dashboard.html carrega como <script>), pra e-mail e tela nunca discordarem
// sobre o que está vencido. Expõe globalThis.HonCalc.
import '../../js/honorarios-calc.js';
const HonCalc = globalThis.HonCalc;

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET      = process.env.CRON_SECRET;
// Segredo dos workers locais (fila STJ e DJEN — scripts/). Só vale para o
// ?tipo=instant: o worker do DJEN avisa que gravou intimação nova e o e-mail
// sai na hora. Os outros tipos continuam exclusivos do CRON_SECRET.
const STJ_FILA_SECRET  = process.env.STJ_FILA_SECRET;

export default async function handler(req, res) {
  // /descadastrar (rewrite no vercel.json) cai aqui: o plano Hobby já está no
  // teto de 12 funções, não cabe um arquivo novo em api/. Autenticado pelo
  // HMAC do link, não pelo CRON_SECRET.
  if (req.query?.acao === 'descadastrar') return descadastrar(req, res);

  const authHeader = req.headers['authorization'];
  // Fecha por padrão: se a variável CRON_SECRET desaparecer da Vercel (num
  // deploy novo, um erro de digitação), antes isso liberava o cron para
  // qualquer pessoa da internet disparar. Agora falta de segredo em produção
  // é motivo para recusar, não para abrir. Fora da Vercel (localhost) segue
  // liberado, senão não dá para testar.
  if (process.env.VERCEL && !CRON_SECRET) {
    return res.status(503).json({ erro: 'CRON_SECRET não configurado no servidor.' });
  }
  const workerInstant = STJ_FILA_SECRET && req.query?.tipo === 'instant' && authHeader === `Bearer ${STJ_FILA_SECRET}`;
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}` && !workerInstant) {
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
    if (tipo === 'instant')           return await rodarInstant(admin, res, hoje);
    if (tipo === 'morning')           return await rodarMorning(admin, res, hoje);
    if (tipo === 'afternoon')         return await rodarAfternoon(admin, res, hoje);
    if (tipo === 'prazo_fatal')       return await rodarPrazoFatal(admin, res, hoje);
    if (tipo === 'honorario_vencido') return await rodarHonorarioVencido(admin, res, hoje);
    if (tipo === 'cadastro_incompleto') return await rodarCadastroIncompleto(admin, res, hoje, req.query?.simular === '1');
    return await rodarEvening(admin, res, hoje);
  } catch (e) {
    await logErro(admin, `cron:email-${tipo}`, e.message, { stack: e.stack });
    return res.status(500).json({ erro: e.message });
  }
}

// GET = clique no link do rodapé (mostra página de confirmação).
// POST = botão "Cancelar inscrição" do Gmail (one-click, RFC 8058) — só 200.
// &voltar=1 reativa, pra quem clicou sem querer.
async function descadastrar(req, res) {
  const userId = String(req.query?.u || '');
  const token  = String(req.query?.t || '');
  const voltar = req.query?.voltar === '1';

  const esperado = userId ? tokenDescadastro(userId) : '';
  const valido = SUPA_SERVICE_KEY && token.length === esperado.length && esperado.length > 0 &&
    timingSafeEqual(Buffer.from(token), Buffer.from(esperado));

  const pagina = (titulo, texto, link) => `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo} — Meu Processo</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:440px;margin:64px auto;background:#fff;border-radius:12px;padding:36px 32px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  <div style="font-size:20px;font-weight:700;color:#053958;margin-bottom:12px">${titulo}</div>
  <div style="font-size:14px;color:#6b7280;line-height:1.7">${texto}</div>
  ${link || ''}
</div></body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!valido) {
    return res.status(400).send(pagina('Link inválido', 'Este link de descadastro não é válido ou está incompleto. Se quiser parar de receber os e-mails, responda qualquer e-mail nosso pedindo o descadastro.'));
  }

  try {
    const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
    await definirDescadastro(admin, userId, !voltar);
  } catch (e) {
    return res.status(500).send(pagina('Não deu certo', 'Tivemos um problema ao salvar sua preferência. Tente de novo em alguns minutos.'));
  }

  if (req.method === 'POST') return res.status(200).send('ok');

  if (voltar) {
    return res.status(200).send(pagina('Avisos reativados ✓', 'Você voltou a receber os e-mails automáticos do Meu Processo.'));
  }
  const linkVoltar = `<a href="${linkDescadastro(userId)}&voltar=1" style="display:inline-block;margin-top:20px;font-size:13px;color:#0d5a96">Cliquei sem querer — quero continuar recebendo</a>`;
  return res.status(200).send(pagina('Pronto, você foi descadastrado', 'Você não vai mais receber os e-mails automáticos do Meu Processo. Seus processos continuam sendo acompanhados normalmente no painel.', linkVoltar));
}

async function logErro(admin, origem, mensagem, detalhes, userId) {
  try {
    await admin.from('error_log').insert({ origem, mensagem, detalhes: detalhes || null, user_id: userId || null });
  } catch (_) {}
}

// ── INSTANT ───────────────────────────────────────────────────────────────────
// Chamado diretamente pelo sincronizar.js quando há movimentos novos.
// Não usa jaNotificouHoje — dedup feito pelo ciclo email_pendente.
// email_pendente controla só o e-mail; notificacao_pendente (aviso no site)
// continua aceso até o advogado abrir o processo.

async function rodarInstant(admin, res, hoje) {
  const { data: pendentes, error: errPendentes } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, cliente, tribunal, datajud_index, ultima_verificacao, novos_movimentos')
    .eq('email_pendente', true)
    .neq('status', 'Arquivado');
  // Erro de leitura não é "nada pendente" — antes o e-mail simplesmente não saía, sem registro.
  if (errPendentes) throw new Error(`Falha ao ler processos pendentes: ${errPendentes.message}`);

  if (!pendentes?.length) {
    return res.status(200).json({ ok: true, tipo: 'instant', emailsEnviados: 0, motivo: 'nada pendente' });
  }

  const porUsuario = {};
  for (const p of pendentes) {
    if (!porUsuario[p.user_id]) porUsuario[p.user_id] = { atualizacoes: [], novosProcessos: [] };
    const novos         = novidadesParaEmail(p.novos_movimentos);
    const autoImportado = novos.some(m => m._auto_importado);
    const item = {
      processoId: p.id, numero: p.numero,
      nome: p.apelido || tituloProcesso(p.nome), cliente: p.cliente || null,
      tribunal: p.tribunal || extrairTribunal(p.datajud_index),
      ultimaVerificacao: p.ultima_verificacao, novos,
    };
    if (autoImportado) porUsuario[p.user_id].novosProcessos.push(item);
    else               porUsuario[p.user_id].atualizacoes.push(item);
  }

  let emailsEnviados = 0;
  const processosNotificados = [];
  const comAcesso = await usuariosComAcesso(admin, Object.keys(porUsuario));

  for (const userId of Object.keys(porUsuario)) {
    if (!comAcesso.has(userId)) { await avisoSemAcesso(admin, userId, porUsuario[userId]); continue; }
    let email, nome;
    try {
      const { data: ud } = await admin.auth.admin.getUserById(userId);
      email = ud?.user?.email;
      if (!email) continue;
      nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];
    } catch (e) {
      await logErro(admin, 'cron:email-instant', e.message, { userId }, userId);
      continue;
    }

    const { atualizacoes, novosProcessos } = porUsuario[userId];
    try {
      await enviarDigestMorning(email, nome, [], atualizacoes, novosProcessos);
      emailsEnviados++;
      await logNotif(admin, userId, 'instant', hoje);
      processosNotificados.push(...[...atualizacoes, ...novosProcessos].map(a => a.processoId));
    } catch (e) {
      await logErro(admin, 'cron:email-instant', e.message, { email }, userId);
    }
  }

  if (processosNotificados.length) {
    await admin.from('processos')
      .update({ email_pendente: false, ultima_notif_email: new Date().toISOString() })
      .in('id', processosNotificados);
  }

  return res.status(200).json({ ok: true, tipo: 'instant', emailsEnviados, hoje });
}

// ── MORNING ───────────────────────────────────────────────────────────────────
// Só envia se a sincronização marcou email_pendente = true no banco.

async function rodarMorning(admin, res, hoje) {
  const { data: pendentes, error: errPendentes } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, cliente, tribunal, datajud_index, ultima_verificacao, novos_movimentos')
    .eq('email_pendente', true)
    .neq('status', 'Arquivado');
  // Erro de leitura não é "nada pendente" — antes o e-mail simplesmente não saía, sem registro.
  if (errPendentes) throw new Error(`Falha ao ler processos pendentes: ${errPendentes.message}`);

  if (!pendentes?.length) {
    return res.status(200).json({ ok: true, tipo: 'morning', emailsEnviados: 0, hoje, motivo: 'nada pendente' });
  }

  // Agrupa por usuário — separa atualizações de processos novos auto-importados
  const porUsuario = {};
  for (const p of pendentes) {
    if (!porUsuario[p.user_id]) porUsuario[p.user_id] = { atualizacoes: [], novosProcessos: [] };
    const novos        = novidadesParaEmail(p.novos_movimentos);
    const autoImportado = novos.some(m => m._auto_importado);
    const item = {
      processoId:        p.id,
      numero:            p.numero,
      nome:              p.apelido || tituloProcesso(p.nome),
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
  const comAcesso = await usuariosComAcesso(admin, userIds);

  for (const userId of userIds) {
    if (!comAcesso.has(userId)) { await avisoSemAcesso(admin, userId, porUsuario[userId]); continue; }
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
      .update({ email_pendente: false, ultima_notif_email: new Date().toISOString() })
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
  const [{ data: pendentes, error: errPendentes }, { data: eventosAmanha, error: errEventos }] = await Promise.all([
    admin.from('processos')
      .select('id, user_id, numero, nome, apelido, cliente, tribunal, datajud_index, ultima_verificacao, novos_movimentos')
      .eq('email_pendente', true)
      .neq('status', 'Arquivado')
      .or(`ultima_notif_email.is.null,ultima_notif_email.lt.${cutoffMorning}`),
    admin.from('eventos')
      .select('user_id, titulo, tipo, data, urgencia')
      .gte('data', hoje)
      .lte('data', amanha),
  ]);
  if (errPendentes || errEventos) throw new Error(`Falha ao ler pendentes/eventos: ${(errPendentes || errEventos).message}`);

  const porUsuario = {};
  for (const p of pendentes || []) {
    if (!porUsuario[p.user_id]) porUsuario[p.user_id] = { atualizacoes: [], novosProcessos: [], prazos: [] };
    const novos        = novidadesParaEmail(p.novos_movimentos);
    const autoImportado = novos.some(m => m._auto_importado);
    const item = {
      processoId:        p.id,
      numero:            p.numero,
      nome:              p.apelido || tituloProcesso(p.nome),
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
  const comAcesso = await usuariosComAcesso(admin, Object.keys(porUsuario));

  for (const [userId, dados] of Object.entries(porUsuario)) {
    if (!dados.atualizacoes.length && !dados.novosProcessos.length && !dados.prazos.length) continue;
    if (!comAcesso.has(userId)) { await avisoSemAcesso(admin, userId, dados); continue; }
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
      .update({ email_pendente: false, ultima_notif_email: new Date().toISOString() })
      .in('id', processosNotificados);
  }

  return res.status(200).json({ ok: true, tipo: 'afternoon', emailsEnviados, hoje });
}

// ── EVENING ───────────────────────────────────────────────────────────────────

async function rodarEvening(admin, res, hoje) {
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data: eventos, error: errEventos } = await admin
    .from('eventos')
    .select('user_id, titulo, tipo, data, urgencia')
    .gte('data', hoje)
    .lte('data', amanha)
    .eq('urgencia', 'urgente');
  if (errEventos) throw new Error(`Falha ao ler eventos: ${errEventos.message}`);

  if (!eventos?.length) return res.status(200).json({ ok: true, tipo: 'evening', emailsEnviados: 0 });

  const prazosPorUsuario = {};
  for (const e of eventos) {
    if (!prazosPorUsuario[e.user_id]) prazosPorUsuario[e.user_id] = [];
    prazosPorUsuario[e.user_id].push({ descricao: e.titulo, data_prazo: e.data, urgencia: e.urgencia });
  }

  let emailsEnviados = 0;
  const comAcesso = await usuariosComAcesso(admin, Object.keys(prazosPorUsuario));
  for (const [userId, lista] of Object.entries(prazosPorUsuario)) {
    if (!comAcesso.has(userId)) continue;
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

// ── PRAZO FATAL ───────────────────────────────────────────────────────────────
// Roda todo dia às 9h BRT (12h UTC), independente de notificacao_pendente —
// diferente de morning/afternoon/evening, que só disparam a partir de
// movimentação de processo. Mesmo critério de "fatal" do _prazoStatus
// client-side (dashboard.js): prazo entre hoje e hoje+3d, coluna != concluida.
// Tarefa já VENCIDA não entra mais: até 05/11/2026 ela voltava todo dia no
// e-mail (84 e-mails em um mês, pra 3 contas, por 8 tarefas esquecidas). Agora
// ela fica em destaque no painel ("Tarefas vencidas"), com o botão de concluir.

async function rodarPrazoFatal(admin, res, hoje) {
  const em3d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const { data: tarefas } = await admin
    .from('tarefas')
    .select('id, user_id, titulo, prazo, processo_id, numero_processo_manual, cliente_manual')
    .gte('prazo', hoje)
    .lte('prazo', em3d)
    .not('prazo', 'is', null)
    .neq('coluna', 'concluida')
    .order('prazo', { ascending: true });

  if (!tarefas?.length) {
    return res.status(200).json({ ok: true, tipo: 'prazo_fatal', emailsEnviados: 0, hoje, motivo: 'nada fatal' });
  }

  // Resolve nome do processo vinculado (quando houver) pra dar contexto no e-mail
  const procIds = [...new Set(tarefas.filter(t => t.processo_id).map(t => t.processo_id))];
  const procMap = {};
  if (procIds.length) {
    const { data: procs } = await admin.from('processos').select('id, numero, nome, apelido, cliente').in('id', procIds);
    for (const p of procs || []) procMap[p.id] = p;
  }

  const porUsuario = {};
  for (const t of tarefas) {
    if (!porUsuario[t.user_id]) porUsuario[t.user_id] = [];
    const proc = t.processo_id ? procMap[t.processo_id] : null;
    porUsuario[t.user_id].push({
      titulo:   t.titulo,
      prazo:    t.prazo,
      processo: proc ? (proc.apelido || tituloProcesso(proc.nome)) + (proc.numero ? ' · ' + proc.numero : '') : (t.cliente_manual || t.numero_processo_manual || null),
    });
  }

  let emailsEnviados = 0;
  const comAcesso = await usuariosComAcesso(admin, Object.keys(porUsuario));
  for (const [userId, lista] of Object.entries(porUsuario)) {
    if (!comAcesso.has(userId)) continue;
    if (await jaNotificouHoje(admin, userId, 'prazo_fatal', hoje)) continue;

    let email, nome;
    try {
      const { data: ud } = await admin.auth.admin.getUserById(userId);
      email = ud?.user?.email;
      if (!email) continue;
      nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];
    } catch (e) {
      await logErro(admin, 'cron:email-prazo_fatal', e.message, { userId }, userId);
      continue;
    }

    try {
      await enviarAlertaPrazoFatal(email, nome, lista, hoje);
      emailsEnviados++;
      await logNotif(admin, userId, 'prazo_fatal', hoje);
    } catch (e) {
      await logErro(admin, 'cron:email-prazo_fatal', e.message, { email }, userId);
    }
  }

  return res.status(200).json({ ok: true, tipo: 'prazo_fatal', emailsEnviados, hoje });
}

// ── HONORÁRIO VENCIDO ────────────────────────────────────────────────────────
// Roda 1x/dia. "Vencido" não é status gravado: sai da conta de parcelas e
// pagamentos (HonCalc) — uma mensalidade em dia não aparece só porque a data
// da 1ª cobrança ficou pra trás, e um pagamento parcial reduz o valor cobrado.
// O dedup por dia em notif_log garante o "lembra de 24 em 24h": enquanto
// houver cobrança em atraso, ela volta todo dia; registrou o pagamento (ou
// cancelou o honorário), some.

// Honorários + seus pagamentos, já com a conta feita. Sem a tabela
// honorario_pagamentos (migration não rodada) segue só com o que está no
// próprio honorário — a conta entende a entrada e o "pago" antigos.
const COLS_HONORARIO = 'id, user_id, descricao, valor, status, data_vencimento, data_pagamento, created_at, recorrente, periodicidade, parcelas_total, valor_entrada, clientes(nome)';
async function honorariosComConta(admin, consulta, hoje) {
  const { data: hons, error } = await consulta;
  if (error) throw new Error(`honorarios: ${error.message}`);
  if (!hons?.length) return [];
  const pagsPorHon = {};
  const ids = hons.map(h => h.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: pags, error: errPag } = await admin.from('honorario_pagamentos')
      .select('honorario_id, valor, data_pagamento').in('honorario_id', ids.slice(i, i + 200));
    if (errPag) break;
    for (const p of pags || []) (pagsPorHon[p.honorario_id] ||= []).push(p);
  }
  return hons.map(h => ({ h, calc: HonCalc.calcular(h, pagsPorHon[h.id] || [], { hoje }) }));
}

async function rodarHonorarioVencido(admin, res, hoje) {
  // Sem data = parcelado/recorrente antigo que conta do cadastro (à vista sem
  // data nunca vence — a própria conta trata).
  const honorarios = await honorariosComConta(admin, admin
    .from('honorarios')
    .select(COLS_HONORARIO)
    .neq('status', 'cancelado')
    .or(`data_vencimento.lt.${hoje},data_vencimento.is.null`)
    .order('data_vencimento', { ascending: true }), hoje);

  const porUsuario = {};
  for (const { h, calc } of honorarios) {
    if (!calc.vencidas.length) continue;
    if (!porUsuario[h.user_id]) porUsuario[h.user_id] = [];
    porUsuario[h.user_id].push({
      descricao:  h.descricao,
      valor:      calc.emAtraso,
      vencimento: calc.vencidas[0].venc,
      cliente:    h.clientes?.nome || null,
      cobrancas:  calc.vencidas.length,
      rotulo:     calc.forma === 'avista' ? null : calc.vencidas.map(p => p.rotulo).slice(0, 3).join(', ') + (calc.vencidas.length > 3 ? '…' : ''),
    });
  }

  if (!Object.keys(porUsuario).length) {
    return res.status(200).json({ ok: true, tipo: 'honorario_vencido', emailsEnviados: 0, hoje, motivo: 'nada vencido' });
  }

  let emailsEnviados = 0;
  const comAcesso = await usuariosComAcesso(admin, Object.keys(porUsuario));
  for (const [userId, lista] of Object.entries(porUsuario)) {
    if (!comAcesso.has(userId)) continue;
    if (await jaNotificouHoje(admin, userId, 'honorario_vencido', hoje)) continue;

    let email, nome;
    try {
      const { data: ud } = await admin.auth.admin.getUserById(userId);
      email = ud?.user?.email;
      if (!email) continue;
      nome = ud.user.user_metadata?.full_name || ud.user.user_metadata?.nome || email.split('@')[0];
    } catch (e) {
      await logErro(admin, 'cron:email-honorario_vencido', e.message, { userId }, userId);
      continue;
    }

    try {
      await enviarAlertaHonorarioVencido(email, nome, lista, hoje);
      emailsEnviados++;
      await logNotif(admin, userId, 'honorario_vencido', hoje);
    } catch (e) {
      await logErro(admin, 'cron:email-honorario_vencido', e.message, { email }, userId);
    }
  }

  return res.status(200).json({ ok: true, tipo: 'honorario_vencido', emailsEnviados, hoje });
}

// ── CADASTRO INCOMPLETO ──────────────────────────────────────────────────────
// 1x/dia. Duas situações, no máximo 2 e-mails cada, por conta:
//   - criou a conta e nunca entrou (ex: login com Google que não completou —
//     caso do Italo, 15/10/2026): 1 dia depois e de novo 3+ dias depois;
//   - entrou mas não informou a OAB (desde 16/10 a OAB é opcional): sem ela o
//     DJEN não acha nada da pessoa — 1 dia depois e de novo 4+ dias depois.
// Só contas com até 30 dias (não acorda conta antiga parada) e com acesso
// ativo; colaborador não precisa de OAB. Quem se descadastrou não recebe
// (enviarEmail central). ?simular=1 só lista, não envia nem registra.

const MAX_LEMBRETES = 2;
// Mesma leitura de OAB do robô do DJEN — antes era uma cópia da regex que
// recusava "DF - 59360" e "59360/DF", e o lembrete pedia OAB a quem já tinha.
const oabsValidas = raw => String(raw || '').split(',').filter(o => lerOab(o));

async function rodarCadastroIncompleto(admin, res, hoje, simular) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
    if (error) throw error;
    users.push(...(data?.users || []));
    if ((data?.users || []).length < 1000) break;
  }
  const agora   = Date.now();
  const recentes = users.filter(u => agora - new Date(u.created_at) <= 30 * 86400000);
  if (!recentes.length) return res.status(200).json({ ok: true, tipo: 'cadastro_incompleto', enviados: 0, motivo: 'nenhuma conta recente' });

  const ids = recentes.map(u => u.id);
  const [{ data: colabs }, { data: logs }, comAcesso] = await Promise.all([
    admin.from('colaboradores').select('user_id').in('user_id', ids).eq('status', 'ativo'),
    admin.from('notif_log').select('user_id, tipo, data').in('user_id', ids).in('tipo', ['cadastro_nunca_entrou', 'cadastro_sem_oab']),
    usuariosComAcesso(admin, ids),
  ]);
  const ehColab = new Set((colabs || []).map(c => c.user_id));
  const historico = (uid, tipo) => (logs || []).filter(l => l.user_id === uid && l.tipo === tipo).map(l => l.data).sort();

  const plano = [];
  for (const u of recentes) {
    if (!u.email || !comAcesso.has(u.id)) continue;
    const idadeDias = (agora - new Date(u.created_at)) / 86400000;
    const nuncaEntrou = !u.last_sign_in_at && !!u.email_confirmed_at;   // e-mail não confirmado = o Supabase já cuida
    const semOab = !!u.last_sign_in_at && !ehColab.has(u.id) && oabsValidas(u.user_metadata?.oab).length === 0;
    const tipo = nuncaEntrou ? 'cadastro_nunca_entrou' : semOab ? 'cadastro_sem_oab' : null;
    if (!tipo) continue;

    const envios = historico(u.id, tipo);
    if (envios.length >= MAX_LEMBRETES || envios.includes(hoje)) continue;
    const intervalo2 = tipo === 'cadastro_nunca_entrou' ? 3 : 4;
    const diasDesdeUltimo = envios.length ? (agora - new Date(envios.at(-1) + 'T12:00:00Z')) / 86400000 : Infinity;
    const vence = envios.length === 0 ? idadeDias >= 1 : (idadeDias >= intervalo2 && diasDesdeUltimo >= 2);
    if (vence) plano.push({ u, tipo, envio: envios.length + 1 });
  }

  if (simular) {
    return res.status(200).json({ ok: true, tipo: 'cadastro_incompleto', simulado: true,
      receberiam: plano.map(p => ({ email: p.u.email, situacao: p.tipo, envio: `${p.envio}/${MAX_LEMBRETES}` })) });
  }

  let enviados = 0;
  for (const p of plano) {
    try {
      const { assunto, html } = emailCadastroIncompleto(p.u, p.tipo, p.envio);
      await enviarEmail(p.u.email, assunto, html);
      await logNotif(admin, p.u.id, p.tipo, hoje);
      enviados++;
    } catch (e) {
      await logErro(admin, 'cron:email-cadastro_incompleto', e.message, { email: p.u.email }, p.u.id);
    }
  }
  return res.status(200).json({ ok: true, tipo: 'cadastro_incompleto', enviados, avaliados: recentes.length, hoje });
}

export function emailCadastroIncompleto(u, tipo, envio) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const primeiro = esc(((u.user_metadata?.full_name || u.user_metadata?.nome || '').trim().split(/\s+/)[0]) || '');
  const ola = primeiro ? `Olá, ${primeiro}!` : 'Olá!';
  const google = (u.app_metadata?.providers || []).includes('google');
  const botao = (txt, url) => `<div style="text-align:center;padding:8px 28px 28px"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#053958 0%,#0d5a96 55%,#2196f3 100%);color:#fff;text-decoration:none;padding:14px 34px;border-radius:9px;font-size:15px;font-weight:700">${txt}</a>`;

  let assunto, subtitulo, corpo, cta;
  if (tipo === 'cadastro_nunca_entrou') {
    assunto   = envio === 1 ? `${primeiro || 'Sua conta'}${primeiro ? ', sua conta' : ''} no Meu Processo já está pronta` : 'Seu teste grátis no Meu Processo está esperando por você';
    subtitulo = 'Sua conta está pronta';
    corpo = `<p style="margin:0 0 14px">${ola}</p>
      <p style="margin:0 0 14px">Você começou seu cadastro no Meu Processo, mas o acesso não chegou a ser concluído. A boa notícia: <b>sua conta já está criada</b> e o <b>teste grátis está ativo</b>. Falta só entrar.</p>`;
    cta = botao('Entrar no Meu Processo →', 'https://www.meuprocesso.app.br/login')
      + `<div style="font-size:12px;color:#6b7280;margin-top:10px">${google
          ? 'Na tela de login, clique em <b>"Entrar com Google"</b>.'
          : 'Use o e-mail e a senha do cadastro. Esqueceu a senha? <a href="https://www.meuprocesso.app.br/esqueci-senha" style="color:#0d5a96">Crie uma nova</a>.'}</div></div>`;
  } else {
    assunto   = envio === 1 ? 'Falta só sua OAB para encontrarmos suas intimações' : 'Suas intimações ainda não estão sendo monitoradas';
    subtitulo = 'Falta um passo';
    corpo = `<p style="margin:0 0 14px">${ola}</p>
      <p style="margin:0 0 14px">Sua conta está ativa, mas ainda <b>sem a OAB cadastrada</b>. É por ela que encontramos automaticamente suas intimações e processos no Diário Eletrônico — sem ela, não temos como avisar você.</p>
      <p style="margin:0 0 14px">Leva 10 segundos: entre no sistema e informe estado e número na tela que aparece logo ao entrar.</p>`;
    cta = botao('Informar minha OAB →', 'https://www.meuprocesso.app.br/dashboard') + '</div>';
  }

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho(subtitulo)}
  <div style="padding:24px 28px 8px;font-size:14px;color:#374151;line-height:1.65">${corpo}</div>
  ${cta}
  ${rodape()}
</div></body></html>`;
  return { assunto, html };
}

// ── AGENDA ────────────────────────────────────────────────────────────────────

async function buscarAgendaSemana(admin, userIds, hoje) {
  if (!userIds.length) return {};
  const seteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const agenda   = {};

  // Honorário: cada cobrança em aberto que vence na semana (num mensal, a
  // data_vencimento é só a 1ª cobrança — filtrar por ela sumia com os meses
  // seguintes). Falha aqui não derruba a agenda.
  const [{ data: eventos }, honorarios, { data: tarefas }] = await Promise.all([
    admin.from('eventos').select('user_id, titulo, tipo, data, urgencia').in('user_id', userIds).gte('data', hoje).lte('data', seteDias).order('data'),
    honorariosComConta(admin, admin.from('honorarios').select(COLS_HONORARIO).in('user_id', userIds)
      .neq('status', 'cancelado').or(`data_vencimento.lte.${seteDias},data_vencimento.is.null`), hoje).catch(() => []),
    admin.from('tarefas').select('user_id, titulo, prazo, prioridade').in('user_id', userIds).gte('prazo', hoje).lte('prazo', seteDias).neq('coluna', 'concluida').order('prazo'),
  ]);

  for (const e of eventos || []) {
    if (!agenda[e.user_id]) agenda[e.user_id] = [];
    agenda[e.user_id].push({ tipo: 'evento', descricao: e.titulo, data: e.data, urgencia: e.urgencia });
  }
  for (const { h, calc } of honorarios) {
    for (const p of calc.parcelas) {
      if (p.falta <= 0 || !p.venc || p.venc < hoje || p.venc > seteDias) continue;
      if (!agenda[h.user_id]) agenda[h.user_id] = [];
      agenda[h.user_id].push({ tipo: 'honorario', descricao: calc.forma === 'avista' ? h.descricao : `${h.descricao} (${p.rotulo})`, data: p.venc, urgencia: 'baixa' });
    }
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

// Conta bloqueada/vencida/cancelada: email_pendente fica true de propósito —
// ao reativar, o próximo digest entrega o que ficou guardado.
async function avisoSemAcesso(admin, userId, dados) {
  const processosNovos = !!dados?.novosProcessos?.length;
  const movimentacoes  = !!dados?.atualizacoes?.length;
  if (!processosNovos && !movimentacoes) return;
  try {
    await enviarAvisoReativacao(admin, userId, { processosNovos, movimentacoes });
  } catch (e) {
    await logErro(admin, 'cron:email-reativacao', e.message, {}, userId);
  }
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
  const diaSemana  = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });
  const todos      = [...atualizacoes, ...novosProcessos];
  const primeiro   = todos[0];
  const primMov    = primeiro?.novos?.[0]?.nome || '';

  // Assunto claro: o que aconteceu + em qual processo
  const assunto = todos.length === 1
    ? `${primMov ? truncar(primMov, 55) + ' — ' : ''}${truncar(primeiro.nome || primeiro.numero, 45)}`
    : `${todos.length} processos atualizados — ${todos.slice(0, 2).map(i => truncar(i.nome || i.numero, 20)).join(', ')}${todos.length > 2 ? ` +${todos.length - 2}` : ''}`;

  const tipoIcon = { evento: '📅', tarefa: '✅', honorario: '💰' };

  const blocoNovosProcessos = novosProcessos.length ? `
<div style="padding:16px 24px;background:#fffbeb;border-bottom:1px solid #fde68a">
  <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">🔔 Novo processo identificado no seu nome</div>
  ${novosProcessos.slice(0, 5).map(item => cardProcesso(item, true)).join('')}
</div>` : '';

  const blocoAtualizacoes = atualizacoes.length ? `
<div style="padding:16px 24px">
  ${atualizacoes.length > 1 ? `<div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">⚖️ ${atualizacoes.length} atualizações</div>` : ''}
  ${atualizacoes.slice(0, 5).map(item => cardProcesso(item, false)).join('')}
</div>` : '';

  const blocoAgenda = agenda.length ? `
<div style="padding:16px 24px;border-top:1px solid #e5e7eb">
  <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">📋 Esta semana</div>
  ${agenda.slice(0, 8).map(item => {
    const dataFmt = new Date(item.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const badge   = item.urgencia === 'urgente'
      ? ' <span style="font-size:10px;background:#fef2f2;color:#dc2626;padding:1px 6px;border-radius:4px;font-weight:700">URGENTE</span>'
      : '';
    const icon = tipoIcon[item.tipo] || '•';
    return `<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f3f4f6">
      <span style="font-size:11px;color:#9ca3af;white-space:nowrap;min-width:64px">${dataFmt}</span>
      <span style="font-size:13px;color:#111827">${icon} ${item.descricao}${badge}</span>
    </div>`;
  }).join('')}
</div>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho('Bom dia, ' + nome.split(' ')[0] + ' · ' + diaSemana)}
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
  const todos    = [...novosProcessos, ...atualizacoes];
  const primeiro = todos[0];
  const primMov  = primeiro?.novos?.[0]?.nome || '';

  const assunto = prazos.length && !todos.length
    ? `Prazo amanhã — ${truncar(prazos[0].descricao, 55)}`
    : todos.length === 1
      ? `${primMov ? truncar(primMov, 55) + ' — ' : ''}${truncar(primeiro.nome || primeiro.numero, 45)}`
      : `${todos.length} atualizações — ${todos.slice(0, 2).map(i => truncar(i.nome || i.numero, 20)).join(', ')}${todos.length > 2 ? ` +${todos.length - 2}` : ''}`;

  const blocoNovosProcessos = novosProcessos.length ? `
<div style="padding:16px 24px;background:#fffbeb;border-bottom:1px solid #fde68a">
  <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">🔔 Novo processo identificado no seu nome</div>
  ${novosProcessos.slice(0, 5).map(item => cardProcesso(item, true)).join('')}
</div>` : '';

  const blocoAtualizacoes = atualizacoes.length ? `
<div style="padding:16px 24px${novosProcessos.length ? ';border-top:1px solid #e5e7eb' : ''}">
  ${atualizacoes.length > 1 ? `<div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">⚖️ ${atualizacoes.length} atualizações</div>` : ''}
  ${atualizacoes.slice(0, 5).map(item => cardProcesso(item, false)).join('')}
</div>` : '';

  const blocoPrazos = prazos.length ? `
<div style="padding:16px 24px;border-top:1px solid #e5e7eb">
  <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">⏰ Prazo amanhã</div>
  ${prazos.map(p => `
  <div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:6px;padding:12px 14px;margin-bottom:8px">
    <div style="font-size:14px;font-weight:700;color:#92400e">${p.descricao}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:4px">${formatarData(p.data_prazo)}</div>
  </div>`).join('')}
</div>` : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho('Atualização · ' + nome.split(' ')[0])}
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

async function enviarAlertaPrazoFatal(para, nome, tarefas, hoje) {
  const assunto = tarefas.length === 1
    ? `⏰ [Meu Processo] Prazo fatal — ${truncar(tarefas[0].titulo, 55)}`
    : `⏰ [Meu Processo] ${tarefas.length} tarefas em prazo fatal`;

  const blocos = tarefas.map(t => {
    const dias   = Math.round((new Date(t.prazo + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
    const status = dias < 0 ? `🔴 VENCIDA HÁ ${Math.abs(dias)}D` : dias === 0 ? '🔴 VENCE HOJE' : `🟠 VENCE EM ${dias}D`;
    return `<div style="background:#fef2f2;border-left:4px solid #be123c;border-radius:6px;padding:14px 16px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:#9f1239">${status} — ${t.titulo}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px">${formatarData(t.prazo)}${t.processo ? ' · ' + t.processo : ''}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  <div style="background:#be123c;padding:24px 28px"><div style="font-size:18px;font-weight:700;color:#fff">Meu Processo</div><div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:2px">Prazo fatal</div></div>
  <div style="padding:24px 28px">
    <div style="font-size:15px;color:#111827;margin-bottom:16px"><strong>${nome}</strong>, você tem ${tarefas.length > 1 ? 'tarefas com prazo fatal' : 'uma tarefa com prazo fatal'}.</div>
    ${blocos}
  </div>
  ${btnDashboard('#be123c')}
  ${rodape()}
</div>
</body></html>`;

  await enviarEmail(para, assunto, html);
}

function _fmtMoedaBR(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function enviarAlertaHonorarioVencido(para, nome, lista, hoje) {
  const assunto = lista.length === 1
    ? `💰 [Meu Processo] Honorário vencido — ${truncar(lista[0].descricao, 50)}`
    : `💰 [Meu Processo] ${lista.length} honorários vencidos`;

  const total = lista.reduce((s, h) => s + Number(h.valor || 0), 0);

  const blocos = lista.map(h => {
    const dias = Math.round((new Date(hoje + 'T12:00:00') - new Date(h.vencimento + 'T12:00:00')) / 86400000);
    const varias = h.cobrancas > 1 ? ` · ${h.cobrancas} cobranças` : '';
    return `<div style="background:#fef2f2;border-left:4px solid #be123c;border-radius:6px;padding:14px 16px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:700;color:#9f1239">R$ ${_fmtMoedaBR(h.valor)} em atraso — há ${dias} dia${dias > 1 ? 's' : ''}${varias}</div>
      <div style="font-size:12px;color:#111827;margin-top:4px">${truncar(h.descricao, 70)}${h.rotulo ? ` <span style="color:#6b7280">(${h.rotulo})</span>` : ''}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px">${formatarData(h.vencimento)}${h.cliente ? ' · ' + h.cliente : ''}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  <div style="background:#be123c;padding:24px 28px"><div style="font-size:18px;font-weight:700;color:#fff">Meu Processo</div><div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:2px">Honorário vencido</div></div>
  <div style="padding:24px 28px">
    <div style="font-size:15px;color:#111827;margin-bottom:16px"><strong>${nome}</strong>, você tem ${lista.length > 1 ? `${lista.length} honorários vencidos, somando R$ ${_fmtMoedaBR(total)}` : 'um honorário vencido'}. Quando receber, registre o pagamento no sistema (vale pagamento parcial ou adiantado) — o aviso para sozinho.</div>
    ${blocos}
  </div>
  ${btnDashboard('#be123c')}
  ${rodape()}
</div>
</body></html>`;

  await enviarEmail(para, assunto, html);
}

// ── CARD PROCESSO ─────────────────────────────────────────────────────────────

function cardProcesso(item, isNovo = false) {
  const novos     = (item.novos || []).slice(0, 3);
  const principal = novos[0];
  const resto     = novos.slice(1);
  const accentColor = isNovo ? '#d97706' : '#3b5bdb';
  const accentBg    = isNovo ? '#fffbeb' : '#edf2ff';
  const accentText  = isNovo ? '#92400e' : '#1e3a8a';

  const detectadoEm = principal?._detectadoEm;
  const movDate     = (principal?.data || '').slice(0, 10);
  const dataJudNote = detectadoEm && movDate && movDate < detectadoEm
    ? `<div style="font-size:10px;color:#6366f1;margin-top:5px">📡 Publicado em ${formatarDataCurta(movDate + 'T12:00:00')} · identificado hoje</div>`
    : '';

  const restoHtml = resto.length
    ? `<div style="margin-top:8px">${resto.map(m =>
        `<div style="font-size:11px;color:#6b7280;padding:3px 0;border-top:1px solid #f1f5f9">+ ${m.nome}${m.data ? ' · ' + formatarDataCurta(m.data.slice(0, 10) + 'T12:00:00') : ''}</div>`
      ).join('')}</div>`
    : '';

  return `
<div style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:12px;overflow:hidden">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2e6b;border-collapse:collapse">
    <tr>
      <td style="padding:9px 14px;color:#93c5fd;font-size:11px;font-weight:700;letter-spacing:.4px">${item.tribunal || ''}</td>
      <td style="padding:9px 14px;text-align:right;color:#7ea8d4;font-size:10px;font-family:monospace;white-space:nowrap">${item.numero || ''}</td>
    </tr>
  </table>
  <div style="padding:12px 14px">
    <div style="font-size:14px;font-weight:700;color:#111827;line-height:1.3;margin-bottom:${item.cliente ? '3px' : '10px'}">${item.nome || item.numero}</div>
    ${item.cliente ? `<div style="font-size:11px;color:#6b7280;margin-bottom:10px">👤 ${item.cliente}</div>` : ''}
    ${principal ? `
    <div style="background:${accentBg};border-left:3px solid ${accentColor};border-radius:0 6px 6px 0;padding:9px 12px">
      <div style="font-size:13px;font-weight:600;color:${accentText};line-height:1.4">${principal.nome}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px">${formatarData(principal.data)}</div>
      ${dataJudNote}
    </div>
    ${restoHtml}` : ''}
  </div>
</div>`;
}

function truncar(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}


function formatarData(iso) {
  if (!iso) return '—';
  try { return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
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
