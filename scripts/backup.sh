#!/usr/bin/env bash
# ============================================================
# Backup do Meu Processo — baixa TODOS os dados do Supabase
#
# Por que existe: o plano grátis do Supabase NÃO tem backup restaurável.
# Se uma tabela for apagada ou uma migration der errado, não há como voltar.
# Este script guarda uma cópia na sua máquina.
#
# Como usar (uma vez por semana):
#   1. crie o arquivo .env.backup na raiz do projeto com a linha:
#        SUPABASE_SERVICE_KEY=cole_aqui_a_chave
#      (Supabase → Settings → API → service_role, "Reveal")
#   2. rode:  bash scripts/backup.sh
#
# O que é salvo em backups/AAAA-MM-DD/:
#   - um .json por tabela, com todas as linhas
#   - usuarios.json (contas e OABs)
#   - arquivos/ com os documentos enviados pelos advogados
#   - RESUMO.txt com a conferência
#
# O que NÃO é salvo: a estrutura do banco (tabelas, políticas, funções).
# Isso já está versionado em supabase/*.sql neste repositório.
# ============================================================

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="https://ctsjhsdblallguftycqs.supabase.co"
HOJE="$(date +%F)"
DESTINO="$RAIZ/backups/$HOJE"

# ── chave ────────────────────────────────────────────────────
# Aceita o arquivo na raiz do projeto ou dentro de scripts/
for LOCAL in "$RAIZ/.env.backup" "$RAIZ/scripts/.env.backup"; do
  if [ -z "${SUPABASE_SERVICE_KEY:-}" ] && [ -s "$LOCAL" ]; then
    SUPABASE_SERVICE_KEY="$(grep -E '^SUPABASE_SERVICE_KEY=' "$LOCAL" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r\n')"
  fi
done
if [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  echo "ERRO: chave não encontrada."
  echo "Crie o arquivo .env.backup na raiz do projeto com:"
  echo "  SUPABASE_SERVICE_KEY=sua_chave_service_role"
  echo "A chave está em: Supabase → Settings → API → service_role (botão Reveal)."
  exit 1
fi

TABELAS="processos tarefas prazos eventos clientes honorarios colaboradores convites \
documentos quadros quadro_compartilhamentos tarefa_comentarios processo_compartilhamentos \
assinaturas admins codigos_acesso processos_descobertos notif_log error_log djen_cadernos_fila"

mkdir -p "$DESTINO"
RESUMO="$DESTINO/RESUMO.txt"
: > "$RESUMO"

registrar() { echo "$1" | tee -a "$RESUMO"; }

registrar "Backup do Meu Processo — $(date '+%d/%m/%Y %H:%M')"
registrar "Destino: $DESTINO"
registrar ""
registrar "TABELA                         LINHAS   SITUAÇÃO"
registrar "------------------------------------------------"

FALHAS=0
TOTAL_LINHAS=0

for T in $TABELAS; do
  # Ordenar é o que garante paginação estável. Estas tabelas não têm coluna id:
  ORDEM="id"
  case "$T" in notif_log|admins) ORDEM="user_id" ;; esac

  ARQ="$DESTINO/$T.json"
  OFFSET=0
  ESPERADO=""
  BAIXADAS=0
  : > "$ARQ.partes"
  ERRO=""

  while : ; do
    CAB="$(mktemp)"
    CORPO="$(mktemp)"
    [ -n "$ORDEM" ] && PARAM_ORDEM="&order=$ORDEM" || PARAM_ORDEM=""
    HTTP=$(curl -s -m 120 -D "$CAB" -o "$CORPO" -w "%{http_code}" \
      "$URL/rest/v1/$T?select=*${PARAM_ORDEM}&limit=1000&offset=$OFFSET" \
      -H "apikey: $SUPABASE_SERVICE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
      -H "Prefer: count=exact")

    # 400 na primeira página costuma ser coluna de ordenação inexistente numa
    # tabela nova. Tenta sem ordenar (seguro: só chega aqui tabela pequena).
    if [ "$HTTP" = "400" ] && [ "$OFFSET" -eq 0 ] && [ -n "$ORDEM" ]; then
      ORDEM=""; rm -f "$CAB" "$CORPO"; continue
    fi
    if [ "$HTTP" != "200" ] && [ "$HTTP" != "206" ]; then
      ERRO="HTTP $HTTP"; rm -f "$CAB" "$CORPO"; break
    fi

    # Content-Range: 0-999/5432  → total à direita da barra
    FAIXA="$(tr -d '\r' < "$CAB" | grep -i '^content-range:' | tail -1 | awk '{print $2}')"
    [ -z "$ESPERADO" ] && ESPERADO="${FAIXA##*/}"

    # nº de linhas desta página, a partir da própria faixa (0-999 => 1000)
    PAG="${FAIXA%%/*}"
    if [ "$PAG" = "*" ] || [ -z "$PAG" ]; then
      N=0
    else
      INI="${PAG%%-*}"; FIM="${PAG##*-}"
      N=$(( FIM - INI + 1 ))
    fi

    # O PostgREST devolve o array quebrado em várias linhas ("}, \n {"), então
    # NÃO dá pra juntar linha a linha — tira só o colchete da borda da página.
    if [ "$N" -gt 0 ]; then
      [ -s "$ARQ.partes" ] && printf ',\n' >> "$ARQ.partes"
      sed -e '1s/^\[//' -e "\$s/\]\$//" "$CORPO" >> "$ARQ.partes"
    fi
    rm -f "$CAB" "$CORPO"

    BAIXADAS=$(( BAIXADAS + N ))
    OFFSET=$(( OFFSET + 1000 ))
    [ "$N" -lt 1000 ] && break
    [ "$OFFSET" -gt 500000 ] && { ERRO="passou de 500 mil linhas"; break; }
  done

  # junta as páginas num único array JSON, um registro por linha
  if [ -z "$ERRO" ]; then
    { printf '[\n'; [ -s "$ARQ.partes" ] && cat "$ARQ.partes"; printf '\n]\n'; } > "$ARQ"
  fi
  rm -f "$ARQ.partes"

  # Conferência estrutural: conta os registros DENTRO do arquivo salvo, e não
  # o que o servidor disse ter mandado. É o que pega arquivo mal montado.
  NO_ARQUIVO=$(grep -c '^ *{"' "$ARQ" 2>/dev/null || echo 0)

  ESPERADO="${ESPERADO:-0}"
  case "$ESPERADO" in ''|*[!0-9]*) ESPERADO=0 ;; esac

  if [ -n "$ERRO" ]; then
    SIT="FALHOU ($ERRO)"; FALHAS=$(( FALHAS + 1 ))
  elif [ "$BAIXADAS" -ne "$ESPERADO" ]; then
    SIT="DIVERGENTE (servidor diz $ESPERADO)"; FALHAS=$(( FALHAS + 1 ))
  elif [ ! -s "$ARQ" ]; then
    SIT="ARQUIVO VAZIO"; FALHAS=$(( FALHAS + 1 ))
  elif [ "$NO_ARQUIVO" -ne "$ESPERADO" ]; then
    SIT="ARQUIVO MAL MONTADO ($NO_ARQUIVO no arquivo x $ESPERADO baixadas)"; FALHAS=$(( FALHAS + 1 ))
  else
    SIT="ok"; TOTAL_LINHAS=$(( TOTAL_LINHAS + BAIXADAS ))
  fi
  registrar "$(printf '%-30s %7s   %s' "$T" "$BAIXADAS" "$SIT")"
done

# ── contas de usuário (ficam fora das tabelas normais) ───────
USUARIOS=0
PAGINA=1
: > "$DESTINO/usuarios.json.partes"
while : ; do
  CORPO="$(mktemp)"
  HTTP=$(curl -s -m 120 -o "$CORPO" -w "%{http_code}" \
    "$URL/auth/v1/admin/users?page=$PAGINA&per_page=1000" \
    -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY")
  if [ "$HTTP" != "200" ]; then rm -f "$CORPO"; registrar "usuarios: FALHOU (HTTP $HTTP)"; FALHAS=$(( FALHAS+1 )); break; fi
  N=$(grep -o '"id":"' "$CORPO" | wc -l | tr -d ' ')
  cat "$CORPO" >> "$DESTINO/usuarios.json.partes"; echo >> "$DESTINO/usuarios.json.partes"
  rm -f "$CORPO"
  USUARIOS=$(( USUARIOS + N ))
  [ "$N" -lt 1000 ] && break
  PAGINA=$(( PAGINA + 1 ))
done
if [ -s "$DESTINO/usuarios.json.partes" ]; then
  mv "$DESTINO/usuarios.json.partes" "$DESTINO/usuarios.json"
  registrar "$(printf '%-30s %7s   %s' "usuarios (contas)" "$USUARIOS" "ok")"
else
  rm -f "$DESTINO/usuarios.json.partes"
fi

# ── documentos enviados pelos advogados ──────────────────────
registrar ""
registrar "ARQUIVOS (bucket documentos)"
mkdir -p "$DESTINO/arquivos"
BAIXADOS=0
CAMINHOS="$(grep -o '"storage_path":"[^"]*"' "$DESTINO/documentos.json" 2>/dev/null | cut -d'"' -f4)"
if [ -n "$CAMINHOS" ]; then
  while IFS= read -r P; do
    [ -z "$P" ] && continue
    LOCAL="$DESTINO/arquivos/$P"
    mkdir -p "$(dirname "$LOCAL")"
    H=$(curl -s -m 120 -o "$LOCAL" -w "%{http_code}" \
      "$URL/storage/v1/object/documentos/$P" \
      -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY")
    if [ "$H" = "200" ] && [ -s "$LOCAL" ]; then
      BAIXADOS=$(( BAIXADOS + 1 ))
    else
      rm -f "$LOCAL"; registrar "  FALHOU: $P (HTTP $H)"; FALHAS=$(( FALHAS + 1 ))
    fi
  done <<< "$CAMINHOS"
  registrar "  $BAIXADOS arquivo(s) baixado(s)"
else
  registrar "  nenhum documento cadastrado"
fi

registrar ""
registrar "------------------------------------------------"
registrar "Total de linhas salvas: $TOTAL_LINHAS"
if [ "$FALHAS" -eq 0 ]; then
  registrar "RESULTADO: backup completo e conferido (todas as tabelas bateram com a contagem do servidor)."
else
  registrar "RESULTADO: $FALHAS PROBLEMA(S) — veja as linhas acima. NÃO considere este backup confiável."
fi
registrar ""
registrar "Restauração: a estrutura do banco está em supabase/*.sql e os dados"
registrar "nestes .json. Em caso de perda, me chame antes de tentar restaurar."

echo
echo "Backup em: $DESTINO"
[ "$FALHAS" -eq 0 ] || exit 1
