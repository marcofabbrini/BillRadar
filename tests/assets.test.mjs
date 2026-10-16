import assert from 'node:assert/strict';
import { assignAsset, pickAsset, ruleKey, matchAddress, matchHolder } from '../src/assetmatch.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

// Mario ha due immobili; Giulia (altra persona) ha una scheda allo stesso indirizzo di "Casa Mario"
const casa = { id: 'h1', kind: 'home', name: 'Casa', holder: 'Mario Rossi', address: 'Via Roma 12, Milano', match: [] };
const mare = { id: 'h2', kind: 'home', name: 'Casa al mare', holder: 'Mario Rossi', address: 'Viale dei Pini 3, Rimini', match: [] };
const giulia = { id: 'h3', kind: 'home', name: 'Casa Giulia', holder: 'Giulia Bianchi', address: 'Via Verdi 5, Torino', match: [] };
const cond = { id: 'h4', kind: 'home', name: 'Studio Rossi', holder: 'Anna Rossi', address: 'Via Roma 12, Milano', match: [] };
const panda = { id: 'c1', kind: 'car', name: 'Panda', holder: 'Mario Rossi', match: ['AB 123 CD'] };

const doc = (holder, addr, extra = '') => ({ text: `Enel Energia\nIntestatario: ${holder}\nIndirizzo di fornitura: ${addr}\n${extra}`, category: 'luce', supplier: 'Enel', holder, supplyAddress: addr });

t('indirizzo e intestatario coincidono → assegnata', () => {
  const r = assignAsset(doc('ROSSI MARIO', 'VIA ROMA 12 20100 MILANO MI'), [casa, mare, giulia]);
  assert.equal(r.asset.id, 'h1'); assert.equal(r.reason, 'verified');
});
t('stesso titolare, due immobili: ciascuna utenza va al suo indirizzo', () => {
  assert.equal(assignAsset(doc('Mario Rossi', 'Viale dei Pini, 3 - 47921 Rimini'), [casa, mare]).asset.id, 'h2');
  assert.equal(assignAsset(doc('Mario Rossi', 'Via Roma n. 12 Milano'), [casa, mare]).asset.id, 'h1');
});
t('intestatario diverso allo stesso indirizzo → manuale', () => {
  const r = assignAsset(doc('Luigi Verdi', 'Via Roma 12 Milano'), [casa, mare]);
  assert.equal(r.asset, null); assert.equal(r.reason, 'holder-mismatch'); assert.deepEqual(r.candidates, ['h1']);
});
t('più intestatari allo stesso indirizzo → manuale (con suggerimento dall\'intestatario)', () => {
  const r = assignAsset(doc('Anna Rossi', 'Via Roma 12 Milano'), [casa, cond, mare]);
  assert.equal(r.asset, null); assert.equal(r.reason, 'shared-address');
  assert.deepEqual(r.candidates.sort(), ['h1', 'h4']); assert.equal(r.suggested, 'h4');
});
t('indirizzo condiviso e intestatario non riconoscibile → manuale senza suggerimento', () => {
  const r = assignAsset(doc('Qualcuno Altro', 'Via Roma 12 Milano'), [casa, cond]);
  assert.equal(r.reason, 'shared-address'); assert.equal(r.suggested, null);
});
t('indirizzo del documento non registrato → manuale, mai a caso', () => {
  const r = assignAsset(doc('Mario Rossi', 'Via Dante 9 Roma'), [casa, mare]);
  assert.equal(r.asset, null); assert.equal(r.reason, 'address-unknown');
});
t('civico diverso non coincide (12 ≠ 123)', () => {
  assert.equal(matchAddress('Via Roma 123 Milano', 'Via Roma 12, Milano'), false);
  assert.equal(matchAddress('Via Roma 12/A Milano', 'Via Roma 12, Milano'), true);
  assert.equal(matchAddress('V.le dei Pini 3', 'Viale dei Pini 3'), true);
});
t('città diversa non coincide', () => assert.equal(matchAddress('Via Roma 12 Napoli', 'Via Roma 12, Milano'), false));
t('nome: ordine libero, maiuscole e accenti indifferenti', () => {
  assert.equal(matchHolder('Intestatario ROSSI MARIO', 'Mario Rossi'), true);
  assert.equal(matchHolder('Intestatario Rossi Luca', 'Mario Rossi'), false);
  assert.equal(matchHolder('qualsiasi', ''), null);
});
t('codice identificativo (targa) vince su tutto', () => {
  assert.equal(assignAsset({ text: 'Targa AB-123-CD', category: 'bollo' }, [casa, mare, panda]).asset.id, 'c1');
});
t('codici uguali su due beni → manuale', () => {
  const a = { id: 'x', kind: 'home', name: 'A', match: ['IT001E999'] }, b = { id: 'y', kind: 'home', name: 'B', match: ['IT001E999'] };
  assert.equal(assignAsset({ text: 'POD IT001E999' }, [a, b]).reason, 'ambiguous');
});
t('senza indirizzo né intestatario sul documento: un solo immobile → assegnata', () => {
  const r = assignAsset({ text: 'Canone fibra', category: 'internet', supplier: 'Fastweb' }, [casa, panda]);
  assert.equal(r.asset.id, 'h1'); assert.equal(r.reason, 'single');
});
t('senza indizi e due immobili → da assegnare', () => {
  assert.equal(assignAsset({ text: 'Canone fibra', category: 'internet' }, [casa, mare]).asset, null);
});
t('scelta imparata solo per beni senza indirizzo', () => {
  const loose = { id: 'l1', kind: 'home', name: 'Vecchia', match: [] }, loose2 = { id: 'l2', kind: 'home', name: 'Altra', match: [] };
  const rules = { [ruleKey('gas', 'Hera')]: 'l2' };
  assert.equal(assignAsset({ category: 'gas', supplier: 'Hera' }, [loose, loose2], rules).asset.id, 'l2');
  assert.equal(assignAsset({ category: 'gas', supplier: 'Hera' }, [casa, mare], { [ruleKey('gas', 'Hera')]: 'h1' }).asset, null);
});
t('un solo bene registrato con intestatario diverso sul documento → manuale', () => {
  const r = assignAsset({ text: 'x', category: 'luce', holder: 'Luigi Verdi' }, [casa]);
  assert.equal(r.asset, null); assert.equal(r.reason, 'holder-mismatch');
});
t('nessun bene → nessuna assegnazione; pickAsset restituisce solo il bene', () => {
  assert.equal(pickAsset({ text: 'x' }, []), null);
  assert.equal(pickAsset(doc('Mario Rossi', 'Via Roma 12 Milano'), [casa]).id, 'h1');
});
console.log(`\n${passed} test superati`);

// categorie da vettura / da immobile
import { KIND_BY_CATEGORY, setKinds } from '../src/assetmatch.js';
t('categoria vettura non finisce su un immobile', () => {
  const r = assignAsset({ text: 'Distributore Eni via Roma 5 rifornimento', category: 'carburante', supplyAddress: 'Via Roma 5' }, [casa, mare, panda]);
  assert.equal(r.asset.id, 'c1');
});
t('categoria immobile non finisce su una vettura', () => {
  const r = assignAsset({ text: 'fornitura luce', category: 'luce' }, [casa, panda]);
  assert.equal(r.asset.id, casa.id);
});
t('categoria personalizzata da vettura', () => {
  setKinds({ ...KIND_BY_CATEGORY, c_lavaggio: 'car' });
  assert.equal(assignAsset({ text: 'lavaggio', category: 'c_lavaggio' }, [casa, panda]).asset.id, 'c1');
});
