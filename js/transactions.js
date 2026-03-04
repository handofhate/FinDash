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
