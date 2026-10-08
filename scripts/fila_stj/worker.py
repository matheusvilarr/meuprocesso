# -*- coding: utf-8 -*-
"""
Worker da fila STJ — resolve números tradicionais do STJ (ex: "AREsp 3254978")
pro número único CNJ, via scraping do processo.stj.jus.br (Scrapling,
StealthyFetcher resolve o desafio do Cloudflare sozinho).

Não roda em segundo plano: é disparado manualmente (ver rodar.bat). Atende a
fila de TODOS os usuários do sistema de uma vez (service role, ignora RLS).

Fluxo:
  1. Lê fila_consulta_stj com status='pendente' no Supabase.
  2. Pra cada linha, resolve o número único no site do STJ (uma sessão de
     navegador só resolve o Cloudflare uma vez e processa tudo em sequência).
  3. Grava o resultado (resolvido/nao_encontrado/erro) de volta na fila.
  4. No final, chama api/cron/sincronizar.js?tipo=fila_stj na Vercel — essa
     rota busca no DataJud pelo número resolvido e importa/mescla em
     `processos`, preservando o número do STJ (nunca apaga).

Uso: rodar.bat (ou `python worker.py` com o venv do Scrapling já ativado).
"""
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ctsjhsdblallguftycqs.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
CRON_SECRET = os.environ.get("CRON_SECRET", "")
SYNC_ENDPOINT = os.environ.get(
    "SYNC_ENDPOINT", "https://meuprocesso.app.br/api/cron/sincronizar?tipo=fila_stj"
)

STJ_URL = "https://processo.stj.jus.br/processo/pesquisa/"

RE_UNICO = re.compile(
    r"N[ÚU]MERO\s+[ÚU]NICO:\s*</span><span[^>]*>(?:<a[^>]*>)?\s*"
    r"(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})",
    re.IGNORECASE,
)
RE_CLASSE = re.compile(r'id="idSpanClasseDescricao">([^<]+)<')
RE_REGISTRO = re.compile(r'id="idSpanNumeroRegistro">\(([^)]+)\)<')


def consulta_normalizada(texto):
    # remove sufixo de UF tipo " - AL" — não é parte do número de registro no STJ
    return re.split(r"\s*-\s*[A-Z]{2}\s*$", texto.strip())[0].strip()


def varrer_processos_orfaos(supa):
    """Processos cadastrados ANTES da fila existir (ou por algum caminho que
    não passa pela detecção, ex: editar processo) ficam com "AREsp 3254978"
    direto no campo numero, pra sempre fora da sincronização. Roda a cada
    execução e enfileira os que ainda não foram enfileirados.
    """
    processos = supa.table("processos").select("id, user_id, numero").execute().data or []

    vistos = set()
    novas = []
    for p in processos:
        numero = (p.get("numero") or "").strip()
        if not numero:
            continue
        if len(re.sub(r"\D", "", numero)) == 20:
            continue  # já é número CNJ válido
        if not re.match(r"^a?resp\.?\s*\d", numero, re.IGNORECASE):
            continue  # não é formato reconhecido do STJ
        termo = consulta_normalizada(numero)
        chave = (p["user_id"], termo)
        if chave in vistos:
            continue
        vistos.add(chave)
        novas.append({
            "user_id": p["user_id"],
            "entrada_original": numero,
            "termo_busca": termo,
            "tribunal": "stj",
            "status": "pendente",
        })

    if not novas:
        return 0

    # upsert com ignore_duplicates: não reinicia uma linha que já estava
    # pendente/resolvida/com erro (ver unique(user_id, termo_busca))
    supa.table("fila_consulta_stj").upsert(
        novas, on_conflict="user_id,termo_busca", ignore_duplicates=True
    ).execute()
    return len(novas)


def importar_resolvidos(supa):
    """Chama a importação sempre que existir QUALQUER linha 'resolvido' na
    fila — inclusive sobras de uma execução anterior que resolveu o número
    mas não chegou a importar (ex: CRON_SECRET errado, conexão caiu). Sem
    isso, uma rodada sem nada *novo* pra resolver nunca tentava de novo o
    que já tinha ficado pra trás.
    """
    pendentes_import = (
        supa.table("fila_consulta_stj")
        .select("id", count="exact")
        .eq("status", "resolvido")
        .execute()
    )
    total = pendentes_import.count or 0
    if not total:
        print("\nNenhum número resolvido pendente de importação.")
        return

    print(f"\nImportando {total} número(s) resolvido(s) no sistema (DataJud + mesclagem em `processos`)...")
    try:
        import requests

        r = requests.get(
            SYNC_ENDPOINT,
            headers={"Authorization": f"Bearer {CRON_SECRET}"},
            timeout=60,
        )
        if r.ok:
            print(f"  OK: {r.json()}")
        else:
            print(f"  Falhou ({r.status_code}): {r.text[:300]}")
    except Exception as e:
        print(f"  Falhou ao chamar {SYNC_ENDPOINT}: {e}")


def main():
    if not SUPABASE_SERVICE_KEY:
        print("ERRO: SUPABASE_SERVICE_KEY não configurada em scripts/fila_stj/.env")
        sys.exit(1)

    supa = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    varridos = varrer_processos_orfaos(supa)
    if varridos:
        print(f"Encontrados {varridos} processo(s) antigo(s) com número do STJ — adicionados à fila.")

    pendentes = (
        supa.table("fila_consulta_stj")
        .select("id, user_id, entrada_original, termo_busca")
        .eq("status", "pendente")
        .execute()
        .data
    )

    if not pendentes:
        print("Fila vazia — nada novo pra resolver agora.")
        importar_resolvidos(supa)
        return

    print(f"{len(pendentes)} número(s) na fila. Abrindo navegador e resolvendo o Cloudflare do STJ...")

    # Import tardio: só precisa do Scrapling quando há algo pra processar,
    # evita o custo de subir o navegador à toa numa fila vazia.
    from scrapling.fetchers import StealthyFetcher

    resultados = {"resolvido": 0, "nao_encontrado": 0, "erro": 0}

    def resolver_fila(page):
        for i, linha in enumerate(pendentes):
            termo = consulta_normalizada(linha["termo_busca"])
            try:
                if i > 0:
                    page.goto(STJ_URL)
                    page.wait_for_load_state("networkidle", timeout=30000)

                page.wait_for_selector("#idNumeroProcesso", state="visible", timeout=15000)
                page.fill("#idNumeroProcesso", termo)
                page.click("#idBotaoPesquisarFormularioExtendido")
                page.wait_for_load_state("networkidle", timeout=30000)
                page.wait_for_timeout(1200)

                html = page.content()
                m_unico = RE_UNICO.search(html)
                m_classe = RE_CLASSE.search(html)
                m_registro = RE_REGISTRO.search(html)
                agora = datetime.now(timezone.utc).isoformat()

                if m_unico:
                    supa.table("fila_consulta_stj").update({
                        "status": "resolvido",
                        "numero_cnj": m_unico.group(1),
                        "classe_descricao": m_classe.group(1).strip() if m_classe else None,
                        "numero_registro_tribunal": m_registro.group(1) if m_registro else None,
                        "processado_em": agora,
                    }).eq("id", linha["id"]).execute()
                    resultados["resolvido"] += 1
                    print(f"  [OK] {linha['entrada_original']} -> {m_unico.group(1)}")
                else:
                    supa.table("fila_consulta_stj").update({
                        "status": "nao_encontrado",
                        "erro_mensagem": "Processo não encontrado no site do STJ.",
                        "processado_em": agora,
                    }).eq("id", linha["id"]).execute()
                    resultados["nao_encontrado"] += 1
                    print(f"  [--] {linha['entrada_original']} -> não encontrado")

            except Exception as e:
                supa.table("fila_consulta_stj").update({
                    "status": "erro",
                    "erro_mensagem": str(e)[:300],
                    "processado_em": datetime.now(timezone.utc).isoformat(),
                }).eq("id", linha["id"]).execute()
                resultados["erro"] += 1
                print(f"  [ERRO] {linha['entrada_original']} -> {e}")

    StealthyFetcher.fetch(
        STJ_URL,
        headless=True,
        solve_cloudflare=True,
        network_idle=True,
        page_action=resolver_fila,
    )

    print(
        f"\nResolvidos: {resultados['resolvido']} · "
        f"Não encontrados: {resultados['nao_encontrado']} · "
        f"Erros: {resultados['erro']}"
    )

    importar_resolvidos(supa)


if __name__ == "__main__":
    main()
