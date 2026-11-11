import { u16 } from './binary.mjs';

/**
 * GDEF GlyphClassDef → per-GID class value.
 *   1 Base, 2 Ligature, 3 Mark, 4 Component (0 / undefined = unclassified)
 *
 * @returns {Uint8Array|null}  null if there is no GDEF or no GlyphClassDef
 */
export function parseGlyphClasses(v, off, numGlyphs) {
  const classOff = u16(v, off + 4);
  if (!classOff) return null;

  const out = new Uint8Array(numGlyphs);
  const o   = off + classOff;
  const fmt = u16(v, o);

  if (fmt === 1) {
    const start = u16(v, o + 2), n = u16(v, o + 4);
    for (let i = 0; i < n; i++) {
      const g = start + i;
      if (g < numGlyphs) out[g] = u16(v, o + 6 + i * 2);
    }
  } else if (fmt === 2) {
    const n = u16(v, o + 2);
    for (let i = 0; i < n; i++) {
      const s = u16(v, o + 4 + i * 6), e = u16(v, o + 6 + i * 6), c = u16(v, o + 8 + i * 6);
      for (let g = s; g <= e && g < numGlyphs; g++) out[g] = c;
    }
  } else return null;

  return out;
}

/**
 * hmtx → per-GID advance width (font units).
 * Glyphs past numberOfHMetrics reuse the last advance.
 *
 * @returns {Uint16Array|null}
 */
export function parseAdvances(v, hmtxOff, hheaOff, numGlyphs) {
  const nm = u16(v, hheaOff + 34);
  if (!nm) return null;
  const out = new Uint16Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < nm) last = u16(v, hmtxOff + g * 4);
    out[g] = last;
  }
  return out;
}
