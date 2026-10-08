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
├── login.html              # Tela de login
├── index.html              # Landing page / redirect
├── css/
│   └── dashboard.css       # Estilos do dashboard
├── js/
│   ├── dashboard.js        # TODA a lógica do frontend (~2700 linhas)
│   └── supabase-client.js  # Inicializa Supabase (_supabase global)
├── api/
│   ├── buscar-processo.js  # Proxy DataJud CNJ (busca por número, OAB, nome, CPF)
│   ├── salvar-evento.js    # Salva eventos de calendário
│   ├── upload-avatar.js    # Upload de foto de perfil
│   └── cron/
│       ├── sincronizar.js             # Cron principal: DataJud (?tipo=datajud), DJEN
│       │                               # (?tipo=djen), OAB scan (?tipo=oab) e fila STJ
│       │                               # (?tipo=fila_stj — ver seção própria abaixo)
│       └── verificar-atualizacoes.js  # Cron de e-mail: lê o que sincronizar.js gravou
├── lib/
│   ├── sync-comum.js       # Funções compartilhadas entre crons (DataJud, e-mail, etc.)
│   └── djen-cadernos.js    # Lógica do cron de cadernos do DJEN
├── scripts/
│   ├── api.py              # FastAPI — expõe scrapers como REST (porta 8000)
│   ├── scraper_pje.py      # Playwright: scraping do portal PJe TJDFT
│   ├── monitor_dje.py      # Busca intimações no DJe TJDFT via API
│   ├── requirements.txt    # playwright, fastapi, uvicorn, requests
│   └── fila_stj/           # Worker da fila STJ/STF — ver seção própria abaixo
│       ├── worker.py
│       ├── requirements.txt
│       ├── rodar.bat       # Duplo-clique pra rodar (venv fica fora do repo)
│       └── .env            # Local, fora do git (SUPABASE_SERVICE_KEY, STJ_FILA_SECRET)
├── supabase/
│   ├── schema.sql          # Schema completo — rode no SQL Editor do Supabase
│   └── migration_*.sql     # Migrations aditivas (não destroem dados) — rodar uma por uma
├── Dockerfile              # Para rodar o backend Python em servidor (ex: Railway)
└── vercel.json             # Rotas, cache e cron job da Vercel
```

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

### `tarefas`
- `titulo` (not null) — descrição da tarefa
- `coluna` — `a_fazer` | `em_andamento` | `revisao` | `concluida`
- `prioridade` — `baixa` | `media` | `urgente`
- `prazo` (date)
- `processo_id` (FK opcional)

### `prazos`
- `descricao`, `data_prazo`, `urgencia`, `tipo`, `notificar_dias`

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
O Supabase é sempre remoto — localhost não afeta o banco.

---

## Funcionalidades e estado atual

### ✅ Funcionando
- Login / logout / recuperação de senha (Supabase Auth)
- **Workspace colaborativo (Fase 1)**: convite por link, até 3 colaboradores, RLS compartilhado
- Cadastro manual de processos
- Busca por número CNJ (DataJud) — individual e em lote (cole vários números)
- Busca por OAB, nome advogado, nome cliente, CPF (DataJud — requer vercel dev ou produção)
- Multi-select nos resultados: importar vários processos de uma vez
- Merge inteligente: processo já cadastrado é atualizado, dados do advogado preservados
- Apelido editável: campo separado do título, editável pelo card (lápis no hover) ou no detalhe
- Monitoramento CNJ: cron diário verifica movimentos novos, badge de notificação
- Timeline de movimentos + notas manuais
- Calendário e prazos
- Kanban de tarefas
- Colaboradores
- Arquivamento de processos
- DJe TJDFT: busca por OAB/nome direto do browser (sem Python)
- **Fila de conversão STJ/STF**: número tradicional (AREsp/REsp) na busca ou cadastro manual → card criado na hora → worker local resolve o número único via scraping → importa/mescla automaticamente, preservando o número do STJ e um histórico completo — ver seção própria abaixo

### 🔧 Em manutenção / incompleto
- **Página TJDFT**: desabilitada visualmente com aviso "em manutenção"
  - DJe: funciona no browser, mas o card está desabilitado junto com o PJe
  - PJe (scraper): requer servidor Python rodando — não disponível em produção ainda
  - Para ativar: remover `opacity:0.45;pointer-events:none` do grid em `dashboard.html` linha ~725
- **Backend Python em produção**: Dockerfile criado, planejado para Railway (~$5/mês)
  - Por enquanto só funciona local: `cd scripts && python api.py`
  - `PYTHON_API` em `dashboard.js` aponta para `localhost:8000` (local) ou Railway (produção)

### 📋 TODOs conhecidos
- Servidor Python para produção (Railway ou servidor próprio do cliente)
- Notificação automática DJe: cron que busca OAB de cada usuário e push notification
- Busca por OAB no DataJud retorna campos limitados por LGPD (partes podem vir vazias)

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
Seções marcadas com `// ── NOME ──`:
- `SUPABASE / AUTH` — login, sessão, carregamento inicial
- `NAVEGAÇÃO` — `showPage()`, sidebar
- `PROCESSOS` — CRUD, cards, filtros
- `DETALHE` — `popularDetalhe()`, timeline, notas, apelido
- `BUSCA NO TRIBUNAL` — modal, DataJud, lote, merge
- `IMPORTAÇÃO COM MERGE` — `_importarComMerge()` (sempre usar esta função para importar)
- `IMPORTAÇÃO EM LOTE` — `_loteResultados`, checkboxes, `importarLoteSelecionados()`
- `TAREFAS` — kanban, drag-and-drop
- `TJDFT` — DJe browser-direct, PJe via Python API
- `DJe` — `rodarMonitorDJe()`, cross-reference com `_processosDB`

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
- Erro "schema cache" → rodar `NOTIFY pgrst, 'reload schema';` no SQL Editor
- **Todo `DELETE`/`UPDATE` em massa direto no banco (fora da UI) precisa filtrar por `user_id`**
  e mostrar um `SELECT` de prévia antes de rodar — em 08/10/2026 um delete sem esse filtro
  apagou um processo real de outro usuário junto com o de teste que era pra apagar. Sem backup
  recente daquele registro específico, a recuperação teve que ser manual.
