(async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) {
    window.location.href = '/login';
    return;
  }
  window._session = session;

  // Verifica se o usuário logado é colaborador de algum escritório
  const { data: colab } = await _supabase
    .from('colaboradores')
    .select('escritorio_id, cargo, nivel_acesso')
    .eq('user_id', session.user.id)
    .eq('status', 'ativo')
    .maybeSingle();

  window._isColaborador   = !!colab;
  window._escritorioId    = colab ? colab.escritorio_id : session.user.id;
  window._colaboradorInfo = colab || null;
  window._user            = session.user;

  // Verifica se o usuário logado é admin (RLS só deixa ele ver a própria linha)
  const { data: adminRow } = await _supabase
    .from('admins')
    .select('nivel')
    .eq('user_id', session.user.id)
    .maybeSingle();
  window._isAdmin = !!adminRow;

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

  if (!window._isAdmin && !assinaturaValida) {
    // Sem nenhuma linha de assinatura (caso raro) → fluxo antigo de aprovação.
    // Com assinatura mas vencida (trial ou plano expirado) → tela de cobrança.
    window.location.href = assinatura ? '/assinatura-vencida' : '/aguardando';
    return;
  }

  const aplicarUI = () => {
    const meta    = session.user.user_metadata || {};
    const nome    = meta.full_name || meta.nome || session.user.email.split('@')[0];
    const email   = session.user.email;
    const cor     = meta.avatar_color || '#1a2e6b';
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
