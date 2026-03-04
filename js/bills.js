// ── Bills Tab ─────────────────────────────────────────────────────────────────

let _billsCache = [];
let _paidCache  = {};
let _billsMonth = '';  // YYYY-MM

function billsDueDayNum(bill) {
  // Extract leading number from dueDay string (e.g. "15th" → 15, "20th (Mar...)" → 20)
  const m = String(bill.dueDay || '99').match(/\d+/);
  return m ? parseInt(m[0], 10) : 99;
}

function billDueThisMonth(bill, yearMonth) {
  const [year, mon] = yearMonth.split('-').map(Number);
  const monthNames  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const monthAbbr   = monthNames[mon - 1];

  if (bill.frequency === 'monthly') return true;

  if (bill.frequency === 'quarterly') {
    // Look for this month's abbreviation in the dueDay string
    const dueDayLower = (bill.dueDay || '').toLowerCase();
    return dueDayLower.includes(monthAbbr);
  }

  if (bill.frequency === 'annual') {
    // Expect dueDay to contain month name, e.g. "January 1st"
    const dueDayLower = (bill.dueDay || '').toLowerCase();
    return dueDayLower.includes(monthAbbr) || dueDayLower.includes(monthNames[mon - 1]);
  }

  return true;
}

async function loadBills(uid) {
  _billsCache = await getBills(uid);
}

async function renderBillsTab(uid) {
  if (!_billsMonth) {
    const now = new Date();
    _billsMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  document.getElementById('bills-month').value = _billsMonth;

  await loadBills(uid);
  _paidCache = await getMonthlyPaid(uid, _billsMonth);
  _renderBillsList(uid);
}

function _renderBillsList(uid) {
  const list = document.getElementById('bills-list');
  const activeBills = _billsCache
    .filter(b => b.active !== false && billDueThisMonth(b, _billsMonth))
    .sort((a, b) => billsDueDayNum(a) - billsDueDayNum(b));

  if (!activeBills.length) {
    list.innerHTML = '<div class="empty-state">No bills due this month. Click <strong>+ Add Bill</strong> to add one.</div>';
    document.getElementById('bills-summary').classList.add('hidden');
    return;
  }

  document.getElementById('bills-summary').classList.remove('hidden');

  let totalDue = 0, totalPaid = 0, countPaid = 0;
  activeBills.forEach(b => {
    if (b.amount) totalDue += b.amount;
    if (_paidCache[b.id]) {
      totalPaid += (_paidCache[b.id].amount || b.amount || 0);
      countPaid++;
    }
  });

  document.getElementById('summary-total').textContent     = fmt(totalDue);
  document.getElementById('summary-paid').textContent      = fmt(totalPaid);
  document.getElementById('summary-remaining').textContent = fmt(Math.max(0, totalDue - totalPaid));
  document.getElementById('summary-count').textContent     = `${countPaid} / ${activeBills.length}`;

  list.innerHTML = activeBills.map(b => billCardHTML(b)).join('');

  // Wire up buttons
  list.querySelectorAll('.btn-mark-paid').forEach(btn => {
    btn.addEventListener('click', () => openPaidModal(btn.dataset.id, uid));
  });
  list.querySelectorAll('.btn-unmark-paid').forEach(btn => {
    btn.addEventListener('click', () => unmarkPaid(btn.dataset.id, uid));
  });
  list.querySelectorAll('.btn-edit-bill').forEach(btn => {
    btn.addEventListener('click', () => openBillModal(btn.dataset.id));
  });
  list.querySelectorAll('.btn-delete-bill').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteBill(btn.dataset.id, uid));
  });
}

function billCardHTML(bill) {
  const paid    = _paidCache[bill.id];
  const isPaid  = !!paid;
  const amtText = bill.amount ? fmt(bill.amount) : '';
  const amtClass = bill.amount ? '' : 'variable';
  const amtDisplay = bill.amount ? fmt(bill.amount) : '<span class="text-muted">variable</span>';

  const freqBadge = bill.frequency === 'quarterly'
    ? '<span class="badge badge-quarterly">Quarterly</span>'
    : bill.frequency === 'annual'
      ? '<span class="badge badge-annual">Annual</span>'
      : '';

  const autopayBadge = bill.autopay
    ? '<span class="badge badge-autopay">Autopay</span>'
    : '<span class="badge badge-manual">Manual</span>';

  const statusIcon = isPaid ? '✅' : '⏳';
  const cardClass  = isPaid ? 'paid' : '';

  const paidDetails = isPaid
    ? `<div class="paid-details">Paid ${paid.paidDate ? `on ${paid.paidDate}` : ''} ${paid.amount ? '— ' + fmt(paid.amount) : ''} ${paid.confirmation ? '— ' + paid.confirmation : ''}</div>`
    : '';

  const markBtn = isPaid
    ? `<button class="btn btn-ghost btn-sm btn-unmark-paid" data-id="${bill.id}" title="Undo paid">↩ Undo</button>`
    : `<button class="btn btn-primary btn-sm btn-mark-paid" data-id="${bill.id}">Mark Paid</button>`;

  return `
    <div class="bill-card ${cardClass}" data-id="${bill.id}">
      <div class="bill-status-icon">${statusIcon}</div>
      <div class="bill-info">
        <div class="bill-name">${esc(bill.company)}${bill.service ? ' — ' + esc(bill.service) : ''}</div>
        <div class="bill-meta">Due: ${esc(bill.dueDay || '—')} ${bill.linkedAccount ? '· ' + esc(bill.linkedAccount) : ''} ${bill.notes ? '· ' + esc(bill.notes) : ''}</div>
        ${paidDetails}
      </div>
      <div class="bill-tags">
        ${autopayBadge}
        ${freqBadge}
      </div>
      <div class="bill-amount ${amtClass}">${amtDisplay}</div>
      <div class="bill-actions">
        ${markBtn}
        <button class="btn-icon btn-edit-bill" data-id="${bill.id}" title="Edit">✏️</button>
        <button class="btn-icon btn-delete-bill" data-id="${bill.id}" title="Delete">🗑️</button>
      </div>
    </div>`;
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────
function openBillModal(billId) {
  const bill = billId ? _billsCache.find(b => b.id === billId) : null;
  document.getElementById('modal-bill-title').textContent = bill ? 'Edit Bill' : 'Add Bill';
  document.getElementById('bill-id').value              = bill?.id || '';
  document.getElementById('bill-company').value         = bill?.company || '';
  document.getElementById('bill-service').value         = bill?.service || '';
  document.getElementById('bill-due-day').value         = bill?.dueDay || '';
  document.getElementById('bill-amount').value          = bill?.amount || '';
  document.getElementById('bill-frequency').value       = bill?.frequency || 'monthly';
  document.getElementById('bill-autopay').checked       = bill?.autopay || false;
  document.getElementById('bill-linked-account').value  = bill?.linkedAccount || '';
  document.getElementById('bill-notes').value           = bill?.notes || '';
  document.getElementById('bill-active').checked        = bill?.active !== false;
  openModal('modal-bill');
}

async function saveBillForm(uid) {
  const id = document.getElementById('bill-id').value.trim();
  const bill = {
    id:            id || undefined,
    company:       document.getElementById('bill-company').value.trim(),
    service:       document.getElementById('bill-service').value.trim(),
    dueDay:        document.getElementById('bill-due-day').value.trim(),
    amount:        parseFloat(document.getElementById('bill-amount').value) || null,
    frequency:     document.getElementById('bill-frequency').value,
    autopay:       document.getElementById('bill-autopay').checked,
    linkedAccount: document.getElementById('bill-linked-account').value.trim(),
    notes:         document.getElementById('bill-notes').value.trim(),
    active:        document.getElementById('bill-active').checked,
  };

  if (!bill.company) { showToast('Company name is required', 'error'); return; }

  try {
    await saveBill(uid, bill);
    closeModal('modal-bill');
    showToast(id ? 'Bill updated' : 'Bill added', 'success');
    await renderBillsTab(uid);
  } catch (err) {
    showToast('Error saving bill: ' + err.message, 'error');
  }
}

async function confirmDeleteBill(billId, uid) {
  const bill = _billsCache.find(b => b.id === billId);
  if (!confirm(`Delete "${bill?.company}"? This cannot be undone.`)) return;
  try {
    await deleteBill(uid, billId);
    showToast('Bill deleted', 'info');
    await renderBillsTab(uid);
  } catch (err) {
    showToast('Error deleting bill: ' + err.message, 'error');
  }
}

// ─── Mark Paid Modal ──────────────────────────────────────────────────────────
function openPaidModal(billId, uid) {
  const bill = _billsCache.find(b => b.id === billId);
  document.getElementById('modal-paid-title').textContent = `Mark Paid — ${bill?.company || ''}`;
  document.getElementById('paid-bill-id').value = billId;
  document.getElementById('paid-amount').value  = bill?.amount || '';
  document.getElementById('paid-date').value    = new Date().toISOString().slice(0, 10);
  document.getElementById('paid-confirmation').value = '';
  document.getElementById('paid-notes').value   = '';
  openModal('modal-paid');
}

async function savePaidForm(uid) {
  const billId = document.getElementById('paid-bill-id').value;
  const data   = {
    paid:         true,
    paidDate:     document.getElementById('paid-date').value,
    amount:       parseFloat(document.getElementById('paid-amount').value) || null,
    confirmation: document.getElementById('paid-confirmation').value.trim(),
    notes:        document.getElementById('paid-notes').value.trim(),
  };
  try {
    await setMonthlyPaid(auth.currentUser.uid, _billsMonth, billId, data);
    closeModal('modal-paid');
    showToast('Marked as paid', 'success');
    _paidCache[billId] = data;
    _renderBillsList(uid);
  } catch (err) {
    showToast('Error saving: ' + err.message, 'error');
  }
}

async function unmarkPaid(billId, uid) {
  try {
    await clearMonthlyPaid(uid, _billsMonth, billId);
    delete _paidCache[billId];
    showToast('Unmarked as paid', 'info');
    _renderBillsList(uid);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}
