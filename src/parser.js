// Parser di bollette/fatture a partire dal testo estratto da un PDF.
// Funzioni pure: nessuna dipendenza dal browser, testabili con Node.

export const CATEGORIES = {
  luce: {
    label: 'Luce', icon: '⚡', unit: 'kWh', color: '#f5b301', kind: 'cost',
    keywords: ['energia elettrica', 'kwh', 'pod ', 'codice pod', 'fornitura luce', 'potenza impegnata', 'enel', 'edison energia', 'a2a energia', 'eni plenitude', 'sorgenia'],
  },
  gas: {
    label: 'Gas', icon: '🔥', unit: 'Smc', color: '#ef6c3c', kind: 'cost',
    keywords: ['gas naturale', 'smc', 'codice pdr', 'pdr ', 'fornitura gas', 'metano', 'coefficiente c'],
  },
  acqua: {
    label: 'Acqua', icon: '💧', unit: 'm³', color: '#2f8fe0', kind: 'cost',
    keywords: ['servizio idrico', 'acquedotto', 'fognatura', 'depurazione', 'metri cubi', 'consumo acqua', 'gruppo cap', 'mm spa', 'acea ato', 'hera acqua'],
  },
  internet: {
    label: 'Internet/Telefono', icon: '📶', unit: '', color: '#8e5bd6', kind: 'cost',
    keywords: ['fibra', 'internet', 'linea fissa', 'telefonia', 'canone mensile', 'tim ', 'vodafone', 'fastweb', 'windtre', 'wind tre', 'iliad', 'sky wifi', 'offerta mobile'],
  },
  bollo: {
    label: 'Bollo auto', icon: '🚗', unit: '', color: '#4a6572', kind: 'cost',
    keywords: ['tassa automobilistica', 'bollo auto', 'aci ', 'automobile club', 'pagopa bollo', 'targa'],
  },
  auto: {
    label: 'Manutenzione auto', icon: '🔧', unit: '', color: '#6d8b3a', kind: 'cost',
    keywords: ['officina', 'tagliando', 'revisione', 'pneumatici', 'gommista', 'carrozzeria', 'ricambi', 'manodopera', 'assicurazione auto', 'rca'],
  },
  gse: {
    label: 'Acconti GSE', icon: '☀️', unit: 'kWh', color: '#22a06b', kind: 'income',
    keywords: ['gse', 'gestore dei servizi energetici', 'ritiro dedicato', 'scambio sul posto', 'acconto', 'contributo in conto scambio', 'fotovoltaico', 'impianto fv', 'energia immessa'],
  },
};

const MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

const NUM = '(\\d{1,3}(?:\\.\\d{3})*,\\d{1,2}|\\d+,\\d{1,2}|\\d+)';

export function parseNumberIT(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, '');
  if (!t) return null;
  const v = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function toISO(d, m, y) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDateIT(s) {
  if (!s) return null;
  let m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) return toISO(m[1], m[2], m[3]);
  m = s.toLowerCase().match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/);
  if (m) return toISO(m[1], MONTHS[m[2]], m[3]);
  return null;
}

const norm = (t) => t.replace(/ /g, ' ').replace(/[ \t]+/g, ' ');

/** Sceglie la categoria con più corrispondenze; restituisce anche i punteggi. */
export function detectCategory(text, subject = '', cats = CATEGORIES) {
  const hay = ` ${(subject + ' ' + text).toLowerCase()} `;
  const scores = {};
  for (const [id, c] of Object.entries(cats)) {
    let s = 0;
    for (const kw of c.keywords) {
      const k = kw.toLowerCase();
      let idx = 0, n = 0;
      while ((idx = hay.indexOf(k, idx)) !== -1 && n < 5) { n++; idx += k.length; }
      s += n;
    }
    scores[id] = s;
  }
  // il GSE è un'entrata: se compare esplicitamente vince su "luce" generica
  if (scores.gse >= 2) scores.gse += 3;
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { category: best && best[1] > 0 ? best[0] : 'altro', scores };
}

export function extractAmount(text) {
  const t = norm(text);
  const labels = [
    'totale da pagare', 'importo da pagare', 'totale bolletta', 'totale fattura',
    'importo totale', 'totale documento', 'totale complessivo', 'da pagare', 'importo dovuto',
    'importo acconto', 'totale acconto', 'importo', 'totale',
  ];
  for (const lab of labels) {
    const re = new RegExp(`${lab}[^\\d\\n]{0,40}(?:€|eur(?:o)?)?\\s*${NUM}`, 'i');
    const m = t.match(re);
    if (m) { const v = parseNumberIT(m[1]); if (v != null && v > 0) return v; }
    const re2 = new RegExp(`${lab}[^\\n]{0,40}?${NUM}\\s*(?:€|eur)`, 'i');
    const m2 = t.match(re2);
    if (m2) { const v = parseNumberIT(m2[1]); if (v != null && v > 0) return v; }
  }
  // fallback: il valore massimo accanto a un simbolo euro
  let max = null;
  for (const m of t.matchAll(new RegExp(`(?:€|eur)\\s*${NUM}|${NUM}\\s*(?:€|eur)`, 'gi'))) {
    const v = parseNumberIT(m[1] || m[2]);
    if (v != null && (max == null || v > max)) max = v;
  }
  return max;
}

export function extractPeriod(text) {
  const t = norm(text);
  const D = '(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4})';
  let m = t.match(new RegExp(`(?:periodo|dal)[^\\d]{0,30}${D}\\s*(?:al|a|-|–)\\s*${D}`, 'i'));
  if (m) return { from: parseDateIT(m[1]), to: parseDateIT(m[2]) };
  m = t.match(new RegExp(`${D}\\s*(?:al|-|–)\\s*${D}`, 'i'));
  if (m) return { from: parseDateIT(m[1]), to: parseDateIT(m[2]) };
  return { from: null, to: null };
}

export function extractDue(text) {
  const t = norm(text);
  const m = t.match(/(?:scadenza|entro il|da pagare entro(?: il)?|pagabile entro(?: il)?)[^\d]{0,20}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[a-zA-Z]+\s+\d{4})/i);
  return m ? parseDateIT(m[1]) : null;
}

export function extractIssueDate(text) {
  const t = norm(text);
  const m = t.match(/(?:data (?:di )?(?:emissione|fattura|documento)|emessa il|emissione)[^\d]{0,20}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[a-zA-Z]+\s+\d{4})/i);
  return m ? parseDateIT(m[1]) : null;
}

export function extractInvoiceNumber(text) {
  const t = norm(text);
  const m = t.match(/(?:fattura|bolletta|documento)\s*(?:n\.?|n°|numero|nr\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{3,24})/i);
  return m ? m[1] : null;
}

export function extractConsumption(text, category, cats = CATEGORIES) {
  const t = norm(text);
  let unit = { luce: 'kwh', gas: 'smc', acqua: '(?:m³|m3|mc|metri cubi)', gse: 'kwh' }[category];
  if (!unit) {
    // categoria personalizzata con unità di misura propria (es. litri, kg)
    const u = cats[category]?.unit;
    if (!u) return null;
    unit = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const labelled = new RegExp(`(?:consumo|consumi|energia|quantit[aà]|fatturato|immessa|totale)[^\\d\\n]{0,40}${NUM}\\s*${unit}`, 'i');
  let m = t.match(labelled);
  if (!m) m = t.match(new RegExp(`${NUM}\\s*${unit}`, 'i'));
  return m ? parseNumberIT(m[1]) : null;
}

export function extractSupplier(text) {
  const t = norm(text);
  const known = ['Enel Energia', 'Edison', 'A2A', 'Eni Plenitude', 'Plenitude', 'Sorgenia', 'Hera', 'Iren', 'Acea', 'Gruppo CAP', 'MM Spa', 'TIM', 'Vodafone', 'Fastweb', 'WindTre', 'Iliad', 'GSE', 'ACI', 'Octopus', 'Illumia', 'Dolomiti Energia', 'E.ON', 'Axpo'];
  for (const k of known) {
    if (new RegExp(`\\b${k.replace(/\./g, '\\.')}\\b`, 'i').test(t)) return k;
  }
  const m = t.match(/^\s*([A-Z][A-Za-z0-9&.' ]{2,40}(?:S\.?p\.?A\.?|S\.?r\.?l\.?))/m);
  return m ? m[1].trim() : null;
}

/** Punto d'ingresso: dal testo del PDF a un record strutturato. */
export function parseBill(text, { subject = '', from = '', cats = CATEGORIES } = {}) {
  const clean = norm(text || '');
  const { category, scores } = detectCategory(clean, `${subject} ${from}`, cats);
  const amount = extractAmount(clean);
  const period = extractPeriod(clean);
  const due = extractDue(clean);
  const issue = extractIssueDate(clean) || period.to;
  const consumption = extractConsumption(clean, category, cats);
  const supplier = extractSupplier(`${from}\n${clean}`);
  const invoiceNumber = extractInvoiceNumber(clean);

  // affidabilità: quanti campi chiave sono stati trovati
  let conf = 0;
  if (category !== 'altro') conf += 0.35;
  if (amount != null) conf += 0.35;
  if (period.from || issue) conf += 0.15;
  if (supplier) conf += 0.1;
  if (invoiceNumber) conf += 0.05;

  return {
    category, amount, consumption,
    unit: cats[category]?.unit || '',
    periodFrom: period.from, periodTo: period.to,
    issueDate: issue, dueDate: due,
    supplier, invoiceNumber,
    confidence: Math.round(conf * 100) / 100,
    needsReview: conf < 0.7 || amount == null,
    scores,
  };
}
