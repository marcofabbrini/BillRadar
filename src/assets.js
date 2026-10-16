// Immobili e vetture: il "tag" obbligatorio di ogni bolletta. Salvati in locale (KV 'assets').
import { getKV, setKV, db } from './db.js';
import { ruleKey } from './assetmatch.js';

let ALL = [];
export const assets = () => ALL;
export const assetById = (id) => ALL.find((a) => a.id === id) || null;
export const KIND_LABEL = { home: 'Immobile', car: 'Vettura' };
export const KIND_ICON = { home: '🏠', car: '🚗' };
export const assetLabel = (a) => (a ? `${KIND_ICON[a.kind] || '📍'} ${a.name}` : '');

export async function loadAssets() {
  ALL = (await getKV('assets', [])) || [];
  return ALL;
}

const parseMatch = (m) => (Array.isArray(m) ? m : String(m || '').split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean);

export async function saveAsset({ id, kind, name, match }) {
  name = (name || '').trim();
  if (!name) throw new Error('Inserisci un nome');
  if (ALL.some((a) => a.id !== id && a.kind === kind && a.name.toLowerCase() === name.toLowerCase())) throw new Error('Esiste già con questo nome');
  const list = [...ALL];
  const rec = { id: id || `a_${Math.random().toString(36).slice(2, 8)}`, kind: kind === 'car' ? 'car' : 'home', name, match: parseMatch(match) };
  const i = list.findIndex((a) => a.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  await setKV('assets', list);
  await loadAssets();
  return rec;
}

/** Elimina il bene: le bollette collegate tornano "da assegnare". */
export async function removeAsset(id) {
  await setKV('assets', ALL.filter((a) => a.id !== id));
  const rules = await getKV('assetRules', {});
  for (const k of Object.keys(rules)) if (rules[k] === id) delete rules[k];
  await setKV('assetRules', rules);
  await db.bills.filter((b) => b.assetId === id).modify({ assetId: null });
  await loadAssets();
}

export const countUnassigned = () => db.bills.filter((b) => !b.assetId).count();

/** Assegna a tutte le bollette senza bene. */
export async function assignAllUnassigned(id) {
  return db.bills.filter((b) => !b.assetId).modify({ assetId: id });
}

/** Ricorda la scelta (categoria + fornitore → bene) e la applica alle bollette simili ancora senza bene. */
export async function learnAssignment(bill, assetId) {
  if (!assetId || !bill.category) return 0;
  const rules = await getKV('assetRules', {});
  rules[ruleKey(bill.category, bill.supplier)] = assetId;
  await setKV('assetRules', rules);
  const key = ruleKey(bill.category, bill.supplier);
  return db.bills.filter((b) => !b.assetId && b.id !== bill.id && ruleKey(b.category, b.supplier) === key).modify({ assetId });
}
