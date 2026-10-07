// Sincronização de processos, DJEN e OAB scan.
// ?tipo=datajud (padrão) — atualiza movimentos de todos os processos no DataJud
// ?tipo=djen    — processa os cadernos do DJEN (lógica em lib/djen-cadernos.js)
// ?tipo=oab     — varre todos os tribunais pela OAB do advogado buscando processos novos
//                 (fora do vercel.json: a API pública do DataJud não expõe "partes",
//                 então a busca por OAB nunca retorna nada — testado set/2026)
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
  abrirExecucao, fecharExecucao,
} from '../../lib/sync-comum.js';

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

  const tipo = req.query?.tipo || 'datajud';
  if (tipo === 'djen') return djenCadernos(req, res);

  const admin = createClient(SUPA_URL, SUPA_SERVICE_KEY);
  const hoje  = new Date().toISOString().slice(0, 10);

  if (tipo === 'oab')      return rodarOabScan(admin, res, hoje);
  if (tipo === 'fila_stj') return rodarFilaStj(admin, res);
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

// Medido em 30/09/2026 contra a API pública (amostras de 8, 20 e 40 paralelas):
// o DataJud responde a todas, mas o tempo cresce com a concorrência —
// mediana 20s com 8, 22s com 20, 36s com 40 (máx. 48s). Ou seja: ele enfileira
// em vez de recusar. Por isso vale manter várias em voo e, principalmente,
// ESPERAR a resposta: com timeout de 28s a gente desligava no meio de
// respostas que estavam chegando.
// Medido em 30/09/2026 à tarde: o próprio CNJ reportou "took" de 51-54s na
// consulta (é a fila interna do Elasticsearch deles, não a rede). De manhã a
// mesma consulta levava 15-25s. Por isso a espera subiu pra 55s e o grosso
// das execuções foi movido pra madrugada no vercel.json.
// Concorrência 40: com 20 e resposta de 20s (madrugada) davam ~40 processos
// por execução — 555 processos levariam dias pra fechar um ciclo. A medição
// mostrou 40 simultâneas com 100% de sucesso, então é daí que vem a vazão.
// Medido em 05/10/2026, consultas sequenciais a TJDFT, TJGO e TRF1:
// mediana 34,6s · 3 de 9 devolveram 429 (fila deles cheia) em 14-37s ·
// 2 de 9 devolveram HTTP 504 em exatos 60,0s.
// Esse 504 em 60s é o dado novo: o CNJ tem um limite próprio e desiste sozinho
// nessa marca. Então esperar além de ~60s é tempo jogado fora, e o nosso
// limite de 55s cortava respostas que ainda chegariam. 58s fica entre os dois.
const CONCORRENCIA_DATAJUD = 40;
const JANELA_INICIAR_MS    = 55000;  // até quando novas consultas são iniciadas
const ESPERA_DATAJUD_MS    = 58000;  // quanto esperamos cada resposta
// 55s iniciando + 58s da última resposta + gravação = ~115s, dentro do
// maxDuration de 120s. Observado nas execuções do fim de semana: mediana 100s,
// máxima 111s — a margem é pequena, então não dá para subir mais.
// 55s pra iniciar + 55s da última resposta + gravação = ~112s, dentro do
// maxDuration de 120s do vercel.json.

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

async function sincronizarDatajud(processos, admin, hoje, startAt = Date.now()) {
  const com_datajud = processos.filter(p => p.datajud_index);
  const resultados = await comPool(
    com_datajud, CONCORRENCIA_DATAJUD, startAt + JANELA_INICIAR_MS,
    proc => sincronizarDatajudUm(proc, admin, hoje),
  );
  return {
    novos:      resultados.filter(r => r === 'novos').length,
    verificados: resultados.filter(r => r === 'novos' || r === 'atualizado' || r === 'sem-mudanca' || r === 'nao-encontrado').length,
    falhas:     resultados.filter(r => r === 'erro').length,
    tentados:   resultados.length,
  };
}

// Usado pelo cron e pelo botão "DataJud agora" do painel admin (api/admin.js).
// proc precisa de: id, user_id, numero, nome, datajud_index, movimentos_hash,
// movimentos_recentes, notificacao_pendente, novos_movimentos, created_at.
// Retorna 'novos' | 'atualizado' | 'sem-mudanca' | 'nao-encontrado' | 'pulado' | 'erro'.
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

export async function sincronizarDatajudUm(proc, admin, hoje) {
  if ((proc.created_at || '').slice(0, 10) === hoje) return 'pulado';
  try {
    const hits = await buscarComRetentativa(proc.datajud_index, proc.numero);
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
  const { data: fila, error: filaErr } = await admin
    .from('fila_consulta_stj')
    .select('id, user_id, termo_busca, numero_cnj')
    .eq('status', 'resolvido');
  if (filaErr) return res.status(500).json({ erro: filaErr.message });
  if (!fila?.length) return res.status(200).json({ ok: true, tipo: 'fila_stj', processados: 0 });

  let importados = 0, mesclados = 0, erros = 0;

  for (const linha of fila) {
    try {
      const numero = normalizarNumeroCNJ(linha.numero_cnj);
      const index  = datajudIndexFromNumero(numero);
      if (!index) throw new Error('Número único resolvido não tem índice DataJud reconhecido.');

      const hits = await buscarNoDatajud(index, numero);
      if (!hits.length) {
        await admin.from('fila_consulta_stj').update({
          status:        'nao_encontrado',
          erro_mensagem: `Número único ${numero} resolvido, mas não encontrado no índice ${index}.`,
          processado_em: new Date().toISOString(),
        }).eq('id', linha.id);
        continue;
      }

      const d = normalizarDescoberta(hits[0]._source, index);
      d.numero     = numero;
      d.movimentos = movimentosDosHits(hits);

      // Número tradicional do STJ (ex: "AREsp 3254978") — o advogado usa pra
      // consultar direto no site do tribunal, nunca é apagado depois disso.
      const registroSuperior = linha.termo_busca;

      const { data: existente } = await admin
        .from('processos')
        .select('id, movimentos_recentes, tribunal')
        .eq('user_id', linha.user_id)
        .eq('numero', numero)
        .maybeSingle();

      let processoId;
      if (existente) {
        const novasMovs = d.movimentos.length ? d.movimentos : (existente.movimentos_recentes || []);
        const updates = {
          movimentos_recentes:      novasMovs,
          movimentos_hash:          novasMovs.length ? novasMovs.slice(0, 6).map(m => m.data + m.nome).join('|') : null,
          ultima_verificacao:       new Date().toISOString(),
          numero_registro_superior: registroSuperior,
          aviso_stj_pendente:       true,
        };
        if (!existente.tribunal && d.tribunal) updates.tribunal = d.tribunal;
        if (d.orgaoJulgador)   updates.orgao_julgador  = d.orgaoJulgador;
        if (d.classe)          updates.classe          = d.classe;
        if (d.dataAjuizamento) updates.data_ajuizamento = d.dataAjuizamento;
        if (d._datajudIndex)   updates.datajud_index   = d._datajudIndex;

        const { error } = await admin.from('processos').update(updates).eq('id', existente.id);
        if (error) throw new Error(error.message);
        processoId = existente.id;
        mesclados++;
      } else {
        const clientePart = (d.partes || []).find(p => /autor|requerente|reclamante/i.test(p.tipo || ''));
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
          aviso_stj_pendente:       true,
        }, { onConflict: 'user_id,numero' }).select('id').single();
        if (error) throw new Error(error.message);
        processoId = inserido?.id || null;
        importados++;
      }

      await admin.from('fila_consulta_stj').update({
        status:        'importado',
        processo_id:   processoId,
        processado_em: new Date().toISOString(),
      }).eq('id', linha.id);

    } catch (e) {
      erros++;
      await logErro(admin, 'cron:fila-stj', String(e.message || e).slice(0, 300),
        { filaId: linha.id, termo: linha.termo_busca }, linha.user_id);
      await admin.from('fila_consulta_stj').update({
        status:        'erro',
        erro_mensagem: String(e.message || e).slice(0, 300),
        processado_em: new Date().toISOString(),
      }).eq('id', linha.id).then(() => {}, () => {});
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
