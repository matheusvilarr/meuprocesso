// Sincronização de processos — roda 30 min antes de cada turno de e-mail.
// Atualiza movimentos_recentes, movimentos_hash, novos_movimentos e
// notificacao_pendente no banco. Sem envio de e-mail — só sync de dados.

import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DATAJUD_KEY      = process.env.DATAJUD_API_KEY
  || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
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

  const { data: processos, error } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, datajud_index, movimentos_hash, movimentos_recentes, created_at, favorito')
    .not('numero', 'is', null)
    .neq('status', 'Arquivado')
    .order('favorito', { ascending: false });

  if (error) return res.status(500).json({ erro: error.message });

  const userIds        = [...new Set((processos || []).map(p => p.user_id))];
  const oabsPorUsuario = await buscarOabsUsuarios(admin, userIds);

  const [atualizadosDatajud, atualizadosDJEN] = await Promise.all([
    sincronizarDatajud(processos, admin, hoje),
    sincronizarDJEN(processos, oabsPorUsuario, admin, hoje),
  ]);

  return res.status(200).json({
    ok: true,
    hoje,
    datajud: atualizadosDatajud,
    djen: atualizadosDJEN,
  });
}

// ── DataJud ───────────────────────────────────────────────────────────────────

async function sincronizarDatajud(processos, admin, hoje) {
  let atualizados = 0;
  const com_datajud = processos.filter(p => p.datajud_index);

  for (let i = 0; i < com_datajud.length; i += 12) {
    const lote = com_datajud.slice(i, i + 12);
    const resultados = await Promise.allSettled(
      lote.map(proc => sincronizarDatajudUm(proc, admin, hoje))
    );
    atualizados += resultados.filter(r => r.status === 'fulfilled' && r.value).length;
  }
  return atualizados;
}

async function sincronizarDatajudUm(proc, admin, hoje) {
  if ((proc.created_at || '').slice(0, 10) === hoje) return false;
  try {
    const hits = await buscarNoDatajud(proc.datajud_index, proc.numero);
    if (!hits?.length) return false;

    const todosMovs = (hits[0]._source.movimentos || [])
      .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
      .slice(0, 100)
      .map(m => ({ nome: m.nome, data: parsarData(m.dataHora) }));

    const novoHash = todosMovs.slice(0, 6).map(m => m.data + m.nome).join('|');
    if (novoHash === proc.movimentos_hash) return false;

    const importadoEm = (proc.created_at || '').slice(0, 10);
    const seteDias    = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const todosNovos  = proc.movimentos_hash
      ? todosMovs.filter(m => !proc.movimentos_hash.includes(m.data + m.nome))
      : todosMovs.slice(0, 1);
    // Só notifica movimentos realmente recentes (últimos 7 dias)
    const novosRecentes = todosNovos.filter(m => m.data && m.data >= seteDias && (!importadoEm || m.data >= importadoEm));

    const update = {
      movimentos_recentes: todosMovs,
      movimentos_hash:     novoHash,
      ultima_verificacao:  new Date().toISOString(),
    };
    if (novosRecentes.length) {
      update.notificacao_pendente = true;
      update.novos_movimentos     = novosRecentes;
    }
    await admin.from('processos').update(update).eq('id', proc.id);
    return novosRecentes.length > 0;
  } catch (e) {
    await logErro(admin, 'cron:datajud', e.message, { numero: proc.numero, processoId: proc.id }, proc.user_id);
    return false;
  }
}

// ── DJEN ─────────────────────────────────────────────────────────────────────

async function sincronizarDJEN(processos, oabsPorUsuario, admin, hoje) {
  let atualizados = 0;
  const ontem     = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const numeroSet = new Set(processos.map(p => p.numero).filter(Boolean));
  const userIds   = [...new Set(processos.map(p => p.user_id))];

  for (const uid of userIds) {
    const oabs = oabsPorUsuario[uid];
    if (!oabs?.length) continue;
    try {
      const reqs = oabs.map(oab =>
        fetch(`${DJEN_API}?${new URLSearchParams({ numeroOab: oab.num, ufOab: oab.uf, dataDisponibilizacaoInicio: ontem, dataDisponibilizacaoFim: hoje, pagina: 1, tamanhoPagina: 100 })}`, { signal: AbortSignal.timeout(15000) })
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
          if ((proc.created_at || '').slice(0, 10) === hoje) continue;

          const movDJEN = { nome: `DJEN — ${item.tipoComunicacao || 'Publicação'}`, data: (item.data_disponibilizacao || hoje) + 'T00:00:00' };
          const movsAtuais = proc.movimentos_recentes || [];
          if (movsAtuais.some(m => m.data === movDJEN.data && m.nome === movDJEN.nome)) continue;

          await admin.from('processos').update({
            movimentos_recentes:  [movDJEN, ...movsAtuais].slice(0, 100),
            ultima_verificacao:   new Date().toISOString(),
            notificacao_pendente: true,
            novos_movimentos:     [movDJEN],
          }).eq('id', proc.id);
          atualizados++;
        }
      }
    } catch (e) {
      await logErro(admin, 'cron:djen', e.message, { oabs }, uid);
    }
  }
  return atualizados;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function buscarNoDatajud(index, numero) {
  const numeroLimpo = numero.replace(/[.\-\/ ]/g, '');
  try {
    const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
      method: 'POST',
      headers: { 'Authorization': `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000),
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

async function logErro(admin, origem, mensagem, detalhes, userId) {
  try {
    await admin.from('error_log').insert({ origem, mensagem, detalhes: detalhes || null, user_id: userId || null });
  } catch (_) {}
}
