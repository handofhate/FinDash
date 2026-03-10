// ── Transaction Edit Inline Dropdown ──────────────────────────────────────────

let _currentTxEdit = null; // Track the transaction being edited
let _activeEditRow = null; // Track the currently open edit row
let _allTransactionsCache = { uid: null, data: null }; // reused for impact preview
const TX_EDIT_ANIM_MS = 3000; // debug slow-motion; can be reduced after tuning

async function _getAllTransactionsForEdit(uid, { refresh = false } = {}) {
  if (!refresh && _allTransactionsCache.uid === uid && Array.isArray(_allTransactionsCache.data)) {
    return _allTransactionsCache.data;
  }
  const all = await getAllTransactions(uid);
  _allTransactionsCache = { uid, data: all };
  return all;
}

// Toggle inline edit dropdown for a given transaction
async function toggleTxEditInline(uid, transaction, categories, bills) {
  const txRow = document.querySelector(`tr[data-id="${transaction.id}"]`);
  if (!txRow) return;

  // Check if this transaction's edit row is already open
  const existingEditRow = txRow.nextElementSibling;
  if (existingEditRow?.classList.contains('tx-edit-row')) {
    _closeTxEditDropdown();
    return;
  }

  // Close any other open edit rows with animation
  const otherEditRows = document.querySelectorAll('.tx-edit-row');
  otherEditRows.forEach(row => _animateCloseRow(row));
  _activeEditRow = null;

  const cachedAll = (_allTransactionsCache.uid === uid && Array.isArray(_allTransactionsCache.data))
    ? _allTransactionsCache.data
    : null;
  _currentTxEdit = {
    uid,
    tx: transaction,
    categories,
    bills,
    allTransactions: cachedAll,
    edits: {}, // { field: { newValue, scope, matchOn } }
  };

  // Create inline edit row
  const colCount = txRow.querySelectorAll('td').length;
  const editRow = document.createElement('tr');
  editRow.className = 'tx-edit-row';
  editRow.innerHTML = `<td colspan="${colCount}"><div class="tx-edit-dropdown tx-edit-collapsed">${_buildTxEditForm(transaction, categories)}</div></td>`;
  
  txRow.after(editRow);
  _activeEditRow = editRow;

  _animateOpenRow(editRow);

  // Wire up field change listeners
  _wireTxEditForm(uid, transaction, categories, bills);

  // Warm cache in background; do not block opening the dropdown.
  if (!cachedAll) {
    _getAllTransactionsForEdit(uid)
      .then(all => {
        if (_currentTxEdit?.tx?.id === transaction.id) {
          _currentTxEdit.allTransactions = all;
          _updateRulesetImpact(transaction);
        }
      })
      .catch(() => {
        // Keep editor usable even if impact preload fails.
      });
  }

  // Add escape key handler
  _addEscapeHandler();
}

function _animateOpenRow(row) {
  const dropdown = row?.querySelector('.tx-edit-dropdown');
  if (!dropdown) return;

  dropdown.style.maxHeight = '0px';
  requestAnimationFrame(() => {
    const targetHeight = dropdown.scrollHeight;
    dropdown.classList.add('tx-edit-open');
    dropdown.classList.remove('tx-edit-collapsed');
    dropdown.style.maxHeight = `${targetHeight}px`;
  });

  const onDone = (e) => {
    if (e.propertyName !== 'max-height') return;
    dropdown.style.maxHeight = 'none';
    dropdown.removeEventListener('transitionend', onDone);
  };
  dropdown.addEventListener('transitionend', onDone);
}

function _animateCloseRow(row, done) {
  const dropdown = row?.querySelector('.tx-edit-dropdown');
  if (!row || !dropdown) {
    row?.remove();
    if (done) done();
    return;
  }

  // If open state uses max-height none, pin it first so transition can run.
  if (dropdown.style.maxHeight === 'none' || !dropdown.style.maxHeight) {
    dropdown.style.maxHeight = `${dropdown.scrollHeight}px`;
    dropdown.offsetHeight;
  }

  dropdown.classList.remove('tx-edit-open');
  dropdown.classList.add('tx-edit-collapsed');
  dropdown.style.maxHeight = '0px';

  setTimeout(() => {
    row.remove();
    if (done) done();
  }, TX_EDIT_ANIM_MS);
}

// Smoothly close the edit dropdown with animation
function _closeTxEditDropdown(callback) {
  if (!_activeEditRow) {
    if (callback) callback();
    return;
  }

  const rowToClose = _activeEditRow;
  _animateCloseRow(rowToClose, () => {
    if (_activeEditRow === rowToClose) {
      _activeEditRow = null;
      _currentTxEdit = null;
      _removeEscapeHandler();
    }
    if (callback) callback();
  });
}

// Close edit dropdown with Escape key
function _addEscapeHandler() {
  document.addEventListener('keydown', _escapeHandler);
}

function _removeEscapeHandler() {
  document.removeEventListener('keydown', _escapeHandler);
}

function _escapeHandler(e) {
  if (e.key === 'Escape' && _activeEditRow) {
    _closeTxEditDropdown();
  }
}

// Build the form HTML for editing a transaction
function _buildTxEditForm(tx, categories) {
  const impOptions = ['Essential', 'Important', 'Optional', 'Low'];
  const scopeOptions = [
    { value: 'this_only', label: 'This transaction only' },
    { value: 'existing_only', label: 'This + existing matching' },
    { value: 'future_only', label: 'This + future imports' },
    { value: 'all', label: 'This + all existing + future' },
  ];

  const html = `
    <form id="form-tx-edit" style="gap:15px">
      <!-- Description field -->
      <div class="tx-edit-field">
        <div class="tx-edit-field-header">
          <label>Description</label>
          <select class="tx-edit-scope" data-field="description">
            ${scopeOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="text" class="tx-edit-value" data-field="description" value="${esc(tx.description || '')}" style="flex:1" />
          <button type="button" class="tx-edit-match-dropdown-btn hidden" data-field="description" style="padding:5px 10px">▼ Match on</button>
        </div>
        <div class="tx-edit-match-dropdown hidden" data-field="description">
          <label>Match on:</label>
          <select class="tx-edit-match-on" data-field="description">
            <option value="description">Description contains</option>
            <option value="category">Category is</option>
            <option value="amount">Amount equals</option>
          </select>
          <input type="text" class="tx-edit-match-value" data-field="description" placeholder="Match value" style="width:100%;margin-top:5px" />
        </div>
      </div>

      <!-- Category field -->
      <div class="tx-edit-field">
        <div class="tx-edit-field-header">
          <label>Category</label>
          <select class="tx-edit-scope" data-field="category">
            ${scopeOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <select class="tx-edit-value" data-field="category" style="flex:1">
            <option value="">-- Select Category --</option>
            ${categories.map(c => `<option value="${esc(c.name)}" ${c.name === tx.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <button type="button" class="tx-edit-match-dropdown-btn hidden" data-field="category" style="padding:5px 10px">▼ Match on</button>
        </div>
        <div class="tx-edit-match-dropdown hidden" data-field="category">
          <label>Match on:</label>
          <select class="tx-edit-match-on" data-field="category">
            <option value="description">Description contains</option>
            <option value="category">Category is</option>
            <option value="amount">Amount equals</option>
          </select>
          <input type="text" class="tx-edit-match-value" data-field="category" placeholder="Match value" style="width:100%;margin-top:5px" />
        </div>
      </div>

      <!-- Importance field -->
      <div class="tx-edit-field">
        <div class="tx-edit-field-header">
          <label>Importance</label>
          <select class="tx-edit-scope" data-field="importance">
            ${scopeOptions.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <select class="tx-edit-value" data-field="importance" style="flex:1">
            <option value="">-- Select Importance --</option>
            ${impOptions.map(opt => `<option value="${opt}" ${opt === tx.importance ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
          <button type="button" class="tx-edit-match-dropdown-btn hidden" data-field="importance" style="padding:5px 10px">▼ Match on</button>
        </div>
        <div class="tx-edit-match-dropdown hidden" data-field="importance">
          <label>Match on:</label>
          <select class="tx-edit-match-on" data-field="importance">
            <option value="description">Description contains</option>
            <option value="category">Category is</option>
            <option value="amount">Amount equals</option>
          </select>
          <input type="text" class="tx-edit-match-value" data-field="importance" placeholder="Match value" style="width:100%;margin-top:5px" />
        </div>
      </div>

      <div id="tx-edit-impact" class="tx-edit-impact text-muted">
        Ruleset impact: no existing transactions will be updated.
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" id="btn-cancel-tx-edit">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `;

  return html;
}

// Wire up event listeners for the edit form
function _wireTxEditForm(uid, tx, categories, bills) {
  const form = document.getElementById('form-tx-edit');
  if (!form) return;

  // Scope dropdown changes - show/hide match criteria based on scope
  form.querySelectorAll('.tx-edit-scope').forEach(select => {
    select.addEventListener('change', e => {
      const field = e.target.dataset.field;
      const scope = e.target.value;
      const matchBtn = form.querySelector(`.tx-edit-match-dropdown-btn[data-field="${field}"]`);
      const matchDropdown = form.querySelector(`.tx-edit-match-dropdown[data-field="${field}"]`);

      if (scope === 'this_only') {
        matchBtn?.classList.add('hidden');
        matchDropdown?.classList.add('hidden');
      } else {
        matchBtn?.classList.remove('hidden');
        matchDropdown?.classList.add('hidden'); // hidden by default until button clicked
      }

      _updateRulesetImpact(tx);
    });
  });

  // Match dropdown button clicks
  form.querySelectorAll('.tx-edit-match-dropdown-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const field = e.target.dataset.field;
      const dropdown = form.querySelector(`.tx-edit-match-dropdown[data-field="${field}"]`);
      dropdown?.classList.toggle('hidden');
    });
  });

  form.querySelectorAll('.tx-edit-value, .tx-edit-match-on, .tx-edit-match-value').forEach(input => {
    input.addEventListener('input', () => _updateRulesetImpact(tx));
    input.addEventListener('change', () => _updateRulesetImpact(tx));
  });

  // Pre-populate match criteria values based on current transaction
  const descInput = form.querySelector('.tx-edit-match-value[data-field="description"]');
  if (descInput && tx.description) descInput.value = tx.description;

  const categoryInput = form.querySelector('.tx-edit-match-value[data-field="category"]');
  if (categoryInput && tx.category) categoryInput.value = tx.category;

  const amountInput = form.querySelector('.tx-edit-match-value[data-field="amount"]');
  if (amountInput && tx.amount) amountInput.value = String(tx.amount);

  // Cancel button
  const cancelBtn = document.getElementById('btn-cancel-tx-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _closeTxEditDropdown();
    });
  }

  // Form submission
  form.addEventListener('submit', async e => {
    e.preventDefault();
    await _saveTxEdits(uid, tx, categories, bills);
  });

  _updateRulesetImpact(tx);
}

function _collectEditsFromForm(form, tx, { requireMatchValue } = { requireMatchValue: true }) {
  const edits = [];
  let error = '';

  ['description', 'category', 'importance'].forEach(field => {
    const input = form.querySelector(`.tx-edit-value[data-field="${field}"]`);
    const newValue = String(input?.value || '').trim();
    const oldValue = field === 'category' ? tx.category : field === 'description' ? tx.description : tx.importance;

    if (!newValue || newValue === String(oldValue || '')) return;

    const scope = form.querySelector(`.tx-edit-scope[data-field="${field}"]`)?.value || 'this_only';
    const edit = { field, newValue, scope };

    if (scope !== 'this_only') {
      const matchOn = form.querySelector(`.tx-edit-match-on[data-field="${field}"]`)?.value || 'description';
      const matchValue = String(form.querySelector(`.tx-edit-match-value[data-field="${field}"]`)?.value || '').trim();

      if (!matchValue) {
        if (requireMatchValue) {
          error = `Match value required for field "${field}"`;
        }
        return;
      }

      edit.matchOn = matchOn;
      edit.matchValue = matchValue;
    }

    edits.push(edit);
  });

  return { edits, error };
}

function _updateRulesetImpact(tx) {
  const form = document.getElementById('form-tx-edit');
  const impactEl = document.getElementById('tx-edit-impact');
  if (!form || !impactEl) return;

  const { edits, error } = _collectEditsFromForm(form, tx, { requireMatchValue: false });
  if (error) {
    impactEl.textContent = error;
    return;
  }

  const existingScopeEdits = edits.filter(e => e.scope === 'existing_only' || e.scope === 'all');
  if (!existingScopeEdits.length) {
    impactEl.textContent = 'Ruleset impact: no existing transactions will be updated.';
    return;
  }

  const allTxs = Array.isArray(_currentTxEdit?.allTransactions) ? _currentTxEdit.allTransactions : [];
  if (!allTxs.length) {
    impactEl.textContent = 'Ruleset impact: calculating existing matches...';
    return;
  }
  const impacted = new Set();
  existingScopeEdits.forEach(edit => {
    _findMatchingTransactions(allTxs, edit.matchOn, edit.matchValue).forEach(t => {
      if (t.id && t.id !== tx.id) impacted.add(t.id);
    });
  });

  const count = impacted.size;
  impactEl.textContent = `Ruleset impact: ${count} existing transaction${count === 1 ? '' : 's'} will be updated.`;
}

// Collect edits from form and save
async function _saveTxEdits(uid, tx, categories, bills) {
  const form = document.getElementById('form-tx-edit');
  const { edits, error } = _collectEditsFromForm(form, tx, { requireMatchValue: true });

  if (error) {
    showToast(error, 'error');
    return;
  }

  if (edits.length === 0) {
    showToast('No changes made', 'info');
    return;
  }

  // Check for conflicts
  const nonThisOnlyEdits = edits.filter(e => e.scope !== 'this_only');
  if (nonThisOnlyEdits.length > 0) {
    const conflicts = await findConflictingRulesets(uid, nonThisOnlyEdits);
    if (conflicts.length > 0) {
      _showConflictWarning(uid, tx, categories, bills, edits, conflicts);
      return;
    }
  }

  // No conflicts, proceed
  await _applyTxEdits(uid, tx, edits);
}

// Show conflict warning modal
function _showConflictWarning(uid, tx, categories, bills, edits, conflicts) {
  const uniqueConflicts = Array.from(new Map((conflicts || []).map(c => [c.id, c])).values());
  const incomingEdits = edits.filter(e => e.scope !== 'this_only');

  const fmtEdit = (edit) => {
    const scopeLabel = edit.scope === 'existing_only'
      ? 'this + existing'
      : edit.scope === 'future_only'
        ? 'this + future'
        : edit.scope === 'all'
          ? 'this + existing + future'
          : 'this only';
    const matcher = edit.matchOn && edit.matchValue
      ? ` when ${edit.matchOn} = "${esc(edit.matchValue)}"`
      : '';
    return `${edit.field} -> "${esc(edit.newValue)}" (${scopeLabel})${matcher}`;
  };

  const text = document.getElementById('conflict-warning-text');
  text.innerHTML = `
    <strong>Your new ruleset:</strong>
    <ul style="margin-top:8px;margin-left:20px">
      ${incomingEdits.map(e => `<li style="margin:4px 0">${fmtEdit(e)}</li>`).join('')}
    </ul>
    <strong style="display:block;margin-top:10px">Conflicting existing ruleset(s):</strong>
    <ul style="margin-top:8px;margin-left:20px">
      ${uniqueConflicts.map((c, i) => {
        const existing = Array.isArray(c.edits) ? c.edits : [];
        return `<li style="margin:6px 0"><strong>Ruleset ${i + 1}</strong><br>${existing.map(e => fmtEdit(e)).join('<br>')}</li>`;
      }).join('')}
    </ul>
    <p style="margin-top:10px">How would you like to proceed?</p>
  `;

  const choices = document.getElementById('conflict-choices');
  choices.innerHTML = `
    <label style="display:flex;align-items:center;gap:10px;margin:10px 0">
      <input type="radio" name="conflict-choice" value="overwrite" checked />
      <span>Overwrite existing rules with this edit</span>
    </label>
    <label style="display:flex;align-items:center;gap:10px;margin:10px 0">
      <input type="radio" name="conflict-choice" value="cancel" />
      <span>Cancel this edit</span>
    </label>
  `;

  const proceedBtn = document.getElementById('btn-conflict-proceed');
  proceedBtn.onclick = async () => {
    const choice = document.querySelector('input[name="conflict-choice"]:checked').value;
    if (choice === 'overwrite') {
      // Delete conflicting rulesets first
      for (const c of uniqueConflicts) {
        await deleteRuleset(uid, c.id);
      }
      closeModal('modal-conflict-warning');
      await _applyTxEdits(uid, tx, edits);
    } else {
      closeModal('modal-conflict-warning');
    }
  };

  openModal('modal-conflict-warning');
}

// Apply edits: update transaction, create rulesets, apply retroactively
async function _applyTxEdits(uid, tx, edits) {
  try {
    showToast('Saving changes…', 'info');

    // Separate this_only edits from ruleset edits
    const thisOnlyEdits = edits.filter(e => e.scope === 'this_only');
    const rulesetEdits = edits.filter(e => e.scope !== 'this_only');

    // 1. Update this transaction with all edits
    const txUpdate = {};
    edits.forEach(e => {
      txUpdate[e.field] = e.newValue;
    });
    await updateTransaction(uid, tx.id, txUpdate);

    // 2. Create ruleset if any edits have scope other than this_only
    if (rulesetEdits.length > 0) {
      const ruleset = {
        edits: rulesetEdits,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const rulesetId = await saveRuleset(uid, ruleset);

      // 3a. Apply ruleset to existing transactions based on scope
      const allTxs = await getAllTransactions(uid);
      for (const edit of rulesetEdits) {
        const matchTxs = _findMatchingTransactions(allTxs, edit.matchOn, edit.matchValue);

        if (edit.scope === 'existing_only' || edit.scope === 'all') {
          // Apply to matching existing transactions (except current one)
          for (const t of matchTxs) {
            if (t.id !== tx.id) {
              await updateTransaction(uid, t.id, { [edit.field]: edit.newValue });
            }
          }
        }
      }
    }

    _closeTxEditDropdown(async () => {
      _allTransactionsCache = { uid: null, data: null };
      await loadAndRenderTxList(uid);
      showToast('Changes saved', 'success');
    });
  } catch (err) {
    showToast('Error saving changes: ' + err.message, 'error');
    console.error(err);
  }
}

// Find transactions matching given criteria
function _findMatchingTransactions(transactions, matchOn, matchValue) {
  return transactions.filter(t => {
    if (matchOn === 'description') {
      return (t.description || '').toLowerCase().includes(matchValue.toLowerCase());
    } else if (matchOn === 'category') {
      return (t.category || '').toLowerCase() === matchValue.toLowerCase();
    } else if (matchOn === 'amount') {
      return String(t.amount || '').trim() === String(matchValue).trim();
    }
    return false;
  });
}
