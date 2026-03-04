// ── Firestore CRUD wrapper ────────────────────────────────────────────────────

const db = firebase.firestore();

// ─── Path helpers ─────────────────────────────────────────────────────────────
const billsCol      = uid => db.collection('users').doc(uid).collection('bills');
const txCol         = uid => db.collection('users').doc(uid).collection('transactions');
const paidCol       = (uid, ym) => db.collection('users').doc(uid).collection('monthlyPaid').doc(ym).collection('bills');

// ─── Bills ────────────────────────────────────────────────────────────────────
async function getBills(uid) {
  const snap = await billsCol(uid).orderBy('dueDay').get().catch(() => billsCol(uid).get());
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function saveBill(uid, bill) {
  const { id, ...data } = bill;
  if (id) {
    await billsCol(uid).doc(id).set(data, { merge: true });
    return id;
  } else {
    const ref = await billsCol(uid).add(data);
    return ref.id;
  }
}

async function deleteBill(uid, billId) {
  await billsCol(uid).doc(billId).delete();
}

// ─── Monthly Paid status ──────────────────────────────────────────────────────
async function getMonthlyPaid(uid, yearMonth) {
  const snap = await paidCol(uid, yearMonth).get();
  const result = {};
  snap.docs.forEach(d => { result[d.id] = d.data(); });
  return result;
}

async function setMonthlyPaid(uid, yearMonth, billId, data) {
  await paidCol(uid, yearMonth).doc(billId).set(data, { merge: true });
}

async function clearMonthlyPaid(uid, yearMonth, billId) {
  await paidCol(uid, yearMonth).doc(billId).delete();
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function getTransactions(uid, { yearMonth, category } = {}) {
  let query = txCol(uid).orderBy('postingDate', 'desc');
  if (yearMonth) query = query.where('yearMonth', '==', yearMonth);
  if (category)  query = query.where('category', '==', category);
  const snap = await query.limit(500).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getTransactionMonths(uid) {
  // Returns sorted list of distinct YYYY-MM strings
  const snap = await txCol(uid).orderBy('postingDate', 'desc').limit(500).get();
  const months = new Set();
  snap.docs.forEach(d => {
    const ym = d.data().yearMonth;
    if (ym) months.add(ym);
  });
  return [...months].sort().reverse();
}

async function getTransactionCategories(uid) {
  const snap = await txCol(uid).get();
  const cats = new Set();
  snap.docs.forEach(d => { if (d.data().category) cats.add(d.data().category); });
  return [...cats].sort();
}

// Returns all imported Transaction IDs for deduplication
async function getImportedTxIds(uid) {
  const snap = await txCol(uid).select().get(); // only fetch doc IDs
  return new Set(snap.docs.map(d => d.id));
}

// Batch-import an array of transaction objects; skips existing IDs
async function importTransactions(uid, rows) {
  const existing = await getImportedTxIds(uid);
  const newRows = rows.filter(r => !existing.has(r.txId));

  // Firestore batch limit = 500 writes
  const BATCH_SIZE = 400;
  let imported = 0;
  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = db.batch();
    newRows.slice(i, i + BATCH_SIZE).forEach(r => {
      const { txId, ...data } = r;
      batch.set(txCol(uid).doc(txId), data);
    });
    await batch.commit();
    imported += Math.min(BATCH_SIZE, newRows.length - i);
  }
  return { imported, skipped: rows.length - newRows.length };
}

// Fetch all transactions (for charts aggregation)
async function getAllTransactions(uid) {
  const snap = await txCol(uid).orderBy('postingDate', 'desc').limit(2000).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
