// Caricamento di PDF singoli o di archivi .zip: ogni PDF viene letto e catalogato come una bolletta arrivata da Gmail.
import { pdfToText } from './pdf.js';
import { parseBill } from './parser.js';
import { loadCategories } from './categories.js';
import { assignAsset } from './assetmatch.js';
import { loadAssets, assignmentFields } from './assets.js';
import { sha256 } from './dupes.js';
import { addBill, getKV, db } from './db.js';
import { getSetting } from './settings.js';
export { expandInputs } from './zipexpand.js';

/** Legge i File scelti dall'utente. */
export async function readFiles(fileList) {
  const items = [];
  for (const f of fileList) items.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), mtime: f.lastModified });
  return items;
}

/**
 * Cataloga i PDF. Un PDF identico (stessa impronta) a uno già presente, o ripetuto nel lotto, viene saltato.
 * hooks.onBill(id, bytes, record) come nella sincronizzazione (archivio Drive).
 */
export async function importPdfs(pdfs, { onProgress = () => {}, hooks = {} } = {}) {
  const stats = { added: 0, skipped: 0, errors: 0, review: 0, newItems: [], failed: [] };
  const allCats = await loadCategories();
  const allAssets = await loadAssets();
  const rules = await getKV('assetRules', {});
  const keepPdf = await getSetting('parse.keepPdf');
  const known = new Set();
  for (const b of await db.bills.toArray()) {
    if (b.pdfHash) known.add(b.pdfHash);
    else if (b.pdf) { try { b.pdfHash = await sha256(await b.pdf.arrayBuffer()); known.add(b.pdfHash); await db.bills.update(b.id, { pdfHash: b.pdfHash }); } catch { /* illeggibile */ } }
  }
  for (let i = 0; i < pdfs.length; i++) {
    const p = pdfs[i];
    onProgress(i + 1, pdfs.length, p.name);
    try {
      const hash = await sha256(p.bytes.slice().buffer);
      if (known.has(hash)) { stats.skipped++; continue; }
      const text = await pdfToText(p.bytes.slice());
      const parsed = parseBill(text, { subject: p.name, from: '', cats: allCats });
      const { scores, ...fields } = parsed;
      const day = new Date(p.mtime || Date.now()).toISOString().slice(0, 10);
      const record = {
        ...fields,
        issueDate: fields.issueDate || day,
        ...assignmentFields(assignAsset({ text, category: fields.category, supplier: fields.supplier, holder: fields.holder, supplyAddress: fields.supplyAddress }, allAssets, rules)),
        fileName: p.name, subject: p.name, from: '', source: 'file', analyzed: true, pdfHash: hash,
        needsReview: fields.needsReview || (fields.category === 'altro' && fields.amount == null),
      };
      const id = await addBill(record, keepPdf ? new Blob([p.bytes], { type: 'application/pdf' }) : null);
      known.add(hash);
      stats.added++; if (record.needsReview) stats.review++;
      stats.newItems.push({ id, category: record.category });
      if (hooks.onBill) await hooks.onBill(id, p.bytes, record);
    } catch (e) {
      console.error(e); stats.errors++; stats.failed.push(p.name);
    }
  }
  return stats;
}
