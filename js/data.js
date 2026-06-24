/* ================================================================
   Real Molinos 3 — Sincronización Supabase
   Normaliza nombres de columna snake_case → camelCase
   ================================================================ */

function normalizeUser(u) {
  if (!u) return u;
  return { ...u,
    pass:         u.pass         || u.password_hash || '',
    password_hash:u.password_hash|| u.pass          || '',
    deptoStatus:  u.deptoStatus  || u.depto_status  || 'pending',
    depto_status: u.depto_status || u.deptoStatus   || 'pending',
  };
}
function normalizePayment(p) {
  if (!p) return p;
  return { ...p,
    residentId:   p.residentId   || p.resident_id   || null,
    residentName: p.residentName || p.resident_name || '',
    sentDate:     p.sentDate     || p.sent_date     || '',
    approvedDate: p.approvedDate || p.approved_date || null,
    paymentDate:  p.paymentDate  || p.payment_date  || null,
    receiptNum:   p.receiptNum   || p.receipt_num   || null,
    receiptUrl:   p.receiptUrl   || p.receipt_url   || null,
    voucherUrl:   p.voucherUrl   || p.voucher_url   || null,
    type:         p.type         || 'income',
    description:  p.description  || '',
    category:     p.category     || '',
    reference:    p.reference    || '',
    notes:        p.notes        || '',
    provider:     p.provider     || '',
  };
}
function normalizeNotification(n) {
  if (!n) return n;
  return { ...n,
    userId: n.userId !== undefined ? n.userId : n.user_id,
    user_id: n.user_id !== undefined ? n.user_id : n.userId,
    isRead: n.isRead !== undefined ? n.isRead : !!n.is_read,
    is_read: n.is_read !== undefined ? n.is_read : !!n.isRead,
  };
}

/* Construye DB.residents como vista de DB.users (solo no-admin) */
function syncResidentsFromUsers() {
  DB.residents = DB.users
    .filter(u => u.role !== 'admin')
    .map(u => ({
      ...u,
      status:  u.depto_status || u.deptoStatus || 'pending',
      userId:  u.id,
      user_id: u.id,
    }));
}

async function loadDB() {
  const sb = window.SUPABASE;
  if (!(sb && sb.config && sb.config().hasKey)) {
    console.warn('Supabase no configurado — usando datos locales vacíos');
    return;
  }
  try {
    const [users, payments, notifications, settingsRows] = await Promise.all([
      sb.listColumns('users', 'id,name,email,role,phone,depto,depto_status,fee,created_at'),
      sb.listColumns('payments', 'id,resident_id,resident_name,depto,month,amount,status,sent_date,approved_date,receipt_num,voucher_url,payment_date,receipt_url,type,description,category,reference,notes,provider'),
      sb.listColumns('notifications', 'id,user_id,message,is_read,created_at').catch(e => { console.warn('Tabla notifications no disponible', e); return []; }),
      sb.list('settings').catch(e => { console.warn('Tabla settings no disponible (corre la migración SQL)', e); return []; }),
    ]);
    DB.users         = (users         || []).map(normalizeUser);
    DB.payments      = (payments      || []).map(normalizePayment);
    DB.notifications = (notifications || []).map(normalizeNotification);
    syncResidentsFromUsers();

    const settingsRow = Array.isArray(settingsRows) && settingsRows.find(s => s.id === 1);
    if (settingsRow) {
      if (settingsRow.contacts && Object.keys(settingsRow.contacts).length) DB.contacts = settingsRow.contacts;
      if (settingsRow.default_fee != null) DB.settings.defaultFee = settingsRow.default_fee;
    }

    console.info('✅ DB cargada desde Supabase', {
      users: DB.users.length, residents: DB.residents.length,
      payments: DB.payments.length,
      notifications: DB.notifications.length
    });

    if (DB.users.length === 0)
      console.warn('⚠️ 0 usuarios — verifica que RLS esté desactivado en la tabla users');
  } catch (err) {
    console.error('❌ Error cargando Supabase', err);
  }
}

/* ── Helpers para insertar con mapeo de columnas ─────────────── */
function toDbPayment(obj, currentUser, depto) {
  return {
    resident_id:   currentUser.id,
    resident_name: currentUser.name,
    depto,
    month:         obj.month,
    amount:        obj.amount,
    status:        'pending',
    type:          'income',
    sent_date:     new Date().toISOString().split('T')[0],
    voucher_url:   obj.voucherUrl || null,
    payment_date:  obj.paymentDate || null,
  };
}

/* Ingreso/egreso registrado directamente por administración (sin residente/voucher) */
function toDbTransaction(obj) {
  return {
    type:          obj.type,
    amount:        obj.amount,
    description:   obj.description || '',
    category:      obj.category    || '',
    reference:     obj.reference   || '',
    notes:         obj.notes       || '',
    provider:      obj.provider    || '',
    status:        'approved',
    approved_date: obj.date,
    payment_date:  obj.date,
    sent_date:     obj.date,
  };
}

window.addEventListener('load', async () => {
  // Espera a que supabase-js restaure la sesión persistida (si la hay) ANTES
  // de cargar la DB — si no, loadDB() corre como anon, y con RLS endurecido
  // (users/payments restringidos a `authenticated`) esa primera carga llega
  // vacía aunque el usuario ya tenga sesión guardada en localStorage. Para un
  // login nuevo (sin sesión previa) loadDB() se repite en doLogin().
  const client = window.SUPABASE?.client?.();
  if (client) { try { await client.auth.getSession(); } catch(e) { console.warn('No se pudo verificar sesión previa', e); } }
  await loadDB();
  if (typeof restoreSession === 'function') restoreSession();
});
