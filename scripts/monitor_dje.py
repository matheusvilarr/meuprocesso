"""
Monitor do Diário de Justiça Eletrônico (DJe) — TJDFT
Baixa automaticamente o PDF do dia e alerta se a OAB do advogado aparece.

Uso:
    python monitor_dje.py "<oab>"              # baixa o diário de hoje
    python monitor_dje.py "<oab>" 2024-06-11   # baixa uma data específica
    python monitor_dje.py "OAB/DF 12345"
"""

import sys
import json
import re
import os
import tempfile
import datetime
import requests
import pdfplumber


# ─── Configuração do TJDFT ────────────────────────────────────────────────────
# AJUSTE: Inspecione a aba de rede do browser em https://www.tjdft.jus.br/publicacoes/diario-de-justica-eletronico
# e copie a URL exata de download do PDF. O padrão costuma ser algo como:
#   https://pesquisa.tjdft.jus.br/dspace/bitstream/.../YYYYMMDD_DJe_TJDFT.pdf
#
# Alguns tribunais expõem uma API ou endpoint com parâmetro de data, ex:
#   https://dje.tjdft.jus.br/dje/pdf?data=YYYY-MM-DD
#
# Substitua a função `montar_url_dje` com o padrão real depois de inspecionar.

def montar_url_dje(data: datetime.date) -> str:
    """
    Monta a URL de download do DJe para uma data.
    AJUSTE: substitua pelo padrão real do TJDFT após inspeção.
    """
    # Padrão de exemplo — ajuste após inspecionar o site do TJDFT
    ano  = data.strftime("%Y")
    mes  = data.strftime("%m")
    dia  = data.strftime("%d")
    return (
        f"https://pesquisa.tjdft.jus.br/search?q=DJe+{ano}{mes}{dia}&format=pdf"
        # AJUSTE: use a URL real, ex:
        # f"https://dje.tjdft.jus.br/dje/pdf?data={ano}-{mes}-{dia}"
    )


def baixar_pdf_dje(data: datetime.date) -> str:
    """
    Faz o download do DJe da data informada e salva em arquivo temporário.
    Retorna o caminho local do PDF.
    """
    url = montar_url_dje(data)
    print(f"  → Baixando DJe de {data.strftime('%d/%m/%Y')}: {url}", flush=True)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        )
    }

    try:
        res = requests.get(url, headers=headers, timeout=60, stream=True)
        res.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(f"Falha ao baixar o DJe: {exc}") from exc

    # Verifica se realmente recebeu um PDF
    content_type = res.headers.get("Content-Type", "")
    if "pdf" not in content_type and "octet-stream" not in content_type:
        raise RuntimeError(
            f"Resposta não é um PDF (Content-Type: {content_type}). "
            "Verifique a URL em montar_url_dje()."
        )

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    for chunk in res.iter_content(chunk_size=8192):
        tmp.write(chunk)
    tmp.close()

    tamanho_mb = os.path.getsize(tmp.name) / 1_048_576
    print(f"  → PDF salvo em {tmp.name} ({tamanho_mb:.1f} MB)", flush=True)
    return tmp.name


# ─── Regex ────────────────────────────────────────────────────────────────────
PADRAO_PROCESSO = re.compile(r'\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}')
SEPARADOR_BLOCO = re.compile(r'\n{2,}')


def extrair_intimacoes(caminho_pdf: str, oab: str) -> list[dict]:
    """
    Percorre o PDF e retorna blocos de texto onde a OAB aparece.
    AJUSTE: Se o DJe usar colunas, ative layout=True em extract_text().
    """
    resultados  = []
    padrao_oab  = re.compile(re.escape(oab.strip()), re.IGNORECASE)

    with pdfplumber.open(caminho_pdf) as pdf:
        total = len(pdf.pages)
        print(f"  → PDF com {total} página(s). Varrendo...", flush=True)

        for num_pagina, pagina in enumerate(pdf.pages, start=1):
            texto = pagina.extract_text(layout=False)  # AJUSTE: layout=True para colunas
            if not texto:
                continue

            for bloco in SEPARADOR_BLOCO.split(texto):
                if not padrao_oab.search(bloco):
                    continue

                processos = PADRAO_PROCESSO.findall(bloco)
                resultados.append({
                    "pagina":          num_pagina,
                    "numero_processo": processos[0] if processos else None,
                    "todos_processos": list(dict.fromkeys(processos)),
                    "bloco_texto":     bloco.strip(),
                })

    return resultados


def monitorar(oab: str, data: datetime.date = None) -> list[dict]:
    """
    Fluxo completo: baixa o DJe da data e varre em busca da OAB.
    """
    if data is None:
        data = datetime.date.today()

    caminho_pdf = baixar_pdf_dje(data)
    try:
        return extrair_intimacoes(caminho_pdf, oab)
    finally:
        os.unlink(caminho_pdf)  # apaga o temporário


def main() -> None:
    if len(sys.argv) < 2:
        print('Uso: python monitor_dje.py "<oab>" [YYYY-MM-DD]')
        print('Ex:  python monitor_dje.py "OAB/DF 12345"')
        print('Ex:  python monitor_dje.py "OAB/DF 12345" 2024-06-11')
        sys.exit(1)

    oab  = sys.argv[1]
    data = (
        datetime.date.fromisoformat(sys.argv[2])
        if len(sys.argv) > 2
        else datetime.date.today()
    )

    print(f"🔍 Buscando '{oab}' no DJe de {data.strftime('%d/%m/%Y')}")

    try:
        resultados = monitorar(oab, data)
    except RuntimeError as exc:
        print(f"❌ {exc}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(resultados, ensure_ascii=False, indent=2))
    print(f"\n✅ {len(resultados)} intimação(ões) encontrada(s)")


if __name__ == "__main__":
    main()
