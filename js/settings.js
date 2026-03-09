// ── Settings & Display ────────────────────────────────────────────────────────

const SETTINGS_KEY = 'findash_settings';

const TX_COLUMNS = [
  { key: 'col_date',        label: 'Date' },
  { key: 'col_description', label: 'Description' },
  { key: 'col_category',    label: 'Category' },
  { key: 'col_subcategory', label: 'Subcategory' },
  { key: 'col_importance',  label: 'Importance' },
  { key: 'col_account',     label: 'Account' },
  { key: 'col_type',        label: 'Type' },
  { key: 'col_amount',      label: 'Amount' },
  { key: 'col_balance',     label: 'Balance' },
];

const SETTING_DEFAULTS = {
  theme:        'dark',
  compactRows:  false,
  hideZeroTx:   false,
  col_date:        true,
  col_description: true,
  col_category:    true,
  col_subcategory: true,
  col_importance:  true,
  col_account:     true,
  col_type:        true,
  col_amount:      true,
  col_balance:     true,
};

function getSettings() {
  try {
    return { ...SETTING_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch { return { ...SETTING_DEFAULTS }; }
}

function saveSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function applySettings() {
  const s = getSettings();
  document.documentElement.setAttribute('data-theme', s.theme || 'dark');
  document.body.classList.toggle('compact-rows', !!s.compactRows);
}

// ─── Import Filter Application ────────────────────────────────────────────────
function applyImportFilters(rows, filters) {
  if (!filters || !filters.length) return { kept: rows, skipped: [], flagged: [] };

  const skipped = [];
  const flagged = [];
  const kept    = [];

  rows.forEach(row => {
    const match = filters.find(f => _filterMatches(row, f));
    if (!match) {
      kept.push(row);
    } else if (match.action === 'skip') {
      skipped.push(row);
    } else {
      const flaggedRow = { ...row, _flagged: true, _flagReason: `${match.field} ${match.operator} "${match.value}"` };
      kept.push(flaggedRow);
      flagged.push(flaggedRow);
    }
  });

  return { kept, skipped, flagged };
}

function _filterMatches(row, filter) {
  const { field, operator, value } = filter;
  let rowVal;
  switch (field) {
    case 'description': rowVal = String(row.description || '').toLowerCase(); break;
    case 'category':    rowVal = String(row.category    || '').toLowerCase(); break;
    case 'type':        rowVal = String(row.type        || '').toLowerCase(); break;
    case 'amount':      rowVal = row.amount; break;
    default: return false;
  }
  const cmpStr = String(value || '').toLowerCase();
  const cmpNum = parseFloat(value);
  switch (operator) {
    case 'contains':    return typeof rowVal === 'string' && rowVal.includes(cmpStr);
    case 'equals':      return field === 'amount' ? rowVal === cmpNum : rowVal === cmpStr;
    case 'startsWith':  return typeof rowVal === 'string' && rowVal.startsWith(cmpStr);
    case 'greaterThan': return typeof rowVal === 'number' && rowVal > cmpNum;
    case 'lessThan':    return typeof rowVal === 'number' && rowVal < cmpNum;
    default: return false;
  }
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
let _settingsTab       = 'display';
let _settingsFilters   = [];
let _settingsCategories = [];
let _settingsUid       = null;

async function openSettingsModal(uid) {
  _settingsUid = uid;
  try {
    if (uid) {
      [_settingsFilters, _settingsCategories] = await Promise.all([
        getImportFilters(uid),
        getCategoryDefinitions(uid),
      ]);
    } else {
      _settingsFilters    = [];
      _settingsCategories = [];
    }
  } catch (err) {
    _settingsFilters    = [];
    _settingsCategories = [];
    showToast('Settings data failed to load. Showing defaults.', 'error');
  }
  _renderSettingsContent();
  openModal('modal-settings');
}

function _renderSettingsContent() {
  const s = getSettings();
  document.getElementById('settings-display-tab').innerHTML    = _renderDisplaySettings(s);
  document.getElementById('settings-categories-tab').innerHTML = _renderCategoriesSettings(_settingsCategories);
  document.getElementById('settings-filters-tab').innerHTML    = _renderFiltersSettings(_settingsFilters);
  _switchSettingsTab(_settingsTab);
  _wireDisplaySettings();
  _wireCategorySettings();
  _wireFilterSettings();
}

function _switchSettingsTab(tab) {
  _settingsTab = tab;
  document.querySelectorAll('.settings-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('settings-display-tab').classList.toggle('hidden', tab !== 'display');
  document.getElementById('settings-categories-tab').classList.toggle('hidden', tab !== 'categories');
  document.getElementById('settings-filters-tab').classList.toggle('hidden', tab !== 'filters');
}

function _renderDisplaySettings(s) {
  const colRows = TX_COLUMNS.map(c => `
    <label class="settings-toggle-row">
      <input type="checkbox" data-setting="${c.key}" ${s[c.key] !== false ? 'checked' : ''}>
      <span>${c.label}</span>
    </label>`).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">Theme</div>
      <label class="settings-toggle-row">
        <input type="radio" name="theme" value="dark"  ${s.theme !== 'light' ? 'checked' : ''}> Dark mode
      </label>
      <label class="settings-toggle-row">
        <input type="radio" name="theme" value="light" ${s.theme === 'light' ? 'checked' : ''}> Light mode
      </label>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Table Display</div>
      <label class="settings-toggle-row">
        <input type="checkbox" data-setting="compactRows" ${s.compactRows ? 'checked' : ''}>
        <span>Compact rows</span>
      </label>
      <label class="settings-toggle-row">
        <input type="checkbox" data-setting="hideZeroTx" ${s.hideZeroTx ? 'checked' : ''}>
        <span>Hide $0.00 transactions</span>
      </label>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Visible Columns</div>
      ${colRows}
    </div>`;
}

function _renderFiltersSettings(filters) {
  const rows = filters.length
    ? filters.map(f => `
      <div class="filter-rule-row" data-id="${f.id}">
        <span class="filter-pill filter-field">${esc(f.field)}</span>
        <span class="filter-pill filter-op">${esc(f.operator)}</span>
        <span class="filter-pill filter-val">"${esc(f.value)}"</span>
        <span class="badge ${f.action === 'skip' ? 'badge-debit' : 'badge-quarterly'}">${f.action === 'skip' ? 'Auto-skip' : 'Flag for review'}</span>
        <button class="btn-icon btn-delete-filter" data-id="${f.id}" title="Delete rule">✕</button>
      </div>`).join('')
    : '<div class="text-muted" style="font-size:13px;padding:4px 0">No filter rules yet.</div>';

  return `
    <div class="settings-section">
      <div class="settings-section-title">Import Filter Rules</div>
      <p class="text-muted" style="font-size:12px;margin-bottom:12px">
        Automatically skip or flag transactions matching these criteria during CSV import.
      </p>
      <div id="filter-rules-list">${rows}</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Add Rule</div>
      <div class="filter-add-form">
        <select id="filter-field">
          <option value="description">Description</option>
          <option value="category">Category</option>
          <option value="type">Type</option>
          <option value="amount">Amount</option>
        </select>
        <select id="filter-operator">
          <option value="contains">contains</option>
          <option value="equals">equals</option>
          <option value="startsWith">starts with</option>
          <option value="greaterThan">greater than</option>
          <option value="lessThan">less than</option>
        </select>
        <input type="text" id="filter-value" placeholder="Value…" />
        <select id="filter-action">
          <option value="skip">Auto-skip</option>
          <option value="review">Flag for review</option>
        </select>
        <button class="btn btn-primary btn-sm" id="btn-add-filter-rule">Add</button>
      </div>
    </div>`;
}

function _renderCategoriesSettings(categories) {
  const rows = categories.length
    ? categories.map(cat => {
        const subs = (cat.subcategories || []).join(', ') || '<span class="text-muted">none</span>';
        return `
        <div class="category-row" data-id="${cat.id}">
          <div class="category-row-main">
            <span class="category-name">${esc(cat.name)}</span>
            <span class="category-subs"><strong>Subs:</strong> ${subs}</span>
          </div>
          <div class="category-row-actions">
            <button class="btn-icon btn-edit-category" data-id="${cat.id}" title="Edit">✏️</button>
            <button class="btn-icon btn-delete-category" data-id="${cat.id}" title="Delete">✕</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="text-muted" style="font-size:13px;padding:4px 0">No categories defined yet.</div>';

  return `
    <div class="settings-section">
      <div class="settings-section-title">Categories</div>
      <p class="text-muted" style="font-size:12px;margin-bottom:12px">
        Define categories for organizing transactions. Each category can have optional subcategories.
      </p>
      <div id="category-list">${rows}</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Add / Edit Category</div>
      <input type="hidden" id="cat-id" />
      <div class="form-group" style="margin-bottom:10px">
        <label for="cat-name">Category Name *</label>
        <input type="text" id="cat-name" placeholder="e.g. Food & Dining, Transportation" />
      </div>
      <div class="form-group">
        <label for="cat-subcategories">Subcategories (comma-separated)</label>
        <input type="text" id="cat-subcategories" placeholder="e.g. Groceries, Restaurants, Fast Food" />
      </div>
      <button class="btn btn-primary btn-sm" id="btn-save-category">Save Category</button>
      <button class="btn btn-ghost btn-sm" id="btn-cancel-category">Cancel</button>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Importance Levels</div>
      <p class="text-muted" style="font-size:12px">
        Hard-coded importance tags: <strong>Essential</strong>, <strong>Important</strong>, <strong>Optional</strong>, <strong>Low</strong>
      </p>
    </div>`;
}

function _wireDisplaySettings() {
  document.querySelectorAll('#settings-display-tab [data-setting]').forEach(el => {
    el.addEventListener('change', () => {
      saveSetting(el.dataset.setting, el.checked);
      applySettings();
      const uid = auth.currentUser?.uid;
      if (uid && typeof _activeTab !== 'undefined' && _activeTab === 'transactions') {
        loadAndRenderTxList(uid);
      }
    });
  });
  document.querySelectorAll('#settings-display-tab input[name="theme"]').forEach(el => {
    el.addEventListener('change', () => { saveSetting('theme', el.value); applySettings(); });
  });
}

function _wireFilterSettings() {
  document.getElementById('filter-rules-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('.btn-delete-filter');
    if (!btn || !_settingsUid) return;
    await deleteImportFilter(_settingsUid, btn.dataset.id);
    _settingsFilters = _settingsFilters.filter(f => f.id !== btn.dataset.id);
    btn.closest('.filter-rule-row').remove();
    if (!_settingsFilters.length) {
      document.getElementById('filter-rules-list').innerHTML =
        '<div class="text-muted" style="font-size:13px;padding:4px 0">No filter rules yet.</div>';
    }
  });

  document.getElementById('btn-add-filter-rule')?.addEventListener('click', async () => {
    const field    = document.getElementById('filter-field').value;
    const operator = document.getElementById('filter-operator').value;
    const value    = document.getElementById('filter-value').value.trim();
    const action   = document.getElementById('filter-action').value;
    if (!value) { showToast('Enter a value for the filter', 'error'); return; }

    const id        = await saveImportFilter(_settingsUid, { field, operator, value, action });
    const newFilter = { id, field, operator, value, action };
    _settingsFilters.push(newFilter);
    document.getElementById('filter-value').value = '';

    const list = document.getElementById('filter-rules-list');
    // Remove "no rules" placeholder if present
    if (list.querySelector('.text-muted')) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', `
      <div class="filter-rule-row" data-id="${id}">
        <span class="filter-pill filter-field">${esc(field)}</span>
        <span class="filter-pill filter-op">${esc(operator)}</span>
        <span class="filter-pill filter-val">"${esc(value)}"</span>
        <span class="badge ${action === 'skip' ? 'badge-debit' : 'badge-quarterly'}">${action === 'skip' ? 'Auto-skip' : 'Flag for review'}</span>
        <button class="btn-icon btn-delete-filter" data-id="${id}" title="Delete rule">✕</button>
      </div>`);
    showToast('Filter rule added', 'success');
  });
}

function _wireCategorySettings() {
  document.getElementById('category-list')?.addEventListener('click', async e => {
    const deleteBtn = e.target.closest('.btn-delete-category');
    const editBtn   = e.target.closest('.btn-edit-category');
    if (!_settingsUid) return;

    if (deleteBtn) {
      const cat = _settingsCategories.find(c => c.id === deleteBtn.dataset.id);
      if (!confirm(`Delete category "${cat?.name}"?`)) return;
      await deleteCategoryDefinition(_settingsUid, deleteBtn.dataset.id);
      _settingsCategories = _settingsCategories.filter(c => c.id !== deleteBtn.dataset.id);
      deleteBtn.closest('.category-row').remove();
      if (!_settingsCategories.length) {
        document.getElementById('category-list').innerHTML =
          '<div class="text-muted" style="font-size:13px;padding:4px 0">No categories defined yet.</div>';
      }
      showToast('Category deleted', 'info');
    }

    if (editBtn) {
      const cat = _settingsCategories.find(c => c.id === editBtn.dataset.id);
      if (!cat) return;
      document.getElementById('cat-id').value = cat.id;
      document.getElementById('cat-name').value = cat.name || '';
      document.getElementById('cat-subcategories').value = (cat.subcategories || []).join(', ');
    }
  });

  document.getElementById('btn-save-category')?.addEventListener('click', async () => {
    const id   = document.getElementById('cat-id').value.trim();
    const name = document.getElementById('cat-name').value.trim();
    const subs = document.getElementById('cat-subcategories').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!name) { showToast('Category name is required', 'error'); return; }

    const catId = await saveCategoryDefinition(_settingsUid, { id: id || undefined, name, subcategories: subs });
    const existing = _settingsCategories.find(c => c.id === catId);
    if (existing) {
      existing.name = name;
      existing.subcategories = subs;
    } else {
      _settingsCategories.push({ id: catId, name, subcategories: subs });
      _settingsCategories.sort((a, b) => a.name.localeCompare(b.name));
    }

    document.getElementById('cat-id').value = '';
    document.getElementById('cat-name').value = '';
    document.getElementById('cat-subcategories').value = '';

    // Re-render category list
    const list = document.getElementById('category-list');
    const rows = _settingsCategories.map(cat => {
      const subsStr = (cat.subcategories || []).join(', ') || '<span class="text-muted">none</span>';
      return `
        <div class="category-row" data-id="${cat.id}">
          <div class="category-row-main">
            <span class="category-name">${esc(cat.name)}</span>
            <span class="category-subs"><strong>Subs:</strong> ${subsStr}</span>
          </div>
          <div class="category-row-actions">
            <button class="btn-icon btn-edit-category" data-id="${cat.id}" title="Edit">✏️</button>
            <button class="btn-icon btn-delete-category" data-id="${cat.id}" title="Delete">✕</button>
          </div>
        </div>`;
    }).join('');
    list.innerHTML = rows;

    showToast(id ? 'Category updated' : 'Category added', 'success');
  });

  document.getElementById('btn-cancel-category')?.addEventListener('click', () => {
    document.getElementById('cat-id').value = '';
    document.getElementById('cat-name').value = '';
    document.getElementById('cat-subcategories').value = '';
  });
}
