import assert from 'node:assert/strict';
import { parseBill, parseNumberIT, parseDateIT } from '../src/parser.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

t('numeri italiani', () => {
  assert.equal(parseNumberIT('1.234,56'), 1234.56);
  assert.equal(parseNumberIT('87,3'), 87.3);
  assert.equal(parseNumberIT('12'), 12);
});

t('date italiane', () => {
  assert.equal(parseDateIT('05/03/2026'), '2026-03-05');
  assert.equal(parseDateIT('5 marzo 2026'), '2026-03-05');
  assert.equal(parseDateIT('01.12.26'), '2026-12-01');
});

t('bolletta luce', () => {
  const r = parseBill(`
    Enel Energia S.p.A.
    Bolletta n. 2026/123456  Data emissione 12/09/2026
    Fornitura energia elettrica - Codice POD IT001E12345678
    Periodo di fatturazione dal 01/07/2026 al 31/08/2026
    Consumo fatturato 412 kWh
    Totale da pagare € 98,45
    Scadenza 02/10/2026`);
  assert.equal(r.category, 'luce');
  assert.equal(r.amount, 98.45);
  assert.equal(r.consumption, 412);
  assert.equal(r.periodFrom, '2026-07-01');
  assert.equal(r.periodTo, '2026-08-31');
  assert.equal(r.dueDate, '2026-10-02');
  assert.equal(r.issueDate, '2026-09-12');
  assert.equal(r.supplier, 'Enel Energia');
  assert.equal(r.needsReview, false);
});

t('bolletta gas', () => {
  const r = parseBill(`
    Fattura n. G-77881 del mese
    Fornitura gas naturale - Codice PDR 12345678901234
    Periodo dal 01/01/2026 al 28/02/2026
    Consumo 215,5 Smc
    Importo totale 1.234,56 €`);
  assert.equal(r.category, 'gas');
  assert.equal(r.amount, 1234.56);
  assert.equal(r.consumption, 215.5);
});

t('bolletta acqua', () => {
  const r = parseBill(`
    Gruppo CAP - Servizio idrico integrato
    Acquedotto, fognatura e depurazione
    Consumo fatturato 38 mc
    Totale bolletta 74,20 euro`);
  assert.equal(r.category, 'acqua');
  assert.equal(r.amount, 74.2);
  assert.equal(r.consumption, 38);
});

t('internet', () => {
  const r = parseBill(`Fastweb S.p.A. Fattura n. FW-2026-9 canone mensile fibra internet
    Totale fattura € 29,95`, { subject: 'La tua fattura Fastweb' });
  assert.equal(r.category, 'internet');
  assert.equal(r.amount, 29.95);
});

t('bollo auto', () => {
  const r = parseBill(`Tassa automobilistica - Automobile Club d'Italia targa AB123CD
    Importo 187,20 €`, { subject: 'Bollo auto' });
  assert.equal(r.category, 'bollo');
  assert.equal(r.amount, 187.2);
});

t('manutenzione auto', () => {
  const r = parseBill(`Officina Rossi S.r.l. Fattura n. 45/2026
    Tagliando, manodopera, ricambi, pneumatici
    Totale documento € 412,80`);
  assert.equal(r.category, 'auto');
  assert.equal(r.amount, 412.8);
});

t('acconto GSE (entrata)', () => {
  const r = parseBill(`GSE - Gestore dei Servizi Energetici
    Ritiro dedicato - impianto fotovoltaico
    Acconto relativo al mese di agosto 2026
    Energia immessa 320 kWh
    Importo acconto € 36,10`, { from: 'noreply@gse.it' });
  assert.equal(r.category, 'gse');
  assert.equal(r.amount, 36.1);
  assert.equal(r.consumption, 320);
});

t('testo non riconoscibile va in revisione', () => {
  const r = parseBill('lorem ipsum');
  assert.equal(r.category, 'altro');
  assert.equal(r.needsReview, true);
});

t('categoria personalizzata con parole chiave e unità', () => {
  const cats = {
    condominio: { label: 'Condominio', unit: 'kg', kind: 'cost', keywords: ['amministratore', 'spese condominiali'] },
  };
  const r = parseBill(`Studio Bianchi - Amministratore\nSpese condominiali rata ottobre\nConsumo 12 kg\nTotale da pagare € 215,00`, { cats });
  assert.equal(r.category, 'condominio');
  assert.equal(r.amount, 215);
  assert.equal(r.consumption, 12);
});

console.log(`\n${passed} test superati`);
