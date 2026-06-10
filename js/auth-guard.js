(async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) {
    window.location.href = '/login';
    return;
  }
  window._session = session;
  window._user    = session.user;

  document.addEventListener('DOMContentLoaded', () => {
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
  });
})();
