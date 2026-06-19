// Sincronização de processos e OAB scan.
// ?tipo=datajud (padrão) — atualiza movimentos de todos os processos no DataJud + DJEN
// ?tipo=oab     — varre todos os tribunais pela OAB do advogado buscando processos novos
//
// DataJud: time guard de 45s, rotação por ultima_verificacao (processa os mais desatualizados primeiro).
// Com 5 runs/dia × ~150 processos/run, todos os processos são cobertos diariamente.

import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DATAJUD_KEY      = process.env.DATAJUD_API_KEY
  || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const CRON_SECRET      = process.env.CRON_SECRET;
const DJEN_API         = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

const ESTADOS_SIGLAS = ['ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms','mg','pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','se','sp','to'];
const TODOS_TRIBUNAIS = [
  'api_publica_stf', 'api_publica_stj',
  ...[1,2,3,4,5,6].map(n => `api_publica_trf${n}`),
  ...Array.from({ length: 24 }, (_, i) => `api_publica_trt${i + 1}`),
  ...ESTADOS_SIGLAS.filter(s => s !== 'df').map(s => `api_publica_tre-${s}`),
  'api_publica_tjmsp', 'api_publica_tjmmg', 'api_publica_tjmrs', 'api_publica_tjdft',
  ...ESTADOS_SIGLAS.filter(s => s !== 'df').map(s => `api_publica_tj${s}`),
];

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
  const tipo  = req.query?.tipo || 'datajud';

  if (tipo === 'oab') return rodarOabScan(admin, res, hoje);
  return rodarDatajud(admin, res, hoje);
}

// ── DATAJUD SYNC ──────────────────────────────────────────────────────────────

async function rodarDatajud(admin, res, hoje) {
  const startAt = Date.now();
  const agora   = new Date().toISOString();

  // O browser do usuário sincroniza em tempo real enquanto o dashboard está aberto.
  // O servidor só entra para cobrir usuários que não abriram o browser nas últimas 20h.
  const limite20h = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { data: processos, error } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, datajud_index, movimentos_hash, movimentos_recentes, created_at')
    .not('numero', 'is', null)
    .neq('status', 'Arquivado')
    .or(`ultima_verificacao.is.null,ultima_verificacao.lte.${limite20h}`)
    .order('ultima_verificacao', { ascending: true, nullsFirst: true })
    .limit(300);

  if (error) return res.status(500).json({ erro: error.message });

  const userIds        = [...new Set((processos || []).map(p => p.user_id))];
  const oabsPorUsuario = await buscarOabsUsuarios(admin, userIds);

  const [atualizadosDatajud, atualizadosDJEN] = await Promise.all([
    sincronizarDatajud(processos, admin, hoje, startAt),
    sincronizarDJEN(processos, oabsPorUsuario, admin, hoje),
  ]);

  return res.status(200).json({
    ok: true, tipo: 'datajud', hoje,
    processosNaFila: processos?.length || 0,
    datajud: atualizadosDatajud,
    djen: atualizadosDJEN,
    elapsed: Math.round((Date.now() - startAt) / 1000) + 's',
  });
}

async function sincronizarDatajud(processos, admin, hoje, startAt = Date.now()) {
  let atualizados = 0;
  const com_datajud = processos.filter(p => p.datajud_index);

  for (let i = 0; i < com_datajud.length; i += 12) {
    if (Date.now() - startAt > 45000) break; // para em 45s

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
    if (!hits?.length) {
      await admin.from('processos').update({ ultima_verificacao: new Date().toISOString() }).eq('id', proc.id);
      return false;
    }

    const todosMovs = (hits[0]._source.movimentos || [])
      .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
      .slice(0, 100)
      .map(m => ({ nome: m.nome, data: parsarData(m.dataHora) }));

    const novoHash = todosMovs.slice(0, 6).map(m => m.data + m.nome).join('|');

    if (novoHash === proc.movimentos_hash) {
      await admin.from('processos').update({ ultima_verificacao: new Date().toISOString() }).eq('id', proc.id);
      return false;
    }

    const importadoEm   = (proc.created_at || '').slice(0, 10);
    const seteDias      = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const todosNovos    = proc.movimentos_hash
      ? todosMovs.filter(m => !proc.movimentos_hash.includes(m.data + m.nome))
      : todosMovs.slice(0, 1);
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
          if (!proc || (proc.created_at || '').slice(0, 10) === hoje) continue;
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

// ── OAB SCAN — busca processos novos por OAB em todos os tribunais ────────────

async function rodarOabScan(admin, res, hoje) {
  const startAt = Date.now();

  const { data: processos } = await admin
    .from('processos').select('user_id, numero').neq('status', 'Arquivado');

  const userIds = [...new Set((processos || []).map(p => p.user_id))];
  const oabsPorUsuario = await buscarOabsUsuarios(admin, userIds);

  const numerosPorUsuario = {};
  for (const p of processos || []) {
    if (!numerosPorUsuario[p.user_id]) numerosPorUsuario[p.user_id] = new Set();
    if (p.numero) numerosPorUsuario[p.user_id].add(p.numero.replace(/[.\-/ ]/g, ''));
  }

  // Todos os usuários em paralelo
  const resultados = await Promise.allSettled(
    userIds
      .filter(uid => oabsPorUsuario[uid]?.length)
      .map(uid => oabScanUsuario(uid, oabsPorUsuario[uid], numerosPorUsuario[uid] || new Set(), admin, hoje, startAt))
  );

  const novos = resultados.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value || 0) : 0), 0);
  return res.status(200).json({
    ok: true, tipo: 'oab', hoje,
    novosEncontrados: novos,
    elapsed: Math.round((Date.now() - startAt) / 1000) + 's',
  });
}

async function oabScanUsuario(userId, oabs, meusNumeros, admin, hoje, startAt) {
  let novos = 0;
  try {
    const { data: jaVistos } = await admin
      .from('processos_descobertos').select('numero').eq('user_id', userId);
    const vistoSet = new Set((jaVistos || []).map(d => d.numero));
    const inserir  = [];

    for (let i = 0; i < TODOS_TRIBUNAIS.length; i += 20) {
      if (Date.now() - startAt > 50000) break; // time guard 50s

      const lote = TODOS_TRIBUNAIS.slice(i, i + 20);
      const resultados = await Promise.allSettled(
        lote.flatMap(index => oabs.map(oab =>
          buscarPorOabNoDatajud(index, oab).then(hits => ({ index, hits }))
        ))
      );

      for (const r of resultados) {
        if (r.status !== 'fulfilled') continue;
        for (const hit of r.value.hits) {
          const fonte       = hit._source;
          const numeroLimpo = String(fonte.numeroProcesso || '').replace(/\D/g, '');
          if (!numeroLimpo || meusNumeros.has(numeroLimpo) || vistoSet.has(numeroLimpo)) continue;
          vistoSet.add(numeroLimpo);
          inserir.push({
            user_id: userId,
            numero:  numeroLimpo,
            tribunal: r.value.index,
            dados: normalizarDescoberta(fonte, r.value.index),
            data_ajuizamento: parsarData(fonte.dataAjuizamento)?.slice(0, 10) || null,
          });
        }
      }
    }

    if (inserir.length) {
      const { error } = await admin.from('processos_descobertos').insert(inserir);
      if (!error) novos = inserir.length;
      else await logErro(admin, 'cron:oab-scan-insert', error.message, null, userId);
    }
  } catch (e) {
    await logErro(admin, 'cron:oab-scan', e.message, null, userId);
  }
  return novos;
}

async function buscarPorOabNoDatajud(index, oab) {
  const variantes = [`${oab.uf}${oab.num}`, `${oab.uf} ${oab.num}`, oab.num];
  const body = {
    size: 50,
    query: { bool: { should: variantes.map(v => ({ match: { 'partes.advogados.OAB': v } })), minimum_should_match: 1 } },
  };
  try {
    const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
      method: 'POST',
      headers: { 'Authorization': `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify(body),
    });
    if (!r.ok) return { hits: [] };
    const json = JSON.parse(decodificarBuffer(await r.arrayBuffer()));
    return { hits: json.hits?.hits || [] };
  } catch { return { hits: [] }; }
}

function normalizarDescoberta(p, index) {
  return {
    numero: p.numeroProcesso || '',
    tribunal: p.tribunal || index,
    _datajudIndex: index,
    classe: p.classe?.nome || null,
    orgaoJulgador: p.orgaoJulgador?.nome || null,
    dataAjuizamento: parsarData(p.dataAjuizamento),
    partes: (p.partes || []).map(parte => ({
      nome: parte.nome,
      tipo: parte.tipoParte?.descricao || parte.tipo || '',
      oab:  parte.advogados?.[0]?.OAB || null,
    })),
    movimentos: (p.movimentos || [])
      .sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora))
      .slice(0, 20)
      .map(m => ({ nome: m.nome, data: m.dataHora })),
  };
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
    return JSON.parse(decodificarBuffer(await r.arrayBuffer())).hits?.hits || null;
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
