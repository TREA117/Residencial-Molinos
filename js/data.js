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
    receiptNum:   p.receiptNum   || p.receipt_num   || null,
    voucherUrl:   p.voucherUrl   || p.voucher_url   || null,
  };
}
function normalizeFinance(f) {
  if (!f) return f;
  return { ...f,
    desc:     f.desc     || f.description || '',
    cat:      f.cat      || f.category    || '',
    ref:      f.ref      || f.reference   || '',
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
    const [users, payments, finances, notifications] = await Promise.all([
      sb.list('users'),
      sb.list('payments'),
      sb.list('finances'),
      sb.list('notifications').catch(e => { console.warn('Tabla notifications no disponible', e); return []; }),
    ]);
    DB.users         = (users         || []).map(normalizeUser);
    DB.payments      = (payments      || []).map(normalizePayment);
    DB.finances      = (finances      || []).map(normalizeFinance);
    DB.notifications = (notifications || []).map(normalizeNotification);
    syncResidentsFromUsers();

    const maxId = Math.max(1,
      ...DB.users.map(u => Number(u.id)||0),
      ...DB.payments.map(p => Number(p.id)||0),
      ...DB.finances.map(f => Number(f.id)||0)
    );
    DB.nextId = maxId + 1;

    console.info('✅ DB cargada desde Supabase', {
      users: DB.users.length, residents: DB.residents.length,
      payments: DB.payments.length, finances: DB.finances.length,
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
    sent_date:     new Date().toISOString().split('T')[0],
    voucher_url:   obj.voucherUrl || null,
    payment_date:  obj.paymentDate || null,
  };
}

function toDbFinance(obj) {
  return {
    date:        obj.date,
    description: obj.desc || obj.description || '',
    category:    obj.cat  || obj.category    || '',
    type:        obj.type,
    amount:      obj.amount,
    reference:   obj.ref  || obj.reference   || '',
    notes:       obj.notes || '',
    cat:         obj.cat  || obj.category    || '',
    ref:         obj.ref  || obj.reference   || '',
  };
}

window.addEventListener('load', async () => {
  await loadDB();
  if (typeof restoreSession === 'function') restoreSession();
});
