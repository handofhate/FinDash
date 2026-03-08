// ── Bills Tab ─────────────────────────────────────────────────────────────────

let _billsCache = [];
let _billsMonth = '';  // YYYY-MM

function billsDueDayNum(bill) {
  // Extract leading number from dueDay string (e.g. "15th" → 15, "20th (Mar...)" → 20)
  const m = String(bill.dueDay || '99').match(/\d+/);
  return m ? parseInt(m[0], 10) : 99;
}

function _isCurrentBillsMonth() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return _billsMonth === currentMonth;
}

function _isDueSoon(bill, referenceDate = new Date()) {
  const dueDay = billsDueDayNum(bill);
  if (!Number.isFinite(dueDay) || dueDay > 31) return false;

  const today = referenceDate.getDate();
  // "Due soon" means the bill is upcoming within the next week in the selected month.
  return dueDay >= today && dueDay <= (today + 7);
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

  const currentMonthView = _isCurrentBillsMonth();
  let totalDue = 0;
  let dueSoonAmount = 0;
  let dueSoonCount = 0;
  let autopayCount = 0;

  activeBills.forEach(b => {
    if (b.amount) totalDue += b.amount;
    if (b.autopay) autopayCount++;
    if (currentMonthView && _isDueSoon(b)) {
      dueSoonCount++;
      dueSoonAmount += (b.amount || 0);
    }
  });

  document.getElementById('summary-monthly-total').textContent = fmt(totalDue);
  document.getElementById('summary-due-soon').textContent = currentMonthView ? fmt(dueSoonAmount) : 'n/a';
  document.getElementById('summary-upcoming-count').textContent = currentMonthView ? String(dueSoonCount) : 'n/a';
  document.getElementById('summary-autopay-count').textContent = `${autopayCount} / ${activeBills.length}`;

  list.innerHTML = activeBills.map(b => billCardHTML(b)).join('');

  // Wire up buttons
  list.querySelectorAll('.btn-edit-bill').forEach(btn => {
    btn.addEventListener('click', () => openBillModal(btn.dataset.id));
  });
  list.querySelectorAll('.btn-delete-bill').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteBill(btn.dataset.id, uid));
  });
}

function billCardHTML(bill) {
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

  const dueSoon = _isCurrentBillsMonth() && _isDueSoon(bill);
  const dueSoonBadge = dueSoon
    ? '<span class="badge badge-debit">Due Soon</span>'
    : '';

  return `
    <div class="bill-card" data-id="${bill.id}">
      <div class="bill-info">
        <div class="bill-name">${esc(bill.company)}${bill.service ? ' — ' + esc(bill.service) : ''}</div>
        <div class="bill-meta">Due: ${esc(bill.dueDay || '—')} ${bill.linkedAccount ? '· ' + esc(bill.linkedAccount) : ''} ${bill.notes ? '· ' + esc(bill.notes) : ''}</div>
      </div>
      <div class="bill-tags">
        ${autopayBadge}
        ${freqBadge}
        ${dueSoonBadge}
      </div>
      <div class="bill-amount ${amtClass}">${amtDisplay}</div>
      <div class="bill-actions">
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
    return true;
  } catch (err) {
    showToast('Error saving bill: ' + err.message, 'error');
    return false;
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
