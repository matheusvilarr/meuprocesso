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
  if (Date.now() - ultimoAcesso > 3600 * 1000) {
    _supabase.auth.updateUser({ data: { ultimo_acesso: new Date().toISOString() } })
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

  // Quem entra pelo Google não traz OAB (o Google só devolve nome e e-mail),
  // e sem OAB o monitoramento do DJEN não encontra nada dessa pessoa. Então o
  // primeiro acesso vai direto para o perfil e só sai de lá depois de
  // preencher. Colaborador não precisa: ele acompanha a OAB do titular.
  window._oabPendente = !window._isColaborador &&
    window._oabsValidas(session.user.user_metadata?.oab).length === 0;

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
