// Scelta automatica dell'immobile/vettura a cui riferire una bolletta. Funzione pura (testabile con Node).
//
// Ordine: 1) parole di riconoscimento dell'immobile/vettura presenti nel PDF (indirizzo, targa, POD/PDR…)
//         2) regola imparata (stessa categoria + stesso fornitore → stesso bene dell'ultima volta)
//         3) un solo bene del tipo adatto (le utenze → immobile, bollo/manutenzione → vettura)
//         4) altrimenti nessuno: la bolletta resta "da assegnare"

export const KIND_BY_CATEGORY = { luce: 'home', gas: 'home', acqua: 'home', internet: 'home', gse: 'home', bollo: 'car', auto: 'car' };

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ');
const compact = (s) => norm(s).replace(/[^a-z0-9]/g, '');

export const ruleKey = (category, supplier) => `${category || ''}|${norm(supplier).trim()}`;

export function pickAsset({ text = '', category, supplier } = {}, assets = [], rules = {}) {
  if (!assets.length) return null;
  const hay = norm(text), hayCompact = compact(text);

  // 1) parole di riconoscimento (la targa/codice si trova anche scritta con spazi o trattini)
  let best = null, bestHits = 0;
  for (const a of assets) {
    let hits = 0;
    for (const kw of a.match || []) {
      const k = norm(kw).trim();
      if (k.length < 3) continue;
      if (hay.includes(k) || (compact(kw).length >= 5 && hayCompact.includes(compact(kw)))) hits++;
    }
    if (hits > bestHits) { best = a; bestHits = hits; }
  }
  if (best) return best;

  // 2) regola imparata
  const ruled = assets.find((a) => a.id === rules[ruleKey(category, supplier)]);
  if (ruled) return ruled;

  // 3) un solo candidato
  const kind = KIND_BY_CATEGORY[category];
  const sameKind = kind ? assets.filter((a) => a.kind === kind) : [];
  if (sameKind.length === 1) return sameKind[0];
  if (assets.length === 1) return assets[0];
  return null;
}
