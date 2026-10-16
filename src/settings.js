// Registro DICHIARATIVO delle impostazioni.
// Per aggiungere una funzione futura basta inserire una voce qui: la schermata
// Impostazioni la mostra da sola e il valore viene salvato in locale.
//
// type: 'text' | 'number' | 'toggle' | 'select' | 'action' | 'info'
import { getKV, setKV } from './db.js';
import { DEFAULT_SENDERS } from './query.js';

export const SETTINGS_SCHEMA = [
  {
    id: 'gmail', title: 'Gmail', icon: '✉️',
    items: [
      { key: 'gmail.clientId', type: 'text', label: 'Google OAuth Client ID', hint: 'Client "Android" creato in Google Cloud Console (vedi README)', default: '' },
      { key: 'gmail.senders', type: 'list', label: 'Indirizzi da cui arrivano le bollette', hint: 'Indirizzo completo o intero dominio (es. @enel.com). Solo le mail con PDF da questi mittenti vengono analizzate.', placeholder: 'es. fatture@fornitore.it', default: DEFAULT_SENDERS },
      { key: 'gmail.keywords', type: 'list', label: 'Testo contenuto nella mail', hint: 'Facoltativo: la mail deve contenere almeno uno di questi testi (oggetto o corpo). Vuoto = nessun vincolo.', placeholder: 'es. la tua fattura', default: [] },
      { key: 'gmail.generic', type: 'toggle', label: 'Cerca anche per parole generiche', hint: 'Aggiunge le mail con "bolletta", "fattura", "GSE", "bollo"… di qualsiasi mittente.', default: false },
      { key: 'gmail.preview', type: 'preview', label: 'Ricerca effettuata' },
      { key: 'gmail.months', type: 'select', label: 'Periodo dello storico', hint: 'Usato da "Sincronizza storico"', options: [['3', 'Ultimi 3 mesi'], ['12', 'Ultimo anno'], ['36', 'Ultimi 3 anni'], ['0', 'Tutto']], default: '12' },
      { key: 'gmail.auto', type: 'toggle', label: 'Controlla nuove bollette all\'apertura', hint: 'Guarda solo le mail degli ultimi 7 giorni', default: true },
      { key: 'action.syncHistory', type: 'action', label: 'Sincronizza storico', hint: 'Cerca le bollette più vecchie nel periodo scelto qui sopra (più lento).' },
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
    id: 'assets', title: 'Immobili e vetture', icon: '🏡',
    items: [
      { key: 'assets.manage', type: 'assets', label: 'Immobili e vetture' },
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
      { key: 'ui.ecgColor', type: 'color', label: 'Colore della striscia in alto', hint: 'La linea del battito nel banner.', default: '#6fe0ff', presets: ['#6fe0ff', '#4ade80', '#fbbf24', '#fb7185', '#c084fc', '#f97316', '#ffffff'] },
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
    id: 'widget', title: 'Widget', icon: '📈',
    items: [
      { key: 'widget.how', type: 'info', label: 'Tieni premuto sulla schermata Home di Android → Widget → BillRadar "Andamento bollette". Alla creazione scegli quali serie mostrare.' },
      { key: 'widget.size', type: 'info', label: 'Si ridimensiona trascinando i bordi (anche a tutta larghezza). Mostra il grafico degli ultimi 12 mesi e quante bollette nuove sono arrivate negli ultimi 7 giorni.' },
      { key: 'widget.edit', type: 'info', label: 'Per cambiare le serie in seguito: tieni premuto il widget → Impostazioni. Il widget si aggiorna quando apri l\'app o sincronizzi.' },
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
