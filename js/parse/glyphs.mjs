import { u16 }            from './binary.mjs';
import { parseCmap }      from './cmap.mjs';
import { parsePostNames } from './post.mjs';
import { parseCFF }       from './cff.mjs';
import { makeGlyfReader } from './glyf.mjs';
import { parseGlyphClasses, parseAdvances } from './metrics.mjs';

/**
 * Gather everything the glyph view needs: GID count, names, cmap reverse map
 * and a lazy outline → SVG-path function.
 *
 * @returns {Object|null}  null if the font has no maxp table
 */
export function readGlyphs(v, tablesRaw, headInfo) {
  if (!tablesRaw['maxp']) return null;
  let numGlyphs = u16(v, tablesRaw['maxp'].off + 4);

  let names = null;
  let rawPath = null;
  let kind = null;
  const notes = [];

  if (tablesRaw['CFF']) {
    try {
      const cff = parseCFF(v, tablesRaw['CFF'].off);
      names   = cff.names;
      rawPath = cff.path;
      kind    = 'CFF';
      numGlyphs = Math.max(numGlyphs, cff.numGlyphs);
    } catch (e) { notes.push('CFF parse failed: ' + e.message); }
  } else if (tablesRaw['glyf'] && tablesRaw['loca'] && headInfo) {
    const long = v.getInt16(tablesRaw['head'].off + 50, false) === 1;
    rawPath = makeGlyfReader(v, tablesRaw['glyf'].off, tablesRaw['loca'].off, long, numGlyphs);
    kind    = 'glyf';
  } else if (tablesRaw['CFF2']) {
    notes.push('CFF2 outlines are not supported');
  }

  // post names override nothing in CFF fonts, but fill in if CFF has none.
  if (!names && tablesRaw['post']) {
    try {
      names = parsePostNames(v, tablesRaw['post'].off, tablesRaw['post'].len, numGlyphs);
    } catch { /* ignore */ }
  }

  let cmap = { byGid: new Map(), count: 0 };
  if (tablesRaw['cmap']) {
    try { cmap = parseCmap(v, tablesRaw['cmap'].off); }
    catch { notes.push('cmap parse failed'); }
  }

  let classes = null, advances = null;
  if (tablesRaw['GDEF']) {
    try { classes = parseGlyphClasses(v, tablesRaw['GDEF'].off, numGlyphs); } catch { /* ignore */ }
  }
  if (tablesRaw['hmtx'] && tablesRaw['hhea']) {
    try { advances = parseAdvances(v, tablesRaw['hmtx'].off, tablesRaw['hhea'].off, numGlyphs); } catch { /* ignore */ }
  }

  const cache = new Map();
  const pathOf = gid => {
    if (!rawPath) return null;
    let p = cache.get(gid);
    if (p === undefined) { p = rawPath(gid); cache.set(gid, p); }
    return p;
  };

  return {
    numGlyphs,
    names,                       // string[] | null
    byGid: cmap.byGid,           // Map<gid, number[]>
    mappedGlyphs: cmap.byGid.size,
    codePoints: cmap.count,
    classes,                     // Uint8Array | null  (GDEF: 1 base, 2 lig, 3 mark, 4 comp)
    advances,                    // Uint16Array | null (hmtx advance widths)
    kind,                        // 'glyf' | 'CFF' | null
    notes,
    pathOf,
  };
}
