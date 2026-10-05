// ── Sessão já ativa → não mostra o login ────────────────────────────────────
// pageshow (não só DOMContentLoaded) pra pegar também quando o navegador
// restaura /login do cache ao voltar (o script não roda de novo nesse caso)
window.addEventListener('pageshow', async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) {
    const params = new URLSearchParams(window.location.search);
    window.location.replace(params.get('redirect') || '/dashboard');
  }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  const isSignup = tab === 'signup';
  document.getElementById('loginForm').style.display  = isSignup ? 'none' : 'flex';
  document.getElementById('signupForm').style.display = isSignup ? 'flex' : 'none';
  document.getElementById('tabLogin').classList.toggle('active', !isSignup);
  document.getElementById('tabSignup').classList.toggle('active', isSignup);

  // O mesmo botão do Google serve para entrar e para criar conta (o OAuth
  // cria a conta sozinho na primeira vez). Só o texto muda, para quem está
  // na aba de cadastro entender que não precisa preencher o formulário.
  document.getElementById('btnGoogleTxt').textContent =
    isSignup ? 'Criar conta com Google' : 'Entrar com Google';
  document.getElementById('googleHint').style.display = isSignup ? 'block' : 'none';
  document.getElementById('trialBanner').style.display = isSignup ? 'block' : 'none';
}

if (new URLSearchParams(window.location.search).get('tab') === 'signup') {
  switchTab('signup');
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

document.getElementById('btnGoogle').addEventListener('click', async function () {
  this.disabled = true;
  // Trocar o textContent do botão apagaria o ícone do Google junto.
  document.getElementById('btnGoogleTxt').textContent = 'Redirecionando...';
  const destino = new URLSearchParams(window.location.search).get('redirect') || '/dashboard';
  await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + destino },
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

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
  const avisoAnterior = document.getElementById('avisoConfirmacao');
  if (avisoAnterior) avisoAnterior.style.display = 'none';

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
    const texto = (error.message || '').toLowerCase();
    btn.classList.remove('loading');
    btn.textContent = 'Entrar';

    // Caso mais comum logo depois do cadastro: a senha está CERTA, só falta
    // confirmar o e-mail. Dizer "verifique suas credenciais" aqui fazia a
    // pessoa achar que errou a senha, tentar de novo e desistir.
    if (texto.includes('not confirmed') || texto.includes('não confirmado')) {
      mostrarAvisoConfirmacao(email);
      return;
    }

    pwErr.textContent = texto.includes('invalid')
      ? 'E-mail ou senha incorretos.'
      : 'Não foi possível entrar agora. Tente de novo em instantes.';
    pwErr.classList.add('show');
    document.getElementById('password').classList.add('error');
    return;
  }

  btn.textContent = 'Redirecionando...';
  const params = new URLSearchParams(window.location.search);
  window.location.href = params.get('redirect') || '/dashboard';
});

// Explica o que realmente aconteceu e dá o caminho de saída ali mesmo, em vez
// de mandar a pessoa adivinhar ou tentar "esqueci minha senha" sem motivo.
function mostrarAvisoConfirmacao(email) {
  const caixa = document.getElementById('avisoConfirmacao');
  if (!caixa) return;
  caixa.innerHTML = `
    <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:14px 16px;margin-bottom:16px;text-align:left">
      <div style="font-size:13.5px;font-weight:700;color:#1e3a5f;margin-bottom:5px">Falta confirmar seu e-mail</div>
      <div style="font-size:12.5px;color:#1e40af;line-height:1.6">
        Sua senha está correta. Enviamos um link de confirmação para
        <strong>${email.replace(/[<>&"]/g, '')}</strong> — abra o e-mail e clique nele para entrar.
        <br><span style="color:#64748b">Não achou? Veja no lixo eletrônico ou promoções.</span>
      </div>
      <button type="button" id="btnReenviar" style="margin-top:11px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">
        Reenviar e-mail de confirmação
      </button>
      <div id="reenvioStatus" style="font-size:12px;color:#15803d;margin-top:9px;display:none"></div>
    </div>`;
  caixa.style.display = 'block';

  document.getElementById('btnReenviar').addEventListener('click', async function () {
    this.disabled = true;
    this.textContent = 'Enviando...';
    const { error } = await _supabase.auth.resend({ type: 'signup', email });
    const status = document.getElementById('reenvioStatus');
    status.style.display = 'block';
    if (error) {
      // O plano grátis do Supabase limita os envios por hora — dizer isso é
      // melhor do que a pessoa ficar clicando achando que está quebrado.
      status.style.color = '#b45309';
      status.textContent = /rate|limit|seconds/i.test(error.message || '')
        ? 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'
        : 'Não conseguimos reenviar agora: ' + error.message;
      this.disabled = false;
      this.textContent = 'Reenviar e-mail de confirmação';
      return;
    }
    status.style.color = '#15803d';
    status.textContent = 'E-mail reenviado. Confira a caixa de entrada e o lixo eletrônico.';
    this.textContent = 'E-mail reenviado';
  });
}

// ── Cadastro ──────────────────────────────────────────────────────────────────

document.getElementById('togglePwSu').addEventListener('click', function () {
  const input = document.getElementById('su-password');
  const hide  = input.type === 'password';
  input.type  = hide ? 'text' : 'password';
  this.innerHTML = hide ? iconEyeOff() : iconEye();
});

// Força da senha — avalia critérios e atualiza barra visual
function avaliarSenha(pw) {
  const criterios = [
    pw.length >= 8,
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^A-Za-z0-9]/.test(pw),
  ];
  return criterios.filter(Boolean).length; // 0–4
}

document.getElementById('su-password').addEventListener('input', function () {
  const score = avaliarSenha(this.value);
  const fill  = document.getElementById('pwStrengthFill');
  const label = document.getElementById('pwStrengthLabel');
  const cores  = ['#ef4444', '#f97316', '#eab308', '#22c55e'];
  const labels = ['Senha muito fraca', 'Senha fraca', 'Senha razoável', 'Senha forte'];

  if (!this.value) {
    fill.style.width = '0%';
    label.textContent = '';
    return;
  }

  fill.style.width      = (score * 25) + '%';
  fill.style.background = cores[score - 1] || '#ef4444';
  label.textContent     = labels[score - 1] || 'Senha muito fraca';
  label.style.color     = cores[score - 1] || '#ef4444';
});

// Impede que a mesma OAB (mesmo advogado) crie várias contas pra ganhar
// vários trials — checa contra as contas já cadastradas.
let _oabDuplicadaSu   = false;
let _oabUltimaCheckSu = '';
let _oabTimerSu       = null;

document.getElementById('su-uf').addEventListener('change', agendarCheckOabSu);
document.getElementById('su-oab-num').addEventListener('input', agendarCheckOabSu);

function agendarCheckOabSu() {
  clearTimeout(_oabTimerSu);
  const uf  = document.getElementById('su-uf').value.trim().toUpperCase();
  const num = document.getElementById('su-oab-num').value.trim().replace(/\D/g, '');
  if (!uf || num.length < 3) return;
  _oabTimerSu = setTimeout(() => checarOabSu(`${uf}${num}`), 600);
}

async function checarOabSu(oab) {
  try {
    const r = await fetch('/api/verificar-oab?oab=' + encodeURIComponent(oab));
    const { existe } = await r.json();
    _oabDuplicadaSu   = !!existe;
    _oabUltimaCheckSu = oab;
    const err = document.getElementById('suOabError');
    if (_oabDuplicadaSu) {
      err.textContent = 'Esse número de OAB já tem uma conta cadastrada. Já tem conta? Faça login.';
      err.classList.add('show');
    } else {
      err.classList.remove('show');
    }
  } catch (_) {}
}

document.getElementById('signupForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const nome     = document.getElementById('su-nome').value.trim();
  const email    = document.getElementById('su-email').value.trim();
  const uf       = document.getElementById('su-uf').value.trim().toUpperCase();
  const oabNum   = document.getElementById('su-oab-num').value.trim().replace(/\D/g, '');
  const telefone = document.getElementById('su-telefone').value.trim().replace(/\D/g, '');
  const password = document.getElementById('su-password').value;
  const btn      = document.getElementById('btnSignup');

  const nomeErr  = document.getElementById('suNomeError');
  const emailErr = document.getElementById('suEmailError');
  const oabErr   = document.getElementById('suOabError');
  const telErr   = document.getElementById('suTelError');
  const pwErr    = document.getElementById('suPwError');

  [nomeErr, emailErr, oabErr, telErr, pwErr].forEach(el => el.classList.remove('show'));
  document.getElementById('su-uf').classList.remove('error');

  let ok = true;

  if (!nome) {
    nomeErr.textContent = 'Digite seu nome completo.';
    nomeErr.classList.add('show');
    ok = false;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailErr.textContent = 'Digite um e-mail válido.';
    emailErr.classList.add('show');
    ok = false;
  }
  if (!uf) {
    oabErr.textContent = 'Selecione o estado da OAB.';
    oabErr.classList.add('show');
    document.getElementById('su-uf').classList.add('error');
    ok = false;
  } else if (!oabNum || oabNum.length < 3) {
    oabErr.textContent = 'Digite o número da OAB (somente números).';
    oabErr.classList.add('show');
    ok = false;
  }
  if (!telefone || telefone.length < 10) {
    telErr.textContent = 'Digite um telefone válido com DDD.';
    telErr.classList.add('show');
    ok = false;
  }

  const score = avaliarSenha(password);
  if (!password || score < 3) {
    pwErr.textContent = 'Senha fraca. Use 8+ caracteres, maiúscula, número e símbolo.';
    pwErr.classList.add('show');
    ok = false;
  }

  if (!ok) return;

  const oab = `${uf}${oabNum}`;

  // Recheca a OAB se o campo mudou desde a última verificação.
  if (oab !== _oabUltimaCheckSu) {
    btn.classList.add('loading');
    btn.textContent = 'Verificando OAB...';
    await checarOabSu(oab);
  }
  if (_oabDuplicadaSu) {
    btn.classList.remove('loading');
    btn.textContent = 'Criar conta';
    return;
  }

  btn.classList.add('loading');
  btn.textContent = 'Criando conta...';

  const { data, error } = await _supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: nome, nome, oab, telefone },
      emailRedirectTo: window.location.origin + '/dashboard',
    },
  });

  btn.classList.remove('loading');

  if (error) {
    pwErr.textContent = error.message.includes('already registered')
      ? 'Este e-mail já tem uma conta. Faça login.'
      : 'Erro ao criar conta: ' + error.message;
    pwErr.classList.add('show');
    btn.textContent = 'Criar conta';
    return;
  }

  if (data.session) {
    window.location.href = '/dashboard';
    return;
  }

  btn.style.display = 'none';
  document.getElementById('signupSuccess').style.display = 'block';
});

// ── Ícones ────────────────────────────────────────────────────────────────────

function iconEye() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function iconEyeOff() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}
