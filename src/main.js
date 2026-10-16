import './style.css';
import { cats, loadCategories, addCategory, removeCategory } from './categories.js';
import { db, listBills, addBill, updateBill, deleteBill, exportAll, importAll, wipeAll, billsToCSV, getKV, setKV } from './db.js';
import { SETTINGS_SCHEMA, getSetting, setSetting, allSettings } from './settings.js';
import { eur, num, MONTH_LABELS, years, monthlyByCategory, totals, consumption, yoy, upcoming } from './stats.js';
import * as gmail from './gmail.js';
import * as drive from './drive.js';
import { renderPdf } from './pdf.js';
import { pushWidget } from './widget.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const state = { newIds: new Set(), cat: { id: null, y: 'all', m: 'all' }, year: new Date().getFullYear(), filter: 'all', q: '', statCat: 'luce', hidden: new Set(), openSet: new Set() };
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
  const bills = await listBills();
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
    <select id="yr" aria-label="Anno">${ys.map((v) => `<option ${v === state.year ? 'selected' : ''}>${v}</option>`).join('')}</select>
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
    <div class="grow"><div class="t">${c.label}${b.needsReview ? ' <span class="tag">verifica</span>' : ''}</div><div class="s">${sub}</div></div>
    <b class="${c.kind === 'income' ? 'pos' : ''}">${c.kind === 'income' ? '+' : ''}${eur(b.amount)}</b></div>`;
}

// ---------- Documenti ----------
async function renderDocs() {
  const bills = await listBills();
  const ids = await enabledCats();
  const f = state.filter;
  const q = state.q.toLowerCase();
  const rows = bills.filter((b) => (f === 'all' || (f === 'review' ? b.needsReview : f === 'new' ? state.newIds.has(b.id) : b.category === f))
    && (!q || `${b.supplier} ${b.fileName} ${b.invoiceNumber} ${b.subject}`.toLowerCase().includes(q)));
  view.innerHTML = `
    <input type="search" id="q" placeholder="Cerca fornitore, numero…" value="${esc(state.q)}">
    <div class="chips" style="margin-top:10px">
      ${[['all', 'Tutti'], ...(state.newIds.size ? [['new', 'Nuove']] : []), ['review', 'Da verificare'], ...ids.map((id) => [id, cat(id).label])].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
    </div>
    <div class="card enter" style="--i:1">${rows.length ? rows.map((b) => billRow(b)).join('') : emptyState('Nessun documento', 'Qui compariranno le bollette trovate in Gmail.')}</div>
    <button class="btn" id="add" style="width:100%">+ Aggiungi manualmente</button>`;
  $('#q').oninput = (e) => { state.q = e.target.value; clearTimeout(renderDocs.t); renderDocs.t = setTimeout(renderDocs, 250); };
  view.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { state.filter = c.dataset.f; renderDocs(); }));
  view.querySelectorAll('.row[data-id]').forEach((r) => (r.onclick = () => openBill(Number(r.dataset.id))));
  $('#add').onclick = () => openBill(null);
}

async function openBill(id) {
  const b = id ? await db.bills.get(id) : { category: 'luce', issueDate: new Date().toISOString().slice(0, 10), source: 'manuale' };
  const dlg = $('#dlg');
  const canDrive = !!(id && b.pdf && !b.driveFileId && (await drive.isDriveEnabled()));
  const field = (k, label, type = 'text') => `<label>${label}</label><input type="${type}" data-k="${k}" ${type === 'number' ? 'step="0.01"' : ''} value="${esc(b[k] ?? '')}">`;
  dlg.innerHTML = `
    <h2 style="margin:0 0 4px">${id ? 'Dettaglio documento' : 'Nuovo documento'}</h2>
    <label>Categoria</label><select data-k="category">${Object.entries(cats()).map(([k, c]) => `<option value="${k}" ${b.category === k ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select>
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
    patch.unit = cat(patch.category).unit;
    patch.needsReview = false;
    if (id) await updateBill(id, patch); else await addBill({ ...b, ...patch });
    let note = '';
    if (id && b.driveFileId && (await drive.isDriveEnabled())) {
      // dati cambiati → il file su Drive viene rinominato/spostato di conseguenza
      try {
        const r = await drive.archiveBill({ ...b, ...patch }, b.pdf);
        if (r) await updateBill(id, { driveFileId: r.fileId, drivePath: r.path });
      } catch (e) { note = ` (Drive non aggiornato: ${e.message})`; }
    }
    dlg.close(); toast(`Salvato${note}`, note ? 7000 : 2500); route();
  };
}

// ---------- Statistiche ----------
async function renderStats() {
  const bills = await listBills();
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
    <div class="card enter" style="margin-top:12px;--i:1"><h3>${c.kind === 'income' ? 'Entrate' : 'Spesa'} mensile · ${state.year}</h3>${simpleBars(byCat[state.statCat], c.color)}
      <div class="grid" style="margin-top:8px"><div><small class="mut">Totale</small><br><b>${eur(tot)}</b></div><div><small class="mut">Media/mese</small><br><b>${eur(tot / 12)}</b></div></div></div>
    ${c.unit && cons.count ? `<div class="card enter" style="--i:2"><h3>Consumo (${c.unit})</h3>${simpleBars(cons.monthly, c.color)}
      <div class="grid" style="margin-top:8px"><div><small class="mut">Totale</small><br><b>${num(cons.qty, 1)} ${c.unit}</b></div>
      <div><small class="mut">Prezzo medio</small><br><b>${cons.avgPrice != null ? eur(cons.avgPrice) + '/' + c.unit : '—'}</b></div></div></div>` : ''}
    ${ids.includes('gse') && ids.includes('luce') ? `<div class="card enter" style="--i:3"><h3>Fotovoltaico vs bollette luce</h3>
      <div class="row"><div class="grow">Costo luce</div><b>${eur(luceCost)}</b></div>
      <div class="row"><div class="grow">Acconti GSE</div><b class="pos">${eur(gseIn)}</b></div>
      <div class="row"><div class="grow"><b>Costo netto energia</b></div><b class="${luceCost - gseIn <= 0 ? 'pos' : ''}">${eur(luceCost - gseIn)}</b></div></div>` : ''}`;
  $('#cat').onchange = (e) => { state.statCat = e.target.value; renderStats(); };
  $('#yr').onchange = (e) => { state.year = Number(e.target.value); renderStats(); };
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
      else html += `<div class="set-item mut">${it.label}</div>`;
    }
    html += '</div></details>';
  }
  view.innerHTML = html + `<p class="mut" style="text-align:center">BillRadar ${__APP_VERSION__} · dati salvati solo su questo dispositivo</p>`;

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
    h += `<div class="set-item"><div class="catline"><span class="catdot" style="background:${c.color}"></span><div><div>${c.icon} ${esc(c.label)}${c.custom ? ' <span class="tag2">tua</span>' : ''}</div><div class="hint">${c.kind === 'income' ? 'Entrata' : 'Spesa'}${c.unit ? ` · ${esc(c.unit)}` : ''}</div></div></div>
      <div class="acts">${c.custom ? `<button class="icon-btn" data-delcat="${id}" aria-label="Elimina ${esc(c.label)}">🗑</button>` : ''}<label class="switch"><input type="checkbox" data-catset="${id}" ${on ? 'checked' : ''}><span></span></label></div></div>`;
  }
  return h + '<div style="padding:12px 0"><button class="btn sec" id="addCat" style="width:100%">+ Aggiungi categoria</button></div>';
}

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
        kind: $('#nc-kind', dlg).value, unit: $('#nc-unit', dlg).value, keywords: $('#nc-kw', dlg).value,
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
      const r = await importAll(json); await loadCategories();
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
      inp.onchange = async () => { await importAll(JSON.parse(await inp.files[0].text())); toast('Backup importato'); route(); };
      inp.click();
    } else if (key === 'action.wipe') {
      if (confirm('Cancellare TUTTI i dati dal telefono? L\'operazione non è reversibile.')) { await wipeAll(); toast('Dati cancellati'); route(); }
    }
  } catch (e) { toast(e.message, 6000); }
}

// ---------- Elenco per categoria (da "Per categoria" nella Home) ----------
const MESI_FULL = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
async function renderCat(id) {
  if (!id || state.cat.id !== id) state.cat = { id, y: String(state.year), m: 'all' };
  const c = cat(id);
  const all = (await listBills()).filter((b) => b.category === id);
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
    <div class="grid2 enter" style="--i:1">
      <select id="cy" aria-label="Anno"><option value="all" ${y === 'all' ? 'selected' : ''}>Tutti gli anni</option>${ys.map((v) => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="cm" aria-label="Mese"><option value="all" ${m === 'all' ? 'selected' : ''}>Tutti i mesi</option>${MESI_FULL.map((l, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === m ? 'selected' : ''}>${l}</option>`; }).join('')}</select>
    </div>
    <div class="card enter" style="--i:2"><div class="row" style="border:0"><div class="grow"><div class="t">${rows.length} document${rows.length === 1 ? 'o' : 'i'}</div><div class="s">${esc(period)}</div></div><b class="${c.kind === 'income' ? 'pos' : ''}">${eur(tot)}</b></div></div>
    <div class="card enter" style="--i:3">${rows.length ? rows.map((b) => billRow(b)).join('') : emptyState('Nessun documento', 'Nessuna bolletta in questo periodo.')}</div>`;
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
  if (tab === 'cat') renderCat(decodeURIComponent(arg || '')); else ({ home: renderHome, docs: renderDocs, stats: renderStats, settings: renderSettings }[tab] || renderHome)();
  window.scrollTo(0, 0);
  pushWidget();   // il widget sulla Home segue i dati dell'app
}
view.addEventListener('click', (e) => { const a = e.target.closest('[data-filter]'); if (a) state.filter = a.dataset.filter; });
window.addEventListener('hashchange', route);

(async () => {
  $('#ver').textContent = `v${__APP_VERSION__}`;
  applyTheme(await getSetting('ui.theme'));
  await loadCategories();
  state.hidden = new Set(await getKV('ui.hiddenSeries', []));
  const t0 = performance.now();
  await route();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(hideSplash, Math.max(0, (calm ? 250 : 2300) - (performance.now() - t0)));
  $('#splash')?.addEventListener('click', hideSplash);
  await gmail.keepAlive();
  if ((await getSetting('gmail.auto')) && (await gmail.isConnected())) doSync('quick');
})();
