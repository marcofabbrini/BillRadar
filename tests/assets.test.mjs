import assert from 'node:assert/strict';
import { pickAsset, ruleKey } from '../src/assetmatch.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

const casa = { id: 'h1', kind: 'home', name: 'Casa', match: ['via roma 12', 'IT001E12345678'] };
const mare = { id: 'h2', kind: 'home', name: 'Casa al mare', match: ['via dei pini'] };
const panda = { id: 'c1', kind: 'car', name: 'Panda', match: ['AB 123 CD'] };

t('nessun bene → nessuna assegnazione', () => assert.equal(pickAsset({ text: 'x' }, []), null));
t('parola di riconoscimento nel testo', () => {
  assert.equal(pickAsset({ text: 'Fornitura presso VIA DEI PINI 3', category: 'luce' }, [casa, mare, panda]).id, 'h2');
});
t('targa scritta con spazi/trattini diversi', () => {
  assert.equal(pickAsset({ text: 'Targa AB-123-CD', category: 'bollo' }, [casa, mare, panda]).id, 'c1');
});
t('codice POD senza spazi', () => {
  assert.equal(pickAsset({ text: 'POD it001e12345678', category: 'luce' }, [casa, mare]).id, 'h1');
});
t('regola imparata (categoria + fornitore)', () => {
  const rules = { [ruleKey('luce', 'Enel Energia')]: 'h2' };
  assert.equal(pickAsset({ text: '', category: 'luce', supplier: 'Enel Energia' }, [casa, mare], rules).id, 'h2');
});
t('il testo vince sulla regola', () => {
  const rules = { [ruleKey('luce', 'Enel')]: 'h2' };
  assert.equal(pickAsset({ text: 'via roma 12', category: 'luce', supplier: 'Enel' }, [casa, mare], rules).id, 'h1');
});
t('un solo immobile → utenze assegnate, bollo no se ci sono più beni', () => {
  assert.equal(pickAsset({ category: 'gas' }, [casa, panda]).id, 'h1');
  assert.equal(pickAsset({ category: 'bollo' }, [casa, panda]).id, 'c1');
});
t('due immobili senza indizi → da assegnare', () => {
  assert.equal(pickAsset({ category: 'luce' }, [casa, mare, panda]), null);
});
t('un solo bene in assoluto → usato per tutto', () => {
  assert.equal(pickAsset({ category: 'altro' }, [casa]).id, 'h1');
});
t('regola verso un bene eliminato viene ignorata', () => {
  assert.equal(pickAsset({ category: 'luce', supplier: 'X' }, [casa, mare], { [ruleKey('luce', 'X')]: 'zzz' }), null);
});
console.log(`\n${passed} test superati`);
