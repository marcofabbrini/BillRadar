// Ricerca dei documenti duplicati (funzioni pure, testabili con Node).
//
// Ordine dei criteri:
//  1) stesso file in assoluto (stesso allegato email, stessa impronta del PDF, stesso file su Drive) → sicuro;
//  2) stessa categoria e stesso PERIODO DI FATTURAZIONE (o, se manca, stessa DATA del documento);
//  3) poi si confrontano gli altri elementi: importo, fornitore, numero documento, immobile/vettura.
//     Periodo + importo + fornitore uguali → sicuro; stesso periodo ma importo diverso, o stessa data e importo → probabile.
//  Sono esclusi: fornitori diversi, numeri documento diversi, beni diversi, periodi diversi.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const compatSupplier = (a, b) => { const x = norm(a.supplier), y = norm(b.supplier); return !x || !y || x.includes(y) || y.includes(x); };
const hasPeriod = (b) => !!(b.periodFrom && b.periodTo);
const sameAmount = (a, b) => a.amount != null && b.amount != null && Math.abs(a.amount - b.amount) < 0.005;

/** Identificativo stabile di un documento (resta valido dopo un ripristino da backup, a differenza dell'id locale). */
export const billUid = (b) => (b.createdAt ? `c${b.createdAt}` : `${b.category}|${b.issueDate}|${b.amount}|${norm(b.supplier)}|${norm(b.invoiceNumber)}`);
export const pairKey = (a, b) => [billUid(a), billUid(b)].sort().join('~');

const IDENTITY = [
  { reason: 'stesso allegato email', key: (b) => (b.messageId && b.attachmentId ? `${b.messageId}|${b.attachmentId}` : null) },
  { reason: 'stesso file PDF', key: (b) => b.pdfHash || null },
  { reason: 'stesso file su Drive', key: (b) => b.driveFileId || null },
];

/** Punteggio per scegliere quale tenere: PDF presente, assegnazione confermata, pagata, già verificata. */
export function keepScore(b) {
  return (b.pdf || b.driveFileId ? 4 : 0) + (b.assetBy === 'manual' ? 3 : 0) + (b.assetId ? 2 : 0) + (b.paid ? 1 : 0) + (b.needsReview ? 0 : 1);
}

/** Valuta una coppia: null se non sono duplicati, altrimenti { strong, reason }. */
export function classifyPair(a, b) {
  if (a.category !== b.category) return null;
  if (a.assetId && b.assetId && a.assetId !== b.assetId) return null;
  const ia = norm(a.invoiceNumber), ib = norm(b.invoiceNumber);
  const invBoth = ia.length >= 3 && ib.length >= 3;
  if (invBoth && ia !== ib) return null;
  if (!compatSupplier(a, b)) return null;
  const amtEq = sameAmount(a, b), amtBoth = a.amount != null && b.amount != null;
  if (invBoth && amtEq) return { strong: true, reason: 'stesso numero, fornitore e importo' };
  if (hasPeriod(a) && hasPeriod(b)) {
    if (a.periodFrom !== b.periodFrom || a.periodTo !== b.periodTo) return null;
    if (amtEq) return { strong: true, reason: 'stesso periodo di fatturazione, fornitore e importo' };
    return { strong: false, reason: amtBoth ? 'stesso periodo e fornitore, importo diverso' : 'stesso periodo e fornitore' };
  }
  if (a.issueDate && a.issueDate === b.issueDate && amtEq && a.amount > 0) return { strong: false, reason: 'stessa data, categoria e importo' };
  return null;
}

/**
 * → [{ ids, bills, strong, reasons, keepIds, presetIds }]
 * `presetIds`: da eliminare di default (solo dove i criteri sono sicuri); `keepIds`: quelli consigliati da tenere.
 * `options.ignore`: insieme di pairKey() che l'utente ha confermato "non è un duplicato".
 */
export function findDuplicates(bills, { ignore = new Set() } = {}) {
  const byId = new Map(bills.map((b) => [b.id, b]));
  const cand = new Map();   // "a-b" → { a, b, identity }
  const add = (x, y, identity = null) => {
    const [a, b] = x.id < y.id ? [x, y] : [y, x];
    const k = `${a.id}-${b.id}`;
    if (!cand.has(k) || identity) cand.set(k, { a, b, identity: identity || cand.get(k)?.identity || null });
  };
  const bucketPairs = (keyFn, identity = null) => {
    const m = new Map();
    for (const b of bills) { const k = keyFn(b); if (k) (m.get(k) || m.set(k, []).get(k)).push(b); }
    for (const l of m.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) add(l[i], l[j], identity);
  };
  for (const r of IDENTITY) bucketPairs(r.key, r.reason);
  bucketPairs((b) => (hasPeriod(b) ? `${b.category}|P|${b.periodFrom}|${b.periodTo}` : null));
  bucketPairs((b) => (b.issueDate ? `${b.category}|D|${b.issueDate}` : null));
  bucketPairs((b) => (norm(b.invoiceNumber).length >= 3 && b.amount != null ? `${b.category}|N|${norm(b.invoiceNumber)}|${b.amount}` : null));

  const edges = [];
  for (const { a, b, identity } of cand.values()) {
    if (ignore.has(pairKey(a, b))) continue;
    const r = identity ? { strong: true, reason: identity } : classifyPair(a, b);
    if (r) edges.push({ a: a.id, b: b.id, ...r });
  }

  const mk = () => { const p = new Map(bills.map((b) => [b.id, b.id])); const f = (x) => { while (p.get(x) !== x) { p.set(x, p.get(p.get(x))); x = p.get(x); } return x; }; return { f, u: (a, b) => { const ra = f(a), rb = f(b); if (ra !== rb) p.set(rb, ra); } }; };
  const any = mk(), strong = mk();
  for (const e of edges) { any.u(e.a, e.b); if (e.strong) strong.u(e.a, e.b); }

  const groups = new Map();
  for (const b of bills) { const r = any.f(b.id); (groups.get(r) || groups.set(r, []).get(r)).push(b); }
  const best = (l) => [...l].sort((x, y) => keepScore(y) - keepScore(x) || x.id - y.id)[0];
  const out = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ids = new Set(members.map((m) => m.id));
    const mine = edges.filter((e) => ids.has(e.a));
    // dentro ogni nucleo di duplicati sicuri si tiene il migliore e si propone l'eliminazione degli altri
    const comps = new Map();
    for (const m of members) { const r = strong.f(m.id); (comps.get(r) || comps.set(r, []).get(r)).push(m); }
    const keepIds = [], presetIds = [];
    for (const c of comps.values()) {
      if (c.length < 2) continue;
      const k = best(c); keepIds.push(k.id);
      c.forEach((m) => { if (m.id !== k.id) presetIds.push(m.id); });
    }
    if (!keepIds.length) keepIds.push(best(members).id);
    out.push({ ids: members.map((m) => m.id), bills: members, strong: presetIds.length > 0, reasons: [...new Set(mine.map((e) => e.reason))], keepIds, presetIds });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || b.bills.length - a.bills.length);
}

/** Impronta SHA-256 di un file (nel browser e in Node ≥ 19). */
export async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
