// Carregado pelo snippet do GA no <head> de cada página (não precisa de
// <script> próprio). Duas coisas:
//  1. Guarda a PRIMEIRA origem da pessoa (de qual site veio, por qual página
//     entrou, utm_*). O cadastro grava isso no user_metadata — o GA sozinho
//     perde a origem no redirect do Google/LinkedIn e no link de confirmação
//     aberto em outro aparelho.
//  2. cta_click em qualquer link de cadastro (?tab=signup, /registro) ou
//     elemento com data-cta. Local do clique: data-cta-location do elemento ou
//     de um ancestral; senão o id da <section> em volta.
(function () {
  const CHAVE = 'mp_origem';

  function ler() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (_) { return null; }
  }
  window.mpOrigem = ler;

  try {
    const pag = location.pathname;
    if (!ler() && !/^\/(dashboard|admin)/.test(pag)) {
      const q = new URLSearchParams(location.search);
      let ref = null;
      try {
        const h = new URL(document.referrer).hostname;
        if (h && !/(^|\.)meuprocesso\.app\.br$/.test(h) && h !== location.hostname) ref = h;
      } catch (_) {}
      const o = { data: new Date().toISOString().slice(0, 10), entrada: pag.replace(/\.html$/, '') || '/', ref };
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => { if (q.get(k)) o[k] = q.get(k).slice(0, 80); });
      if (q.get('gclid')) o.gclid = true;
      localStorage.setItem(CHAVE, JSON.stringify(o));
    }
  } catch (_) {}

  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('a, button');
    if (!el) return;
    const href = el.getAttribute('href') || '';
    if (!el.hasAttribute('data-cta') && !/tab=signup|\/registro/.test(href)) return;
    const marcado = el.closest('[data-cta-location]');
    const secao   = el.closest('section[id], header, nav, footer');
    const local   = marcado?.getAttribute('data-cta-location')
      || secao?.id || secao?.tagName.toLowerCase() || '';
    const pagina  = location.pathname.replace(/\.html$/, '') || '/';
    window.mpTrack('cta_click', {
      cta_location: pagina + (local ? '#' + local : ''),
      cta_text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    });
  }, true);
})();
