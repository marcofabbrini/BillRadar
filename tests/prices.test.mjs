import assert from 'node:assert/strict';
import { groupContracts, analyzeBill, priceTrend, annualUnits, compareOffer, parseOffer, contractKey } from '../src/prices.js';
import { extractBreakdown, extractPointCode } from '../src/parser.js';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

const BILL = `Enel Energia
Codice POD IT001E12345678
Spesa per la materia energia (dal 01/07/2026 al 31/08/2026)   € 41,20
Spesa per il trasporto e la gestione del contatore   € 12,10
Spesa per oneri di sistema   € 9,80
Totale imposte e IVA   € 14,20
Totale da pagare € 77,30`;

t('POD e PDR', () => {
  assert.equal(extractPointCode(BILL), 'IT001E12345678');
  assert.equal(extractPointCode('Punto di riconsegna (PDR): 12345678901234'), '12345678901234');
  assert.equal(extractPointCode('niente'), null);
});
t('scomposizione ARERA (date tra parentesi ignorate)', () => {
  assert.deepEqual(extractBreakdown(BILL, 77.3), { materia: 41.2, trasporto: 12.1, oneri: 9.8, imposte: 14.2 });
});
t('valore sulla riga successiva', () => {
  assert.equal(extractBreakdown('Spesa per la materia gas naturale\n120,50', 300).materia, 120.5);
});
t('somma incoerente col totale → nessuna scomposizione', () => {
  assert.equal(extractBreakdown('Spesa per oneri di sistema € 900,00', 50), null);
  assert.equal(extractBreakdown('testo qualsiasi', 50), null);
});

const mk = (o) => ({ category: 'luce', supplier: 'Enel Energia', assetId: 'h1', amount: 77.3, consumption: 301, issueDate: '2026-10-14', periodFrom: '2026-08-01', periodTo: '2026-09-30', ...o });
t('prezzo finito = totale / consumo, con scomposizione', () => {
  const a = analyzeBill(mk({ breakdown: { materia: 41.2, trasporto: 12.1, oneri: 9.8, imposte: 14.2 } }));
  assert.ok(Math.abs(a.finished - 77.3 / 301) < 1e-9);
  assert.equal(a.parts.length, 4);                       // 41.2+12.1+9.8+14.2 = 77.3 → nessuna "altre voci"
  assert.ok(Math.abs(a.exTax - (77.3 - 14.2) / 301) < 1e-9);
  assert.ok(Math.abs(a.materiaPerUnit - 41.2 / 301) < 1e-9);
});
t('voci mancanti → "altre voci" per la differenza', () => {
  const a = analyzeBill(mk({ breakdown: { materia: 41.2, imposte: 14.2 } }));
  assert.equal(a.parts.at(-1).key, 'altro'); assert.ok(Math.abs(a.parts.at(-1).amount - 21.9) < 1e-9);
});
t('senza scomposizione: solo prezzo finito', () => {
  const a = analyzeBill(mk({})); assert.equal(a.hasBreakdown, false); assert.ok(a.finished > 0);
});

t('contratti: stesso POD insieme, immobili/fornitori diversi separati; l\'ultima bolletta è la più recente', () => {
  const bills = [
    mk({ id: 1, pointCode: 'IT001E1', periodTo: '2026-03-31', issueDate: '2026-04-10' }),
    mk({ id: 2, pointCode: 'IT001E1', supplier: 'Altro nome', periodTo: '2026-09-30' }),
    mk({ id: 3, assetId: 'h2', supplier: 'Enel Energia', pointCode: null }),
    mk({ id: 4, category: 'gas', supplier: 'Hera', consumption: 90 }),
    mk({ id: 5, category: 'internet', consumption: null }),
    mk({ id: 6, category: 'gse' }),
  ];
  const c = groupContracts(bills);
  assert.equal(c.length, 3);
  const pod = c.find((x) => x.pointCode === 'IT001E1');
  assert.equal(pod.bills.length, 2); assert.equal(pod.last.id, 2);
  assert.notEqual(contractKey(mk({ assetId: 'h1' })), contractKey(mk({ assetId: 'h2' })));
});
t('andamento del prezzo e variazione sull\'ultima', () => {
  const c = groupContracts([mk({ id: 1, periodTo: '2026-03-31', amount: 60, consumption: 300 }), mk({ id: 2, periodTo: '2026-05-31', amount: 66, consumption: 300 })])[0];
  const tr = priceTrend(c);
  assert.equal(tr.pts.length, 2); assert.ok(Math.abs(tr.deltaPct - 10) < 1e-9);
});
t('consumo annuo dai periodi coperti', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const m = String(2 * i + 1).padStart(2, '0'), e = String(2 * i + 2).padStart(2, '0');
    rows.push(mk({ id: i, periodFrom: `2025-${m}-01`, periodTo: `2025-${e}-${e === '02' ? '28' : e === '04' || e === '06' || e === '09' || e === '11' ? '30' : '31'}`, consumption: 300 }));
  }
  const c = groupContracts(rows)[0];
  assert.ok(Math.abs(annualUnits(c) - 1800) <= 5);
});
t('confronto sulla sola materia prima', () => {
  const c = groupContracts([mk({ breakdown: { materia: 60.2, trasporto: 12, oneri: 9, imposte: 14 }, amount: 95.2, consumption: 301 })])[0];
  const r = compareOffer(c, { priceUnit: 0.15, fixedMonthly: 8 }, 1800);
  assert.ok(Math.abs(r.currentYear - 1800 * (60.2 / 301)) < 1e-6);
  assert.ok(Math.abs(r.offerYear - (1800 * 0.15 + 96)) < 1e-6);
  assert.ok(Math.abs(r.delta - (r.offerYear - r.currentYear)) < 1e-9);
  const noBd = compareOffer(groupContracts([mk({})])[0], { priceUnit: 0.15 }, 1800);
  assert.equal(noBd.comparable, false); assert.equal(noBd.delta, null);
});

t('offerta luce: prezzo, quota fissa, validità, nome', () => {
  const o = parseOffer(`Offerta Luce Flex Casa
Fornitore: Octopus Energy
Prezzo energia: 0,1180 €/kWh
Spesa per trasporto: 0,0450 €/kWh
Corrispettivo di commercializzazione (PCV): 9,90 €/mese
Offerta valida fino al 30/11/2026`);
  assert.equal(o.category, 'luce'); assert.equal(o.priceUnit, 0.118); assert.equal(o.fixedMonthly, 9.9);
  assert.equal(o.validUntil, '2026-11-30'); assert.equal(o.name, 'Luce Flex Casa'); assert.equal(o.supplier, 'Octopus');
});
t('offerta gas con quota annua e prezzo prima dell\'unità', () => {
  const o = parseOffer('Offerta Gas Fisso 12\nPrezzo gas naturale 0,4520 €/Smc\nQuota fissa 96,00 €/anno\nPrezzo fisso per 12 mesi');
  assert.equal(o.category, 'gas'); assert.equal(o.priceUnit, 0.452); assert.equal(o.fixedMonthly, 8); assert.equal(o.kind, 'fisso');
});
t('offerta indicizzata e testo non riconosciuto', () => {
  assert.equal(parseOffer('Prezzo PUN + spread 0,0300 €/kWh').kind, 'variabile');
  const n = parseOffer('lorem ipsum'); assert.equal(n.category, null); assert.equal(n.priceUnit, null);
});
console.log(`\n${passed} test superati`);
