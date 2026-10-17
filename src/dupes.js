// Ricerca dei documenti duplicati (funzioni pure, testabili con Node).
// "Sicuro": stesso allegato email, stesso file (impronta del PDF), stesso file su Drive, oppure stesso
// numero documento + fornitore + importo. "Probabile": stessa categoria, data e importo.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const compatSupplier = (a, b) => { const x = norm(a.supplier), y = norm(b.supplier); return !x || !y || x.includes(y) || y.includes(x); };

const RULES = [
  { reason: 'stesso allegato email', strong: true, key: (b) => (b.messageId && b.attachmentId ? `${b.messageId}|${b.attachmentId}` : null) },
  { reason: 'stesso file PDF', strong: true, key: (b) => b.pdfHash || null },
  { reason: 'stesso file su Drive', strong: true, key: (b) => b.driveFileId || null },
  { reason: 'stesso numero, fornitore e importo', strong: true, key: (b) => (norm(b.invoiceNumber).length >= 3 && b.amount != null ? `${norm(b.invoiceNumber)}|${norm(b.supplier)}|${b.amount}` : null) },
  { reason: 'stessa categoria, data e importo', strong: false, key: (b) => (b.issueDate && b.amount > 0 ? `${b.category}|${b.issueDate}|${b.amount}` : null), pair: compatSupplier },
];

/** Punteggio per scegliere quale tenere: PDF presente, assegnazione confermata, pagata, già verificata. */
export function keepScore(b) {
  return (b.pdf || b.driveFileId ? 4 : 0) + (b.assetBy === 'manual' ? 3 : 0) + (b.assetId ? 2 : 0) + (b.paid ? 1 : 0) + (b.needsReview ? 0 : 1);
}

/** → [{ ids, bills, strong, reasons, keep }] con `keep` = id suggerito da tenere. */
export function findDuplicates(bills) {
  const parent = new Map(bills.map((b) => [b.id, b.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const edges = [];   // { a, b, reason, strong }
  for (const rule of RULES) {
    const buckets = new Map();
    for (const b of bills) { const k = rule.key(b); if (k) (buckets.get(k) || buckets.set(k, []).get(k)).push(b); }
    for (const list of buckets.values()) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        if (rule.pair && !rule.pair(list[i], list[j])) continue;
        union(list[i].id, list[j].id); edges.push({ a: list[i].id, b: list[j].id, reason: rule.reason, strong: rule.strong });
      }
    }
  }
  const groups = new Map();
  for (const b of bills) { const r = find(b.id); (groups.get(r) || groups.set(r, []).get(r)).push(b); }
  const out = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ids = new Set(members.map((m) => m.id));
    const mine = edges.filter((e) => ids.has(e.a));
    const best = [...members].sort((x, y) => keepScore(y) - keepScore(x) || x.id - y.id)[0];
    out.push({ ids: members.map((m) => m.id), bills: members, strong: mine.some((e) => e.strong), reasons: [...new Set(mine.map((e) => e.reason))], keep: best.id });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || b.bills.length - a.bills.length);
}

/** Impronta SHA-256 di un file (nel browser e in Node ≥ 19). */
export async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
