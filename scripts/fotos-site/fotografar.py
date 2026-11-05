# Fotos da home (img/screenshots/home/) tiradas do sistema REAL — dashboard.html/js/css sem
# alteração — com o banco dublê (supabase-dubla.js: advogada e processos fictícios, nada
# fala com o Supabase de verdade). Refazer quando a tela do sistema mudar:
#   python scripts/fotos-site/fotografar.py            (as 5 telas usadas na home)
#   python scripts/fotos-site/fotografar.py dashboard  (só uma)
# Precisa de Node e Playwright. O e-mail do celular (email-celular.jpg) sai de
# email.mjs (modelo real do sistema, itens fictícios). Depois de fotografar, rodar otimizar.py.
import json, subprocess, sys, time, os
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright

AQUI = Path(__file__).parent
REPO = str(Path(__file__).resolve().parents[2])
SAIDA = Path(REPO) / "img" / "screenshots" / "home"; SAIDA.mkdir(parents=True, exist_ok=True)
PORTA = 3011
DUBLA = (AQUI / "supabase-dubla.js").read_text(encoding="utf-8")
so = sys.argv[1:] or ["email-celular", "dashboard", "processos", "calendario", "tarefas", "honorarios", "descobertos-recorte", "timeline-recorte", "tarefas-recorte", "prazos-recorte", "calendario-recorte", "honorarios-recorte"]

hoje = date.today()
d = lambda n: (hoje + timedelta(days=n)).isoformat()
def sug(i, numero, classe, trib, autor, reu, tipo, dias, hist):
    return {"id": f"s{i}", "numero": numero, "tribunal": trib, "encontrado_em": d(dias) + "T12:00:00Z",
            "dados": {"numero": numero, "tribunal": trib, "classe": classe, "orgaoJulgador": "",
                      "partes": [{"nome": autor, "tipo": "Autor"}, {"nome": reu, "tipo": "Réu"}],
                      "_historico": hist, "_intimacao": {"nome": f"DJEN — Intimação · {tipo}", "data": d(dias) + "T00:00:00"}}}
DESCOBERTOS = [
    sug(1, "0716402-88.2026.8.07.0001", "Procedimento Comum Cível", "TJDFT", "Vinícius Andrade Lobo", "Seguradora Brasília Previdência", "Decisão", 0, False),
    sug(2, "0002215-41.2026.5.10.0007", "Ação Trabalhista - Rito Ordinário", "TRT10", "Cíntia Mendes Carvalho", "Supermercados Planalto Ltda.", "Despacho", -1, False),
    sug(3, "0729931-07.2025.8.07.0001", "Cumprimento de Sentença", "TJDFT", "Construtora Serra Dourada Ltda.", "Edifício Mirante do Lago", "Intimação", -48, True),
    sug(4, "0701182-63.2025.8.07.0016", "Procedimento do Juizado Especial Cível", "TJDFT", "Otávio Brandão Leal", "Telefonia Centro-Oeste S.A.", "Sentença", -95, True),
    sug(5, "1018840-29.2024.4.01.3400", "Procedimento Comum Cível", "TRF1", "Maria das Graças Penha", "Instituto Nacional do Seguro Social", "Despacho", -210, True),
]

servidor = subprocess.Popen(["node", "scripts/servidor-local.mjs", str(PORTA)], cwd=REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1.6, locale="pt-BR",
                            timezone_id="America/Sao_Paulo")
        def rota(route):
            u = route.request.url
            if "supabase-client.js" in u:
                return route.fulfill(status=200, content_type="text/javascript", body=DUBLA)
            if "processos-descobertos" in u:
                return route.fulfill(status=200, content_type="application/json", body=json.dumps({"descobertos": DESCOBERTOS}))
            if any(x in u for x in ("googletagmanager", "googlesyndication", "google-analytics", "comunicaapi", "datajud")):
                return route.abort()
            if "/api/" in u:
                return route.fulfill(status=200, content_type="application/json", body="{}")
            return route.continue_()
        ctx.route("**/*", rota)
        pg = ctx.new_page()
        erros = []
        pg.on("pageerror", lambda e: erros.append(str(e)[:160]))
        pg.goto(f"http://localhost:{PORTA}/dashboard", wait_until="networkidle")
        pg.wait_for_timeout(2500)

        def foto(nome, prep=None, espera=1200, clip=None):
            if prep: pg.evaluate(prep)
            pg.wait_for_timeout(espera)
            if nome not in so: return
            if clip == "auto": clip = pg.evaluate("window.__clip")
            pg.screenshot(path=str(SAIDA / f"{nome}.jpg"), type="jpeg", quality=86, clip=clip)
            print("ok", nome)

        foto("dashboard")
        recorte = lambda sel: "(() => { const el = %s; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); window.__clip = {x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12}; })()" % sel
        foto("prazos-recorte", recorte("document.getElementById('dash-prazos-recentes').closest('.card')"), 500, clip="auto")
        foto("compromissos-recorte", recorte("document.getElementById('card-compromissos-dia')"), 500, clip="auto")
        pg.evaluate("window.scrollTo(0, 0)")
        foto("processos", "showPage('processos')")
        foto("descobertos", "abrirModalDescobertos()")
        foto("descobertos-recorte", "(() => { const m = document.querySelector('#modal-descobertos .modal'); const r = m.getBoundingClientRect(); window.__clip = {x: r.x, y: r.y, width: r.width, height: r.height}; })()", 300, clip="auto")
        foto("detalhe", "closeModal('modal-descobertos'); abrirProcesso('p1')", 2000)
        foto("detalhe-timeline", "window.scrollTo(0, 620); document.querySelector('.main')?.scrollTo(0, 620)", 800)
        foto("timeline-recorte", None, 300, clip={"x": 104, "y": 272, "width": 534, "height": 600})
        foto("calendario", "showPage('calendario'); window.scrollTo(0, 0)", 1800)
        foto("calendario-recorte", None, 300, clip={"x": 100, "y": 184, "width": 960, "height": 560})
        foto("tarefas", "showPage('tarefas'); window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0)", 1800)
        foto("tarefas-recorte", None, 300, clip={"x": 104, "y": 284, "width": 990, "height": 616})
        foto("honorarios", "showPage('honorarios'); window.scrollTo(0, 0)", 1500)
        foto("honorarios-recorte", None, 300, clip={"x": 100, "y": 184, "width": 1320, "height": 432})
        # E-mail de aviso como aparece no celular (modelo real, itens fictícios)
        if "email-celular" in so:
            tmp = AQUI / "_email.html"
            subprocess.run(["node", str(AQUI / "email.mjs"), str(tmp)], cwd=REPO, check=True)
            cel = b.new_page(viewport={"width": 360, "height": 700}, device_scale_factor=2.5, is_mobile=True)
            cel.goto(tmp.as_uri()); cel.wait_for_timeout(400)
            cel.add_style_tag(content="body > div{margin:0 auto!important;border-radius:0!important;box-shadow:none!important}")
            cel.screenshot(path=str(SAIDA / "email-celular.jpg"), type="jpeg", quality=88, clip={"x": 0, "y": 0, "width": 360, "height": 680})
            tmp.unlink(); cel.close(); print("ok email-celular")
        print("erros:", erros)
        b.close()
finally:
    servidor.terminate()
