/* Minimal .xlsx writer (stored zip + SpreadsheetML). No dependencies, works offline. */
(function (root) {
  'use strict';
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), d = f.data, crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, d);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true);
      c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + d.length;
    }
    const cs = cen.reduce((s, a) => s + a.length, 0); const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cs, true); e.setUint32(16, off, true); e.setUint16(20, 0, true);
    const all = [...parts, ...cen, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; } return out;
  }
  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dserial = d => { const [y, m, dd] = d.split('-').map(Number); return (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 864e5; };
  const XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // cell: string | number | {date:'YYYY-MM-DD'} | {time:'HH:MM'} | {v, warn:true}
  function sheetXml(rows, widths, rtl) {
    const nc = rows.reduce((m, r) => Math.max(m, r.length), 1), last = colName(nc - 1) + rows.length;
    let x = XH + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<dimension ref="A1:${last}"/>` + `<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>`;
    if (widths && widths.length) x += '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    x += '<sheetData>';
    rows.forEach((row, ri) => {
      x += `<row r="${ri + 1}">`;
      row.forEach((c, ci) => {
        if (c == null || c === '') return; const ref = colName(ci) + (ri + 1);
        let s = 0, v = c;
        if (c && typeof c === 'object' && 'v' in c) { v = c.v; if (c.warn) s = 3; if (v == null || v === '') { if (s) x += `<c r="${ref}" s="${s}"/>`; return; } }
        if (ri === 0) x += `<c r="${ref}" t="inlineStr" s="1"><is><t>${xesc(v)}</t></is></c>`;
        else if (v && typeof v === 'object' && v.date) x += `<c r="${ref}" s="2"><v>${dserial(v.date)}</v></c>`;
        else if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
        else x += `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
      });
      x += '</row>';
    });
    x += '</sheetData>'; if (rows.length > 1) x += `<autoFilter ref="A1:${last}"/>`; return x + '</worksheet>';
  }
  const STYLES = XH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF8F4D00"/><name val="Arial"/><family val="2"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B3DB8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1DA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function buildXlsx(sheets) {
    const enc = new TextEncoder(), n = sheets.length, R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const names = []; for (const s of sheets) { let b = String(s.name).replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31) || 'Sheet', nm = b, i = 2; while (names.includes(nm)) nm = b.slice(0, 28) + ' ' + (i++); names.push(nm); }
    const ct = XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>';
    const rels = XH + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const defs = sheets.map((s, i) => { if (s.rows.length < 2) return ''; const nc = s.rows.reduce((m, r) => Math.max(m, r.length), 1); return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xesc(`'${names[i].replace(/'/g, "''")}'!$A$1:$${colName(nc - 1)}$${s.rows.length}`)}</definedName>`; }).join('');
    const wb = XH + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><bookViews><workbookView/></bookViews><sheets>${names.map((nm, i) => `<sheet name="${xesc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defs ? `<definedNames>${defs}</definedNames>` : ''}</workbook>`;
    const wbr = XH + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>`;
    const files = [['[Content_Types].xml', ct], ['_rels/.rels', rels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbr], ['xl/styles.xml', STYLES]];
    sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths, s.rtl !== false)]));
    return zip(files.map(([name, t]) => ({ name, data: enc.encode(t) })));
  }
  const api = { buildXlsx, crc32, zip };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.XLSX = api;
})(typeof self !== 'undefined' ? self : this);
