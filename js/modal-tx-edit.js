// ── Transaction Edit Modal ────────────────────────────────────────────────────

let _currentTxEdit = null; // Track the transaction being edited

// Open the transaction edit modal for a given transaction
async function openTxEditModal(uid, transaction, categories, bills) {
  _currentTxEdit = {
    uid,
    tx: transaction,
    categories,
    bills,
    edits: {}, // { field: { newValue, scope, matchOn } }
  };

  const body = document.getElementById('modal-tx-edit-body');
  body.innerHTML = _buildTxEditForm(transaction, categories);

  // Wire up field change listeners
  _wireTxEditForm(uid, transaction, categories, bills);

  openModal('modal-tx-edit');
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

      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" data-close="modal-tx-edit">Cancel</button>
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

  // Pre-populate match criteria values based on current transaction
  const descInput = form.querySelector('.tx-edit-match-value[data-field="description"]');
  if (descInput && tx.description) descInput.value = tx.description;

  const categoryInput = form.querySelector('.tx-edit-match-value[data-field="category"]');
  if (categoryInput && tx.category) categoryInput.value = tx.category;

  const amountInput = form.querySelector('.tx-edit-match-value[data-field="amount"]');
  if (amountInput && tx.amount) amountInput.value = String(tx.amount);

  // Form submission
  form.addEventListener('submit', async e => {
    e.preventDefault();
    await _saveTxEdits(uid, tx, categories, bills);
  });
}

// Collect edits from form and save
async function _saveTxEdits(uid, tx, categories, bills) {
  const form = document.getElementById('form-tx-edit');
  const edits = [];

  // Collect edits for each field
  ['description', 'category', 'importance'].forEach(field => {
    const input = form.querySelector(`.tx-edit-value[data-field="${field}"]`);
    const newValue = input.value.trim();
    const oldValue = field === 'category' ? tx.category : field === 'description' ? tx.description : tx.importance;

    if (newValue && newValue !== String(oldValue || '')) {
      const scope = form.querySelector(`.tx-edit-scope[data-field="${field}"]`).value;
      const edit = { field, newValue, scope };

      if (scope !== 'this_only') {
        const matchOn = form.querySelector(`.tx-edit-match-on[data-field="${field}"]`).value;
        const matchValue = form.querySelector(`.tx-edit-match-value[data-field="${field}"]`).value.trim();

        if (!matchValue) {
          showToast(`Match value required for field "${field}"`, 'error');
          return;
        }

        edit.matchOn = matchOn;
        edit.matchValue = matchValue;
      }

      edits.push(edit);
    }
  });

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
  const text = document.getElementById('conflict-warning-text');
  text.innerHTML = `
    <strong>${conflicts.length} existing rule(s) would be overwritten:</strong>
    <ul style="margin-top:10px;margin-left:20px">
      ${conflicts.map((c, i) => `<li style="margin:5px 0">Rule ${i + 1}: ${c.edits.map(e => `${e.field}`).join(', ')}</li>`).join('')}
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
      for (const c of conflicts) {
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

    closeModal('modal-tx-edit');
    await loadAndRenderTxList(uid);
    showToast('Changes saved', 'success');
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
