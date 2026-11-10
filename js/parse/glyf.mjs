import { u16, u32 } from './binary.mjs';

/**
 * TrueType (`glyf`/`loca`) outline reader.
 *
 * Returns SVG path data in font units with the Y axis already flipped
 * (SVG Y grows downward), or '' for empty glyphs.
 *
 * @param {DataView} v
 * @param {number}   glyfOff
 * @param {number}   locaOff
 * @param {boolean}  longLoca    - head.indexToLocFormat === 1
 * @param {number}   numGlyphs
 * @returns {(gid:number)=>string}
 */
export function makeGlyfReader(v, glyfOff, locaOff, longLoca, numGlyphs) {
  const loc = gid => longLoca ? u32(v, locaOff + gid * 4) : u16(v, locaOff + gid * 2) * 2;

  /** @returns {{contours: {x:number,y:number,on:boolean}[][]}|null} */
  function outline(gid, depth) {
    if (gid < 0 || gid >= numGlyphs || depth > 8) return [];
    const a = loc(gid), b = loc(gid + 1);
    if (b <= a) return [];                         // empty glyph
    let p = glyfOff + a;
    const nc = v.getInt16(p, false);
    p += 10;
    return nc >= 0 ? simple(p, nc) : composite(p, depth);
  }

  function simple(p, nc) {
    if (nc === 0) return [];
    const ends = [];
    for (let i = 0; i < nc; i++) ends.push(u16(v, p + i * 2));
    p += nc * 2;
    const npts = ends[nc - 1] + 1;
    p += 2 + u16(v, p);                            // skip instructions

    const flags = [];
    while (flags.length < npts) {
      const f = v.getUint8(p++);
      flags.push(f);
      if (f & 8) {
        let r = v.getUint8(p++);
        while (r-- > 0 && flags.length < npts) flags.push(f);
      }
    }

    const xs = [], ys = [];
    let c = 0;
    for (const f of flags) {
      if (f & 2) { const d = v.getUint8(p++); c += (f & 16) ? d : -d; }
      else if (!(f & 16)) { c += v.getInt16(p, false); p += 2; }
      xs.push(c);
    }
    c = 0;
    for (const f of flags) {
      if (f & 4) { const d = v.getUint8(p++); c += (f & 32) ? d : -d; }
      else if (!(f & 32)) { c += v.getInt16(p, false); p += 2; }
      ys.push(c);
    }

    const contours = [];
    let s = 0;
    for (const e of ends) {
      const pts = [];
      for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      contours.push(pts);
      s = e + 1;
    }
    return contours;
  }

  function composite(p, depth) {
    const out = [];
    let more = true;
    while (more) {
      const fl = u16(v, p), gi = u16(v, p + 2);
      p += 4;
      let dx = 0, dy = 0;
      if (fl & 1) {                                // ARG_1_AND_2_ARE_WORDS
        if (fl & 2) { dx = v.getInt16(p, false); dy = v.getInt16(p + 2, false); }
        p += 4;
      } else {
        if (fl & 2) { dx = v.getInt8(p); dy = v.getInt8(p + 1); }
        p += 2;
      }
      let a = 1, bb = 0, cc = 0, d = 1;
      const f2 = o => v.getInt16(p + o, false) / 16384;
      if (fl & 8)        { a = d = f2(0); p += 2; }
      else if (fl & 0x40) { a = f2(0); d = f2(2); p += 4; }
      else if (fl & 0x80) { a = f2(0); bb = f2(2); cc = f2(4); d = f2(6); p += 8; }

      for (const ct of outline(gi, depth + 1)) {
        out.push(ct.map(pt => ({
          x: a * pt.x + cc * pt.y + dx,
          y: bb * pt.x + d * pt.y + dy,
          on: pt.on,
        })));
      }
      more = !!(fl & 0x20);
    }
    return out;
  }

  const r = n => Math.round(n * 100) / 100;

  /** Convert quadratic-spline contours to an SVG path string. */
  function toPath(contours) {
    let d = '';
    for (const pts of contours) {
      const n = pts.length;
      if (n < 2) continue;
      let start, first;
      if (pts[0].on)            { start = pts[0]; first = 1; }
      else if (pts[n - 1].on)   { start = pts[n - 1]; first = 0; }
      else { start = { x: (pts[0].x + pts[n - 1].x) / 2, y: (pts[0].y + pts[n - 1].y) / 2 }; first = 0; }

      d += `M${r(start.x)} ${r(-start.y)}`;
      const last = (pts[0].on) ? n : (pts[n - 1].on ? n - 1 : n);
      let ctrl = null;
      for (let i = first; i < last; i++) {
        const pt = pts[i];
        if (pt.on) {
          if (ctrl) { d += `Q${r(ctrl.x)} ${r(-ctrl.y)} ${r(pt.x)} ${r(-pt.y)}`; ctrl = null; }
          else d += `L${r(pt.x)} ${r(-pt.y)}`;
        } else {
          if (ctrl) {
            const mx = (ctrl.x + pt.x) / 2, my = (ctrl.y + pt.y) / 2;
            d += `Q${r(ctrl.x)} ${r(-ctrl.y)} ${r(mx)} ${r(-my)}`;
          }
          ctrl = pt;
        }
      }
      if (ctrl) d += `Q${r(ctrl.x)} ${r(-ctrl.y)} ${r(start.x)} ${r(-start.y)}`;
      d += 'Z';
    }
    return d;
  }

  return gid => {
    try { return toPath(outline(gid, 0)); } catch { return ''; }
  };
}
