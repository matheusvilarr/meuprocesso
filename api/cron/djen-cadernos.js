// Sincronização DJEN via "caderno" diário (1 download = todas as comunicações
// de um tribunal no dia), em vez de 1 requisição por OAB por usuário.
//
// Por quê: a API do DJEN limita 20 requisições/minuto por IP (documentado em
// /swagger/djen.yml). Buscar por OAB escala com usuários × OABs e estoura essa
// cota rápido. O endpoint /api/v1/caderno/{tribunal}/{data}/{meio} devolve o
// dia inteiro de um tribunal em 1 requisição — o volume de requisições passa a
// depender só do número de tribunais (~90 no país), não do número de usuários.
//
// Fila em djen_cadernos_fila: cada execução do cron processa 1 (tribunal, dia)
// pendente por vez. Testado localmente: até o maior tribunal do país (TJSP,
// ~260 mil comunicações, 150MB) processa em ~5-10s com <300MB de RAM via
// streaming (nunca carrega o zip inteiro na memória).
//
// Escopo v1: só tribunais com pelo menos 1 usuário com OAB na UF correspondente
// (TJ + TRE + TRF + TRT da região) + tribunais nacionais (STJ, TST, TSE, CJF).
// Não cobre 100% dos casos (ex: advogado de SP com processo em outro estado
// não coberto aqui) — trade-off aceito para manter custo zero por enquanto.
// Editais (meio=E) fora do escopo v1, só Diário Eletrônico (meio=D).

import { createClient } from '@supabase/supabase-js';
import unzipper from 'unzipper';
import { Readable } from 'node:stream';
import { logErro, _djenAtualizarProcesso, _djenAutoImportar, buscarOabsUsuarios } from './sincronizar.js';

const SUPA_URL         = 'https://ctsjhsdblallguftycqs.supabase.co';
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET      = process.env.CRON_SECRET;
const CADERNO_API      = 'https://comunicaapi.pje.jus.br/api/v1/caderno';
const STALE_MS         = 15 * 60 * 1000; // "processando" travado há mais que isso volta pra fila

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

  try {
    await seedFilaHoje(admin, hoje);

    const item = await reivindicarProximoPendente(admin);
    if (!item) return res.status(200).json({ ok: true, semPendencias: true, hoje });

    const resultado = await processarTribunal(item, admin, hoje);
    return res.status(200).json({ ok: true, ...resultado });
  } catch (e) {
    await logErro(admin, 'cron:djen-cadernos', e.message, {});
    return res.status(500).json({ erro: e.message });
  }
}

// ── FILA ──────────────────────────────────────────────────────────────────────

async function seedFilaHoje(admin, hoje) {
  const { data: existentes } = await admin
    .from('djen_cadernos_fila').select('id').eq('data', hoje).limit(1);
  if (existentes?.length) return; // já semeado hoje

  const ufs = await ufsComUsuarios(admin);
  const tribunais = new Set(NACIONAL);
  for (const uf of ufs) for (const t of (UF_TRIBUNAIS[uf] || [])) tribunais.add(t);

  const linhas = [...tribunais].map(tribunal => ({ tribunal, data: hoje }));
  if (linhas.length) {
    await admin.from('djen_cadernos_fila').upsert(linhas, { onConflict: 'tribunal,data', ignoreDuplicates: true });
  }
}

async function ufsComUsuarios(admin) {
  const ids = await todosOsUserIds(admin);
  const oabsPorUsuario = await buscarOabsUsuarios(admin, ids);
  const ufs = new Set();
  for (const oabs of Object.values(oabsPorUsuario)) {
    for (const o of oabs) ufs.add(o.uf);
  }
  return ufs;
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

async function reivindicarProximoPendente(admin) {
  const staleDesde = new Date(Date.now() - STALE_MS).toISOString();
  const { data: candidatos } = await admin
    .from('djen_cadernos_fila')
    .select('id, tribunal, data, status, tentativas')
    .or(`status.eq.pendente,and(status.eq.processando,iniciado_em.lte.${staleDesde})`)
    .order('criado_em', { ascending: true })
    .limit(1);

  const candidato = candidatos?.[0];
  if (!candidato) return null;

  const { data: reivindicado } = await admin
    .from('djen_cadernos_fila')
    .update({ status: 'processando', iniciado_em: new Date().toISOString(), tentativas: candidato.tentativas + 1 })
    .eq('id', candidato.id)
    .eq('status', candidato.status)
    .select()
    .maybeSingle();

  return reivindicado || null; // null = outra execução já pegou esse item nesse instante
}

// ── PROCESSAMENTO DE 1 TRIBUNAL ────────────────────────────────────────────────

export async function processarTribunal(item, admin, hoje) {
  const { tribunal, data } = item;

  const metaRes = await fetch(`${CADERNO_API}/${tribunal}/${data}/D`, { signal: AbortSignal.timeout(20000) });
  if (!metaRes.ok) throw new Error(`Metadados do caderno ${tribunal} responderam ${metaRes.status}`);
  const meta = await metaRes.json();

  // "Sem comunicações" e "Cancelado" são estados finais — nunca vão virar "Processado".
  // Só "Não Processado"/"Em processamento" são transitórios e valem retentar.
  const ESTADOS_FINAIS_SEM_DADOS = ['Sem comunicações', 'Cancelado'];
  if (ESTADOS_FINAIS_SEM_DADOS.includes(meta.status)) {
    await admin.from('djen_cadernos_fila')
      .update({ status: 'concluido', concluido_em: new Date().toISOString(), comunicacoes_encontradas: 0, erro_msg: `status API: ${meta.status}` })
      .eq('id', item.id);
    return { tribunal, pulado: true, motivo: meta.status };
  }
  if (meta.status !== 'Processado') {
    // Transitório (ainda gerando o caderno). Depois de várias tentativas, desiste
    // pro dia — evita loop infinito se o tribunal nunca terminar de processar.
    const desistir = item.tentativas >= 10;
    await admin.from('djen_cadernos_fila')
      .update({
        status: desistir ? 'erro' : 'pendente',
        erro_msg: `status API: ${meta.status}`,
      })
      .eq('id', item.id);
    return { tribunal, pulado: true, motivo: meta.status, desistiu: desistir };
  }

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
      usuariosPorOab.get(chave).push(uid);
    }
  }

  const procPorUsuarioNumero = new Map(); // "uid|numero" -> proc
  const numeroSetGlobal = new Set();
  for (const p of processos) {
    procPorUsuarioNumero.set(`${p.user_id}|${p.numero}`, p);
    numeroSetGlobal.add(p.numero);
  }

  if (!meta.url) throw new Error('Metadados do caderno sem URL de download.');
  const zipRes = await fetch(meta.url, { signal: AbortSignal.timeout(120000) });
  if (!zipRes.ok || !zipRes.body) throw new Error(`Download do caderno ${tribunal} respondeu ${zipRes.status}`);

  const PADRAO = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
  let comunicacoesEncontradas = 0;

  // Importante: o evento 'finish' do stream dispara quando o ZIP terminou de ser
  // LIDO, não quando nossas gravações no banco terminaram — cada página é
  // processada de forma assíncrona (JSON.parse + updates no Supabase), então é
  // preciso coletar as promises e esperar todas antes de contar o resultado como
  // pronto. Sem isso, a function podia devolver resposta e ser encerrada pela
  // Vercel com gravações ainda pendentes, perdendo dado de verdade em produção.
  const pendentes = [];
  await new Promise((resolve, reject) => {
    Readable.fromWeb(zipRes.body).pipe(unzipper.Parse())
      .on('entry', entry => {
        if (!entry.path.endsWith('.json')) { entry.autodrain(); return; }
        pendentes.push(processarPagina(entry, {
          usuariosPorOab, procPorUsuarioNumero, numeroSetGlobal, PADRAO, admin, hoje,
          onMatch: () => { comunicacoesEncontradas++; },
        }));
      })
      .on('finish', resolve)
      .on('error', reject);
  });
  await Promise.all(pendentes);

  await admin.from('djen_cadernos_fila').update({
    status: 'concluido', concluido_em: new Date().toISOString(), comunicacoes_encontradas: comunicacoesEncontradas,
  }).eq('id', item.id);

  return { tribunal, comunicacoesEncontradas, totalComunicacoesNoCaderno: meta.total_comunicacoes };
}

async function processarPagina(entry, ctx) {
  const chunks = [];
  for await (const chunk of entry) chunks.push(chunk);

  let json;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch (_) {
    return; // arquivo corrompido/parcial — ignora essa página, não derruba o resto
  }

  const { usuariosPorOab, procPorUsuarioNumero, numeroSetGlobal, PADRAO, admin, hoje, onMatch } = ctx;

  for (const publicacao of json.items || []) {
    const uidsAlvo = new Set();
    for (const da of publicacao.destinatarioadvogados || []) {
      const adv = da.advogado;
      if (!adv) continue;
      const chave = `${adv.uf_oab}${adv.numero_oab}`;
      for (const uid of usuariosPorOab.get(chave) || []) uidsAlvo.add(uid);
    }
    if (!uidsAlvo.size) continue;

    const dataPub = publicacao.data_disponibilizacao || hoje;
    const movDJEN = { nome: `DJEN — ${publicacao.tipoComunicacao || 'Publicação'}`, data: dataPub };
    const numPrincipal = publicacao.numeroprocessocommascara;
    const numsTexto = [...new Set((publicacao.texto || '').match(PADRAO) || [])]
      .filter(n => n !== numPrincipal && numeroSetGlobal.has(n));

    for (const uid of uidsAlvo) {
      let atualizouAlgo = false;

      if (numPrincipal) {
        const proc = procPorUsuarioNumero.get(`${uid}|${numPrincipal}`);
        if (!proc) {
          atualizouAlgo = await _djenAutoImportar(numPrincipal, uid, movDJEN, admin);
        } else if ((proc.created_at || '').slice(0, 10) !== hoje) {
          atualizouAlgo = await _djenAtualizarProcesso(proc.id, movDJEN, admin);
        }
      }

      for (const num of numsTexto) {
        const proc = procPorUsuarioNumero.get(`${uid}|${num}`);
        if (!proc || (proc.created_at || '').slice(0, 10) === hoje) continue;
        const ok = await _djenAtualizarProcesso(proc.id, movDJEN, admin);
        atualizouAlgo = atualizouAlgo || ok;
      }

      if (atualizouAlgo) onMatch();
    }
  }
}
