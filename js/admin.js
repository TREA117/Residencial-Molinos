/* ================================================================
   Real Molinos 3 — Vistas de Administrador
   ================================================================ */

/* ── DASHBOARD ─────────────────────────────────────────────── */
/* Filtro de fecha compartido por Dashboard e Ingresos/Egresos:
   from/to vacíos = sin límite en ese extremo. */
function inDateRange(dateStr, from, to) {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to   && dateStr > to)   return false;
  return true;
}

function txLedgerDate(p) {
  return p.approvedDate||p.approved_date||p.paymentDate||p.payment_date||p.sentDate||p.sent_date||'';
}

/* Remanente = balance acumulado (ingresos − egresos aprobados) de TODO lo
   anterior a `beforeDate` (exclusivo, 'YYYY-MM-DD'). Se calcula solo —
   administración no tiene que escribirlo cada mes — siempre que el
   histórico de pagos/transacciones esté importado en la tabla payments. */
function calcRemanente(beforeDate) {
  if (!beforeDate) return 0;
  return DB.payments
    .filter(p => p.status==='approved' && txLedgerDate(p) && txLedgerDate(p) < beforeDate)
    .reduce((s,p) => s + (p.type==='expense' ? -1 : 1) * Number(p.amount||0), 0);
}

function firstDayOfCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}

function renderDashboard() {
  const from = document.getElementById('dashFrom')?.value || '';
  const to   = document.getElementById('dashTo')?.value   || '';
  const hasFilter = !!(from || to);

  const approvedAll = DB.payments.filter(p=>p.status==='approved');
  const approved    = hasFilter
    ? approvedAll.filter(p => inDateRange(p.approvedDate||p.approved_date||p.sentDate||p.sent_date||'', from, to))
    : approvedAll;
  const totalIncome    = approved.filter(p=>p.type==='income').reduce((s,p)=>s+Number(p.amount||0),0);
  const totalExpense   = approved.filter(p=>p.type==='expense').reduce((s,p)=>s+Number(p.amount||0),0);
  const remanente       = calcRemanente(from || firstDayOfCurrentMonth());
  const balance        = totalIncome - totalExpense;
  const approvedRes    = DB.residents.filter(r=>r.status==='approved').length;
  const pendingRes     = DB.residents.filter(r=>r.status==='pending').length;
  const pendingPay     = DB.payments.filter(p=>p.status==='pending'&&(p.residentId||p.resident_id)).length;

  const area = document.getElementById('metricsArea');
  if (area) area.innerHTML = `
    <div class="metric"><div class="metric-label">Remanente mes anterior</div><div class="metric-value" style="color:${remanente>=0?'var(--navy)':'var(--c-red)'}">${fmt(remanente)}</div><div class="metric-change">acumulado a la fecha de inicio</div></div>
    <div class="metric"><div class="metric-label">Balance${hasFilter?' (filtrado)':' total'}</div><div class="metric-value" style="color:${balance>=0?'var(--navy)':'var(--c-red)'}">${fmt(balance)}</div><div class="metric-change">Ingresos − Egresos</div></div>
    <div class="metric"><div class="metric-label">Ingresos${hasFilter?' (filtrado)':' totales'}</div><div class="metric-value">${fmt(totalIncome)}</div><div class="metric-change up">↑ acumulado</div></div>
    <div class="metric"><div class="metric-label">Egresos${hasFilter?' (filtrado)':' totales'}</div><div class="metric-value">${fmt(totalExpense)}</div><div class="metric-change down">↓ acumulado</div></div>
    <div class="metric"><div class="metric-label">Residentes activos</div><div class="metric-value">${approvedRes}</div><div class="metric-change">${pendingRes} pendientes de auth</div></div>
    <div class="metric"><div class="metric-label">Comprobantes</div><div class="metric-value" style="color:var(--c-amber)">${pendingPay}</div><div class="metric-change">por revisar</div></div>`;

  renderCharts(approved);

  const all = DB.payments
    .filter(p => !hasFilter || inDateRange(p.approvedDate||p.approved_date||p.sentDate||p.sent_date||'', from, to))
    .map(p=>{
      const isResident = !!(p.residentId||p.resident_id);
      const descBase = p.description || (isResident ? 'Pago '+(p.month||'')+' — Depto '+(p.depto||'') : '—');
      const desc = p.provider ? `${p.provider} — ${descBase}` : descBase;
      const date = p.approvedDate||p.approved_date||p.sentDate||p.sent_date;
      const dispType = p.status==='pending' ? 'payment' : (p.status==='rejected' ? 'payment' : p.type);
      return { date, desc, type:dispType, amount:p.amount, status:p.status };
    });
  all.sort((a,b)=>new Date(b.date)-new Date(a.date));
  const ra = document.getElementById('recentActivity');
  if (ra) ra.innerHTML = all.slice(0,8).map(r=>`<tr>
    <td>${fmtDate(r.date)}</td><td>${r.desc}</td>
    <td><span class="badge ${r.type==='income'?'badge-income':r.type==='expense'?'badge-expense':'badge-pending'}">${r.type==='income'?'Ingreso':r.type==='expense'?'Egreso':'Pago'}</span></td>
    <td style="font-weight:500;color:${r.type==='income'?'var(--navy)':'var(--c-red)'}">${r.type==='income'?'+':'−'}${fmt(r.amount)}</td>
    <td><span class="badge ${r.status==='approved'?'badge-approved':r.status==='pending'?'badge-pending':'badge-rejected'}">${r.status==='approved'?'Aprobado':r.status==='pending'?'Pendiente':'Rechazado'}</span></td>
  </tr>`).join('');
}

function renderCharts(approved) {
  approved = approved || DB.payments.filter(p=>p.status==='approved');
  const months  = ['Ene','Feb','Mar','Abr','May','Jun'];
  const mKeys   = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
  const txDate   = p => p.approvedDate||p.approved_date||'';
  const incomes  = mKeys.map(m=>approved.filter(p=>p.type==='income' &&String(txDate(p)).startsWith(m)).reduce((s,p)=>s+Number(p.amount||0),0));
  const expenses = mKeys.map(m=>approved.filter(p=>p.type==='expense'&&String(txDate(p)).startsWith(m)).reduce((s,p)=>s+Number(p.amount||0),0));
  if (chartFlow) chartFlow.destroy();
  const ctx1 = document.getElementById('chartFlow');
  if (ctx1) chartFlow = new Chart(ctx1, {
    type:'bar',
    data:{labels:months, datasets:[
      {label:'Ingresos', data:incomes,  backgroundColor:'rgba(200,154,43,0.3)', borderColor:'var(--gold)', borderWidth:2, borderRadius:4},
      {label:'Egresos',  data:expenses, backgroundColor:'rgba(139,32,32,0.2)',  borderColor:'var(--c-red)',  borderWidth:2, borderRadius:4}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{font:{size:11}, color:'#3F4750'}}},
      scales:{x:{grid:{display:false}}, y:{grid:{color:'rgba(0,0,0,0.04)'}, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k'}}}
    }
  });
  const cats = {};
  approved.filter(p=>p.type==='expense').forEach(p=>{const k=p.category||'Otros'; cats[k]=(cats[k]||0)+Number(p.amount||0);});
  if (chartDist) chartDist.destroy();
  const ctx2 = document.getElementById('chartDist');
  if (ctx2 && Object.keys(cats).length) chartDist = new Chart(ctx2, {
    type:'doughnut',
    data:{labels:Object.keys(cats), datasets:[{data:Object.values(cats), backgroundColor:['#C89A2B','#001534','#3F4750','#ACA79D','#E9DFCE','#8B2020'], borderWidth:2, borderColor:'#fff'}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right', labels:{font:{size:11}, padding:8}}}}
  });
}

/* ── RESIDENTS ─────────────────────────────────────────────── */
function renderResidents() {
  const search  = (document.getElementById('searchResident')?.value||'').toLowerCase();
  const pending = DB.residents.filter(r=>r.status==='pending');
  const all     = DB.residents.filter(r=>(r.name||'').toLowerCase().includes(search)||String(r.depto||'').toLowerCase().includes(search));
  const pb = document.getElementById('pendingBadge');
  if (pb) pb.textContent = pending.length;

  document.getElementById('tblPendingResidents').innerHTML = pending.map(r=>`<tr>
    <td style="font-weight:500">${r.name}</td><td><strong>${r.depto||'—'}</strong></td>
    <td>${r.email||'—'}</td><td>${r.phone||'—'}</td><td>${fmtDate(new Date())}</td>
    <td style="display:flex;gap:6px">
      <button class="btn btn-success btn-sm" onclick="approveResident(${r.id})">✓ Autorizar</button>
      <button class="btn btn-danger btn-sm"  onclick="rejectResident(${r.id})">✕ Rechazar</button>
    </td></tr>`).join()||'<tr><td colspan="6" style="text-align:center;color:var(--mist);padding:1.5rem">Sin solicitudes pendientes ✓</td></tr>';

  document.getElementById('tblAllResidents').innerHTML = all.map(r=>`<tr>
    <td style="font-weight:500">${r.name}</td><td><strong>${r.depto||'—'}</strong></td>
    <td><span class="badge ${r.status==='approved'?'badge-approved':r.status==='pending'?'badge-pending':'badge-rejected'}">${r.status==='approved'?'Autorizado':r.status==='pending'?'Pendiente':'Rechazado'}</span></td>
    <td>${r.email||'—'}</td><td>${r.phone||'—'}</td>
    <td style="display:flex;gap:6px">
      <button class="btn btn-secondary btn-sm" onclick="editResidentModal(${r.id})">Editar</button>
      <button class="btn btn-danger btn-sm"    onclick="deleteResident(${r.id})">Eliminar</button>
    </td></tr>`).join()||'<tr><td colspan="6" style="text-align:center;color:var(--mist);padding:1.5rem">Sin resultados</td></tr>';
  updatePendingCounts();
}

async function approveResident(id) {
  const uid = Number(id);
  const r = DB.residents.find(r=>Number(r.id)===uid);
  if (!r) return;
  try {
    await window.SUPABASE.update('users', uid, { depto_status: 'approved' });
    r.status = 'approved';
    const u = DB.users.find(u=>Number(u.id)===uid);
    if (u) { u.depto_status='approved'; u.deptoStatus='approved'; }
    renderResidents();
    showToast('✓ Residente '+r.name+' autorizado — Depto '+r.depto);
  } catch(e) {
    console.error('Supabase approve failed', e);
    showToast('Error al guardar en Supabase: '+(e?.message||e),'error');
  }
}

async function rejectResident(id) {
  const uid = Number(id);
  const r = DB.residents.find(r=>Number(r.id)===uid);
  if (!r) return;
  try {
    await window.SUPABASE.update('users', uid, { depto_status: 'rejected' });
    r.status = 'rejected';
    const u = DB.users.find(u=>Number(u.id)===uid);
    if (u) { u.depto_status='rejected'; u.deptoStatus='rejected'; }
    renderResidents();
    showToast('Residente rechazado', 'error');
  } catch(e) {
    console.error('Supabase reject failed', e);
    showToast('Error al guardar en Supabase: '+(e?.message||e),'error');
  }
}

async function deleteResident(id) {
  if (!confirm('¿Eliminar este usuario?')) return;
  const uid = Number(id);
  try {
    await window.SUPABASE.remove('users', uid);
    DB.users     = DB.users.filter(u=>Number(u.id)!==uid);
    DB.residents = DB.residents.filter(r=>Number(r.id)!==uid);
    renderResidents();
    showToast('Usuario eliminado');
  } catch(e) {
    console.error('Supabase delete failed', e);
    showToast('Error al eliminar en Supabase: '+(e?.message||e),'error');
  }
}

function editResidentModal(id) {
  const r = DB.residents.find(r=>r.id===id);
  if (!r) return;
  document.getElementById('editResId').value    = r.id;
  document.getElementById('editResName').value  = r.name  ||'';
  document.getElementById('editResEmail').value = r.email ||'';
  document.getElementById('editResPhone').value = r.phone ||'';
  document.getElementById('editResDepto').value = r.depto ||'';
  document.getElementById('editResStatus').value= r.status||'pending';
  openModal('modalEditResident');
}

async function saveEditResident() {
  const id  = Number(document.getElementById('editResId').value);
  const r   = DB.residents.find(r=>Number(r.id)===id);
  if (!r) return;
  const name   = document.getElementById('editResName').value.trim();
  const email  = document.getElementById('editResEmail').value.trim();
  const phone  = document.getElementById('editResPhone').value.trim();
  const depto  = document.getElementById('editResDepto').value.trim().toUpperCase().replace(/\s+/g,'');
  const status = document.getElementById('editResStatus').value;
  try {
    await window.SUPABASE.update('users', id, { name, email, phone, depto, depto_status: status });
    r.name=name; r.email=email; r.phone=phone; r.depto=depto; r.status=status;
    const u = DB.users.find(u=>Number(u.id)===id);
    if (u) { u.name=name; u.email=email; u.phone=phone; u.depto=depto; u.depto_status=status; u.deptoStatus=status; }
    closeModal('modalEditResident'); renderResidents(); showToast('Residente actualizado ✓');
  } catch(e) {
    console.error('Supabase update user failed', e);
    showToast('Error al guardar: '+(e?.message||e),'error');
  }
}

function openModalAddResident() {
  ['newResName','newResEmail','newResPhone','newResDepto'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  openModal('modalAddResident');
}
async function saveNewResident() {
  const name   = document.getElementById('newResName').value.trim();
  const email  = document.getElementById('newResEmail').value.trim();
  const phone  = document.getElementById('newResPhone').value.trim();
  const depto  = document.getElementById('newResDepto').value.trim().toUpperCase().replace(/\s+/g,'');
  const status = document.getElementById('newResStatus').value;
  if (!name||!depto) { showToast('Nombre y departamento son requeridos','error'); return; }
  try {
    const sb = window.SUPABASE;
    if (sb && sb.config().hasKey) {
      const rows = await sb.insert('users', {
        name, email, phone, depto, role:'resident',
        depto_status: status, password_hash: ''
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) {
        const newUser = { ...row, deptoStatus: status, depto_status: status };
        DB.users.push(newUser);
        if (typeof syncResidentsFromUsers === 'function') syncResidentsFromUsers();
      }
    }
  } catch(e) { console.warn('Supabase insert user failed',e); showToast('Error al agregar usuario','error'); return; }
  closeModal('modalAddResident'); renderResidents(); showToast('Residente '+name+' agregado ✓');
}

/* ── PAYMENTS / VOUCHERS (admin) ───────────────────────────── */
function renderPayments() {
  const month     = document.getElementById('filterPayMonth')?.value||'';
  const residentPays = DB.payments.filter(p=>p.residentId||p.resident_id);
  const pending   = residentPays.filter(p=>p.status==='pending');
  const all       = residentPays.filter(p=>p.status!=='rejected').filter(p=>!month||p.month===month);
  const ppb = document.getElementById('payPendingBadge');
  if (ppb) ppb.textContent = pending.length;

  document.getElementById('tblPendingPayments').innerHTML = pending.map(p=>`<tr>
    <td style="font-weight:500">${p.residentName||p.resident_name||'—'}</td>
    <td><strong>${p.depto||'—'}</strong></td><td>${p.month||'—'}</td>
    <td>${fmt(p.amount)}</td>
    <td>${p.paymentDate||p.payment_date?fmtDate(p.paymentDate||p.payment_date):'—'}</td>
    <td>${fmtDate(p.sentDate||p.sent_date)}</td>
    <td><button class="btn btn-secondary btn-sm" onclick="viewVoucher(${p.id})">Ver imagen</button></td>
    <td style="display:flex;gap:6px">
      <button class="btn btn-success btn-sm" onclick="approvePayment(${p.id})">✓ Aprobar</button>
      <button class="btn btn-danger btn-sm"  onclick="rejectPayment(${p.id})">✕ Rechazar</button>
      <button class="btn btn-danger btn-sm"  onclick="deletePayment(${p.id})">🗑 Eliminar</button>
    </td></tr>`).join()||'<tr><td colspan="8" style="text-align:center;color:var(--mist);padding:1.5rem">Sin comprobantes pendientes ✓</td></tr>';

  document.getElementById('tblAllPayments').innerHTML = all.map(p=>`<tr>
    <td>${p.residentName||p.resident_name||'—'}</td><td>${p.depto||'—'}</td>
    <td>${p.month||'—'}</td><td>${fmt(p.amount)}</td>
    <td><span class="badge ${p.status==='approved'?'badge-approved':p.status==='pending'?'badge-pending':'badge-rejected'}">${p.status==='approved'?'Aprobado':p.status==='pending'?'Pendiente':'Rechazado'}</span></td>
    <td>${(p.receiptNum||p.receipt_num)?`<button class="btn btn-secondary btn-sm" onclick="showReceipt(${p.id})">${p.receiptNum||p.receipt_num}</button>`:'—'}</td>
    <td><button class="btn btn-danger btn-sm" onclick="deletePayment(${p.id})">🗑 Eliminar</button></td>
  </tr>`).join('');
  updatePendingCounts();
}

async function approvePayment(id) {
  const p = DB.payments.find(p=>p.id===id);
  if (!p) return;
  const today = new Date();
  const mm    = String(today.getMonth()+1).padStart(2,'0');
  const yyyy  = today.getFullYear();
  const approvedDate = today.toISOString().split('T')[0];
  const receiptNum   = `${yyyy}-${mm}-${p.depto||'XXX'}`;
  const desc = 'Cuota mantenimiento '+p.month+' — Depto '+p.depto;

  try {
    await window.SUPABASE.update('payments', id, {
      status:'approved', approved_date:approvedDate, receipt_num:receiptNum,
      type:'income', description:desc, category:'Mantenimiento'
    });
    p.status = 'approved';
    p.approvedDate = approvedDate; p.approved_date = approvedDate;
    p.receiptNum = receiptNum; p.receipt_num = receiptNum;
    p.type = 'income'; p.description = desc; p.category = 'Mantenimiento';
  } catch(e) {
    console.error('Supabase approve payment failed', e);
    showToast('Error al aprobar el pago: '+(e?.message||e), 'error');
    return;
  }

  renderPayments();
  updatePendingCounts();
  showToast('✓ Pago aprobado — Recibo '+receiptNum+' generado');

  // Generar y subir el recibo a Storage de inmediato, para que quede
  // disponible sin depender de que alguien lo abra/descargue manualmente.
  try {
    const blob = await generateReceiptImageBlob(p);
    const url  = await uploadReceiptImage(p, blob);
    await window.SUPABASE.update('payments', id, { receipt_url: url });
    p.receiptUrl = url; p.receipt_url = url;
    if (typeof renderMyPayments === 'function') renderMyPayments();
    if (typeof renderVouchers === 'function') renderVouchers();
  } catch(e) {
    console.warn('No se pudo pre-generar el recibo en Storage', e);
  }

  showReceipt(id);
}

async function rejectPayment(id) {
  const p = DB.payments.find(p=>p.id===id);
  if (!p) return;

  const voucherUrl = p.voucherUrl || p.voucher_url || null;
  const client = window.SUPABASE?.client?.();

  try {
    if (client && voucherUrl) {
      const marker = '/comprobantes/';
      const idx = voucherUrl.indexOf(marker);
      if (idx !== -1) {
        const path = decodeURIComponent(voucherUrl.slice(idx + marker.length));
        const { error: rmError } = await client.storage.from('comprobantes').remove([path]);
        if (rmError) console.warn('No se pudo eliminar la imagen del storage', rmError);
      }
    }

    await window.SUPABASE.update('payments', id, { status: 'rejected', voucher_url: null });
    p.status = 'rejected';
    p.voucherUrl = null; p.voucher_url = null;

    const residentId = p.residentId || p.resident_id;
    if (residentId) {
      try {
        const notifRows = await window.SUPABASE.insert('notifications', {
          user_id: residentId,
          message: `Tu comprobante de ${p.month||'el mes'} fue rechazado por administración. Sube un nuevo comprobante.`,
          is_read: false,
        });
        const notifRow = Array.isArray(notifRows) ? notifRows[0] : notifRows;
        if (notifRow) DB.notifications.push(normalizeNotification(notifRow));
      } catch(notifErr) {
        console.warn('No se pudo crear la notificación (¿existe la tabla notifications?)', notifErr);
      }
    }
  } catch(e) {
    console.error('Supabase reject payment failed', e);
    showToast('Error al rechazar el pago: '+(e?.message||e), 'error');
    return;
  }
  renderPayments(); showToast('Comprobante rechazado','error'); updatePendingCounts();
}

/* ── Helpers de storage compartidos ──────────────────────────── */
function storagePathFromUrl(url, marker) {
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}
function extFromUrl(url, fallback) {
  const clean = (url||'').split('?')[0];
  const ext = clean.split('.').pop();
  return (ext && ext.length <= 4 && ext !== clean) ? ext : fallback;
}

/* ── DELETE PAYMENT (comprobante + recibo + ingreso vinculado) ── */
async function deletePayment(id, folderDepto) {
  const p = DB.payments.find(p=>p.id===id);
  if (!p) return;
  if (!confirm('¿Eliminar este registro de forma permanente? Se borrará el comprobante y el recibo (si aplica) del storage, y la fila de la tabla payments. Esta acción no se puede deshacer.')) return;

  const client      = window.SUPABASE?.client?.();
  const voucherUrl  = p.voucherUrl || p.voucher_url || null;
  const receiptUrl  = p.receiptUrl || p.receipt_url || null;

  try {
    if (client && voucherUrl) {
      const path = storagePathFromUrl(voucherUrl, '/comprobantes/');
      if (path) {
        const { data: rmData, error: rmError } = await client.storage.from('comprobantes').remove([path]);
        console.info('Eliminar comprobante storage', { path, rmData, rmError });
        if (rmError) throw new Error('No se pudo eliminar el comprobante del storage (ruta: '+path+'): '+(rmError.message||rmError));
        if (!rmData || rmData.length === 0) throw new Error('El comprobante no se encontró en el storage (ruta: '+path+'). Verifica el bucket "comprobantes".');
      }
    }
    if (client && receiptUrl) {
      const path = storagePathFromUrl(receiptUrl, '/recibos/');
      if (path) {
        const { data: rmData, error: rmError } = await client.storage.from('recibos').remove([path]);
        console.info('Eliminar recibo storage', { path, rmData, rmError });
        if (rmError) throw new Error('No se pudo eliminar el recibo del storage (ruta: '+path+'): '+(rmError.message||rmError));
        if (!rmData || rmData.length === 0) throw new Error('El recibo no se encontró en el storage (ruta: '+path+'). Verifica el bucket "recibos".');
      }
    }
    await window.SUPABASE.remove('payments', id);
  } catch(e) {
    console.error('Supabase delete payment failed', e);
    showToast('Error al eliminar el comprobante: '+(e?.message||e), 'error');
    return;
  }

  DB.payments  = DB.payments.filter(p=>p.id!==id);

  renderPayments();
  if (typeof renderVouchers === 'function') renderVouchers();
  if (typeof renderFinances === 'function') renderFinances();
  updatePendingCounts();

  const folderModalOpen = document.getElementById('modalFolder')?.classList.contains('open');
  if (folderModalOpen && folderDepto) openDeptoFolder(folderDepto);

  showToast('✓ Comprobante eliminado');
}

function viewVoucher(id) {
  const p = DB.payments.find(p=>p.id===id);
  if (!p) return;
  const imgUrl = p.voucherUrl||p.voucher_url||null;
  document.getElementById('voucherBody').innerHTML = `
    <div style="text-align:center;padding:1rem">
      ${imgUrl
        ?`<img src="${imgUrl}" alt="Comprobante" style="max-width:100%;max-height:400px;border-radius:8px;border:2px solid var(--gold)">`
        :`<div style="background:var(--c-bg);border-radius:var(--r-md);padding:2rem;margin-bottom:1rem">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--mist)" stroke-width="1.5" style="margin:0 auto;display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <div style="font-size:13px;color:var(--mist);margin-top:8px">Sin imagen adjunta</div>
           </div>`}
      <div style="margin-top:12px;text-align:left">
        <div style="font-size:13px;font-weight:600;color:var(--navy)">${p.residentName||p.resident_name||'—'} · Depto ${p.depto||'—'}</div>
        <div style="font-size:12px;color:var(--mist)">${p.month||'—'} · ${fmt(p.amount)} · Fecha pago: ${p.paymentDate||p.payment_date?fmtDate(p.paymentDate||p.payment_date):'—'} · Enviado: ${fmtDate(p.sentDate||p.sent_date)}</div>
      </div>
    </div>`;

  const buttons = [];
  if (imgUrl) buttons.push(`<button class="btn btn-secondary" id="btnDownloadVoucher">⬇ Descargar</button>`);
  if (p.status === 'pending' && currentUser?.role === 'admin') {
    buttons.push(`<button class="btn btn-danger btn-sm" onclick="rejectPayment(${id});closeModal('modalViewVoucher')">✕ Rechazar</button>`);
    buttons.push(`<button class="btn btn-gold" onclick="approvePayment(${id});closeModal('modalViewVoucher')">✓ Aprobar y generar recibo</button>`);
  }
  buttons.push(`<button class="btn btn-primary" onclick="closeModal('modalViewVoucher')">Cerrar</button>`);
  document.getElementById('voucherFoot').innerHTML = buttons.join('');

  if (imgUrl) {
    const btn = document.getElementById('btnDownloadVoucher');
    const ext = (imgUrl.split('?')[0].split('.').pop() || 'jpg').slice(0,4);
    const filename = `comprobante-${(p.depto||'SIN-DEPTO')}-${(p.month||'')}`.replace(/\s+/g,'_') + '.' + ext;
    btn.onclick = async () => {
      btn.disabled = true; const orig = btn.textContent; btn.textContent = '⬇ Descargando...';
      try { await downloadUrlAsFile(imgUrl, filename); }
      catch(e) { console.error('No se pudo descargar el comprobante', e); showToast('No se pudo descargar el comprobante','error'); }
      finally { btn.disabled = false; btn.textContent = orig; }
    };
  }

  openModal('modalViewVoucher');
}

/* ── VOUCHERS BY FOLDER (organized by depto) ───────────────── */
function renderVouchers() {
  const area = document.getElementById('vouchersArea');
  if (!area) return;

  // Group by depto (solo comprobantes ligados a un residente)
  const byDepto = {};
  DB.payments.filter(p=>p.residentId||p.resident_id).forEach(p => {
    const d = p.depto||'SIN-DEPTO';
    if (!byDepto[d]) byDepto[d] = [];
    byDepto[d].push(p);
  });

  area.innerHTML = `
    <div class="alert alert-gold" style="margin-bottom:1.5rem">
      📥 <strong>Descarga y limpieza total (modo prueba).</strong> Todos los comprobantes aprobados guardados se descargarán en un ZIP y luego se eliminarán automáticamente al usar "Descargar y limpiar".
    </div>
    <div class="folder-grid">
      ${Object.entries(byDepto).sort(([a],[b])=>a.localeCompare(b)).map(([depto,pays])=>`
        <div class="folder-item" onclick="openDeptoFolder('${depto}')">
          <div class="folder-icon">📁</div>
          <div class="folder-name">Depto ${depto}</div>
          <div class="folder-count">${pays.length} archivo${pays.length!==1?'s':''}</div>
        </div>`).join('')}
    </div>`;
}

function openDeptoFolder(depto) {
  const pays = DB.payments.filter(p=>(p.residentId||p.resident_id)&&(p.depto||'SIN-DEPTO')===depto);
  document.getElementById('folderTitle').textContent = 'Depto ' + depto;
  document.getElementById('folderBody').innerHTML = `
    <table style="width:100%">
      <thead><tr><th>Archivo</th><th>Mes</th><th>Monto</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>
        ${pays.map(p=>{
          const today=new Date();
          const mm=String(today.getMonth()+1).padStart(2,'0');
          const yyyy=today.getFullYear();
          const recName  = p.receiptNum||p.receipt_num ? (p.receiptNum||p.receipt_num) : '—';
          const compName = recName!=='—' ? recName+'-C' : '—';
          return `<tr>
            <td><div style="font-size:12px;font-family:monospace">${recName}</div><div style="font-size:11px;color:var(--mist)">${compName}</div></td>
            <td>${p.month||'—'}</td><td>${fmt(p.amount)}</td>
            <td><span class="badge ${p.status==='approved'?'badge-approved':p.status==='pending'?'badge-pending':'badge-rejected'}">${p.status==='approved'?'Aprobado':p.status==='pending'?'Pendiente':'Rechazado'}</span></td>
            <td style="display:flex;gap:4px">
              ${p.voucherUrl||p.voucher_url?`<button class="btn btn-secondary btn-sm" onclick="viewVoucher(${p.id})">Ver</button>`:''}
              ${p.receiptNum||p.receipt_num?`<button class="btn btn-gold btn-sm" onclick="showReceipt(${p.id})">Recibo</button>`:''}
              <button class="btn btn-danger btn-sm" onclick="deletePayment(${p.id},'${depto}')">🗑</button>
            </td>
          </tr>`;
        }).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--mist);padding:1rem">Sin archivos</td></tr>'}
      </tbody>
    </table>`;
  openModal('modalFolder');
}

/* ── DOWNLOAD & AUTO-CLEANUP ────────────────────────────────── */
const PAYMENTS_CSV_COLUMNS = [
  'resident_name','depto','month','amount','status','type',
  'description','category','sent_date','payment_date',
  'approved_date','receipt_num'
];

function csvEscape(v) {
  return '"' + String(v ?? '').replace(/"/g,'""') + '"';
}

async function downloadAndCleanup() {
  if (typeof JSZip === 'undefined') {
    showToast('No se pudo cargar la librería de ZIP (JSZip)','error');
    return;
  }

  const today = new Date();

  // Todos los comprobantes aprobados de residentes guardados actualmente
  const toArchive = DB.payments.filter(p =>
    (p.residentId||p.resident_id) && p.status === 'approved'
  );

  if (toArchive.length === 0) {
    showToast('No hay comprobantes aprobados para archivar','error');
    return;
  }

  const dateLabel  = today.toISOString().split('T')[0];
  const folderName = `Reporte-Comprobantes-${dateLabel}`;

  showToast('Generando ZIP, esto puede tardar unos segundos…');

  try {
    const zip  = new JSZip();
    const root = zip.folder(folderName);

    const csvLines = [PAYMENTS_CSV_COLUMNS.join(',')];
    for (const p of toArchive) {
      csvLines.push(PAYMENTS_CSV_COLUMNS.map(col => csvEscape(p[col])).join(','));
    }
    root.file('ReporteMensual.csv', csvLines.join('\n'));

    for (const p of toArchive) {
      const depto       = p.depto || 'SIN-DEPTO';
      const deptoFolder = root.folder(depto);
      const recNum      = p.receiptNum||p.receipt_num || `pago-${p.id}`;
      const voucherUrl  = p.voucherUrl||p.voucher_url || null;

      if (voucherUrl) {
        try {
          const blob = await (await fetch(voucherUrl)).blob();
          deptoFolder.file(`${recNum}-comprobante.${extFromUrl(voucherUrl,'jpg')}`, blob);
        } catch(e) { console.warn('No se pudo descargar comprobante para el ZIP', p.id, e); }
      }
      try {
        // Siempre se regenera en lugar de reusar receipt_url cacheado, para
        // no archivar una imagen vieja generada con un template desactualizado.
        const blob = await generateReceiptImageBlob(p);
        deptoFolder.file(`${recNum}-recibo.jpg`, blob);
      } catch(e) { console.warn('No se pudo obtener el recibo para el ZIP', p.id, e); }
    }

    const zipBlob = await zip.generateAsync({ type:'blob' });
    downloadBlob(zipBlob, `${folderName}.zip`);
  } catch(e) {
    console.error('Error generando el ZIP', e);
    showToast('Error al generar el ZIP: '+(e?.message||e),'error');
    return;
  }

  // Limpieza real: solo borra los archivos en storage (comprobantes + recibos)
  // y limpia receipt_url/voucher_url — la fila de payments se conserva.
  const client = window.SUPABASE?.client?.();
  const clearedIds = [];
  for (const p of toArchive) {
    try {
      const voucherUrl = p.voucherUrl||p.voucher_url || null;
      const receiptUrl = p.receiptUrl||p.receipt_url || null;
      if (client && voucherUrl) {
        const path = storagePathFromUrl(voucherUrl, '/comprobantes/');
        if (path) {
          const { data, error } = await client.storage.from('comprobantes').remove([path]);
          if (error) throw new Error('Storage comprobantes: '+(error.message||error));
          if (!data || data.length === 0) throw new Error('Comprobante no encontrado en storage (ruta: '+path+')');
        }
      }
      if (client && receiptUrl) {
        const path = storagePathFromUrl(receiptUrl, '/recibos/');
        if (path) {
          const { data, error } = await client.storage.from('recibos').remove([path]);
          if (error) throw new Error('Storage recibos: '+(error.message||error));
          if (!data || data.length === 0) throw new Error('Recibo no encontrado en storage (ruta: '+path+')');
        }
      }
      await window.SUPABASE.update('payments', p.id, { receipt_url: null, voucher_url: null });
      p.receiptUrl = null; p.receipt_url = null;
      p.voucherUrl = null; p.voucher_url = null;
      clearedIds.push(p.id);
    } catch(e) {
      console.error('No se pudo limpiar el archivo del pago', p.id, e);
    }
  }

  renderVouchers();
  if (typeof renderPayments === 'function') renderPayments();
  if (typeof renderFinances === 'function') renderFinances();
  if (typeof renderMyPayments === 'function') renderMyPayments();
  updatePendingCounts();

  if (clearedIds.length === toArchive.length) {
    showToast(`✓ ZIP descargado — ${clearedIds.length} comprobantes/recibos eliminados del storage (las filas se conservan)`);
  } else {
    showToast(`ZIP descargado — ${clearedIds.length} de ${toArchive.length} limpiados (revisa la consola)`,'error');
  }
}

/* ── FINANCES (ledger completo: pagos de residentes + movimientos manuales) ── */
function renderFinances() {
  const month = document.getElementById('filterFinMonth')?.value||'';
  const type  = document.getElementById('filterFinType')?.value||'';
  const ledger = DB.payments.filter(p=>p.status==='approved');
  const txDateFilter = p => p.approvedDate||p.approved_date||p.paymentDate||p.payment_date||'';
  const filtered = ledger.filter(p=>
    (!type||p.type===type) &&
    (!month || String(txDateFilter(p)).startsWith(month))
  );
  const totalIn  = filtered.filter(p=>p.type==='income').reduce((s,p)=>s+Number(p.amount||0),0);
  const totalEx  = filtered.filter(p=>p.type==='expense').reduce((s,p)=>s+Number(p.amount||0),0);
  const remanente = calcRemanente(month ? month+'-01' : firstDayOfCurrentMonth());
  const fm = document.getElementById('finMetrics');
  if (fm) fm.innerHTML = `
    <div class="metric"><div class="metric-label">Remanente mes anterior</div><div class="metric-value" style="color:${remanente>=0?'var(--navy)':'var(--c-red)'}">${fmt(remanente)}</div></div>
    <div class="metric"><div class="metric-label">Ingresos filtrados</div><div class="metric-value" style="color:var(--navy)">${fmt(totalIn)}</div></div>
    <div class="metric"><div class="metric-label">Egresos filtrados</div><div class="metric-value" style="color:var(--c-red)">${fmt(totalEx)}</div></div>
    <div class="metric"><div class="metric-label">Balance</div><div class="metric-value" style="color:${totalIn-totalEx>=0?'var(--navy)':'var(--c-red)'}">${fmt(totalIn-totalEx)}</div></div>`;

  const ms = document.getElementById('filterFinMonth');
  if (ms && ms.children.length<=1) {
    const months = [...new Set(ledger.map(p=>String(txDateFilter(p)).slice(0,7)).filter(m=>/^\d{4}-\d{2}$/.test(m)))].sort().reverse();
    months.forEach(m=>{
      const [y,mo] = m.split('-');
      const label = new Date(+y,+mo-1,1).toLocaleDateString('es-MX',{month:'long',year:'numeric'});
      const o = document.createElement('option'); o.value=m; o.textContent=label.charAt(0).toUpperCase()+label.slice(1);
      ms.appendChild(o);
    });
  }

  const txDate = p => p.approvedDate||p.approved_date||p.paymentDate||p.payment_date;
  const tf = document.getElementById('tblFinances');
  if (tf) tf.innerHTML = filtered.sort((a,b)=>new Date(txDate(b))-new Date(txDate(a))).map(p=>{
    const isResident = !!(p.residentId||p.resident_id);
    const concepto  = p.description || (isResident ? 'Cuota mantenimiento '+(p.month||'')+' — Depto '+(p.depto||'') : '—');
    const proveedor = p.provider || (isResident ? (p.residentName||p.resident_name||'—') : '—');
    const ref  = p.reference || p.receiptNum || p.receipt_num || '—';
    return `<tr>
    <td>${fmtDate(txDate(p))}</td><td>${proveedor}</td><td>${concepto}</td>
    <td><span class="badge ${p.type==='income'?'badge-income':'badge-expense'}">${p.type==='income'?'Ingreso':'Egreso'}</span></td>
    <td style="font-weight:500;color:${p.type==='income'?'var(--navy)':'var(--c-red)'}">${p.type==='income'?'+':'−'}${fmt(p.amount)}</td>
    <td style="color:var(--mist)">${ref}</td>
    <td style="display:flex;gap:4px">
      <button class="btn btn-secondary btn-sm" onclick="editTransactionModal(${p.id})">Editar</button>
      <button class="btn btn-danger btn-sm" onclick="deletePayment(${p.id})">Eliminar</button>
    </td>
  </tr>`;}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--mist);padding:1.5rem">Sin transacciones</td></tr>';
}

function editTransactionModal(id) {
  const p = DB.payments.find(p=>p.id===id);
  if (!p) return;
  const isResident = !!(p.residentId||p.resident_id);
  document.getElementById('editTransId').value       = p.id;
  document.getElementById('editTransDate').value     = p.approvedDate||p.approved_date||p.paymentDate||p.payment_date||'';
  document.getElementById('editTransType').value     = p.type==='expense' ? 'expense' : 'income';
  document.getElementById('editTransProvider').value = p.provider || '';
  document.getElementById('editTransAmount').value   = p.amount || '';
  document.getElementById('editTransDesc').value     = p.description || (isResident ? 'Cuota mantenimiento '+(p.month||'')+' — Depto '+(p.depto||'') : '');
  document.getElementById('editTransCat').value      = p.category || '';
  document.getElementById('editTransRef').value      = p.reference || '';
  document.getElementById('editTransNotes').value    = p.notes || '';
  openModal('modalEditTransaction');
}

async function saveEditTransaction() {
  const id     = Number(document.getElementById('editTransId').value);
  const p      = DB.payments.find(p=>p.id===id);
  if (!p) return;
  const date     = document.getElementById('editTransDate').value;
  const type     = document.getElementById('editTransType').value;
  const provider = document.getElementById('editTransProvider').value.trim();
  const amount   = parseFloat(document.getElementById('editTransAmount').value);
  const desc     = document.getElementById('editTransDesc').value.trim();
  const cat      = document.getElementById('editTransCat').value.trim();
  const ref      = document.getElementById('editTransRef').value.trim();
  const notes    = document.getElementById('editTransNotes').value.trim();
  if (!date||!amount||!desc) { showToast('Completa fecha, monto y concepto','error'); return; }

  const updates = {
    type, amount, description:desc, category:cat, provider, reference:ref, notes,
    approved_date: date
  };
  try {
    await window.SUPABASE.update('payments', id, updates);
    Object.assign(p, updates, { approvedDate:date });
  } catch(e) {
    console.error('No se pudo guardar la transacción', e);
    showToast('Error al guardar: '+(e?.message||e),'error');
    return;
  }
  closeModal('modalEditTransaction'); renderFinances(); renderDashboard();
  showToast('✓ Transacción actualizada');
}

function openModalTransaction(type) {
  document.getElementById('transType').value = type;
  document.getElementById('transModalTitle').textContent = type==='income'?'Nuevo ingreso':'Nuevo egreso';
  document.getElementById('transDate').value = new Date().toISOString().split('T')[0];
  ['transAmount','transDesc','transRef','transNotes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  openModal('modalTransaction');
}

async function saveTransaction() {
  const type   = document.getElementById('transType').value;
  const date   = document.getElementById('transDate').value;
  const amount = parseFloat(document.getElementById('transAmount').value);
  const desc   = document.getElementById('transDesc').value.trim();
  const cat    = document.getElementById('transCat').value;
  const ref    = document.getElementById('transRef').value.trim();
  const notes  = document.getElementById('transNotes').value.trim();
  if (!date||!amount||!desc) { showToast('Completa fecha, monto y descripción','error'); return; }
  const rec = { type, date, amount, description:desc, category:cat, reference:ref, notes };
  try {
    const sb = window.SUPABASE;
    const rows = await sb.insert('payments', toDbTransaction(rec));
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row) DB.payments.push(normalizePayment(row));
  } catch(e) {
    console.error('Supabase insert transaction failed', e);
    showToast('Error al guardar: '+(e?.message||e),'error');
    return;
  }
  closeModal('modalTransaction'); renderFinances(); renderDashboard();
  showToast((type==='income'?'Ingreso':'Egreso')+' registrado: '+fmt(amount));
}

/* ── IMPORT CSV ─────────────────────────────────────────────── */
function openModalImport() {
  const fileEl = document.getElementById('txFile');
  const pasteEl = document.getElementById('txPaste');
  const labelEl = document.getElementById('txFileLabel');
  if (fileEl) fileEl.value = '';
  if (pasteEl) pasteEl.value = '';
  if (labelEl) labelEl.textContent = 'Seleccionar .csv';
  openModal('modalImport');
}

function normalizeImportType(raw) {
  const t = (raw||'').trim().toLowerCase();
  if (['ingreso','ingresos','income','in'].includes(t)) return 'income';
  if (['egreso','egresos','expense','gasto','out'].includes(t)) return 'expense';
  return '';
}

function parseDelimitedRow(line, delim) {
  if (delim === '\t') return line.split('\t');
  const out = []; let cur = ''; let inQuotes = false;
  for (let i=0; i<line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeImportDate(raw) {
  raw = (raw||'').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y,m,d] = raw.split('-');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  const slash = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    // Excel exporta como MES/DÍA/AÑO (EE.UU.) la mayoría de las veces.
    // Si el primer número no puede ser mes (>12), se interpreta al revés
    // (DÍA/MES/AÑO) en vez de generar una fecha inválida.
    let [, a, b, y] = slash;
    let month = parseInt(a,10), day = parseInt(b,10);
    if (month > 12 && day <= 12) { const t = month; month = day; day = t; }
    if (month > 12 || day > 31) return '';
    return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const parsed = new Date(raw);
  return isNaN(parsed) ? '' : parsed.toISOString().split('T')[0];
}

async function doImportTransactions() {
  const fileEl  = document.getElementById('txFile');
  const pasteEl = document.getElementById('txPaste');
  let lines, delim;
  if (fileEl?.files?.[0]) {
    const text = await fileEl.files[0].text();
    lines = text.trim().split('\n'); delim = ',';
  } else if (pasteEl?.value.trim()) {
    lines = pasteEl.value.trim().split('\n'); delim = '\t';
  } else {
    showToast('Selecciona un archivo o pega los datos','error'); return;
  }

  let imported = 0, failed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const [dateRaw, typeRaw, provider, concept, amountRaw] = parseDelimitedRow(line, delim).map(c=>(c||'').trim());
    const date = normalizeImportDate(dateRaw);
    const type = normalizeImportType(typeRaw);
    if (!date && i === 0) continue; // encabezado (fecha,tipo,proveedor,concepto,monto)
    const amount = parseFloat(String(amountRaw||'').replace(/[^0-9.\-]/g,''));
    if (!date || !type || !concept || !amount) { failed++; continue; }
    try {
      const rec = { type, date, amount, description:concept,
        category: type==='income' ? 'Ingresos importados' : 'Egresos importados',
        provider, reference:'', notes:'' };
      const rows = await window.SUPABASE.insert('payments', toDbTransaction(rec));
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) DB.payments.push(normalizePayment(row));
      imported++;
    } catch(e) { console.error('Import transacción failed', line, e); failed++; }
  }
  closeModal('modalImport'); renderFinances(); renderDashboard();
  showToast(`${imported} transacciones importadas${failed?` (${failed} con error, revisa formato de fecha/tipo/monto)`:''} ✓`, failed && !imported ? 'error' : 'success');
}

function exportCSV() {
  const ledger = DB.payments.filter(p=>p.status==='approved');
  const headers='Fecha,Descripción,Proveedor,Tipo,Categoría,Monto,Referencia,Notas';
  const txDate = p => p.approvedDate||p.approved_date||p.paymentDate||p.payment_date||'';
  const rows = ledger.map(p=>{
    const isResident = !!(p.residentId||p.resident_id);
    const desc = p.description || (isResident ? 'Cuota mantenimiento '+(p.month||'')+' — Depto '+(p.depto||'') : '');
    const cat  = p.category || (isResident ? 'Mantenimiento' : '');
    const ref  = p.reference || p.receiptNum || p.receipt_num || '';
    return `${txDate(p)},"${desc}","${p.provider||''}",${p.type},${cat},${p.amount},${ref},"${p.notes||''}"`;
  });
  const csv=[headers,...rows].join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`finanzas-rm3-${new Date().toISOString().split('T')[0]}.csv`; a.click();
  showToast('CSV exportado ✓');
}

/* ── REPORTS ────────────────────────────────────────────────── */
function renderReports() {
  const monthStart = firstDayOfCurrentMonth();
  const remanente = calcRemanente(monthStart);
  const thisMonth = DB.payments.filter(p => p.status==='approved' && txLedgerDate(p) >= monthStart);
  const ingresosMes = thisMonth.filter(p=>p.type==='income').reduce((s,p)=>s+Number(p.amount||0),0);
  const egresosMes  = thisMonth.filter(p=>p.type==='expense').reduce((s,p)=>s+Number(p.amount||0),0);
  const remanenteSiguiente = remanente + ingresosMes - egresosMes;
  const summary = document.getElementById('reportSummary');
  if (summary) summary.innerHTML = `
    <div class="metric"><div class="metric-label">Remanente mes anterior</div><div class="metric-value" style="color:${remanente>=0?'var(--navy)':'var(--c-red)'}">${fmt(remanente)}</div></div>
    <div class="metric"><div class="metric-label">Ingresos del mes</div><div class="metric-value">${fmt(ingresosMes)}</div></div>
    <div class="metric"><div class="metric-label">Egresos del mes</div><div class="metric-value" style="color:var(--c-red)">${fmt(egresosMes)}</div></div>
    <div class="metric"><div class="metric-label">Remanente para el siguiente mes</div><div class="metric-value" style="color:${remanenteSiguiente>=0?'var(--navy)':'var(--c-red)'}">${fmt(remanenteSiguiente)}</div></div>`;

  const tbody = document.getElementById('tblReport');
  if (!tbody) return;
  tbody.innerHTML = DB.residents.map(r=>{
    const myPays=DB.payments.filter(p=>(p.residentId===r.id||p.resident_id===r.id)&&p.status==='approved');
    const latest=myPays.sort((a,b)=>new Date(b.approvedDate||b.approved_date)-new Date(a.approvedDate||a.approved_date))[0];
    const hasCurrent=myPays.find(p=>{
      const d=new Date(); const mn=d.toLocaleDateString('es-MX',{month:'long'})+' '+d.getFullYear();
      return (p.month||'').toLowerCase().includes(mn.toLowerCase());
    });
    return `<tr>
      <td><strong>${r.depto||'—'}</strong></td><td>${r.name}</td><td>${fmt(DB.settings?.defaultFee||400)}</td>
      <td><span class="badge ${hasCurrent?'badge-approved':r.status==='approved'?'badge-pending':'badge-rejected'}">${hasCurrent?'Pagado':r.status==='approved'?'Pendiente':'Inactivo'}</span></td>
      <td>${latest?fmtDate(latest.approvedDate||latest.approved_date):'—'}</td>
    </tr>`;
  }).join('');
}

/* ── EDIT CONTACTS (admin) ─────────────────────────────────── */
function renderEditContacts() {
  const c = DB.contacts;
  const area = document.getElementById('editContactsArea');
  if (!area) return;
  area.innerHTML = `
    <div class="card" style="margin-bottom:1rem;padding:1.25rem">
      <div style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:1rem">Administración</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Teléfono 1</label><input type="tel" id="ec_adminPhone1" value="${c.admin.phone1.display}"></div>
        <div class="field"><label>Teléfono 2</label><input type="tel" id="ec_adminPhone2" value="${c.admin.phone2.display}"></div>
        <div class="field"><label>WhatsApp (con código país, sin +)</label><input type="tel" id="ec_adminWA" value="${c.admin.whatsapp}"></div>
        <div class="field"><label>Correo</label><input type="email" id="ec_adminEmail" value="${c.admin.email}"></div>
        <div class="field" style="grid-column:1/-1"><label>Horario</label><input type="text" id="ec_adminHours" value="${c.admin.hours}"></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:1rem;padding:1.25rem">
      <div style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:1rem">Caseta de Seguridad</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Teléfono 1</label><input type="tel" id="ec_casetaPhone1" value="${c.caseta.phone1.display}"></div>
        <div class="field"><label>Teléfono 2</label><input type="tel" id="ec_casetaPhone2" value="${c.caseta.phone2.display}"></div>
        <div class="field"><label>WhatsApp</label><input type="tel" id="ec_casetaWA" value="${c.caseta.whatsapp}"></div>
        <div class="field" style="grid-column:1/-1"><label>Horario</label><input type="text" id="ec_casetaHours" value="${c.caseta.hours||''}" placeholder="Ej. Lun–Dom 8:00–20:00"></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:1rem;padding:1.25rem">
      <div style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:1rem">Configuración general</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Cuota mensual por defecto (MXN)</label><input type="number" id="ec_defaultFee" value="${DB.settings?.defaultFee||400}"></div>
      </div>
    </div>
    <button class="btn btn-gold" onclick="saveContacts()">Guardar contactos</button>`;
}

async function saveContacts() {
  const c = DB.contacts;
  c.admin.phone1.display = document.getElementById('ec_adminPhone1').value;
  c.admin.phone1.number  = c.admin.phone1.display.replace(/[\s\-\(\)]/g,'');
  c.admin.phone2.display = document.getElementById('ec_adminPhone2').value;
  c.admin.phone2.number  = c.admin.phone2.display.replace(/[\s\-\(\)]/g,'');
  c.admin.whatsapp       = document.getElementById('ec_adminWA').value;
  c.admin.email          = document.getElementById('ec_adminEmail').value;
  c.admin.hours          = document.getElementById('ec_adminHours').value;
  c.caseta.phone1.display= document.getElementById('ec_casetaPhone1').value;
  c.caseta.phone1.number = c.caseta.phone1.display.replace(/[\s\-\(\)]/g,'');
  c.caseta.phone2.display= document.getElementById('ec_casetaPhone2').value;
  c.caseta.phone2.number = c.caseta.phone2.display.replace(/[\s\-\(\)]/g,'');
  c.caseta.whatsapp      = document.getElementById('ec_casetaWA').value;
  c.caseta.hours          = document.getElementById('ec_casetaHours').value;
  DB.settings.defaultFee = parseFloat(document.getElementById('ec_defaultFee').value) || 400;

  try {
    const client = window.SUPABASE?.client?.();
    if (!client) throw new Error('Sin conexión con Supabase');
    const { error } = await client.from('settings').upsert({
      id: 1, contacts: c, default_fee: DB.settings.defaultFee, updated_at: new Date().toISOString()
    });
    if (error) throw error;
    showToast('✓ Contactos actualizados y guardados');
  } catch(e) {
    console.error('No se pudo guardar la configuración en Supabase', e);
    showToast('Se actualizó en pantalla, pero no se pudo guardar permanentemente (¿falta la tabla "settings"?)', 'error');
  }
}
