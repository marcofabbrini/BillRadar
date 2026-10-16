// Registro DICHIARATIVO delle impostazioni.
// Per aggiungere una funzione futura basta inserire una voce qui: la schermata
// Impostazioni la mostra da sola e il valore viene salvato in locale.
//
// type: 'text' | 'number' | 'toggle' | 'select' | 'action' | 'info'
import { getKV, setKV } from './db.js';

export const SETTINGS_SCHEMA = [
  {
    id: 'gmail', title: 'Gmail', icon: '✉️',
    items: [
      { key: 'gmail.clientId', type: 'text', label: 'Google OAuth Client ID', hint: 'Client "Android" creato in Google Cloud Console (vedi README)', default: '' },
      { key: 'gmail.query', type: 'text', label: 'Filtro di ricerca', hint: 'Sintassi Gmail. Modificalo per aggiungere mittenti.', default: 'has:attachment filename:pdf (bolletta OR fattura OR "tassa automobilistica" OR GSE OR acconto OR bollo)' },
      { key: 'gmail.months', type: 'select', label: 'Periodo da analizzare', options: [['3', 'Ultimi 3 mesi'], ['12', 'Ultimo anno'], ['36', 'Ultimi 3 anni'], ['0', 'Tutto']], default: '12' },
      { key: 'gmail.auto', type: 'toggle', label: 'Sincronizza all\'apertura', hint: 'Cerca nuove bollette ogni volta che apri l\'app', default: true },
      { key: 'action.connect', type: 'action', label: 'Collega / scollega account Gmail' },
    ],
  },
  {
    id: 'drive', title: 'Google Drive', icon: '☁️',
    items: [
      { key: 'drive.enabled', type: 'toggle', label: 'Archivia su Google Drive', hint: 'Facoltativo. Salva i PDF in BillRadar / Anno / Mese / Tipologia nel tuo Drive.', default: false },
      { key: 'action.driveSync', type: 'action', label: 'Archivia ora i documenti già presenti', hint: 'Carica su Drive le bollette salvate prima di attivare l\'archivio.' },
      { key: 'drive.autoBackup', type: 'toggle', label: 'Backup automatico dei dati', hint: 'Dopo ogni sincronizzazione salva un file JSON in BillRadar / Service (uno al giorno).', default: false },
      { key: 'action.driveBackup', type: 'action', label: 'Esegui backup su Drive', hint: 'Salva i dati estratti (JSON) in BillRadar / Service.' },
      { key: 'action.driveRestore', type: 'action', label: 'Ripristina da Drive', hint: 'Recupera l\'ultimo backup dalla cartella Service. Non crea doppioni.' },
      { key: 'action.driveFree', type: 'action', label: 'Libera spazio sul telefono', hint: 'Toglie dal telefono i PDF già presenti su Drive; restano apribili da Drive.' },
    ],
  },
  {
    id: 'categories', title: 'Categorie', icon: '🗂️',
    items: [
      { key: 'cat.manage', type: 'categories', label: 'Categorie' },
    ],
  },
  {
    id: 'parsing', title: 'Estrazione dati', icon: '🧾',
    items: [
      { key: 'parse.review', type: 'toggle', label: 'Segna da verificare i documenti incerti', default: true },
      { key: 'parse.keepPdf', type: 'toggle', label: 'Conserva il PDF originale sul telefono', default: true },
    ],
  },
  {
    id: 'appearance', title: 'Aspetto', icon: '🎨',
    items: [
      { key: 'ui.theme', type: 'select', label: 'Tema', options: [['dark', 'Scuro (neon)'], ['light', 'Chiaro'], ['auto', 'Automatico']], default: 'dark' },
    ],
  },
  {
    id: 'data', title: 'Dati', icon: '💾',
    items: [
      { key: 'storage.info', type: 'storage', label: 'Spazio occupato' },
      { key: 'action.exportJson', type: 'action', label: 'Esporta backup (JSON)' },
      { key: 'action.exportCsv', type: 'action', label: 'Esporta tabella (CSV)' },
      { key: 'action.import', type: 'action', label: 'Importa backup' },
      { key: 'action.wipe', type: 'action', label: 'Cancella tutti i dati', danger: true },
    ],
  },
  {
    id: 'future', title: 'In arrivo', icon: '🧭',
    items: [
      { key: 'future.notice', type: 'info', label: 'Qui compariranno le nuove funzioni (promemoria scadenze, soglie di spesa, altri mittenti…).' },
    ],
  },
];

const defaults = {};
for (const s of SETTINGS_SCHEMA) for (const i of s.items) if ('default' in i) defaults[i.key] = i.default;

export async function getSetting(key) {
  return getKV(`set.${key}`, defaults[key]);
}
export const setSetting = (key, value) => setKV(`set.${key}`, value);

export async function allSettings() {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = await getSetting(k);
  return out;
}
