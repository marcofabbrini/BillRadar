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

async function ensureFolder(name, parentId, key, cache) {
  if (cache[key]) return cache[key];
  const esc = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${esc}' and '${parentId}' in parents`;
  const found = await dfetch(`${FILES}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`);
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await dfetch(`${FILES}?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    id = created.id;
  }
  cache[key] = id;
  return id;
}

async function uploadOnce(bill, pdf) {
  const cache = await getKV('drive.folders', {});
  const parts = folderParts(bill);
  let parent = 'root', key = '';
  for (const part of parts) { key += `/${part}`; parent = await ensureFolder(part, parent, key, cache); }
  await setKV('drive.folders', cache);

  const boundary = `billradar${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: driveFileName(bill), parents: [parent], mimeType: 'application/pdf' });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    pdf, `\r\n--${boundary}--`,
  ]);
  const res = await dfetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return { fileId: res.id, path: parts.join('/') };
}

/** Carica un PDF nella cartella giusta. Se l'utente ha cancellato le cartelle, le ricrea. */
export async function archiveBill(bill, pdf) {
  try { return await uploadOnce(bill, pdf); }
  catch (e) {
    if (e.status !== 404) throw e;
    await setKV('drive.folders', {});
    return uploadOnce(bill, pdf);
  }
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
