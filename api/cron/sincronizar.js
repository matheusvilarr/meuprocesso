// Sincronização de processos e OAB scan.
// ?tipo=datajud (padrão) — atualiza movimentos de todos os processos no DataJud + DJEN
// ?tipo=oab     — varre todos os tribunais pela OAB do advogado buscando processos novos
//
// DataJud: filtro de 20h (browser cobre usuários ativos). Time guard 45s.
// DJEN: roda em TODOS os processos ativos a cada execução, sem filtro de inatividade.
//       Usa OABs do titular + todos os colaboradores ativos do escritório.

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

  // DataJud: browser cobre usuários ativos — servidor só entra para quem ficou 20h+ sem abrir.
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

  // OABs buscadas antes — uma chamada listUsers no lugar de N getUserById sequenciais
  const { data: todosProcessos } = await admin
    .from('processos')
    .select('id, user_id, numero, movimentos_recentes, created_at')
    .not('numero', 'is', null)
    .neq('status', 'Arquivado');

  const djenUserIds    = [...new Set((todosProcessos || []).map(p => p.user_id))];
  const oabsPorUsuario = await buscarOabsUsuarios(admin, djenUserIds);

  // DataJud primeiro, DJEN depois com dados frescos — evita race condition
  const atualizadosDatajud = await sincronizarDatajud(processos, admin, hoje, startAt);

  // Re-carrega movimentos_recentes depois que DataJud atualizou
  const { data: todosProcessosFresh } = await admin
    .from('processos')
    .select('id, user_id, numero, movimentos_recentes, created_at')
    .not('numero', 'is', null)
    .neq('status', 'Arquivado');

  const atualizadosDJEN = await sincronizarDJEN(todosProcessosFresh || [], oabsPorUsuario, admin, hoje);

  return res.status(200).json({
    ok: true, tipo: 'datajud', hoje,
    processosNaFila: processos?.length || 0,
    todosParaDJEN: todosProcessos?.length || 0,
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

    // Preserva movimentos DJEN existentes — DataJud não deve apagá-los
    const djenExistentes = (proc.movimentos_recentes || []).filter(m => (m.nome || '').startsWith('DJEN'));
    const movimentosFinal = [...todosMovs, ...djenExistentes]
      .sort((a, b) => (b.data || '') > (a.data || '') ? 1 : -1)
      .slice(0, 100);

    const update = {
      movimentos_recentes: movimentosFinal,
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
  const ontem     = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const numeroSet = new Set(processos.map(p => p.numero).filter(Boolean));
  // Inclui todos com OAB, mesmo sem processos — auto-import cria os processos faltantes
  const userIds   = [...new Set([...processos.map(p => p.user_id), ...Object.keys(oabsPorUsuario)])];

  // Todos os usuários em paralelo — elimina gargalo sequencial
  const resultados = await Promise.allSettled(
    userIds.map(uid => _djenUsuario(uid, processos, oabsPorUsuario, numeroSet, admin, hoje, ontem))
  );

  return resultados.reduce((acc, r) => acc + (r.status === 'fulfilled' ? r.value : 0), 0);
}

async function _djenUsuario(uid, processos, oabsPorUsuario, numeroSet, admin, hoje, ontem) {
  const oabs = oabsPorUsuario[uid];
  if (!oabs?.length) return 0;

  let atualizados = 0;
  try {
    const reqs = oabs.map(oab =>
      fetch(`${DJEN_API}?${new URLSearchParams({ numeroOab: oab.num, ufOab: oab.uf, dataDisponibilizacaoInicio: ontem, dataDisponibilizacaoFim: hoje, pagina: 1, tamanhoPagina: 100 })}`, { signal: AbortSignal.timeout(15000) })
        .then(r => r.ok ? r.json() : { items: [] })
        .catch(() => ({ items: [] }))
    );
    const items = (await Promise.all(reqs)).flatMap(r => r.items || []);

    for (const item of items) {
      const dataPub = item.data_disponibilizacao || hoje;
      if (dataPub < ontem) continue;

      const movDJEN = { nome: `DJEN — ${item.tipoComunicacao || 'Publicação'}`, data: dataPub + 'T00:00:00' };
      const PADRAO  = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;

      // Número principal da publicação: auto-importar se ainda não cadastrado
      const numPrincipal = item.numeroprocessocommascara;
      if (numPrincipal) {
        const proc = processos.find(p => p.numero === numPrincipal && p.user_id === uid);
        if (!proc) {
          const importado = await _djenAutoImportar(numPrincipal, uid, movDJEN, admin);
          if (importado) atualizados++;
        } else if ((proc.created_at || '').slice(0, 10) !== hoje) {
          const ok = await _djenAtualizarProcesso(proc.id, movDJEN, admin);
          if (ok) atualizados++;
        }
      }

      // Números citados no texto: só atualizar processos já cadastrados (evita falsos positivos)
      const numsTexto = [...new Set((item.texto || '').match(PADRAO) || [])]
        .filter(n => n !== numPrincipal && numeroSet.has(n));
      for (const num of numsTexto) {
        const proc = processos.find(p => p.numero === num && p.user_id === uid);
        if (!proc || (proc.created_at || '').slice(0, 10) === hoje) continue;
        const ok = await _djenAtualizarProcesso(proc.id, movDJEN, admin);
        if (ok) atualizados++;
      }
    }
  } catch (e) {
    await logErro(admin, 'cron:djen', e.message, { oabs }, uid);
  }
  return atualizados;
}

async function _djenAtualizarProcesso(processoId, movDJEN, admin) {
  const { data: procFresh } = await admin.from('processos')
    .select('movimentos_recentes').eq('id', processoId).single();
  const movsAtuais = procFresh?.movimentos_recentes || [];
  if (movsAtuais.some(m => m.data === movDJEN.data && m.nome === movDJEN.nome)) return false;
  await admin.from('processos').update({
    movimentos_recentes:  [movDJEN, ...movsAtuais].slice(0, 100),
    ultima_verificacao:   new Date().toISOString(),
    notificacao_pendente: true,
    novos_movimentos:     [movDJEN],
  }).eq('id', processoId);
  return true;
}

async function _djenAutoImportar(numero, userId, movDJEN, admin) {
  // Só importa processos do ano corrente — publicações de casos antigos não cadastrados são ignoradas
  const m = (numero || '').match(/\d{7}-\d{2}\.(\d{4})\./);
  if (!m || parseInt(m[1], 10) < new Date().getFullYear()) return false;

  try {
    const { data: existente } = await admin.from('processos')
      .select('id').eq('user_id', userId).eq('numero', numero).maybeSingle();
    if (existente) return false;

    const movMarcado = { ...movDJEN, _auto_importado: true };
    await admin.from('processos').insert({
      user_id:              userId,
      numero,
      nome:                 numero,  // DataJud preenche no próximo cron
      status:               'Ativo',
      datajud_index:        _datajudIndexFromNumero(numero),
      movimentos_recentes:  [movMarcado],
      novos_movimentos:     [movMarcado],
      notificacao_pendente: true,
      ultima_verificacao:   new Date().toISOString(),
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Deriva o índice DataJud a partir do número CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO)
function _datajudIndexFromNumero(numero) {
  const m = (numero || '').match(/\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}/);
  if (!m) return null;
  const seg = m[1], trib = parseInt(m[2], 10);
  if (seg === '1') return 'api_publica_stf';
  if (seg === '3') return 'api_publica_stj';
  if (seg === '4' && trib >= 1 && trib <= 6)  return `api_publica_trf${trib}`;
  if (seg === '5' && trib >= 1 && trib <= 24) return `api_publica_trt${trib}`;
  if (seg === '6') {
    const ufsTre = ['','ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms','mg','pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','se','sp','to'];
    const uf = ufsTre[trib];
    if (!uf) return null;
    return `api_publica_tre_${uf}`;
  }
  if (seg === '8') {
    const ufs = ['','ac','al','ap','am','ba','ce','dft','es','go','ma','mt','ms','mg','pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','se','sp','to'];
    const uf = ufs[trib];
    if (!uf) return null;
    return uf === 'dft' ? 'api_publica_tjdft' : `api_publica_tj${uf}`;
  }
  if (seg === '9') {
    if (trib === 13) return 'api_publica_tjmmg';
    if (trib === 21) return 'api_publica_tjmrs';
    if (trib === 26) return 'api_publica_tjmsp';
    return null;
  }
  return null;
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

  // Todos os usuários com OAB em paralelo — inclui quem não tem processos ainda
  const resultados = await Promise.allSettled(
    Object.keys(oabsPorUsuario)
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
  if (!userIds.length) return {};
  const result = {};

  const parseOab = raw =>
    (raw || '').split(',').map(s => s.trim()).filter(Boolean).map(o => {
      const m = o.toUpperCase().replace(/[.\-]/g, '').match(/^(?:OAB[/ ]?)?([A-Z]{2})[/ ]?(\d{3,7})$/);
      return m ? { uf: m[1], num: m[2] } : null;
    }).filter(Boolean);

  // Colaboradores ativos de uma vez só
  const { data: colabs } = await admin
    .from('colaboradores')
    .select('escritorio_id, user_id')
    .in('escritorio_id', userIds)
    .eq('status', 'ativo');

  const colabPorEscritorio = {};
  const todosIds = new Set(userIds);
  for (const c of colabs || []) {
    (colabPorEscritorio[c.escritorio_id] ||= []).push(c.user_id);
    todosIds.add(c.user_id);
  }

  // Um único listUsers paginado no lugar de N chamadas getUserById sequenciais
  const metaMap = {};
  try {
    let page = 1;
    while (true) {
      const { data: listResult, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000, page });
      if (listErr) throw listErr;
      const users = listResult?.users || [];
      for (const u of users) metaMap[u.id] = u.user_metadata?.oab;
      if (users.length < 1000) break;
      page++;
    }
  } catch (e) {
    await logErro(admin, 'cron:buscar-oabs', e.message, {});
    return result;
  }

  // Inclui usuários com OAB mesmo sem processos — permite auto-import para novos usuários
  const todosComOab = [...new Set([...userIds, ...Object.keys(metaMap).filter(id => metaMap[id])])];

  for (const uid of todosComOab) {
    const oabs = new Map();
    for (const oab of parseOab(metaMap[uid])) {
      oabs.set(`${oab.uf}${oab.num}`, oab);
    }
    for (const colabId of colabPorEscritorio[uid] || []) {
      for (const oab of parseOab(metaMap[colabId])) {
        oabs.set(`${oab.uf}${oab.num}`, oab);
      }
    }
    if (oabs.size) result[uid] = [...oabs.values()];
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
