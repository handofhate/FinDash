// ── Local AI Categorizer (Transformers.js) ───────────────────────────────────

window.LocalAI = (() => {
  let _classifier = null;
  let _loadingPromise = null;
  let _state = 'idle';
  let _lastError = '';

  async function _loadClassifier() {
    if (_classifier) return _classifier;
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = (async () => {
      _state = 'loading';
      _lastError = '';
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      // DistilBERT NLI is a compromise between quality and model size for browser use.
      _classifier = await pipeline('zero-shot-classification', 'Xenova/distilbert-base-uncased-mnli');
      _state = 'ready';
      return _classifier;
    })();

    try {
      return await _loadingPromise;
    } catch (err) {
      _state = 'error';
      _lastError = err?.message || 'Model failed to load';
      throw err;
    } finally {
      _loadingPromise = null;
    }
  }

  async function suggestRows(rows, categoryDefs, options = {}) {
    const labels = (categoryDefs || []).map(c => String(c.name || '').trim()).filter(Boolean);
    if (!rows?.length || labels.length < 2) return [];

    const threshold = Number(options.threshold ?? 0.5);
    const maxRows = Number(options.maxRows ?? 120);
    const selectedRows = rows.slice(0, Math.max(1, maxRows));

    let classify;
    try {
      classify = await _loadClassifier();
    } catch (err) {
      return [];
    }

    const results = [];
    for (const row of selectedRows) {
      const text = String(row.description || '').trim();
      if (!text) continue;

      try {
        const out = await classify(text, labels, { multi_label: false });
        const label = Array.isArray(out?.labels) ? out.labels[0] : null;
        const score = Array.isArray(out?.scores) ? Number(out.scores[0]) : 0;
        if (!label || score < threshold) continue;

        results.push({
          txId: row.txId,
          category: label,
          score,
        });
      } catch {
        // Ignore per-row model inference errors.
      }
    }

    return results;
  }

  return {
    suggestRows,
    getStatus: () => ({ state: _state, error: _lastError }),
  };
})();
