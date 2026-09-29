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

  if (!r.ok) {
    let motivo = '';
    try { motivo = (await r.json()).motivo || ''; } catch (_) { motivo = `Servidor respondeu ${r.status}.`; }
    document.getElementById('admin-guard').innerHTML = `
      <div style="text-align:center;max-width:460px;line-height:1.6">
        <div style="font-size:16px;font-weight:600;color:#2e2e2a;margin-bottom:8px">Acesso restrito a administradores</div>
        ${motivo ? `<div style="font-size:13px;margin-bottom:16px">${esc(motivo)}</div>` : ''}
        <a href="/dashboard" style="color:#1a2e6b;font-weight:600">← Voltar ao dashboard</a>
      </div>`;
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
  if (!_tabsProntas) { setupTabs(); _tabsProntas = true; }
  renderCronSchedule();
  startCronClock();
  carregarPendentes(); // carrega em background só para mostrar badge
  carregarSaude();
}
let _tabsProntas = false;

// ── SAÚDE DO SISTEMA ───────────────────────────────────────────────────────────

const NIVEL_ALERTA = {
  critico: { icone: 'ti-alert-octagon',  classe: 'alerta-critico' },
  atencao: { icone: 'ti-alert-triangle', classe: 'alerta-atencao' },
  info:    { icone: 'ti-info-circle',    classe: 'alerta-info' },
};

function tempoRelativo(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1)   return 'agora';
  if (min < 60)  return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48)    return `há ${h}h`;
  return `há ${Math.round(h / 24)} dias`;
}

async function carregarSaude() {
  const alertasEl = document.getElementById('saude-alertas');
  try {
    const r = await fetch('/api/admin?acao=saude', { headers: { 'Authorization': `Bearer ${_adminToken}` } });
    const s = await r.json();
    if (!s.ok) throw new Error(s.erro || 'erro');
    renderSaude(s);
  } catch (e) {
    alertasEl.innerHTML = `<div class="saude-alerta alerta-critico"><i class="ti ti-alert-octagon"></i><div><strong>Não foi possível verificar a saúde do sistema</strong><div>${esc(e.message)}</div></div></div>`;
  }
}

function renderSaude(s) {
  document.getElementById('saude-atualizado').textContent =
    `verificado ${tempoRelativo(s.geradoEm)}${s.config.deploy ? ' · deploy ' + esc(s.config.deploy) : ''}`;

  const alertasEl = document.getElementById('saude-alertas');
  const ordem = { critico: 0, atencao: 1, info: 2 };
  const alertas = [...(s.alertas || [])].sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  alertasEl.innerHTML = alertas.length
    ? alertas.map((a, i) => {
        const n = NIVEL_ALERTA[a.nivel] || NIVEL_ALERTA.info;
        const botao = a.acao ? `<button class="adm-btn-small" onclick="acaoAlerta(${i})">${esc(a.acao.label)}</button>` : '';
        return `<div class="saude-alerta ${n.classe}"><i class="ti ${n.icone}"></i><div class="saude-alerta-txt"><strong>${esc(a.titulo)}</strong><div>${esc(a.detalhe)}</div></div>${botao}</div>`;
      }).join('')
    : `<div class="saude-alerta alerta-ok"><i class="ti ti-circle-check"></i><div><strong>Tudo funcionando</strong><div>DataJud, DJEN e e-mails sem pendências.</div></div></div>`;
  window._alertasSaude = alertas;

  const d = s.datajud, dj = s.djen, em = s.emails;
  const pct = d.comIndice ? Math.round(((d.comIndice - d.desatualizados) / d.comIndice) * 100) : 100;
  const card = (icone, titulo, valor, linhas, estado) => `
    <div class="saude-card ${estado}">
      <div class="saude-card-topo"><i class="ti ${icone}"></i> ${titulo}</div>
      <div class="saude-card-valor">${valor}</div>
      ${linhas.map(l => `<div class="saude-card-linha">${l}</div>`).join('')}
    </div>`;

  document.getElementById('saude-cards').innerHTML = [
    card('ti-cloud-search', 'DataJud', `${pct}% em dia`, [
      `${d.comIndice} monitorados · ${d.desatualizados} atrasados (48h+)`,
      `Última consulta ${tempoRelativo(d.ultimaVerificacao)}`,
    ], pct >= 90 ? 'ok' : pct >= 60 ? 'atencao' : 'critico'),
    card('ti-news', 'DJEN (cadernos)', `${dj.hoje.concluidos}/${dj.hoje.total} hoje`, [
      `Ontem: ${dj.ontem.concluidos}/${dj.ontem.total}${dj.hoje.erros + dj.ontem.erros ? ` · ${dj.hoje.erros + dj.ontem.erros} com erro` : ''}`,
      `${dj.hoje.publicacoes + dj.ontem.publicacoes} publicação(ões) encontradas · último ${tempoRelativo(dj.ultimaConclusao)}`,
    ], !dj.ultimaConclusao ? 'critico' : (dj.hoje.erros + dj.ontem.erros) ? 'atencao' : 'ok'),
    card('ti-mail', 'E-mails', `${em.pendentes} na fila`, [
      `${em.avisosSite} aviso(s) aguardando leitura no site`,
      `Último envio: ${em.ultimoEnvio ? em.ultimoEnvio.split('-').reverse().join('/') + (em.ultimoTipo ? ' (' + esc(em.ultimoTipo) + ')' : '') : 'nunca'}`,
    ], s.config.resend ? 'ok' : 'critico'),
    card('ti-shield-check', 'Configuração', s.config.cronSecret && s.config.resend ? 'OK' : 'Pendências', [
      `CRON_SECRET ${s.config.cronSecret ? '✓' : '✗ faltando'} · Resend ${s.config.resend ? '✓' : '✗ faltando'}`,
      `Região ${esc(s.config.regiao || '—')}${s.config.regiao === 'gru1' ? ' (São Paulo) ✓' : ''}`,
    ], s.config.cronSecret && s.config.resend ? 'ok' : 'critico'),
    card('ti-receipt', 'Assinaturas', `${s.assinaturas.emTrial} em teste`, [
      `${s.assinaturas.vencendo7d} vencem em 7 dias`,
      `${s.assinaturas.vencidas} vencida(s)`,
    ], s.assinaturas.vencendo7d ? 'atencao' : 'ok'),
  ].join('');
}

function irParaAba(aba) {
  document.querySelector(`.adm-tab[data-tab="${aba}"]`)?.click();
  document.querySelector('.adm-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function acaoAlerta(i) {
  const a = (window._alertasSaude || [])[i]?.acao;
  if (!a) return;
  if (a.tipo === 'aba') irParaAba(a.aba);
  if (a.tipo === 'filtro') { irParaAba('advogados'); setFiltroAdv(a.filtro); }
}

// ── CRON SCHEDULE ──────────────────────────────────────────────────────────────

// Espelho do vercel.json (plano Hobby: cada cron dispara 1x/dia, em algum
// momento dentro da hora marcada — não no minuto exato).
const CRON_DEFS = [
  // dias úteis
  { name: 'Sincronizar DataJud', utcH: 8,  utcM: 0,  days: [1,2,3,4,5], icon: 'ti-refresh',    color: '#3b82f6', label: '5h BRT · seg–sex (e 7h, 9h, 11h, 13h, 15h, 17h, 19h)' },
  { name: 'E-mail Morning',      utcH: 10, utcM: 30, days: [1,2,3,4,5], icon: 'ti-sun',        color: '#f59e0b', label: '7h30 BRT · seg–sex' },
  { name: 'E-mail Tarde',        utcH: 16, utcM: 30, days: [1,2,3,4,5], icon: 'ti-mail',       color: '#f97316', label: '13h30 BRT · seg–sex' },
  { name: 'E-mail Noite',        utcH: 21, utcM: 0,  days: [1,2,3,4,5], icon: 'ti-moon',       color: '#8b5cf6', label: '18h BRT · seg–sex (prazos urgentes)' },
  // fins de semana
  { name: 'Sincronizar DataJud', utcH: 10, utcM: 0,  days: [0,6],       icon: 'ti-refresh',    color: '#3b82f6', label: '7h BRT · fim de semana (e 11h, 15h)' },
  { name: 'E-mail Morning',      utcH: 10, utcM: 30, days: [0,6],       icon: 'ti-sun',        color: '#f59e0b', label: '7h30 BRT · fim de semana' },
  { name: 'E-mail Tarde',        utcH: 18, utcM: 30, days: [0,6],       icon: 'ti-mail',       color: '#f97316', label: '15h30 BRT · fim de semana' },
  // todos os dias
  { name: 'DJEN (cadernos)',     utcH: 9,  utcM: 0,  days: [0,1,2,3,4,5,6], icon: 'ti-news',   color: '#10b981', label: '6h BRT · todo dia' },
  { name: 'DJEN (cadernos)',     utcH: 15, utcM: 0,  days: [0,1,2,3,4,5,6], icon: 'ti-news',   color: '#10b981', label: '12h BRT · todo dia' },
  { name: 'DJEN (cadernos)',     utcH: 22, utcM: 0,  days: [0,1,2,3,4,5,6], icon: 'ti-news',   color: '#10b981', label: '19h BRT · todo dia' },
  { name: 'Prazo fatal',         utcH: 12, utcM: 0,  days: [0,1,2,3,4,5,6], icon: 'ti-alarm',  color: '#be123c', label: '9h BRT · todo dia' },
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
  document.getElementById('stat-oab-duplicada').textContent  = s.totalOabDuplicada ?? '—';
}

function setupTabs() {
  document.querySelectorAll('.adm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.adm-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.adm-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
      if (btn.dataset.tab === 'emails')        carregarEmails();
      if (btn.dataset.tab === 'pendentes')     carregarPendentes();
      if (btn.dataset.tab === 'djen-cadernos') carregarDjenCadernos();
    });
  });
}

async function carregarPendentes() {
  const tbody = document.getElementById('pendentes-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:24px">Carregando…</td></tr>';

  const r = await fetch('/api/admin?acao=pendentes', {
    headers: { 'Authorization': `Bearer ${_adminToken}` },
  });
  const data = await r.json();
  if (!data.ok) { tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444;padding:16px">Erro ao carregar.</td></tr>'; return; }

  const badge = document.getElementById('badge-pendentes');
  if (data.pendentes.length) {
    badge.textContent = data.pendentes.length;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }

  if (!data.pendentes.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px">Nenhuma conta pendente.</td></tr>';
    return;
  }

  tbody.innerHTML = data.pendentes.map(u => `
    <tr id="pendente-row-${u.id}">
      <td>${u.nome ? esc(u.nome) : '<span style="color:#9ca3af">—</span>'}</td>
      <td>${esc(u.email)}</td>
      <td>${u.oab ? esc(u.oab) : '<span style="color:#9ca3af">—</span>'}</td>
      <td><span style="font-size:11px;background:#f3f4f6;padding:2px 8px;border-radius:6px">${esc(u.provider)}</span></td>
      <td style="color:#6b7280;font-size:12px">${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
      <td>
        <div style="display:flex;gap:8px">
          <button class="adm-btn-primary" style="font-size:12px;padding:6px 14px" onclick="aprovarUsuario('${u.id}')">Aprovar</button>
          <button class="adm-btn-secondary" style="font-size:12px;padding:6px 14px;color:#ef4444;border-color:#ef4444" onclick="rejeitarUsuario('${u.id}')">Rejeitar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function aprovarUsuario(userId) {
  const r = await fetch('/api/admin?acao=aprovar-usuario', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${_adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const data = await r.json();
  if (data.ok) {
    document.getElementById('pendente-row-' + userId)?.remove();
    const badge = document.getElementById('badge-pendentes');
    const n = parseInt(badge.textContent || '0') - 1;
    if (n <= 0) badge.style.display = 'none';
    else badge.textContent = n;
  } else {
    alert('Erro: ' + data.erro);
  }
}

async function rejeitarUsuario(userId) {
  if (!confirm('Rejeitar e EXCLUIR esta conta permanentemente? (Só funciona para contas vazias — contas com processos são protegidas.)')) return;
  const r = await fetch('/api/admin?acao=rejeitar-usuario', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${_adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const data = await r.json();
  if (data.ok) {
    document.getElementById('pendente-row-' + userId)?.remove();
    const badge = document.getElementById('badge-pendentes');
    const n = parseInt(badge.textContent || '0') - 1;
    if (n <= 0) badge.style.display = 'none';
    else badge.textContent = n;
  } else {
    alert('Erro: ' + data.erro);
  }
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
      `<p style="color:#c0392b;">Erro ao carregar: ${esc(data.erro || 'desconhecido')}</p>`;
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

const PLANO_LABEL = { trial: 'Teste grátis', mensal: 'Mensal', semestral: 'Semestral', anual: 'Anual', legado: 'Legado' };

function celulaAssinatura(a) {
  if (!a.plano) return '<span style="color:#9f9f98;font-size:11px;">— sem assinatura —</span>';
  const dias    = a.dataExpiracao ? Math.ceil((new Date(a.dataExpiracao) - new Date()) / 86400000) : null;
  const vencida = a.statusAssinatura !== 'ativo' || (dias !== null && dias < 0);
  const cor     = vencida ? '#c0392b' : (dias !== null && dias <= 5) ? '#d97706' : '#6b8f5e';
  const diasTxt = dias === null ? '' : vencida ? 'vencida' : dias === 0 ? 'vence hoje' : `${dias}d restantes`;
  return `<div style="font-size:11px;font-weight:600;">${esc(PLANO_LABEL[a.plano] || a.plano)}</div>
          <div style="font-size:10px;color:${cor}">${fmtData(a.dataExpiracao)}${diasTxt ? ' · ' + diasTxt : ''}</div>`;
}

let _filtroAdv = 'todos';

function setFiltroAdv(filtro) {
  _filtroAdv = filtro;
  document.querySelectorAll('#adv-filtros .adv-chip').forEach(b => b.classList.toggle('active', b.dataset.filtro === filtro));
  renderAdvogados();
}

function diasAte(iso) {
  return iso ? Math.ceil((new Date(iso) - new Date()) / 86400000) : null;
}

const FILTROS_ADV = {
  todos:          () => true,
  trial:          a => a.plano === 'trial' && a.statusAssinatura === 'ativo' && diasAte(a.dataExpiracao) >= 0,
  vencendo:       a => a.statusAssinatura === 'ativo' && diasAte(a.dataExpiracao) >= 0 && diasAte(a.dataExpiracao) <= 7,
  vencidos:       a => a.plano && (a.statusAssinatura !== 'ativo' || diasAte(a.dataExpiracao) < 0),
  desatualizados: a => a.numDesatualizados > 0,
  inativos:       a => !a.ultimoLogin || (Date.now() - new Date(a.ultimoLogin)) > 30 * 86400000,
  bloqueados:     a => a.bloqueado,
  oabdup:         a => a.oabDuplicado,
};

function renderAdvogados() {
  const termo = (document.getElementById('adv-busca')?.value || '').toLowerCase().trim();
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = semAcento(termo);
  const lista = _adminData.advogados
    .filter(FILTROS_ADV[_filtroAdv] || FILTROS_ADV.todos)
    .filter(a => !t || semAcento(a.nome).includes(t) || semAcento(a.email).includes(t) ||
                 semAcento(a.oab).replace(/\W/g, '').includes(t.replace(/\W/g, '')));

  // Contador em cada chip — mostra de relance quantos há em cada situação
  document.querySelectorAll('#adv-filtros .adv-chip').forEach(b => {
    const f = b.dataset.filtro;
    if (f === 'todos') return;
    const n = _adminData.advogados.filter(FILTROS_ADV[f]).length;
    const rotulo = b.dataset.rotulo || (b.dataset.rotulo = b.textContent);
    b.textContent = n ? `${rotulo} (${n})` : rotulo;
  });

  document.getElementById('adv-total').textContent = lista.length === _adminData.advogados.length
    ? `${_adminData.advogados.length} cadastrado(s)`
    : `${lista.length} de ${_adminData.advogados.length}`;

  document.getElementById('adv-tbody').innerHTML = lista.map(a => `
    <tr class="adv-linha" onclick="abrirFicha('${a.id}')" title="Ver ficha completa">
      <td><span class="adv-nome">${esc(a.nome)}</span>${a.nivelAdmin ? ' <span class="adm-badge" style="font-size:9px;vertical-align:middle;">' + esc(a.nivelAdmin.toUpperCase()) + '</span>' : ''}${a.numDesatualizados ? ` <span class="adm-status-pill adm-status-pendente" style="font-size:9px;" title="Processos sem consulta ao DataJud há 48h+">${a.numDesatualizados} atrasado(s)</span>` : ''}</td>
      <td>${esc(a.email)}${a.emailConfirmado ? '' : ' <span class="adm-status-pill adm-status-pendente" style="font-size:9px;">não confirmado</span>'}</td>
      <td>${esc(a.oab)}${a.oabDuplicado ? ' <span class="adm-status-pill adm-status-bloqueado" title="Outra conta usa a mesma OAB" style="font-size:9px;"><i class="ti ti-alert-triangle"></i> duplicada</span>' : ''}</td>
      <td>${fmtData(a.criadoEm)}</td>
      <td>${a.ultimoLogin ? fmtData(a.ultimoLogin) : 'Nunca'}</td>
      <td>${a.numProcessos}</td>
      <td>${a.numTarefas}</td>
      <td>${a.numColaboradores}</td>
      <td><span class="adm-status-pill ${a.bloqueado ? 'adm-status-bloqueado' : 'adm-status-ativo'}">${a.bloqueado ? 'Bloqueado' : 'Ativo'}</span></td>
      <td>${celulaAssinatura(a)}</td>
      <td onclick="event.stopPropagation()">
        <button class="adm-btn-small ${a.bloqueado ? 'ok' : 'danger'}" onclick="toggleStatus('${a.id}', ${!a.bloqueado})">
          ${a.bloqueado ? 'Desbloquear' : 'Bloquear'}
        </button>
        <button class="adm-btn-small" onclick="abrirAssinatura('${a.id}')">
          Assinatura
        </button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="11" style="text-align:center;color:#9f9f98;">Nenhum advogado encontrado com esse filtro/busca.</td></tr>`;
}

// ── FICHA DO ADVOGADO ──────────────────────────────────────────────────────────

let _fichaId = null;

function fecharFicha() {
  document.getElementById('modal-ficha').style.display = 'none';
  _fichaId = null;
}

async function abrirFicha(id) {
  _fichaId = id;
  const a = (_adminData.advogados || []).find(x => x.id === id);
  document.getElementById('ficha-nome').textContent = a?.nome || '—';
  document.getElementById('ficha-sub').textContent  = a?.email || '';
  document.getElementById('ficha-corpo').innerHTML  = '<div class="saude-carregando">Carregando…</div>';
  document.getElementById('modal-ficha').style.display = 'flex';

  try {
    const r = await fetch(`/api/admin?acao=detalhe-usuario&userId=${encodeURIComponent(id)}`, { headers: { 'Authorization': `Bearer ${_adminToken}` } });
    const d = await r.json();
    if (!d.ok) throw new Error(d.erro || 'erro');
    if (_fichaId === id) renderFicha(d, a);
  } catch (e) {
    document.getElementById('ficha-corpo').innerHTML = `<p style="color:#c0392b">Erro ao carregar: ${esc(e.message)}</p>`;
  }
}

function renderFicha(d, resumo) {
  const u = d.usuario, p = d.processos, as = d.assinatura;
  document.getElementById('ficha-sub').innerHTML =
    `${esc(u.email)} · ${u.oabs.length ? 'OAB ' + u.oabs.map(esc).join(', ') : '<span style="color:#c0392b">sem OAB cadastrada — DJEN não encontra publicações</span>'}`;

  const dias = as ? diasAte(as.data_expiracao) : null;
  const assinTxt = !as ? 'Sem assinatura (travado em /aguardando)'
    : `${esc(PLANO_LABEL[as.plano] || as.plano)} · ${as.status !== 'ativo' || dias < 0 ? '<strong style="color:#c0392b">vencida</strong>' : dias === 0 ? 'vence hoje' : `${dias} dia(s) restantes`} · até ${fmtData(as.data_expiracao)}`;

  const kpi = (valor, rotulo, alerta) => `<div class="ficha-kpi${alerta ? ' alerta' : ''}"><div class="ficha-kpi-v">${valor}</div><div class="ficha-kpi-l">${rotulo}</div></div>`;

  const recentes = d.recentes.length
    ? d.recentes.map(m => `
        <div class="ficha-mov">
          <div class="ficha-mov-data">${m.data ? fmtData(m.data) : '—'}</div>
          <div class="ficha-mov-txt">
            <div><strong>${esc(m.nome)}</strong>${m.novo ? ' <span class="adm-status-pill adm-status-pendente" style="font-size:9px;">não lido</span>' : ''}</div>
            <div class="ficha-mov-sub">${esc(m.mov)} · <span class="ficha-fonte ${m.fonte === 'DJEN' ? 'djen' : ''}">${m.fonte}</span></div>
          </div>
        </div>`).join('')
    : '<div class="ficha-vazio">Nenhuma movimentação registrada.</div>';

  const erros = d.erros.length
    ? d.erros.map(e => `<div class="ficha-erro"><code>${esc(e.origem)}</code> ${esc(e.mensagem)} <span>${tempoRelativo(e.created_at)}</span></div>`).join('')
    : '<div class="ficha-vazio">Nenhum erro nos últimos 14 dias.</div>';

  // Dicas automáticas a partir dos dados
  const dicas = [];
  if (!u.oabs.length) dicas.push('Sem OAB no perfil: o DJEN não consegue achar publicações nem importar processos novos.');
  if (p.desatualizados48h) dicas.push(`${p.desatualizados48h} processo(s) sem consulta ao DataJud há 48h+ — use "Sincronizar agora".`);
  if (p.semNumeroCnj) dicas.push(`${p.semNumeroCnj} processo(s) sem número CNJ válido não são monitorados automaticamente.`);
  if (!u.ultimoLogin || (Date.now() - new Date(u.ultimoLogin)) > 30 * 86400000) dicas.push('Não entra no sistema há mais de 30 dias.');
  if (as && as.plano === 'trial' && dias !== null && dias >= 0 && dias <= 3) dicas.push('Teste grátis acabando — bom momento para contato.');
  if (!u.emailConfirmado) dicas.push('E-mail ainda não confirmado.');

  document.getElementById('ficha-corpo').innerHTML = `
    ${dicas.length ? `<div class="ficha-dicas">${dicas.map(t => `<div><i class="ti ti-bulb"></i> ${esc(t)}</div>`).join('')}</div>` : ''}

    <div class="ficha-kpis">
      ${kpi(p.ativos, 'processos ativos')}
      ${kpi(p.monitorados, 'monitorados (CNJ)')}
      ${kpi(p.desatualizados48h, 'sync atrasada', p.desatualizados48h > 0)}
      ${kpi(p.avisosSite, 'avisos não lidos')}
      ${kpi(p.autoImportados, 'importados pelo DJEN')}
      ${kpi(d.ultimaPublicacaoDjen ? fmtData(d.ultimaPublicacaoDjen) : '—', 'última publicação DJEN')}
    </div>

    <div class="ficha-secao">
      <div class="ficha-secao-titulo"><i class="ti ti-receipt"></i> Assinatura</div>
      <div class="ficha-linha">${assinTxt}${as?.valor_pago ? ` · R$ ${Number(as.valor_pago).toFixed(2).replace('.', ',')}` : ''}${as?.observacoes ? ` · <em>${esc(as.observacoes)}</em>` : ''}</div>
      <div class="ficha-acoes">
        <button class="adm-btn-small" onclick="renovarAssinatura('${u.id}', 30, 'mensal')">+30 dias (mensal)</button>
        <button class="adm-btn-small" onclick="renovarAssinatura('${u.id}', 182, 'semestral')">+6 meses</button>
        <button class="adm-btn-small" onclick="renovarAssinatura('${u.id}', 365, 'anual')">+1 ano</button>
        <button class="adm-btn-small" onclick="renovarAssinatura('${u.id}', 7, null)">+7 dias (mesmo plano)</button>
        <button class="adm-btn-small" onclick="fecharFicha();abrirAssinatura('${u.id}')">Editar…</button>
      </div>
    </div>

    <div class="ficha-secao">
      <div class="ficha-secao-titulo"><i class="ti ti-activity"></i> Últimas movimentações</div>
      ${recentes}
    </div>

    <div class="ficha-secao">
      <div class="ficha-secao-titulo"><i class="ti ti-alert-triangle"></i> Erros de sincronização (14 dias)</div>
      ${erros}
    </div>

    <div class="ficha-secao ficha-rodape">
      <div class="ficha-linha" style="color:#9f9f98;font-size:12px;">
        Cadastro ${fmtData(u.criadoEm)} · último login ${u.ultimoLogin ? tempoRelativo(u.ultimoLogin) : 'nunca'} · via ${esc(u.provider)}
        ${u.telefone ? ` · tel. ${esc(u.telefone)}` : ''}
        ${d.colaboradores.length ? ` · ${d.colaboradores.length} colaborador(es)` : ''}
        ${d.ultimosEmails.length ? ` · último e-mail ${d.ultimosEmails[0].data.split('-').reverse().join('/')} (${esc(d.ultimosEmails[0].tipo)})` : ' · nenhum e-mail enviado'}
      </div>
      <div class="ficha-acoes">
        <button class="adm-btn-primary" id="ficha-btn-sync" onclick="sincronizarUsuario('${u.id}')"><i class="ti ti-refresh"></i> Sincronizar DataJud agora</button>
        <button class="adm-btn-small ${u.bloqueado ? 'ok' : 'danger'}" onclick="toggleStatus('${u.id}', ${!u.bloqueado})">${u.bloqueado ? 'Desbloquear acesso' : 'Bloquear acesso'}</button>
      </div>
      <div id="ficha-resultado" class="ficha-resultado" style="display:none"></div>
    </div>`;
}

// Soma dias a partir do vencimento atual (se ainda válido) ou de hoje.
async function renovarAssinatura(id, dias, plano) {
  const a = (_adminData.advogados || []).find(x => x.id === id);
  const atual  = a?.dataExpiracao && new Date(a.dataExpiracao) > new Date() ? new Date(a.dataExpiracao) : new Date();
  const novo   = new Date(atual.getTime() + dias * 86400000);
  const planoF = plano || a?.plano || 'trial';
  const ok = confirm(`${a?.nome || 'Advogado'}: plano ${PLANO_LABEL[planoF] || planoF}, válido até ${novo.toLocaleDateString('pt-BR')}. Confirmar?`);
  if (!ok) return;

  const r = await chamarAdmin('atualizar-assinatura', {
    escritorioId: id,
    plano: planoF,
    status: 'ativo',
    dataExpiracao: new Date(novo.toISOString().slice(0, 10) + 'T23:59:59').toISOString(),
    valorPago: a?.valorPago ?? null,
    formaPagamento: a?.formaPagamento || null,
    observacoes: a?.obsAssinatura || null,
  });
  if (r.erro) return alert(r.erro);
  await recarregarDados();
  if (_fichaId === id) abrirFicha(id);
  carregarSaude();
}

async function sincronizarUsuario(id) {
  const btn = document.getElementById('ficha-btn-sync');
  const out = document.getElementById('ficha-resultado');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Sincronizando…'; }
  const r = await chamarAdmin('sincronizar-processos', { userId: id });
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> Sincronizar DataJud agora'; }
  if (out) {
    out.style.display = 'block';
    out.innerHTML = r.erro
      ? `<span style="color:#c0392b">Erro: ${esc(r.erro)}</span>`
      : `${r.atualizados} atualizado(s) · ${r.semMudanca} sem mudança · ${r.naoEncontrado} não encontrado(s) · ${r.erros} com erro do DataJud${r.parou ? ' · parou pelo limite de tempo, rode de novo pra continuar' : ''}`;
  }
}

async function recarregarDados() {
  const r = await fetch('/api/admin?acao=dados', { headers: { 'Authorization': `Bearer ${_adminToken}` } });
  if (!r.ok) return;
  _adminData = await r.json();
  renderStats();
  renderAdvogados();
  renderSincronizacoes();
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
    <div class="sync-stat ${(s.totalErrosCronSemana ?? 0) > 0 ? 'sync-stat-orange' : ''}"><span class="sync-stat-val">${s.totalErrosCronSemana ?? 0}</span><span class="sync-stat-lbl">Erros de sincronização (7d)</span></div>
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

  renderSyncErros(_adminData.cronErros || []);
}

// Explicação em linguagem simples para os erros mais comuns
function explicarErro(origem, mensagem) {
  const m = String(mensagem || '');
  if (origem === 'cron:djen' && /403/.test(m)) return 'Código antigo (DJEN por OAB, anterior a 29/09) bloqueado pela API do DJEN. Não deve mais aparecer.';
  if (/timeout|aborted/i.test(m))             return 'O DataJud demorou mais de 28s para responder (instabilidade do CNJ). O processo é tentado de novo automaticamente.';
  if (/DataJud respondeu 5\d\d/.test(m))       return 'Erro no servidor do DataJud (CNJ). Tentado de novo na próxima execução.';
  if (/DataJud respondeu 429/.test(m))         return 'DataJud limitou o número de consultas. Tentado de novo na próxima execução.';
  if (/Metadados do caderno .* 403/.test(m))   return 'API do DJEN bloqueou o acesso — confira se as funções estão na região gru1 (São Paulo).';
  return null;
}

function renderSyncErros(erros) {
  const wrap = document.getElementById('sync-erros-wrap');
  if (!wrap) return;
  if (!erros.length) {
    wrap.innerHTML = '<div class="saude-alerta alerta-ok"><i class="ti ti-circle-check"></i><div><strong>Nenhum erro de sincronização nos últimos 14 dias</strong></div></div>';
    return;
  }

  // Agrupa erros iguais (números/ids trocados por #) — mostra o padrão, quantas
  // vezes aconteceu, quantos usuários afetou e quando foi a última vez.
  const grupos = new Map();
  for (const e of erros) {
    const padrao = String(e.mensagem || '').replace(/\d[\d.\-/]*/g, '#').slice(0, 160);
    const chave  = `${e.origem}|${padrao}`;
    if (!grupos.has(chave)) grupos.set(chave, { origem: e.origem, exemplo: e.mensagem, n: 0, usuarios: new Set(), ultima: e.created_at, primeira: e.created_at });
    const g = grupos.get(chave);
    g.n++;
    if (e.user_id) g.usuarios.add(e.user_id);
    if (e.created_at > g.ultima)   g.ultima = e.created_at;
    if (e.created_at < g.primeira) g.primeira = e.created_at;
  }
  const lista = [...grupos.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));

  wrap.innerHTML = `
    <h3 style="font-size:14px;font-weight:600;color:#991b1b;margin:0 0 12px;display:flex;align-items:center;gap:6px;">
      <i class="ti ti-alert-triangle"></i> Erros de sincronização — ${erros.length} ocorrência(s) em ${lista.length} tipo(s), últimos 14 dias
    </h3>
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead>
          <tr><th>Erro</th><th>Vezes</th><th>Usuários</th><th>Última vez</th></tr>
        </thead>
        <tbody>
          ${lista.map(g => {
            const nomes = [...g.usuarios].map(id => (_adminData.advogados || []).find(a => a.id === id)?.nome).filter(Boolean);
            const expl  = explicarErro(g.origem, g.exemplo);
            return `<tr>
              <td style="max-width:420px;">
                <code style="font-size:11px;background:#fef2f2;color:#991b1b;padding:2px 6px;border-radius:4px;">${esc(g.origem)}</code>
                <div style="font-size:12px;color:#374151;margin-top:4px;">${esc(g.exemplo)}</div>
                ${expl ? `<div style="font-size:11px;color:#6b6b63;margin-top:3px;"><i class="ti ti-bulb"></i> ${esc(expl)}</div>` : ''}
              </td>
              <td style="font-weight:600;">${g.n}</td>
              <td style="font-size:12px;" title="${esc(nomes.join(', '))}">${g.usuarios.size ? `${g.usuarios.size}${nomes.length ? ' · ' + esc(nomes.slice(0, 2).join(', ')) + (nomes.length > 2 ? '…' : '') : ''}` : '—'}</td>
              <td style="font-size:12px;white-space:nowrap;">${tempoRelativo(g.ultima)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
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
  const a = (_adminData.advogados || []).find(x => x.id === userId);
  if (bloquear && !confirm(`Bloquear o acesso de ${a?.nome || 'este usuário'}? Os dados ficam preservados e dá pra desbloquear depois.`)) return;
  const r = await chamarAdmin('toggle-status', { userId, bloquear });
  if (r.erro) return alert(r.erro);
  await recarregarDados();
  if (_fichaId === userId) abrirFicha(userId);
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

let _assinaturaEscritorioId = null;

function abrirAssinatura(id) {
  const a = (_adminData.advogados || []).find(x => x.id === id);
  if (!a) return;
  _assinaturaEscritorioId = id;

  document.getElementById('assin-quem').textContent = `${a.nome} · ${a.email}`;
  document.getElementById('assin-plano').value  = a.plano || 'mensal';
  document.getElementById('assin-status').value = a.statusAssinatura || 'ativo';
  document.getElementById('assin-expiracao').value = a.dataExpiracao ? a.dataExpiracao.slice(0, 10) : '';
  document.getElementById('assin-valor').value = a.valorPago ?? '';
  document.getElementById('assin-forma').value = a.formaPagamento || '';
  document.getElementById('assin-obs').value   = a.obsAssinatura || '';
  document.getElementById('assin-erro').style.display = 'none';
  document.getElementById('modal-assinatura').style.display = 'flex';
}
function fecharAssinatura() {
  document.getElementById('modal-assinatura').style.display = 'none';
  _assinaturaEscritorioId = null;
}

async function salvarAssinatura() {
  if (!_assinaturaEscritorioId) return;
  const plano          = document.getElementById('assin-plano').value;
  const status          = document.getElementById('assin-status').value;
  const dataExpiracao   = document.getElementById('assin-expiracao').value;
  const valorPagoStr    = document.getElementById('assin-valor').value.trim();
  const formaPagamento  = document.getElementById('assin-forma').value;
  const observacoes     = document.getElementById('assin-obs').value.trim();
  const erroEl = document.getElementById('assin-erro');
  const btn    = document.getElementById('assin-btn');
  erroEl.style.display = 'none';

  if (!dataExpiracao) {
    erroEl.textContent = 'Informe a validade.';
    erroEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';
  const r = await chamarAdmin('atualizar-assinatura', {
    escritorioId: _assinaturaEscritorioId,
    plano, status,
    dataExpiracao: new Date(dataExpiracao + 'T23:59:59').toISOString(),
    valorPago: valorPagoStr ? Number(valorPagoStr) : null,
    formaPagamento: formaPagamento || null,
    observacoes: observacoes || null,
  });
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-check"></i> Salvar';

  if (r.erro) {
    erroEl.textContent = r.erro;
    erroEl.style.display = 'block';
    return;
  }
  fecharAssinatura();
  await init();
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

async function sincronizarTodos(userId) {
  const btn    = document.getElementById('btn-sincronizar');
  const result = document.getElementById('sync-resultado');

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Sincronizando…';
  result.style.display = 'none';

  const body = userId ? { userId } : {};
  const r = await chamarAdmin('sincronizar-processos', body);

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-refresh"></i> DataJud agora';

  if (r.erro) {
    result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;margin-bottom:16px;';
    result.textContent = 'Erro: ' + r.erro;
    return;
  }

  result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#f0fdf4;color:#166534;border:1px solid #86efac;margin-bottom:16px;';
  const partes = [
    `<strong>${r.atualizados}</strong> processo(s) atualizados`,
    `<strong>${r.semMudanca}</strong> sem mudança`,
    r.naoEncontrado   ? `<strong>${r.naoEncontrado}</strong> não encontrado(s) no DataJud` : null,
    r.erros           ? `<strong>${r.erros}</strong> erro(s) de API` : null,
    `Total verificado: <strong>${r.total}</strong>`,
    r.reparados       ? `<em>${r.reparados} índice(s) CNJ preenchido(s)</em>` : null,
    r.emailsDisparados > 0 ? `📧 <strong>${r.emailsDisparados}</strong> e-mail(s) disparado(s) agora` : null,
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

// ── CADERNOS DJEN ──────────────────────────────────────────────────────────────

async function carregarDjenCadernos() {
  const wrap = document.getElementById('djen-tabela-wrap');
  wrap.innerHTML = '<p style="color:#9f9f98;padding:20px 0;">Carregando...</p>';

  const r = await fetch('/api/admin?acao=djen-cadernos', {
    headers: { 'Authorization': `Bearer ${_adminToken}` },
  });
  const data = await r.json();
  if (!data.ok) {
    wrap.innerHTML = `<p style="color:#c0392b;">Erro ao carregar: ${data.erro || 'desconhecido'}</p>`;
    return;
  }
  renderDjenCadernos(data.fila || []);
}

function renderDjenCadernos(fila) {
  const cont = s => fila.filter(f => f.status === s).length;
  document.getElementById('djen-stats-row').innerHTML = `
    <div class="sync-stat"><span class="sync-stat-val">${fila.length}</span><span class="sync-stat-lbl">Linhas (14 dias)</span></div>
    <div class="sync-stat sync-stat-blue"><span class="sync-stat-val">${cont('concluido')}</span><span class="sync-stat-lbl">Concluídos</span></div>
    <div class="sync-stat sync-stat-orange"><span class="sync-stat-val">${cont('pendente')}</span><span class="sync-stat-lbl">Pendentes</span></div>
    <div class="sync-stat ${cont('erro') > 0 ? 'sync-stat-orange' : ''}"><span class="sync-stat-val">${cont('erro')}</span><span class="sync-stat-lbl">Erros</span></div>
    <div class="sync-stat"><span class="sync-stat-val">${cont('processando')}</span><span class="sync-stat-lbl">Processando agora</span></div>
  `;

  const wrap = document.getElementById('djen-tabela-wrap');
  if (!fila.length) {
    wrap.innerHTML = '<p style="color:#9f9f98;text-align:center;padding:32px;">Nenhum registro ainda — a fila é populada na primeira execução do dia.</p>';
    return;
  }

  const corStatus = { concluido: '#166534', pendente: '#92400e', processando: '#1d4ed8', erro: '#991b1b' };
  const bgStatus  = { concluido: '#f0fdf4', pendente: '#fffbeb', processando: '#eff6ff', erro: '#fef2f2' };

  wrap.innerHTML = `
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead>
          <tr>
            <th>Tribunal</th><th>Data</th><th>Status</th><th>Comunicações</th>
            <th>Tentativas</th><th>Concluído em</th><th>Obs.</th>
          </tr>
        </thead>
        <tbody>
          ${fila.map(f => `
            <tr>
              <td><code style="font-size:11px;">${esc(f.tribunal)}</code></td>
              <td style="font-size:12px;">${f.data}</td>
              <td><span style="font-size:11px;background:${bgStatus[f.status] || '#f3f4f6'};color:${corStatus[f.status] || '#374151'};padding:2px 8px;border-radius:6px;">${esc(f.status)}</span></td>
              <td style="font-size:12px;">${f.comunicacoes_encontradas ?? '—'}</td>
              <td style="font-size:12px;">${f.tentativas}</td>
              <td style="font-size:12px;color:#6b7280;">${f.concluido_em ? new Date(f.concluido_em).toLocaleString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}</td>
              <td style="font-size:11px;color:#991b1b;max-width:260px;">${f.erro_msg ? esc(f.erro_msg) : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function rodarDjenCadernos() {
  const btn    = document.getElementById('btn-djen-cadernos');
  const result = document.getElementById('djen-resultado');

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Processando…';
  result.style.display = 'none';

  const r = await chamarAdmin('rodar-djen-cadernos', {});

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-play"></i> Processar próximo da fila';

  if (r.erro) {
    result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;margin-bottom:16px;';
    result.textContent = 'Erro: ' + r.erro;
    return;
  }

  const res = r.resultado || {};
  result.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:#f0fdf4;color:#166534;border:1px solid #86efac;margin-bottom:16px;';
  const lista = res.resultados || [];
  const achadas = lista.reduce((s, x) => s + (x.comunicacoesEncontradas || 0), 0);
  const comErro = lista.filter(x => x.erro);
  result.innerHTML = res.semPendencias
    ? 'Fila de hoje e ontem já está toda processada.'
    : `<strong>${lista.length}</strong> caderno(s) processado(s) em ${esc(res.elapsed || '')} · <strong>${achadas}</strong> publicação(ões) gravada(s)` +
      (comErro.length ? ` · <span style="color:#991b1b">${comErro.length} com erro (${esc(comErro[0].erro)})</span>` : '') +
      (lista.length && res.elapsed && parseInt(res.elapsed) >= 80 ? ' · ainda pode haver itens na fila, clique de novo' : '');
  if (comErro.length) result.style.background = '#fffbeb';
  carregarSaude();

  await carregarDjenCadernos();
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
