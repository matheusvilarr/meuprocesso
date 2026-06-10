document.getElementById('togglePw').addEventListener('click', function () {
  const input = document.getElementById('password');
  const hide  = input.type === 'password';
  input.type  = hide ? 'text' : 'password';
  this.innerHTML = hide ? iconEyeOff() : iconEye();
});

document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('btnSubmit');
  const emailErr = document.getElementById('emailError');
  const pwErr    = document.getElementById('passwordError');

  emailErr.classList.remove('show');
  pwErr.classList.remove('show');
  document.getElementById('email').classList.remove('error');
  document.getElementById('password').classList.remove('error');

  let ok = true;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailErr.textContent = 'Digite um e-mail válido.';
    emailErr.classList.add('show');
    document.getElementById('email').classList.add('error');
    ok = false;
  }
  if (!password || password.length < 6) {
    pwErr.textContent = 'A senha deve ter pelo menos 6 caracteres.';
    pwErr.classList.add('show');
    document.getElementById('password').classList.add('error');
    ok = false;
  }
  if (!ok) return;

  btn.classList.add('loading');
  btn.textContent = 'Entrando...';

  const { error } = await _supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = (error.message || '').toLowerCase().includes('invalid')
      ? 'E-mail ou senha incorretos.'
      : 'Erro ao entrar. Verifique suas credenciais.';
    pwErr.textContent = msg;
    pwErr.classList.add('show');
    document.getElementById('password').classList.add('error');
    btn.classList.remove('loading');
    btn.textContent = 'Entrar';
    return;
  }

  btn.textContent = 'Redirecionando...';
  window.location.href = '/dashboard';
});

function iconEye() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function iconEyeOff() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}
