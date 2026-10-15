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
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ctsjhsdblallguftycqs.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
STJ_FILA_SECRET = os.environ.get("STJ_FILA_SECRET", "")
SYNC_ENDPOINT = os.environ.get(
    # www. direto: meuprocesso.app.br (sem www) redireciona (308), e o requests
    # derruba o header Authorization ao seguir redirect pra outro host —
    # virava 401 mesmo com o STJ_FILA_SECRET certo. Achado em 12/10/2026.
    "SYNC_ENDPOINT", "https://www.meuprocesso.app.br/api/cron/sincronizar?tipo=fila_stj"
)

STJ_URL = "https://processo.stj.jus.br/processo/pesquisa/"

RE_UNICO = re.compile(
    r"N[ÚU]MERO\s+[ÚU]NICO:\s*</span><span[^>]*>(?:<a[^>]*>)?\s*"
    r"(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})",
    re.IGNORECASE,
)
RE_CLASSE = re.compile(r'id="idSpanClasseDescricao">([^<]+)<')
RE_REGISTRO = re.compile(r'id="idSpanNumeroRegistro">\(([^)]+)\)<')


RE_STJ = re.compile(r"\b(a?resp)\b\.?\s*(?:n[º°o]?\.?\s*)?(\d[\d.]*)", re.IGNORECASE)


def normalizar_stj(texto):
    """Mesma regra de lib/sync-comum.js (normalizarNumeroSTJ):
    "REsp nº 2280984 / AL", "AgInt no AREsp 3.080.419/AL", "AREsp 2722519 - AL"
    -> "REsp 2280984" / "AREsp 3080419" / "AREsp 2722519". None se não for STJ."""
    s = str(texto or "")
    if len(re.sub(r"\D", "", s)) == 20:
        return None
    m = RE_STJ.search(s)
    if not m:
        return None
    num = re.sub(r"\D", "", m.group(2))
    if not 5 <= len(num) <= 8:
        return None
    return ("AREsp " if m.group(1).lower() == "aresp" else "REsp ") + num


CLASSES_STF = ["ARE", "RE", "AI", "Rcl", "ADI", "ADPF", "ADC", "ADO", "MI"]
RE_STF = re.compile(r"\b(ARE|RE|AI|Rcl|ADI|ADPF|ADC|ADO|MI)\b\.?\s*(?:n[º°o]?\.?\s*)?(\d[\d.]*)", re.IGNORECASE)


def normalizar_superior(texto):
    """STJ ou STF -> (tribunal, termo). Mesma regra de lib/sync-comum.js
    (normalizarNumeroSuperior): classes do STF só as que não existem no STJ."""
    stj = normalizar_stj(texto)
    if stj:
        return ("stj", stj)
    s = str(texto or "")
    if len(re.sub(r"\D", "", s)) == 20:
        return None
    m = RE_STF.search(s)
    if not m:
        return None
    num = re.sub(r"\D", "", m.group(2))
    if not 3 <= len(num) <= 8:
        return None
    classe = next(c for c in CLASSES_STF if c.lower() == m.group(1).lower())
    return ("stf", f"{classe} {num}")


def consulta_normalizada(texto):
    r = normalizar_superior(texto)
    return r[1] if r else texto.strip()


def ler_tudo(query_fn):
    """O supabase-py devolve no máximo 1000 linhas por consulta — sem paginar,
    o que passasse disso sumia sem aviso (o banco já tem ~830 processos)."""
    linhas, inicio = [], 0
    while True:
        lote = query_fn().range(inicio, inicio + 999).execute().data or []
        linhas.extend(lote)
        if len(lote) < 1000:
            return linhas
        inicio += 1000


def varrer_processos_orfaos(supa):
    """Cartões ativos com número do STJ e sem tribunal (cadastrados antes da
    fila existir, colados de novo, digitados num formato que a detecção antiga
    não pegava...). Três destinos:
      - nunca enfileirado            -> entra na fila como 'pendente'
      - já resolvido/importado antes -> volta pra 'resolvido', e a importação
        na Vercel junta esse cartão solto no processo CNJ (sem consultar o STJ de novo)
      - deu erro                     -> nova tentativa (ver retentar_erros)
    """
    processos = ler_tudo(lambda: supa.table("processos")
                         .select("id, user_id, numero")
                         .is_("datajud_index", "null")
                         .neq("status", "Arquivado"))
    fila = ler_tudo(lambda: supa.table("fila_consulta_stj")
                    .select("id, user_id, termo_busca, entrada_original, status, numero_cnj"))
    na_fila = {}
    for f in fila:
        # também pela entrada original: "ARE 3068207" que virou "AREsp 3068207"
        # no STJ (ver resolver_stf) continua sendo reconhecido como já na fila
        na_fila[(f["user_id"], consulta_normalizada(f.get("entrada_original") or ""))] = f
        na_fila[(f["user_id"], consulta_normalizada(f["termo_busca"]))] = f

    vistos, novas, reabrir = set(), [], set()
    for p in processos:
        sup = normalizar_superior(p.get("numero"))
        if not sup:
            continue
        tribunal, termo = sup
        chave = (p["user_id"], termo)
        if chave in vistos:
            continue
        vistos.add(chave)
        linha = na_fila.get(chave)
        if not linha:
            novas.append({
                "user_id": p["user_id"],
                "entrada_original": p["numero"].strip(),
                "termo_busca": termo,
                "tribunal": tribunal,
                "status": "pendente",
            })
        elif linha["status"] == "importado" and linha.get("numero_cnj"):
            reabrir.add(linha["id"])

    if novas:
        supa.table("fila_consulta_stj").upsert(
            novas, on_conflict="user_id,termo_busca", ignore_duplicates=True
        ).execute()
    for fid in reabrir:
        supa.table("fila_consulta_stj").update({"status": "resolvido"}).eq("id", fid).eq("status", "importado").execute()
    return len(novas), len(reabrir)


def retentar_erros(supa):
    """Erro (site do STJ fora, timeout, DataJud lento) não é definitivo — antes
    ficava 'erro' pra sempre. Espera 2h entre tentativas pra não martelar.
    Quem já tem o número CNJ volta direto pra importação, sem novo scraping."""
    limite = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    erros = ler_tudo(lambda: supa.table("fila_consulta_stj")
                     .select("id, numero_cnj")
                     .eq("status", "erro")
                     .lt("processado_em", limite))
    for f in erros:
        novo = "resolvido" if f.get("numero_cnj") else "pendente"
        supa.table("fila_consulta_stj").update({"status": novo}).eq("id", f["id"]).eq("status", "erro").execute()
    return len(erros)


def importar_resolvidos(supa):
    """Chama a importação sempre que existir QUALQUER linha 'resolvido' na
    fila — inclusive sobras de uma execução anterior que resolveu o número
    mas não chegou a importar (ex: STJ_FILA_SECRET errado, conexão caiu). Sem
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

        # 130s: a rota tem maxDuration de 120s na Vercel — com 60s o worker
        # desistia e dizia "falhou" enquanto a importação ainda estava rodando.
        r = requests.get(
            SYNC_ENDPOINT,
            headers={"Authorization": f"Bearer {STJ_FILA_SECRET}"},
            timeout=130,
        )
        if r.ok:
            print(f"  OK: {r.json()}")
        else:
            print(f"  Falhou ({r.status_code}): {r.text[:300]}")
    except Exception as e:
        print(f"  Falhou ao chamar {SYNC_ENDPOINT}: {e}")


def marcar(supa, linha_id, campos):
    campos = {**campos, "processado_em": datetime.now(timezone.utc).isoformat()}
    supa.table("fila_consulta_stj").update(campos).eq("id", linha_id).execute()


def resolver_stj(supa, linhas, resultados, Fetcher):
    def acao(page):
        for i, linha in enumerate(linhas):
            termo = consulta_normalizada(linha["termo_busca"])
            via_stf = linha.get("_veio_do_stf")
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

                if m_unico:
                    campos = {
                        "status": "resolvido",
                        "numero_cnj": m_unico.group(1),
                        "classe_descricao": m_classe.group(1).strip() if m_classe else None,
                        "numero_registro_tribunal": m_registro.group(1) if m_registro else None,
                    }
                    if via_stf:
                        # Era "ARE 3068207" digitado sem o "sp": passa a ser
                        # registrado como STJ. A entrada original fica intacta.
                        try:
                            marcar(supa, linha["id"], {**campos, "termo_busca": termo, "tribunal": "stj"})
                        except Exception:
                            marcar(supa, linha["id"], campos)   # termo já existe na fila desse usuário
                    else:
                        marcar(supa, linha["id"], campos)
                    resultados["resolvido"] += 1
                    print(f"  [OK] {linha['entrada_original']} -> {m_unico.group(1)}" + (f" (achado no STJ como {termo})" if via_stf else ""))
                else:
                    marcar(supa, linha["id"], {
                        "status": "nao_encontrado",
                        "erro_mensagem": "Processo não encontrado no STF nem no STJ." if via_stf else "Processo não encontrado no site do STJ.",
                    })
                    resultados["nao_encontrado"] += 1
                    print(f"  [--] {linha['entrada_original']} -> não encontrado")

            except Exception as e:
                marcar(supa, linha["id"], {"status": "erro", "erro_mensagem": str(e)[:300]})
                resultados["erro"] += 1
                print(f"  [ERRO] {linha['entrada_original']} -> {e}")

    Fetcher.fetch(STJ_URL, headless=True, solve_cloudflare=True, network_idle=True, page_action=acao)


STF_URL = "https://portal.stf.jus.br/"
RE_UNICO_STF = re.compile(r"N[úu]mero [ÚU]nico:\s*(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})", re.IGNORECASE)


def resolver_stf(supa, linhas, resultados, Fetcher):
    """Portal do STF: a busca só roda pelo formulário (o link direto
    listarProcessos.asp?classe=...&numeroProcesso=... volta vazio sem a sessão
    da página inicial). Testado em 15/10/2026 com ARE 1450000.
    ARE/RE que não existe no STF volta como AREsp/REsp pra tentar no STJ:
    a numeração do ARE no STF está na casa de 1,5 milhão, e "ARE 3068207"
    (Pedro) era o AREsp 3068207 do STJ digitado sem o "sp"."""
    para_stj = []

    def acao(page):
        for linha in linhas:
            classe, num = linha["termo_busca"].split(" ", 1)
            try:
                page.goto(STF_URL)
                page.wait_for_load_state("networkidle", timeout=30000)
                page.select_option("#tipo-pesquisa-processo", "CLASSE_E_NUMERO")
                page.select_option("#Siglas", classe)
                page.fill("#pesquisaPrincipalClasseNumero", num)
                page.press("#pesquisaPrincipalClasseNumero", "Enter")
                page.wait_for_load_state("networkidle", timeout=30000)
                page.wait_for_timeout(2500)

                texto = re.sub(r"<[^>]+>", " ", page.content()).replace("&nbsp;", " ")
                texto = re.sub(r"\s+", " ", texto)
                m_unico = RE_UNICO_STF.search(texto)

                if m_unico:
                    marcar(supa, linha["id"], {
                        "status": "resolvido",
                        "numero_cnj": m_unico.group(1),
                        "numero_registro_tribunal": linha["termo_busca"],
                    })
                    resultados["resolvido"] += 1
                    print(f"  [OK] {linha['entrada_original']} -> {m_unico.group(1)} (STF)")
                elif classe in ("ARE", "RE") and len(num) >= 5:
                    termo_stj = ("AREsp " if classe == "ARE" else "REsp ") + num
                    para_stj.append({**linha, "termo_busca": termo_stj, "_veio_do_stf": True})
                    print(f"  [->] {linha['entrada_original']} não existe no STF — tentando {termo_stj} no STJ")
                else:
                    marcar(supa, linha["id"], {
                        "status": "nao_encontrado",
                        "erro_mensagem": "Processo não encontrado no site do STF.",
                    })
                    resultados["nao_encontrado"] += 1
                    print(f"  [--] {linha['entrada_original']} -> não encontrado no STF")

            except Exception as e:
                marcar(supa, linha["id"], {"status": "erro", "erro_mensagem": str(e)[:300]})
                resultados["erro"] += 1
                print(f"  [ERRO] {linha['entrada_original']} -> {e}")

    Fetcher.fetch(STF_URL, headless=True, network_idle=True, page_action=acao)
    return para_stj


def main():
    if not SUPABASE_SERVICE_KEY:
        print("ERRO: SUPABASE_SERVICE_KEY não configurada em scripts/fila_stj/.env")
        sys.exit(1)

    supa = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    novos, reabertos = varrer_processos_orfaos(supa)
    if novos:
        print(f"{novos} cartão(ões) com número do STJ/STF fora da fila — adicionados.")
    if reabertos:
        print(f"{reabertos} cartão(ões) duplicado(s) de número já convertido — vão ser juntados ao processo CNJ.")
    retentados = retentar_erros(supa)
    if retentados:
        print(f"{retentados} item(ns) que deram erro antes — tentando de novo.")

    pendentes = ler_tudo(lambda: supa.table("fila_consulta_stj")
                         .select("id, user_id, entrada_original, termo_busca, tribunal")
                         .eq("status", "pendente"))

    if not pendentes:
        print("Fila vazia — nada novo pra resolver agora.")
        importar_resolvidos(supa)
        return

    # Import tardio: só precisa do Scrapling quando há algo pra processar,
    # evita o custo de subir o navegador à toa numa fila vazia.
    from scrapling.fetchers import StealthyFetcher

    resultados = {"resolvido": 0, "nao_encontrado": 0, "erro": 0}
    do_stf = [l for l in pendentes if l.get("tribunal") == "stf"]
    do_stj = [l for l in pendentes if l.get("tribunal") != "stf"]

    # STF primeiro: ARE/RE que não existe lá volta como AREsp/REsp pro STJ
    # nesta mesma rodada (erro comum de digitação — ver resolver_stf).
    if do_stf:
        print(f"{len(do_stf)} número(s) do STF na fila. Abrindo navegador...")
        do_stj += resolver_stf(supa, do_stf, resultados, StealthyFetcher)
    if do_stj:
        print(f"{len(do_stj)} número(s) do STJ na fila. Abrindo navegador e resolvendo o Cloudflare do STJ...")
        resolver_stj(supa, do_stj, resultados, StealthyFetcher)

    print(
        f"\nResolvidos: {resultados['resolvido']} · "
        f"Não encontrados: {resultados['nao_encontrado']} · "
        f"Erros: {resultados['erro']}"
    )

    importar_resolvidos(supa)


if __name__ == "__main__":
    main()
