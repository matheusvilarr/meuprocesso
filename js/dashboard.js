// Navigation
const pages = {
  'dashboard': 'Dashboard',
  'processos': 'Meus Processos',
  'processo-detalhe': 'Detalhe do Processo',
  'calendario': 'Calendário',
  'tarefas': 'Tarefas',
  'colaboradores': 'Colaboradores',
  'configuracoes': 'Configurações',
  'arquivados': 'Arquivados & Encerrados',
  'ajuda': 'Ajuda',
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
  if (id === 'tarefas')       carregarTarefas();
  if (id === 'arquivados')    carregarArquivados();
  if (id === 'configuracoes') carregarConfiguracoes();
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
  if (id === 'modal-lembrete') {
    preencherProcessosModal('ev-processo');
    const hoje = new Date().toISOString().slice(0, 10);
    const evData = document.getElementById('ev-data');
    if (evData && !evData.value) evData.value = hoje;
    // Reseta estado de lock (só abrirModalPrazoProcesso o ativa)
    _resetarLockProcessoModal();
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

  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(first);
    d.setDate(d.getDate() - (first.getDay() - i));
    html += `<div class="cal-day other-month">${d.getDate()}</div>`;
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const isToday  = miniCalDate.getFullYear() === today.getFullYear() &&
                     miniCalDate.getMonth() === today.getMonth() && d === today.getDate();
    const hasEvent = eventoDias.has(d);
    html += `<div class="cal-day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''}" onclick="showPage('calendario')">${d}</div>`;
  }

  grid.innerHTML = html;
}

function changeCalMonth(dir) {
  miniCalDate.setMonth(miniCalDate.getMonth() + dir);
  buildMiniCal();
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
    const evHtml  = events.map(e =>
      `<div class="fcal-event ${_tipoEvtCls[e.tipo] || 'event-lembrete'}"
            onclick="event.stopPropagation();excluirEvento('${e.id}')"
            title="${e.titulo} (clique para excluir)">${e.titulo}</div>`
    ).join('');
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

  const cfg       = BUSCA_CONFIG[tipo];
  const inputArea = document.getElementById('busca-input-area');
  const inputEl   = document.getElementById('busca-input');

  document.getElementById('busca-label').textContent            = cfg.label;
  if (inputEl) {
    inputEl.placeholder = cfg.placeholder;
    inputEl.value       = '';
    inputEl.style.height = '62px';
  }
  document.getElementById('busca-hint').textContent             = cfg.hint;
  document.getElementById('busca-tribunal-wrap').style.display  = cfg.tribunal ? 'block' : 'none';
  document.getElementById('busca-oab-uf-wrap').style.display    = cfg.uf       ? 'block' : 'none';

  const avisoEl = document.getElementById('busca-aviso-restrito');
  if (cfg.restrito) {
    avisoEl.style.display   = 'block';
    inputArea.style.display = 'none';
  } else {
    avisoEl.style.display   = 'none';
    inputArea.style.display = 'block';
  }
  limparResultadoBusca();
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

  // Busca individual
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

  // Verifica duplicata pelo número
  if (numero) {
    const jaExiste = (window._processosDB || []).some(p => p.numero === numero);
    if (!jaExiste) {
      const { count } = await _supabase
        .from('processos').select('id', { count: 'exact', head: true })
        .eq('user_id', window._user?.id).eq('numero', numero);
      if (count > 0) { showToast('Este processo já está cadastrado.'); return; }
    } else {
      showToast('Este processo já está cadastrado.');
      return;
    }
  }

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
  const wrap = document.getElementById('dash-prazos-recentes');
  if (!wrap) return;

  const hoje    = new Date();
  const em30    = new Date(hoje); em30.setDate(em30.getDate() + 30);
  const proximos = (_eventosDB || [])
    .filter(e => { const d = new Date(e.data + 'T12:00:00'); return d >= hoje && d <= em30; })
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, 5);

  if (!proximos.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:28px 20px;color:var(--gray-400)">
        <i class="ti ti-calendar-off" style="font-size:28px;display:block;margin-bottom:8px;opacity:0.35"></i>
        <div style="font-size:13px;font-weight:500">Nenhum prazo nos próximos 30 dias</div>
        <div style="font-size:12px;margin-top:4px;opacity:.75">Clique em "Programar Lembrete" para adicionar.</div>
      </div>`;
    return;
  }

  const urgCls    = { alta: 'urgency-alta', media: 'urgency-media', baixa: 'urgency-baixa' };
  const tipoLabel = { prazo_processual:'Prazo Processual', audiencia:'Audiência', lembrete:'Lembrete', reuniao:'Reunião' };
  wrap.innerHTML = proximos.map(e => {
    const dt   = new Date(e.data + 'T12:00:00');
    const dias = Math.ceil((dt - hoje) / 86400000);
    const dia  = dt.toLocaleDateString('pt-BR', { day:'2-digit' });
    const mes  = dt.toLocaleDateString('pt-BR', { month:'short' }).replace('.','');
    const badgeCls = dias <= 3 ? 'dias-urgente' : dias <= 7 ? 'dias-aviso' : 'dias-ok';
    return `
      <div class="prazo-item" onclick="irParaCalendarioMes(${dt.getFullYear()},${dt.getMonth()})">
        <div class="prazo-date"><div class="prazo-day">${dia}</div><div class="prazo-month">${mes}</div></div>
        <div class="prazo-urgency ${urgCls[e.urgencia] || 'urgency-baixa'}"></div>
        <div class="prazo-info"><div class="prazo-name">${e.titulo}</div><div class="prazo-type">${tipoLabel[e.tipo] || 'Lembrete'}</div></div>
        <span class="dias-badge ${badgeCls}">${dias === 0 ? 'Hoje' : dias + 'd'}</span>
      </div>`;
  }).join('');
}

function renderizarListaProcessos(lista) {
  const grid  = document.getElementById('lista-processos-db');
  const empty = document.getElementById('processos-empty');
  if (!grid) return;

  grid.querySelectorAll('.process-card[data-db]').forEach(el => el.remove());

  const sub = document.getElementById('processos-sub-header');
  if (sub) sub.textContent = lista.length ? `${lista.length} processo(s) ativo(s)` : 'Nenhum processo cadastrado';

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
      <div class="pc-title">${p.apelido || p.nome}</div>
      ${p.apelido ? `<div style="font-size:11px;color:var(--gray-400);margin-top:-2px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nome}</div>` : ''}
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
    return `
      <div class="prazo-item">
        <div class="prazo-date"><div class="prazo-day">${dia}</div><div class="prazo-month">${mes}</div></div>
        <div class="prazo-urgency ${urgCls[e.urgencia] || 'urgency-baixa'}"></div>
        <div class="prazo-info">
          <div class="prazo-name">${e.titulo}</div>
          <div class="prazo-type"><span class="badge ${cls}">${tipoLabel[e.tipo] || 'Lembrete'}</span></div>
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
          <div class="cnj-tl-dot ${isNovo ? 'cnj-tl-dot--novo' : isNota ? 'cnj-tl-dot--nota' : ''}"></div>
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

// ── CONFIGURAÇÕES / PERFIL ────────────────────────────────────────────────

const AVATAR_CORES = ['#1a2e6b','#1565c0','#1a7a4a','#9c2b6a','#c0390f','#b07a00','#374151'];
let _avatarCorAtual = '#1a2e6b';

function aplicarAvatarSidebar() {
  const avatar = document.getElementById('sidebar-user-avatar');
  if (!avatar || !window._user) return;
  const meta    = window._user.user_metadata || {};
  const fotoUrl = meta.avatar_url;

  if (fotoUrl) {
    avatar.innerHTML        = `<img src="${fotoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    avatar.style.background = 'transparent';
    avatar.style.overflow   = 'hidden';
  } else {
    avatar.innerHTML = '';
    const nome     = meta.full_name || meta.nome || window._user.email?.split('@')[0] || '';
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
  if (!confirm('Excluir este evento?')) return;
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
  const procs = window._processosDB || [];
  const opcoes = procs.map(p =>
    `<option value="${p.id}">${p.numero ? p.numero + ' — ' : ''}${p.apelido || p.nome}</option>`
  ).join('');
  sel.innerHTML = `<option value="">— Nenhum processo —</option>${opcoes}`;
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

  const total = _tarefasDB.length;
  const sub   = document.getElementById('tarefas-sub');
  if (sub) sub.textContent = total ? `${total} tarefa(s) no quadro` : 'Nenhuma tarefa ainda';

  const procMap = {};
  for (const p of (window._processosDB || [])) procMap[p.id] = p.apelido || p.nome;

  renderizarKanban(_tarefasDB, procMap);
}

function renderizarKanban(tarefas, procMap) {
  const colunas = ['a_fazer','em_andamento','revisao','concluida'];

  for (const col of colunas) {
    const el    = document.getElementById('col-' + col);
    const badge = document.getElementById('col-count-' + col);
    if (!el) continue;

    const itens = tarefas.filter(t => t.coluna === col);
    if (badge) badge.textContent = itens.length;

    if (!itens.length) {
      el.innerHTML = `<div style="text-align:center;padding:24px 12px;color:var(--gray-400);font-size:12px;opacity:0.7">
        <i class="ti ti-inbox" style="display:block;font-size:20px;margin-bottom:6px"></i>
        Nenhuma tarefa
      </div>`;
      continue;
    }

    el.innerHTML = itens.map(t => criarCardTarefa(t, procMap || {})).join('');
  }
}

function criarCardTarefa(t, procMap) {
  const priCls  = { urgente: '#dc2626', media: '#d97706', baixa: '#6b7280' };
  const priLbl  = { urgente: 'Urgente', media: 'Média', baixa: 'Baixa' };
  const cor     = priCls[t.prioridade]  || priCls.baixa;
  const lbl     = priLbl[t.prioridade] || 'Baixa';
  const proc    = t.processo_id && procMap[t.processo_id] ? `<div style="font-size:11px;color:var(--gray-400);margin-top:4px"><i class="ti ti-briefcase" style="font-size:10px"></i> ${procMap[t.processo_id]}</div>` : '';
  const prazo   = t.prazo ? `<div style="font-size:11px;color:var(--gray-400);margin-top:4px"><i class="ti ti-calendar" style="font-size:10px"></i> ${new Date(t.prazo + 'T12:00:00').toLocaleDateString('pt-BR')}</div>` : '';

  return `
    <div class="task-card" draggable="true"
      ondragstart="kanbanDragStart(event,'${t.id}')"
      ondragend="kanbanDragEnd(event)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="font-size:13px;font-weight:500;line-height:1.4;flex:1">${t.titulo}</div>
        <button onclick="excluirTarefa('${t.id}')" title="Excluir"
          style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:13px;padding:0;line-height:1;flex-shrink:0">
          <i class="ti ti-x"></i>
        </button>
      </div>
      ${proc}${prazo}
      <div style="margin-top:8px">
        <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:8px;background:${cor}18;color:${cor}">${lbl}</span>
      </div>
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

  const { error } = await _supabase
    .from('tarefas')
    .update({ coluna, updated_at: new Date().toISOString() })
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

  const { error } = await _supabase.from('tarefas').insert({
    user_id:     window._user?.id,
    titulo,
    processo_id: processo || null,
    coluna,
    prioridade,
    prazo:       prazo || null,
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
  if (!confirm('Excluir esta tarefa?')) return;
  const { error } = await _supabase.from('tarefas').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir tarefa.'); return; }
  showToast('Tarefa excluída.');
  carregarTarefas();
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
    const sublabel = {
      buscando:       'Buscando no DataJud...',
      encontrado:     r.data?.classe || r.data?.tribunal || 'Encontrado',
      nao_encontrado: 'Não localizado no DataJud',
      erro:           'Erro de conexão — tente novamente',
    }[r.status] || r.status;

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;border:1px solid var(--gray-200);background:${bgs[r.status] || 'var(--gray-50)'}">
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
  label.textContent = `${selecionados} de ${encontrados} selecionado(s)`;
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
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Importando ${selecionados.length}...`; }

  // Busca todos os números já cadastrados de uma vez (evita N queries)
  const { data: existentes } = await _supabase
    .from('processos').select('numero').eq('user_id', window._user?.id);
  const numerosExistentes = new Set((existentes || []).map(p => p.numero).filter(Boolean));

  let importados = 0;
  let duplicados = 0;
  let erros      = 0;

  for (const r of selecionados) {
    const d    = r.data;
    const movs = d.movimentos || [];

    if (d.numero && numerosExistentes.has(d.numero)) {
      duplicados++;
      continue;
    }

    const clientePart = (d.partes || []).find(p => /autor|requerente|reclamante/i.test(p.tipo));

    const { error } = await _supabase.from('processos').insert({
      user_id:             window._user?.id,
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
    });

    if (error) { erros++; console.error('Erro ao importar', d.numero, error); }
    else importados++;
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-cloud-download"></i> Importar selecionados'; }

  closeModal('modal-busca-tribunal');

  const partes = [];
  if (importados)  partes.push(`${importados} importado(s)`);
  if (duplicados)  partes.push(`${duplicados} já cadastrado(s)`);
  if (erros)       partes.push(`${erros} com falha`);
  showToast(partes.length ? partes.join(' · ') + '.' : 'Nenhum processo importado.');
  carregarProcessos();
}
