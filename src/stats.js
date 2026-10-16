import { cats } from './categories.js';

export const eur = (v) => (v == null ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v));
export const num = (v, d = 0) => (v == null ? '—' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: d }).format(v));
export const MONTH_LABELS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const yearOf = (b) => Number((b.issueDate || '').slice(0, 4));
const monthOf = (b) => Number((b.issueDate || '').slice(5, 7)) - 1;

export function years(bills) {
  const ys = [...new Set(bills.map(yearOf).filter(Boolean))].sort((a, b) => b - a);
  return ys.length ? ys : [new Date().getFullYear()];
}

/** Totali mensili per categoria in un anno: { luce: [12 valori], ... } */
export function monthlyByCategory(bills, year) {
  const out = {};
  for (const id of [...Object.keys(cats()), 'altro']) out[id] = Array(12).fill(0);
  for (const b of bills) {
    if (yearOf(b) !== year || !out[b.category] || b.amount == null) continue;
    out[b.category][monthOf(b)] += b.amount;
  }
  return out;
}

export function totals(bills, year) {
  const t = { spese: 0, entrate: 0, perCategoria: {} };
  for (const b of bills) {
    if (yearOf(b) !== year || b.amount == null) continue;
    const c = cats()[b.category] || { kind: 'cost' };   // "altro" conta come spesa
    t.perCategoria[b.category] = (t.perCategoria[b.category] || 0) + b.amount;
    if (c.kind === 'income') t.entrate += b.amount; else t.spese += b.amount;
  }
  t.saldo = t.entrate - t.spese;
  return t;
}

/** Consumo e prezzo medio (€/unità) per una categoria con unità di misura. */
export function consumption(bills, category, year) {
  const rows = bills.filter((b) => b.category === category && yearOf(b) === year && b.consumption != null && b.amount != null);
  const qty = rows.reduce((s, b) => s + b.consumption, 0);
  const cost = rows.reduce((s, b) => s + b.amount, 0);
  const monthly = Array(12).fill(0);
  rows.forEach((b) => { monthly[monthOf(b)] += b.consumption; });
  return { qty, cost, avgPrice: qty ? cost / qty : null, monthly, count: rows.length };
}

export function yoy(bills, year) {
  const cur = totals(bills, year), prev = totals(bills, year - 1);
  const pct = prev.spese ? ((cur.spese - prev.spese) / prev.spese) * 100 : null;
  return { cur: cur.spese, prev: prev.spese, pct };
}

export function upcoming(bills, days = 30) {
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  return bills
    .filter((b) => b.dueDate && b.dueDate >= today && b.dueDate <= limit && !b.paid && cats()[b.category]?.kind !== 'income')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
