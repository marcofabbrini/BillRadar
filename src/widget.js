// Ponte verso il widget Android: l'app prepara un'istantanea dei dati (ultimi 12 mesi + nuove bollette
// degli ultimi 7 giorni) e la consegna al codice nativo, che la disegna sulla schermata Home.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { listBills, getKV } from './db.js';
import { cats } from './categories.js';
import { getSetting } from './settings.js';
import { MONTH_LABELS } from './stats.js';

const WidgetBridge = registerPlugin('WidgetBridge');
const DAY = 864e5;

export async function buildSnapshot(now = new Date()) {
  const bills = await listBills();
  // ultimi 12 mesi, il più recente a destra
  const keys = [], labels = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    labels.push(MONTH_LABELS[d.getMonth()]);
  }
  const series = [];
  for (const [id, c] of Object.entries(cats())) {
    if ((await getSetting(`cat.${id}`)) === false) continue;
    const values = keys.map((key) => bills
      .filter((b) => b.category === id && (b.issueDate || '').startsWith(key) && b.amount != null)
      .reduce((s, b) => s + b.amount, 0));
    if (values.some((v) => v > 0)) series.push({ id, label: c.label, color: c.color, income: c.kind === 'income', values: values.map((v) => Math.round(v * 100) / 100) });
  }
  // nuove bollette = archiviate nell'app negli ultimi 7 giorni
  const since = now.getTime() - 7 * DAY;
  const fresh = bills.filter((b) => (b.createdAt || 0) >= since);
  const by = {};
  fresh.forEach((b) => { by[b.category] = (by[b.category] || 0) + 1; });
  const text = Object.entries(by).map(([id, n]) => `${n} ${cats()[id]?.label || 'Altro'}`).join(', ');
  return { v: 1, updated: now.getTime(), labels, series, fresh: { count: fresh.length, text } };
}

let timer;
/** Aggiorna il widget (se l'app gira su Android). Raggruppa le chiamate ravvicinate. */
export function pushWidget() {
  if (!Capacitor.isNativePlatform()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try { await WidgetBridge.update({ json: JSON.stringify(await buildSnapshot()) }); }
    catch (e) { console.warn('widget non aggiornato', e); }
  }, 800);
}
