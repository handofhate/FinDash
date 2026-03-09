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

    applySettings();

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

// ─── Settings ─────────────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', async () => {
  const uid = auth.currentUser?.uid || null;
  try {
    await openSettingsModal(uid);
  } catch (err) {
    showToast('Unable to open settings: ' + err.message, 'error');
  }
});

// Settings tab buttons (inside modal — use event delegation on the modal)
document.getElementById('modal-settings').addEventListener('click', e => {
  const tab = e.target.closest('.settings-tab-btn');
  if (tab) _switchSettingsTab(tab.dataset.tab);
});

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
document.getElementById('btn-suggestion-dismiss').addEventListener('click', dismissCurrentSuggestion);
document.getElementById('btn-suggestion-skip').addEventListener('click', skipCurrentSuggestion);
document.getElementById('btn-suggestion-add').addEventListener('click', addCurrentSuggestion);

document.getElementById('bills-month').addEventListener('change', async e => {
  _billsMonth = e.target.value;
  const uid = auth.currentUser?.uid;
  if (uid) _renderBillsList(uid);
});

document.getElementById('form-bill').addEventListener('submit', async e => {
  e.preventDefault();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const saved = await saveBillForm(uid);
  if (saved) confirmDismissActiveSuggestion();
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

document.getElementById('import-preview').addEventListener('click', async e => {
  const acceptAllCatBtn = e.target.closest('#btn-accept-all-category-suggestions');
  const declineAllCatBtn = e.target.closest('#btn-decline-all-category-suggestions');
  const acceptCategoryBtn = e.target.closest('.btn-accept-category-suggestion');
  const editCategoryBtn = e.target.closest('.btn-edit-category-suggestion');
  const mergeCategoryBtn = e.target.closest('.btn-merge-category-suggestion');
  const declineCategoryBtn = e.target.closest('.btn-decline-category-suggestion');
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  if (acceptAllCatBtn) await acceptAllCategorySuggestions(uid);
  if (declineAllCatBtn) declineAllCategorySuggestions();
  if (acceptCategoryBtn) await acceptCategorySuggestion(uid, acceptCategoryBtn.dataset.key);
  if (editCategoryBtn) editCategorySuggestion(editCategoryBtn.dataset.key);
  if (mergeCategoryBtn) mergeCategorySuggestion(mergeCategoryBtn.dataset.key);
  if (declineCategoryBtn) declineCategorySuggestion(declineCategoryBtn.dataset.key);
});

document.getElementById('form-edit-category-suggestion').addEventListener('submit', e => {
  e.preventDefault();
  saveCategorySuggestionEditForm();
});

let _dragCategorySuggestionKey = null;

document.getElementById('import-preview').addEventListener('dragstart', e => {
  const row = e.target.closest('.import-sugg-row[data-kind="category-suggestion"]');
  if (!row) return;
  _dragCategorySuggestionKey = row.dataset.key;
  row.classList.add('is-dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.key || '');
  }
});

document.getElementById('import-preview').addEventListener('dragend', () => {
  _dragCategorySuggestionKey = null;
  document.querySelectorAll('.import-sugg-row.is-dragging, .import-sugg-row.drop-target')
    .forEach(el => el.classList.remove('is-dragging', 'drop-target'));
});

document.getElementById('import-preview').addEventListener('dragover', e => {
  const target = e.target.closest('.import-sugg-row[data-kind="category-suggestion"]');
  if (!target || !_dragCategorySuggestionKey || target.dataset.key === _dragCategorySuggestionKey) return;
  e.preventDefault();
  target.classList.add('drop-target');
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
});

document.getElementById('import-preview').addEventListener('dragleave', e => {
  const target = e.target.closest('.import-sugg-row[data-kind="category-suggestion"]');
  if (!target) return;
  const toEl = e.relatedTarget;
  if (toEl && target.contains(toEl)) return;
  target.classList.remove('drop-target');
});

document.getElementById('import-preview').addEventListener('drop', e => {
  const target = e.target.closest('.import-sugg-row[data-kind="category-suggestion"]');
  if (!target || !_dragCategorySuggestionKey || target.dataset.key === _dragCategorySuggestionKey) return;
  e.preventDefault();
  mergeCategorySuggestion(_dragCategorySuggestionKey, target.dataset.key);
  _dragCategorySuggestionKey = null;
});

document.getElementById('btn-delete-all-txns').addEventListener('click', async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  if (!confirm('Delete ALL transactions? This cannot be undone.')) return;
  showToast('Deleting…', 'info');
  const count = await deleteAllTransactions(uid);
  showToast(`Deleted ${count} transactions`, 'success');
  await renderTransactionsTab(uid);
});

document.getElementById('btn-delete-account-txns').addEventListener('click', async () => {
  const uid      = auth.currentUser?.uid;
  const acctSel  = document.getElementById('tx-account');
  const accountId   = acctSel.value;
  const accountName = acctSel.options[acctSel.selectedIndex]?.text;
  if (!uid || !accountId) return;
  if (!confirm(`Delete all transactions from "${accountName}"? This cannot be undone.`)) return;
  showToast('Deleting…', 'info');
  const count = await deleteTransactionsByAccount(uid, accountId);
  showToast(`Deleted ${count} transactions from "${accountName}"`, 'success');
  await renderTransactionsTab(uid);
});

document.getElementById('tx-month').addEventListener('change', async () => {
  const uid = auth.currentUser?.uid;
  if (uid) await loadAndRenderTxList(uid);
});

document.getElementById('tx-account').addEventListener('change', async e => {
  const uid = auth.currentUser?.uid;
  if (uid) await loadAndRenderTxList(uid);
  // Show "Delete Account" only when a specific account is selected
  const hasAccount = !!e.target.value;
  document.getElementById('btn-delete-account-txns').classList.toggle('hidden', !hasAccount);
  if (hasAccount) {
    const sel = e.target;
    document.getElementById('btn-delete-account-txns').textContent =
      `Delete "${sel.options[sel.selectedIndex].text}"`;
  }
});

document.getElementById('tx-category').addEventListener('change', async () => {
  const uid = auth.currentUser?.uid;
  if (uid) await loadAndRenderTxList(uid);
});

document.getElementById('btn-show-hidden').addEventListener('click', async () => {
  _showHidden = !_showHidden;
  const uid = auth.currentUser?.uid;
  if (uid) await loadAndRenderTxList(uid);
});

// Event delegation for hide/unhide buttons in the transaction list
document.getElementById('tx-list').addEventListener('click', async e => {
  const hideBtn   = e.target.closest('.btn-hide-tx');
  const unhideBtn = e.target.closest('.btn-unhide-tx');
  const uid       = auth.currentUser?.uid;
  if (!uid) return;

  if (hideBtn) {
    await setTransactionHidden(uid, hideBtn.dataset.id, true);
    await loadAndRenderTxList(uid);
  }
  if (unhideBtn) {
    await setTransactionHidden(uid, unhideBtn.dataset.id, false);
    await loadAndRenderTxList(uid);
  }
});

// Event delegation for inline category/importance dropdowns
document.getElementById('tx-list').addEventListener('change', async e => {
  const catSelect  = e.target.closest('.tx-select-category');
  const impSelect  = e.target.closest('.tx-select-importance');
  const uid        = auth.currentUser?.uid;
  if (!uid) return;

  if (catSelect) {
    const txId = catSelect.dataset.id;
    let value  = catSelect.value;
    
    if (value === '__other__') {
      const custom = prompt('Enter new category name:');
      if (!custom) { catSelect.value = ''; return; }
      // Save new category definition
      await saveCategoryDefinition(uid, { name: custom.trim() });
      value = custom.trim();
    }
    
    await updateTransaction(uid, txId, { category: value });
    await loadAndRenderTxList(uid);
  }

  if (impSelect) {
    const txId = impSelect.dataset.id;
    const value = impSelect.value;
    await updateTransaction(uid, txId, { importance: value });
  }
});

// Show/hide "new account name" field based on account selector value
document.getElementById('import-account-select').addEventListener('change', e => {
  document.getElementById('new-account-name-group').classList.toggle('hidden', e.target.value !== 'new');
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
  btn.addEventListener('click', () => {
    if (btn.dataset.close === 'modal-bill') clearActiveSuggestion();
    closeModal(btn.dataset.close);
  });
});

// Clicking outside a modal does nothing — use Cancel button or Escape to close

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    clearActiveSuggestion();
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));
  }
});

// Occurrence toggle in suggestion card
document.getElementById('recurring-suggestions').addEventListener('click', e => {
  const btn = e.target.closest('.btn-sugg-toggle-txns');
  if (!btn) return;
  const list = btn.closest('.suggestion-detail').querySelector('.suggestion-txn-list');
  if (!list) return;
  list.classList.toggle('hidden');
  const count  = btn.dataset.count;
  const plural = count !== '1' ? 's' : '';
  btn.textContent = `${count} occurrence${plural} ${list.classList.contains('hidden') ? '▾' : '▲'}`;
});
