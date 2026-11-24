/* AG Survey: reads the daily Excel reports on the phone (.xls, .xlsx, .xlsm), no library needed.
   XL.read(bytes) -> Promise<[{ name, cells: Map(row -> Map(col -> value)) }]>   rows and columns count from 1.
   .xls files saved with "protect workbook" are encrypted with Excel's built-in password; a file with a password to open needs
   that password: XL.read(bytes, { pw: [passwords] }) tries Excel's own, then these. RC4 CryptoAPI (SHA-1) and the older RC4
   (MD5) are both read. A wrong or missing password throws an error with code 'PW'; opt.used gets the password that opened it. */
(function (root) {
  'use strict';
  const td16 = new TextDecoder('utf-16le'), td8 = new TextDecoder('utf-8'), tdLatin = new TextDecoder('windows-1252');

  // ---------------- SHA-1 and RC4 (for the encrypted .xls) ----------------
  function sha1(bytes) {
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476, e = 0xC3D2E1F0; const w = new Uint32Array(80);
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let A = a, B = b, C = c, D = d, E = e;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (B & C) | (~B & D) : i < 40 ? B ^ C ^ D : i < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
        const k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        const t = (((A << 5) | (A >>> 27)) + f + E + k + w[i]) | 0; E = D; D = C; C = (B << 30) | (B >>> 2); B = A; A = t;
      }
      a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0; e = (e + E) | 0;
    }
    const out = new Uint8Array(20), ov = new DataView(out.buffer); [a, b, c, d, e].forEach((x, i) => ov.setUint32(i * 4, x >>> 0)); return out;
  }
  function rc4(key) {
    const s = new Uint8Array(256); for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; const t = s[i]; s[i] = s[j]; s[j] = t; }
    let i = 0, j = 0;
    return n => { const out = new Uint8Array(n); for (let k = 0; k < n; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; const t = s[i]; s[i] = s[j]; s[j] = t; out[k] = s[(s[i] + s[j]) & 255]; } return out; };
  }
  // MD5 (the older RC4 encryption of .xls)
  const MD5K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)), MD5S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  function md5(bytes) {
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(n - 8, (l * 8) >>> 0, true); dv.setUint32(n - 4, Math.floor(l / 0x20000000), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let o = 0; o < n; o += 64) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; } else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + MD5K[i] + dv.getUint32(o + g * 4, true)) >>> 0; A = D; D = C; C = B;
        const r = MD5S[((i >> 4) << 2) | (i & 3)]; B = (B + ((F << r) | (F >>> (32 - r)))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16), ov = new DataView(out.buffer); [a0, b0, c0, d0].forEach((x, i) => ov.setUint32(i * 4, x, true)); return out;
  }
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const le32 = v => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const utf16 = s => { const o = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { o[i * 2] = s.charCodeAt(i) & 255; o[i * 2 + 1] = s.charCodeAt(i) >> 8; } return o; };

  // ---------------- the .xls container (Compound File) ----------------
  function cfbStream(buf, want) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), u16 = o => dv.getUint16(o, true), u32 = o => dv.getUint32(o, true);
    const ss = 1 << u16(0x1E), nfat = u32(0x2C), dir0 = u32(0x30), cutoff = u32(0x38), mf0 = u32(0x3C), dif0 = u32(0x44), ndif = u32(0x48), off = s => (s + 1) * ss;
    const fatSecs = []; for (let i = 0; i < 109 && fatSecs.length < nfat; i++) fatSecs.push(u32(0x4C + i * 4));
    for (let d = dif0, k = 0; k < ndif && d < 0xFFFFFFFA; k++) { for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nfat; i++) fatSecs.push(u32(off(d) + i * 4)); d = u32(off(d) + ss - 4); }
    const fat = new Uint32Array(fatSecs.length * ss / 4); fatSecs.forEach((s, j) => { for (let i = 0; i < ss / 4; i++) fat[j * ss / 4 + i] = u32(off(s) + i * 4); });
    const chain = (s, t) => { const out = []; while (s < 0xFFFFFFFA && out.length <= t.length) { out.push(s); s = t[s]; } return out; };
    const read = (s, size) => { const c = chain(s, fat), o = new Uint8Array(c.length * ss); c.forEach((x, i) => o.set(buf.subarray(off(x), off(x) + ss), i * ss)); return size == null ? o : o.subarray(0, size); };
    const dir = read(dir0), ents = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) { const nl = dir[o + 0x40] | (dir[o + 0x41] << 8); ents.push({ name: td16.decode(dir.subarray(o, o + Math.max(0, nl - 2))), type: dir[o + 0x42], start: new DataView(dir.buffer, dir.byteOffset + o).getUint32(0x74, true), size: new DataView(dir.buffer, dir.byteOffset + o).getUint32(0x78, true) }); }
    const e = ents.find(x => x.type === 2 && want.test(x.name)); if (!e) throw new Error('مش ملف Excel');
    if (e.size >= cutoff) return read(e.start, e.size);
    const root = ents[0], mini = read(root.start, root.size), mfat = new Uint32Array(read(mf0).buffer.slice(0));
    const c = chain(e.start, mfat), o = new Uint8Array(c.length * 64); c.forEach((x, i) => o.set(mini.subarray(x * 64, x * 64 + 64), i * 64)); return o.subarray(0, e.size);
  }

  // ---------------- BIFF8 (.xls) ----------------
  const PLAIN = new Set([0x0809, 0x002F, 0x0194, 0x0195, 0x00E1, 0x0196, 0x0138]); // never encrypted
  function decryptXls(w, opt) {
    const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
    let p = 0, fp = -1;
    while (p + 4 <= w.length && p < 4096) { const t = dv.getUint16(p, true), l = dv.getUint16(p + 2, true); if (t === 0x2F) { fp = p; break; } p += 4 + l; }
    if (fp < 0) return w;
    const d = fp + 4; if (dv.getUint16(d, true) !== 1) throw new Error('الملف محمي بنوع تشفير مش مدعوم');
    const vMajor = dv.getUint16(d + 2, true), same = (a, b) => a.every((x, i) => x === b[i]);
    let mk;   // password -> (block number -> RC4 key) when it is the right password, else null
    if (vMajor === 1) {   // RC4 (Office 97/2000 compatible): MD5
      const salt = w.slice(d + 6, d + 22), ev = w.slice(d + 22, d + 38), evh = w.slice(d + 38, d + 54);
      mk = pw => {
        const t0 = md5(utf16(pw)).subarray(0, 5), ib = new Uint8Array(336); for (let i = 0; i < 16; i++) { ib.set(t0, i * 21); ib.set(salt, i * 21 + 5); }
        const t1 = md5(ib).subarray(0, 5), key = b => md5(cat(t1, le32(b)));
        const ks = rc4(key(0))(32), vv = ev.map((x, i) => x ^ ks[i]), vh = evh.map((x, i) => x ^ ks[16 + i]);
        return same(md5(vv), vh) ? key : null;
      };
    } else {              // RC4 CryptoAPI: SHA-1
      const hs = dv.getUint32(d + 10, true), h = d + 14, keyBits = dv.getUint32(h + 16, true) || 40, v = h + hs;
      const salt = w.slice(v + 4, v + 20), ev = w.slice(v + 20, v + 36), evh = w.slice(v + 40, v + 60);
      mk = pw => {
        const h0 = sha1(cat(salt, utf16(pw)));
        const key = b => { const x = sha1(cat(h0, le32(b))); return keyBits === 40 ? cat(x.subarray(0, 5), new Uint8Array(11)) : x.subarray(0, keyBits / 8); };
        const ks = rc4(key(0))(36), vv = ev.map((x, i) => x ^ ks[i]), vh = evh.map((x, i) => x ^ ks[16 + i]);
        return same(sha1(vv), vh) ? key : null;
      };
    }
    const pws = (opt && opt.pw) || []; let key = null;
    for (const pw of ['VelvetSweatshop'].concat(pws)) if (pw && (key = mk(pw))) { if (opt) opt.used = pw; break; }
    if (!key) { const e = new Error(pws.length ? 'الباسورد غلط' : 'الملف عليه باسورد'); e.code = 'PW'; throw e; }
    const out = new Uint8Array(w);
    for (let b = 0; b * 1024 < w.length; b++) { const n = Math.min(1024, w.length - b * 1024), ks = rc4(key(b))(n); for (let i = 0; i < n; i++) out[b * 1024 + i] ^= ks[i]; }
    p = 0; while (p + 4 <= w.length) {   // headers and some records stay as they were
      const t = dv.getUint16(p, true), l = dv.getUint16(p + 2, true);
      out.set(w.subarray(p, p + 4), p);
      if (PLAIN.has(t)) out.set(w.subarray(p + 4, p + 4 + l), p + 4); else if (t === 0x85) out.set(w.subarray(p + 4, p + 8), p + 4);
      p += 4 + l;
    }
    return out;
  }
  function rk(v) { let n; if (v & 2) n = v >> 2; else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, v & 0xFFFFFFFC, true); n = b.getFloat64(0, true); } return v & 1 ? n / 100 : n; }
  function readXls(buf, opt) {
    const w = decryptXls(cfbStream(buf, /^(Workbook|Book)$/), opt), dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
    const recs = []; for (let p = 0; p + 4 <= w.length;) { const t = dv.getUint16(p, true), l = dv.getUint16(p + 2, true); recs.push([t, p + 4, l]); p += 4 + l; }
    const byPos = new Map(); recs.forEach((r, i) => byPos.set(r[1] - 4, i));
    // a string that can run on into CONTINUE records; at each new CONTINUE the characters' width can change
    function strReader(i0, pos) {
      let ri = i0, p = pos, end = recs[i0][1] + recs[i0][2];
      const next = () => { ri++; if (!recs[ri] || recs[ri][0] !== 0x3C) throw new Error('bad continue'); p = recs[ri][1]; end = p + recs[ri][2]; };
      const need = () => { if (p >= end) next(); };
      return {
        u8() { need(); return w[p++]; }, u16() { const a = this.u8(); return a | (this.u8() << 8); }, u32() { return (this.u16() | (this.u16() << 16)) >>> 0; },
        skip(n) { while (n > 0) { need(); const k = Math.min(n, end - p); p += k; n -= k; } },
        chars(n, hi) { let s = ''; while (n > 0) { if (p >= end) { next(); hi = w[p++] & 1; } const k = Math.min(n, Math.floor((end - p) / (hi ? 2 : 1))); if (!k && p < end) { next(); hi = w[p++] & 1; continue; } s += (hi ? td16 : tdLatin).decode(w.subarray(p, p + k * (hi ? 2 : 1))); p += k * (hi ? 2 : 1); n -= k; } return s; },
        richStr() { const cch = this.u16(), f = this.u8(); const cRun = f & 8 ? this.u16() : 0, ext = f & 4 ? this.u32() : 0; const s = this.chars(cch, f & 1); this.skip(cRun * 4); this.skip(ext); return s; },
      };
    }
    let sst = [];
    const sheets = [];
    for (let i = 0; i < recs.length; i++) {
      const [t, p, l] = recs[i];
      if (t === 0xFC) { const r = strReader(i, p), n = r.u32(); const uniq = r.u32(); for (let k = 0; k < uniq; k++) { try { sst.push(r.richStr()); } catch (e) { break; } } void n; }
      if (t === 0x85) { const off = dv.getUint32(p, true), hid = w[p + 4], typ = w[p + 5], cch = w[p + 6], fl = w[p + 7]; const name = fl & 1 ? td16.decode(w.subarray(p + 8, p + 8 + cch * 2)) : tdLatin.decode(w.subarray(p + 8, p + 8 + cch)); if (typ === 0) sheets.push({ name, off, hidden: hid !== 0 }); }
      if (t === 0x0A) break; // end of the workbook part
    }
    for (const sh of sheets) {
      const cells = sh.cells = new Map(); const put = (r, c, v) => { if (v === '' || v == null) return; let m = cells.get(r + 1); if (!m) cells.set(r + 1, m = new Map()); m.set(c + 1, v); };
      let i = byPos.get(sh.off); if (i == null) continue; let fr = null;
      for (i++; i < recs.length; i++) {
        const [t, p, l] = recs[i]; if (t === 0x0A) break;
        const row = dv.getUint16(p, true), col = dv.getUint16(p + 2, true);
        if (t === 0xFD) put(row, col, sst[dv.getUint32(p + 6, true)]);
        else if (t === 0x203) put(row, col, dv.getFloat64(p + 6, true));
        else if (t === 0x27E) put(row, col, rk(dv.getUint32(p + 6, true)));
        else if (t === 0xBD) { const n = (l - 6) / 6; for (let k = 0; k < n; k++) put(row, col + k, rk(dv.getUint32(p + 6 + k * 6, true))); }
        else if (t === 0x06) { if (dv.getUint16(p + 12, true) === 0xFFFF) { const ty = w[p + 6]; if (ty === 0) fr = [row, col]; else if (ty === 1) put(row, col, !!w[p + 8]); } else put(row, col, dv.getFloat64(p + 6, true)); }
        else if (t === 0x207 && fr) { const r = strReader(i, p), cch = r.u16(), f = r.u8(); put(fr[0], fr[1], r.chars(cch, f & 1)); fr = null; }
        else if (t === 0x204 || t === 0xD6) { const r = strReader(i, p + 6), cch = r.u16(), f = r.u8(); put(row, col, r.chars(cch, f & 1)); }
      }
    }
    return sheets.map(s => ({ name: s.name, hidden: s.hidden, cells: s.cells || new Map() }));
  }

  // ---------------- .xlsx / .xlsm (zip + XML) ----------------
  async function inflate(data) {
    if (typeof DecompressionStream !== 'undefined') { const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); }
    if (typeof require === 'function') return new Uint8Array(require('zlib').inflateRawSync(data));
    throw new Error('المتصفح ده مش بيقدر يفك ملفات Excel');
  }
  function unzipIndex(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let e = buf.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('مش ملف Excel');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
    for (let i = 0; i < n; i++) {
      const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = td8.decode(buf.subarray(p + 46, p + 46 + nl)); files[name] = { m, cs, lo }; p += 46 + nl + xl + cl;
    }
    return async name => { const f = files[name]; if (!f) return null; const s = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true), d = buf.subarray(s, s + f.cs); return td8.decode(f.m === 8 ? await inflate(d) : d); };
  }
  const ent = s => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, x) => x === 'lt' ? '<' : x === 'gt' ? '>' : x === 'quot' ? '"' : x === 'apos' ? "'" : x === 'amp' ? '&' : String.fromCodePoint(x[1] === 'x' || x[1] === 'X' ? parseInt(x.slice(2), 16) : +x.slice(1)));
  const colNum = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  async function readXlsx(buf) {
    const get = unzipIndex(buf), wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels') || '', ss = await get('xl/sharedStrings.xml') || '';
    const tgt = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = /Id="([^"]+)"/.exec(m[0]), t = /Target="([^"]+)"/.exec(m[0]); if (id && t) tgt[id[1]] = t[1]; }
    const sst = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => ent([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
    const out = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = ent((/name="([^"]*)"/.exec(m[0]) || [])[1] || ''), rid = (/r:id="([^"]+)"/.exec(m[0]) || [])[1], hidden = /state="(hidden|veryHidden)"/.test(m[0]);
      let t = tgt[rid] || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      const x = await get(t); const cells = new Map();
      if (x) for (const c of x.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!c[4]) continue; const ty = (/\bt="(\w+)"/.exec(c[3]) || [])[1], v = (/<v>([\s\S]*?)<\/v>/.exec(c[4]) || [])[1];
        let val = ty === 's' ? sst[+v] : ty === 'inlineStr' ? ent([...c[4].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(y => y[1]).join('')) : ty === 'str' || ty === 'e' ? (v == null ? '' : ent(v)) : ty === 'b' ? v === '1' : v == null ? '' : +v;
        if (val === '' || val == null || (typeof val === 'number' && isNaN(val))) continue;
        const r = +c[2]; let mm = cells.get(r); if (!mm) cells.set(r, mm = new Map()); mm.set(colNum(c[1]), val);
      }
      out.push({ name, hidden, cells });
    }
    return out;
  }

  async function read(bytes, opt) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] === 0x50 && b[1] === 0x4B) return readXlsx(b);
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return readXls(b, opt);
    throw new Error('الملف ده مش Excel');
  }
  // Excel day number -> YYYY-MM-DD
  const serialDay = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return d.toISOString().slice(0, 10); };
  root.XL = { read, serialDay, _sha1: sha1, _md5: md5 };
})(typeof self !== 'undefined' ? self : this);
