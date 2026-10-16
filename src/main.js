import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import './style.css';
import { CATEGORIES } from './parser.js';
import { db, listBills, addBill, updateBill, deleteBill, exportAll, importAll, wipeAll, billsToCSV, getKV } from './db.js';
import { SETTINGS_SCHEMA, getSetting, setSetting, allSettings } from './settings.js';
import { eur, num, MONTH_LABELS, years, monthlyByCategory, totals, consumption, yoy, upcoming } from './stats.js';
import * as gmail from './gmail.js';
import { renderPdf } from './pdf.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const state = { year: new Date().getFullYear(), filter: 'all', q: '', statCat: 'luce' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cat = (id) => CATEGORIES[id] || { label: 'Altro', icon: '📄', color: '#888', kind: 'cost', unit: '' };
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
function stackedBars(byCat, ids) {
  const W = 340, H = 170, pad = 22, bw = (W - pad) / 12;
  const totalsM = Array.from({ length: 12 }, (_, m) => ids.reduce((s, id) => s + (byCat[id]?.[m] || 0), 0));
  const max = Math.max(1, ...totalsM);
  let g = '';
  for (let m = 0; m < 12; m++) {
    let y = H - 18;
    for (const id of ids) {
      const v = byCat[id]?.[m] || 0; if (!v) continue;
      const h = (v / max) * (H - 36);
      y -= h;
      g += `<rect class="bar" style="--m:${m}" x="${pad + m * bw + 3}" y="${y}" width="${bw - 6}" height="${h}" rx="3" fill="${cat(id).color}"/>`;
    }
    g += `<text x="${pad + m * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${MONTH_LABELS[m][0]}</text>`;
  }
  g += `<text x="0" y="12">${eur(max).replace(',00', '')}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Spesa mensile">${g}</svg>`;
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
  const s = await allSettings();
  return Object.keys(CATEGORIES).filter((id) => s[`cat.${id}`] !== false);
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
  view.innerHTML = `
    ${reauth ? '<div class="card" style="border-color:var(--bad)"><b>Gmail non è più collegato.</b> <button class="btn" id="reauth" style="margin-top:8px;width:100%">Riconnetti Gmail</button></div>' : ''}
    <select id="yr" aria-label="Anno">${ys.map((v) => `<option ${v === state.year ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <div class="grid enter" style="margin-top:12px;--i:1">
      <div class="kpi glow"><small>Spese ${state.year}</small><b data-count="${t.spese}">${eur(t.spese)}</b>
        ${y.pct != null ? `<small class="${y.pct > 0 ? 'neg' : 'pos'}">${y.pct > 0 ? '▲' : '▼'} ${num(Math.abs(y.pct), 1)}% vs ${state.year - 1}</small>` : '<small>&nbsp;</small>'}</div>
      <div class="kpi"><small>Acconti GSE</small><b class="pos" data-count="${t.entrate}">${eur(t.entrate)}</b>
        <small>Saldo <span class="${t.saldo >= 0 ? 'pos' : 'neg'}">${eur(t.saldo)}</span></small></div>
    </div>
    ${review ? `<div class="card enter" style="--i:2"><b>${review}</b> document${review > 1 ? 'i' : 'o'} da verificare <a href="#/docs" data-filter="review" style="float:right">Apri →</a></div>` : ''}
    <div class="card enter" style="--i:2"><h3>Spesa mensile</h3>${bills.length ? stackedBars(byCat, ids) : emptyState('Nessun dato ancora', 'Collega Gmail e tocca ⟳ per cercare le bollette.')}
      <div class="legend">${ids.map((id) => `<span><i style="background:${cat(id).color}"></i>${cat(id).label}</span>`).join('')}</div></div>
    <div class="card enter" style="--i:3"><h3>Per categoria</h3>${ids.map((id) => {
      const v = t.perCategoria[id] || 0;
      return `<div class="row"><div class="ico" style="background:${cat(id).color}22">${cat(id).icon}</div><div class="grow"><div class="t">${cat(id).label}</div></div><b class="${cat(id).kind === 'income' ? 'pos' : ''}" data-count="${v}">${eur(v)}</b></div>`;
    }).join('')}</div>
    ${next.length ? `<div class="card enter" style="--i:4"><h3>Prossime scadenze</h3>${next.slice(0, 5).map((b) => billRow(b, true)).join('')}</div>` : ''}`;
  $('#yr').onchange = (e) => { state.year = Number(e.target.value); renderHome(); };
  if (reauth) $('#reauth').onclick = () => runAction('action.connect');
  view.querySelectorAll('.row[data-id]').forEach((r) => (r.onclick = () => openBill(Number(r.dataset.id))));
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
  const rows = bills.filter((b) => (f === 'all' || (f === 'review' ? b.needsReview : b.category === f))
    && (!q || `${b.supplier} ${b.fileName} ${b.invoiceNumber} ${b.subject}`.toLowerCase().includes(q)));
  view.innerHTML = `
    <input type="search" id="q" placeholder="Cerca fornitore, numero…" value="${esc(state.q)}">
    <div class="chips" style="margin-top:10px">
      ${[['all', 'Tutti'], ['review', 'Da verificare'], ...ids.map((id) => [id, cat(id).label])].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
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
  const field = (k, label, type = 'text') => `<label>${label}</label><input type="${type}" data-k="${k}" ${type === 'number' ? 'step="0.01"' : ''} value="${esc(b[k] ?? '')}">`;
  dlg.innerHTML = `
    <h2 style="margin:0 0 4px">${id ? 'Dettaglio documento' : 'Nuovo documento'}</h2>
    <label>Categoria</label><select data-k="category">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${b.category === k ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}</select>
    ${field('supplier', 'Fornitore')}${field('amount', 'Importo (€)', 'number')}${field('consumption', 'Consumo', 'number')}
    ${field('issueDate', 'Data documento', 'date')}${field('periodFrom', 'Periodo da', 'date')}${field('periodTo', 'Periodo a', 'date')}
    ${field('dueDate', 'Scadenza', 'date')}${field('invoiceNumber', 'Numero documento')}
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-k="paid" ${b.paid ? 'checked' : ''}> Pagata</label>
    <div id="pdfbox" style="margin-top:10px"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="btn" id="save">Salva</button>
      ${b.pdf ? '<button class="btn sec" id="pdfBtn">Vedi PDF</button>' : ''}
      ${id ? '<button class="btn danger" id="del">Elimina</button>' : ''}
      <button class="btn sec" id="close">Chiudi</button></div>`;
  dlg.showModal();
  $('#close', dlg).onclick = () => dlg.close();
  if (b.pdf) $('#pdfBtn', dlg).onclick = async () => renderPdf(await b.pdf.arrayBuffer(), $('#pdfbox', dlg));
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
    dlg.close(); toast('Salvato'); route();
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
  for (const sec of SETTINGS_SCHEMA) {
    html += `<div class="set-group enter" style="--i:${gi++}"><h2>${sec.icon} ${sec.title}</h2><div class="card" style="padding:4px 14px">`;
    for (const it of sec.items) {
      const v = await getSetting(it.key);
      const hint = it.hint ? `<div class="hint">${esc(it.hint)}</div>` : '';
      if (it.type === 'toggle') html += `<div class="set-item"><div>${it.label}${hint}</div><label class="switch"><input type="checkbox" data-s="${it.key}" ${v ? 'checked' : ''}><span></span></label></div>`;
      else if (it.type === 'text') html += `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div>${it.label}</div>${hint}<input type="text" data-s="${it.key}" value="${esc(v)}" style="margin-top:6px"></div>`;
      else if (it.type === 'select') html += `<div class="set-item"><div>${it.label}</div><select data-s="${it.key}" style="width:auto">${it.options.map(([k, l]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      else if (it.type === 'action') {
        const label = it.key === 'action.connect' ? (connected ? 'Scollega Gmail' : (await gmail.needsReauth()) ? 'Riconnetti Gmail' : 'Collega Gmail') : it.label;
        html += `<div class="set-item"><div>${it.label}${it.key === 'action.connect' ? `<div class="hint">${connected ? 'Collegato' : 'Non collegato'}${last ? ' · ultimo sync ' + new Date(last).toLocaleString('it-IT') : ''}</div>` : ''}</div><button class="btn ${it.danger ? 'danger' : 'sec'}" data-a="${it.key}">${it.key === 'action.connect' ? label : 'Esegui'}</button></div>`;
      } else html += `<div class="set-item mut">${it.label}</div>`;
    }
    html += '</div></div>';
  }
  view.innerHTML = html + '<p class="mut" style="text-align:center">BillRadar 0.1 · dati salvati solo su questo dispositivo</p>';

  view.querySelectorAll('[data-s]').forEach((el) => (el.onchange = async () => {
    const val = el.type === 'checkbox' ? el.checked : el.value;
    await setSetting(el.dataset.s, val);
    if (el.dataset.s === 'ui.theme') applyTheme(val);
  }));
  view.querySelectorAll('[data-a]').forEach((el) => (el.onclick = () => runAction(el.dataset.a)));
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
      else { await gmail.connect(); toast('Gmail collegato'); await doSync(); }
      renderSettings();
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

// ---------- sync ----------
async function doSync() {
  const bar = $('#progress');
  try {
    if (!(await gmail.isConnected())) { toast('Collega prima Gmail in Impostazioni'); location.hash = '#/settings'; return; }
    bar.hidden = false;
    $('#syncBtn').classList.add('busy');
    const r = await gmail.sync((i, n) => { $('div', bar).style.width = `${(i / n) * 100}%`; $('span', bar).textContent = `Analizzo ${i}/${n}`; });
    toast(`Sincronizzato: ${r.added} nuovi, ${r.skipped} già presenti${r.errors ? `, ${r.errors} errori` : ''}`, 5000);
  } catch (e) { toast(e.message, 6000); }
  bar.hidden = true;
  $('#syncBtn').classList.remove('busy');
  route();
}
$('#syncBtn').onclick = doSync;
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
  const tab = (location.hash.replace('#/', '') || 'home');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  moveIndicator();
  ({ home: renderHome, docs: renderDocs, stats: renderStats, settings: renderSettings }[tab] || renderHome)();
  window.scrollTo(0, 0);
}
view.addEventListener('click', (e) => { const a = e.target.closest('[data-filter]'); if (a) state.filter = a.dataset.filter; });
window.addEventListener('hashchange', route);

(async () => {
  applyTheme(await getSetting('ui.theme'));
  const t0 = performance.now();
  await route();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(hideSplash, Math.max(0, (calm ? 250 : 2300) - (performance.now() - t0)));
  $('#splash')?.addEventListener('click', hideSplash);
  await gmail.keepAlive();
  if ((await getSetting('gmail.auto')) && (await gmail.isConnected())) doSync();
})();
