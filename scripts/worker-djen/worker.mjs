// Worker local do DJEN — roda a MESMA rotina do cron da Vercel
// (lib/djen-cadernos.js, ?tipo=djen), só que do computador do escritório.
//
// Por que existe: a API do DJEN (comunicaapi.pje.jus.br) limita e bloqueia por
// IP/região, e a Vercel não tem IP fixo. Na pane de nov/2026 a API respondia
// normal de um IP residencial brasileiro enquanto as buscas do cron paravam.
// Daqui a consulta sai do IP do escritório — e ainda poupa execução da Vercel.
//
// Não apaga nada: usa a mesma fila (djen_cadernos_fila) e a mesma reivindicação
// atômica de item do cron, então os dois podem rodar ao mesmo tempo sem
// processar o mesmo item duas vezes.
//
// Uso: rodar.bat (duplo-clique) ou `node scripts/worker-djen/worker.mjs`.
// Configuração e agendamento: LEIA-ME.md nesta pasta.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const RAIZ  = path.resolve(PASTA, '..', '..');
const LOG   = path.join(PASTA, 'worker-djen.log');
const TRAVA = path.join(PASTA, '.rodando');
// Sem o teto de 180s da Vercel: dá pra varrer todas as OABs numa execução.
// O DJEN aceita ~20 consultas/min por IP (o código espaça 3,2s entre elas).
const ORCAMENTO_MS   = 20 * 60 * 1000;
const TRAVA_VELHA_MS = 40 * 60 * 1000;

function log(msg) {
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const linha = `[${quando}] ${msg}`;
  console.log(linha);
  try { fs.appendFileSync(LOG, linha + '\n'); } catch (_) {}
}

const envPath = path.join(PASTA, '.env');
if (!fs.existsSync(envPath)) {
  log('ERRO: falta o arquivo .env nesta pasta. Copie o exemplo.env para .env e preencha (ver LEIA-ME.md).');
  process.exit(1);
}
// Lido à mão (e não com process.loadEnvFile) por causa do BOM: o Bloco de
// Notas e o PowerShell salvam "UTF-8 com BOM", e aí a primeira variável do
// arquivo não era reconhecida.
const envTexto = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '');
for (const [k, v] of Object.entries(parseEnv(envTexto))) if (v) process.env[k] = v;
// O handler trata "rodando na Vercel" pelo VERCEL e exige o CRON_SECRET nesse
// caso. Aqui não é a Vercel — e o CRON_SECRET nem deve existir neste computador.
delete process.env.VERCEL;
delete process.env.CRON_SECRET;
// Aparece no histórico de execuções do painel admin (coluna região) e nas
// mensagens de erro do DJEN — dá pra separar o que veio do worker.
process.env.VERCEL_REGION = 'worker-local';

if (!process.env.SUPABASE_SERVICE_KEY) {
  log('ERRO: SUPABASE_SERVICE_KEY vazia no .env — sem ela não dá pra ler nem gravar no banco.');
  process.exit(1);
}
if (!process.env.STJ_FILA_SECRET) {
  log('Aviso: sem STJ_FILA_SECRET no .env — intimação nova vai no resumo de e-mail da manhã/tarde, não na hora.');
}
if (!process.env.RESEND_API_KEY) {
  log('Aviso: sem RESEND_API_KEY no .env — processo novo encontrado aparece só no painel, sem e-mail.');
}

// Agendador + duplo-clique ao mesmo tempo: o segundo sai sem fazer nada.
if (fs.existsSync(TRAVA)) {
  const idade = Date.now() - fs.statSync(TRAVA).mtimeMs;
  if (idade < TRAVA_VELHA_MS) {
    log(`Já tem uma execução em andamento (há ${Math.round(idade / 60000)} min) — saindo.`);
    process.exit(0);
  }
  log('Trava antiga encontrada (a execução anterior não terminou direito) — seguindo.');
}
fs.writeFileSync(TRAVA, String(process.pid));

let codigoSaida = 0;
try {
  const { default: djenCadernos } = await import(pathToFileURL(path.join(RAIZ, 'lib', 'djen-cadernos.js')).href);

  let status = 200, corpo = null;
  const res = {
    status(c) { status = c; return this; },
    json(d)   { corpo = d; return this; },
  };
  const req = { headers: {}, query: { tipo: 'djen' }, inicioMs: Date.now(), orcamentoMs: ORCAMENTO_MS };

  log('Iniciando busca no DJEN...');
  await djenCadernos(req, res);

  if (status >= 400) {
    codigoSaida = 1;
    log(`ERRO (${status}): ${corpo?.erro || JSON.stringify(corpo)}`);
  } else {
    const resultados = corpo?.resultados || [];
    const erros      = resultados.filter(r => r.erro);
    const novas      = resultados.reduce((s, r) => s + (r.comunicacoesEncontradas || 0), 0);
    const pulados    = resultados.filter(r => r.pulado).length;
    log(`Pronto em ${corpo?.elapsed || '?'}: ${resultados.length} OAB(s) consultada(s), ` +
        `${novas} publicação(ões) nova(s) gravada(s), ${pulados} sem novidade, ${erros.length} com erro.`);
    for (const e of erros) log(`  erro em ${e.tribunal} ${e.data}: ${e.erro}`);
    if (!resultados.length) log('  Nada a fazer agora (todas as OABs de hoje já foram conferidas há menos de 4h, ou é fim de semana).');
    if (erros.length && erros.length === resultados.length) codigoSaida = 1;
  }
} catch (e) {
  codigoSaida = 1;
  log(`ERRO inesperado: ${e?.stack || e}`);
} finally {
  fs.rmSync(TRAVA, { force: true });
}
process.exit(codigoSaida);
