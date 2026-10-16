// Categorie = quelle integrate (parser.js) + quelle create dall'utente (salvate in locale).
import { CATEGORIES as BUILTIN } from './parser.js';
import { getKV, setKV, db } from './db.js';
import { setKinds } from './assetmatch.js';

let ALL = { ...BUILTIN };

/** Elenco corrente (sincrono, aggiornato da loadCategories). */
export const cats = () => ALL;

export async function loadCategories() {
  const custom = await getKV('customCategories', []);
  ALL = { ...BUILTIN };
  for (const c of custom) {
    ALL[c.id] = {
      label: c.label, icon: c.icon || '📌', color: c.color || '#9aa7b2',
      unit: c.unit || '', kind: c.kind === 'income' ? 'income' : 'cost', scope: c.scope === 'car' ? 'car' : 'home',
      keywords: c.keywords || [], custom: true,
    };
  }
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
    kind: kind === 'income' ? 'income' : 'cost', scope: scope === 'car' ? 'car' : 'home', unit: (unit || '').trim(),
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
  await loadCategories();
}
