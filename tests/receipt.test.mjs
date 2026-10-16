import assert from 'node:assert/strict';
import { toNum, round2, lineTotal, receiptTotals, bySubcategory } from '../src/receipt.js';
import { parseBill } from '../src/parser.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

t('numeri all\'italiana', () => {
  assert.equal(toNum('1,50'), 1.5); assert.equal(toNum('2.30'), 2.3); assert.equal(toNum('1.234,56'), 1234.56);
  assert.equal(toNum(''), null); assert.equal(toNum('abc'), null); assert.equal(toNum(null), null); assert.equal(toNum('-2,5'), -2.5);
});
t('riga: quantità × prezzo, quantità vuota = 1, arrotondamento al centesimo', () => {
  assert.equal(lineTotal({ qty: '3', price: '0,99' }), 2.97);
  assert.equal(lineTotal({ qty: '', price: '4,2' }), 4.2);
  assert.equal(lineTotal({ qty: '0,35', price: '2,99' }), 1.05);
  assert.equal(lineTotal({ qty: '2', price: '' }), 0);
});
t('totale = somma righe, sconti negativi', () => {
  const r = receiptTotals([{ qty: '2', price: '1,10' }, { price: '3,50' }, { price: '-0,70' }]);
  assert.equal(r.sum, 5); assert.equal(r.total, 5); assert.equal(r.manual, false); assert.equal(r.count, 3);
});
t('totale a mano vince e mostra la differenza', () => {
  const r = receiptTotals([{ price: '10' }, { price: '4,99' }], '14,90');
  assert.equal(r.total, 14.9); assert.equal(r.diff, -0.09); assert.equal(r.manual, true);
});
t('senza righe: solo totale', () => {
  const r = receiptTotals([], '23,5'); assert.equal(r.total, 23.5); assert.equal(r.diff, 0);
  assert.equal(receiptTotals([], '').total, 0);
});
t('somma senza errori di virgola mobile', () => {
  assert.equal(receiptTotals([{ price: '0,1' }, { price: '0,2' }]).total, 0.3);
});
t('per sottocategoria', () => {
  const r = bySubcategory([{ subcategory: 'Alimentari', amount: 10 }, { subcategory: 'Alimentari', amount: 5.5 }, { subcategory: 'Casa', amount: 30 }, { amount: 2 }]);
  assert.deepEqual(r.map((x) => [x.name, x.total, x.count]), [['Casa', 30, 1], ['Alimentari', 15.5, 2], ['Senza sottocategoria', 2, 1]]);
});
t('riconoscimento categorie spese', () => {
  assert.equal(parseBill('Pizzeria Da Gino coperto 2 Totale € 38,00').category, 'ristoranti');
  assert.equal(parseBill('Supermercato Conad alimentari Totale documento € 54,20').category, 'spesa');
});
console.log(`\n${passed} test superati`);
