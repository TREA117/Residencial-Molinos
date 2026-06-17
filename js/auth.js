/* ================================================================
   Real Molinos 3 — Autenticación
   Registro: nombre, correo, teléfono, número de departamento
   ================================================================ */

let currentUser = null;

/* ── Sesión persistente con timeout de inactividad ─────────── */
const SESSION_KEY    = 'rm3_session';
const INACTIVITY_MS  = 10 * 60 * 1000; // 10 minutos
let inactivityTimer  = null;

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, ts: Date.now() }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    doLogout();
    showAlert('alertAuth', 'Sesión cerrada por inactividad (10 min)', 'info');
  }, INACTIVITY_MS);
  // Actualizar timestamp en storage para que sea válido al recargar
  if (currentUser) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: currentUser, ts: Date.now() }));
  }
}

function startInactivityWatch() {
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev =>
    document.addEventListener(ev, resetInactivityTimer, { passive: true })
  );
  resetInactivityTimer();
}

function stopInactivityWatch() {
  clearTimeout(inactivityTimer);
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev =>
    document.removeEventListener(ev, resetInactivityTimer)
  );
}

function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  try {
    const { user, ts } = JSON.parse(raw);
    if (!user || (Date.now() - ts) > INACTIVITY_MS) { clearSession(); return; }
    loginUser(user);
  } catch(e) { clearSession(); }
}

function switchAuth(mode) {
  ['Login', 'OTP', 'Register'].forEach(m =>
    document.getElementById('form' + m).classList.add('hidden')
  );
  document.getElementById('form' + mode.charAt(0).toUpperCase() + mode.slice(1))
    .classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', i === (mode === 'login' || mode === 'otp' ? 0 : 1))
  );
}

function showOTP() {
  document.getElementById('formLogin').classList.add('hidden');
  document.getElementById('formOTP').classList.remove('hidden');
}

function sendOTP() {
  const v = document.getElementById('otpContact').value.trim();
  if (!v) { showAlert('alertAuth', 'Ingresa correo o teléfono', 'error'); return; }
  document.getElementById('otpCodeField').classList.remove('hidden');
  showAlert('alertAuth', 'Código enviado a ' + v + ' (demo: 123456)', 'info');
}

function verifyOTP() {
  const code = document.getElementById('otpCode').value.trim();
  if (code === '123456') { loginUser(DB.users[0]); }
  else { showAlert('alertAuth', 'Código incorrecto', 'error'); }
}

function matchesPassword(user, pass) {
  const c = String(pass).trim();
  const s = String(user.password_hash || user.pass || '').trim();
  return s === c;
}

async function tryRemoteLogin(email, pass) {
  try {
    const client = window.SUPABASE?.client?.();
    if (!client) return null;
    const { data, error } = await client.from('users').select('*').eq('email', email).limit(1);
    if (error) { console.warn('Remote login error', error); return null; }
    const u = Array.isArray(data) && data[0] ? data[0] : null;
    if (!u) return null;
    if (!u.pass && u.password_hash) u.pass = u.password_hash;
    if (!u.deptoStatus && u.depto_status) u.deptoStatus = u.depto_status;
    return matchesPassword(u, pass) ? u : null;
  } catch (err) { console.error('tryRemoteLogin failed', err); return null; }
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('loginPass').value.trim();
  let user = DB.users.find(u => String(u.email||'').trim().toLowerCase() === email && matchesPassword(u, pass));
  if (!user) {
    const remote = await tryRemoteLogin(email, pass);
    if (remote) { try { DB.users.push(remote); } catch(e){} user = remote; }
  }
  if (!user) { showAlert('alertAuth', 'Credenciales incorrectas', 'error'); return; }
  loginUser(user);
}

async function doRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const depto = document.getElementById('regDepto').value.trim().toUpperCase().replace(/\s+/g, '');
  const pass  = document.getElementById('regPass').value;

  if (!name || !email || !phone || !depto || !pass) {
    showAlert('alertAuth', 'Completa todos los campos', 'error'); return;
  }

  const sb = window.SUPABASE;
  if (!sb) { showAlert('alertAuth', 'Error de conexión con el servidor', 'error'); return; }

  const btn = document.querySelector('#formRegister .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

  try {
    // Insertar usuario en Supabase directamente
    const userData = await sb.insert('users', {
      name, email, password_hash: pass, phone, role: 'resident',
      depto, depto_status: 'pending', fee: 1500
    });

    // Agregar al array local y sincronizar residents
    if (Array.isArray(userData) && userData[0]) {
      const newUser = { ...userData[0], deptoStatus: 'pending', depto_status: 'pending', pass };
      DB.users.push(newUser);
      if (typeof syncResidentsFromUsers === 'function') syncResidentsFromUsers();
    }

    console.info('📬 Nuevo registro pendiente de autorización:', name, depto);
    showAlert('alertAuth', '✓ Registro enviado. El administrador autorizará tu acceso.', 'success');
    switchAuth('login');
  } catch(err) {
    console.error('Registration error', err);
    const msg = (err?.message || '').toLowerCase().includes('duplicate') || (err?.message || '').includes('unique')
      ? 'Ese correo ya está registrado.'
      : (err?.message || 'Error al registrar, intenta de nuevo.');
    showAlert('alertAuth', msg, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Solicitar acceso'; }
  }
}

function loginUser(user) {
  // Normalize
  if (!user.deptoStatus  && user.depto_status)  user.deptoStatus  = user.depto_status;
  if (!user.depto_status && user.deptoStatus)   user.depto_status = user.deptoStatus;
  if (!user.pass         && user.password_hash) user.pass         = user.password_hash;
  saveSession(user);
  startInactivityWatch();

  currentUser = user;
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  document.getElementById('sidebarName').textContent = user.name;
  document.getElementById('sidebarRole').textContent =
    user.role === 'admin' ? 'Administrador' : 'Depto ' + (user.depto || '—');
  document.getElementById('dashWelcome').textContent = 'Bienvenido, ' + user.name;

  if (user.role === 'admin') {
    document.getElementById('navAdminFull').classList.remove('hidden');
    document.getElementById('navAdminFull').style.display = 'block';
    document.getElementById('navAdmin').classList.remove('hidden');
    document.getElementById('navAdmin').style.display = 'block';
    document.getElementById('navResident').classList.add('hidden');
    goTo('dashboard');
  } else {
    // Check if user is authorized
    const status = user.deptoStatus || user.depto_status || 'pending';
    if (status === 'pending') {
      showPendingApproval();
      return;
    }
    if (status === 'rejected') {
      doLogout();
      showAlert('alertAuth', 'Tu acceso ha sido rechazado. Contacta a administración.', 'error');
      return;
    }
    document.getElementById('navAdminFull').classList.add('hidden');
    document.getElementById('navResident').classList.remove('hidden');
    document.getElementById('navResident').style.display = 'block';
    goTo('myPayments');
  }
  updatePendingCounts();
}

function showPendingApproval() {
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('formLogin').classList.add('hidden');
  document.getElementById('formOTP').classList.add('hidden');
  document.getElementById('formRegister').classList.add('hidden');
  const pending = document.getElementById('formPendingApproval');
  if (pending) pending.classList.remove('hidden');
  else {
    showAlert('alertAuth',
      '⏳ Tu cuenta está pendiente de autorización por administración. Te notificaremos cuando tengas acceso.',
      'info'
    );
  }
}

function doLogout() {
  clearSession();
  stopInactivityWatch();
  currentUser = null;
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('formLogin').classList.remove('hidden');
  document.getElementById('formOTP').classList.add('hidden');
  document.getElementById('formRegister').classList.add('hidden');
  const pending = document.getElementById('formPendingApproval');
  if (pending) pending.classList.add('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  ['navAdmin','navAdminFull','navResident'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}
