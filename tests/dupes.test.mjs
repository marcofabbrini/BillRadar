import assert from 'node:assert/strict';
import { findDuplicates, classifyPair, keepScore, sha256, billUid, pairKey } from '../src/dupes.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };
const b = (id, o = {}) => ({ id, category: 'luce', supplier: 'Enel', amount: 100, issueDate: '2026-09-01', createdAt: 1000 + id, ...o });
const P = { periodFrom: '2026-07-01', periodTo: '2026-08-31' };

t('nessun duplicato', () => assert.deepEqual(findDuplicates([b(1), b(2, { amount: 80, issueDate: '2026-09-02' }), b(3, { issueDate: '2026-10-01' })]), []));
t('stesso periodo di fatturazione, fornitore e importo → sicuro (anche con date emissione diverse)', () => {
  const g = findDuplicates([b(1, { ...P, issueDate: '2026-09-01' }), b(2, { ...P, issueDate: '2026-09-09' })]);
  assert.equal(g.length, 1); assert.equal(g[0].strong, true); assert.deepEqual(g[0].presetIds.length, 1);
  assert.match(g[0].reasons[0], /periodo di fatturazione/);
});
t('stesso periodo ma importo diverso → probabile, non preselezionato', () => {
  const g = findDuplicates([b(1, P), b(2, { ...P, amount: 120, issueDate: '2026-09-09' })]);
  assert.equal(g.length, 1); assert.equal(g[0].strong, false); assert.deepEqual(g[0].presetIds, []); assert.match(g[0].reasons[0], /importo diverso/);
});
t('periodi diversi, stesso importo e data: non sono duplicati', () => {
  assert.equal(classifyPair(b(1, P), b(2, { periodFrom: '2026-09-01', periodTo: '2026-10-31' })), null);
});
t('senza periodo: stessa data e importo → probabile; stessa data ma importo diverso → no', () => {
  assert.equal(classifyPair(b(1), b(2)).strong, false);
  assert.equal(classifyPair(b(1), b(2, { amount: 50 })), null);
});
t('numeri documento diversi o fornitori diversi o beni diversi → mai duplicati', () => {
  assert.equal(classifyPair(b(1, { ...P, invoiceNumber: 'FT-100' }), b(2, { ...P, invoiceNumber: 'FT-101' })), null);
  assert.equal(classifyPair(b(1, P), b(2, { ...P, supplier: 'Hera' })), null);
  assert.equal(classifyPair(b(1, { ...P, assetId: 'h1' }), b(2, { ...P, assetId: 'h2' })), null);
  assert.equal(classifyPair(b(1, { ...P, assetId: 'h1' }), b(2, { ...P, assetId: 'h1' })).strong, true);
});
t('stesso numero, fornitore e importo → sicuro anche con periodi non letti', () => {
  assert.equal(classifyPair(b(1, { invoiceNumber: 'FT-123', issueDate: '2026-01-01' }), b(2, { invoiceNumber: 'ft 123', issueDate: '2026-02-02' })).strong, true);
});
t('categorie diverse non si confrontano', () => assert.deepEqual(findDuplicates([b(1, P), b(2, { ...P, category: 'gas' })]), []));
t('stesso PDF o stesso allegato → sicuro, anche con dati diversi', () => {
  const g = findDuplicates([b(1, { pdfHash: 'abc' }), b(2, { pdfHash: 'abc', amount: 7, issueDate: '2026-01-01' }), b(3, { messageId: 'm', attachmentId: 'a', amount: 11, issueDate: '2026-03-03' }), b(4, { messageId: 'm', attachmentId: 'a', amount: 9, issueDate: '2026-04-04' })]);
  assert.equal(g.length, 2); assert.ok(g.every((x) => x.strong));
});
t('gruppo a catena: si tiene il migliore dei sicuri, il resto resta da controllare', () => {
  const x = b(1, { ...P }), y = b(2, { ...P, pdf: {}, assetId: 'h1', assetBy: 'manual' }), z = b(3, { ...P, amount: 130 });
  const g = findDuplicates([x, y, z]);
  assert.equal(g.length, 1); assert.deepEqual(g[0].keepIds, [2]); assert.deepEqual(g[0].presetIds, [1]);
});
t('da tenere: PDF e assegnazione confermata; a parità il più vecchio', () => {
  assert.ok(keepScore(b(2, { pdf: {}, assetBy: 'manual', assetId: 'h1' })) > keepScore(b(1, { needsReview: true })));
  assert.deepEqual(findDuplicates([b(5, P), b(2, P)])[0].keepIds, [2]);
});
t('"non è un duplicato": la coppia confermata non compare più', () => {
  const a = b(1, P), c = b(2, P);
  assert.equal(findDuplicates([a, c]).length, 1);
  assert.deepEqual(findDuplicates([a, c], { ignore: new Set([pairKey(a, c)]) }), []);
  assert.equal(pairKey(a, c), pairKey(c, a));
});
t('l\'esclusione vale per quella coppia, non per le altre', () => {
  const a = b(1, P), c = b(2, P), d = b(3, { ...P, issueDate: '2026-09-20' });
  const g = findDuplicates([a, c, d], { ignore: new Set([pairKey(a, c)]) });
  assert.equal(g.length, 1);   // a e c restano legati tramite d
  assert.equal(findDuplicates([a, c, d], { ignore: new Set([pairKey(a, c), pairKey(a, d), pairKey(c, d)]) }).length, 0);
});
t('identificativo stabile', () => { assert.equal(billUid(b(1)), 'c1001'); assert.ok(billUid({ category: 'gas', amount: 5 }).includes('gas')); });
t('importi senza valore non danno falsi duplicati', () => assert.deepEqual(findDuplicates([b(1, { amount: null }), b(2, { amount: null })]), []));
t('impronta SHA-256', async () => {
  assert.equal(await sha256(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
setTimeout(() => console.log(`\n${passed} test superati`), 50);
