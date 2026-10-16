import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { getSetting } from './settings.js';
import { addBill, billExists, getKV, setKV } from './db.js';
import { pdfToText } from './pdf.js';
import { parseBill, CATEGORIES } from './parser.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
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
  });
}

export async function isConnected() {
  const t = await getKV('gmail.tokens');
  return !!(t && (t.refresh || t.access));
}
export async function disconnect() { await setKV('gmail.tokens', null); }

async function tokenRequest(params) {
  const clientId = await getSetting('gmail.clientId');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...params }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Errore di autenticazione');
  return j;
}

/** Avvia il login Google nel browser di sistema e attende il redirect. */
export async function connect() {
  const clientId = (await getSetting('gmail.clientId')).trim();
  if (!clientId) throw new Error('Inserisci prima il Client ID in Impostazioni → Gmail');
  if (!Capacitor.isNativePlatform()) throw new Error('Il collegamento Gmail funziona solo nell\'app Android (APK).');

  const verifier = rand();
  const state = rand(16);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPE, code_challenge: await challenge(verifier), code_challenge_method: 'S256',
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
}

async function accessToken() {
  const t = await getKV('gmail.tokens');
  if (!t) throw new Error('Account Gmail non collegato');
  if (t.access && t.expires > Date.now()) return t.access;
  if (!t.refresh) throw new Error('Sessione scaduta: ricollega Gmail');
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
  await saveTokens(j);
  return j.access_token;
}

async function gget(path, params) {
  const url = `${API}${path}${params ? '?' + new URLSearchParams(params) : ''}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!r.ok) throw new Error(`Gmail ${r.status}`);
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
export async function sync(onProgress = () => {}) {
  const base = await getSetting('gmail.query');
  const months = Number(await getSetting('gmail.months'));
  const keepPdf = await getSetting('parse.keepPdf');
  const q = months ? `${base} newer_than:${months * 30}d` : base;

  const ids = [];
  let pageToken;
  do {
    const r = await gget('/messages', { q, maxResults: '100', ...(pageToken ? { pageToken } : {}) });
    ids.push(...(r.messages || []).map((m) => m.id));
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < 500);

  const stats = { messages: ids.length, added: 0, skipped: 0, errors: 0 };
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
        const parsed = parseBill(text, { subject, from, cats: CATEGORIES });
        if (parsed.category === 'altro' && parsed.amount == null) { stats.skipped++; continue; }
        const { scores, ...fields } = parsed;
        await addBill({
          ...fields,
          issueDate: fields.issueDate || mailDate,
          messageId: msg.id, attachmentId: p.body.attachmentId,
          fileName: p.filename, subject, from, source: 'gmail',
        }, keepPdf ? new Blob([bytes], { type: 'application/pdf' }) : null);
        stats.added++;
      }
    } catch (e) {
      console.error(e);
      stats.errors++;
    }
  }
  await setKV('gmail.lastSync', Date.now());
  return stats;
}
