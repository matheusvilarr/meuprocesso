let _adminToken = null;
let _adminData  = null;

// Nome/email/OAB vêm de user_metadata, que o próprio usuário controla — nunca
// injetar sem escapar, senão é XSS direto na sessão do admin.
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ESCAPE_MAP[c]);
}

async function init() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  _adminToken = session.access_token;

  const r = await fetch('/api/admin?acao=dados', {
    headers: { 'Authorization': `Bearer ${_adminToken}` },
  });

  if (r.status === 403) {
    document.getElementById('admin-guard').textContent = 'Acesso restrito a administradores.';
    setTimeout(() => window.location.href = 'dashboard.html', 1800);
    return;
  }

  _adminData = await r.json();
  document.getElementById('admin-guard').style.display = 'none';
  document.getElementById('admin-app').style.display   = 'block';

  renderStats();
  renderAdvogados();
  renderSincronizacoes();
  renderCodigos();
  renderAdmins();
  setupTabs();
  renderCronSchedule();
  startCronClock();
}

// ── CRON SCHEDULE ──────────────────────────────────────────────────────────────

const CRON_DEFS = [
  // dias úteis
  { name: 'Sincronizar DataJud+DJEN', utcH: 8,  utcM: 0,  days: [1,2,3,4,5], icon: 'ti-refresh',   color: '#3b82f6', label: '5h BRT · seg–sex' },
  { name: 'E-mail Morning',           utcH: 11, utcM: 0,  days: [1,2,3,4,5], icon: 'ti-sun',        color: '#f59e0b', label: '8h BRT · seg–sex' },
  { name: 'Sincronizar DataJud+DJEN', utcH: 15, utcM: 0,  days: [1,2,3,4,5], icon: 'ti-refresh',   color: '#3b82f6', label: '12h BRT · seg–sex' },
  { name: 'E-mail Tarde',             utcH: 16, utcM: 0,  days: [1,2,3,4,5], icon: 'ti-mail',       color: '#f97316', label: '13h BRT · seg–sex' },
  { name: 'E-mail Noite',             utcH: 20, utcM: 0,  days: [1,2,3,4,5], icon: 'ti-moon',       color: '#8b5cf6', label: '17h BRT · seg–sex' },
  { name: 'OAB Scan',                 utcH: 21, utcM: 30, days: [1,2,3,4,5], icon: 'ti-id-badge-2', color: '#10b981', label: '18h30 BRT · seg–sex' },
  // fins de semana
  { name: 'Sincronizar DataJud+DJEN', utcH: 11, utcM: 0,  days: [0,6],       icon: 'ti-refresh',   color: '#3b82f6', label: '8h BRT · fim de semana' },
  { name: 'E-mail Morning',           utcH: 11, utcM: 30, days: [0,6],       icon: 'ti-sun',        color: '#f59e0b', label: '8h30 BRT · fim de semana' },
  { name: 'OAB Scan',                 utcH: 21, utcM: 0,  days: [0,6],       icon: 'ti-id-badge-2', color: '#10b981', label: '18h BRT · fim de semana' },
];

function nextFire(utcH, utcM, days) {
  const now = Date.now();
  for (let d = 0; d <= 7; d++) {
    const t = new Date(now);
    t.setUTCDate(t.getUTCDate() + d);
    t.setUTCHours(utcH, utcM, 0, 0);
    if (days.includes(t.getUTCDay()) && t.getTime() > now) return t;
  }
  return null;
}

function formatCountdown(ms) {
  if (ms <= 0) return 'agora';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) {
    const dias = Math.floor(h / 24);
    return `em ${dias}d ${h % 24}h`;
  }
  if (h > 0) return `em ${h}h ${m}min`;
  return `em ${m}min`;
}

function countdownClass(ms) {
  if (ms < 30 * 60000)  return 'cron-urgente';
  if (ms < 120 * 60000) return 'cron-proximo';
  return 'cron-ok';
}

function renderCronSchedule() {
  const now = Date.now();
  const brtDate = new Date(now - 3 * 3600000);
  const brtH = String(brtDate.getUTCHours()).padStart(2, '0');
  const brtM = String(brtDate.getUTCMinutes()).padStart(2, '0');
  document.getElementById('cron-now-brt').textContent = `Agora: ${brtH}:${brtM} BRT`;

  const items = CRON_DEFS.map(c => {
    const fire = nextFire(c.utcH, c.utcM, c.days);
    const ms   = fire ? fire.getTime() - now : null;
    const brtFire = fire ? new Date(fire.getTime() - 3 * 3600000) : null;
    const brtStr  = brtFire
      ? `${String(brtFire.getUTCHours()).padStart(2,'0')}:${String(brtFire.getUTCMinutes()).padStart(2,'0')}`
      : '—';
    return { ...c, fire, ms, brtStr };
  }).sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));

  document.getElementById('cron-grid').innerHTML = items.map(c => `
    <div class="cron-item ${c.ms != null ? countdownClass(c.ms) : ''}">
      <div class="cron-item-icon" style="background:${c.color}20;color:${c.color};">
        <i class="ti ${c.icon}"></i>
      </div>
      <div class="cron-item-body">
        <div class="cron-item-name">${c.name}</div>
        <div class="cron-item-label">${c.label}</div>
      </div>
      <div class="cron-item-next">
        ${c.ms != null
          ? `<span class="cron-countdown">${formatCountdown(c.ms)}</span><span class="cron-fire-time">${c.brtStr} BRT</span>`
          : '<span style="color:#9f9f98;font-size:12px;">—</span>'}
      </div>
    </div>
  `).join('');
}

let _cronClockTimer = null;
function startCronClock() {
  if (_cronClockTimer) clearInterval(_cronClockTimer);
  _cronClockTimer = setInterval(renderCronSchedule, 30000);
}

function renderStats() {
  const s = _adminData.stats || {};
  document.getElementById('stat-total').textContent         = s.totalAdvogados ?? '—';
  document.getElementById('stat-processos').textContent     = s.totalProcessos ?? '—';
  document.getElementById('stat-convites').textContent      = s.convitesPendentes ?? '—';
  document.getElementById('stat-bloqueados').textContent     = s.totalBloqueados ?? '—';
  document.getElementById('stat-sem-confirmar').textContent  = s.totalSemConfirmar ?? '—';
}

function setupTabs() {
  document.querySelectorAll('.adm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.adm-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.adm-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
      if (btn.dataset.tab === 'emails') carregarEmails();
    });
  });
}

let _emailsCarregados = false;

async function carregarEmails() {
  if (_emailsCarregados) return;
  _emailsCarregados = true;

  document.getElementById('email-tabela-wrap').innerHTML =
    '<p style="color:#9f9f98;padding:20px 0;">Carregando...</p>';

  const r = await fetch('/api/admin?acao=emails', {
    headers: { 'Authorization': `Bearer ${_adminToken}` },
  });
  const data = await r.json();
  if (!data.ok) {
    document.getElementById('email-tabela-wrap').innerHTML =
      `<p style="color:#c0392b;">Erro ao carregar: ${data.erro || 'desconhecido'}</p>`;
    return;
  }
  renderEmails(data.logs || [], data.erros || []);
}

function renderEmails(logs, erros) {
  const hoje = new Date().toISOString().slice(0, 10);
  const semAntesISO = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // Agrupa logs por usuário
  const porUsuario = {};
  for (const l of logs) {
    if (!porUsuario[l.user_id]) porUsuario[l.user_id] = {};
    if (!porUsuario[l.user_id][l.tipo] || l.data > porUsuario[l.user_id][l.tipo]) {
      porUsuario[l.user_id][l.tipo] = l.data;
    }
  }

  // Stats globais
  const logsHoje    = logs.filter(l => l.data === hoje && l.tipo !== 'oab_scan');
  const logsSemana  = logs.filter(l => l.data >= semAntesISO && l.tipo !== 'oab_scan');
  const usersNotif  = new Set(logsHoje.map(l => l.user_id)).size;
  const errosSemana = erros.filter(e => (e.created_at || '').slice(0, 10) >= semAntesISO).length;

  document.getElementById('email-stats-row').innerHTML = `
    <div class="sync-stat sync-stat-blue">
      <span class="sync-stat-val">${logsHoje.length}</span>
      <span class="sync-stat-lbl">Envios hoje</span>
    </div>
    <div class="sync-stat">
      <span class="sync-stat-val">${usersNotif}</span>
      <span class="sync-stat-lbl">Usuários notificados hoje</span>
    </div>
    <div class="sync-stat">
      <span class="sync-stat-val">${logsSemana.length}</span>
      <span class="sync-stat-lbl">Envios nos últimos 7 dias</span>
    </div>
    <div class="sync-stat ${errosSemana > 0 ? 'sync-stat-orange' : ''}">
      <span class="sync-stat-val">${errosSemana}</span>
      <span class="sync-stat-lbl">Erros de entrega (7d)</span>
    </div>
  `;

  // Tabela por usuário — só quem tem processos
  const advComProc = (_adminData.advogados || []).filter(a => a.numProcessos > 0);
  const errosPorUser = {};
  for (const e of erros) {
    if (e.user_id) {
      if (!errosPorUser[e.user_id]) errosPorUser[e.user_id] = 0;
      errosPorUser[e.user_id]++;
    }
  }

  const turnoIcon = { morning: '🌅', afternoon: '☀️', evening: '🌙' };

  const linhas = advComProc.map(a => {
    const u = porUsuario[a.id] || {};
    const notifHoje = logs.some(l => l.user_id === a.id && l.data === hoje && l.tipo !== 'oab_scan');
    const errosU = errosPorUser[a.id] || 0;

    const cellTurno = (tipo) => {
      const data = u[tipo];
      if (!data) return '<td class="eml-cell eml-nunca">—</td>';
      const isHoje = data === hoje;
      return `<td class="eml-cell ${isHoje ? 'eml-hoje' : 'eml-ok'}" title="${data}">${isHoje ? '✓ hoje' : fmtData(data)}</td>`;
    };

    return `
      <tr>
        <td>
          <div style="font-weight:600;font-size:13px;">${esc(a.nome)}</div>
          <div style="font-size:11px;color:#9f9f98;">${esc(a.email)}</div>
        </td>
        ${cellTurno('morning')}
        ${cellTurno('afternoon')}
        ${cellTurno('evening')}
        <td>
          ${notifHoje
            ? '<span class="adm-status-pill adm-status-ativo">✓ Notificado hoje</span>'
            : '<span class="adm-status-pill adm-status-pendente">Não notificado hoje</span>'}
        </td>
        <td>${errosU > 0
          ? `<span class="adm-status-pill adm-status-bloqueado">${errosU} erro(s)</span>`
          : '<span style="color:#9f9f98;">—</span>'}</td>
      </tr>
    `;
  }).join('');

  document.getElementById('email-tabela-wrap').innerHTML = `
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead>
          <tr>
            <th>Advogado</th>
            <th>${turnoIcon.morning} Último morning</th>
            <th>${turnoIcon.afternoon} Último afternoon</th>
            <th>${turnoIcon.evening} Último evening</th>
            <th>Status hoje</th>
            <th>Erros (14d)</th>
          </tr>
        </thead>
        <tbody>${linhas || '<tr><td colspan="6" style="text-align:center;color:#9f9f98;">Nenhum dado ainda.</td></tr>'}</tbody>
      </table>
    </div>
  `;

  // Log de erros detalhado
  if (!erros.length) {
    document.getElementById('email-erros-wrap').innerHTML = '';
    return;
  }

  document.getElementById('email-erros-wrap').innerHTML = `
    <h3 style="font-size:14px;font-weight:600;color:#991b1b;margin:0 0 12px;display:flex;align-items:center;gap:6px;">
      <i class="ti ti-alert-triangle"></i> Log de erros de e-mail (14 dias)
    </h3>
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead>
          <tr><th>Data/hora</th><th>Origem</th><th>Mensagem</th><th>Usuário</th></tr>
        </thead>
        <tbody>
          ${erros.slice(0, 30).map(e => {
            const adv = (_adminData.advogados || []).find(a => a.id === e.user_id);
            const dt  = e.created_at
              ? new Date(e.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
              : '—';
            return `<tr>
              <td style="white-space:nowrap;font-size:12px;">${dt}</td>
              <td><code style="font-size:11px;background:#fef2f2;color:#991b1b;padding:2px 6px;border-radius:4px;">${esc(e.origem)}</code></td>
              <td style="font-size:12px;color:#374151;max-width:300px;">${esc(e.mensagem)}</td>
              <td style="font-size:12px;">${adv ? esc(adv.nome) : (e.user_id ? e.user_id.slice(0,8)+'…' : '—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function fmtData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderAdvogados() {
  document.getElementById('adv-total').textContent = `${_adminData.advogados.length} cadastrado(s)`;
  document.getElementById('adv-tbody').innerHTML = _adminData.advogados.map(a => `
    <tr>
      <td>${esc(a.nome)}${a.nivelAdmin ? ' <span class="adm-badge" style="font-size:9px;vertical-align:middle;">' + esc(a.nivelAdmin.toUpperCase()) + '</span>' : ''}</td>
      <td>${esc(a.email)}${a.emailConfirmado ? '' : ' <span class="adm-status-pill adm-status-pendente" style="font-size:9px;">não confirmado</span>'}</td>
      <td>${esc(a.oab)}</td>
      <td>${fmtData(a.criadoEm)}</td>
      <td>${a.ultimoLogin ? fmtData(a.ultimoLogin) : 'Nunca'}</td>
      <td>${a.numProcessos}</td>
      <td>${a.numTarefas}</td>
      <td>${a.numColaboradores}</td>
      <td><span class="adm-status-pill ${a.bloqueado ? 'adm-status-bloqueado' : 'adm-status-ativo'}">${a.bloqueado ? 'Bloqueado' : 'Ativo'}</span></td>
      <td>
        <button class="adm-btn-small ${a.bloqueado ? 'ok' : 'danger'}" onclick="toggleStatus('${a.id}', ${!a.bloqueado})">
          ${a.bloqueado ? 'Desbloquear' : 'Bloquear'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10" style="text-align:center;color:#9f9f98;">Nenhum advogado cadastrado.</td></tr>';
}

function renderCodigos() {
  document.getElementById('cod-tbody').innerHTML = (_adminData.codigos || []).map(c => {
    let statusConvite = '—';
    if (c.email_convidado) {
      if (c.usado_em)       statusConvite = '<span class="adm-status-pill adm-status-ativo">Usado</span>';
      else if (c.enviado_em) statusConvite = `<span class="adm-status-pill adm-status-pendente">Enviado</span> <button class="adm-btn-small" onclick="reenviarConvite('${c.id}')">Reenviar</button>`;
      else                   statusConvite = '<span class="adm-status-pill adm-status-bloqueado">Falhou ao enviar</span> <button class="adm-btn-small" onclick="reenviarConvite(\'' + c.id + '\')">Reenviar</button>';
    }
    return `
    <tr>
      <td><code class="adm-code">${esc(c.codigo)}</code></td>
      <td>${esc(c.descricao) || '—'}</td>
      <td>${c.email_convidado ? esc(c.email_convidado) + '<br>' + statusConvite : '—'}</td>
      <td>${c.usos_atual}${c.usos_max != null ? ' / ' + c.usos_max : ''}</td>
      <td><span class="adm-status-pill ${c.ativo ? 'adm-status-ativo' : 'adm-status-bloqueado'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td>${fmtData(c.created_at)}</td>
      <td>
        <button class="adm-btn-small ${c.ativo ? 'danger' : 'ok'}" onclick="toggleCodigo('${c.id}', ${!c.ativo})">
          ${c.ativo ? 'Desativar' : 'Ativar'}
        </button>
      </td>
    </tr>
  `;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:#9f9f98;">Nenhum código gerado ainda.</td></tr>';
}

function renderSincronizacoes() {
  const s     = _adminData.stats || {};
  const advs  = (_adminData.advogados || []).filter(a => a.numProcessos > 0);
  const maxTotal = Math.max(...advs.map(a => a.numProcessos), 1);

  // Mini-stats
  const pctSync = s.totalProcessos > 0
    ? Math.round((s.totalSincronizados / s.totalProcessos) * 100)
    : 0;
  document.getElementById('sync-stats-row').innerHTML = `
    <div class="sync-stat"><span class="sync-stat-val">${s.totalProcessos ?? 0}</span><span class="sync-stat-lbl">Total de processos</span></div>
    <div class="sync-stat sync-stat-blue"><span class="sync-stat-val">${s.totalSincronizados ?? 0}</span><span class="sync-stat-lbl">Sincronizados (CNJ)</span></div>
    <div class="sync-stat sync-stat-orange"><span class="sync-stat-val">${s.totalNotificacoes ?? 0}</span><span class="sync-stat-lbl">Notificações pendentes</span></div>
    <div class="sync-stat"><span class="sync-stat-val">${pctSync}%</span><span class="sync-stat-lbl">Taxa de sincronização</span></div>
  `;

  if (!advs.length) {
    document.getElementById('sync-chart').innerHTML = '<p style="color:#9f9f98;text-align:center;padding:32px;">Nenhum processo cadastrado.</p>';
    return;
  }

  // Ordena por mais sincronizados
  const sorted = [...advs].sort((a, b) => b.numSincronizados - a.numSincronizados);

  document.getElementById('sync-chart').innerHTML = `
    <div class="sync-chart-header">
      <span>Advogado</span>
      <span style="display:flex;align-items:center;gap:16px;font-size:11px;">
        <span><span class="sync-legend navy"></span> Total</span>
        <span><span class="sync-legend blue"></span> Sincronizados CNJ</span>
        <span><span class="sync-legend orange"></span> Notificações</span>
      </span>
    </div>
    ${sorted.map(a => {
      const pctTotal = (a.numProcessos / maxTotal) * 100;
      const pctSinc  = a.numProcessos > 0 ? (a.numSincronizados / a.numProcessos) * 100 : 0;
      const sincPct  = Math.round((a.numSincronizados / a.numProcessos) * 100) || 0;
      const lastSync = a.ultimaSync
        ? new Date(a.ultimaSync).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
        : '—';
      return `
        <div class="sync-row">
          <div class="sync-row-name">
            <span>${esc(a.nome)}</span>
            <span class="sync-row-email">${esc(a.email)}</span>
          </div>
          <div class="sync-row-bars">
            <div class="sync-bar-wrap">
              <div class="sync-bar-track">
                <div class="sync-bar-fill navy" style="width:${pctTotal}%"></div>
              </div>
              <span class="sync-bar-num">${a.numProcessos}</span>
            </div>
            <div class="sync-bar-wrap">
              <div class="sync-bar-track">
                <div class="sync-bar-fill blue" style="width:${pctSinc}%"></div>
              </div>
              <span class="sync-bar-num">${a.numSincronizados} <span style="color:#9f9f98;">(${sincPct}%)</span></span>
            </div>
          </div>
          <div class="sync-row-meta">
            ${a.numNotificacoes > 0 ? `<span class="sync-notif">${a.numNotificacoes} notif.</span>` : '<span style="color:#d1d5db;">—</span>'}
            <span class="sync-last">Última sync: ${lastSync}</span>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function renderAdmins() {
  const admins = _adminData.advogados.filter(a => a.nivelAdmin);
  document.getElementById('admins-tbody').innerHTML = admins.map(a => `
    <tr>
      <td>${esc(a.nome)}</td>
      <td>${esc(a.email)}</td>
      <td>${esc(a.nivelAdmin)}</td>
      <td>
        ${a.nivelAdmin !== 'super_admin' ? `<button class="adm-btn-small danger" onclick="removerAdmin('${esc(a.email)}')">Remover acesso</button>` : '<span style="color:#9f9f98;font-size:12px;">—</span>'}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:#9f9f98;">Nenhum administrador.</td></tr>';
}

async function chamarAdmin(acao, body) {
  const r = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_adminToken}` },
    body: JSON.stringify({ acao, ...body }),
  });
  return r.json();
}

async function toggleStatus(userId, bloquear) {
  const r = await chamarAdmin('toggle-status', { userId, bloquear });
  if (r.erro) return alert(r.erro);
  await init();
}

function abrirGerarCodigo() {
  document.getElementById('cod-descricao').value = '';
  document.getElementById('cod-usos-max').value  = '';
  document.getElementById('modal-gerar-codigo').style.display = 'flex';
}
function fecharGerarCodigo() {
  document.getElementById('modal-gerar-codigo').style.display = 'none';
}

async function gerarCodigo() {
  const descricao = document.getElementById('cod-descricao').value.trim();
  const usosMax   = parseInt(document.getElementById('cod-usos-max').value) || null;
  const r = await chamarAdmin('gerar-codigo', { descricao, usosMax });
  if (r.erro) return alert(r.erro);
  fecharGerarCodigo();
  await init();
}

async function toggleCodigo(id, ativo) {
  const r = await chamarAdmin('toggle-codigo', { id, ativo });
  if (r.erro) return alert(r.erro);
  await init();
}

function abrirConvidarAdvogado() {
  document.getElementById('conv-email').value = '';
  document.getElementById('conv-descricao').value = '';
  document.getElementById('conv-erro').style.display = 'none';
  document.getElementById('modal-convidar-advogado').style.display = 'flex';
}
function fecharConvidarAdvogado() {
  document.getElementById('modal-convidar-advogado').style.display = 'none';
}

async function convidarAdvogado() {
  const email     = document.getElementById('conv-email').value.trim();
  const descricao = document.getElementById('conv-descricao').value.trim();
  const erroEl    = document.getElementById('conv-erro');
  const btn       = document.getElementById('conv-btn');
  erroEl.style.display = 'none';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    erroEl.textContent = 'Informe um e-mail válido.';
    erroEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Enviando...';
  const r = await chamarAdmin('convidar-advogado', { email, descricao });
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-send"></i> Enviar convite';

  if (r.erro) {
    erroEl.textContent = r.erro;
    erroEl.style.display = 'block';
    return;
  }
  fecharConvidarAdvogado();
  await init();
  if (r.avisoEmail) alert(r.avisoEmail);
}

async function enviarEmailsAgora() {
  const btn    = document.getElementById('btn-enviar-emails');
  const result = document.getElementById('email-resultado');

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Enviando…';
  result.style.display = 'none';

  const r = await chamarAdmin('rodar-emails', { tipo: 'morning' });

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-mail-forward"></i> Enviar e-mails agora';

  if (r.erro) {
    result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;';
    result.textContent = 'Erro: ' + r.erro;
    return;
  }

  const res = r.resultado || {};
  result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#f0fdf4;color:#166534;border:1px solid #86efac;';
  result.innerHTML = `<strong>${res.emailsEnviados ?? 0}</strong> e-mail(s) enviado(s)`;

  _emailsCarregados = false;
  await carregarEmails();
}

async function rodarDjenScan() {
  const btn    = document.getElementById('btn-djen-scan');
  const result = document.getElementById('sync-resultado');

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Rodando…';
  result.style.display = 'none';

  const r = await chamarAdmin('rodar-djen-scan', {});

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-scan"></i> DJEN + OAB scan agora';

  if (r.erro) {
    result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;margin-bottom:16px;';
    result.textContent = 'Erro: ' + r.erro;
    return;
  }

  const res = r.resultado || {};
  result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#f0fdf4;color:#166534;border:1px solid #86efac;margin-bottom:16px;';
  result.innerHTML = `DJEN+DataJud concluído · DJEN: <strong>${res.djen ?? '—'}</strong> atualizados · DataJud: <strong>${res.datajud ?? '—'}</strong> · ${res.elapsed ?? ''}`;

  await recarregarSyncStats();
}

async function sincronizarTodos(userId) {
  const btn    = document.getElementById('btn-sincronizar');
  const result = document.getElementById('sync-resultado');

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Sincronizando…';
  result.style.display = 'none';

  const body = userId ? { userId } : {};
  const r = await chamarAdmin('sincronizar-processos', body);

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-refresh"></i> Sincronizar todos agora';

  if (r.erro) {
    result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;margin-bottom:16px;';
    result.textContent = 'Erro: ' + r.erro;
    return;
  }

  result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#f0fdf4;color:#166534;border:1px solid #86efac;margin-bottom:16px;';
  const partes = [
    `<strong>${r.atualizados}</strong> processo(s) atualizados`,
    `<strong>${r.semMudanca}</strong> sem mudança`,
    r.naoEncontrado ? `<strong>${r.naoEncontrado}</strong> não encontrado(s) no DataJud` : null,
    r.erros         ? `<strong>${r.erros}</strong> erro(s) de API` : null,
    `Total verificado: <strong>${r.total}</strong>`,
    r.reparados     ? `· <em>${r.reparados} índice(s) CNJ preenchido(s)</em>` : null,
  ].filter(Boolean);
  result.innerHTML = partes.join(' · ');

  // Recarrega os dados de sync sem reiniciar a página inteira
  await recarregarSyncStats();
}

async function recarregarSyncStats() {
  const r = await fetch('/api/admin?acao=dados', {
    headers: { 'Authorization': `Bearer ${_adminToken}` },
  });
  if (!r.ok) return;
  _adminData = await r.json();
  renderStats();
  renderSincronizacoes();
}

async function reenviarConvite(id) {
  const r = await chamarAdmin('reenviar-convite', { id });
  if (r.erro) return alert(r.erro);
  await init();
}

async function promoverAdmin() {
  const email = document.getElementById('admin-email-input').value.trim();
  if (!email) return;
  const r = await chamarAdmin('gerenciar-admin', { email, tipo: 'promover' });
  if (r.erro) return alert(r.erro);
  document.getElementById('admin-email-input').value = '';
  await init();
}

async function removerAdmin(email) {
  if (!confirm(`Remover acesso admin de ${email}?`)) return;
  const r = await chamarAdmin('gerenciar-admin', { email, tipo: 'remover' });
  if (r.erro) return alert(r.erro);
  await init();
}

document.addEventListener('DOMContentLoaded', init);
