// ── Transactions Tab ──────────────────────────────────────────────────────────

let _pendingImport = [];  // rows waiting for user confirmation

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

    _pendingImport = newRows;

    // Show preview
    const stats = document.getElementById('import-stats');
    const dateRange = _getDateRange(rows);
    stats.innerHTML =
      `<strong>${rows.length}</strong> rows parsed · ` +
      `<span class="text-green">${newRows.length} new</span> · ` +
      `<span class="text-muted">${dupCount} already imported</span> · ` +
      `${dateRange}`;

    const wrap = document.getElementById('import-preview-table-wrap');
    wrap.innerHTML = buildTxTable(newRows.slice(0, 20), [], true);
    if (newRows.length > 20) {
      wrap.innerHTML += `<div class="text-muted" style="padding:8px 12px">…and ${newRows.length - 20} more</div>`;
    }

    document.getElementById('import-preview').classList.remove('hidden');
    document.getElementById('btn-import-confirm').disabled = newRows.length === 0;
    showToast('', 'info'); // clear loading toast
  } catch (err) {
    showToast('Parse error: ' + err.message, 'error');
  }
}

async function confirmImport(uid) {
  if (!_pendingImport.length) return;
  document.getElementById('btn-import-confirm').disabled = true;
  showToast('Importing…', 'info');
  try {
    const { imported, skipped } = await importTransactions(uid, _pendingImport);
    _pendingImport = [];
    document.getElementById('import-preview').classList.add('hidden');
    showToast(`Imported ${imported} transactions (${skipped} skipped)`, 'success');
    await renderTransactionsTab(uid);
    // Auto-scan for recurring bills after every import
    await renderRecurringSuggestions(uid);
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
    document.getElementById('btn-import-confirm').disabled = false;
  }
}

function cancelImport() {
  _pendingImport = [];
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

  // Populate month dropdown
  const months = await getTransactionMonths(uid);
  const monthSel = document.getElementById('tx-month');
  monthSel.innerHTML = '<option value="">All Months</option>' +
    months.map(m => `<option value="${m}"${m === defaultMonth ? ' selected' : ''}>${m}</option>`).join('');

  // Populate category dropdown
  const cats = await getTransactionCategories(uid);
  const catSel = document.getElementById('tx-category');
  catSel.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${c}">${esc(c)}</option>`).join('');

  await loadAndRenderTxList(uid);
}

async function loadAndRenderTxList(uid) {
  const yearMonth = document.getElementById('tx-month').value;
  const category  = document.getElementById('tx-category').value;

  const txns = await getTransactions(uid, { yearMonth, category });
  const bills = _billsCache || [];

  const listEl = document.getElementById('tx-list');

  if (!txns.length) {
    listEl.innerHTML = '<div class="empty-state">No transactions found. Import a CSV to get started.</div>';
    document.getElementById('tx-summary').classList.add('hidden');
    return;
  }

  // Summary
  let totalSpent = 0, totalIncome = 0;
  txns.forEach(t => {
    if (t.type === 'Debit')  totalSpent  += t.amount;
    if (t.type === 'Credit') totalIncome += t.amount;
  });
  document.getElementById('tx-total-spent').textContent  = fmt(totalSpent);
  document.getElementById('tx-total-income').textContent = fmt(totalIncome);
  document.getElementById('tx-count').textContent        = txns.length;
  document.getElementById('tx-summary').classList.remove('hidden');

  listEl.innerHTML = buildTxTable(txns, bills, false);
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
    if (!groups[key]) groups[key] = { display: t.description, txns: [], category: t.category };
    groups[key].txns.push(t);
  });

  // Build set of already-tracked bill names for deduplication
  const trackedNames = (existingBills || []).map(b => _normalizeDesc(b.company));

  const suggestions = [];

  Object.values(groups).forEach(({ display, txns, category }) => {
    if (txns.length < 2) return;

    const sorted = [...txns].sort((a, b) => _parseTxDate(a.postingDate) - _parseTxDate(b.postingDate));

    const amounts = sorted.map(t => t.amount);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountRange = Math.max(...amounts) - Math.min(...amounts);
    const amountConsistent = avgAmount > 0 && (amountRange / avgAmount) < 0.15;

    // Days between each occurrence
    const dates = sorted.map(t => _parseTxDate(t.postingDate));
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push((dates[i] - dates[i - 1]) / 86400000);
    }
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

    // Classify frequency
    let frequency = null;
    let freqConf  = 0;
    if (avgGap >= 25 && avgGap <= 35)    { frequency = 'monthly';   freqConf = 0.9; }
    else if (avgGap >= 85 && avgGap <= 100)  { frequency = 'quarterly'; freqConf = 0.75; }
    else if (avgGap >= 355 && avgGap <= 375) { frequency = 'annual';    freqConf = 0.75; }
    else if (amountConsistent && txns.length >= 2) { frequency = 'monthly'; freqConf = 0.4; }

    if (!frequency) return;

    const confidence = amountConsistent ? freqConf : freqConf * 0.6;
    if (confidence < 0.3) return;

    // Skip if already tracked as a bill
    const normDisplay = _normalizeDesc(display);
    const alreadyTracked = trackedNames.some(n => n && (normDisplay.includes(n) || n.includes(normDisplay)));
    if (alreadyTracked) return;

    suggestions.push({
      description: display,
      amount:      amountConsistent ? Math.round(avgAmount * 100) / 100 : null,
      frequency,
      confidence,
      occurrences: txns.length,
      lastDate:    sorted[sorted.length - 1].postingDate,
      category,
      dueDay:      _predictDueDay(sorted),
    });
  });

  return suggestions.sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);
}

// ─── Suggestions Panel ────────────────────────────────────────────────────────
let _dismissedSuggestions = new Set(); // descriptions dismissed this session

async function renderRecurringSuggestions(uid) {
  const panel = document.getElementById('recurring-suggestions');
  if (!panel) return;

  const [allTxns, bills] = await Promise.all([
    getAllTransactions(uid),
    getBills(uid),
  ]);

  const suggestions = detectRecurringCharges(allTxns, bills)
    .filter(s => !_dismissedSuggestions.has(s.description));

  if (!suggestions.length) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  document.getElementById('suggestions-list').innerHTML = suggestions.map(s => suggestionCardHTML(s)).join('');
}

function suggestionCardHTML(s) {
  const confPct   = Math.round(s.confidence * 100);
  const confColor = s.confidence >= 0.75 ? 'var(--green)' : s.confidence >= 0.5 ? 'var(--yellow)' : 'var(--text-muted)';
  const amtText   = s.amount != null ? fmt(s.amount) : 'variable';
  const freqLabel = s.frequency.charAt(0).toUpperCase() + s.frequency.slice(1);
  const dueMeta   = s.dueDay ? ` · due ~${esc(s.dueDay)}` : '';

  return `
    <div class="suggestion-card" data-desc="${esc(s.description)}">
      <div class="suggestion-info">
        <div class="suggestion-name">${esc(s.description)}</div>
        <div class="suggestion-meta">
          ${esc(s.category)} · ${freqLabel}${dueMeta} · seen ${s.occurrences}× · last ${esc(s.lastDate)}
        </div>
      </div>
      <div class="suggestion-amount">${amtText}</div>
      <div class="suggestion-conf" style="color:${confColor}" title="Detection confidence">${confPct}% match</div>
      <button class="btn btn-primary btn-sm btn-add-suggestion"
        data-desc="${esc(s.description)}"
        data-amount="${s.amount != null ? s.amount.toFixed(2) : ''}"
        data-frequency="${esc(s.frequency)}"
        data-category="${esc(s.category)}"
        data-dueday="${esc(s.dueDay || '')}">
        + Add as Bill
      </button>
      <button class="btn-icon btn-dismiss-suggestion" data-desc="${esc(s.description)}" title="Dismiss">✕</button>
    </div>`;
}

function openBillModalFromSuggestion(btn) {
  // Pre-fill bill modal from suggestion data
  document.getElementById('modal-bill-title').textContent = 'Add Bill';
  document.getElementById('bill-id').value              = '';
  document.getElementById('bill-company').value         = btn.dataset.desc;
  document.getElementById('bill-service').value         = btn.dataset.category || '';
  document.getElementById('bill-due-day').value         = btn.dataset.dueday || '';
  document.getElementById('bill-amount').value          = btn.dataset.amount || '';
  document.getElementById('bill-frequency').value       = btn.dataset.frequency || 'monthly';
  document.getElementById('bill-autopay').checked       = false;
  document.getElementById('bill-linked-account').value  = '';
  document.getElementById('bill-notes').value           = '';
  document.getElementById('bill-active').checked        = true;
  openModal('modal-bill');
}

function dismissSuggestion(desc) {
  _dismissedSuggestions.add(desc);
  const card = document.querySelector(`.suggestion-card[data-desc="${CSS.escape(desc)}"]`);
  if (card) card.remove();
  if (!document.querySelectorAll('.suggestion-card').length) {
    document.getElementById('recurring-suggestions').classList.add('hidden');
  }
}

function dismissAllSuggestions() {
  document.querySelectorAll('.suggestion-card').forEach(c => _dismissedSuggestions.add(c.dataset.desc));
  document.getElementById('recurring-suggestions').classList.add('hidden');
}

function buildTxTable(txns, bills, compact) {
  const billNames = (bills || []).map(b => (b.company || '').toLowerCase());

  const rows = txns.map(t => {
    const isRecurring = billNames.some(name => name && t.description.toLowerCase().includes(name));
    const amtClass = t.type === 'Credit' ? 'tx-amount-credit' : 'tx-amount-debit';
    const sign     = t.type === 'Credit' ? '+' : '-';
    const rowClass = isRecurring ? 'tx-recurring' : '';
    const recurBadge = isRecurring ? '<span class="badge badge-recurring" title="Matches a known bill">recurring</span>' : '';
    const typeBadge = t.type === 'Credit'
      ? '<span class="badge badge-credit">Credit</span>'
      : '<span class="badge badge-debit">Debit</span>';

    if (compact) {
      return `<tr class="${rowClass}">
        <td>${esc(t.postingDate)}</td>
        <td>${esc(t.description)} ${recurBadge}</td>
        <td>${esc(t.category)}</td>
        <td class="${amtClass}">${sign}${fmt(t.amount)}</td>
      </tr>`;
    }

    return `<tr class="${rowClass}">
      <td>${esc(t.postingDate)}</td>
      <td>${esc(t.description)} ${recurBadge}</td>
      <td>${esc(t.category)}</td>
      <td>${typeBadge}</td>
      <td class="${amtClass}">${sign}${fmt(t.amount)}</td>
      <td class="text-muted">${t.balance !== undefined ? fmt(t.balance) : ''}</td>
    </tr>`;
  }).join('');

  const headers = compact
    ? ['Date', 'Description', 'Category', 'Amount']
    : ['Date', 'Description', 'Category', 'Type', 'Amount', 'Balance'];

  return `<table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
