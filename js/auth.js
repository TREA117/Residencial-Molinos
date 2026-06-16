/* ================================================================
   Real Molinos 3 — Autenticación
   Registro: nombre, correo, teléfono, número de departamento
   ================================================================ */

let currentUser = null;

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
  // Validate depto format
  if (/\s/.test(depto) || depto !== depto.toUpperCase()) {
    showAlert('alertAuth', 'El número de departamento debe estar en mayúsculas y sin espacios (ej: 10H)', 'error'); return;
  }

  const newUser = {
    name, email, password_hash: pass, pass,
    phone, role: 'resident',
    depto, depto_status: 'pending', deptoStatus: 'pending', fee: 1500
  };

  try {
    const sb = window.SUPABASE;
    if (sb && sb.config().hasKey) {
      const { data, error } = await sb.insert('users', {
        name, email, password_hash: pass, phone, role: 'resident',
        depto, depto_status: 'pending', fee: 1500
      });
      if (error) throw error;
      // Also create resident record as pending
      await sb.insert('residents', {
        name, email, phone, depto, status: 'pending', fee: 1500,
        user_id: Array.isArray(data) ? data[0]?.id : data?.id || null
      });
      // Notify admin (in production: trigger email/push notification)
      console.info('📬 Nuevo registro pendiente de autorización:', name, depto);
    }
  } catch(err) {
    console.warn('Could not save to Supabase', err);
  }

  DB.users.push(newUser);
  showAlert('alertAuth', '✓ Registro enviado. El administrador recibirá una notificación para autorizar tu acceso.', 'success');
  switchAuth('login');
}

function loginUser(user) {
  // Normalize
  if (!user.deptoStatus  && user.depto_status)  user.deptoStatus  = user.depto_status;
  if (!user.depto_status && user.deptoStatus)   user.depto_status = user.deptoStatus;
  if (!user.pass         && user.password_hash) user.pass         = user.password_hash;

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
