// Caches globais — declarados aqui para evitar TDZ em chamadas síncronas de inicialização
let _clientesDB   = [];
let _honorariosDB = [];

// Navigation
const pages = {
  'dashboard': 'Dashboard',
  'processos': 'Meus Processos',
  'processo-detalhe': 'Detalhe do Processo',
  'calendario': 'Calendário',
  'tarefas': 'Tarefas',
  'clientes': 'Clientes',
  'honorarios': 'Honorários',
  'colaboradores': 'Colaboradores',
  'configuracoes': 'Configurações',
  'arquivados': 'Arquivados & Encerrados',
  'ajuda': 'Ajuda',
  'tjdft': 'TJDFT',
};

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  document.getElementById('topbar-title').textContent = pages[id] || id;
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + id + "'")) {
      n.classList.add('active');
    }
  });
  if (id === 'calendario') {
    fullCalDate = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth(), 1);
    carregarEventos();
  }
  if (id === 'processos' && !window._filtroSemanaNavegando) {
    window._filtroSemana = false;
    filtrarProcessos();
  }
  window._filtroSemanaNavegando = false;
  if (id === 'tarefas')       carregarTarefas();
  if (id === 'arquivados')    carregarArquivados();
  if (id === 'configuracoes') carregarConfiguracoes();
  if (id === 'colaboradores') carregarParceiros();
  if (id === 'tjdft') { verificarBackendPython(); inicializarDatesDJe(); }
  if (id === 'clientes')      carregarClientes();
  if (id === 'honorarios') { carregarHonorarios(); _aplicarVisHonorarios(); }
}

function showProcessDetail() {
  showPage('processo-detalhe');
  document.getElementById('topbar-title').textContent = 'Detalhe do Processo';
}

// Tabs
function switchTab(id, btn) {
  const card = btn.closest('.card');
  card.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  card.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'comentarios' && _processoAtual) {
    popularComentarios(_processoAtual);
    _zerarBadgeTab('comentarios', _processoAtual.id);
  }
  if (id === 'documentos' && _processoAtual) {
    popularDocumentos(_processoAtual);
    _zerarBadgeTab('documentos', _processoAtual.id);
  }
}

function _zerarBadgeTab(tipo, processoId) {
  const badge = document.getElementById('tab-badge-' + tipo);
  if (badge) badge.style.display = 'none';
  if (processoId) localStorage.setItem(`lastSeen_${tipo}_${processoId}`, Date.now());
}

function _atualizarBadgesDetalhe(proc) {
  if (!proc) return;
  const comentarios = (proc.historico || []).filter(h => h.tipo === 'comentario');
  const documentos  = (proc.historico || []).filter(h => h.tipo === 'documento');
  const lastComment = parseInt(localStorage.getItem(`lastSeen_comentarios_${proc.id}`) || '0');
  const lastDoc     = parseInt(localStorage.getItem(`lastSeen_documentos_${proc.id}`)  || '0');
  const novosComent = comentarios.filter(h => new Date(h.created_at).getTime() > lastComment).length;
  const novosDocs   = documentos.filter(h => new Date(h.created_at).getTime() > lastDoc).length;
  const bc = document.getElementById('tab-badge-comentarios');
  const bd = document.getElementById('tab-badge-documentos');
  if (bc) { bc.textContent = novosComent; bc.style.display = novosComent ? 'inline' : 'none'; }
  if (bd) { bd.textContent = novosDocs;   bd.style.display = novosDocs   ? 'inline' : 'none'; }
}

// Modal
function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'modal-lembrete') {
    preencherProcessosModal('ev-processo');
    const hoje = new Date().toISOString().slice(0, 10);
    const evData = document.getElementById('ev-data');
    if (evData && !evData.value) evData.value = hoje;
    // Reseta estado de lock (só abrirModalPrazoProcesso o ativa)
    _resetarLockProcessoModal();
  }
  if (id === 'modal-lembrete-recorrente') {
    const hoje = new Date().toISOString().slice(0, 10);
    const evrData = document.getElementById('evr-data');
    if (evrData && !evrData.value) evrData.value = hoje;
  }
  if (id === 'modal-tarefa') {
    preencherProcessosModal('tar-processo');
  }
  if (id === 'modal-busca-tribunal') {
    _loteResultados = [];
    const inputEl = document.getElementById('busca-input');
    if (inputEl) { inputEl.value = ''; inputEl.style.height = '62px'; }
    limparResultadoBusca();
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.style.zIndex = ''; // limpa z-index elevado (ex: aberto sobre o calendário)
}

function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}

// ── RECÊNCIA E ORDENAÇÃO ────────────────────────────────────────────────────
function _ultimaAtividade(proc) {
  return proc.movimentos_recentes?.[0]?.data || proc.created_at || '2000-01-01';
}

function _ultimaAtividadeDias(proc) {
  const d = proc.movimentos_recentes?.[0]?.data;
  if (!d) return 9999;
  return Math.floor((Date.now() - new Date(d)) / 86400000);
}

// Horário do último movimento pra exibir junto de "Nova movimentação".
// Publicações de DJEN não têm hora real (vêm com T00:00:00) — nesse caso
// mostra só a data, pra não sugerir uma precisão que não existe.
function formatarHorarioMov(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const temHora = /T(?!00:00:00)/.test(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (!temHora) return ` · ${data}`;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return ` · ${data} ${hora}`;
}

function _recenciaInfo(proc) {
  const d = proc.movimentos_recentes?.[0]?.data;
  if (!d) return null;
  const dias = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (dias <= 1)  return { cls: 'rec-verde',   label: dias === 0 ? 'Hoje' : 'Ontem' };
  if (dias <= 5)  return { cls: 'rec-azul',    label: `há ${dias}d` };
  if (dias <= 7)  return { cls: 'rec-ambar',   label: `há ${dias}d` };
  if (dias <= 15) return { cls: 'rec-laranja', label: `há ${dias}d` };
  const meses = Math.floor(dias / 30);
  return { cls: 'rec-cinza', label: meses >= 1 ? `há ${meses} ${meses === 1 ? 'mês' : 'meses'}` : `há ${dias}d` };
}

function _sortRecente(a, b) {
  return _ultimaAtividade(b).localeCompare(_ultimaAtividade(a));
}

// Filtro rápido "esta semana" ativado pelo card do dashboard
window._filtroSemana = false;

function verAtualizacoesSemana() {
  window._filtroSemana = true;
  window._filtroSemanaNavegando = true;
  showPage('processos');
  filtrarProcessos();
}

function limparFiltroSemana() {
  window._filtroSemana = false;
  const chip = document.getElementById('chip-semana');
  if (chip) chip.style.display = 'none';
  filtrarProcessos();
}

async function favoritar(event, id) {
  event.stopPropagation();
  const proc = (window._processosDB || []).find(p => p.id === id);
  if (!proc || proc._isShared) return;
  const novoValor = !proc.favorito;
  const { error } = await _supabase.from('processos').update({ favorito: novoValor }).eq('id', id);
  if (error) { showToast('Erro ao salvar favorito: ' + error.message, 'error'); return; }
  proc.favorito = novoValor;
  filtrarProcessos();
}

// Modal de confirmação customizado
let _confirmarResolve = null;

function _confirmar(msg, titulo = 'Confirmar', { textoOk = 'Confirmar', perigo = false, icone = '⚠️' } = {}) {
  return new Promise(resolve => {
    _confirmarResolve = resolve;
    document.getElementById('confirmar-msg').textContent       = msg;
    document.getElementById('confirmar-titulo').textContent    = titulo;
    document.getElementById('confirmar-icon').textContent      = icone;
    const btnOk = document.getElementById('confirmar-btn-ok');
    btnOk.textContent        = textoOk;
    btnOk.style.background   = perigo ? '#dc2626' : '';
    btnOk.style.borderColor  = perigo ? '#dc2626' : '';
    document.getElementById('modal-confirmar').style.display   = 'flex';
  });
}

function _confirmarResolver() {
  document.getElementById('modal-confirmar').style.display = 'none';
  if (_confirmarResolve) { _confirmarResolve(true); _confirmarResolve = null; }
}

function _confirmarRejeitar() {
  document.getElementById('modal-confirmar').style.display = 'none';
  if (_confirmarResolve) { _confirmarResolve(false); _confirmarResolve = null; }
}

// Tempo relativo para datas
function _tempoRelativo(iso) {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)    return 'agora mesmo';
  if (diff < 3600)  return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return `há ${Math.floor(diff / 86400)} dia${Math.floor(diff / 86400) > 1 ? 's' : ''}`;
}

// Toast
let toastTimer;
function showToast(msg, tipo) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.style.background = tipo === 'success' ? '#16a34a' : tipo === 'error' ? '#dc2626' : tipo === 'warning' ? '#d97706' : '';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); t.style.background = ''; }, 3500);
}

// Mini Calendar
let miniCalDate = new Date();
let _eventosDB  = [];

function buildMiniCal() {
  const grid = document.getElementById('mini-cal-grid');
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  document.getElementById('mini-cal-month').textContent = monthNames[miniCalDate.getMonth()] + ' ' + miniCalDate.getFullYear();

  const days = ['D','S','T','Q','Q','S','S'];
  let html = days.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  const first = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth(), 1);
  const last  = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth() + 1, 0);
  const today = new Date();

  const eventoDias = new Set(
    _eventosDB
      .filter(e => {
        const d = new Date(e.data + 'T12:00:00');
        return d.getFullYear() === miniCalDate.getFullYear() && d.getMonth() === miniCalDate.getMonth();
      })
      .map(e => new Date(e.data + 'T12:00:00').getDate())
  );

  // honorários com vencimento neste mês
  const honorDias = {};
  (_honorariosDB || []).forEach(h => {
    if (!h.data_vencimento || h.status === 'pago' || h.status === 'cancelado') return;
    const d = new Date(h.data_vencimento + 'T12:00:00');
    if (d.getFullYear() === miniCalDate.getFullYear() && d.getMonth() === miniCalDate.getMonth()) {
      honorDias[d.getDate()] = honorDias[d.getDate()] || h.status;
    }
  });

  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(first);
    d.setDate(d.getDate() - (first.getDay() - i));
    html += `<div class="cal-day other-month">${d.getDate()}</div>`;
  }

  const ano = miniCalDate.getFullYear();
  const mes = miniCalDate.getMonth();
  for (let d = 1; d <= last.getDate(); d++) {
    const isToday  = ano === today.getFullYear() && mes === today.getMonth() && d === today.getDate();
    const hasEvent = eventoDias.has(d);
    const honStatus = honorDias[d];
    const moneyBadge = honStatus ? `<span class="cal-day-money${honStatus==='vencido'?' vencido':''}">$</span>` : '';
    html += `<div class="cal-day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''}" onclick="abrirDiaPopover(${ano},${mes},${d},this)">${d}${moneyBadge}</div>`;
  }

  grid.innerHTML = html;
}

function changeCalMonth(dir) {
  miniCalDate.setMonth(miniCalDate.getMonth() + dir);
  buildMiniCal();
  // Fecha popover ao trocar de mês
  const pop = document.getElementById('dia-popover');
  if (pop) pop.style.display = 'none';
}

let _diaSelecionado = null;

function abrirDiaPopover(ano, mes, dia, celEl) {
  const pop    = document.getElementById('dia-popover');
  const titulo = document.getElementById('dia-popover-titulo');
  const lista  = document.getElementById('dia-popover-lista');
  if (!pop) return;

  document.querySelectorAll('.cal-day.selecionado').forEach(el => el.classList.remove('selecionado'));
  if (celEl) celEl.classList.add('selecionado');

  _diaSelecionado = { ano, mes, dia };

  const isoDate  = `${ano}-${String(mes + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  const dtObj    = new Date(isoDate + 'T12:00:00');
  const nomes    = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const meses    = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  titulo.textContent = `${nomes[dtObj.getDay()]}, ${dia} de ${meses[mes]}`;

  const tipoLabel = { prazo_processual:'Prazo', audiencia:'Audiência', lembrete:'Lembrete', reuniao:'Reunião' };
  const corTipo   = { prazo_processual:'#ef4444', audiencia:'#3b82f6', lembrete:'#f59e0b', reuniao:'#8b5cf6' };
  const eventos   = (_eventosDB || []).filter(e => e.data === isoDate);

  lista.innerHTML = eventos.length
    ? eventos.map(e => {
        const sh = e.processo_id ? window._sharedSet?.[e.processo_id] : null;
        return `
        <div style="display:flex;align-items:flex-start;gap:9px;padding:8px 10px;border-radius:8px;background:var(--gray-50)">
          <div style="width:3px;min-height:34px;border-radius:4px;background:${corTipo[e.tipo] || '#94a3b8'};flex-shrink:0;margin-top:2px"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;font-weight:600;color:var(--gray-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.titulo}</div>
            <div style="font-size:11px;color:var(--gray-400);margin-top:1px">${tipoLabel[e.tipo] || e.tipo}${e.hora ? ' · ' + e.hora : ''}</div>
            ${sh ? `<div style="font-size:10px;color:#7c3aed;margin-top:2px"><i class="ti ti-handshake" style="font-size:10px"></i> ${_esc(sh.owner_nome)}</div>` : ''}
          </div>
        </div>`;
      }).join('')
    : `<div style="text-align:center;padding:16px 0;color:var(--gray-300)">
         <i class="ti ti-calendar-off" style="font-size:24px;display:block;margin-bottom:6px"></i>
         <div style="font-size:12px">Nenhum compromisso</div>
       </div>`;

  // Posiciona o popover perto da célula clicada
  pop.style.display = 'block';
  const rect    = celEl.getBoundingClientRect();
  const popW    = 280;
  const popH    = pop.offsetHeight;
  let left      = rect.right + 8;
  let top       = rect.top + window.scrollY;

  // Se sair pela direita, abre para a esquerda
  if (left + popW > window.innerWidth - 16) left = rect.left - popW - 8;
  // Se sair por baixo, sobe
  if (top + popH > window.innerHeight + window.scrollY - 16) top = Math.max(8, rect.bottom + window.scrollY - popH);

  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';

  // Fecha ao clicar fora
  setTimeout(() => document.addEventListener('click', _fecharDiaFora, { once: true }), 50);
}

function _fecharDiaFora(e) {
  // Clique em outro dia: abrirDiaPopover já vai abrir o novo — não fechar aqui
  if (e.target.closest('.cal-day')) return;
  const pop = document.getElementById('dia-popover');
  if (pop && !pop.contains(e.target)) {
    fecharDiaPopover();
  } else if (pop && pop.style.display !== 'none') {
    setTimeout(() => document.addEventListener('click', _fecharDiaFora, { once: true }), 50);
  }
}

function fecharDiaPopover() {
  const pop = document.getElementById('dia-popover');
  if (pop) pop.style.display = 'none';
  document.querySelectorAll('.cal-day.selecionado').forEach(el => el.classList.remove('selecionado'));
}

function abrirNovoEventoDia() {
  fecharDiaPopover();
  if (!_diaSelecionado) return;
  const { ano, mes, dia } = _diaSelecionado;
  const isoDate = `${ano}-${String(mes + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  openModal('modal-lembrete');
  const evData = document.getElementById('ev-data');
  if (evData) evData.value = isoDate;
}

// ── CALENDÁRIO EXPANDIDO ────────────────────────────────────────────────────
let _calExpDate    = new Date();
let _calExpView    = 'mes';
let _calExpEventos = [];
let _calExpDiaSel  = null;

const _calCorTipo = {
  prazo_processual: { bg:'#fee2e2', txt:'#b91c1c', border:'#ef4444' },
  audiencia:        { bg:'#dbeafe', txt:'#1d4ed8', border:'#3b82f6' },
  lembrete:         { bg:'#fef9c3', txt:'#a16207', border:'#f59e0b' },
  reuniao:          { bg:'#f3e8ff', txt:'#7c3aed', border:'#8b5cf6' },
};
const _calLabel   = { prazo_processual:'Prazo', audiencia:'Audiência', lembrete:'Lembrete', reuniao:'Reunião' };
const _calMeses   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const _calMesesAb = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

async function abrirCalExp() {
  _calExpDate = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth(), 1);
  _calExpView = 'mes';
  openModal('modal-cal-exp');
  await _calExpCarregar();
  _calExpRender();
}

async function _calExpCarregar() {
  if (!window._user) return;
  const [ini, fim] = _calExpPeriodo();
  const { data } = await _supabase.from('eventos').select('*')
    .gte('data', ini).lte('data', fim).order('data', { ascending: true });
  if (data) _calExpEventos = data;
}

function _calExpPeriodo() {
  const a = _calExpDate.getFullYear(), m = _calExpDate.getMonth();
  if (_calExpView === 'ano') return [`${a}-01-01`, `${a}-12-31`];
  if (_calExpView === 'semana') {
    const ini = new Date(_calExpDate); ini.setDate(ini.getDate() - ini.getDay());
    const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
    return [ini.toISOString().slice(0,10), fim.toISOString().slice(0,10)];
  }
  return [new Date(a,m,1).toISOString().slice(0,10), new Date(a,m+1,0).toISOString().slice(0,10)];
}

function _calExpRender() {
  const a = _calExpDate.getFullYear(), m = _calExpDate.getMonth();
  const titulo = document.getElementById('cal-exp-titulo');
  if (_calExpView === 'mes')    { if (titulo) titulo.textContent = _calMeses[m] + ' ' + a; _buildCalExpMes(); }
  if (_calExpView === 'semana') { _buildCalExpSemana(); }
  if (_calExpView === 'ano')    { if (titulo) titulo.textContent = String(a); _buildCalExpAno(); }
  ['mes','semana','ano'].forEach(v => {
    document.getElementById('cal-exp-btn-'+v)?.classList.toggle('active', v === _calExpView);
  });
}

async function calExpNav(dir) {
  if (_calExpView === 'mes')    _calExpDate.setMonth(_calExpDate.getMonth() + dir);
  if (_calExpView === 'semana') _calExpDate.setDate(_calExpDate.getDate() + dir * 7);
  if (_calExpView === 'ano')    _calExpDate.setFullYear(_calExpDate.getFullYear() + dir);
  await _calExpCarregar();
  _calExpRender();
}

async function setCalExpView(v) {
  _calExpView = v;
  await _calExpCarregar();
  _calExpRender();
}

async function calExpHoje() {
  _calExpDate = new Date();
  await _calExpCarregar();
  _calExpRender();
}

function calExpToggleAno() {
  // Se já está em ano, volta pra mês. Caso contrário abre o seletor de ano.
  if (_calExpView === 'ano') { setCalExpView('mes'); return; }
  const picker = document.getElementById('cal-ano-picker');
  if (!picker) return;
  if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
  _calAnoPickerBase = _calExpDate.getFullYear() - 5;
  _renderAnoPicker();
  picker.style.display = 'block';
  setTimeout(() => document.addEventListener('click', _fecharAnoPickerFora, { once: true }), 50);
}

let _calAnoPickerBase = new Date().getFullYear() - 5;

function _renderAnoPicker() {
  const grid  = document.getElementById('cal-ano-picker-grid');
  const range = document.getElementById('cal-ano-picker-range');
  if (!grid) return;
  const atual = _calExpDate.getFullYear();
  range.textContent = `${_calAnoPickerBase} – ${_calAnoPickerBase + 11}`;
  grid.innerHTML = Array.from({ length: 12 }, (_, i) => {
    const a = _calAnoPickerBase + i;
    const isAtual = a === atual;
    return `<button onclick="calAnoPickerSelect(${a})"
      style="padding:7px 4px;border:none;border-radius:8px;font-size:13px;font-weight:${isAtual?'700':'500'};
      cursor:pointer;transition:all .12s;
      background:${isAtual?'var(--navy)':'none'};
      color:${isAtual?'var(--white)':'var(--gray-700)'}"
      onmouseover="if(!${isAtual})this.style.background='var(--gray-100)'"
      onmouseout="if(!${isAtual})this.style.background='none'">${a}</button>`;
  }).join('');
}

function calAnoPickerNav(delta) {
  _calAnoPickerBase += delta;
  _renderAnoPicker();
}

async function calAnoPickerSelect(ano) {
  document.getElementById('cal-ano-picker').style.display = 'none';
  _calExpDate.setFullYear(ano);
  if (_calExpView === 'ano') { await _calExpCarregar(); _calExpRender(); return; }
  await _calExpCarregar();
  _calExpRender();
}

function _fecharAnoPickerFora(e) {
  const picker = document.getElementById('cal-ano-picker');
  if (picker && !picker.contains(e.target) && e.target.id !== 'cal-exp-titulo') {
    picker.style.display = 'none';
  } else if (picker && picker.style.display !== 'none') {
    setTimeout(() => document.addEventListener('click', _fecharAnoPickerFora, { once: true }), 50);
  }
}

function calExpNovoEvento() {
  const lemEl = document.getElementById('modal-lembrete');
  if (lemEl) lemEl.style.zIndex = '400';
  openModal('modal-lembrete');
  if (_calExpDiaSel) {
    const el = document.getElementById('ev-data');
    if (el) el.value = _calExpDiaSel;
  }
}

function _calExpEvHtml(ev, compact) {
  const c = _calCorTipo[ev.tipo] || { bg:'#f3f4f6', txt:'#6b7280', border:'#9ca3af' };
  if (compact) {
    return `<span class="cal-exp-ev" style="background:${c.bg};color:${c.txt};border-left-color:${c.border}"
      onclick="event.stopPropagation()" title="${_esc(ev.titulo)}">${_esc(ev.titulo)}</span>`;
  }
  return `<div class="cal-exp-sev" style="background:${c.bg};border-left-color:${c.border}">
    <div class="cal-exp-sev-titulo" style="color:${c.txt}">${_esc(ev.titulo)}</div>
    ${ev.hora ? `<div class="cal-exp-sev-hora">${ev.hora}</div>` : ''}
    <div class="cal-exp-sev-hora">${_calLabel[ev.tipo] || ev.tipo}</div>
  </div>`;
}

function _buildCalExpMes() {
  const body = document.getElementById('cal-exp-body');
  const a = _calExpDate.getFullYear(), m = _calExpDate.getMonth();
  const today = new Date();
  const first = new Date(a, m, 1), last = new Date(a, m+1, 0);
  const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  let html = `<div class="cal-exp-mes-grid">`;
  html += dias.map(d => `<div class="cal-exp-dh">${d}</div>`).join('');

  // Dias do mês anterior
  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(first); d.setDate(d.getDate() - (first.getDay() - i));
    html += `<div class="cal-exp-day other-month"><div class="cal-exp-day-num"><span>${d.getDate()}</span></div></div>`;
  }

  // Dias do mês atual
  for (let d = 1; d <= last.getDate(); d++) {
    const iso = `${a}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = a===today.getFullYear() && m===today.getMonth() && d===today.getDate();
    const evs = _calExpEventos.filter(e => e.data === iso);
    const visiveis = evs.slice(0, 3), extra = evs.length - 3;
    const hons = (_honorariosDB||[]).filter(h => h.data_vencimento === iso && h.status !== 'pago' && h.status !== 'cancelado');
    const honHtml = hons.map(h => `<div class="cal-exp-ev" style="background:${h.status==='vencido'?'var(--red-light)':'var(--green-light)'};color:${h.status==='vencido'?'var(--red)':'var(--green)'};border-left:3px solid ${h.status==='vencido'?'var(--red)':'var(--green)'}" onclick="event.stopPropagation();abrirEditarHonorario('${h.id}')">
      <i class="ti ti-cash" style="font-size:10px"></i> ${h.descricao.substring(0,22)}
    </div>`).join('');
    html += `<div class="cal-exp-day${isToday?' today':''}" onclick="calExpClickDia('${iso}')">
      <div class="cal-exp-day-num">
        <span>${d}</span>
        <button class="cal-exp-add-btn" onclick="event.stopPropagation();calExpNoDia('${iso}')">+</button>
      </div>
      ${visiveis.map(e => _calExpEvHtml(e, true)).join('')}
      ${honHtml}
      ${extra > 0 ? `<div class="cal-exp-more" onclick="event.stopPropagation();calExpClickDia('${iso}')">+${extra} mais</div>` : ''}
    </div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
}

function _buildCalExpSemana() {
  const body = document.getElementById('cal-exp-body');
  const today = new Date();
  const dom = new Date(_calExpDate); dom.setDate(_calExpDate.getDate() - _calExpDate.getDay());
  const titulo = document.getElementById('cal-exp-titulo');
  const fmt = d => d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  const fim = new Date(dom); fim.setDate(dom.getDate() + 6);
  if (titulo) titulo.textContent = fmt(dom) + ' – ' + fmt(fim);

  let html = `<div class="cal-exp-semana-grid">`;
  const dnames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(dom); d.setDate(dom.getDate() + i);
    const iso = d.toISOString().slice(0,10);
    const isToday = d.toDateString() === today.toDateString();
    const evs = _calExpEventos.filter(e => e.data === iso);
    html += `<div class="cal-exp-scol${isToday?' today':''}">
      <div class="cal-exp-scol-header">
        <div class="s-dname">${dnames[d.getDay()]}</div>
        <div class="s-dnum${isToday?' today':''}">${d.getDate()}</div>
      </div>
      <div class="cal-exp-scol-eventos" onclick="calExpNoDia('${iso}')">
        ${evs.length ? evs.map(e => _calExpEvHtml(e, false)).join('') : ''}
      </div>
    </div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
}

function _buildCalExpAno() {
  const body = document.getElementById('cal-exp-body');
  const a = _calExpDate.getFullYear(), today = new Date();
  let html = `<div class="cal-exp-ano-grid">`;
  for (let m = 0; m < 12; m++) {
    const first = new Date(a, m, 1), last = new Date(a, m+1, 0);
    let mini = `<div class="cal-exp-ano-mini">`;
    mini += ['D','S','T','Q','Q','S','S'].map(d => `<div class="cal-exp-ano-dh">${d}</div>`).join('');
    for (let i = 0; i < first.getDay(); i++) mini += `<div class="cal-exp-ano-d other-m"></div>`;
    for (let d = 1; d <= last.getDate(); d++) {
      const iso = `${a}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = a===today.getFullYear() && m===today.getMonth() && d===today.getDate();
      const hasEv   = _calExpEventos.some(e => e.data === iso);
      mini += `<div class="cal-exp-ano-d${isToday?' today':''}${hasEv?' has-ev':''}">${d}</div>`;
    }
    mini += `</div>`;
    html += `<div class="cal-exp-ano-mes" onclick="calExpClickMes(${m})">
      <div class="cal-exp-ano-mes-titulo">${_calMesesAb[m]}</div>
      ${mini}
    </div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
}

async function calExpClickMes(m) {
  _calExpDate.setMonth(m);
  await setCalExpView('mes');
}

function calExpClickDia(iso) {
  _calExpDiaSel = iso;
  // Mostra popover ou destaca o dia — por ora só define seleção
}

function calExpNoDia(iso) {
  _calExpDiaSel = iso;
  // Mantém o calendário aberto por baixo — eleva o lembrete acima dele
  const lemEl = document.getElementById('modal-lembrete');
  if (lemEl) lemEl.style.zIndex = '400';
  openModal('modal-lembrete');
  const el = document.getElementById('ev-data');
  if (el) el.value = iso;
}

// Full Calendar
let fullCalDate = new Date();

const _tipoEvtCls = {
  prazo_processual: 'event-prazo',
  audiencia:        'event-audiencia',
  lembrete:         'event-lembrete',
  reuniao:          'event-reuniao',
};

function buildFullCal() {
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  document.getElementById('full-cal-month').textContent = monthNames[fullCalDate.getMonth()] + ' ' + fullCalDate.getFullYear();

  const grid = document.getElementById('full-cal-grid');
  const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  let html = dayNames.map(d => `<div class="fcal-header">${d}</div>`).join('');

  const first = new Date(fullCalDate.getFullYear(), fullCalDate.getMonth(), 1);
  const last  = new Date(fullCalDate.getFullYear(), fullCalDate.getMonth() + 1, 0);
  const today = new Date();

  const eventosPorDia = {};
  for (const e of _eventosDB) {
    const d = new Date(e.data + 'T12:00:00');
    if (d.getFullYear() === fullCalDate.getFullYear() && d.getMonth() === fullCalDate.getMonth()) {
      const day = d.getDate();
      if (!eventosPorDia[day]) eventosPorDia[day] = [];
      eventosPorDia[day].push(e);
    }
  }

  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(first);
    d.setDate(d.getDate() - (first.getDay() - i));
    html += `<div class="fcal-day other-month"><div class="fcal-day-num">${d.getDate()}</div></div>`;
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const isToday = fullCalDate.getFullYear() === today.getFullYear() &&
                    fullCalDate.getMonth() === today.getMonth() && d === today.getDate();
    const events  = eventosPorDia[d] || [];
    const evHtml  = events.map(e => {
      const sh = e.processo_id ? window._sharedSet?.[e.processo_id] : null;
      const shIcon = sh ? `<i class="ti ti-handshake" title="Compartilhado por ${sh.owner_nome}" style="font-size:9px;margin-left:3px;opacity:.8"></i>` : '';
      return `<div class="fcal-event ${_tipoEvtCls[e.tipo] || 'event-lembrete'}"
            onclick="event.stopPropagation();excluirEvento('${e.id}')"
            title="${e.titulo}${sh ? ' · Compartilhado por ' + sh.owner_nome : ''} (clique para excluir)">${e.titulo}${shIcon}</div>`;
    }).join('');
    html += `<div class="fcal-day ${isToday ? 'today' : ''}"><div class="fcal-day-num">${d}</div>${evHtml}</div>`;
  }

  grid.innerHTML = html;
  renderizarEsteMes();
}

function changeFCalMonth(dir) {
  fullCalDate.setMonth(fullCalDate.getMonth() + dir);
  carregarEventos();
}

// Init
buildMiniCal();

// ── BUSCA UNIFICADA ────────────────────────────────────────────────────

let _tipoBusca = 'numero';
let _abaAtiva  = 'numero'; // 'numero' | 'advogado'

function selecionarAbaBusca(aba, btn) {
  _abaAtiva = aba;
  document.querySelectorAll('.busca-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  document.getElementById('busca-aba-numero').style.display   = aba === 'numero'   ? '' : 'none';
  document.getElementById('busca-aba-advogado').style.display = aba === 'advogado' ? '' : 'none';

  if (aba === 'advogado') {
    const hoje = new Date().toISOString().slice(0, 10);
    const ini  = document.getElementById('modal-dje-inicio');
    const fim  = document.getElementById('modal-dje-fim');
    if (ini && !ini.value) ini.value = new Date(new Date().getFullYear() + '-01-01').toISOString().slice(0, 10);
    if (fim && !fim.value) fim.value = hoje;
    document.getElementById('modal-dje-query')?.focus();
  }
}

function _detectarArea(siglaTribunal, nomeClasse) {
  const t = (siglaTribunal || '').toUpperCase();
  const c = (nomeClasse    || '').toUpperCase();
  if (t.startsWith('TRT') || c.includes('TRABALH') || c.includes('RECLAMAÇÃO')) return 'Trabalhista';
  if (c.includes('FAMÍL') || c.includes('DIVÓRC') || c.includes('ALIMENT') || c.includes('GUARDA') || c.includes('ADOÇÃO')) return 'Família';
  if (c.includes('TRIBUT') || c.includes('FISCAL') || c.includes('EXECUÇÃO FISCAL')) return 'Tributário';
  if (c.includes('PREVIDÊN') || c.includes('BENEFÍCIO') || c.includes('INSS') || c.includes('APOSENTAD')) return 'Previdenciário';
  if (c.includes('CRIMIN') || c.includes('PENAL') || c.includes('CRIME') || c.includes('INQUÉRIT')) return 'Criminal';
  return 'Cível';
}

async function buscarAdvogadoDJEN() {
  const rawQuery   = document.getElementById('modal-dje-query')?.value.trim();
  const ufSelecionada = document.getElementById('modal-dje-uf')?.value || '';
  const dataInicio = document.getElementById('modal-dje-inicio')?.value || new Date(new Date().getFullYear() + '-01-01').toISOString().slice(0, 10);
  const dataFim    = document.getElementById('modal-dje-fim')?.value    || new Date().toISOString().slice(0, 10);

  if (!rawQuery) {
    const oabPerfil = window._user?.user_metadata?.oab || '';
    if (!oabPerfil) {
      showToast('Cadastre sua OAB nas configurações para buscar no DJEN.', 'warning');
      closeModal('modal-busca-tribunal');
      showPage('configuracoes');
      setTimeout(() => document.getElementById('config-oab')?.focus(), 400);
      return;
    }
    showToast('Informe OAB ou nome do advogado.');
    return;
  }

  const titulo    = document.getElementById('modal-djen-titulo');
  const lista     = document.getElementById('modal-djen-resultados');
  titulo.textContent = 'Buscando…';
  lista.innerHTML    = '<div style="text-align:center;padding:20px;color:var(--gray-400)"><i class="ti ti-loader-2" style="animation:spin .8s linear infinite;font-size:22px"></i></div>';

  // Cada entrada pode ser "DF 59360" ou só "59360" (usa UF do dropdown)
  const entradas = rawQuery.split(',').map(s => s.trim()).filter(Boolean);
  const oabsParsadas = entradas.map(e => {
    let n = _normalizarOAB(e);
    // Se não tem UF no texto mas há UF selecionada, tenta compor com a UF
    if (!n && ufSelecionada && /^\d{3,6}$/.test(e.trim())) n = `${ufSelecionada}${e.trim()}`;
    return n ? _parsearOAB(n) : null;
  }).filter(Boolean);
  const isOAB = oabsParsadas.length > 0;
  const label = isOAB ? oabsParsadas.map(o => `${o.uf} ${o.num}`).join(', ') : rawQuery;

  try {
    const PAGE_SIZE = 100;
    const base = { dataDisponibilizacaoInicio: dataInicio, dataDisponibilizacaoFim: dataFim, pagina: 1, tamanhoPagina: PAGE_SIZE };

    const _fetchDJEN = (params) => fetch(`${DJEN_API}?${new URLSearchParams(params)}`).then(r => r.ok ? r.json() : { items: [], count: 0 });

    let reqs;
    if (isOAB) {
      reqs = oabsParsadas.map(oab => _fetchDJEN({ ...base, numeroOab: oab.num, ufOab: oab.uf }));
    } else {
      const params = { ...base, nomeAdvogado: rawQuery };
      if (ufSelecionada) params.ufOab = ufSelecionada;
      reqs = [_fetchDJEN(params)];
    }

    const resultados = await Promise.all(reqs);
    const vistos = new Set();
    let items = resultados.flatMap(r => r.items || []).filter(item => { if (vistos.has(item.id)) return false; vistos.add(item.id); return true; });
    const total = resultados.reduce((s, r) => s + (r.count || 0), 0);

    // Paginação: busca as páginas restantes se houver mais resultados
    if (total > items.length) {
      const numPaginas = Math.min(Math.ceil(total / PAGE_SIZE), 10); // máx 10 páginas (1000 resultados)
      const reqsExtras = [];
      for (let pg = 2; pg <= numPaginas; pg++) {
        if (isOAB) {
          oabsParsadas.forEach(oab => reqsExtras.push(_fetchDJEN({ ...base, pagina: pg, numeroOab: oab.num, ufOab: oab.uf })));
        } else {
          const p = { ...base, pagina: pg, nomeAdvogado: rawQuery };
          if (ufSelecionada) p.ufOab = ufSelecionada;
          reqsExtras.push(_fetchDJEN(p));
        }
      }
      if (reqsExtras.length) {
        titulo.textContent = `Carregando mais resultados (${items.length} de ${total})…`;
        const extras = await Promise.all(reqsExtras);
        const maisItems = extras.flatMap(r => r.items || []).filter(item => { if (vistos.has(item.id)) return false; vistos.add(item.id); return true; });
        items = [...items, ...maisItems];
      }
    }

    items.sort((a, b) => (b.data_disponibilizacao || '').localeCompare(a.data_disponibilizacao || ''));

    if (!items.length) {
      titulo.textContent = `Nenhuma publicação encontrada para "${label}" no período`;
      lista.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px">
        <i class="ti ti-mood-empty" style="font-size:28px;display:block;margin-bottom:8px;opacity:.4"></i>
        Tente ampliar o período ou verificar o formato da OAB.
      </div>`;
      return;
    }

    titulo.textContent = `${items.length} publicação(ões)${total > items.length ? ` de ${total}` : ''}`;

    const stripHtml2 = h => h.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const fmt2 = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const PADRAO_PROC = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;

    window._djeResultados = items.map(item => {
      const textoLimpo   = stripHtml2(item.texto || '');
      const processoMask = item.numeroprocessocommascara || '';
      const numerosExtras = [...new Set((textoLimpo.match(PADRAO_PROC) || []))];
      const processos    = processoMask ? [processoMask, ...numerosExtras.filter(n => n !== processoMask)] : numerosExtras;
      const tipoDecisao  = _extrairTipoDecisao(textoLimpo);
      // Extrai partes via destinatarios (polo A = ativo/cliente, P/R = passivo/contrário)
      const parteAtiva   = item.destinatarios?.find(d => ['A','AT','ATIVO'].includes((d.polo||'').toUpperCase()));
      const partePassiva = item.destinatarios?.find(d => ['P','R','PA','RE','PASSIVO'].includes((d.polo||'').toUpperCase()));
      const partes       = { cliente: parteAtiva?.nome || null, contrario: partePassiva?.nome || null };
      const matches      = processos.map(num => (window._processosDB || []).find(p => p.numero === num)).filter(Boolean);
      return { ...item, textoLimpo, processos, tipoDecisao, partes, matches };
    });

    window._djeResultados = _deduplicarDJe(window._djeResultados);

    // Salva automaticamente as publicações de processos já cadastrados — o usuário
    // roda essa busca manualmente como substituto do cron, então o resultado já
    // precisa cair na timeline e acender a notificação sem precisar clicar em nada.
    let qtdAutoSalvas = 0;
    for (const doc of window._djeResultados) {
      if (!doc.matches.length) continue;
      const resultado = await _salvarMovimentoDJe(doc, doc.matches[0]);
      doc._autoSave = resultado.status;
      if (resultado.status === 'salvo') qtdAutoSalvas++;
    }
    if (qtdAutoSalvas > 0) {
      await carregarProcessos();
      showToast(`✓ ${qtdAutoSalvas} processo(s) atualizado(s) automaticamente com publicações do DJEN.`, 'success');
    }

    const semCadastro = window._djeResultados.filter(d => !d.matches.length && d.processos[0]);
    let html = semCadastro.length > 1 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 2px 10px">
        <span style="font-size:12px;color:var(--gray-500)">${semCadastro.length} processo(s) não cadastrado(s)</span>
        <button class="btn-primary" style="font-size:11px;padding:5px 14px" onclick="importarTodosDJe()">
          <i class="ti ti-download"></i> Importar todos
        </button>
      </div>` : '';

    html += window._djeResultados.map((doc, i) => {
      const numPrincipal = doc.processos[0] || '';
      const dataFmt      = fmt2(doc.data_disponibilizacao);
      const orgao        = (doc.nomeOrgao || '').slice(0, 60);
      const temMatch     = doc.matches.length > 0;
      const semNumero    = !numPrincipal;
      const badgePubs    = (doc._pubCount || 1) > 1
        ? `<span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:8px;background:#fef3c7;color:#92400e;white-space:nowrap">${doc._pubCount} publicações</span>`
        : '';

      const badgeTipo = `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;background:${temMatch ? '#dcfce7;color:#166534' : '#e8edf5;color:var(--navy)'};white-space:nowrap">${temMatch ? '✓ No sistema' : (doc.tipoComunicacao || 'PUBLICAÇÃO')}</span>`;
      const badgeDecisao = doc.tipoDecisao ? `<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:#f3f4f6;color:var(--gray-500)">${doc.tipoDecisao}</span>` : '';

      // Card compacto para processos já no sistema
      if (temMatch) {
        return `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">${badgeTipo}${badgeDecisao}${badgePubs}
              <span style="font-size:10px;color:var(--gray-400);margin-left:auto;white-space:nowrap">${dataFmt} · ${doc.siglaTribunal || ''}</span>
            </div>
            <div style="font-size:12px;font-weight:600;color:var(--navy);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${numPrincipal || 'sem número'}${doc.processos.length > 1 ? ` <span style="color:var(--gray-400);font-weight:400">+${doc.processos.length-1}</span>` : ''}</div>
            ${orgao ? `<div style="font-size:10px;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${orgao}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            ${doc._autoSave === 'salvo'
              ? `<span style="font-size:11px;font-weight:600;color:var(--green);white-space:nowrap"><i class="ti ti-check"></i> Salvo automaticamente</span>`
              : doc._autoSave === 'erro'
                ? `<button class="btn-primary" style="font-size:11px;padding:4px 10px;white-space:nowrap" onclick="salvarAtualizacaoDJe(${i},'${doc.matches[0].id}',this)"><i class="ti ti-refresh"></i> Tentar de novo</button>`
                : `<span style="font-size:11px;color:var(--gray-400);white-space:nowrap"><i class="ti ti-check"></i> Já atualizado</span>`}
            <button class="btn-secondary" style="font-size:11px;padding:4px 8px" onclick="abrirProcesso('${doc.matches[0].id}')"><i class="ti ti-arrow-right"></i></button>
            ${doc.link ? `<a href="${doc.link}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;font-size:11px;color:var(--gray-400);padding:4px 6px;text-decoration:none" title="DJEN"><i class="ti ti-external-link"></i></a>` : ''}
          </div>
        </div>`;
      }

      // Card expandido para processos novos (não cadastrados)
      const segredo = doc.partes?.cliente?.length <= 2;
      const clienteHtml = segredo
        ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:6px 10px;margin:6px 0">
             <div style="font-size:10px;font-weight:700;color:#92400e;margin-bottom:4px"><i class="ti ti-lock" style="font-size:10px"></i> Segredo de Justiça</div>
             <input id="dje-cliente-manual-${i}" type="text" class="form-input" placeholder="Nome do cliente" style="font-size:11px;padding:5px 9px">
           </div>`
        : (doc.partes?.cliente ? `<div style="font-size:11px;color:var(--gray-700);margin:3px 0"><b>Cliente:</b> ${doc.partes.cliente}${doc.partes.contrario ? ` · <b>vs</b> ${doc.partes.contrario}` : ''}</div>` : '');
      const preview = semNumero ? '' : doc.textoLimpo.slice(0, 110) + (doc.textoLimpo.length > 110 ? '…' : '');

      return `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px">
          <div style="display:flex;align-items:center;gap:5px">${badgeTipo}${badgeDecisao}${badgePubs}</div>
          <span style="font-size:10px;color:var(--gray-400);white-space:nowrap">${dataFmt} · ${doc.siglaTribunal || ''}</span>
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--navy)">${numPrincipal || '<span style="color:var(--gray-400);font-style:italic">Sem número</span>'}${doc.processos.length > 1 ? ` <span style="color:var(--gray-400);font-weight:400;font-size:11px">+${doc.processos.length-1}</span>` : ''}</div>
        ${orgao ? `<div style="font-size:10px;color:var(--gray-500);margin-top:1px">${orgao}</div>` : ''}
        ${clienteHtml}
        ${preview ? `<div style="font-size:11px;color:var(--gray-500);margin-top:5px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${preview}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          ${numPrincipal ? `<button class="btn-secondary" style="font-size:11px;padding:4px 10px" onclick="importarProcessoDJe(${i})"><i class="ti ti-plus"></i> Importar</button>` : ''}
          ${doc.link ? `<a href="${doc.link}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--gray-400);padding:4px 6px;text-decoration:none"><i class="ti ti-external-link" style="font-size:11px"></i> DJEN</a>` : ''}
        </div>
      </div>`;
    }).join('');

    lista.innerHTML = html;

  } catch(e) {
    titulo.textContent = '';
    lista.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px">❌ ${e.message || 'Erro ao acessar o DJEN.'}</div>`;
  }
}

const BUSCA_CONFIG = {
  numero:   { label: 'Número do processo (CNJ)', placeholder: '0000000-00.0000.0.00.0000\nPara vários, cole um por linha', hint: 'O tribunal é detectado automaticamente. Para vários, cole um número por linha.', tribunal: false, uf: false },
  oab:      { label: 'Número da OAB',            placeholder: 'Ex: 12345',       hint: 'Mais preciso que busca por nome — evita homônimos. Informe só o número e selecione UF e tribunal.', tribunal: true, uf: true  },
  advogado: { label: 'Nome do advogado',          placeholder: 'Ex: João Silva',  hint: 'Resultados ordenados por mais recente. Use todas as palavras do nome. Para busca exata sem homônimos, prefira a aba OAB.', tribunal: true, uf: false },
  cliente:  { label: 'Nome do cliente / parte',   placeholder: 'Ex: Empresa XYZ Ltda', hint: 'Resultados ordenados por mais recente. Use nome completo para evitar resultados genéricos.', tribunal: true, uf: false },
  cpf:      { label: 'CPF ou CNPJ',              placeholder: 'Somente números', hint: 'Selecione o tribunal para buscar.',                       tribunal: true,  uf: false },
};

function selecionarTipoBusca(tipo, btn) {
  _tipoBusca = tipo;
  document.querySelectorAll('.busca-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const cfg       = BUSCA_CONFIG[tipo];
  const inputArea = document.getElementById('busca-input-area');
  const inputEl   = document.getElementById('busca-input');

  document.getElementById('busca-label').textContent            = cfg.label;
  if (inputEl) {
    inputEl.placeholder  = cfg.placeholder;
    inputEl.value        = '';
    inputEl.style.height = '62px';
    inputEl.style.fontFamily = tipo === 'numero' ? 'monospace' : 'inherit';
  }
  document.getElementById('busca-hint').textContent             = cfg.hint;
  document.getElementById('busca-tribunal-wrap').style.display  = cfg.tribunal ? 'block' : 'none';
  document.getElementById('busca-oab-uf-wrap').style.display    = cfg.uf       ? 'block' : 'none';
  const sugestao = document.getElementById('busca-oab-sugestao');
  if (sugestao) sugestao.style.display = 'none';
  inputArea.style.display = 'block';
  limparResultadoBusca();
}

// Detecta se o texto digitado no campo de nome parece ser um número de OAB
function _verificarSugestaoOAB() {
  const sugestao = document.getElementById('busca-oab-sugestao');
  if (!sugestao) return;
  if (_tipoBusca !== 'advogado') { sugestao.style.display = 'none'; return; }
  const val = (document.getElementById('busca-input')?.value || '').trim();
  // Considera OAB: só números (ex: 59360) ou UF+número (ex: DF59360, SP 12345)
  const pareceOAB = /^\d{3,6}$/.test(val) || /^[A-Za-z]{2}[/ ]?\d{3,6}$/.test(val);
  sugestao.style.display = pareceOAB ? 'flex' : 'none';
}

// Clique no link "use a aba OAB": migra o valor digitado para o campo OAB
function _usarOABDetectada() {
  const val = (document.getElementById('busca-input')?.value || '').trim();
  // Extrai só os dígitos do número OAB
  const somenteDigitos = val.replace(/\D/g, '');
  // Extrai UF se presente (ex: "DF59360" → UF=DF)
  const ufMatch = val.toUpperCase().match(/^([A-Z]{2})[/ ]?\d/);
  const uf = ufMatch ? ufMatch[1] : '';

  // Clica na tab OAB
  const tabOAB = [...document.querySelectorAll('.busca-tab')].find(b => b.getAttribute('onclick')?.includes("'oab'"));
  if (tabOAB) selecionarTipoBusca('oab', tabOAB);

  // Preenche o campo com o número e seleciona a UF detectada
  const input = document.getElementById('busca-input');
  if (input) input.value = somenteDigitos;

  const ufSel = document.getElementById('busca-oab-uf-select');
  if (uf && ufSel) {
    const opt = [...ufSel.options].find(o => o.value === uf);
    if (opt) ufSel.value = uf;
  }
}

async function buscarProcesso() {
  const rawInput = document.getElementById('busca-input').value.trim();
  const btn      = document.getElementById('busca-btn');
  const tribunal = document.getElementById('busca-tribunal-select').value;
  const uf       = document.getElementById('busca-oab-uf-select').value;

  limparResultadoBusca();

  if (!rawInput) { mostrarErroBusca('Preencha o campo de busca.'); return; }

  // Detecta múltiplos números CNJ (apenas na aba número)
  if (_tipoBusca === 'numero') {
    const linhas = rawInput.split(/[\n\r,;]+/).map(l => l.trim()).filter(Boolean);
    const numerosValidos = linhas.map(l => l.replace(/\D/g, '')).filter(n => n.length === 20);
    if (numerosValidos.length > 1) {
      await _buscarLoteInterno(numerosValidos, btn);
      return;
    }
  }

  // Busca individual via DataJud CNJ
  let url;
  if (_tipoBusca === 'numero') {
    url = `/api/buscar-processo?tipo=numero&numero=${encodeURIComponent(rawInput)}`;
  } else {
    if (!tribunal) { mostrarErroBusca('Selecione o tribunal.'); return; }
    if (_tipoBusca === 'oab' && !uf) { mostrarErroBusca('Selecione a UF da OAB.'); return; }
    url = `/api/buscar-processo?tipo=${_tipoBusca}&q=${encodeURIComponent(rawInput)}&tribunal=${tribunal}`;
    if (_tipoBusca === 'oab') url += `&uf=${encodeURIComponent(uf)}`;
  }

  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>';
  btn.disabled  = true;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (!res.ok) { mostrarErroBusca(data.erro || 'Nenhum resultado.'); return; }
    exibirResultados(data.resultados || []);
  } catch {
    mostrarErroBusca('Erro de conexão. Tente novamente.');
  } finally {
    btn.innerHTML = '<i class="ti ti-search"></i> Buscar';
    btn.disabled  = false;
  }
}

async function _buscarPJeTJDFT(numero, btn) {
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> PJe...';
  btn.disabled  = true;

  try {
    const res = await fetch('http://localhost:8000/pje', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ numero_processo: numero }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      mostrarErroBusca(err.detail || 'Processo não encontrado no PJe TJDFT.');
      return;
    }

    const d = await res.json();

    // Transforma partes: "NOME - OAB ... - CPF ... (TIPO)" → { nome, tipo }
    const partes = (d.partes || []).map(p => {
      const m = p.participante.match(/^(.+?)\s*-\s*(?:OAB\s+\S+\s*-\s*)?CPF:[^(]+\(([^)]+)\)$/);
      return m ? { nome: m[1].trim(), tipo: m[2].trim() } : { nome: p.participante, tipo: '' };
    });

    // Transforma movimentações: "DD/MM/YYYY HH:MM:SS" → ISO
    const movimentos = (d.movimentacoes || []).map(m => {
      const [datePart, timePart] = m.data.split(' ');
      const [dd, mm, yyyy] = datePart.split('/');
      return { data: `${yyyy}-${mm}-${dd}T${timePart}`, nome: m.andamento };
    });

    exibirResultados([{
      numero:          d.numero,
      classe:          _pjeExtrairClasse(d.movimentacoes),
      tribunal:        'TJDFT',
      orgaoJulgador:   _pjeExtrairMagistrado(d.movimentacoes),
      dataAjuizamento: null,
      partes,
      movimentos,
      _fonte:          'pje_tjdft',
    }]);

  } catch (err) {
    const msg = err.message?.includes('Failed to fetch')
      ? 'Servidor Python não encontrado. No terminal: cd scripts && python api.py'
      : `Erro: ${err.message}`;
    mostrarErroBusca(msg);
  } finally {
    btn.innerHTML = '<i class="ti ti-search"></i> Buscar';
    btn.disabled  = false;
  }
}

function _pjeExtrairClasse(movs) {
  for (const m of (movs || [])) {
    const match = m.andamento.match(/para\s+([A-ZÁÀÃÂÉÊÍÓÔÕÚÜ\s]+?)\s*\(\d+\)/);
    if (match) return match[1].trim();
  }
  return '';
}

function _pjeExtrairMagistrado(movs) {
  for (const m of (movs || [])) {
    const match = m.andamento.match(/Magistrado\(a\)\s+(.+)/);
    if (match) return match[1].trim();
  }
  return '';
}

async function _buscarLoteInterno(numerosValidos, btn) {
  _loteResultados = [];

  const progressEl    = document.getElementById('lote-progress');
  const progressBar   = document.getElementById('lote-progress-bar');
  const progressText  = document.getElementById('lote-progress-text');
  const progressCount = document.getElementById('lote-progress-count');
  const resultadosEl  = document.getElementById('lote-resultados');
  const importarWrap  = document.getElementById('lote-importar-wrap');

  progressEl.style.display   = 'block';
  resultadosEl.style.display = 'flex';
  resultadosEl.innerHTML     = '';
  importarWrap.style.display = 'none';
  if (btn) { btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>'; btn.disabled = true; }

  const total = numerosValidos.length;

  for (let i = 0; i < total; i++) {
    const numFormatado = formatarNumero(numerosValidos[i]);
    progressText.textContent  = `Buscando: ${numFormatado}`;
    progressCount.textContent = `${i + 1}/${total}`;
    progressBar.style.width   = `${(i / total) * 100}%`;

    const item = { numero: numFormatado, status: 'buscando', data: null, selecionado: true };
    _loteResultados.push(item);
    renderizarLoteResultados();

    try {
      const res  = await fetch(`/api/buscar-processo?tipo=numero&numero=${encodeURIComponent(numFormatado)}`);
      const json = await res.json();
      if (res.ok && json.resultados?.length) {
        item.status = 'encontrado';
        item.data   = json.resultados[0];
      } else {
        item.status = 'nao_encontrado';
      }
    } catch {
      item.status = 'erro';
    }

    renderizarLoteResultados();
    resultadosEl.scrollTop = resultadosEl.scrollHeight;
  }

  progressBar.style.width   = '100%';
  progressText.textContent  = 'Busca concluída!';
  progressCount.textContent = `${total}/${total}`;
  if (btn) { btn.innerHTML = '<i class="ti ti-search"></i> Buscar'; btn.disabled = false; }

  const encontrados    = _loteResultados.filter(r => r.status === 'encontrado').length;
  const naoEncontrados = _loteResultados.filter(r => r.status === 'nao_encontrado').length;

  if (encontrados > 0) {
    importarWrap.style.display = 'block';
    atualizarLoteLabel();
  } else {
    mostrarErroBusca(
      naoEncontrados === total
        ? `Nenhum dos ${total} processos foi localizado no DataJud. Os números podem ainda não estar disponíveis online.`
        : 'Nenhum processo encontrado.'
    );
  }
}

function exibirResultados(lista) {
  if (!lista.length) { mostrarErroBusca('Nenhum processo encontrado.'); return; }

  // Reordena pelo movimento mais recente — garante 2025/2026 antes de 2023/2024
  if (_tipoBusca !== 'numero') {
    lista = [...lista].sort((a, b) => {
      const dA = a.movimentos?.[0]?.data ? new Date(a.movimentos[0].data) : new Date(0);
      const dB = b.movimentos?.[0]?.data ? new Date(b.movimentos[0].data) : new Date(0);
      return dB - dA;
    });
  }

  window._buscaResultados = lista;

  // Com múltiplos resultados: reutiliza o sistema de lote com checkboxes
  if (lista.length > 1) {
    _loteResultados = lista.map(d => {
      const jaExiste = !!(d.numero && (window._processosDB || []).some(p => p.numero === d.numero));
      return {
        numero:     d.numero || '—',
        status:     'encontrado',
        data:       d,
        selecionado: true,
        jaExiste,
      };
    });

    const resultadosEl = document.getElementById('lote-resultados');
    const importarWrap = document.getElementById('lote-importar-wrap');
    resultadosEl.style.display = 'flex';
    importarWrap.style.display = 'block';
    renderizarLoteResultados();
    atualizarLoteLabel();

    // Label informando ordenação para buscas por nome/OAB
    if (_tipoBusca !== 'numero') {
      const tipoLabel = { oab: 'OAB', advogado: 'Nome do advogado', cliente: 'Nome do cliente', cpf: 'CPF/CNPJ' };
      const loteLabel = document.getElementById('lote-importar-label');
      if (loteLabel) {
        loteLabel.insertAdjacentHTML('afterend',
          `<span id="lote-ordem-label" style="font-size:11px;color:var(--gray-400);display:flex;align-items:center;gap:4px;margin-top:2px">
            <i class="ti ti-sort-descending-2" style="font-size:12px"></i> Mais recentes primeiro · ${lista.length} resultado(s) — ${tipoLabel[_tipoBusca] || ''}
          </span>`
        );
      }
    }

    document.getElementById('busca-resultados-wrap').style.display = 'none';
    return;
  }

  // Resultado único: card expandido com botão de importar
  const wrap = document.getElementById('busca-resultados-wrap');
  wrap.style.display = 'flex';
  const fmt = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  const d = lista[0];
  const jaExiste = !!(d.numero && (window._processosDB || []).some(p => p.numero === d.numero));
  const btnLabel = jaExiste
    ? '<i class="ti ti-refresh"></i> Atualizar e mesclar'
    : '<i class="ti ti-cloud-download"></i> Importar e monitorar';

  wrap.innerHTML = `
    <div class="busca-result-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--navy)">${d.numero || '—'}</div>
          <div style="font-size:12px;color:var(--gray-500);margin-top:2px">${d.classe || ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#e8edf5;color:var(--navy);white-space:nowrap">${d.tribunal || ''}</span>
          ${jaExiste ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#dcfce7;color:#15803d">Já cadastrado</span>` : ''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px">
        <div><span style="color:var(--gray-400)">Órgão: </span><span style="font-weight:500">${d.orgaoJulgador || '—'}</span></div>
        <div><span style="color:var(--gray-400)">Ajuizado: </span><span style="font-weight:500">${fmt(d.dataAjuizamento)}</span></div>
      </div>
      ${d.partes && d.partes.length ? `
        <div style="font-size:12px;color:var(--gray-600);margin-bottom:10px">
          ${d.partes.slice(0,3).map(p => `<span style="margin-right:8px">· ${p.tipo ? '<em style=color:var(--gray-400)>'+p.tipo+'</em> ' : ''}${p.nome}</span>`).join('')}
        </div>` : ''}
      ${d.movimentos && d.movimentos.length ? `
        <div style="border-top:1px solid var(--gray-200);padding-top:8px;margin-bottom:10px">
          ${d.movimentos.slice(0,3).map(m => `
            <div style="display:flex;gap:6px;font-size:11px;margin-bottom:3px">
              <span style="color:var(--gray-400);white-space:nowrap;flex-shrink:0">${fmt(m.data)}</span>
              <span style="color:var(--gray-700)">${m.nome}</span>
            </div>`).join('')}
        </div>` : ''}
      <button class="btn-primary" style="width:100%;justify-content:center;font-size:12px;padding:8px;gap:6px"
        onclick="adicionarProcesso(0)">
        ${btnLabel}
      </button>
    </div>`;
}

async function adicionarProcesso(i) {
  const d = (window._buscaResultados || [])[i];
  if (!d) return;

  // Verifica se processo já existe para mesclar diretamente
  if (d.numero) {
    const jaExiste = (window._processosDB || []).some(p => p.numero === d.numero);
    if (jaExiste) {
      const result = await _importarComMerge(d);
      if (result.status === 'mesclado') {
        closeModal('modal-busca-tribunal');
        showToast('Processo atualizado e mesclado com seus dados existentes.');
        carregarProcessos();
      } else {
        showToast('Erro ao mesclar processo.');
      }
      return;
    }
  }

  // Processo novo: abre formulário para o advogado preencher os detalhes
  closeModal('modal-busca-tribunal');
  openModal('modal-novo-processo');

  setTimeout(() => {
    document.getElementById('np-numero').value           = d.numero          || '';
    document.getElementById('np-nome').value             = d.classe          || '';
    document.getElementById('np-tribunal').value         = d.tribunal        || '';
    document.getElementById('np-datajud-index').value    = d._datajudIndex   || '';
    document.getElementById('np-classe').value           = d.classe          || '';
    document.getElementById('np-orgao-julgador').value   = d.orgaoJulgador   || '';
    document.getElementById('np-data-ajuizamento').value = d.dataAjuizamento || '';
    window._importMovimentos = d.movimentos || [];

    const clientePart = (d.partes || []).find(p => /autor|requerente|reclamante/i.test(p.tipo));
    if (clientePart) document.getElementById('np-cliente').value = clientePart.nome || '';
  }, 100);
}

// ── SUPABASE: SALVAR PROCESSO ─────────────────────────────────────────────

async function salvarProcesso() {
  const btn = document.getElementById('btn-criar-processo');

  const numero  = document.getElementById('np-numero').value.trim();
  const nome    = document.getElementById('np-nome').value.trim();
  const cliente = document.getElementById('np-cliente').value.trim();

  if (!nome) { showToast('Preencha o nome / assunto do processo.'); return; }

  // Verifica duplicata pelo número
  if (numero) {
    const jaExiste = (window._processosDB || []).some(p => p.numero === numero);
    if (!jaExiste) {
      const { count } = await _supabase
        .from('processos').select('id', { count: 'exact', head: true })
        .eq('user_id', window._escritorioId).eq('numero', numero);
      if (count > 0) { showToast('Este processo já está cadastrado.'); return; }
    } else {
      showToast('Este processo já está cadastrado.');
      return;
    }
  }

  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  const payload = {
    user_id:         window._escritorioId,
    numero,
    nome,
    cliente,
    area:            document.getElementById('np-area').value,
    tribunal:        document.getElementById('np-tribunal').value.trim(),
    parte_contraria: document.getElementById('np-parte-contraria').value.trim(),
    datajud_index:       document.getElementById('np-datajud-index').value || null,
    classe:              document.getElementById('np-classe').value || null,
    orgao_julgador:      document.getElementById('np-orgao-julgador').value || null,
    data_ajuizamento:    document.getElementById('np-data-ajuizamento').value || null,
    movimentos_recentes: window._importMovimentos?.length ? window._importMovimentos : null,
    movimentos_hash:     window._importMovimentos?.length
      ? window._importMovimentos.map(m => m.data + m.nome).join('|') : null,
    ultima_verificacao:  window._importMovimentos?.length ? new Date().toISOString() : null,
  };

  const { error } = await _supabase.from('processos').insert(payload);

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-check"></i> Criar Processo';

  if (error) {
    showToast('Erro ao salvar: ' + error.message);
    return;
  }

  closeModal('modal-novo-processo');
  showToast('Processo salvo com sucesso!');
  carregarProcessos();
}

// ── SUPABASE: CARREGAR PROCESSOS ─────────────────────────────────────────

async function carregarProcessos() {
  if (!window._user) return;

  const uid = window._user.id;

  // Carrega processos + compartilhamentos em paralelo
  const [processosRes, countArqRes, sharedWithMeRes, mySharesRes, pendentesRes] = await Promise.all([
    _supabase.from('processos').select('*').neq('status', 'Arquivado').order('created_at', { ascending: false }),
    _supabase.from('processos').select('id', { count: 'exact', head: true }).eq('status', 'Arquivado'),
    _supabase.from('processo_compartilhamentos').select('processo_id,owner_nome,nivel_acesso').eq('shared_with_id', uid).eq('status', 'aceito'),
    _supabase.from('processo_compartilhamentos').select('processo_id,shared_with_nome,nivel_acesso').eq('owner_id', uid).eq('status', 'aceito'),
    _supabase.from('processo_compartilhamentos').select('id', { count: 'exact', head: true }).eq('shared_with_id', uid).eq('status', 'pendente'),
  ]);

  const data = processosRes.data;
  if (processosRes.error || !data) return;

  // Mapas de compartilhamento para renderização dos cards
  window._sharedSet   = {};  // processo_id → { nivel_acesso, owner_nome } — compartilhados comigo
  window._mySharesMap = {};  // processo_id → [{ nome, nivel }] — que eu compartilhei

  for (const s of (sharedWithMeRes.data || [])) {
    window._sharedSet[s.processo_id] = { nivel_acesso: s.nivel_acesso, owner_nome: s.owner_nome };
  }
  for (const s of (mySharesRes.data || [])) {
    if (!window._mySharesMap[s.processo_id]) window._mySharesMap[s.processo_id] = [];
    window._mySharesMap[s.processo_id].push({ nome: s.shared_with_nome, nivel: s.nivel_acesso });
  }

  // Reordena pelo movimento mais recente (mais ativo primeiro)
  data.sort((a, b) => {
    const dA = a.movimentos_recentes?.[0]?.data || a.ultima_verificacao || a.created_at || '';
    const dB = b.movimentos_recentes?.[0]?.data || b.ultima_verificacao || b.created_at || '';
    return dB.localeCompare(dA);
  });

  // Badge de processos (exclui os que eu não possuo — shared)
  const meus = data.filter(p => !window._sharedSet[p.id]);
  const badge = document.getElementById('badge-processos');
  if (badge) {
    badge.textContent   = meus.length;
    badge.style.display = meus.length ? 'inline-flex' : 'none';
  }

  // Badge de arquivados
  const countArq = countArqRes.count || 0;
  const badgeArq = document.getElementById('badge-arquivados');
  if (badgeArq) {
    badgeArq.textContent   = countArq;
    badgeArq.style.display = countArq ? 'inline-flex' : 'none';
  }

  // Badge de pendentes recebidos
  const countPend = pendentesRes.count || 0;
  const badgeParc = document.getElementById('badge-parceiros');
  if (badgeParc) {
    badgeParc.textContent   = countPend || 0;
    badgeParc.style.display = countPend ? 'inline-flex' : 'none';
  }

  window._processosDB = data;
  renderizarListaProcessos(data);
  atualizarDashboard(meus, countArq);
  atualizarBell();

  // Carrega clientes e honorários em background para ficarem disponíveis no detalhe do processo
  carregarClientes();
  carregarHonorarios();

  // Enriquece em background processos com número CNJ mas sem datajud_index
  _enriquecerPendentes(meus);
}

// Roda _enriquecerComDatajud para processos que têm número mas nunca cruzaram com DataJud
// Processa em lotes de 3 para não sobrecarregar a API
const _ENR_COOLDOWN_KEY = 'enriquecimento_ultimo';
const _ENR_COOLDOWN_MS  = 60 * 60 * 1000; // 1h

async function _enriquecerPendentes(lista) {
  const ultimo = parseInt(localStorage.getItem(_ENR_COOLDOWN_KEY) || '0', 10);
  if (Date.now() - ultimo < _ENR_COOLDOWN_MS) return;

  const pendentes = (lista || []).filter(p =>
    p.numero && !p.datajud_index && p.numero.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/)
  );
  if (!pendentes.length) return;

  localStorage.setItem(_ENR_COOLDOWN_KEY, String(Date.now()));

  // Favoritos primeiro
  pendentes.sort((a, b) => (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0));

  for (let i = 0; i < pendentes.length; i += 3) {
    const lote = pendentes.slice(i, i + 3);
    await Promise.all(lote.map(p => _enriquecerComDatajud(p.numero)));
    if (i + 3 < pendentes.length) await new Promise(r => setTimeout(r, 1500));
  }
}

function atualizarDashboard(processos, totalArquivados) {
  const sharedCount = Object.keys(window._sharedSet || {}).length;
  const ativos      = processos.length + sharedCount;
  const comSync     = processos.filter(p => p.datajud_index).length;
  const essaSemana  = (window._processosDB || []).filter(p => _ultimaAtividadeDias(p) <= 7).length;

  // Saudação com nome real
  const nome = window._user?.user_metadata?.full_name || window._user?.email?.split('@')[0] || '';
  const hora = new Date().getHours();
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const greet = document.getElementById('dash-greeting');
  if (greet) greet.textContent = nome ? `${saud}, ${nome}!` : `${saud}!`;

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const sub = document.getElementById('dash-sub');
  if (sub) sub.textContent = hoje.charAt(0).toUpperCase() + hoje.slice(1);

  // Stat cards
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('stat-processos-ativos', ativos);
  const subProcessos = sharedCount > 0
    ? `${processos.length} próprio${processos.length !== 1 ? 's' : ''} + ${sharedCount} compartilhado${sharedCount !== 1 ? 's' : ''}`
    : comSync > 0 ? `${comSync} sincronizado(s) com CNJ` : 'Nenhum sincronizado';
  set('stat-processos-sub', subProcessos);

  set('stat-notificacoes', essaSemana || '0');
  const elNotiSub = document.getElementById('stat-notificacoes-sub');
  if (elNotiSub) {
    elNotiSub.textContent = essaSemana > 0 ? `${essaSemana} processo(s) com atividade` : 'Nenhuma atualização';
    elNotiSub.className   = `stat-change ${essaSemana > 0 ? 'up' : ''}`;
  }

  set('stat-arquivados', totalArquivados);

  atualizarPrazosDash();

  // Processos Recentes
  const wrap = document.getElementById('dash-processos-recentes');
  if (!wrap) return;

  if (!processos.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:36px 20px">
      <i class="ti ti-briefcase" style="font-size:36px;display:block;margin-bottom:12px;color:var(--gray-200)"></i>
      <div style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:6px">Nenhum processo ainda</div>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:18px">Adicione processos para acompanhar aqui</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn-primary" style="font-size:12px;padding:7px 14px" onclick="abrirModalNovoProcesso()"><i class="ti ti-plus"></i> Novo processo</button>
        <button class="btn-secondary" style="font-size:12px;padding:7px 14px" onclick="abrirModalBusca()"><i class="ti ti-search"></i> Buscar no CNJ</button>
      </div>
    </div>`;
    return;
  }

  const areaMap = { 'Cível':'civil','Trabalhista':'trabalhista','Criminal':'criminal','Tributário':'tributario','Família':'familia','Previdenciário':'previdenciario' };
  wrap.innerHTML = processos.slice(0, 5).map(p => `
    <div class="process-row" onclick="abrirProcesso('${p.id}')">
      <div class="process-num">${p.numero || '—'}</div>
      <div class="process-info">
        <div class="process-name">${p.apelido || p.nome}${p.notificacao_pendente ? ` <span title="Nova movimentação" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--amber);vertical-align:middle"></span>` : ''}</div>
        <div class="process-meta">
          ${p.datajud_index
            ? `<i class="ti ti-cloud-check" style="font-size:10px;color:var(--green)"></i> CNJ DataJud`
            : `<i class="ti ti-pencil" style="font-size:10px"></i> Manual`
          }
          ${p.orgao_julgador ? ` · ${p.orgao_julgador}` : ''}
          ${p.notificacao_pendente ? formatarHorarioMov(p.novos_movimentos?.[0]?.data) : ''}
        </div>
      </div>
      <span class="badge badge-${areaMap[p.area] || 'civil'}">${p.area || 'Cível'}</span>
    </div>`).join('');

  atualizarTimelineDash(processos);
  atualizarPrazosDash();
}

function atualizarTimelineDash(processos) {
  const wrap = document.getElementById('dash-atualizacoes-recentes');
  if (!wrap) return;

  const atualizacoes = [];
  for (const p of processos) {
    const movs = p.novos_movimentos?.length
      ? p.novos_movimentos
      : (p.movimentos_recentes || []).slice(0, 1);
    for (const m of movs.slice(0, 2)) {
      atualizacoes.push({ processo: p.apelido || p.nome, texto: m.nome, data: m.data, novo: !!p.novos_movimentos?.length });
    }
  }
  atualizacoes.sort((a, b) => new Date(b.data) - new Date(a.data));

  if (!atualizacoes.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:28px 20px;color:var(--gray-400)">
        <i class="ti ti-timeline" style="font-size:28px;display:block;margin-bottom:8px;opacity:0.35"></i>
        <div style="font-size:13px;font-weight:500">Nenhuma atualização ainda</div>
        <div style="font-size:12px;margin-top:4px;opacity:.75">As atualizações aparecem aqui quando um processo for sincronizado com o CNJ.</div>
      </div>`;
    return;
  }

  const fmt = iso => {
    if (!iso) return '';
    const d    = new Date(iso);
    const diff = Math.floor((Date.now() - d) / 3600000);
    if (diff < 1)  return 'Há menos de 1h';
    if (diff < 24) return `Há ${diff}h`;
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  };

  wrap.innerHTML = atualizacoes.slice(0, 5).map(a => `
    <div class="timeline-item">
      <div class="tl-dot ${a.novo ? 'gold' : 'navy'}"></div>
      <div class="tl-content">
        <div class="tl-text"><strong>${a.processo}</strong> — ${a.texto}</div>
        <div class="tl-time">${fmt(a.data)} · CNJ DataJud</div>
      </div>
    </div>`).join('');
}

function atualizarPrazosDash() {
  const hoje  = new Date(); hoje.setHours(0, 0, 0, 0);
  const em7   = new Date(hoje); em7.setDate(em7.getDate() + 7);

  const eventosSemana = (_eventosDB || [])
    .filter(e => { const d = new Date(e.data + 'T12:00:00'); return d >= hoje && d <= em7; })
    .map(e => ({ tipoItem: 'evento', data: e.data, ordem: e.data, raw: e }));

  const honorariosSemana = (_honorariosDB || [])
    .filter(h => h.data_vencimento && (h.status === 'pendente' || h.status === 'vencido'))
    .filter(h => { const d = new Date(h.data_vencimento + 'T12:00:00'); return d >= hoje && d <= em7; })
    .map(h => ({ tipoItem: 'honorario', data: h.data_vencimento, ordem: h.data_vencimento, raw: h }));

  const todos = [...eventosSemana, ...honorariosSemana].sort((a, b) => a.ordem.localeCompare(b.ordem));

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-prazos', String(todos.length));
  if (!todos.length) {
    set('stat-prazos-sub', 'Nenhum nesta semana');
  } else {
    const partes = [];
    if (eventosSemana.length) partes.push(`${eventosSemana.length} compromisso${eventosSemana.length > 1 ? 's' : ''}`);
    if (honorariosSemana.length) partes.push(`${honorariosSemana.length} honorário${honorariosSemana.length > 1 ? 's' : ''}`);
    set('stat-prazos-sub', partes.join(' · '));
  }

  const wrap = document.getElementById('dash-prazos-recentes');
  if (!wrap) return;

  if (!todos.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:28px 20px;color:var(--gray-400)">
        <i class="ti ti-calendar-off" style="font-size:28px;display:block;margin-bottom:8px;opacity:0.35"></i>
        <div style="font-size:13px;font-weight:500">Nenhum prazo nos próximos 7 dias</div>
        <div style="font-size:12px;margin-top:4px;opacity:.75">Clique em "Programar Lembrete" para adicionar.</div>
      </div>`;
    return;
  }

  const urgCls    = { alta: 'urgency-alta', media: 'urgency-media', baixa: 'urgency-baixa' };
  const tipoLabel = { prazo_processual:'Prazo Processual', audiencia:'Audiência', lembrete:'Lembrete', reuniao:'Reunião' };

  wrap.innerHTML = todos.slice(0, 6).map(item => {
    const dt   = new Date(item.data + 'T12:00:00');
    const dias = Math.ceil((dt - hoje) / 86400000);
    const dia  = dt.toLocaleDateString('pt-BR', { day:'2-digit' });
    const mes  = dt.toLocaleDateString('pt-BR', { month:'short' }).replace('.','');
    const badgeCls = dias <= 1 ? 'dias-urgente' : dias <= 3 ? 'dias-aviso' : 'dias-ok';
    const diasTxt  = dias <= 0 ? 'Hoje' : dias === 1 ? 'Amanhã' : dias + 'd';

    if (item.tipoItem === 'honorario') {
      const h = item.raw;
      const valorFmt = (h.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const urgencia = h.status === 'vencido' ? 'urgency-alta' : 'urgency-media';
      return `
        <div class="prazo-item" onclick="showPage('honorarios')">
          <div class="prazo-date"><div class="prazo-day">${dia}</div><div class="prazo-month">${mes}</div></div>
          <div class="prazo-urgency ${urgencia}"></div>
          <div class="prazo-info">
            <div class="prazo-name"><i class="ti ti-cash" style="font-size:11px;color:var(--gray-400);margin-right:3px"></i>${escHtml(h.cliente_nome || h.descricao)} — ${valorFmt}</div>
            <div class="prazo-type">${h.status === 'vencido' ? 'Honorário vencido' : 'Honorário a vencer'}</div>
          </div>
          <span class="dias-badge ${badgeCls}">${diasTxt}</span>
        </div>`;
    }

    const e = item.raw;
    return `
      <div class="prazo-item" onclick="irParaCalendarioMes(${dt.getFullYear()},${dt.getMonth()})">
        <div class="prazo-date"><div class="prazo-day">${dia}</div><div class="prazo-month">${mes}</div></div>
        <div class="prazo-urgency ${urgCls[e.urgencia] || 'urgency-baixa'}"></div>
        <div class="prazo-info">
          <div class="prazo-name"><i class="ti ti-calendar-event" style="font-size:11px;color:var(--gray-400);margin-right:3px"></i>${escHtml(e.titulo)}</div>
          <div class="prazo-type">${tipoLabel[e.tipo] || 'Lembrete'}</div>
        </div>
        <span class="dias-badge ${badgeCls}">${diasTxt}</span>
      </div>`;
  }).join('');
}

function renderizarListaProcessos(lista) {
  const grid  = document.getElementById('lista-processos-db');
  const empty = document.getElementById('processos-empty');
  if (!grid) return;

  grid.querySelectorAll('.process-card[data-db], .section-sep[data-dyn]').forEach(el => el.remove());

  const sub = document.getElementById('processos-sub-header');
  if (sub) sub.textContent = lista.length ? `${lista.length} processo(s) ativo(s)` : 'Nenhum processo cadastrado';

  // Separar favoritos × outros e ordenar por recência
  const favs   = lista.filter(p => p.favorito && !p._isShared).sort(_sortRecente);
  const outros = lista.filter(p => !p.favorito || p._isShared).sort(_sortRecente);

  if (!lista.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const fmtHora = iso => {
    if (!iso) return 'nunca verificado';
    const h = Math.floor((Date.now() - new Date(iso)) / 3600000);
    if (h < 1)  return 'há menos de 1h';
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(h/24)}d`;
  };

  const statusCls = s => (s || 'Ativo').toLowerCase().replace(/\s/g, '-');
  const areaMap   = { 'Cível':'civil','Trabalhista':'trabalhista','Criminal':'criminal','Tributário':'tributario','Família':'familia','Previdenciário':'previdenciario' };

  const criarCard = p => {
    const temSync    = !!p.datajud_index;
    const temNotif   = !!p.notificacao_pendente;
    const isShared   = !!window._sharedSet?.[p.id];
    const sharedInfo = isShared ? window._sharedSet[p.id] : null;
    const myShares   = window._mySharesMap?.[p.id] || [];
    const rec        = _recenciaInfo(p);

    const card = document.createElement('div');
    card.className = `process-card${temNotif ? ' pc-notif' : ''}${isShared ? ' pc-compartilhado' : ''}`;
    card.setAttribute('data-db', p.id);
    card.onclick = () => abrirProcesso(p.id);

    const diasSemVerif = p.ultima_verificacao
      ? (Date.now() - new Date(p.ultima_verificacao)) / 86400000 : 999;
    const syncDot = diasSemVerif <= 7
      ? (temSync ? '#22c55e' : '#60a5fa')
      : (temSync ? '#f59e0b' : '#d1d5db');
    const syncTip = diasSemVerif <= 7
      ? (temSync ? 'Atualizado via CNJ DataJud' : 'Verificado recentemente')
      : (temSync ? 'CNJ — verificação desatualizada' : 'Sem sincronização automática');

    const avatarHtml = myShares.length ? (() => {
      const visiveis = myShares.slice(0, 3);
      const extra    = myShares.length - visiveis.length;
      const dots     = visiveis.map(s => {
        const iniciais = s.nome.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const nv       = s.nivel === 'total' ? 'nivel-total' : s.nivel === 'comentario' ? 'nivel-comentario' : 'nivel-leitura';
        const label    = s.nivel === 'total' ? 'Acesso total' : s.nivel === 'comentario' ? 'Comentários' : 'Leitura';
        return `<div class="pc-avatar-dot ${nv}" title="${_esc(s.nome)} — ${label}">${iniciais}</div>`;
      }).join('');
      const extraHtml = extra ? `<div class="pc-avatar-dot" style="background:#9ca3af" title="+ ${extra} pessoa(s)">+${extra}</div>` : '';
      return `<div class="pc-avatars">${dots}${extraHtml}</div>`;
    })() : '';

    card.innerHTML = `
      <div class="pc-top">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="pc-num">${p.numero || '—'}</span>
          ${rec ? `<span class="recencia-badge ${rec.cls}">${rec.label}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          ${isShared ? `<span class="pc-share-badge"><i class="ti ti-share" style="font-size:9px"></i> ${_esc(sharedInfo.owner_nome.split(' ')[0])}</span>` : ''}
          <span title="${syncTip}" style="width:7px;height:7px;border-radius:50%;background:${syncDot};flex-shrink:0;display:inline-block"></span>
          <span class="pc-status status-${statusCls(p.status)}">${p.status || 'Ativo'}</span>
          ${!isShared ? `
            <button class="pc-fav-btn${p.favorito ? ' ativo' : ''}" onclick="favoritar(event,'${p.id}')" title="${p.favorito ? 'Remover dos favoritos' : 'Favoritar'}">
              <i class="ti ${p.favorito ? 'ti-star-filled' : 'ti-star'}"></i>
            </button>
            <button class="btn-arquivar-card" title="Arquivar processo"
              onclick="pedirArquivar(event,'${p.id}','${(p.nome||'').replace(/'/g,'\\x27')}')">
              <i class="ti ti-archive"></i>
            </button>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;min-width:0" class="pc-title-row">
        <div class="pc-title" style="flex:1;min-width:0" id="pc-title-${p.id}">${p.apelido || p.nome}</div>
        ${!isShared ? `<button onclick="editarApelidoCard(event,'${p.id}')" title="Editar apelido"
          style="background:none;border:none;padding:2px 4px;cursor:pointer;color:var(--gray-400);font-size:12px;flex-shrink:0;opacity:0;transition:opacity .15s"
          class="btn-edit-apelido-card">
          <i class="ti ti-pencil"></i>
        </button>` : ''}
      </div>
      ${p.apelido ? `<div style="font-size:11px;color:var(--gray-400);margin-top:-2px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nome}</div>` : ''}
      <div class="pc-client">
        <i class="ti ti-user" style="font-size:12px"></i>
        ${p.cliente || 'Cliente não informado'}
        ${p.classe ? `<span style="margin-left:6px;color:var(--gray-400)">· ${p.classe}</span>` : ''}
      </div>
      <div class="pc-meta" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="badge badge-${areaMap[p.area] || 'civil'}">${p.area || 'Cível'}</span>
        ${temSync && !isShared ? `
          <button class="btn-atualizar-mini"
            onclick="verificarProcessoAgora(event,'${p.id}','${p.datajud_index}','${p.numero}')">
            <i class="ti ti-refresh"></i> Atualizar
          </button>` : ''}
        ${!isShared ? `<button class="pc-share-btn" onclick="abrirModalCompartilhar(event,'${p.id}')" title="Compartilhar processo">
          <i class="ti ti-user-plus" style="font-size:11px"></i> Compartilhar
        </button>` : `<span class="share-nivel-badge ${sharedInfo.nivel_acesso}">${sharedInfo.nivel_acesso === 'total' ? 'Acesso total' : sharedInfo.nivel_acesso === 'comentario' ? 'Comentários' : 'Leitura'}</span>`}
        ${avatarHtml}
      </div>
      ${(() => {
        const ultimoMov = p.movimentos_recentes?.[0];
        if (temNotif && p.novos_movimentos?.length) {
          return `<div class="pc-prazo" style="color:#1d4ed8;border-top-color:#dbeafe">
            <i class="ti ti-bell-ringing"></i>
            <span style="font-weight:600">${p.novos_movimentos[0].nome}</span>
          </div>`;
        }
        if (ultimoMov) {
          const nomeResumido = ultimoMov.nome.length > 55 ? ultimoMov.nome.slice(0, 55) + '…' : ultimoMov.nome;
          const dataFormatada = ultimoMov.data ? new Date(ultimoMov.data).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }) : '';
          return `<div class="pc-prazo" title="${ultimoMov.nome}">
            <i class="ti ti-clock" style="font-size:13px"></i>
            <span>${dataFormatada ? dataFormatada + ' · ' : ''}${nomeResumido}</span>
          </div>`;
        }
        return `<div class="pc-prazo"><i class="ti ti-pencil" style="font-size:13px"></i> Sem movimentações</div>`;
      })()}`;

    return card;
  };

  // Injetar separadores e cards por seção
  const mkSep = (icon, texto, extraCls = '') => {
    const sep = document.createElement('div');
    sep.className = `section-sep${extraCls ? ' ' + extraCls : ''}`;
    sep.setAttribute('data-dyn', '1');
    sep.innerHTML = `<i class="ti ${icon}"></i> ${texto}`;
    return sep;
  };

  if (favs.length) {
    grid.insertBefore(mkSep('ti-star-filled', 'Favoritos', 'fav-sep'), empty);
    favs.forEach(p => grid.insertBefore(criarCard(p), empty));
  }
  if (favs.length && outros.length) {
    grid.insertBefore(mkSep('ti-list', 'Todos os processos'), empty);
  }
  outros.forEach(p => grid.insertBefore(criarCard(p), empty));
}

function filtrarProcessos() {
  const q      = (document.getElementById('filter-texto')?.value   || '').toLowerCase().trim();
  const area   = (document.getElementById('filter-area')?.value    || '');
  const status = (document.getElementById('filter-status')?.value  || '');

  let lista = window._processosDB || [];

  if (q) {
    lista = lista.filter(p =>
      (p.numero  || '').toLowerCase().includes(q) ||
      (p.nome    || '').toLowerCase().includes(q) ||
      (p.apelido || '').toLowerCase().includes(q) ||
      (p.cliente || '').toLowerCase().includes(q) ||
      (p.classe  || '').toLowerCase().includes(q)
    );
  }
  if (area)   lista = lista.filter(p => (p.area   || 'Cível') === area);
  if (status) lista = lista.filter(p => (p.status || 'Ativo') === status);
  if (window._filtroSemana) {
    lista = lista.filter(p => _ultimaAtividadeDias(p) <= 7);
    const chip = document.getElementById('chip-semana');
    if (chip) chip.style.display = 'inline-flex';
  } else {
    const chip = document.getElementById('chip-semana');
    if (chip) chip.style.display = 'none';
  }

  renderizarListaProcessos(lista);
}

function topbarSearch(q) {
  const drop = document.getElementById('topbar-search-drop');
  if (!drop) return;
  const term = (q || '').toLowerCase().trim();
  if (!term) { drop.style.display = 'none'; return; }

  const resultados = (window._processosDB || []).filter(p =>
    (p.numero  || '').toLowerCase().includes(term) ||
    (p.nome    || '').toLowerCase().includes(term) ||
    (p.apelido || '').toLowerCase().includes(term) ||
    (p.cliente || '').toLowerCase().includes(term)
  ).slice(0, 6);

  if (!resultados.length) {
    drop.innerHTML = `<div style="padding:12px 16px;font-size:13px;color:var(--gray-400)">Nenhum resultado encontrado</div>`;
    drop.style.display = 'block';
    return;
  }

  drop.innerHTML = resultados.map(p => `
    <div onmousedown="topbarSearchSelect('${p.id}')"
      style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--gray-100);display:flex;flex-direction:column;gap:2px"
      onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
      <div style="font-size:13px;font-weight:600;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.apelido || p.nome}</div>
      <div style="font-size:11px;color:var(--gray-400)">${p.numero || '—'}${p.cliente ? ' · ' + p.cliente : ''}</div>
    </div>
  `).join('');
  drop.style.display = 'block';
}

function topbarSearchSelect(id) {
  const drop  = document.getElementById('topbar-search-drop');
  const input = document.getElementById('topbar-search-input');
  if (drop)  drop.style.display = 'none';
  if (input) input.value = '';
  abrirProcesso(id);
}

function filtrarTarefas(q) {
  const term = (q || '').toLowerCase().trim();
  const procMap = {};
  for (const p of (window._processosDB || [])) procMap[p.id] = p.apelido || p.nome;

  const lista = term
    ? (_tarefasDB || []).filter(t =>
        (t.titulo || '').toLowerCase().includes(term) ||
        (t.processo_id && (procMap[t.processo_id] || '').toLowerCase().includes(term))
      )
    : (_tarefasDB || []);

  renderizarKanban(lista, procMap);
}

function filtrarCalendario(q) {
  const wrap = document.getElementById('cal-este-mes');
  if (!wrap) return;
  const term = (q || '').toLowerCase().trim();

  const doMes = _eventosDB.filter(e => {
    const d = new Date(e.data + 'T12:00:00');
    if (d.getFullYear() !== fullCalDate.getFullYear() || d.getMonth() !== fullCalDate.getMonth()) return false;
    if (!term) return true;
    return (e.titulo || '').toLowerCase().includes(term) || (e.tipo || '').toLowerCase().includes(term);
  });

  if (!doMes.length) {
    const msg = term ? 'Nenhum evento encontrado' : 'Nenhum evento este mês';
    wrap.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--gray-400);font-size:12px">
      <i class="ti ti-calendar-off" style="font-size:22px;display:block;margin-bottom:6px;opacity:0.35"></i>
      ${msg}
    </div>`;
    return;
  }

  const tipoLabel = { prazo_processual: 'Prazo Fatal', audiencia: 'Audiência', lembrete: 'Lembrete', reuniao: 'Reunião' };
  const urgCls    = { alta: 'urgency-alta', media: 'urgency-media', baixa: 'urgency-baixa' };

  wrap.innerHTML = doMes.map(e => {
    const dt  = new Date(e.data + 'T12:00:00');
    const dia = dt.toLocaleDateString('pt-BR', { day: '2-digit' });
    const mes = dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    const cls = _tipoEvtCls[e.tipo] || 'event-lembrete';
    const sh  = e.processo_id ? window._sharedSet?.[e.processo_id] : null;
    const shLine = sh ? `<div style="font-size:10px;color:#7c3aed;margin-top:2px"><i class="ti ti-handshake" style="font-size:10px"></i> ${_esc(sh.owner_nome)}</div>` : '';
    return `
      <div class="prazo-item">
        <div class="prazo-date"><div class="prazo-day">${dia}</div><div class="prazo-month">${mes}</div></div>
        <div class="prazo-urgency ${urgCls[e.urgencia] || 'urgency-baixa'}"></div>
        <div class="prazo-info">
          <div class="prazo-name">${e.titulo}</div>
          <div class="prazo-type"><span class="badge ${cls}">${tipoLabel[e.tipo] || 'Lembrete'}</span></div>
          ${shLine}
        </div>
        <button onclick="excluirEvento('${e.id}')" title="Excluir"
          style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:14px;padding:4px;line-height:1">
          <i class="ti ti-trash"></i>
        </button>
      </div>`;
  }).join('');
}

async function verificarProcessoAgora(evt, id, datajudIndex, numero) {
  evt.stopPropagation();
  const btn = evt.currentTarget;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>';
  btn.disabled  = true;

  try {
    const res  = await fetch(`/api/buscar-processo?tipo=numero&numero=${encodeURIComponent(numero)}`);
    const data = await res.json();
    if (!res.ok || !data.resultados?.length) throw new Error('sem resultado');

    const d     = data.resultados[0];
    const movs  = d.movimentos || [];
    const hash  = movs.map(m => m.data + m.nome).join('|');

    const proc  = (window._processosDB || []).find(p => p.id === id);
    const novo  = hash !== proc?.movimentos_hash;
    const novos = novo && proc?.movimentos_hash
      ? movs.filter(m => !proc.movimentos_hash.includes(m.data + m.nome))
      : [];

    await _supabase.from('processos').update({
      movimentos_recentes:  movs,
      movimentos_hash:      hash,
      ultima_verificacao:   new Date().toISOString(),
      notificacao_pendente: novo && novos.length > 0,
      novos_movimentos:     novos.length ? novos : null,
    }).eq('id', id);

    showToast(novo && novos.length ? `${novos.length} nova(s) movimentação(ões)!` : 'Nenhuma novidade.');
    carregarProcessos();
  } catch {
    showToast('Erro ao verificar. Tente novamente.');
  } finally {
    btn.innerHTML = '<i class="ti ti-refresh"></i> Atualizar agora';
    btn.disabled  = false;
  }
}

// ── DETALHE DO PROCESSO ───────────────────────────────────────────────────

let _processoAtual = null;

async function abrirProcesso(id) {
  let proc = (window._processosDB || []).find(p => p.id === id);

  // Processo pode ser arquivado — busca direto do banco se não estiver em memória
  if (!proc) {
    const { data } = await _supabase.from('processos').select('*').eq('id', id).single();
    if (!data) return;
    proc = data;
  }

  // Enriquece processo com metadados de compartilhamento (se for shared)
  _processoAtual              = { ...proc };
  _processoAtual._isShared    = !!window._sharedSet?.[id];
  _processoAtual._sharedNivel = window._sharedSet?.[id]?.nivel_acesso || null;
  _processoAtual._sharedOwner = window._sharedSet?.[id]?.owner_nome   || null;

  // Marca notificação como lida
  if (proc.notificacao_pendente) {
    await _supabase.from('processos')
      .update({ notificacao_pendente: false, novos_movimentos: null })
      .eq('id', id);
    proc.notificacao_pendente = false;
    carregarProcessos();
  }

  showPage('processo-detalhe');
  popularDetalhe(proc);
  carregarPrazosProcesso(proc.id);
}

function popularDetalhe(proc) {
  document.getElementById('topbar-title').textContent = proc.apelido || proc.nome || 'Processo';

  // Tags (área + status)
  const areaMap = { 'Cível':'civil','Trabalhista':'trabalhista','Criminal':'criminal','Tributário':'tributario','Família':'familia','Previdenciário':'previdenciario' };
  const statusCls = s => (s || 'Ativo').toLowerCase().replace(/\s/g, '-');
  const isArquivado = proc.status === 'Arquivado';
  document.getElementById('detalhe-tags').innerHTML = `
    <span class="badge badge-${areaMap[proc.area] || 'civil'}">${proc.area || 'Cível'}</span>
    <span class="pc-status status-${statusCls(proc.status)}" style="font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600">${proc.status || 'Ativo'}</span>
    ${isArquivado ? `
    <button class="btn-atualizar-mini" style="border-color:var(--green);color:var(--green)"
      onclick="restaurarProcesso(event,'${proc.id}','${(proc.nome||'').replace(/'/g,"'")}')">
      <i class="ti ti-rotate-clockwise"></i> Restaurar processo
    </button>` : ''}`;

  // Badge e botão de sync
  const syncBadge = document.getElementById('detalhe-sync-badge');
  const syncBtn   = document.getElementById('detalhe-btn-sync');
  if (proc.datajud_index) {
    const fmtH = iso => iso ? `· verificado ${_tempoRelativo(iso) || fmtHora(iso)}` : '';
    syncBadge.style.display = 'inline-flex';
    syncBadge.className     = 'pc-sync-badge';
    syncBadge.innerHTML     = `<i class="ti ti-cloud-check"></i> CNJ DataJud ${fmtH(proc.ultima_verificacao)}`;
    syncBtn.style.display   = 'inline-flex';
  } else {
    syncBadge.style.display = 'none';
    syncBtn.style.display   = 'none';
  }

  // Título imutável (vindo do tribunal)
  const nomeEl = document.getElementById('detalhe-nome-proc');
  if (nomeEl) nomeEl.textContent = proc.nome || proc.numero || '—';

  // Apelido (campo separado e editável)
  const display = document.getElementById('detalhe-apelido-display');
  if (proc.apelido) {
    display.textContent   = proc.apelido;
    display.style.color   = 'var(--navy)';
    display.style.opacity = '1';
  } else {
    display.textContent   = 'Adicionar apelido...';
    display.style.color   = 'var(--gray-400)';
    display.style.opacity = '0.8';
  }

  // Número e órgão
  document.getElementById('detalhe-numero-orgao').textContent =
    [proc.numero, proc.orgao_julgador, proc.tribunal].filter(Boolean).join(' · ');

  // Grid de campos
  const fmt = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  const clienteVinculado = proc.cliente_id
    ? (_clientesDB || []).find(c => c.id === proc.cliente_id)
    : null;
  const clienteNome = clienteVinculado?.nome || proc.cliente || '—';
  const clienteLink = clienteVinculado
    ? `<span style="font-size:11px;color:var(--blue);cursor:pointer;margin-left:6px" onclick="showPage('clientes')">
         <i class="ti ti-arrow-right"></i>ver ficha
       </span>`
    : '';

  const honsProc = (_honorariosDB || []).filter(h => h.processo_id === proc.id && h.status !== 'cancelado');
  const honTotal = honsProc.reduce((s, h) => s + Number(h.valor), 0);
  const honVenc  = honsProc.filter(h => h.status === 'vencido').length;
  const honHtml  = honsProc.length
    ? `<span style="color:var(--navy);font-weight:600">R$ ${_fmtValor(honTotal)}</span>
       ${honVenc ? `<span style="color:var(--red);font-size:11px;margin-left:6px">(${honVenc} vencido${honVenc>1?'s':''})</span>` : ''}
       <span style="font-size:11px;color:var(--blue);cursor:pointer;margin-left:6px" onclick="showPage('honorarios')">
         <i class="ti ti-arrow-right"></i>ver honorários
       </span>`
    : `<span style="color:var(--gray-400)">—</span>
       <span style="font-size:11px;color:var(--blue);cursor:pointer;margin-left:6px" onclick="openModal('modal-novo-honorario');setTimeout(()=>{const s=document.getElementById('hon-processo');if(s)s.value='${proc.id}'},100)">
         <i class="ti ti-plus"></i> adicionar
       </span>`;

  document.getElementById('detalhe-grid').innerHTML = `
    <div class="detail-field"><label>Cliente</label><p>${clienteNome}${clienteLink}</p></div>
    <div class="detail-field"><label>Classe</label><p>${proc.classe || '—'}</p></div>
    <div class="detail-field"><label>Tribunal</label><p>${proc.tribunal || '—'}</p></div>
    <div class="detail-field"><label>Distribuído em</label><p>${fmt(proc.data_ajuizamento)}</p></div>
    <div class="detail-field" style="grid-column:1/-1"><label>Honorários vinculados</label><p>${honHtml}</p></div>`;

  // Timeline
  renderizarTimelineCNJ(proc);
  _atualizarBadgesDetalhe(proc);
  _renderizarResponsaveis(proc.id);
}

function fmtHora(iso) {
  if (!iso) return 'nunca';
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000);
  if (h < 1)  return 'há menos de 1h';
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function _urlTribunalPublico(idx) {
  if (!idx) return null;
  const c = idx.replace('api_publica_', '');
  const especiais = {
    stf:  'https://portal.stf.jus.br/processos/',
    stj:  'https://processo.stj.jus.br/processo/pesquisa/',
    tst:  'https://www.tst.jus.br/consulta-unificada',
    tjsp: 'https://esaj.tjsp.jus.br/cpopg/open.do',
    tjsc: 'https://esaj.tjsc.jus.br/cpopg/open.do',
    tjce: 'https://esaj.tjce.jus.br/cpopg/open.do',
    tjba: 'https://pje.tjba.jus.br/pje/ConsultaPublica/listView.seam',
    tjpe: 'https://pje.tjpe.jus.br/1grau/ConsultaPublica/listView.seam',
    tjrj: 'https://www3.tjrj.jus.br/consultaprocessual/pages/consulta/defConsulta.seam',
    tjmg: 'https://www4.tjmg.jus.br/juridico/sf/proc_complemento2.jsp',
    tjrs: 'https://www.tjrs.jus.br/novo/busca/?categoria=processo',
    tjpr: 'https://projudi.tjpr.jus.br/projudi/',
    tjgo: 'https://projudi.tjgo.jus.br/BuscaProcesso',
    trf1: 'https://processual.trf1.jus.br/consultaProcessual/',
    trf2: 'https://consultaprocessual.trf2.jus.br/consultaprocessual/servlet/ServletTRF2',
    trf3: 'https://web.trf3.jus.br/consulta/processual/Consulta/PesquisarProcesso',
    trf4: 'https://eproc.trf4.jus.br/eproc2trf4/controlador.php?acao=processo_consulta_publica',
    trf5: 'https://pje.trf5.jus.br/pje/ConsultaPublica/listView.seam',
    trf6: 'https://pje.trf6.jus.br/pje/ConsultaPublica/listView.seam',
  };
  if (especiais[c]) return especiais[c];
  // TRTs → PJe padrão
  if (c.startsWith('trt')) return `https://pje.${c}.jus.br/consultaprocessual/pages/consulta/ConsultaProcessual.seam`;
  // TJs estaduais → PJe padrão
  if (c.startsWith('tj'))  return `https://pje.${c}.jus.br/consultapublica/ConsultaPublica/listView.seam`;
  return null;
}

function renderizarTimelineCNJ(proc) {
  const wrap = document.getElementById('timeline-cnj-wrap');
  if (!wrap) return;

  const linkTribunal = _urlTribunalPublico(proc.datajud_index);
  const movsCNJ   = (proc.movimentos_recentes || []).map(m => ({ ...m, _tipo: 'cnj' }));
  const notas     = (proc.notas_manuais || []).map(n => ({ nome: n.texto, data: n.created_at, _tipo: 'nota', _id: n.id }));
  const novosSet  = new Set((proc.novos_movimentos || []).map(m => m.data + m.nome));

  // LOG (historico) removido da timeline principal — contabilizado nos badges das abas
  const todos = [...movsCNJ, ...notas].sort((a, b) => new Date(b.data) - new Date(a.data));

  const fmt = iso => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' }); }
    catch { return iso; }
  };

  if (!todos.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:40px 0;color:var(--gray-400)">
        <i class="ti ti-timeline" style="font-size:32px;display:block;margin-bottom:12px"></i>
        <div style="font-weight:500;margin-bottom:8px">Nenhuma movimentação ainda</div>
        <div style="font-size:13px;margin-bottom:16px">
          ${proc.datajud_index
            ? 'Sincronize com o CNJ DataJud ou adicione uma anotação acima.'
            : 'Adicione anotações acima para registrar o histórico deste processo.'}
        </div>
        ${proc.datajud_index
          ? `<button class="btn-primary" onclick="sincronizarDetalhe()">
               <i class="ti ti-cloud-download"></i> Carregar movimentações
             </button>`
          : ''}
      </div>`;
    return;
  }

  const totalCNJ   = movsCNJ.length;
  const totalNotas = notas.length;

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:6px">
      <div style="font-size:13px;font-weight:600;color:var(--navy)">
        ${totalCNJ     ? `<span style="color:var(--navy)">${totalCNJ} movimentação(ões)</span>` : ''}
        ${totalCNJ && totalNotas ? ' · ' : ''}
        ${totalNotas   ? `<span style="color:var(--amber)">${totalNotas} anotação(ões)</span>` : ''}
      </div>
      ${proc.datajud_index
        ? `<button class="btn-secondary" style="font-size:11px;padding:4px 10px" onclick="sincronizarDetalhe()">
             <i class="ti ti-refresh"></i> Atualizar CNJ
           </button>`
        : (proc.numero
            ? `<button class="btn-secondary" style="font-size:11px;padding:4px 10px" onclick="_enriquecerComDatajud('${proc.numero}')">
                 <i class="ti ti-cloud-download"></i> Buscar no CNJ
               </button>`
            : '')}
    </div>
    <div class="cnj-timeline">
      ${todos.map(m => {
        const isNovo      = m._tipo === 'cnj' && novosSet.has(m.data + m.nome);
        const isNota      = m._tipo === 'nota';
        const isHistorico = m._tipo === 'historico';
        return `
        <div class="cnj-tl-item ${isNovo ? 'cnj-tl-item--novo' : ''} ${isHistorico ? 'cnj-tl-item--historico' : ''}">
          <div class="cnj-tl-dot ${isNovo ? 'cnj-tl-dot--novo' : isNota ? 'cnj-tl-dot--nota' : isHistorico ? 'cnj-tl-dot--historico' : ''}"></div>
          <div class="cnj-tl-body">
            <div class="cnj-tl-data">
              ${fmt(m.data)}
              ${isNota
                ? `<span style="margin-left:6px;background:var(--amber-light);color:var(--amber);font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px">NOTA</span>`
                : isHistorico
                  ? `<span style="margin-left:6px;background:var(--gray-100);color:var(--gray-400);font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px">LOG</span>`
                  : m._fonte === 'djen'
                    ? '<span style="margin-left:6px;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px">DJEN</span>'
                    : '<span style="margin-left:6px;background:#e8f0fe;color:#1a2e6b;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px">CNJ</span>'
              }
              ${m._url
                ? `<a href="${m._url}" target="_blank" rel="noopener" title="Ver publicação" style="margin-left:6px;color:var(--gray-400);font-size:11px;text-decoration:none;vertical-align:middle"><i class="ti ti-external-link"></i></a>`
                : (!isNota && !isHistorico && linkTribunal)
                  ? `<a href="${linkTribunal}" target="_blank" rel="noopener" title="Ver no tribunal" style="margin-left:6px;color:var(--gray-400);font-size:11px;text-decoration:none;vertical-align:middle;opacity:.7;transition:opacity .15s" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7"><i class="ti ti-external-link"></i></a>`
                  : ''}
            </div>
            <div class="cnj-tl-nome">
              ${isNota      ? `<i class="ti ti-pencil" style="font-size:11px;color:var(--amber);margin-right:4px"></i>` : ''}
              ${isHistorico ? `<i class="ti ti-history" style="font-size:11px;color:var(--gray-400);margin-right:4px"></i>` : ''}
              ${m.nome}
              ${isHistorico && m._autor ? `<span style="color:var(--gray-300);font-size:11px;font-style:normal;margin-left:4px">— ${m._autor}</span>` : ''}
              ${isNovo ? '<span class="cnj-tl-novo-badge">NOVO</span>' : ''}
            </div>
            ${isNota ? `
              <button onclick="excluirNota('${m._id}')"
                style="margin-top:4px;background:none;border:none;color:var(--gray-400);font-size:11px;cursor:pointer;padding:0">
                <i class="ti ti-trash"></i> remover
              </button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

async function adicionarNota() {
  const input = document.getElementById('nota-input');
  const texto = input?.value.trim();
  if (!texto || !_processoAtual) return;

  const nota = {
    id:         crypto.randomUUID(),
    texto,
    created_at: new Date().toISOString(),
  };

  const notas = [...(_processoAtual.notas_manuais || []), nota];

  const { error } = await _supabase
    .from('processos')
    .update({ notas_manuais: notas })
    .eq('id', _processoAtual.id);

  if (error) { showToast('Erro ao salvar anotação.'); return; }

  _processoAtual.notas_manuais = notas;
  input.value = '';
  await logHistorico('nota_add', 'Adicionou uma anotação à timeline');
  renderizarTimelineCNJ(_processoAtual);
  showToast('Anotação registrada na timeline.');
}

async function excluirNota(notaId) {
  if (!_processoAtual) return;
  const notas = (_processoAtual.notas_manuais || []).filter(n => n.id !== notaId);

  const { error } = await _supabase
    .from('processos')
    .update({ notas_manuais: notas })
    .eq('id', _processoAtual.id);

  if (error) { showToast('Erro ao remover anotação.'); return; }

  _processoAtual.notas_manuais = notas;
  await logHistorico('nota_remove', 'Removeu uma anotação da timeline');
  renderizarTimelineCNJ(_processoAtual);
  showToast('Anotação removida.');
}

// ── HISTÓRICO ──────────────────────────────────────────────────────────────
async function logHistorico(tipo, descricao) {
  if (!_processoAtual) return;
  const entrada = {
    id: crypto.randomUUID(),
    tipo,
    descricao,
    autor_id:   window._user?.id,
    autor_nome: window._user?.user_metadata?.nome || window._user?.email || 'Usuário',
    created_at: new Date().toISOString(),
  };
  const historico = [...(_processoAtual.historico || []), entrada];
  _processoAtual.historico = historico;
  await _supabase.from('processos').update({ historico }).eq('id', _processoAtual.id);
  renderizarTimelineCNJ(_processoAtual);
}

// ── COMENTÁRIOS ────────────────────────────────────────────────────────────
function popularComentarios(proc) {
  const lista  = document.getElementById('coment-lista');
  if (!lista) return;
  lista.innerHTML = renderComentarios(proc.comentarios || []);

  // Bloqueia entrada de comentários para nível "leitura"
  const podeEscrever = !proc._isShared || proc._sharedNivel !== 'leitura';
  const area         = document.getElementById('coment-input');
  const sendBtn      = document.getElementById('coment-send-btn');
  if (area)    area.disabled    = !podeEscrever;
  if (sendBtn) sendBtn.disabled = !podeEscrever;
  if (area && !podeEscrever) area.placeholder = 'Você tem acesso de somente leitura neste processo.';
}

function renderComentarios(comentarios) {
  if (!comentarios.length) {
    return '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:24px 0">Nenhum comentário ainda.</p>';
  }
  const tops = comentarios.filter(c => !c.reply_to_id);
  return tops.map(c => {
    const replies = comentarios.filter(r => r.reply_to_id === c.id);
    return `
      <div class="coment-item" id="coment-${c.id}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
          <span class="coment-autor">${_esc(c.autor_nome)}</span>
          <span class="coment-data">${_fmtDataComent(c.created_at)}</span>
          <button class="coment-action-btn" onclick="responderComentario('${c.id}','${_esc(c.autor_nome).replace(/'/g,"\\'")}')">
            <i class="ti ti-corner-down-right"></i> Responder
          </button>
          ${c.autor_id === window._user?.id ? `<button class="coment-action-btn danger" onclick="excluirComentario('${c.id}')"><i class="ti ti-trash"></i></button>` : ''}
        </div>
        <div class="coment-texto">${_fmtTextoComent(c.texto)}</div>
        ${replies.map(r => `
          <div class="coment-reply-item" id="coment-${r.id}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
              <span class="coment-autor">${_esc(r.autor_nome)}</span>
              <span class="coment-data">${_fmtDataComent(r.created_at)}</span>
              ${r.autor_id === window._user?.id ? `<button class="coment-action-btn danger" onclick="excluirComentario('${r.id}')"><i class="ti ti-trash"></i></button>` : ''}
            </div>
            <div class="coment-texto">${_fmtTextoComent(r.texto)}</div>
          </div>
        `).join('')}
      </div>`;
  }).join('');
}

async function adicionarComentario() {
  if (!_processoAtual) return;
  const area    = document.getElementById('coment-input');
  const sendBtn = document.getElementById('coment-send-btn');
  const texto   = area?.value.trim();
  if (!texto) return;

  if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .6s linear infinite"></i>'; }

  const entry = {
    id:          crypto.randomUUID(),
    autor_id:    window._user?.id,
    autor_nome:  window._user?.user_metadata?.nome || window._user?.email || 'Usuário',
    texto,
    reply_to_id: window._replyToId || null,
    created_at:  new Date().toISOString(),
  };
  const comentarios = [...(_processoAtual.comentarios || []), entry];
  _processoAtual.comentarios = comentarios;

  const { error } = await _supabase.from('processos').update({ comentarios }).eq('id', _processoAtual.id);

  if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<i class="ti ti-send"></i>'; }

  if (error) { showToast('Erro ao salvar comentário.', 'error'); return; }

  area.value = '';
  cancelarReply();
  popularComentarios(_processoAtual);
  showToast('Comentário publicado!', 'success');
  await logHistorico('coment_add', 'Adicionou um comentário');
}

async function excluirComentario(id) {
  if (!_processoAtual) return;
  const todos = _processoAtual.comentarios || [];
  const alvo  = todos.find(c => c.id === id);
  if (!alvo || alvo.autor_id !== window._user?.id) return;

  const { error } = await _supabase.rpc('excluir_comentario', {
    p_processo_id: _processoAtual.id,
    p_comment_id:  id,
  });
  if (error) { showToast('Erro ao excluir comentário.', 'error'); return; }

  _processoAtual.comentarios = todos.filter(c => c.id !== id && c.reply_to_id !== id);
  popularComentarios(_processoAtual);
  await logHistorico('coment_remove', 'Removeu um comentário');
}

function responderComentario(id, nomeAutor) {
  window._replyToId   = id;
  window._replyToNome = nomeAutor;
  const banner = document.getElementById('coment-reply-banner');
  const label  = document.getElementById('coment-reply-label');
  if (banner) banner.style.display = 'flex';
  if (label)  label.textContent    = `Respondendo @${nomeAutor}`;
  document.getElementById('coment-input')?.focus();
}

function cancelarReply() {
  window._replyToId   = null;
  window._replyToNome = null;
  const banner = document.getElementById('coment-reply-banner');
  if (banner) banner.style.display = 'none';
}

function comentTecla(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    adicionarComentario();
  }
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _fmtDataComent(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }) + ' ' +
         d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

function _fmtTextoComent(texto) {
  return _esc(texto).replace(/@(\w+)/g, '<span class="coment-mention">@$1</span>');
}

// ── DOCUMENTOS ─────────────────────────────────────────────────────────────
let _docList = [];

async function popularDocumentos(proc) {
  const lista = document.getElementById('doc-lista');
  if (!lista) return;

  // Esconde área de upload para quem não tem nível 'total'
  const podeUpload = !proc._isShared || proc._sharedNivel === 'total';
  const uploadArea = document.querySelector('.doc-upload-area');
  if (uploadArea) uploadArea.style.display = podeUpload ? 'block' : 'none';

  lista.innerHTML = '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:16px">Carregando...</p>';

  const { data: docs, error } = await _supabase
    .from('documentos')
    .select('*')
    .eq('processo_id', proc.id)
    .order('created_at', { ascending: false });

  if (error) { lista.innerHTML = '<p style="color:var(--red);font-size:13px;padding:12px">Erro ao carregar documentos.</p>'; return; }

  _docList = docs || [];

  if (!_docList.length) {
    lista.innerHTML = '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:24px 0">Nenhum documento ainda.</p>';
    return;
  }

  lista.innerHTML = _docList.map((d, i) => `
    <div class="doc-item">
      <i class="ti ${_docIcone(d.tipo_mime)}" style="font-size:20px;color:var(--navy);flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(d.nome)}</div>
        <div style="font-size:11px;color:var(--gray-400)">${_fmtTamanho(d.tamanho)} · ${_esc(d.uploader_nome)} · ${_fmtDataComent(d.created_at)}</div>
      </div>
      <button class="doc-btn" onclick="baixarDocumento(${i})" title="Baixar"><i class="ti ti-download"></i></button>
      <button class="doc-btn danger" onclick="excluirDocumento(${i})" title="Excluir"><i class="ti ti-trash"></i></button>
    </div>
  `).join('');
}

async function uploadDocumento(file) {
  if (!_processoAtual || !file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Arquivo muito grande. Limite: 2 MB.'); return; }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path     = `${window._escritorioId}/${_processoAtual.id}/${Date.now()}_${safeName}`;

  const { error: upErr } = await _supabase.storage.from('documentos').upload(path, file, { contentType: file.type });
  if (upErr) { showToast('Erro no upload: ' + upErr.message); return; }

  const { error: insErr } = await _supabase.from('documentos').insert({
    processo_id:   _processoAtual.id,
    escritorio_id: window._escritorioId,
    nome:          file.name,
    storage_path:  path,
    tamanho:       file.size,
    tipo_mime:     file.type || '',
    uploader_id:   window._user.id,
    uploader_nome: window._user?.user_metadata?.nome || window._user?.email || 'Usuário',
  });

  if (insErr) {
    await _supabase.storage.from('documentos').remove([path]);
    showToast('Erro ao registrar documento: ' + insErr.message);
    return;
  }

  const input = document.getElementById('doc-file-input');
  if (input) input.value = '';

  showToast('Documento enviado com sucesso.');
  await logHistorico('doc_add', `Adicionou o documento "${file.name}"`);
  popularDocumentos(_processoAtual);
}

async function baixarDocumento(idx) {
  const doc = _docList[idx];
  if (!doc) return;
  const { data, error } = await _supabase.storage.from('documentos').createSignedUrl(doc.storage_path, 60);
  if (error) { showToast('Erro ao gerar link de download.'); return; }
  window.open(data.signedUrl, '_blank');
}

async function excluirDocumento(idx) {
  const doc = _docList[idx];
  if (!doc) return;
  if (!await _confirmar(`Excluir o documento "${doc.nome}"? Esta ação não pode ser desfeita.`, 'Excluir documento', { textoOk: 'Excluir', perigo: true, icone: '🗑️' })) return;

  await _supabase.storage.from('documentos').remove([doc.storage_path]);
  const { error } = await _supabase.from('documentos').delete().eq('id', doc.id);
  if (error) { showToast('Erro ao excluir documento.'); return; }

  showToast('Documento excluído.');
  await logHistorico('doc_remove', `Removeu o documento "${doc.nome}"`);
  popularDocumentos(_processoAtual);
}

function _docIcone(mime) {
  if (!mime) return 'ti-file';
  if (mime.includes('pdf'))                                    return 'ti-file-type-pdf';
  if (mime.includes('image'))                                  return 'ti-photo';
  if (mime.includes('word') || mime.includes('document'))      return 'ti-file-type-doc';
  if (mime.includes('sheet') || mime.includes('excel'))        return 'ti-file-type-xls';
  if (mime.includes('zip')  || mime.includes('compressed'))    return 'ti-file-zip';
  return 'ti-file';
}

function _fmtTamanho(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function sincronizarDetalhe() {
  if (!_processoAtual?.datajud_index || !_processoAtual?.numero) return;

  const btn = document.getElementById('detalhe-btn-sync');
  if (btn) { btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Sincronizando...'; btn.disabled = true; }

  try {
    const res  = await fetch(`/api/buscar-processo?tipo=numero&numero=${encodeURIComponent(_processoAtual.numero)}`);
    const data = await res.json();
    if (!res.ok || !data.resultados?.length) throw new Error();

    const movs  = data.resultados[0].movimentos || [];
    const hash  = movs.map(m => m.data + m.nome).join('|');
    const novos = _processoAtual.movimentos_hash
      ? movs.filter(m => !_processoAtual.movimentos_hash.includes(m.data + m.nome))
      : [];

    const upd = {
      movimentos_recentes: movs,
      movimentos_hash:     hash,
      ultima_verificacao:  new Date().toISOString(),
      notificacao_pendente: novos.length > 0,
      novos_movimentos:    novos.length ? novos : null,
    };

    await _supabase.from('processos').update(upd).eq('id', _processoAtual.id);
    Object.assign(_processoAtual, upd);

    renderizarTimelineCNJ(_processoAtual);
    document.getElementById('detalhe-sync-badge').innerHTML =
      `<i class="ti ti-cloud-check"></i> CNJ DataJud · verificado agora`;

    showToast(novos.length ? `${novos.length} nova(s) movimentação(ões)!` : 'Timeline atualizada. Sem novidades.');
    carregarProcessos();
  } catch {
    showToast('Erro ao sincronizar. Tente novamente.');
  } finally {
    if (btn) { btn.innerHTML = '<i class="ti ti-refresh"></i> Sincronizar'; btn.disabled = false; }
  }
}

// ── APELIDO ───────────────────────────────────────────────────────────────

function editarApelido() {
  const display = document.getElementById('detalhe-apelido-display');
  const input   = document.getElementById('detalhe-apelido-input');
  input.value   = _processoAtual?.apelido || '';
  display.style.display = 'none';
  input.style.display   = 'block';
  input.focus();
  if (input.value) input.select();
}

async function salvarApelido() {
  const input   = document.getElementById('detalhe-apelido-input');
  const display = document.getElementById('detalhe-apelido-display');
  const novo    = input.value.trim();

  input.style.display   = 'none';
  display.style.display = 'block';

  if (!_processoAtual) return;

  // Não salva se não mudou nada
  const apelidoAtual = _processoAtual.apelido || '';
  if (novo === apelidoAtual) return;

  const apelidoSalvar = novo || null;
  if (novo) {
    display.textContent   = novo;
    display.style.color   = 'var(--navy)';
    display.style.opacity = '1';
  } else {
    display.textContent   = 'Adicionar apelido...';
    display.style.color   = 'var(--gray-400)';
    display.style.opacity = '0.8';
  }
  _processoAtual.apelido = apelidoSalvar;
  document.getElementById('topbar-title').textContent = novo || _processoAtual.nome;

  const { error } = await _supabase
    .from('processos')
    .update({ apelido: apelidoSalvar })
    .eq('id', _processoAtual.id);

  if (error) {
    console.error('Erro ao salvar apelido:', error);
    showToast('Erro: ' + (error.message || 'coluna apelido não encontrada — rode migration_tarefas_v2.sql'));
    return;
  }
  carregarProcessos();
  showToast(novo ? 'Apelido salvo.' : 'Apelido removido.');
  await logHistorico('apelido_change', novo ? `Alterou o apelido para "${novo}"` : 'Removeu o apelido do processo');
}

function editarApelidoCard(event, processoId) {
  event.stopPropagation();
  const proc = (window._processosDB || []).find(p => p.id === processoId);
  if (!proc) return;

  const titleEl = document.getElementById('pc-title-' + processoId);
  if (!titleEl) return;

  const apelidoAnterior = proc.apelido || '';

  const input = document.createElement('input');
  input.type        = 'text';
  input.value       = apelidoAnterior;
  input.placeholder = 'Adicionar apelido...';
  input.style.cssText = 'font-size:14px;font-weight:500;padding:2px 6px;height:26px;width:100%;border:1px solid var(--navy);border-radius:4px;outline:none;color:var(--gray-800);font-family:inherit';

  titleEl.replaceWith(input);
  input.focus();
  if (input.value) input.select();

  const concluir = async () => {
    const novo = input.value.trim();

    // Restaura display
    const novoEl = document.createElement('div');
    novoEl.className = 'pc-title';
    novoEl.id        = 'pc-title-' + processoId;
    novoEl.style.cssText = 'flex:1;min-width:0';
    novoEl.textContent = novo || proc.nome;
    input.replaceWith(novoEl);

    if (novo === apelidoAnterior) return;

    const { error } = await _supabase
      .from('processos')
      .update({ apelido: novo || null })
      .eq('id', processoId);

    if (error) {
      console.error('Erro ao salvar apelido:', error);
      showToast('Erro: ' + (error.message || 'verifique o console'));
      return;
    }
    proc.apelido = novo || null;
    showToast(novo ? 'Apelido salvo.' : 'Apelido removido.');
    carregarProcessos();
  };

  input.addEventListener('blur', concluir);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = apelidoAnterior; input.blur(); }
  });
}

// ── NOTIFICAÇÕES ──────────────────────────────────────────────────────────

const _notifPrefs = {
  get processos()  { return localStorage.getItem('notif_processos')  !== 'false'; },
  get calendario() { return localStorage.getItem('notif_calendario') !== 'false'; },
  get tarefas()    { return localStorage.getItem('notif_tarefas')    !== 'false'; },
  set processos(v)  { localStorage.setItem('notif_processos',  String(v)); },
  set calendario(v) { localStorage.setItem('notif_calendario', String(v)); },
  set tarefas(v)    { localStorage.setItem('notif_tarefas',    String(v)); },
};

function atualizarBell() {
  const bell    = document.getElementById('notif-bell');
  const badge   = document.getElementById('notif-badge');
  const hoje    = new Date();
  const em7     = new Date(); em7.setDate(hoje.getDate() + 7);
  const hojeStr = hoje.toISOString().slice(0, 10);

  let total = 0;
  if (_notifPrefs.processos)
    total += (window._processosDB || []).filter(p => p.notificacao_pendente).length;
  if (_notifPrefs.calendario)
    total += (_eventosDB || []).filter(e => { const d = new Date(e.data + 'T12:00:00'); return d >= hoje && d <= em7; }).length;
  if (_notifPrefs.tarefas)
    total += (_tarefasDB || []).filter(t =>
      t.coluna !== 'concluida' && (t.prioridade === 'urgente' || (t.prazo && t.prazo < hojeStr))
    ).length;

  // Ponto azul no sino do topbar
  const topbarBadge = document.getElementById('topbar-notif-badge');
  if (topbarBadge) topbarBadge.style.display = total > 0 ? 'block' : 'none';
}

let _notifPanelAberto = false;

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  _notifPanelAberto = !_notifPanelAberto;
  if (_notifPanelAberto) {
    _renderNotifPanel();
    panel.style.display = 'flex';
    setTimeout(() => document.addEventListener('click', _fecharNotifFora, { once: true }), 50);
  } else {
    panel.style.display = 'none';
  }
}

function _fecharNotifFora(e) {
  const panel    = document.getElementById('notif-panel');
  const bellBtn  = document.querySelector('.icon-btn [id="topbar-bell"]')?.closest('.icon-btn');
  if (panel && !panel.contains(e.target) && (!bellBtn || !bellBtn.contains(e.target))) {
    panel.style.display = 'none';
    _notifPanelAberto = false;
  } else if (panel && panel.style.display !== 'none') {
    setTimeout(() => document.addEventListener('click', _fecharNotifFora, { once: true }), 50);
  }
}

function _toggleNotifPref(cat) {
  _notifPrefs[cat] = !_notifPrefs[cat];
  _renderNotifPanel();
  atualizarBell();
}

function _notifToggleBtn(cat) {
  const on = _notifPrefs[cat];
  return `<div onclick="event.stopPropagation();_toggleNotifPref('${cat}')" title="${on ? 'Desativar' : 'Ativar'}"
    style="cursor:pointer;width:22px;height:13px;background:${on ? '#1d4ed8' : '#bfdbfe'};border-radius:7px;position:relative;flex-shrink:0;transition:background .2s">
    <div style="position:absolute;top:2px;left:${on ? '11px' : '2px'};width:9px;height:9px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 2px rgba(0,0,0,.2)"></div>
  </div>`;
}

function _renderNotifPanel() {
  const body = document.getElementById('notif-panel-body');
  if (!body) return;

  const hoje    = new Date();
  const em7     = new Date(); em7.setDate(hoje.getDate() + 7);
  const hojeStr = hoje.toISOString().slice(0, 10);
  const fmt     = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });

  const tipoEvento = { prazo_processual:'Prazo', audiencia:'Audiência', lembrete:'Lembrete', reuniao:'Reunião' };

  const secoes = [
    {
      cat: 'processos', icon: 'ti-briefcase', label: 'Processos',
      cor: '#3b82f6',
      items: (window._processosDB || []).filter(p => p.notificacao_pendente),
      html: p => `<div onclick="abrirProcesso('${p.id}');toggleNotifPanel()" style="padding:6px 16px 6px 36px;cursor:pointer;display:flex;align-items:center;gap:8px;border-radius:6px;margin:0 8px 2px;transition:background .12s" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background='transparent'">
        <i class="ti ti-point-filled" style="font-size:8px;color:#3b82f6;flex-shrink:0"></i>
        <div style="min-width:0">
          <div style="font-size:12.5px;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.apelido || p.nome}</div>
          <div style="font-size:11px;color:var(--gray-400)">Nova movimentação</div>
        </div>
      </div>`,
    },
    {
      cat: 'calendario', icon: 'ti-calendar', label: 'Calendário',
      cor: 'var(--blue)',
      items: (_eventosDB || []).filter(e => { const d = new Date(e.data + 'T12:00:00'); return d >= hoje && d <= em7; }),
      html: e => `<div onclick="showPage('calendario');toggleNotifPanel()" style="padding:6px 16px 6px 36px;cursor:pointer;display:flex;align-items:center;gap:8px;border-radius:6px;margin:0 8px 2px;transition:background .12s" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background='transparent'">
        <i class="ti ti-point-filled" style="font-size:8px;color:var(--blue);flex-shrink:0"></i>
        <div style="min-width:0;flex:1">
          <div style="font-size:12.5px;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.titulo}</div>
          <div style="font-size:11px;color:var(--gray-400)">${tipoEvento[e.tipo] || e.tipo} · ${fmt(e.data)}</div>
        </div>
      </div>`,
    },
    {
      cat: 'tarefas', icon: 'ti-checklist', label: 'Tarefas',
      cor: 'var(--red)',
      items: (_tarefasDB || []).filter(t => t.coluna !== 'concluida' && (t.prioridade === 'urgente' || (t.prazo && t.prazo < hojeStr))),
      html: t => `<div onclick="showPage('tarefas');toggleNotifPanel()" style="padding:6px 16px 6px 36px;cursor:pointer;display:flex;align-items:center;gap:8px;border-radius:6px;margin:0 8px 2px;transition:background .12s" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background='transparent'">
        <i class="ti ti-point-filled" style="font-size:8px;color:var(--red);flex-shrink:0"></i>
        <div style="min-width:0;flex:1">
          <div style="font-size:12.5px;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.titulo}</div>
          <div style="font-size:11px;color:${t.prazo && t.prazo < hojeStr ? 'var(--red)' : 'var(--gray-400)'}">${t.prazo && t.prazo < hojeStr ? 'Vencida em ' + fmt(t.prazo) : 'Urgente'}</div>
        </div>
      </div>`,
    },
  ];

  const todasOff = secoes.every(s => !_notifPrefs[s.cat]);
  const temItem  = secoes.some(s => _notifPrefs[s.cat] && s.items.length);

  let html = secoes.map(s => {
    const on    = _notifPrefs[s.cat];
    const count = on ? s.items.length : 0;
    const itens = on && s.items.length
      ? s.items.slice(0, 5).map(s.html).join('') +
        (s.items.length > 5 ? `<div style="font-size:11px;color:var(--gray-400);padding:2px 16px 10px 36px">+ ${s.items.length - 5} mais</div>` : '')
      : (on ? `<div style="font-size:12px;color:var(--gray-300);padding:2px 16px 10px 36px">Nenhuma no momento</div>` : '');
    return `<div style="padding:11px 16px ${on && s.items.length ? '6px' : '11px'};border-bottom:1px solid var(--gray-100)">
      <div style="display:flex;align-items:center;justify-content:space-between;${on ? 'margin-bottom:6px' : ''}">
        <div style="display:flex;align-items:center;gap:7px">
          <i class="ti ${s.icon}" style="font-size:14px;color:var(--navy)"></i>
          <span style="font-size:13px;font-weight:600;color:var(--gray-900)">${s.label}</span>
          ${on && count ? `<span style="font-size:10px;font-weight:700;background:#dbeafe;color:#1d4ed8;padding:0 6px;border-radius:10px;line-height:17px">${count}</span>` : ''}
        </div>
        ${_notifToggleBtn(s.cat)}
      </div>
      ${itens}
    </div>`;
  }).join('');

  if (todasOff) {
    html += `<div style="padding:24px 20px;text-align:center;color:var(--gray-400);font-size:13px">
      <i class="ti ti-bell-slash" style="font-size:28px;display:block;margin-bottom:8px;opacity:.4"></i>
      Todas as notificações estão desativadas.
    </div>`;
  } else if (!temItem) {
    html += `<div style="padding:20px;text-align:center;color:var(--gray-400);font-size:13px">
      <i class="ti ti-circle-check" style="font-size:28px;display:block;margin-bottom:8px;color:#22c55e;opacity:.7"></i>
      Tudo em dia!
    </div>`;
  }

  body.innerHTML = html;
}

// ── LOGOUT ────────────────────────────────────────────────────────────────

async function fazerLogout() {
  await _supabase.auth.signOut();
  window.location.href = '/login';
}

// ── SYNC AUTOMÁTICO ───────────────────────────────────────────────────────

const SYNC_INTERVALO_MS = 10 * 60 * 1000; // 10 minutos
let _syncTimer = null;

async function sincronizarTodos(silencioso = false) {
  const procs = (window._processosDB || []).filter(p => p.datajud_index && p.numero);
  if (!procs.length) return;

  atualizarBarraSync('sincronizando');
  if (!silencioso) showToast(`Verificando ${procs.length} processo(s)...`);

  let atualizados = 0;

  for (const p of procs) {
    try {
      const res  = await fetch(`/api/buscar-processo?tipo=numero&numero=${encodeURIComponent(p.numero)}`);
      const data = await res.json();
      if (!res.ok || !data.resultados?.length) continue;

      const movs  = data.resultados[0].movimentos || [];
      const hash  = movs.map(m => m.data + m.nome).join('|');
      if (hash === p.movimentos_hash) continue;

      const novos = p.movimentos_hash
        ? movs.filter(m => !p.movimentos_hash.includes(m.data + m.nome))
        : [];

      await _supabase.from('processos').update({
        movimentos_recentes:  movs,
        movimentos_hash:      hash,
        ultima_verificacao:   new Date().toISOString(),
        notificacao_pendente: novos.length > 0,
        novos_movimentos:     novos.length ? novos : null,
      }).eq('id', p.id);

      atualizados++;
    } catch (_) {}
  }

  atualizarBarraSync('ok', new Date());
  await carregarProcessos();
  if (atualizados > 0) showToast(`${atualizados} processo(s) com nova movimentação!`);
  else if (!silencioso) showToast('Nenhuma novidade nos processos.');
}

function atualizarBarraSync(estado, data) {
  const el = document.getElementById('sync-status-bar');
  if (!el) return;
  const fmt = d => d ? d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '';
  if (estado === 'sincronizando') {
    el.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Sincronizando com CNJ DataJud...`;
    el.style.color = 'var(--amber)';
  } else {
    el.innerHTML = `<i class="ti ti-cloud-check"></i> Sincronizado com CNJ DataJud${data ? ' · ' + fmt(data) : ''}`;
    el.style.color = 'var(--green)';
  }
}

function iniciarSyncAutomatico() {
  if (_syncTimer) clearInterval(_syncTimer);
  _syncTimer = setInterval(() => sincronizarTodos(true), SYNC_INTERVALO_MS);
}

// ── INIT: carrega dados ao abrir dashboard ────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Impede botão voltar de sair do dashboard
  history.pushState(null, '', '/dashboard');
  window.addEventListener('popstate', () => {
    history.pushState(null, '', '/dashboard');
  });

  const aguardar = setInterval(() => {
    if (window._user !== undefined) {
      clearInterval(aguardar);
      if (window._user) {
        carregarProcessos().then(() => {
          iniciarSyncAutomatico();
          sincronizarTodos(true);
        });
        carregarEventosDashboard();
        carregarTarefas();
        carregarDescobertos();
        aplicarAvatarSidebar();
      }
    }
  }, 100);
});

function mostrarErroBusca(msg) {
  const el = document.getElementById('busca-erro');
  el.textContent   = msg;
  el.style.display = 'block';
}

function limparResultadoBusca() {
  document.getElementById('busca-erro').style.display            = 'none';
  document.getElementById('busca-resultados-wrap').style.display = 'none';
  const loteProgress  = document.getElementById('lote-progress');
  const loteResultados = document.getElementById('lote-resultados');
  const loteImportar  = document.getElementById('lote-importar-wrap');
  const loteBar       = document.getElementById('lote-progress-bar');
  if (loteProgress)   loteProgress.style.display   = 'none';
  if (loteResultados) { loteResultados.style.display = 'none'; loteResultados.innerHTML = ''; }
  if (loteImportar)   loteImportar.style.display    = 'none';
  if (loteBar)        loteBar.style.width            = '0%';
  _loteResultados = [];
  window._buscaResultados = [];
}

function formatarNumero(num) {
  if (!num) return '';
  const s = String(num).replace(/\D/g, '');
  if (s.length !== 20) return num;
  return `${s.slice(0,7)}-${s.slice(7,9)}.${s.slice(9,13)}.${s.slice(13,14)}.${s.slice(14,16)}.${s.slice(16)}`;
}

// ── ARQUIVAR / RESTAURAR ──────────────────────────────────────────────────

let _arquivarId   = null;
let _arquivarNome = null;

function pedirArquivar(evt, id, nome) {
  evt.stopPropagation();
  _arquivarId   = id;
  _arquivarNome = nome;
  const el = document.getElementById('arquivar-nome-processo');
  if (el) el.innerHTML = `<i class="ti ti-folder" style="color:var(--gray-400)"></i> <strong>${nome}</strong>`;
  openModal('modal-arquivar');
}

async function confirmarArquivar() {
  if (!_arquivarId) return;
  const btn = document.getElementById('btn-confirmar-arquivar');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Arquivando…'; }

  const { error } = await _supabase
    .from('processos')
    .update({ status: 'Arquivado', notificacao_pendente: false })
    .eq('id', _arquivarId);

  closeModal('modal-arquivar');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-archive"></i> Arquivar mesmo assim'; }

  if (error) { showToast('Erro ao arquivar processo.'); return; }

  showToast(`"${_arquivarNome}" foi arquivado. Acesse Arquivados & Encerrados para restaurar.`);
  _arquivarId = null; _arquivarNome = null;
  carregarProcessos();
}

async function carregarArquivados() {
  const grid  = document.getElementById('lista-arquivados-db');
  const empty = document.getElementById('arquivados-empty');
  if (!grid) return;

  grid.querySelectorAll('.process-card[data-db]').forEach(el => el.remove());

  const { data, error } = await _supabase
    .from('processos')
    .select('*')
    .eq('status', 'Arquivado')
    .order('updated_at', { ascending: false });

  if (error || !data || !data.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const statusCls = s => (s || 'Ativo').toLowerCase().replace(/\s/g, '-');
  const areaMap   = { 'Cível':'civil','Trabalhista':'trabalhista','Criminal':'criminal','Tributário':'tributario','Família':'familia','Previdenciário':'previdenciario' };

  data.forEach(p => {
    const temSync = !!p.datajud_index;

    const card = document.createElement('div');
    card.className = 'process-card';
    card.setAttribute('data-db', p.id);
    card.style.opacity = '0.8';
    card.onclick = () => abrirProcesso(p.id);

    card.innerHTML = `
      <div class="pc-top">
        <span class="pc-num">${p.numero || '—'}</span>
        <div style="display:flex;align-items:center;gap:5px">
          ${temSync ? `<span class="pc-sync-badge"><i class="ti ti-cloud-check"></i> CNJ DataJud</span>` : ''}
          <span class="pc-status" style="background:var(--gray-200);color:var(--gray-600)">Arquivado</span>
        </div>
      </div>
      <div class="pc-title">${p.apelido || p.nome}</div>
      ${p.apelido ? `<div style="font-size:11px;color:var(--gray-400);margin-top:-2px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nome}</div>` : ''}
      <div class="pc-client">
        <i class="ti ti-user" style="font-size:12px"></i>
        ${p.cliente || 'Cliente não informado'}
        ${p.classe ? `<span style="margin-left:6px;color:var(--gray-400)">· ${p.classe}</span>` : ''}
      </div>
      <div class="pc-meta">
        <span class="badge badge-${areaMap[p.area] || 'civil'}">${p.area || 'Cível'}</span>
        <div style="display:flex;gap:4px;margin-left:auto">
          ${temSync ? `
            <button class="btn-atualizar-mini"
              onclick="verificarProcessoAgora(event,'${p.id}','${p.datajud_index}','${p.numero}')">
              <i class="ti ti-refresh"></i> Atualizar
            </button>` : ''}
          <button class="btn-atualizar-mini" style="border-color:var(--green);color:var(--green)"
            onclick="restaurarProcesso(event,'${p.id}','${(p.nome||'').replace(/'/g,'\\x27')}')">
            <i class="ti ti-rotate-clockwise"></i> Restaurar
          </button>
        </div>
      </div>
      <div class="pc-prazo" style="color:var(--gray-400)">
        ${temSync
          ? `<i class="ti ti-pause-circle" style="font-size:13px"></i> Sincronização automática pausada`
          : `<i class="ti ti-pencil" style="font-size:13px"></i> Processo manual · clique para editar`
        }
      </div>`;

    grid.appendChild(card);
  });
}

// ── COLABORADORES ─────────────────────────────────────────────────────────

function _avatarCor(str) {
  const paleta = ['#1a2e6b','#1565c0','#1a7a4a','#9c2b6a','#c0390f','#b07a00','#374151','#0d7377','#7c3aed'];
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = ((h << 5) - h + (str || '').charCodeAt(i)) | 0;
  return paleta[Math.abs(h) % paleta.length];
}

function _avatarIniciais(nome, email) {
  if (nome) {
    const p = nome.trim().split(/\s+/).filter(Boolean);
    if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
    if (p.length === 1 && p[0].length >= 2) return p[0].slice(0, 2).toUpperCase();
    if (p.length === 1) return p[0][0].toUpperCase();
  }
  if (email) {
    const pref = email.split('@')[0];
    return pref.length >= 2 ? pref.slice(0, 2).toUpperCase() : pref[0].toUpperCase();
  }
  return '??';
}

function _membroCardHTML(iniciais, cor, nomeDisplay, emailDisplay, cargoLabel, escopoLabel, dataLabel, btnRemover) {
  return `
  <div style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--gray-100)">
    <div style="width:40px;height:40px;border-radius:50%;background:${cor};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0;letter-spacing:.5px;user-select:none">
      ${iniciais}
    </div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:1px">
        <div style="font-size:14px;font-weight:600;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${nomeDisplay}</div>
        <span style="font-size:11px;background:var(--gray-100);color:var(--gray-500);padding:1px 7px;border-radius:10px;white-space:nowrap">${cargoLabel}</span>
      </div>
      ${emailDisplay ? `<div style="font-size:12px;color:var(--gray-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${emailDisplay}</div>` : ''}
      <div style="font-size:11px;color:var(--gray-300);margin-top:1px">${escopoLabel}${dataLabel ? ' · ' + dataLabel : ''}</div>
    </div>
    ${btnRemover}
  </div>`;
}

async function carregarColaboradores() {
  const lista    = document.getElementById('colab-lista');
  const convites = document.getElementById('colab-convites');
  const cardConv = document.getElementById('card-convites-pendentes');
  const btnConv  = document.getElementById('btn-convidar-colab');
  const aviso    = document.getElementById('colab-aviso-readonly');

  // Colaboradores não gerenciam a equipe
  if (window._isColaborador) {
    if (btnConv) btnConv.style.display = 'none';
    if (aviso)  { aviso.style.display = 'flex'; }
  }

  // Carrega membros ativos do escritório
  const { data: membros, error } = await _supabase
    .from('colaboradores')
    .select('*')
    .eq('escritorio_id', window._escritorioId)
    .eq('status', 'ativo')
    .order('created_at', { ascending: true });

  if (!lista) return;

  const cnt = document.getElementById('colab-count');
  const total = membros?.length || 0;
  if (cnt) cnt.textContent = `(${total}/3)`;

  // Card do titular (sempre no topo)
  let titularHTML = '';
  if (!window._isColaborador) {
    const meta   = window._user?.user_metadata || {};
    const nomeT  = meta.full_name || meta.nome || window._user?.email?.split('@')[0] || 'Titular';
    const emailT = window._user?.email || '';
    const corT   = meta.avatar_color || '#1a2e6b';
    const iniT   = _avatarIniciais(nomeT, emailT);
    titularHTML  = _membroCardHTML(iniT, corT, nomeT, emailT, 'Titular', 'Escritório completo', '', '');
  }

  if (!membros || !membros.length) {
    lista.innerHTML = titularHTML + `<div style="padding:20px 20px 24px;text-align:center;color:var(--gray-400);font-size:13px">
      Nenhum colaborador ainda. Gere um link de convite para adicionar alguém.
    </div>`;
  } else {
    const membrosHTML = membros.map(m => {
      const proc = m.processo_id
        ? (window._processosDB || []).find(p => p.id === m.processo_id)
        : null;
      const escopoLabel = proc
        ? `Processo: ${(proc.apelido || proc.nome || proc.numero || '').slice(0, 38)}`
        : 'Escritório completo';
      const dataLabel = m.created_at ? `Desde ${new Date(m.created_at).toLocaleDateString('pt-BR')}` : '';
      const nomeM  = m.nome  || m.email?.split('@')[0] || m.cargo || 'Colaborador';
      const emailM = m.email || '';
      const iniM   = _avatarIniciais(nomeM, emailM);
      const corM   = _avatarCor(nomeM || emailM || m.id);
      const btnR   = !window._isColaborador
        ? `<button onclick="removerColaborador('${m.id}')" title="Remover colaborador"
            style="background:none;border:none;cursor:pointer;color:var(--gray-300);padding:6px;border-radius:6px;font-size:17px;transition:color .15s;flex-shrink:0"
            onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--gray-300)'">
            <i class="ti ti-user-minus"></i>
          </button>`
        : '';
      return _membroCardHTML(iniM, corM, nomeM, emailM, m.cargo || 'Colaborador', escopoLabel, dataLabel, btnR);
    }).join('');
    lista.innerHTML = titularHTML + membrosHTML;
  }

  // Convites pendentes (só para titular)
  if (window._isColaborador) return;

  const { data: pendentes } = await _supabase
    .from('convites')
    .select('id, email, cargo, expires_at')
    .eq('escritorio_id', window._escritorioId)
    .eq('status', 'pendente')
    .order('created_at', { ascending: false });

  if (pendentes?.length) {
    if (cardConv) cardConv.style.display = 'block';
    convites.innerHTML = pendentes.map(c => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--gray-100)">
        <i class="ti ti-mail" style="color:var(--gold);font-size:20px;flex-shrink:0"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--gray-900)">${c.email}</div>
          <div style="font-size:12px;color:var(--gray-400)">${c.cargo || ''} · Expira em ${new Date(c.expires_at).toLocaleDateString('pt-BR')}</div>
        </div>
        <button onclick="cancelarConvite('${c.id}')" title="Cancelar convite"
          style="background:none;border:none;cursor:pointer;color:var(--gray-400);padding:4px;font-size:16px"
          onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--gray-400)'">
          <i class="ti ti-x"></i>
        </button>
      </div>`).join('');
  }
}

function abrirModalConvite(processoId) {
  if (window._isColaborador) return;
  document.getElementById('conv-link-wrap').style.display    = 'none';
  document.getElementById('conv-erro').style.display         = 'none';
  document.getElementById('conv-email').value                = '';
  document.getElementById('conv-cargo').value                = 'Advogado Associado';
  document.getElementById('conv-nivel').value                = 'total';
  document.getElementById('conv-escopo').value               = processoId ? 'processo' : 'escritorio';
  document.getElementById('conv-processo-wrap').style.display = processoId ? 'block' : 'none';

  // Preenche select de processos
  const sel = document.getElementById('conv-processo');
  sel.innerHTML = '<option value="">Selecione o processo...</option>';
  (window._processosDB || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value       = p.id;
    opt.textContent = (p.apelido || p.nome || p.numero || '').slice(0, 60);
    if (p.id === processoId) opt.selected = true;
    sel.appendChild(opt);
  });

  const btn = document.getElementById('btn-gerar-convite');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Gerar link'; }
  openModal('modal-convidar-colab');
}

function toggleConvProcesso() {
  const escopo = document.getElementById('conv-escopo').value;
  document.getElementById('conv-processo-wrap').style.display = escopo === 'processo' ? 'block' : 'none';
}

async function gerarConvite() {
  const email      = document.getElementById('conv-email').value.trim();
  const cargo      = document.getElementById('conv-cargo').value.trim() || 'Advogado Associado';
  const nivel      = document.getElementById('conv-nivel').value;
  const escopo     = document.getElementById('conv-escopo')?.value || 'escritorio';
  const processoId = escopo === 'processo' ? (document.getElementById('conv-processo')?.value || null) : null;
  const erroEl     = document.getElementById('conv-erro');
  const btn        = document.getElementById('btn-gerar-convite');

  erroEl.style.display = 'none';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    erroEl.textContent = 'Digite um e-mail válido.';
    erroEl.style.display = 'block';
    return;
  }
  if (escopo === 'processo' && !processoId) {
    erroEl.textContent = 'Selecione um processo.';
    erroEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.innerHTML   = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Gerando...';

  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { showToast('Sessão expirada.'); return; }

  try {
    const res  = await fetch('/api/colaboradores?acao=convidar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body:    JSON.stringify({ email, cargo, nivel_acesso: nivel, processo_id: processoId }),
    });
    const data = await res.json();
    if (!res.ok) {
      erroEl.textContent   = data.erro || 'Erro ao gerar convite.';
      erroEl.style.display = 'block';
      btn.disabled    = false;
      btn.innerHTML   = '<i class="ti ti-send"></i> Gerar link';
      return;
    }
    document.getElementById('conv-link-input').value = data.link;
    document.getElementById('conv-link-wrap').style.display = 'block';
    btn.innerHTML = '<i class="ti ti-check"></i> Link gerado!';
  } catch {
    erroEl.textContent   = 'Falha na conexão. Tente novamente.';
    erroEl.style.display = 'block';
    btn.disabled    = false;
    btn.innerHTML   = '<i class="ti ti-send"></i> Gerar link';
  }
}

function copiarLinkConvite() {
  const input = document.getElementById('conv-link-input');
  if (!input?.value) return;
  navigator.clipboard.writeText(input.value).then(() => showToast('Link copiado!'));
}

async function removerColaborador(id) {
  if (!await _confirmar('O colaborador perderá o acesso ao escritório imediatamente.', 'Remover colaborador?', { textoOk: 'Remover', perigo: true, icone: '👤' })) return;
  const { error } = await _supabase
    .from('colaboradores')
    .update({ status: 'removido' })
    .eq('id', id)
    .eq('escritorio_id', window._escritorioId);
  if (error) { showToast('Erro ao remover colaborador.'); return; }
  showToast('Colaborador removido.');
  carregarColaboradores();
}

async function cancelarConvite(id) {
  if (!await _confirmar('O link de convite ficará inativo e o destinatário não conseguirá mais aceitar.', 'Cancelar convite?', { textoOk: 'Cancelar convite', perigo: true, icone: '✉️' })) return;
  const { error } = await _supabase
    .from('convites')
    .update({ status: 'expirado' })
    .eq('id', id)
    .eq('escritorio_id', window._escritorioId);
  if (error) { showToast('Erro ao cancelar convite.'); return; }
  showToast('Convite cancelado.');
  carregarColaboradores();
}

// ── PARCEIROS & COMPARTILHAMENTO ──────────────────────────────────────────

let _shareProcessoId   = null;  // id do processo que está sendo compartilhado
let _shareUsuarioFound = null;  // usuário encontrado pelo e-mail

async function carregarParceiros() {
  const uid = window._user?.id;
  if (!uid) return;

  const [sharedWithMeRes, mySharesRes, pendentesRes, myPendentesRes] = await Promise.all([
    _supabase.from('processo_compartilhamentos')
      .select('id,processo_id,owner_nome,nivel_acesso,created_at')
      .eq('shared_with_id', uid).eq('status', 'aceito').order('created_at', { ascending: false }),
    _supabase.from('processo_compartilhamentos')
      .select('id,processo_id,shared_with_nome,shared_with_email,nivel_acesso,created_at')
      .eq('owner_id', uid).eq('status', 'aceito').order('created_at', { ascending: false }),
    _supabase.rpc('buscar_convites_pendentes'),
    _supabase.from('processo_compartilhamentos')
      .select('id,processo_id,shared_with_nome,shared_with_email,nivel_acesso,created_at')
      .eq('owner_id', uid).eq('status', 'pendente').order('created_at', { ascending: false }),
  ]);

  // Pendentes recebidos — usa RPC para ter nome/número do processo
  const pendentes = pendentesRes.data || [];
  const cardPend  = document.getElementById('card-shares-pendentes');
  const listaPend = document.getElementById('lista-shares-pendentes');
  const badgePend = document.getElementById('badge-shares-pendentes');

  if (cardPend) cardPend.style.display = pendentes.length ? 'block' : 'none';
  if (badgePend) badgePend.textContent = pendentes.length;

  const fmtDia = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' }) : '';

  if (listaPend) {
    listaPend.innerHTML = pendentes.length ? pendentes.map(s => {
      const iniciais = (s.owner_nome || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `
        <div style="padding:16px 20px;border-bottom:1px solid var(--gray-100);display:flex;gap:14px;align-items:flex-start">
          <div class="pc-avatar-dot nivel-${s.nivel_acesso}" style="width:40px;height:40px;font-size:14px;flex-shrink:0;margin-top:2px">${iniciais}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:var(--gray-800);margin-bottom:2px">${_esc(s.processo_nome)}</div>
            ${s.processo_numero ? `<div style="font-size:11px;color:var(--gray-400);margin-bottom:6px;font-family:monospace">${_esc(s.processo_numero)}</div>` : ''}
            <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--gray-500);margin-bottom:8px">
              ${s.cliente_nome ? `<span><i class="ti ti-user" style="font-size:11px"></i> ${_esc(s.cliente_nome)}</span>` : ''}
              <span><i class="ti ti-send" style="font-size:11px"></i> ${_esc(s.owner_nome)}</span>
              <span><i class="ti ti-calendar" style="font-size:11px"></i> ${fmtDia(s.created_at)}</span>
              <span class="share-nivel-badge ${s.nivel_acesso}">${_nivelLabel(s.nivel_acesso)}</span>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn-secondary" style="font-size:12px;padding:5px 14px;color:var(--red);border-color:var(--red)" onclick="recusarCompartilhamento('${s.id}')">Recusar</button>
              <button class="btn-primary" style="font-size:12px;padding:5px 14px" onclick="aceitarCompartilhamento('${s.id}')">Aceitar convite</button>
            </div>
          </div>
        </div>`;
    }).join('') : '';
  }

  // Compartilhados comigo (aceitos)
  const comigo     = sharedWithMeRes.data || [];
  const listaComigo = document.getElementById('lista-shares-comigo');
  if (listaComigo) {
    listaComigo.innerHTML = comigo.length ? comigo.map(s => {
      const proc = (window._processosDB || []).find(p => p.id === s.processo_id);
      const nomeProcesso = proc ? (proc.apelido || proc.nome) : `Processo ${s.processo_id.slice(0, 8)}…`;
      return `
        <div class="share-item">
          <div class="pc-avatar-dot nivel-${s.nivel_acesso}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">
            ${s.owner_nome.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
          </div>
          <div class="share-item-info">
            <div class="share-item-titulo" style="cursor:pointer" onclick="abrirProcesso('${s.processo_id}')">${_esc(nomeProcesso)}</div>
            <div class="share-item-meta">Compartilhado por <b>${_esc(s.owner_nome)}</b> · <span class="share-nivel-badge ${s.nivel_acesso}">${_nivelLabel(s.nivel_acesso)}</span></div>
          </div>
          <button class="btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--red);border-color:var(--red)" onclick="sairCompartilhamento('${s.id}')">Sair</button>
        </div>`;
    }).join('') : '<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px">Nenhum processo compartilhado com você ainda.</div>';
  }

  // Processos que compartilhei (aceitos + pendentes enviados)
  const meus         = mySharesRes.data    || [];
  const meusPend     = myPendentesRes.data || [];
  const listaMeus    = document.getElementById('lista-shares-meus');
  if (listaMeus) {
    const totalMeus = meus.length + meusPend.length;
    if (!totalMeus) {
      listaMeus.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px">Você ainda não compartilhou nenhum processo.</div>';
    } else {
      const renderItem = (s, pendente) => {
        const proc        = (window._processosDB || []).find(p => p.id === s.processo_id);
        const nomeProcesso = proc ? (proc.apelido || proc.nome) : `Processo ${s.processo_id.slice(0, 8)}…`;
        const iniciais    = s.shared_with_nome.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        const clickProc   = proc ? `style="cursor:pointer;color:var(--navy)" onclick="showPage('processos');abrirProcesso('${proc.id}')"` : '';
        return `
          <div class="share-item" style="${pendente ? 'opacity:.75' : ''}">
            <div class="pc-avatar-dot nivel-${s.nivel_acesso}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${iniciais}</div>
            <div class="share-item-info">
              <div class="share-item-titulo" ${clickProc}>${_esc(nomeProcesso)}</div>
              <div class="share-item-meta">
                <b>${_esc(s.shared_with_nome)}</b> · ${_esc(s.shared_with_email)} ·
                ${pendente
                  ? '<span style="color:#d97706;font-weight:600">Aguardando aceitação</span>'
                  : `<span class="share-nivel-badge ${s.nivel_acesso}">${_nivelLabel(s.nivel_acesso)}</span>`}
              </div>
            </div>
            ${pendente ? '' : `
            <select class="form-input" style="width:auto;font-size:12px;padding:5px 8px" onchange="alterarNivelShare('${s.id}',this.value)">
              <option value="leitura"    ${s.nivel_acesso==='leitura'    ?'selected':''}>Leitura</option>
              <option value="comentario" ${s.nivel_acesso==='comentario' ?'selected':''}>Comentários</option>
              <option value="total"      ${s.nivel_acesso==='total'      ?'selected':''}>Total</option>
            </select>`}
            <button class="btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--red);border-color:var(--red)" onclick="revogarCompartilhamento('${s.id}')">
              ${pendente ? 'Cancelar' : 'Revogar'}
            </button>
          </div>`;
      };
      listaMeus.innerHTML =
        meusPend.map(s => renderItem(s, true)).join('') +
        meus.map(s => renderItem(s, false)).join('');
    }
  }
}

// ── Responsáveis no detalhe do processo ──

async function _renderizarResponsaveis(processoId) {
  const lista = document.getElementById('responsaveis-lista');
  if (!lista || !processoId) return;

  const { data } = await _supabase
    .from('processo_compartilhamentos')
    .select('id,shared_with_nome,shared_with_email,nivel_acesso,status,owner_id,created_at,updated_at')
    .eq('processo_id', processoId)
    .order('created_at', { ascending: true });

  const shares = data || [];
  if (!shares.length) {
    lista.innerHTML = `<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:12px">Nenhum parceiro vinculado.</div>`;
    return;
  }

  const fmtData = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }) : '';

  lista.innerHTML = shares.map(s => {
    const iniciais = (s.shared_with_nome || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const isOwner  = s.owner_id === window._user?.id;
    const ativo    = s.status === 'aceito';
    const labels   = { pendente: 'Aguardando aceite', aceito: _nivelLabel(s.nivel_acesso), recusado: 'Recusou o convite', saiu: `Saiu em ${fmtData(s.updated_at)}` };
    const labelColor = { pendente: '#d97706', aceito: 'var(--gray-400)', recusado: 'var(--red)', saiu: 'var(--gray-400)' };
    const opacity    = !ativo ? 'opacity:.55;' : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 16px;${opacity}">
        <div class="pc-avatar-dot nivel-${ativo ? s.nivel_acesso : 'inativo'}" style="width:30px;height:30px;font-size:11px;flex-shrink:0">${iniciais}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(s.shared_with_nome)}</div>
          <div style="font-size:11px;color:${labelColor[s.status]}">${labels[s.status] || s.status}</div>
        </div>
        ${isOwner && ativo ? `<button onclick="revogarCompartilhamento('${s.id}')" title="Revogar acesso"
          style="background:none;border:none;color:var(--gray-300);cursor:pointer;padding:4px;line-height:1;font-size:14px">
          <i class="ti ti-x"></i></button>` : ''}
        ${isOwner && s.status === 'saiu' ? `<button onclick="convidarNovamente('${s.id}')" title="Re-convidar"
          style="background:none;border:none;color:var(--navy);cursor:pointer;padding:4px;line-height:1;font-size:12px">
          <i class="ti ti-refresh"></i></button>` : ''}
      </div>`;
  }).join('');
}

function abrirModalCompartilharDetalhe() {
  if (!_processoAtual) return;
  abrirModalCompartilhar({ stopPropagation: () => {} }, _processoAtual.id);
}

// ── Modal de compartilhar processo ──

function _resetModalShare() {
  const emailEl = document.getElementById('share-email');
  const erro    = document.getElementById('share-erro');
  if (emailEl) emailEl.value        = '';
  if (erro)    erro.style.display   = 'none';
}

function abrirModalCompartilhar(event, processoId) {
  event.stopPropagation();
  _shareProcessoId = processoId;
  _resetModalShare();

  const proc       = (window._processosDB || []).find(p => p.id === processoId);
  const nome       = proc ? (proc.apelido || proc.nome) : '';
  const info       = document.getElementById('share-processo-info');
  const selectWrap = document.getElementById('share-processo-select-wrap');
  if (info)        { info.style.display = 'block'; info.innerHTML = `<i class="ti ti-briefcase" style="margin-right:6px;color:var(--navy)"></i><b>${_esc(nome)}</b>`; }
  if (selectWrap)  selectWrap.style.display = 'none';

  openModal('modal-compartilhar');
  setTimeout(() => document.getElementById('share-email')?.focus(), 150);
}

function abrirModalCompartilharSemProcesso() {
  _shareProcessoId = null;
  _resetModalShare();

  const info       = document.getElementById('share-processo-info');
  const selectWrap = document.getElementById('share-processo-select-wrap');
  const sel        = document.getElementById('share-processo-select');
  if (info)       info.style.display       = 'none';
  if (selectWrap) selectWrap.style.display = 'block';
  if (sel) {
    const lista = (window._processosDB || []).filter(p => !p.arquivado)
      .sort((a, b) => (a.apelido || a.nome).localeCompare(b.apelido || b.nome));
    sel.innerHTML = '<option value="">— Selecione um processo —</option>' +
      lista.map(p => `<option value="${p.id}">${_esc(p.apelido || p.nome)}</option>`).join('');
    sel.onchange = () => { _shareProcessoId = sel.value || null; };
  }

  openModal('modal-compartilhar');
  setTimeout(() => document.getElementById('share-email')?.focus(), 150);
}

async function convidarParceiro() {
  if (!_shareProcessoId) {
    _shareProcessoId = document.getElementById('share-processo-select')?.value || null;
  }
  const email = document.getElementById('share-email')?.value.trim();
  const erro  = document.getElementById('share-erro');
  const btn   = document.getElementById('btn-confirmar-share');

  if (erro) { erro.style.display = 'none'; erro.textContent = ''; }

  if (!_shareProcessoId) {
    if (erro) { erro.textContent = 'Selecione um processo.'; erro.style.display = 'block'; }
    return;
  }
  if (!email || !email.includes('@')) {
    if (erro) { erro.textContent = 'Digite um e-mail válido.'; erro.style.display = 'block'; }
    return;
  }

  if (btn) btn.disabled = true;

  const { data: usuario, error: rpcError } = await _supabase.rpc('buscar_usuario_por_email', { email_input: email });

  if (btn) btn.disabled = false;

  if (rpcError) {
    if (erro) { erro.textContent = 'Erro: ' + rpcError.message; erro.style.display = 'block'; }
    return;
  }
  if (!usuario) {
    if (erro) { erro.textContent = 'Nenhum advogado com este e-mail encontrado. Peça para criar conta no Meu Processo.'; erro.style.display = 'block'; }
    return;
  }

  const nivel   = document.getElementById('share-nivel')?.value || 'leitura';
  const ownNome = window._user?.user_metadata?.nome || window._user?.email || 'Advogado';

  const { error } = await _supabase.from('processo_compartilhamentos').upsert({
    processo_id:       _shareProcessoId,
    owner_id:          window._user.id,
    owner_nome:        ownNome,
    shared_with_id:    usuario.id,
    shared_with_email: usuario.email,
    shared_with_nome:  usuario.nome,
    nivel_acesso:      nivel,
    status:            'pendente',
    updated_at:        new Date().toISOString(),
  }, { onConflict: 'processo_id,shared_with_id' });

  if (error) {
    if (erro) { erro.textContent = 'Erro ao convidar: ' + error.message; erro.style.display = 'block'; }
    return;
  }

  closeModal('modal-compartilhar');
  showToast(`Convite enviado para ${usuario.nome}!`, 'success');
  _shareProcessoId = null;
  carregarProcessos();
  carregarParceiros();
  if (_processoAtual) _renderizarResponsaveis(_processoAtual.id);
}

async function aceitarCompartilhamento(shareId) {
  const { error } = await _supabase
    .from('processo_compartilhamentos')
    .update({ status: 'aceito' })
    .eq('id', shareId);
  if (error) { showToast('Erro ao aceitar compartilhamento.'); return; }
  showToast('Compartilhamento aceito!');
  carregarProcessos();
  carregarParceiros();
}

async function recusarCompartilhamento(shareId) {
  if (!await _confirmar('Você não terá acesso a este processo.', 'Recusar convite?', { textoOk: 'Recusar', perigo: true, icone: '🚫' })) return;
  const { error } = await _supabase
    .from('processo_compartilhamentos')
    .update({ status: 'recusado' })
    .eq('id', shareId);
  if (error) { showToast('Erro ao recusar.'); return; }
  showToast('Compartilhamento recusado.');
  carregarProcessos();
  carregarParceiros();
}

async function sairCompartilhamento(shareId) {
  if (!await _confirmar('Você perderá o acesso a este processo e seus dados vinculados.', 'Sair do compartilhamento?', { textoOk: 'Sair', perigo: true, icone: '👋' })) return;
  const { error } = await _supabase
    .from('processo_compartilhamentos')
    .update({ status: 'saiu', updated_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) { showToast('Erro ao sair do compartilhamento.'); return; }
  showToast('Você saiu do compartilhamento.');
  carregarProcessos();
  carregarParceiros();
}

async function revogarCompartilhamento(shareId) {
  if (!await _confirmar('O advogado perderá o acesso ao processo imediatamente.', 'Revogar acesso?', { textoOk: 'Revogar', perigo: true, icone: '🔒' })) return;
  const { error } = await _supabase
    .from('processo_compartilhamentos')
    .update({ status: 'saiu', updated_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) { showToast('Erro ao revogar acesso.'); return; }
  showToast('Acesso revogado.');
  carregarProcessos();
  carregarParceiros();
  if (_processoAtual) _renderizarResponsaveis(_processoAtual.id);
}

async function convidarNovamente(shareId) {
  const { error } = await _supabase
    .from('processo_compartilhamentos')
    .update({ status: 'pendente', updated_at: new Date().toISOString() })
    .eq('id', shareId);
  if (error) { showToast('Erro ao re-convidar.'); return; }
  showToast('Convite re-enviado!', 'success');
  if (_processoAtual) _renderizarResponsaveis(_processoAtual.id);
  carregarParceiros();
}

async function alterarNivelShare(shareId, novoNivel) {
  const { error } = await _supabase
    .from('processo_compartilhamentos')
    .update({ nivel_acesso: novoNivel })
    .eq('id', shareId);
  if (error) { showToast('Erro ao alterar nível.'); return; }
  showToast('Nível de acesso atualizado.');
  carregarProcessos();
}

function _nivelLabel(nivel) {
  if (nivel === 'total')      return 'Acesso total';
  if (nivel === 'comentario') return 'Comentários';
  return 'Leitura';
}

// ── CONFIGURAÇÕES / PERFIL ────────────────────────────────────────────────

const AVATAR_CORES = ['#1a2e6b','#1565c0','#1a7a4a','#9c2b6a','#c0390f','#b07a00','#374151'];
let _avatarCorAtual = '#1a2e6b';

function aplicarAvatarSidebar() {
  const avatar = document.getElementById('sidebar-user-avatar');
  if (!avatar || !window._user) return;
  const meta    = window._user.user_metadata || {};
  const nome    = meta.full_name || meta.nome || window._user.email?.split('@')[0] || '';
  const fotoUrl = meta.avatar_url;

  // Atualiza nome no sidebar sempre
  const nameEl = document.getElementById('sidebar-user-name');
  if (nameEl) nameEl.textContent = nome || window._user.email || '';

  if (fotoUrl) {
    avatar.innerHTML        = `<img src="${fotoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    avatar.style.background = 'transparent';
    avatar.style.overflow   = 'hidden';
  } else {
    avatar.innerHTML = '';
    const cor      = meta.avatar_color || '#1a2e6b';
    const iniciais = nome.trim().split(' ').filter(Boolean).slice(0,2).map(p => p[0].toUpperCase()).join('')
                     || (window._user.email || '?')[0].toUpperCase();
    avatar.textContent      = iniciais;
    avatar.style.background = cor;
    avatar.style.overflow   = '';
  }
}

function carregarConfiguracoes() {
  const meta  = window._user?.user_metadata || {};
  const nome  = meta.full_name || meta.nome || '';
  const email = window._user?.email || '';
  const cor   = meta.avatar_color || '#1a2e6b';

  _avatarCorAtual = cor;

  const nomeEl  = document.getElementById('config-nome');
  const emailEl = document.getElementById('config-email');
  if (nomeEl)  nomeEl.value  = nome;
  if (emailEl) emailEl.value = email;

  atualizarAvatarPreview(nome, cor);

  const escEl = document.getElementById('config-escritorio');
  const oabEl = document.getElementById('config-oab');
  const telEl = document.getElementById('config-telefone');
  if (escEl) escEl.value = meta.escritorio || '';
  if (oabEl) oabEl.value = meta.oab        || '';
  if (telEl) telEl.value = meta.telefone   || '';

  // Mostra alerta se OAB não preenchida
  const alertaOAB = document.getElementById('config-oab-alerta');
  if (alertaOAB) alertaOAB.style.display = meta.oab ? 'none' : 'flex';

  // Esconde alerta ao preencher OAB
  if (oabEl) oabEl.addEventListener('input', function () {
    if (alertaOAB) alertaOAB.style.display = this.value.trim() ? 'none' : 'flex';
  }, { once: false });

  const picker = document.getElementById('config-color-picker');
  if (picker) {
    picker.innerHTML = AVATAR_CORES.map(c => `
      <div onclick="selecionarCorAvatar('${c}')" data-cor="${c}" style="
        width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;
        border:3px solid ${c === cor ? '#fff' : 'transparent'};
        box-shadow:${c === cor ? '0 0 0 2px ' + c : 'none'};
        transition:all .15s;flex-shrink:0"></div>`
    ).join('');
  }

  atualizarFotoLabel();

  const s1 = document.getElementById('config-senha-nova');
  const s2 = document.getElementById('config-senha-confirma');
  const se = document.getElementById('config-senha-erro');
  if (s1) s1.value = '';
  if (s2) s2.value = '';
  if (se) se.style.display = 'none';
}

function selecionarCorAvatar(cor) {
  _avatarCorAtual = cor;
  document.querySelectorAll('#config-color-picker [data-cor]').forEach(el => {
    const c = el.dataset.cor;
    el.style.border     = `3px solid ${c === cor ? '#fff' : 'transparent'}`;
    el.style.boxShadow  = c === cor ? `0 0 0 2px ${c}` : 'none';
  });
  const nome = document.getElementById('config-nome')?.value || '';
  atualizarAvatarPreview(nome, cor);
}

function atualizarAvatarPreview(nome, cor) {
  const el = document.getElementById('config-avatar');
  if (!el) return;
  const fotoUrl = window._user?.user_metadata?.avatar_url;
  if (fotoUrl) {
    el.innerHTML        = `<img src="${fotoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    el.style.background = 'transparent';
  } else {
    el.innerHTML = '';
    const iniciais = nome.trim().split(' ').filter(Boolean).slice(0,2).map(p => p[0].toUpperCase()).join('')
                     || (window._user?.email || '?')[0].toUpperCase();
    el.textContent      = iniciais;
    el.style.background = cor;
  }
}

async function uploadFotoPerfil(input) {
  const file = input.files?.[0];
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    showToast('Foto muito grande. Máximo 3 MB.');
    input.value = '';
    return;
  }

  showToast('Enviando foto...');

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { showToast('Sessão expirada. Faça login novamente.'); return; }

  const ext = file.name.split('.').pop().toLowerCase() || 'jpg';

  const res = await fetch('/api/upload-avatar', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ base64, contentType: file.type, ext }),
  });

  const data = await res.json();
  input.value = '';

  if (!res.ok) { showToast('Erro: ' + (data.erro || 'falha no upload')); return; }

  const { error: metaErr } = await _supabase.auth.updateUser({ data: { avatar_url: data.url } });
  if (metaErr) { showToast('Erro ao salvar foto: ' + metaErr.message); return; }

  if (window._user) {
    window._user.user_metadata = { ...window._user.user_metadata, avatar_url: data.url };
  }

  atualizarAvatarPreview(document.getElementById('config-nome')?.value || '', _avatarCorAtual);
  aplicarAvatarSidebar();
  atualizarFotoLabel();
  showToast('Foto atualizada!');
}

async function removerFotoPerfil() {
  const { error } = await _supabase.auth.updateUser({ data: { avatar_url: null } });
  if (error) { showToast('Erro ao remover foto.'); return; }
  if (window._user) {
    window._user.user_metadata = { ...window._user.user_metadata, avatar_url: null };
  }
  atualizarAvatarPreview(document.getElementById('config-nome')?.value || '', _avatarCorAtual);
  aplicarAvatarSidebar();
  atualizarFotoLabel();
  showToast('Foto removida.');
}

function atualizarFotoLabel() {
  const label = document.getElementById('config-foto-label');
  if (!label) return;
  const temFoto = !!window._user?.user_metadata?.avatar_url;
  label.innerHTML = temFoto
    ? `<span style="font-size:12px;color:var(--gray-400)">
         <span onclick="document.getElementById('config-foto-input').click()" style="color:var(--navy);font-weight:600;cursor:pointer">Trocar foto</span>
         &nbsp;·&nbsp;
         <span onclick="removerFotoPerfil()" style="color:var(--red);cursor:pointer">Remover</span>
       </span>`
    : `<span style="font-size:12px;color:var(--gray-400)">Clique na foto para enviar · JPG, PNG até 3 MB</span>`;
}

async function salvarPerfil() {
  const nome = document.getElementById('config-nome')?.value.trim() || '';
  if (!nome) { showToast('Preencha o nome.'); return; }

  const { error } = await _supabase.auth.updateUser({
    data: { full_name: nome, nome, avatar_color: _avatarCorAtual }
  });

  if (error) { showToast('Erro ao salvar: ' + error.message); return; }

  if (window._user) {
    window._user.user_metadata = {
      ...window._user.user_metadata,
      full_name: nome, nome, avatar_color: _avatarCorAtual
    };
  }

  const nameEl = document.getElementById('sidebar-user-name');
  if (nameEl) nameEl.textContent = nome;

  aplicarAvatarSidebar();

  const hora = new Date().getHours();
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const greet = document.getElementById('dash-greeting');
  if (greet) greet.textContent = `${saud}, ${nome}!`;

  showToast('Perfil salvo com sucesso!');
}

async function salvarEscritorio() {
  const escritorio = document.getElementById('config-escritorio')?.value.trim() || '';
  const oab        = document.getElementById('config-oab')?.value.trim()        || '';
  const telefone   = document.getElementById('config-telefone')?.value.trim()   || '';

  const { error } = await _supabase.auth.updateUser({
    data: { escritorio, oab, telefone }
  });

  if (error) { showToast('Erro ao salvar: ' + error.message); return; }

  if (window._user) {
    window._user.user_metadata = {
      ...window._user.user_metadata,
      escritorio, oab, telefone
    };
  }

  showToast('Dados do escritório salvos!');
}

async function alterarSenha() {
  const nova     = document.getElementById('config-senha-nova')?.value    || '';
  const confirma = document.getElementById('config-senha-confirma')?.value || '';
  const erroEl   = document.getElementById('config-senha-erro');

  erroEl.style.display = 'none';

  if (nova.length < 6) {
    erroEl.textContent   = 'A senha deve ter pelo menos 6 caracteres.';
    erroEl.style.display = 'block';
    return;
  }
  if (nova !== confirma) {
    erroEl.textContent   = 'As senhas não conferem.';
    erroEl.style.display = 'block';
    return;
  }

  const { error } = await _supabase.auth.updateUser({ password: nova });

  if (error) {
    erroEl.textContent   = 'Erro: ' + error.message;
    erroEl.style.display = 'block';
    return;
  }

  document.getElementById('config-senha-nova').value     = '';
  document.getElementById('config-senha-confirma').value = '';
  showToast('Senha alterada com sucesso!');
}

async function restaurarProcesso(evt, id, nome) {
  evt.stopPropagation();
  const { error } = await _supabase
    .from('processos')
    .update({ status: 'Ativo' })
    .eq('id', id);

  if (error) { showToast('Erro ao restaurar processo.'); return; }
  showToast(`"${nome}" restaurado! Disponível novamente em Meus Processos.`);
  carregarArquivados();
  carregarProcessos();
}

// ── CALENDÁRIO: EVENTOS DO BANCO ──────────────────────────────────────────

async function carregarEventosDashboard() {
  if (!window._user) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const em90 = new Date(); em90.setDate(em90.getDate() + 90);
  const { data } = await _supabase
    .from('eventos')
    .select('*')
    .gte('data', hoje)
    .lte('data', em90.toISOString().slice(0, 10))
    .order('data', { ascending: true });
  if (data) _eventosDB = data;
  atualizarPrazosDash();
  buildMiniCal();
  atualizarBell();

  const em7 = new Date(); em7.setDate(em7.getDate() + 7);
  const proximos = data?.filter(e => new Date(e.data + 'T12:00:00') <= em7) || [];
  const badgeEv = document.getElementById('badge-eventos');
  if (badgeEv) {
    badgeEv.textContent   = proximos.length;
    badgeEv.style.display = proximos.length ? 'inline-flex' : 'none';
  }
}

async function carregarEventos() {
  if (!window._user) return;

  // Renderiza imediatamente com o cache (calendário aparece sem delay)
  buildFullCal();
  buildMiniCal();

  const agora  = new Date();
  const inicio = new Date(fullCalDate.getFullYear(), fullCalDate.getMonth(), 1).toISOString().slice(0, 10);
  const fim    = new Date(fullCalDate.getFullYear(), fullCalDate.getMonth() + 1, 0).toISOString().slice(0, 10);

  const { data, error } = await _supabase
    .from('eventos')
    .select('*')
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: true });

  if (!error && data) {
    _eventosDB = data;
  }

  buildFullCal();
  buildMiniCal();

  // Badge: eventos nos próximos 7 dias
  const em7 = new Date(agora); em7.setDate(em7.getDate() + 7);
  const proximos = (_eventosDB).filter(e => {
    const d = new Date(e.data + 'T12:00:00');
    return d >= agora && d <= em7;
  });
  const badgeEv = document.getElementById('badge-eventos');
  if (badgeEv) {
    badgeEv.textContent   = proximos.length;
    badgeEv.style.display = proximos.length ? 'inline-flex' : 'none';
  }

  // Atualiza prazos no dashboard
  atualizarPrazosDash();
}

function renderizarEsteMes() {
  const input = document.getElementById('cal-search-input');
  if (input) input.value = '';
  filtrarCalendario('');
}

async function excluirEvento(id) {
  if (!await _confirmar('O evento será removido do calendário permanentemente.', 'Excluir evento?', { textoOk: 'Excluir', perigo: true, icone: '📅' })) return;
  const { error } = await _supabase.from('eventos').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir evento.'); return; }
  showToast('Evento excluído.');
  carregarEventos();
}

async function salvarEvento() {
  const titulo   = document.getElementById('ev-titulo')?.value.trim()   || '';
  const tipo     = document.getElementById('ev-tipo')?.value            || 'lembrete';
  const data     = document.getElementById('ev-data')?.value            || '';
  const proc     = document.getElementById('ev-processo')?.value        || '';
  const urgencia = document.getElementById('ev-urgencia')?.value        || 'baixa';
  const notif    = parseInt(document.getElementById('ev-notificar')?.value || '1', 10);

  if (!titulo) { showToast('Preencha a descrição do evento.'); return; }
  if (!data)   { showToast('Selecione uma data.'); return; }

  const btn = document.getElementById('btn-salvar-evento');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Salvando...'; }

  try {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) { showToast('Sessão expirada. Recarregue a página.'); return; }

    const res = await fetch('/api/salvar-evento', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        titulo, tipo, data,
        processo_id:     proc || null,
        urgencia,
        notificar_antes: notif,
        escritorio_id:   window._isColaborador ? window._escritorioId : undefined,
      }),
    });

    let json = {};
    try { json = await res.json(); } catch (_) {}
    if (!res.ok) { showToast('Erro: ' + (json.erro || `status ${res.status}`)); return; }

    closeModal('modal-lembrete');
    document.getElementById('ev-titulo').value = '';
    showToast('Prazo registrado! Você receberá um e-mail de confirmação.');
    carregarEventos();
  } catch (err) {
    showToast('Erro: ' + (err?.message || 'falha ao salvar'));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> Salvar Prazo'; }
  }
}

function _proximaDataPeriodicidade(d, periodicidade) {
  const dt = new Date(d + 'T12:00:00');
  switch (periodicidade) {
    case 'semanal':    dt.setDate(dt.getDate() + 7); break;
    case 'quinzenal':  dt.setDate(dt.getDate() + 15); break;
    case 'mensal':     dt.setMonth(dt.getMonth() + 1); break;
    case 'bimestral':  dt.setMonth(dt.getMonth() + 2); break;
    case 'trimestral': dt.setMonth(dt.getMonth() + 3); break;
    case 'anual':      dt.setFullYear(dt.getFullYear() + 1); break;
  }
  return dt.toISOString().slice(0, 10);
}

async function salvarLembreteRecorrente() {
  const titulo        = document.getElementById('evr-titulo')?.value.trim() || '';
  const tipo           = document.getElementById('evr-tipo')?.value          || 'lembrete';
  const dataInicial    = document.getElementById('evr-data')?.value          || '';
  const periodicidade  = document.getElementById('evr-periodicidade')?.value || 'mensal';
  const repeticoes     = parseInt(document.getElementById('evr-repeticoes')?.value || '6', 10);
  const urgencia       = document.getElementById('evr-urgencia')?.value      || 'baixa';
  const notif          = parseInt(document.getElementById('evr-notificar')?.value || '1', 10);

  if (!titulo)     { showToast('Preencha a descrição do lembrete.'); return; }
  if (!dataInicial) { showToast('Selecione a primeira data.'); return; }
  if (!repeticoes || repeticoes < 2) { showToast('Informe ao menos 2 repetições.'); return; }

  const datas = [dataInicial];
  for (let i = 1; i < repeticoes; i++) datas.push(_proximaDataPeriodicidade(datas[i - 1], periodicidade));

  const btn = document.getElementById('btn-salvar-evento-recorrente');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Criando...'; }

  try {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) { showToast('Sessão expirada. Recarregue a página.'); return; }

    const res = await fetch('/api/salvar-evento', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        eventos: datas.map(data => ({
          titulo, tipo, data,
          urgencia,
          notificar_antes: notif,
        })),
        escritorio_id: window._isColaborador ? window._escritorioId : undefined,
      }),
    });

    let json = {};
    try { json = await res.json(); } catch (_) {}
    if (!res.ok) { showToast('Erro: ' + (json.erro || `status ${res.status}`)); return; }

    closeModal('modal-lembrete-recorrente');
    document.getElementById('evr-titulo').value = '';
    showToast(`${datas.length} lembretes criados!`);
    carregarEventos();
    carregarEventosDashboard();
  } catch (err) {
    showToast('Erro: ' + (err?.message || 'falha ao salvar'));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> Criar Recorrência'; }
  }
}

async function carregarPrazosProcesso(processoId) {
  const wrap = document.getElementById('detalhe-prazos-lista');
  if (!wrap) return;

  wrap.innerHTML = `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:12px">
    <i class="ti ti-loader-2" style="animation:spin .8s linear infinite;display:block;margin-bottom:6px"></i>Carregando...
  </div>`;

  const { data, error } = await _supabase
    .from('eventos')
    .select('*')
    .eq('processo_id', processoId)
    .order('data', { ascending: true });

  if (error || !data || !data.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--gray-400)">
      <i class="ti ti-calendar-off" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.3"></i>
      <div style="font-size:12px;opacity:.7">Nenhum prazo vinculado.<br>Use o botão + para adicionar.</div>
    </div>`;
    return;
  }

  const urgCls    = { alta:'urgency-alta', media:'urgency-media', baixa:'urgency-baixa' };
  const tipoLabel = { prazo_processual:'Prazo Processual', audiencia:'Audiência', lembrete:'Lembrete', reuniao:'Reunião' };
  const hoje      = new Date();

  wrap.innerHTML = data.map(e => {
    const dt   = new Date(e.data + 'T12:00:00');
    const dias = Math.ceil((dt - hoje) / 86400000);
    const dia  = dt.toLocaleDateString('pt-BR', { day:'2-digit' });
    const mes  = dt.toLocaleDateString('pt-BR', { month:'short' }).replace('.','');
    const badgeCls = dias < 0 ? 'dias-urgente' : dias <= 3 ? 'dias-urgente' : dias <= 7 ? 'dias-aviso' : 'dias-ok';
    const label    = dias < 0 ? `${Math.abs(dias)}d atrás` : dias === 0 ? 'Hoje' : `${dias}d`;
    return `
      <div class="prazo-item" onclick="irParaCalendarioMes(${dt.getFullYear()},${dt.getMonth()})">
        <div class="prazo-date"><div class="prazo-day">${dia}</div><div class="prazo-month">${mes}</div></div>
        <div class="prazo-urgency ${urgCls[e.urgencia] || 'urgency-baixa'}"></div>
        <div class="prazo-info">
          <div class="prazo-name">${e.titulo}</div>
          <div class="prazo-type">${tipoLabel[e.tipo] || 'Lembrete'}</div>
        </div>
        <span class="dias-badge ${badgeCls}">${label}</span>
      </div>`;
  }).join('');
}

function _resetarLockProcessoModal() {
  document.getElementById('ev-processo-locked').style.display     = 'none';
  document.getElementById('ev-processo-toggle-wrap').style.display = 'none';
  document.getElementById('ev-processo').style.display            = 'block';
  document.getElementById('ev-processo-span-opcional').style.display = 'inline';
  const tog = document.getElementById('ev-processo-toggle');
  if (tog) tog.checked = false;
}

function abrirModalPrazoProcesso() {
  openModal('modal-lembrete');
  if (!_processoAtual) return;

  // Trava o campo no processo atual
  const sel    = document.getElementById('ev-processo');
  const locked = document.getElementById('ev-processo-locked');
  const nome   = document.getElementById('ev-processo-locked-nome');
  const toggle = document.getElementById('ev-processo-toggle-wrap');
  const opc    = document.getElementById('ev-processo-span-opcional');

  if (sel)    { sel.value = _processoAtual.id; sel.style.display = 'none'; }
  if (locked) locked.style.display = 'flex';
  if (nome)   nome.textContent = (_processoAtual.apelido || _processoAtual.nome) +
                                  (_processoAtual.numero ? '  ·  ' + _processoAtual.numero : '');
  if (toggle) toggle.style.display = 'flex';
  if (opc)    opc.style.display = 'none';
}

function toggleProcessoOutro(checked) {
  const sel    = document.getElementById('ev-processo');
  const locked = document.getElementById('ev-processo-locked');
  if (checked) {
    if (locked) locked.style.display = 'none';
    if (sel)    { sel.style.display = 'block'; sel.value = _processoAtual?.id || ''; }
  } else {
    if (locked) locked.style.display = 'flex';
    if (sel)    { sel.style.display = 'none'; if (_processoAtual) sel.value = _processoAtual.id; }
  }
}

function irParaCalendarioMes(ano, mes) {
  miniCalDate = new Date(ano, mes, 1);
  fullCalDate = new Date(ano, mes, 1);
  showPage('calendario');
}

function abrirModalTipo(tipo) {
  openModal('modal-lembrete');
  const sel = document.getElementById('ev-tipo');
  if (sel) sel.value = tipo;
}

function preencherProcessosModal(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const procs  = window._processosDB || [];
  const shared = window._sharedSet   || {};

  const meus = procs.filter(p => !shared[p.id]);
  const comp  = procs.filter(p =>  shared[p.id]);

  const toOption = p => `<option value="${p.id}">${p.numero ? p.numero + ' — ' : ''}${p.apelido || p.nome}</option>`;

  let html = `<option value="">— Nenhum processo —</option>`;
  if (meus.length) html += `<optgroup label="Meus processos">${meus.map(toOption).join('')}</optgroup>`;
  if (comp.length) html += `<optgroup label="🤝 Compartilhados comigo">${comp.map(toOption).join('')}</optgroup>`;

  sel.innerHTML = html;
}

function atualizarHintCompartilhamento() {
  const sel   = document.getElementById('tar-processo');
  const hint  = document.getElementById('tar-processo-hint');
  if (!sel || !hint) return;
  const isShared = sel.value && window._sharedSet?.[sel.value];
  hint.style.display = isShared ? 'flex' : 'none';
}

let _vincularTaskId = null;

function abrirVincularTarefa(taskId) {
  _vincularTaskId = taskId;
  document.getElementById('vincular-busca').value = '';
  filtrarVincularTarefa();
  document.getElementById('modal-vincular-tarefa').style.display = 'flex';
  setTimeout(() => document.getElementById('vincular-busca').focus(), 80);
}

function fecharVincularTarefa() {
  document.getElementById('modal-vincular-tarefa').style.display = 'none';
  _vincularTaskId = null;
}

function filtrarVincularTarefa() {
  const q     = (document.getElementById('vincular-busca')?.value || '').toLowerCase();
  const procs = (window._processosDB || []);
  const shared = window._sharedSet || {};

  const filtrados = q
    ? procs.filter(p => (p.apelido || p.nome || '').toLowerCase().includes(q) || (p.numero || '').includes(q))
    : procs;

  const lista = document.getElementById('vincular-lista');
  if (!lista) return;

  if (!filtrados.length) {
    lista.innerHTML = `<div style="text-align:center;padding:16px;color:var(--gray-400);font-size:12px">Nenhum processo encontrado</div>`;
    return;
  }

  lista.innerHTML = filtrados.slice(0, 20).map(p => {
    const isShared = shared[p.id];
    const label    = p.apelido || p.nome;
    const num      = p.numero ? `<span style="color:var(--gray-400);font-size:10px">${p.numero}</span>` : '';
    const tag      = isShared ? `<span style="font-size:10px;color:#7c3aed;margin-left:4px"><i class="ti ti-handshake"></i> compartilhado</span>` : '';
    return `<button onclick="vincularTarefaProcesso('${p.id}');fecharVincularTarefa()"
      style="text-align:left;background:none;border:1px solid var(--gray-200);border-radius:8px;padding:8px 12px;cursor:pointer;width:100%;transition:background .1s"
      onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background='none'">
      <div style="font-size:13px;font-weight:500;color:var(--navy)">${_esc(label)}${tag}</div>
      ${num}
    </button>`;
  }).join('');
}

async function vincularTarefaProcesso(processoId) {
  if (!_vincularTaskId && processoId !== null) return;
  const taskId  = _vincularTaskId;
  const meuNome = window._user?.user_metadata?.full_name || window._user?.email?.split('@')[0] || '';
  const { error } = await _supabase.from('tarefas')
    .update({ processo_id: processoId || null, updated_at: new Date().toISOString(), updated_by_nome: meuNome })
    .eq('id', taskId);
  if (error) { showToast('Erro ao vincular processo.', 'error'); return; }
  showToast(processoId ? 'Tarefa vinculada ao processo!' : 'Vínculo removido.', 'success');
  carregarTarefas();
}

// ── KANBAN: TAREFAS DO BANCO ──────────────────────────────────────────────

let _tarefasDB  = [];
let _dragTaskId = null;

async function carregarTarefas() {
  if (!window._user) return;

  const { data, error } = await _supabase
    .from('tarefas')
    .select('*')
    .order('created_at', { ascending: true });

  if (!error && data) _tarefasDB = data;
  atualizarBell();

  const total = _tarefasDB.length;
  const sub   = document.getElementById('tarefas-sub');
  if (sub) sub.textContent = total ? `${total} tarefa(s) no quadro` : 'Nenhuma tarefa ainda';

  const procMap = {};
  for (const p of (window._processosDB || [])) procMap[p.id] = p.apelido || p.nome;

  const lastSeen = localStorage.getItem('kanban_last_seen') || '0';
  const meuNome  = window._user?.user_metadata?.full_name || window._user?.email?.split('@')[0] || '';

  renderizarKanban(_tarefasDB, procMap, lastSeen, meuNome);

  // Marca kanban como visto agora (dots somem na próxima vez que carregar)
  localStorage.setItem('kanban_last_seen', new Date().toISOString());
}

function renderizarKanban(tarefas, procMap, lastSeen, meuNome) {
  const colunas = ['a_fazer','em_andamento','revisao','concluida'];
  lastSeen  = lastSeen  || '0';
  meuNome   = meuNome   || '';

  for (const col of colunas) {
    const el    = document.getElementById('col-' + col);
    const badge = document.getElementById('col-count-' + col);
    const dot   = document.getElementById('col-dot-' + col);
    if (!el) continue;

    const itens = tarefas.filter(t => t.coluna === col);
    if (badge) badge.textContent = itens.length;

    // Dot laranja se alguma tarefa de parceiro foi atualizada desde a última visita
    const temNovo = itens.some(t =>
      t.updated_at && t.updated_at > lastSeen &&
      t.updated_by_nome && t.updated_by_nome !== meuNome
    );
    if (dot) dot.style.display = temNovo ? 'inline-block' : 'none';

    if (!itens.length) {
      el.innerHTML = `<div style="text-align:center;padding:24px 12px;color:var(--gray-400);font-size:12px;opacity:0.7">
        <i class="ti ti-inbox" style="display:block;font-size:20px;margin-bottom:6px"></i>
        Nenhuma tarefa
      </div>`;
      continue;
    }

    el.innerHTML = itens.map(t => criarCardTarefa(t, procMap || {}, lastSeen, meuNome)).join('');
  }
}

function criarCardTarefa(t, procMap, lastSeen, meuNome) {
  const priCls  = { urgente: '#dc2626', media: '#d97706', baixa: '#6b7280' };
  const priLbl  = { urgente: 'Urgente', media: 'Média', baixa: 'Baixa' };
  const cor     = priCls[t.prioridade]  || priCls.baixa;
  const lbl     = priLbl[t.prioridade] || 'Baixa';
  const shared  = t.processo_id ? window._sharedSet?.[t.processo_id] : null;
  const proc    = t.processo_id && procMap[t.processo_id] ? `<div style="font-size:11px;color:var(--gray-400);margin-top:4px"><i class="ti ti-briefcase" style="font-size:10px"></i> ${procMap[t.processo_id]}</div>` : '';
  const sharedTag = shared ? `<div style="font-size:10px;color:#7c3aed;margin-top:4px;display:flex;align-items:center;gap:3px"><i class="ti ti-handshake" style="font-size:10px"></i> ${_esc(shared.owner_nome)}</div>` : '';
  const prazo   = t.prazo ? `<div style="font-size:11px;color:var(--gray-400);margin-top:4px"><i class="ti ti-calendar" style="font-size:10px"></i> ${new Date(t.prazo + 'T12:00:00').toLocaleDateString('pt-BR')}</div>` : '';

  // Indicador de atividade de parceiro: quem moveu e quando
  const atividadeNova = t.updated_by_nome && t.updated_by_nome !== (meuNome || '') &&
                        t.updated_at && t.updated_at > (lastSeen || '0');
  const atividadeTag = atividadeNova
    ? `<div style="font-size:10px;color:#f97316;margin-top:5px;display:flex;align-items:center;gap:3px">
        <i class="ti ti-activity" style="font-size:10px"></i>
        ${_esc(t.updated_by_nome)} · ${_tempoRelativo(t.updated_at) || ''}
       </div>`
    : (t.updated_by_nome && !atividadeNova && (shared || procMap[t.processo_id])
        ? `<div style="font-size:10px;color:var(--gray-400);margin-top:5px;display:flex;align-items:center;gap:3px">
            <i class="ti ti-activity" style="font-size:10px"></i>
            ${_esc(t.updated_by_nome)} · ${_tempoRelativo(t.updated_at) || ''}
           </div>`
        : '');

  // Ícone de vincular processo (mini modal com busca)
  const linkIcon = !t.processo_id
    ? `<button onclick="abrirVincularTarefa('${t.id}')" title="Vincular a processo"
        style="background:none;border:none;color:var(--gray-300);cursor:pointer;font-size:13px;padding:0;line-height:1;flex-shrink:0;transition:color .15s"
        onmouseover="this.style.color='#7c3aed'" onmouseout="this.style.color='var(--gray-300)'">
        <i class="ti ti-link"></i>
       </button>`
    : '';
  const shareBtn = '';

  return `
    <div class="task-card" draggable="true"
      ondragstart="kanbanDragStart(event,'${t.id}')"
      ondragend="kanbanDragEnd(event)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="font-size:13px;font-weight:500;line-height:1.4;flex:1">${t.titulo}</div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          ${linkIcon}
          <button onclick="excluirTarefa('${t.id}')" title="Excluir"
            style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:13px;padding:0;line-height:1">
            <i class="ti ti-x"></i>
          </button>
        </div>
      </div>
      ${proc}${sharedTag}${prazo}${atividadeTag}
      <div style="margin-top:8px">
        <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:8px;background:${cor}18;color:${cor}">${lbl}</span>
      </div>
      ${shareBtn}
    </div>`;
}

function kanbanDragStart(e, taskId) {
  _dragTaskId = taskId;
  e.currentTarget.style.opacity = '0.5';
  e.dataTransfer.effectAllowed  = 'move';
}

function kanbanDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.task-col-body').forEach(el => el.classList.remove('drag-over'));
}

function kanbanDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function kanbanDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function kanbanDrop(e, coluna) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!_dragTaskId) return;

  const meuNome = window._user?.user_metadata?.full_name || window._user?.email?.split('@')[0] || '';
  const { error } = await _supabase
    .from('tarefas')
    .update({ coluna, updated_at: new Date().toISOString(), updated_by_nome: meuNome })
    .eq('id', _dragTaskId);

  _dragTaskId = null;
  if (error) { showToast('Erro ao mover tarefa.'); return; }
  carregarTarefas();
}

async function salvarTarefa() {
  const titulo     = document.getElementById('tar-titulo')?.value.trim()   || '';
  const processo   = document.getElementById('tar-processo')?.value        || '';
  const coluna     = document.getElementById('tar-coluna')?.value          || 'a_fazer';
  const prioridade = document.getElementById('tar-prioridade')?.value      || 'baixa';
  const prazo      = document.getElementById('tar-prazo')?.value           || null;

  if (!titulo) { showToast('Preencha a descrição da tarefa.'); return; }

  const btn = document.getElementById('btn-salvar-tarefa');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Salvando...'; }

  const meuNome = window._user?.user_metadata?.full_name || window._user?.email?.split('@')[0] || '';
  const { error } = await _supabase.from('tarefas').insert({
    user_id:          window._escritorioId,
    titulo,
    processo_id:      processo || null,
    coluna,
    prioridade,
    prazo:            prazo || null,
    updated_by_nome:  meuNome,
    updated_at:       new Date().toISOString(),
  });

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> Criar Tarefa'; }

  if (error) {
    showToast('Erro ao salvar tarefa: ' + error.message);
    console.error('Erro tarefa:', error);
    return;
  }

  closeModal('modal-tarefa');
  document.getElementById('tar-titulo').value = '';
  showToast('Tarefa criada!');
  carregarTarefas();
}

async function excluirTarefa(id) {
  if (!await _confirmar('A tarefa será excluída permanentemente do quadro.', 'Excluir tarefa?', { textoOk: 'Excluir', perigo: true, icone: '✅' })) return;
  const { error } = await _supabase.from('tarefas').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir tarefa.'); return; }
  showToast('Tarefa excluída.');
  carregarTarefas();
}

// ── IMPORTAÇÃO COM MERGE INTELIGENTE ─────────────────────────────────────

async function _importarComMerge(d) {
  const movs = d.movimentos || [];

  // Verifica se processo já existe
  const { data: existente } = await _supabase
    .from('processos')
    .select('id,apelido,cliente,notas_manuais,movimentos_recentes,movimentos_hash')
    .eq('user_id', window._escritorioId)
    .eq('numero', d.numero)
    .maybeSingle();

  if (existente) {
    // Mescla: atualiza dados do tribunal, preserva dados do advogado
    const novasMovs = movs.length ? movs : (existente.movimentos_recentes || []);
    const updates = {
      movimentos_recentes: novasMovs,
      movimentos_hash: novasMovs.length ? novasMovs.map(m => m.data + m.nome).join('|') : null,
      ultima_verificacao:  new Date().toISOString(),
    };
    if (d.tribunal)        updates.tribunal        = d.tribunal;
    if (d.orgaoJulgador)   updates.orgao_julgador  = d.orgaoJulgador;
    if (d.classe)          updates.classe           = d.classe;
    if (d.dataAjuizamento) updates.data_ajuizamento = d.dataAjuizamento;
    if (d._datajudIndex)   updates.datajud_index   = d._datajudIndex;

    const { error } = await _supabase.from('processos').update(updates).eq('id', existente.id);
    if (error) return { status: 'erro', error };
    return { status: 'mesclado' };
  }

  // Processo novo
  const clientePart = (d.partes || []).find(p => /autor|requerente|reclamante/i.test(p.tipo));
  // upsert (não insert) — evita duplicar se duas chamadas concorrentes (ex: duplo clique
  // no "Importar selecionados") passarem pela checagem acima ao mesmo tempo
  const { error } = await _supabase.from('processos').upsert({
    user_id:             window._escritorioId,
    numero:              d.numero             || '',
    nome:                d.classe             || d.numero || '',
    cliente:             clientePart?.nome    || '',
    area:                'Cível',
    tribunal:            d.tribunal           || '',
    parte_contraria:     '',
    datajud_index:       d._datajudIndex      || null,
    classe:              d.classe             || null,
    orgao_julgador:      d.orgaoJulgador      || null,
    data_ajuizamento:    d.dataAjuizamento    || null,
    movimentos_recentes: movs.length ? movs   : null,
    movimentos_hash:     movs.length ? movs.map(m => m.data + m.nome).join('|') : null,
    ultima_verificacao:  movs.length ? new Date().toISOString() : null,
  }, { onConflict: 'user_id,numero' });
  if (error) return { status: 'erro', error };
  return { status: 'importado' };
}

// ── IMPORTAÇÃO EM LOTE ────────────────────────────────────────────────────

let _loteResultados = [];

function renderizarLoteResultados() {
  const wrap = document.getElementById('lote-resultados');
  if (!wrap) return;

  const icons = {
    buscando:       `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite;color:var(--gray-400);font-size:15px"></i>`,
    encontrado:     `<i class="ti ti-circle-check" style="color:var(--green);font-size:15px"></i>`,
    nao_encontrado: `<i class="ti ti-circle-x" style="color:var(--red);font-size:15px"></i>`,
    erro:           `<i class="ti ti-alert-triangle" style="color:var(--amber);font-size:15px"></i>`,
  };
  const bgs = {
    buscando:       'var(--gray-50)',
    encontrado:     'var(--green-light)',
    nao_encontrado: 'var(--red-light)',
    erro:           'var(--amber-light)',
  };

  wrap.innerHTML = _loteResultados.map((r, i) => {
    const isFound = r.status === 'encontrado';
    const jaExiste = !!r.jaExiste;
    const sublabel = {
      buscando:       'Buscando...',
      encontrado:     (jaExiste ? '↻ Já cadastrado · ' : '') + (r.data?.classe || r.data?.tribunal || 'Encontrado'),
      nao_encontrado: 'Não localizado',
      erro:           'Erro de conexão',
    }[r.status] || r.status;

    const bg = r.status === 'encontrado'
      ? (jaExiste ? '#f0fdf4' : 'var(--green-light)')
      : (bgs[r.status] || 'var(--gray-50)');

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;border:1px solid var(--gray-200);background:${bg}">
        ${isFound
          ? `<input type="checkbox" ${r.selecionado ? 'checked' : ''}
               onchange="_loteResultados[${i}].selecionado=this.checked;atualizarLoteLabel()"
               style="width:14px;height:14px;cursor:pointer;flex-shrink:0;accent-color:var(--navy)">`
          : `<div style="width:14px;flex-shrink:0"></div>`}
        <div style="flex:1;min-width:0;overflow:hidden">
          <div style="font-size:12px;font-weight:600;font-family:monospace;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.numero}</div>
          <div style="font-size:11px;color:var(--gray-600);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sublabel}</div>
        </div>
        <div style="flex-shrink:0">${icons[r.status] || ''}</div>
      </div>`;
  }).join('');
}

function atualizarLoteLabel() {
  const encontrados    = _loteResultados.filter(r => r.status === 'encontrado').length;
  const selecionados   = _loteResultados.filter(r => r.selecionado && r.status === 'encontrado').length;
  const naoEncontrados = _loteResultados.filter(r => r.status === 'nao_encontrado').length;
  const label = document.getElementById('lote-importar-label');
  if (!label) return;
  const jaExistentes = _loteResultados.filter(r => r.status === 'encontrado' && r.jaExiste && r.selecionado).length;
  label.textContent = `${selecionados} de ${encontrados} selecionado(s)`;
  if (jaExistentes)   label.textContent += ` (${jaExistentes} serão mesclados)`;
  if (naoEncontrados) label.textContent += ` · ${naoEncontrados} não localizado(s)`;
}

function loteToggleTodos() {
  const encontrados = _loteResultados.filter(r => r.status === 'encontrado');
  const algumDesmarcado = encontrados.some(r => !r.selecionado);
  encontrados.forEach(r => { r.selecionado = algumDesmarcado; });
  renderizarLoteResultados();
  atualizarLoteLabel();
}

async function importarLoteSelecionados() {
  const selecionados = _loteResultados.filter(r => r.selecionado && r.status === 'encontrado' && r.data);
  if (!selecionados.length) { showToast('Selecione pelo menos um processo.'); return; }

  const btn = document.querySelector('#lote-importar-wrap .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Processando ${selecionados.length}...`; }

  let importados = 0;
  let mesclados  = 0;
  let erros      = 0;

  for (const r of selecionados) {
    const result = await _importarComMerge(r.data);
    if (result.status === 'importado')     importados++;
    else if (result.status === 'mesclado') mesclados++;
    else { erros++; console.error('Erro ao importar', r.numero, result.error); }
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-cloud-download"></i> Importar selecionados'; }

  closeModal('modal-busca-tribunal');

  const partes = [];
  if (importados) partes.push(`${importados} importado(s)`);
  if (mesclados)  partes.push(`${mesclados} atualizado(s) e mesclado(s)`);
  if (erros)      partes.push(`${erros} com falha`);
  showToast(partes.length ? partes.join(' · ') + '.' : 'Nenhum processo importado.');
  carregarProcessos();
}

// ── PROCESSOS DESCOBERTOS (OAB) ──────────────────────────────────────────────
// Processos que o cron diário encontrou na OAB do advogado e que ainda não
// foram cadastrados. Ele decide importar (via _importarComMerge) ou ignorar;
// uma vez decidido, o backend nunca mais retorna aquele item.

let _descobertosCache = [];

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

async function carregarDescobertos() {
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) return;
    const r = await fetch('/api/processos-descobertos', {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    if (!r.ok) return;
    const { descobertos } = await r.json();
    _descobertosCache = descobertos || [];

    const banner = document.getElementById('descobertos-banner');
    if (!banner) return;
    if (_descobertosCache.length) {
      document.getElementById('descobertos-banner-texto').textContent =
        `Encontramos ${_descobertosCache.length} processo(s) novo(s) na sua OAB`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  } catch (_) {}
}

function abrirModalDescobertos() {
  renderizarDescobertos();
  openModal('modal-descobertos');
}

function renderizarDescobertos() {
  const lista = document.getElementById('descobertos-lista');
  if (!lista) return;

  if (!_descobertosCache.length) {
    lista.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px">Nenhum processo novo pendente.</div>';
    return;
  }

  lista.innerHTML = _descobertosCache.map(item => {
    const d = item.dados || {};
    const dataFmt = item.data_ajuizamento
      ? new Date(item.data_ajuizamento + 'T12:00:00').toLocaleDateString('pt-BR')
      : '—';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--gray-50);border-radius:var(--radius)" id="descoberto-${item.id}">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--navy)">${escHtml(d.numero || item.numero)}</div>
        <div style="font-size:11px;color:var(--gray-400)">${escHtml(d.classe || item.tribunal)} · Ajuizado em ${dataFmt}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-secondary" style="font-size:11px;padding:5px 10px" onclick="ignorarDescoberto('${item.id}')">Ignorar</button>
        <button class="btn-primary" style="font-size:11px;padding:5px 10px" onclick="importarDescoberto('${item.id}')">Importar</button>
      </div>
    </div>`;
  }).join('');
}

async function decidirDescoberto(id, acao) {
  const { data: { session } } = await _supabase.auth.getSession();
  await fetch('/api/processos-descobertos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ id, acao }),
  });
  _descobertosCache = _descobertosCache.filter(d => d.id !== id);
  renderizarDescobertos();
  const banner = document.getElementById('descobertos-banner');
  if (banner && !_descobertosCache.length) banner.style.display = 'none';
  else if (banner) document.getElementById('descobertos-banner-texto').textContent =
    `Encontramos ${_descobertosCache.length} processo(s) novo(s) na sua OAB`;
}

async function ignorarDescoberto(id) {
  await decidirDescoberto(id, 'ignorar');
  showToast('Processo ignorado.');
}

async function importarDescoberto(id) {
  const item = _descobertosCache.find(d => d.id === id);
  if (!item) return;
  const result = await _importarComMerge(item.dados);
  if (result.status === 'erro') {
    showToast('Erro ao importar processo.');
    return;
  }
  await decidirDescoberto(id, 'marcar-importado');
  showToast(result.status === 'mesclado' ? 'Processo mesclado com um já existente.' : 'Processo importado.');
  carregarProcessos();
}

// ─── TJDFT ────────────────────────────────────────────────────────────────────

const PYTHON_API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8000'
  : 'https://meuprocesso-api.up.railway.app';

// Usa a API do DJEN (comunicaapi.pje.jus.br) — dados atuais, CORS aberto, sem autenticação.
// Substitui o buscador pesquisadje.tjdft.jus.br que congelou em out/2024.
const DJEN_API = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const DJE_DATA_INICIO_PADRAO = new Date(new Date().getFullYear() + '-01-01').toISOString().slice(0, 10);

function inicializarDatesDJe() {
  const ini   = document.getElementById('dje-data-inicio');
  const fim   = document.getElementById('dje-data-fim');
  const aviso = document.getElementById('dje-aviso-periodo');
  if (ini && !ini.value) ini.value = DJE_DATA_INICIO_PADRAO;
  if (fim && !fim.value) fim.value = new Date().toISOString().slice(0, 10);
  if (aviso) aviso.innerHTML = '';
}

async function verificarBackendPython() {
  const badge = document.getElementById('tjdft-status-badge');
  if (!badge) return;
  try {
    const res = await fetch(`${PYTHON_API}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0"></span> Servidor Python conectado`;
      badge.style.background = '#f0fdf4';
      badge.style.color = 'var(--green)';
      return;
    }
  } catch (_) {}
  badge.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:var(--gray-400);flex-shrink:0"></span> Servidor Python desconectado`;
  badge.style.background = 'var(--gray-100)';
  badge.style.color = 'var(--gray-500)';
}

// Normaliza OAB para o formato "DF59360" usado no DJe
// Aceita: "DF59360", "DF 59360", "OAB/DF 59360", "OAB DF 59360", "59360/DF", "59360 DF"
function _normalizarOAB(input) {
  const s = input.trim().toUpperCase().replace(/\./g, '');
  let m;
  m = s.match(/^OAB[/ ]?([A-Z]{2})[/ ]?(\d{3,6})$/);
  if (m) return `${m[1]}${m[2]}`;
  m = s.match(/^([A-Z]{2})[/ ]?(\d{3,6})$/);
  if (m) return `${m[1]}${m[2]}`;
  m = s.match(/^(\d{3,6})[/ ]([A-Z]{2})$/);
  if (m) return `${m[2]}${m[1]}`;
  return null;
}

function _tipoQueryDJe(q) {
  if (_normalizarOAB(q)) return 'oab';
  return 'nome';
}

// Extrai tipo de decisão do texto do DJe
// Agrupa publicações DJe pelo número CNJ principal — evita cards duplicados
function _deduplicarDJe(resultados) {
  const seen = new Map(); // numero → índice em deduped
  const deduped = [];
  for (const doc of resultados) {
    const num = doc.processos?.[0];
    if (!num) { deduped.push({ ...doc, _pubCount: 1 }); continue; }
    if (!seen.has(num)) {
      seen.set(num, deduped.length);
      deduped.push({ ...doc, _pubCount: 1 });
    } else {
      const idx = seen.get(num);
      deduped[idx]._pubCount = (deduped[idx]._pubCount || 1) + 1;
      // Mantém a publicação mais recente como entrada principal
      if ((doc.data_disponibilizacao || '') > (deduped[idx].data_disponibilizacao || '')) {
        const count = deduped[idx]._pubCount;
        deduped[idx] = { ...doc, _pubCount: count };
      }
    }
  }
  return deduped;
}

function _extrairTipoDecisao(txt) {
  const tipos = ['ACÓRDÃO', 'SENTENÇA', 'DECISÃO INTERLOCUTÓRIA', 'DESPACHO', 'CERTIDÃO', 'PORTARIA', 'RESOLUÇÃO', 'ATO'];
  for (const t of tipos) {
    if (txt.toUpperCase().includes(t)) return t;
  }
  return '';
}

// Extrai número e UF da OAB de uma string normalizada ("DF59360" → {num:"59360", uf:"DF"})
function _parsearOAB(normalizado) {
  const m = normalizado.match(/^([A-Z]{2})(\d+)$/);
  return m ? { uf: m[1], num: m[2] } : null;
}

async function rodarMonitorDJe() {
  const rawQuery   = document.getElementById('dje-query')?.value.trim();
  const dataInicio = document.getElementById('dje-data-inicio')?.value || DJE_DATA_INICIO_PADRAO;
  const dataFim    = document.getElementById('dje-data-fim')?.value    || new Date().toISOString().slice(0, 10);

  if (!rawQuery) {
    const oabPerfil = window._user?.user_metadata?.oab || '';
    if (!oabPerfil) {
      showToast('Cadastre sua OAB nas configurações para buscar no DJEN.', 'warning');
      showPage('configuracoes');
      setTimeout(() => document.getElementById('config-oab')?.focus(), 400);
      return;
    }
    showToast('Informe OAB ou nome do advogado.');
    return;
  }

  const wrap  = document.getElementById('dje-resultado');
  const title = document.getElementById('dje-resultado-titulo');
  const lista = document.getElementById('dje-resultado-lista');

  lista.innerHTML    = '';
  wrap.style.display = 'block';

  // Suporta múltiplas OABs separadas por vírgula: "DF59360, SP12345"
  const entradas = rawQuery.split(',').map(s => s.trim()).filter(Boolean);
  const oabsParsadas = entradas
    .map(e => { const n = _normalizarOAB(e); return n ? _parsearOAB(n) : null; })
    .filter(Boolean);
  const isOAB = oabsParsadas.length > 0;
  const label = isOAB ? oabsParsadas.map(o => `${o.uf}${o.num}`).join(', ') : rawQuery;

  title.textContent = `Buscando "${label}" no DJEN nacional…`;

  try {
    const baseParams = {
      dataDisponibilizacaoInicio: dataInicio,
      dataDisponibilizacaoFim:    dataFim,
      pagina:        1,
      tamanhoPagina: 50,
    };

    // Faz uma requisição por OAB em paralelo; sem OAB faz uma só requisição por nome
    const requisicoes = isOAB
      ? oabsParsadas.map(oab => {
          const p = new URLSearchParams({ ...baseParams, numeroOab: oab.num, ufOab: oab.uf });
          return fetch(`${DJEN_API}?${p}`).then(r => r.ok ? r.json() : { items: [], count: 0 });
        })
      : [fetch(`${DJEN_API}?${new URLSearchParams(baseParams)}`).then(r => r.ok ? r.json() : { items: [], count: 0 })];

    const resultados = await Promise.all(requisicoes);

    // Mescla, deduplica por id e ordena por data mais recente
    const vistos = new Set();
    let items = resultados.flatMap(r => r.items || []).filter(item => {
      if (vistos.has(item.id)) return false;
      vistos.add(item.id);
      return true;
    }).sort((a, b) => (b.data_disponibilizacao || '').localeCompare(a.data_disponibilizacao || ''));

    const total = resultados.reduce((s, r) => s + (r.count || 0), 0);

    // Para busca por nome: filtra client-side nos destinatários
    if (!isOAB && rawQuery.length >= 3) {
      const palavras = rawQuery.toLowerCase().split(/\s+/).filter(p => p.length > 2);
      items = items.filter(item => {
        const advs = (item.destinatarioadvogados || []).map(d => (d.advogado?.nome || '').toLowerCase());
        const textoLower = (item.texto || '').toLowerCase();
        return advs.some(n => palavras.every(p => n.includes(p)))
          || palavras.every(p => textoLower.includes(p));
      });
    }

    title.textContent = items.length
      ? `${total} publicação(ões) no período — exibindo ${items.length}`
      : `Nenhuma publicação encontrada para "${label}" no período`;

    if (!items.length) {
      lista.innerHTML = `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px">
        <i class="ti ti-mood-empty" style="font-size:28px;display:block;margin-bottom:8px;opacity:.4"></i>
        Nenhuma publicação no período selecionado.<br>
        <span style="font-size:12px">Tente ampliar o intervalo de datas.</span>
      </div>`;
      return;
    }

    const PADRAO_PROC = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;
    const fmt = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const stripHtml = h => h
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim();

    // Extrai nomes de partes do texto da publicação
    const extrairPartes = txt => {
      const polos = { cliente: null, contrario: null };
      const reqs = txt.match(/(?:REQUERENTE|AUTOR[AE]?|EXEQUENTE|IMPETRANTE|RECORRENTE)\s*[:\-]\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇa-záéíóúâêîôûãõç\s]{3,50}?)(?=\s{2,}|ADVOGADO|OAB|\n|CPF|REQUERIDO|RÉU)/i);
      const reus  = txt.match(/(?:REQUERIDO[A]?|RÉU|RÉUS|EXECUTADO[A]?|IMPETRADO|RECORRIDO)\s*[:\-]\s*([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇa-záéíóúâêîôûãõç\s]{3,50}?)(?=\s{2,}|ADVOGADO|OAB|\n|CPF|REQUERENTE|AUTOR)/i);
      if (reqs) polos.cliente   = reqs[1].trim();
      if (reus) polos.contrario = reus[1].trim();
      return polos;
    };

    window._djeResultados = items.map(item => {
      const textoLimpo = stripHtml(item.texto || '');
      const processoMask = item.numeroprocessocommascara || '';
      // Extrai todos os números CNJ do texto também
      const numerosExtras = [...new Set((textoLimpo.match(PADRAO_PROC) || []))];
      const processos = processoMask
        ? [processoMask, ...numerosExtras.filter(n => n !== processoMask)]
        : numerosExtras;
      const tipoDecisao = _extrairTipoDecisao(textoLimpo);
      const partes      = extrairPartes(textoLimpo);
      const matches = processos
        .map(num => (window._processosDB || []).find(p => p.numero === num))
        .filter(Boolean);
      return { ...item, textoLimpo, processos, tipoDecisao, partes, matches };
    });

    window._djeResultados = _deduplicarDJe(window._djeResultados);

    // Salva automaticamente nos processos já cadastrados (ver _salvarMovimentoDJe)
    let qtdAutoSalvas = 0;
    for (const doc of window._djeResultados) {
      if (!doc.matches.length) continue;
      const resultado = await _salvarMovimentoDJe(doc, doc.matches[0]);
      doc._autoSave = resultado.status;
      if (resultado.status === 'salvo') qtdAutoSalvas++;
    }
    if (qtdAutoSalvas > 0) {
      await carregarProcessos();
      showToast(`✓ ${qtdAutoSalvas} processo(s) atualizado(s) automaticamente com publicações do DJEN.`, 'success');
    }

    // Botão "Importar todos" no topo dos resultados
    const semCadastro = window._djeResultados.filter(d => !d.matches.length && d.processos[0]);
    lista.innerHTML = semCadastro.length > 1 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 2px 10px">
        <span style="font-size:12px;color:var(--gray-500)">${semCadastro.length} processo(s) não cadastrado(s)</span>
        <button class="btn-primary" style="font-size:11px;padding:5px 14px" onclick="importarTodosDJe()">
          <i class="ti ti-download"></i> Importar todos
        </button>
      </div>` : '';

    lista.innerHTML += window._djeResultados.map((doc, i) => {
      const preview = doc.textoLimpo.slice(0, 220) + (doc.textoLimpo.length > 220 ? '…' : '');
      const temMatch = doc.matches.length > 0;
      const numPrincipal = doc.processos[0] || '';
      const dataFmt = fmt(doc.data_disponibilizacao);
      const orgao = doc.nomeOrgao || '';

      if (temMatch) {
        const proc = doc.matches[0];
        return `
          <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:var(--radius);padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px">
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;letter-spacing:.03em">
                  <i class="ti ti-bell-ringing" style="font-size:10px"></i> ATUALIZAÇÃO
                </span>
                ${doc.tipoDecisao ? `<span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px;background:#e8edf5;color:var(--navy)">${doc.tipoDecisao}</span>` : ''}
              </div>
              <span style="font-size:10px;color:var(--gray-400);white-space:nowrap">${dataFmt}</span>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--navy);margin-bottom:2px">${proc.apelido || proc.nome}</div>
            <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px">${numPrincipal} · ${orgao}</div>
            <div style="font-size:11px;color:var(--gray-700);line-height:1.6;max-height:60px;overflow:hidden;margin-bottom:10px">${preview}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${doc._autoSave === 'salvo'
                ? `<span style="font-size:11px;font-weight:600;color:var(--green)"><i class="ti ti-check"></i> Salvo automaticamente</span>`
                : doc._autoSave === 'erro'
                  ? `<button class="btn-primary" style="font-size:11px;padding:6px 12px;gap:5px" onclick="salvarAtualizacaoDJe(${i},'${proc.id}',this)"><i class="ti ti-refresh"></i> Tentar de novo</button>`
                  : `<span style="font-size:11px;color:var(--gray-400)"><i class="ti ti-check"></i> Já atualizado</span>`}
              <button class="btn-secondary" style="font-size:11px;padding:6px 12px;gap:5px"
                onclick="abrirProcesso('${proc.id}')">
                <i class="ti ti-arrow-right"></i> Ver processo
              </button>
              ${doc.link ? `<a href="${doc.link}" target="_blank" rel="noopener"
                style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--gray-500);padding:6px 8px;text-decoration:none">
                <i class="ti ti-external-link" style="font-size:11px"></i> DJEN</a>` : ''}
            </div>
          </div>`;
      }

      return `
        <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:12px 14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#e8edf5;color:var(--navy);letter-spacing:.03em">
                ${doc.tipoComunicacao || 'PUBLICAÇÃO'}
              </span>
              ${doc.tipoDecisao ? `<span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px;background:#f3f4f6;color:var(--gray-600)">${doc.tipoDecisao}</span>` : ''}
            </div>
            <span style="font-size:10px;color:var(--gray-400);white-space:nowrap">${dataFmt}</span>
          </div>
          <div style="font-size:12px;font-weight:600;color:var(--navy);margin-bottom:2px">
            ${numPrincipal || 'Processo não identificado'}
            ${doc.processos.length > 1 ? `<span style="color:var(--gray-400);font-weight:400"> +${doc.processos.length-1}</span>` : ''}
          </div>
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px">${orgao}</div>
          ${doc.partes?.cliente ? `<div style="font-size:11px;color:var(--gray-600);margin-bottom:4px">
            <span style="color:var(--gray-400)">Cliente: </span>${doc.partes.cliente}
            ${doc.partes.contrario ? ` · <span style="color:var(--gray-400)">vs </span>${doc.partes.contrario}` : ''}
          </div>` : ''}
          <div style="font-size:11px;color:var(--gray-600);line-height:1.6;max-height:60px;overflow:hidden;margin-bottom:10px">${preview}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${numPrincipal ? `
              <button class="btn-secondary" style="font-size:11px;padding:6px 12px;gap:5px"
                onclick="importarProcessoDJe(${i})">
                <i class="ti ti-plus"></i> Importar processo
              </button>` : ''}
            ${doc.link ? `<a href="${doc.link}" target="_blank" rel="noopener"
              style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--navy);font-weight:600;padding:6px 8px;text-decoration:none">
              <i class="ti ti-external-link" style="font-size:11px"></i> Abrir no DJEN
            </a>` : ''}
          </div>
        </div>`;
    }).join('');

  } catch (e) {
    title.textContent = '';
    lista.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px">
      ❌ ${e.message || 'Erro ao acessar o DJEN.'}
    </div>`;
  }
}

// Persiste uma publicação do DJEN num processo já cadastrado. Usada tanto pelo
// clique manual em "Salvar" quanto pelo salvamento automático da busca por OAB
// (o usuário roda a busca manualmente como substituto do cron e espera que o
// resultado já caia direto no processo, sem precisar clicar em cada card).
async function _salvarMovimentoDJe(doc, proc) {
  const dataDisp  = doc.data_disponibilizacao || '';
  const descricao = `DJEN — ${doc.tipoComunicacao || 'Publicação'}${doc.tipoDecisao ? ' · ' + doc.tipoDecisao : ''}`;

  const novoMov = {
    data:   dataDisp ? dataDisp + 'T00:00:00' : new Date().toISOString(),
    nome:   descricao,
    _fonte: 'djen',
    _url:   doc.link || null,
  };

  const existentes = proc.movimentos_recentes || [];
  const jaSalvo = existentes.some(m => m.nome === novoMov.nome && m.data === novoMov.data);
  if (jaSalvo) return { status: 'duplicado' };

  const novosMovs = [novoMov, ...existentes];

  const { error } = await _supabase.from('processos').update({
    movimentos_recentes:  novosMovs,
    notificacao_pendente: true,
    novos_movimentos:     [novoMov],
    ultima_verificacao:   new Date().toISOString(),
  }).eq('id', proc.id);

  if (error) return { status: 'erro', error };

  proc.movimentos_recentes  = novosMovs;
  proc.notificacao_pendente = true;

  return { status: 'salvo' };
}

async function salvarAtualizacaoDJe(docIndex, processoId, btn) {
  const doc  = (window._djeResultados || [])[docIndex];
  const proc = (window._processosDB  || []).find(p => p.id === processoId);
  if (!doc || !proc) return;

  btn.disabled   = true;
  btn.innerHTML  = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Salvando…';

  const resultado = await _salvarMovimentoDJe(doc, proc);

  if (resultado.status === 'duplicado') {
    showToast('Esta publicação já foi salva neste processo.');
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Salvar como atualização';
    return;
  }

  if (resultado.status === 'erro') {
    showToast('Erro ao salvar: ' + resultado.error.message);
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Salvar como atualização';
    return;
  }

  btn.innerHTML = '<i class="ti ti-check"></i> Salvo!';
  btn.style.background = 'var(--green)';

  carregarProcessos();
  showToast(`Atualização salva em "${proc.apelido || proc.nome}"`);
}

async function importarProcessoDJe(docIndex) {
  const doc = (window._djeResultados || [])[docIndex];
  if (!doc || !doc.processos[0]) return;

  const btn = document.querySelector(`button[onclick="importarProcessoDJe(${docIndex})"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Importando…'; }

  const mov = `DJEN — ${doc.tipoComunicacao || 'Publicação'}${doc.tipoDecisao ? ' · ' + doc.tipoDecisao : ''}`;
  // Usa o nome digitado pelo advogado para processos em segredo de justiça
  const clienteManual = document.getElementById(`dje-cliente-manual-${docIndex}`)?.value.trim() || null;
  const clienteFinal  = clienteManual || (doc.partes?.cliente?.length > 2 ? doc.partes.cliente : null);
  const userId = window._escritorioId || window._user?.id;
  const numero = doc.processos[0];
  const novoMov = { data: (doc.data_disponibilizacao || '') + 'T00:00:00', nome: mov };

  // Checa direto no banco (não no cache local) se o processo já existe, para não duplicar
  // nem descartar a publicação encontrada caso já esteja cadastrado
  const { data: existente } = await _supabase
    .from('processos')
    .select('id,movimentos_recentes')
    .eq('user_id', userId)
    .eq('numero', numero)
    .maybeSingle();

  if (existente) {
    const movsAtuais = existente.movimentos_recentes || [];
    const novasMovs   = [novoMov, ...movsAtuais].slice(0, 100);
    const { error } = await _supabase.from('processos').update({
      movimentos_recentes:  novasMovs,
      movimentos_hash:      novasMovs.map(m => m.data + m.nome).join('|').slice(0, 500),
      ultima_verificacao:   new Date().toISOString(),
      notificacao_pendente: true,
      novos_movimentos:     [novoMov],
    }).eq('id', existente.id);

    if (error) {
      showToast('Erro ao atualizar: ' + error.message);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-plus"></i> Importar processo'; }
      return;
    }
    if (btn) btn.innerHTML = '<i class="ti ti-check"></i> Atualizado';
    showToast(`✓ Processo ${numero} já cadastrado — publicação mesclada na timeline.`, 'success');
    await carregarProcessos();
    return;
  }

  const { error } = await _supabase.from('processos').upsert({
    user_id:         userId,
    numero,
    nome:            [doc.nomeClasse, doc.tipoDecisao].filter(Boolean).join(' · ') || doc.tipoComunicacao || 'Publicação DJEN',
    tribunal:        doc.siglaTribunal    || '',
    cliente:         clienteFinal,
    parte_contraria: doc.partes?.contrario?.length > 2 ? doc.partes.contrario : null,
    area:            _detectarArea(doc.siglaTribunal, doc.nomeClasse),
    classe:          doc.nomeClasse  || null,
    orgao_julgador:  doc.nomeOrgao   || null,
    movimentos_recentes: [novoMov],
    movimentos_hash:     (doc.data_disponibilizacao || '') + mov,
    ultima_verificacao:  new Date().toISOString(),
  }, { onConflict: 'user_id,numero' });

  if (error) {
    showToast('Erro ao importar: ' + error.message);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-plus"></i> Importar processo'; }
    return;
  }

  if (btn) btn.innerHTML = '<i class="ti ti-check"></i> Importado';
  showToast(`✓ Processo ${numero} importado! Carregando timeline do CNJ…`, 'success');
  await carregarProcessos();

  // Enriquece com movimentos completos do DataJud em background
  _enriquecerComDatajud(numero);
}

// Busca movimentos completos no DataJud e atualiza o processo recém-importado
async function _enriquecerComDatajud(numero) {
  try {
    const r = await fetch(`/api/buscar-processo?tipo=numero&numero=${encodeURIComponent(numero)}`);
    if (!r.ok) return;
    const d = await r.json();
    const p = d.resultados?.[0];
    if (!p?.movimentos?.length) return;

    const update = {
      movimentos_recentes: p.movimentos,
      movimentos_hash: p.movimentos.slice(0, 20).map(m => (m.data || '') + (m.nome || '')).join('|').slice(0, 500),
      ultima_verificacao: new Date().toISOString(),
    };
    // Aproveita dados extras do DataJud se não vieram do DJEN
    if (p.tribunal)       update.tribunal       = p.tribunal;
    if (p.orgaoJulgador)  update.orgao_julgador = p.orgaoJulgador;
    if (p.classe)         update.classe         = p.classe;
    // datajud_index é essencial para o cron de monitoramento detectar este processo
    if (p._datajudIndex)  update.datajud_index  = p._datajudIndex;

    const userId = window._escritorioId || window._user?.id;
    await _supabase.from('processos').update(update).eq('numero', numero).eq('user_id', userId);
    await carregarProcessos();

    // Se o detalhe deste processo estiver aberto, re-renderiza a timeline
    if (_processoAtual?.numero === numero) {
      const proc = (window._processosDB || []).find(p => p.numero === numero);
      if (proc) {
        _processoAtual = proc;
        popularDetalhe(proc);
      }
    }

    showToast(`Timeline completa: ${p.movimentos.length} movimentos carregados`, 'success');
  } catch (_) { /* silently fail — timeline básica do DJEN já foi salva */ }
}

async function importarTodosDJe() {
  const dbNums = new Set((window._processosDB || []).map(p => p.numero).filter(Boolean));
  const pendentes = (window._djeResultados || []).filter(d =>
    d.processos[0] && !d.matches?.length && !dbNums.has(d.processos[0])
  );
  if (!pendentes.length) { showToast('Nenhum processo novo para importar.'); return; }

  showToast(`Importando ${pendentes.length} processo(s)...`);
  let ok = 0, erros = 0;

  for (const doc of pendentes) {
    const numero = doc.processos[0];
    if (dbNums.has(numero)) continue; // skip se chegou ao DB entre iterações
    try {
      const { error } = await _supabase.from('processos').insert({
        user_id:         window._escritorioId || window._user?.id,
        numero,
        nome:            [doc.nomeClasse, doc.tipoDecisao].filter(Boolean).join(' · ') || doc.tipoComunicacao || 'Publicação DJEN',
        tribunal:        doc.siglaTribunal || '',
        cliente:         doc.partes?.cliente   || null,
        parte_contraria: doc.partes?.contrario || null,
        area:            _detectarArea(doc.siglaTribunal, doc.nomeClasse),
        classe:          doc.nomeClasse  || null,
        orgao_julgador:  doc.nomeOrgao   || null,
        movimentos_recentes: [{
          data: (doc.data_disponibilizacao || '') + 'T00:00:00',
          nome: `DJEN — ${doc.tipoComunicacao || 'Publicação'}${doc.tipoDecisao ? ' · ' + doc.tipoDecisao : ''}`,
        }],
      });
      if (error) { erros++; }
      else {
        ok++;
        dbNums.add(numero);        // evita re-inserir no próximo click
        doc.matches = [{ numero }]; // evita re-importar sem precisar recarregar resultados
      }
    } catch (_) { erros++; }
  }

  await carregarProcessos();
  // Atualiza matches em _djeResultados com base no DB já atualizado
  const novosNums = new Set((window._processosDB || []).map(p => p.numero));
  (window._djeResultados || []).forEach(d => {
    if (!d.matches?.length && d.processos[0] && novosNums.has(d.processos[0])) {
      d.matches = [{ numero: d.processos[0] }];
    }
  });
  // Enriquece processos recém-importados com timeline do DataJud em background
  for (const doc of pendentes) {
    if (doc.processos[0]) _enriquecerComDatajud(doc.processos[0]);
  }
  showToast(`${ok} importado(s)${erros ? ` · ${erros} com falha` : ''}.`, ok > 0 ? 'success' : undefined);
}

async function rodarScraperPJe() {
  const numero = document.getElementById('pje-numero')?.value.trim();
  if (!numero) { showToast('Informe o número do processo.'); return; }

  const wrap  = document.getElementById('pje-resultado');
  const title = document.getElementById('pje-resultado-titulo');
  const tbody = document.getElementById('pje-tabela-body');

  title.textContent = 'Buscando andamentos…';
  tbody.innerHTML   = '';
  wrap.style.display = 'block';

  try {
    const res  = await fetch(`${PYTHON_API}/pje`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ numero_processo: numero }),
      signal:  AbortSignal.timeout(60000),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || 'Erro no servidor');

    const movs = data.movimentacoes || [];
    const partes = data.partes || [];
    title.textContent = `${movs.length} andamento(s) · ${partes.length} parte(s)`;

    if (!movs.length) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;padding:16px;color:var(--gray-400);font-size:12px">Nenhum andamento encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = movs.map(h => `
      <tr style="border-bottom:1px solid var(--gray-100)">
        <td style="padding:7px 10px;color:var(--gray-500);white-space:nowrap;font-size:11px">${h.data}</td>
        <td style="padding:7px 10px;color:var(--navy);font-size:12px">${h.andamento}</td>
      </tr>`).join('');

  } catch (e) {
    title.textContent = '';
    tbody.innerHTML = `<tr><td colspan="2" style="color:var(--red);font-size:12px;padding:10px">
      ❌ ${e.message.includes('fetch') ? 'Servidor Python não está rodando em localhost:8000' : e.message}
    </td></tr>`;
  }
}

// ── MÁSCARAS DE INPUT ─────────────────────────────────────────────────────────

function maskCpfCnpj(el) {
  const pos = el.selectionStart;
  const prev = el.value.length;
  let v = el.value.replace(/\D/g, '').substring(0, 14);
  if (v.length <= 11) {
    // CPF: 000.000.000-00
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  } else {
    // CNPJ: 00.000.000/0000-00
    v = v.replace(/(\d{2})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1/$2');
    v = v.replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }
  el.value = v;
  const diff = el.value.length - prev;
  el.setSelectionRange(pos + diff, pos + diff);
}

function maskTelefone(el) {
  const pos = el.selectionStart;
  const prev = el.value.length;
  let v = el.value.replace(/\D/g, '').substring(0, 11);
  if (v.length <= 10) {
    // Fixo: (00) 0000-0000
    v = v.replace(/(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  } else {
    // Celular: (00) 9 0000-0000
    v = v.replace(/(\d{2})(\d)/, '($1) $2');
    v = v.replace(/(\d{1})(\d{4})(\d{1,4})$/, '$1 $2-$3');
  }
  el.value = v;
  const diff = el.value.length - prev;
  el.setSelectionRange(pos + diff, pos + diff);
}

// ── CLIENTES ──────────────────────────────────────────────────────────────────

async function carregarClientes() {
  const uid = window._escritorioId || window._user?.id;
  if (!uid) return;
  const { data } = await _supabase
    .from('clientes')
    .select('*')
    .order('nome');
  _clientesDB = data || [];
  _renderClientes(_clientesDB);
  _popularSelectsClientes();
}

function _renderClientes(lista) {
  const grid  = document.getElementById('clientes-grid');
  const empty = document.getElementById('clientes-empty');
  if (!grid) return;
  grid.querySelectorAll('.cliente-card').forEach(c => c.remove());

  const sub = document.getElementById('clientes-sub');
  if (sub) sub.textContent = `${lista.length} cliente${lista.length !== 1 ? 's' : ''} cadastrado${lista.length !== 1 ? 's' : ''}`;

  if (!lista.length) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';

  lista.forEach(cli => {
    const iniciais = cli.nome.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const honorsCli = _honorariosDB.filter(h => h.cliente_id === cli.id);
    const procsCli  = [...new Set(honorsCli.map(h => h.processo_id).filter(Boolean))];
    const vencidos  = honorsCli.filter(h => h.status === 'vencido').length;

    const card = document.createElement('div');
    card.className = 'cliente-card';
    card.dataset.id = cli.id;
    card.innerHTML = `
      <div class="cliente-card-header">
        <div class="cliente-avatar">${iniciais}</div>
        <div style="min-width:0">
          <div class="cliente-nome">${cli.nome}</div>
          <div class="cliente-doc">${cli.cpf_cnpj || '—'}</div>
        </div>
      </div>
      <div class="cliente-card-info">
        ${cli.email    ? `<div class="cliente-info-row"><i class="ti ti-mail"></i>${cli.email}</div>` : ''}
        ${cli.telefone ? `<div class="cliente-info-row"><i class="ti ti-phone"></i>${cli.telefone}</div>` : ''}
      </div>
      <div class="cliente-card-footer">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${procsCli.length   ? `<span class="cliente-pill processos"><i class="ti ti-briefcase"></i>${procsCli.length} processo${procsCli.length>1?'s':''}</span>` : ''}
          ${honorsCli.length  ? `<span class="cliente-pill honorarios"><i class="ti ti-cash"></i>${honorsCli.length} honorário${honorsCli.length>1?'s':''}</span>` : ''}
          ${vencidos          ? `<span class="cliente-pill vencidos"><i class="ti ti-alert-circle"></i>${vencidos} vencido${vencidos>1?'s':''}</span>` : ''}
        </div>
        <button class="cliente-edit-btn" title="Editar cliente" onclick="event.stopPropagation();abrirEditarCliente('${cli.id}')">
          <i class="ti ti-pencil"></i>
        </button>
      </div>`;
    card.addEventListener('click', () => abrirDetalheCliente(cli.id));
    grid.insertBefore(card, empty);
  });
}

function filtrarClientes(q) {
  const t = (q || '').toLowerCase();
  const filtrado = t
    ? _clientesDB.filter(c =>
        c.nome.toLowerCase().includes(t) ||
        (c.cpf_cnpj || '').toLowerCase().includes(t) ||
        (c.email    || '').toLowerCase().includes(t))
    : _clientesDB;
  _renderClientes(filtrado);
}

async function salvarCliente() {
  const nome = document.getElementById('cli-nome').value.trim();
  if (!nome) { showToast('Informe o nome do cliente.', 'error'); return; }
  const btn = document.getElementById('cli-save-btn');
  btn.disabled = true;
  const uid = window._escritorioId || window._user?.id;
  const { error } = await _supabase.from('clientes').insert({
    user_id:   uid,
    nome,
    cpf_cnpj:  document.getElementById('cli-cpf').value.trim()     || null,
    email:     document.getElementById('cli-email').value.trim()    || null,
    telefone:  document.getElementById('cli-telefone').value.trim() || null,
    endereco:  document.getElementById('cli-endereco').value.trim() || null,
    observacoes: document.getElementById('cli-obs').value.trim()    || null,
  });
  btn.disabled = false;
  if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return; }
  showToast('Cliente salvo com sucesso!', 'success');
  closeModal('modal-novo-cliente');
  ['cli-nome','cli-cpf','cli-email','cli-telefone','cli-endereco','cli-obs'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  await carregarClientes();
}

function abrirEditarCliente(id) {
  const cli = _clientesDB.find(c => c.id === id);
  if (!cli) return;
  document.getElementById('cli-edit-id').value       = cli.id;
  document.getElementById('cli-edit-nome').value     = cli.nome || '';
  document.getElementById('cli-edit-email').value    = cli.email || '';
  document.getElementById('cli-edit-endereco').value = cli.endereco || '';
  document.getElementById('cli-edit-obs').value      = cli.observacoes || '';
  // Popula e formata CPF/CNPJ e telefone
  const cpfEl = document.getElementById('cli-edit-cpf');
  cpfEl.value = cli.cpf_cnpj || '';
  if (cpfEl.value) maskCpfCnpj(cpfEl);
  const telEl = document.getElementById('cli-edit-telefone');
  telEl.value = cli.telefone || '';
  if (telEl.value) maskTelefone(telEl);
  openModal('modal-editar-cliente');
}

async function atualizarCliente() {
  const id   = document.getElementById('cli-edit-id').value;
  const nome = document.getElementById('cli-edit-nome').value.trim();
  if (!nome) { showToast('Informe o nome.', 'error'); return; }
  const { error } = await _supabase.from('clientes').update({
    nome,
    cpf_cnpj:    document.getElementById('cli-edit-cpf').value.trim()      || null,
    email:       document.getElementById('cli-edit-email').value.trim()     || null,
    telefone:    document.getElementById('cli-edit-telefone').value.trim()  || null,
    endereco:    document.getElementById('cli-edit-endereco').value.trim()  || null,
    observacoes: document.getElementById('cli-edit-obs').value.trim()       || null,
  }).eq('id', id);
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Cliente atualizado!', 'success');
  closeModal('modal-editar-cliente');
  await carregarClientes();
}

async function excluirCliente(id) {
  if (!confirm('Excluir este cliente? Os honorários vinculados perderão a referência.')) return;
  await _supabase.from('clientes').delete().eq('id', id);
  showToast('Cliente removido.', 'success');
  closeModal('modal-editar-cliente');
  await carregarClientes();
}

function abrirDetalheCliente(id) {
  // Atalho: abre honorários filtrado pelo cliente
  showPage('honorarios');
  const sel = document.getElementById('hon-filtro-status');
  if (sel) sel.value = '';
  window._honFiltroCliente = id;
  filtrarHonorarios();
}

// ── HONORÁRIOS ────────────────────────────────────────────────────────────────

const _HON_VIS_KEY = 'hon_valores_ocultos';

function _aplicarVisHonorarios() {
  const oculto = localStorage.getItem(_HON_VIS_KEY) === '1';
  const page   = document.getElementById('page-honorarios');
  const icon   = document.getElementById('hon-vis-icon');
  const label  = document.getElementById('hon-vis-label');
  if (!page) return;
  if (oculto) {
    page.classList.add('hon-oculto');
    if (icon)  { icon.className  = 'ti ti-eye-off'; }
    if (label) { label.textContent = 'Mostrar'; }
  } else {
    page.classList.remove('hon-oculto');
    if (icon)  { icon.className  = 'ti ti-eye'; }
    if (label) { label.textContent = 'Ocultar'; }
  }
}

function toggleHonVisibilidade() {
  const oculto = localStorage.getItem(_HON_VIS_KEY) === '1';
  localStorage.setItem(_HON_VIS_KEY, oculto ? '0' : '1');
  _aplicarVisHonorarios();
}

async function carregarHonorarios() {
  const uid = window._escritorioId || window._user?.id;
  if (!uid) return;
  const { data } = await _supabase
    .from('honorarios')
    .select('*, clientes(nome)')
    .order('data_vencimento', { ascending: true });
  _honorariosDB = (data || []).map(h => ({
    ...h,
    cliente_nome: h.clientes?.nome || null,
  }));
  _atualizarVencidos();
  _renderHonorarios(_honorariosDB);
  _atualizarKpisHon();
  _atualizarBadgeHon();
  _popularSelectsClientes();
  _popularSelectsProcessos();
  atualizarPrazosDash();
}

function _atualizarVencidos() {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  _honorariosDB.forEach(h => {
    if (h.status === 'pendente' && h.data_vencimento) {
      const d = new Date(h.data_vencimento + 'T00:00:00');
      if (d < hoje) h.status = 'vencido';
    }
  });
}

function _statusGrupo(h) {
  if (h.status === 'pago')     return 'pago';
  if (h.status === 'cancelado') return 'cancelado';
  if (h.status === 'vencido')  return 'vencido';
  if (!h.data_vencimento)      return 'pendente';
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const d    = new Date(h.data_vencimento + 'T00:00:00');
  const diff = Math.floor((d - hoje) / 86400000);
  if (diff <= 7 && diff >= 0) return 'semana';
  return 'pendente';
}

function _renderHonorarios(lista) {
  const container = document.getElementById('honorarios-lista');
  const empty     = document.getElementById('honorarios-empty');
  if (!container) return;
  container.querySelectorAll('.hon-grupo,.hon-card').forEach(el => el.remove());

  if (!lista.length) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';

  const grupos = { vencido:[], semana:[], pendente:[], pago:[], cancelado:[] };
  lista.forEach(h => grupos[_statusGrupo(h)].push(h));

  const labels = {
    vencido:   { icon:'ti-alert-circle', label:'Vencidos' },
    semana:    { icon:'ti-clock',        label:'Vencem esta semana' },
    pendente:  { icon:'ti-coin',         label:'Pendentes' },
    pago:      { icon:'ti-circle-check', label:'Pagos' },
    cancelado: { icon:'ti-ban',          label:'Cancelados' },
  };

  ['vencido','semana','pendente','pago','cancelado'].forEach(g => {
    if (!grupos[g].length) return;
    const titulo = document.createElement('div');
    titulo.className = `hon-grupo-titulo ${g} hon-grupo`;
    titulo.innerHTML = `<i class="ti ${labels[g].icon}"></i>${labels[g].label} (${grupos[g].length})`;
    container.insertBefore(titulo, empty);

    grupos[g].forEach(h => {
      const card = _buildHonCard(h, g);
      container.insertBefore(card, empty);
    });
  });
}

function _buildHonCard(h, grupo) {
  const card = document.createElement('div');
  card.className = `hon-card ${grupo}`;
  card.dataset.id = h.id;

  const tipoIcone = { fixo:'ti-file-dollar', exito:'ti-trophy', hora:'ti-clock-hour-4', recorrente:'ti-refresh' };
  const tipoLabel = { fixo:'Fixo', exito:'Êxito', hora:'Hora', recorrente:'Recorrente' };

  const vencStr  = h.data_vencimento ? _fmtData(h.data_vencimento) : '—';
  const procLabel = h.processo_id
    ? (window._processosDB||[]).find(p => p.id === h.processo_id)?.apelido
      || (window._processosDB||[]).find(p => p.id === h.processo_id)?.nome
      || 'Processo vinculado'
    : null;

  const pagar = (grupo === 'vencido' || grupo === 'semana' || grupo === 'pendente')
    ? `<button class="hon-pagar-btn" onclick="event.stopPropagation();marcarPago('${h.id}')">
        <i class="ti ti-check"></i> Marcar como pago
       </button>`
    : '';

  // Badge de status só para pago/cancelado — pendentes já estão identificados pelo grupo
  const statusBadge = (grupo === 'pago' || grupo === 'cancelado')
    ? `<span class="hon-status-badge ${grupo}">${_statusLabel(h.status)}</span>`
    : '';

  card.innerHTML = `
    <div class="hon-card-icon"><i class="ti ${tipoIcone[h.tipo] || 'ti-cash'}"></i></div>
    <div class="hon-card-body">
      <div class="hon-card-desc">${h.descricao}</div>
      <div class="hon-card-meta">
        ${h.cliente_nome ? `<span class="hon-meta-item"><i class="ti ti-user"></i>${h.cliente_nome}</span>` : ''}
        ${procLabel      ? `<span class="hon-meta-item"><i class="ti ti-briefcase"></i>${procLabel}</span>` : ''}
        <span class="hon-meta-item"><i class="ti ti-calendar"></i>${vencStr}</span>
        <span class="hon-tipo-badge">${tipoLabel[h.tipo] || h.tipo}</span>
      </div>
    </div>
    <div class="hon-card-right">
      <div class="hon-valor">R$ ${_fmtValor(h.valor)}</div>
      ${statusBadge}
      ${pagar}
    </div>`;
  card.addEventListener('click', () => abrirEditarHonorario(h.id));
  return card;
}

function _statusLabel(s) {
  return { pendente:'Pendente', pago:'Pago', vencido:'Vencido', cancelado:'Cancelado' }[s] || s;
}

function _fmtValor(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function _fmtData(d) {
  if (!d) return '—';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function _atualizarKpisHon() {
  const agora = new Date(); agora.setHours(0,0,0,0);
  const mesAtual = agora.getMonth(); const anoAtual = agora.getFullYear();
  let receber = 0, mesPago = 0, vencidos = 0;
  _honorariosDB.forEach(h => {
    if (h.status === 'pago') {
      const d = h.data_pagamento ? new Date(h.data_pagamento + 'T00:00:00') : null;
      if (d && d.getMonth() === mesAtual && d.getFullYear() === anoAtual) mesPago += Number(h.valor);
    } else if (h.status === 'vencido') {
      vencidos += Number(h.valor);
      receber  += Number(h.valor);
    } else if (h.status === 'pendente') {
      receber += Number(h.valor);
    }
  });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = 'R$ ' + _fmtValor(v); };
  set('hon-val-receber', receber);
  set('hon-val-mes',     mesPago);
  set('hon-val-venc',    vencidos);
}

function _atualizarBadgeHon() {
  const venc = _honorariosDB.filter(h => h.status === 'vencido').length;
  const badge = document.getElementById('badge-honorarios-venc');
  if (badge) { badge.textContent = venc; badge.style.display = venc ? '' : 'none'; }
}

function filtrarHonorarios() {
  const q     = (document.getElementById('hon-search')?.value || '').toLowerCase();
  const st    = document.getElementById('hon-filtro-status')?.value || '';
  const tipo  = document.getElementById('hon-filtro-tipo')?.value   || '';
  const cliId = window._honFiltroCliente || '';

  const lista = _honorariosDB.filter(h => {
    if (st   && h.status !== st)   return false;
    if (tipo && h.tipo   !== tipo) return false;
    if (cliId && h.cliente_id !== cliId) return false;
    if (q) {
      const proc = (window._processosDB||[]).find(p => p.id === h.processo_id);
      const procNome = proc?.apelido || proc?.nome || '';
      return (
        h.descricao.toLowerCase().includes(q) ||
        (h.cliente_nome || '').toLowerCase().includes(q) ||
        procNome.toLowerCase().includes(q)
      );
    }
    return true;
  });
  _renderHonorarios(lista);
}

async function marcarPago(id) {
  const hoje = new Date().toISOString().split('T')[0];
  const { error } = await _supabase.from('honorarios').update({
    status: 'pago', data_pagamento: hoje
  }).eq('id', id);
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Honorário marcado como pago!', 'success');
  await carregarHonorarios();
}

function honSetCobranca(tipo) {
  document.getElementById('hon-cobranca-tipo').value = tipo;
  ['avista','parcelado','recorrente'].forEach(t => {
    document.getElementById('hon-pill-' + t)?.classList.toggle('active', t === tipo);
  });
  document.getElementById('hon-avista-box').style.display    = tipo === 'avista'     ? ''     : 'none';
  const pb = document.getElementById('hon-parcelado-box');
  if (pb) pb.style.display  = tipo === 'parcelado'  ? 'flex' : 'none';
  const rb = document.getElementById('hon-recorr-box');
  if (rb) rb.style.display  = tipo === 'recorrente' ? 'flex' : 'none';
  honCalcParcela();
}

function honCalcParcela() {
  const valor = parseFloat(document.getElementById('hon-valor')?.value) || 0;
  const qtd   = parseInt(document.getElementById('hon-parcelas-qtd')?.value) || 1;
  const label = document.getElementById('hon-parcela-valor');
  if (label) label.textContent = valor > 0 ? 'R$ ' + _fmtValor(valor / qtd) : 'R$ —';
}

function honSetCobrancaEdit(tipo) {
  document.getElementById('hon-edit-cobranca-tipo').value = tipo;
  ['avista','parcelado','recorrente'].forEach(t => {
    document.getElementById('hon-epill-' + t)?.classList.toggle('active', t === tipo);
  });
  document.getElementById('hon-edit-avista-box').style.display    = tipo === 'avista'     ? ''     : 'none';
  const pb = document.getElementById('hon-edit-parcelado-box');
  if (pb) pb.style.display  = tipo === 'parcelado'  ? 'flex' : 'none';
  const rb = document.getElementById('hon-edit-recorr-box');
  if (rb) rb.style.display  = tipo === 'recorrente' ? 'flex' : 'none';
  honEditCalcParcela();
}

function honEditCalcParcela() {
  const valor = parseFloat(document.getElementById('hon-edit-valor')?.value) || 0;
  const qtd   = parseInt(document.getElementById('hon-edit-parcelas-qtd')?.value) || 1;
  const label = document.getElementById('hon-edit-parcela-valor');
  if (label) label.textContent = valor > 0 ? 'R$ ' + _fmtValor(valor / qtd) : 'R$ —';
}

function _popularSelectsClientes() {
  ['hon-cliente','hon-edit-cliente'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Sem cliente vinculado —</option>';
    _clientesDB.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.nome;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
}

function _popularSelectsProcessos() {
  ['hon-processo','hon-edit-processo'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Sem processo vinculado —</option>';
    (window._processosDB || []).filter(p => !p.arquivado).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.apelido || p.nome || '').substring(0, 60);
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
}

async function salvarHonorario() {
  const desc = document.getElementById('hon-desc').value.trim();
  if (!desc) { showToast('Informe a descrição.', 'error'); return; }
  const valor = parseFloat(document.getElementById('hon-valor').value);
  if (!valor || valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }
  const btn = document.getElementById('hon-save-btn');
  btn.disabled = true;

  const uid      = window._escritorioId || window._user?.id;
  const tipo     = document.getElementById('hon-tipo').value;
  const cobranca = document.getElementById('hon-cobranca-tipo')?.value || 'avista';
  const isParc   = cobranca === 'parcelado';
  const isRecorr = cobranca === 'recorrente';
  const parcelasQtd = isParc ? (parseInt(document.getElementById('hon-parcelas-qtd')?.value) || null) : null;
  const numCobr     = isRecorr ? (parseInt(document.getElementById('hon-parcelas')?.value) || null) : null;

  const dataVenc = isParc
    ? (document.getElementById('hon-parcela-inicio')?.value || null)
    : isRecorr
      ? (document.getElementById('hon-recorr-inicio')?.value || null)
      : (document.getElementById('hon-venc')?.value || null);

  const payload = {
    user_id:        uid,
    descricao:      desc,
    cliente_id:     document.getElementById('hon-cliente').value  || null,
    processo_id:    document.getElementById('hon-processo').value || null,
    tipo:           isRecorr ? 'recorrente' : tipo,
    valor,
    status:         'pendente',
    data_vencimento: dataVenc || null,
    recorrente:     isRecorr,
    periodicidade:  isRecorr ? (document.getElementById('hon-period')?.value || null) : null,
    parcelas_total: isParc ? parcelasQtd : numCobr,
    parcela_atual:  isParc ? 1 : null,
    notas:          document.getElementById('hon-notas').value.trim() || null,
  };

  const { error } = await _supabase.from('honorarios').insert(payload);
  btn.disabled = false;
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Honorário salvo!', 'success');
  closeModal('modal-novo-honorario');
  ['hon-desc','hon-valor','hon-notas'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  honSetCobranca('avista');
  await carregarHonorarios();
}

function honEditSetStatus(status) {
  document.getElementById('hon-edit-status').value = status;
  const cls = { pendente:'active', vencido:'active-vencido', pago:'active-pago', cancelado:'active-cancelado' };
  ['pendente','vencido','pago','cancelado'].forEach(s => {
    const pill = document.getElementById('hon-epill-' + s);
    if (!pill) return;
    pill.className = 'hon-pill' + (s === status ? ' ' + cls[s] : '');
  });
  const wrap = document.getElementById('hon-pgto-wrap');
  const pgto = document.getElementById('hon-edit-pgto');
  if (wrap) wrap.style.display = status === 'pago' ? '' : 'none';
  if (status === 'pago' && pgto && !pgto.value) {
    pgto.value = new Date().toISOString().slice(0, 10);
  }
}

function abrirEditarHonorario(id) {
  const h = _honorariosDB.find(x => x.id === id);
  if (!h) return;

  document.getElementById('hon-edit-id').value    = h.id;
  document.getElementById('hon-edit-desc').value  = h.descricao || '';
  document.getElementById('hon-edit-valor').value = h.valor || '';
  document.getElementById('hon-edit-notas').value = h.notas || '';

  const tipoEl = document.getElementById('hon-edit-tipo');
  if (tipoEl) tipoEl.value = h.tipo || 'fixo';

  // Detecta forma de cobrança a partir dos dados salvos
  let cobranca = 'avista';
  if (h.recorrente || h.tipo === 'recorrente') cobranca = 'recorrente';
  else if (h.parcelas_total > 1) cobranca = 'parcelado';
  honSetCobrancaEdit(cobranca);

  // Preenche campos da cobrança
  document.getElementById('hon-edit-venc').value           = h.data_vencimento || '';
  document.getElementById('hon-edit-parcela-inicio').value = h.data_vencimento || '';
  document.getElementById('hon-edit-recorr-inicio').value  = h.data_vencimento || '';
  if (h.parcelas_total) {
    const qtdEl = document.getElementById('hon-edit-parcelas-qtd');
    if (qtdEl) qtdEl.value = h.parcelas_total;
    const parcEl = document.getElementById('hon-edit-parcelas');
    if (parcEl) parcEl.value = h.parcelas_total;
  }
  if (h.periodicidade) {
    const pdEl = document.getElementById('hon-edit-period');
    if (pdEl) pdEl.value = h.periodicidade;
  }

  // Status via pills
  honEditSetStatus(h.status || 'pendente');
  document.getElementById('hon-edit-pgto').value = h.data_pagamento || '';

  _popularSelectsClientes();
  _popularSelectsProcessos();
  setTimeout(() => {
    document.getElementById('hon-edit-cliente').value  = h.cliente_id  || '';
    document.getElementById('hon-edit-processo').value = h.processo_id || '';
  }, 50);

  honEditCalcParcela();
  openModal('modal-editar-honorario');
}

async function atualizarHonorario() {
  const id   = document.getElementById('hon-edit-id').value;
  const desc = document.getElementById('hon-edit-desc').value.trim();
  if (!desc) { showToast('Informe a descrição.', 'error'); return; }
  const valor = parseFloat(document.getElementById('hon-edit-valor').value);
  if (!valor || valor <= 0) { showToast('Informe um valor válido.', 'error'); return; }

  const cobranca    = document.getElementById('hon-edit-cobranca-tipo')?.value || 'avista';
  const isParc      = cobranca === 'parcelado';
  const isRecorr    = cobranca === 'recorrente';
  const parcelasQtd = isParc ? (parseInt(document.getElementById('hon-edit-parcelas-qtd')?.value) || null) : null;
  const numCobr     = isRecorr ? (parseInt(document.getElementById('hon-edit-parcelas')?.value) || null) : null;

  const dataVenc = isParc
    ? (document.getElementById('hon-edit-parcela-inicio')?.value || null)
    : isRecorr
      ? (document.getElementById('hon-edit-recorr-inicio')?.value || null)
      : (document.getElementById('hon-edit-venc')?.value || null);

  const { error } = await _supabase.from('honorarios').update({
    descricao:       desc,
    cliente_id:      document.getElementById('hon-edit-cliente').value  || null,
    processo_id:     document.getElementById('hon-edit-processo').value || null,
    tipo:            document.getElementById('hon-edit-tipo').value,
    valor,
    status:          document.getElementById('hon-edit-status').value,
    data_vencimento: dataVenc || null,
    data_pagamento:  document.getElementById('hon-edit-pgto').value || null,
    recorrente:      isRecorr,
    periodicidade:   isRecorr ? (document.getElementById('hon-edit-period')?.value || null) : null,
    parcelas_total:  isParc ? parcelasQtd : numCobr,
    notas:           document.getElementById('hon-edit-notas').value.trim() || null,
  }).eq('id', id);
  if (error) { showToast('Erro: ' + error.message, 'error'); return; }
  showToast('Honorário atualizado!', 'success');
  closeModal('modal-editar-honorario');
  await carregarHonorarios();
}

async function excluirHonorario(id) {
  if (!confirm('Excluir este honorário? Essa ação não pode ser desfeita.')) return;
  await _supabase.from('honorarios').delete().eq('id', id);
  showToast('Honorário removido.', 'success');
  closeModal('modal-editar-honorario');
  await carregarHonorarios();
}
