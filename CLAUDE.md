# CLAUDE.md — Orientações para o assistente AI

Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão.
Leia com atenção antes de qualquer alteração.

---

## O que é este projeto

**Meu Processo** — sistema de gestão jurídica para advogados.
Permite cadastrar, monitorar e receber notificações de processos judiciais.
URL de produção: `meuprocesso.app.br` (hospedado na Vercel, branch `main`).
Repositório: `github.com/matheusvilarr/meuprocesso`

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Frontend | HTML/CSS/JS puro (sem framework) |
| Backend serverless | Vercel Functions (`/api/*.js`) — ES Modules |
| Banco de dados | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth |
| Deploy | Vercel (push na `main` = deploy automático) |
| Scraping PJe | Python + Playwright (`/scripts/`) — roda local ou Docker |
| Busca DJe | API direta no browser (`pesquisadje.tjdft.jus.br/api/v1/buscador`) |
| Busca CNJ | DataJud API pública (`api-publica.datajud.cnj.jus.br`) |

---

## Estrutura de arquivos

```
/
├── dashboard.html          # App principal (SPA — página única)
├── index.html              # Landing page de marketing (+ script que redireciona ?code= do Supabase)
├── login.html              # Login + aba de cadastro, Google OAuth
├── registro.html           # Cadastro com código de acesso
├── aceitar-convite.html    # Aceite de convite de colaborador
├── aguardando.html         # "Aguardando aprovação" (fluxo antigo — só sem linha em assinaturas)
├── admin.html              # Painel admin
├── esqueci-senha.html / redefinir-senha.html / cadastro-confirmado.html
├── assinatura-vencida.html # Stub: só redireciona pro /dashboard (links antigos)
├── precos.html, calculadora-prazo-processual.html, privacidade.html, termos.html
├── blog/                   # Artigos de SEO
├── demo/                   # Páginas estáticas de demonstração
├── css/                    # dashboard, admin, home, login, blog, style
├── js/
│   ├── dashboard.js        # TODA a lógica do app (~10.700 linhas)
│   ├── auth-guard.js       # Sessão, assinatura, OAB obrigatória, detecção de colaborador
│   ├── honorarios-calc.js  # Conta dos honorários (globalThis.HonCalc) — tela E cron de e-mail
│   ├── supabase-client.js  # Inicializa Supabase (_supabase global, PKCE)
│   ├── login.js, registro.js, admin.js, home.js
│   └── main.js             # Legado — nenhuma página carrega
├── api/                    # ⚠️ 12 funções = LIMITE do plano Hobby da Vercel (ver abaixo)
│   ├── buscar-processo.js  # Proxy DataJud CNJ (busca por número, OAB, nome, CPF) — exige login
│   ├── admin.js            # Backend do painel admin (~22 ?acao=)
│   ├── colaboradores.js    # Convidar / aceitar / buscar usuário por e-mail
│   ├── codigo-acesso.js    # Validar / registrar código de acesso (público — roda antes da sessão existir)
│   ├── verificar-oab.js    # OAB já usada em outra conta? (público — usado no cadastro)
│   ├── processos-descobertos.js # Processos achados pela OAB: listar / ignorar / marcar importado
│   ├── email-transacional.js    # E-mail "cadastro recebido"
│   ├── salvar-evento.js    # Salva eventos de calendário
│   ├── upload-avatar.js    # Upload de foto de perfil
│   ├── debug.js            # Diagnóstico DataJud / e-mail — só admins
│   └── cron/
│       ├── sincronizar.js             # Cron principal — ver seção "Crons" abaixo
│       └── verificar-atualizacoes.js  # Cron de e-mail: lê o que sincronizar.js gravou
├── lib/                    # Código de servidor compartilhado (fora de api/ = não conta no limite)
│   ├── sync-comum.js       # Funções compartilhadas entre crons (DataJud, e-mail, etc.)
│   └── djen-cadernos.js    # Lógica do cron de cadernos do DJEN
├── scripts/
│   ├── api.py              # FastAPI — expõe scrapers como REST (porta 8000)
│   ├── scraper_pje.py      # Playwright: scraping do portal PJe TJDFT
│   ├── monitor_dje.py      # Busca intimações no DJe TJDFT via API
│   ├── requirements.txt    # playwright, fastapi, uvicorn, requests
│   ├── backup.bat / backup.sh  # Backup local do banco (ver BACKUP-LEIA-ME.md; saída em backups/, fora do git)
│   ├── servidor-local.mjs  # Servidor estático local (sem vercel dev — /api responde 501)
│   └── fila_stj/           # Worker da fila STJ/STF — ver seção própria abaixo
│       ├── worker.py
│       ├── requirements.txt
│       ├── rodar.bat       # Duplo-clique pra rodar (venv fica fora do repo)
│       └── .env            # Local, fora do git (SUPABASE_SERVICE_KEY, STJ_FILA_SECRET)
├── supabase/
│   ├── schema.sql          # Schema completo — rode no SQL Editor do Supabase
│   └── migration_*.sql     # Migrations aditivas (não destroem dados) — rodar uma por uma
├── Dockerfile              # Para rodar o backend Python em servidor (ex: Railway)
└── vercel.json             # Rotas, cache e cron jobs da Vercel
```

### Limites do plano Hobby da Vercel
- **Cada arquivo em `api/` vira uma função, e o limite é 12 — já estamos nele.** Rota nova não
  ganha arquivo novo: entra como `?acao=`/`?tipo=` numa função existente, com a lógica em `lib/`.
- **Cron roda no máximo 1x por dia por entrada** — por isso o `vercel.json` repete a mesma rota
  em vários horários. Um `*/5` quebrou todos os deploys desde 31/07/2026.

---

## Banco de dados (Supabase)

**Projeto ativo:** `ctsjhsdblallguftycqs.supabase.co`
(Existe outro projeto `ijnhvfpzgqdehxxgmfrl` que é um teste antigo — ignorar.)

**Tabelas:**

### `processos`
Campos importantes:
- `nome` — título do tribunal (imutável, não editar)
- `apelido` — nome personalizado pelo advogado (editável)
- `movimentos_recentes` (jsonb) — array `[{ nome, data }]`
- `movimentos_hash` — string para detectar mudanças (concatenação de data+nome)
- `notificacao_pendente` (boolean) — true quando há novo movimento não lido
- `novos_movimentos` (jsonb) — movimentos novos desde última leitura
- `datajud_index` — ex: `api_publica_tjdft` (identifica de qual tribunal veio)
- `notas_manuais` (jsonb) — array `[{ texto, created_at, id }]`
- `numero_registro_superior` — número tradicional do STJ/STF (ex: "AREsp 3254978"), quando o processo veio da fila de conversão. Nunca é apagado por um sync normal.
- `historico_numeros` (jsonb) — array `[{ numero, etiqueta, origem, data }]`, só cresce — todos os números que a causa já teve (1ª instância, STJ, STF...)
- `aviso_stj_pendente` (boolean) — true logo após a fila importar/mesclar; o dashboard mostra um toast e desliga

### `fila_consulta_stj`
Números no formato STJ/STF ("AREsp 3254978") colados na busca ou no cadastro manual entram aqui — ver seção "Fila de conversão STJ/STF" abaixo.
- `user_id`, `entrada_original`, `termo_busca` (normalizado, sem sufixo de UF)
- `status` — `pendente` | `processando` | `resolvido` | `nao_encontrado` | `erro` | `importado`
- `numero_cnj`, `classe_descricao`, `numero_registro_tribunal` — preenchidos pelo worker
- `processo_id` — FK pro processo criado/mesclado, preenchido na importação
- `unique(user_id, termo_busca)`

### `honorarios` e `honorario_pagamentos`
O honorário é o ACORDO; as cobranças não são gravadas, saem dele. Pagamentos ficam em
`honorario_pagamentos` (`migration_honorario_pagamentos.sql`) e são abatidos da cobrança mais
antiga em aberto — parcial e adiantado de vários meses são o mesmo gesto.
- `recorrente` = true → `valor` é o de CADA cobrança (`periodicidade`, `parcelas_total` = nº de
  cobranças ou null = sem fim); `parcelas_total` > 1 sem recorrente → parcelado, `valor` = total
- `data_vencimento` = 1ª cobrança; `status` só `pendente` (ativo) | `cancelado` — pago/vencido
  saem da conta. Legado: `status='pago'` e `valor_entrada` valem como pagamento sem mexer no banco
- A conta mora em **`js/honorarios-calc.js`** (`globalThis.HonCalc`), carregado pela tela E
  importado pelo cron de e-mail — nunca duplicar a regra em outro lugar

### `tarefas`
- `titulo` (not null) — descrição da tarefa
- `coluna` — `a_fazer` | `em_andamento` | `revisao` | `concluida`
- `prioridade` — `baixa` | `media` | `urgente`
- `prazo` (date)
- `processo_id` (FK opcional)

### `prazos`
- `descricao`, `data_prazo`, `urgencia`, `tipo`, `notificar_dias`
- **Nenhum código usa mais** — prazos de verdade hoje são `tarefas.prazo` e `eventos`

### `colaboradores`
- `escritorio_id` (FK → auth.users) — dono/titular
- `user_id` (FK → auth.users) — conta real do colaborador
- `cargo` — texto livre ("Advogado Associado", "Estagiário"...)
- `nivel_acesso` — `total` | `restrito`
- `status` — `ativo` | `removido`

### `convites`
- `escritorio_id`, `email`, `cargo`, `nivel_acesso`
- `token` (hex 32 bytes, único) — usado na URL `/aceitar-convite?token=...`
- `status` — `pendente` | `aceito` | `expirado`
- `expires_at` — 7 dias após criação

### Outras tabelas (resumo — detalhes na migration indicada)
| Tabela | Migration | Para quê |
|---|---|---|
| `eventos` | — (nenhum `.sql` cria; só `ALTER` em `migration_evento*.sql`) | Calendário |
| `clientes` | `clientes_honorarios` | Cadastro de clientes do escritório |
| `documentos` | `docs_comentarios_historico` | Anexos (ver TODO: bucket não existe) |
| `assinaturas` | `assinaturas` | Plano/trial por `escritorio_id` (`assinatura_ativa()`, trial de 30 dias via trigger) |
| `solicitacoes_licenca` | `solicitacoes_licenca` | Pedido de plano feito pela tela |
| `admins`, `codigos_acesso` | `admin_panel` | Painel admin e códigos de convite do cadastro |
| `processo_compartilhamentos` | `compartilhamentos` | "Parceiros": compartilhar processo entre contas |
| `quadros`, `tarefa_comentarios` | `quadros_tarefas_v1` | Pastas do kanban e comentários de tarefa |
| `quadro_compartilhamentos` | `quadro_compartilhamentos_v1` | Compartilhar quadro de tarefas |
| `processos_descobertos` | `processos_descobertos` | Processos achados pela OAB, aguardando decisão |
| `djen_cadernos_fila` | `djen_cadernos` | Fila do cron de cadernos do DJEN |
| `cron_execucoes` | `cron_execucoes` | 1 linha por execução de cron (saúde no painel admin) |
| `email_envios` | `email_envios` | Controle da cota do Resend |
| `notif_log` | `notif_log` | Evita e-mail repetido no mesmo dia |
| `error_log` | `error_log` | Erros dos crons (grava com service role; só admins leem) |

Notas, comentários de processo e de cliente são editados por funções SQL atômicas
(`anexar_`/`remover_nota_processo`, `..._comentario_processo`, `..._comentario_cliente`) —
usar essas RPCs, não ler-modificar-gravar o jsonb pelo navegador.
Buckets do Storage (`avatars`, `documentos`) não têm SQL — são criados no painel.

**RLS ativo em todas as tabelas.**
- `processos`, `tarefas`, `prazos`, `eventos`: colaboradores ativos de um escritório veem os dados do titular via EXISTS subquery na tabela `colaboradores`.
- Migration para aplicar: `supabase/migration_colaboradores_v1.sql`

### Workspace colaborativo — variáveis globais
```javascript
window._isColaborador   // boolean — true se o usuário logado é colaborador
window._escritorioId    // uuid — sempre o ID do titular (owner)
window._colaboradorInfo // { escritorio_id, cargo, nivel_acesso } | null
```
- `auth-guard.js` detecta colaborador no login e define essas variáveis
- INSERTs usam `window._escritorioId` como `user_id` (não `window._user.id`)
- RLS deixa o colaborador acessar os dados porque usa EXISTS no SELECT

---

## Como rodar localmente

```bash
# Frontend + APIs serverless (porta 3000 ou 3002)
npx vercel dev --port 3002

# Backend Python (scrapers — porta 8000)
cd scripts && python api.py
```

Sem `vercel dev`, as rotas `/api/*` não funcionam (busca CNJ, upload, cron).
Sem npm/npx, dá pra testar só as telas com `node scripts/servidor-local.mjs [porta]`
(as rotas `/api/*` respondem 501).
O Supabase é sempre remoto — **testar localmente mexe nos dados reais de produção**.

---

## Funcionalidades e estado atual

### ✅ Funcionando
- Login / logout / recuperação de senha (Supabase Auth)
- **Workspace colaborativo (Fase 1)**: convite por link, até 3 colaboradores, RLS compartilhado.
  O backend funciona, mas o card "Colaboradores de escritório" em `dashboard.html` está
  desabilitado com selo "EM DESENVOLVIMENTO". O que está no ar é "Parceiros"
  (`processo_compartilhamentos`): compartilhar processo entre contas diferentes
- Cadastro manual de processos
- Busca por número CNJ (DataJud) — individual e em lote (cole vários números)
- Busca por OAB, nome advogado, nome cliente, CPF (DataJud — requer vercel dev ou produção)
- Multi-select nos resultados: importar vários processos de uma vez
- Merge inteligente: processo já cadastrado é atualizado, dados do advogado preservados
- Apelido editável: campo separado do título, editável pelo card (lápis no hover) ou no detalhe
- Monitoramento CNJ: DataJud 8x/dia e DJEN 6x/dia (ver "Crons"), badge de notificação e e-mail
- Clientes e honorários (pagamento parcial/adiantado), painel admin, assinaturas/trial
- Timeline de movimentos + notas manuais
- Calendário e prazos
- Kanban de tarefas
- Colaboradores
- Arquivamento de processos
- DJe TJDFT: busca por OAB/nome direto do browser (sem Python)
- **Fila de conversão STJ/STF**: número tradicional (AREsp/REsp) na busca ou cadastro manual → card criado na hora → worker local resolve o número único via scraping → importa/mescla automaticamente, preservando o número do STJ e um histórico completo — ver seção própria abaixo

### 🔧 Em manutenção / incompleto
- **Página TJDFT** (`#page-tjdft` em `dashboard.html`): existe, mas está inacessível — não há
  item na barra lateral nem nada chamando `showPage('tjdft')`
  - DJe: funciona no browser
  - PJe (scraper): requer servidor Python rodando — não disponível em produção ainda
    (além do `PYTHON_API`, há um `http://localhost:8000/pje` fixo no `dashboard.js`)
  - Para reativar: adicionar o item de navegação que chama `showPage('tjdft')`
- **Backend Python em produção**: Dockerfile criado, planejado para Railway (~$5/mês)
  - Por enquanto só funciona local: `cd scripts && python api.py`
  - `PYTHON_API` em `dashboard.js` aponta para `localhost:8000` (local) ou Railway (produção)

### 📋 TODOs conhecidos
- **Anexos de documentos não funcionam em produção** (achado em 20/10/2026): `uploadDocumento()`
  em `dashboard.js` envia pro bucket `documentos` do Supabase Storage, que **nunca foi criado** —
  só existe `avatars`; tabela `documentos` tem 0 linhas. Fazer a lógica inteira, não só criar o bucket:
  bucket privado + policies (só o escritório dono e colaboradores ativos), limite maior que os 2 MB
  atuais (20–25 MB), coluna de "onde o arquivo está" (supabase/r2) pra poder migrar pro Cloudflare R2
  depois sem mexer na tela, apagar os arquivos junto com o processo, cota por plano. Custos e
  alternativas discutidos: Supabase Pro (100 GB inclusos) agora, R2 quando passar de ~100 GB.
- Servidor Python para produção (Railway ou servidor próprio do cliente)
- Notificação automática DJe: cron que busca OAB de cada usuário e push notification
- Busca por OAB no DataJud retorna campos limitados por LGPD (partes podem vir vazias)

---

## Crons (`vercel.json` está em UTC; Brasília = UTC−3)

**`api/cron/sincronizar.js`** — sem `?tipo=` = `datajud`
| `tipo` | O que faz | Quando (BRT) |
|---|---|---|
| `datajud` | Atualiza movimentos no DataJud | 8x/dia: 00h, 02h, 04h, 06h, 08h, 10h, 14h, 20h |
| `djen` | Processa a fila de cadernos do DJEN (`lib/djen-cadernos.js`) | 6x/dia: 06h, 08h40, 12h, 14h40, 19h, 21h40 |
| `fila_stj` | Importa o que o worker da fila STJ resolveu | Chamado pelo worker local (`STJ_FILA_SECRET`) |
| `onboarding`, `historico_oab` | Boas-vindas + busca no DJEN pela OAB | Chamado pelo navegador com o token do usuário |
| `oab` | Varredura por OAB no DataJud | Fora do agendamento — a API pública não expõe partes, nunca retorna nada |

**`api/cron/verificar-atualizacoes.js`** — só e-mail, não consulta o DataJud
| `tipo` | Quando (BRT) |
|---|---|
| `morning` | 07h30 todo dia |
| `afternoon` | 13h30 seg–sex / 15h30 sáb–dom |
| `evening` | 18h seg–sex |
| `prazo_fatal` (tarefas vencendo em até 3 dias) | 09h |
| `honorario_vencido` | 09h30 |
| `cadastro_incompleto` (máx. 2 lembretes) | 10h |
| `instant` | Fora do agendamento — chamado pelo próprio sync quando há novidade |

`/descadastrar` é um rewrite pra `verificar-atualizacoes?acao=descadastrar` (link assinado
com HMAC, não usa `CRON_SECRET`). Os dois crons recusam qualquer chamada se `CRON_SECRET`
não estiver configurado na Vercel.

---

## Fila de conversão STJ/STF

A API pública do DataJud só aceita o número único (CNJ, 20 dígitos) — nunca o número
tradicional do STJ/STF (ex: "AREsp 3254978"). Esse número não dá pra resolver sozinho:
o site do STJ (`processo.stj.jus.br`) tem Cloudflare, então a resolução roda um navegador
real local (Scrapling), fora da Vercel.

**Fluxo:**
1. `js/dashboard.js` detecta o padrão (`/^a?resp\.?\s*\d/i`) na busca ou no cadastro manual,
   já cria o card na hora (editável, enquanto espera) e grava em `fila_consulta_stj`.
2. `scripts/fila_stj/rodar.bat` — rodado manualmente, quando o Matheus quiser (sem agendamento
   automático por enquanto) — abre um navegador headless via Scrapling, resolve o Cloudflare
   e cada número pendente, grava o resultado na fila. Também varre `processos` por números
   STJ "antigos" que nunca passaram pela fila (ex: cadastrados manualmente antes dela existir).
3. No final, chama `api/cron/sincronizar.js?tipo=fila_stj`, que busca no DataJud pelo número
   resolvido e importa/mescla em `processos` (mesma lógica de merge do `_importarComMerge`),
   em paralelo via `comPool` (uma consulta por item sequencial estoura o `maxDuration`).
4. Manda 1 e-mail por advogado (resumo de tudo resolvido naquela execução, só quando cria
   processo novo — não quando só mescla/corrige um existente já acompanhado).

**Ambiente do worker (fora do repo, fora do OneDrive):**
- venv: `C:\Users\mathe\scrapling-env\.venv` — criado com `uv`, tem Scrapling + supabase-py +
  python-dotenv. Fica fora do OneDrive de propósito (binário de navegador é pesado, sem
  necessidade de sincronizar pra nuvem).
- Credenciais em `scripts/fila_stj/.env` (local, fora do git): `SUPABASE_SERVICE_KEY`,
  `STJ_FILA_SECRET`.

**`STJ_FILA_SECRET` ≠ `CRON_SECRET`:** o `CRON_SECRET` nativo da Vercel só aceita "Rotate"
no painel (gera valor aleatório próprio, não aceita colar um valor manual) — por isso o
worker usa uma variável própria (`STJ_FILA_SECRET`, tipo "Config", editável normalmente),
que `api/cron/sincronizar.js` aceita como credencial alternativa.

**Armadilha de produção já pisada:** `meuprocesso.app.br` (sem `www`) faz redirect 308 pra
`www.meuprocesso.app.br`, e `requests`/curl descartam o header `Authorization` ao seguir
redirect pra outro host — isso parecia "CRON_SECRET errado" (401) mas na real nunca chegava
no handler. `SYNC_ENDPOINT` no `.env` do worker já aponta pro host `www.` direto.

---

## Convenções do código

### `dashboard.js` — organização por seção
Seções marcadas com `// ── NOME ──` (achar com `grep -n "^// ── " js/dashboard.js`). As principais:
- `BUSCA UNIFICADA` — modal de busca, DataJud, DJEN por OAB, lote
- `SUPABASE: SALVAR PROCESSO` / `SUPABASE: CARREGAR PROCESSOS`
- `TABELA` — visão padrão de Meus Processos
- `DETALHE DO PROCESSO`, `HISTÓRICO`, `COMENTÁRIOS`, `DOCUMENTOS`, `APELIDO`
- `NOTIFICAÇÕES`, `SYNC AUTOMÁTICO`, `NOVIDADES: IMPORTANTE × ROTINA`
- `INIT` — carrega os dados ao abrir o dashboard
- `COLABORADORES`, `PARCEIROS & COMPARTILHAMENTO`, `CONFIGURAÇÕES / PERFIL`
- `CALENDÁRIO: EVENTOS DO BANCO`, `KANBAN: TAREFAS DO BANCO`, `QUADROS`, `PAINEL DETALHE TAREFA`
- `IMPORTAÇÃO COM MERGE INTELIGENTE` — `_importarComMerge()` (sempre usar esta função para importar)
- `IMPORTAÇÃO EM LOTE`, `PROCESSOS DESCOBERTOS (OAB)`, `SCAN DE 1 ANO NO DJEN`, `AVISOS DA FILA STJ`
- `CLIENTES`, `HONORÁRIOS`

### Escape de HTML — obrigatório
O app monta telas com `innerHTML` + template string. Todo valor que não é literal do código
(dado do usuário, do DataJud, do DJEN, mensagem de erro) passa por:
- `_esc(s)` — texto dentro de HTML ou de atributo entre aspas
- `_jsArg(s)` — valor dentro de string JS num `onclick="f('...')"`
- `_escTextoHtml(s)` — texto que veio de HTML externo (publicação do DJEN): decodifica
  entidades e escapa
- `_hrefExterno(url)` — link externo em `href`: só aceita http(s), senão devolve `''`

`showToast()` e `_confirmar()` usam `textContent` — **não** passar `_esc` neles (mostraria `&amp;`).

### Variáveis globais importantes
```javascript
window._user          // usuário logado (Supabase Auth)
window._processosDB   // array com todos os processos do usuário (cache local)
_supabase             // cliente Supabase (de supabase-client.js)
_processoAtual        // processo aberto no detalhe
_loteResultados       // resultados da busca em lote com checkboxes
window._buscaResultados // resultados da busca individual
```

### Função de importação — SEMPRE usar `_importarComMerge(d)`
```javascript
// d = objeto normalizado do DataJud com: numero, classe, tribunal, partes, movimentos, etc.
const result = await _importarComMerge(d);
// result.status: 'importado' | 'mesclado' | 'erro'
// Preserva: apelido, cliente, notas_manuais do usuário
// Atualiza: movimentos_recentes, tribunal, orgao_julgador, classe
```

---

## Instruções de trabalho

- **NÃO commitar** sem o usuário pedir explicitamente
- **Mudanças locais primeiro** — testar antes de commitar
- Push na `main` = deploy imediato em produção (Vercel)
- O usuário (Matheus Vilar) é o advogado dono do produto — falar em português
- Preferir edições cirúrgicas a reescritas grandes
- Não adicionar comentários óbvios no código — só onde o "porquê" é não-óbvio
- Erros de coluna no Supabase geralmente = migration não aplicada → rodar a migration específica em `supabase/`
- **NUNCA rodar `schema.sql` em produção** — ele faz `DROP TABLE` em processos/tarefas e apaga dados de clientes reais
- Migrations novas devem ser só aditivas (sem DROP TABLE / DELETE / UPDATE em massa de dados)
- **Tabela nova precisa de GRANT na mesma migration** — desde 30/10/2026 o Supabase não dá mais
  acesso automático da API a tabelas criadas no schema `public`; sem isso o site recebe
  "permission denied". Tabelas que já existiam não mudam. Junto do `CREATE TABLE`:
  ```sql
  grant select, insert, update, delete on public.nova_tabela to authenticated;
  grant select, insert, update, delete on public.nova_tabela to service_role;
  -- anon só se a tela de login/landing precisar ler (raro)
  ```
  RLS continua obrigatório — o GRANT libera a API, a policy decide quais linhas cada um vê.
- Erro "schema cache" → rodar `NOTIFY pgrst, 'reload schema';` no SQL Editor
- **Todo `DELETE`/`UPDATE` em massa direto no banco (fora da UI) precisa filtrar por `user_id`**
  e mostrar um `SELECT` de prévia antes de rodar — em 08/10/2026 um delete sem esse filtro
  apagou um processo real de outro usuário junto com o de teste que era pra apagar. Sem backup
  recente daquele registro específico, a recuperação teve que ser manual.
