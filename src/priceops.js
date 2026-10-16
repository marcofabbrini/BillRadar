// Operazioni sui dati per l'analisi prezzi (usano database e PDF salvati sul telefono).
import { db } from './db.js';
import { pdfToText } from './pdf.js';
import { extractBreakdown, extractPointCode } from './parser.js';

/** Rilegge il PDF di una bolletta e ne estrae scomposizione dei costi e codice POD/PDR. Restituisce true se ha aggiornato. */
export async function analyzeBill(b) {
  if (b.analyzed || !b.pdf) return false;
  try {
    const text = await pdfToText(await b.pdf.arrayBuffer());
    const patch = { breakdown: extractBreakdown(text, b.amount), pointCode: b.pointCode || extractPointCode(text), analyzed: true };
    await db.bills.update(b.id, patch);
    Object.assign(b, patch);
    return true;
  } catch { return false; }
}

/** Legge i PDF delle bollette ancora da analizzare (di norma solo l'ultima di ogni contratto). */
export async function analyzeMany(bills) {
  let n = 0;
  for (const b of bills) if (await analyzeBill(b)) n++;
  return n;
}
