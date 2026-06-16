/* ================================================================
   Real Molinos 3 — Vistas de Administrador
   ================================================================ */

/* ── DASHBOARD ─────────────────────────────────────────────── */
function renderDashboard() {
  const totalIncome  = DB.finances.filter(f=>f.type==='income').reduce((s,f)=>s+Number(f.amount||0),0);
  const totalExpense = DB.finances.filter(f=>f.type==='expense').reduce((s,f)=>s+Number(f.amount||0),0);
  const balance      = totalIncome - totalExpense;
  const approvedRes  = DB.residents.filter(r=>r.status==='approved').length;
  const pendingRes   = DB.residents.filter(r=>r.status==='pending').length;
  const pendingPay   = DB.payments.filter(p=>p.status==='pending').length;

  const area = document.getElementById('metricsArea');
  if (area) area.innerHTML = `
    <div class="metric"><div class="metric-label">Balance total</div><div class="metric-value" style="color:${balance>=0?'var(--navy)':'var(--c-red)'}">${fmt(balance)}</div><div class="metric-change">Ingresos − Egresos</div></div>
    <div class="metric"><div class="metric-label">Ingresos totales</div><div class="metric-value">${fmt(totalIncome)}</div><div class="metric-change up">↑ acumulado</div></div>
    <div class="metric"><div class="metric-label">Egresos totales</div><div class="metric-value">${fmt(totalExpense)}</div><div class="metric-change down">↓ acumulado</div></div>
    <div class="metric"><div class="metric-label">Residentes activos</div><div class="metric-value">${approvedRes}</div><div class="metric-change">${pendingRes} pendientes de auth</div></div>
    <div class="metric"><div class="metric-label">Comprobantes</div><div class="metric-value" style="color:var(--c-amber)">${pendingPay}</div><div class="metric-change">por revisar</div></div>`;

  renderCharts();

  const all = [
    ...DB.finances.map(f=>({date:f.date, desc:f.desc||f.description||'', type:f.type, amount:f.amount, status:'—'})),
    ...DB.payments.map(p=>({date:p.sentDate||p.sent_date, desc:'Pago '+(p.month||'')+' — Depto '+(p.depto||''), type:'payment', amount:p.amount, status:p.status}))
  ];
  all.sort((a,b)=>new Date(b.date)-new Date(a.date));
  const ra = document.getElementById('recentActivity');
  if (ra) ra.innerHTML = all.slice(0,8).map(r=>`<tr>
    <td>${fmtDate(r.date)}</td><td>${r.desc}</td>
    <td><span class="badge ${r.type==='income'?'badge-income':r.type==='expense'?'badge-expense':'badge-pending'}">${r.type==='income'?'Ingreso':r.type==='expense'?'Egreso':'Pago'}</span></td>
    <td style="font-weight:500;color:${r.type==='income'?'var(--navy)':'var(--c-red)'}">${r.type==='income'?'+':'−'}${fmt(r.amount)}</td>
    <td><span class="badge ${r.status==='approved'?'badge-approved':r.status==='pending'?'badge-pending':'badge-rejected'}">${r.status==='—'?'—':r.status==='approved'?'Aprobado':r.status==='pending'?'Pendiente':'Rechazado'}</span></td>
  </tr>`).join('');
}

function renderCharts() {
  const months  = ['Ene','Feb','Mar','Abr','May','Jun'];
  const mKeys   = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
  const incomes  = mKeys.map(m=>DB.finances.filter(f=>f.type==='income' &&String(f.date||'').startsWith(m)).reduce((s,f)=>s+Number(f.amount||0),0));
  const expenses = mKeys.map(m=>DB.finances.filter(f=>f.type==='expense'&&String(f.date||'').startsWith(m)).reduce((s,f)=>s+Number(f.amount||0),0));
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
  DB.finances.filter(f=>f.type==='expense').forEach(f=>{const k=f.cat||f.category||'Otros'; cats[k]=(cats[k]||0)+Number(f.amount||0);});
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
  const r = DB.residents.find(r=>r.id===id);
  if (!r) return;
  r.status = 'approved';
  // Also update user record
  const u = DB.users.find(u=>u.id===r.userId||u.id===r.user_id||u.email===r.email);
  if (u) { u.deptoStatus='approved'; u.depto_status='approved'; }
  try {
    const client = window.SUPABASE?.client?.();
    if (client) {
      await client.from('residents').update({status:'approved'}).eq('id',id);
      if (u?.id) await client.from('users').update({depto_status:'approved'}).eq('id',u.id);
    }
  } catch(e) { console.warn('Supabase approve resident failed',e); }
  renderResidents();
  showToast('✓ Residente '+r.name+' autorizado — Depto '+r.depto);
}

async function rejectResident(id) {
  const r = DB.residents.find(r=>r.id===id);
  if (r) {
    r.status = 'rejected';
    try {
      const client = window.SUPABASE?.client?.();
      if (client) await client.from('residents').update({status:'rejected'}).eq('id',id);
    } catch(e) { console.warn('Supabase reject resident failed',e); }
  }
  renderResidents(); showToast('Residente rechazado','error');
}

async function deleteResident(id) {
  if (!confirm('¿Eliminar este residente?')) return;
  DB.residents = DB.residents.filter(r=>r.id!==id);
  try {
    const client = window.SUPABASE?.client?.();
    if (client) await client.from('residents').delete().eq('id',id);
  } catch(e) { console.warn('Supabase delete resident failed',e); }
  renderResidents(); showToast('Residente eliminado');
}

function editResidentModal(id) {
  const r = DB.residents.find(r=>r.id===id);
  if (!r) return;
  document.getElementById('editResId').value    = r.id;
  document.getElementById('editResName').value  = r.name  ||'';
  document.getElementById('editResEmail').value = r.email ||'';
  document.getElementById('editResPhone').value = r.phone ||'';
  document.getElementById('editResDepto').value = r.depto ||'';
  document.getElementById('editResFee').value   = r.fee   ||1500;
  document.getElementById('editResStatus').value= r.status||'pending';
  openModal('modalEditResident');
}

async function saveEditResident() {
  const id     = Number(document.getElementById('editResId').value);
  const r      = DB.residents.find(r=>r.id===id);
  if (!r) return;
  r.name   = document.getElementById('editResName').value.trim();
  r.email  = document.getElementById('editResEmail').value.trim();
  r.phone  = document.getElementById('editResPhone').value.trim();
  r.depto  = document.getElementById('editResDepto').value.trim().toUpperCase().replace(/\s+/g,'');
  r.fee    = parseFloat(document.getElementById('editResFee').value)||1500;
  r.status = document.getElementById('editResStatus').value;
  try {
    const client = window.SUPABASE?.client?.();
    if (client) await client.from('residents').update({name:r.name,email:r.email,phone:r.phone,depto:r.depto,fee:r.fee,status:r.status}).eq('id',id);
  } catch(e) { console.warn('Supabase update resident failed',e); }
  closeModal('modalEditResident'); renderResidents(); showToast('Residente actualizado ✓');
}

function openModalAddResident() {
  ['newResName','newResEmail','newResPhone','newResDepto'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  const fee=document.getElementById('newResFee'); if(fee) fee.value='1500';
  openModal('modalAddResident');
}
async function saveNewResident() {
  const name   = document.getElementById('newResName').value.trim();
  const email  = document.getElementById('newResEmail').value.trim();
  const phone  = document.getElementById('newResPhone').value.trim();
  const depto  = document.getElementById('newResDepto').value.trim().toUpperCase().replace(/\s+/g,'');
  const fee    = parseFloat(document.getElementById('newResFee').value)||1500;
  const status = document.getElementById('newResStatus').value;
  if (!name||!depto) { showToast('Nombre y departamento son requeridos','error'); return; }
  const rec = {name,email,phone,depto,status,fee,user_id:null};
  try {
    const sb = window.SUPABASE;
    if (sb&&sb.config().hasKey) {
      const {data,error} = await sb.insert('residents',toDbResident(rec));
      if (error) throw error;
      const row = Array.isArray(data)?data[0]:data;
      if (row) DB.residents.push({...rec,id:row.id,userId:null});
    } else { DB.residents.push({...rec,id:DB.nextId++}); }
  } catch(e) { console.warn('Supabase insert resident failed',e); DB.residents.push({...rec,id:DB.nextId++}); }
  closeModal('modalAddResident'); renderResidents(); showToast('Residente '+name+' agregado ✓');
}

/* ── PAYMENTS / VOUCHERS (admin) ───────────────────────────── */
function renderPayments() {
  const month   = document.getElementById('filterPayMonth')?.value||'';
  const pending = DB.payments.filter(p=>p.status==='pending');
  const all     = DB.payments.filter(p=>!month||p.month===month);
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
    </td></tr>`).join()||'<tr><td colspan="8" style="text-align:center;color:var(--mist);padding:1.5rem">Sin comprobantes pendientes ✓</td></tr>';

  document.getElementById('tblAllPayments').innerHTML = all.map(p=>`<tr>
    <td>${p.residentName||p.resident_name||'—'}</td><td>${p.depto||'—'}</td>
    <td>${p.month||'—'}</td><td>${fmt(p.amount)}</td>
    <td><span class="badge ${p.status==='approved'?'badge-approved':p.status==='pending'?'badge-pending':'badge-rejected'}">${p.status==='approved'?'Aprobado':p.status==='pending'?'Pendiente':'Rechazado'}</span></td>
    <td>${(p.receiptNum||p.receipt_num)?`<button class="btn btn-secondary btn-sm" onclick="showReceipt(${p.id})">${p.receiptNum||p.receipt_num}</button>`:'—'}</td>
  </tr>`).join('');
  updatePendingCounts();
}

async function approvePayment(id) {
  const p = DB.payments.find(p=>p.id===id);
  if (!p) return;
  const today = new Date();
  const mm    = String(today.getMonth()+1).padStart(2,'0');
  const yyyy  = today.getFullYear();
  p.status       = 'approved';
  p.approvedDate = today.toISOString().split('T')[0];
  p.approved_date= p.approvedDate;
  p.receiptNum   = `${yyyy}-${mm}-${p.depto||'XXX'}`;
  p.receipt_num  = p.receiptNum;

  try {
    const client = window.SUPABASE?.client?.();
    if (client) {
      await client.from('payments').update({
        status:'approved', approved_date:p.approvedDate, receipt_num:p.receiptNum
      }).eq('id',id);
      await client.from('finances').insert({
        date:p.approvedDate, description:'Cuota mantenimiento '+p.month+' — Depto '+p.depto,
        category:'Mantenimiento', type:'income', amount:p.amount,
        reference:p.receiptNum, notes:'', cat:'Mantenimiento', ref:p.receiptNum
      });
    }
  } catch(e) { console.warn('Supabase approve payment failed',e); }

  Array.prototype.push.call(DB.finances,{
    id:DB.nextId++, date:p.approvedDate,
    desc:'Cuota mantenimiento '+p.month+' — Depto '+p.depto,
    description:'Cuota mantenimiento '+p.month+' — Depto '+p.depto,
    cat:'Mantenimiento', category:'Mantenimiento',
    type:'income', amount:p.amount, ref:p.receiptNum, reference:p.receiptNum, notes:''
  });

  renderPayments();
  showReceipt(id);
  updatePendingCounts();
  showToast('✓ Pago aprobado — Recibo '+p.receiptNum+' generado');
}

async function rejectPayment(id) {
  const p = DB.payments.find(p=>p.id===id);
  if (p) {
    p.status='rejected';
    try {
      const client=window.SUPABASE?.client?.();
      if(client) await client.from('payments').update({status:'rejected'}).eq('id',id);
    } catch(e){ console.warn(e); }
  }
  renderPayments(); showToast('Comprobante rechazado','error'); updatePendingCounts();
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
  document.getElementById('voucherFoot').innerHTML = `
    <button class="btn btn-danger btn-sm" onclick="rejectPayment(${id});closeModal('modalViewVoucher')">✕ Rechazar</button>
    <button class="btn btn-gold" onclick="approvePayment(${id});closeModal('modalViewVoucher')">✓ Aprobar y generar recibo</button>`;
  openModal('modalViewVoucher');
}

/* ── VOUCHERS BY FOLDER (organized by depto) ───────────────── */
function renderVouchers() {
  const area = document.getElementById('vouchersArea');
  if (!area) return;

  // Group by depto
  const byDepto = {};
  DB.payments.forEach(p => {
    const d = p.depto||'SIN-DEPTO';
    if (!byDepto[d]) byDepto[d] = [];
    byDepto[d].push(p);
  });

  const today   = new Date();
  const day     = today.getDate();
  const canDownload = day >= 10 && day <= 15;

  area.innerHTML = `
    <div class="alert alert-${canDownload?'gold':'info'}" style="margin-bottom:1.5rem">
      ${canDownload
        ?`📥 <strong>Ventana de descarga activa (días 10–15).</strong> Descarga los comprobantes antes del día 15. Los archivos anteriores al mes en curso se eliminarán automáticamente al descargar o el día 15.`
        :`ℹ️ La descarga masiva de comprobantes está disponible del día 10 al 15 de cada mes.`}
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
  const pays = DB.payments.filter(p=>(p.depto||'SIN-DEPTO')===depto);
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
              ${p.voucherUrl||p.voucher_url?`<button class="btn btn-secondary btn-sm" onclick="window.open('${p.voucherUrl||p.voucher_url}','_blank')">Ver</button>`:''}
              ${p.receiptNum||p.receipt_num?`<button class="btn btn-gold btn-sm" onclick="showReceipt(${p.id})">Recibo</button>`:''}
            </td>
          </tr>`;
        }).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--mist);padding:1rem">Sin archivos</td></tr>'}
      </tbody>
    </table>`;
  openModal('modalFolder');
}

/* ── DOWNLOAD & AUTO-CLEANUP ────────────────────────────────── */
async function downloadAndCleanup() {
  const today = new Date();
  const day   = today.getDate();
  if (day < 10 || day > 15) { showToast('La descarga solo está disponible del día 10 al 15','error'); return; }

  // Export CSV of payments
  const headers = 'Recibo,Depto,Residente,Mes,Monto,Fecha Pago,Fecha Aprobación,Comprobante';
  const rows = DB.payments
    .filter(p=>p.status==='approved')
    .map(p=>[
      p.receiptNum||p.receipt_num||'',
      p.depto||'',
      p.residentName||p.resident_name||'',
      p.month||'',
      p.amount,
      p.paymentDate||p.payment_date||'',
      p.approvedDate||p.approved_date||'',
      p.voucherUrl||p.voucher_url||''
    ].join(','));
  const csv  = [headers,...rows].join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `Pagos-${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}.csv`;
  a.click();

  // Auto-cleanup: remove payments from previous months from Supabase
  const prevMonthThreshold = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0];
  try {
    const client = window.SUPABASE?.client?.();
    if (client) {
      await client.from('payments').delete()
        .lt('approved_date', prevMonthThreshold)
        .eq('status','approved');
      DB.payments = DB.payments.filter(p => {
        const d = p.approvedDate||p.approved_date||'';
        return !d || d >= prevMonthThreshold || p.status !== 'approved';
      });
      showToast('✓ Descarga completada — comprobantes anteriores eliminados');
    }
  } catch(e) { console.warn('Cleanup failed',e); showToast('Descarga completada (limpieza manual requerida)','error'); }
}

/* ── FINANCES ──────────────────────────────────────────────── */
function renderFinances() {
  const type = document.getElementById('filterFinType')?.value||'';
  const cat  = document.getElementById('filterFinCat')?.value||'';
  const filtered = DB.finances.filter(f=>(!type||f.type===type)&&(!cat||(f.cat||f.category||'')===cat));
  const totalIn  = filtered.filter(f=>f.type==='income').reduce((s,f)=>s+Number(f.amount||0),0);
  const totalEx  = filtered.filter(f=>f.type==='expense').reduce((s,f)=>s+Number(f.amount||0),0);
  const fm = document.getElementById('finMetrics');
  if (fm) fm.innerHTML = `
    <div class="metric"><div class="metric-label">Ingresos filtrados</div><div class="metric-value" style="color:var(--navy)">${fmt(totalIn)}</div></div>
    <div class="metric"><div class="metric-label">Egresos filtrados</div><div class="metric-value" style="color:var(--c-red)">${fmt(totalEx)}</div></div>
    <div class="metric"><div class="metric-label">Balance</div><div class="metric-value" style="color:${totalIn-totalEx>=0?'var(--navy)':'var(--c-red)'}">${fmt(totalIn-totalEx)}</div></div>`;

  const cats = [...new Set(DB.finances.map(f=>f.cat||f.category||'Otros').filter(Boolean))];
  const cs = document.getElementById('filterFinCat');
  if (cs&&cs.children.length<=1) cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;cs.appendChild(o);});

  const tf = document.getElementById('tblFinances');
  if (tf) tf.innerHTML = filtered.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(f=>`<tr>
    <td>${fmtDate(f.date)}</td><td>${f.desc||f.description||'—'}</td><td>${f.cat||f.category||'—'}</td>
    <td><span class="badge ${f.type==='income'?'badge-income':'badge-expense'}">${f.type==='income'?'Ingreso':'Egreso'}</span></td>
    <td style="font-weight:500;color:${f.type==='income'?'var(--navy)':'var(--c-red)'}">${f.type==='income'?'+':'−'}${fmt(f.amount)}</td>
    <td style="color:var(--mist)">${f.ref||f.reference||'—'}</td>
    <td><button class="btn btn-danger btn-sm" onclick="deleteTransaction(${f.id})">Eliminar</button></td>
  </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--mist);padding:1.5rem">Sin transacciones</td></tr>';
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
  const rec = {date,desc,description:desc,cat,category:cat,type,amount,ref,reference:ref,notes};
  try {
    const sb=window.SUPABASE;
    if (sb&&sb.config().hasKey) {
      const {data,error}=await sb.insert('finances',toDbFinance(rec));
      if(error) throw error;
      const row=Array.isArray(data)?data[0]:data;
      if(row) DB.finances.push({...rec,...row,id:row.id});
      else DB.finances.push({...rec,id:DB.nextId++});
    } else { DB.finances.push({...rec,id:DB.nextId++}); }
  } catch(e) { console.warn(e); DB.finances.push({...rec,id:DB.nextId++}); }
  closeModal('modalTransaction'); renderFinances();
  showToast((type==='income'?'Ingreso':'Egreso')+' registrado: '+fmt(amount));
}

async function deleteTransaction(id) {
  try {
    const client=window.SUPABASE?.client?.();
    if(client) await client.from('finances').delete().eq('id',id);
  } catch(e){ console.warn(e); }
  DB.finances=DB.finances.filter(f=>f.id!==id);
  renderFinances(); showToast('Transacción eliminada');
}

/* ── IMPORT CSV ─────────────────────────────────────────────── */
function openModalImport() { openModal('modalImport'); }
function selectImportMethod(m) {
  const area=document.getElementById('importMethodArea');
  const btn=document.getElementById('btnDoImport');
  if (m==='csv') {
    area.innerHTML='<div class="field"><label>Archivo CSV</label><div class="upload-zone" onclick="document.getElementById(\'csvFile\').click()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:28px;height:28px;margin:0 auto 6px;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><div>Seleccionar .csv</div><div style="font-size:11px;color:var(--mist);margin-top:4px">fecha, descripcion, tipo, monto, categoria, referencia</div></div><input type="file" id="csvFile" accept=".csv" style="display:none"></div>';
    btn.style.display='inline-flex';
  } else if (m==='paste') {
    area.innerHTML='<div class="field"><label>Pegar desde Excel (Tab separado)</label><textarea id="pasteData" placeholder="2026-06-01\tCuota depto 10H\tincome\t1500\tMantenimiento" style="height:120px;font-family:monospace;font-size:12px"></textarea></div>';
    btn.style.display='inline-flex';
  }
}

async function doImport() {
  const pasteEl = document.getElementById('pasteData');
  if (!pasteEl?.value.trim()) { showToast('Pega datos o selecciona un archivo','error'); return; }
  const lines = pasteEl.value.trim().split('\n');
  let imported = 0;
  for (const line of lines) {
    const [date,desc,type,amount,cat,ref] = line.split('\t');
    if (date&&desc&&type&&amount) {
      const rec={date:date.trim(),desc:desc.trim(),description:desc.trim(),cat:cat?.trim()||'Otros',category:cat?.trim()||'Otros',type:type.trim(),amount:parseFloat(amount)||0,ref:ref?.trim()||'',reference:ref?.trim()||'',notes:''};
      try {
        const sb=window.SUPABASE;
        if(sb&&sb.config().hasKey){const{data,error}=await sb.insert('finances',toDbFinance(rec));if(!error){const row=Array.isArray(data)?data[0]:data;DB.finances.push({...rec,id:row?.id||DB.nextId++});}}
        else DB.finances.push({...rec,id:DB.nextId++});
      } catch(e){ DB.finances.push({...rec,id:DB.nextId++}); }
      imported++;
    }
  }
  closeModal('modalImport'); renderFinances(); showToast(imported+' transacciones importadas ✓');
}

function exportCSV() {
  const headers='Fecha,Descripción,Tipo,Categoría,Monto,Referencia,Notas';
  const rows=DB.finances.map(f=>`${f.date},"${f.desc||f.description||''}",${f.type},${f.cat||f.category||''},${f.amount},${f.ref||f.reference||''},"${f.notes||''}"`);
  const csv=[headers,...rows].join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`finanzas-rm3-${new Date().toISOString().split('T')[0]}.csv`; a.click();
  showToast('CSV exportado ✓');
}

/* ── REPORTS ────────────────────────────────────────────────── */
function renderReports() {
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
      <td><strong>${r.depto||'—'}</strong></td><td>${r.name}</td><td>${fmt(r.fee||1500)}</td>
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
      </div>
    </div>
    <button class="btn btn-gold" onclick="saveContacts()">Guardar contactos</button>`;
}

function saveContacts() {
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
  showToast('✓ Contactos actualizados');
}
