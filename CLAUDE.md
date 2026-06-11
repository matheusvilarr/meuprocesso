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
│       └── verificar-atualizacoes.js  # Cron diário: verifica novos movimentos
├── scripts/
│   ├── api.py              # FastAPI — expõe scrapers como REST (porta 8000)
│   ├── scraper_pje.py      # Playwright: scraping do portal PJe TJDFT
│   ├── monitor_dje.py      # Busca intimações no DJe TJDFT via API
│   └── requirements.txt    # playwright, fastapi, uvicorn, requests
├── supabase/
│   ├── schema.sql          # Schema completo — rode no SQL Editor do Supabase
│   └── migration_tarefas_v2.sql  # Migration para adicionar colunas (não destrói dados)
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

### `tarefas`
- `titulo` (not null) — descrição da tarefa
- `coluna` — `a_fazer` | `em_andamento` | `revisao` | `concluida`
- `prioridade` — `baixa` | `media` | `urgente`
- `prazo` (date)
- `processo_id` (FK opcional)

### `prazos`
- `descricao`, `data_prazo`, `urgencia`, `tipo`, `notificar_dias`

### `colaboradores`
- Membros do escritório vinculados ao `escritorio_id` (= user_id do advogado principal)

**RLS ativo em todas as tabelas** — cada usuário vê só seus próprios dados.

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
- Erros de coluna no Supabase geralmente = tabela não criada ou schema desatualizado → rodar `schema.sql`
- Erro "schema cache" → rodar `NOTIFY pgrst, 'reload schema';` no SQL Editor
