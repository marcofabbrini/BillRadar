import { zipSync, strToU8 } from 'fflate';
import assert from 'node:assert/strict';
import { expandInputs } from '../src/zipexpand.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const pdf = (s) => strToU8('%PDF-1.4 ' + s);
const zip = zipSync({ 'a/luce.pdf': pdf('1'), 'a/note.txt': strToU8('x'), '__MACOSX/._luce.pdf': pdf('2'), 'gas.PDF': pdf('3'), 'a/': new Uint8Array(0) });
t('zip: solo i PDF veri', () => {
  const r = expandInputs([{ name: 'bollette.zip', bytes: zip, mtime: 1 }]);
  assert.deepEqual(r.pdfs.map((p) => p.name).sort(), ['gas.PDF', 'luce.pdf']);
  assert.equal(r.ignored, 1);
});
t('PDF singolo + file estraneo', () => {
  const r = expandInputs([{ name: 'x.pdf', bytes: pdf('9') }, { name: 'foto.jpg', bytes: new Uint8Array([1, 2]) }]);
  assert.equal(r.pdfs.length, 1); assert.equal(r.ignored, 1);
});
t('.pdf che non è un PDF viene ignorato', () => {
  const r = expandInputs([{ name: 'finto.pdf', bytes: strToU8('ciao ciao') }]);
  assert.equal(r.pdfs.length, 0); assert.equal(r.ignored, 1);
});
t('zip dentro zip', () => {
  const outer = zipSync({ 'inner.zip': zip });
  assert.equal(expandInputs([{ name: 'o.zip', bytes: outer }]).pdfs.length, 2);
});
t('zip rotto → errore, nessun crash', () => {
  const r = expandInputs([{ name: 'rotto.zip', bytes: new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]) }]);
  assert.equal(r.errors.length, 1);
});
console.log(n + ' test ok');
