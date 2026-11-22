# Worker do DJEN (local)

Busca as publicações do DJEN para as OABs dos advogados **a partir deste computador**,
com a mesma rotina do cron da Vercel (`lib/djen-cadernos.js`).

**Por quê:** a API do DJEN limita e bloqueia por IP/região, e a Vercel não tem IP fixo. Na pane
de nov/2026 a API respondia normalmente de um IP residencial brasileiro enquanto as buscas do
cron paravam. Rodando daqui, a consulta sai do IP do escritório e ainda poupa execução da Vercel.

**É seguro rodar junto com o cron da Vercel:** os dois usam a mesma fila (`djen_cadernos_fila`)
e cada item é reivindicado de forma atômica, então nenhum item é processado duas vezes. O worker
não apaga nada.

## Configurar (uma vez)

1. Node instalado (`node --version` no terminal).
2. Na raiz do projeto: `npm ci` (instala as dependências; a pasta `node_modules` fica fora do git).
3. Nesta pasta, copie `exemplo.env` para `.env` e preencha. Os valores ficam com o Matheus:
   - `SUPABASE_SERVICE_KEY`: **obrigatória**
   - `STJ_FILA_SECRET`: e-mail de intimação na hora (sem ela, vai no resumo da manhã/tarde)
   - `RESEND_API_KEY`: e-mail de "processo novo encontrado" (sem ela, só aparece no painel)

   O `.env` **nunca** vai para o git (já está no `.gitignore`).

## Rodar

- Agora: duplo-clique em `rodar.bat`.
- O resultado aparece na tela e fica gravado em `worker-djen.log` (nesta pasta, fora do git).
- No painel admin, as execuções do worker aparecem no histórico do DJEN com a região `worker-local`.

## Agendar (Agendador de Tarefas do Windows)

A cada 2 horas, das 7h às 23h (o computador precisa estar ligado e com o usuário logado).
No PowerShell, **nesta pasta**:

```powershell
schtasks /Create /TN "MeuProcesso - Worker DJEN" /TR "`"$PWD\rodar.bat`" agendado" /SC DAILY /ST 07:00 /RI 120 /DU 16:00 /F
```

- Ver a tarefa: `schtasks /Query /TN "MeuProcesso - Worker DJEN"`
- Rodar na hora: `schtasks /Run /TN "MeuProcesso - Worker DJEN"`
- Remover: `schtasks /Delete /TN "MeuProcesso - Worker DJEN" /F`

Rodar mais vezes não adianta: cada OAB só é reconferida depois de 4 horas, e o DJEN aceita
cerca de 20 consultas por minuto por IP (o worker espaça 3,2s entre elas).
