// Analisi dei prezzi: prezzo finito all'unità dall'ultima bolletta di ogni contratto, scomposizione dei costi
// e confronto con preventivi/contratti caricati. Funzioni pure (testabili con Node).
import { parseNumberIT, parseDateIT, extractSupplier } from './parser.js';

export const PRICED = ['luce', 'gas', 'acqua'];   // categorie con consumo e quindi un prezzo all'unità
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const day = (s) => (s ? new Date(`${s}T12:00:00`).getTime() : NaN);
const billDate = (b) => b.periodTo || b.issueDate || '';

/** Un contratto = stesso punto di fornitura (POD/PDR) oppure stessa categoria + immobile + fornitore. */
export const contractKey = (b) => (b.pointCode ? `${b.category}|${b.pointCode}` : `${b.category}|${b.assetId || ''}|${norm(b.supplier)}`);

/** Raggruppa le bollette con consumo in contratti; le bollette di ciascuno sono dalla più recente. */
export function groupContracts(bills) {
  const map = new Map();
  for (const b of bills) {
    if (!PRICED.includes(b.category) || b.amount == null || !(b.consumption > 0)) continue;
    const k = contractKey(b);
    if (!map.has(k)) map.set(k, { key: k, category: b.category, assetId: b.assetId || null, supplier: b.supplier || null, pointCode: b.pointCode || null, bills: [] });
    map.get(k).bills.push(b);
  }
  const list = [...map.values()];
  for (const c of list) {
    c.bills.sort((a, b) => billDate(b).localeCompare(billDate(a)));
    c.last = c.bills[0];
    c.assetId = c.last.assetId || c.assetId;
    c.supplier = c.last.supplier || c.supplier;
  }
  return list.sort((a, b) => billDate(b.last).localeCompare(billDate(a.last)));
}

/** Prezzo finito (tutto compreso) e scomposizione, dall'ultima bolletta. */
export function analyzeBill(b) {
  const units = b.consumption, total = b.amount;
  const finished = units > 0 && total != null ? total / units : null;
  const bd = b.breakdown || null;
  const parts = [];
  if (bd) {
    const defs = [['materia', 'Materia prima', '#f5b301'], ['trasporto', 'Trasporto e contatore', '#2f8fe0'], ['oneri', 'Oneri di sistema', '#8e5bd6'], ['imposte', 'Imposte e IVA', '#ef6c3c']];
    let found = 0;
    for (const [k, label, color] of defs) {
      if (bd[k] == null) continue;
      found += bd[k];
      parts.push({ key: k, label, color, amount: bd[k], perUnit: bd[k] / units, share: total ? bd[k] / total : null });
    }
    const rest = total - found;
    if (parts.length && rest > 0.05) parts.push({ key: 'altro', label: 'Altre voci', color: '#6b8497', amount: rest, perUnit: rest / units, share: rest / total });
  }
  const tax = bd?.imposte ?? null;
  return {
    finished, total, units, parts,
    exTax: tax != null && units ? (total - tax) / units : null,
    materiaPerUnit: bd?.materia != null && units ? bd.materia / units : null,
    hasBreakdown: parts.length > 0,
  };
}

/** Andamento del prezzo finito sulle ultime N bollette (dalla meno recente) + variazione sull'ultima. */
export function priceTrend(contract, n = 8) {
  const pts = contract.bills.slice(0, n).map((b) => ({ id: b.id, date: billDate(b), price: b.amount / b.consumption })).reverse();
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  return { pts, deltaPct: prev && prev.price ? ((last.price - prev.price) / prev.price) * 100 : null };
}

/** Consumo annuo del contratto: somma degli ultimi 12 mesi riportata a 365 giorni sui periodi coperti; null se non stimabile. */
export function annualUnits(contract) {
  const latest = day(billDate(contract.last));
  if (isNaN(latest)) return null;
  const rows = contract.bills.filter((b) => latest - day(billDate(b)) <= 365 * 864e5);
  const units = rows.reduce((s, b) => s + b.consumption, 0);
  let days = 0, ok = true;
  for (const b of rows) {
    const a = day(b.periodFrom), z = day(b.periodTo);
    if (isNaN(a) || isNaN(z) || z < a) { ok = false; break; }
    days += (z - a) / 864e5 + 1;
  }
  if (ok && days >= 28) return Math.round((units * 365) / Math.min(days, 365 * 1.2));
  return rows.length >= 6 ? Math.round(units) : null;
}

/**
 * Confronto a parità di consumo, sulla sola componente "materia prima" (trasporto, oneri e imposte non
 * dipendono dal fornitore). Attuale = voce materia della bolletta (quote fisse incluse); offerta = prezzo × consumo + quota fissa.
 */
export function compareOffer(contract, offer, units) {
  const a = analyzeBill(contract.last);
  const offerYear = offer.priceUnit != null && units ? units * offer.priceUnit + 12 * (offer.fixedMonthly || 0) : null;
  const currentYear = a.materiaPerUnit != null && units ? units * a.materiaPerUnit : null;
  return { offerYear, currentYear, delta: offerYear != null && currentYear != null ? offerYear - currentYear : null, comparable: currentYear != null };
}

// ---------- lettura di preventivi / contratti ----------
const NUMP = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2,5}|\\d+,\\d{2,5}|\\d+\\.\\d{2,5})';

function priceFor(text, unitRe) {
  const re = new RegExp(`${NUMP}\\s*(?:€|eur(?:o)?)?\\s*\\/\\s*(?:${unitRe})\\b|(?:€|eur(?:o)?)\\s*\\/\\s*(?:${unitRe})\\s*:?\\s*${NUMP}`, 'gi');
  const hits = [];
  for (const m of text.matchAll(re)) {
    const v = parseNumberIT(m[1] || m[2] || m[3] || m[4] || '');
    const before = text.slice(Math.max(0, m.index - 70), m.index).toLowerCase();
    if (v == null || v <= 0 || v > 5) continue;
    if (/trasport|oneri|accis|imposta|dispacci|perdite|contatore|bonus|sconto/.test(before)) continue;
    hits.push({ v, good: /prezzo|energia|materia|monorario|\bf1\b|fisso|indicizz/.test(before) });
  }
  return (hits.find((h) => h.good) || hits[0])?.v ?? null;
}

/** Estrae i dati di un'offerta dal testo; l'utente li conferma/corregge prima di salvarli. */
export function parseOffer(text) {
  const t = String(text || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  const nKwh = (t.match(/kwh/gi) || []).length, nSmc = (t.match(/\bsmc\b|metri cubi standard|\/\s*m3|\/\s*mc\b/gi) || []).length;
  const category = nSmc > nKwh ? 'gas' : nKwh ? 'luce' : null;
  const priceUnit = category === 'gas' ? priceFor(t, 'smc|m3|mc|m³') : category === 'luce' ? priceFor(t, 'kwh') : null;

  let fixedMonthly = null;
  const fx = t.match(/(?:quota fissa|corrispettivo (?:di )?commercializzazione|commercializzazione|\bpcv\b|costo fisso|canone)[^\n\d]{0,60}(?:€|eur(?:o)?)?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|eur(?:o)?)?\s*\/\s*(mese|anno)/i);
  if (fx) { const v = parseNumberIT(fx[1].replace('.', ',')); fixedMonthly = v == null ? null : fx[2].toLowerCase() === 'anno' ? Math.round((v / 12) * 100) / 100 : v; }

  const vu = t.match(/(?:valid[ao]|validità|scadenza|entro il|fino al)\s*(?:fino\s*)?(?:al|il)?\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[a-zA-Z]+\s+\d{4})/i);
  const nm = t.match(/offerta\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 +\-]{2,30}?)(?:\n|\.|,|;|$)/i);
  const kind = /indicizzat|variabile|\bpun\b|\bpsv\b|\bttf\b/i.test(t) ? 'variabile' : /prezzo fisso|bloccat|fisso per/i.test(t) ? 'fisso' : null;
  return { category, supplier: extractSupplier(t), name: nm ? nm[1].trim() : '', priceUnit, fixedMonthly, validUntil: vu ? parseDateIT(vu[1]) : null, kind };
}
