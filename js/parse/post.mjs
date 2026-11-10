import { u16, u32 } from './binary.mjs';
import { MAC_GLYPH_NAMES } from './glyphNames.mjs';

/**
 * Read glyph names from the `post` table.
 *
 * @returns {string[]|null}  names indexed by GID, or null for format 3.0 / missing
 */
export function parsePostNames(v, off, len, numGlyphs) {
  const ver = u32(v, off);

  if (ver === 0x00010000) return MAC_GLYPH_NAMES.slice(0, numGlyphs);
  if (ver !== 0x00020000) return null;

  const n   = u16(v, off + 32);
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(u16(v, off + 34 + i * 2));

  // Pascal strings follow the index array.
  const strs = [];
  let p = off + 34 + n * 2;
  const end = off + len;
  while (p < end) {
    const l = v.getUint8(p++);
    let s = '';
    for (let i = 0; i < l && p + i < end; i++) s += String.fromCharCode(v.getUint8(p + i));
    strs.push(s);
    p += l;
  }

  const names = [];
  for (let g = 0; g < numGlyphs; g++) {
    const i = idx[g];
    if (i === undefined) { names.push(''); continue; }
    names.push(i < 258 ? MAC_GLYPH_NAMES[i] : (strs[i - 258] ?? ''));
  }
  return names;
}
