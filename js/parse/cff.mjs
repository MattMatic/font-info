import { u16 } from './binary.mjs';
import { CFF_STD_STRINGS } from './glyphNames.mjs';

/**
 * Compact Font Format (CFF 1) reader: glyph names + Type 2 outlines.
 * CFF2 is not supported.
 *
 * @param {DataView} v
 * @param {number}   base  - offset of the `CFF ` table
 * @returns {{ names: string[], numGlyphs: number, path: (gid:number)=>string }}
 */
export function parseCFF(v, base) {
  const u8  = o => v.getUint8(o);
  const hdrSize = u8(base + 2);

  /** Read an INDEX at absolute offset; returns { items:[{off,len}], end }. */
  function index(o) {
    const count = u16(v, o);
    if (count === 0) return { items: [], end: o + 2 };
    const offSize = u8(o + 2);
    const rd = i => {
      let n = 0;
      for (let k = 0; k < offSize; k++) n = n * 256 + u8(o + 3 + i * offSize + k);
      return n;
    };
    const dataStart = o + 3 + (count + 1) * offSize - 1;
    const items = [];
    for (let i = 0; i < count; i++) {
      const a = rd(i), b = rd(i + 1);
      items.push({ off: dataStart + a, len: b - a });
    }
    return { items, end: dataStart + rd(count) };
  }

  /** Parse a DICT into Map<operator, number[]>. */
  function dict(o, len) {
    const m = new Map();
    let ops = [];
    const end = o + len;
    while (o < end) {
      const b = u8(o++);
      if (b <= 21) {
        let op = b;
        if (b === 12) op = 1200 + u8(o++);
        m.set(op, ops);
        ops = [];
      } else if (b === 28) { ops.push(v.getInt16(o, false)); o += 2; }
      else if (b === 29) { ops.push(v.getInt32(o, false)); o += 4; }
      else if (b === 30) {
        let s = '', done = false;
        while (!done && o < end) {
          const byte = u8(o++);
          for (const nib of [byte >> 4, byte & 15]) {
            if (nib === 15) { done = true; break; }
            s += nib < 10 ? nib : nib === 10 ? '.' : nib === 11 ? 'E' : nib === 12 ? 'E-' : nib === 14 ? '-' : '';
          }
        }
        ops.push(parseFloat(s) || 0);
      }
      else if (b >= 32 && b <= 246) ops.push(b - 139);
      else if (b >= 247 && b <= 250) ops.push((b - 247) * 256 + u8(o++) + 108);
      else if (b >= 251 && b <= 254) ops.push(-(b - 251) * 256 - u8(o++) - 108);
    }
    return m;
  }

  // ── top-level structure ──────────────────────────────────────────────────
  const nameIdx = index(base + hdrSize);
  const topIdx  = index(nameIdx.end);
  const strIdx  = index(topIdx.end);
  const gsubrIdx = index(strIdx.end);

  const top = dict(topIdx.items[0].off, topIdx.items[0].len);
  const csOff = top.get(17)?.[0];
  if (csOff === undefined) throw new Error('CFF: no CharStrings');
  const charStrings = index(base + csOff);
  const numGlyphs = charStrings.items.length;
  const isCID = top.has(1230);

  const sidString = sid => {
    if (sid < 391) return CFF_STD_STRINGS[sid];
    const it = strIdx.items[sid - 391];
    if (!it) return '';
    let s = '';
    for (let i = 0; i < it.len; i++) s += String.fromCharCode(u8(it.off + i));
    return s;
  };

  // ── charset → names ──────────────────────────────────────────────────────
  const names = new Array(numGlyphs).fill('');
  names[0] = '.notdef';
  const csetOff = top.get(15)?.[0] ?? 0;
  const sids = [0];
  if (csetOff === 0) {                     // ISOAdobe: SID === GID (0–228)
    for (let g = 1; g < numGlyphs; g++) sids.push(g);
  } else if (csetOff > 2) {
    let p = base + csetOff;
    const fmt = u8(p++);
    if (fmt === 0) {
      for (let g = 1; g < numGlyphs; g++) { sids.push(u16(v, p)); p += 2; }
    } else {
      while (sids.length < numGlyphs) {
        const first = u16(v, p); p += 2;
        let left;
        if (fmt === 1) left = u8(p++); else { left = u16(v, p); p += 2; }
        for (let k = 0; k <= left && sids.length < numGlyphs; k++) sids.push(first + k);
      }
    }
  }
  if (csetOff === 0 || csetOff > 2) {
    for (let g = 1; g < numGlyphs; g++) {
      names[g] = isCID ? `cid${sids[g]}` : (sidString(sids[g]) ?? '');
    }
  }

  // ── private dicts / subrs ────────────────────────────────────────────────
  function readPrivate(d) {
    const pv = d.get(18);
    if (!pv || pv.length < 2) return { subrs: [], defW: 0, nomW: 0 };
    const [size, off] = pv;
    const pd = dict(base + off, size);
    const so = pd.get(19)?.[0];
    return {
      subrs: so !== undefined ? index(base + off + so).items : [],
      defW:  pd.get(20)?.[0] ?? 0,
      nomW:  pd.get(21)?.[0] ?? 0,
    };
  }

  let privs = [], fdSelect = null;
  if (isCID && top.has(1236)) {
    const fdIdx = index(base + top.get(1236)[0]);
    privs = fdIdx.items.map(it => readPrivate(dict(it.off, it.len)));
    if (top.has(1237)) fdSelect = readFDSelect(base + top.get(1237)[0], numGlyphs);
  } else {
    privs = [readPrivate(top)];
  }

  function readFDSelect(p, n) {
    const fmt = u8(p++);
    const out = new Array(n).fill(0);
    if (fmt === 0) {
      for (let g = 0; g < n; g++) out[g] = u8(p + g);
    } else if (fmt === 3) {
      const nr = u16(v, p); p += 2;
      for (let r = 0; r < nr; r++) {
        const first = u16(v, p), fd = u8(p + 2), next = u16(v, p + 3);
        for (let g = first; g < next && g < n; g++) out[g] = fd;
        p += 3;
      }
    }
    return out;
  }

  const bias = n => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

  // ── Type 2 charstring interpreter (outline only) ─────────────────────────
  const r2 = n => Math.round(n * 100) / 100;

  function glyphPath(gid) {
    const it = charStrings.items[gid];
    if (!it) return '';
    const priv = privs[fdSelect ? (fdSelect[gid] ?? 0) : 0] ?? privs[0];
    const lsubrs = priv.subrs, gsubrs = gsubrIdx.items;
    const lb = bias(lsubrs.length), gb = bias(gsubrs.length);

    let d = '';
    let x = 0, y = 0, open = false;
    let stack = [];
    let nHints = 0, haveWidth = false, done = false;

    const move = (dx, dy) => {
      if (open) d += 'Z';
      x += dx; y += dy;
      d += `M${r2(x)} ${r2(-y)}`;
      open = true;
    };
    const line = (dx, dy) => { x += dx; y += dy; d += `L${r2(x)} ${r2(-y)}`; };
    const curve = (a, b, c, e, f, g) => {
      const x1 = x + a, y1 = y + b, x2 = x1 + c, y2 = y1 + e;
      x = x2 + f; y = y2 + g;
      d += `C${r2(x1)} ${r2(-y1)} ${r2(x2)} ${r2(-y2)} ${r2(x)} ${r2(-y)}`;
    };
    // Discard optional leading width argument.
    const width = (argsExpected) => {
      if (!haveWidth) {
        haveWidth = true;
        if (argsExpected === 'even' ? stack.length % 2 === 1 : stack.length > argsExpected) stack.shift();
      }
    };

    function run(o, len, depth) {
      if (depth > 10) return;
      const end = o + len;
      while (o < end && !done) {
        const b = u8(o++);
        if (b >= 32 || b === 28) {
          if (b === 28)            { stack.push(v.getInt16(o, false)); o += 2; }
          else if (b <= 246)       stack.push(b - 139);
          else if (b <= 250)       stack.push((b - 247) * 256 + u8(o++) + 108);
          else if (b <= 254)       stack.push(-(b - 251) * 256 - u8(o++) - 108);
          else                     { stack.push(v.getInt32(o, false) / 65536); o += 4; }
          continue;
        }
        switch (b) {
          case 1: case 3: case 18: case 23:            // stems
            width('even');
            nHints += stack.length >> 1; stack = []; break;
          case 19: case 20:                            // hintmask / cntrmask
            width('even');
            nHints += stack.length >> 1; stack = [];
            o += (nHints + 7) >> 3; break;
          case 21: width(2); move(stack[0] ?? 0, stack[1] ?? 0); stack = []; break;
          case 22: width(1); move(stack[0] ?? 0, 0); stack = []; break;
          case 4:  width(1); move(0, stack[0] ?? 0); stack = []; break;
          case 5:
            for (let i = 0; i + 1 < stack.length; i += 2) line(stack[i], stack[i + 1]);
            stack = []; break;
          case 6: case 7: {
            let horiz = b === 6;
            for (const a of stack) { horiz ? line(a, 0) : line(0, a); horiz = !horiz; }
            stack = []; break;
          }
          case 8:
            for (let i = 0; i + 5 < stack.length; i += 6)
              curve(stack[i], stack[i+1], stack[i+2], stack[i+3], stack[i+4], stack[i+5]);
            stack = []; break;
          case 24: {                                   // rcurveline
            let i = 0;
            for (; i + 6 <= stack.length - 2; i += 6)
              curve(stack[i], stack[i+1], stack[i+2], stack[i+3], stack[i+4], stack[i+5]);
            line(stack[i], stack[i + 1]);
            stack = []; break;
          }
          case 25: {                                   // rlinecurve
            let i = 0;
            for (; i + 2 <= stack.length - 6; i += 2) line(stack[i], stack[i + 1]);
            curve(stack[i], stack[i+1], stack[i+2], stack[i+3], stack[i+4], stack[i+5]);
            stack = []; break;
          }
          case 26: {                                   // vvcurveto
            let i = 0, dx1 = 0;
            if (stack.length % 4 === 1) dx1 = stack[i++];
            for (; i + 3 < stack.length; i += 4) {
              curve(dx1, stack[i], stack[i+1], stack[i+2], 0, stack[i+3]); dx1 = 0;
            }
            stack = []; break;
          }
          case 27: {                                   // hhcurveto
            let i = 0, dy1 = 0;
            if (stack.length % 4 === 1) dy1 = stack[i++];
            for (; i + 3 < stack.length; i += 4) {
              curve(stack[i], dy1, stack[i+1], stack[i+2], stack[i+3], 0); dy1 = 0;
            }
            stack = []; break;
          }
          case 30: case 31: {                          // vhcurveto / hvcurveto
            let horiz = b === 31, i = 0;
            while (i + 3 < stack.length) {
              const last = (stack.length - i === 5) ? stack[i + 4] : 0;
              if (horiz) curve(stack[i], 0, stack[i+1], stack[i+2], last, stack[i+3]);
              else       curve(0, stack[i], stack[i+1], stack[i+2], stack[i+3], last);
              horiz = !horiz; i += 4;
            }
            stack = []; break;
          }
          case 10: {                                   // callsubr
            const s = lsubrs[stack.pop() + lb];
            if (s) run(s.off, s.len, depth + 1);
            break;
          }
          case 29: {                                   // callgsubr
            const s = gsubrs[stack.pop() + gb];
            if (s) run(s.off, s.len, depth + 1);
            break;
          }
          case 11: return;                             // return
          case 14: width(0); done = true; break;       // endchar (seac not supported)
          case 12: {                                   // escape: flex family
            const s = stack, e = u8(o++);
            if (e === 35) {
              curve(s[0], s[1], s[2], s[3], s[4], s[5]);
              curve(s[6], s[7], s[8], s[9], s[10], s[11]);
            } else if (e === 34) {
              curve(s[0], 0, s[1], s[2], s[3], 0);
              curve(s[4], 0, s[5], -s[2], s[6], 0);
            } else if (e === 36) {
              curve(s[0], s[1], s[2], s[3], s[4], 0);
              curve(s[5], 0, s[6], s[7], s[8], -(s[1] + s[3] + s[7]));
            } else if (e === 37) {
              const sx = s[0] + s[2] + s[4] + s[6] + s[8];
              const sy = s[1] + s[3] + s[5] + s[7] + s[9];
              curve(s[0], s[1], s[2], s[3], s[4], s[5]);
              if (Math.abs(sx) > Math.abs(sy)) curve(s[6], s[7], s[8], s[9], s[10], -sy);
              else                             curve(s[6], s[7], s[8], s[9], -sx, s[10]);
            }
            stack = []; break;
          }
          default: stack = [];
        }
      }
    }

    run(it.off, it.len, 0);
    if (open) d += 'Z';
    return d;
  }

  return {
    names,
    numGlyphs,
    path: gid => { try { return glyphPath(gid); } catch { return ''; } },
  };
}
