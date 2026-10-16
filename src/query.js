// Costruisce la ricerca Gmail dai filtri dell'utente (mittenti + testi). Funzione pura: testabile con Node.

export const DEFAULT_SENDERS = ['noreply.enelenergia@enel.com', 'contotelefonico@fatturazione.windtre.it'];
export const GENERIC_TERMS = ['bolletta', 'fattura', '"tassa automobilistica"', 'GSE', 'acconto', 'bollo'];

const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map((s) => String(s || '').trim()).filter(Boolean))];
const isSender = (s) => /^[^\s"'()<>,;:]+$/.test(s) && (s.startsWith('@') || s.includes('@') || s.includes('.'));
const quote = (s) => `"${s.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
const group = (parts) => (parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0]);

/**
 * - mittenti: (from:a OR from:b)
 * - parole generiche (facoltative): (bolletta OR fattura …) — in alternativa ai mittenti
 * - testi: la mail deve contenere almeno uno dei testi (oggetto o corpo)
 * Se non è impostato nulla si ricade sulle parole generiche, per non scansionare ogni PDF della casella.
 */
export function buildGmailQuery({ senders = [], keywords = [], generic = false } = {}) {
  const from = clean(senders).filter(isSender).map((s) => `from:${s}`);
  const words = clean(keywords).map(quote).filter((q) => q.length > 2);
  const source = [];
  if (from.length) source.push(group(from));
  if (generic || (!from.length && !words.length)) source.push(`(${GENERIC_TERMS.join(' OR ')})`);

  const q = ['has:attachment', 'filename:pdf'];
  if (source.length) q.push(source.length > 1 ? `(${source.join(' OR ')})` : source[0]);
  if (words.length) q.push(group(words));
  return q.join(' ');
}

/** Indirizzi scartati perché non sembrano indirizzi validi (per avvisare l'utente). */
export const invalidSenders = (senders) => clean(senders).filter((s) => !isSender(s));
