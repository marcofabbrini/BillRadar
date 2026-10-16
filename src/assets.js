// Immobili e vetture: il "tag" obbligatorio di ogni bolletta. Salvati in locale (KV 'assets').
import { getKV, setKV, db } from './db.js';
import { ruleKey, assignAsset } from './assetmatch.js';
import { extractHolder, extractAddress } from './parser.js';
import { pdfToText } from './pdf.js';

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

export async function saveAsset({ id, kind, name, match, holder, address }) {
  name = (name || '').trim();
  if (!name) throw new Error('Inserisci un nome');
  if (ALL.some((a) => a.id !== id && a.kind === kind && a.name.toLowerCase() === name.toLowerCase())) throw new Error('Esiste già con questo nome');
  const list = [...ALL];
  const rec = {
    id: id || `a_${Math.random().toString(36).slice(2, 8)}`, kind: kind === 'car' ? 'car' : 'home', name,
    holder: (holder || '').trim(), address: kind === 'car' ? '' : (address || '').trim(), match: parseMatch(match),
  };
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

const words = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Impronta del documento: categoria + fornitore + intestatario + indirizzo letti nel PDF. */
const tupleKey = (b) => `${ruleKey(b.category, b.supplier)}|${words(b.holder)}|${words(b.supplyAddress)}`;

/**
 * Assegnazione manuale: la scelta viene estesa solo ai documenti che risultano IDENTICI per categoria, fornitore,
 * intestatario e indirizzo (un titolare con più immobili non viene mai mescolato). Per i beni senza indirizzo
 * (es. una vettura) vale anche come regola per le prossime bollette di quel fornitore.
 */
export async function learnAssignment(bill, assetId) {
  if (!assetId || !bill.category) return 0;
  const asset = assetById(assetId);
  if (asset && !asset.address) {
    const rules = await getKV('assetRules', {});
    rules[ruleKey(bill.category, bill.supplier)] = assetId;
    await setKV('assetRules', rules);
  }
  const hasEvidence = !!(bill.holder || bill.supplyAddress);
  if (asset?.address && !hasEvidence) return 0;   // un immobile "verificato" non si estende a documenti senza indirizzo/intestatario
  const key = tupleKey(bill);
  return db.bills.filter((b) => !b.assetId && b.id !== bill.id && tupleKey(b) === key).modify({ assetId, assetBy: 'manual', assetNote: null, assetSuggest: null });
}

/** Esito dell'assegnazione da salvare sul documento. */
export function assignmentFields(result) {
  return {
    assetId: result.asset?.id || null,
    assetBy: result.asset ? 'auto' : null,
    assetNote: result.asset ? null : (result.reason !== 'none' ? result.reason : null),
    assetSuggest: result.suggested || null,
  };
}

/** Rilegge i PDF già presenti e (ri)assegna le bollette senza bene o assegnate in automatico; quelle scelte a mano non si toccano. */
export async function reverifyBills(onProgress = () => {}) {
  const rules = await getKV('assetRules', {});
  const todo = await db.bills.filter((b) => !b.assetId || b.assetBy === 'auto').toArray();
  const out = { total: todo.length, assigned: 0, manual: 0, noPdf: 0, changed: 0 };
  for (let i = 0; i < todo.length; i++) {
    onProgress(i + 1, todo.length);
    const b = todo[i];
    if (!b.pdf) { out.noPdf++; continue; }
    let text;
    try { text = await pdfToText(await b.pdf.arrayBuffer()); } catch { out.noPdf++; continue; }
    const holder = extractHolder(text), supplyAddress = extractAddress(text);
    const r = assignAsset({ text, category: b.category, supplier: b.supplier, holder, supplyAddress }, ALL, rules);
    const patch = { holder, supplyAddress, ...assignmentFields(r) };
    if (patch.assetId !== (b.assetId || null)) out.changed++;
    if (patch.assetId) out.assigned++; else out.manual++;
    await db.bills.update(b.id, patch);
  }
  return out;
}
