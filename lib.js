/* Shared low-level helpers: bytes, hashing, ZIP, PDF writer, record-manifest parsing. No network, no dependencies. */
'use strict';
const Lib = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
  const fromB64 = b => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const latin1 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return s; };
  async function sha256(data) { const u = data instanceof Uint8Array ? data : typeof data === 'string' ? enc.encode(data) : new Uint8Array(data); return hex(await crypto.subtle.digest('SHA-256', u)); }

  /* ---------- file type sniffing (checks real bytes, not just the name) ---------- */
  function sniff(u8, name = '') {
    const b = i => u8[i]; const s = (o, str) => [...str].every((c, i) => u8[o + i] === c.charCodeAt(0));
    if (s(0, '%PDF-')) return { kind: 'pdf', label: 'PDF document', mime: 'application/pdf' };
    if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return { kind: 'image', label: 'JPEG image', mime: 'image/jpeg' };
    if (s(0, '\x89PNG')) return { kind: 'image', label: 'PNG image', mime: 'image/png' };
    if (s(0, 'GIF8')) return { kind: 'image', label: 'GIF image', mime: 'image/gif' };
    if (s(0, 'RIFF') && s(8, 'WEBP')) return { kind: 'image', label: 'WebP image', mime: 'image/webp' };
    if (s(4, 'ftypheic') || s(4, 'ftypheix') || s(4, 'ftypmif1')) return { kind: 'image', label: 'HEIC image', mime: 'image/heic' };
    if (s(4, 'ftypqt')) return { kind: 'video', label: 'QuickTime video', mime: 'video/quicktime' };
    if (s(4, 'ftypM4A')) return { kind: 'audio', label: 'M4A audio', mime: 'audio/mp4' };
    if (s(4, 'ftyp')) return { kind: 'video', label: 'MP4 video', mime: 'video/mp4' };
    if (s(0, 'ID3') || (b(0) === 0xFF && (b(1) & 0xE0) === 0xE0)) return { kind: 'audio', label: 'MP3 audio', mime: 'audio/mpeg' };
    if (s(0, 'RIFF') && s(8, 'WAVE')) return { kind: 'audio', label: 'WAV audio', mime: 'audio/wav' };
    if (s(0, 'OggS')) return { kind: 'audio', label: 'Ogg audio', mime: 'audio/ogg' };
    if (b(0) === 0x1A && b(1) === 0x45 && b(2) === 0xDF && b(3) === 0xA3) return { kind: 'video', label: 'WebM video', mime: 'video/webm' };
    if (s(0, 'PK\x03\x04')) { const lower = name.toLowerCase(); if (lower.endsWith('.docx')) return { kind: 'document', label: 'Word document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }; return { kind: 'zip', label: 'ZIP archive', mime: 'application/zip' }; }
    if (b(0) === 0xD0 && b(1) === 0xCF && b(2) === 0x11 && b(3) === 0xE0) return { kind: 'document', label: 'Word (older) document', mime: 'application/msword' };
    const head = latin1(u8.subarray(0, 512));
    if (/^(From |Received:|Return-Path:|Date:|Subject:|MIME-Version:)/m.test(head) && /\.eml$/i.test(name)) return { kind: 'document', label: 'Email message', mime: 'message/rfc822' };
    if (u8.length && !u8.subarray(0, 2048).some(c => c === 0)) return { kind: 'document', label: 'Text file', mime: 'text/plain' };
    return { kind: 'other', label: 'Unrecognized file type', mime: 'application/octet-stream' };
  }

  /* ---------- record-manifest parsing (Inky v2 + historical v1) ---------- */
  function b64utf8(b64) { return dec.decode(fromB64(b64)); }
  function readManifest(text) {
    let m = text.match(/%DOCREC2-BEGIN\r?\n([\s\S]*?)%DOCREC2-END/);
    if (m) { const o = JSON.parse(b64utf8(m[1].split(/\r?\n/).map(l => l.replace(/^%DR2:/, '').trim()).join(''))); return { method: 'manifest-v2', schema: `${o.schema || 'documentation-record'} v${o.schemaVersion || 2}`, record: o.record || {} }; }
    m = text.match(/%LUMIDOCKET_MANIFEST_V1_BEGIN\r?\n([\s\S]*?)%LUMIDOCKET_MANIFEST_V1_END/);
    if (m) { const o = JSON.parse(b64utf8(m[1].split(/\r?\n/).map(l => l.replace(/^%LD1:/, '').trim()).join(''))); return { method: 'manifest-legacy', schema: 'legacy record v1', record: adaptLegacy(o.record || o) }; }
    return null;
  }
  function adaptLegacy(r) {
    const id = String(r.id || '');
    return {
      id, prefix: id.replace(/\d+$/, ''), title: r.title || '', category: r.category || '', subcategory: r.finance?.type || r.category || '', heading: r.category || '',
      eventDate: r.eventDate || '', eventTime: r.eventTime || '', timeAccuracy: r.timeAccuracy || (r.eventTime ? 'Exact' : 'Unknown'), timeZone: r.timeZone || '',
      entryStarted: r.entryDate || '', generatedAt: r.generatedAt || '', revision: Number(r.revision) || 1,
      preparedBy: r.reporter || '', basis: r.accountBasis || '', location: r.location || '',
      people: String(r.people || '').split(/\n+/).map(s => s.trim()).filter(Boolean), children: [],
      caseRefs: r.caseNumber ? String(r.caseNumber).split(/[,;]+/).map(c => ({ caseNumber: c.trim(), proceeding: r.caseType || '' })).filter(c => c.caseNumber) : [],
      relatedIds: Array.isArray(r.relatedIds) ? r.relatedIds : String(r.relatedIds || '').split(/[,;\s]+/).filter(Boolean),
      fields: (r.extra || []).map(x => ({ key: '', label: x.label, value: x.value })),
      narrative: [['narrative', 'Account', r.narrative], ['observed', 'Personally seen or heard', r.observed], ['reported', 'Information reported by others', r.reported], ['quotes', 'Exact statements', r.quotes], ['outcome', 'Outcome', r.outcome], ['followup', 'Follow-up', r.followup]].filter(x => x[2]).map(([key, label, value]) => ({ key, label, value })),
      sequence: (r.moments || []).map(x => ({ when: x.time || '', description: x.detail || '', basis: x.basis || '' })),
      files: (r.files || []).map(x => ({ ref: x.receiptId || null, role: x.receiptId ? 'receipt' : 'evidence', name: x.name, size: x.size, mime: x.mime, sha256: /^[0-9a-f]{64}$/.test(x.sha256 || '') ? x.sha256 : null })),
      financial: r.finance ? { kind: r.finance.type || 'payment', amount: r.finance.amount ?? null, amountText: r.finance.amount != null ? String(r.finance.amount) : '', paidBy: r.finance.paidBy || r.finance.payer || '', paidTo: r.finance.paidTo || r.finance.recipient || '', category: r.finance.category || '', status: r.finance.status || '', method: r.finance.method || '', merchantReceiptNumber: r.finance.receiptNumber || '' } : null
    };
  }
  /* Rough text scan for PDFs without record data: uncompressed and Flate streams, literal strings only. */
  async function scanPdfText(u8) {
    const raw = latin1(u8); const texts = [];
    const pull = s => { const out = []; s.replace(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g, (m, a, b) => { const src = a != null ? a : (b || '').replace(/\(((?:\\.|[^\\)])*)\)|-?\d+(\.\d+)?/g, (mm, x) => x != null ? x : ''); out.push(src.replace(/\\([0-7]{1,3})/g, (q, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, '$1')); return ''; }); return out.join(' '); };
    texts.push(pull(raw));
    if ('DecompressionStream' in self) {
      const re = /\/FlateDecode[^]*?stream\r?\n/g; let m, n = 0;
      while ((m = re.exec(raw)) && n < 60) { n++; const start = m.index + m[0].length; const end = raw.indexOf('endstream', start); if (end < 0) break;
        try { const data = await new Response(new Blob([u8.subarray(start, end)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(); texts.push(pull(latin1(new Uint8Array(data)))); } catch { /* skip stream */ } }
    }
    return texts.join(' ').replace(/\s+/g, ' ').slice(0, 20000);
  }

  /* ---------- ZIP (store) writer and reader ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(entries) {
    const parts = [], central = []; let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = e.data instanceof Uint8Array ? e.data : enc.encode(String(e.data)); const crc = crc32(data); const d = e.date || new Date();
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name); offset += 30 + name.length + data.length;
      if (offset > 0xFFFFFFF0) throw new Error('This export is larger than 4 GB, which ZIP files made here cannot hold. Select fewer files.');
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
  async function unzip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf); const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('This is not a ZIP file, or it is damaged.');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = [];
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const ln = dv.getUint16(lho + 26, true), lx = dv.getUint16(lho + 28, true); const start = lho + 30 + ln + lx; const raw = u8.subarray(start, start + csize);
      let data = null, unsupported = false;
      if (method === 0) data = raw;
      else if (method === 8 && 'DecompressionStream' in self) { try { data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); } catch { unsupported = true; } }
      else unsupported = true;
      out.push({ name, data, unsupported });
    }
    return out;
  }

  /* ---------- PDF writer (US Letter, Helvetica, WinAnsi) ---------- */
  const HN = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const HB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  const WIN = {0x20AC:128,0x201A:130,0x0192:131,0x201E:132,0x2026:133,0x2020:134,0x2021:135,0x02C6:136,0x2030:137,0x0160:138,0x2039:139,0x0152:140,0x017D:142,0x2018:145,0x2019:146,0x201C:147,0x201D:148,0x2022:149,0x2013:150,0x2014:151,0x02DC:152,0x2122:153,0x0161:154,0x203A:155,0x0153:156,0x017E:158,0x0178:159};
  const WX = {128:556,130:222,131:556,132:333,133:1000,134:556,135:556,136:333,137:1000,138:667,139:333,140:1000,142:611,145:222,146:222,147:333,148:333,149:350,150:556,151:1000,152:333,153:1000,154:500,155:333,156:944,158:500,159:667};
  const IGNORE = /[​-‍︎️]/;
  function winBytes(s, bad) { const out = []; for (const ch of String(s ?? '').normalize('NFC')) { const c = ch.codePointAt(0); if (c === 9) { out.push(32, 32, 32, 32); continue; } if (c === 10 || c === 13 || IGNORE.test(ch)) continue; if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out.push(c); else if (WIN[c]) out.push(WIN[c]); else { if (bad) bad.add(ch); out.push(63); } } return out; }
  const rgb = x => [1, 3, 5].map(i => (parseInt(x.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

  /* ---------- Project color guide (shared by the app, record PDFs, and reports) ---------- */
  const PAL = {
    cotton: '#f2eadc', greenOnyx: '#989a82', oakmoss: '#5e5a30', moodyBlue: '#5f8293', seaworthy: '#0e3f52',
    sage: '#8c9868', lavender: '#8e6a7c', clay: '#c27d5c', moss: '#857634', slate: '#4a5d6b'
  };
  const PAL_NAMES = {
    cotton: ['Cotton', 'SW 9581'], greenOnyx: ['Green Onyx', 'SW 9128'], oakmoss: ['Oakmoss', 'SW 6180'], moodyBlue: ['Moody Blue', 'SW 6221'], seaworthy: ['Seaworthy', 'SW 7620'],
    sage: ['Sage', 'Earthy Green'], lavender: ['Lavender', 'Soft Plum'], clay: ['Clay', 'Terracotta Rose'], moss: ['Moss', 'Deep Olive'], slate: ['Slate', 'Graphite Blue-Gray']
  };
  /* Document chrome uses the core palette; one palette color per record group keeps coding simple. */
  const DOC = { band: PAL.cotton, head: PAL.seaworthy, accent: PAL.moodyBlue, ink: '#1f2a30', label: PAL.slate, light: '#f7f2e9', zebra: '#fbf8f2', rule: '#ddd5c6', grid: '#cfc6b4' };
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  /* Darkens a palette color just enough for readable text on white (WCAG AA, 4.5:1). */
  function inkOf(h) { let t = 0, x = h; const shade = k => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join(''); while (1.05 / (lum(x) + .05) < 4.6 && t < .9) { t += .04; x = shade(t); } return x; }
  const CAT = {
    incident: 'clay', concerns: 'lavender', comms: 'moodyBlue', police: 'seaworthy', evidence: 'slate',
    parenting: 'sage', care: 'greenOnyx', finance: 'moss', court: 'oakmoss'
  };
  const catColor = g => { const k = CAT[g]; const color = k ? PAL[k] : '#8a8578'; return { key: k || '', name: k ? PAL_NAMES[k][0] : 'Neutral', color, ink: inkOf(color) }; };

  /* Logo for generated PDFs (JPEG drawn on the Cotton header band). */
  let LOGO = null;
  function logo() {
    if (LOGO !== null) return LOGO; const src = self.INKY_LOGO; if (!src || !src.b64) return (LOGO = false);
    try { const bin = atob(src.b64); LOGO = { w: src.w, h: src.h, bg: src.bg, obj: `<< /Type /XObject /Subtype /Image /Width ${src.w} /Height ${src.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n${bin}\nendstream` }; } catch { LOGO = false; }
    return LOGO;
  }

  function pdf(opts = {}) {
    const W = 612, H = 792, ML = 54, MR = 558, CW = MR - ML, TOP = 70, BOT = 58, BAND = 50;
    const NAVY = DOC.head, INK = DOC.ink, SLATE = DOC.label, LIGHT = DOC.light, RULE = DOC.rule;
    const LG = opts.logo === false ? null : logo(); let usedLogo = false;
    const accent = opts.accent || NAVY; const bad = new Set(); const pages = []; let ops = null, y = 0;
    const tw = (s, size, bold) => { let u = 0; const tab = bold ? HB : HN; for (const b of winBytes(s)) u += b >= 32 && b <= 126 ? tab[b - 32] : (WX[b] || (b >= 192 && b <= 222 ? 722 : bold ? 611 : 556)); return u * size / 1000; };
    const lit = s => winBytes(s, bad).map(b => b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b < 128 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0')).join('');
    function wrap(text, max, size, bold) { const out = []; for (const para of String(text ?? '').split(/\r?\n/)) { if (!para.trim()) { out.push(''); continue; } let line = ''; for (let word of para.split(/ +/)) { if (!word) continue; while (tw(word, size, bold) > max) { let n = 1; while (n < word.length && tw(word.slice(0, n + 1), size, bold) <= max) n++; if (line) { out.push(line); line = ''; } out.push(word.slice(0, n)); word = word.slice(n); } if (!word) continue; const t = line ? line + ' ' + word : word; if (line && tw(t, size, bold) > max) { out.push(line); line = word; } else line = t; } if (line) out.push(line); } while (out.length && out[out.length - 1] === '') out.pop(); return out.length ? out : ['']; }
    const A = {
      W, H, ML, MR, CW, NAVY, INK, SLATE, accent, tw, wrap,
      get y() { return y; }, set y(v) { y = v; },
      text(s, x, base, size, bold, col = INK) { ops.push(`BT /F${bold ? 2 : 1} ${size} Tf ${rgb(col)} rg ${x.toFixed(2)} ${(H - base).toFixed(2)} Td (${lit(s)}) Tj ET`); },
      rect(x, top, w, hh, col) { ops.push(`${rgb(col)} rg ${x.toFixed(2)} ${(H - top - hh).toFixed(2)} ${w.toFixed(2)} ${hh.toFixed(2)} re f`); },
      box(x, top, w, hh, col, lw = .6) { ops.push(`${rgb(col)} RG ${lw} w ${x.toFixed(2)} ${(H - top - hh).toFixed(2)} ${w.toFixed(2)} ${hh.toFixed(2)} re S`); },
      line(x1, t1, x2, t2, col = RULE, lw = .6) { ops.push(`${rgb(col)} RG ${lw} w ${x1.toFixed(2)} ${(H - t1).toFixed(2)} m ${x2.toFixed(2)} ${(H - t2).toFixed(2)} l S`); },
      logo(x, top, hh) { if (!LG) return 0; const ww = hh * LG.w / LG.h; usedLogo = true; ops.push(`q ${ww.toFixed(2)} 0 0 ${hh.toFixed(2)} ${x.toFixed(2)} ${(H - top - hh).toFixed(2)} cm /Im1 Do Q`); return ww; },
      hasLogo: !!LG,
      logoW: hh => LG ? hh * LG.w / LG.h : 0,
      room() { return H - BOT - y; },
      ensure(hh) { if (hh > A.room()) A.newPage(); },
      newPage() {
        if (ops) pages.push(ops); ops = [];
        if (opts.watermark > 0) { const g = (1 - 0.13 * Math.min(1, opts.watermark)).toFixed(3); const cx = W / 2, cy = H / 2; for (const r of [70, 130, 190]) ops.push(`${g} ${g} ${g} RG 0.8 w ${cx} ${cy + r} m ${cx + r} ${cy} l ${cx} ${cy - r} l ${cx - r} ${cy} l h S`); ops.push(`${g} ${g} ${g} RG 0.8 w ${cx - 190} ${cy} m ${cx + 190} ${cy} l S ${cx} ${cy - 190} m ${cx} ${cy + 190} l S`); }
        A.rect(0, 0, W, BAND, DOC.band); A.rect(0, 0, W, 4, accent); A.rect(0, BAND - 1.2, W, 1.2, DOC.grid);
        let lx = ML; if (LG) lx += A.logo(ML - 4, 9, 36) + 8;
        if (opts.headerLeft) A.text(opts.headerLeft, lx, 31, 8, true, NAVY);
        if (opts.headerRight) A.text(opts.headerRight, MR - tw(opts.headerRight, 8.5, true), 31, 8.5, true, NAVY);
        y = TOP;
      },
      section(title, col = accent) { A.ensure(80); y += 6; A.rect(ML, y, 4, 16, col); A.text(String(title).toUpperCase(), ML + 12, y + 12.5, 11, true, NAVY); y += 22; A.line(ML, y, MR, y); y += 8; },
      sub(title, col = accent, right = '') { A.ensure(60); y += 8; A.rect(ML, y, CW, 22, col); const maxW = CW - 16 - (right ? tw(right, 9, false) + 14 : 0); let tt = String(title); if (tw(tt, 10.5, true) > maxW) { while (tt.length > 1 && tw(tt + '\u2026', 10.5, true) > maxW) tt = tt.slice(0, -1); tt = tt.trimEnd() + '\u2026'; } A.text(tt, ML + 8, y + 15, 10.5, true, '#ffffff'); if (right) A.text(right, MR - 8 - tw(right, 9, false), y + 15, 9, false, '#ffffff'); y += 28; },
      kv(label, value, LW = 150) {
        const L = wrap(label, LW - 14, 8.6, true); let V = wrap(value, CW - LW - 14, 10, false); let first = true;
        while (V.length) { const n = Math.floor((A.room() - 10) / 13.8); if (n < Math.min(2, V.length)) { A.newPage(); continue; }
          const take = V.splice(0, n), labs = first ? L : ['(continued)'], hh = Math.max(take.length * 13.8, labs.length * 11) + 10;
          A.rect(ML, y, LW, hh, LIGHT); labs.forEach((s, i) => A.text(s, ML + 7, y + 14 + i * 11, 8.6, true, SLATE)); take.forEach((s, i) => { if (s) A.text(s, ML + LW + 8, y + 15 + i * 13.8, 10, false, INK); });
          y += hh; A.line(ML, y, MR, y); first = false; if (V.length) A.newPage(); }
      },
      para(label, value) { const Ls = wrap(value, CW, 10, false); A.ensure(14 + Math.min(Ls.length, 2) * 14.5 + 4); y += 5; if (label) { A.text(label, ML, y + 10, 9, true, SLATE); y += 14; } for (const s of Ls) { if (A.room() < 15) A.newPage(); if (s) A.text(s, ML, y + 11, 10, false, INK); y += 14.5; } y += 3; },
      note(t, size = 8.6) { for (const s of wrap(t, CW, size, false)) { if (A.room() < 12) A.newPage(); A.text(s, ML, y + 9, size, false, SLATE); y += size + 3.6; } y += 3; },
      table(cols, rows, o = {}) {
        const size = o.size || 8.8, lh = size + 3.6, ws = cols.map(c => c.w * CW);
        const head = () => { const HL = cols.map((c, i) => wrap(c.h, ws[i] - 10, 8.2, true)); const hh = Math.max(...HL.map(l => l.length)) * 10.5 + 9; A.ensure(hh + 24); A.rect(ML, y, CW, hh, o.headColor || NAVY); let x = ML; HL.forEach((ls, i) => { ls.forEach((s, j) => A.text(s, x + 5, y + 12 + j * 10.5, 8.2, true, '#ffffff')); x += ws[i]; }); y += hh; };
        head();
        rows.forEach((r, ri) => {
          const cells = r.cells || r; const CL = cells.map((c, i) => wrap(String(c ?? ''), ws[i] - 10, size, cols[i].bold)); let hh = Math.max(...CL.map(l => l.length)) * lh + 8;
          if (hh > A.room()) { A.newPage(); head(); }
          if (hh > A.room()) { const max = Math.floor((A.room() - 8) / lh); CL.forEach((l, i) => { if (l.length > max) CL[i] = l.slice(0, max - 1).concat(['(continued in record section)']); }); hh = max * lh + 8; }
          if (ri % 2 === 1) A.rect(ML, y, CW, hh, DOC.zebra);
          if (r.bar) A.rect(ML, y, 3, hh, r.bar);
          let x = ML; CL.forEach((ls, i) => { ls.forEach((s, j) => { if (s) A.text(s, x + 5 + (i === 0 && r.bar ? 2 : 0), y + 12 + j * lh, size, cols[i].bold, (i === 0 && r.color) || INK); }); x += ws[i]; });
          y += hh; A.line(ML, y, MR, y);
        });
        y += 6;
      },
      finish(meta = {}) {
        if (ops) pages.push(ops); ops = null;
        if (bad.size) { const e = new Error('unsupported characters'); e.unsupported = [...bad]; throw e; }
        const u16 = s => '<FEFF' + [...String(s)].map(ch => { const c = ch.codePointAt(0); if (c > 0xffff) { const v = c - 0x10000; return (0xD800 + (v >> 10)).toString(16).padStart(4, '0') + (0xDC00 + (v & 1023)).toString(16).padStart(4, '0'); } return c.toString(16).padStart(4, '0'); }).join('').toUpperCase() + '>';
        const dt = new Date(); const p2 = n => String(Math.abs(n)).padStart(2, '0'); const off = -dt.getTimezoneOffset();
        const pdfDate = `D:${dt.getFullYear()}${p2(dt.getMonth() + 1)}${p2(dt.getDate())}${p2(dt.getHours())}${p2(dt.getMinutes())}${p2(dt.getSeconds())}${off >= 0 ? '+' : '-'}${p2(Math.floor(Math.abs(off) / 60))}'${p2(Math.abs(off) % 60)}'`;
        const objs = [null, null, null]; const add = s => { objs.push(s); return objs.length - 1; };
        const F1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), F2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        const kids = []; const IM = usedLogo ? add(LG.obj) : 0; const xres = IM ? ` /XObject << /Im1 ${IM} 0 R >>` : '';
        pages.forEach((pg, i) => {
          const left = opts.footer ? opts.footer(i + 1, pages.length) : ''; const right = `Page ${i + 1} of ${pages.length}`;
          const foot = [`${rgb(RULE)} RG 0.6 w ${ML} 44 m ${MR} 44 l S`, `BT /F1 7.4 Tf ${rgb(SLATE)} rg ${ML} 30 Td (${lit(left)}) Tj ET`, `BT /F1 7.4 Tf ${rgb(SLATE)} rg ${(MR - tw(right, 7.4, false)).toFixed(2)} 30 Td (${lit(right)}) Tj ET`];
          const stream = pg.concat(foot).join('\n'); const sid = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
          kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >>${xres} >> /Contents ${sid} 0 R >>`));
        });
        const info = add(`<< /Title ${u16(meta.title || 'Documentation')} /Subject ${u16(meta.subject || '')} /Keywords ${u16(meta.keywords || '')} /CreationDate (${pdfDate}) /ModDate (${pdfDate}) >>`);
        objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objs[2] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
        let out = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
        for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
        const xref = out.length; out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
        out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
        return { bytes, pages: pages.length };
      }
    };
    return A;
  }

  // Generated labels follow explicit wording or the record's structured type.
  function recordTerm(record) {
    const chosen = (record.fields || []).find(field => field.key === 'wording');
    const term = chosen && (chosen.raw || chosen.value);
    if (['Event', 'Occurrence', 'Episode', 'Interaction', 'Situation', 'Matter'].includes(term)) return term;
    const prefix = record.prefix || record.category || String(record.id || record.docId || '').replace(/[-0-9].*$/, '');
    if (['COMM', 'KCT', 'COM', 'EXC', 'EXCH', 'POLI', 'POL', 'PPD'].includes(prefix)) return 'Interaction';
    if (['CRT', 'CONC'].includes(prefix) || record.financial?.kind === 'matter' || record.typeKey === 'FINMAT') return 'Matter';
    return 'Event';
  }

  return { PAL, PAL_NAMES, DOC, CAT, catColor, inkOf, logo, recordTerm, enc, dec, toB64, fromB64, hex, latin1, sha256, sniff, readManifest, adaptLegacy, scanPdfText, crc32, zip, unzip, pdf, winBytes };
})();
