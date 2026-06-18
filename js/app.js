/* ================================================================
   Real Molinos 3 — Vistas de Residente
   ================================================================ */

const fmt     = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const fmtDate = d => { try { return new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }); } catch(e){ return d||'—'; } };
let chartFlow = null, chartDist = null;

/* ── DEMO LOGIN HELPER ──────────────────────────────────────── */
function fillLogin(email, pass) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPass').value  = pass;
}

/* ── NAVIGATION ────────────────────────────────────────────── */
async function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1));
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick')?.includes("'" + page + "'")) n.classList.add('active');
  });

  // Recargar usuarios frescos de Supabase al abrir la sección de residentes
  if (page === 'residents') {
    const sb = window.SUPABASE;
    if (sb && sb.config && sb.config().hasKey) {
      try {
        const users = await sb.list('users');
        if (users) {
          DB.users = users.map(u => ({
            ...u,
            deptoStatus:   u.deptoStatus  || u.depto_status  || 'pending',
            depto_status:  u.depto_status || u.deptoStatus   || 'pending',
            pass:          u.pass         || u.password_hash || '',
          }));
          if (typeof syncResidentsFromUsers === 'function') syncResidentsFromUsers();
        }
      } catch(e) { console.warn('reload users failed', e); }
    }
  }

  const renders = {
    dashboard:  renderDashboard,
    residents:  renderResidents,
    payments:   renderPayments,
    vouchers:   renderVouchers,
    finances:   renderFinances,
    reports:    renderReports,
    myPayments: renderMyPayments,
    myAccount:  renderMyAccount,
    contacts:   renderContacts,
    editContacts: renderEditContacts,
  };
  if (renders[page]) renders[page]();
}

function updatePendingCounts() {
  const pRes = DB.residents.filter(r => r.status === 'pending').length;
  const pPay = DB.payments.filter(p => p.status === 'pending').length;
  ['pendingResCount','pendingResCount2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = pRes; el.classList.toggle('hidden', pRes === 0); }
  });
  ['pendingPayCount','pendingPayCount2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = pPay; el.classList.toggle('hidden', pPay === 0); }
  });
}

/* ── PAYMENT DAY BANNER (days 1-10 of month) ──────────────── */
function checkPaymentBanner() {
  const today = new Date();
  const day   = today.getDate();
  const banner = document.getElementById('paymentDayBanner');
  if (!banner || !currentUser || currentUser.role === 'admin') return;
  if (day >= 1 && day <= 10) {
    const res = DB.residents.find(r =>
      r.userId === currentUser.id || r.user_id === currentUser.id || r.email === currentUser.email
    );
    const fee = res?.fee || currentUser.fee || 1500;
    const monthName = today.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="payment-alert-banner">
        <div class="payment-alert-icon">🗓️</div>
        <div class="payment-alert-text">
          <div class="payment-alert-title">Período de pago activo — días 1 al 10</div>
          <div class="payment-alert-sub">Tu cuota de mantenimiento de ${monthName} es <strong>${fmt(fee)}</strong>. Realiza tu pago antes del día 10.</div>
        </div>
        <button class="btn btn-gold btn-sm" onclick="openModalUploadPayment()">Pagar ahora</button>
      </div>`;
  } else {
    banner.classList.add('hidden');
  }
}

/* ── MY PAYMENTS (resident home) ───────────────────────────── */
function renderMyPayments() {
  if (!currentUser) return;
  checkPaymentBanner();

  const res = DB.residents.find(r =>
    r.userId === currentUser.id || r.user_id === currentUser.id || r.email === currentUser.email
  );
  const depto  = res?.depto  || currentUser.depto  || '—';
  const status = res?.status || currentUser.deptoStatus || currentUser.depto_status || (currentUser.depto ? 'approved' : 'pending');
  const fee    = res?.fee    || currentUser.fee    || 1500;

  const deptoNumEl    = document.getElementById('resDeptoNum');
  const deptoStatusEl = document.getElementById('resDeptoStatus');
  const feeEl         = document.getElementById('resFeeDisplay');
  const ctaEl         = document.getElementById('uploadCTAArea');
  const alertEl       = document.getElementById('deptoVerifAlert');

  if (deptoNumEl)    deptoNumEl.textContent    = 'Depto ' + depto;
  if (deptoStatusEl) deptoStatusEl.textContent = status === 'approved' ? '✓ Verificado' : '⏳ Pendiente de verificación';
  if (feeEl)         feeEl.textContent         = fmt(fee);

  const isApproved = status === 'approved';
  if (!isApproved) {
    if (alertEl) alertEl.innerHTML = '<div class="alert alert-info">Tu departamento está en proceso de verificación. El administrador te notificará cuando tengas acceso.</div>';
    if (ctaEl)   { ctaEl.style.opacity = '0.4'; ctaEl.style.pointerEvents = 'none'; }
  } else {
    if (alertEl) alertEl.innerHTML = '';
    if (ctaEl)   { ctaEl.style.opacity = '1'; ctaEl.style.pointerEvents = 'auto'; }
  }

  const notifEl = document.getElementById('userNotifications');
  if (notifEl) {
    const myNotifs = DB.notifications.filter(n =>
      (n.userId === currentUser.id || n.user_id === currentUser.id) && !n.isRead && !n.is_read
    );
    notifEl.innerHTML = myNotifs.map(n => `
      <div class="alert alert-error" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <span>🔔 ${n.message}</span>
        <button class="btn btn-secondary btn-sm" onclick="markNotificationRead(${n.id})">Marcar como leído</button>
      </div>`).join('');
  }

  const myPays = DB.payments.filter(p =>
    p.residentId === currentUser.id || p.resident_id === currentUser.id ||
    p.residentName === currentUser.name || p.resident_name === currentUser.name
  );
  const tbody = document.getElementById('tblMyPayments');
  if (tbody) {
    tbody.innerHTML = myPays
      .sort((a, b) => new Date(b.sentDate||b.sent_date) - new Date(a.sentDate||a.sent_date))
      .map(p => `<tr>
        <td>${p.month||'—'}</td>
        <td>${fmt(p.amount)}</td>
        <td>${p.paymentDate || p.payment_date ? fmtDate(p.paymentDate||p.payment_date) : '—'}</td>
        <td>${fmtDate(p.sentDate||p.sent_date)}</td>
        <td><span class="badge ${p.status==='approved'?'badge-approved':p.status==='pending'?'badge-pending':'badge-rejected'}">${p.status==='approved'?'Aprobado':p.status==='pending'?'En revisión':'Rechazado'}</span></td>
        <td>${(p.receiptNum||p.receipt_num)
          ? `<button class="btn btn-secondary btn-sm" onclick="showReceipt(${p.id})">${p.receiptNum||p.receipt_num}</button>`
          : '—'}</td>
      </tr>`).join('') ||
      '<tr><td colspan="6" style="text-align:center;color:var(--mist);padding:1.5rem">Sin pagos registrados</td></tr>';
  }
}

async function markNotificationRead(id) {
  const n = DB.notifications.find(n=>n.id===id);
  if (!n) return;
  try {
    await window.SUPABASE.update('notifications', id, { is_read: true });
    n.isRead = true; n.is_read = true;
  } catch(e) {
    console.error('Supabase mark notification read failed', e);
    showToast('Error al actualizar notificación','error');
    return;
  }
  renderMyPayments();
}

/* ── MY ACCOUNT STATEMENT (estado de cuenta) ───────────────── */
function renderMyAccount() {
  if (!currentUser) return;
  const myPays = DB.payments.filter(p =>
    p.residentId === currentUser.id || p.resident_id === currentUser.id ||
    p.residentName === currentUser.name || p.resident_name === currentUser.name
  );
  const approved = myPays.filter(p => p.status === 'approved');
  const pending  = myPays.filter(p => p.status === 'pending');
  const rejected = myPays.filter(p => p.status === 'rejected');
  const totalPaid = approved.reduce((s,p) => s + Number(p.amount||0), 0);
  const fee = currentUser.fee || 1500;

  const area = document.getElementById('accountArea');
  if (!area) return;
  area.innerHTML = `
    <div class="metrics" style="margin-bottom:1.5rem">
      <div class="metric"><div class="metric-label">Total pagado</div><div class="metric-value" style="color:var(--navy)">${fmt(totalPaid)}</div><div class="metric-change up">${approved.length} pagos aprobados</div></div>
      <div class="metric"><div class="metric-label">En revisión</div><div class="metric-value" style="color:var(--c-amber)">${pending.length}</div><div class="metric-change">comprobantes pendientes</div></div>
      <div class="metric"><div class="metric-label">Cuota mensual</div><div class="metric-value">${fmt(fee)}</div><div class="metric-change">mantenimiento</div></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">Estado de cuenta</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Mes</th><th>Concepto</th><th>Monto</th><th>Fecha pago</th><th>Estado</th><th>Recibo</th></tr></thead>
        <tbody>
          ${myPays.sort((a,b)=>new Date(b.sentDate||b.sent_date)-new Date(a.sentDate||a.sent_date)).map(p=>`<tr>
            <td>${p.month||'—'}</td>
            <td>Cuota de mantenimiento</td>
            <td>${fmt(p.amount)}</td>
            <td>${p.approvedDate||p.approved_date ? fmtDate(p.approvedDate||p.approved_date) : '—'}</td>
            <td><span class="badge ${p.status==='approved'?'badge-approved':p.status==='pending'?'badge-pending':'badge-rejected'}">${p.status==='approved'?'Pagado':p.status==='pending'?'En revisión':'Rechazado'}</span></td>
            <td>${(p.receiptNum||p.receipt_num)?`<button class="btn btn-secondary btn-sm" onclick="showReceipt(${p.id})">${p.receiptNum||p.receipt_num}</button>`:'—'}</td>
          </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--mist);padding:1.5rem">Sin movimientos</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}

/* ── UPLOAD VOUCHER (resident) ─────────────────────────────── */
function openModalUploadPayment() {
  const res    = DB.residents.find(r => r.userId===currentUser?.id||r.user_id===currentUser?.id||r.email===currentUser?.email);
  const status = res?.status || currentUser?.deptoStatus || currentUser?.depto_status || (currentUser?.depto ? 'approved' : 'pending');
  if (status !== 'approved') { showToast('Tu departamento aún no ha sido verificado', 'error'); return; }
  document.getElementById('payAmount').value    = '';
  document.getElementById('payDate').value      = new Date().toISOString().split('T')[0];
  document.getElementById('uploadFileName').textContent = 'Sin archivo seleccionado';
  openModal('modalUploadPayment');
}

function simulateUpload() { document.getElementById('payFile').click(); }
function fileSelected(input) {
  document.getElementById('uploadFileName').textContent = input.files[0] ? input.files[0].name : 'Sin archivo';
}

async function savePayment() {
  const month       = document.getElementById('payMonth').value;
  const amount      = parseFloat(document.getElementById('payAmount').value);
  const paymentDate = document.getElementById('payDate').value;
  const file        = document.getElementById('payFile')?.files?.[0] || null;

  if (!amount) { showToast('Ingresa el monto pagado', 'error'); return; }
  if (!file)   { showToast('Adjunta el comprobante de pago', 'error'); return; }

  const res = DB.residents.find(r =>
    r.userId===currentUser.id||r.user_id===currentUser.id||r.email===currentUser.email
  ) || { depto: currentUser.depto || '—' };

  const client = window.SUPABASE?.client?.();
  if (!client) { showToast('Sin conexión con Supabase', 'error'); return; }

  let voucherUrl = null;

  // Subir imagen a Supabase Storage
  try {
    showToast('Subiendo comprobante...', 'success');
    const today = new Date();
    const mm    = String(today.getMonth()+1).padStart(2,'0');
    const yyyy  = today.getFullYear();
    const fileName = `${yyyy}-${mm}-${res.depto}-C_${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await client.storage
      .from('comprobantes').upload(fileName, file, { cacheControl:'3600', upsert:false });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = client.storage.from('comprobantes').getPublicUrl(fileName);
    voucherUrl = publicUrl;
  } catch(err) {
    console.error('Storage upload failed', err);
    showToast('Error al subir imagen: ' + (err?.message || err), 'error');
    return;
  }

  // Guardar registro de pago
  const payRecord = toDbPayment({ month, amount, voucherUrl, paymentDate }, currentUser, res.depto);
  try {
    const rows = await window.SUPABASE.insert('payments', payRecord);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Supabase no devolvió el registro insertado');
    row.residentId   = row.resident_id;
    row.residentName = row.resident_name;
    row.sentDate      = row.sent_date;
    row.voucherUrl    = row.voucher_url;
    DB.payments.push(row);
  } catch(err) {
    console.error('Supabase insert payment failed', err);
    showToast('Error al guardar el pago: ' + (err?.message || err), 'error');
    return;
  }

  closeModal('modalUploadPayment');
  renderMyPayments();
  showToast('✓ Comprobante enviado con imagen');
}

/* ── CONTACTS (resident view) ──────────────────────────────── */
function renderContacts() {
  const c = DB.contacts;
  const area = document.getElementById('contactsArea');
  if (!area) return;
  area.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:1.5rem">
      <!-- Administración -->
      <div class="card" style="padding:1.5rem">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.25rem">
          <div style="width:44px;height:44px;border-radius:50%;background:var(--gold-light);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          </div>
          <div><div style="font-size:15px;font-weight:600;color:var(--navy)">${c.admin.name}</div><div style="font-size:12px;color:var(--mist)">Oficina general</div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <a href="tel:${c.admin.phone1.number}" class="contact-row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.69a16 16 0 0 0 6 6l.72-.97a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 21.28 16z"/></svg><div><div class="cr-main">${c.admin.phone1.display}</div><div class="cr-sub">${c.admin.phone1.label}</div></div></a>
          <a href="tel:${c.admin.phone2.number}" class="contact-row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg><div><div class="cr-main">${c.admin.phone2.display}</div><div class="cr-sub">${c.admin.phone2.label}</div></div></a>
          <a href="https://wa.me/${c.admin.whatsapp.replace('+','')}" target="_blank" class="contact-row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><div><div class="cr-main">WhatsApp</div><div class="cr-sub">Mensajes y comprobantes</div></div></a>
          <a href="mailto:${c.admin.email}" class="contact-row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><div><div class="cr-main">${c.admin.email}</div><div class="cr-sub">Correo electrónico</div></div></a>
        </div>
        <div style="margin-top:10px;padding:8px 12px;background:var(--c-bg);border-radius:var(--r-md);font-size:12px;color:var(--c-text-2)"><strong>Horario:</strong> ${c.admin.hours}</div>
      </div>
      <!-- Caseta -->
      <div class="card" style="padding:1.5rem">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.25rem">
          <div style="width:44px;height:44px;border-radius:50%;background:var(--c-amber-light);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div><div style="font-size:15px;font-weight:600;color:var(--navy)">${c.caseta.name}</div><div style="font-size:12px;color:var(--mist)">Vigilancia 24/7</div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <a href="tel:${c.caseta.phone1.number}" class="contact-row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.69a16 16 0 0 0 6 6l.72-.97a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 21.28 16z"/></svg><div><div class="cr-main">${c.caseta.phone1.display}</div><div class="cr-sub">${c.caseta.phone1.label}</div></div></a>
          <a href="tel:${c.caseta.phone2.number}" class="contact-row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg><div><div class="cr-main">${c.caseta.phone2.display}</div><div class="cr-sub">${c.caseta.phone2.label}</div></div></a>
          <a href="https://wa.me/${c.caseta.whatsapp.replace('+','')}" target="_blank" class="contact-row"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><div><div class="cr-main">WhatsApp caseta</div><div class="cr-sub">Visitas y accesos</div></div></a>
        </div>
        <div style="margin-top:10px;padding:8px 12px;background:var(--c-amber-light);border-radius:var(--r-md);font-size:12px;color:var(--c-amber);font-weight:500">${c.caseta.hours}</div>
      </div>
    </div>
    <!-- Emergencias -->
    <div class="card" style="padding:1.25rem">
      <div style="font-size:13px;font-weight:600;color:var(--navy);margin-bottom:10px">Números de emergencia</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
        ${c.emergency.map(e=>`<a href="tel:${e.number}" class="emerg-btn ${e.color}"><div><div class="eb-num">${e.label}</div><div class="eb-label">${e.desc}</div></div></a>`).join('')}
      </div>
    </div>`;
}

/* ── RECEIPT VIEWER & PDF ──────────────────────────────────── */
function buildReceiptHTML(p) {
  const recNum       = p.receiptNum || p.receipt_num;
  const approvedDate = p.approvedDate || p.approved_date || new Date().toISOString().split('T')[0];
  const resName      = p.residentName || p.resident_name || '—';

  return `
    <div class="receipt">
      <img src="assets/LogoM3.svg" alt="" class="receipt-watermark" onerror="this.style.display='none'">
      <div class="receipt-content">
        <div class="receipt-header">
          <div>
            <div class="receipt-logo">Real Molinos 3</div>
            <div style="font-size:10px;color:var(--mist)">Privada</div>
          </div>
          <div class="receipt-num"><strong style="color:var(--navy)">${recNum}</strong><br>${fmtDate(approvedDate)}</div>
        </div>
        <div class="receipt-row"><span class="key">Residente</span><span>${resName}</span></div>
        <div class="receipt-row"><span class="key">Departamento</span><span>${p.depto||'—'}</span></div>
        <div class="receipt-row"><span class="key">Concepto</span><span>Cuota de mantenimiento mensual</span></div>
        <div class="receipt-row"><span class="key">Período</span><span>${p.month||'—'}</span></div>
        <div class="receipt-row"><span class="key">Fecha de pago</span><span>${p.paymentDate||p.payment_date ? fmtDate(p.paymentDate||p.payment_date) : fmtDate(approvedDate)}</span></div>
        <div class="receipt-row"><span class="key">Fecha aprobación</span><span>${fmtDate(approvedDate)}</span></div>
        <div class="receipt-row"><span class="key">Referencia</span><span>${recNum}</span></div>
        <div class="receipt-total"><span>Total pagado</span><span>${fmt(p.amount)}</span></div>
        <div class="receipt-sig">
          <div class="receipt-sig-label">Firma de administración</div>
          <div class="sig-box"><span class="sig-text">Administración RM3</span></div>
          <div style="font-size:10px;color:var(--mist);margin-top:4px">Real Molinos 3 Privada — Documento oficial de pago</div>
        </div>
      </div>
    </div>`;
}

function showReceipt(id) {
  const p = DB.payments.find(p => p.id === id);
  if (!p || !(p.receiptNum || p.receipt_num)) return;
  document.getElementById('receiptContent').innerHTML = buildReceiptHTML(p);
  updateReceiptDownloadButton(p);
  openModal('modalReceipt');
}

function updateReceiptDownloadButton(p) {
  const btn = document.getElementById('btnDownloadReceipt');
  if (!btn) return;
  btn.textContent = '⬇ Descargar';
  btn.disabled = false;
  btn.onclick = () => downloadReceipt(p);
}

/* ── Descarga genérica de archivos (recibos, comprobantes) ───── */
function downloadBlob(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(blobUrl);
}

async function downloadUrlAsFile(url, filename) {
  const res = await fetch(url);
  const blob = await res.blob();
  downloadBlob(blob, filename);
}

async function downloadReceipt(p) {
  const btn = document.getElementById('btnDownloadReceipt');
  const recNum = p.receiptNum || p.receipt_num || 'recibo';
  const fileName = `${recNum}.jpg`;
  if (btn) { btn.disabled = true; btn.textContent = '⬇ Descargando...'; }
  try {
    const url = p.receiptUrl || p.receipt_url || null;
    if (url) {
      await downloadUrlAsFile(url, fileName);
    } else {
      const blob = await generateReceiptImageBlob(p);
      downloadBlob(blob, fileName);
      // Sube en segundo plano para que la próxima vez no haya que regenerarlo
      uploadReceiptImage(p, blob)
        .then(newUrl => {
          window.SUPABASE.update('payments', p.id, { receipt_url: newUrl }).catch(()=>{});
          p.receiptUrl = newUrl; p.receipt_url = newUrl;
        })
        .catch(e => console.warn('No se pudo guardar el recibo en Storage', e));
    }
  } catch (e) {
    console.error('No se pudo descargar el recibo', e);
    showToast('No se pudo generar el recibo', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Descargar'; }
  }
}

/* Espera a que todas las <img> dentro de un contenedor terminen de cargar
   (o fallen) antes de que html2canvas tome la foto — si no, captura el
   recibo antes de que la marca de agua/logo haya cargado y sale en blanco. */
function waitForImages(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  })));
}

/* Renderiza el recibo a una imagen JPEG comprimida (peso mínimo) */
async function generateReceiptImageBlob(p) {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left     = '-9999px';
  container.style.top      = '0';
  container.style.width    = '520px';
  container.style.background = '#fff';
  container.innerHTML = buildReceiptHTML(p);
  document.body.appendChild(container);
  try {
    await waitForImages(container);
    const canvas = await html2canvas(container, { scale: 1.5, backgroundColor: '#ffffff' });
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } finally {
    container.remove();
  }
}

async function uploadReceiptImage(p, blob) {
  const client = window.SUPABASE?.client?.();
  if (!client) throw new Error('Sin conexión con Supabase');
  const recNum = p.receiptNum || p.receipt_num;
  if (!recNum) throw new Error('El pago no tiene número de recibo');
  const imgBlob  = blob || await generateReceiptImageBlob(p);
  const fileName = `${p.depto||'SIN-DEPTO'}/${recNum}.jpg`;
  const { error: uploadError } = await client.storage
    .from('recibos').upload(fileName, imgBlob, { cacheControl:'3600', upsert:true, contentType:'image/jpeg' });
  if (uploadError) throw uploadError;
  const { data: { publicUrl } } = client.storage.from('recibos').getPublicUrl(fileName);
  return publicUrl;
}

/* ── HELPERS ────────────────────────────────────────────────── */
let __modalZTop = 100;
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.zIndex = String(++__modalZTop);
  el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.style.zIndex = '';
}

function showAlert(elId, msg, type) {
  const el = document.getElementById(elId);
  if (el) {
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(() => { if (el) el.innerHTML = ''; }, 6000);
  }
}

let toastTimer = null;
function showToast(msg, type = 'success') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;transition:opacity 0.3s;border:1px solid;';
    document.body.appendChild(t);
  }
  if (type === 'error') {
    t.style.background = '#8B2020'; t.style.color = 'white'; t.style.borderColor = '#8B2020';
  } else {
    t.style.background = '#001534'; t.style.color = '#C89A2B'; t.style.borderColor = '#C89A2B';
  }
  t.textContent = msg; t.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
}

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
});
