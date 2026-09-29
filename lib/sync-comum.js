// Funções compartilhadas da sincronização (DataJud + DJEN), usadas por
// api/cron/sincronizar.js, lib/djen-cadernos.js, api/admin.js e
// api/buscar-processo.js. Ficam em lib/ (e não em api/) porque todo arquivo
// em api/ vira uma função serverless, e o plano Hobby da Vercel aceita no
// máximo 12 — além disso, evita import circular entre os crons.

export function parsarData(s) {
  if (!s) return null;
  const str = String(s);
  if (/^\d{14}$/.test(str)) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}T${str.slice(8,10)}:${str.slice(10,12)}:${str.slice(12,14)}`;
  if (/^\d{8}$/.test(str))  return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
  return s;
}

export function decodificarBuffer(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

export async function logErro(admin, origem, mensagem, detalhes, userId) {
  try {
    await admin.from('error_log').insert({ origem, mensagem, detalhes: detalhes || null, user_id: userId || null });
  } catch (_) {}
}

// ── MOVIMENTOS ────────────────────────────────────────────────────────────────

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
    email_pendente:       true,
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
      datajud_index:        datajudIndexFromNumero(numero),
      movimentos_recentes:  [movMarcado],
      novos_movimentos:     [movMarcado],
      notificacao_pendente: true,
      email_pendente:       true,
      // null = primeiro da fila do DataJud, que completa nome/classe/tribunal
      ultima_verificacao:   null,
    });
    return !error;
  } catch (_) {
    return false;
  }
}

// Deriva o índice DataJud a partir do número CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO)
export function datajudIndexFromNumero(numero) {
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

// ── OABs dos usuários ─────────────────────────────────────────────────────────

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
  for (const c of colabs || []) {
    (colabPorEscritorio[c.escritorio_id] ||= []).push(c.user_id);
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
