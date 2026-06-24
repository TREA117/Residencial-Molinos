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
  ['Login', 'Register'].forEach(m =>
    document.getElementById('form' + m).classList.add('hidden')
  );
  document.getElementById('form' + mode.charAt(0).toUpperCase() + mode.slice(1))
    .classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', i === (mode === 'login' ? 0 : 1))
  );
}

async function fetchProfileByEmail(email) {
  try {
    const client = window.SUPABASE?.client?.();
    if (!client) return null;
    const { data, error } = await client.from('users').select('*').eq('email', email).limit(1);
    if (error) { console.warn('fetchProfileByEmail error', error); return null; }
    const u = Array.isArray(data) && data[0] ? data[0] : null;
    if (u && !u.deptoStatus && u.depto_status) u.deptoStatus = u.depto_status;
    return u;
  } catch (err) { console.error('fetchProfileByEmail failed', err); return null; }
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('loginPass').value.trim();
  const client = window.SUPABASE?.client?.();
  if (!client) { showAlert('alertAuth', 'Error de conexión con el servidor', 'error'); return; }

  const { error: authError } = await client.auth.signInWithPassword({ email, password: pass });
  if (authError) {
    // La confirmación de correo siempre la hace el administrador (al
    // autorizar el depto, o al vincular una cuenta vieja) — nunca se
    // confirma sola al registrarse. Ver confirm_user_email/reconcile_user_auth_id
    // en supabase-migration-auth-native.sql.
    if (authError.code === 'email_not_confirmed') {
      showAlert('alertAuth', 'Tu cuenta está pendiente de confirmación por el administrador.', 'error');
      return;
    }
    // Cuenta de antes de la migración (tiene legacy_id) que todavía no
    // pasó por "Crear cuenta" — no existe su identidad en Supabase Auth,
    // así que signInWithPassword siempre va a fallar hasta que se vincule.
    const profile = await fetchProfileByEmail(email);
    if (profile && profile.legacy_id != null && !profile.auth_synced) {
      showAlert('alertAuth', 'Esta cuenta es de antes de la migración. Usa "Crear cuenta" con este mismo correo y tu contraseña para vincularla.', 'error');
      return;
    }
    showAlert('alertAuth', 'Credenciales incorrectas', 'error');
    return;
  }

  const user = await fetchProfileByEmail(email);
  if (!user) {
    showAlert('alertAuth', 'No se encontró un perfil para esta cuenta. Contacta al administrador.', 'error');
    return;
  }
  // La carga inicial en window.load corrió como anon (antes de este login) y
  // bajo RLS endurecido eso deja DB.users/payments/notifications vacíos —
  // se recargan ahora que sí hay sesión autenticada.
  if (typeof loadDB === 'function') await loadDB();
  if (!DB.users.find(u => String(u.email||'').trim().toLowerCase() === email)) {
    try { DB.users.push(user); } catch(e){}
  }
  loginUser(user);
}

// `existing` se busca por email ANTES de insertar: una cuenta que ya tenía
// fila en `users` (ej. admin@molino.com, migrada del esquema viejo) solo
// necesita crear su identidad en auth.users — la fila de perfil ya existe
// y se reconcilia aparte con supabase-migration-auth-native.sql, no aquí.
async function doRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const phone = document.getElementById('regPhone').value.trim();
  const depto = document.getElementById('regDepto').value.trim().toUpperCase().replace(/\s+/g, '');
  const pass  = document.getElementById('regPass').value;

  if (!name || !email || !pass) {
    showAlert('alertAuth', 'Completa nombre, correo y contraseña', 'error'); return;
  }

  const client = window.SUPABASE?.client?.();
  if (!client) { showAlert('alertAuth', 'Error de conexión con el servidor', 'error'); return; }

  const btn = document.querySelector('#formRegister .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

  try {
    const existing = await fetchProfileByEmail(email);

    const { data, error } = await client.auth.signUp({ email, password: pass });
    if (error) throw error;

    if (existing) {
      const { error: rpcError } = await client.rpc('reconcile_user_auth_id', {
        p_old_id: existing.id,
        p_new_id: data.user.id,
      });
      if (rpcError) throw rpcError;
      showAlert('alertAuth', '✓ Tu cuenta existente fue vinculada automáticamente. Ya puedes iniciar sesión.', 'success');
      switchAuth('login');
      return;
    }

    if (!depto) { showAlert('alertAuth', 'El número de departamento es requerido', 'error'); return; }

    const userData = await window.SUPABASE.insert('users', {
      id: data.user.id, name, email, phone, role: 'resident',
      depto, depto_status: 'pending', fee: DB.settings?.defaultFee || 400
    });

    if (Array.isArray(userData) && userData[0]) {
      const newUser = { ...userData[0], deptoStatus: 'pending', depto_status: 'pending' };
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
  document.getElementById('formRegister').classList.add('hidden');
  const pending = document.getElementById('formPendingApproval');
  if (pending) pending.classList.add('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  ['navAdmin','navAdminFull','navResident'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}
