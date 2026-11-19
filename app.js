/* Documentation library: encrypted local vault, import, organization, timeline, packets, backups. */
(() => {
'use strict';
const L = Lib;
/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : L.hex(crypto.getRandomValues(new Uint8Array(16))));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtDate = (d, long) => { const x = parseD(d); return x ? x.toLocaleDateString('en-US', long ? { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) : (d || ''); };
const fmtTime = t => { if (!t) return ''; const [H, M] = t.split(':').map(Number); if (isNaN(H)) return t; return `${(H % 12) || 12}:${pad(M || 0)} ${H >= 12 ? 'PM' : 'AM'}`; };
const stamp = iso => iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const fmtSize = b => b == null ? '' : b < 1024 ? b + ' bytes' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const money = a => { if (a === '' || a == null) return ''; const n = Number(String(a).replace(/[$,]/g, '')); return isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : String(a); };
const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
let toastT; function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 5000); }
function busy(t) { $('busyText').textContent = t || 'Working…'; $('busy').classList.remove('hidden'); }
function unbusy() { $('busy').classList.add('hidden'); }
const inArtifact = () => !!(window.claude && typeof window.claude.use === 'function');
async function saveBlob(blob, name) {
  if (inArtifact()) { let d = null; try { d = await window.claude.use('downloads'); } catch { }
    if (d) { try { await d.save({ filename: name, data: blob }); return true; } catch (e) { if (e && e.code === 'declined') { toast('Download cancelled.'); return false; } if (e && e.code === 'rate_limited') { toast('Another download prompt is already open.'); return false; } } } }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 20000); return true;
}
function noPrintHere() { if (!inArtifact()) return false; msg('Printing isn\'t available here', '<p>Printing is blocked inside this Claude view. Use <b>Download PDF</b>, then open and print the PDF.</p>'); return true; }
const safeName = s => String(s || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'file';
const fv = v => /^\d{2}:\d{2}$/.test(v || '') ? fmtTime(v) : /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? fmtDate(v) : v;
const csv = rows => rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
function msg(title, html, buttons = [{ label: 'OK', value: 'ok', primary: true }]) {
  return new Promise(res => {
    const d = $('dlgMsg'); $('msgTitle').textContent = title; $('msgBody').innerHTML = html; const f = $('msgFoot'); f.innerHTML = '';
    for (const b of buttons) { const el = document.createElement('button'); el.type = 'button'; el.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''); el.textContent = b.label; el.onclick = () => { d.close(); res(b.value); }; f.append(el); }
    d.onclose = () => res(null); d.showModal();
  });
}
function askText(title, text, { password = true, placeholder = '' } = {}) {
  return new Promise(res => {
    const d = $('dlgPass'), inp = $('ppInput'); $('ppTitle').textContent = title; $('ppText').textContent = text; inp.type = password ? 'password' : 'text'; inp.value = ''; inp.placeholder = placeholder;
    d.onclose = () => res(d.returnValue === 'ok' ? inp.value : null); d.returnValue = ''; d.showModal(); inp.focus();
  });
}

/* ================= categories ================= */
const GROUPS = {
  police: { label: 'Police Interactions', color: '#b0573d', sym: '◆' }, incident: { label: 'Events and occurrences', color: '#a2455f', sym: '✱' },
  parenting: { label: 'Parenting', color: '#2f7f73', sym: '●' }, comms: { label: 'Communications', color: '#3a6d9a', sym: '▲' },
  care: { label: 'Child & Care', color: '#765a8f', sym: '■' }, finance: { label: 'Financial', color: '#a8752c', sym: '$' },
  court: { label: 'Court & Legal', color: '#3f4a7c', sym: '§' }, evidence: { label: 'Evidence', color: '#5c6875', sym: '◎' },
  other: { label: 'Not yet categorized', color: '#6b7280', sym: '?' }
};
const GROUP_ORDER = ['police', 'incident', 'parenting', 'comms', 'care', 'finance', 'court', 'evidence', 'other'];
const CATS = {
  INCD:['Incident','incident'], EVID:['Evidence','evidence'], COMM:['Communication','comms'], POLI:['Police contact','police'],
  PPD: ['Police Interaction', 'police'], INC: ['General Incident', 'incident'], PAR: ['Parenting Issue', 'parenting'],
  KCT: ['Child Contact', 'comms'], EXC: ['Parenting Exchange', 'comms'], MED: ['Medical', 'care'], EDU: ['Education', 'care'], THR: ['Therapy', 'care'],
  ACT: ['Activities', 'care'], WEL: ['Well-being', 'care'], OBS: ['Child Statements & Observations', 'care'], FIN: ['Financial', 'finance'], RCP: ['Receipt', 'finance'],
  CRT: ['Court / Legal', 'court'], EVD: ['Evidence', 'evidence'],
  COM: ['Communications (older code)', 'comms'], CHD: ['Child & Care (older code)', 'care'], EV: ['Evidence (older code EV)', 'evidence'], EB: ['Evidence (older code EB)', 'evidence'], IN: ['Incident (older code IN)', 'incident'],
  SRC: ['Supporting file', 'evidence']
};
const prefixOf = id => { const m = /^([A-Z]{2,4})(?=-?\d)/.exec(String(id || '').toUpperCase()); return m && CATS[m[1]] ? m[1] : ''; };
const groupOf = r => (CATS[r.category] || [, 'other'])[1];
const colorOf = r => GROUPS[groupOf(r)].color;
const catLabel = c => CATS[c] ? CATS[c][0] : 'Not yet categorized';
const METHOD = {
  'manifest-v2': ['Verified record data', 'm-verified', 'Read directly from the structured data inside the PDF.'],
  'manifest-legacy': ['Verified record data (older format)', 'm-verified', 'Read from structured data made by an earlier version of the documentation app.'],
  'hash-match': ['Matched by fingerprint', 'm-verified', 'This file\'s SHA-256 fingerprint matches a file listed inside a record.'],
  'filename': ['Guessed from file name — check', 'm-inferred', 'No structured data was found. These details come from the file name.'],
  'text': ['Found in PDF text — check', 'm-inferred', 'No structured data was found. The ID was found by scanning the PDF\'s text.'],
  'manual': ['Enter details', 'm-manual', 'Nothing could be read automatically. Please fill in what you know.'],
  'created': ['Made in this app', 'm-verified', 'Created here from your own entries and saved automatically.']
};

/* ================= storage (IndexedDB + Web Crypto) ================= */
const ITER = 600000, CHECK = 'documentation-vault-check-v1';
let db = null, key = null, R = [], S = null;
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function openDB() { return new Promise((res, rej) => { const r = indexedDB.open('inkyridion-vault', 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('meta'); d.createObjectStore('records', { keyPath: 'id' }); d.createObjectStore('files', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('Close other tabs of this app and try again.')); }); }
function tx(stores, mode, fn) { return new Promise((res, rej) => { let t; try { t = db.transaction(stores, mode); } catch (e) { rej(e); return; } let out; try { out = fn(t); } catch (e) { try { t.abort(); } catch { } rej(e); return; } t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Saving was cancelled.')); }); }
async function idbGetV(store, k) { let v; await tx([store], 'readonly', t => { t.objectStore(store).get(k).onsuccess = e => v = e.target.result; }); return v; }
async function idbAll(store) { let v; await tx([store], 'readonly', t => { t.objectStore(store).getAll().onsuccess = e => v = e.target.result; }); return v || []; }
async function deriveKey(pass, salt, iter = ITER) { const base = await crypto.subtle.importKey('raw', L.enc.encode(pass), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function sealBytes(u8, k = key) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, u8)); return { iv, ct }; }
async function unsealBytes(row, k = key) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, k, row.ct)); }
const seal = (o, k) => sealBytes(L.enc.encode(JSON.stringify(o)), k);
const unseal = async (row, k) => JSON.parse(L.dec.decode(await unsealBytes(row, k)));
async function putRecords(recs) { const rows = await Promise.all(recs.map(async r => ({ id: r.uid, ...await seal(r) }))); await tx(['records'], 'readwrite', t => { const s = t.objectStore('records'); rows.forEach(x => s.put(x)); }); }
async function saveSettings() { const row = await seal(S); await tx(['meta'], 'readwrite', t => t.objectStore('meta').put(row, 'settings')); }
const defaultSettings = () => ({ idle: 10, pkt: { year: new Date().getFullYear(), next: 1 }, srcNext: 1, lastBackup: null, imports: [], packets: [] });
async function fileBytes(rec) { const row = await idbGetV('files', rec.source.fileId); if (!row) throw new Error('The stored file for ' + rec.docId + ' is missing.'); return unsealBytes(row); }

/* ================= lock screen ================= */
let mode = 'loading';
async function initAuth() {
  if (location.protocol === 'file:') $('fileBanner').classList.remove('hidden');
  if (!window.indexedDB || !window.crypto?.subtle) { $('authHint').textContent = 'This browser can\'t run the secure library. It needs IndexedDB and Web Crypto — use a current browser and open the app from its https address.'; $('authForm').classList.add('hidden'); return; }
  try { db = await openDB(); } catch (e) { $('authHint').textContent = 'Storage is unavailable here (' + e.message + '). Private browsing modes often block it.'; $('authForm').classList.add('hidden'); return; }
  const meta = await idbGetV('meta', 'vault');
  if (meta) setMode('unlock'); else setMode('create');
}
function setMode(m) {
  mode = m; $('authErr').textContent = ''; $('pass').value = ''; $('pass2').value = '';
  const create = m === 'create';
  $('confirmWrap').classList.toggle('hidden', !create); $('restoreWelcome').classList.toggle('hidden', !create);
  $('authHint').textContent = create ? 'Create a passphrase to set up your private library on this device. It encrypts everything you import.' : 'Enter your passphrase to unlock.';
  $('passHelp').textContent = create ? 'At least 12 characters. A short sentence works well. If you forget it, the library can\'t be recovered — so you\'ll also want backups.' : '';
  $('authBtn').textContent = create ? 'Create library' : 'Unlock';
  $('authTitle').textContent = create ? 'Welcome to Inkyridion' : 'Welcome back';
  $('pass').setAttribute('autocomplete', create ? 'new-password' : 'current-password');
  $('auth').classList.remove('hidden'); $('app').classList.add('hidden');
  setTimeout(() => $('pass').focus(), 50);
}
async function onAuth(e) {
  e.preventDefault(); const p = $('pass').value; $('authErr').textContent = '';
  if (mode === 'create') {
    if (p.length < 12) { $('authErr').textContent = 'Use at least 12 characters.'; return; }
    if (p !== $('pass2').value) { $('authErr').textContent = 'The two entries don\'t match.'; return; }
    busy('Setting up your encrypted library…');
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16)); key = await deriveKey(p, salt);
      const check = await sealBytes(L.enc.encode(CHECK)); S = defaultSettings(); const srow = await seal(S);
      await tx(['meta'], 'readwrite', t => { const m = t.objectStore('meta'); m.put({ v: 1, salt, iter: ITER, check, created: new Date().toISOString() }, 'vault'); m.put(srow, 'settings'); });
      try { await navigator.storage?.persist?.(); } catch { }
      R = []; enterApp();
    } catch (err) { $('authErr').textContent = 'Could not create the library: ' + err.message; } finally { unbusy(); }
  } else if (mode === 'unlock') {
    busy('Unlocking…');
    try {
      const meta = await idbGetV('meta', 'vault'); const k = await deriveKey(p, meta.salt, meta.iter);
      try { const c = await unsealBytes(meta.check, k); if (L.dec.decode(c) !== CHECK) throw 0; } catch { $('authErr').textContent = 'That passphrase didn\'t unlock the library.'; return; }
      key = k; const srow = await idbGetV('meta', 'settings'); S = srow ? { ...defaultSettings(), ...await unseal(srow) } : defaultSettings();
      const rows = await idbAll('records'); R = []; const bad = [];
      for (const r of rows) { try { R.push(await unseal(r)); } catch { bad.push(r.id); } }
      enterApp(); if (bad.length) msg('Some records could not be read', `<p>${bad.length} stored record(s) failed their integrity check and were skipped. Restore from a backup if this continues.</p>`);
    } catch (err) { $('authErr').textContent = 'Could not unlock: ' + err.message; } finally { unbusy(); }
  }
}
function enterApp() { $('auth').classList.add('hidden'); $('app').classList.remove('hidden'); $('pass').value = ''; $('pass2').value = ''; lastActive = Date.now(); renderAll(); window.Record?.onUnlock(); go('record'); }
function lock() {
  key = null; R = []; S = null; staged = []; pkExcluded.clear();
  document.querySelectorAll('dialog[open]').forEach(d => d.close()); $('printRoot').innerHTML = ''; ['recent', 'tlPreview', 'libBody', 'tlList', 'cal', 'reviewList', 'pkRecords', 'pvBody', 'recBody'].forEach(id => { const e = $(id); if (e) e.innerHTML = ''; });
  $('review').classList.add('hidden'); setMode('unlock');
}
let lastActive = Date.now();
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
setInterval(() => { if (key && S && Date.now() - lastActive > (S.idle || 10) * 60000) { lock(); toast('Locked after inactivity.'); } }, 15000);

/* ================= navigation ================= */
let view = 'record';
function go(v) {
  view = v; document.querySelectorAll('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'v-' + v));
  document.querySelectorAll('.nav').forEach(b => b.toggleAttribute('aria-current', b.dataset.view === v)); document.querySelectorAll('.nav[aria-current]').forEach(b => b.setAttribute('aria-current', 'page'));
  ({ record: () => window.Record?.render(), library: () => { renderOverview(); renderLibrary(); }, timeline: renderTimeline, packet: renderPacket, settings: renderSettings })[v]();
  scrollTo(0, 0); $('main').focus({ preventScroll: true });
}
function renderAll() { fillFilterOptions(); if (view) ({ record: () => window.Record?.render(), library: () => { renderOverview(); renderLibrary(); }, timeline: renderTimeline, packet: renderPacket, settings: renderSettings })[view] ?.(); }

/* ================= derived data ================= */
const current = () => R.filter(r => r.isCurrent !== false);
const byDoc = id => R.filter(r => r.docId === id);
const findCurrent = id => R.find(r => r.docId === id && r.isCurrent !== false) || R.find(r => r.docId === id);
const allCases = () => [...new Set(current().flatMap(r => r.caseRefs.map(c => c.caseNumber)))].sort();
const isAttachment = r => r.kind === 'file' && !!r.evidence?.matchedTo;
const sortKey = r => (r.eventDate || '9999-99-99') + 'T' + (r.eventTime || '99:99');
function refInfo(rec) {
  const related = (rec.relatedIds || []).filter(id => id && id !== rec.docId).map(id => ({ id, rec: findCurrent(id), status: findCurrent(id) ? 'imported' : (rec.refStatus?.[id] || 'missing') }));
  const files = (rec.manifestFiles || []).map(f => { const hit = (f.sha256 && R.find(r => r.source?.sha256 === f.sha256)) || (f.ref && R.find(r => r.docId === f.ref && r.kind === 'file')); return { ...f, rec: hit || null, status: hit ? 'imported' : 'missing' }; });
  return { related, files, missing: related.filter(x => x.status !== 'imported').length + files.filter(x => x.status !== 'imported').length };
}
function findRefByHash(sha) {
  for (const r of R) for (const f of r.manifestFiles || []) if (f.sha256 === sha) return { ref: f.ref, name: f.name, parent: r.docId, date: r.eventDate };
  for (const s of staged) for (const f of s.manifest?.files || []) if (f.sha256 === sha) return { ref: f.ref, name: f.name, parent: s.manifest.id, date: s.manifest.eventDate };
  return null;
}
function evidenceInventory(recs) {
  const rows = [], seenFileRecs = new Set(); const inSet = new Set(recs.map(r => r.uid));
  for (const r of recs) {
    if (r.kind === 'file') continue;
    if (r.category === 'EVID' || r.category === 'EVD' || r.category === 'EV' || r.category === 'EB') {
      const desc = (r.narrative || [])[0]?.value || r.title;
      rows.push({ code: r.docId, desc, source: r.fields.find(f => /source/i.test(f.label))?.value || r.preparedBy || '', parent: r.docId, related: (r.relatedIds || []).join(', '), status: (r.manifestFiles || []).length ? 'Evidence record (files listed below)' : 'Evidence record — no file attached to the record', sha: '', color: colorOf(r), rec: r });
    }
    for (const f of refInfo(r).files) {
      if (f.rec) seenFileRecs.add(f.rec.uid);
      rows.push({ code: f.ref || '(no code)', desc: f.name || '', source: r.docId, parent: r.docId, related: r.docId, status: f.status === 'imported' ? (f.sha256 && f.rec?.source?.sha256 === f.sha256 ? 'Imported — fingerprint matches' : 'Imported') : 'Referenced evidence — not yet uploaded', sha: f.sha256 || '', color: colorOf(r), rec: f.rec || r, missing: f.status !== 'imported' });
    }
  }
  const seenCodes = new Set(rows.map(x => x.code));
  for (const r of recs) for (const id of r.relatedIds || []) { if (!/^(EVID|EVD|EV|EB)-?\d/.test(id) || seenCodes.has(id) || findCurrent(id)) continue; seenCodes.add(id); rows.push({ code: id, desc: `Referenced by ${r.docId}`, source: '', parent: r.docId, related: r.docId, status: 'Referenced evidence — not yet uploaded', sha: '', color: GROUPS.evidence.color, rec: r, missing: true }); }
  for (const r of recs) if (r.kind === 'file' && !seenFileRecs.has(r.uid)) rows.push({ code: r.docId, desc: r.evidence?.description || r.title, source: r.evidence?.source || '', parent: r.evidence?.matchedTo || '', related: (r.links || []).map(l => l.to).join(', '), status: 'Imported — not referenced by a record', sha: r.source.sha256, color: colorOf(r), rec: r });
  void inSet; return rows;
}

/* ================= import ================= */
let staged = [];
function parseFilename(name) {
  const m = /^([A-Z]{2,4}\d{3,6})(?:_rev(\d+))?_(\d{4}-\d{2}-\d{2})(?:_(.+?))?\.pdf$/i.exec(name);
  if (!m || !prefixOf(m[1])) return null;
  return { docId: m[1].toUpperCase(), category: prefixOf(m[1]), eventDate: m[3], title: (m[4] || '').replace(/_+/g, ' ').trim(), revision: Number(m[2]) || 1 };
}
async function stage(fileList) {
  const files = [...fileList]; if (!files.length) return; if (!key) return; if (view !== 'library') go('library');
  busy('Reading and fingerprinting files…');
  try {
    const items = [];
    for (const f of files) {
      const u8 = new Uint8Array(await f.arrayBuffer()); const t = L.sniff(u8, f.name);
      if (t.kind === 'zip') {
        try { for (const e of await L.unzip(u8)) { if (/(^|\/)(__MACOSX|\.DS_Store)/.test(e.name)) continue; if (e.unsupported) { items.push({ error: `${f.name} › ${e.name}: compressed in a way this browser can't open. Unzip it first.` }); continue; } items.push({ name: e.name.split('/').pop(), path: `${f.name} › ${e.name}`, u8: e.data }); } }
        catch (err) { items.push({ error: `${f.name}: ${err.message}` }); }
        continue;
      }
      items.push({ name: f.name, u8, lastModified: f.lastModified ? new Date(f.lastModified).toISOString() : null });
    }
    const total = items.reduce((a, i) => a + (i.u8?.length || 0), 0);
    if (navigator.storage?.estimate) { const est = await navigator.storage.estimate(); if (est.quota && est.quota - est.usage < total * 1.15 + 2e6) throw new Error(`These files need about ${fmtSize(total)}, but only about ${fmtSize(est.quota - est.usage)} of browser storage is free. Import fewer files at a time, or free up space.`); }
    for (const it of items) staged.push(it.error ? { tmp: uid(), error: it.error } : await analyze(it));
    resolveDuplicates(); renderReview();
    $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { msg('Import stopped', `<p>${esc(e.message)}</p><p>Nothing was saved.</p>`); }
  finally { unbusy(); }
}
async function analyze(it) {
  const t = L.sniff(it.u8, it.name); const sha = await L.sha256(it.u8);
  const s = { tmp: uid(), name: it.name, path: it.path || it.name, size: it.u8.length, u8: it.u8, type: t, sha256: sha, lastModified: it.lastModified || null, method: 'manual', manifest: null, schema: '', revision: 1, kind: t.kind === 'pdf' ? 'record' : 'file',
    f: { docId: '', category: '', title: '', eventDate: '', eventTime: '', cases: '' }, reviewed: false, action: 'save', dup: null, notes: [] };
  if (t.kind === 'pdf') {
    let man = null; try { man = L.readManifest(L.latin1(it.u8)); } catch { s.notes.push('Record data was found inside this PDF but could not be read. Enter the details by hand.'); }
    if (man) { const r = man.record; s.manifest = r; s.method = man.method; s.schema = man.schema; s.revision = Number(r.revision) || 1; s.reviewed = true;
      s.f = { docId: String(r.id || '').toUpperCase(), category: prefixOf(r.id), title: r.title || '', eventDate: r.eventDate || '', eventTime: r.eventTime || '', cases: (r.caseRefs || []).map(c => c.caseNumber).join(', ') }; }
    else {
      const fn = parseFilename(it.name);
      if (fn) { s.method = 'filename'; s.revision = fn.revision; Object.assign(s.f, { docId: fn.docId, category: fn.category, eventDate: fn.eventDate, title: fn.title }); }
      else { let txt = ''; try { txt = await L.scanPdfText(it.u8); } catch { }
        const id = (txt.match(/Document ID\s+([A-Z]{2,4}\d{3,6})/) || txt.match(/\b((?:INCD|POLI|COMM|EVID|INC|PAR|EVD|PPD|KCT|EXC|FIN|RCP|CRT|MED|EDU|THR|ACT|WEL|OBS|COM|CHD)\d{3,6})\b/) || [])[1];
        if (id) { s.method = 'text'; s.f.docId = id; s.f.category = prefixOf(id); } }
      if (!s.f.title) s.f.title = it.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
      s.notes.push('Printed or "Save as PDF" copies don\'t carry record data, so please check these details.');
    }
  } else {
    const ref = findRefByHash(sha);
    if (ref) { s.method = 'hash-match'; s.reviewed = true; Object.assign(s.f, { docId: (ref.ref || '').toUpperCase(), category: prefixOf(ref.ref) || 'EVID', title: ref.name || it.name, eventDate: ref.date || '' }); s.matchedTo = ref.parent; }
    else s.f.title = it.name;
    if (t.kind === 'other') s.notes.push('This file type isn\'t recognized. It can still be stored and listed as-is.');
  }
  return s;
}
function resolveDuplicates() {
  const seen = [];
  for (const s of staged) {
    if (s.error) continue; s.dup = null;
    const exact = R.find(r => r.source?.sha256 === s.sha256) || seen.find(o => o.sha256 === s.sha256 && o.action !== 'skip');
    if (exact) { s.dup = { type: 'exact', other: exact.docId || exact.f?.docId || exact.name, otherUid: exact.uid || null }; if (!['skip', 'copy'].includes(s.action)) s.action = 'skip'; seen.push(s); continue; }
    const id = s.f.docId.trim().toUpperCase();
    if (id) {
      const prior = [...R.filter(r => r.docId === id), ...seen.filter(o => o.f.docId === id && o.action !== 'skip').map(o => ({ docId: id, title: o.f.title, eventDate: o.f.eventDate, revision: o.revision, isCurrent: o.action !== 'older', staged: true }))];
      if (prior.length) {
        const cur = prior.find(p => p.isCurrent !== false) || prior[0];
        const differs = (cur.title || '') !== (s.f.title || '') && (cur.eventDate || '') !== (s.f.eventDate || '');
        if (differs && !(s.revision > (cur.revision || 1))) { s.dup = { type: 'conflict', other: id, cur }; if (!['review', 'current', 'older', 'skip'].includes(s.action) || s.action === 'save') s.action = 'review'; }
        else { s.dup = { type: 'revision', other: id, cur }; if (s.action === 'save') s.action = s.revision > (cur.revision || 1) ? 'current' : 'older'; }
      } else if (['current', 'older', 'review', 'copy'].includes(s.action) && !s.dup) s.action = 'save';
    }
    seen.push(s);
  }
}
function catOptions(sel) { return `<option value="">Choose…</option>` + Object.entries(CATS).map(([k, [l]]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)} (${k})</option>`).join(''); }
function renderReview() {
  const box = $('reviewList'); const live = staged.filter(s => !s.error);
  $('review').classList.toggle('hidden', !staged.length);
  if (!staged.length) { box.innerHTML = ''; return; }
  const toSave = live.filter(s => s.action !== 'skip').length;
  $('reviewSub').textContent = `${staged.length} file(s). Green labels mean the details were read from data inside the file. Yellow means please check.`;
  $('reviewCount').textContent = `${toSave} will be saved${live.length - toSave ? `, ${live.length - toSave} skipped` : ''}.`;
  box.innerHTML = staged.map(s => {
    if (s.error) return `<div class="rv" data-tmp="${s.tmp}"><div class="rv-top"><div class="rv-name">⚠ ${esc(s.error)}</div><button class="btn small" data-rm type="button">Dismiss</button></div></div>`;
    const [ml, mc, mt] = METHOD[s.method]; const fromData = !!s.manifest;
    let dupHtml = '';
    if (s.dup?.type === 'exact') dupHtml = `<div class="banner warn"><b>Exact duplicate.</b> This file is identical (same fingerprint) to ${esc(s.dup.other)}.<label>What to do<select data-k="action"><option value="skip" ${s.action === 'skip' ? 'selected' : ''}>Skip it — don't save a second copy</option><option value="copy" ${s.action === 'copy' ? 'selected' : ''}>Keep as a separately documented copy</option></select></label>${s.dup.otherUid ? `<button class="btn small" type="button" data-open="${s.dup.otherUid}">Review the existing file</button>` : ''}</div>`;
    else if (s.dup) { const c = s.dup.cur || {}; dupHtml = `<div class="banner warn"><b>${s.dup.type === 'conflict' ? 'ID conflict' : 'Another version of this record'}.</b> ${esc(s.dup.other)} is already in the library${c.staged ? ' (in this import)' : ''}: revision ${esc(c.revision || 1)}, "${esc(c.title || '')}", ${esc(fmtDate(c.eventDate) || 'no date')}. This file: revision ${esc(s.revision)}${s.dup.type === 'conflict' ? ' — the title and date are different, so it may be an unrelated record using the same ID' : ''}.
      <label>What to do<select data-k="action">${[['current', 'Save as the current version (keep the other as history)'], ['older', 'Save as an earlier version'], ['review', 'Save it to the review queue and decide later'], ['skip', 'Don\'t save it']].map(([v, l]) => `<option value="${v}" ${s.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`; }
    return `<div class="rv" data-tmp="${s.tmp}">
      <div class="rv-top"><div><div class="rv-name">${esc(s.path)}</div><div class="muted" style="font-size:14.5px">${esc(s.type.label)} · ${fmtSize(s.size)} · SHA-256 ${esc(s.sha256.slice(0, 16))}…</div></div><span class="method ${mc}" title="${esc(mt)}">${esc(ml)}</span></div>
      ${s.notes.map(n => `<p class="hint">${esc(n)}</p>`).join('')}${s.matchedTo ? `<p class="hint">Listed inside ${esc(s.matchedTo)} — it will be linked to that record.</p>` : ''}
      ${dupHtml}
      <div class="rv-grid">
        ${!fromData ? `<label>This is<select data-k="kind"><option value="record" ${s.kind === 'record' ? 'selected' : ''}>A documentation record</option><option value="file" ${s.kind === 'file' ? 'selected' : ''}>Evidence or a supporting file</option></select></label>` : ''}
        <label>Record ID${fromData ? ' (from record data)' : ''}<input data-k="docId" value="${esc(s.f.docId)}" ${fromData ? 'readonly' : ''} placeholder="${s.kind === 'file' ? 'Optional, e.g. EVID007' : 'e.g. POLI004'}"></label>
        <label>Category<select data-k="category">${catOptions(s.f.category)}</select></label>
        <label>Title<input data-k="title" value="${esc(s.f.title)}"></label>
        <label>${s.kind === 'file' ? 'Date (if known)' : 'Event date'}<input type="date" data-k="eventDate" value="${esc(s.f.eventDate)}"></label>
        ${s.kind === 'record' ? `<label>Time (if known)<input type="time" data-k="eventTime" value="${esc(s.f.eventTime)}"></label>` : ''}
        <label>Case number(s)<input data-k="cases" value="${esc(s.f.cases)}" placeholder="Separate with commas"></label>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:6px">
        <label class="check"><input type="checkbox" data-k="reviewed" ${s.reviewed ? 'checked' : ''}> I checked these details</label>
        <button class="btn small" type="button" data-rm>Remove from this import</button>
      </div></div>`;
  }).join('');
}
function onReviewInput(e) {
  const card = e.target.closest('.rv'); if (!card) return; const s = staged.find(x => x.tmp === card.dataset.tmp); if (!s) return;
  const k = e.target.dataset.k; if (!k) return;
  if (k === 'reviewed') s.reviewed = e.target.checked;
  else if (k === 'action') { s.action = e.target.value; renderReviewCounts(); }
  else if (k === 'kind') { s.kind = e.target.value; renderReview(); }
  else { s.f[k] = e.target.value; if (k === 'docId') { s.f.docId = s.f.docId.toUpperCase(); if (!s.f.category && prefixOf(s.f.docId)) { s.f.category = prefixOf(s.f.docId); } if (e.type === 'change') { resolveDuplicates(); renderReview(); } } }
}
function renderReviewCounts() { const live = staged.filter(s => !s.error); const n = live.filter(s => s.action !== 'skip').length; $('reviewCount').textContent = `${n} will be saved${live.length - n ? `, ${live.length - n} skipped` : ''}.`; }
function parseCases(text, prior = []) { return String(text || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map(n => ({ caseNumber: n, proceeding: (prior.find(p => p.caseNumber === n) || {}).proceeding || '' })); }
function buildRecord(s, fileId, now) {
  const m = s.manifest || {}; const f = s.f; const docIdIn = f.docId.trim().toUpperCase();
  const cat = f.category || prefixOf(docIdIn) || (s.kind === 'file' ? 'SRC' : '');
  let internalRef = ''; if (!docIdIn) { internalRef = 'SRC-' + pad(S.srcNext++, 4); }
  const rec = {
    uid: uid(), kind: s.kind, docId: docIdIn || internalRef, originalId: docIdIn, internalRef, category: cat, title: f.title.trim() || s.name,
    eventDate: f.eventDate, eventTime: s.kind === 'record' ? f.eventTime : '', timeAccuracy: f.eventTime ? (m.eventTime === f.eventTime && m.timeAccuracy ? m.timeAccuracy : 'Exact') : 'Unknown',
    timeZone: m.timeZone || '', entryStarted: m.entryStarted || '', generatedAt: m.generatedAt || '', revision: s.revision || 1, heading: m.heading || '', subcategory: m.subcategory || '',
    preparedBy: m.preparedBy || '', basis: m.basis || '', location: m.location || '', people: m.people || [], children: m.children || [],
    caseRefs: parseCases(f.cases, m.caseRefs || []), relatedIds: (m.relatedIds || []).map(x => String(x).toUpperCase()), fields: m.fields || [], narrative: m.narrative || [], sequence: m.sequence || [], manifestFiles: m.files || [], financial: m.financial || null,
    source: { fileId, name: s.name, path: s.path, size: s.size, mime: s.type.mime, typeLabel: s.type.label, sha256: s.sha256, lastModified: s.lastModified, importedAt: now },
    method: s.method, schema: s.schema, status: s.reviewed && cat && (f.eventDate || s.kind === 'file') ? 'confirmed' : 'needs-review', isCurrent: true,
    links: [], refStatus: {}, history: [{ at: now, field: 'Imported', from: '', to: `${METHOD[s.method][0]}` }], flags: [],
    evidence: s.kind === 'file' ? { description: '', source: '', acquired: '', preservation: '', handling: '', matchedTo: s.matchedTo || '' } : null,
    extracted: s.manifest ? { title: m.title || '', category: prefixOf(m.id), eventDate: m.eventDate || '', eventTime: m.eventTime || '', cases: (m.caseRefs || []).map(c => c.caseNumber).join(', ') } : null
  };
  if (rec.extracted) for (const [k, lab] of [['title', 'Title'], ['eventDate', 'Event date'], ['category', 'Category'], ['eventTime', 'Event time']]) if ((rec.extracted[k] || '') !== (rec[k] || '')) rec.history.push({ at: now, field: lab, from: rec.extracted[k] || '—', to: rec[k] || '—', note: 'Changed during import review (the original file is unchanged)' });
  if (s.matchedTo) rec.links.push({ to: s.matchedTo, type: 'Supporting evidence' });
  return rec;
}
async function saveCreated(o) {
  const now = new Date().toISOString(); const m = o.manifest;
  const s = { name: o.name, path: o.name, size: o.bytes.length, u8: o.bytes, type: { kind: o.noPdf ? 'document' : 'pdf', label: o.noPdf ? 'Record data (JSON)' : 'PDF document', mime: o.mime }, sha256: await L.sha256(o.bytes), lastModified: now, method: 'created', manifest: m, schema: 'documentation-record v2', revision: Number(m.revision) || 1, kind: 'record',
    f: { docId: String(m.id || '').toUpperCase(), category: prefixOf(m.id), title: m.title || '', eventDate: m.eventDate || '', eventTime: m.eventTime || '', cases: (m.caseRefs || []).map(c => c.caseNumber).join(', ') }, reviewed: true, notes: o.noPdf ? ['Saved as record data only: some characters can\'t go in a PDF. Use Print for a paper copy.'] : [] };
  const fileRows = []; const fid = uid(); fileRows.push({ id: fid, ...await sealBytes(o.bytes) });
  const rec = buildRecord(s, fid, now); rec.status = 'confirmed'; rec.history[0] = { at: now, field: 'Created', from: '', to: `Saved in this app (revision ${rec.revision})` };
  const demoted = R.filter(r => r.docId === rec.docId && r.isCurrent !== false && r.kind === 'record').map(r => ({ ...r, isCurrent: false, history: [...r.history, { at: now, field: 'Current version', from: 'Yes', to: `No — revision ${rec.revision} was saved` }] }));
  const newRecs = [rec];
  for (const f of o.files || []) {
    if (!f.file) continue; const u8 = new Uint8Array(await f.file.arrayBuffer()); const sha = f.hash || await L.sha256(u8);
    if (R.some(r => r.source?.sha256 === sha) || newRecs.some(r => r.source?.sha256 === sha)) continue;
    const fid2 = uid(); fileRows.push({ id: fid2, ...await sealBytes(u8) }); const t = L.sniff(u8, f.name);
    const fs = { name: f.name, path: f.name, size: u8.length, u8, type: t, sha256: sha, lastModified: f.lastModified || null, method: 'hash-match', manifest: null, schema: '', revision: 1, kind: 'file',
      f: { docId: String(f.ref || '').toUpperCase(), category: /^RCP/.test(f.ref || '') ? 'RCP' : 'EVID', title: f.name, eventDate: m.eventDate || '', eventTime: '', cases: s.f.cases }, reviewed: true, notes: [], matchedTo: rec.docId };
    const fr = buildRecord(fs, fid2, now); fr.history[0] = { at: now, field: 'Attached', from: '', to: `Added with ${rec.docId}` }; newRecs.push(fr);
  }
  const rows = await Promise.all([...newRecs, ...demoted].map(async r => ({ id: r.uid, ...await seal(r) }))); const srow = await seal(S);
  try { await tx(['records', 'files', 'meta'], 'readwrite', t => { const fst = t.objectStore('files'), rs = t.objectStore('records'); fileRows.forEach(x => fst.put(x)); rows.forEach(x => rs.put(x)); t.objectStore('meta').put(srow, 'settings'); }); }
  catch (e) { const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || '')); throw new Error(quota ? 'The browser ran out of storage space, so nothing was saved.' : 'Saving failed: ' + (e.message || e)); }
  for (const d of demoted) { const i = R.findIndex(r => r.uid === d.uid); if (i >= 0) R[i] = d; }
  R.push(...newRecs); fillFilterOptions();
  return rec.docId;
}
async function commitImport() {
  const todo = staged.filter(s => !s.error && s.action !== 'skip'); if (!todo.length) { toast('Nothing to save.'); return; }
  for (const s of todo) if (s.f.eventDate && !parseD(s.f.eventDate)) { msg('Check a date', `<p>${esc(s.name)} has a date that isn't valid.</p>`); return; }
  busy('Encrypting and saving…'); const now = new Date().toISOString(); const srcBefore = S.srcNext;
  try {
    const newRecs = [], fileRows = [], demote = new Map();
    for (const s of todo) {
      busy(`Encrypting ${s.name}…`);
      const fileId = uid(); fileRows.push({ id: fileId, ...await sealBytes(s.u8) });
      const rec = buildRecord(s, fileId, now);
      if (s.action === 'current') { R.filter(r => r.docId === rec.docId && r.isCurrent !== false).forEach(r => demote.set(r.uid, r)); newRecs.filter(r => r.docId === rec.docId).forEach(r => r.isCurrent = false); }
      if (s.action === 'older') rec.isCurrent = false;
      if (s.action === 'review') { rec.status = 'needs-review'; rec.flags.push(s.dup?.type === 'conflict' ? 'ID conflict: another record already uses this ID with a different title and date.' : 'Decide which version is current.'); if (R.some(r => r.docId === rec.docId && r.isCurrent !== false) || newRecs.some(r => r.docId === rec.docId && r.isCurrent)) rec.isCurrent = false; }
      if (s.action === 'copy') { rec.isCurrent = false; rec.copyOf = s.dup?.other || ''; rec.flags.push(`Exact copy of ${s.dup?.other} (same fingerprint), kept on purpose.`); }
      newRecs.push(rec);
    }
    const demoted = [...demote.values()].map(r => ({ ...r, isCurrent: false, history: [...r.history, { at: now, field: 'Current version', from: 'Yes', to: 'No — a newer version was imported' }] }));
    S.imports = [...(S.imports || []), { at: now, count: newRecs.length }].slice(-200);
    const rows = await Promise.all([...newRecs, ...demoted].map(async r => ({ id: r.uid, ...await seal(r) }))); const srow = await seal(S);
    await tx(['records', 'files', 'meta'], 'readwrite', t => { const fs = t.objectStore('files'), rs = t.objectStore('records'); fileRows.forEach(x => fs.put(x)); rows.forEach(x => rs.put(x)); t.objectStore('meta').put(srow, 'settings'); });
    for (const d of demoted) { const i = R.findIndex(r => r.uid === d.uid); if (i >= 0) R[i] = d; }
    R.push(...newRecs); staged = []; renderReview(); renderAll(); window.Record?.render();
    const nr = newRecs.filter(r => r.status === 'needs-review').length;
    toast(`${newRecs.length} saved to your library${nr ? ` — ${nr} need review` : ''}.`);
  } catch (e) {
    S.srcNext = srcBefore; S.imports = (S.imports || []).filter(x => x.at !== now);
    const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
    msg('Nothing was saved', `<p>${quota ? 'The browser ran out of storage space.' : 'Saving failed: ' + esc(e.message || e)}</p><p>Your library is unchanged. ${quota ? 'Try importing fewer or smaller files.' : 'Please try again.'}</p>`);
  } finally { unbusy(); }
}

/* ================= home ================= */
function recCard(r, extra = '') {
  const g = GROUPS[groupOf(r)]; const ri = r.kind === 'record' ? refInfo(r) : { related: [], missing: 0 };
  const badges = [r.status === 'needs-review' ? '<span class="badge b-review">Needs review</span>' : '', r.isCurrent === false ? '<span class="badge b-old">Earlier version / copy</span>' : '', ri.missing ? `<span class="badge b-miss">${ri.missing} missing reference${ri.missing > 1 ? 's' : ''}</span>` : ''].join('');
  return `<button type="button" class="rc" data-open="${r.uid}" style="--c:${g.color}"><span class="bar"></span><span><span class="id"><span class="sym" aria-hidden="true">${g.sym}</span>${esc(r.docId)}</span> <span class="badge b-cat" style="--c:${g.color}">${esc(catLabel(r.category))}</span>${badges}
    <span class="t" style="display:block">${esc(r.title)}</span><span class="m" style="display:block">${esc(r.source.name)}${r.caseRefs.length ? ' · Case ' + esc(r.caseRefs.map(c => c.caseNumber).join(', ')) : ''}${ri.related.length ? ` · ${ri.related.length} related` : ''}${extra}</span></span>
    <span class="d">${r.eventDate ? esc(fmtDate(r.eventDate)) : '<span class="badge b-review">No date</span>'}</span></button>`;
}
async function renderOverview() {
  if (!S) return;
  const cur = current(); const recs = cur.filter(r => r.kind === 'record'); const inv = evidenceInventory(cur); const nr = R.filter(r => r.status === 'needs-review').length;
  const dates = cur.map(r => r.eventDate).filter(Boolean).sort(); const lb = S.lastBackup;
  const stat = (n, l, c, sub = '', ic = '') => `<div class="stat" style="--c:${c}">${ic ? `<span class="ic" aria-hidden="true">${ic}</span>` : ''}<b>${n}</b><span>${l}${sub ? '<br>' + sub : ''}</span></div>`;
  $('stats').innerHTML = !R.length ? `<div class="empty" style="grid-column:1/-1">Nothing here yet. Records you save on <b>Inky</b> appear here automatically. You can also import PDFs, photos, and receipts below.</div>` :
    stat(recs.length, 'Records', '#2a2a2e', dates.length ? `${esc(fmtDate(dates[0]))} – ${esc(fmtDate(dates[dates.length - 1]))}` : '', '📚') + stat(new Set(cur.map(groupOf)).size, 'Categories', GROUPS.comms.color, '', '🗂') +
    stat(inv.length, 'Evidence items', GROUPS.evidence.color, inv.filter(x => x.missing).length ? `${inv.filter(x => x.missing).length} not yet uploaded` : '', '📎') + stat(allCases().length, 'Case numbers', GROUPS.court.color, '', '⚖️') +
    stat(nr, 'Need review', '#a8743f', nr ? 'Filter: Needs review' : 'All checked', '🔎') + stat(lb ? esc(fmtDate(lb.at.slice(0, 10))) : 'Never', 'Last backup', GROUPS.parenting.color, lb ? (lb.verified ? 'Tested ✓' : 'Not tested yet') : 'Back up soon', '🛡');
  const old = !lb || Date.now() - new Date(lb.at).getTime() > 14 * 864e5; $('backupNudge').classList.toggle('hidden', !R.length || (!old && lb.verified));
  $('storageLine').textContent = await storageText();
}
const renderHome = renderOverview;
async function storageText() { try { const e = await navigator.storage.estimate(); const p = await navigator.storage.persisted?.(); return `Using ${fmtSize(e.usage)} of about ${fmtSize(e.quota)} on this device · ${p ? 'Storage protection on' : 'Storage protection not granted — keep backups'}`; } catch { return 'Storage details unavailable in this browser.'; } }

/* ================= library ================= */
let libView = 'list', idxSort = { k: 'date', dir: 1 };
function fillFilterOptions() {
  if (!S) return; const cases = allCases();
  const catOpts = '<option value="">All categories</option>' + GROUP_ORDER.filter(g => g !== 'other' || R.some(r => groupOf(r) === 'other')).map(g => `<option value="g:${g}">${esc(GROUPS[g].label)}</option>`).join('') + Object.keys(CATS).filter(c => R.some(r => r.category === c)).map(c => `<option value="c:${c}">— ${esc(catLabel(c))}</option>`).join('');
  const caseOpts = '<option value="">All cases</option>' + cases.map(c => `<option value="${esc(c)}">Case ${esc(c)}</option>`).join('') + '<option value="__none">No case number</option>';
  const months = [...new Set(R.map(r => (r.eventDate || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  for (const [id, html] of [['fCat', catOpts], ['tCat', catOpts], ['fCase', caseOpts], ['tCase', caseOpts], ['fMonth', '<option value="">All dates</option>' + [...new Set(months.map(m => m.slice(0, 4)))].map(y => `<option value="y:${y}">${y}</option>` + months.filter(m => m.startsWith(y)).map(m => `<option value="m:${m}">— ${esc(monthName(+m.slice(0, 4), +m.slice(5) - 1))}</option>`).join('')).join('')]]) { const el = $(id); const v = el.value; el.innerHTML = html; el.value = [...el.options].some(o => o.value === v) ? v : ''; }
}
function matchCat(r, v) { if (!v) return true; return v.startsWith('g:') ? groupOf(r) === v.slice(2) : r.category === v.slice(2); }
function matchCase(r, v) { if (!v) return true; return v === '__none' ? !r.caseRefs.length : r.caseRefs.some(c => c.caseNumber === v); }
function libFiltered() {
  const q = $('fSearch').value.trim().toLowerCase(), cat = $('fCat').value, cs = $('fCase').value, mo = $('fMonth').value, st = $('fStatus').value;
  return R.filter(r => {
    if (st !== 'older' && r.isCurrent === false && !q) return false;
    if (st === 'older' && r.isCurrent !== false) return false;
    if (st === 'needs-review' && r.status !== 'needs-review') return false; if (st === 'confirmed' && r.status !== 'confirmed') return false;
    if (st === 'nodate' && r.eventDate) return false; if (st === 'file' && r.kind !== 'file') return false; if (st === 'missingref' && !(r.kind === 'record' && refInfo(r).missing)) return false;
    if (!matchCat(r, cat) || !matchCase(r, cs)) return false;
    if (mo.startsWith('y:') && !(r.eventDate || '').startsWith(mo.slice(2))) return false; if (mo.startsWith('m:') && !(r.eventDate || '').startsWith(mo.slice(2))) return false;
    if (q) { const hay = [r.docId, r.originalId, r.internalRef, r.title, r.source.name, r.location, r.preparedBy, ...r.people, ...r.children, ...r.caseRefs.map(c => c.caseNumber), ...r.relatedIds, ...r.fields.map(f => f.value), ...r.narrative.map(n => n.value), ...(r.manifestFiles || []).map(f => (f.ref || '') + ' ' + (f.name || '')), r.evidence?.description, r.evidence?.source].join(' ').toLowerCase(); if (!q.split(/\s+/).every(w => hay.includes(w))) return false; }
    return true;
  }).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}
function renderLibrary() {
  if (!S) return; fillFilterOptions();
  const list = libFiltered(); const body = $('libBody');
  document.querySelectorAll('[data-lv]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.lv === libView)));
  $('libCount').textContent = R.length ? `${list.length} shown of ${R.length} stored file(s).` : '';
  if (!R.length) { body.innerHTML = '<div class="empty">Your library is empty. Use the import box above.</div>'; return; }
  if (libView === 'list') body.innerHTML = list.length ? `<div class="rlist">${list.map(r => recCard(r)).join('')}</div>` : '<div class="empty">Nothing matches these filters.</div>';
  else if (libView === 'folders') {
    const years = {}; for (const r of list) { const y = r.eventDate ? r.eventDate.slice(0, 4) : 'No date yet'; const m = r.eventDate ? r.eventDate.slice(0, 7) : ''; ((years[y] = years[y] || {})[m] = years[y][m] || []).push(r); }
    body.innerHTML = Object.keys(years).sort().reverse().map(y => `<details class="folder" open><summary>📁 ${esc(y)}</summary>${Object.keys(years[y]).sort().reverse().map(m => { const rs = years[y][m]; const groups = GROUP_ORDER.filter(g => rs.some(r => groupOf(r) === g)); return `<details class="folder"><summary>📁 ${m ? esc(monthName(+m.slice(0, 4), +m.slice(5) - 1)) : 'Undated'} <span class="muted">(${rs.length})</span></summary>${groups.map(g => `<details class="folder"><summary style="color:${GROUPS[g].color}">📁 ${esc(GROUPS[g].label)} <span class="muted">(${rs.filter(r => groupOf(r) === g).length})</span></summary><div class="rlist">${rs.filter(r => groupOf(r) === g).map(r => recCard(r)).join('')}</div></details>`).join('')}</details>`; }).join('')}</details>`).join('');
  } else if (libView === 'index') {
    const keyf = { date: sortKey, cat: r => groupOf(r) + r.category + sortKey(r), code: r => r.docId, case: r => (r.caseRefs[0]?.caseNumber || '~') + sortKey(r), imported: r => r.source.importedAt }[idxSort.k];
    const rows = [...list].sort((a, b) => keyf(a).localeCompare(keyf(b)) * idxSort.dir);
    const th = (k, l) => `<th><button type="button" data-sort="${k}">${l}${idxSort.k === k ? (idxSort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    body.innerHTML = `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn small" type="button" id="idxCsv">Download index (CSV)</button></div><div class="tablewrap"><table class="t"><thead><tr>${th('code', 'Record ID')}${th('date', 'Date')}<th>Time</th><th>Title</th>${th('cat', 'Category')}${th('case', 'Case')}<th>Evidence</th><th>Status</th>${th('imported', 'Imported')}</tr></thead><tbody>${rows.map(r => `<tr class="click" data-open="${r.uid}" tabindex="0"><td style="color:${colorOf(r)};font-weight:800">${esc(r.docId)}</td><td>${esc(fmtDate(r.eventDate)) || '—'}</td><td>${r.eventTime ? esc(fmtTime(r.eventTime)) : 'Unknown'}</td><td>${esc(r.title)}</td><td>${esc(catLabel(r.category))}</td><td>${esc(r.caseRefs.map(c => c.caseNumber).join(', '))}</td><td>${esc((r.manifestFiles || []).map(f => f.ref).filter(Boolean).join(', '))}</td><td>${r.status === 'needs-review' ? 'Needs review' : 'Reviewed'}${r.isCurrent === false ? ' · earlier version' : ''}</td><td>${esc(fmtDate(r.source.importedAt.slice(0, 10)))}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    const inv = evidenceInventory(list.filter(r => r.isCurrent !== false));
    body.innerHTML = inv.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Description</th><th>Record</th><th>File status</th><th>SHA-256</th></tr></thead><tbody>${inv.map(x => `<tr class="click" data-open="${x.rec.uid}" tabindex="0"><td style="color:${x.color};font-weight:800">${esc(x.code)}</td><td>${esc(x.desc)}</td><td>${esc(x.parent)}</td><td>${x.missing ? `<span class="badge b-miss">${esc(x.status)}</span>` : esc(x.status)}</td><td><code style="font-size:12px">${esc(x.sha ? x.sha.slice(0, 16) + '…' : '')}</code></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No evidence items match.</div>';
  }
}
function indexCsv(recs) { return csv([['Record ID', 'Original ID', 'Internal ref', 'Event date', 'Time', 'Time accuracy', 'Title', 'Category', 'Case numbers', 'Related records', 'Evidence refs', 'Status', 'Current version', 'Revision', 'Imported', 'Original file', 'SHA-256'], ...recs.map(r => [r.docId, r.originalId, r.internalRef, r.eventDate, r.eventTime, r.timeAccuracy, r.title, catLabel(r.category), r.caseRefs.map(c => c.caseNumber).join('; '), r.relatedIds.join('; '), (r.manifestFiles || []).map(f => f.ref).filter(Boolean).join('; '), r.status, r.isCurrent === false ? 'No' : 'Yes', r.revision, r.source.importedAt, r.source.name, r.source.sha256])]); }

/* ================= record detail ================= */
let openUid = null;
function openRecord(u) {
  const r = R.find(x => x.uid === u); if (!r) return; openUid = u; const g = GROUPS[groupOf(r)]; const ri = refInfo(r); const versions = byDoc(r.docId).sort((a, b) => (b.revision || 1) - (a.revision || 1) || (b.source.importedAt || '').localeCompare(a.source.importedAt || ''));
  const backrefs = R.filter(o => o.uid !== r.uid && o.isCurrent !== false && ((o.relatedIds || []).includes(r.docId) || (o.links || []).some(l => l.to === r.docId) || (o.manifestFiles || []).some(f => f.sha256 && f.sha256 === r.source.sha256)));
  const kv = rows => `<div class="kv">${rows.filter(x => String(x[1] ?? '').trim()).map(([k, v]) => `<div class="k">${esc(k)}</div><div>${v && v.html ? v.html : esc(v)}</div>`).join('')}</div>`;
  const statusSel = (id) => `<select data-refstatus="${esc(id)}" aria-label="Status of ${esc(id)}">${[['missing', 'Referenced but missing'], ['awaiting', 'Awaiting collection'], ['unconfirmed', 'Unconfirmed reference']].map(([v, l]) => `<option value="${v}" ${(r.refStatus?.[id] || 'missing') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('recTitle').textContent = `${r.docId} — ${catLabel(r.category)}`;
  $('recBody').innerHTML = `
  <div class="rec-head" style="--c:${g.color}"><div class="id">${g.sym} ${esc(r.docId)}${r.internalRef && r.originalId ? ` · internal ${esc(r.internalRef)}` : ''}</div><h2>${esc(r.title)}</h2>
    <div>${r.status === 'needs-review' ? '<span class="badge b-review">Needs review</span>' : '<span class="badge b-ok">Reviewed</span>'}${r.isCurrent === false ? '<span class="badge b-old">Not the current version</span>' : ''}<span class="method ${METHOD[r.method][1]}">${esc(METHOD[r.method][0])}</span></div>
    ${r.flags.map(f => `<p class="banner warn">${esc(f)}</p>`).join('')}</div>
  <div class="actions"><button class="btn" type="button" id="rView">View original</button><button class="btn" type="button" id="rDl">Download original</button><button class="btn" type="button" id="rStatus">${r.status === 'needs-review' ? '✓ Mark as reviewed' : 'Mark as needs review'}</button><button class="btn danger" type="button" id="rDel">Remove from library</button></div>
  <h3 class="rec-sec">How it's organized <span class="muted" style="font-size:15px;font-weight:400">(editing this never changes the original file)</span></h3>
  <div class="edit-grid">
    <label>Title<input id="eTitle" value="${esc(r.title)}"></label>
    <label>Category<select id="eCat">${catOptions(r.category)}</select></label>
    ${!r.originalId ? `<label>Record ID<input id="eId" value="" placeholder="Optional, e.g. EVID007"><span class="hint">Now: ${esc(r.docId)}</span></label>` : ''}
    <label>${r.kind === 'file' ? 'Date (if known)' : 'Event date'}<input id="eDate" type="date" value="${esc(r.eventDate)}"></label>
    ${r.kind === 'record' ? `<label>Event time<input id="eTime" type="time" value="${esc(r.eventTime)}"></label><label>Time accuracy<select id="eAcc">${['Exact', 'Approximate', 'Unknown'].map(a => `<option ${r.timeAccuracy === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>` : ''}
    <label>Case number(s)<input id="eCases" value="${esc(r.caseRefs.map(c => c.caseNumber).join(', '))}"></label>
    ${r.kind === 'file' ? `<label>Description<input id="eDesc" value="${esc(r.evidence?.description)}"></label><label>Original source<input id="eSrc" value="${esc(r.evidence?.source)}" placeholder="Who or where it came from"></label><label>Date acquired<input id="eAcq" type="date" value="${esc(r.evidence?.acquired)}"></label><label>Preservation status<select id="ePres">${['', 'Preserved, confirmed', 'Received, awaiting verification', 'Held by another person or agency', 'Requested, not yet received'].map(v => `<option ${r.evidence?.preservation === v ? 'selected' : ''} value="${esc(v)}">${v || 'Choose…'}</option>`).join('')}</select></label><label style="grid-column:1/-1">Handling notes<textarea id="eHand">${esc(r.evidence?.handling)}</textarea></label>` : ''}
  </div>
  <div class="actions"><button class="btn primary" type="button" id="rSave">Save changes</button></div>
  ${r.kind === 'record' && (r.extracted || r.narrative.length || r.fields.length) ? `<h3 class="rec-sec">From the original record</h3>
    ${kv([['Document type', r.heading || catLabel(r.category)], [Lib.recordTerm(r)+' date', fmtDate(r.eventDate, true)], ['Time', r.eventTime ? `${fmtTime(r.eventTime)} (${r.timeAccuracy.toLowerCase()})${r.timeZone ? ' ' + r.timeZone : ''}` : 'Unknown'], ['Location', r.location], ['Children', r.children.join(', ')], ['People involved', r.people.join('\n')], ['Prepared by', r.preparedBy], ['How the preparer knows', r.basis], ['Case number(s)', r.caseRefs.map(c => c.caseNumber + (c.proceeding ? ` (${c.proceeding})` : '')).join(', ')], ['Entry started', stamp(r.entryStarted)], ['Document created', stamp(r.generatedAt)], ['Revision', r.revision], ...r.fields.map(f => [f.label, fv(f.value)])])}
    ${r.financial ? kv([['Amount', money(r.financial.amountText ?? r.financial.amount)], ['Paid by', r.financial.paidBy], ['Paid to', r.financial.paidTo], ['Category', r.financial.category], ['Status', r.financial.status], ['Method', r.financial.method], ['Receipt / transaction no. (original)', r.financial.merchantReceiptNumber], ['Raised by', r.financial.raisedBy], ['Participants', r.financial.participants]]) : ''}
    ${r.narrative.map(n => `<div class="muted" style="font-weight:700;font-size:15px">${esc(n.label)}</div><div class="narr">${esc(n.value)}</div>`).join('')}
    ${r.sequence.length ? `<h3 class="rec-sec">Event sequence</h3><div class="tablewrap"><table class="t"><thead><tr><th>Time</th><th>What happened</th><th>How known</th></tr></thead><tbody>${r.sequence.map(x => `<tr><td>${esc(x.when || 'Unknown')}</td><td>${esc(x.description)}</td><td>${esc(x.basis)}</td></tr>`).join('')}</tbody></table></div>` : ''}` : ''}
  ${ri.files.length ? `<h3 class="rec-sec">Files listed in this record</h3><div class="tablewrap"><table class="t"><thead><tr><th>Ref</th><th>File</th><th>Status</th></tr></thead><tbody>${ri.files.map(f => `<tr><td><b>${esc(f.ref || '')}</b></td><td>${esc(f.name)}<br><code style="font-size:12px">${esc(f.sha256 || 'no fingerprint recorded')}</code></td><td>${f.rec ? `<button class="btn small" type="button" data-open="${f.rec.uid}">Imported — open</button>` : '<span class="badge b-miss">Referenced evidence — not yet uploaded</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <h3 class="rec-sec">Related documentation</h3>
  ${ri.related.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Record</th><th>Status</th></tr></thead><tbody>${ri.related.map(x => `<tr><td><b>${esc(x.id)}</b>${x.rec ? ' — ' + esc(x.rec.title) : ''}</td><td>${x.rec ? `<button class="btn small" type="button" data-open="${x.rec.uid}">Referenced and imported — open</button>` : statusSel(x.id)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">The original record lists no related IDs.</p>'}
  ${(r.links || []).length ? `<div class="tablewrap" style="margin-top:8px"><table class="t"><thead><tr><th>Linked here</th><th>Relationship</th><th></th></tr></thead><tbody>${r.links.map((l, i) => { const t = findCurrent(l.to); return `<tr><td><b>${esc(l.to)}</b>${t ? ' — ' + esc(t.title) : ' <span class="badge b-miss">not in library</span>'}</td><td>${esc(l.type)}</td><td>${t ? `<button class="btn small" type="button" data-open="${t.uid}">Open</button>` : ''} <button class="btn small" type="button" data-unlink="${i}">Remove link</button></td></tr>`; }).join('')}</tbody></table></div>` : ''}
  ${backrefs.length ? `<p style="margin:10px 0 4px"><b>Referenced by:</b></p><div>${backrefs.map(o => `<button class="refchip" type="button" data-open="${o.uid}" style="color:${colorOf(o)}">${esc(o.docId)}</button>`).join('')}</div>` : ''}
  <div class="edit-grid" style="margin-top:10px"><label>Link to another record<input id="lnkTo" list="lnkList" placeholder="Type an ID or title"><datalist id="lnkList">${current().filter(o => o.uid !== r.uid).map(o => `<option value="${esc(o.docId)}">${esc(o.title)}</option>`).join('')}</datalist></label>
    <label>Relationship<select id="lnkType">${['Related to same event', 'Supporting evidence', 'Follow-up', 'Revision', 'Same proceeding', 'Related communication', 'Related payment', 'Related receipt'].map(t => `<option>${t}</option>`).join('')}</select></label></div>
  <div class="actions"><button class="btn small" type="button" id="lnkAdd">Add link</button></div>
  ${versions.length > 1 ? `<h3 class="rec-sec">Versions of ${esc(r.docId)}</h3><div class="tablewrap"><table class="t"><thead><tr><th>Revision</th><th>Imported</th><th>Fingerprint</th><th></th></tr></thead><tbody>${versions.map(v => `<tr><td>${esc(v.revision)}${v.copyOf ? ' (copy)' : ''}</td><td>${esc(stamp(v.source.importedAt))}</td><td><code style="font-size:12px">${esc(v.source.sha256.slice(0, 16))}…</code></td><td>${v.isCurrent !== false ? '<b>Current</b>' : `<button class="btn small" type="button" data-current="${v.uid}">Make current</button>`} ${v.uid !== r.uid ? `<button class="btn small" type="button" data-open="${v.uid}">Open</button>` : '(this one)'}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <h3 class="rec-sec">Original file</h3>
  ${kv([['File name', r.source.name], ['Imported from', r.source.path !== r.source.name ? r.source.path : ''], ['Type', r.source.typeLabel], ['Size', fmtSize(r.source.size)], ['SHA-256', { html: `<code style="font-size:13px;word-break:break-all">${esc(r.source.sha256)}</code>` }], ['Imported', stamp(r.source.importedAt)], ['How details were found', METHOD[r.method][2]], ['Data format', r.schema], ['Original ID', r.originalId || '(none — internal reference used)'], ['Internal reference', r.internalRef]])}
  <h3 class="rec-sec">Change history</h3>
  <div class="tablewrap"><table class="t"><thead><tr><th>When</th><th>What</th><th>From</th><th>To</th></tr></thead><tbody>${[...r.history].reverse().map(h => `<tr><td>${esc(stamp(h.at))}</td><td>${esc(h.field)}${h.note ? `<br><span class="muted" style="font-size:13px">${esc(h.note)}</span>` : ''}</td><td>${esc(h.from)}</td><td>${esc(h.to)}</td></tr>`).join('')}</tbody></table></div>`;
  const d = $('dlgRec'); if (!d.open) d.showModal(); $('recBody').scrollTop = 0;
}
async function updateRecord(r, changes, note) {
  const now = new Date().toISOString(); const next = { ...r, history: [...r.history] };
  for (const [k, label, val, show] of changes) { const before = JSON.stringify(r[k] ?? ''), after = JSON.stringify(val ?? ''); if (before === after) continue; next.history.push({ at: now, field: label, from: show ? show(r[k]) : String(r[k] ?? '') || '—', to: show ? show(val) : String(val ?? '') || '—', note }); next[k] = val; }
  if (next.history.length === r.history.length) return false;
  await putRecords([next]); const i = R.findIndex(x => x.uid === r.uid); R[i] = next; return true;
}
async function onRecClick(e) {
  const t = e.target.closest('button'); if (!t) return; const r = R.find(x => x.uid === openUid); if (!r) return;
  try {
    if (t.dataset.open) { openRecord(t.dataset.open); return; }
    if (t.id === 'rView') { let w = null; try { w = inArtifact() ? null : window.open('', '_blank'); } catch { } const u8 = await fileBytes(r); const url = URL.createObjectURL(new Blob([u8], { type: r.source.mime })); if (w) w.location.href = url; else saveBlob(new Blob([u8], { type: r.source.mime }), r.source.name); setTimeout(() => URL.revokeObjectURL(url), 120000); return; }
    if (t.id === 'rDl') { const u8 = await fileBytes(r); saveBlob(new Blob([u8], { type: r.source.mime }), r.source.name); return; }
    if (t.id === 'rStatus') { await updateRecord(r, [['status', 'Review status', r.status === 'needs-review' ? 'confirmed' : 'needs-review', v => v === 'confirmed' ? 'Reviewed' : 'Needs review']]); openRecord(r.uid); renderAll(); return; }
    if (t.id === 'rSave') {
      const ch = [['title', 'Title', $('eTitle').value.trim() || r.title], ['category', 'Category', $('eCat').value, catLabel], ['eventDate', r.kind === 'file' ? 'Date' : 'Event date', $('eDate').value], ['caseRefs', 'Case numbers', parseCases($('eCases').value, r.caseRefs), v => (v || []).map(c => c.caseNumber).join(', ') || '—']];
      if (r.kind === 'record') ch.push(['eventTime', 'Event time', $('eTime').value], ['timeAccuracy', 'Time accuracy', $('eTime').value ? $('eAcc').value : 'Unknown']);
      if ($('eId') && $('eId').value.trim()) { const nid = $('eId').value.trim().toUpperCase(); ch.push(['docId', 'Record ID', nid], ['originalId', 'Original ID', nid]); }
      if (r.kind === 'file') ch.push(['evidence', 'Evidence details', { ...r.evidence, description: $('eDesc').value.trim(), source: $('eSrc').value.trim(), acquired: $('eAcq').value, preservation: $('ePres').value, handling: $('eHand').value.trim() }, v => [v?.description, v?.source, v?.acquired, v?.preservation, v?.handling].filter(Boolean).join(' · ') || '—']);
      const ok = await updateRecord(r, ch, 'Archive classification changed — the original file is unchanged'); toast(ok ? 'Saved. The original file was not changed.' : 'No changes to save.'); openRecord(r.uid); renderAll(); return;
    }
    if (t.id === 'lnkAdd') { const to = $('lnkTo').value.trim().toUpperCase(); if (!to) { toast('Type a record ID first.'); return; } if (to === r.docId) return; await updateRecord(r, [['links', 'Link added', [...(r.links || []), { to, type: $('lnkType').value }], v => (v || []).map(l => `${l.to} (${l.type})`).join(', ') || '—']]); openRecord(r.uid); return; }
    if (t.dataset.unlink != null) { const links = r.links.filter((_, i) => i !== +t.dataset.unlink); await updateRecord(r, [['links', 'Link removed', links, v => (v || []).map(l => `${l.to} (${l.type})`).join(', ') || '—']]); openRecord(r.uid); return; }
    if (t.dataset.current) { const target = R.find(x => x.uid === t.dataset.current); const now = new Date().toISOString(); const ups = byDoc(target.docId).map(v => ({ ...v, isCurrent: v.uid === target.uid, history: v.isCurrent !== false === (v.uid === target.uid) ? v.history : [...v.history, { at: now, field: 'Current version', from: v.isCurrent !== false ? 'Yes' : 'No', to: v.uid === target.uid ? 'Yes' : 'No' }] })); await putRecords(ups); ups.forEach(u => { R[R.findIndex(x => x.uid === u.uid)] = u; }); openRecord(r.uid); renderAll(); toast('Current version updated.'); return; }
    if (t.id === 'rDel') {
      const v = await msg('Remove from library?', `<p>This deletes <b>${esc(r.docId)}</b> and its stored original file from this library. It can't be undone unless you have a backup.</p>`, [{ label: 'Cancel', value: 'no' }, { label: 'Remove', value: 'yes', danger: true }]);
      if (v !== 'yes') { $('dlgRec').showModal(); return; }
      const others = R.filter(x => x.uid !== r.uid && x.source.fileId === r.source.fileId);
      await tx(['records', 'files'], 'readwrite', t2 => { t2.objectStore('records').delete(r.uid); if (!others.length) t2.objectStore('files').delete(r.source.fileId); });
      R = R.filter(x => x.uid !== r.uid);
      if (r.isCurrent !== false) { const alt = byDoc(r.docId).sort((a, b) => (b.revision || 1) - (a.revision || 1))[0]; if (alt) { alt.isCurrent = true; await putRecords([alt]); } }
      $('dlgRec').close(); renderAll(); toast(`${r.docId} removed.`); return;
    }
  } catch (err) { msg('Something went wrong', `<p>${esc(err.message)}</p>`); }
}
async function onRecChange(e) { const s = e.target.dataset.refstatus; if (!s) return; const r = R.find(x => x.uid === openUid); await updateRecord(r, [['refStatus', `Reference status (${s})`, { ...(r.refStatus || {}), [s]: e.target.value }, v => (v || {})[s] || 'missing']]); toast('Reference status saved.'); }

/* ================= timeline & calendar ================= */
let calStart = null, dayFilter = '';
function tlFiltered() { const cs = $('tCase').value, cat = $('tCat').value, from = $('tFrom').value, to = $('tTo').value; return current().filter(r => !isAttachment(r) && matchCase(r, cs) && matchCat(r, cat) && (!from || !r.eventDate || r.eventDate >= from) && (!to || !r.eventDate || r.eventDate <= to)); }
function renderTimeline() {
  if (!S) return; fillFilterOptions(); const recs = tlFiltered(); const dated = recs.filter(r => r.eventDate).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (!calStart) { const last = dated[dated.length - 1]; const d = last ? parseD(last.eventDate) : new Date(); calStart = new Date(d.getFullYear(), d.getMonth() - 1, 1); }
  const m2 = new Date(calStart.getFullYear(), calStart.getMonth() + 1, 1);
  $('calTitle').textContent = `${monthName(calStart.getFullYear(), calStart.getMonth())} – ${monthName(m2.getFullYear(), m2.getMonth())}`;
  const byDate = {}; for (const r of dated) (byDate[r.eventDate] = byDate[r.eventDate] || []).push(r);
  $('cal').innerHTML = [calStart, m2].map(m => monthHtml(m.getFullYear(), m.getMonth(), byDate)).join('');
  const present = GROUP_ORDER.filter(g => recs.some(r => groupOf(r) === g));
  $('legend').innerHTML = present.map(g => `<span style="--c:${GROUPS[g].color}"><i></i>${GROUPS[g].sym} ${esc(GROUPS[g].label)}</span>`).join('') || '<span class="muted">No records in this view.</span>';
  const list = dayFilter ? dated.filter(r => r.eventDate === dayFilter) : dated; $('clearDay').classList.toggle('hidden', !dayFilter);
  let html = ''; let lastD = '';
  for (const r of list) {
    if (r.eventDate !== lastD) { html += `<div class="tl-day">${esc(fmtDate(r.eventDate, true))}</div>`; lastD = r.eventDate; }
    const ri = refInfo(r);
    html += `<div class="tl-item"><div class="tl-time">${r.eventTime ? esc(fmtTime(r.eventTime)) + (r.timeAccuracy === 'Approximate' ? ' (approx.)' : '') : 'Time unknown'}</div><div><span class="refchip" style="color:${colorOf(r)}">${GROUPS[groupOf(r)].sym} ${esc(r.docId)}</span><span class="muted" style="font-size:15px">${esc(catLabel(r.category))}</span> ${r.status === 'needs-review' ? '<span class="badge b-review">Needs review</span>' : ''}<br><button class="open" type="button" data-open="${r.uid}">${esc(r.title)}</button>
      <div>${r.caseRefs.map(c => `<span class="refchip">Case ${esc(c.caseNumber)}</span>`).join('')}${ri.files.map(f => `<span class="refchip" title="${esc(f.name)}" style="${f.rec ? '' : 'color:#8a2c22'}">${esc(f.ref || 'file')}${f.rec ? '' : ' (not uploaded)'}</span>`).join('')}${ri.related.map(x => x.rec ? `<button class="refchip" type="button" data-open="${x.rec.uid}" style="color:${colorOf(x.rec)}">↔ ${esc(x.id)}</button>` : `<span class="refchip" style="color:#8a2c22">↔ ${esc(x.id)} (missing)</span>`).join('')}</div></div></div>`;
  }
  const undated = recs.filter(r => !r.eventDate && r.kind === 'record');
  if (!dayFilter && undated.length) html += `<div class="tl-day" style="color:#6a4b00">Needs a date (${undated.length})</div><p class="muted">These records have no event date yet, so they can't be placed in order. Open one to add its date.</p><div class="rlist">${undated.map(r => recCard(r)).join('')}</div>`;
  $('tlList').innerHTML = html || '<div class="empty">No dated records in this view.</div>';
}
function monthHtml(y, m, byDate) {
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(); let cells = '';
  for (let i = 0; i < first; i++) cells += '<div class="day out" aria-hidden="true"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${pad(m + 1)}-${pad(d)}`; const ev = byDate[iso] || [];
    cells += `<div class="day${ev.length ? ' has' : ''}${dayFilter === iso ? ' sel' : ''}"><button class="n" type="button" data-day="${iso}" ${ev.length ? '' : 'disabled'} aria-label="${esc(fmtDate(iso, true))}${ev.length ? `, ${ev.length} record${ev.length > 1 ? 's' : ''}` : ''}">${d}</button>${ev.slice(0, 3).map(r => `<button class="chip" type="button" data-open="${r.uid}" style="--c:${colorOf(r)}" title="${esc(r.title)}">${esc(r.docId)}</button>`).join('')}${ev.length > 3 ? `<button class="more-n" type="button" data-day="${iso}">+${ev.length - 3} more</button>` : ''}</div>`;
  }
  return `<div class="month"><h3>${esc(monthName(y, m))}</h3><div class="mgrid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="dow">${w}</div>`).join('')}${cells}</div></div>`;
}

/* ================= packet builder ================= */
const SECTIONS = [['cover', 'Cover page', 'Cover page'], ['index', 'Master document index', 'Index of every record'], ['calendar', 'Two-month calendars', 'Color-coded calendars'], ['timeline', 'Chronological timeline', 'Timeline of events'], ['sequence', 'Expanded event sequences', 'Step-by-step event details'], ['records', 'Category documentation (full records)', 'Full records, grouped by type'], ['financial', 'Financial ledger', 'Money ledger and receipts'], ['evidence', 'Evidence inventory', 'Evidence list'], ['manifest', 'Verification manifest', 'File fingerprints for verification']];
let secOrder = SECTIONS.map(s => s[0]), secOn = new Set(secOrder); const pkExcluded = new Set(); let pkCaseSel = null, pkCatSel = null;
function pkRange() { const v = $('pkRange').value; const t = new Date(); if (v === 'm1') return [`${t.getFullYear()}-${pad(t.getMonth() + 1)}-01`, todayISO()]; if (v === 'm2') { const s = new Date(t.getFullYear(), t.getMonth() - 1, 1); return [`${s.getFullYear()}-${pad(s.getMonth() + 1)}-01`, todayISO()]; } if (v === 'custom') return [$('pkFrom').value, $('pkTo').value]; return ['', '']; }
function pkCandidates() {
  const [from, to] = pkRange(); const inclReview = $('pkReview').checked;
  return current().filter(r => (inclReview || r.status !== 'needs-review') && (!from || !r.eventDate || r.eventDate >= from) && (!to || !r.eventDate || r.eventDate <= to) && (from || to ? (r.eventDate || r.kind === 'file') : true)
    && (r.caseRefs.length ? r.caseRefs.some(c => pkCaseSel.has(c.caseNumber)) : pkCaseSel.has('__none')) && pkCatSel.has(groupOf(r))).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}
const pkSelected = () => pkCandidates().filter(r => !pkExcluded.has(r.uid));
function renderPacket() {
  if (!S) return; const cases = allCases(); const groups = GROUP_ORDER.filter(g => current().some(r => groupOf(r) === g));
  if (!pkCaseSel) pkCaseSel = new Set([...cases, '__none', ...cases.map(c => '__seen:' + c)]); else cases.forEach(c => { if (!pkCaseSel.has('__seen:' + c)) { pkCaseSel.add(c); pkCaseSel.add('__seen:' + c); } });
  if (!pkCatSel) pkCatSel = new Set(GROUP_ORDER);
  $('pkCases').innerHTML = [...cases.map(c => [c, 'Case ' + c]), ['__none', 'Records with no case number']].map(([v, l]) => `<label><input type="checkbox" data-case="${esc(v)}" ${pkCaseSel.has(v) ? 'checked' : ''}> ${esc(l)}</label>`).join('');
  $('pkCats').innerHTML = groups.length ? groups.map(g => `<label style="border-color:${GROUPS[g].color}"><input type="checkbox" data-cat="${g}" ${pkCatSel.has(g) ? 'checked' : ''}> ${GROUPS[g].sym} ${esc(GROUPS[g].label)}</label>`).join('') : '<span class="muted">Import records first.</span>';
  const cand = pkCandidates();
  $('pkRecords').innerHTML = cand.length ? cand.map(r => `<label><input type="checkbox" data-pick="${r.uid}" ${pkExcluded.has(r.uid) ? '' : 'checked'}><span><b style="color:${colorOf(r)}">${esc(r.docId)}</b> ${esc(r.title)} <span class="muted">· ${esc(fmtDate(r.eventDate) || 'no date')}${r.status === 'needs-review' ? ' · needs review' : ''}</span></span></label>`).join('') : '<p class="muted">No records match.</p>';
  $('pkSections').innerHTML = secOrder.map((k, i) => `<li><label><input type="checkbox" data-sec="${k}" ${secOn.has(k) ? 'checked' : ''}> ${esc(SECTIONS.find(s => s[0] === k)[2])}</label><button type="button" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button type="button" data-down="${i}" aria-label="Move down" ${i < secOrder.length - 1 ? '' : 'disabled'}>▼</button></li>`).join('');
  updatePkSummary();
}
function updatePkSummary() {
  const sel = pkSelected(); const cand = pkCandidates(); const nr = current().filter(r => r.status === 'needs-review').length;
  $('pkPickCount').textContent = `(${sel.length} of ${cand.length} included)`;
  const ds = sel.map(r => r.eventDate).filter(Boolean).sort();
  $('pkSummary').innerHTML = sel.length ? `<b>${sel.length} record${sel.length === 1 ? '' : 's'}</b>${ds.length ? ` · ${esc(fmtDate(ds[0]))} – ${esc(fmtDate(ds[ds.length - 1]))}` : ''} · report number <b>${peekPkt()}</b>${!$('pkReview').checked && nr ? `<br>${nr} record(s) still needing review are left out until you check them.` : ''}` : (R.length?'No records match these dates and filters.':'Capture or import a record to start your packet.');
  $('pkIncludes').innerHTML = secOrder.filter(k => secOn.has(k)).map(k => `<li>${esc(SECTIONS.find(x => x[0] === k)[2])}</li>`).join('');
  const custom = $('pkRange').value !== 'all' || pkExcluded.size || $('pkKids').checked || !$('pkNarr').checked || [...pkCatSel].length < GROUP_ORDER.length || secOn.size < SECTIONS.length;
  $('pkCustomHint').textContent = custom ? '· customized' : '· everything included';
  ['pkRun', 'pkPdf', 'pkZip', 'pkPrint'].forEach(id => { $(id).disabled = !sel.length; });
  const w = $('pkOriginals').checked && ($('pkKids').checked || !$('pkNarr').checked); $('pkOrigWarn').classList.toggle('hidden', !w);
  $('pkOrigWarn').textContent = w ? 'Heads up: the original files in the ZIP are untouched, so they still contain everything you left out of the report text (like children\'s names or full accounts).' : '';
  $('pkOpW').classList.toggle('hidden', document.querySelector('[name=pkProfile]:checked').value !== 'mark');
}
function peekPkt() { const y = new Date().getFullYear(); const n = S.pkt.year === y ? S.pkt.next : 1; return `PKT-${y}-${pad(n, 4)}`; }
async function takePkt() { const y = new Date().getFullYear(); if (S.pkt.year !== y) S.pkt = { year: y, next: 1 }; const id = `PKT-${y}-${pad(S.pkt.next, 4)}`; S.pkt.next++; await saveSettings(); return id; }
async function sourceDigest(recs) { return L.sha256(JSON.stringify(recs.map(r => [r.docId, r.revision, r.source.sha256]).sort())); }
function redactor(rec, on) { if (!on) return s => s; const names = [...new Set([...(rec.children || []), ...String(rec.childrenText || '').split(/,|&|\band\b/)].map(s => s.trim()).filter(s => s.length > 1))]; if (!names.length) return s => s; const re = new RegExp('\\b(' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi'); return s => String(s ?? '').replace(re, '[child]'); }
function buildBlocks(recs, o) {
  const B = []; const brk = () => B.push({ t: 'break' }); let first = true; const startSec = () => { if (!first) brk(); first = false; };
  const dated = recs.filter(r => r.eventDate && !isAttachment(r)); const range = dated.length ? [dated[0].eventDate, dated[dated.length - 1].eventDate] : ['', ''];
  const inv = evidenceInventory(recs);
  const evRefs = r => (r.manifestFiles || []).map(f => f.ref).filter(Boolean).join(', ');
  for (const k of secOrder.filter(s => secOn.has(s))) {
    if (k === 'cover') { startSec(); const cs = [...new Set(recs.flatMap(r => r.caseRefs.map(c => c.caseNumber)))];
      B.push({ t: 'cover', title: o.title, rows: [['Report ID', o.pkt], ['Date range', o.from || o.to ? `${fmtDate(o.from) || 'start'} – ${fmtDate(o.to) || 'present'}` : range[0] ? `${fmtDate(range[0])} – ${fmtDate(range[1])} (all dates)` : 'All dates'], ['Case number(s)', cs.length ? cs.join(', ') : 'None listed'], ['Records included', String(recs.length)], ['Generated', stamp(o.generated)], ['Copy type', o.watermark ? 'Presentation copy (watermarked)' : 'Clean court-review copy'], ['Source digest (SHA-256)', o.digest]],
        contents: secOrder.filter(s => secOn.has(s) && s !== 'cover').map(s => SECTIONS.find(x => x[0] === s)[1]),
        note: 'This report is an organizational summary prepared by the person who kept these records, for attorney or court review. It is not a court-issued, certified, or authenticated document, and it does not establish that any statement in it is true. Original files are preserved separately and unchanged.' }); continue; }
    if (k === 'index' && recs.length) { startSec(); B.push({ t: 'sec', title: 'Master document index' }); B.push({ t: 'table', cols: [{ h: 'Record ID', w: .115, bold: 1 }, { h: 'Date', w: .115 }, { h: 'Time', w: .1 }, { h: 'Title', w: .25 }, { h: 'Category', w: .13 }, { h: 'Case', w: .11 }, { h: 'Evidence', w: .1 }, { h: 'Status', w: .08 }], rows: recs.map(r => { const red = redactor(r, o.kids); return { cells: [r.docId, fmtDate(r.eventDate) || '—', r.eventTime ? fmtTime(r.eventTime) + (r.timeAccuracy === 'Approximate' ? ' ~' : '') : 'Unknown', red(r.title), catLabel(r.category), r.caseRefs.map(c => c.caseNumber).join(', '), evRefs(r), r.status === 'needs-review' ? 'Check' : 'OK'], bar: colorOf(r), color: colorOf(r) }; }) }); B.push({ t: 'note', text: '"~" means the time is approximate. "Check" means the record\'s details have not yet been confirmed.' }); continue; }
    if (k === 'calendar' && dated.length) {
      const s = parseD(o.from || dated[0].eventDate), e = parseD(o.to || dated[dated.length - 1].eventDate); let months = []; for (let d = new Date(s.getFullYear(), s.getMonth(), 1); d <= e; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push([d.getFullYear(), d.getMonth()]);
      let trimmed = false; if (months.length > 24) { months = months.slice(-24); trimmed = true; }
      const byDate = {}; for (const r of dated) (byDate[r.eventDate] = byDate[r.eventDate] || []).push(r);
      for (let i = 0; i < months.length; i += 2) {
        startSec(); const pair = months.slice(i, i + 2); B.push({ t: 'sec', title: 'Calendar — ' + pair.map(([y, m]) => monthName(y, m)).join(' & ') });
        const busyDays = [];
        for (const [y, m] of pair) { const ev = {}; for (const [d, rs] of Object.entries(byDate)) if (d.startsWith(`${y}-${pad(m + 1)}`)) { ev[+d.slice(8)] = rs.map(r => ({ id: r.docId, color: colorOf(r) })); if (rs.length > 3) busyDays.push(`${fmtDate(d)}: ${rs.map(r => r.docId).join(', ')}`); } B.push({ t: 'cal', y, m, ev }); }
        const present = GROUP_ORDER.filter(g => dated.some(r => groupOf(r) === g)); B.push({ t: 'note', text: 'Key: ' + present.map(g => GROUPS[g].label).join(' · ') + '. Each date lists record IDs; the category is also shown by the ID prefix (for example POLI = police interaction), so the calendar reads correctly in black and white.' });
        if (busyDays.length) B.push({ t: 'note', text: 'Dates with more than three records: ' + busyDays.join('; ') });
      }
      if (trimmed) B.push({ t: 'note', text: 'The calendar shows the most recent 24 months. The master index lists every record.' });
      continue;
    }
    if (k === 'timeline' && dated.length) { startSec(); B.push({ t: 'sec', title: 'Chronological timeline' });
      B.push({ t: 'table', cols: [{ h: 'Date', w: .13 }, { h: 'Time', w: .1 }, { h: 'Record', w: .11, bold: 1 }, { h: 'What the record covers', w: .46 }, { h: 'References', w: .2 }], rows: dated.map(r => { const red = redactor(r, o.kids); const main = (r.narrative || []).find(n => !['outcome', 'followup'].includes(n.key)); const sum = main && o.narr ? ' — ' + red(main.value).replace(/\s+/g, ' ').slice(0, 220) + (main.value.length > 220 ? '…' : '') : ''; return { cells: [fmtDate(r.eventDate), r.eventTime ? fmtTime(r.eventTime) + (r.timeAccuracy === 'Approximate' ? ' (approx.)' : '') : 'Unknown', r.docId, red(r.title) + sum, [r.caseRefs.map(c => 'Case ' + c.caseNumber).join(', '), evRefs(r), (r.relatedIds || []).length ? 'Related: ' + r.relatedIds.join(', ') : ''].filter(Boolean).join('\n')], bar: colorOf(r), color: colorOf(r) }; }) }); continue; }
    if (k === 'sequence') { const seqR = recs.filter(r => (r.sequence || []).length); if (!seqR.length) continue; startSec(); B.push({ t: 'sec', title: 'Detailed chronology' }); for (const r of seqR) { const red = redactor(r, o.kids); B.push({ t: 'sub', title: `${r.docId} — ${red(r.title)}`, right: fmtDate(r.eventDate), color: colorOf(r) }); B.push({ t: 'table', cols: [{ h: 'Time', w: .16 }, { h: 'What happened', w: .58 }, { h: 'How known', w: .26 }], rows: r.sequence.map(x => [x.when || 'Unknown', red(x.description), x.basis || '']) }); } B.push({ t: 'note', text: 'Each sequence is shown exactly as written in its own record. Sequences from different records are not merged.' }); continue; }
    if (k === 'records' && recs.length) {
      for (const g of GROUP_ORDER) { const rs = recs.filter(r => groupOf(r) === g); if (!rs.length) continue; startSec(); B.push({ t: 'sec', title: GROUPS[g].label, color: GROUPS[g].color });
        for (const r of rs) { const red = redactor(r, o.kids); const F = r.financial;
          B.push({ t: 'sub', title: `${r.docId} — ${red(r.title)}`, right: fmtDate(r.eventDate) || 'No date', color: colorOf(r) });
          const rows = [['Document type', r.heading || catLabel(r.category)], [Lib.recordTerm(r)+' date', fmtDate(r.eventDate, true)], ['Time', r.kind === 'record' ? (r.eventTime ? `${fmtTime(r.eventTime)} (${r.timeAccuracy.toLowerCase()})` : 'Unknown') : ''], ['Location', red(r.location)], ['Children', o.kids ? (r.children.length ? '[child]' : '') : r.children.join(', ')], ['People involved', red(r.people.join('\n'))], ['Prepared by', r.preparedBy], ['Case number(s)', r.caseRefs.map(c => c.caseNumber + (c.proceeding ? ` (${c.proceeding})` : '')).join(', ')], ['Related records', (r.relatedIds || []).concat((r.links || []).map(l => `${l.to} (${l.type.toLowerCase()})`)).join(', ')], ['Evidence / receipts', (r.manifestFiles || []).map(f => `${f.ref || ''} ${f.name || ''}`.trim()).join('\n')], ['Entry started', r.entryStarted ? stamp(r.entryStarted) : ''], ['Revision', r.kind === 'record' ? String(r.revision) : ''], ['Status', r.status === 'needs-review' ? 'Details not yet confirmed' : ''], ...r.fields.filter(f => !(F && ['amount', 'paidBy', 'paidTo', 'payCat', 'payStatus', 'payMethod', 'txn', 'matStatus', 'raisedBy', 'participants'].includes(f.key))).map(f => [f.label, red(fv(f.value))])];
          if (F) rows.push(['Amount', money(F.amountText ?? F.amount)], ['Paid by', F.paidBy], ['Paid to', F.paidTo], ['Payment category', F.category], ['Payment status', F.status], ['Payment method', F.method], ['Receipt / transaction no. (original)', F.merchantReceiptNumber], ['Raised by', F.raisedBy], ['Other participants', F.participants]);
          if (r.kind === 'file') rows.push(['Description', red(r.evidence?.description)], ['Original source', r.evidence?.source], ['Date acquired', fmtDate(r.evidence?.acquired)], ['Preservation status', r.evidence?.preservation], ['Handling notes', red(r.evidence?.handling)]);
          rows.push(['Original file', `${r.source.name} (${fmtSize(r.source.size)})`], ['SHA-256', r.source.sha256]);
          B.push({ t: 'kv', rows: rows.filter(x => String(x[1] ?? '').trim()) });
          if (o.narr) for (const n of r.narrative || []) { if (n.key === 'followup' && !o.follow) continue; B.push({ t: 'para', label: n.key==='narrative'?'Account of the '+Lib.recordTerm(r).toLowerCase():n.label, text: red(n.value) }); }
        } }
      continue;
    }
    if (k === 'financial') { const fin = recs.filter(r => r.category === 'FIN' || r.category === 'RCP'); if (!fin.length) continue; startSec(); B.push({ t: 'sec', title: 'Financial ledger', color: GROUPS.finance.color });
      const pays = fin.filter(r => r.financial);
      if (pays.length) B.push({ t: 'table', cols: [{ h: 'Date', w: .11 }, { h: 'Record', w: .09, bold: 1 }, { h: 'Purpose', w: .2 }, { h: 'Amount', w: .1 }, { h: 'Paid by', w: .11 }, { h: 'Paid to', w: .11 }, { h: 'Status', w: .16 }, { h: 'Receipts', w: .12 }], rows: pays.map(r => ({ cells: [fmtDate(r.eventDate), r.docId, r.title, money(r.financial.amountText ?? r.financial.amount) || '—', r.financial.paidBy, r.financial.paidTo, r.financial.status || r.financial.kind, (r.manifestFiles || []).map(f => f.ref).filter(Boolean).join(', ') || 'None'], bar: GROUPS.finance.color })) });
      const totals = {}; for (const r of pays) { const n = Number(String(r.financial.amountText ?? r.financial.amount ?? '').replace(/[$,]/g, '')); if (isFinite(n) && n) { const c = r.financial.category || 'Uncategorized'; totals[c] = (totals[c] || 0) + n; } }
      if (Object.keys(totals).length) { B.push({ t: 'sub', title: 'Recorded amounts by category', color: GROUPS.finance.color }); B.push({ t: 'table', cols: [{ h: 'Category', w: .6 }, { h: 'Total of recorded amounts', w: .4 }], rows: Object.entries(totals).map(([c, n]) => [c, money(n)]) }); B.push({ t: 'note', text: 'Totals add up the amounts as recorded, across all statuses. They are not a calculation of support owed or credited.' }); }
      const rcpt = pays.flatMap(r => refInfo(r).files.map(f => [f.ref || '—', r.docId, f.name || '', f.status === 'imported' ? 'Imported — fingerprint matches' : 'Referenced — file not uploaded']));
      if (rcpt.length) { B.push({ t: 'sub', title: 'Receipt inventory', color: GROUPS.finance.color }); B.push({ t: 'table', cols: [{ h: 'Receipt ID', w: .14, bold: 1 }, { h: 'Payment record', w: .14 }, { h: 'Original file', w: .4 }, { h: 'File status', w: .32 }], rows: rcpt }); B.push({ t: 'note', text: 'RCP numbers are internal receipt IDs. They are separate from any number printed on the merchant\'s receipt.' }); }
      const missing = pays.filter(r => /^paid/i.test(r.financial.status || '') && (!(r.manifestFiles || []).length || refInfo(r).files.some(f => f.status !== 'imported')));
      if (missing.length) { B.push({ t: 'sub', title: 'Missing receipts', color: GROUPS.finance.color }); B.push({ t: 'table', cols: [{ h: 'Record', w: .14, bold: 1 }, { h: 'Date', w: .14 }, { h: 'Purpose', w: .42 }, { h: 'What is missing', w: .3 }], rows: missing.map(r => [r.docId, fmtDate(r.eventDate), r.title, (r.manifestFiles || []).length ? 'Receipt listed but not uploaded here' : 'No receipt attached to the record']) }); }
      continue; }
    if (k === 'evidence' && inv.length) { startSec(); B.push({ t: 'sec', title: 'Evidence inventory', color: GROUPS.evidence.color }); B.push({ t: 'table', cols: [{ h: 'Code', w: .13, bold: 1 }, { h: 'Description', w: .3 }, { h: 'Record', w: .11 }, { h: 'Related', w: .12 }, { h: 'File status', w: .18 }, { h: 'SHA-256 (start)', w: .16 }], rows: inv.map(x => ({ cells: [x.code, redactor(x.rec, o.kids)(x.desc), x.parent, x.related, x.status, x.sha ? x.sha.slice(0, 16) + '…' : '—'], bar: x.color })) }); B.push({ t: 'note', text: '"Not yet uploaded" means a record refers to this file but the file itself is not in this library. Nothing is assumed about files that are not present.' }); continue; }
    if (k === 'manifest' && recs.length) { startSec(); B.push({ t: 'sec', title: 'Verification manifest' }); B.push({ t: 'kv', rows: [['Report ID', o.pkt], ['Generated', stamp(o.generated)], ['Records', String(recs.length)], ['Source digest (SHA-256)', o.digest]] });
      B.push({ t: 'table', size: 7.6, cols: [{ h: 'Record', w: .12, bold: 1 }, { h: 'Original file', w: .3 }, { h: 'Size', w: .1 }, { h: 'SHA-256 fingerprint', w: .48 }], rows: recs.map(r => [r.docId, r.source.name, fmtSize(r.source.size), r.source.sha256]) });
      B.push({ t: 'note', text: 'A SHA-256 fingerprint changes if even one byte of a file changes. A matching fingerprint shows a file is identical to the one listed here; it does not show who made the file or that its contents are true. This report\'s own fingerprint is recorded in manifest.json inside the ZIP export, because a document can\'t contain its own fingerprint.' }); continue; }
  }
  return B;
}
function blocksHtml(B, o) {
  const pages = [[]]; for (const b of B) { if (b.t === 'break') pages.push([]); else pages[pages.length - 1].push(b); }
  const head = `<div class="pg-head"><span>DOCUMENTATION REPORT</span><span>${esc(o.pkt)}</span></div>`; const foot = `<div class="pg-foot">${esc(o.pkt)} · Generated ${esc(stamp(o.generated))} · Source digest ${esc(o.digest.slice(0, 12))}</div>`;
  const cell = c => esc(c);
  return pages.filter(p => p.length).map(p => `<div class="paper${o.watermark ? ' wm' : ''}" style="--pa:#1f2d4d;--wm:${(o.watermark || 0) * 0.07}">${head}${p.map(b => {
    if (b.t === 'cover') return `<h1>${esc(b.title)}</h1><div class="pkv cover-meta">${b.rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div><p class="pl" style="margin-top:20px">Contents</p><ol>${b.contents.map(c => `<li>${esc(c)}</li>`).join('')}</ol><p class="cover-note">${esc(b.note)}</p>`;
    if (b.t === 'sec') return `<div class="sec" style="--sc:${b.color || '#1f2d4d'}">${esc(b.title)}</div>`;
    if (b.t === 'sub') return `<div class="subh" style="--sc:${b.color}"><span>${esc(b.title)}</span><span>${esc(b.right || '')}</span></div>`;
    if (b.t === 'kv') return `<div class="pkv">${b.rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>`;
    if (b.t === 'para') return `<div class="pl">${esc(b.label)}</div><div class="pt">${esc(b.text)}</div>`;
    if (b.t === 'note') return `<p class="note">${esc(b.text)}</p>`;
    if (b.t === 'table') return `<table><thead><tr>${b.cols.map(c => `<th style="width:${c.w * 100}%">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => { const cells = r.cells || r; return `<tr>${cells.map((c, i) => `<td${i === 0 && r.bar ? ` class="bar" style="--c:${r.bar};color:${r.color || 'inherit'};font-weight:700"` : ''}>${cell(c)}</td>`).join('')}</tr>`; }).join('')}</tbody></table>`;
    if (b.t === 'cal') { const first = new Date(b.y, b.m, 1).getDay(), days = new Date(b.y, b.m + 1, 0).getDate(); const cells = []; for (let i = 0; i < first; i++) cells.push(''); for (let d = 1; d <= days; d++) { const ev = b.ev[d] || []; cells.push(`<b>${d}</b>${ev.slice(0, 3).map(e => `<i style="--c:${e.color}">${esc(e.id)}</i>`).join('')}${ev.length > 3 ? `<span>+${ev.length - 3} more</span>` : ''}`); } while (cells.length % 7) cells.push(''); let rows = ''; for (let i = 0; i < cells.length; i += 7) rows += `<tr>${cells.slice(i, i + 7).map(c => `<td>${c}</td>`).join('')}</tr>`; return `<div class="pcal"><h3>${esc(monthName(b.y, b.m))}</h3><table><thead><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<th>${w}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`; }
    return '';
  }).join('')}${foot}</div>`).join('');
}
function blocksPdf(B, o) {
  const P = L.pdf({ accent: '#2a2a2e', headerLeft: 'DOCUMENTATION REPORT', headerRight: o.pkt, watermark: o.watermark || 0, footer: () => `${o.pkt}  ·  Generated ${stamp(o.generated)}  ·  Source digest ${o.digest.slice(0, 12)}` });
  P.newPage(); let fresh = true;
  for (const b of B) {
    if (b.t === 'break') { if (!fresh) P.newPage(); fresh = true; continue; } fresh = false;
    if (b.t === 'cover') { P.y += 60; for (const s of P.wrap(b.title, P.CW, 24, true)) { P.text(s, P.ML, P.y + 22, 24, true, P.NAVY); P.y += 30; } P.y += 16; b.rows.forEach(([k, v]) => P.kv(k, v, 160)); P.y += 18; P.text('CONTENTS', P.ML, P.y + 10, 9.5, true, P.SLATE); P.y += 18; b.contents.forEach((c, i) => { P.text(`${i + 1}.  ${c}`, P.ML + 6, P.y + 10, 10.5, false, P.INK); P.y += 16; }); P.y += 20; P.line(P.ML, P.y, P.MR, P.y); P.y += 8; P.note(b.note, 9); }
    else if (b.t === 'sec') P.section(b.title, b.color || '#2a2a2e');
    else if (b.t === 'sub') P.sub(b.title, b.color, b.right);
    else if (b.t === 'kv') b.rows.forEach(([k, v]) => P.kv(k, v));
    else if (b.t === 'para') P.para(b.label, b.text);
    else if (b.t === 'note') P.note(b.text);
    else if (b.t === 'table') P.table(b.cols, b.rows, { size: b.size });
    else if (b.t === 'cal') {
      const ch = 44, cw = P.CW / 7; const first = new Date(b.y, b.m, 1).getDay(), days = new Date(b.y, b.m + 1, 0).getDate(); const rowsN = Math.ceil((first + days) / 7);
      P.ensure(34 + rowsN * ch + 10); P.text(monthName(b.y, b.m), P.ML, P.y + 13, 12.5, true, P.NAVY); P.y += 20;
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((w, i) => { P.rect(P.ML + i * cw, P.y, cw, 14, P.NAVY); P.text(w, P.ML + i * cw + 4, P.y + 10, 8, true, '#ffffff'); }); P.y += 14;
      for (let c = 0; c < rowsN * 7; c++) { const d = c - first + 1; const x = P.ML + (c % 7) * cw, top = P.y + Math.floor(c / 7) * ch; P.box(x, top, cw, ch, '#c9d0db', .6); if (d < 1 || d > days) continue; P.text(String(d), x + 3, top + 9, 7.5, true, P.SLATE); const ev = b.ev[d] || []; ev.slice(0, 3).forEach((e, j) => P.text(e.id, x + 3, top + 19 + j * 8.4, 7, true, e.color)); if (ev.length > 3) P.text(`+${ev.length - 3} more`, x + 3, top + 19 + 3 * 8.4, 6.6, false, P.SLATE); }
      P.y += rowsN * ch + 12;
    }
  }
  return P.finish({ title: `${o.pkt} — ${o.title}`, subject: 'Documentation report', keywords: `packet=${o.pkt}; digest=${o.digest}` });
}
async function packetOptions(assign) {
  const recs = pkSelected(); if (!recs.length) throw new Error('No records are selected. Check the case, category, and date choices.');
  const [from, to] = pkRange(); const mark = document.querySelector('[name=pkProfile]:checked').value === 'mark';
  return { recs, o: { title: $('pkTitle').value.trim() || 'Documentation Report', from, to, narr: $('pkNarr').checked, follow: $('pkFollow').checked, kids: $('pkKids').checked, watermark: mark ? Number($('pkOpacity').value) / 100 : 0, generated: new Date().toISOString(), digest: await sourceDigest(recs), pkt: assign ? await takePkt() : peekPkt() + ' (preview)' } };
}
async function runReport() {
  if (!R.length) { msg('Nothing to report yet', '<p>Save a record on <b>Inky</b> (or import documents in the Library) first.</p>'); return; }
  busy('Gathering every record and building your report…');
  try {
    const { recs, o } = await packetOptions(false); const B = buildBlocks(recs, o); let pages = null, bad = null;
    try { pages = blocksPdf(B, o).pages; } catch (e) { if (e.unsupported) bad = e.unsupported; else throw e; }
    const ds = recs.map(r => r.eventDate).filter(Boolean).sort();
    $('pkOut').innerHTML = blocksHtml(B, o); $('pkResult').classList.remove('hidden');
    $('pkResultSum').innerHTML = `${recs.length} record${recs.length === 1 ? '' : 's'}${ds.length ? ` · ${esc(fmtDate(ds[0]))} – ${esc(fmtDate(ds[ds.length - 1]))}` : ''}${pages ? ` · ${pages} pages` : ''}. Scroll down to read it, then download or print.${bad ? `<br><b>Note:</b> some characters (${esc(bad.join(' '))}) can't go in the downloaded PDF — use Print for those.` : ''}`;
    $('pkPdf').disabled = !!bad; updatePkSummary();
    setTimeout(() => $('pkResult').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  } catch (e) { msg('Report not built', `<p>${esc(e.message)}</p>`); } finally { unbusy(); }
}
async function runReportFromAnywhere() {
  if (!key) return;
  if (window.Record?.hasUnsaved()) {
    const v = await msg('Save this record first?', '<p>The record you\'re working on hasn\'t been saved yet, so it won\'t be in the report.</p>', [{ label: 'Cancel', value: 'no' }, { label: 'Continue without saving', value: 'skip' }, { label: 'Save and continue', value: 'save', primary: true }]);
    if (!v || v === 'no') return; if (v === 'save' && !(await window.Record.save())) return;
  }
  const fromTimeline=view==='timeline';
  if(fromTimeline && calStart){
    const iso=d=>[d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
    $('pkRange').value='custom';
    $('pkFrom').value=iso(calStart);
    $('pkTo').value=iso(new Date(calStart.getFullYear(),calStart.getMonth()+2,0));
    $('pkFromW').classList.remove('hidden');$('pkToW').classList.remove('hidden');
  }
  $('pkResult').classList.add('hidden');
  go('packet');
  const caseNumber=fromTimeline?$('tCase').value:'';
  if(caseNumber){pkCaseSel=new Set([...pkCaseSel].filter(c=>c.startsWith('__seen:')));pkCaseSel.add(caseNumber);renderPacket()}
  $('pkCustom').open=true;
}
async function pkPreview() { try { const { recs, o } = await packetOptions(false); $('pvBody').innerHTML = blocksHtml(buildBlocks(recs, o), o); $('dlgPreview').showModal(); } catch (e) { msg('Can\'t preview yet', `<p>${esc(e.message)}</p>`); } }
function tryPdf(B, o) { try { return blocksPdf(B, o); } catch (e) { if (e.unsupported) { const err = new Error('unsupported'); err.unsupported = e.unsupported; throw err; } throw e; } }
async function unsupportedDialog(chars) { const v = await msg('Some characters can\'t go in a direct PDF', `<p>The built-in PDF maker can't show: <b>${esc(chars.join('  '))}</b></p><p>Use <b>Print / Save PDF</b> instead — it shows every character.</p>`, [{ label: 'Cancel', value: 'no' }, { label: 'Print / Save PDF instead', value: 'print', primary: true }]); if (v === 'print') pkPrint(); }
async function logPacket(o, recs, kind, sha) { S.packets = [...(S.packets || []), { id: o.pkt, at: o.generated, kind, records: recs.length, sha256: sha || '' }].slice(-500); await saveSettings(); updatePkSummary(); }
async function pkPdf(sectionsOverride, nameSuffix) {
  const saved = [secOrder, secOn]; if (sectionsOverride) { secOrder = sectionsOverride; secOn = new Set(sectionsOverride); }
  try { const { recs, o } = await packetOptions(false); const B = buildBlocks(recs, o); try { blocksPdf(B, { ...o }); } catch (e) { if (e.unsupported) { [secOrder, secOn] = saved; return unsupportedDialog(e.unsupported); } throw e; }
    o.pkt = await takePkt(); const out = blocksPdf(buildBlocks(recs, o), o); const sha = await L.sha256(out.bytes);
    if (!(await saveBlob(new Blob([out.bytes], { type: 'application/pdf' }), `${o.pkt}${nameSuffix ? '_' + nameSuffix : ''}.pdf`))) { await logPacket(o, recs, 'pdf-declined', sha); return; } await logPacket(o, recs, 'pdf' + (nameSuffix ? ':' + nameSuffix : ''), sha);
    toast(`${o.pkt} created (${out.pages} pages). Check your Downloads.`);
  } catch (e) { msg('Report not created', `<p>${esc(e.message)}</p>`); } finally { [secOrder, secOn] = saved; }
}
async function pkPrint() { if (noPrintHere()) return; try { const { recs, o } = await packetOptions(true); $('printRoot').innerHTML = blocksHtml(buildBlocks(recs, o), o); await logPacket(o, recs, 'print'); toast(`${o.pkt} sent to the print screen.`); setTimeout(() => print(), 120); } catch (e) { msg('Can\'t print yet', `<p>${esc(e.message)}</p>`); } }
async function pkZip() {
  busy('Building the report and ZIP…');
  try {
    const { recs, o } = await packetOptions(false); const B0 = buildBlocks(recs, o); try { blocksPdf(B0, o); } catch (e) { if (e.unsupported) { unbusy(); return unsupportedDialog(e.unsupported); } throw e; }
    o.pkt = await takePkt(); const out = blocksPdf(buildBlocks(recs, o), o); const base = o.pkt + '/'; const entries = []; const files = [];
    const addE = async (path, data, role, recordId) => { const u8 = data instanceof Uint8Array ? data : L.enc.encode(data); entries.push({ name: base + path, data: u8 }); files.push({ path, role, recordId: recordId || null, size: u8.length, sha256: await L.sha256(u8) }); };
    await addE(`${o.pkt}-report.pdf`, out.bytes, 'packet');
    if ($('pkOriginals').checked) { const used = new Set(); for (const r of recs) { busy(`Adding original ${r.docId}…`); const u8 = await fileBytes(r); if (await L.sha256(u8) !== r.source.sha256) throw new Error(`The stored copy of ${r.docId} doesn't match its recorded fingerprint. Restore it from a backup before exporting.`); let p = `originals/${safeName(r.docId)}__${safeName(r.source.name)}`; let n = 2; while (used.has(p)) p = p.replace(/(\.[^.]*)?$/, `_${n++}$1`); used.add(p); await addE(p, u8, 'original', r.docId); } }
    await addE('index/master-index.csv', indexCsv(recs), 'index');
    await addE('index/evidence-index.csv', csv([['Code', 'Description', 'Record', 'Related', 'File status', 'SHA-256'], ...evidenceInventory(recs).map(x => [x.code, x.desc, x.parent, x.related, x.status, x.sha])]), 'index');
    await addE('READ-ME.txt', `Documentation report ${o.pkt}\nGenerated ${stamp(o.generated)}\n\nContents:\n- ${o.pkt}-report.pdf: the organized report\n- originals/: untouched original files, exactly as imported${$('pkOriginals').checked ? '' : ' (not included in this export)'}\n- index/: master index and evidence index as spreadsheets (CSV)\n- manifest.json: SHA-256 fingerprints of every file above\n\nThis ZIP is NOT encrypted. A matching fingerprint shows a file is unchanged; it does not show who made it or that it is true. This is an organizational summary, not a court-issued or certified document.\n`, 'readme');
    const manifest = { schema: 'documentation-packet-manifest', version: 1, packetId: o.pkt, generatedAt: o.generated, title: o.title, recordCount: recs.length, sourceDigest: o.digest, hashAlgorithm: 'SHA-256', note: 'manifest.json is not listed in itself. Fingerprints confirm byte-level consistency only.', records: recs.map(r => ({ id: r.docId, revision: r.revision, eventDate: r.eventDate, sha256: r.source.sha256 })), files };
    entries.push({ name: base + 'manifest.json', data: L.enc.encode(JSON.stringify(manifest, null, 2)) });
    unbusy(); if (!(await saveBlob(L.zip(entries), `${o.pkt}.zip`))) return; await logPacket(o, recs, 'zip', files[0].sha256);
    toast(`${o.pkt}.zip created. It is not encrypted.`);
  } catch (e) { msg('ZIP not created', `<p>${esc(e.message)}</p>`); } finally { unbusy(); }
}
async function pkCatZip() {
  busy('Building category PDFs…');
  try { const { recs, o } = await packetOptions(false); const groups = GROUP_ORDER.filter(g => recs.some(r => groupOf(r) === g)); const entries = []; const saved = [secOrder, secOn];
    try { secOrder = ['cover', 'index', 'timeline', 'records', 'manifest']; secOn = new Set(secOrder); for (const g of groups) { const rs = recs.filter(r => groupOf(r) === g); blocksPdf(buildBlocks(rs, { ...o, title: `${o.title} — ${GROUPS[g].label}` }), o); } } catch (e) { [secOrder, secOn] = saved; if (e.unsupported) { unbusy(); return unsupportedDialog(e.unsupported); } throw e; }
    o.pkt = await takePkt();
    for (const g of groups) { const rs = recs.filter(r => groupOf(r) === g); const oo = { ...o, title: `${o.title} — ${GROUPS[g].label}`, digest: await sourceDigest(rs) }; const out = blocksPdf(buildBlocks(rs, oo), oo); entries.push({ name: `${o.pkt}/${safeName(GROUPS[g].label)}.pdf`, data: out.bytes }); }
    [secOrder, secOn] = saved; unbusy(); if (!(await saveBlob(L.zip(entries), `${o.pkt}_by-category.zip`))) return; await logPacket(o, recs, 'category-zip'); toast(`${groups.length} category PDFs saved in ${o.pkt}_by-category.zip.`);
  } catch (e) { msg('Not created', `<p>${esc(e.message)}</p>`); } finally { unbusy(); }
}
function printCalendar() {
  if (noPrintHere()) return;
  const recs = tlFiltered().filter(r => r.eventDate); const m2 = new Date(calStart.getFullYear(), calStart.getMonth() + 1, 1); const blocks = [{ t: 'sec', title: 'Calendar — ' + monthName(calStart.getFullYear(), calStart.getMonth()) + ' & ' + monthName(m2.getFullYear(), m2.getMonth()) }];
  for (const d of [calStart, m2]) { const ev = {}; recs.filter(r => r.eventDate.startsWith(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)).forEach(r => (ev[+r.eventDate.slice(8)] = ev[+r.eventDate.slice(8)] || []).push({ id: r.docId, color: colorOf(r) })); blocks.push({ t: 'cal', y: d.getFullYear(), m: d.getMonth(), ev }); }
  blocks.push({ t: 'note', text: 'Key: ' + GROUP_ORDER.filter(g => recs.some(r => groupOf(r) === g)).map(g => GROUPS[g].label).join(' · ') });
  $('printRoot').innerHTML = blocksHtml(blocks, { pkt: 'Calendar', generated: new Date().toISOString(), digest: '—' }); setTimeout(() => print(), 100);
}

/* ================= verify ZIP ================= */
async function verifyZip(file) {
  busy('Checking every file…');
  try {
    const ents = await L.unzip(new Uint8Array(await file.arrayBuffer())); const me = ents.find(e => /(^|\/)manifest\.json$/.test(e.name));
    if (!me) { msg('Unsupported format', '<p>This ZIP has no manifest.json, so there is nothing to check it against. Only report ZIPs made by this app can be verified.</p>'); return; }
    if (me.unsupported) { msg('Verification incomplete', '<p>The manifest is compressed in a way this browser can\'t open.</p>'); return; }
    let man; try { man = JSON.parse(L.dec.decode(me.data)); } catch { msg('Unsupported format', '<p>manifest.json could not be read.</p>'); return; }
    if (man.schema !== 'documentation-packet-manifest' || !Array.isArray(man.files)) { msg('Unsupported format', '<p>This manifest is not a report manifest from this app.</p>'); return; }
    if (/encrypted-library-backup|vault-backup/.test(file.name)) { }
    const base = me.name.replace(/manifest\.json$/, ''); const rows = []; let ok = 0, bad = 0, miss = 0, unsup = 0;
    for (const f of man.files) { const e = ents.find(x => x.name === base + f.path); if (!e) { miss++; rows.push([f.path, 'File missing']); continue; } if (e.unsupported) { unsup++; rows.push([f.path, 'Can\'t check (unsupported compression)']); continue; } const h = await L.sha256(e.data); if (h === f.sha256) { ok++; rows.push([f.path, 'Matches ✓']); } else { bad++; rows.push([f.path, 'Hash mismatch — this file changed']); } }
    const extra = ents.filter(e => e !== me && !man.files.some(f => base + f.path === e.name)).map(e => e.name.slice(base.length));
    const verdict = bad || miss ? 'Verification failed' : unsup || extra.length ? 'Verification incomplete' : 'Verification passed';
    msg(verdict, `<p class="banner ${bad || miss ? 'warn' : unsup || extra.length ? 'info' : 'ok'}"><b>${esc(man.packetId)}</b>: ${ok} matched, ${bad} changed, ${miss} missing${unsup ? `, ${unsup} couldn't be checked` : ''}${extra.length ? `, ${extra.length} extra file(s) not in the manifest` : ''}.</p><div class="tablewrap"><table class="t"><thead><tr><th>File</th><th>Result</th></tr></thead><tbody>${rows.map(([p, s]) => `<tr><td>${esc(p)}</td><td>${esc(s)}</td></tr>`).join('')}${extra.map(p => `<tr><td>${esc(p)}</td><td>Not listed in the manifest</td></tr>`).join('')}</tbody></table></div><p class="hint">A match means the file is byte-for-byte the same as when the report was made. It doesn't show who made it, or that it's true or admissible.</p>`);
  } catch (e) { msg('Verification incomplete', `<p>${esc(e.message)}</p>`); } finally { unbusy(); }
}

/* ================= backups ================= */
async function makeBackup() {
  busy('Preparing encrypted backup…');
  try {
    const vault = await idbGetV('meta', 'vault'), srow = await idbGetV('meta', 'settings'); const recs = await idbAll('records'), files = await idbAll('files'); const createdAt = new Date().toISOString();
    const b = x => L.toB64(x);
    const j = { format: 'documentation-vault-backup', version: 1, createdAt, vault: { salt: b(vault.salt), iter: vault.iter, check: { iv: b(vault.check.iv), ct: b(vault.check.ct) }, created: vault.created }, settings: srow ? { iv: b(srow.iv), ct: b(srow.ct) } : null, records: recs.map(r => ({ id: r.id, iv: b(r.iv), ct: b(r.ct) })), files: files.map(f => ({ id: f.id, iv: b(f.iv), path: `files/${f.id}.bin`, size: f.ct.length })), counts: { records: recs.length, files: files.length } };
    const entries = [{ name: 'vault-backup.json', data: L.enc.encode(JSON.stringify(j)) }, ...files.map(f => ({ name: `files/${f.id}.bin`, data: f.ct })), { name: 'READ-ME.txt', data: 'Encrypted library backup.\nEverything inside is encrypted with your library passphrase. Restore it from Settings → Restore from backup.\nKeep at least two copies in different places. A forgotten passphrase cannot be recovered.\n' }];
    unbusy(); if (!(await saveBlob(L.zip(entries), `encrypted-library-backup-${todayISO()}.zip`))) return;
    S.lastBackup = { at: createdAt, records: recs.length, files: files.length, verified: false }; await saveSettings(); renderSettings(); renderHome();
    msg('Backup downloaded', `<p>${recs.length} record(s) and ${files.length} file(s), encrypted.</p><p>To be sure it works, use <b>Test a backup</b> and choose the file you just saved. Keep a second copy somewhere else (another drive or cloud folder).</p>`);
  } catch (e) { msg('Backup not created', `<p>${esc(e.message)}</p>`); } finally { unbusy(); }
}
async function readBackup(file) {
  const ents = await L.unzip(new Uint8Array(await file.arrayBuffer())); const je = ents.find(e => e.name === 'vault-backup.json'); if (!je) throw new Error('This ZIP is not an encrypted library backup. (Report ZIPs can be checked with Verify a ZIP.)');
  const j = JSON.parse(L.dec.decode(je.data)); if (j.format !== 'documentation-vault-backup' || j.version !== 1) throw new Error('This backup format is not supported.');
  return { j, ents };
}
async function openBackup(file, purpose) {
  const { j, ents } = await readBackup(file); const pass = await askText('Backup passphrase', `Enter the passphrase that was used for this backup (made ${stamp(j.createdAt)}).`); if (pass == null) return null;
  busy('Decrypting and checking the backup…');
  const k = await deriveKey(pass, L.fromB64(j.vault.salt), j.vault.iter);
  try { const c = await unsealBytes({ iv: L.fromB64(j.vault.check.iv), ct: L.fromB64(j.vault.check.ct) }, k); if (L.dec.decode(c) !== CHECK) throw 0; } catch { unbusy(); throw new Error('That passphrase doesn\'t open this backup.'); }
  const recs = [], files = new Map(), problems = [];
  for (const r of j.records) { try { recs.push({ row: r, rec: await unseal({ iv: L.fromB64(r.iv), ct: L.fromB64(r.ct) }, k) }); } catch { problems.push(`Record ${r.id} failed its integrity check.`); } }
  for (const f of j.files) { const e = ents.find(x => x.name === f.path); if (!e || !e.data) { problems.push(`File ${f.id} is missing from the backup.`); continue; } files.set(f.id, { iv: L.fromB64(f.iv), ct: e.data }); }
  let checked = 0;
  for (const { rec } of recs) { const fr = files.get(rec.source?.fileId); if (!fr) { problems.push(`${rec.docId}: original file missing.`); continue; } try { const u8 = await unsealBytes(fr, k); if (await L.sha256(u8) !== rec.source.sha256) problems.push(`${rec.docId}: file fingerprint doesn't match.`); else checked++; } catch { problems.push(`${rec.docId}: file failed its integrity check.`); } }
  let settings = null; if (j.settings) { try { settings = await unseal({ iv: L.fromB64(j.settings.iv), ct: L.fromB64(j.settings.ct) }, k); } catch { problems.push('Settings failed their integrity check.'); } }
  void purpose; return { j, k, recs, files, problems, checked, settings };
}
async function testBackup(file) {
  try { const b = await openBackup(file, 'test'); if (!b) return; unbusy();
    const ok = !b.problems.length;
    if (ok && S.lastBackup && S.lastBackup.at === b.j.createdAt) { S.lastBackup.verified = new Date().toISOString(); await saveSettings(); renderSettings(); renderHome(); }
    msg(ok ? 'Backup test passed' : 'Backup has problems', `<p class="banner ${ok ? 'ok' : 'warn'}">Made ${esc(stamp(b.j.createdAt))}: ${b.recs.length} record(s) decrypted, ${b.checked} original file(s) decrypted and matched to their fingerprints.</p>${ok ? '<p>This backup can be restored with its passphrase.</p>' : `<ul>${b.problems.slice(0, 30).map(p => `<li>${esc(p)}</li>`).join('')}</ul>`}`);
  } catch (e) { unbusy(); msg('Backup test failed', `<p>${esc(e.message)}</p>`); }
}
async function restoreBackup(file, welcome) {
  try {
    const b = await openBackup(file, 'restore'); if (!b) return;
    if (b.problems.length) { unbusy(); const v = await msg('Backup has problems', `<ul>${b.problems.slice(0, 20).map(p => `<li>${esc(p)}</li>`).join('')}</ul><p>Restore what could be checked?</p>`, [{ label: 'Cancel', value: 'no' }, { label: 'Restore the rest', value: 'yes', primary: true }]); if (v !== 'yes') return; busy('Restoring…'); }
    const good = b.recs.filter(x => b.files.has(x.rec.source?.fileId) && !b.problems.some(p => p.startsWith(x.rec.docId + ':')));
    if (welcome) {
      const v = b.j.vault; const srow = b.j.settings;
      await tx(['meta', 'records', 'files'], 'readwrite', t => { const m = t.objectStore('meta'); m.put({ v: 1, salt: L.fromB64(v.salt), iter: v.iter, check: { iv: L.fromB64(v.check.iv), ct: L.fromB64(v.check.ct) }, created: v.created || b.j.createdAt }, 'vault'); if (srow) m.put({ iv: L.fromB64(srow.iv), ct: L.fromB64(srow.ct) }, 'settings'); const rs = t.objectStore('records'), fs = t.objectStore('files'); for (const x of good) { rs.put({ id: x.row.id, iv: L.fromB64(x.row.iv), ct: L.fromB64(x.row.ct) }); const f = b.files.get(x.rec.source.fileId); fs.put({ id: x.rec.source.fileId, iv: f.iv, ct: f.ct }); } });
      key = b.k; S = { ...defaultSettings(), ...(b.settings || {}) }; R = good.map(x => x.rec); unbusy(); enterApp();
      msg('Library restored', `<p>${R.length} record(s) restored with their original IDs, dates, links, and files. Use the same passphrase as the backup to unlock from now on.</p>`); return;
    }
    let added = 0, skipped = 0, demoted = 0; const newRecs = [], fileRows = [];
    for (const x of good) {
      const rec = x.rec; if (R.some(r => r.uid === rec.uid) || R.some(r => r.source?.sha256 === rec.source.sha256)) { skipped++; continue; }
      const u8 = await unsealBytes(b.files.get(rec.source.fileId), b.k); const fid = R.some(r => r.source.fileId === rec.source.fileId) ? uid() : rec.source.fileId;
      fileRows.push({ id: fid, ...await sealBytes(u8) }); const next = { ...rec, source: { ...rec.source, fileId: fid }, history: [...rec.history, { at: new Date().toISOString(), field: 'Restored from backup', from: '', to: stamp(b.j.createdAt) }] };
      if (next.isCurrent !== false && R.some(r => r.docId === next.docId && r.isCurrent !== false)) { next.isCurrent = false; next.flags = [...(next.flags || []), 'Restored from a backup while another current version already existed.']; demoted++; }
      newRecs.push(next); added++;
    }
    if (b.settings?.pkt && b.settings.pkt.year === S.pkt.year) S.pkt.next = Math.max(S.pkt.next, b.settings.pkt.next);
    S.srcNext = Math.max(S.srcNext || 1, b.settings?.srcNext || 1);
    const rows = await Promise.all(newRecs.map(async r => ({ id: r.uid, ...await seal(r) }))); const srow = await seal(S);
    await tx(['records', 'files', 'meta'], 'readwrite', t => { fileRows.forEach(f => t.objectStore('files').put(f)); rows.forEach(r => t.objectStore('records').put(r)); t.objectStore('meta').put(srow, 'settings'); });
    R.push(...newRecs); unbusy(); renderAll();
    msg('Restore finished', `<p>${added} record(s) added, ${skipped} already in this library (skipped — nothing was overwritten).${demoted ? ` ${demoted} added as earlier versions because a current version already existed.` : ''}</p>`);
  } catch (e) { unbusy(); msg('Restore failed', `<p>${esc(e.message)}</p><p>Your library was not changed.</p>`); }
}

/* ================= settings ================= */
async function renderSettings() {
  if (!S) return; const lb = S.lastBackup;
  $('backupLine').innerHTML = lb ? `Last backup: ${esc(stamp(lb.at))} (${lb.records} records, ${lb.files} files) — ${lb.verified ? `<b>tested ${esc(stamp(lb.verified))}</b>` : '<b>not tested yet</b>'}` : '<b>No backup yet.</b>';
  $('idleSel').value = String(S.idle || 10);
  $('storageInfo').textContent = await storageText();
  const hist = [...(S.imports || [])].reverse().slice(0, 12);
  $('importHist').innerHTML = (hist.length ? hist.map(h => `<div>${esc(stamp(h.at))} — ${h.count} file(s)</div>`).join('') : 'No imports yet.') + ((S.packets || []).length ? `<p style="margin-top:10px"><b>Reports made:</b> ${S.packets.slice(-8).reverse().map(p => esc(p.id + ' (' + p.kind + ')')).join(', ')}</p>` : '');
}
const GUIDE = `<h3>1. Make a record</h3><p>Tap <b>Inky</b>. Choose what you're documenting (an incident, police contact, a phone call, a payment, a school or medical event, and so on). Fill in the starred items — usually just the date and a few taps. More details are optional. Add photos, screenshots, or receipts with <b>Attach evidence</b>.</p>
<h3>2. Save it</h3><p>Tap <b>Save record</b>. It's encrypted and kept in your library with its own number (for example POLI004). You can also <b>Save &amp; download PDF</b> or <b>Save &amp; print</b> a copy of that one record. To correct a record, change the form and save again: it keeps the same number and becomes the next revision, and the earlier version is kept as history. Tap <b>Start a new record</b> when you're done.</p>
<h3>3. Assemble a packet</h3><p>Open <b>Packets</b>, check the case and dates, then tap <b>Build packet</b>. Use the section and privacy controls to choose what appears. Preview the result before exporting a PDF or ZIP.</p>
<h3>Library and timeline</h3><p>The <b>Library</b> shows everything saved, with search and filters, folders, a sortable index, and an evidence list. You can also import PDFs made on another device or by the older Inky app, plus any other files. <b>Ridion</b> shows two months at a time; tap a date or a record ID.</p>
<h3>Backups</h3><p>Your library lives only on this device, encrypted with your passphrase. In <b>Settings</b>, use <b>Download encrypted backup</b>, then <b>Test a backup</b>. Keep two copies in different places. On a new device, choose <b>Restore from an encrypted backup</b> on the first screen. A forgotten passphrase can't be recovered.</p>
<h3>Good to know</h3><p>Reports and ZIP files are not encrypted, so check what's included before sharing. A report is an organizational summary — not a court-issued or certified document. Write only what you saw, heard, or were told, and say which. The direct PDF uses standard Western characters; use Print for other scripts or emoji.</p>`;
const INSTALL = `<p><b>iPhone / iPad (Safari):</b> open the app's web address, tap the Share button, then <b>Add to Home Screen</b>.</p><p><b>Android (Chrome):</b> open the address, tap the ⋮ menu, then <b>Install app</b> or <b>Add to Home screen</b>.</p><p><b>Computer (Chrome or Edge):</b> click the install icon at the right end of the address bar.</p><p>After the first visit, the app opens and works without internet. Your library stays only in that browser on that device.</p>`;

/* ================= wiring ================= */
function wire() {
  $('authForm').addEventListener('submit', onAuth);
  $('restoreWelcome').addEventListener('click', () => { backupMode = 'welcome'; $('backupInput').click(); });
  document.querySelectorAll('[data-binder-tab]').forEach(b=>b.addEventListener('click',()=>{
    go('library');$('fCase').value=$('tCase').value;document.querySelector('[data-lv="'+b.dataset.binderTab+'"]').click();
    $('fStatus').value='';renderLibrary()
  }));
  document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => b.classList.contains('run') ? runReportFromAnywhere() : go(b.dataset.view)));
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); const im = e.target.closest('[data-import]'); if (im) $('importInput').click(); });
  $('lockBtn').addEventListener('click', lock); $('lockBtn2').addEventListener('click', lock);
  $('quickBackup').addEventListener('click', makeBackup);
  $('importInput').addEventListener('change', e => { stage(e.target.files); e.target.value = ''; });
  const drop = $('drop'); drop.addEventListener('click', () => $('importInput').click()); drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('importInput').click(); } });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => stage(e.dataTransfer.files));
  addEventListener('dragover', e => { if (key && view === 'library') e.preventDefault(); }); addEventListener('drop', e => { if (key && view === 'library' && !e.target.closest('#drop')) { e.preventDefault(); stage(e.dataTransfer.files); } });
  $('reviewList').addEventListener('input', onReviewInput); $('reviewList').addEventListener('change', onReviewInput);
  $('reviewList').addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) { openRecord(o.dataset.open); return; } if (e.target.closest('[data-rm]')) { const tmp = e.target.closest('.rv').dataset.tmp; staged = staged.filter(s => s.tmp !== tmp); resolveDuplicates(); renderReview(); } });
  $('reviewCancel').addEventListener('click', () => { staged = []; renderReview(); toast('Import cancelled. Nothing was saved.'); });
  $('reviewSave').addEventListener('click', commitImport);
  ['fSearch', 'fCat', 'fCase', 'fMonth', 'fStatus'].forEach(id => $(id).addEventListener('input', renderLibrary));
  document.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => { libView = b.dataset.lv; renderLibrary(); }));
  $('libBody').addEventListener('click', e => { const s = e.target.closest('[data-sort]'); if (s) { idxSort = idxSort.k === s.dataset.sort ? { k: s.dataset.sort, dir: -idxSort.dir } : { k: s.dataset.sort, dir: 1 }; renderLibrary(); return; } if (e.target.id === 'idxCsv') { saveBlob(new Blob([indexCsv(libFiltered())], { type: 'text/csv' }), `master-index-${todayISO()}.csv`); return; } const o = e.target.closest('[data-open]'); if (o) openRecord(o.dataset.open); });
  $('libBody').addEventListener('keydown', e => { if (e.key === 'Enter') { const o = e.target.closest('tr[data-open]'); if (o) openRecord(o.dataset.open); } });
  for (const id of ['tlList', 'cal']) $(id).addEventListener('click', e => { const d = e.target.closest('[data-day]'); if (d) { dayFilter = d.dataset.day; renderTimeline(); $('tlList').scrollIntoView({ behavior: 'smooth' }); return; } const o = e.target.closest('[data-open]'); if (o) openRecord(o.dataset.open); });
  $('recBody').addEventListener('click', onRecClick); $('recBody').addEventListener('change', onRecChange);
  ['tCase', 'tCat', 'tFrom', 'tTo'].forEach(id => $(id).addEventListener('input', renderTimeline));
  $('calPrev').addEventListener('click', () => { calStart = new Date(calStart.getFullYear(), calStart.getMonth() - 2, 1); renderTimeline(); });
  $('calNext').addEventListener('click', () => { calStart = new Date(calStart.getFullYear(), calStart.getMonth() + 2, 1); renderTimeline(); });
  $('calToday').addEventListener('click', () => { const t = new Date(); calStart = new Date(t.getFullYear(), t.getMonth() - 1, 1); renderTimeline(); });
  $('clearDay').addEventListener('click', () => { dayFilter = ''; renderTimeline(); });
  $('printCal').addEventListener('click', printCalendar);
  $('pkRange').addEventListener('change', () => { const c = $('pkRange').value === 'custom'; $('pkFromW').classList.toggle('hidden', !c); $('pkToW').classList.toggle('hidden', !c); renderPacket(); });
  ['pkFrom', 'pkTo', 'pkReview'].forEach(id => $(id).addEventListener('change', renderPacket));
  ['pkNarr', 'pkFollow', 'pkKids', 'pkOriginals', 'pkOpacity', 'pkTitle'].forEach(id => $(id).addEventListener('input', updatePkSummary));
  document.querySelectorAll('[name=pkProfile]').forEach(r => r.addEventListener('change', updatePkSummary));
  $('v-packet').addEventListener('change', e => { const t = e.target; if (t.dataset.case != null) { t.checked ? pkCaseSel.add(t.dataset.case) : pkCaseSel.delete(t.dataset.case); renderPacket(); } else if (t.dataset.cat) { t.checked ? pkCatSel.add(t.dataset.cat) : pkCatSel.delete(t.dataset.cat); renderPacket(); } else if (t.dataset.pick) { t.checked ? pkExcluded.delete(t.dataset.pick) : pkExcluded.add(t.dataset.pick); updatePkSummary(); } else if (t.dataset.sec) { t.checked ? secOn.add(t.dataset.sec) : secOn.delete(t.dataset.sec); updatePkSummary(); } });
  $('pkSections').addEventListener('click', e => { const u = e.target.closest('[data-up]'), d = e.target.closest('[data-down]'); const i = u ? +u.dataset.up : d ? +d.dataset.down : -1; if (i < 0) return; const j = u ? i - 1 : i + 1; [secOrder[i], secOrder[j]] = [secOrder[j], secOrder[i]]; renderPacket(); });
  $('pkRun').addEventListener('click', runReport);
  $('pkCustom').addEventListener('change', () => $('pkResult').classList.add('hidden')); $('pkCustom').addEventListener('input', e => { if (e.target.id === 'pkTitle' || e.target.type === 'range') $('pkResult').classList.add('hidden'); });
  $('pkSections').addEventListener('click', e => { if (e.target.closest('[data-up],[data-down]')) $('pkResult').classList.add('hidden'); });
  $('numView').addEventListener('click', () => window.Record?.openNumbers()); $('numExport').addEventListener('click', () => window.Record?.exportBackup());
  $('numImport').addEventListener('click', () => $('importFile').click()); $('importFile').addEventListener('change', e => { if (e.target.files[0]) window.Record?.importBackup(e.target.files[0]); e.target.value = ''; });
  $('pkPdf').addEventListener('click', () => pkPdf()); $('pkPrint').addEventListener('click', pkPrint); $('pkZip').addEventListener('click', pkZip); $('pkCatZip').addEventListener('click', pkCatZip);
  $('pkIndexCsv').addEventListener('click', () => { const recs = pkSelected(); saveBlob(new Blob([indexCsv(recs)], { type: 'text/csv' }), `master-index-${todayISO()}.csv`); });
  document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.quick; pkPdf(k === 'evidence' ? ['cover', 'evidence'] : k === 'chronology' ? ['cover', 'timeline', 'sequence'] : ['cover', 'financial'], k); }));
  let backupMode = 'restore';
  $('backupBtn').addEventListener('click', makeBackup); $('testBackupBtn').addEventListener('click', () => { backupMode = 'test'; $('backupInput').click(); }); $('restoreBtn').addEventListener('click', () => { backupMode = 'restore'; $('backupInput').click(); });
  $('backupInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (backupMode === 'test') testBackup(f); else restoreBackup(f, backupMode === 'welcome'); });
  $('verifyBtn').addEventListener('click', () => $('verifyInput').click()); $('verifyInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) verifyZip(f); });
  $('persistBtn').addEventListener('click', async () => { try { const ok = await navigator.storage.persist(); toast(ok ? 'The browser agreed to keep this storage.' : 'The browser declined. Keep regular backups.'); renderSettings(); } catch { toast('Not supported in this browser.'); } });
  $('idleSel').addEventListener('change', async () => { S.idle = Number($('idleSel').value); await saveSettings(); toast('Auto-lock updated.'); });
  $('helpBtn').addEventListener('click', () => msg('User guide', GUIDE)); $('installBtn').addEventListener('click', () => msg('Install on your device', INSTALL));
  $('wipeBtn').addEventListener('click', async () => { const v = await askText('Delete library', 'This permanently erases every record and file in this browser. Type DELETE to confirm.', { password: false, placeholder: 'DELETE' }); if (v !== 'DELETE') { if (v != null) toast('Not deleted.'); return; } db.close(); await new Promise(r => { const q = indexedDB.deleteDatabase('inkyridion-vault'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); location.reload(); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  addEventListener('afterprint', () => { $('printRoot').innerHTML = ''; });
  addEventListener('beforeunload', e => { if (staged.length) { e.preventDefault(); e.returnValue = ''; } });
  window.__vault = { get records() { return R; }, get settings() { return S; } };
  window.App = {
    toast, msg, busy, unbusy, saveBlob, inArtifact, go: v => go(v), runReport: runReportFromAnywhere,
    attachmentCode(hash) {return R.find(r=>r.kind==='file' && r.source?.sha256===hash)?.docId || ''},
    counters() {
      const next = { ...(S?.counters || {}) };
      for (const record of R) {
        const ids = [record.docId, ...(record.manifestFiles || []).map(file => file.ref), ...(record.relatedIds || [])];
        for (const id of ids) {
          const match = /^([A-Z]{2,4})(\d+)$/.exec(id || '');
          if (match) next[match[1]] = Math.max(Number(next[match[1]]) || 1, Number(match[2]) + 1);
        }
      }
      return next;
    },
    async saveCounters(c) { if (!S) return; const cur = S.counters || {}; for (const [k, v] of Object.entries(c)) cur[k] = Math.max(Number(cur[k]) || 1, Number(v) || 1); S.counters = cur; await saveSettings(); },
    saveCreated
  };
}
wire(); initAuth();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
