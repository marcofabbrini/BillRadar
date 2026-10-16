import assert from 'node:assert/strict';
import { buildGmailQuery, invalidSenders, DEFAULT_SENDERS } from '../src/query.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

t('mittenti predefiniti', () => {
  assert.equal(buildGmailQuery({ senders: DEFAULT_SENDERS }),
    'has:attachment filename:pdf (from:noreply.enelenergia@enel.com OR from:contotelefonico@fatturazione.windtre.it)');
});
t('un solo mittente senza parentesi', () => {
  assert.equal(buildGmailQuery({ senders: ['a@b.it'] }), 'has:attachment filename:pdf from:a@b.it');
});
t('testi: almeno uno, tra virgolette', () => {
  assert.equal(buildGmailQuery({ senders: ['a@b.it'], keywords: ['la tua fattura', 'bolletta'] }),
    'has:attachment filename:pdf from:a@b.it ("la tua fattura" OR "bolletta")');
});
t('dominio intero', () => {
  assert.match(buildGmailQuery({ senders: ['@enel.com'] }), /from:@enel\.com/);
});
t('righe vuote, doppioni e spazi ignorati', () => {
  assert.equal(buildGmailQuery({ senders: ['  a@b.it ', '', 'a@b.it'], keywords: ['  ', ''] }), 'has:attachment filename:pdf from:a@b.it');
});
t('virgolette nei testi non rompono la ricerca', () => {
  assert.equal(buildGmailQuery({ senders: ['a@b.it'], keywords: ['dice "ciao"'] }), 'has:attachment filename:pdf from:a@b.it "dice ciao"');
});
t('parole generiche in alternativa ai mittenti', () => {
  const q = buildGmailQuery({ senders: ['a@b.it'], generic: true });
  assert.match(q, /\(from:a@b\.it OR \(bolletta OR fattura/);
});
t('niente impostato → parole generiche (mai tutti i PDF)', () => {
  assert.match(buildGmailQuery({}), /\(bolletta OR fattura/);
});
t('solo testi: nessun ripiego generico', () => {
  assert.equal(buildGmailQuery({ keywords: ['bolletta luce'] }), 'has:attachment filename:pdf "bolletta luce"');
});
t('indirizzi non validi segnalati e ignorati', () => {
  assert.deepEqual(invalidSenders(['ok@a.it', 'due parole', 'x)y@z.it']), ['due parole', 'x)y@z.it']);
  assert.equal(buildGmailQuery({ senders: ['due parole', 'ok@a.it'] }), 'has:attachment filename:pdf from:ok@a.it');
});
console.log(`\n${passed} test superati`);
