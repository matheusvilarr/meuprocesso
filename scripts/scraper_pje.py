"""
Scraper de Histórico — PJe TJDFT
Busca o histórico de andamentos de um processo no portal público do TJDFT.

Uso:
    python scraper_pje.py "<numero_processo>"
    python scraper_pje.py "0700976-86.2026.8.07.0000"

Requisitos:
    pip install playwright && playwright install chromium
"""

import sys
import json
import re
import asyncio
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout


BASE_URL = "https://pje2i-consultapublica.tjdft.jus.br"

TIMEOUT_PAGE   = 30_000
TIMEOUT_RENDER = 4_000   # aguarda JS renderizar após carregar página
TIMEOUT_DETAIL = 5_000   # aguarda após navegar para página de detalhe

# Seletores confirmados via inspeção do portal TJDFT
SEL_INPUT  = "#numeroProcesso"
SEL_BOTAO  = ".btn.pesquisar"
SEL_RESULT = "a[href*='/processo/']"

PADRAO_MOVIMENTO = re.compile(
    r'(\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2})\s*-\s*(.+?)(?=\n\d{2}/\d{2}/\d{4}|\Z)',
    re.DOTALL,
)
PADRAO_CPF = re.compile(r'CPF:\s*\d{3}\.\d{3}\.\d{3}-\d{2}')
PADRAO_OAB = re.compile(r'OAB\s+\w{2}\d+')


async def buscar_historico(numero_processo: str) -> dict:
    """
    Pesquisa o processo no portal PJe do TJDFT e retorna partes + andamentos.
    """
    resultado: dict = {
        "numero":        numero_processo,
        "partes":        [],
        "movimentacoes": [],
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page    = await browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )

        try:
            print(f"  → Acessando {BASE_URL}", flush=True)
            await page.goto(BASE_URL, timeout=TIMEOUT_PAGE)
            await page.wait_for_timeout(TIMEOUT_RENDER)

            await page.fill(SEL_INPUT, numero_processo)
            await page.click(SEL_BOTAO)
            print(f"  → Pesquisando: {numero_processo}", flush=True)
            await page.wait_for_timeout(TIMEOUT_RENDER + 1_000)

            # Navega direto para a página de detalhe do processo
            href = await page.get_attribute(SEL_RESULT, "href")
            if not href:
                raise RuntimeError("Processo não encontrado ou portal não retornou resultado.")

            await page.goto(BASE_URL + href, timeout=TIMEOUT_PAGE)
            await page.wait_for_timeout(TIMEOUT_DETAIL)
            print("  → Página de detalhe carregada.", flush=True)

            # ── Partes ───────────────────────────────────────────────────────
            # Filtra apenas linhas de tabela que contêm CPF ou OAB (ignora linhas de andamentos)
            for tr in await page.query_selector_all("table tr"):
                tds = await tr.query_selector_all("td")
                if len(tds) < 2:
                    continue
                nome = (await tds[0].inner_text()).strip()
                sit  = (await tds[1].inner_text()).strip()
                if (PADRAO_CPF.search(nome) or PADRAO_OAB.search(nome)) and sit in ("Ativo", "Inativo"):
                    resultado["partes"].append({"participante": nome, "situacao": sit})

            # ── Movimentações ────────────────────────────────────────────────
            txt = await page.evaluate("document.body.innerText")

            # Isola a seção "Movimentações do Processo" até "Documentos juntados"
            ini = txt.find("Movimentações do Processo")
            fim = txt.find("Documentos juntados", ini) if ini >= 0 else -1
            secao = txt[ini:fim] if (ini >= 0 and fim > ini) else (txt[ini:] if ini >= 0 else txt)

            for m in PADRAO_MOVIMENTO.finditer(secao):
                data_hora = m.group(1).strip()
                descricao = m.group(2).strip()
                # Remove colunas extras separadas por tab (links de documentos)
                descricao = descricao.split("\t")[0].strip()
                # Normaliza espaços internos
                descricao = re.sub(r'\s+', ' ', descricao)
                resultado["movimentacoes"].append({
                    "data":      data_hora,
                    "andamento": descricao,
                })

            print(
                f"  → {len(resultado['partes'])} parte(s) | "
                f"{len(resultado['movimentacoes'])} andamento(s).",
                flush=True,
            )

        except PlaywrightTimeout as exc:
            print(f"⚠️  Timeout — verifique a conexão ou os seletores: {exc}", file=sys.stderr)
            raise
        except Exception as exc:
            print(f"❌ Erro inesperado: {exc}", file=sys.stderr)
            raise
        finally:
            await browser.close()

    return resultado


async def main() -> None:
    if len(sys.argv) < 2:
        print('Uso: python scraper_pje.py "<numero_processo>"')
        print('Ex:  python scraper_pje.py "0700976-86.2026.8.07.0000"')
        sys.exit(1)

    numero = sys.argv[1]
    print(f"🔍 Buscando histórico do processo: {numero}")

    historico = await buscar_historico(numero)

    print(json.dumps(historico, ensure_ascii=False, indent=2))
    print(f"\n✅ {len(historico['movimentacoes'])} andamento(s) encontrado(s)")


if __name__ == "__main__":
    asyncio.run(main())
