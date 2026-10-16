// Categorie = quelle integrate (parser.js) + quelle create dall'utente (salvate in locale).
import { CATEGORIES as BUILTIN } from './parser.js';
import { getKV, setKV, db } from './db.js';
import { setKinds } from './assetmatch.js';

let ALL = { ...BUILTIN };
export const SCOPES = ['home', 'car', 'other', 'exp'];   // immobili, vetture, altri beni, spese personali (senza bene)
export const SCOPE_LABEL = { home: 'Immobili', car: 'Vetture', other: 'Altro (altri beni)', exp: 'Spese' };
export const SCOPE_ICON = { home: '🏠', car: '🚗', other: '📦', exp: '🛒' };
/** Le bollette di immobili e vetture richiedono il tag; le spese personali no. */
export const needsAsset = (b) => cats()[b?.category]?.scope !== 'exp';

/** Elenco corrente (sincrono, aggiornato da loadCategories). */
export const cats = () => ALL;

export async function loadCategories() {
  const custom = await getKV('customCategories', []);
  ALL = { ...BUILTIN };
  for (const c of custom) {
    ALL[c.id] = {
      label: c.label, icon: c.icon || '📌', color: c.color || '#9aa7b2',
      unit: c.unit || '', kind: c.kind === 'income' ? 'income' : 'cost', scope: SCOPES.includes(c.scope) ? c.scope : 'home',
      keywords: c.keywords || [], custom: true,
    };
  }
  await loadSubcats();
  setKinds(Object.fromEntries(Object.entries(ALL).map(([k, c]) => [k, c.scope || 'home'])));
  return ALL;
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'cat';

export async function addCategory({ label, icon, color, kind, unit, keywords, scope }) {
  label = (label || '').trim();
  if (!label) throw new Error('Inserisci un nome per la categoria');
  const exists = Object.values(ALL).some((c) => c.label.toLowerCase() === label.toLowerCase());
  if (exists) throw new Error('Esiste già una categoria con questo nome');
  const list = await getKV('customCategories', []);
  const id = `c_${slug(label)}_${Math.random().toString(36).slice(2, 6)}`;
  list.push({
    id, label, icon: (icon || '').trim() || '📌', color: color || '#9aa7b2',
    kind: kind === 'income' ? 'income' : 'cost', scope: SCOPES.includes(scope) ? scope : 'home', unit: (unit || '').trim(),
    keywords: (Array.isArray(keywords) ? keywords : String(keywords || '').split(','))
      .map((k) => k.trim().toLowerCase()).filter(Boolean),
  });
  await setKV('customCategories', list);
  await loadCategories();
  return id;
}

/** Elimina una categoria personalizzata; i documenti già archiviati passano ad "altro". */
export async function removeCategory(id) {
  if (!ALL[id]?.custom) return;
  const list = (await getKV('customCategories', [])).filter((c) => c.id !== id);
  await setKV('customCategories', list);
  await db.bills.where('category').equals(id).modify({ category: 'altro' });
  await db.kv.delete(`set.cat.${id}`);
  const subs = await getKV('subcats', {}); delete subs[id]; await setKV('subcats', subs);
  await loadCategories();
}

// ---------- sottocategorie (per le spese personali, a scelta dell'utente) ----------
let SUBS = {};
export const loadSubcats = async () => { SUBS = (await getKV('subcats', {})) || {}; return SUBS; };
export const subcats = (catId) => SUBS[catId] || [];

export async function addSubcat(catId, name) {
  name = (name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Scrivi il nome della sottocategoria');
  const list = SUBS[catId] || [];
  if (list.some((s) => s.toLowerCase() === name.toLowerCase())) return list.find((s) => s.toLowerCase() === name.toLowerCase());
  SUBS = { ...SUBS, [catId]: [...list, name] };
  await setKV('subcats', SUBS);
  return name;
}

export async function removeSubcat(catId, name) {
  SUBS = { ...SUBS, [catId]: (SUBS[catId] || []).filter((s) => s !== name) };
  await setKV('subcats', SUBS);
  await db.bills.where('category').equals(catId).filter((b) => b.subcategory === name).modify({ subcategory: null });
}
