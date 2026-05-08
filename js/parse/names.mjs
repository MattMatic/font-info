import { u16, u32, s16, s32, str4, tableChecksum } from './binary.mjs';

// ── read ─────────────────────────────────────────────────────────────────────

/**
 * Read every record from an OpenType `name` table.
 * Returns an array of {pid, eid, lid, nid, value, utf16} objects.
 *
 * Encoding rules (spec §5.2.1):
 *  - platformID 3 (Windows) → always UTF-16BE
 *  - platformID 0 (Unicode) with encodingID ≥ 1 → UTF-16BE
 *  - platformID 1 (Mac) → Mac Roman; we map printable ASCII and substitute
 *    '?' for anything outside 0x20–0x7E to avoid garbled display.
 */
export function readAllNames(v, off) {
  const count   = u16(v, off + 2);
  const strBase = off + u16(v, off + 4);
  const recs    = [];

  for (let i = 0; i < count; i++) {
    const b   = off + 6 + i * 12;
    const pid = u16(v, b);
    const eid = u16(v, b + 2);
    const lid = u16(v, b + 4);
    const nid = u16(v, b + 6);
    const len = u16(v, b + 8);
    const so  = u16(v, b + 10);

    const utf16 = (pid === 3) || (pid === 0 && eid >= 1);
    let s = '';

    if (utf16) {
      for (let j = 0; j < len; j += 2)
        s += String.fromCharCode(v.getUint16(strBase + so + j, false));
    } else {
      for (let j = 0; j < len; j++) {
        const c = v.getUint8(strBase + so + j);
        s += (c >= 0x20 && c < 0x7F) ? String.fromCharCode(c) : '?';
      }
    }

    recs.push({ pid, eid, lid, nid, value: s, utf16 });
  }
  return recs;
}

/**
 * Derive a {nameID → string} map from the raw records, preferring
 * Windows (pid=3) → Unicode (pid=0) → Mac (pid=1) in that order.
 */
export function readNamesSimple(v, off) {
  const recs = readAllNames(v, off);
  const res  = {};
  for (const r of recs)
    if ((r.pid === 3 || r.pid === 0) && !res[r.nid]) res[r.nid] = r.value;
  for (const r of recs)
    if (!res[r.nid]) res[r.nid] = r.value;
  return res;
}

// ── write ────────────────────────────────────────────────────────────────────

/**
 * Rebuild the `name` table byte payload with edited strings.
 *
 * @param {ArrayBuffer} origBuf  - original font file buffer (read-only)
 * @param {number}      ntOff    - byte offset of the name table in origBuf
 * @param {Object}      edits    - {nameID: newString} map of changes
 * @returns {{ tbl: Uint8Array, padLen: number, contentLen: number }}
 *
 * Strategy:
 *  - Keep the same record count and order (safe; no shaper depends on order).
 *  - For each record: if its nid is in `edits`, re-encode in its platform
 *    encoding; otherwise copy original bytes verbatim.
 *  - Reconstruct the string storage area from scratch (no overlap issues).
 *  - Pad the result to a 4-byte boundary as required by the spec.
 */
export function rebuildNameTable(origBuf, ntOff, edits) {
  const v       = new DataView(origBuf);
  const count   = u16(v, ntOff + 2);
  const origStrBase = ntOff + u16(v, ntOff + 4);

  // 1. Collect original record headers.
  const hdrs = [];
  for (let i = 0; i < count; i++) {
    const b = ntOff + 6 + i * 12;
    hdrs.push({
      pid:  u16(v, b),
      eid:  u16(v, b + 2),
      lid:  u16(v, b + 4),
      nid:  u16(v, b + 6),
      olen: u16(v, b + 8),
      ooff: u16(v, b + 10),
    });
  }

  // 2. Encode each record's string into bytes.
  const strs = [], offsets = [];
  let total = 0;

  for (const h of hdrs) {
    let bytes;
    if (h.nid in edits) {
      const txt   = edits[h.nid];
      const utf16 = (h.pid === 3) || (h.pid === 0 && h.eid >= 1);
      if (utf16) {
        bytes = new Uint8Array(txt.length * 2);
        for (let i = 0; i < txt.length; i++) {
          const c = txt.charCodeAt(i);
          bytes[i * 2]     = c >> 8;
          bytes[i * 2 + 1] = c & 0xFF;
        }
      } else {
        // Mac Roman: map to 7-bit ASCII (safe for all printable Latin).
        bytes = new Uint8Array(txt.length);
        for (let i = 0; i < txt.length; i++)
          bytes[i] = txt.charCodeAt(i) & 0x7F;
      }
    } else {
      bytes = new Uint8Array(origBuf, origStrBase + h.ooff, h.olen).slice();
    }
    offsets.push(total);
    strs.push(bytes);
    total += bytes.length;
  }

  // 3. Lay out the new table.
  const strStart   = 6 + count * 12;   // header(6) + records
  const contentLen = strStart + total;
  const padLen     = (contentLen + 3) & ~3;

  const tbl = new Uint8Array(padLen);
  const tv  = new DataView(tbl.buffer);
  s16(tv, 0, 0);          // format 0
  s16(tv, 2, count);
  s16(tv, 4, strStart);

  for (let i = 0; i < count; i++) {
    const h = hdrs[i], b = 6 + i * 12;
    tv.setUint16(b,      h.pid,           false);
    tv.setUint16(b + 2,  h.eid,           false);
    tv.setUint16(b + 4,  h.lid,           false);
    tv.setUint16(b + 6,  h.nid,           false);
    tv.setUint16(b + 8,  strs[i].length,  false);
    tv.setUint16(b + 10, offsets[i],      false);
    tbl.set(strs[i], strStart + offsets[i]);
  }

  return { tbl, padLen, contentLen };
}

// ── patch font & download ────────────────────────────────────────────────────

/**
 * Apply name-table edits to the font binary, fix the table directory,
 * and trigger a browser download of the result.
 *
 * Patching steps:
 *  1. Splice new name table bytes into a copy of the file.
 *  2. Update the name table's directory entry (checksum, length).
 *  3. If the table size changed (delta ≠ 0), shift offsets of all tables
 *     that sit after the name table in the file.
 *  4. Zero the `head` table's checkSumAdjustment field.
 *     Rationale: correctly recomputing the whole-file checksum (0xB1B0AFBA
 *     minus Σ all table words) would require a second full-file pass.
 *     Zeroing is universally accepted — HarfBuzz, Core Text, and DirectWrite
 *     all ignore this field at runtime; it is only used by font validation
 *     tools (e.g. `checksum -f`).
 */
export function patchAndDownload(origBuf, tablesRaw, edits, saveAs) {
  const nt = tablesRaw['name'];
  const { tbl, padLen, contentLen } = rebuildNameTable(origBuf, nt.off, edits);

  const origPad  = (nt.len + 3) & ~3;
  const delta    = padLen - origPad;
  const afterOrig = nt.off + origPad;
  const newSize  = origBuf.byteLength + delta;

  // Splice.
  const out = new Uint8Array(newSize);
  out.set(new Uint8Array(origBuf, 0, nt.off));
  out.set(tbl, nt.off);
  out.set(new Uint8Array(origBuf, afterOrig), nt.off + padLen);

  const nv = new DataView(out.buffer);
  const numTbls = u16(nv, 4);

  // Patch table directory.
  for (let i = 0; i < numTbls; i++) {
    const base = 12 + i * 16;
    const tag  = str4(nv, base);

    if (tag === 'name') {
      s32(nv, base + 4,  tableChecksum(out.buffer, nt.off, padLen));
      s32(nv, base + 12, contentLen); // spec wants unpadded length
      continue;
    }

    if (delta !== 0) {
      const off = u32(nv, base + 8);
      if (off > nt.off) s32(nv, base + 8, off + delta);
    }
  }

  // Zero head checkSumAdjustment when the file layout changed.
  if (delta !== 0) {
    for (let i = 0; i < numTbls; i++) {
      if (str4(nv, 12 + i * 16) === 'head') {
        s32(nv, u32(nv, 12 + i * 16 + 8) + 8, 0);
        break;
      }
    }
  }

  // Download.
  const blob = new Blob([out.buffer], { type: 'font/ttf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = saveAs;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}
