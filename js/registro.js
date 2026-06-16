let _codigoValidado = false;
let _codigoTimer   = null;

// Toggle olho da senha
document.getElementById('togglePwReg').addEventListener('click', function () {
  const input = document.getElementById('reg-senha');
  const hide  = input.type === 'password';
  input.type  = hide ? 'text' : 'password';
  this.innerHTML = hide ? iconEyeOff() : iconEye();
});

// Valida código ao sair do campo (debounce 600ms)
document.getElementById('reg-codigo').addEventListener('input', function () {
  _codigoValidado = false;
  const icon = document.getElementById('codigo-check-icon');
  icon.className = 'codigo-check';
  clearTimeout(_codigoTimer);
  const codigo = this.value.trim();
  if (codigo.length < 3) return;
  _codigoTimer = setTimeout(() => validarCodigo(codigo), 600);
});

async function validarCodigo(codigo) {
  try {
    const r = await fetch('/api/codigo-acesso?acao=validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo }),
    });
    const { valido } = await r.json();
    _codigoValidado = valido;
    const icon = document.getElementById('codigo-check-icon');
    icon.textContent = valido ? '✓' : '✗';
    icon.className   = `codigo-check ${valido ? 'ok' : 'err'}`;
    const err = document.getElementById('codigoError');
    if (!valido) {
      err.textContent = 'Código inválido ou inativo.';
      err.classList.add('show');
    } else {
      err.classList.remove('show');
    }
  } catch (_) {}
}

document.getElementById('registroForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const nome   = document.getElementById('reg-nome').value.trim();
  const email  = document.getElementById('reg-email').value.trim();
  const oab    = document.getElementById('reg-oab').value.trim();
  const codigo = document.getElementById('reg-codigo').value.trim();
  const senha  = document.getElementById('reg-senha').value;
  const btn    = document.getElementById('btnRegistro');

  // Limpa erros
  ['nome','email','oab','codigo','senha'].forEach(f => {
    document.getElementById(f + 'Error').classList.remove('show');
  });

  let ok = true;

  if (!nome) {
    mostrarErro('nomeError', 'Informe seu nome completo.'); ok = false;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    mostrarErro('emailError', 'Digite um e-mail válido.'); ok = false;
  }
  if (!oab) {
    mostrarErro('oabError', 'OAB é obrigatória para usar o sistema.'); ok = false;
  }
  if (!senha || senha.length < 6) {
    mostrarErro('senhaError', 'A senha deve ter pelo menos 6 caracteres.'); ok = false;
  }

  // Valida código se ainda não foi validado
  if (!_codigoValidado) {
    if (!codigo) {
      mostrarErro('codigoError', 'Informe o código de acesso.'); ok = false;
    } else {
      btn.classList.add('loading');
      btn.textContent = 'Verificando código...';
      await validarCodigo(codigo);
      if (!_codigoValidado) {
        btn.classList.remove('loading');
        btn.textContent = 'Criar conta';
        return;
      }
    }
  }

  if (!ok) return;

  btn.classList.add('loading');
  btn.textContent = 'Criando conta...';

  const { error } = await _supabase.auth.signUp({
    email,
    password: senha,
    options: {
      data: { full_name: nome, nome, oab },
      emailRedirectTo: `${window.location.origin}/cadastro-confirmado`,
    },
  });

  if (error) {
    btn.classList.remove('loading');
    btn.textContent = 'Criar conta';
    if (error.message?.toLowerCase().includes('already registered')) {
      mostrarErro('emailError', 'Este e-mail já possui uma conta. Tente fazer login.');
    } else {
      mostrarErro('emailError', 'Erro ao criar conta: ' + error.message);
    }
    return;
  }

  // Registra o uso do código (não bloqueia o fluxo se falhar)
  fetch('/api/codigo-acesso?acao=registrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
  }).catch(() => {});

  // Sucesso — mostra caixa de confirmação
  document.getElementById('registroForm').style.display = 'none';
  document.getElementById('registro-links').style.display = 'none';
  document.getElementById('sucesso-email').textContent = email;
  document.getElementById('sucesso-box').style.display = 'block';
});

function mostrarErro(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}

function iconEye() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function iconEyeOff() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}
