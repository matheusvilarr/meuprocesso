# Backup do banco — como fazer

O plano grátis do Supabase **não tem backup que você possa restaurar**. Se uma
tabela for apagada, uma migration der errado ou a conta for perdida, os dados
dos clientes vão junto. Este backup é a única proteção que existe hoje.

## Configuração (uma vez só)

1. No Supabase, vá em **Settings → API**.
2. Na seção **Project API keys**, ache a linha **`service_role`** e clique em
   **Reveal**. Copie a chave.
3. Na pasta do projeto, crie um arquivo chamado **`.env.backup`** com uma linha:

   ```
   SUPABASE_SERVICE_KEY=cole_a_chave_aqui
   ```

Esse arquivo **não vai para o Git** (já está no `.gitignore`). Essa chave dá
acesso total ao banco, sem nenhuma restrição — trate como a senha principal do
sistema. Não cole em e-mail, chat nem em conversa comigo.

## Fazer o backup (uma vez por semana)

Dê **duplo clique em `scripts/backup.bat`**.

Ou, pelo terminal do VS Code:

```bash
bash scripts/backup.sh
```

Demora de alguns segundos a poucos minutos, conforme o volume.

## Como saber se deu certo

No fim aparece uma destas duas linhas:

- **`RESULTADO: backup completo e conferido`** — pode confiar. O script comparou,
  tabela por tabela, a quantidade de linhas que baixou com a quantidade que o
  servidor informou ter. Só diz isso quando todas batem.
- **`RESULTADO: N PROBLEMA(S)`** — **não confie neste backup.** Rode de novo; se
  insistir, me chame com o conteúdo do `RESUMO.txt`.

## Onde fica

```
backups/2026-09-30/
  RESUMO.txt              conferência (leia este primeiro)
  processos.json          um arquivo por tabela
  clientes.json
  honorarios.json
  ...
  usuarios.json           contas, e-mails e OABs
  arquivos/               documentos enviados pelos advogados
```

**Importante:** essa pasta tem dados de clientes reais. Ela fica dentro do
OneDrive, então já sobe para a nuvem automaticamente — o que é bom para não
perder, mas quer dizer que quem tiver acesso ao seu OneDrive tem acesso a esses
dados.

Guarde pelo menos os 4 backups mais recentes. Os antigos pode apagar.

## O que este backup cobre e o que não cobre

**Cobre:** todos os dados — processos, movimentações, clientes, honorários,
tarefas, prazos, compartilhamentos, assinaturas, contas de usuário e os
documentos enviados.

**Não cobre:** a estrutura do banco (tabelas, políticas de acesso, funções).
Isso está versionado nos arquivos `supabase/*.sql` deste repositório.

Ou seja: **repositório + pasta de backup = tudo que é necessário para
reconstruir o sistema.** Um backup sozinho não basta.

## Se precisar restaurar

Me chame antes de tentar. Restaurar na ordem errada quebra as ligações entre
processos, clientes e honorários. A ordem correta é: estrutura primeiro
(`supabase/*.sql`), depois contas, depois as tabelas na ordem de dependência.

## Quando isso deixa de ser necessário

O plano **Supabase Pro (US$ 25/mês)** inclui backup diário automático com
restauração por um clique. Quando o sistema começar a ser cobrado, vale migrar:
aí o backup manual vira uma segunda camada, não a única.
