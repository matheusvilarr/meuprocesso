// Vercel Cron Job — verifica atualizações no DataJud e DJEN, notifica por email
// Roda 3x/dia conforme vercel.json — requer SUPABASE_SERVICE_KEY e RESEND_API_KEY

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

  // ── 1. Busca todos os processos ativos ────────────────────────────────────
  const { data: processos, error } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, datajud_index, movimentos_hash')
    .not('numero', 'is', null)
    .neq('status', 'Arquivado');

  if (error) return res.status(500).json({ erro: error.message });

  // ── 2. Busca OABs dos usuários (salvas em user_metadata pelo perfil) ──────
  const userIds = [...new Set(processos.map(p => p.user_id))];
  const oabsPorUsuario = {}; // { user_id: [{num, uf}] }
  for (const uid of userIds) {
    try {
      const { data: ud } = await admin.auth.admin.getUserById(uid);
      const oabRaw = ud?.user?.user_metadata?.oab || '';
      if (!oabRaw) continue;
      const oabs = oabRaw.split(',').map(s => s.trim()).filter(Boolean);
      oabsPorUsuario[uid] = oabs.map(o => {
        const m = o.toUpperCase().replace(/\./g, '').match(/^(?:OAB[/ ]?)?([A-Z]{2})[/ ]?(\d{3,6})$/);
        return m ? { uf: m[1], num: m[2] } : null;
      }).filter(Boolean);
    } catch (_) {}
  }

  let verificados = 0, atualizados = 0;
  const atualizacoesPorUsuario = {}; // { user_id: [{ nome, novos, fonte }] }

  // ── 3. Verifica DataJud (movimentos históricos) ───────────────────────────
  const processosDatajud = processos.filter(p => p.datajud_index);
  for (const proc of processosDatajud) {
    try {
      const hits = await buscarNoDatajud(proc.datajud_index, proc.numero);
      if (!hits || !hits.length) continue;

      const fonte = hits[0]._source;
      const todosMovs = (fonte.movimentos || [])
        .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
        .slice(0, 100)
        .map(m => ({ nome: m.nome, data: parsarData(m.dataHora) }));

      const novoHash = todosMovs.slice(0, 6).map(m => m.data + m.nome).join('|');
      verificados++;

      if (novoHash === proc.movimentos_hash) continue;

      const novos = proc.movimentos_hash
        ? todosMovs.filter(m => !proc.movimentos_hash.includes(m.data + m.nome))
        : todosMovs.slice(0, 1);

      await admin.from('processos').update({
        movimentos_recentes:  todosMovs,
        movimentos_hash:      novoHash,
        ultima_verificacao:   new Date().toISOString(),
        notificacao_pendente: true,
        novos_movimentos:     novos,
      }).eq('id', proc.id);

      atualizados++;
      if (!atualizacoesPorUsuario[proc.user_id]) atualizacoesPorUsuario[proc.user_id] = [];
      atualizacoesPorUsuario[proc.user_id].push({ nome: proc.apelido || proc.nome, novos: novos.slice(0, 3), fonte: 'CNJ DataJud' });
    } catch (_) {}
  }

  // ── 4. Verifica DJEN (publicações do dia — mais rápido que DataJud) ───────
  const hoje      = new Date().toISOString().slice(0, 10);
  const ontem     = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const numeroSet = new Set(processos.map(p => p.numero).filter(Boolean));

  for (const uid of userIds) {
    const oabs = oabsPorUsuario[uid];
    if (!oabs?.length) continue;

    try {
      const reqs = oabs.map(oab =>
        fetch(`${DJEN_API}?${new URLSearchParams({ numeroOab: oab.num, ufOab: oab.uf, dataDisponibilizacaoInicio: ontem, dataDisponibilizacaoFim: hoje, pagina: 1, tamanhoPagina: 100 })}`)
          .then(r => r.ok ? r.json() : { items: [] })
      );
      const resultados = await Promise.all(reqs);
      const items = resultados.flatMap(r => r.items || []);

      for (const item of items) {
        const PADRAO = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
        const numerosNoTexto = [...new Set((item.numeroprocessocommascara ? [item.numeroprocessocommascara] : []).concat((item.texto || '').match(PADRAO) || []))];

        for (const numDJEN of numerosNoTexto) {
          if (!numeroSet.has(numDJEN)) continue; // processo não cadastrado pelo usuário

          const proc = processos.find(p => p.numero === numDJEN && p.user_id === uid);
          if (!proc) continue;

          const movDJEN = { nome: `DJEN — ${item.tipoComunicacao || 'Publicação'}`, data: (item.data_disponibilizacao || hoje) + 'T00:00:00' };
          const djenKey = movDJEN.data + movDJEN.nome;

          // Evita duplicar: verifica se o movimento DJEN já está na timeline
          const { data: procAtual } = await admin.from('processos').select('movimentos_recentes').eq('id', proc.id).single();
          const movsAtuais = procAtual?.movimentos_recentes || [];
          const jaTemMovimento = movsAtuais.some(m => m.data === movDJEN.data && m.nome === movDJEN.nome);
          if (jaTemMovimento) continue;

          const novaLista = [movDJEN, ...movsAtuais].slice(0, 100);

          await admin.from('processos').update({
            movimentos_recentes:  novaLista,
            ultima_verificacao:   new Date().toISOString(),
            notificacao_pendente: true,
            novos_movimentos:     [movDJEN],
          }).eq('id', proc.id);

          atualizados++;
          if (!atualizacoesPorUsuario[uid]) atualizacoesPorUsuario[uid] = [];
          atualizacoesPorUsuario[uid].push({ nome: proc.apelido || proc.nome, novos: [movDJEN], fonte: 'DJEN' });
        }
      }
    } catch (_) {}
  }

  // ── 5. Envia emails consolidados ──────────────────────────────────────────
  let emailsEnviados = 0;
  if (RESEND_KEY && Object.keys(atualizacoesPorUsuario).length) {
    for (const [userId, itens] of Object.entries(atualizacoesPorUsuario)) {
      try {
        const { data: userData } = await admin.auth.admin.getUserById(userId);
        const email = userData?.user?.email;
        if (!email) continue;
        const nomeUsuario = userData.user.user_metadata?.full_name || email.split('@')[0];
        await enviarEmailNotificacao(email, nomeUsuario, itens);
        emailsEnviados++;
      } catch (_) {}
    }
  }

  return res.status(200).json({
    ok: true,
    total: processos.length,
    verificados,
    atualizados,
    emailsEnviados,
    timestamp: new Date().toISOString(),
  });
}

// ── Email via Resend ─────────────────────────────────────────────────────────

async function enviarEmailNotificacao(para, nomeUsuario, itens) {
  const plural    = itens.length > 1;
  const assunto   = plural
    ? `[Meu Processo] ${itens.length} processos com nova movimentação`
    : `[Meu Processo] Nova movimentação — ${itens[0].nome}`;

  const blocos = itens.map(item => `
    <div style="background:#f8f9fa;border-left:4px solid #1a2e6b;border-radius:6px;padding:14px 16px;margin-bottom:12px">
      <div style="font-weight:700;color:#1a2e6b;font-size:14px;margin-bottom:8px">
        📁 ${item.nome}
      </div>
      ${item.novos.map(m => `
        <div style="font-size:13px;color:#374151;padding:4px 0;border-bottom:1px solid #e5e7eb">
          <span style="color:#6b7280;font-size:11px">${formatarData(m.data)}</span><br>
          ${m.nome}
        </div>`).join('')}
    </div>`).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

        <!-- Header -->
        <div style="background:#1a2e6b;padding:24px 28px">
          <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px">Meu Processo</div>
          <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">meuprocesso.app.br</div>
        </div>

        <!-- Body -->
        <div style="padding:24px 28px">
          <div style="font-size:15px;color:#111827;margin-bottom:6px">
            Olá, <strong>${nomeUsuario}</strong>!
          </div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:20px">
            ${plural
              ? `<strong>${itens.length} processos</strong> receberam novas movimentações no CNJ DataJud.`
              : `O processo abaixo recebeu uma nova movimentação no CNJ DataJud.`}
          </div>

          ${blocos}

          <div style="text-align:center;margin-top:24px">
            <a href="https://meuprocesso.app.br/dashboard"
               style="display:inline-block;background:#1a2e6b;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600">
              Ver no Dashboard →
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
          <div style="font-size:11px;color:#9ca3af;text-align:center">
            Você recebe este email porque monitora processos no Meu Processo.<br>
            As informações são obtidas diretamente do CNJ DataJud.
          </div>
        </div>

      </div>
    </body>
    </html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'notificacoes@meuprocesso.app.br',
      to:      para,
      subject: assunto,
      html,
    }),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function buscarNoDatajud(index, numero) {
  const numeroLimpo = numero.replace(/[.\-\/ ]/g, '');
  try {
    const r = await fetch(
      `https://api-publica.datajud.cnj.jus.br/${index}/_search`,
      {
        method: 'POST',
        headers: { 'Authorization': `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: 1, query: { match: { numeroProcesso: numeroLimpo } } })
      }
    );
    if (!r.ok) return null;
    const buffer = await r.arrayBuffer();
    const text   = decodificarBuffer(buffer);
    const d      = JSON.parse(text);
    return d.hits?.hits || null;
  } catch {
    return null;
  }
}

function decodificarBuffer(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function parsarData(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{14}$/.test(str)) {
    return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}T${str.slice(8,10)}:${str.slice(10,12)}:${str.slice(12,14)}`;
  }
  if (/^\d{8}$/.test(str)) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
  return s;
}

function formatarData(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}
