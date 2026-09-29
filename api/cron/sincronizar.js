// Sincronização de processos e OAB scan.
// ?tipo=datajud (padrão) — atualiza movimentos de todos os processos no DataJud
// ?tipo=oab     — varre todos os tribunais pela OAB do advogado buscando processos novos
//                 (fora do vercel.json: a API pública do DataJud não expõe "partes",
//                 então a busca por OAB nunca retorna nada — testado set/2026)
//
// DataJud: filtro de 20h (browser cobre usuários ativos). Time guard 90s.
// DJEN: migrado pro cron dedicado api/cron/djen-cadernos.js (ver esse arquivo).

import { createClient } from '@supabase/supabase-js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DATAJUD_KEY      = process.env.DATAJUD_API_KEY
  || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const CRON_SECRET      = process.env.CRON_SECRET;

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

export async function repararDatajudIndex(admin) {
  const { data: semIndex } = await admin
    .from('processos')
    .select('id, numero')
    .is('datajud_index', null)
    .not('numero', 'is', null)
    .neq('status', 'Arquivado');

  if (!semIndex?.length) return 0;

  const updates = (semIndex || []).map(p => {
    const idx = _datajudIndexFromNumero(p.numero);
    return idx ? { id: p.id, idx } : null;
  }).filter(Boolean);

  await Promise.allSettled(
    updates.map(({ id, idx }) =>
      admin.from('processos').update({ datajud_index: idx }).eq('id', id)
    )
  );
  return updates.length;
}

async function rodarDatajud(admin, res, hoje) {
  const startAt = Date.now();

  // Backfill: preenche datajud_index para processos que têm numero mas não têm index
  const reparados = await repararDatajudIndex(admin);

  // DataJud: browser cobre usuários ativos — servidor só entra para quem ficou 20h+ sem abrir.
  const limite20h = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  // Só processos com datajud_index: os sem índice (ex: cadastro manual sem
  // número CNJ) nunca eram atualizados e ficavam eternamente no topo da fila.
  const { data: processos, error } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, datajud_index, movimentos_hash, movimentos_recentes, notificacao_pendente, novos_movimentos, created_at')
    .not('numero', 'is', null)
    .not('datajud_index', 'is', null)
    .neq('status', 'Arquivado')
    .or(`ultima_verificacao.is.null,ultima_verificacao.lte.${limite20h}`)
    .order('ultima_verificacao', { ascending: true, nullsFirst: true })
    .limit(300);

  if (error) return res.status(500).json({ erro: error.message });

  const atualizadosDatajud = await sincronizarDatajud(processos, admin, hoje, startAt);

  // DJEN: migrado pro cron dedicado api/cron/djen-cadernos.js (baixa o caderno
  // diário por tribunal em vez de 1 requisição por OAB por usuário — evitava o
  // limite de 20 req/min por IP da API do DJEN, que aqui só gerava 403 à toa).

  // Dispara email imediato se houve movimentos novos — não bloqueia o response em caso de erro
  if (atualizadosDatajud > 0) {
    try {
      await fetch('https://meuprocesso.app.br/api/cron/verificar-atualizacoes?tipo=instant', {
        headers: { 'Authorization': `Bearer ${CRON_SECRET || ''}` },
        signal: AbortSignal.timeout(25000),
      });
    } catch (_) {}
  }

  return res.status(200).json({
    ok: true, tipo: 'datajud', hoje,
    reparados,
    processosNaFila: processos?.length || 0,
    datajud: atualizadosDatajud,
    emailInstant: atualizadosDatajud > 0,
    elapsed: Math.round((Date.now() - startAt) / 1000) + 's',
  });
}

async function sincronizarDatajud(processos, admin, hoje, startAt = Date.now()) {
  let atualizados = 0;
  const com_datajud = processos.filter(p => p.datajud_index);

  for (let i = 0; i < com_datajud.length; i += 12) {
    // 60s + até 28s do último lote + disparo de e-mail (25s) cabe no maxDuration
    // de 120s. O DataJud chega a levar 20-30s por consulta em horário de pico.
    if (Date.now() - startAt > 60000) break;

    const lote = com_datajud.slice(i, i + 12);
    const resultados = await Promise.allSettled(
      lote.map(proc => sincronizarDatajudUm(proc, admin, hoje))
    );
    atualizados += resultados.filter(r => r.status === 'fulfilled' && r.value === 'novos').length;
  }
  return atualizados;
}

// Chave estável de um movimento pra comparar listas antigas e novas, mesmo
// que a data tenha sido gravada em formatos diferentes (ISO com/sem ms,
// "yyyyMMddHHmmss"...) por versões diferentes do código.
// Só texto (sem new Date): o navegador roda em horário de Brasília e o
// servidor em UTC, e a chave precisa dar igual nos dois.
export function chaveMov(m) {
  const dia = String(parsarData(m?.data) || '')
    .replace(/\.\d+/, '').replace(/(Z|[+-]\d{2}:?\d{2})$/, '').slice(0, 16);
  return `${dia}|${(m?.nome || '').trim()}`;
}

// Movimentos vindos do DataJud, de todos os graus do processo (G1, G2, JE...
// são documentos separados no índice com o mesmo número), sem duplicatas,
// do mais recente pro mais antigo.
export function movimentosDosHits(hits) {
  const vistos = new Map();
  for (const h of hits || []) {
    for (const m of h._source?.movimentos || []) {
      const mov = { nome: m.nome, data: parsarData(m.dataHora) };
      const k = chaveMov(mov);
      if (!vistos.has(k)) vistos.set(k, mov);
    }
  }
  const ts = m => { const t = new Date(m.data).getTime(); return isNaN(t) ? 0 : t; };
  return [...vistos.values()].sort((a, b) => ts(b) - ts(a)).slice(0, 100);
}

// Usado pelo cron e pelo botão "DataJud agora" do painel admin (api/admin.js).
// proc precisa de: id, user_id, numero, nome, datajud_index, movimentos_hash,
// movimentos_recentes, notificacao_pendente, novos_movimentos, created_at.
// Retorna 'novos' | 'atualizado' | 'sem-mudanca' | 'nao-encontrado' | 'pulado' | 'erro'.
export async function sincronizarDatajudUm(proc, admin, hoje) {
  if ((proc.created_at || '').slice(0, 10) === hoje) return 'pulado';
  try {
    const hits = await buscarNoDatajud(proc.datajud_index, proc.numero);
    if (!hits?.length) {
      await admin.from('processos').update({ ultima_verificacao: new Date().toISOString() }).eq('id', proc.id);
      return 'nao-encontrado';
    }

    const todosMovs = movimentosDosHits(hits);
    const novoHash  = todosMovs.slice(0, 6).map(m => m.data + m.nome).join('|');

    if (novoHash === proc.movimentos_hash) {
      await admin.from('processos').update({ ultima_verificacao: new Date().toISOString() }).eq('id', proc.id);
      return 'sem-mudanca';
    }

    // Novo = não estava na lista salva. Compara com a lista inteira (não só
    // com o hash dos 6 últimos) e aceita até 30 dias de atraso: tribunais
    // costumam enviar ao DataJud com dias/semanas de atraso, e a janela antiga
    // de 5 dias fazia essas movimentações entrarem na timeline sem notificar.
    const anteriores    = (proc.movimentos_recentes || []).filter(m => !ehMovDJEN(m));
    const conhecidas    = new Set(anteriores.map(chaveMov));
    const importadoEm   = (proc.created_at || '').slice(0, 10);
    const limite30d     = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const detectadoEm   = new Date().toISOString().slice(0, 10);
    // Primeira sincronização (processo sem nenhum movimento do DataJud salvo):
    // só a mais recente conta como novidade, igual ao comportamento anterior.
    const todosNovos    = anteriores.length
      ? todosMovs.filter(m => !conhecidas.has(chaveMov(m)))
      : todosMovs.slice(0, 1);
    const novosRecentes = todosNovos
      .filter(m => m.data && m.data.slice(0, 10) >= limite30d && (!importadoEm || m.data.slice(0, 10) >= importadoEm))
      .map(m => ({ ...m, _detectadoEm: detectadoEm }));

    // Preserva movimentos DJEN existentes — DataJud não deve apagá-los
    const djenExistentes = (proc.movimentos_recentes || []).filter(ehMovDJEN);
    const movimentosFinal = [...todosMovs, ...djenExistentes]
      .sort((a, b) => (b.data || '') > (a.data || '') ? 1 : -1)
      .slice(0, 100);

    const update = {
      movimentos_recentes: movimentosFinal,
      movimentos_hash:     novoHash,
      ultima_verificacao:  new Date().toISOString(),
    };
    // Processo auto-importado pelo DJEN nasce com nome = número; completa com
    // os dados do DataJud (só nesse caso — nunca sobrescreve o que o advogado editou).
    const src = hits[0]._source || {};
    if (proc.nome && proc.nome === proc.numero) {
      if (src.classe?.nome)        { update.nome = src.classe.nome; update.classe = src.classe.nome; }
      if (src.orgaoJulgador?.nome) update.orgao_julgador = src.orgaoJulgador.nome;
      if (src.tribunal)            update.tribunal = src.tribunal;
    }
    if (novosRecentes.length) {
      // Mantém novidades ainda não notificadas (ex: publicação DJEN pendente de e-mail)
      const pendentes = proc.notificacao_pendente ? (proc.novos_movimentos || []) : [];
      const chaves    = new Set(novosRecentes.map(chaveMov));
      update.notificacao_pendente = true;
      update.novos_movimentos     = [...novosRecentes, ...pendentes.filter(m => !chaves.has(chaveMov(m)))];
    }
    const { error: upErr } = await admin.from('processos').update(update).eq('id', proc.id);
    if (upErr) throw new Error(`Falha ao gravar: ${upErr.message}`);
    return novosRecentes.length ? 'novos' : 'atualizado';
  } catch (e) {
    await logErro(admin, 'cron:datajud', e.message, { numero: proc.numero, processoId: proc.id }, proc.user_id);
    // Não marca como verificado agora (a falha não pode esconder o processo por
    // 20h), mas joga pra ~2h atrás do fim da janela: volta na próxima execução,
    // só que atrás dos que nunca foram tentados. Sem isso, processos que sempre
    // dão timeout ocupavam o começo da fila em toda execução.
    const retry = new Date(Date.now() - 18 * 3600 * 1000).toISOString();
    await admin.from('processos').update({ ultima_verificacao: retry }).eq('id', proc.id).then(() => {}, () => {});
    return 'erro';
  }
}

// ── DJEN ─────────────────────────────────────────────────────────────────────

export function ehMovDJEN(m) {
  return m?._fonte === 'djen' || (m?.nome || '').startsWith('DJEN');
}

// Mesma publicação gravada por caminhos diferentes (cron antigo: data "AAAA-MM-DD"
// e nome "DJEN — Tipo"; busca manual: data com "T00:00:00" e nome "DJEN — Tipo ·
// Decisão"; cron de cadernos: com _url). Compara pelo link quando os dois têm,
// senão pelo dia + tipo.
export function mesmoMovDJEN(a, b) {
  if (a?._url && b?._url) return a._url === b._url;
  const dia  = m => String(m?.data || '').slice(0, 10);
  const tipo = m => String(m?.nome || '').split(' · ')[0].trim();
  return dia(a) === dia(b) && tipo(a) === tipo(b);
}

export async function _djenAtualizarProcesso(processoId, movDJEN, admin) {
  const { data: procFresh } = await admin.from('processos')
    .select('movimentos_recentes, notificacao_pendente, novos_movimentos').eq('id', processoId).single();
  const movsAtuais = procFresh?.movimentos_recentes || [];
  if (movsAtuais.some(m => ehMovDJEN(m) && mesmoMovDJEN(m, movDJEN))) return false;
  const pendentes = procFresh?.notificacao_pendente ? (procFresh.novos_movimentos || []) : [];
  // Sem ultima_verificacao aqui: ela controla a fila do DataJud, e uma
  // publicação no DJEN não significa que o DataJud foi consultado.
  const { error } = await admin.from('processos').update({
    movimentos_recentes:  [movDJEN, ...movsAtuais].slice(0, 100),
    notificacao_pendente: true,
    novos_movimentos:     [movDJEN, ...pendentes],
  }).eq('id', processoId);
  if (error) throw new Error(`Falha ao gravar DJEN no processo ${processoId}: ${error.message}`);
  return true;
}

export async function _djenAutoImportar(numero, userId, movDJEN, admin) {
  // Só importa processos do ano corrente — publicações de casos antigos não cadastrados são ignoradas
  const m = (numero || '').match(/\d{7}-\d{2}\.(\d{4})\./);
  if (!m || parseInt(m[1], 10) < new Date().getFullYear()) return false;

  try {
    const { data: existente } = await admin.from('processos')
      .select('id').eq('user_id', userId).eq('numero', numero).maybeSingle();
    if (existente) return false;

    const movMarcado = { ...movDJEN, _auto_importado: true };
    const { error } = await admin.from('processos').insert({
      user_id:              userId,
      numero,
      nome:                 numero,  // DataJud preenche no próximo cron
      status:               'Ativo',
      datajud_index:        _datajudIndexFromNumero(numero),
      movimentos_recentes:  [movMarcado],
      novos_movimentos:     [movMarcado],
      notificacao_pendente: true,
      // null = primeiro da fila do DataJud, que completa nome/classe/tribunal
      ultima_verificacao:   null,
    });
    return !error;
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
    return `api_publica_tre-${uf}`;
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
          buscarPorOabNoDatajud(index, oab).then(res => ({ index, hits: res.hits }))
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
      signal: AbortSignal.timeout(20000),
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

export async function buscarOabsUsuarios(admin, userIds) {
  if (!userIds.length) return {};
  const result = {};

  // num sem zeros à esquerda — o DJEN manda "8746", o advogado pode ter
  // cadastrado "08746".
  const parseOab = raw =>
    (raw || '').split(',').map(s => s.trim()).filter(Boolean).map(o => {
      const m = o.toUpperCase().replace(/[.\-]/g, '').match(/^(?:OAB[/ ]?)?([A-Z]{2})[/ ]?(\d{3,7})$/);
      return m ? { uf: m[1], num: m[2].replace(/^0+/, '') } : null;
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

// IMPORTANTE: propositalmente NÃO engole erro aqui (nem timeout, nem status
// != 200) — se engolisse e devolvesse null/[], sincronizarDatajudUm() trataria
// isso como "consultei e não achou nada" e marcaria ultima_verificacao como
// agora, escondendo a falha e adiando a próxima tentativa real em 20h. Deixa
// a exceção subir pro catch de sincronizarDatajudUm(), que loga em error_log
// e NÃO atualiza ultima_verificacao — o processo continua na fila pra
// próxima execução do cron.
async function buscarNoDatajud(index, numero) {
  const numeroLimpo = numero.replace(/[.\-\/ ]/g, '');
  const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
    method: 'POST',
    headers: { 'Authorization': `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(28000),
    // size 10: um mesmo número pode ter um documento por grau (G1, G2, JE...)
    body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: numeroLimpo } } }),
  });
  if (!r.ok) throw new Error(`DataJud respondeu ${r.status} (${index})`);
  const json = JSON.parse(decodificarBuffer(await r.arrayBuffer()));
  return json.hits?.hits || [];
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

export async function logErro(admin, origem, mensagem, detalhes, userId) {
  try {
    await admin.from('error_log').insert({ origem, mensagem, detalhes: detalhes || null, user_id: userId || null });
  } catch (_) {}
}
