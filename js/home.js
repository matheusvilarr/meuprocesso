// Animação do notebook no topo da home: a pergunta do advogado aparece sendo
// digitada, entra a tela real do sistema que responde e uma faixa com a resposta.
// As telas vêm do banco dublê (scripts/fotos-site) — dados fictícios. Cada imagem
// só é baixada perto da vez dela; pausa fora da tela e com a aba em segundo plano.
(function () {
  const palco = document.querySelector('.cena-palco');
  if (!palco) return;

  const imgs       = [...palco.querySelectorAll('.cena-img')];
  const pergunta   = palco.querySelector('.cena-pergunta');
  const texto      = palco.querySelector('.cena-texto');
  const resposta   = palco.querySelector('.cena-resposta');
  const respostaTx = resposta.querySelector('span');
  const destaque   = palco.querySelector('.cena-destaque');
  const pontos     = [...document.querySelectorAll('.cena-pontos button')];

  // img = posição da tela dentro de .cena-palco (mesma ordem do HTML).
  // d = contorno na parte da tela que responde: [esquerda, topo, largura, altura] em %
  // da tela — medido nas fotos de scripts/fotos-site (refazer se as fotos mudarem).
  const CENAS = [
    { img: 0, p: 'Saiu alguma intimação pra mim hoje?',      r: '2 intimações hoje. O aviso já está no seu e-mail.',               d: [6.8, 34.8, 23.4, 11.6] },
    { img: 1, p: 'O que eu tenho pra fazer essa semana?',     r: 'Prazos, compromissos e tarefas da semana no painel do dia.',      d: [67.9, 21.1, 30.6, 21.6] },
    { img: 2, p: 'Quando é a audiência do Rodrigo?',            r: 'Amanhã, às 14h30. Já está no calendário.',                       d: [44.4, 34.8, 10.4, 13.4] },
    { img: 3, p: 'Em que pé está a cobrança da Vila Ipê?',    r: 'Decisão publicada hoje. Todo o histórico do processo num lugar só.' },
    { img: 4, p: 'Quanto eu tenho a receber?',                r: 'R$ 8.640 a receber e R$ 1.500 vencidos, separados por cliente.', d: [6.8, 20.4, 91.6, 11.6] },
    { img: 5, p: 'Quem da equipe está com o quê?',            r: 'Cada tarefa no seu quadro, com prazo e prioridade.' },
  ];
  const DIGITAR_MS = 38, PAUSA_PERGUNTA_MS = 900, SAIDA_MS = 450;
  // Tempo pra ler a resposta E olhar a tela. Até 05/11/2026 eram 4,3s fixos e a
  // cena trocava antes de terminar de ler; agora cresce com o tamanho do texto.
  const tempoLeitura = c => Math.max(7000, 3500 + c.r.length * 55);

  let atual = 0, timers = [], rodando = false, naTela = true, liberado = false;
  // Mouse em cima do notebook segura a cena (só no computador): ela termina o
  // que estava fazendo e não avança até o mouse sair.
  let segurando = false, esperandoSair = false;

  const depois = (ms, fn) => timers.push(setTimeout(fn, ms));
  const limpar = () => { timers.forEach(clearTimeout); timers = []; };
  const carregar = img => {
    if (!img || !img.dataset.src) return;
    img.srcset = img.dataset.srcset;
    img.src = img.dataset.src;
    delete img.dataset.src;
  };
  const marcarPonto = n => pontos.forEach((b, k) => {
    b.setAttribute('aria-current', k === n ? 'true' : 'false');
    b.classList.remove('enchendo');
  });

  // A bolinha da cena atual vai enchendo durante a leitura — mostra quanto
  // falta pra trocar, em vez de a troca pegar de surpresa.
  function encherPonto(n, ms) {
    const b = pontos[n];
    if (!b) return;
    b.style.setProperty('--leitura', ms + 'ms');
    b.classList.remove('enchendo');
    void b.offsetWidth;
    b.classList.add('enchendo');
  }

  function avancar(n) {
    if (!rodando) return;
    if (segurando) { esperandoSair = true; return; }
    // Primeiro some a resposta; só depois entra a próxima pergunta.
    resposta.classList.remove('ativa');
    destaque.classList.remove('ativa');
    depois(SAIDA_MS, () => mostrar((n + 1) % CENAS.length));
  }

  function mostrar(n) {
    limpar();
    atual = n;
    const c = CENAS[n];
    carregar(imgs[c.img]);
    carregar(imgs[CENAS[(n + 1) % CENAS.length].img]);
    marcarPonto(n);

    resposta.classList.remove('ativa');
    destaque.classList.remove('ativa');
    texto.textContent = '';
    pergunta.classList.add('ativa');

    let letra = 0;
    const digitar = () => {
      texto.textContent = c.p.slice(0, ++letra);
      if (letra < c.p.length) depois(DIGITAR_MS, digitar);
      else depois(PAUSA_PERGUNTA_MS, revelar);
    };
    depois(350, digitar);

    function revelar() {
      imgs.forEach((im, j) => im.classList.toggle('ativa', j === c.img));
      pergunta.classList.remove('ativa');
      respostaTx.textContent = c.r;
      depois(450, () => resposta.classList.add('ativa'));
      if (c.d) {
        const [x, y, w, h] = c.d;
        Object.assign(destaque.style, { left: x + '%', top: y + '%', width: w + '%', height: h + '%' });
        depois(750, () => destaque.classList.add('ativa'));
      }
      const ms = tempoLeitura(c);
      encherPonto(n, ms);
      depois(ms, () => avancar(n));
    }
  }

  function iniciar() {
    if (rodando || !liberado || !naTela || document.hidden) return;
    rodando = true;
    mostrar(atual);
  }
  function parar() { rodando = false; limpar(); }

  // Quem pediu menos movimento no sistema vê só a primeira tela, com a resposta.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    respostaTx.textContent = CENAS[0].r;
    resposta.classList.add('ativa');
    marcarPonto(0);
    pontos.forEach((b, k) => b.addEventListener('click', () => {
      carregar(imgs[CENAS[k].img]);
      imgs.forEach((im, j) => im.classList.toggle('ativa', j === CENAS[k].img));
      respostaTx.textContent = CENAS[k].r;
      marcarPonto(k);
    }));
    return;
  }

  pontos.forEach((b, k) => b.addEventListener('click', () => { liberado = rodando = true; esperandoSair = false; mostrar(k); }));

  if (matchMedia('(pointer: fine)').matches) {
    const barra = pontos[0]?.parentElement;
    palco.addEventListener('pointerenter', () => { segurando = true; barra?.classList.add('segurando'); });
    palco.addEventListener('pointerleave', () => {
      segurando = false;
      barra?.classList.remove('segurando');
      if (esperandoSair) { esperandoSair = false; depois(1200, () => avancar(atual)); }
    });
  }

  new IntersectionObserver(([e]) => {
    naTela = e.isIntersecting;
    naTela ? iniciar() : parar();
  }, { threshold: 0.3 }).observe(palco);

  document.addEventListener('visibilitychange', () => (document.hidden ? parar() : iniciar()));

  // A primeira tela já está visível (é a imagem que o navegador pinta primeiro);
  // a primeira pergunta entra depois de um instante.
  setTimeout(() => { liberado = true; iniciar(); }, 2500);
})();

// Acabamento: entrada das seções ao rolar, brilho que segue o mouse no mosaico e
// botão principal que se aproxima do cursor. Nada disso roda com movimento reduzido.
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Entrada em cascata. O CSS só esconde quando .anima está no <html>, então sem
  // JS a página aparece inteira.
  // Cada bloco (e cada item de uma .cascata) entra sozinho, assim que a borda de
  // cima aparece. Até 05/11/2026 o grupo inteiro esperava 12% da própria altura
  // aparecer — no celular, onde o grupo vira uma coluna enorme, a pessoa rolava
  // por um bom pedaço de tela vazia antes de o conteúdo surgir.
  const alvos = [...document.querySelectorAll('.surgir, .cascata > *')];
  if ('IntersectionObserver' in window && alvos.length) {
    document.documentElement.classList.add('anima');
    const io = new IntersectionObserver(entradas => {
      let k = 0;
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        // Os que entram juntos (uma linha de cartões no computador) entram em sequência
        e.target.style.setProperty('--i', Math.min(k++, 4));
        e.target.classList.add('visivel');
        io.unobserve(e.target);
      }
    }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
    alvos.forEach(a => io.observe(a));
  }

  if (!matchMedia('(pointer: fine)').matches) return;

  document.querySelectorAll('.peca').forEach(p => p.addEventListener('pointermove', e => {
    const r = p.getBoundingClientRect();
    p.style.setProperty('--mx', `${e.clientX - r.left}px`);
    p.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  const ima = document.querySelector('.abertura .botao-grande');
  if (ima) {
    ima.classList.add('ima');
    let quadro = 0;
    const mover = (x, y) => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(() => { ima.style.transform = `translate(${x}px, ${y}px)`; }); };
    ima.addEventListener('pointermove', e => {
      const r = ima.getBoundingClientRect();
      mover((e.clientX - r.left - r.width / 2) * 0.12, (e.clientY - r.top - r.height / 2) * 0.22);
    });
    ima.addEventListener('pointerleave', () => mover(0, 0));
  }
})();
