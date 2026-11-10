import { u16, u32 } from './binary.mjs';

/**
 * Parse the `cmap` table into a reverse map: GID → sorted Unicode code points.
 *
 * Only Unicode subtables are used:
 *   platform 0 (any encoding), platform 3 encoding 1 (BMP) and 10 (full).
 * Supported subtable formats: 4, 6, 10, 12, 13 (13 maps ranges to one glyph).
 *
 * @param {DataView} v
 * @param {number}   off  - cmap table offset
 * @returns {{ byGid: Map<number, number[]>, count: number }}
 */
export function parseCmap(v, off) {
  const byGid = new Map();
  const seen  = new Set();               // subtable offsets already read
  let count = 0;                         // distinct mapped code points

  const numTables = u16(v, off + 2);
  const cps = new Set();

  const add = (cp, gid) => {
    if (gid === 0) return;
    let a = byGid.get(gid);
    if (!a) byGid.set(gid, a = []);
    if (!a.includes(cp)) a.push(cp);
    cps.add(cp);
  };

  for (let i = 0; i < numTables; i++) {
    const pid = u16(v, off + 4 + i * 8);
    const eid = u16(v, off + 4 + i * 8 + 2);
    const sub = off + u32(v, off + 4 + i * 8 + 4);
    const isUni = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
    if (!isUni || seen.has(sub)) continue;
    seen.add(sub);
    try { readSubtable(v, sub, add); } catch { /* malformed subtable: skip */ }
  }

  for (const a of byGid.values()) a.sort((x, y) => x - y);
  count = cps.size;
  return { byGid, count };
}

function readSubtable(v, o, add) {
  const fmt = u16(v, o);

  if (fmt === 4) {
    const segX2 = u16(v, o + 6);
    const seg   = segX2 / 2;
    const endO  = o + 14;
    const stO   = endO + segX2 + 2;
    const dltO  = stO + segX2;
    const roO   = dltO + segX2;
    for (let s = 0; s < seg; s++) {
      const end = u16(v, endO + s * 2);
      const st  = u16(v, stO + s * 2);
      const dlt = u16(v, dltO + s * 2);
      const ro  = u16(v, roO + s * 2);
      if (st === 0xFFFF) continue;
      for (let c = st; c <= end; c++) {
        let g;
        if (ro === 0) g = (c + dlt) & 0xFFFF;
        else {
          const gp = roO + s * 2 + ro + (c - st) * 2;
          if (gp + 2 > v.byteLength) continue;
          g = u16(v, gp);
          if (g !== 0) g = (g + dlt) & 0xFFFF;
        }
        add(c, g);
      }
    }
  } else if (fmt === 6) {
    const first = u16(v, o + 6), n = u16(v, o + 8);
    for (let i = 0; i < n; i++) add(first + i, u16(v, o + 10 + i * 2));
  } else if (fmt === 10) {
    const first = u32(v, o + 12), n = u32(v, o + 16);
    for (let i = 0; i < n; i++) add(first + i, u16(v, o + 20 + i * 2));
  } else if (fmt === 12 || fmt === 13) {
    const n = u32(v, o + 12);
    for (let i = 0; i < n; i++) {
      const g = o + 16 + i * 12;
      const st = u32(v, g), en = u32(v, g + 4), gid = u32(v, g + 8);
      if (en - st > 0x110000) continue;
      for (let c = st; c <= en; c++) add(c, fmt === 12 ? gid + (c - st) : gid);
    }
  }
}
