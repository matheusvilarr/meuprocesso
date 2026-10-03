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

// Antes: UTF-8 estrito e, ao primeiro byte inválido, o texto INTEIRO era lido
// como windows-1252 — um byte ruim no meio da resposta transformava todos os
// acentos em lixo ("PRESIDÊNCIA" virava "PRESIDÃŠNCIA"). Agora o UTF-8
// tolerante estraga só o byte ruim, e o windows-1252 só entra quando a
// resposta realmente não é UTF-8.
export function decodificarBuffer(buffer) {
  const utf8  = new TextDecoder('utf-8').decode(buffer);          // tolerante
  const ruins = (utf8.match(/�/g) || []).length;
  if (!ruins) return utf8;

  const win = new TextDecoder('windows-1252').decode(buffer);
  // "Ã"/"Â" em excesso é assinatura de UTF-8 lido como win1252 — nesse caso o
  // texto é UTF-8 mesmo, só com alguns bytes corrompidos na origem.
  const mojibake = (win.match(/[ÃÂ]/g) || []).length;
  return mojibake > ruins ? utf8 : win;
}

// Texto que já chegou (ou foi salvo) como UTF-8 lido em windows-1252.
// Só mexe quando a conversão de volta dá um UTF-8 válido, então nome legítimo
// como "SÃO PAULO" ou "JOÃO" passa intacto.
const WIN1252_ALTOS = {
  '€':0x80,'‚':0x82,'ƒ':0x83,'„':0x84,'…':0x85,'†':0x86,'‡':0x87,'ˆ':0x88,'‰':0x89,
  'Š':0x8A,'‹':0x8B,'Œ':0x8C,'Ž':0x8E,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,
  '–':0x96,'—':0x97,'˜':0x98,'™':0x99,'š':0x9A,'›':0x9B,'œ':0x9C,'ž':0x9E,'Ÿ':0x9F,
};

export function corrigirMojibake(texto) {
  const s = String(texto ?? '');
  if (!/[ÃÂ]./.test(s)) return s;
  const bytes = [];
  for (const c of s) {
    const cp = WIN1252_ALTOS[c] ?? c.codePointAt(0);
    if (cp > 0xFF) return s;  // caractere que não cabe em 1 byte → não é mojibake
    bytes.push(cp);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); }
  catch { return s; }
}

// Teto de linhas iguais por execução. Um bloqueio do DJEN chegou a gravar 522
// linhas idênticas num dia — isso não ajuda a diagnosticar nada e só ocupa
// espaço do plano grátis (500 MB no Supabase). A janela se reabre sozinha
// depois de 5 min, porque a função pode ficar "quente" entre execuções.
const MAX_ERROS_IGUAIS = 20;
const _contagemErros   = new Map();
let   _janelaErros     = 0;

export async function logErro(admin, origem, mensagem, detalhes, userId) {
  try {
    if (Date.now() - _janelaErros > 5 * 60 * 1000) { _contagemErros.clear(); _janelaErros = Date.now(); }
    const chave = `${origem}|${String(mensagem || '').replace(/\d+/g, '#').slice(0, 80)}`;
    const n = (_contagemErros.get(chave) || 0) + 1;
    _contagemErros.set(chave, n);
    if (n > MAX_ERROS_IGUAIS) return;          // já registrou o bastante desse tipo
    const msg = n === MAX_ERROS_IGUAIS
      ? `${mensagem} — [e outras ocorrências iguais nesta execução, não registradas]`
      : mensagem;
    await admin.from('error_log').insert({ origem, mensagem: msg, detalhes: detalhes || null, user_id: userId || null });
  } catch (_) {}
}

// Retenção: o painel só olha 14 dias. Guardar mais que 30 não ajuda em nada
// e vai comendo o espaço do banco, que no plano grátis é limitado.
export async function limparLogsAntigos(admin) {
  const limite = new Date(Date.now() - 30 * 86400000).toISOString();
  const dia    = limite.slice(0, 10);
  const apagar = (tabela, coluna, valor) =>
    admin.from(tabela).delete().lt(coluna, valor).then(() => {}, () => {});
  await Promise.all([
    apagar('error_log', 'created_at', limite),
    apagar('notif_log', 'data', dia),
    apagar('djen_cadernos_fila', 'data', dia),   // a fila só usa os últimos 7 dias
    apagar('cron_execucoes', 'iniciado_em', limite),
  ]);
}

// ── REGISTRO DAS EXECUÇÕES AUTOMÁTICAS ────────────────────────────────────────
// Uma linha por execução: gravada no começo e completada no fim. Execução que
// fica com terminou_em vazio é a que morreu no meio (estourou o tempo da
// Vercel) — sem isso não há como saber que ela nem chegou ao fim.
// Nunca derruba o cron: se o registro falhar, a sincronização segue.

export async function abrirExecucao(admin, cron) {
  try {
    const { data } = await admin.from('cron_execucoes').insert({
      cron,
      regiao: process.env.VERCEL_REGION || null,
      deploy: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    }).select('id').single();
    return data?.id ?? null;
  } catch { return null; }
}

export async function fecharExecucao(admin, id, dados = {}) {
  if (!id) return;
  const { inicioMs, fila = null, processados = null, resultados = null, erro = null } = dados;
  try {
    await admin.from('cron_execucoes').update({
      terminou_em: new Date().toISOString(),
      duracao_ms: inicioMs ? Date.now() - inicioMs : null,
      fila, processados, resultados,
      erro: erro ? String(erro).slice(0, 500) : null,
    }).eq('id', id);
  } catch { /* registro é diagnóstico, não pode quebrar o cron */ }
}

// ── PADRÃO DE CADASTRO ────────────────────────────────────────────────────────
// Todo lugar que grava um processo passa por aqui. Antes cada caminho de
// importação salvava num formato: a busca por número gravava com pontuação, o
// scan por OAB gravava os 20 dígitos corridos. Isso criava dois problemas:
// o número sem pontuação ficava fora da fila de sincronização, e o mesmo
// processo podia ser cadastrado duas vezes (o índice único compara texto).

// Formato canônico do CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
export function normalizarNumeroCNJ(numero) {
  const s = String(numero ?? '').trim();
  const d = s.replace(/\D/g, '');
  if (d.length !== 20) return s;   // não é número CNJ — devolve como veio
  return `${d.slice(0,7)}-${d.slice(7,9)}.${d.slice(9,13)}.${d.slice(13,14)}.${d.slice(14,16)}.${d.slice(16)}`;
}

// Título do processo em caixa padronizada. O DataJud devolve "Procedimento
// Comum Cível" e o DJEN devolve "PROCEDIMENTO COMUM CíVEL" — na lista os dois
// apareciam lado a lado. Preposições ficam em minúsculo, como em português.
const PREPOSICOES = new Set([
  'de','da','do','das','dos','e','ou','a','o','as','os','em','por','para','com','sem',
  'ao','aos','à','às','no','na','nos','nas','num','numa','contra','sob','sobre','entre',
  'perante','até','após','desde','durante','mediante','conforme','segundo','pelo','pela',
]);

export function tituloProcesso(...partes) {
  const texto = partes.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
  if (!texto) return '';
  return corrigirMojibake(texto).toLowerCase().replace(/[^\s·]+/g, (p, pos) =>
    (pos === 0 || !PREPOSICOES.has(p)) ? p.charAt(0).toUpperCase() + p.slice(1) : p);
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
      const mov = { nome: corrigirMojibake(m.nome), data: parsarData(m.dataHora) };
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

// Processo que apareceu numa intimação mas não está cadastrado: NÃO entra
// direto na lista do advogado. Vira uma sugestão que ele aceita ou recusa.
//
// Por quê: aparecer a OAB numa publicação não significa que o processo é dele
// hoje — pode ser caso encerrado, homônimo, ou trabalho que saiu do escritório.
// Quem decide o que fica atrelado ao perfil é o advogado.
//
// `marcoISO` é a data da primeira importação dele. Publicação anterior a isso
// é de antes de ele usar o sistema: se não cadastrou naquela época, foi
// escolha dele, e não faz sentido ressuscitar agora. Antes o corte era "ano
// corrente", que ainda trazia coisa anterior à chegada da pessoa.
export async function _djenSugerirProcesso(numeroBruto, userId, movDJEN, admin, marcoISO, tribunal) {
  const numero = normalizarNumeroCNJ(numeroBruto);
  if (!/^\d{7}-\d{2}\.\d{4}\./.test(numero)) return false;

  const dataPub = String(movDJEN?.data || '').slice(0, 10);
  if (marcoISO && dataPub && dataPub < String(marcoISO).slice(0, 10)) return false;

  try {
    // Já cadastrado de verdade? Então não é descoberta.
    const { data: jaTem } = await admin.from('processos')
      .select('id').eq('user_id', userId).eq('numero', numero).maybeSingle();
    if (jaTem) return false;

    // Já sugerido antes (pendente, importado ou ignorado) — não insiste.
    const { data: jaSugerido } = await admin.from('processos_descobertos')
      .select('id').eq('user_id', userId).eq('numero', numero).maybeSingle();
    if (jaSugerido) return false;

    const { error } = await admin.from('processos_descobertos').insert({
      user_id:  userId,
      numero,
      tribunal: tribunal || datajudIndexFromNumero(numero) || 'desconhecido',
      // Formato que _importarComMerge() espera, para o "Importar" de um clique
      // já levar a intimação para a timeline.
      dados: {
        numero,
        tribunal:      tribunal || null,
        _datajudIndex: datajudIndexFromNumero(numero),
        movimentos:    [movDJEN],
        _origem:       'djen',
        _intimacao:    { nome: movDJEN?.nome || null, data: movDJEN?.data || null, url: movDJEN?._url || null },
      },
    });
    return !error;
  } catch (_) {
    return false;
  }
}

// Deriva o índice DataJud a partir do número CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO).
// Aceita com ou sem pontuação: até 30/09/2026 só a versão com máscara era
// reconhecida, e processo salvo com os 20 dígitos corridos ficava sem índice —
// ou seja, fora da fila de sincronização PARA SEMPRE, sem nunca atualizar.
export function datajudIndexFromNumero(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return null;
  const seg = d[13], trib = parseInt(d.slice(14, 16), 10);
  if (seg === '1') return 'api_publica_stf';
  if (seg === '3') return 'api_publica_stj';
  // J=7 é a Justiça Militar da União; índice conferido em 30/09/2026 (200 OK).
  // J=2 (CNJ) não tem índice na API pública — testado, devolve 404.
  if (seg === '7') return 'api_publica_stm';
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
