import './style.css';
import { cats, loadCategories, addCategory, removeCategory } from './categories.js';
import { db, listBills, addBill, updateBill, deleteBill, exportAll, importAll, wipeAll, billsToCSV, getKV, setKV } from './db.js';
import { SETTINGS_SCHEMA, getSetting, setSetting, allSettings } from './settings.js';
import { eur, num, MONTH_LABELS, years, monthlyByCategory, totals, consumption, yoy, upcoming } from './stats.js';
import * as gmail from './gmail.js';
import * as drive from './drive.js';
import { renderPdf, pdfToText } from './pdf.js';
import { pushWidget } from './widget.js';
import { buildGmailQuery, invalidSenders } from './query.js';
import { assets, assetById, assetLabel, loadAssets, saveAsset, removeAsset, countUnassigned, assignAllUnassigned, learnAssignment, reverifyBills, KIND_LABEL, KIND_ICON } from './assets.js';
import { REASON_TEXT } from './assetmatch.js';
import { groupContracts, analyzeBill as priceOf, priceTrend, annualUnits, compareOffer, parseOffer } from './prices.js';
import { analyzeMany } from './priceops.js';
import { listOffers, addOffer, updateOffer, deleteOffer } from './db.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const state = { asset: 'all', newIds: new Set(), cat: { id: null, y: 'all', m: 'all' }, year: new Date().getFullYear(), filter: 'all', q: '', statCat: 'luce', hidden: new Set(), openSet: new Set() };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cat = (id) => cats()[id] || { label: 'Altro', icon: '📄', color: '#888', kind: 'cost', unit: '' };
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '—');

function emptyState(title, text) {
  return `<div class="empty"><div class="radar-ico"><img src="./logo-symbol.png" alt=""></div><b>${title}</b><div>${text}</div></div>`;
}

// numeri che "salgono" fino al valore finale
function animateCounts() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  view.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target) || target === 0) return;
    const t0 = performance.now(), dur = 900 + Math.min(600, Math.abs(target) / 20);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = eur(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick); else el.textContent = eur(target);
    };
    requestAnimationFrame(tick);
  });
}

function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- grafici SVG ----------
const CH = { W: 340, H: 200, L: 42, R: 12, T: 14, B: 24 };
let chartCtx = null;

/** Curva cubica monotona (Fritsch–Carlson): morbida e senza sovra-oscillazioni. */
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i][0] + h)},${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
}
function niceMax(v) {
  const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
const chartX = (m) => CH.L + ((CH.W - CH.L - CH.R) * m) / 11;

// ---------- filtro per immobile / vettura ----------
const applyAsset = (bills) => (state.asset === 'all' ? bills : state.asset === 'none' ? bills.filter((b) => !b.assetId) : bills.filter((b) => b.assetId === state.asset));
const assetOptions = (value, { all = '🏠🚗 Tutti', none = true, placeholder = null, only = null } = {}) => {
  const grp = (kind, label) => {
    if (only && only !== kind) return '';
    const l = assets().filter((a) => a.kind === kind);
    return l.length ? `<optgroup label="${label}">${l.map((a) => `<option value="${a.id}" ${a.id === value ? 'selected' : ''}>${esc(assetLabel(a))}</option>`).join('')}</optgroup>` : '';
  };
  return (placeholder ? `<option value="">${placeholder}</option>` : `<option value="all" ${value === 'all' ? 'selected' : ''}>${all}</option>`)
    + grp('home', 'Immobili') + grp('car', 'Vetture')
    + (none && !placeholder ? `<option value="none" ${value === 'none' ? 'selected' : ''}>Senza assegnazione</option>` : '');
};
/** Selettore del bene (mostrato solo se ne esiste almeno uno). */
const assetSelect = (id = 'as') => (assets().length ? `<select id="${id}" aria-label="Immobile o vettura">${assetOptions(state.asset)}</select>` : '');
const bindAssetSelect = (rerender, id = 'as') => {
  const el = $(`#${id}`);
  if (el) el.onchange = async (e) => { state.asset = e.target.value; await setKV('ui.asset', state.asset); rerender(); };
};
const assetTag = (b) => {
  if (!assets().length) return '';
  const a = assetById(b.assetId);
  return a ? `<span class="tag2">${esc(assetLabel(a))}</span>` : '<span class="tag">da assegnare</span>';
};

let chartMax = 1;
function lineChart(byCat, vis) {
  const { W, H, L, R, T, B } = CH;
  const max = niceMax(Math.max(1, ...vis.flatMap((id) => byCat[id] || [])));
  chartMax = max;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4, yy = y(v);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-dasharray="${i ? '3 4' : ''}"/>`;
    g += `<text x="${L - 6}" y="${yy + 3}" text-anchor="end">${num(v)}€</text>`;
  }
  for (let m = 0; m < 12; m++) g += `<text x="${chartX(m)}" y="${H - 7}" text-anchor="middle">${MONTH_LABELS[m]}</text>`;
  if (!vis.length) g += `<text x="${W / 2}" y="${H / 2 - 4}" text-anchor="middle" style="font-size:12px">Tocca la legenda per mostrare le serie</text>`;
  vis.forEach((id, k) => {
    const c = cat(id).color;
    const pts = (byCat[id] || []).map((v, m) => (v > 0 ? [chartX(m), y(v)] : null)).filter(Boolean);
    if (pts.length >= 2) g += `<path class="ln" pathLength="1" d="${smoothPath(pts)}" stroke="${c}" style="color:${c};--d:${k * 90}ms"/>`;
    // niente pallini sui mesi (lettura più pulita); solo se la serie ha un unico punto, altrimenti non si vedrebbe
    if (pts.length === 1) g += `<circle class="pt" cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="3.4" fill="${c}" style="--d:${k * 90 + 700}ms"/>`;
  });
  g += `<line class="guide" y1="${T}" y2="${H - B}" stroke="var(--acc)" stroke-width="1" visibility="hidden"/><g class="marks"></g>`;
  g += `<rect class="hit" x="${L}" y="0" width="${W - L}" height="${H}" fill="transparent"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Spesa mensile per categoria">${g}</svg>`;
}

/** Disegna grafico + legenda cliccabile (tocca una voce per nascondere/mostrare la serie). */
function paintChart() {
  const box = $('#chartBox');
  if (!box || !chartCtx) return;
  const { byCat, ids, hasData } = chartCtx;
  if (!hasData) { box.innerHTML = emptyState('Nessun dato ancora', 'Collega Gmail, poi "Sincronizza storico" in Impostazioni; ⟳ controlla le nuove.'); return; }
  const vis = ids.filter((id) => !state.hidden.has(id));
  box.innerHTML = `<div class="chartwrap">${lineChart(byCat, vis)}<div class="tip" hidden></div></div>
    <div class="legend">${ids.map((id) => `<button class="lg ${state.hidden.has(id) ? 'off' : ''}" data-id="${id}" aria-pressed="${!state.hidden.has(id)}"><i style="background:${cat(id).color};color:${cat(id).color}"></i>${esc(cat(id).label)}</button>`).join('')}${state.hidden.size ? '<button class="lg all" data-all>Mostra tutte</button>' : ''}</div>`;

  box.querySelectorAll('.lg').forEach((b) => (b.onclick = async () => {
    if (b.dataset.all !== undefined) state.hidden.clear();
    else if (state.hidden.has(b.dataset.id)) state.hidden.delete(b.dataset.id); else state.hidden.add(b.dataset.id);
    await setKV('ui.hiddenSeries', [...state.hidden]);
    paintChart();
  }));

  // tooltip al tocco / passaggio del mouse
  const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), guide = svg.querySelector('.guide');
  const marks = svg.querySelector('.marks');
  const hide = () => { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); marks.innerHTML = ''; };
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * CH.W;
    const m = Math.max(0, Math.min(11, Math.round((px - CH.L) / ((CH.W - CH.L - CH.R) / 11))));
    const rows = vis.filter((id) => (byCat[id]?.[m] || 0) > 0);
    if (!rows.length) return hide();
    const gx = chartX(m);
    guide.setAttribute('x1', gx); guide.setAttribute('x2', gx); guide.setAttribute('visibility', 'visible');
    // il punto compare solo sul mese toccato
    const yv = (v) => CH.T + (CH.H - CH.T - CH.B) * (1 - v / chartMax);
    marks.innerHTML = rows.map((id) => `<circle cx="${gx.toFixed(1)}" cy="${yv(byCat[id][m]).toFixed(1)}" r="4" fill="${cat(id).color}" stroke="var(--bg, #06121f)" stroke-width="1.5"/>`).join('');
    tip.innerHTML = `<b>${MONTH_LABELS[m]} ${state.year}</b>${rows.map((id) => `<span><i style="background:${cat(id).color}"></i>${esc(cat(id).label)}<em>${eur(byCat[id][m])}</em></span>`).join('')}`;
    tip.hidden = false;
    tip.style.left = `${Math.max(80, Math.min(r.width - 80, (gx / CH.W) * r.width))}px`;
  };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(e); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}

function simpleBars(vals, color) {
  const W = 340, H = 150, pad = 4, bw = (W - pad) / 12, max = Math.max(1, ...vals);
  let g = '';
  vals.forEach((v, m) => {
    const h = (v / max) * (H - 30);
    g += `<rect class="bar" style="--m:${m}" x="${pad + m * bw + 3}" y="${H - 16 - h}" width="${bw - 6}" height="${h}" rx="3" fill="${color}"/>`;
    g += `<text x="${pad + m * bw + bw / 2}" y="${H - 3}" text-anchor="middle">${MONTH_LABELS[m][0]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>`;
}

async function enabledCats() {
  const out = [];
  for (const id of Object.keys(cats())) if ((await getSetting(`cat.${id}`)) !== false) out.push(id);
  return out;
}

// ---------- Home ----------
async function renderHome() {
  const allBills = await listBills();
  const bills = applyAsset(allBills);
  const unassigned = assets().length ? allBills.filter((b) => !b.assetId).length : 0;
  const ids = await enabledCats();
  const ys = years(bills);
  if (!ys.includes(state.year)) state.year = ys[0];
  const t = totals(bills, state.year), y = yoy(bills, state.year);
  const byCat = monthlyByCategory(bills, state.year);
  const next = upcoming(bills);
  const review = bills.filter((b) => b.needsReview).length;

  const reauth = await gmail.needsReauth();
  const fresh = await getKV('ui.newBills', []);
  const freshTxt = (() => {
    const by = {};
    fresh.forEach((x) => { by[x.category] = (by[x.category] || 0) + 1; });
    return Object.entries(by).map(([id, n]) => `${n} ${cat(id).label}`).join(', ');
  })();
  view.innerHTML = `
    ${reauth ? '<div class="card" style="border-color:var(--bad)"><b>Gmail non è più collegato.</b> <button class="btn" id="reauth" style="margin-top:8px;width:100%">Riconnetti Gmail</button></div>' : ''}
    ${fresh.length ? `<div class="card notice enter" style="--i:0"><div class="nt"><span class="bell">🔔</span><div><b>${fresh.length} ${fresh.length > 1 ? 'nuove bollette' : 'nuova bolletta'}</b><div class="s">${esc(freshTxt)}</div></div></div>
      <div class="nb"><button class="btn" id="nSee">Vedi</button><button class="btn sec" id="nOk">Ok</button></div></div>` : ''}
    ${unassigned ? `<div class="card enter" style="--i:1"><b>${unassigned}</b> bollett${unassigned > 1 ? 'e' : 'a'} senza immobile o vettura <a href="#/docs" data-filter="unassigned" style="float:right">Assegna →</a></div>` : ''}
    <div class="${assets().length ? 'grid2' : ''}" style="margin:0"><select id="yr" aria-label="Anno">${ys.map((v) => `<option ${v === state.year ? 'selected' : ''}>${v}</option>`).join('')}</select>${assetSelect()}</div>
    <div class="grid enter" style="margin-top:12px;--i:1">
      <div class="kpi glow"><small>Spese ${state.year}</small><b data-count="${t.spese}">${eur(t.spese)}</b>
        ${y.pct != null ? `<small class="${y.pct > 0 ? 'neg' : 'pos'}">${y.pct > 0 ? '▲' : '▼'} ${num(Math.abs(y.pct), 1)}% vs ${state.year - 1}</small>` : '<small>&nbsp;</small>'}</div>
      <div class="kpi"><small>Acconti GSE</small><b class="pos" data-count="${t.entrate}">${eur(t.entrate)}</b>
        <small>Saldo <span class="${t.saldo >= 0 ? 'pos' : 'neg'}">${eur(t.saldo)}</span></small></div>
    </div>
    ${review ? `<div class="card enter" style="--i:2"><b>${review}</b> document${review > 1 ? 'i' : 'o'} da verificare <a href="#/docs" data-filter="review" style="float:right">Apri →</a></div>` : ''}
    <div class="card enter" style="--i:2"><h3>Spesa mensile</h3><div id="chartBox"></div></div>
    <div class="card enter" style="--i:3"><h3>Per categoria</h3>${[...ids, ...(t.perCategoria.altro ? ['altro'] : [])].map((id) => {
      const v = t.perCategoria[id] || 0;
      return `<div class="row tap" data-cat="${id}" role="button" tabindex="0"><div class="ico" style="background:${cat(id).color}22">${cat(id).icon}</div><div class="grow"><div class="t">${cat(id).label}</div></div><b class="${cat(id).kind === 'income' ? 'pos' : ''}" data-count="${v}">${eur(v)}</b><span class="go">›</span></div>`;
    }).join('')}</div>
    ${next.length ? `<div class="card enter" style="--i:4"><h3>Prossime scadenze</h3>${next.slice(0, 5).map((b) => billRow(b, true)).join('')}</div>` : ''}`;
  $('#yr').onchange = (e) => { state.year = Number(e.target.value); renderHome(); };
  bindAssetSelect(renderHome);
  if (reauth) $('#reauth').onclick = () => runAction('action.connect');
  if (fresh.length) {
    $('#nOk').onclick = async () => { await setKV('ui.newBills', []); renderHome(); };
    $('#nSee').onclick = async () => { state.newIds = new Set(fresh.map((x) => x.id)); state.filter = 'new'; await setKV('ui.newBills', []); location.hash = '#/docs'; };
  }
  view.querySelectorAll('.row[data-cat]').forEach((r) => (r.onclick = () => { state.cat = { id: r.dataset.cat, y: String(state.year), m: 'all' }; location.hash = `#/cat/${r.dataset.cat}`; }));
  view.querySelectorAll('.row[data-id]').forEach((r) => (r.onclick = () => openBill(Number(r.dataset.id))));
  chartCtx = { byCat, ids, hasData: bills.length > 0 };
  paintChart();
  animateCounts();
}

function billRow(b, showDue = false) {
  const c = cat(b.category);
  const sub = showDue ? `Scade ${fmtDate(b.dueDate)}` : `${fmtDate(b.issueDate)} · ${esc(b.supplier || b.fileName || '')}`;
  return `<div class="row" data-id="${b.id}"><div class="ico" style="background:${c.color}22">${c.icon}</div>
    <div class="grow"><div class="t">${c.label}${b.needsReview ? ' <span class="tag">verifica</span>' : ''} ${assetTag(b)}</div><div class="s">${sub}</div></div>
    <b class="${c.kind === 'income' ? 'pos' : ''}">${c.kind === 'income' ? '+' : ''}${eur(b.amount)}</b></div>`;
}

// ---------- Documenti ----------
async function renderDocs() {
  const bills = applyAsset(await listBills());
  const ids = await enabledCats();
  const f = state.filter;
  const q = state.q.toLowerCase();
  const rows = bills.filter((b) => (f === 'all' || (f === 'review' ? b.needsReview : f === 'new' ? state.newIds.has(b.id) : f === 'unassigned' ? !b.assetId : b.category === f))
    && (!q || `${b.supplier} ${b.fileName} ${b.invoiceNumber} ${b.subject}`.toLowerCase().includes(q)));
  view.innerHTML = `
    <input type="search" id="q" placeholder="Cerca fornitore, numero…" value="${esc(state.q)}">
    ${assets().length ? `<div style="margin-top:10px">${assetSelect()}</div>` : ''}
    <div class="chips" style="margin-top:10px">
      ${[['all', 'Tutti'], ...(state.newIds.size ? [['new', 'Nuove']] : []), ...(assets().length ? [['unassigned', 'Da assegnare']] : []), ['review', 'Da verificare'], ...ids.map((id) => [id, cat(id).label])].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
    </div>
    <div class="card enter" style="--i:1">${rows.length ? rows.map((b) => billRow(b)).join('') : emptyState('Nessun documento', 'Qui compariranno le bollette trovate in Gmail.')}</div>
    <button class="btn" id="add" style="width:100%">+ Aggiungi manualmente</button>`;
  bindAssetSelect(renderDocs);
  $('#q').oninput = (e) => { state.q = e.target.value; clearTimeout(renderDocs.t); renderDocs.t = setTimeout(renderDocs, 250); };
  view.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { state.filter = c.dataset.f; renderDocs(); }));
  view.querySelectorAll('.row[data-id]').forEach((r) => (r.onclick = () => openBill(Number(r.dataset.id))));
  $('#add').onclick = () => openBill(null);
}

const scopeOf = (category) => (cats()[category] ? (cats()[category].scope || 'home') : null);

async function openBill(id) {
  const b = id ? await db.bills.get(id) : { category: 'luce', issueDate: new Date().toISOString().slice(0, 10), source: 'manuale' };
  const dlg = $('#dlg');
  const canDrive = !!(id && b.pdf && !b.driveFileId && (await drive.isDriveEnabled()));
  const field = (k, label, type = 'text') => `<label>${label}</label><input type="${type}" data-k="${k}" ${type === 'number' ? 'step="0.01"' : ''} value="${esc(b[k] ?? '')}">`;
  dlg.innerHTML = `
    <h2 style="margin:0 0 4px">${id ? 'Dettaglio documento' : 'Nuovo documento'}</h2>
    <label>Categoria</label><select data-k="category">${['home', 'car'].map((sc) => `<optgroup label="${sc === 'car' ? 'Vetture' : 'Immobili'}">${Object.entries(cats()).filter(([, c]) => (c.scope || 'home') === sc).map(([k, c]) => `<option value="${k}" ${b.category === k ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</optgroup>`).join('')}<option value="altro" ${b.category === 'altro' ? 'selected' : ''}>📄 Altro</option></select>
    <label>Immobile / vettura <b style="color:var(--bad)">*</b></label>
    <select data-k="assetId" id="assetSel">${assetOptions(b.assetId || b.assetSuggest || (id ? '' : (assetById(state.asset) ? state.asset : '')), { only: scopeOf(b.category), placeholder: assets().length ? '— scegli a cosa si riferisce —' : '— nessuno: aggiungilo in Impostazioni —' })}</select>
    ${!b.assetId && b.assetNote ? `<div class="hint" style="color:var(--warn,#ffb938);margin-top:6px">${esc(REASON_TEXT[b.assetNote] || '')}${b.assetSuggest ? ` Suggerito: ${esc(assetLabel(assetById(b.assetSuggest)))} (intestatario coincidente): controlla e conferma.` : ''}</div>` : ''}
    ${field('holder', 'Intestatario (dal documento)')}${field('supplyAddress', 'Indirizzo fornitura (dal documento)')}
    ${field('supplier', 'Fornitore')}${field('amount', 'Importo (€)', 'number')}${field('consumption', 'Consumo', 'number')}
    ${field('issueDate', 'Data documento', 'date')}${field('periodFrom', 'Periodo da', 'date')}${field('periodTo', 'Periodo a', 'date')}
    ${field('dueDate', 'Scadenza', 'date')}${field('invoiceNumber', 'Numero documento')}
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-k="paid" ${b.paid ? 'checked' : ''}> Pagata</label>
    ${b.driveFileId ? `<div class="hint" style="margin-top:10px">☁️ Archiviato su Drive: ${esc(b.drivePath || 'BillRadar')}</div>` : ''}
    <div id="pdfbox" style="margin-top:10px"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="btn" id="save">Salva</button>
      ${b.pdf || b.driveFileId ? '<button class="btn sec" id="pdfBtn">Vedi PDF</button>' : ''}
      ${canDrive ? '<button class="btn sec" id="driveBtn">☁️ Salva su Drive</button>' : ''}
      ${id ? '<button class="btn danger" id="del">Elimina</button>' : ''}
      <button class="btn sec" id="close">Chiudi</button></div>`;
  dlg.showModal();
  // cambiando categoria si propongono solo immobili (luce, gas…) o solo vetture (bollo, carburante…)
  const catSel = dlg.querySelector('[data-k=category]'), astSel = $('#assetSel', dlg);
  const ph = astSel.options[0]?.value === '' ? astSel.options[0].textContent : '— scegli a cosa si riferisce —';
  catSel.onchange = () => {
    const keep = astSel.value, only = scopeOf(catSel.value);
    astSel.innerHTML = assetOptions(keep, { only, placeholder: ph });
    if (!astSel.value) astSel.value = '';
  };
  $('#close', dlg).onclick = () => dlg.close();
  if (canDrive) $('#driveBtn', dlg).onclick = async () => {
    try {
      const { fileId, path } = await drive.archiveBill(b, b.pdf);
      await updateBill(id, { driveFileId: fileId, drivePath: path });
      dlg.close(); toast(`Salvato su Drive: ${path}`); route();
    } catch (e) { toast(e.message, 7000); }
  };
  if (b.pdf || b.driveFileId) $('#pdfBtn', dlg).onclick = async () => {
    try {
      const blob = b.pdf || await drive.downloadPdf(b);   // PDF non più sul telefono: lo scarica da Drive
      await renderPdf(await blob.arrayBuffer(), $('#pdfbox', dlg));
    } catch (e) { toast(e.message, 6000); }
  };
  if (id) $('#del', dlg).onclick = async () => { if (confirm('Eliminare questo documento?')) { await deleteBill(id); dlg.close(); route(); } };
  $('#save', dlg).onclick = async () => {
    const patch = {};
    dlg.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      patch[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : (el.value || null);
    });
    // il tag è obbligatorio: ogni bolletta deve riferirsi a un immobile o a una vettura
    if (!assets().length) { toast('Aggiungi prima un immobile o una vettura in Impostazioni', 5000); return; }
    if (!patch.assetId) { const sel = $('#assetSel', dlg); sel.classList.add('invalid'); sel.focus(); toast('Scegli a quale immobile o vettura si riferisce', 4000); return; }
    patch.unit = cat(patch.category).unit;
    patch.needsReview = false;
    patch.assetBy = 'manual'; patch.assetNote = null; patch.assetSuggest = null;   // scelta confermata dall'utente
    const savedId = id || await addBill({ ...b, ...patch });
    if (id) await updateBill(id, patch);
    let note = '';
    // ricorda la scelta (categoria + fornitore → bene) e la applica alle bollette simili ancora senza bene
    const similar = await learnAssignment({ ...b, ...patch, id: savedId }, patch.assetId);
    if (similar) note += ` · assegnata anche ad altre ${similar} simili`;
    if (id && b.driveFileId && (await drive.isDriveEnabled())) {
      // dati cambiati → il file su Drive viene rinominato/spostato di conseguenza
      try {
        const r = await drive.archiveBill({ ...b, ...patch }, b.pdf);
        if (r) await updateBill(id, { driveFileId: r.fileId, drivePath: r.path });
      } catch (e) { note += ` (Drive non aggiornato: ${e.message})`; }
    }
    dlg.close(); toast(`Salvato${note}`, note ? 7000 : 2500); route();
  };
}

// ---------- Statistiche ----------
async function renderStats() {
  const bills = applyAsset(await listBills());
  const ids = await enabledCats();
  const ys = years(bills);
  if (!ys.includes(state.year)) state.year = ys[0];
  if (!ids.includes(state.statCat)) state.statCat = ids[0];
  const c = cat(state.statCat);
  const byCat = monthlyByCategory(bills, state.year);
  const cons = consumption(bills, state.statCat, state.year);
  const tot = byCat[state.statCat].reduce((a, b) => a + b, 0);
  const luceCost = byCat.luce.reduce((a, b) => a + b, 0), gseIn = byCat.gse.reduce((a, b) => a + b, 0);

  view.innerHTML = `
    <div style="display:flex;gap:8px"><select id="cat">${ids.map((id) => `<option value="${id}" ${id === state.statCat ? 'selected' : ''}>${cat(id).icon} ${cat(id).label}</option>`).join('')}</select>
    <select id="yr" style="width:110px">${ys.map((v) => `<option ${v === state.year ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    ${assets().length ? `<div style="margin-top:8px">${assetSelect()}</div>` : ''}
    <div class="card enter" style="margin-top:12px;--i:1"><h3>${c.kind === 'income' ? 'Entrate' : 'Spesa'} mensile · ${state.year}</h3>${simpleBars(byCat[state.statCat], c.color)}
      <div class="grid" style="margin-top:8px"><div><small class="mut">Totale</small><br><b>${eur(tot)}</b></div><div><small class="mut">Media/mese</small><br><b>${eur(tot / 12)}</b></div></div></div>
    ${c.unit && cons.count ? `<div class="card enter" style="--i:2"><h3>Consumo (${c.unit})</h3>${simpleBars(cons.monthly, c.color)}
      <div class="grid" style="margin-top:8px"><div><small class="mut">Totale</small><br><b>${num(cons.qty, 1)} ${c.unit}</b></div>
      <div><small class="mut">Prezzo medio</small><br><b>${cons.avgPrice != null ? eur(cons.avgPrice) + '/' + c.unit : '—'}</b></div></div></div>` : ''}
    ${ids.includes('gse') && ids.includes('luce') ? `<div class="card enter" style="--i:3"><h3>Fotovoltaico vs bollette luce</h3>
      <div class="row"><div class="grow">Costo luce</div><b>${eur(luceCost)}</b></div>
      <div class="row"><div class="grow">Acconti GSE</div><b class="pos">${eur(gseIn)}</b></div>
      <div class="row"><div class="grow"><b>Costo netto energia</b></div><b class="${luceCost - gseIn <= 0 ? 'pos' : ''}">${eur(luceCost - gseIn)}</b></div></div>` : ''}`;
  bindAssetSelect(renderStats);
  $('#cat').onchange = (e) => { state.statCat = e.target.value; renderStats(); };
  $('#yr').onchange = (e) => { state.year = Number(e.target.value); renderStats(); };
}

// ---------- Analisi prezzi ----------
const eurU = (v) => (v == null ? '—' : new Intl.NumberFormat('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(v));
const pct = (v) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(v * 100)}%`;
const unitOf = (category) => cats()[category]?.unit || 'unità';
const UNIT_NOTE = { gas: 'Smc = standard metro cubo, l\'unità con cui il gas viene fatturato (qui usato al posto del "mq").' };

function priceSpark(pts, color) {
  if (pts.length < 2) return '';
  const W = 320, H = 64, pad = 8, min = Math.min(...pts.map((p) => p.price)), max = Math.max(...pts.map((p) => p.price)), span = max - min || 1;
  const xy = pts.map((p, i) => [pad + ((W - 2 * pad) * i) / (pts.length - 1), H - pad - ((H - 2 * pad) * (p.price - min)) / span]);
  const [lx, ly] = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Andamento del prezzo finito"><path d="${smoothPath(xy)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="3.6" fill="${color}"/>
    <text x="${pad}" y="${H - 1}" font-size="9.5" fill="currentColor" opacity=".6">${eurU(pts[0].price)}</text><text x="${W - pad}" y="${H - 1}" text-anchor="end" font-size="9.5" fill="currentColor" opacity=".6">${eurU(pts[pts.length - 1].price)}</text></svg>`;
}

function contractCard(c, i) {
  const cc = cat(c.category), a = priceOf(c.last), tr = priceTrend(c), asset = assetById(c.assetId), u = cc.unit;
  const period = c.last.periodFrom && c.last.periodTo ? ` · ${fmtDate(c.last.periodFrom)} – ${fmtDate(c.last.periodTo)}` : '';
  const delta = tr.deltaPct == null ? '' : `<span class="${tr.deltaPct > 0.05 ? 'neg' : tr.deltaPct < -0.05 ? 'pos' : ''}">${tr.deltaPct > 0 ? '▲' : tr.deltaPct < 0 ? '▼' : '•'} ${num(Math.abs(tr.deltaPct), 1)}% sulla precedente</span>`;
  const parts = a.hasBreakdown ? `<div class="stack" role="img" aria-label="Scomposizione dei costi">${a.parts.map((p) => `<i style="flex:${p.amount};background:${p.color}" title="${esc(p.label)}"></i>`).join('')}</div>
    ${a.parts.map((p) => `<div class="row pr"><span class="catdot" style="background:${p.color}"></span><div class="grow"><div class="t">${esc(p.label)}</div><div class="s">${eur(p.amount)} · ${pct(p.share)} della bolletta</div></div><b>${eurU(p.perUnit)}<small> €/${u}</small></b></div>`).join('')}
    ${a.exTax != null ? `<div class="hint" style="margin-top:6px">Al netto di imposte e IVA: <b>${eurU(a.exTax)} €/${u}</b></div>` : ''}`
    : `<div class="hint" style="margin-top:8px">Nel PDF non ho trovato le voci di costo (materia prima, trasporto, oneri, imposte): vedi solo il prezzo finito.</div>`;
  return `<div class="card enter price-card" style="--i:${i + 1}">
    <div class="row" style="border:0;padding-top:0"><div class="ico" style="background:${cc.color}22">${cc.icon}</div>
      <div class="grow"><div class="t">${esc(cc.label)}${c.supplier ? ` · ${esc(c.supplier)}` : ''}</div><div class="s">${asset ? esc(assetLabel(asset)) + ' · ' : ''}bolletta del ${fmtDate(c.last.issueDate)}${c.pointCode ? ` · ${esc(c.pointCode)}` : ''}</div></div></div>
    <div class="big"><b data-count-u="${a.finished}">${eurU(a.finished)}</b><span>€/${u}</span><small>prezzo finito, tutto compreso</small></div>
    <div class="s">${eur(a.total)} ÷ ${num(a.units, 1)} ${u}${period}</div>
    ${UNIT_NOTE[c.category] ? `<div class="hint">${UNIT_NOTE[c.category]}</div>` : ''}
    ${parts}
    ${tr.pts.length > 1 ? `<div style="margin-top:12px"><div class="s">Prezzo finito nelle ultime ${tr.pts.length} bollette · ${delta}</div>${priceSpark(tr.pts, cc.color)}</div>` : ''}
  </div>`;
}

function offerLine(o) {
  const u = unitOf(o.category), cc = cats()[o.category];
  return `<div class="row tap" data-offer="${o.id}" role="button" tabindex="0"><div class="ico" style="background:${(cc?.color || '#6b8497')}22">${cc?.icon || '📄'}</div>
    <div class="grow"><div class="t">${esc(o.supplier || 'Fornitore')}${o.name ? ` · ${esc(o.name)}` : ''}${o.kind ? ` <span class="tag2">${o.kind}</span>` : ''}</div>
    <div class="s">${o.priceUnit != null ? `${eurU(o.priceUnit)} €/${u}` : 'prezzo da inserire'}${o.fixedMonthly ? ` · ${eur(o.fixedMonthly)}/mese` : ''}${o.validUntil ? ` · valida fino al ${fmtDate(o.validUntil)}` : ''}</div></div><span class="go">›</span></div>`;
}

async function comparisonCard(c, offers, i) {
  const cc = cat(c.category), u = cc.unit, asset = assetById(c.assetId);
  const opts = offers.filter((o) => o.category === c.category && o.priceUnit != null);
  if (!opts.length) return '';
  const guess = annualUnits(c) ?? Math.round(c.last.consumption * 6);
  const units = Number(await getKV(`price.units.${c.key}`, guess)) || guess;
  const a = priceOf(c.last);
  const rows = opts.map((o) => ({ o, r: compareOffer(c, o, units) })).sort((x, y) => (x.r.offerYear ?? 1e12) - (y.r.offerYear ?? 1e12));
  const cur = rows[0]?.r.currentYear;
  const best = rows[0];
  const verdict = cur != null && best.r.delta != null
    ? (best.r.delta < -0.5 ? `<div class="verdict good">La migliore offerta ti farebbe risparmiare circa <b>${eur(-best.r.delta)}</b> l'anno sulla materia prima.</div>`
      : `<div class="verdict">Nessuna offerta caricata è più conveniente del contratto attuale.</div>`) : '';
  return `<div class="card enter" style="--i:${i + 1}">
    <h3>Confronto ${esc(cc.label)}${asset ? ` · ${esc(assetLabel(asset))}` : ''}</h3>
    <label>Consumo annuo da usare (${u})</label><input type="number" inputmode="decimal" data-units="${esc(c.key)}" value="${units}" min="1">
    <div class="hint">${annualUnits(c) != null ? 'Calcolato dalle tue bollette degli ultimi 12 mesi: puoi modificarlo.' : 'Stima dall\'ultima bolletta: correggila se conosci il consumo annuo.'}</div>
    ${verdict}
    <div class="cmp">
      <div class="row pr ${cur == null ? 'mut' : ''}"><div class="grow"><div class="t">Attuale${c.supplier ? ` · ${esc(c.supplier)}` : ''}</div><div class="s">${a.materiaPerUnit != null ? `${eurU(a.materiaPerUnit)} €/${u} (materia prima, quote fisse incluse)` : 'voce "materia prima" non trovata nella bolletta'}</div></div><b>${cur != null ? eur(cur) + '<small>/anno</small>' : '—'}</b></div>
      ${rows.map(({ o, r }, k) => `<div class="row pr ${k === 0 && r.delta != null && r.delta < -0.5 ? 'best' : ''}"><div class="grow"><div class="t">${esc(o.supplier || 'Offerta')}${o.name ? ` · ${esc(o.name)}` : ''}</div><div class="s">${eurU(o.priceUnit)} €/${u}${o.fixedMonthly ? ` + ${eur(o.fixedMonthly)}/mese` : ''}</div></div>
        <div style="text-align:right"><b>${eur(r.offerYear)}<small>/anno</small></b>${r.delta != null ? `<div class="s ${r.delta < 0 ? 'pos' : 'neg'}">${r.delta < 0 ? '−' : '+'}${eur(Math.abs(r.delta))}</div>` : ''}</div></div>`).join('')}
    </div>
    <div class="hint">${cur == null ? 'Senza la voce "materia prima" della bolletta non posso confrontare: vedi solo il costo annuo di ogni offerta. ' : ''}Stima indicativa sulla sola componente materia prima: trasporto, oneri e imposte sono uguali per ogni fornitore. Dispacciamento, perdite di rete e sconti possono cambiare il risultato reale.</div>
  </div>`;
}

async function renderPrices() {
  view.innerHTML = '<div class="card enter">' + emptyState('Analizzo le bollette…', 'Leggo le voci di costo dall\'ultima bolletta di ogni contratto.') + '</div>';
  const all = applyAsset(await listBills());
  let contracts = groupContracts(all);
  if (await analyzeMany(contracts.map((c) => c.last))) contracts = groupContracts(all);
  const offers = await listOffers();

  const cards = contracts.map(contractCard).join('');
  const cmps = (await Promise.all(contracts.map((c, i) => comparisonCard(c, offers, contracts.length + i)))).join('');
  view.innerHTML = `
    ${assets().length ? `<div class="enter" style="--i:0;margin-bottom:12px">${assetSelect()}</div>` : ''}
    <h2 style="margin:4px 0 8px">I tuoi contratti</h2>
    ${cards || `<div class="card enter">${emptyState('Nessun contratto da analizzare', 'Servono bollette di luce, gas o acqua con il consumo indicato. Sincronizza Gmail o aggiungile dai Documenti.')}</div>`}
    <h2 style="margin:18px 0 8px">Preventivi e contratti da confrontare</h2>
    <div class="card enter" style="--i:${contracts.length + 1}">
      ${offers.length ? offers.map(offerLine).join('') : '<div class="s" style="padding:6px 0">Carica un preventivo o un contratto (PDF): ne leggo prezzo e quota fissa e li confronto con le tue bollette.</div>'}
      <button class="btn" id="offerAdd" style="width:100%;margin-top:10px">+ Carica preventivo o contratto (PDF)</button>
      <input type="file" id="offerFile" accept="application/pdf" hidden>
      <button class="btn sec" id="offerManual" style="width:100%;margin-top:8px">+ Inserisci offerta a mano</button>
    </div>
    ${cmps}`;
  bindAssetSelect(renderPrices);
  view.querySelectorAll('[data-offer]').forEach((r) => (r.onclick = () => openOfferDialog(Number(r.dataset.offer))));
  $('#offerAdd').onclick = () => $('#offerFile').click();
  $('#offerManual').onclick = () => openOfferDialog(null);
  $('#offerFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      toast('Leggo il documento…', 2500);
      const buf = await f.arrayBuffer();
      const parsed = parseOffer(await pdfToText(buf.slice(0)));
      openOfferDialog(null, { ...parsed, fileName: f.name }, new Blob([buf], { type: 'application/pdf' }));
    } catch (err) { toast(`Documento non leggibile: ${err.message}`, 6000); }
    e.target.value = '';
  };
  view.querySelectorAll('[data-units]').forEach((el) => (el.onchange = async () => { await setKV(`price.units.${el.dataset.units}`, Number(el.value) || 0); renderPrices(); }));
  animateCountsU();
}

function animateCountsU() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  view.querySelectorAll('[data-count-u]').forEach((el) => {
    const target = Number(el.dataset.countU); if (!isFinite(target)) return;
    const t0 = performance.now();
    const tick = (now) => { const p = Math.min(1, (now - t0) / 800); el.textContent = eurU(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); else el.textContent = eurU(target); };
    requestAnimationFrame(tick);
  });
}

async function openOfferDialog(id, prefill = null, pdf = null) {
  const o = id ? (await listOffers()).find((x) => x.id === id) : { category: 'luce', ...(prefill || {}) };
  if (!o) return;
  const dlg = $('#dlg');
  dlg.innerHTML = `
    <h2 style="margin:0 0 4px">${id ? 'Offerta' : 'Nuova offerta'}</h2>
    ${prefill ? '<div class="hint" style="margin-bottom:6px">Valori letti dal documento: controllali e correggili se serve.</div>' : ''}
    <label>Tipo</label><select data-k="category"><option value="luce" ${o.category !== 'gas' ? 'selected' : ''}>⚡ Luce</option><option value="gas" ${o.category === 'gas' ? 'selected' : ''}>🔥 Gas</option></select>
    <label>Fornitore</label><input type="text" data-k="supplier" value="${esc(o.supplier || '')}">
    <label>Nome dell'offerta</label><input type="text" data-k="name" value="${esc(o.name || '')}">
    <label id="pl">Prezzo della materia prima (€/${o.category === 'gas' ? 'Smc' : 'kWh'})</label><input type="number" step="0.0001" inputmode="decimal" data-k="priceUnit" value="${o.priceUnit ?? ''}">
    <label>Quota fissa (€/mese)</label><input type="number" step="0.01" inputmode="decimal" data-k="fixedMonthly" value="${o.fixedMonthly ?? ''}">
    <label>Tipo di prezzo</label><select data-k="kind"><option value="" ${!o.kind ? 'selected' : ''}>—</option><option value="fisso" ${o.kind === 'fisso' ? 'selected' : ''}>Fisso</option><option value="variabile" ${o.kind === 'variabile' ? 'selected' : ''}>Variabile / indicizzato</option></select>
    <label>Valida fino al</label><input type="date" data-k="validUntil" value="${esc(o.validUntil || '')}">
    <label>Note</label><input type="text" data-k="notes" value="${esc(o.notes || '')}" placeholder="es. sconto primo anno, bonus…">
    <div id="pdfbox" style="margin-top:10px"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="btn" id="of-save">Salva</button>
      ${(o.pdf || pdf) ? '<button class="btn sec" id="of-pdf">Vedi PDF</button>' : ''}
      ${id ? '<button class="btn danger" id="of-del">Elimina</button>' : ''}
      <button class="btn sec" id="of-close">Chiudi</button></div>`;
  dlg.showModal();
  const sel = dlg.querySelector('[data-k=category]');
  sel.onchange = () => { $('#pl', dlg).textContent = `Prezzo della materia prima (€/${sel.value === 'gas' ? 'Smc' : 'kWh'})`; };
  $('#of-close', dlg).onclick = () => dlg.close();
  const blob = pdf || o.pdf;
  if (blob) $('#of-pdf', dlg).onclick = async () => renderPdf(await blob.arrayBuffer(), $('#pdfbox', dlg));
  if (id) $('#of-del', dlg).onclick = async () => { if (confirm('Eliminare questa offerta?')) { await deleteOffer(id); dlg.close(); renderPrices(); } };
  $('#of-save', dlg).onclick = async () => {
    const patch = {};
    dlg.querySelectorAll('[data-k]').forEach((el) => {
      patch[el.dataset.k] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : (el.value || null);
    });
    if (patch.priceUnit == null || patch.priceUnit <= 0) { toast('Inserisci il prezzo della materia prima', 4000); return; }
    if (id) await updateOffer(id, patch); else await addOffer({ ...patch, fileName: prefill?.fileName || null }, pdf);
    dlg.close(); toast('Offerta salvata'); renderPrices();
  };
}

// ---------- Impostazioni ----------
async function renderSettings() {
  const connected = await gmail.isConnected();
  const last = await getKV('gmail.lastSync');
  let html = '', gi = 0;
  const catHtml = await catSettingsHtml();
  const stoHtml = await storageHtml();
  for (const sec of SETTINGS_SCHEMA) {
    html += `<details class="set-group enter" data-sec="${sec.id}" ${state.openSet.has(sec.id) ? 'open' : ''} style="--i:${gi++}"><summary><span>${sec.icon} ${sec.title}</span><i class="chev"></i></summary><div class="card" style="padding:4px 14px">`;
    for (const it of sec.items) {
      const v = await getSetting(it.key);
      const hint = it.hint ? `<div class="hint">${esc(it.hint)}</div>` : '';
      if (it.type === 'toggle') html += `<div class="set-item"><div>${it.label}${hint}</div><label class="switch"><input type="checkbox" data-s="${it.key}" ${v ? 'checked' : ''}><span></span></label></div>`;
      else if (it.type === 'text') html += `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div>${it.label}</div>${hint}<input type="text" data-s="${it.key}" value="${esc(v)}" style="margin-top:6px"></div>`;
      else if (it.type === 'select') html += `<div class="set-item"><div>${it.label}</div><select data-s="${it.key}" style="width:auto">${it.options.map(([k, l]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      else if (it.type === 'action') {
        const label = it.key === 'action.connect' ? (connected ? 'Scollega Gmail' : (await gmail.needsReauth()) ? 'Riconnetti Gmail' : 'Collega Gmail') : it.label;
        html += `<div class="set-item"><div>${it.label}${it.key === 'action.connect' ? `<div class="hint">${connected ? 'Collegato' : 'Non collegato'}${last ? ' · ultimo sync ' + new Date(last).toLocaleString('it-IT') : ''}</div>` : hint}</div><button class="btn ${it.danger ? 'danger' : 'sec'}" data-a="${it.key}">${it.key === 'action.connect' ? label : 'Esegui'}</button></div>`;
      } else if (it.type === 'categories') html += catHtml;
      else if (it.type === 'storage') html += stoHtml;
      else if (it.type === 'assets') html += assetSettingsHtml();
      else if (it.type === 'color') html += `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div>${it.label}</div>${hint}<div class="swatches">${it.presets.map((c) => `<button type="button" class="sw ${String(v).toLowerCase() === c ? 'on' : ''}" data-ecg="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<input type="color" data-s="${it.key}" data-color value="${esc(v)}" aria-label="Colore personalizzato"><button type="button" class="btn sec" data-ecgreset="${it.default}">Ripristina</button></div></div>`;
      else if (it.type === 'list') {
        const arr = Array.isArray(v) ? v : [];
        html += `<div class="list-set" data-list="${it.key}" style="padding:10px 0;border-bottom:1px solid var(--line)"><div>${it.label}</div>${hint}
          ${arr.map((val, i) => `<div class="li"><input type="text" inputmode="${it.key === 'gmail.senders' ? 'email' : 'text'}" autocapitalize="none" autocomplete="off" spellcheck="false" data-l="${it.key}" data-i="${i}" value="${esc(val)}" placeholder="${esc(it.placeholder || '')}"><button class="icon-btn" data-ldel="${it.key}" data-i="${i}" aria-label="Rimuovi">✕</button></div>`).join('')}
          <button class="btn sec" data-ladd="${it.key}" style="margin-top:8px">+ Aggiungi</button></div>`;
      } else if (it.type === 'preview') html += `<div style="padding:10px 0"><div>${it.label}</div><div class="hint qprev" id="qprev">${esc(await previewQuery())}</div><div class="hint bad" id="qwarn"></div></div>`;
      else html += `<div class="set-item mut">${it.label}</div>`;
    }
    html += '</div></details>';
  }
  view.innerHTML = html + `<p class="mut" style="text-align:center">BillRadar ${__APP_VERSION__} · dati salvati solo su questo dispositivo</p>`;

  // colore della striscia ECG: anteprima dal vivo
  view.querySelectorAll('[data-ecg]').forEach((el) => (el.onclick = async () => { await setSetting('ui.ecgColor', el.dataset.ecg); applyEcg(el.dataset.ecg); renderSettings(); }));
  view.querySelectorAll('[data-ecgreset]').forEach((el) => (el.onclick = async () => { await setSetting('ui.ecgColor', el.dataset.ecgreset); applyEcg(el.dataset.ecgreset); renderSettings(); }));
  view.querySelectorAll('input[data-color]').forEach((el) => (el.oninput = () => applyEcg(el.value)));
  // immobili e vetture
  const addA = $('#addAsset'); if (addA) addA.onclick = () => openAssetDialog();
  const rev = $('#reverify'); if (rev) rev.onclick = async () => {
    const bar = $('#progress'); bar.hidden = false;
    try {
      const r = await reverifyBills((i, n) => { $('div', bar).style.width = `${(i / n) * 100}%`; $('span', bar).textContent = `Verifico ${i}/${n}`; });
      toast(r.total ? `Verificate ${r.total - r.noPdf}: ${r.assigned} assegnate, ${r.manual} da assegnare a mano${r.noPdf ? `; ${r.noPdf} senza PDF sul telefono (non verificabili)` : ''}` : 'Nessuna bolletta da verificare', 8000);
    } catch (e) { toast(e.message, 6000); } finally { bar.hidden = true; }
    route();
  };
  view.querySelectorAll('[data-editasset]').forEach((el) => (el.onclick = () => openAssetDialog(el.dataset.editasset)));
  view.querySelectorAll('[data-delasset]').forEach((el) => (el.onclick = async (e) => {
    e.stopPropagation();
    const a = assetById(el.dataset.delasset);
    if (!confirm(`Eliminare "${a.name}"? Le sue bollette resteranno, ma torneranno "da assegnare".`)) return;
    await removeAsset(a.id); if (state.asset === a.id) state.asset = 'all'; toast('Eliminato'); renderSettings();
  }));

  // elenchi (mittenti, testi): ogni riga si salva da sola; la ricerca risultante si aggiorna subito
  const readList = (key) => [...view.querySelectorAll(`input[data-l="${key}"]`)].map((i) => i.value);
  const refreshPreview = async () => {
    const q = $('#qprev'); if (!q) return;
    q.textContent = await previewQuery(readList('gmail.senders'), readList('gmail.keywords'));
    const bad = invalidSenders(readList('gmail.senders'));
    $('#qwarn').textContent = bad.length ? `Indirizzo non valido, ignorato: ${bad.join(', ')}` : '';
  };
  view.querySelectorAll('input[data-l]').forEach((el) => {
    el.oninput = refreshPreview;
    el.onchange = async () => { await setSetting(el.dataset.l, readList(el.dataset.l).map((x) => x.trim()).filter(Boolean)); refreshPreview(); };
  });
  view.querySelectorAll('[data-ldel]').forEach((el) => (el.onclick = async () => {
    const key = el.dataset.ldel, list = readList(key); list.splice(Number(el.dataset.i), 1);
    await setSetting(key, list.map((x) => x.trim()).filter(Boolean)); renderSettings();
  }));
  view.querySelectorAll('[data-ladd]').forEach((el) => (el.onclick = async () => {
    const key = el.dataset.ladd, list = readList(key).map((x) => x.trim()).filter(Boolean);
    await setSetting(key, [...list, '']);
    await renderSettings();
    [...view.querySelectorAll(`input[data-l="${key}"]`)].pop()?.focus();
  }));

  view.querySelectorAll('[data-s]').forEach((el) => (el.onchange = async () => {
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.s === 'drive.enabled' && val) {
      // il permesso Drive si chiede solo ora, solo se serve
      try {
        if (!(await gmail.hasDriveScope())) { await gmail.connect({ drive: true }); toast('Accesso a Drive concesso'); }
      } catch (e) { el.checked = false; await setSetting('drive.enabled', false); toast(e.message, 6000); return; }
      await setSetting('drive.enabled', true);
      await renderSettings();
      if (confirm('Archivio su Drive attivo. Vuoi caricare ora anche i documenti già presenti?')) runAction('action.driveSync');
      return;
    }
    await setSetting(el.dataset.s, val);
    if (el.dataset.s === 'ui.theme') applyTheme(val);
    if (el.dataset.s === 'ui.ecgColor') applyEcg(val);
    if (el.dataset.s === 'gmail.generic') refreshPreview();
  }));
  view.querySelectorAll('[data-a]').forEach((el) => (el.onclick = () => runAction(el.dataset.a)));

  // sezioni collassabili: chiuse di default, lo stato aperto resta durante i ricaricamenti
  view.querySelectorAll('details.set-group').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) state.openSet.add(d.dataset.sec); else state.openSet.delete(d.dataset.sec);
  }));
  // categorie: abilita/disabilita, elimina (solo personalizzate), aggiungi
  view.querySelectorAll('[data-catset]').forEach((el) => (el.onchange = () => setSetting(`cat.${el.dataset.catset}`, el.checked)));
  view.querySelectorAll('[data-delcat]').forEach((el) => (el.onclick = async () => {
    const id = el.dataset.delcat;
    if (!confirm(`Eliminare la categoria "${cat(id).label}"? I documenti già archiviati passeranno ad "Altro".`)) return;
    await removeCategory(id); state.hidden.delete(id); toast('Categoria eliminata'); renderSettings();
  }));
  const addBtn = $('#addCat'); if (addBtn) addBtn.onclick = openCategoryDialog;
}

async function catSettingsHtml() {
  let h = '';
  for (const [id, c] of Object.entries(cats())) {
    const on = (await getSetting(`cat.${id}`)) !== false;
    h += `<div class="set-item"><div class="catline"><span class="catdot" style="background:${c.color}"></span><div><div>${c.icon} ${esc(c.label)}${c.custom ? ' <span class="tag2">tua</span>' : ''}</div><div class="hint">${(c.scope === 'car' ? '🚗 Vetture · ' : '🏠 Immobili · ') + (c.kind === 'income' ? 'Entrata' : 'Spesa')}${c.unit ? ` · ${esc(c.unit)}` : ''}</div></div></div>
      <div class="acts">${c.custom ? `<button class="icon-btn" data-delcat="${id}" aria-label="Elimina ${esc(c.label)}">🗑</button>` : ''}<label class="switch"><input type="checkbox" data-catset="${id}" ${on ? 'checked' : ''}><span></span></label></div></div>`;
  }
  return h + '<div style="padding:12px 0"><button class="btn sec" id="addCat" style="width:100%">+ Aggiungi categoria</button></div>';
}

function assetSettingsHtml() {
  const list = assets();
  const rows = list.map((a) => `<div class="set-item" data-editasset="${a.id}" style="cursor:pointer"><div class="catline"><span class="ico" style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:18px;background:var(--acc-soft)">${KIND_ICON[a.kind]}</span><div><div>${esc(a.name)}</div><div class="hint">${KIND_LABEL[a.kind]}${a.holder ? ` · intestato a ${esc(a.holder)}` : ''}${a.address ? ` · ${esc(a.address)}` : ''}${a.match?.length ? ` · codici: ${esc(a.match.join(', '))}` : ''}</div></div></div>
      <div class="acts"><button class="icon-btn" data-delasset="${a.id}" aria-label="Elimina ${esc(a.name)}">🗑</button></div></div>`).join('');
  return `${rows || '<div class="set-item mut">Nessun immobile o vettura. Aggiungili: ogni bolletta dovrà riferirsi a uno di essi.</div>'}
    <div style="padding:12px 0;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec" id="addAsset" style="flex:1">+ Aggiungi immobile o vettura</button>${list.length ? '<button class="btn sec" id="reverify" style="flex:1">Verifica le bollette già presenti</button>' : ''}</div>
    <div class="hint" style="padding-bottom:10px">Le bollette si assegnano da sole solo se indirizzo e intestatario del documento coincidono con quelli registrati. Se più schede hanno lo stesso indirizzo (intestatari diversi) l\'assegnazione resta manuale.</div>`;
}

function openAssetDialog(id = null) {
  const a = id ? assetById(id) : null;
  const dlg = $('#dlg');
  dlg.innerHTML = `
    <h2 style="margin:0 0 4px">${a ? 'Modifica' : 'Nuovo'} immobile o vettura</h2>
    <label>Tipo</label><select id="as-kind"><option value="home" ${a?.kind !== 'car' ? 'selected' : ''}>🏠 Immobile</option><option value="car" ${a?.kind === 'car' ? 'selected' : ''}>🚗 Vettura</option></select>
    <label>Nome</label><input type="text" id="as-name" maxlength="30" placeholder="es. Casa, Casa al mare, Panda" autocomplete="off" value="${esc(a?.name || '')}">
    <label>Intestatario delle utenze</label>
    <input type="text" id="as-holder" placeholder="es. Mario Rossi (come scritto in bolletta)" autocomplete="off" value="${esc(a?.holder || '')}">
    <div id="as-addr-box"><label>Indirizzo della fornitura</label>
    <input type="text" id="as-addr" placeholder="es. Via Roma 12, Milano" autocomplete="off" value="${esc(a?.address || '')}"></div>
    <div class="hint" style="margin-top:6px">Le bollette vengono assegnate da sole solo se nel PDF compaiono sia l'indirizzo sia l'intestatario. Stesso indirizzo con intestatari diversi? Crea due schede: quelle bollette andranno assegnate a mano.</div>
    <label>Codici di riconoscimento (facoltativi)</label>
    <input type="text" id="as-match" placeholder="es. IT001E12345678, 12345678901234, AB123CD" autocomplete="off" value="${esc((a?.match || []).join(', '))}">
    <div class="hint" style="margin-top:6px">Separati da virgole: POD, PDR, targa, numero contratto. Sono univoci: se compaiono nel PDF decidono da soli.</div>
    <div style="display:flex;gap:8px;margin-top:16px"><button class="btn" id="as-save">Salva</button><button class="btn sec" id="as-cancel">Annulla</button></div>`;
  dlg.showModal();
  const syncKind = () => { $('#as-addr-box', dlg).hidden = $('#as-kind', dlg).value === 'car'; };
  $('#as-kind', dlg).onchange = syncKind; syncKind();
  $('#as-cancel', dlg).onclick = () => dlg.close();
  $('#as-save', dlg).onclick = async () => {
    try {
      const wasEmpty = assets().length === 0;
      const rec = await saveAsset({ id, kind: $('#as-kind', dlg).value, name: $('#as-name', dlg).value, holder: $('#as-holder', dlg).value, address: $('#as-addr', dlg).value, match: $('#as-match', dlg).value });
      dlg.close();
      const n = await countUnassigned();
      if (wasEmpty && n && confirm(`Assegnare a "${rec.name}" le ${n} bollette già presenti?`)) await assignAllUnassigned(rec.id);
      const sameAddr = rec.address && assets().filter((x) => x.id !== rec.id && x.address && x.address.toLowerCase().replace(/\W+/g, '') === rec.address.toLowerCase().replace(/\W+/g, '')).length;
      toast(sameAddr ? 'Salvato. Stesso indirizzo di un\'altra scheda: le bollette di quell\'indirizzo si assegnano a mano.' : 'Salvato', sameAddr ? 7000 : 3200); renderSettings();
    } catch (e) { toast(e.message, 4500); }
  };
}

function applyEcg(c) { document.documentElement.style.setProperty('--ecg', c || '#6fe0ff'); }

function openCategoryDialog() {
  const dlg = $('#dlg');
  const icons = ['🏠', '🛒', '🏥', '🎓', '🐶', '📺', '✈️', '💼', '🔌', '🚌', '🎁', '📌'];
  dlg.innerHTML = `
    <h2 style="margin:0 0 4px">Nuova categoria</h2>
    <label>Nome</label><input type="text" id="nc-name" maxlength="28" placeholder="es. Condominio" autocomplete="off">
    <label>Icona</label>
    <div class="chips" id="nc-icons">${icons.map((i) => `<button type="button" class="chip" data-i="${i}">${i}</button>`).join('')}</div>
    <input type="text" id="nc-icon" maxlength="4" value="📌" style="width:90px">
    <label>Colore</label><input type="color" id="nc-color" value="#35c8ff">
    <label>Si riferisce a</label><select id="nc-scope"><option value="home">🏠 Immobili</option><option value="car">🚗 Vetture</option></select>
    <label>Tipo</label><select id="nc-kind"><option value="cost">Spesa</option><option value="income">Entrata</option></select>
    <label>Unità di misura (facoltativa)</label><input type="text" id="nc-unit" maxlength="8" placeholder="es. kWh, L, kg">
    <label>Parole chiave per riconoscerla (facoltative)</label>
    <input type="text" id="nc-kw" placeholder="es. condominio, amministratore" autocomplete="off">
    <div class="hint" style="margin-top:6px">Con le parole chiave le nuove bollette trovate in Gmail finiscono qui da sole. Senza, puoi assegnarla a mano dal dettaglio di ogni documento.</div>
    <div style="display:flex;gap:8px;margin-top:16px"><button class="btn" id="nc-save">Aggiungi</button><button class="btn sec" id="nc-cancel">Annulla</button></div>`;
  dlg.showModal();
  dlg.querySelectorAll('#nc-icons .chip').forEach((c) => (c.onclick = () => { $('#nc-icon', dlg).value = c.dataset.i; }));
  $('#nc-cancel', dlg).onclick = () => dlg.close();
  $('#nc-save', dlg).onclick = async () => {
    try {
      await addCategory({
        label: $('#nc-name', dlg).value, icon: $('#nc-icon', dlg).value, color: $('#nc-color', dlg).value,
        kind: $('#nc-kind', dlg).value, scope: $('#nc-scope', dlg).value, unit: $('#nc-unit', dlg).value, keywords: $('#nc-kw', dlg).value,
      });
      dlg.close(); toast('Categoria aggiunta'); renderSettings();
    } catch (e) { toast(e.message, 4500); }
  };
}

const fmtBytes = (n) => (n == null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function storageHtml() {
  const u = await drive.localUsage();
  const rows = [
    ['Documenti', String(u.docs)],
    ['PDF sul telefono', `${u.pdfs} · ${fmtBytes(u.pdfBytes)}`],
    ['di cui già su Drive', String(u.onDrive)],
    ['Totale app (stima)', u.usage != null ? fmtBytes(u.usage) : '—'],
  ];
  return `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div>Spazio occupato</div>
    ${rows.map(([k, v]) => `<div class="row" style="padding:6px 0"><div class="grow mut">${k}</div><b>${v}</b></div>`).join('')}
    <div class="hint">I dati estratti pesano pochissimo (circa 1 KB a documento): lo spazio è quasi tutto nei PDF.</div></div>`;
}

/** Testo della ricerca Gmail risultante dai filtri (anche non ancora salvati). */
async function previewQuery(senders, keywords) {
  return buildGmailQuery({
    senders: senders ?? await getSetting('gmail.senders'),
    keywords: keywords ?? await getSetting('gmail.keywords'),
    generic: await getSetting('gmail.generic'),
  });
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
}

async function runAction(key) {
  try {
    if (key === 'action.connect') {
      if (await gmail.isConnected()) { await gmail.disconnect(); toast('Gmail scollegato'); }
      else { await gmail.connect(); toast('Gmail collegato'); await doSync('full'); }
      renderSettings();
    } else if (key === 'action.syncHistory') {
      await doSync('full');
    } else if (key === 'action.driveSync') {
      if (!(await drive.isDriveEnabled())) { toast('Attiva prima "Archivia su Google Drive"'); return; }
      const bar = $('#progress'); bar.hidden = false;
      try {
        const r = await drive.archivePending((i, n) => { $('div', bar).style.width = `${(i / n) * 100}%`; $('span', bar).textContent = `Carico su Drive ${i}/${n}`; });
        toast(r.total === 0 ? 'Nessun documento da archiviare' : `Su Drive: ${r.done} caricati${r.errors ? `, ${r.errors} errori. ${r.firstError}` : ''}`, r.errors ? 8000 : 4500);
      } finally { bar.hidden = true; }
      await renderSettings();
    } else if (key === 'action.driveBackup') {
      if (!(await drive.isDriveEnabled())) { toast('Attiva prima "Archivia su Google Drive"'); return; }
      const r = await drive.backupToDrive(await exportAll());
      toast(`Backup salvato in ${r.path}: ${r.name}${r.replaced ? ' (aggiornato)' : ''}`, 6000);
    } else if (key === 'action.driveRestore') {
      if (!(await drive.isDriveEnabled())) { toast('Attiva prima "Archivia su Google Drive"'); return; }
      const { name, json } = await drive.restoreFromDrive();
      if (!confirm(`Ripristinare i dati da ${name}? I documenti già presenti non vengono duplicati.`)) return;
      const r = await importAll(json); await loadCategories(); await loadAssets();
      toast(`Ripristino da ${name}: ${r.added} documenti recuperati, ${r.skipped} già presenti`, 7000); route();
    } else if (key === 'action.driveFree') {
      if (!(await drive.isDriveEnabled())) { toast('Attiva prima "Archivia su Google Drive"'); return; }
      if (!confirm('Rimuovere dal telefono i PDF già presenti su Drive? Resteranno consultabili da Drive.')) return;
      const bar = $('#progress'); bar.hidden = false;
      try {
        const r = await drive.freeLocalPdfs((i, n) => { $('div', bar).style.width = `${(i / n) * 100}%`; $('span', bar).textContent = `Verifico ${i}/${n}`; });
        toast(r.freed ? `Liberati ${fmtBytes(r.bytes)} (${r.freed} PDF)${r.skipped ? `, ${r.skipped} non trovati su Drive: tenuti sul telefono` : ''}` : 'Nessun PDF da rimuovere', 6000);
      } finally { bar.hidden = true; }
      route();
    } else if (key === 'action.exportJson') download(`billradar-${Date.now()}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json');
    else if (key === 'action.exportCsv') download(`billradar-${Date.now()}.csv`, billsToCSV(await listBills()), 'text/csv');
    else if (key === 'action.import') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = async () => { await importAll(JSON.parse(await inp.files[0].text())); await loadCategories(); await loadAssets(); toast('Backup importato'); route(); };
      inp.click();
    } else if (key === 'action.wipe') {
      if (confirm('Cancellare TUTTI i dati dal telefono? L\'operazione non è reversibile.')) { await wipeAll(); await loadCategories(); await loadAssets(); state.asset = 'all'; applyEcg(); toast('Dati cancellati'); route(); }
    }
  } catch (e) { toast(e.message, 6000); }
}

// ---------- Elenco per categoria (da "Per categoria" nella Home) ----------
const MESI_FULL = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
async function renderCat(id) {
  if (!id || state.cat.id !== id) state.cat = { id, y: String(state.year), m: 'all' };
  const c = cat(id);
  const all = applyAsset(await listBills()).filter((b) => b.category === id);
  const ys = [...new Set(all.map((b) => (b.issueDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  if (state.cat.y !== 'all' && !ys.includes(state.cat.y)) ys.unshift(state.cat.y);
  const { y, m } = state.cat;
  const rows = all.filter((b) => {
    const d = b.issueDate || '';
    return (y === 'all' || d.startsWith(y)) && (m === 'all' || d.slice(5, 7) === m);
  });
  const tot = rows.reduce((s, b) => s + (b.amount || 0), 0);
  const period = [m === 'all' ? '' : MESI_FULL[Number(m) - 1], y === 'all' ? '' : y].filter(Boolean).join(' ') || 'tutto il periodo';
  view.innerHTML = `
    <a href="#/home" class="back">‹ Home</a>
    <div class="cat-head enter" style="--i:0"><div class="ico" style="background:${c.color}22">${c.icon}</div><h2>${esc(c.label)}</h2></div>
    ${assets().length ? `<div class="enter" style="--i:1;margin-bottom:10px">${assetSelect()}</div>` : ''}
    <div class="grid2 enter" style="--i:1">
      <select id="cy" aria-label="Anno"><option value="all" ${y === 'all' ? 'selected' : ''}>Tutti gli anni</option>${ys.map((v) => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="cm" aria-label="Mese"><option value="all" ${m === 'all' ? 'selected' : ''}>Tutti i mesi</option>${MESI_FULL.map((l, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === m ? 'selected' : ''}>${l}</option>`; }).join('')}</select>
    </div>
    <div class="card enter" style="--i:2"><div class="row" style="border:0"><div class="grow"><div class="t">${rows.length} document${rows.length === 1 ? 'o' : 'i'}</div><div class="s">${esc(period)}</div></div><b class="${c.kind === 'income' ? 'pos' : ''}">${eur(tot)}</b></div></div>
    <div class="card enter" style="--i:3">${rows.length ? rows.map((b) => billRow(b)).join('') : emptyState('Nessun documento', 'Nessuna bolletta in questo periodo.')}</div>`;
  bindAssetSelect(() => renderCat(id));
  $('#cy').onchange = (e) => { state.cat.y = e.target.value; renderCat(id); };
  $('#cm').onchange = (e) => { state.cat.m = e.target.value; renderCat(id); };
  view.querySelectorAll('.row[data-id]').forEach((r) => (r.onclick = () => openBill(Number(r.dataset.id))));
}

// ---------- sync ----------
/**
 * mode:
 *  'quick'   → all'apertura: solo le mail degli ultimi 7 giorni, senza rumore se non c'è nulla
 *  'refresh' → tasto ⟳: solo le mail arrivate dall'ultimo controllo fino ad adesso
 *  'full'    → "Sincronizza storico": tutto il periodo scelto nelle impostazioni
 */
async function doSync(mode = 'refresh') {
  const bar = $('#progress');
  const quiet = mode === 'quick';
  if (doSync.busy) return;
  doSync.busy = true;
  try {
    if (!(await gmail.isConnected())) { if (!quiet) { toast('Collega prima Gmail in Impostazioni'); location.hash = '#/settings'; } return; }
    if (!quiet) bar.hidden = false;
    $('#syncBtn').classList.add('busy');
    const last = await getKV('gmail.lastCheck');
    const opts = mode === 'full' ? {} : mode === 'quick' || !last ? { days: 7 } : { afterTs: last - 3600e3 };   // 1 ora di margine
    const hook = drive.syncHook();
    const r = await gmail.sync((i, n) => { if (quiet) return; $('div', bar).style.width = `${(i / n) * 100}%`; $('span', bar).textContent = `Analizzo ${i}/${n}`; }, hook, opts);
    if (r.added && (await getSetting('drive.autoBackup')) && (await drive.isDriveEnabled())) {
      try { await drive.backupToDrive(await exportAll()); } catch (e) { hook.errors.push(`backup: ${e.message}`); }
    }
    if (r.newItems.length) {
      // avviso in Home finché non viene chiuso: quante e di che tipo
      const prev = await getKV('ui.newBills', []);
      await setKV('ui.newBills', [...prev, ...r.newItems]);
    }
    if (!quiet || r.added || r.errors || hook.errors.length) {
      const onDrive = hook.uploaded ? `, ${hook.uploaded} su Drive` : '';
      const msg = mode === 'full'
        ? `Storico sincronizzato: ${r.added} nuovi${onDrive}, ${r.skipped} già presenti`
        : r.added ? `${r.added} ${r.added > 1 ? 'nuove bollette' : 'nuova bolletta'}${onDrive}` : 'Nessuna nuova bolletta';
      toast(`${msg}${r.errors ? `, ${r.errors} errori` : ''}${hook.errors.length ? `. Drive: ${hook.errors[0]}` : ''}`, hook.errors.length ? 9000 : 4500);
    }
  } catch (e) { if (!quiet || !/non collegato/i.test(e.message)) toast(e.message, 6000); }
  finally {
    doSync.busy = false;
    bar.hidden = true;
    $('#syncBtn').classList.remove('busy');
  }
  route();
}
$('#syncBtn').onclick = () => doSync('refresh');
// effetto onda al tocco sui pulsanti
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn');
  if (!b) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 1.6;
  const w = document.createElement('span');
  w.style.cssText = `position:absolute;border-radius:50%;pointer-events:none;background:rgba(255,255,255,.45);width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px;transform:scale(0);opacity:1;transition:transform .55s ease-out,opacity .55s`;
  b.appendChild(w);
  requestAnimationFrame(() => { w.style.transform = 'scale(1)'; w.style.opacity = '0'; });
  setTimeout(() => w.remove(), 600);
});

// ---------- router ----------
function moveIndicator() {
  const a = $('.tabs a.on'), ind = $('.tabs .indicator');
  if (!a || !ind) return;
  ind.style.width = `${a.offsetWidth}px`;
  ind.style.transform = `translateX(${a.offsetLeft - 6}px)`;
}
window.addEventListener('resize', moveIndicator);

function hideSplash() {
  const sp = $('#splash');
  if (!sp) return;
  sp.classList.add('hide');
  setTimeout(() => sp.remove(), 800);
}

function applyTheme(t) { document.documentElement.dataset.theme = t || 'auto'; }
async function route() {
  const [tab, arg] = (location.hash.replace('#/', '') || 'home').split('/');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (tab === 'cat' ? 'home' : tab)));
  moveIndicator();
  if (tab === 'cat') renderCat(decodeURIComponent(arg || '')); else ({ home: renderHome, docs: renderDocs, stats: renderStats, prices: renderPrices, settings: renderSettings }[tab] || renderHome)();
  window.scrollTo(0, 0);
  pushWidget();   // il widget sulla Home segue i dati dell'app
}
view.addEventListener('click', (e) => { const a = e.target.closest('[data-filter]'); if (a) { state.filter = a.dataset.filter; if (a.dataset.filter === 'unassigned') state.asset = 'all'; } });
window.addEventListener('hashchange', route);

(async () => {
  $('#ver').textContent = `v${__APP_VERSION__}`;
  applyTheme(await getSetting('ui.theme'));
  await loadCategories();
  await loadAssets();
  applyEcg(await getSetting('ui.ecgColor'));
  state.asset = await getKV('ui.asset', 'all');
  if (!['all', 'none'].includes(state.asset) && !assetById(state.asset)) state.asset = 'all';
  state.hidden = new Set(await getKV('ui.hiddenSeries', []));
  const t0 = performance.now();
  await route();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(hideSplash, Math.max(0, (calm ? 250 : 2300) - (performance.now() - t0)));
  $('#splash')?.addEventListener('click', hideSplash);
  await gmail.keepAlive();
  if ((await getSetting('gmail.auto')) && (await gmail.isConnected())) doSync('quick');
})();
