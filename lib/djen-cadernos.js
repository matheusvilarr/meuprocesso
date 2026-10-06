// Sincronização DJEN via "caderno" diário (1 download = todas as comunicações
// de um tribunal no dia), em vez de 1 requisição por OAB por usuário.
//
// Por quê: a API do DJEN limita 20 requisições/minuto por IP (documentado em
// /swagger/djen.yml). Buscar por OAB escala com usuários × OABs e estoura essa
// cota rápido. O endpoint /api/v1/caderno/{tribunal}/{data}/{meio} devolve o
// dia inteiro de um tribunal em 1 requisição — o volume de requisições passa a
// depender só do número de tribunais, não do número de usuários.
//
// Plano Hobby (gratuito) da Vercel: cron só pode rodar 1x por dia por entrada,
// então o vercel.json tem algumas entradas diárias em horários diferentes e
// cada execução processa VÁRIOS itens da fila (até o limite de tempo), em vez
// de 1 item a cada 5 min (o "*/5" quebrava todos os deploys desde 31/07/2026).
//
// Fila em djen_cadernos_fila, uma linha por (tribunal, dia). Cada execução:
//   1. semeia os últimos 7 dias (data de Brasília) — dias que ficaram pra trás
//      (DJEN bloqueado, cron parado) continuam na lista até serem processados;
//   2. processa pendentes, do dia mais antigo pro mais novo; caderno ainda
//      não gerado ou que falhou volta pra fila;
//   3. reconfere cadernos de hoje/ontem já processados há 2h+: o DJEN publica
//      novas versões do mesmo dia (_v2, _v3...) com mais comunicações. Só baixa
//      de novo se versão/total mudaram. Reprocessar é idempotente (dedup).
//
// Escopo: tribunais da UF de cada OAB cadastrada (TJ + TRE + TRF + TRT) +
// nacionais (STJ, TST, TSE, CJF) + tribunais dos processos já cadastrados
// (advogado do DF com processo em GO também é coberto).
// Editais (meio=E) fora do escopo, só Diário Eletrônico (meio=D).

import { createClient } from '@supabase/supabase-js';
import unzipper from 'unzipper';
import { Readable } from 'node:stream';
import { logErro, _djenAtualizarProcesso, _djenSugerirProcesso, buscarOabsUsuarios,
         abrirExecucao, fecharExecucao, corrigirMojibake, tituloProcesso } from './sync-comum.js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET      = process.env.CRON_SECRET;
const CADERNO_API      = 'https://comunicaapi.pje.jus.br/api/v1/caderno';
const STALE_MS         = 15 * 60 * 1000;      // "processando" travado há mais que isso volta pra fila
const RECONFERIR_MS    = 2 * 3600 * 1000;     // cadernos concluídos há mais que isso são reconferidos
const ORCAMENTO_MS     = 85 * 1000;           // maxDuration do vercel.json é 120s
// A fila guarda os últimos 7 dias: se o DJEN bloquear ou o cron parar por
// alguns dias, os cadernos atrasados continuam na lista e são processados em
// ordem (mais antigo primeiro) assim que voltar — nenhum dia fica pra trás.
const DIAS_NA_FILA     = 7;
const MAX_TENTATIVAS   = 25;                  // ~8 dias com 3 execuções/dia

// Não existe caderno em sábado e domingo — o DJEN devolve 404. Conferido em
// 30/09/2026 para TJDFT, TJGO e STJ: 25/09 (sex) e 28/09 (seg) respondem 200,
// 26 e 27 (fim de semana) respondem 404. Sem este filtro a fila enchia de
// linhas impossíveis, cada uma tentada 25 vezes, gastando o tempo da execução
// que deveria ir para os dias úteis.
function ehDiaUtil(data) {
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

const NACIONAL = ['CJF', 'STJ', 'TST', 'TSE'];
const UF_TRIBUNAIS = {
  AC: ['TJAC', 'TRE-AC', 'TRF1', 'TRT14'],
  AL: ['TJAL', 'TRE-AL', 'TRF5', 'TRT19'],
  AM: ['TJAM', 'TRE-AM', 'TRF1', 'TRT11'],
  AP: ['TJAP', 'TRE-AP', 'TRF1', 'TRT8'],
  BA: ['TJBA', 'TRE-BA', 'TRF1', 'TRT5'],
  CE: ['TJCE', 'TRE-CE', 'TRF5', 'TRT7'],
  DF: ['TJDFT', 'TRE-DF', 'TRF1', 'TRT10'],
  ES: ['TJES', 'TRE-ES', 'TRF2', 'TRT17'],
  GO: ['TJGO', 'TRE-GO', 'TRF1', 'TRT18'],
  MA: ['TJMA', 'TRE-MA', 'TRF1', 'TRT16'],
  MG: ['TJMG', 'TJMMG', 'TRE-MG', 'TRF1', 'TRF6', 'TRT3'],
  RS: ['TJRS', 'TJMRS', 'TRE-RS', 'TRF4', 'TRT4'],
  MS: ['TJMS', 'TRE-MS', 'TRF3', 'TRT24'],
  SP: ['TJSP', 'TJMSP', 'TRE-SP', 'TRF3', 'TRT15', 'TRT2'],
  MT: ['TJMT', 'TRE-MT', 'TRF1', 'TRT23'],
  PA: ['TJPA', 'TRE-PA', 'TRF1', 'TRT8'],
  PB: ['TJPB', 'TRF5', 'TRT13'],
  PE: ['TJPE', 'TRE-PE', 'TRF5', 'TRT6'],
  PI: ['TJPI', 'TRE-PI', 'TRF1', 'TRT22'],
  PR: ['TJPR', 'TRE-PR', 'TRF4', 'TRT9'],
  RJ: ['TJRJ', 'TRE-RJ', 'TRF2', 'TRT1'],
  RN: ['TJRN', 'TRE-RN', 'TRF5', 'TRT21'],
  RO: ['TJRO', 'TRE-RO', 'TRF1', 'TRT14'],
  RR: ['TJRR', 'TRF1', 'TRT11'],
  SC: ['TJSC', 'TRE-SC', 'TRF4', 'TRT12'],
  SE: ['TJSE', 'TRE-SE', 'TRF5', 'TRT20'],
  TO: ['TJTO', 'TRE-TO', 'TRF1', 'TRT10'],
};
// Código de tribunal do número CNJ (J=8 e J=6) → UF
const UF_POR_CODIGO = ['', 'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SE','SP','TO'];

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  // Fecha por padrão: se a variável CRON_SECRET desaparecer da Vercel (num
  // deploy novo, um erro de digitação), antes isso liberava o cron para
  // qualquer pessoa da internet disparar. Agora falta de segredo em produção
  // é motivo para recusar, não para abrir. Fora da Vercel (localhost) segue
  // liberado, senão não dá para testar.
  if (process.env.VERCEL && !CRON_SECRET) {
    return res.status(503).json({ erro: 'CRON_SECRET não configurado no servidor.' });
  }
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ erro: 'Não autorizado.' });
  }
  if (!SUPA_SERVICE_KEY) {
    return res.status(500).json({ erro: 'SUPABASE_SERVICE_KEY não configurada.' });
  }

  const admin  = createClient(SUPA_URL, SUPA_SERVICE_KEY);
  const inicio = Date.now();
  const hoje   = dataBrasilia(0);
  const ontem  = dataBrasilia(-1);
  const datas  = Array.from({ length: DIAS_NA_FILA }, (_, i) => dataBrasilia(-i)); // hoje ... 6 dias atrás

  const execId = await abrirExecucao(admin, 'djen');

  try {
    const ctx = await montarContexto(admin);
    await semearFila(admin, datas, ctx);

    const tentados   = new Set();
    const resultados = [];
    while (Date.now() - inicio < ORCAMENTO_MS) {
      const item = await reivindicarProximo(admin, datas, ontem, tentados);
      if (!item) break;
      tentados.add(item.id);
      try {
        resultados.push(await processarTribunal(item, admin, ctx, hoje));
      } catch (e) {
        const bruto = String(e?.message || e || 'erro desconhecido');
        const msg = bruto.includes('(IP ') ? bruto : (await erroDjen(bruto)).message;
        const desistir = item.tentativas >= MAX_TENTATIVAS;
        await admin.from('djen_cadernos_fila')
          .update({ status: desistir ? 'erro' : 'pendente', erro_msg: msg })
          .eq('id', item.id);
        await logErro(admin, 'cron:djen-cadernos', `${item.tribunal} ${item.data}: ${msg}`, {});
        resultados.push({ tribunal: item.tribunal, data: item.data, erro: msg });
      }
    }

    const { count: filaRestante } = await admin.from('djen_cadernos_fila')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente').gte('data', datas.at(-1));

    await fecharExecucao(admin, execId, {
      inicioMs: inicio,
      fila: filaRestante ?? null,
      processados: resultados.length,
      resultados: {
        cadernos:    resultados.length,
        comErro:     resultados.filter(r => r.erro).length,
        publicacoes: resultados.reduce((s, r) => s + (r.comunicacoesEncontradas || 0), 0),
      },
    });

    // Formato compatível com o painel admin ("Processar próximo da fila")
    const primeiro = resultados[0];
    return res.status(200).json({
      ok: true,
      semPendencias: !resultados.length,
      ...(primeiro || {}),
      processados: resultados.length,
      resultados,
      elapsed: Math.round((Date.now() - inicio) / 1000) + 's',
    });
  } catch (e) {
    await logErro(admin, 'cron:djen-cadernos', e.message, {});
    await fecharExecucao(admin, execId, { inicioMs: inicio, erro: e.message });
    return res.status(500).json({ erro: e.message });
  }
}

// IP de saída desta função — a Vercel (Hobby) não tem IP fixo, e a API do
// DJEN bloqueia por IP/região. Vai junto na mensagem de erro pra dar pra ver
// no painel admin qual IP foi recusado e se mudou. Só é consultado quando
// alguma chamada ao DJEN falha; guardado por 5 min entre execuções.
let _ipCache = { ip: null, em: 0 };
async function ipDeSaida() {
  if (_ipCache.ip && Date.now() - _ipCache.em < 5 * 60 * 1000) return _ipCache.ip;
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    _ipCache = { ip: (await r.json()).ip || '?', em: Date.now() };
  } catch (_) {
    return '?';
  }
  return _ipCache.ip;
}

async function erroDjen(msg) {
  return new Error(`${msg} (IP ${await ipDeSaida()}, região ${process.env.VERCEL_REGION || '?'})`);
}

// Repete na hora falhas passageiras (5xx, 429, conexão caiu) com espera
// crescente. 403 não é repetido — é bloqueio, tentar de novo não resolve.
async function fetchComRetentativa(url, timeoutMs) {
  const esperas = [2000, 5000];
  for (let tentativa = 0; ; tentativa++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const passageiro = r.status >= 500 || r.status === 429;
      if (!passageiro || tentativa >= esperas.length) return r;
    } catch (e) {
      const passageiro = /fetch failed|ECONN|socket|network/i.test(e.message);
      if (!passageiro || tentativa >= esperas.length) throw e;
    }
    await new Promise(r => setTimeout(r, esperas[tentativa]));
  }
}

function dataBrasilia(deltaDias) {
  return new Date(Date.now() - 3 * 3600 * 1000 + deltaDias * 86400000).toISOString().slice(0, 10);
}

// ── CONTEXTO (carregado 1x por execução) ─────────────────────────────────────

async function montarContexto(admin) {
  const [oabsPorUsuario, processos] = await Promise.all([
    buscarOabsUsuarios(admin, await todosOsUserIds(admin)),
    admin.from('processos').select('id, user_id, numero, created_at')
      .not('numero', 'is', null).neq('status', 'Arquivado').then(r => r.data || []),
  ]);

  const usuariosPorOab = new Map(); // "UF12345" -> [uid, ...]
  for (const [uid, oabs] of Object.entries(oabsPorUsuario)) {
    for (const o of oabs) {
      const chave = `${o.uf}${o.num}`;
      if (!usuariosPorOab.has(chave)) usuariosPorOab.set(chave, []);
      if (!usuariosPorOab.get(chave).includes(uid)) usuariosPorOab.get(chave).push(uid);
    }
  }

  const procPorUsuarioNumero = new Map(); // "uid|numero" -> proc
  const numeroSetGlobal = new Set();
  // Data da primeira importação de cada advogado. Publicação anterior a isso
  // é de antes de ele usar o sistema — não vira sugestão.
  const marcoPorUsuario = new Map(); // uid -> "AAAA-MM-DD"
  for (const p of processos) {
    procPorUsuarioNumero.set(`${p.user_id}|${p.numero}`, p);
    numeroSetGlobal.add(p.numero);
    const dia = (p.created_at || '').slice(0, 10);
    if (dia && (!marcoPorUsuario.has(p.user_id) || dia < marcoPorUsuario.get(p.user_id))) {
      marcoPorUsuario.set(p.user_id, dia);
    }
  }

  return { oabsPorUsuario, processos, usuariosPorOab, procPorUsuarioNumero, numeroSetGlobal, marcoPorUsuario };
}

async function todosOsUserIds(admin) {
  const ids = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000, page });
    if (error) throw error;
    const users = data?.users || [];
    ids.push(...users.map(u => u.id));
    if (users.length < 1000) break;
    page++;
  }
  return ids;
}

// Sigla do tribunal no DJEN a partir do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO)
function siglaDjenDoNumero(numero) {
  const m = (numero || '').match(/\d{7}-\d{2}\.\d{4}\.(\d)\.(\d{2})\.\d{4}/);
  if (!m) return null;
  const j = m[1], tr = parseInt(m[2], 10);
  if (j === '8') { const uf = UF_POR_CODIGO[tr]; return uf ? (uf === 'DF' ? 'TJDFT' : `TJ${uf}`) : null; }
  if (j === '6') { const uf = UF_POR_CODIGO[tr]; return uf ? `TRE-${uf}` : null; }
  if (j === '5' && tr >= 1 && tr <= 24) return `TRT${tr}`;
  if (j === '4' && tr >= 1 && tr <= 6)  return `TRF${tr}`;
  if (j === '3') return 'STJ';
  return null;
}

// ── FILA ──────────────────────────────────────────────────────────────────────

async function semearFila(admin, datas, ctx) {
  const tribunais = new Set(NACIONAL);
  for (const oabs of Object.values(ctx.oabsPorUsuario)) {
    for (const o of oabs) for (const t of (UF_TRIBUNAIS[o.uf] || [])) tribunais.add(t);
  }
  for (const p of ctx.processos) {
    const sigla = siglaDjenDoNumero(p.numero);
    if (sigla) tribunais.add(sigla);
  }

  const linhas = datas.filter(ehDiaUtil).flatMap(data => [...tribunais].map(tribunal => ({ tribunal, data })));
  if (linhas.length) {
    await admin.from('djen_cadernos_fila').upsert(linhas, { onConflict: 'tribunal,data', ignoreDuplicates: true });
  }
}

// Ordem da fila, por prioridade:
//   1. pendentes de HOJE e ONTEM — é o que o advogado precisa saber agora
//      (prazo corre); backfill nunca pode atrasar o dia corrente;
//   2. reconferência de hoje/ontem (DJEN publica versões novas do mesmo dia);
//   3. pendentes de dias anteriores — recuperação de atraso, em ordem.
// Dias mais antigos não são reconferidos: o caderno já está fechado.
export async function reivindicarProximo(admin, datas, ontem, tentados) {
  const agora      = Date.now();
  const staleDesde = new Date(agora - STALE_MS).toISOString();
  const reconferir = new Date(agora - RECONFERIR_MS).toISOString();
  const recentes   = datas.filter(d => d >= ontem);
  const antigos    = datas.filter(d => d <  ontem);

  const buscar = async (dias, filtro) => {
    if (!dias.length) return null;
    let q = admin
      .from('djen_cadernos_fila')
      .select('id, tribunal, data, status, tentativas, erro_msg')
      .in('data', dias)
      .or(filtro)
      .order('data', { ascending: true })
      .order('criado_em', { ascending: true })
      .limit(1);
    if (tentados.size) q = q.not('id', 'in', `(${[...tentados].join(',')})`);
    const { data } = await q;
    return data?.[0] || null;
  };

  const pendente = `status.eq.pendente,and(status.eq.processando,iniciado_em.lte.${staleDesde})`;
  const candidato =
       await buscar(recentes, pendente)
    || await buscar(recentes, `and(status.eq.concluido,concluido_em.lte.${reconferir})`)
    || await buscar(antigos,  pendente);
  if (!candidato) return null;

  const { data: reivindicado } = await admin
    .from('djen_cadernos_fila')
    .update({ status: 'processando', iniciado_em: new Date().toISOString(), tentativas: candidato.tentativas + 1 })
    .eq('id', candidato.id)
    .eq('status', candidato.status)
    .select()
    .maybeSingle();

  if (!reivindicado) { tentados.add(candidato.id); return reivindicarProximo(admin, datas, ontem, tentados); }
  return { ...reivindicado, statusAnterior: candidato.status, marcaAnterior: candidato.erro_msg };
}

// ── PROCESSAMENTO DE 1 TRIBUNAL ────────────────────────────────────────────────

export async function processarTribunal(item, admin, ctx, hoje) {
  const { tribunal, data } = item;

  const metaRes = await fetchComRetentativa(`${CADERNO_API}/${tribunal}/${data}/D`, 20000);

  // 404 não é falha: é o DJEN dizendo que não há caderno desse tribunal nesse
  // dia — feriado, ou tribunal que simplesmente não publicou. Só faz sentido
  // insistir em hoje/ontem, quando o caderno ainda pode sair. Em dia mais
  // antigo o caderno não vem mais, e repetir 25 vezes só queima o orçamento
  // da execução e enche o log de erro que não é erro.
  if (metaRes.status === 404) {
    const aindaPodeSair = data >= dataBrasilia(-1);
    await admin.from('djen_cadernos_fila').update({
      status:  aindaPodeSair ? 'pendente' : 'concluido',
      erro_msg: aindaPodeSair ? 'aguardando publicação do caderno' : 'sem caderno publicado nesse dia',
      ...(aindaPodeSair ? {} : { concluido_em: new Date().toISOString() }),
    }).eq('id', item.id);
    return { tribunal, data, pulado: true, motivo: aindaPodeSair ? 'caderno ainda não publicado' : 'sem caderno nesse dia' };
  }

  if (!metaRes.ok) throw await erroDjen(`Metadados do caderno ${tribunal} responderam ${metaRes.status}`);
  const meta = await metaRes.json();

  // "Sem comunicações" e "Cancelado" são estados finais — nunca vão virar "Processado".
  const ESTADOS_FINAIS_SEM_DADOS = ['Sem comunicações', 'Cancelado'];
  if (ESTADOS_FINAIS_SEM_DADOS.includes(meta.status)) {
    await admin.from('djen_cadernos_fila')
      .update({ status: 'concluido', concluido_em: new Date().toISOString(), comunicacoes_encontradas: item.comunicacoes_encontradas ?? 0, erro_msg: `status API: ${meta.status}` })
      .eq('id', item.id);
    return { tribunal, data, pulado: true, motivo: meta.status };
  }
  if (meta.status !== 'Processado') {
    // Transitório (ainda gerando o caderno). Volta pra fila; a próxima execução
    // do dia tenta de novo. Um item já concluído antes continua concluído.
    const desistir = item.tentativas >= MAX_TENTATIVAS;
    const status   = item.statusAnterior === 'concluido' ? 'concluido' : (desistir ? 'erro' : 'pendente');
    await admin.from('djen_cadernos_fila')
      .update({ status, erro_msg: status === 'concluido' ? item.marcaAnterior : `status API: ${meta.status}`, ...(status === 'concluido' ? { concluido_em: new Date().toISOString() } : {}) })
      .eq('id', item.id);
    return { tribunal, data, pulado: true, motivo: meta.status, desistiu: status === 'erro' };
  }

  // Marca da versão processada — guardada em erro_msg (sem mudar o schema).
  const marca = `v${meta.versao ?? '?'} · ${meta.total_comunicacoes ?? '?'} comunicações`;
  if (item.statusAnterior === 'concluido' && item.marcaAnterior === marca) {
    await admin.from('djen_cadernos_fila')
      .update({ status: 'concluido', concluido_em: new Date().toISOString() })
      .eq('id', item.id);
    return { tribunal, data, pulado: true, motivo: 'caderno sem alteração' };
  }

  if (!meta.url) throw new Error('Metadados do caderno sem URL de download.');
  const zipRes = await fetchComRetentativa(meta.url, 60000);
  if (!zipRes.ok || !zipRes.body) throw await erroDjen(`Download do caderno ${tribunal} respondeu ${zipRes.status}`);

  const PADRAO = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
  let comunicacoesEncontradas = 0;

  // Importante: o evento 'finish' do stream dispara quando o ZIP terminou de ser
  // LIDO, não quando nossas gravações no banco terminaram — cada página é
  // processada de forma assíncrona (JSON.parse + updates no Supabase), então é
  // preciso coletar as promises e esperar todas antes de contar o resultado como
  // pronto. Sem isso, a function podia devolver resposta e ser encerrada pela
  // Vercel com gravações ainda pendentes, perdendo dado de verdade em produção.
  // As páginas são processadas uma de cada vez (encadeadas) pra duas páginas
  // não gravarem no mesmo processo ao mesmo tempo e uma sobrescrever a outra.
  let fila = Promise.resolve();
  await new Promise((resolve, reject) => {
    // Erro no download não passa pelo pipe — sem este handler derrubaria a função
    const origem = Readable.fromWeb(zipRes.body).on('error', reject);
    origem.pipe(unzipper.Parse())
      .on('entry', entry => {
        if (!entry.path.endsWith('.json')) { entry.autodrain(); return; }
        const conteudo = lerEntrada(entry);
        // Evita "unhandled rejection" (derruba a função na Vercel) se a leitura
        // falhar antes da fila chegar nela — o erro continua subindo pela fila.
        conteudo.catch(() => {});
        fila = fila.then(() => conteudo).then(buf => processarPagina(buf, {
          // tribunal vai no contexto porque processarPagina não recebe o item
          // da fila — usar item.tribunal aqui dentro quebrava com
          // "item is not defined" e derrubava o caderno inteiro.
          ...ctx, PADRAO, admin, hoje, tribunal: item.tribunal,
          onMatch: () => { comunicacoesEncontradas++; },
        }));
        fila.catch(() => {}); // o erro é tratado no "await fila" abaixo
      })
      .on('finish', resolve)
      .on('error', reject);
  });
  await fila;

  // tentativas volta a 0: o contador serve pra desistir de caderno que nunca
  // fica pronto, não pra contar as reconferências de quem já deu certo.
  await admin.from('djen_cadernos_fila').update({
    status: 'concluido', concluido_em: new Date().toISOString(), tentativas: 0,
    comunicacoes_encontradas: comunicacoesEncontradas, erro_msg: marca,
  }).eq('id', item.id);

  return { tribunal, data, comunicacoesEncontradas, totalComunicacoesNoCaderno: meta.total_comunicacoes };
}

async function lerEntrada(entry) {
  const chunks = [];
  for await (const chunk of entry) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function normalizarNumOab(num) {
  return String(num || '').trim().replace(/^0+/, '');
}

// O caderno traz "numero_processo" só com dígitos; a API de busca traz
// "numeroprocessocommascara". Os processos no banco ficam com máscara.
function numeroComMascara(publicacao) {
  if (publicacao.numeroprocessocommascara) return publicacao.numeroprocessocommascara;
  const s = String(publicacao.numero_processo || '').replace(/\D/g, '');
  if (s.length !== 20) return null;
  return `${s.slice(0,7)}-${s.slice(7,9)}.${s.slice(9,13)}.${s.slice(13,14)}.${s.slice(14,16)}.${s.slice(16)}`;
}

async function processarPagina(buf, ctx) {
  let json;
  try {
    json = JSON.parse(buf.toString('utf-8'));
  } catch (_) {
    return; // arquivo corrompido/parcial — ignora essa página, não derruba o resto
  }

  const { usuariosPorOab, procPorUsuarioNumero, numeroSetGlobal, PADRAO, admin, hoje, onMatch } = ctx;

  for (const publicacao of json.items || []) {
    if (publicacao.ativo === false || publicacao.data_cancelamento) continue;
    const uidsAlvo = new Set();
    for (const da of publicacao.destinatarioadvogados || []) {
      const adv = da.advogado;
      if (!adv) continue;
      const chave = `${String(adv.uf_oab || '').toUpperCase()}${normalizarNumOab(adv.numero_oab)}`;
      for (const uid of usuariosPorOab.get(chave) || []) uidsAlvo.add(uid);
    }
    if (!uidsAlvo.size) continue;

    const dataPub = publicacao.data_disponibilizacao || hoje;
    const movDJEN = {
      nome:   `DJEN — ${publicacao.tipoComunicacao || 'Publicação'}${publicacao.tipoDocumento ? ' · ' + publicacao.tipoDocumento : ''}`,
      data:   `${dataPub}T00:00:00`,
      _fonte: 'djen',
      _url:   publicacao.link || null,
    };
    const numPrincipal = numeroComMascara(publicacao);
    const numsTexto = [...new Set((publicacao.texto || '').match(PADRAO) || [])]
      .filter(n => n !== numPrincipal && numeroSetGlobal.has(n));

    // Mesmos campos que o buscador DJEN do navegador já usa (dashboard.js) —
    // dá pra identificar de quem é o processo (cliente, classe, tribunal) na
    // tela de sugestões, sem gastar outra chamada ao DataJud.
    const parteAtiva   = publicacao.destinatarios?.find(d => ['A','AT','ATIVO'].includes((d.polo || '').toUpperCase()));
    const partePassiva = publicacao.destinatarios?.find(d => ['P','R','PA','RE','PASSIVO'].includes((d.polo || '').toUpperCase()));
    const extraSugestao = {
      classe:        publicacao.nomeClasse ? tituloProcesso(publicacao.nomeClasse) : null,
      orgaoJulgador: publicacao.nomeOrgao  ? corrigirMojibake(publicacao.nomeOrgao) : null,
      partes: [
        parteAtiva   ? { nome: corrigirMojibake(parteAtiva.nome),   tipo: 'Autor' } : null,
        partePassiva ? { nome: corrigirMojibake(partePassiva.nome), tipo: 'Réu'   } : null,
      ].filter(Boolean),
    };

    for (const uid of uidsAlvo) {
      // Falha em um processo não pode derrubar o caderno inteiro
      try {
      let atualizouAlgo = false;

      if (numPrincipal) {
        const proc = procPorUsuarioNumero.get(`${uid}|${numPrincipal}`);
        if (!proc) {
          // Não cadastra sozinho: sugere, e o advogado decide se quer o
          // processo atrelado ao perfil dele.
          atualizouAlgo = await _djenSugerirProcesso(
            numPrincipal, uid, movDJEN, admin, ctx.marcoPorUsuario.get(uid), ctx.tribunal, extraSugestao);
          // Evita sugerir de novo se o mesmo processo aparecer em outra publicação
          if (atualizouAlgo) procPorUsuarioNumero.set(`${uid}|${numPrincipal}`, { id: null, created_at: new Date().toISOString() });
        } else if (proc.id && (proc.created_at || '').slice(0, 10) !== hoje) {
          atualizouAlgo = await _djenAtualizarProcesso(proc.id, movDJEN, admin);
        }
      }

      for (const num of numsTexto) {
        const proc = procPorUsuarioNumero.get(`${uid}|${num}`);
        if (!proc?.id || (proc.created_at || '').slice(0, 10) === hoje) continue;
        const ok = await _djenAtualizarProcesso(proc.id, movDJEN, admin);
        atualizouAlgo = atualizouAlgo || ok;
      }

      if (atualizouAlgo) onMatch();
      } catch (e) {
        await logErro(admin, 'cron:djen-cadernos', e.message, { numero: numPrincipal }, uid);
      }
    }
  }
}
