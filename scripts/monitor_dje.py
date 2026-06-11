"""
Monitor do Diário de Justiça Eletrônico (DJe) — TJDFT
Usa a API de busca do pesquisadje.tjdft.jus.br — não baixa o PDF.

Uso:
    python monitor_dje.py "DF59360"                     # busca últimos 30 dias
    python monitor_dje.py "DF59360" 2025-01-01          # a partir de uma data
    python monitor_dje.py "DF59360" 2025-01-01 2025-09-30  # intervalo específico
    python monitor_dje.py "SUZANA VILAR"                # também funciona por nome
"""

import sys
import json
import re
import datetime
import requests


BASE_URL = "https://pesquisadje.tjdft.jus.br"
PADRAO_PROCESSO = re.compile(r'\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}')


def formatar_oab(oab: str) -> str:
    """
    Normaliza o OAB para o formato usado no DJe: "DF59360".
    Aceita: "OAB/DF 59360", "59360 DF", "DF 59360", "DF59360" etc.
    """
    oab = oab.strip().upper()
    # Remove prefixo "OAB" e pontuação
    oab = re.sub(r'^OAB/?', '', oab).strip()
    # Extrai UF e número
    m = re.match(r'^([A-Z]{2})\s*(\d+)$|^(\d+)\s*([A-Z]{2})$', oab)
    if m:
        uf = m.group(1) or m.group(4)
        num = m.group(2) or m.group(3)
        return f"{uf}{num}"
    # Já está no formato certo ou não conseguimos parsear — devolve limpo
    return re.sub(r'\s+', '', oab)


def buscar_dje(
    query: str,
    data_inicio: datetime.date,
    data_fim: datetime.date,
    pagina: int = 0,
    tamanho: int = 20,
) -> dict:
    """Chama a API de busca do DJe TJDFT."""
    url = (
        f"{BASE_URL}/api/v1/buscador"
        f"?query={requests.utils.quote(query)}"
        f"&pagina={pagina}"
        f"&tamanho={tamanho}"
        f"&dataInicio={data_inicio.isoformat()}"
        f"&dataFim={data_fim.isoformat()}"
    )
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        )
    }
    res = requests.get(url, headers=headers, timeout=20)
    res.raise_for_status()
    return res.json()


def monitorar(
    oab: str,
    data_inicio: datetime.date = None,
    data_fim: datetime.date = None,
) -> list[dict]:
    """
    Busca intimações do advogado no DJe TJDFT.
    Retorna lista de publicações encontradas com preview e link.
    """
    query = formatar_oab(oab)

    if data_fim is None:
        data_fim = datetime.date.today()
    if data_inicio is None:
        data_inicio = data_fim - datetime.timedelta(days=30)

    print(
        f"  → Buscando '{query}' no DJe TJDFT de "
        f"{data_inicio.strftime('%d/%m/%Y')} a {data_fim.strftime('%d/%m/%Y')}",
        flush=True,
    )

    resultado = buscar_dje(query, data_inicio, data_fim)
    docs = resultado.get("documentos", [])
    total = resultado.get("total", 0)

    print(f"  → {total} publicação(ões) encontrada(s).", flush=True)

    saida = []
    for doc in docs:
        # Extrai número(s) de processo do preview
        preview_txt = " ".join(doc.get("preview", []))
        processos = list(dict.fromkeys(PADRAO_PROCESSO.findall(preview_txt)))

        saida.append({
            "data":            doc.get("dataDisponibilizacao"),
            "edicao":          doc.get("numero"),
            "pagina":          doc.get("pagina"),
            "numeros_processo": processos,
            "preview":         preview_txt.strip(),
            "url_diario":      doc.get("urlDiario"),
        })

    return saida


def main() -> None:
    if len(sys.argv) < 2:
        print('Uso: python monitor_dje.py "<oab>" [data_inicio] [data_fim]')
        print('Ex:  python monitor_dje.py "DF59360"')
        print('Ex:  python monitor_dje.py "DF59360" 2025-01-01')
        print('Ex:  python monitor_dje.py "DF59360" 2025-01-01 2025-09-30')
        sys.exit(1)

    oab = sys.argv[1]

    data_inicio = (
        datetime.date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else None
    )
    data_fim = (
        datetime.date.fromisoformat(sys.argv[3]) if len(sys.argv) > 3 else None
    )

    print(f"🔍 Monitor DJe — OAB: {oab}")

    try:
        resultados = monitorar(oab, data_inicio, data_fim)
    except requests.RequestException as exc:
        print(f"❌ Erro de conexão: {exc}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(resultados, ensure_ascii=False, indent=2))
    print(f"\n✅ {len(resultados)} publicação(ões) retornada(s)")


if __name__ == "__main__":
    main()
