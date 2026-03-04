// ── Charts Tab ────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6',
  '#a855f7','#ec4899','#14b8a6','#f97316','#84cc16',
  '#06b6d4','#e11d48','#8b5cf6','#10b981',
];

let _chartInstances = {};
let _drillMonth = null;

function destroyChart(id) {
  if (_chartInstances[id]) {
    _chartInstances[id].destroy();
    delete _chartInstances[id];
  }
}

async function renderChartsTab(uid) {
  const monthCount = parseInt(document.getElementById('charts-months').value, 10) || 6;
  const allTxns    = await getAllTransactions(uid);

  if (!allTxns.length) {
    document.getElementById('charts-empty').classList.remove('hidden');
    document.getElementById('charts-grid') && (document.querySelector('.charts-grid').style.display = 'none');
    return;
  }

  document.getElementById('charts-empty').classList.add('hidden');

  // Build month list (last N months)
  const months = getLastNMonths(monthCount);

  // Aggregate data
  const { byMonth, byCategory, incomeByMonth, expenseByMonth } = aggregateTxns(allTxns, months);

  // Populate drill-month selector
  const drillSel = document.getElementById('charts-drill-month');
  drillSel.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');
  if (!_drillMonth || !months.includes(_drillMonth)) _drillMonth = months[0];
  drillSel.value = _drillMonth;
  document.getElementById('drill-label').classList.remove('hidden');
  drillSel.classList.remove('hidden');

  renderIncomeExpenseChart(months, incomeByMonth, expenseByMonth);
  renderCategoryBarChart(months, byMonth, byCategory);
  renderDonutChart(byMonth[_drillMonth] || {}, _drillMonth);
  renderTopMerchants(allTxns, months);
}

// ─── Data helpers ─────────────────────────────────────────────────────────────
function getLastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function aggregateTxns(txns, months) {
  // byMonth[YYYY-MM][category] = total
  const byMonth = {};
  const byCategory = new Set();
  const incomeByMonth  = {};
  const expenseByMonth = {};

  months.forEach(m => {
    byMonth[m] = {};
    incomeByMonth[m]  = 0;
    expenseByMonth[m] = 0;
  });

  txns.forEach(t => {
    if (!months.includes(t.yearMonth)) return;
    const m   = t.yearMonth;
    const cat = t.category || 'Uncategorized';
    byCategory.add(cat);

    if (t.type === 'Debit') {
      byMonth[m][cat] = (byMonth[m][cat] || 0) + t.amount;
      expenseByMonth[m] += t.amount;
    } else {
      incomeByMonth[m] += t.amount;
    }
  });

  return { byMonth, byCategory: [...byCategory].sort(), incomeByMonth, expenseByMonth };
}

// ─── Chart renderers ──────────────────────────────────────────────────────────
function renderIncomeExpenseChart(months, incomeByMonth, expenseByMonth) {
  destroyChart('income-expense');
  const ctx = document.getElementById('chart-income-expense').getContext('2d');
  _chartInstances['income-expense'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Income',
          data: months.map(m => incomeByMonth[m] || 0),
          backgroundColor: 'rgba(34,197,94,0.7)',
          borderColor: '#22c55e',
          borderWidth: 1,
        },
        {
          label: 'Expenses',
          data: months.map(m => expenseByMonth[m] || 0),
          backgroundColor: 'rgba(239,68,68,0.7)',
          borderColor: '#ef4444',
          borderWidth: 1,
        },
      ],
    },
    options: chartOptions('$'),
  });
}

function renderCategoryBarChart(months, byMonth, categories) {
  destroyChart('category-bar');
  const ctx = document.getElementById('chart-category-bar').getContext('2d');
  const datasets = categories.map((cat, i) => ({
    label: cat,
    data: months.map(m => byMonth[m][cat] || 0),
    backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + 'cc',
    borderColor:     CHART_COLORS[i % CHART_COLORS.length],
    borderWidth: 1,
  }));

  _chartInstances['category-bar'] = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets },
    options: {
      ...chartOptions('$'),
      scales: {
        x: { stacked: true, ...darkScale() },
        y: { stacked: true, ...darkScale(), ticks: { callback: v => '$' + v.toLocaleString() } },
      },
      onClick: (e, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        _drillMonth = months[idx];
        document.getElementById('charts-drill-month').value = _drillMonth;
        // Rebuild donut for clicked month
        const cats = {};
        Object.entries(byMonth[_drillMonth] || {}).forEach(([c, v]) => { cats[c] = v; });
        renderDonutChart(cats, _drillMonth);
      },
    },
  });
}

function renderDonutChart(catData, monthLabel) {
  destroyChart('donut');
  document.getElementById('chart-donut-title').textContent = `Category Breakdown — ${monthLabel || ''}`;
  const ctx = document.getElementById('chart-donut').getContext('2d');
  const sorted = Object.entries(catData).sort((a, b) => b[1] - a[1]);

  _chartInstances['donut'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([c]) => c),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + 'cc'),
        borderColor:     sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
        borderWidth: 1,
      }],
    },
    options: {
      plugins: {
        legend: { labels: { color: '#e2e4f0', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: $${ctx.raw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          },
        },
      },
    },
  });
}

function renderTopMerchants(txns, months) {
  const spend = {};
  txns.forEach(t => {
    if (!months.includes(t.yearMonth)) return;
    if (t.type !== 'Debit') return;
    spend[t.description] = (spend[t.description] || 0) + t.amount;
  });

  const top = Object.entries(spend).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = top[0]?.[1] || 1;
  const el  = document.getElementById('top-merchants-list');

  el.innerHTML = top.map(([name, amt]) => `
    <div class="merchant-item">
      <span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(name)}">${esc(name)}</span>
      <div class="merchant-bar-wrap"><div class="merchant-bar" style="width:${(amt/max*100).toFixed(1)}%"></div></div>
      <span class="merchant-amount">-${fmt(amt)}</span>
    </div>`).join('');
}

// ─── Chart.js shared options ──────────────────────────────────────────────────
function darkScale() {
  return {
    grid:  { color: '#2a2d3e' },
    ticks: { color: '#7b7f96' },
  };
}

function chartOptions(prefix = '') {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { labels: { color: '#e2e4f0', font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${prefix}${ctx.raw.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      x: darkScale(),
      y: { ...darkScale(), ticks: { callback: v => prefix + v.toLocaleString() } },
    },
  };
}
