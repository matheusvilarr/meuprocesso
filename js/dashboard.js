// Navigation
const pages = {
  'dashboard': 'Dashboard',
  'processos': 'Meus Processos',
  'processo-detalhe': 'Detalhe do Processo',
  'calendario': 'Calendário',
  'tarefas': 'Tarefas',
  'colaboradores': 'Colaboradores'
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
  if (id === 'calendario') buildFullCal();
  if (id === 'arquivados') carregarArquivados();
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
}

// Modal
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}

// Toast
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Mini Calendar
let miniCalDate = new Date(2025, 5, 1);
const eventDays = { 10: 'prazo', 13: 'prazo', 15: 'audiencia', 18: 'reuniao', 20: 'lembrete' };

function buildMiniCal() {
  const grid = document.getElementById('mini-cal-grid');
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  document.getElementById('mini-cal-month').textContent = monthNames[miniCalDate.getMonth()] + ' ' + miniCalDate.getFullYear();

  const days = ['D','S','T','Q','Q','S','S'];
  let html = days.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  const first = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth(), 1);
  const last  = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth() + 1, 0);
  const today = new Date();

  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(first);
    d.setDate(d.getDate() - (first.getDay() - i));
    html += `<div class="cal-day other-month">${d.getDate()}</div>`;
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const isToday = miniCalDate.getFullYear() === today.getFullYear() &&
                    miniCalDate.getMonth() === today.getMonth() && d === today.getDate();
    const hasEvent = eventDays[d];
    html += `<div class="cal-day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''}" onclick="showPage('calendario')">${d}</div>`;
  }

  grid.innerHTML = html;
}

function changeCalMonth(dir) {
  miniCalDate.setMonth(miniCalDate.getMonth() + dir);
  buildMiniCal();
}

// Full Calendar
let fullCalDate = new Date(2025, 5, 1);

const fullEvents = {
  10: [{ text: 'Contestação — Rodrigues', cls: 'event-prazo' }],
  13: [{ text: 'Recurso — Marques',       cls: 'event-prazo' }],
  15: [{ text: 'Audiência 14h — Ana Paula', cls: 'event-audiencia' }],
  18: [{ text: 'Reunião — Inventário',    cls: 'event-reuniao' }],
  20: [{ text: 'Manifestação — Tech',     cls: 'event-lembrete' }],
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

  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(first);
    d.setDate(d.getDate() - (first.getDay() - i));
    html += `<div class="fcal-day other-month"><div class="fcal-day-num">${d.getDate()}</div></div>`;
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const isToday = fullCalDate.getFullYear() === today.getFullYear() &&
                    fullCalDate.getMonth() === today.getMonth() && d === today.getDate();
    const events = fullEvents[d] || [];
    const evHtml = events.map(e => `<div class="fcal-event ${e.cls}">${e.text}</div>`).join('');
    html += `<div class="fcal-day ${isToday ? 'today' : ''}"><div class="fcal-day-num">${d}</div>${evHtml}</div>`;
  }

  grid.innerHTML = html;
}

function changeFCalMonth(dir) {
  fullCalDate.setMonth(fullCalDate.getMonth() + dir);
  buildFullCal();
}

// Init
buildMiniCal();

// ── BUSCA DATAJUD ──────────────────────────────────────────────────────

let _tipoBusca = 'numero';

const BUSCA_CONFIG = {
  numero:   { label: 'Número do processo (CNJ)', placeholder: '0000000-00.0000.0.00.0000', hint: 'O tribunal é detectado automaticamente pelo número.', tribunal: false, uf: false, restrito: false },
  oab:      { label: 'Número da OAB',            placeholder: 'Ex: 123456',               hint: '',  tribunal: true,  uf: true,  restrito: true },
  advogado: { label: 'Nome do advogado',          placeholder: 'Ex: João Silva',            hint: '',  tribunal: true,  uf: false, restrito: true },
  cliente:  { label: 'Nome do cliente / parte',   placeholder: 'Ex: Empresa XYZ Ltda',     hint: '',  tribunal: true,  uf: false, restrito: true },
  cpf:      { label: 'CPF ou CNPJ',              placeholder: 'Somente números',           hint: '',  tribunal: true,  uf: false, restrito: true },
};

function selecionarTipoBusca(tipo, btn) {
  _tipoBusca = tipo;
  document.querySelectorAll('.busca-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const cfg = BUSCA_CONFIG[tipo];
  document.getElementById('busca-label').textContent       = cfg.label;
  document.getElementById('busca-input').placeholder       = cfg.placeholder;
  document.getElementById('busca-hint').textContent        = cfg.hint;
  document.getElementById('busca-tribunal-wrap').style.display  = cfg.tribunal ? 'block' : 'none';
  document.getElementById('busca-oab-uf-wrap').style.display    = cfg.uf      ? 'block' : 'none';
  document.getElementById('busca-input').value = '';

  const avisoEl = document.getElementById('busca-aviso-restrito');
  const inputArea = document.getElementById('busca-input-area');
  if (cfg.restrito) {
    avisoEl.style.display  = 'block';
    inputArea.style.display = 'none';
  } else {
    avisoEl.style.display  = 'none';
    inputArea.style.display = 'block';
  }
  limparResultadoBusca();
}

async function buscarProcesso() {
  const input    = document.getElementById('busca-input').value.trim();
  const btn      = document.getElementById('busca-btn');
  const tribunal = document.getElementById('busca-tribunal-select').value;
  const uf       = document.getElementById('busca-oab-uf-select').value;

  limparResultadoBusca();

  if (!input) { mostrarErroBusca('Preencha o campo de busca.'); return; }

  // Monta a URL
  let url;
  if (_tipoBusca === 'numero') {
    url = `/api/buscar-processo?tipo=numero&numero=${encodeURIComponent(input)}`;
  } else {
    if (!tribunal) { mostrarErroBusca('Selecione o tribunal.'); return; }
    if (_tipoBusca === 'oab' && !uf) { mostrarErroBusca('Selecione a UF da OAB.'); return; }
    url = `/api/buscar-processo?tipo=${_tipoBusca}&q=${encodeURIComponent(input)}&tribunal=${tribunal}`;
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

function exibirResultados(lista) {
  const wrap = document.getElementById('busca-resultados-wrap');
  wrap.style.display = 'flex';

  if (!lista.length) { mostrarErroBusca('Nenhum processo encontrado.'); wrap.style.display = 'none'; return; }

  const fmt = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

  wrap.innerHTML = lista.map((d, i) => `
    <div class="busca-result-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--navy)">${d.numero || '—'}</div>
          <div style="font-size:12px;color:var(--gray-500);margin-top:2px">${d.classe || ''}</div>
        </div>
        <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#e8edf5;color:var(--navy);white-space:nowrap;flex-shrink:0">${d.tribunal || ''}</span>
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
        onclick="adicionarProcesso(${i})">
        <i class="ti ti-cloud-download"></i> Importar e monitorar
      </button>
    </div>`).join('');

  // Guarda lista para uso em adicionarProcesso
  window._buscaResultados = lista;
}

function adicionarProcesso(i) {
  const d = (window._buscaResultados || [])[i];
  if (!d) return;

  closeModal('modal-busca-tribunal');
  openModal('modal-novo-processo');

  setTimeout(() => {
    document.getElementById('np-numero').value         = d.numero        || '';
    document.getElementById('np-nome').value           = d.classe        || '';
    document.getElementById('np-tribunal').value       = d.tribunal      || '';
    document.getElementById('np-datajud-index').value    = d._datajudIndex  || '';
    document.getElementById('np-classe').value           = d.classe         || '';
    document.getElementById('np-orgao-julgador').value   = d.orgaoJulgador  || '';
    document.getElementById('np-data-ajuizamento').value = d.dataAjuizamento|| '';
    // guarda movimentos para salvar junto ao processo
    window._importMovimentos = d.movimentos || [];

    const clientePart = (d.partes || []).find(p => /autor|requerente|reclamante/i.test(p.tipo));
    if (clientePart) document.getElementById('np-cliente').value = clientePart.nome || '';

    showToast('Dados importados do DataJud CNJ');
  }, 100);
}

// ── SUPABASE: SALVAR PROCESSO ─────────────────────────────────────────────

async function salvarProcesso() {
  const btn = document.getElementById('btn-criar-processo');

  const numero  = document.getElementById('np-numero').value.trim();
  const nome    = document.getElementById('np-nome').value.trim();
  const cliente = document.getElementById('np-cliente').value.trim();

  if (!nome) { showToast('Preencha o nome / assunto do processo.'); return; }

  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  const payload = {
    user_id:         window._user?.id,
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

  const { data, error } = await _supabase
    .from('processos')
    .select('*')
    .neq('status', 'Arquivado')
    .order('created_at', { ascending: false });

  if (error || !data) return;

  // Atualiza badge de processos
  const badge = document.getElementById('badge-processos');
  if (badge) {
    badge.textContent    = data.length;
    badge.style.display  = data.length ? 'inline-flex' : 'none';
  }

  // Atualiza badge de arquivados
  const { count: countArq } = await _supabase
    .from('processos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'Arquivado');
  const badgeArq = document.getElementById('badge-arquivados');
  if (badgeArq) {
    badgeArq.textContent   = countArq || 0;
    badgeArq.style.display = countArq ? 'inline-flex' : 'none';
  }

  // Badge de notificações pendentes
  const comNotif = data.filter(p => p.notificacao_pendente);
  const bell     = document.getElementById('notif-bell');
  if (bell) {
    bell.style.color = comNotif.length
      ? 'var(--gold)'
      : 'rgba(255,255,255,0.3)';
    bell.title = comNotif.length
      ? `${comNotif.length} atualização(ões) nova(s)`
      : 'Sem novas notificações';
  }

  window._processosDB = data;
  renderizarListaProcessos(data);
  atualizarDashboard(data, countArq || 0);
}

function atualizarDashboard(processos, totalArquivados) {
  const ativos    = processos.length;
  const comNotif  = processos.filter(p => p.notificacao_pendente).length;
  const comSync   = processos.filter(p => p.datajud_index).length;

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
  set('stat-processos-sub', comSync > 0 ? `${comSync} sincronizado(s) com CNJ` : 'Nenhum sincronizado');

  set('stat-notificacoes', comNotif);
  const elNotiSub = document.getElementById('stat-notificacoes-sub');
  if (elNotiSub) {
    elNotiSub.textContent = comNotif > 0 ? `${comNotif} aguardando leitura` : 'Tudo em dia';
    elNotiSub.className   = `stat-change ${comNotif > 0 ? 'alert' : 'up'}`;
  }

  set('stat-arquivados', totalArquivados);

  set('stat-prazos', '—');
  set('stat-prazos-sub', 'Em breve');

  // Processos Recentes
  const wrap = document.getElementById('dash-processos-recentes');
  if (!wrap) return;

  if (!processos.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:30px;color:var(--gray-400);font-size:13px">
      <i class="ti ti-briefcase" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.3"></i>
      Nenhum processo cadastrado ainda
    </div>`;
    return;
  }

  const areaMap = { 'Cível':'civil','Trabalhista':'trabalhista','Criminal':'criminal','Tributário':'tributario','Família':'familia','Previdenciário':'previdenciario' };
  wrap.innerHTML = processos.slice(0, 5).map(p => `
    <div class="process-row" onclick="abrirProcesso('${p.id}')">
      <div class="process-num">${p.numero || '—'}</div>
      <div class="process-info">
        <div class="process-name">${p.apelido || p.nome}</div>
        <div class="process-meta">
          ${p.datajud_index
            ? `<i class="ti ti-cloud-check" style="font-size:10px;color:var(--green)"></i> CNJ DataJud`
            : `<i class="ti ti-pencil" style="font-size:10px"></i> Manual`
          }
          ${p.orgao_julgador ? ` · ${p.orgao_julgador}` : ''}
          ${p.notificacao_pendente ? ` · <span style="color:var(--amber);font-weight:600">Nova movimentação</span>` : ''}
        </div>
      </div>
      <span class="badge badge-${areaMap[p.area] || 'civil'}">${p.area || 'Cível'}</span>
    </div>`).join('');
}

function renderizarListaProcessos(lista) {
  const grid  = document.getElementById('lista-processos-db');
  const empty = document.getElementById('processos-empty');
  if (!grid) return;

  grid.querySelectorAll('.process-card[data-db]').forEach(el => el.remove());

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

  const cards = lista.map(p => {
    const temSync  = !!p.datajud_index;
    const temNotif = !!p.notificacao_pendente;

    const card = document.createElement('div');
    card.className = `process-card${temNotif ? ' pc-notif' : ''}`;
    card.setAttribute('data-db', p.id);
    card.onclick = () => abrirProcesso(p.id);

    card.innerHTML = `
      <div class="pc-top">
        <span class="pc-num">${p.numero || '—'}</span>
        <div style="display:flex;align-items:center;gap:5px">
          ${temSync ? `<span class="pc-sync-badge ${temNotif ? 'pc-sync-badge--notif' : ''}">
            <i class="ti ti-${temNotif ? 'bell-ringing' : 'cloud-check'}"></i>
            ${temNotif ? 'Atualizado' : 'CNJ DataJud'}
          </span>` : ''}
          <span class="pc-status status-${statusCls(p.status)}">${p.status || 'Ativo'}</span>
          <button class="btn-arquivar-card" title="Arquivar processo"
            onclick="pedirArquivar(event,'${p.id}','${(p.nome||'').replace(/'/g,'\\x27')}')">
            <i class="ti ti-archive"></i>
          </button>
        </div>
      </div>
      <div class="pc-title">${p.nome}</div>
      <div class="pc-client">
        <i class="ti ti-user" style="font-size:12px"></i>
        ${p.cliente || 'Cliente não informado'}
        ${p.classe ? `<span style="margin-left:6px;color:var(--gray-400)">· ${p.classe}</span>` : ''}
      </div>
      <div class="pc-meta">
        <span class="badge badge-${areaMap[p.area] || 'civil'}">${p.area || 'Cível'}</span>
        ${temSync ? `
          <button class="btn-atualizar-mini"
            onclick="verificarProcessoAgora(event,'${p.id}','${p.datajud_index}','${p.numero}')">
            <i class="ti ti-refresh"></i> Atualizar
          </button>` : ''}
      </div>
      ${temNotif && p.novos_movimentos?.length ? `
        <div class="pc-prazo" style="color:var(--amber);border-top-color:var(--amber-light)">
          <i class="ti ti-bell-ringing"></i>
          <span style="font-weight:600">${p.novos_movimentos[0].nome}</span>
        </div>` : `
        <div class="pc-prazo">
          ${temSync
            ? `<i class="ti ti-clock" style="font-size:13px"></i>
               Verificado ${fmtHora(p.ultima_verificacao)}`
            : `<i class="ti ti-clock" style="font-size:13px"></i> Cadastro manual`
          }
        </div>`
      }`;

    return card;
  });

  cards.forEach(c => grid.appendChild(c));
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

  _processoAtual = proc;

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
    const fmtH = iso => iso ? `· verificado ${fmtHora(iso)}` : '';
    syncBadge.style.display = 'inline-flex';
    syncBadge.className     = 'pc-sync-badge';
    syncBadge.innerHTML     = `<i class="ti ti-cloud-check"></i> CNJ DataJud ${fmtH(proc.ultima_verificacao)}`;
    syncBtn.style.display   = 'inline-flex';
  } else {
    syncBadge.style.display = 'none';
    syncBtn.style.display   = 'none';
  }

  // Apelido / título
  const display = document.getElementById('detalhe-apelido-display');
  display.textContent = proc.apelido || proc.nome || '—';

  // Número e órgão
  document.getElementById('detalhe-numero-orgao').textContent =
    [proc.numero, proc.orgao_julgador, proc.tribunal].filter(Boolean).join(' · ');

  // Grid de campos
  const fmt = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  document.getElementById('detalhe-grid').innerHTML = `
    <div class="detail-field"><label>Cliente</label><p>${proc.cliente || '—'}</p></div>
    <div class="detail-field"><label>Classe</label><p>${proc.classe || '—'}</p></div>
    <div class="detail-field"><label>Tribunal</label><p>${proc.tribunal || '—'}</p></div>
    <div class="detail-field"><label>Distribuído em</label><p>${fmt(proc.data_ajuizamento)}</p></div>`;

  // Timeline
  renderizarTimelineCNJ(proc);
}

function fmtHora(iso) {
  if (!iso) return 'nunca';
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000);
  if (h < 1)  return 'há menos de 1h';
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function renderizarTimelineCNJ(proc) {
  const wrap = document.getElementById('timeline-cnj-wrap');
  if (!wrap) return;

  const movsCNJ  = (proc.movimentos_recentes || []).map(m => ({ ...m, _tipo: 'cnj' }));
  const notas    = (proc.notas_manuais || []).map(n => ({ nome: n.texto, data: n.created_at, _tipo: 'nota', _id: n.id }));
  const novosSet = new Set((proc.novos_movimentos || []).map(m => m.data + m.nome));

  // Mescla e ordena por data (mais recente primeiro)
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

  const totalCNJ = movsCNJ.length;
  const totalNotas = notas.length;

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:6px">
      <div style="font-size:13px;font-weight:600;color:var(--navy)">
        ${totalCNJ ? `<span style="color:var(--navy)">${totalCNJ} do CNJ DataJud</span>` : ''}
        ${totalCNJ && totalNotas ? ' · ' : ''}
        ${totalNotas ? `<span style="color:var(--amber)">${totalNotas} anotação(ões)</span>` : ''}
      </div>
      ${proc.datajud_index ? `
        <button class="btn-secondary" style="font-size:11px;padding:4px 10px" onclick="sincronizarDetalhe()">
          <i class="ti ti-refresh"></i> Atualizar CNJ
        </button>` : ''}
    </div>
    <div class="cnj-timeline">
      ${todos.map(m => {
        const isNovo  = m._tipo === 'cnj' && novosSet.has(m.data + m.nome);
        const isNota  = m._tipo === 'nota';
        return `
        <div class="cnj-tl-item ${isNovo ? 'cnj-tl-item--novo' : ''}">
          <div class="cnj-tl-dot ${isNova ? 'cnj-tl-dot--novo' : isNota ? 'cnj-tl-dot--nota' : ''}"></div>
          <div class="cnj-tl-body">
            <div class="cnj-tl-data">
              ${fmt(m.data)}
              ${isNota
                ? `<span style="margin-left:6px;background:var(--amber-light);color:var(--amber);font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px">NOTA</span>`
                : '<span style="margin-left:6px;background:#e8f0fe;color:#1a2e6b;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px">CNJ</span>'
              }
            </div>
            <div class="cnj-tl-nome">
              ${isNota ? `<i class="ti ti-pencil" style="font-size:11px;color:var(--amber);margin-right:4px"></i>` : ''}
              ${m.nome}
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
  renderizarTimelineCNJ(_processoAtual);
  showToast('Anotação removida.');
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
  input.value   = _processoAtual?.apelido || _processoAtual?.nome || '';
  display.style.display = 'none';
  input.style.display   = 'block';
  input.focus();
  input.select();
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

  // Salva: se vazio, remove o apelido (mostra o nome)
  const apelidoSalvar = novo || null;
  display.textContent = novo || _processoAtual.nome;
  _processoAtual.apelido = apelidoSalvar;
  document.getElementById('topbar-title').textContent = novo || _processoAtual.nome;

  const { error } = await _supabase
    .from('processos')
    .update({ apelido: apelidoSalvar })
    .eq('id', _processoAtual.id);

  if (error) { showToast('Erro ao salvar apelido.'); return; }
  carregarProcessos();
  showToast(novo ? 'Apelido salvo.' : 'Apelido removido.');
}

async function verNotificacoes() {
  showPage('processos');
  // Foca nos processos com notificação
  const com = (window._processosDB || []).filter(p => p.notificacao_pendente);
  if (com.length) showToast(`${com.length} processo(s) com nova movimentação`);
}

// ── LOGOUT ────────────────────────────────────────────────────────────────

async function fazerLogout() {
  await _supabase.auth.signOut();
  window.location.href = 'login.html';
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
  const aguardar = setInterval(() => {
    if (window._user !== undefined) {
      clearInterval(aguardar);
      if (window._user) {
        carregarProcessos().then(() => {
          iniciarSyncAutomatico();
          // Sync imediato ao abrir — garante dados frescos sem esperar 10min
          sincronizarTodos(true);
        });
        const avatar = document.getElementById('sidebar-user-avatar');
        if (avatar) avatar.textContent = (window._user.email || '?')[0].toUpperCase();
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
      <div class="pc-title">${p.nome}</div>
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
