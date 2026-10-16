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
    id: 'categories', title: 'Categorie', icon: '🗂️',
    items: [
      { key: 'cat.luce', type: 'toggle', label: 'Luce', default: true },
      { key: 'cat.gas', type: 'toggle', label: 'Gas', default: true },
      { key: 'cat.acqua', type: 'toggle', label: 'Acqua', default: true },
      { key: 'cat.internet', type: 'toggle', label: 'Internet/Telefono', default: true },
      { key: 'cat.bollo', type: 'toggle', label: 'Bollo auto', default: true },
      { key: 'cat.auto', type: 'toggle', label: 'Manutenzione auto', default: true },
      { key: 'cat.gse', type: 'toggle', label: 'Acconti GSE (entrate)', default: true },
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
      { key: 'ui.theme', type: 'select', label: 'Tema', options: [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']], default: 'auto' },
    ],
  },
  {
    id: 'data', title: 'Dati', icon: '💾',
    items: [
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
