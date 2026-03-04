// ── App Entry Point ───────────────────────────────────────────────────────────

// ─── Shared utilities ─────────────────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined) return '';
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let _toastTimer = null;
function showToast(msg, type = 'info') {
  if (!msg) return;
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ─── Auth state ───────────────────────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-email').textContent = user.email || user.displayName || '';

    // Pre-load bills cache (used by both bills and transactions tabs)
    await loadBills(user.uid);

    // Default to bills tab
    await renderBillsTab(user.uid);
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
});

// ─── Tab routing ──────────────────────────────────────────────────────────────
let _activeTab = 'bills';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

async function switchTab(tabName) {
  if (_activeTab === tabName) return;
  _activeTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', false));

  const el = document.getElementById(`tab-${tabName}`);
  if (el) {
    el.classList.remove('hidden');
    el.classList.add('active');
  }
  // Hide other tabs
  document.querySelectorAll('.tab-content').forEach(s => {
    if (s.id !== `tab-${tabName}`) s.classList.add('hidden');
  });

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  if (tabName === 'bills')        await renderBillsTab(uid);
  if (tabName === 'transactions') await renderTransactionsTab(uid);
  if (tabName === 'charts')       await renderChartsTab(uid);
}

// ─── Auth buttons ─────────────────────────────────────────────────────────────
document.getElementById('btn-signin').addEventListener('click', signIn);
document.getElementById('btn-signout').addEventListener('click', signOut);

// ─── Bills events ─────────────────────────────────────────────────────────────
document.getElementById('btn-add-bill').addEventListener('click', () => openBillModal(null));

document.getElementById('btn-scan-recurring').addEventListener('click', async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  showToast('Scanning transactions…', 'info');
  await renderRecurringSuggestions(uid);
  showToast('Scan complete', 'success');
});

document.getElementById('btn-dismiss-suggestions').addEventListener('click', dismissAllSuggestions);

// Event delegation for suggestion cards (add / dismiss buttons)
document.getElementById('recurring-suggestions').addEventListener('click', e => {
  const addBtn     = e.target.closest('.btn-add-suggestion');
  const dismissBtn = e.target.closest('.btn-dismiss-suggestion');
  if (addBtn)     openBillModalFromSuggestion(addBtn);
  if (dismissBtn) dismissSuggestion(dismissBtn.dataset.desc);
});

document.getElementById('bills-month').addEventListener('change', async e => {
  _billsMonth = e.target.value;
  const uid = auth.currentUser?.uid;
  if (uid) {
    _paidCache = await getMonthlyPaid(uid, _billsMonth);
    _renderBillsList(uid);
  }
});

document.getElementById('form-bill').addEventListener('submit', async e => {
  e.preventDefault();
  const uid = auth.currentUser?.uid;
  if (uid) await saveBillForm(uid);
});

document.getElementById('form-paid').addEventListener('submit', async e => {
  e.preventDefault();
  const uid = auth.currentUser?.uid;
  if (uid) await savePaidForm(uid);
});

// ─── Transaction events ───────────────────────────────────────────────────────
document.getElementById('btn-import-csv').addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

document.getElementById('csv-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset so same file can be re-selected
  const uid = auth.currentUser?.uid;
  if (uid) await handleCSVFile(file, uid);
});

document.getElementById('btn-import-confirm').addEventListener('click', async () => {
  const uid = auth.currentUser?.uid;
  if (uid) await confirmImport(uid);
});

document.getElementById('btn-import-cancel').addEventListener('click', cancelImport);

document.getElementById('tx-month').addEventListener('change', async () => {
  const uid = auth.currentUser?.uid;
  if (uid) await loadAndRenderTxList(uid);
});

document.getElementById('tx-category').addEventListener('change', async () => {
  const uid = auth.currentUser?.uid;
  if (uid) await loadAndRenderTxList(uid);
});

// ─── Charts events ────────────────────────────────────────────────────────────
document.getElementById('charts-months').addEventListener('change', async () => {
  const uid = auth.currentUser?.uid;
  if (uid) await renderChartsTab(uid);
});

document.getElementById('charts-drill-month').addEventListener('change', async e => {
  _drillMonth = e.target.value;
  const uid = auth.currentUser?.uid;
  if (uid) await renderChartsTab(uid);
});

document.getElementById('btn-refresh-charts').addEventListener('click', async () => {
  const uid = auth.currentUser?.uid;
  if (uid) await renderChartsTab(uid);
});

// ─── Modal close buttons ──────────────────────────────────────────────────────
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));
  }
});
