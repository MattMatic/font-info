import { u16, u32, str4 }              from './binary.mjs';
import { readAllNames, readNamesSimple } from './names.mjs';
import { parseLayoutTable }              from './layout.mjs';

/**
 * Parse an OpenType/TrueType font file and return a structured result object.
 *
 * @param {ArrayBuffer} buf       - raw font bytes
 * @param {string}      fileName  - original filename, used as download hint
 * @returns {Object} result
 *
 * Supported sfntVersion values:
 *   0x00010000  TrueType / OpenType with TrueType outlines
 *   0x4F54544F  ('OTTO') OpenType with CFF outlines
 *   0x74727565  ('true') Apple TrueType
 *   0x74797031  ('typ1') Apple Type 1 (rare; parse proceeds)
 */
export function analyzeFont(buf, fileName) {
  const v    = new DataView(buf);
  const sfnt = u32(v, 0);

  if (![0x00010000, 0x4F54544F, 0x74727565, 0x74797031].includes(sfnt)) {
    throw new Error(
      `Unsupported format (sfntVersion: 0x${sfnt.toString(16).padStart(8, '0')}). ` +
      'Load a TTF or OTF file.'
    );
  }

  // ── table directory ──────────────────────────────────────────────────────
  const numTbls  = u16(v, 4);
  const tablesRaw = {};

  for (let i = 0; i < numTbls; i++) {
    const tag = str4(v, 12 + i * 16);
    const off = u32(v, 12 + i * 16 + 8);
    const len = u32(v, 12 + i * 16 + 12);
    tablesRaw[tag] = { off, len };
  }

  // ── name table ───────────────────────────────────────────────────────────
  let nameRecs = [], names = {};
  if (tablesRaw['name']) {
    nameRecs = readAllNames(v, tablesRaw['name'].off);
    names    = readNamesSimple(v, tablesRaw['name'].off);
  }

  // ── head table (version string fallback) ────────────────────────────────
  let headVer = '';
  if (tablesRaw['head']) {
    const hOff = tablesRaw['head'].off;
    const maj  = v.getInt16(hOff + 4, false);
    const min  = v.getUint16(hOff + 6, false);
    headVer    = `${maj}.${min}`;
  }

  // ── layout tables ────────────────────────────────────────────────────────
  const gsub = tablesRaw['GSUB']
    ? parseLayoutTable(v, tablesRaw['GSUB'].off, 'GSUB')
    : null;
  const gpos = tablesRaw['GPOS']
    ? parseLayoutTable(v, tablesRaw['GPOS'].off, 'GPOS')
    : null;

  return {
    names,
    nameRecs,
    headVer,
    tablesRaw,
    gsub,
    gpos,
    fileSize: buf.byteLength,
    fileName,
    origBuf:  buf,
  };
}
