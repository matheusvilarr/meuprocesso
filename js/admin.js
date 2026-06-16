let _adminToken = null;
let _adminData  = null;

async function init() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  _adminToken = session.access_token;

  const r = await fetch('/api/admin/dados', {
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

  renderAdvogados();
  renderCodigos();
  renderAdmins();
  setupTabs();
}

function setupTabs() {
  document.querySelectorAll('.adm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.adm-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.adm-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
    });
  });
}

function fmtData(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderAdvogados() {
  document.getElementById('adv-total').textContent = `${_adminData.advogados.length} cadastrado(s)`;
  document.getElementById('adv-tbody').innerHTML = _adminData.advogados.map(a => `
    <tr>
      <td>${a.nome}${a.nivelAdmin ? ' <span class="adm-badge" style="font-size:9px;vertical-align:middle;">' + a.nivelAdmin.toUpperCase() + '</span>' : ''}</td>
      <td>${a.email}</td>
      <td>${a.oab}</td>
      <td>${fmtData(a.criadoEm)}</td>
      <td>${a.ultimoLogin ? fmtData(a.ultimoLogin) : 'Nunca'}</td>
      <td>${a.numProcessos}</td>
      <td><span class="adm-status-pill ${a.bloqueado ? 'adm-status-bloqueado' : 'adm-status-ativo'}">${a.bloqueado ? 'Bloqueado' : 'Ativo'}</span></td>
      <td>
        <button class="adm-btn-small ${a.bloqueado ? 'ok' : 'danger'}" onclick="toggleStatus('${a.id}', ${!a.bloqueado})">
          ${a.bloqueado ? 'Desbloquear' : 'Bloquear'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="8" style="text-align:center;color:#9f9f98;">Nenhum advogado cadastrado.</td></tr>';
}

function renderCodigos() {
  document.getElementById('cod-tbody').innerHTML = (_adminData.codigos || []).map(c => `
    <tr>
      <td><code class="adm-code">${c.codigo}</code></td>
      <td>${c.descricao || '—'}</td>
      <td>${c.usos_atual}${c.usos_max != null ? ' / ' + c.usos_max : ''}</td>
      <td><span class="adm-status-pill ${c.ativo ? 'adm-status-ativo' : 'adm-status-bloqueado'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td>${fmtData(c.created_at)}</td>
      <td>
        <button class="adm-btn-small ${c.ativo ? 'danger' : 'ok'}" onclick="toggleCodigo('${c.id}', ${!c.ativo})">
          ${c.ativo ? 'Desativar' : 'Ativar'}
        </button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="text-align:center;color:#9f9f98;">Nenhum código gerado ainda.</td></tr>';
}

function renderAdmins() {
  const admins = _adminData.advogados.filter(a => a.nivelAdmin);
  document.getElementById('admins-tbody').innerHTML = admins.map(a => `
    <tr>
      <td>${a.nome}</td>
      <td>${a.email}</td>
      <td>${a.nivelAdmin}</td>
      <td>
        ${a.nivelAdmin !== 'super_admin' ? `<button class="adm-btn-small danger" onclick="removerAdmin('${a.email}')">Remover acesso</button>` : '<span style="color:#9f9f98;font-size:12px;">—</span>'}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center;color:#9f9f98;">Nenhum administrador.</td></tr>';
}

async function chamarAdmin(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_adminToken}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function toggleStatus(userId, bloquear) {
  const r = await chamarAdmin('/api/admin/toggle-status', { userId, bloquear });
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
  const r = await chamarAdmin('/api/admin/gerar-codigo', { descricao, usosMax });
  if (r.erro) return alert(r.erro);
  fecharGerarCodigo();
  await init();
}

async function toggleCodigo(id, ativo) {
  const r = await chamarAdmin('/api/admin/toggle-codigo', { id, ativo });
  if (r.erro) return alert(r.erro);
  await init();
}

async function promoverAdmin() {
  const email = document.getElementById('admin-email-input').value.trim();
  if (!email) return;
  const r = await chamarAdmin('/api/admin/gerenciar-admin', { email, acao: 'promover' });
  if (r.erro) return alert(r.erro);
  document.getElementById('admin-email-input').value = '';
  await init();
}

async function removerAdmin(email) {
  if (!confirm(`Remover acesso admin de ${email}?`)) return;
  const r = await chamarAdmin('/api/admin/gerenciar-admin', { email, acao: 'remover' });
  if (r.erro) return alert(r.erro);
  await init();
}

document.addEventListener('DOMContentLoaded', init);
