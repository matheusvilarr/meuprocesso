# Gera as versões WebP em vários tamanhos das fotos da home (img/screenshots/home/*.jpg)
# e uma logo pequena, usando o próprio Chromium do Playwright (sem Pillow).
# O navegador escolhe pelo srcset a menor que serve pra tela — no celular a foto do
# topo cai de 252 KB pra ~30 KB. Rodar depois de fotografar.py.
import base64, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
PASTA = REPO / "img" / "screenshots" / "home"
# nome -> larguras geradas (nunca maiores que o original)
TAMANHOS = {
    "processos":           [640, 960, 1320, 1760],
    "dashboard":           [640, 960, 1320, 1760],
    # telas inteiras da animação do notebook (só cabem ~720 px de largura)
    "calendario":          [720, 1320],
    "tarefas":             [720, 1320],
    "honorarios":          [720, 1320],
    "tarefas-recorte":     [480, 720, 1080, 1400],
    "descobertos-recorte": [480, 720, 860],
    "timeline-recorte":    [440, 660, 854],
    "prazos-recorte":      [440, 660, 900],
    "calendario-recorte":  [480, 720, 1080, 1400],
    "honorarios-recorte":  [640, 960, 1320, 1760],
    "email-celular":       [300, 450, 600, 900],
}
LOGO = [("img/images/logo.png", "img/images/logo-96.png", 96)]

JS = """async ([url, largura, tipo, q]) => {
  const img = new Image(); img.src = url; await img.decode();
  const w = Math.min(largura, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
  return [c.toDataURL(tipo, q), w, h];
}"""

# Canvas com imagem de file:// fica "tainted" e não exporta — serve pelo servidor local.
PORTA = 3014
srv = subprocess.Popen(["node", "scripts/servidor-local.mjs", str(PORTA)], cwd=REPO,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
BASE = f"http://localhost:{PORTA}"
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.goto(BASE + "/termos")
    for nome, larguras in TAMANHOS.items():
        origem = f"{BASE}/img/screenshots/home/{nome}.jpg"
        for L in larguras:
            dados, w, h = pg.evaluate(JS, [origem, L, "image/webp", 0.8])
            destino = PASTA / f"{nome}-{w}.webp"
            destino.write_bytes(base64.b64decode(dados.split(",", 1)[1]))
            print(f"{destino.name:32} {w}x{h}  {destino.stat().st_size/1024:.0f} KB")
    for origem, destino, L in LOGO:
        dados, w, h = pg.evaluate(JS, [f"{BASE}/{origem}", L, "image/png", None])
        (REPO / destino).write_bytes(base64.b64decode(dados.split(",", 1)[1]))
        print(f"{destino:32} {w}x{h}  {(REPO / destino).stat().st_size/1024:.0f} KB")
    b.close()
finally:
    srv.terminate()
