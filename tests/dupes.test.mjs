import assert from 'node:assert/strict';
import { findDuplicates, keepScore, sha256 } from '../src/dupes.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };
const b = (id, o = {}) => ({ id, category: 'luce', supplier: 'Enel', amount: 100, issueDate: '2026-09-01', ...o });

t('nessun duplicato', () => assert.deepEqual(findDuplicates([b(1), b(2, { amount: 80 }), b(3, { issueDate: '2026-10-01' })]), []));
t('stesso numero, fornitore e importo → sicuro', () => {
  const g = findDuplicates([b(1, { invoiceNumber: 'FT-123', issueDate: '2026-09-01' }), b(2, { invoiceNumber: 'ft 123', issueDate: '2026-09-05' }), b(3, { amount: 5 })]);
  assert.equal(g.length, 1); assert.equal(g[0].strong, true); assert.deepEqual(g[0].ids.sort(), [1, 2]);
});
t('stessa categoria, data e importo → probabile', () => {
  const g = findDuplicates([b(1), b(2, { supplier: 'ENEL Energia' })]);
  assert.equal(g.length, 1); assert.equal(g[0].strong, false); assert.deepEqual(g[0].reasons, ['stessa categoria, data e importo']);
});
t('fornitori diversi: non sono duplicati', () => assert.deepEqual(findDuplicates([b(1), b(2, { supplier: 'Hera' })]), []));
t('stesso PDF o stesso allegato → sicuro, anche con dati diversi', () => {
  const g = findDuplicates([b(1, { pdfHash: 'abc' }), b(2, { pdfHash: 'abc', amount: 7, issueDate: '2026-01-01' }), b(3, { messageId: 'm', attachmentId: 'a', amount: 11, issueDate: '2026-03-03' }), b(4, { messageId: 'm', attachmentId: 'a', amount: 9, issueDate: '2026-04-04' })]);
  assert.equal(g.length, 2); assert.ok(g.every((x) => x.strong));
});
t('gruppo di tre: si uniscono a catena', () => {
  const g = findDuplicates([b(1, { pdfHash: 'x' }), b(2, { pdfHash: 'x', invoiceNumber: 'AB-77' }), b(3, { invoiceNumber: 'AB-77', amount: 100, issueDate: '2026-02-02' })]);
  assert.equal(g.length, 1); assert.equal(g[0].ids.length, 3);
});
t('da tenere: quello con PDF e assegnazione confermata', () => {
  const x = b(1, { assetBy: 'auto', needsReview: true }), y = b(2, { pdf: {}, assetId: 'h1', assetBy: 'manual' });
  assert.ok(keepScore(y) > keepScore(x));
  assert.equal(findDuplicates([x, y])[0].keep, 2);
});
t('a parità tiene il più vecchio', () => assert.equal(findDuplicates([b(5), b(2)])[0].keep, 2));
t('importi senza valore non danno falsi duplicati', () => assert.deepEqual(findDuplicates([b(1, { amount: null }), b(2, { amount: null })]), []));
t('impronta SHA-256', async () => {
  assert.equal(await sha256(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
setTimeout(() => console.log(`\n${passed} test superati`), 50);
