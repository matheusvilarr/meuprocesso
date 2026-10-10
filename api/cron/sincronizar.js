// Sincronização de processos, DJEN e OAB scan.
// ?tipo=datajud (padrão) — atualiza movimentos de todos os processos no DataJud
// ?tipo=djen    — processa os cadernos do DJEN (lógica em lib/djen-cadernos.js)
// ?tipo=oab     — varre todos os tribunais pela OAB do advogado buscando processos novos
//                 (fora do vercel.json: a API pública do DataJud não expõe "partes",
//                 então a busca por OAB nunca retorna nada — testado set/2026)
// ?tipo=onboarding — chamado pelo próprio dashboard (token do usuário, não o
//                 CRON_SECRET) no primeiro login com OAB e 0 processos: manda
//                 e-mail de boas-vindas + busca no DJEN (esse sim funciona
//                 por OAB) + e-mail avisando o que foi encontrado.
//
// O DJEN é servido por esta função porque o plano Hobby da Vercel aceita no
// máximo 12 funções em api/ — a 13ª (api/cron/djen-cadernos.js) fez todos os
// deploys falharem de 31/07 a 29/09/2026.
//
// DataJud: filtro de 20h (browser cobre usuários ativos). Time guard 60s.

import { createClient } from '@supabase/supabase-js';
import djenCadernos from '../../lib/djen-cadernos.js';
import {
  parsarData, decodificarBuffer, logErro, chaveMov, movimentosDosHits,
  ehMovDJEN, datajudIndexFromNumero, buscarOabsUsuarios, corrigirMojibake,
  normalizarNumeroCNJ, tituloProcesso, limparLogsAntigos,
  abrirExecucao, fecharExecucao, enviarEmail, cabecalho, rodape, btnDashboard,
  inferirTratamento,
} from '../../lib/sync-comum.js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Chave pública (anon/publishable) — mesma usada em api/processos-descobertos.js.
// Só serve pra validar o token do próprio usuário logado, nunca acessa dado
// de outra conta.
const SUPA_ANON_KEY    = 'sb_publishable_i2UzINt5Xv1QthMl1M0Tgw_iNkiO0K1';
const DATAJUD_KEY      = process.env.DATAJUD_API_KEY
  || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const CRON_SECRET      = process.env.CRON_SECRET;
// Segredo próprio do worker local da fila STJ — CRON_SECRET é gerenciado
// pelo "Rotate" nativo de Cron Jobs da Vercel (não aceita valor manual),
// então o worker (chamada manual, fora da Vercel) usa este aqui, que a
// gente controla direto por Edit comum no painel.
const STJ_FILA_SECRET  = process.env.STJ_FILA_SECRET;

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
  const tipo = req.query?.tipo || 'datajud';

  // ?tipo=onboarding não usa o CRON_SECRET — é chamado pelo próprio navegador
  // do usuário, então o segredo do cron não pode viajar pro client. Se
  // mandasse o CRON_SECRET pro browser pra autorizar essa chamada, qualquer
  // um veria o segredo no código-fonte da página.
  if (tipo === 'onboarding') return rodarOnboarding(req, res);

  // Fecha por padrão: se a variável CRON_SECRET desaparecer da Vercel (num
  // deploy novo, um erro de digitação), antes isso liberava o cron para
  // qualquer pessoa da internet disparar. Agora falta de segredo em produção
  // é motivo para recusar, não para abrir. Fora da Vercel (localhost) segue
  // liberado, senão não dá para testar.
  if (process.env.VERCEL && !CRON_SECRET) {
    return res.status(503).json({ erro: 'CRON_SECRET não configurado no servidor.' });
  }
  const autorizado = (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`)
    || (STJ_FILA_SECRET && authHeader === `Bearer ${STJ_FILA_SECRET}`);
  if (CRON_SECRET && !autorizado) {
    return res.status(401).json({ erro: 'Não autorizado.' });
  }
  if (!SUPA_SERVICE_KEY) {
    return res.status(500).json({ erro: 'SUPABASE_SERVICE_KEY não configurada.' });
  }

  if (tipo === 'djen') return djenCadernos(req, res);

  const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
  const hoje  = new Date().toISOString().slice(0, 10);

  if (tipo === 'oab')          return rodarOabScan(admin, res, hoje);
  if (tipo === 'fila_stj')     return rodarFilaStj(admin, res);
  if (tipo === 'email-pessoal') return rodarEmailPessoal(req, res);
  return rodarDatajud(admin, res, hoje);
}

// Envio administrativo pontual — útil pra e-mails pessoais/um-a-um que não
// fazem sentido virar um fluxo automático permanente (ex: contato direto do
// Matheus com os primeiros usuários). Autenticado pelo mesmo segredo de
// admin já usado pra ?tipo=onboarding com user_id; o conteúdo vem inteiro no
// corpo da requisição — nada de texto pessoal fica fixado no código.
async function rodarEmailPessoal(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  const destinatarios = req.body?.destinatarios;
  if (!Array.isArray(destinatarios) || !destinatarios.length) {
    return res.status(400).json({ erro: 'destinatarios (array de {to, assunto, html}) é obrigatório.' });
  }
  const resultados = [];
  for (const d of destinatarios) {
    if (!d?.to || !d?.assunto || !d?.html) { resultados.push({ to: d?.to, ok: false, erro: 'to/assunto/html faltando' }); continue; }
    try {
      await enviarEmail(d.to, d.assunto, d.html);
      resultados.push({ to: d.to, ok: true });
    } catch (e) {
      resultados.push({ to: d.to, ok: false, erro: String(e.message || e).slice(0, 200) });
    }
  }
  return res.status(200).json({ ok: true, resultados });
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
    const idx = datajudIndexFromNumero(p.numero);
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
  const execId  = await abrirExecucao(admin, 'datajud');

  // Backfill: preenche datajud_index para processos que têm numero mas não têm index
  const reparados = await repararDatajudIndex(admin);

  // Descarta log com mais de 30 dias — sem isso a tabela cresce pra sempre
  await limparLogsAntigos(admin);

  // Fila: todo processo cuja última consulta BEM-SUCEDIDA tem 20h+ (ou nunca
  // teve) entra, e a ordem é pela última TENTATIVA — quem nunca foi tentado
  // primeiro, quem falhou vai pro fim e é tentado de novo na próxima volta.
  // Assim a fila sempre anda e todos os processos são consultados, sem que um
  // processo que falha sempre trave os outros ou tenha a data falseada.
  const limite20h = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  // Só processos com datajud_index: os sem índice (ex: cadastro manual sem
  // número CNJ) não têm como ser consultados no DataJud.
  const { data: processos, error } = await admin
    .from('processos')
    .select('id, user_id, numero, nome, apelido, datajud_index, movimentos_hash, movimentos_recentes, notificacao_pendente, novos_movimentos, sync_falhas, created_at')
    .not('numero', 'is', null)
    .not('datajud_index', 'is', null)
    .neq('status', 'Arquivado')
    .or(`ultima_verificacao.is.null,ultima_verificacao.lte.${limite20h}`)
    .order('sync_ultima_tentativa', { ascending: true, nullsFirst: true })
    .limit(400);

  if (error) {
    await fecharExecucao(admin, execId, { inicioMs: startAt, erro: error.message });
    return res.status(500).json({ erro: error.message });
  }

  const r = await sincronizarDatajud(processos, admin, hoje, startAt);

  // Fila total = quantos processos estariam elegíveis, não só os 400 que
  // couberam nesta execução. É esse número que diz se a fila dá a volta.
  const { count: filaTotal } = await admin.from('processos')
    .select('id', { count: 'exact', head: true })
    .not('numero', 'is', null).not('datajud_index', 'is', null).neq('status', 'Arquivado')
    .or(`ultima_verificacao.is.null,ultima_verificacao.lte.${limite20h}`);

  await fecharExecucao(admin, execId, {
    inicioMs: startAt,
    fila: filaTotal ?? null,
    processados: r.tentados,
    resultados: { novos: r.novos, verificados: r.verificados, falhas: r.falhas, reparados },
  });

  // Dispara email imediato se houve movimentos novos — não bloqueia o response em caso de erro
  if (r.novos > 0) {
    try {
      await fetch('https://meuprocesso.app.br/api/cron/verificar-atualizacoes?tipo=instant', {
        headers: { 'Authorization': `Bearer ${CRON_SECRET || ''}` },
        signal: AbortSignal.timeout(12000),
      });
    } catch (_) {}
  }

  return res.status(200).json({
    ok: true, tipo: 'datajud', hoje,
    reparados,
    processosNaFila: processos?.length || 0,
    filaRestante: filaTotal ?? null,
    datajud: r.novos,
    tentados: r.tentados, verificados: r.verificados, falhas: r.falhas,
    emailInstant: r.novos > 0,
    elapsed: Math.round((Date.now() - startAt) / 1000) + 's',
  });
}

// Medido em 30/09 e 05/10/2026 contra a API pública: o DataJud enfileira em
// vez de recusar, mediana de resposta ~35s, e o próprio CNJ tem um limite
// interno e desiste sozinho aos 60s (HTTP 504). Esperar além disso é tempo
// jogado fora; por isso a espera por requisição é 58s — entre o que ele
// costuma levar e o ponto em que ele mesmo desiste.
// (Até 09/10/2026 havia também uma concorrência de 40 consultas simultâneas,
// uma por processo — descontinuada quando o sync passou a agrupar por
// tribunal via query "terms"; ver LOTE_DATAJUD_CONCORRENCIA mais abaixo.)
const JANELA_INICIAR_MS    = 55000;  // até quando novas consultas são iniciadas
const ESPERA_DATAJUD_MS    = 58000;  // quanto esperamos cada resposta
// 55s iniciando + 58s da última resposta + gravação = ~115s, dentro do
// maxDuration de 120s do vercel.json — a margem é pequena, não dá pra subir mais.

// Pool contínuo: assim que uma consulta termina, a próxima começa. Antes era
// em lotes, e o lote inteiro ficava parado esperando a consulta mais lenta.
export async function comPool(itens, limite, prazoParaIniciar, tarefa) {
  const resultados = [];
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length && Date.now() < prazoParaIniciar) {
      const item = itens[proximo++];
      try { resultados.push(await tarefa(item)); }
      catch { resultados.push('erro'); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

// Testado em 09-10/10/2026 contra a API pública: uma query "terms" com vários
// números de uma vez devolve os mesmos resultados que N queries "match"
// individuais (conferido processo a processo), e uma única requisição com 194
// números levou 35s — no mesmo patamar de UMA consulta individual (17-39s).
// Ou seja, o tempo do DataJud é dominado por um custo fixo por requisição, não
// pelo tamanho do lote. Isso troca "1 requisição por processo" (até 400 por
// execução) por "1 requisição por tribunal com pendência" (na prática, 14-90).
//
// Tamanho do lote: Elasticsearch recusa size > 10000 sem paginação; 300 por
// lote com margem de *4 no "size" (um processo pode ter mais de 1 documento —
// G1, G2, JE) fica bem abaixo disso e mantém a resposta num tamanho razoável
// (~5MB, extrapolado da medição real de 194 processos = 3,36MB).
const LOTE_DATAJUD_TAMANHO        = 300;
const LOTE_DATAJUD_CONCORRENCIA   = 15;
// Espaça o disparo de cada lote — medido em 09/10: 40 requisições simultâneas
// no mesmo instante geram um pico de ~240/min (2x o limite de 120/min dos
// Termos de Uso do CNJ) e foi exatamente aí que vieram os 429 do teste. Com
// poucas dezenas de lotes (não centenas de processos) isso já é bem mais raro,
// mas o espaçamento custa pouco e elimina o risco de vez.
const LOTE_DATAJUD_ESPACAMENTO_MS = 250;

function dividirEmLotes(itens, tamanho) {
  const lotes = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

async function buscarLoteDatajud(index, numeros) {
  const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
    method: 'POST',
    headers: { 'Authorization': `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(ESPERA_DATAJUD_MS),
    body: JSON.stringify({ size: numeros.length * 4, query: { terms: { numeroProcesso: numeros } } }),
  });
  if (!r.ok) throw new Error(`DataJud respondeu ${r.status} (${index})`);
  const json = JSON.parse(decodificarBuffer(await r.arrayBuffer()));
  return json.hits?.hits || [];
}

async function sincronizarDatajud(processos, admin, hoje, startAt = Date.now()) {
  const com_datajud = processos.filter(p => p.datajud_index);

  // Agrupa por tribunal e quebra em lotes — 1 requisição por lote, não por processo.
  const porTribunal = new Map();
  for (const p of com_datajud) {
    const numeroLimpo = p.numero.replace(/[.\-/ ]/g, '');
    if (!porTribunal.has(p.datajud_index)) porTribunal.set(p.datajud_index, new Set());
    porTribunal.get(p.datajud_index).add(numeroLimpo);
  }
  const lotesParaBuscar = [];
  for (const [index, numerosSet] of porTribunal) {
    for (const lote of dividirEmLotes([...numerosSet], LOTE_DATAJUD_TAMANHO)) {
      lotesParaBuscar.push({ index, numeros: lote });
    }
  }

  // Reserva de vez — garante o espaçamento mesmo com várias buscas de lote em
  // paralelo (comPool roda LOTE_DATAJUD_CONCORRENCIA trabalhadores ao mesmo
  // tempo). Mutação síncrona, sem await no meio, então é segura mesmo com
  // concorrência real do event loop.
  let proximoDisparo = 0;
  function reservarVez() {
    const agora  = Date.now();
    const inicio = Math.max(agora, proximoDisparo);
    proximoDisparo = inicio + LOTE_DATAJUD_ESPACAMENTO_MS;
    return inicio - agora;
  }

  // numeroLimpo -> hits[] (achou) | [] (não achou) | Error (lote falhou —
  // cada processo do lote recebe o mesmo erro, cai no caminho de "erro" de
  // sempre: fim da fila, tenta de novo na próxima execução).
  const mapaResultados = new Map();
  await comPool(lotesParaBuscar, LOTE_DATAJUD_CONCORRENCIA, startAt + JANELA_INICIAR_MS, async (lote) => {
    const esperar = reservarVez();
    if (esperar > 0) await new Promise(r => setTimeout(r, esperar));
    try {
      const hits = await buscarLoteDatajud(lote.index, lote.numeros);
      const porNumero = new Map();
      for (const h of hits) {
        const num = h._source?.numeroProcesso;
        if (!num) continue;
        if (!porNumero.has(num)) porNumero.set(num, []);
        porNumero.get(num).push(h);
      }
      for (const n of lote.numeros) mapaResultados.set(n, porNumero.get(n) || []);
    } catch (e) {
      for (const n of lote.numeros) mapaResultados.set(n, e);
    }
  });

  // Aplica o resultado já buscado, processo por processo — mesma lógica de
  // sempre (hash, mesclar movimentos, gravar, classificar erro). Não depende
  // mais de rede aqui, então a concorrência é só sobre I/O do Supabase.
  const resultados = await comPool(com_datajud, 20, startAt + JANELA_INICIAR_MS + ESPERA_DATAJUD_MS, async (proc) => {
    const numeroLimpo = proc.numero.replace(/[.\-/ ]/g, '');
    const resultado = mapaResultados.has(numeroLimpo) ? mapaResultados.get(numeroLimpo) : [];
    return aplicarResultadoDatajud(proc, resultado, admin, hoje);
  });

  return {
    novos:      resultados.filter(r => r === 'novos').length,
    verificados: resultados.filter(r => r === 'novos' || r === 'atualizado' || r === 'sem-mudanca' || r === 'nao-encontrado').length,
    falhas:     resultados.filter(r => r === 'erro').length,
    tentados:   resultados.length,
  };
}

// proc precisa de: id, user_id, numero, nome, datajud_index, movimentos_hash,
// movimentos_recentes, notificacao_pendente, novos_movimentos, created_at.
// Campos gravados em toda consulta que deu certo: marca como verificado e
// zera o contador de falhas da fila.
function sucessoFila() {
  const agora = new Date().toISOString();
  return { ultima_verificacao: agora, sync_ultima_tentativa: agora, sync_falhas: 0, sync_ultimo_erro: null };
}

// Processo auto-descoberto (DJEN) nasce com nome = número, pra ser completado
// com os dados do DataJud assim que possível. Fica em função própria porque
// precisa rodar em DOIS lugares: quando a movimentação muda E quando não muda.
// Antes só rodava no primeiro caso — um processo sem movimentação nova (ex:
// aguardando despacho há meses) caía sempre no atalho "sem-mudanca" e nunca
// chegava a essa parte do código, ficando com nome=número PARA SEMPRE, mesmo
// depois de centenas de tentativas do cron. Achado investigando por que o
// botão "Sincronizar" do detalhe não atualizava classe/tribunal.
function enriquecerSeDescoberto(proc, hits) {
  if (!(proc.nome && proc.nome === proc.numero)) return {};
  const src = hits[0]._source || {};
  const upd = {};
  if (src.classe?.nome) {
    const classe = tituloProcesso(src.classe.nome);
    upd.nome = classe;
    upd.classe = classe;
  }
  if (src.orgaoJulgador?.nome) upd.orgao_julgador = corrigirMojibake(src.orgaoJulgador.nome);
  if (src.tribunal)            upd.tribunal = corrigirMojibake(src.tribunal);
  return upd;
}

// Usado só pelo botão "DataJud agora" do painel admin (1 processo, sob
// demanda) — busca e aplica. O cron em lote chama aplicarResultadoDatajud()
// direto, já com os hits buscados em lote (ver sincronizarDatajud acima).
export async function sincronizarDatajudUm(proc, admin, hoje) {
  if ((proc.created_at || '').slice(0, 10) === hoje) return 'pulado';
  let hits;
  try {
    hits = await buscarComRetentativa(proc.datajud_index, proc.numero);
  } catch (e) {
    return aplicarResultadoDatajud(proc, e, admin, hoje);
  }
  return aplicarResultadoDatajud(proc, hits, admin, hoje);
}

// hitsOuErro: array de hits do DataJud (pode ser vazio = não achou), ou um
// Error (a busca em lote falhou pra esse processo — mesmo tratamento de
// sempre: classifica, loga, vai pro fim da fila). Retorna 'novos' |
// 'atualizado' | 'sem-mudanca' | 'nao-encontrado' | 'pulado' | 'erro'.
async function aplicarResultadoDatajud(proc, hitsOuErro, admin, hoje) {
  if ((proc.created_at || '').slice(0, 10) === hoje) return 'pulado';
  try {
    if (hitsOuErro instanceof Error) throw hitsOuErro;
    const hits = hitsOuErro;
    if (!hits?.length) {
      await admin.from('processos').update(sucessoFila()).eq('id', proc.id);
      return 'nao-encontrado';
    }

    const todosMovs = movimentosDosHits(hits);
    const novoHash  = todosMovs.slice(0, 6).map(m => m.data + m.nome).join('|');

    if (novoHash === proc.movimentos_hash) {
      await admin.from('processos')
        .update({ ...sucessoFila(), ...enriquecerSeDescoberto(proc, hits) })
        .eq('id', proc.id);
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
      ...sucessoFila(),
      ...enriquecerSeDescoberto(proc, hits),
    };
    if (novosRecentes.length) {
      // Mantém novidades ainda não notificadas (ex: publicação DJEN pendente de e-mail)
      const pendentes = proc.notificacao_pendente ? (proc.novos_movimentos || []) : [];
      const chaves    = new Set(novosRecentes.map(chaveMov));
      update.notificacao_pendente = true;
      update.email_pendente       = true;
      update.novos_movimentos     = [...novosRecentes, ...pendentes.filter(m => !chaves.has(chaveMov(m)))];
    }
    const { error: upErr } = await admin.from('processos').update(update).eq('id', proc.id);
    if (upErr) throw new Error(`Falha ao gravar: ${upErr.message}`);
    return novosRecentes.length ? 'novos' : 'atualizado';
  } catch (e) {
    const c = classificarErroDatajud(e);
    const falhas = (proc.sync_falhas || 0) + 1;
    // Mensagem no formato "[tipo] texto (detalhe técnico)" — o painel admin
    // agrupa pelo tipo e separa culpa do CNJ de falha nossa.
    await logErro(admin, c.origem === 'sistema' ? 'cron:datajud-sistema' : 'cron:datajud',
      `[${c.tipo}] ${c.texto} — ${String(e.message || '').slice(0, 150)}`,
      { numero: proc.numero, processoId: proc.id, tipo: c.tipo, origem: c.origem, falhasSeguidas: falhas }, proc.user_id);
    // ultima_verificacao NÃO muda (continua sendo a última consulta que deu
    // certo). Só registra a tentativa: o processo vai pro fim da fila e é
    // tentado de novo na próxima volta, sem travar os outros.
    await admin.from('processos').update({
      sync_ultima_tentativa: new Date().toISOString(),
      sync_falhas:           falhas,
      sync_ultimo_erro:      `[${c.tipo}] ${c.texto}`.slice(0, 300),
    }).eq('id', proc.id).then(() => {}, () => {});
    return 'erro';
  }
}

// Classifica a falha em linguagem simples e diz de quem é a responsabilidade:
// 'cnj' = problema do lado do DataJud (fora do nosso controle, a fila tenta
// de novo); 'sistema' = problema nosso (nunca deveria acontecer — vira alerta
// crítico no painel admin).
export function classificarErroDatajud(e) {
  const m = String(e?.message || e || '');
  // Nossa consulta expirou antes de o CNJ responder. Continua marcado como
  // 'sistema' de propósito: o limite é nosso e é o que dá para mexer. Mas a
  // medição de 05/10 mostrou que o CNJ leva 35s na mediana e desiste sozinho
  // em 60s — então passar disso raramente é bug nosso, é o CNJ no limite.
  // Dizer o número medido evita tanto nos culpar à toa quanto nos isentar.
  if (/aborted|timeout/i.test(m))           return { tipo: 'espera-curta',  origem: 'sistema', texto: `Sem resposta do DataJud em ${Math.round(ESPERA_DATAJUD_MS / 1000)}s (ele responde em ~35s e corta sozinho em 60s)` };
  if (/respondeu 429/.test(m))              return { tipo: 'cnj-saturado',  origem: 'cnj',     texto: 'Servidor do CNJ sem capacidade no momento (429 — fila interna cheia)' };
  if (/respondeu 5\d\d/.test(m))            return { tipo: 'cnj-fora',      origem: 'cnj',     texto: `DataJud com erro interno (${m.match(/respondeu (\d+)/)[1]})` };
  if (/respondeu 40[13]/.test(m))           return { tipo: 'cnj-bloqueio',  origem: 'cnj',     texto: 'DataJud recusou o acesso (chave pública trocada ou bloqueio de IP)' };
  if (/respondeu 404/.test(m))              return { tipo: 'indice',        origem: 'sistema', texto: 'Tribunal (índice DataJud) inexistente para este número — número do processo pode estar errado' };
  if (/fetch failed|ECONN|ENOTFOUND|socket/i.test(m)) return { tipo: 'rede', origem: 'cnj',  texto: 'Falha de conexão com o DataJud' };
  if (/Falha ao gravar/.test(m))            return { tipo: 'banco',         origem: 'sistema', texto: 'Erro ao gravar no banco de dados' };
  return { tipo: 'desconhecido', origem: 'sistema', texto: m.slice(0, 200) || 'Erro desconhecido' };
}

// Tenta de novo na hora as falhas rápidas e passageiras (5xx, 429, conexão),
// com espera crescente. Timeout não é repetido aqui: já custou 28s e, se o CNJ
// está lento, o processo volta na próxima execução da fila.
// TETO_RETENTATIVA_MS garante que essas repetições nunca estourem o
// maxDuration da function — se já gastou esse tempo, desiste e deixa a fila
// tentar na próxima execução.
const TETO_RETENTATIVA_MS = 15000;

async function buscarComRetentativa(index, numero) {
  const esperas = [2000, 6000];
  const inicio  = Date.now();
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await buscarNoDatajud(index, numero);
    } catch (e) {
      const { tipo } = classificarErroDatajud(e);
      // 429 fora da lista de propósito: é fila interna cheia no CNJ — insistir
      // 2s depois só aumenta a fila deles. Esse processo volta na próxima
      // execução do cron, que é o comportamento certo.
      const passageiro = tipo === 'cnj-fora' || tipo === 'rede';
      const cabeNoTempo = Date.now() - inicio + esperas[tentativa] < TETO_RETENTATIVA_MS;
      if (!passageiro || tentativa >= esperas.length || !cabeNoTempo) throw e;
      await new Promise(r => setTimeout(r, esperas[tentativa]));
    }
  }
}

// IMPORTANTE: propositalmente NÃO engole erro aqui (nem timeout, nem status
// != 200) — se engolisse e devolvesse null/[], sincronizarDatajudUm() trataria
// isso como "consultei e não achou nada" e marcaria ultima_verificacao como
// agora, escondendo a falha. Deixa a exceção subir pro catch de
// sincronizarDatajudUm(), que classifica, loga e registra na fila.
async function buscarNoDatajud(index, numero) {
  const numeroLimpo = numero.replace(/[.\-\/ ]/g, '');
  const r = await fetch(`https://api-publica.datajud.cnj.jus.br/${index}/_search`, {
    method: 'POST',
    headers: { 'Authorization': `ApiKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(ESPERA_DATAJUD_MS),
    // size 10: um mesmo número pode ter um documento por grau (G1, G2, JE...)
    body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: numeroLimpo } } }),
  });
  if (!r.ok) throw new Error(`DataJud respondeu ${r.status} (${index})`);
  const json = JSON.parse(decodificarBuffer(await r.arrayBuffer()));
  return json.hits?.hits || [];
}

// ── FILA STJ — resolve "AREsp 3254978" pro número CNJ e importa ───────────────
// O scraping em si roda fora da Vercel (navegador real, contorna o Cloudflare
// do processo.stj.jus.br — ver scripts/fila_stj/worker.py) porque a API
// pública do DataJud só aceita o número único (20 dígitos), nunca o número de
// registro tradicional do STJ/STF. O worker só resolve o número e grava em
// fila_consulta_stj; quem decide como importar/mesclar em `processos` é esta
// função — mesma regra de _importarComMerge() (js/dashboard.js), só que aqui
// com a service key porque não existe sessão de usuário.
async function rodarFilaStj(admin, res) {
  const startAt = Date.now();
  const { data: fila, error: filaErr } = await admin
    .from('fila_consulta_stj')
    .select('id, user_id, entrada_original, termo_busca, numero_cnj, tribunal')
    .eq('status', 'resolvido');
  if (filaErr) return res.status(500).json({ erro: filaErr.message });
  if (!fila?.length) return res.status(200).json({ ok: true, tipo: 'fila_stj', processados: 0 });

  // Um e-mail por processo era irritante (lote de 6 = 6 e-mails seguidos) —
  // junta tudo que essa execução resolveu e manda um só por advogado, no
  // final. Cada entrada carrega o que entra no resumo do e-mail.
  const avisosPorUsuario = {};

  // Em série isso estourava o maxDuration com poucos itens (cada consulta ao
  // DataJud pode levar dezenas de segundos). Mesmo pool contínuo usado pelo
  // sync normal — concorrência bem menor porque a fila do STJ é tipicamente
  // pequena (poucas dezenas, não milhares).
  const resultados = await comPool(fila, Math.min(10, fila.length), startAt + JANELA_INICIAR_MS, async (linha) => {
    try {
      const numero = normalizarNumeroCNJ(linha.numero_cnj);
      const index  = datajudIndexFromNumero(numero);
      if (!index) throw new Error('Número único resolvido não tem índice DataJud reconhecido.');

      const hits = await buscarNoDatajud(index, numero);
      // Processo pode ser recente demais pro DataJud já ter indexado — isso
      // não invalida a resolução do número no STJ (que veio direto do site do
      // tribunal). Em vez de desistir, grava o número certo mesmo sem dados
      // ainda: ultima_verificacao fica null, então a sincronização normal
      // (api/cron/sincronizar.js?tipo=datajud) completa assim que o DataJud
      // indexar, sem precisar passar pela fila do STJ de novo.
      const semDadosDatajud = !hits.length;
      const d = semDadosDatajud
        ? { numero, tribunal: null, _datajudIndex: index, classe: null, orgaoJulgador: null, dataAjuizamento: null, partes: [], movimentos: [] }
        : normalizarDescoberta(hits[0]._source, index);
      d.numero     = numero;
      d.movimentos = semDadosDatajud ? [] : movimentosDosHits(hits);

      // Número tradicional do STJ (ex: "AREsp 3254978") — o advogado usa pra
      // consultar direto no site do tribunal, nunca é apagado depois disso.
      const registroSuperior = linha.termo_busca;

      // Casa tanto pelo número único (já cadastrado certo) quanto pelo texto
      // original digitado/buscado (ex: alguém cadastrou manualmente com
      // numero="AREsp 3254978" antes de existir essa fila) — sem isso, um
      // processo assim virava duplicado em vez de corrigido.
      const candidatosNumero = [...new Set([numero, linha.entrada_original, linha.termo_busca].filter(Boolean))];
      const { data: achados } = await admin
        .from('processos')
        .select('id, numero, apelido, nome, cliente, movimentos_recentes, tribunal, historico_numeros')
        .eq('user_id', linha.user_id)
        .in('numero', candidatosNumero);
      const existente = (achados || []).find(p => p.numero === numero) || (achados || [])[0] || null;

      // Histórico de números da causa (1ª instância, 2ª instância se mudou,
      // STJ, STF...) — só cresce, nunca apaga uma entrada antiga. Registra
      // o número de registro do STJ/STF resolvido agora e, se o número
      // único do processo estiver mudando, preserva o valor anterior antes
      // de sobrescrever (senão esse rastro se perde pra sempre).
      const agoraIso = new Date().toISOString();
      const etiquetaTribunal = (linha.tribunal || 'stj').toUpperCase();
      const historicoBase = existente?.historico_numeros || [];
      const novasEntradas = [
        { numero: registroSuperior, etiqueta: etiquetaTribunal, origem: 'fila_stj', data: agoraIso },
      ];
      if (existente && existente.numero !== numero) {
        novasEntradas.push({ numero: existente.numero, etiqueta: 'Número anterior', origem: 'fila_stj', data: agoraIso });
      }
      const historicoAtualizado = [
        ...historicoBase,
        ...novasEntradas.filter(nv => !historicoBase.some(h => h.numero === nv.numero)),
      ];

      let processoId;
      let nomeExibicao = existente?.apelido || existente?.nome || d.classe || numero;
      let clienteNovo  = null;
      if (existente) {
        const novasMovs = d.movimentos.length ? d.movimentos : (existente.movimentos_recentes || []);
        const updates = {
          movimentos_recentes:      novasMovs,
          movimentos_hash:          novasMovs.length ? novasMovs.slice(0, 6).map(m => m.data + m.nome).join('|') : null,
          ultima_verificacao:       new Date().toISOString(),
          numero_registro_superior: registroSuperior,
          historico_numeros:        historicoAtualizado,
          aviso_stj_pendente:       true,
        };
        // Achado pelo texto antigo (ex: "AREsp 3254978"), não pelo número
        // único — corrige o número, senão o processo continua fora da fila
        // de sincronização pra sempre.
        if (existente.numero !== numero) updates.numero = numero;
        if (!existente.tribunal && d.tribunal) updates.tribunal = d.tribunal;
        if (d.orgaoJulgador)   updates.orgao_julgador  = d.orgaoJulgador;
        if (d.classe)          updates.classe          = d.classe;
        if (d.dataAjuizamento) updates.data_ajuizamento = d.dataAjuizamento;
        if (d._datajudIndex)   updates.datajud_index    = d._datajudIndex;

        const { error } = await admin.from('processos').update(updates).eq('id', existente.id);
        if (error) throw new Error(error.message);
        processoId = existente.id;
      } else {
        const clientePart = (d.partes || []).find(p => /autor|requerente|reclamante/i.test(p.tipo || ''));
        clienteNovo = clientePart?.nome || null;
        const { data: inserido, error } = await admin.from('processos').upsert({
          user_id:                  linha.user_id,
          numero,
          nome:                     d.classe || numero,
          cliente:                  clientePart?.nome || '',
          area:                     'Cível',
          tribunal:                 d.tribunal || '',
          datajud_index:            d._datajudIndex || index,
          classe:                   d.classe || null,
          orgao_julgador:           d.orgaoJulgador || null,
          data_ajuizamento:         d.dataAjuizamento || null,
          movimentos_recentes:      d.movimentos.length ? d.movimentos : null,
          movimentos_hash:          d.movimentos.length ? d.movimentos.slice(0, 6).map(m => m.data + m.nome).join('|') : null,
          ultima_verificacao:       d.movimentos.length ? new Date().toISOString() : null,
          numero_registro_superior: registroSuperior,
          historico_numeros:        historicoAtualizado,
          aviso_stj_pendente:       true,
        }, { onConflict: 'user_id,numero' }).select('id').single();
        if (error) throw new Error(error.message);
        processoId = inserido?.id || null;
      }

      await admin.from('fila_consulta_stj').update({
        status:        'importado',
        processo_id:   processoId,
        processado_em: new Date().toISOString(),
        erro_mensagem: semDadosDatajud
          ? 'Número CNJ gravado; DataJud ainda não tinha dados deste processo — a sincronização normal completa quando disponível.'
          : null,
      }).eq('id', linha.id);

      // Avisa só quando é processo NOVO — mesclar em um que o advogado já
      // acompanhava (ex: só corrigindo o número) não gera e-mail, por pedido.
      if (!existente) {
        (avisosPorUsuario[linha.user_id] ||= []).push({
          numero, registroSuperior, nomeExibicao,
          classe: d.classe || null,
          cliente: clienteNovo,
          dataAjuizamento: d.dataAjuizamento || null,
          semDadosDatajud,
        });
      }

      return existente ? 'mesclado' : 'importado';
    } catch (e) {
      await logErro(admin, 'cron:fila-stj', String(e.message || e).slice(0, 300),
        { filaId: linha.id, termo: linha.termo_busca }, linha.user_id);
      await admin.from('fila_consulta_stj').update({
        status:        'erro',
        erro_mensagem: String(e.message || e).slice(0, 300),
        processado_em: new Date().toISOString(),
      }).eq('id', linha.id).then(() => {}, () => {});
      return 'erro';
    }
  });

  const importados = resultados.filter(r => r === 'importado').length;
  const mesclados  = resultados.filter(r => r === 'mesclado').length;
  const erros      = resultados.filter(r => r === 'erro').length;

  // Um e-mail por advogado com o resumo de tudo que essa execução resolveu —
  // nunca derruba a resposta da rota se o envio falhar.
  for (const userId of Object.keys(avisosPorUsuario)) {
    try {
      const itens = avisosPorUsuario[userId];
      const { data: ud } = await admin.auth.admin.getUserById(userId);
      const email = ud?.user?.email;
      if (!email) continue;

      const linhaItem = (it) => `
        <div style="padding:12px 0;border-bottom:1px solid #e5e7eb">
          <div style="font-size:14px;font-weight:700;color:#1a2b4a">${it.nomeExibicao}</div>
          ${it.cliente ? `<div style="font-size:12px;color:#374151">Cliente: ${it.cliente}</div>` : ''}
          ${it.classe ? `<div style="font-size:12px;color:#374151">${it.classe}</div>` : ''}
          <div style="font-size:12px;color:#6b7280;margin-top:4px">
            STJ: <b>${it.registroSuperior}</b> → CNJ: <b style="font-family:monospace">${it.numero}</b>
          </div>
          ${it.dataAjuizamento ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px">Distribuído em ${new Date(it.dataAjuizamento).toLocaleDateString('pt-BR')}</div>` : ''}
          ${it.semDadosDatajud ? `<div style="font-size:11px;color:#b45309;margin-top:2px">DataJud ainda não tinha dados deste processo — detalhes completam na próxima sincronização.</div>` : ''}
        </div>`;

      const assunto = itens.length === 1
        ? `Número do STJ resolvido — ${itens[0].nomeExibicao}`
        : `${itens.length} números do STJ resolvidos`;

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho(`Número${itens.length > 1 ? 's' : ''} do STJ resolvido${itens.length > 1 ? 's' : ''}`)}
  <div style="padding:16px 24px">
    <div style="font-size:13px;color:#374151;line-height:1.5;margin-bottom:14px">
      O STJ identifica processos por um número de registro próprio (ex: AREsp, REsp), diferente
      do número único (CNJ) usado para consultar movimentações. ${itens.length > 1 ? 'Os processos abaixo foram localizados' : 'O processo abaixo foi localizado'}
      no site do STJ e tiveram o número único convertido automaticamente — o número do STJ
      continua salvo e pesquisável no sistema, não foi apagado.
    </div>
    ${itens.map(linhaItem).join('')}
  </div>
  ${btnDashboard('#1a2e6b')}
  ${rodape()}
</div>
</body></html>`;

      await enviarEmail(email, assunto, html);
    } catch (e) {
      await logErro(admin, 'cron:fila-stj-email', String(e.message || e).slice(0, 300), { userId });
    }
  }

  return res.status(200).json({ ok: true, tipo: 'fila_stj', processados: fila.length, importados, mesclados, erros });
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
    // Sem normalizar, o processo importado daqui entrava com os 20 dígitos
    // corridos e ficava fora da fila de sincronização.
    numero: normalizarNumeroCNJ(p.numeroProcesso),
    tribunal: corrigirMojibake(p.tribunal) || index,
    _datajudIndex: index,
    classe: p.classe?.nome ? tituloProcesso(p.classe.nome) : null,
    orgaoJulgador: p.orgaoJulgador?.nome ? corrigirMojibake(p.orgaoJulgador.nome) : null,
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

// ── ONBOARDING (boas-vindas + descoberta por OAB via DJEN) ────────────────────
// Diferente do resto do arquivo: chamado pelo navegador do próprio usuário
// (token de sessão), não pelo cron da Vercel. Busca por OAB aqui usa o DJEN,
// não o DataJud — é o único dos dois que realmente funciona por OAB (ver
// buscarPorOabNoDatajud acima e o comentário no topo do arquivo).

const DJEN_API = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

// "count" do DJEN é publicação, não processo — um processo com 3 intimações
// conta 3. Pra não inflar o número no e-mail, deduplica por número de
// processo; o total só é exato se PAGINAS_MAX cobrir tudo (senão vira
// "pelo menos X", nunca um número inventado maior que o real).
const DJEN_PAGINAS_MAX = 4;
const DJEN_TAMANHO_PAGINA = 100;

async function buscarDJENPorOab(oab) {
  const base = {
    numeroOab: oab.num,
    ufOab: oab.uf,
    dataDisponibilizacaoInicio: new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10),
    dataDisponibilizacaoFim: new Date().toISOString().slice(0, 10),
    tamanhoPagina: DJEN_TAMANHO_PAGINA,
  };
  const buscarPagina = async (pagina) => {
    try {
      const params = new URLSearchParams({ ...base, pagina });
      const r = await fetch(`${DJEN_API}?${params}`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return { count: 0, items: [] };
      return await r.json();
    } catch {
      return { count: 0, items: [] };
    }
  };

  const primeira = await buscarPagina(1);
  const totalPublicacoes = primeira.count || 0;
  let itens = primeira.items || [];

  const numPaginas = Math.min(Math.ceil(totalPublicacoes / DJEN_TAMANHO_PAGINA), DJEN_PAGINAS_MAX);
  if (numPaginas > 1) {
    const extras = await Promise.all(
      Array.from({ length: numPaginas - 1 }, (_, i) => buscarPagina(i + 2))
    );
    itens = itens.concat(...extras.map(e => e.items || []));
  }

  const distintos = new Map();
  for (const it of itens) {
    const num = it.numeroprocessocommascara;
    if (num && !distintos.has(num)) distintos.set(num, it);
  }

  // Só é um total exato se a gente trouxe todas as páginas que existem.
  const completo = totalPublicacoes <= numPaginas * DJEN_TAMANHO_PAGINA;
  return { totalProcessos: distintos.size, exato: completo, itens: [...distintos.values()] };
}

async function enviarBoasVindas(email, nome) {
  const assunto = 'Bem-vindo(a) ao Meu Processo';
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho('Bem-vindo(a)!')}
  <div style="padding:20px 24px">
    <div style="font-size:14px;color:#374151;line-height:1.6">
      Olá, ${nome}. A partir de agora o Meu Processo acompanha seus processos automaticamente:
      monitoramos movimentações, publicações no DJEN e prazos, e avisamos você quando algo mudar —
      sem precisar consultar nenhum portal manualmente todo dia.
    </div>
  </div>
  ${btnDashboard('#1a2e6b')}
  ${rodape()}
</div>
</body></html>`;
  await enviarEmail(email, assunto, html);
}

async function enviarEmailDescoberta(email, nome, oab, totalProcessos, exato, itens) {
  const preview = [...itens]
    .sort((a, b) => (b.data_disponibilizacao || '').localeCompare(a.data_disponibilizacao || ''))
    .slice(0, 4);

  const fmt = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '';
  const linhaItem = (it) => {
    const parteAtiva = (it.destinatarios || []).find(d => ['A', 'AT', 'ATIVO'].includes((d.polo || '').toUpperCase()));
    const cliente = parteAtiva?.nome ? corrigirMojibake(parteAtiva.nome) : null;
    const classe  = it.nomeClasse ? corrigirMojibake(it.nomeClasse) : null;
    const trib    = it.siglaTribunal || '';
    const idPartes = [classe, trib].filter(Boolean).join(' · ');
    return `
      <div style="padding:12px 0;border-bottom:1px solid #e5e7eb">
        <div style="font-size:13px;font-weight:700;color:#1a2b4a;font-family:monospace">${it.numeroprocessocommascara}</div>
        ${cliente || idPartes ? `<div style="font-size:12px;color:#374151;margin-top:2px">${cliente ? `<b>${cliente}</b>` : ''}${cliente && idPartes ? ' · ' : ''}${idPartes}</div>` : ''}
        ${it.data_disponibilizacao ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px">Publicado em ${fmt(it.data_disponibilizacao)}</div>` : ''}
      </div>`;
  };

  // Quando não paginou tudo, "totalProcessos" é só o que coube nas páginas
  // buscadas — nunca inventa um número maior que o real, só admite que pode
  // ter mais ("pelo menos X" em vez de "X").
  const prefixo  = exato ? '' : 'pelo menos ';
  const resto    = Math.max(0, totalProcessos - preview.length);
  const assunto  = `Encontramos ${prefixo}${totalProcessos} processo(s) na sua OAB ${oab.uf} ${oab.num}`;

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
  ${cabecalho(`${prefixo}${totalProcessos} processo(s) encontrado(s)`)}
  <div style="padding:16px 24px">
    <div style="font-size:13px;color:#374151;line-height:1.5;margin-bottom:14px">
      ${nome}, localizamos publicações no DJEN com a sua OAB (${oab.uf} ${oab.num}) em
      ${totalProcessos === 1 && exato ? 'um processo que ainda não está' : `${prefixo}${totalProcessos} processos que ainda não estão`}
      cadastrados no seu painel. Veja ${preview.length > 1 ? 'alguns dos mais recentes' : 'o mais recente'}:
    </div>
    ${preview.map(linhaItem).join('')}
    ${resto > 0 ? `<div style="font-size:12px;color:#6b7280;padding-top:10px;text-align:center">+ ${resto} processo(s) a mais encontrados${!exato ? ' (pode ter ainda mais)' : ''}</div>` : ''}
  </div>
  <div style="text-align:center;margin-top:8px;padding:0 24px 24px">
    <a href="https://meuprocesso.app.br/dashboard?abrir=busca-oab" style="display:inline-block;background:#1a2e6b;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600">Comece a monitorar agora →</a>
  </div>
  ${rodape()}
</div>
</body></html>`;

  await enviarEmail(email, assunto, html);
}

async function rodarOnboarding(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ erro: 'Não autenticado.' });
  if (!SUPA_SERVICE_KEY) return res.status(500).json({ erro: 'SUPABASE_SERVICE_KEY não configurada.' });

  const token = authHeader.slice(7);
  const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);

  // Chamada administrativa: CRON_SECRET/STJ_FILA_SECRET + ?user_id= dispara
  // pra uma conta específica ignorando a trava de "conta recém-criada" — uso
  // manual e pontual (ex: conta antiga que nunca recebeu o aviso porque
  // cadastrou antes desse recurso existir), nunca automático.
  const tokenAdmin = (CRON_SECRET && token === CRON_SECRET) || (STJ_FILA_SECRET && token === STJ_FILA_SECRET);
  let user, ignorarIdadeConta = false;

  if (tokenAdmin) {
    const userId = req.query?.user_id || req.body?.user_id;
    if (!userId) return res.status(400).json({ erro: 'user_id obrigatório na chamada administrativa.' });
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    user = data.user;
    ignorarIdadeConta = true;
  } else {
    const supaAnon = createClient(SUPA_URL, SUPA_ANON_KEY);
    const { data: { user: userToken }, error: authErr } = await supaAnon.auth.getUser(token);
    if (authErr || !userToken) return res.status(401).json({ erro: 'Token inválido.' });
    user = userToken;
  }

  try {
    // Idempotente — duas chamadas (ex: duas abas abertas) não mandam e-mail em dobro.
    if (user.user_metadata?.onboarding_email_enviado) {
      return res.status(200).json({ ok: true, jaEnviado: true });
    }

    // Só pra conta recém-criada — evita mandar "boas-vindas" pra alguém antigo
    // que hoje só está com 0 processos (ex: arquivou tudo). Chamada
    // administrativa pula essa trava de propósito.
    if (!ignorarIdadeConta && Date.now() - new Date(user.created_at).getTime() > 2 * 86400000) {
      return res.status(200).json({ ok: true, contaAntiga: true });
    }

    const { count } = await admin.from('processos')
      .select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    if (count > 0) return res.status(200).json({ ok: true, jaTemProcessos: true });

    const oabsPorUsuario = await buscarOabsUsuarios(admin, [user.id]);
    const oabs = oabsPorUsuario[user.id] || [];
    if (!oabs.length) return res.status(200).json({ ok: true, semOab: true });

    // Marca ANTES de mandar — se der erro no meio do caminho, não tenta nas
    // próximas chamadas em loop.
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, onboarding_email_enviado: true },
    });

    const primeiroNome = (user.user_metadata?.full_name || user.user_metadata?.nome || '').trim().split(' ')[0] || 'Advogado(a)';
    // "Dr./Dra." só quando o primeiro nome permite inferir o gênero com
    // confiança (ver inferirTratamento) — nome ambíguo usa só o primeiro nome.
    const tratamento = inferirTratamento(primeiroNome);
    const nome = tratamento ? `${tratamento} ${primeiroNome}` : primeiroNome;
    await enviarBoasVindas(user.email, nome);

    const { totalProcessos, exato, itens } = await buscarDJENPorOab(oabs[0]);
    if (totalProcessos > 0 && itens.length) {
      await enviarEmailDescoberta(user.email, nome, oabs[0], totalProcessos, exato, itens);
    }

    return res.status(200).json({ ok: true, enviouBoasVindas: true, processosEncontrados: totalProcessos });
  } catch (e) {
    await logErro(admin, 'onboarding-email', String(e.message || e).slice(0, 300), {}, user.id);
    return res.status(500).json({ erro: 'Falha ao processar onboarding.' });
  }
}
