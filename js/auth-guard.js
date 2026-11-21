// Mesma regra que o servidor usa para casar as publicações do DJEN
// (buscarOabsUsuarios em lib/sync-comum.js). Precisa de UF + número: uma OAB
// gravada só como "59360" não casa com nada, e o advogado fica sem receber
// intimação nenhuma sem entender por quê.
window._oabsValidas = function (raw) {
  return String(raw || '').split(',').map(s => s.trim()).filter(Boolean).map(o => {
    const m = o.toUpperCase().replace(/[.\-]/g, '').match(/^(?:OAB[/ ]?)?([A-Z]{2})[/ ]?(\d{3,7})$/);
    return m ? { uf: m[1], num: m[2].replace(/^0+/, '') } : null;
  }).filter(Boolean);
};

// GA: user_id + sign_up/trial_start na 1ª abertura do painel (vale pra e-mail,
// Google e LinkedIn — o OAuth não passa por nenhuma tela nossa antes daqui).
// A marca ga_signup no user_metadata evita contar de novo em outro aparelho.
// Junto grava a origem guardada pelo analytics.js, se o cadastro não trouxe.
function _registrarAnalytics(user, assinatura, gravandoAcesso) {
  if (window._isAdmin) {
    try { localStorage.setItem('mp_interno', '1'); } catch (_) {}
    window['ga-disable-G-S036MFTGEC'] = true;
    return;
  }
  if (typeof gtag !== 'function') return;
  const meta     = user.user_metadata || {};
  const provider = user.app_metadata?.provider || 'email';
  gtag('set', { user_id: user.id });
  if (meta.como_conheceu) gtag('set', 'user_properties', { acquisition_self_reported: meta.como_conheceu });

  let entrou = null;
  try { entrou = sessionStorage.getItem('mp_login'); sessionStorage.removeItem('mp_login'); } catch (_) {}

  const recente = Date.now() - Date.parse(user.created_at) < 3 * 86400 * 1000;
  if (!meta.ga_signup && recente) {
    gtag('event', 'sign_up', { method: provider, colaborador: window._isColaborador ? 'sim' : 'nao' });
    if (assinatura?.plano === 'trial') gtag('event', 'trial_start', { method: provider });
    const extra = { ga_signup: new Date().toISOString() };
    if (!meta.origem) {
      try { const o = JSON.parse(localStorage.getItem('mp_origem') || 'null'); if (o) extra.origem = o; } catch (_) {}
    }
    // Depois do ultimo_acesso: dois updateUser simultâneos podem se sobrescrever
    // no servidor, e sem a marca ga_signup o sign_up seria contado de novo.
    gravandoAcesso.then(() => _supabase.auth.updateUser({ data: extra })).then(() => {}, () => {});
  } else if (entrou) {
    gtag('event', 'login', { method: provider });
  }
}

(async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) {
    // Preserva pra onde a pessoa tentou ir (ex: link de e-mail com
    // ?abrir=busca-oab) — login.js já sabe ler esse "redirect" de volta.
    const destino = window.location.pathname + window.location.search;
    // Conta banida no Google OAuth volta pra cá com #error=...&error_code=
    // user_banned na hash (o redirectTo do botão Google aponta pra /dashboard
    // — mudar isso quebra o fluxo porque o Supabase só aceita URLs de retorno
    // que estão na allowlist dele). Sem repassar a hash, login.js nunca vê o
    // erro e a pessoa só cai numa tela de login limpa, sem explicação.
    window.location.href = '/login?redirect=' + encodeURIComponent(destino) + window.location.hash;
    return;
  }
  window._session = session;

  // colaboradores + admins em paralelo (independentes entre si)
  const [{ data: colab }, { data: adminRow }] = await Promise.all([
    _supabase.from('colaboradores')
      .select('escritorio_id, cargo, nivel_acesso')
      .eq('user_id', session.user.id)
      .eq('status', 'ativo')
      .maybeSingle(),
    _supabase.from('admins')
      .select('nivel')
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  window._isColaborador   = !!colab;
  window._escritorioId    = colab ? colab.escritorio_id : session.user.id;
  window._colaboradorInfo = colab || null;
  window._isAdmin         = !!adminRow;
  window._user            = session.user;

  // O Supabase só atualiza last_sign_in_at num login de verdade — quem fica
  // semanas logado (a sessão renova sozinha) aparecia no painel admin como se
  // nunca tivesse entrado. Registra o acesso no máximo 1x por hora (era 1x por
  // dia, e o painel admin mostrava o horário do PRIMEIRO acesso do dia, não do
  // último); o updateUser mescla o user_metadata, não sobrescreve os outros campos.
  const ultimoAcesso = Date.parse(session.user.user_metadata?.ultimo_acesso || '') || 0;
  let gravandoAcesso = Promise.resolve();
  if (Date.now() - ultimoAcesso > 3600 * 1000) {
    gravandoAcesso = _supabase.auth.updateUser({ data: { ultimo_acesso: new Date().toISOString() } })
      .then(() => {}, () => {});   // não bloqueia a abertura do dashboard
  }

  // Assinatura do escritório (trial ou plano pago) — sempre por escritorio_id,
  // nunca por session.user.id direto, pra colaborador herdar do titular.
  const { data: assinatura } = await _supabase
    .from('assinaturas')
    .select('plano, status, data_expiracao')
    .eq('escritorio_id', window._escritorioId)
    .maybeSingle();
  window._assinatura = assinatura;

  const assinaturaValida = !!assinatura && assinatura.status === 'ativo' &&
    new Date(assinatura.data_expiracao) > new Date();

  // Sem nenhuma linha de assinatura (caso raro) → fluxo antigo de aprovação.
  if (!window._isAdmin && !assinatura) {
    window.location.href = '/aguardando';
    return;
  }
  // Vencida, cancelada ou bloqueada: entra, mas só na "Minha Assinatura"
  // (escolher plano / pedir licença). Até 16/10/2026 ia pra /assinatura-vencida,
  // que no bloqueado só tinha "fale com a gente" — tela sem saída.
  window._acessoRestrito = !window._isAdmin && !assinaturaValida;

  // Quem entra pelo Google ou LinkedIn não traz OAB (só nome e e-mail), e sem
  // OAB o monitoramento do DJEN não encontra nada dessa pessoa — o dashboard
  // cobre o painel com a tela "Falta só sua OAB" até preencher (_mostrarTelaOAB).
  // Colaborador não precisa: ele acompanha a OAB do titular.
  window._oabPendente = !window._isColaborador &&
    window._oabsValidas(session.user.user_metadata?.oab).length === 0;

  _registrarAnalytics(session.user, assinatura, gravandoAcesso);

  // Sinaliza pro dashboard.js que o auth está pronto — evita setInterval polling
  document.dispatchEvent(new Event('authReady'));

  const aplicarUI = () => {
    const meta    = session.user.user_metadata || {};
    const nome    = meta.full_name || meta.nome || session.user.email.split('@')[0];
    const email   = session.user.email;
    const cor     = meta.avatar_color || '#053958';
    const fotoUrl = meta.avatar_url;

    const nameEl  = document.getElementById('sidebar-user-name');
    const emailEl = document.getElementById('sidebar-user-email');
    if (nameEl)  nameEl.textContent  = nome;
    if (emailEl) emailEl.textContent = email;

    const avatar = document.getElementById('sidebar-user-avatar');
    if (avatar) {
      if (fotoUrl) {
        avatar.innerHTML        = `<img src="${fotoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        avatar.style.background = 'transparent';
        avatar.style.overflow   = 'hidden';
      } else {
        const iniciais = nome.trim().split(' ').filter(Boolean).slice(0,2).map(p => p[0].toUpperCase()).join('');
        avatar.textContent      = iniciais || email[0].toUpperCase();
        avatar.style.background = cor;
      }
    }

    // Badge "Colaborador" na sidebar se aplicável
    if (window._isColaborador) {
      const colabBadge = document.getElementById('sidebar-colab-badge');
      if (colabBadge) {
        colabBadge.textContent   = colab.cargo || 'Colaborador';
        colabBadge.style.display = 'block';
      }
    }

    // Item "Painel Admin" na sidebar se aplicável
    if (window._isAdmin) {
      const navAdmin = document.getElementById('nav-item-admin');
      if (navAdmin) navAdmin.style.display = 'flex';
    }

    // Badge de trial/vencimento próximo — só aparece quando é trial ou
    // está perto de vencer, pra não poluir a sidebar quando está tudo bem.
    if (assinatura) {
      const diasRestantes = Math.ceil((new Date(assinatura.data_expiracao) - new Date()) / 86400000);
      const badge = document.getElementById('sidebar-assinatura-badge');
      if (badge && (assinatura.plano === 'trial' || diasRestantes <= 10)) {
        badge.textContent = assinatura.plano === 'trial'
          ? `Trial · ${Math.max(diasRestantes, 0)}d restantes`
          : `Plano vence em ${diasRestantes}d`;
        badge.className   = 'sidebar-assinatura-badge' + (diasRestantes <= 3 ? ' urgente' : '');
        badge.style.display = 'block';
        badge.onclick = (e) => { e.stopPropagation(); if (typeof showPage === 'function') showPage('assinatura'); };
      }
    }
  };

  // DOMContentLoaded pode já ter disparado antes das consultas assíncronas
  // acima terminarem — nesse caso o listener nunca seria chamado.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aplicarUI);
  } else {
    aplicarUI();
  }
})();
