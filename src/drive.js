// Archivio opzionale su Google Drive: BillRadar / Anno / Mese / Tipologia / file.pdf
// Usa il permesso drive.file: l'app gestisce solo le cartelle e i file creati da lei.
import { accessToken, googleError, hasDriveScope } from './gmail.js';
import { getKV, setKV, listBills, updateBill } from './db.js';
import { getSetting } from './settings.js';
import { cats } from './categories.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const ROOT_NAME = 'BillRadar';
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Senza nome';

export async function isDriveEnabled() {
  return !!(await getSetting('drive.enabled')) && (await hasDriveScope());
}

/** Percorso delle cartelle per un documento: BillRadar / 2026 / 03 - Marzo / Luce */
export function folderParts(bill) {
  const m = /^(\d{4})-(\d{2})/.exec(bill.issueDate || '');
  const label = cats()[bill.category]?.label || 'Altro';
  return [
    ROOT_NAME,
    m ? m[1] : 'Senza data',
    m ? `${m[2]} - ${MESI[Number(m[2]) - 1] || m[2]}` : 'Senza data',
    clean(label),
  ];
}

export function driveFileName(bill) {
  const amount = bill.amount != null ? `${bill.amount.toFixed(2).replace('.', ',')} EUR` : '';
  const label = cats()[bill.category]?.label || 'Altro';
  return `${clean([bill.issueDate || 'senza-data', label, bill.supplier, amount].filter(Boolean).join(' '))}.pdf`;
}

async function dfetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${await accessToken()}`, ...(opts.headers || {}) } });
  if (!r.ok) throw await googleError(r, 'Drive');
  return r.json();
}

const esc = (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const JSON_H = { 'Content-Type': 'application/json' };
export const SERVICE_NAME = 'Service';
const BACKUP_PREFIX = 'billradar-backup-';

async function ensureFolder(name, parentId, key, cache, create = true) {
  if (cache[key]) return cache[key];
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${esc(name)}' and '${parentId}' in parents`;
  const found = await dfetch(`${FILES}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`);
  let id = found.files?.[0]?.id;
  if (!id) {
    if (!create) return null;
    const created = await dfetch(`${FILES}?fields=id`, {
      method: 'POST', headers: JSON_H,
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    id = created.id;
  }
  cache[key] = id;
  return id;
}

/** Risolve (e se serve crea) il percorso di cartelle; restituisce l'ID dell'ultima. */
async function resolveParent(parts, create = true) {
  const cache = await getKV('drive.folders', {});
  let parent = 'root', key = '';
  for (const part of parts) {
    key += `/${part}`;
    parent = await ensureFolder(part, parent, key, cache, create);
    if (!parent) return null;
  }
  await setKV('drive.folders', cache);
  return parent;
}

/** Cerca un file con quel nome nella cartella (non nel cestino). */
async function findInFolder(name, parentId) {
  const q = `trashed=false and name='${esc(name)}' and '${parentId}' in parents`;
  const r = await dfetch(`${FILES}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`);
  return r.files?.[0]?.id || null;
}

/** Crea il file, oppure ne aggiorna il contenuto se nella cartella ne esiste già uno con lo stesso nome. */
async function putFile(name, parentId, blob, mime) {
  const existing = await findInFolder(name, parentId);
  if (existing) {
    await dfetch(`${UPLOAD}/${existing}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: blob });
    return { fileId: existing, replaced: true };
  }
  const boundary = `billradar${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: [parentId], mimeType: mime });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob, `\r\n--${boundary}--`,
  ]);
  const res = await dfetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return { fileId: res.id, replaced: false };
}

async function uploadOnce(bill, pdf) {
  const parts = folderParts(bill);
  const parent = await resolveParent(parts);
  const { fileId, replaced } = await putFile(driveFileName(bill), parent, pdf, 'application/pdf');
  return { fileId, path: parts.join('/'), replaced };
}

/** Il documento è già su Drive: se nome o cartella non corrispondono più (modifica), lo rinomina/sposta. */
async function relocate(bill) {
  let meta;
  try { meta = await dfetch(`${FILES}/${bill.driveFileId}?fields=id,name,parents,trashed`); }
  catch (e) { if (e.status === 404) return null; throw e; }
  if (meta.trashed) return null;          // cancellato dall'utente: va ricaricato
  const parts = folderParts(bill);
  const parent = await resolveParent(parts);
  const name = driveFileName(bill);
  const oldParent = meta.parents?.[0];
  if (meta.name !== name || oldParent !== parent) {
    const qs = new URLSearchParams({ fields: 'id' });
    if (oldParent && oldParent !== parent) { qs.set('addParents', parent); qs.set('removeParents', oldParent); }
    await dfetch(`${FILES}/${bill.driveFileId}?${qs}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify({ name }) });
  }
  return { fileId: bill.driveFileId, path: parts.join('/'), replaced: true };
}

/**
 * Porta il documento su Drive e lo mantiene allineato:
 * - già archiviato → viene rinominato/spostato se i dati sono cambiati;
 * - file con lo stesso nome già presente nella cartella → ne aggiorna il contenuto, non crea doppioni;
 * - cartelle cancellate dall'utente → le ricrea.
 */
export async function archiveBill(bill, pdf) {
  const run = async () => {
    if (bill.driveFileId) { const moved = await relocate(bill); if (moved) return moved; }
    if (!pdf) return null;                 // niente PDF locale e file perso su Drive
    return uploadOnce(bill, pdf);
  };
  try { return await run(); }
  catch (e) {
    if (e.status !== 404) throw e;
    await setKV('drive.folders', {});
    return run();
  }
}

/** Scarica il PDF da Drive (per i documenti il cui PDF non è più sul telefono). */
export async function downloadPdf(bill) {
  const r = await fetch(`${FILES}/${bill.driveFileId}?alt=media`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!r.ok) throw await googleError(r, 'Drive');
  return r.blob();
}

// ---------- backup / ripristino (cartella BillRadar/Service) ----------
export async function backupToDrive(json) {
  const parent = await resolveParent([ROOT_NAME, SERVICE_NAME]);
  const name = `${BACKUP_PREFIX}${new Date().toISOString().slice(0, 10)}.json`;   // stesso giorno → sovrascrive
  const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
  const { replaced } = await putFile(name, parent, blob, 'application/json');
  await setKV('drive.lastBackup', Date.now());
  return { name, replaced, path: `${ROOT_NAME}/${SERVICE_NAME}` };
}

export async function restoreFromDrive() {
  const parent = await resolveParent([ROOT_NAME, SERVICE_NAME], false);
  const none = () => new Error('Nessun backup trovato su Drive (cartella BillRadar/Service).');
  if (!parent) throw none();
  const q = `trashed=false and '${parent}' in parents and name contains '${BACKUP_PREFIX}'`;
  const r = await dfetch(`${FILES}?${new URLSearchParams({ q, fields: 'files(id,name)', orderBy: 'name desc', pageSize: '1' })}`);
  const f = r.files?.[0];
  if (!f) throw none();
  const res = await fetch(`${FILES}/${f.id}?alt=media`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw await googleError(res, 'Drive');
  return { name: f.name, json: await res.json() };
}

/** Libera spazio: toglie dal telefono i PDF che risultano ancora presenti su Drive. */
export async function freeLocalPdfs(onProgress = () => {}) {
  const todo = (await listBills()).filter((b) => b.pdf && b.driveFileId);
  const out = { total: todo.length, freed: 0, bytes: 0, skipped: 0 };
  for (let i = 0; i < todo.length; i++) {
    onProgress(i + 1, todo.length);
    try {
      const meta = await dfetch(`${FILES}/${todo[i].driveFileId}?fields=id,trashed`);
      if (meta.trashed) { out.skipped++; continue; }
      out.bytes += todo[i].pdf.size || 0;
      await updateBill(todo[i].id, { pdf: null });
      out.freed++;
    } catch (e) {
      if (e.status === 404) { out.skipped++; continue; }   // non su Drive: il PDF locale resta
      throw e;
    }
  }
  return out;
}

/** Spazio occupato sul telefono. */
export async function localUsage() {
  const bills = await listBills();
  const withPdf = bills.filter((b) => b.pdf);
  const pdfBytes = withPdf.reduce((s, b) => s + (b.pdf.size || 0), 0);
  let usage = null, quota = null;
  try { const e = await navigator.storage?.estimate?.(); usage = e?.usage ?? null; quota = e?.quota ?? null; } catch { /* non disponibile */ }
  return {
    docs: bills.length, pdfs: withPdf.length, pdfBytes, usage, quota,
    onDrive: withPdf.filter((b) => b.driveFileId).length,
  };
}

/** Hook per la sincronizzazione Gmail: archivia ogni nuovo documento se la funzione è attiva. */
export function syncHook() {
  const hook = { uploaded: 0, errors: [] };
  hook.onBill = async (id, bytes, record) => {
    if (hook.errors.length >= 3 || !(await isDriveEnabled())) return;   // niente raffica di errori identici
    try {
      const { fileId, path } = await archiveBill(record, new Blob([bytes], { type: 'application/pdf' }));
      await updateBill(id, { driveFileId: fileId, drivePath: path });
      hook.uploaded++;
    } catch (e) { hook.errors.push(e.message); }
  };
  return hook;
}

/** Archivia i documenti già presenti (con PDF conservato) che non sono ancora su Drive. */
export async function archivePending(onProgress = () => {}) {
  const todo = (await listBills()).filter((b) => b.pdf && !b.driveFileId);
  const out = { total: todo.length, done: 0, errors: 0, firstError: null };
  for (let i = 0; i < todo.length; i++) {
    onProgress(i + 1, todo.length);
    try {
      const { fileId, path } = await archiveBill(todo[i], todo[i].pdf);
      await updateBill(todo[i].id, { driveFileId: fileId, drivePath: path });
      out.done++;
    } catch (e) {
      out.errors++; out.firstError ||= e.message;
      if (e.status === 403 || e.status === 401) break;   // problema di configurazione: inutile insistere
    }
  }
  return out;
}
