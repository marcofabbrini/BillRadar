import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { getSetting } from './settings.js';
import { addBill, billExists, getKV, setKV } from './db.js';
import { pdfToText } from './pdf.js';
import { parseBill } from './parser.js';
import { loadCategories } from './categories.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// drive.file: l'app vede solo i file e le cartelle che crea lei (permesso non sensibile)
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const REDIRECT_URI = 'com.marcofabbrini.billradar:/oauth2redirect';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ---------- PKCE ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function challenge(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

async function saveTokens(t) {
  const prev = (await getKV('gmail.tokens')) || {};
  await setKV('gmail.tokens', {
    access: t.access_token,
    refresh: t.refresh_token || prev.refresh,
    expires: Date.now() + (t.expires_in - 60) * 1000,
    scope: t.scope || prev.scope || '',
  });
}

export async function hasDriveScope() {
  const t = await getKV('gmail.tokens');
  return !!(t && (t.scope || '').includes('auth/drive.file'));
}

export async function isConnected() {
  const t = await getKV('gmail.tokens');
  return !!(t && (t.refresh || t.access));
}
export async function disconnect() {
  await setKV('gmail.tokens', null);
  await setKV('gmail.needsReauth', false);
}
export const needsReauth = async () => !!(await getKV('gmail.needsReauth'));

async function tokenRequest(params) {
  const clientId = await getSetting('gmail.clientId');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || 'Errore di autenticazione');
    e.code = j.error;
    throw e;
  }
  return j;
}

/** Avvia il login Google nel browser di sistema e attende il redirect. */
export async function connect(opts = {}) {
  // il permesso Drive viene chiesto solo se l'archivio su Drive è attivo (o richiesto ora)
  const wantDrive = opts.drive ?? !!(await getSetting('drive.enabled'));
  const clientId = (await getSetting('gmail.clientId')).trim();
  if (!clientId) throw new Error('Inserisci prima il Client ID in Impostazioni → Gmail');
  if (!Capacitor.isNativePlatform()) throw new Error('Il collegamento Gmail funziona solo nell\'app Android (APK).');

  const verifier = rand();
  const state = rand(16);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: wantDrive ? `${SCOPE} ${DRIVE_SCOPE}` : SCOPE, include_granted_scopes: 'true', code_challenge: await challenge(verifier), code_challenge_method: 'S256',
    state, access_type: 'offline', prompt: 'consent',
  });

  const code = await new Promise((resolve, reject) => {
    let handle;
    CapApp.addListener('appUrlOpen', async ({ url: u }) => {
      if (!u.startsWith(REDIRECT_URI.split(':')[0])) return;
      const q = new URL(u.replace(':/', '://')).searchParams;
      (await handle).remove();
      Browser.close().catch(() => {});
      if (q.get('state') !== state) return reject(new Error('Risposta non valida (state)'));
      if (q.get('error')) return reject(new Error(q.get('error')));
      resolve(q.get('code'));
    }).then((h) => { handle = Promise.resolve(h); });
    Browser.open({ url });
  });

  const tokens = await tokenRequest({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
  await saveTokens(tokens);
  await setKV('gmail.needsReauth', false);
}

/** Rinnova il token in background all'apertura dell'app, così il collegamento resta attivo. */
export async function keepAlive() {
  if (!(await isConnected())) return;
  try { await accessToken(); } catch { /* il banner "Riconnetti" gestisce il caso */ }
}

export async function accessToken() {
  const t = await getKV('gmail.tokens');
  if (!t) throw new Error('Account Gmail non collegato');
  if (t.access && t.expires > Date.now()) return t.access;
  if (!t.refresh) throw new Error('Sessione scaduta: ricollega Gmail');
  try {
    const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
    await saveTokens(j);
    return j.access_token;
  } catch (e) {
    // token revocato o scaduto: serve un nuovo consenso (un solo tocco)
    if (e.code === 'invalid_grant') {
      await setKV('gmail.tokens', null);
      await setKV('gmail.needsReauth', true);
      throw new Error('Sessione Gmail scaduta: tocca "Riconnetti Gmail"');
    }
    throw e;
  }
}

/** Traduce gli errori delle API Google (Gmail / Drive) in indicazioni chiare. */
export async function googleError(r, api = 'Gmail') {
  let reason = '', msg = '';
  try {
    const j = await r.json();
    reason = j.error?.errors?.[0]?.reason || j.error?.status || '';
    msg = j.error?.message || '';
    // il dettaglio completo resta in console per la diagnosi
    console.error(`${api} API`, r.status, JSON.stringify(j.error || j));
  } catch { /* corpo non JSON */ }
  const hay = `${reason} ${msg}`.toLowerCase();
  let hint;
  if (hay.includes('accessnotconfigured') || hay.includes('has not been used') || hay.includes('disabled'))
    hint = `la ${api} API non è abilitata nel progetto Google Cloud (API e servizi → Libreria → ${api === 'Drive' ? 'Google Drive API' : 'Gmail API'} → Abilita).`;
  else if (hay.includes('insufficient') || hay.includes('scope'))
    hint = api === 'Drive'
      ? 'manca il permesso per Drive. Disattiva e riattiva "Archivia su Google Drive" e consenti l\'accesso nella schermata di Google.'
      : 'manca il permesso di lettura. Scollega Gmail e ricollegalo spuntando la casella "Leggi i messaggi" nella schermata di consenso di Google.';
  else if (hay.includes('ratelimit') || hay.includes('quota'))
    hint = 'troppe richieste, riprova tra qualche minuto.';
  else hint = msg || 'accesso negato da Google.';
  const e = new Error(`${api} ${r.status}: ${hint}`);
  e.status = r.status; e.reason = reason;
  return e;
}

async function gget(path, params) {
  const url = `${API}${path}${params ? '?' + new URLSearchParams(params) : ''}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!r.ok) throw await googleError(r, 'Gmail');
  return r.json();
}

const b64urlToBytes = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

function* walkParts(part) {
  if (!part) return;
  yield part;
  for (const p of part.parts || []) yield* walkParts(p);
}
const header = (msg, name) => (msg.payload.headers.find((h) => h.name.toLowerCase() === name) || {}).value || '';

/** Scarica le mail con bollette, estrae i dati dai PDF e li archivia in locale. */
/**
 * opts.afterTs → solo mail arrivate dopo quell'istante (controllo "in tempo reale");
 * opts.days    → solo gli ultimi N giorni;
 * nessuna opzione → storico, secondo "Periodo dello storico" nelle impostazioni.
 */
export async function sync(onProgress = () => {}, hooks = {}, opts = {}) {
  const startedAt = Date.now();
  const base = await getSetting('gmail.query');
  const months = Number(await getSetting('gmail.months'));
  const keepPdf = await getSetting('parse.keepPdf');
  let q;
  if (opts.afterTs) q = `${base} after:${Math.floor(opts.afterTs / 1000)}`;
  else if (opts.days) q = `${base} newer_than:${opts.days}d`;
  else q = months ? `${base} newer_than:${months * 30}d` : base;

  const ids = [];
  let pageToken;
  do {
    const r = await gget('/messages', { q, maxResults: '100', ...(pageToken ? { pageToken } : {}) });
    ids.push(...(r.messages || []).map((m) => m.id));
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < 500);

  const allCats = await loadCategories();
  const stats = { messages: ids.length, added: 0, skipped: 0, errors: 0, newItems: [] };
  for (let i = 0; i < ids.length; i++) {
    onProgress(i + 1, ids.length);
    try {
      const msg = await gget(`/messages/${ids[i]}`, { format: 'full' });
      const subject = header(msg, 'subject');
      const from = header(msg, 'from');
      const mailDate = new Date(Number(msg.internalDate)).toISOString().slice(0, 10);
      for (const p of walkParts(msg.payload)) {
        const isPdf = p.filename && /\.pdf$/i.test(p.filename);
        if (!isPdf || !p.body?.attachmentId) continue;
        if (await billExists(msg.id, p.body.attachmentId)) { stats.skipped++; continue; }
        const att = await gget(`/messages/${msg.id}/attachments/${p.body.attachmentId}`);
        const bytes = b64urlToBytes(att.data);
        const text = await pdfToText(bytes.slice());
        const parsed = parseBill(text, { subject, from, cats: allCats });
        if (parsed.category === 'altro' && parsed.amount == null) { stats.skipped++; continue; }
        const { scores, ...fields } = parsed;
        const record = {
          ...fields,
          issueDate: fields.issueDate || mailDate,
          messageId: msg.id, attachmentId: p.body.attachmentId,
          fileName: p.filename, subject, from, source: 'gmail',
        };
        const billId = await addBill(record, keepPdf ? new Blob([bytes], { type: 'application/pdf' }) : null);
        stats.added++;
        stats.newItems.push({ id: billId, category: record.category });
        // archivio opzionale (es. Google Drive): un errore qui non interrompe la sincronizzazione
        if (hooks.onBill) await hooks.onBill(billId, bytes, record);
      }
    } catch (e) {
      console.error(e);
      stats.errors++;
    }
  }
  await setKV('gmail.lastSync', Date.now());
  await setKV('gmail.lastCheck', startedAt);   // da qui in poi il controllo rapido guarda solo le mail successive
  return stats;
}
