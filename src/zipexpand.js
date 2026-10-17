// Espansione di file e archivi .zip in una lista di PDF (logica pura, testabile senza browser).
import { unzipSync } from 'fflate';

const MAX_ENTRIES = 2000, MAX_BYTES = 60 * 1024 * 1024;
const isZip = (name, b) => /\.zip$/i.test(name) || (b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4);
const isPdfBytes = (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;   // %PDF

/**
 * Espande file e archivi in una lista piatta di PDF.
 * items: [{ name, bytes: Uint8Array, mtime }]  →  { pdfs: [{name, bytes, mtime}], ignored: n, errors: [msg] }
 */
export function expandInputs(items, depth = 0, acc = { pdfs: [], ignored: 0, errors: [], bytes: 0 }) {
  for (const it of items) {
    if (isZip(it.name, it.bytes) && depth < 2) {
      let files;
      try { files = unzipSync(it.bytes, { filter: (f) => !f.name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(f.name) && f.originalSize <= MAX_BYTES }); }
      catch { acc.errors.push(`${it.name}: archivio non leggibile`); continue; }
      const inner = Object.entries(files).map(([n, bytes]) => ({ name: n.split('/').pop() || n, bytes, mtime: it.mtime }));
      if (inner.length + acc.pdfs.length > MAX_ENTRIES) { acc.errors.push(`${it.name}: troppi file`); continue; }
      expandInputs(inner, depth + 1, acc);
    } else if (/\.pdf$/i.test(it.name) && isPdfBytes(it.bytes)) {
      acc.bytes += it.bytes.length;
      acc.pdfs.push(it);
    } else acc.ignored++;
  }
  return acc;
}

