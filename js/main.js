const words=['abrir portal de tribunal.','movimentação não vista.','planilha desatualizada.','prazo que passou.','WhatsApp do escritório.','post-it no monitor.','desorganização.'];
let wi=0;
const el=document.getElementById('ticker');
el.style.transition='opacity .25s ease,transform .25s ease';
function rotateTicker(){
  el.style.opacity='0';el.style.transform='translateY(-6px)';
  setTimeout(()=>{wi=(wi+1)%words.length;el.textContent=words[wi];el.style.transition='opacity .35s ease,transform .35s ease';el.style.opacity='1';el.style.transform='translateY(0)'},260);
}
setInterval(rotateTicker,2400);

// Hero carousel
const heroSlides=document.querySelectorAll('.carousel-slide');
if(heroSlides.length){
  const heroLabels=document.querySelectorAll('.carousel-label');
  const heroDots=document.querySelectorAll('.carousel-dot');
  const heroUrl=document.querySelector('.screen-url');
  const heroUrls=['meuprocesso.app.br/dashboard','meuprocesso.app.br → Processos','meuprocesso.app.br → Buscar no CNJ','meuprocesso.app.br → Movimentações','meuprocesso.app.br → Tarefas'];
  let cur=0,heroTimer;
  function goSlide(n){
    heroSlides[cur].classList.remove('active');
    heroLabels[cur].classList.remove('active');
    heroDots[cur].classList.remove('active');
    cur=n%heroSlides.length;
    heroSlides[cur].classList.add('active');
    heroLabels[cur].classList.add('active');
    heroDots[cur].classList.add('active');
    if(heroUrl)heroUrl.textContent=heroUrls[cur];
  }
  function startTimer(){heroTimer=setInterval(()=>goSlide((cur+1)%heroSlides.length),3600);}
  heroDots.forEach((dot,i)=>dot.addEventListener('click',()=>{clearInterval(heroTimer);goSlide(i);startTimer();}));
  startTimer();
}

const obs=new IntersectionObserver((entries)=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target)}})},{threshold:.1,rootMargin:'0px 0px -30px 0px'});
document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));

function toggleFaq(item){const isOpen=item.classList.contains('open');document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));if(!isOpen)item.classList.add('open')}
