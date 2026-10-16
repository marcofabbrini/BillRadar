// Calcolo degli scontrini (funzioni pure, testabili con Node).

/** Numero scritto all'italiana ("1,50", "2.30") → numero; vuoto o non valido → null. */
export function toNum(v) {
  if (v == null) return null;
  const t = String(v).trim().replace(/\s/g, '').replace(/\./g, (m, i, s) => (s.includes(',') ? '' : '.')).replace(',', '.');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Totale di una riga: quantità (1 se vuota) × prezzo unitario. Prezzi negativi = sconti. */
export function lineTotal(l) {
  const price = toNum(l?.price);
  if (price == null) return 0;
  const qty = toNum(l?.qty);
  return round2((qty == null ? 1 : qty) * price);
}

/**
 * Totali dello scontrino. Con un totale scritto a mano vince quello (es. arrotondamenti, sconti
 * sul totale), e `diff` mostra la differenza rispetto alla somma delle righe.
 */
export function receiptTotals(items = [], manualTotal = null) {
  const lines = items.filter((l) => toNum(l?.price) != null);
  const sum = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const manual = toNum(manualTotal);
  const total = manual != null ? round2(manual) : sum;
  return { count: lines.length, sum, total, manual: manual != null, diff: manual != null && lines.length ? round2(manual - sum) : 0 };
}

/** Importo per sottocategoria: [{ name, total, count }] dal più alto; senza sottocategoria → "Senza sottocategoria". */
export function bySubcategory(bills) {
  const m = new Map();
  for (const b of bills) {
    const k = (b.subcategory || '').trim() || 'Senza sottocategoria';
    const e = m.get(k) || { name: k, total: 0, count: 0 };
    e.total = round2(e.total + (b.amount || 0)); e.count++; m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
