// Teste direto das APIs do CNJ a partir DESTE computador — sem Vercel no meio.
// Serve para separar "o CNJ está fora" de "o problema é a Vercel":
//   - falha aqui também  → o problema é o CNJ (ou a rede), não a Vercel
//   - funciona aqui, mas não no site → o problema está na Vercel / no nosso servidor
//
// Uso: testar-datajud.bat (duplo-clique) ou
//      node scripts/diagnostico/testar-datajud.mjs 0700001-23.2025.8.07.0001
//      node scripts/diagnostico/testar-datajud.mjs "DF 59360"
//
// Número do processo → DataJud (andamentos). OAB → DJEN (publicações): a API
// pública do DataJud não busca por OAB (não expõe as partes).
// Só lê. Não precisa de chave nenhuma nem grava nada no banco.

import readline from 'node:readline/promises';
import { datajudIndexFromNumero, movimentosDosHits, lerOab } from '../../lib/sync-comum.js';

const DATAJUD_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const ESPERA_MS   = 70000;   // o próprio CNJ desiste aos 60s

const fmtData = s => s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
const segundos = t0 => ((Date.now() - t0) / 1000).toFixed(1) + 's';

function diagnostico(status, corpo) {
  if (status === 429 || /rejected_execution|es_rejected/.test(corpo))
    return 'CNJ SOBRECARREGADO (429 — fila interna cheia). Não é a Vercel: o CNJ recusa também daqui.';
  if (status === 504) return 'CNJ NÃO RESPONDEU A TEMPO (504 — ele desiste sozinho aos 60s). Não é a Vercel.';
  if (status >= 500)  return `ERRO INTERNO NO CNJ (${status}). Não é a Vercel.`;
  if (status === 401 || status === 403) return `ACESSO RECUSADO (${status}) — chave pública trocada pelo CNJ ou bloqueio deste IP.`;
  if (status === 404) return 'Índice do tribunal inexistente — confira o número do processo.';
  return `Resposta inesperada (${status}).`;
}

async function testarNumero(numero) {
  const limpo = numero.replace(/\D/g, '');
  const indice = datajudIndexFromNumero(limpo);
  if (!indice) return console.log('  Não reconheci o tribunal desse número (precisa ter 20 dígitos no padrão CNJ).');
  console.log(`  DataJud · índice ${indice} · consultando (pode levar até 60s)...`);
  const t0 = Date.now();
  let r, texto;
  try {
    r = await fetch(`https://api-publica.datajud.cnj.jus.br/${indice}/_search`, {
      method: 'POST',
      headers: { Authorization: `APIKey ${DATAJUD_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: limpo } } }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    texto = await r.text();
  } catch (e) {
    return console.log(`  ✗ Sem resposta em ${segundos(t0)}: ${e.message}\n  → Se for "timeout", o CNJ está travado. Se for erro de rede, confira a internet.`);
  }
  console.log(`  HTTP ${r.status} em ${segundos(t0)}`);
  if (!r.ok) return console.log(`  ✗ ${diagnostico(r.status, texto)}`);

  let json;
  try { json = JSON.parse(texto); } catch { return console.log('  ✗ Resposta não é JSON: ' + texto.slice(0, 150)); }
  if (json.timed_out || json._shards?.failed > 0) {
    return console.log(`  ✗ CNJ SOBRECARREGADO: respondeu 200, mas a busca veio pela metade (${json._shards?.failed} parte(s) falharam). Não é a Vercel.`);
  }
  const hits = json.hits?.hits || [];
  if (!hits.length) return console.log('  ✓ O DataJud respondeu normalmente, mas não tem esse processo nesse tribunal.');

  const src = hits[0]._source || {};
  const movs = movimentosDosHits(hits);
  const atualizado = hits.map(h => h._source?.dataHoraUltimaAtualizacao).filter(Boolean).sort().pop();
  console.log(`  ✓ DATAJUD FUNCIONANDO daqui.`);
  console.log(`    ${src.classe?.nome || '—'} · ${src.tribunal || ''} · ${src.orgaoJulgador?.nome || '—'}`);
  console.log(`    Atualizado no DataJud em: ${fmtData(atualizado)}   (se for antigo, o CNJ não está recebendo dados novos do tribunal)`);
  console.log('    Últimos andamentos:');
  for (const m of movs.slice(0, 5)) console.log(`      ${fmtData(m.data)}  ${m.nome}`);
  console.log('  → Se o site não atualiza este processo mas aqui funcionou, o problema está do nosso lado (Vercel/servidor).');
}

async function testarOab(oab) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 30 * 86400000);
  const params = new URLSearchParams({
    numeroOab: oab.num, ufOab: oab.uf,
    dataDisponibilizacaoInicio: inicio.toISOString().slice(0, 10),
    dataDisponibilizacaoFim: hoje.toISOString().slice(0, 10),
    itensPorPagina: 5, pagina: 1,
  });
  console.log(`  DJEN · OAB ${oab.uf} ${oab.num} · publicações dos últimos 30 dias...`);
  console.log('  (a API pública do DataJud não busca por OAB — para andamentos, teste com o número do processo)');
  const t0 = Date.now();
  let r, texto;
  try {
    r = await fetch(`https://comunicaapi.pje.jus.br/api/v1/comunicacao?${params}`, { signal: AbortSignal.timeout(30000) });
    texto = await r.text();
  } catch (e) {
    return console.log(`  ✗ Sem resposta em ${segundos(t0)}: ${e.message}`);
  }
  console.log(`  HTTP ${r.status} em ${segundos(t0)}`);
  if (r.status === 429) return console.log('  ✗ Limite do DJEN (20 consultas/min por IP). Espere 1 minuto e tente de novo.');
  if (r.status === 403) return console.log('  ✗ DJEN RECUSOU ESTE IP (403).');
  if (!r.ok) return console.log(`  ✗ Erro ${r.status}: ${texto.slice(0, 150)}`);
  const json = JSON.parse(texto);
  const itens = json.items || [];
  console.log(`  ✓ DJEN FUNCIONANDO daqui: ${json.count ?? itens.length} publicação(ões) nos últimos 30 dias.`);
  for (const p of itens) {
    console.log(`      ${p.data_disponibilizacao}  ${p.siglaTribunal || ''}  ${p.numeroprocessocommascara || ''}  ${p.tipoComunicacao || ''}`);
  }
  console.log('  → Se aqui aparecem publicações e no site não, a suspeita é o DJEN bloqueando o IP da Vercel (o worker local resolve).');
}

async function testar(entrada) {
  const texto = String(entrada || '').trim();
  if (!texto) return;
  console.log(`\n▶ ${texto}`);
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length === 20) return testarNumero(texto);
  const oab = lerOab(texto);
  if (oab) return testarOab(oab);
  console.log('  Não entendi. Digite um número de processo (20 dígitos) ou uma OAB (ex: DF 59360).');
}

const argumento = process.argv.slice(2).join(' ');
if (argumento) {
  await testar(argumento);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Teste das APIs do CNJ a partir deste computador (sem Vercel).');
  console.log('Digite um número de processo ou uma OAB. Enter vazio para sair.');
  for (;;) {
    const linha = await rl.question('\nNúmero do processo ou OAB: ');
    if (!linha.trim()) break;
    await testar(linha);
  }
  rl.close();
}
