// Scelta dell'immobile/vettura a cui riferire una bolletta, VERIFICANDO intestatario e indirizzo.
// Funzioni pure (testabili con Node).
//
// Regole, in ordine:
//  1) codici identificativi (POD, PDR, targa, n. contratto…) presenti nel PDF → quel bene;
//  2) indirizzo della fornitura registrato in un immobile e presente nel PDF:
//       - un solo immobile a quell'indirizzo: se l'intestatario coincide (o non è registrato) → assegnata;
//         se l'intestatario del documento è diverso → assegnazione MANUALE;
//       - più immobili allo stesso indirizzo (intestatari diversi) → assegnazione MANUALE;
//  3) il documento riporta un indirizzo che non corrisponde a nessun immobile registrato → MANUALE;
//  4) nessuna informazione contraddittoria: scelta imparata (beni senza indirizzo) o unico bene adatto.

export const KIND_BY_CATEGORY = { luce: 'home', gas: 'home', acqua: 'home', internet: 'home', gse: 'home', bollo: 'car', auto: 'car', tagliando: 'car', carburante: 'car', assicurazione: 'car', ricarica: 'car' };
/** Aggiorna l'ambito (immobile/vettura) di ogni categoria, comprese quelle personalizzate. */
export function setKinds(map) { for (const k of Object.keys(KIND_BY_CATEGORY)) delete KIND_BY_CATEGORY[k]; Object.assign(KIND_BY_CATEGORY, map); }

export const REASON_TEXT = {
  'shared-address': 'Più intestatari allo stesso indirizzo: assegna a mano.',
  'holder-mismatch': "L'intestatario del documento non coincide con quello registrato: assegna a mano.",
  'address-unknown': 'Indirizzo non presente tra i tuoi immobili: assegna a mano.',
  ambiguous: 'Più beni corrispondono ai codici del documento: assegna a mano.',
};

const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s) => strip(s).replace(/[^a-z0-9]+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ');
const compact = (s) => norm(s).replace(/[^a-z0-9]/g, '');

export const ruleKey = (category, supplier) => `${category || ''}|${norm(supplier).trim()}`;

/** Indirizzo in forma confrontabile: abbreviazioni espanse, senza "n.", "civico"… */
function addrTokens(s) {
  let t = strip(s)
    .replace(/\bv\.?\s?le\b/g, 'viale').replace(/\bp\.?\s?zza\b/g, 'piazza').replace(/\bc\.?\s?so\b/g, 'corso')
    .replace(/\bstr\.\s/g, 'strada ').replace(/\bv\.\s?(?=[a-z])/g, 'via ').replace(/\bloc\.\s?/g, 'localita ');
  return words(t).split(' ').filter((x) => x && !['n', 'nr', 'num', 'numero', 'civ', 'civico'].includes(x));
}

/** L'indirizzo (via + civico, e la città se indicata) compare nel testo? Il civico deve coincidere per intero. */
export function matchAddress(text, address) {
  const [street, ...rest] = String(address || '').split(',');
  const st = addrTokens(street);
  if (st.length < 2) return false;
  const hay = ` ${addrTokens(text).join(' ')} `;
  if (!hay.includes(` ${st.join(' ')} `)) return false;
  const city = addrTokens(rest.join(' ')).filter((x) => x.length >= 3 && !/^\d+$/.test(x));
  return city.every((c) => hay.includes(` ${c} `));
}

/** Tutte le parole del nome dell'intestatario compaiono nel testo (in qualsiasi ordine)? null = non registrato. */
export function matchHolder(text, holder) {
  const tokens = words(holder).split(' ').filter((x) => x.length >= 2);
  if (!tokens.length) return null;
  const hay = ` ${words(text)} `;
  return tokens.every((t) => hay.includes(` ${t} `));
}

export function assignAsset({ text = '', category, supplier, holder, supplyAddress } = {}, assets = [], rules = {}) {
  const out = (asset, reason, extra = {}) => ({ asset, reason, ...extra });
  // una categoria da immobile si assegna solo a immobili, una da vettura solo a vetture
  const wanted = KIND_BY_CATEGORY[category];
  if (wanted) assets = assets.filter((a) => a.kind === wanted);
  if (!assets.length) return out(null, 'none');
  const hayCompact = compact(text), hay = norm(text);

  // 1) codici identificativi
  const hits = assets.map((a) => {
    let n = 0;
    for (const kw of a.match || []) {
      const k = norm(kw).trim();
      if (k.length < 3) continue;
      if (hay.includes(k) || (compact(kw).length >= 5 && hayCompact.includes(compact(kw)))) n++;
    }
    return [a, n];
  }).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  if (hits.length) {
    if (hits.length > 1 && hits[0][1] === hits[1][1]) return out(null, 'ambiguous', { candidates: hits.map(([a]) => a.id) });
    return out(hits[0][0], 'identifier');
  }

  // 2) indirizzo + intestatario
  const withAddr = assets.filter((a) => a.address);
  const atAddress = withAddr.filter((a) => matchAddress(text, a.address));
  if (atAddress.length > 1) {
    const ok = atAddress.filter((a) => matchHolder(text, a.holder) === true);
    return out(null, 'shared-address', { candidates: atAddress.map((a) => a.id), suggested: ok.length === 1 ? ok[0].id : null });
  }
  if (atAddress.length === 1) {
    const a = atAddress[0], h = matchHolder(text, a.holder);
    if (h === false) return out(null, 'holder-mismatch', { candidates: [a.id] });
    return out(a, h === true ? 'verified' : 'address');
  }

  // 3) il documento indica un indirizzo, ma non è nessuno dei tuoi immobili
  if (withAddr.length && supplyAddress) return out(null, 'address-unknown', { candidates: withAddr.map((a) => a.id) });

  // 4) nessuna contraddizione: scelta imparata (solo beni senza indirizzo) o unico bene adatto
  const ruled = assets.find((a) => !a.address && a.id === rules[ruleKey(category, supplier)]);
  const kind = KIND_BY_CATEGORY[category];
  const sameKind = kind ? assets.filter((a) => a.kind === kind) : [];
  const cand = ruled || (sameKind.length === 1 ? sameKind[0] : assets.length === 1 ? assets[0] : null);
  if (!cand) return out(null, 'none');
  if (holder && cand.holder && matchHolder(holder, cand.holder) === false) {   // intestatario letto sul documento ≠ registrato
    return out(null, 'holder-mismatch', { candidates: [cand.id] });
  }
  return out(cand, ruled ? 'rule' : 'single');
}

export const pickAsset = (info, assets, rules) => assignAsset(info, assets, rules).asset;
