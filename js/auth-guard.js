(async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  window._session = session;
  window._user    = session.user;

  document.addEventListener('DOMContentLoaded', () => {
    const meta = session.user.user_metadata || {};
    const nome  = meta.nome || session.user.email.split('@')[0];
    const email = session.user.email;

    const nameEl  = document.getElementById('sidebar-user-name');
    const emailEl = document.getElementById('sidebar-user-email');
    if (nameEl)  nameEl.textContent  = nome;
    if (emailEl) emailEl.textContent = email;
  });
})();
