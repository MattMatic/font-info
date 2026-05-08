// Low-level DataView helpers — all OpenType multi-byte values are big-endian.

export const u16 = (v, o) => v.getUint16(o, false);
export const u32 = (v, o) => v.getUint32(o, false);
export const s16 = (v, o, n) => v.setUint16(o, n, false);
export const s32 = (v, o, n) => v.setUint32(o, n, false);

/** Read a 4-byte ASCII tag, trimming trailing spaces (e.g. 'CFF '→'CFF'). */
export function str4(v, o) {
  let s = '';
  for (let i = 0; i < 4; i++) s += String.fromCharCode(v.getUint8(o + i));
  return s.trimEnd();
}

/**
 * OpenType per-table checksum: unsigned 32-bit sum of all big-endian uint32
 * words in the table, zero-padding the last word if the length isn't a
 * multiple of 4.
 */
export function tableChecksum(ab, off, len) {
  const v = new DataView(ab);
  const aligned = (len + 3) & ~3;
  let sum = 0;
  for (let i = 0; i < aligned; i += 4) {
    const w = (off + i + 3 < ab.byteLength) ? v.getUint32(off + i, false) : 0;
    sum = (sum + w) >>> 0;
  }
  return sum;
}
