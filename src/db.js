import Dexie from 'dexie';

// Tutto l'archivio vive in IndexedDB sul dispositivo: nessun server.
export const db = new Dexie('billradar');
db.version(1).stores({
  bills: '++id, category, issueDate, messageId, [messageId+attachmentId], source',
  kv: 'key',
});

export async function getKV(key, fallback = null) {
  const row = await db.kv.get(key);
  return row ? row.value : fallback;
}
export const setKV = (key, value) => db.kv.put({ key, value });

export async function addBill(bill, pdfBlob = null) {
  const rec = { ...bill, pdf: pdfBlob || null, createdAt: Date.now() };
  return db.bills.add(rec);
}

export async function billExists(messageId, attachmentId) {
  return !!(await db.bills.where('[messageId+attachmentId]').equals([messageId, attachmentId]).first());
}

export const listBills = () => db.bills.orderBy('issueDate').reverse().toArray();
export const updateBill = (id, patch) => db.bills.update(id, patch);
export const deleteBill = (id) => db.bills.delete(id);

export async function exportAll() {
  const bills = await db.bills.toArray();
  const kv = await db.kv.toArray();
  return {
    app: 'BillRadar', version: 1, exportedAt: new Date().toISOString(),
    // i PDF non vengono inclusi nel JSON (solo i dati estratti)
    bills: bills.map(({ pdf, ...rest }) => rest),
    settings: kv.filter((r) => !r.key.startsWith('gmail.')),
  };
}

export async function importAll(json) {
  if (json?.app !== 'BillRadar') throw new Error('File non valido');
  for (const b of json.bills || []) {
    const { id, ...rest } = b;
    const dup = rest.messageId && rest.attachmentId
      ? await billExists(rest.messageId, rest.attachmentId) : false;
    if (!dup) await db.bills.add(rest);
  }
  for (const r of json.settings || []) await db.kv.put(r);
}

export async function wipeAll() {
  await db.bills.clear();
  await db.kv.clear();
}

export function billsToCSV(bills) {
  const head = ['data', 'categoria', 'fornitore', 'importo', 'consumo', 'unita', 'periodo_da', 'periodo_a', 'scadenza', 'numero', 'origine'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = bills.map((b) => [b.issueDate, b.category, b.supplier, b.amount, b.consumption, b.unit, b.periodFrom, b.periodTo, b.dueDate, b.invoiceNumber, b.source].map(esc).join(';'));
  return [head.join(';'), ...rows].join('\n');
}
