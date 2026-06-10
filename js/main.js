const words=['planilha mal feita.','post-it no monitor.','documento sem nome.','WhatsApp do escritório.','e-mail que ninguém viu.','prazo que passou.','desorganização.'];
let wi=0;
const el=document.getElementById('ticker');
el.style.transition='opacity .25s ease,transform .25s ease';
function rotateTicker(){
  el.style.opacity='0';el.style.transform='translateY(-6px)';
  setTimeout(()=>{wi=(wi+1)%words.length;el.textContent=words[wi];el.style.transition='opacity .35s ease,transform .35s ease';el.style.opacity='1';el.style.transform='translateY(0)'},260);
}
setInterval(rotateTicker,2400);

const obs=new IntersectionObserver((entries)=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target)}})},{threshold:.1,rootMargin:'0px 0px -30px 0px'});
document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));

function toggleFaq(item){const isOpen=item.classList.contains('open');document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));if(!isOpen)item.classList.add('open')}
