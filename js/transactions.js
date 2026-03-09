// ── Transactions Tab ──────────────────────────────────────────────────────────

let _pendingImport = [];  // rows waiting for user confirmation
let _showHidden    = false; // toggle to show/hide hidden transactions
let _categoryDefs  = [];   // cached category definitions
let _pendingCategorySuggestions = [];
let _pendingSubcategorySuggestions = [];

// ─── CSV Parsing ──────────────────────────────────────────────────────────────
function parseTransactionCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: results => {
        try {
          const rows = results.data.map(mapBankRow).filter(r => r !== null);
          resolve(rows);
        } catch (e) {
          reject(e);
        }
      },
      error: reject,
    });
  });
}

function _extractAccountNumber(txId) {
  // Transaction ID format: "YYYYMMDD ACCTNUM AMOUNT TXREF"
  const parts = String(txId).trim().split(/\s+/);
  return parts.length >= 2 ? parts[1] : null;
}

function mapBankRow(row) {
  // Handles the specific bank CSV format (also tolerates minor header variations)
  const txId = row['Transaction ID'] || row['transaction_id'] || row['TransactionID'];
  if (!txId) return null;

  const postingDate = row['Posting Date'] || row['PostingDate'] || '';
  const type        = row['Transaction Type'] || row['Type'] || '';
  const rawAmount   = row['Amount'] || '0';
  const description = row['Description'] || row['Merchant'] || '';
  const category    = row['Transaction Category'] || row['Category'] || '';
  const rawBalance  = row['Balance'] || '0';
  const extDesc     = row['Extended Description'] || '';

  // Parse amounts — bank uses negative for debits, positive for credits
  const amount = Math.abs(parseFloat(String(rawAmount).replace(/,/g, '')) || 0);
  const balance = parseFloat(String(rawBalance).replace(/,/g, '')) || 0;

  // Build YYYY-MM for grouping
  const yearMonth = postingDateToYearMonth(postingDate);

  return {
    txId: String(txId).trim(),
    postingDate: postingDate.trim(),
    yearMonth,
    type:        type.trim(),      // "Debit" | "Credit"
    amount,
    description: description.trim(),
    category:    category.trim(),
    balance,
    extDesc:     extDesc.trim(),
  };
}

function postingDateToYearMonth(dateStr) {
  // Handles M/D/YYYY format
  const parts = String(dateStr).split('/');
  if (parts.length === 3) {
    const [m, , y] = parts;
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  return '';
}

// ─── Auto-Assignment Logic ────────────────────────────────────────────────────
const _DESC_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'at', 'on', 'in', 'with',
  'payment', 'online', 'purchase', 'pos', 'debit', 'card', 'visa', 'mastercard',
]);

const _KEYWORD_RULES = [
  { words: ['grocery', 'grocer', 'market', 'supermarket', 'aldi', 'kroger', 'publix', 'walmart'], category: 'Food & Dining', subcategory: 'Groceries', importance: 'Essential' },
  { words: ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'chipotle', 'doordash', 'uber eats'], category: 'Food & Dining', subcategory: 'Restaurants', importance: 'Optional' },
  { words: ['uber', 'lyft', 'shell', 'chevron', 'exxon', 'fuel', 'gas', 'parking', 'toll'], category: 'Transportation', subcategory: 'Fuel & Transit', importance: 'Important' },
  { words: ['netflix', 'spotify', 'hulu', 'disney', 'max', 'youtube'], category: 'Entertainment', subcategory: 'Streaming', importance: 'Optional' },
  { words: ['rent', 'mortgage', 'hoa'], category: 'Housing', subcategory: 'Rent & Mortgage', importance: 'Essential' },
  { words: ['electric', 'water', 'sewer', 'utility', 'internet', 'xfinity', 'comcast', 'att', 'verizon', 'tmobile'], category: 'Utilities', subcategory: 'Bills', importance: 'Essential' },
  { words: ['insurance', 'geico', 'progressive', 'allstate'], category: 'Insurance', subcategory: 'Premiums', importance: 'Essential' },
  { words: ['pharmacy', 'walgreens', 'cvs', 'hospital', 'clinic', 'medical', 'dental'], category: 'Health', subcategory: 'Medical', importance: 'Essential' },
  { words: ['amazon', 'target', 'bestbuy', 'store'], category: 'Shopping', subcategory: 'General', importance: 'Optional' },
];

function _tokenizeDesc(str) {
  return _normalizeDesc(str)
    .split(' ')
    .filter(t => t.length > 1 && !_DESC_STOPWORDS.has(t));
}

function _jaccardSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  a.forEach(t => { if (b.has(t)) inter++; });
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

function _amountSimilarity(a, b) {
  if (!a || !b) return 0.5;
  const max = Math.max(a, b);
  const ratio = max ? Math.abs(a - b) / max : 1;
  return Math.max(0, 1 - ratio);
}

function _importanceFromCategoryName(category) {
  const c = String(category || '').toLowerCase();
  if (!c) return '';
  if (['housing', 'utilities', 'insurance', 'health'].some(k => c.includes(k))) return 'Essential';
  if (['transport', 'education', 'debt'].some(k => c.includes(k))) return 'Important';
  if (['entertainment', 'shopping', 'travel'].some(k => c.includes(k))) return 'Optional';
  return 'Low';
}

function _parseBankCategory(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return { category: '', subcategory: '' };
  const parts = txt.split(/[>/:-]/).map(s => s.trim()).filter(Boolean);
  return {
    category: parts[0] || txt,
    subcategory: parts[1] || '',
  };
}

function _deriveRecommendation(tokens, categoryDefs, bankCategory) {
  // 1) Match against user-defined categories/subcategories
  let best = null;
  (categoryDefs || []).forEach(def => {
    const catTokens = _tokenizeDesc(def.name || '');
    const catScore  = _jaccardSimilarity(tokens, catTokens);
    if (!best || catScore > best.score) {
      best = { score: catScore, category: def.name, subcategory: '', source: 'defined-category', isNew: false };
    }
    (def.subcategories || []).forEach(sub => {
      const subTokens = _tokenizeDesc(sub);
      const subScore  = _jaccardSimilarity(tokens, subTokens);
      if (!best || subScore > best.score) {
        best = { score: subScore, category: def.name, subcategory: sub, source: 'defined-subcategory', isNew: false };
      }
    });
  });
  if (best && best.score >= 0.34) {
    return {
      category: best.category,
      subcategory: best.subcategory,
      importance: _importanceFromCategoryName(best.category),
      source: best.source,
      isNew: false,
    };
  }

  // 2) Keyword-based inference (may suggest new categories)
  for (const rule of _KEYWORD_RULES) {
    if (rule.words.some(w => tokens.some(t => t.includes(w) || w.includes(t)))) {
      const exists = (categoryDefs || []).some(d => String(d.name || '').toLowerCase() === rule.category.toLowerCase());
      return {
        category: rule.category,
        subcategory: rule.subcategory,
        importance: rule.importance,
        source: 'keyword',
        isNew: !exists,
      };
    }
  }

  // 3) Fall back to bank-provided category if available
  const parsed = _parseBankCategory(bankCategory);
  if (parsed.category) {
    const exists = (categoryDefs || []).some(d => String(d.name || '').toLowerCase() === parsed.category.toLowerCase());
    return {
      category: parsed.category,
      subcategory: parsed.subcategory,
      importance: _importanceFromCategoryName(parsed.category),
      source: 'bank-category',
      isNew: !exists,
    };
  }

  return null;
}

async function autoAssignCategories(uid, rows) {
  // Build pattern map from existing categorized transactions
  const existing = await getAllTransactions(uid);
  const categoryDefs = await getCategoryDefinitions(uid);
  const patternMap = {};  // normalized description → { category, subcategory, importance, count, avgAmount, tokens }

  existing.forEach(tx => {
    if (!tx.category) return;
    const key = _normalizeDesc(tx.description);
    if (!key) return;
    if (!patternMap[key]) {
      patternMap[key] = {
        category: tx.category,
        subcategory: tx.subcategory || '',
        importance: tx.importance || '',
        count: 0,
        avgAmount: 0,
        tokens: _tokenizeDesc(tx.description),
      };
    }
    patternMap[key].avgAmount = ((patternMap[key].avgAmount * patternMap[key].count) + (tx.amount || 0)) / (patternMap[key].count + 1);
    patternMap[key].count++;
  });

  const learnedPatterns = Object.entries(patternMap).map(([key, p]) => ({ key, ...p }));

  // Apply to new rows
  rows.forEach(row => {
    const desc = String(row.description || '');
    const key = _normalizeDesc(row.description);
    const tokens = _tokenizeDesc(desc);

    // 1) Exact learned match from prior transactions
    if (key && patternMap[key] && patternMap[key].count >= 1) {
      row.category    = patternMap[key].category;
      row.subcategory = patternMap[key].subcategory;
      row.importance  = patternMap[key].importance || _importanceFromCategoryName(patternMap[key].category);
      row._autoAssignedBy = 'exact-history';
      row._autoAssignedConfidence = 0.98;
      return;
    }

    // 2) Fuzzy learned match
    let best = null;
    learnedPatterns.forEach(p => {
      const tokenScore = _jaccardSimilarity(tokens, p.tokens || []);
      if (tokenScore < 0.2) return;
      const amountScore = _amountSimilarity(row.amount || 0, p.avgAmount || 0);
      const countScore  = Math.min(p.count / 4, 1);
      const score = tokenScore * 0.72 + amountScore * 0.18 + countScore * 0.10;
      if (!best || score > best.score) best = { score, pattern: p };
    });

    if (best && best.score >= 0.62) {
      row.category    = best.pattern.category;
      row.subcategory = best.pattern.subcategory;
      row.importance  = best.pattern.importance || _importanceFromCategoryName(best.pattern.category);
      row._autoAssignedBy = 'fuzzy-history';
      row._autoAssignedConfidence = Math.round(best.score * 100) / 100;
      return;
    }

    // 3) Recommendation path (defined categories, keyword inference, bank category)
    const recommendation = _deriveRecommendation(tokens, categoryDefs, row.category);
    if (recommendation) {
      row._categoryRecommendation = recommendation.category;
      row._subcategoryRecommendation = recommendation.subcategory || '';
      row._importanceRecommendation = recommendation.importance || '';
      row._recommendationSource = recommendation.source;
      row._suggestedNewCategory = !!recommendation.isNew;

      if (!row.category) row.category = recommendation.category;
      if (!row.subcategory && recommendation.subcategory) row.subcategory = recommendation.subcategory;
      if (!row.importance && recommendation.importance) row.importance = recommendation.importance;
      return;
    }

    // 4) Final fallback: if a category exists but importance is blank, infer importance.
    if (row.category && !row.importance) {
      row.importance = _importanceFromCategoryName(row.category);
    }
  });
}

function _collectCategorySuggestions(rows, categoryDefs) {
  const existingNames = new Set((categoryDefs || []).map(c => String(c.name || '').toLowerCase()));
  const suggestions = new Map();
  rows.forEach(r => {
    const name = String(r._categoryRecommendation || '').trim();
    if (!name) return;

    const isActuallyNew = !existingNames.has(name.toLowerCase());
    if (!isActuallyNew) return;

    const key = name.toLowerCase();
    if (!suggestions.has(key)) {
      suggestions.set(key, {
        key,
        name,
        subcategories: new Set(),
        sources: new Set(),
        count: 0,
      });
    }

    const item = suggestions.get(key);
    const sub = String(r._subcategoryRecommendation || '').trim();
    if (sub) item.subcategories.add(sub);
    item.sources.add(String(r._recommendationSource || 'rules'));
    item.count += 1;
  });

  return [...suggestions.values()].map(s => ({
    key: s.key,
    name: s.name,
    subcategories: [...s.subcategories],
    source: [...s.sources].join(', '),
    count: s.count,
  }));
}

function _collectSubcategorySuggestions(rows, categoryDefs) {
  const byCategory = new Map((categoryDefs || []).map(c => [String(c.name || '').toLowerCase(), c]));
  const suggestions = new Map();

  rows.forEach(r => {
    const category = String(r._categoryRecommendation || '').trim();
    const subcategory = String(r._subcategoryRecommendation || '').trim();
    if (!category || !subcategory) return;

    const catDef = byCategory.get(category.toLowerCase());
    if (!catDef) return;

    const exists = (catDef.subcategories || []).some(s => String(s).toLowerCase() === subcategory.toLowerCase());
    if (exists) return;

    const key = `${category.toLowerCase()}::${subcategory.toLowerCase()}`;
    if (!suggestions.has(key)) {
      suggestions.set(key, {
        key,
        category,
        subcategory,
        sources: new Set(),
        count: 0,
      });
    }

    const item = suggestions.get(key);
    item.sources.add(String(r._recommendationSource || 'rules'));
    item.count += 1;
  });

  return [...suggestions.values()].map(s => ({
    key: s.key,
    category: s.category,
    subcategory: s.subcategory,
    source: [...s.sources].join(', '),
    count: s.count,
  }));
}

function _refreshPendingSuggestions() {
  _pendingCategorySuggestions = _collectCategorySuggestions(_pendingImport, _categoryDefs);
  _pendingSubcategorySuggestions = _collectSubcategorySuggestions(_pendingImport, _categoryDefs);
}

function _renderImportSuggestionPanels() {
  const wrap = document.getElementById('import-preview-table-wrap');
  if (!wrap) return;

  let catPanel = document.getElementById('import-category-suggestions');
  if (!catPanel) {
    catPanel = document.createElement('div');
    catPanel.id = 'import-category-suggestions';
    catPanel.className = 'import-suggestions-box hidden';
    wrap.parentNode.insertBefore(catPanel, wrap);
  }

  let subPanel = document.getElementById('import-subcategory-suggestions');
  if (!subPanel) {
    subPanel = document.createElement('div');
    subPanel.id = 'import-subcategory-suggestions';
    subPanel.className = 'import-suggestions-box hidden';
    wrap.parentNode.insertBefore(subPanel, wrap);
  }

  if (_pendingCategorySuggestions.length) {
    const list = _pendingCategorySuggestions.map(s => `
      <div class="import-sugg-row" data-key="${esc(s.key)}">
        <div>
          <strong>${esc(s.name)}</strong>
          ${s.subcategories.length ? `<span class="text-muted"> · ${esc(s.subcategories.join(', '))}</span>` : ''}
          <div class="text-muted" style="font-size:11px">${s.count} transaction(s), source: ${esc(s.source)}</div>
        </div>
        <div class="import-sugg-actions">
          <button class="btn btn-primary btn-sm btn-accept-category-suggestion" data-key="${esc(s.key)}">Accept</button>
          <button class="btn btn-ghost btn-sm btn-decline-category-suggestion" data-key="${esc(s.key)}">Decline</button>
        </div>
      </div>
    `).join('');

    catPanel.innerHTML = `
      <div class="import-sugg-header">
        <div>
          <strong>Suggested New Categories</strong>
          <div class="text-muted" style="font-size:12px">Accept or decline each category suggestion.</div>
        </div>
      </div>
      <div class="import-sugg-list">${list}</div>
    `;
    catPanel.classList.remove('hidden');
  } else {
    catPanel.classList.add('hidden');
    catPanel.innerHTML = '';
  }

  if (_pendingSubcategorySuggestions.length) {
    const list = _pendingSubcategorySuggestions.map(s => `
      <div class="import-sugg-row" data-key="${esc(s.key)}">
        <div>
          <strong>${esc(s.category)}</strong>
          <span class="text-muted"> → ${esc(s.subcategory)}</span>
          <div class="text-muted" style="font-size:11px">${s.count} transaction(s), source: ${esc(s.source)}</div>
        </div>
        <div class="import-sugg-actions">
          <button class="btn btn-primary btn-sm btn-accept-subcategory-suggestion" data-key="${esc(s.key)}">Accept</button>
          <button class="btn btn-ghost btn-sm btn-decline-subcategory-suggestion" data-key="${esc(s.key)}">Decline</button>
        </div>
      </div>
    `).join('');

    subPanel.innerHTML = `
      <div class="import-sugg-header">
        <div>
          <strong>Suggested New Subcategories</strong>
          <div class="text-muted" style="font-size:12px">Accept or decline each subcategory suggestion.</div>
        </div>
      </div>
      <div class="import-sugg-list">${list}</div>
    `;
    subPanel.classList.remove('hidden');
  } else {
    subPanel.classList.add('hidden');
    subPanel.innerHTML = '';
  }
}

async function acceptCategorySuggestion(uid, key) {
  const suggestion = _pendingCategorySuggestions.find(s => s.key === key);
  if (!suggestion) return;
  const existing = await getCategoryDefinitions(uid);
  const byName = new Map(existing.map(c => [String(c.name || '').toLowerCase(), c]));

  const found = byName.get(suggestion.name.toLowerCase());
  if (found) {
    const merged = [...new Set([...(found.subcategories || []), ...(suggestion.subcategories || [])])];
    await saveCategoryDefinition(uid, { id: found.id, name: found.name, subcategories: merged });
  } else {
    await saveCategoryDefinition(uid, { name: suggestion.name, subcategories: suggestion.subcategories || [] });
  }

  _pendingCategorySuggestions = _pendingCategorySuggestions.filter(s => s.key !== key);
  _categoryDefs = await getCategoryDefinitions(uid);
  _refreshPendingSuggestions();
  _renderImportSuggestionPanels();
  showToast(`Added category "${suggestion.name}"`, 'success');
}

function declineCategorySuggestion(key) {
  _pendingCategorySuggestions = _pendingCategorySuggestions.filter(s => s.key !== key);
  _renderImportSuggestionPanels();
}

async function acceptSubcategorySuggestion(uid, key) {
  const suggestion = _pendingSubcategorySuggestions.find(s => s.key === key);
  if (!suggestion) return;

  const defs = await getCategoryDefinitions(uid);
  const cat = defs.find(c => String(c.name || '').toLowerCase() === suggestion.category.toLowerCase());

  if (cat) {
    const merged = [...new Set([...(cat.subcategories || []), suggestion.subcategory])];
    await saveCategoryDefinition(uid, { id: cat.id, name: cat.name, subcategories: merged });
  } else {
    await saveCategoryDefinition(uid, { name: suggestion.category, subcategories: [suggestion.subcategory] });
  }

  _pendingSubcategorySuggestions = _pendingSubcategorySuggestions.filter(s => s.key !== key);
  _categoryDefs = await getCategoryDefinitions(uid);
  _refreshPendingSuggestions();
  _renderImportSuggestionPanels();
  showToast(`Added subcategory "${suggestion.subcategory}"`, 'success');
}

function declineSubcategorySuggestion(key) {
  _pendingSubcategorySuggestions = _pendingSubcategorySuggestions.filter(s => s.key !== key);
  _renderImportSuggestionPanels();
}

// ─── Import Flow ──────────────────────────────────────────────────────────────
async function handleCSVFile(file, uid) {
  showToast('Parsing CSV…', 'info');
  try {
    const rows = await parseTransactionCSV(file);
    if (!rows.length) { showToast('No transactions found in file', 'error'); return; }

    // Check for duplicates
    const existing = await getImportedTxIds(uid);
    const newRows  = rows.filter(r => !existing.has(r.txId));
    const dupCount = rows.length - newRows.length;

    // Auto-assign categories to new rows based on existing patterns
    await autoAssignCategories(uid, newRows);

    // Apply import filter rules
    const filters = await getImportFilters(uid);
    const { kept, skipped, flagged } = applyImportFilters(newRows, filters);
    _pendingImport = kept;
    _refreshPendingSuggestions();

    // Detect account number from Transaction ID
    const detectedAcctNum = _extractAccountNumber(rows[0]?.txId || '');
    document.getElementById('import-detected-acct').textContent = detectedAcctNum || 'Unknown';

    // Populate account selector
    const accounts = await getAccounts(uid);
    const acctSel  = document.getElementById('import-account-select');
    const matchingAcct = accounts.find(a => a.detectedNumber === detectedAcctNum);
    acctSel.innerHTML =
      accounts.map(a =>
        `<option value="${a.id}"${a.id === matchingAcct?.id ? ' selected' : ''}>${esc(a.name)}</option>`
      ).join('') +
      `<option value="new"${!matchingAcct ? ' selected' : ''}>+ New account…</option>`;
    const nameGroup = document.getElementById('new-account-name-group');
    nameGroup.classList.toggle('hidden', !!matchingAcct);

    // Show preview stats
    const stats = document.getElementById('import-stats');
    const dateRange = _getDateRange(rows);
    let statsHTML =
      `<strong>${rows.length}</strong> rows parsed · ` +
      `<span class="text-green">${kept.length} to import</span> · ` +
      `<span class="text-muted">${dupCount} already imported</span>`;
    if (skipped.length)  statsHTML += ` · <span class="text-muted">${skipped.length} auto-skipped by filters</span>`;
    if (flagged.length)  statsHTML += ` · <span style="color:var(--yellow)">${flagged.length} flagged for review</span>`;
    statsHTML += ` · ${dateRange}`;
    stats.innerHTML = statsHTML;

    const wrap = document.getElementById('import-preview-table-wrap');
    _renderImportSuggestionPanels();
    wrap.innerHTML = buildTxTable(kept.slice(0, 20), [], true);
    if (kept.length > 20) {
      wrap.innerHTML += `<div class="text-muted" style="padding:8px 12px">…and ${kept.length - 20} more</div>`;
    }

    document.getElementById('import-preview').classList.remove('hidden');
    document.getElementById('btn-import-confirm').disabled = kept.length === 0;
    showToast('', 'info');
  } catch (err) {
    showToast('Parse error: ' + err.message, 'error');
  }
}

async function confirmImport(uid) {
  if (!_pendingImport.length) return;

  // Resolve account
  const acctSel   = document.getElementById('import-account-select');
  const acctVal   = acctSel.value;
  let accountId, accountName;

  if (acctVal === 'new') {
    const name = document.getElementById('import-account-name').value.trim();
    if (!name) { showToast('Enter an account nickname first', 'error'); return; }
    const detectedNumber = document.getElementById('import-detected-acct').textContent;
    accountId   = await saveAccount(uid, { name, detectedNumber });
    accountName = name;
  } else if (acctVal) {
    accountId   = acctVal;
    accountName = acctSel.options[acctSel.selectedIndex].text;
  } else {
    showToast('Select an account to assign these transactions to', 'error'); return;
  }

  // Stamp every pending row with the account
  const rowsWithAccount = _pendingImport.map(r => ({ ...r, accountId, accountName }));

  document.getElementById('btn-import-confirm').disabled = true;
  showToast('Importing…', 'info');
  try {
    const { imported, skipped } = await importTransactions(uid, rowsWithAccount);
    _pendingImport = [];
    _pendingCategorySuggestions = [];
    _pendingSubcategorySuggestions = [];
    _renderImportSuggestionPanels();
    document.getElementById('import-preview').classList.add('hidden');
    showToast(`Imported ${imported} transactions to "${accountName}" (${skipped} skipped)`, 'success');
    await renderTransactionsTab(uid);
    await renderRecurringSuggestions(uid);
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
    document.getElementById('btn-import-confirm').disabled = false;
  }
}

function cancelImport() {
  _pendingImport = [];
  _pendingCategorySuggestions = [];
  _pendingSubcategorySuggestions = [];
  _renderImportSuggestionPanels();
  document.getElementById('import-preview').classList.add('hidden');
}

function _getDateRange(rows) {
  const dates = rows.map(r => r.postingDate).filter(Boolean).sort();
  if (!dates.length) return '';
  return `${dates[0]} – ${dates[dates.length - 1]}`;
}

// ─── Render Tab ───────────────────────────────────────────────────────────────
async function renderTransactionsTab(uid) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Populate filters in parallel
  const [months, cats, accounts, categoryDefs] = await Promise.all([
    getTransactionMonths(uid),
    getTransactionCategories(uid),
    getAccounts(uid),
    getCategoryDefinitions(uid),
  ]);

  _categoryDefs = categoryDefs;

  const monthSel = document.getElementById('tx-month');
  monthSel.innerHTML = '<option value="">All Months</option>' +
    months.map(m => `<option value="${m}"${m === defaultMonth ? ' selected' : ''}>${m}</option>`).join('');

  const acctSel = document.getElementById('tx-account');
  acctSel.innerHTML = '<option value="">All Accounts</option>' +
    accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  const catSel = document.getElementById('tx-category');
  catSel.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${c}">${esc(c)}</option>`).join('');

  await loadAndRenderTxList(uid);
}

async function loadAndRenderTxList(uid) {
  const yearMonth = document.getElementById('tx-month').value;
  const category  = document.getElementById('tx-category').value;
  const accountId = document.getElementById('tx-account').value;
  const s         = getSettings();

  let txns = await getTransactions(uid, { yearMonth, category });
  if (accountId) txns = txns.filter(t => t.accountId === accountId);
  if (s.hideZeroTx) txns = txns.filter(t => t.amount !== 0);

  // Split hidden from visible for summary; when _showHidden is true, render all
  const visibleTxns = _showHidden ? txns : txns.filter(t => !t.hidden);
  const bills       = _billsCache || [];
  const listEl      = document.getElementById('tx-list');

  // Update show-hidden button label
  const hiddenCount = txns.filter(t => t.hidden).length;
  const showHiddenBtn = document.getElementById('btn-show-hidden');
  if (showHiddenBtn) {
    showHiddenBtn.textContent = _showHidden
      ? 'Hide hidden'
      : `Show Hidden${hiddenCount ? ` (${hiddenCount})` : ''}`;
  }

  if (!visibleTxns.length) {
    listEl.innerHTML = '<div class="empty-state">No transactions found. Import a CSV to get started.</div>';
    document.getElementById('tx-summary').classList.add('hidden');
    return;
  }

  // Summary — always excludes hidden transactions regardless of _showHidden
  const summaryTxns = txns.filter(t => !t.hidden);
  let totalSpent = 0, totalIncome = 0;
  summaryTxns.forEach(t => {
    if (t.type === 'Debit')  totalSpent  += t.amount;
    if (t.type === 'Credit') totalIncome += t.amount;
  });
  document.getElementById('tx-total-spent').textContent  = fmt(totalSpent);
  document.getElementById('tx-total-income').textContent = fmt(totalIncome);
  document.getElementById('tx-count').textContent        = summaryTxns.length;
  document.getElementById('tx-summary').classList.remove('hidden');

  listEl.innerHTML = buildTxTable(visibleTxns, bills, false);
}

// ─── Recurring Bill Detection ──────────────────────────────────────────────────

function _normalizeDesc(str) {
  return String(str).toLowerCase()
    .replace(/\s+#\d+\s*/g, ' ')    // strip store numbers like #5304
    .replace(/\b\d{5,}\b/g, '')      // strip long numeric codes
    .replace(/[^a-z0-9\s]/g, ' ')   // strip special chars
    .replace(/\s+/g, ' ')
    .trim();
}

function _parseTxDate(str) {
  // M/D/YYYY → Date
  const [m, d, y] = String(str).split('/');
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
}

function _ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function _predictDueDay(sortedTxns) {
  // Extract the day-of-month from each posting date
  const days = sortedTxns.map(t => _parseTxDate(t.postingDate).getDate());

  // Count how often each day appears
  const counts = {};
  days.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
  const [[topDay, topCount]] = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  // Accept prediction if the most common day covers ≥ half the occurrences
  // OR if all days are within a 3-day window of each other (bank processing delays)
  const min = Math.min(...days), max = Math.max(...days);
  if (topCount >= Math.ceil(days.length / 2) || (max - min) <= 3) {
    return _ordinal(parseInt(topDay, 10));
  }
  return null;
}

function detectRecurringCharges(transactions, existingBills) {
  const debits = transactions.filter(t => t.type === 'Debit' && t.amount > 0);

  // Group by normalized description
  const groups = {};
  debits.forEach(t => {
    const key = _normalizeDesc(t.description);
    if (!key) return;
    if (!groups[key]) groups[key] = { display: t.description, txns: [], category: t.category, accounts: {} };
    groups[key].txns.push(t);
    if (t.accountName) groups[key].accounts[t.accountName] = (groups[key].accounts[t.accountName] || 0) + 1;
  });

  // Build set of already-tracked bill names for deduplication
  const trackedNames = (existingBills || []).map(b => _normalizeDesc(b.company));

  const suggestions = [];

  Object.values(groups).forEach(({ display, txns, category, accounts }) => {
    if (txns.length < 2) return;

    const sorted  = [...txns].sort((a, b) => _parseTxDate(a.postingDate) - _parseTxDate(b.postingDate));
    const dates   = sorted.map(t => _parseTxDate(t.postingDate));
    const amounts = sorted.map(t => t.amount);

    // Amount consistency — within 10%
    const avgAmount       = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountRange     = Math.max(...amounts) - Math.min(...amounts);
    const amountConsistent = avgAmount > 0 && (amountRange / avgAmount) < 0.10;

    // Days between each occurrence
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

    // Must match a clear frequency pattern — no catch-all fallback
    let frequency = null, freqConf = 0;
    if      (avgGap >= 25 && avgGap <= 35)    { frequency = 'monthly';   freqConf = 0.9; }
    else if (avgGap >= 85 && avgGap <= 100)   { frequency = 'quarterly'; freqConf = 0.75; }
    else if (avgGap >= 355 && avgGap <= 375)  { frequency = 'annual';    freqConf = 0.75; }
    else return;

    // Recency: how long since last occurrence (35% of score)
    const daysSinceLast = (new Date() - dates[dates.length - 1]) / 86400000;
    const recencyFactor = daysSinceLast <= 45  ? 1.0
                        : daysSinceLast <= 90  ? 0.8
                        : daysSinceLast <= 180 ? 0.6
                        : daysSinceLast <= 365 ? 0.4
                        : 0.2;

    // Occurrence count: caps at 5+ sightings (15% of score)
    const countFactor = Math.min(txns.length / 5, 1.0);

    // Combined: frequency pattern (50%) + recency (35%) + count (15%)
    const baseConf   = amountConsistent ? freqConf : freqConf * 0.65;
    const confidence = baseConf * 0.5 + recencyFactor * 0.35 + countFactor * 0.15;

    if (confidence < 0.45) return;

    // Skip if already tracked as a bill
    const normDisplay    = _normalizeDesc(display);
    const alreadyTracked = trackedNames.some(n => n && (normDisplay.includes(n) || n.includes(normDisplay)));
    if (alreadyTracked) return;

    const topAccount = Object.entries(accounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const freqScore    = Math.round(baseConf * 0.5 * 100);
    const recencyScore = Math.round(recencyFactor * 0.35 * 100);
    const countScore   = Math.round(countFactor * 0.15 * 100);

    suggestions.push({
      description:         display,
      amount:              amountConsistent ? Math.round(avgAmount * 100) / 100 : null,
      mostRecentAmount:    Math.round(amounts[amounts.length - 1] * 100) / 100,
      mostRecentDayOrdinal: _ordinal(dates[dates.length - 1].getDate()),
      txnHistory:          sorted.map(t => ({ date: t.postingDate, amount: t.amount })),
      confidenceBreakdown: { freq: freqScore, recency: recencyScore, count: countScore },
      frequency,
      confidence,
      occurrences: txns.length,
      lastDate:    sorted[sorted.length - 1].postingDate,
      lastDateMs:  dates[dates.length - 1].getTime(),
      category,
      dueDay:      _predictDueDay(sorted),
      accountName: topAccount,
    });
  });

  // Sort: confidence descending; break ties by most recent
  return suggestions.sort((a, b) => {
    const diff = b.confidence - a.confidence;
    return Math.abs(diff) > 0.05 ? diff : b.lastDateMs - a.lastDateMs;
  });
}

// ─── Suggestions Panel (Tinder-style) ────────────────────────────────────────
let _pendingSuggestions = [];
let _dismissedDescs     = new Set();
let _currentSuggIdx     = 0;
let _activeSuggestion   = null; // suggestion currently staged for bill modal (not yet saved)

async function renderRecurringSuggestions(uid) {
  const panel = document.getElementById('recurring-suggestions');
  if (!panel) return;

  const [allTxns, bills] = await Promise.all([getAllTransactions(uid), getBills(uid)]);
  const all = detectRecurringCharges(allTxns, bills);

  _pendingSuggestions = all.filter(s => !_dismissedDescs.has(s.description));
  if (_currentSuggIdx >= _pendingSuggestions.length) _currentSuggIdx = 0;

  _renderCurrentSuggestion();
}

function _renderCurrentSuggestion() {
  const panel = document.getElementById('recurring-suggestions');
  if (!panel) return;

  if (!_pendingSuggestions.length) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');
  const s = _pendingSuggestions[_currentSuggIdx];
  document.getElementById('suggestion-progress').textContent =
    `${_currentSuggIdx + 1} of ${_pendingSuggestions.length}`;
  document.getElementById('suggestion-card-display').innerHTML = _suggestionDetailHTML(s);
}

function _suggestionDetailHTML(s) {
  const confPct   = Math.round(s.confidence * 100);
  const confColor = s.confidence >= 0.75 ? 'var(--green)' : s.confidence >= 0.6 ? 'var(--yellow)' : 'var(--text-muted)';
  const amtText   = s.amount != null
    ? fmt(s.amount)
    : `Variable${s.mostRecentAmount ? ` (last: ${fmt(s.mostRecentAmount)})` : ''}`;
  const freqLabel = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' }[s.frequency] || s.frequency;
  const bd        = s.confidenceBreakdown || {};
  const confTitle = `Frequency pattern: ${bd.freq || 0}%&#10;Recency: ${bd.recency || 0}%&#10;Occurrence count: ${bd.count || 0}%`;
  const occLabel  = `${s.occurrences} occurrence${s.occurrences !== 1 ? 's' : ''}`;

  const txnRows = (s.txnHistory || []).slice().reverse()
    .map(t => `<tr>
      <td style="padding:2px 0;color:var(--text-muted)">${esc(t.date)}</td>
      <td style="padding:2px 0 2px 16px;text-align:right;font-weight:600">${fmt(t.amount)}</td>
    </tr>`).join('');

  return `
    <div class="suggestion-detail">
      <div class="suggestion-detail-name">${esc(s.description)}</div>
      <div class="suggestion-detail-meta">
        <span class="suggestion-detail-amount">${amtText}</span>
        <span class="suggestion-detail-freq">${freqLabel}</span>
        ${s.dueDay    ? `<span class="text-muted">Due ~${esc(s.dueDay)}</span>` : ''}
        ${s.accountName ? `<span class="account-chip">${esc(s.accountName)}</span>` : ''}
      </div>
      <div class="suggestion-detail-stats">
        <span class="btn-sugg-toggle-txns" data-count="${s.occurrences}"
          style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px"
          title="Click to see all occurrences">${occLabel} ▾</span>
        <span>Last: ${esc(s.lastDate)}</span>
        <span>${esc(s.category)}</span>
        <span style="color:${confColor};cursor:help" title="${confTitle}">${confPct}% confidence ⓘ</span>
      </div>
      <div class="suggestion-txn-list hidden" style="margin-top:10px">
        <table style="font-size:12px;border-collapse:collapse;width:100%">
          <thead><tr>
            <th style="text-align:left;color:var(--text-muted);font-weight:500;padding-bottom:4px">Date</th>
            <th style="text-align:right;color:var(--text-muted);font-weight:500;padding-bottom:4px;padding-left:16px">Amount</th>
          </tr></thead>
          <tbody>${txnRows}</tbody>
        </table>
      </div>
    </div>`;
}

function dismissCurrentSuggestion() {
  if (!_pendingSuggestions.length) return;
  _dismissedDescs.add(_pendingSuggestions.splice(_currentSuggIdx, 1)[0].description);
  if (_currentSuggIdx >= _pendingSuggestions.length) _currentSuggIdx = 0;
  _renderCurrentSuggestion();
}

function skipCurrentSuggestion() {
  if (_pendingSuggestions.length <= 1) return;
  _currentSuggIdx = (_currentSuggIdx + 1) % _pendingSuggestions.length;
  _renderCurrentSuggestion();
}

function addCurrentSuggestion() {
  if (!_pendingSuggestions.length) return;
  _activeSuggestion = _pendingSuggestions[_currentSuggIdx];
  // Panel stays on current suggestion while modal is open.
  // confirmDismissActiveSuggestion() advances after successful save.

  const s = _activeSuggestion;
  // Pre-fill bill modal
  // Amount: use consistent average, or fall back to most recent for variable bills
  const amountVal = s.amount != null
    ? s.amount.toFixed(2)
    : (s.mostRecentAmount ? s.mostRecentAmount.toFixed(2) : '');
  // Due day: use predicted pattern, or fall back to most recent date's day-of-month
  const dueDayVal = s.dueDay || s.mostRecentDayOrdinal || '';

  document.getElementById('modal-bill-title').textContent  = 'Add Bill';
  document.getElementById('bill-id').value                 = '';
  document.getElementById('bill-company').value            = s.description;
  document.getElementById('bill-service').value            = s.category || '';
  document.getElementById('bill-due-day').value            = dueDayVal;
  document.getElementById('bill-amount').value             = amountVal;
  document.getElementById('bill-frequency').value          = s.frequency || 'monthly';
  document.getElementById('bill-autopay').checked          = false;
  document.getElementById('bill-linked-account').value     = s.accountName || '';
  document.getElementById('bill-notes').value              = '';
  document.getElementById('bill-active').checked           = true;
  openModal('modal-bill');
}

// Called after bill form is successfully saved — removes the staged suggestion from the list
function confirmDismissActiveSuggestion() {
  if (!_activeSuggestion) return;
  const idx = _pendingSuggestions.findIndex(s => s.description === _activeSuggestion.description);
  if (idx !== -1) {
    _pendingSuggestions.splice(idx, 1);
    _dismissedDescs.add(_activeSuggestion.description);
    if (_currentSuggIdx >= _pendingSuggestions.length) _currentSuggIdx = 0;
    _renderCurrentSuggestion();
  }
  _activeSuggestion = null;
}

// Called when bill modal closes without saving (cancel/escape/click-outside)
function clearActiveSuggestion() {
  _activeSuggestion = null;
}

function dismissAllSuggestions() {
  _pendingSuggestions.forEach(s => _dismissedDescs.add(s.description));
  _pendingSuggestions = [];
  _currentSuggIdx = 0;
  document.getElementById('recurring-suggestions').classList.add('hidden');
}

function buildTxTable(txns, bills, compact) {
  const billNames = (bills || []).map(b => (b.company || '').toLowerCase());

  if (compact) {
    // Fixed columns for import preview — always same 4 columns
    const rows = txns.map(t => {
      const amtClass   = t.type === 'Credit' ? 'tx-amount-credit' : 'tx-amount-debit';
      const sign       = t.type === 'Credit' ? '+' : '-';
      const flagBadge  = t._flagged
        ? `<span class="badge badge-quarterly" title="${esc(t._flagReason)}">review</span>` : '';
      const recoBadge  = t._suggestedNewCategory
        ? '<span class="badge badge-annual" title="Recommended new category">new category</span>'
        : (t._categoryRecommendation ? `<span class="badge badge-autopay" title="Suggested from ${esc(t._recommendationSource || 'rules')}">suggested</span>` : '');
      const catText = t.category
        ? esc(t.category)
        : (t._categoryRecommendation ? esc(t._categoryRecommendation) : '<span class="text-muted">—</span>');
      return `<tr class="${t._flagged ? 'tx-flagged' : ''}">
        <td>${esc(t.postingDate)}</td>
        <td>${esc(t.description)} ${flagBadge}</td>
        <td>${catText} ${recoBadge}</td>
        <td class="${amtClass}">${sign}${fmt(t.amount)}</td>
      </tr>`;
    }).join('');
    return `<table>
      <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // Full mode — respect column visibility settings
  const s    = getSettings();
  const cols = TX_COLUMNS.filter(c => s[c.key] !== false);

  // Build category/subcategory/importance dropdown options
  const categoryOpts = ['<option value="">—</option>']
    .concat(_categoryDefs.map(c => `<option value="${esc(c.name)}"${c.name === '___SELECTED___' ? ' selected' : ''}>${esc(c.name)}</option>`))
    .concat(['<option value="__other__">+ Other...</option>'])
    .join('');

  const importanceOpts = ['<option value="">—</option>']
    .concat(IMPORTANCE_LEVELS.map(lvl => `<option value="${lvl}"${lvl === '___SELECTED___' ? ' selected' : ''}>${lvl}</option>`))
    .join('');

  const rows = txns.map(t => {
    const isRecurring = billNames.some(name => name && t.description.toLowerCase().includes(name));
    const amtClass    = t.type === 'Credit' ? 'tx-amount-credit' : 'tx-amount-debit';
    const sign        = t.type === 'Credit' ? '+' : '-';
    const recurBadge  = isRecurring ? '<span class="badge badge-recurring" title="Matches a known bill">recurring</span>' : '';
    const typeBadge   = t.type === 'Credit'
      ? '<span class="badge badge-credit">Credit</span>'
      : '<span class="badge badge-debit">Debit</span>';
    const acctCell    = t.accountName
      ? `<span class="account-chip">${esc(t.accountName)}</span>`
      : '<span class="text-muted">—</span>';

    const isHidden  = !!t.hidden;
    const rowClass  = isHidden ? 'tx-hidden' : (isRecurring ? 'tx-recurring' : '');
    const actionBtn = isHidden
      ? `<button class="btn btn-ghost btn-sm btn-unhide-tx" data-id="${t.id}">Unhide</button>`
      : `<button class="btn-icon btn-hide-tx" data-id="${t.id}" title="Hide this transaction">&#128065;</button>`;

    // Build subcategory dropdown options based on selected category
    const selectedCat     = t.category || '';
    const selectedCatDef  = _categoryDefs.find(c => c.name === selectedCat);
    const subcatOpts      = ['<option value="">—</option>']
      .concat((selectedCatDef?.subcategories || []).map(sub => 
        `<option value="${esc(sub)}"${sub === t.subcategory ? ' selected' : ''}>${esc(sub)}</option>`))
      .concat(['<option value="__other__">+ Other...</option>'])
      .join('');

    const categorySelect = `<select class="tx-inline-select tx-select-category" data-id="${t.id}">${categoryOpts.replace('___SELECTED___', selectedCat)}</select>`;
    const subcatSelect   = `<select class="tx-inline-select tx-select-subcategory" data-id="${t.id}" ${!selectedCat ? 'disabled' : ''}>${subcatOpts}</select>`;
    const importanceSelect = `<select class="tx-inline-select tx-select-importance" data-id="${t.id}">${importanceOpts.replace('___SELECTED___', t.importance || '')}</select>`;

    const cellMap = {
      col_date:        `<td>${esc(t.postingDate)}</td>`,
      col_description: `<td>${esc(t.description)} ${recurBadge}</td>`,
      col_category:    `<td>${categorySelect}</td>`,
      col_subcategory: `<td>${subcatSelect}</td>`,
      col_importance:  `<td>${importanceSelect}</td>`,
      col_account:     `<td>${acctCell}</td>`,
      col_type:        `<td>${typeBadge}</td>`,
      col_amount:      `<td class="${amtClass}">${sign}${fmt(t.amount)}</td>`,
      col_balance:     `<td class="text-muted">${t.balance !== undefined ? fmt(t.balance) : ''}</td>`,
    };

    return `<tr class="${rowClass}" data-id="${t.id}">
      ${cols.map(c => cellMap[c.key]).join('')}
      <td class="tx-actions">${actionBtn}</td>
    </tr>`;
  }).join('');

  const headers = [...cols.map(c => `<th>${c.label}</th>`), '<th></th>'].join('');

  return `<table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
