// ── Firestore CRUD wrapper ────────────────────────────────────────────────────

const db = firebase.firestore();

// ─── Path helpers ─────────────────────────────────────────────────────────────
const billsCol      = uid => db.collection('users').doc(uid).collection('bills');
const txCol         = uid => db.collection('users').doc(uid).collection('transactions');
const accountsCol   = uid => db.collection('users').doc(uid).collection('accounts');
const categoriesCol = uid => db.collection('users').doc(uid).collection('categories');
const categoryMappingsCol = uid => db.collection('users').doc(uid).collection('categoryMappings');

// ─── Accounts ─────────────────────────────────────────────────────────────────
async function getAccounts(uid) {
  const snap = await accountsCol(uid).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
}

async function saveAccount(uid, account) {
  const { id, ...data } = account;
  if (id) {
    await accountsCol(uid).doc(id).set(data, { merge: true });
    return id;
  } else {
    const ref = await accountsCol(uid).add(data);
    return ref.id;
  }
}

async function deleteAccount(uid, accountId) {
  await accountsCol(uid).doc(accountId).delete();
}

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

// ─── Transactions ─────────────────────────────────────────────────────────────
async function getTransactions(uid, { yearMonth, category } = {}) {
  let query = txCol(uid).orderBy('postingDate', 'desc');
  if (yearMonth) query = query.where('yearMonth', '==', yearMonth);
  if (category)  query = query.where('category', '==', category);
  const snap = await query.limit(5000).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getTransactionMonths(uid) {
  const snap = await txCol(uid).orderBy('postingDate', 'desc').limit(5000).get();
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
  const snap = await txCol(uid).get();
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
      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([k]) => !k.startsWith('_'))
      );
      batch.set(txCol(uid).doc(txId), cleanData);
    });
    await batch.commit();
    imported += Math.min(BATCH_SIZE, newRows.length - i);
  }
  return { imported, skipped: rows.length - newRows.length };
}

// Fetch all transactions (for charts aggregation)
async function getAllTransactions(uid) {
  const snap = await txCol(uid).orderBy('postingDate', 'desc').limit(10000).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Transaction deletion ─────────────────────────────────────────────────────
async function _batchDelete(docs) {
  const BATCH_SIZE = 400;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return docs.length;
}

async function deleteAllTransactions(uid) {
  const snap = await txCol(uid).get();
  return _batchDelete(snap.docs);
}

async function deleteTransactionsByAccount(uid, accountId) {
  const snap = await txCol(uid).where('accountId', '==', accountId).get();
  return _batchDelete(snap.docs);
}

async function setTransactionHidden(uid, txId, hidden) {
  await txCol(uid).doc(txId).set({ hidden }, { merge: true });
}

async function updateTransaction(uid, txId, fields) {
  await txCol(uid).doc(txId).set(fields, { merge: true });
}

// ─── Category Definitions ─────────────────────────────────────────────────────
const IMPORTANCE_LEVELS = ['Essential', 'Important', 'Optional', 'Low'];

async function getCategoryDefinitions(uid) {
  const snap = await categoriesCol(uid).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function saveCategoryDefinition(uid, category) {
  const { id, ...data } = category;
  if (id) {
    await categoriesCol(uid).doc(id).set(data, { merge: true });
    return id;
  }
  const ref = await categoriesCol(uid).add(data);
  return ref.id;
}

async function deleteCategoryDefinition(uid, categoryId) {
  await categoriesCol(uid).doc(categoryId).delete();
}

async function deleteAllCategoryDefinitions(uid) {
  const snap = await categoriesCol(uid).get();
  return _batchDelete(snap.docs);
}

// ─── Bank Category Mappings ───────────────────────────────────────────────────
async function getCategoryMappings(uid) {
  const snap = await categoryMappingsCol(uid).get();
  const mappings = {};
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.bankCategory && data.mappedCategory) {
      mappings[data.bankCategory] = data.mappedCategory;
    }
  });
  return mappings;
}

async function saveCategoryMapping(uid, bankCategory, mappedCategory) {
  // Use bankCategory as document ID for easy lookup
  const docId = String(bankCategory).toLowerCase().replace(/[^a-z0-9]/g, '_');
  await categoryMappingsCol(uid).doc(docId).set({
    bankCategory,
    mappedCategory,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function deleteCategoryMapping(uid, bankCategory) {
  const docId = String(bankCategory).toLowerCase().replace(/[^a-z0-9]/g, '_');
  await categoryMappingsCol(uid).doc(docId).delete();
}

// ─── Import Filters ───────────────────────────────────────────────────────────
const filtersCol = uid => db.collection('users').doc(uid).collection('importFilters');

async function getImportFilters(uid) {
  const snap = await filtersCol(uid).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function saveImportFilter(uid, filter) {
  const { id, ...data } = filter;
  if (id) {
    await filtersCol(uid).doc(id).set(data, { merge: true });
    return id;
  }
  const ref = await filtersCol(uid).add(data);
  return ref.id;
}

async function deleteImportFilter(uid, filterId) {
  await filtersCol(uid).doc(filterId).delete();
}
