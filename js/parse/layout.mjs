import { u16 } from './binary.mjs';
import { GSUB_LNAMES, GPOS_LNAMES, CTX_GSUB, CTX_GPOS } from '../ui/constants.mjs';

// ── ScriptList parser ────────────────────────────────────────────────────────

/**
 * Read a 4-byte ASCII tag from a DataView, preserving trailing spaces so the
 * caller can decide whether to trim (script/lang tags are space-padded to 4).
 */
function readTag(v, off) {
  let s = '';
  for (let i = 0; i < 4; i++) s += String.fromCharCode(v.getUint8(off + i));
  return s;
}

/**
 * Parse one ScriptList table and return a Map<scriptTag, Set<langTag>>.
 *
 * ScriptList layout (OpenType spec §6.2):
 *   +0  uint16  scriptCount
 *   +2  ScriptRecord[n]  — each: char[4] scriptTag + uint16 scriptOffset
 *
 * Script table (relative to ScriptList base):
 *   +0  uint16  defaultLangSysOffset  (0 = absent)
 *   +2  uint16  langSysCount
 *   +4  LangSysRecord[n]  — each: char[4] langSysTag + uint16 langSysOffset
 *
 * We collect the raw 4-char tags including trailing spaces, then trim for
 * display. The default LangSys (no tag) is represented as 'dflt'.
 *
 * @param {DataView} v
 * @param {number}   listOff  - absolute offset of the ScriptList
 * @returns {Map<string, Set<string>>}  scriptTag → Set of langTags
 */
function parseScriptList(v, listOff) {
  const result      = new Map();
  const scriptCount = u16(v, listOff);

  for (let i = 0; i < scriptCount; i++) {
    const recOff    = listOff + 2 + i * 6;
    const scriptTag = readTag(v, recOff).trimEnd();
    const scriptOff = listOff + u16(v, recOff + 4);

    const langs = new Set();

    // Default LangSys — present when offset is non-zero.
    const defaultLSOff = u16(v, scriptOff);
    if (defaultLSOff !== 0) langs.add('dflt');

    // Named LangSys records.
    const lsCount = u16(v, scriptOff + 2);
    for (let j = 0; j < lsCount; j++) {
      const lsRecOff = scriptOff + 4 + j * 6;
      const langTag  = readTag(v, lsRecOff).trimEnd();
      langs.add(langTag);
    }

    // Merge into result — a script may theoretically appear in both
    // GSUB and GPOS ScriptLists (handled by mergeScriptMaps below).
    if (result.has(scriptTag)) {
      for (const l of langs) result.get(scriptTag).add(l);
    } else {
      result.set(scriptTag, langs);
    }
  }

  return result;
}

/**
 * Merge two script maps (from GSUB and GPOS), unioning the lang sets.
 * Returns a new Map sorted alphabetically by script tag, with each
 * lang set's entries sorted alphabetically (dflt always first).
 *
 * @param {Map|null} a
 * @param {Map|null} b
 * @returns {Map<string, string[]>}  scriptTag → sorted lang tag array
 */
export function mergeScriptMaps(a, b) {
  const merged = new Map();

  for (const map of [a, b]) {
    if (!map) continue;
    for (const [script, langs] of map) {
      if (!merged.has(script)) merged.set(script, new Set());
      for (const l of langs) merged.get(script).add(l);
    }
  }

  // Sort scripts alphabetically; within each script sort langs with dflt first.
  const sorted = new Map(
    [...merged.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([script, langs]) => [
        script,
        [...langs].sort((a, b) =>
          a === 'dflt' ? -1 : b === 'dflt' ? 1 : a.localeCompare(b)
        ),
      ])
  );

  return sorted;
}

// ── lookup list parser ───────────────────────────────────────────────────────

/**
 * Parse one LookupList table.
 *
 * @param {DataView} v
 * @param {number}   offset   - absolute offset of the LookupList table
 * @param {Object}   lnames   - {typeInt → human label}
 * @param {number[]} ctxTypes - lookup type numbers that are contextual
 * @returns {Object[]} array of lookup descriptors
 */
function parseLookups(v, offset, lnames, ctxTypes) {
  const count   = u16(v, offset);
  const lookups = [];

  for (let i = 0; i < count; i++) {
    const lOff     = offset + u16(v, offset + 2 + i * 2);
    const type     = u16(v, lOff);
    const flag     = u16(v, lOff + 2);
    const subCount = u16(v, lOff + 4);
    const isExt    = type === 7 || type === 9;
    const subs     = [];

    for (let s = 0; s < subCount; s++) {
      const sOff = lOff + u16(v, lOff + 6 + s * 2);
      let fmt = 0, detail = '';
      try { fmt = u16(v, sOff); } catch (_) { /* out of bounds — skip */ }

      if (ctxTypes.includes(type)) {
        // Approximate the number of rules so the user can gauge complexity.
        const cnt = fmt === 1 ? u16(v, sOff + 4)
                  : fmt === 2 ? u16(v, sOff + 6)
                  :             u16(v, sOff + 2);
        detail = `fmt${fmt} rules≈${cnt}`;
      }
      subs.push({ fmt, detail });
    }

    lookups.push({
      index:        i,
      type,
      isExt,
      name:         lnames[type] ?? `Type${type}`,
      flag,
      subCount,
      subs,
      isContextual: ctxTypes.includes(type),
    });
  }
  return lookups;
}

// ── GSUB / GPOS table parser ─────────────────────────────────────────────────

/**
 * Parse a GSUB or GPOS table header, its ScriptList, and its LookupList.
 * Returns null if `off` is falsy (table absent).
 */
export function parseLayoutTable(v, off, tag) {
  if (!off) return null;
  const major        = u16(v, off);
  const minor        = u16(v, off + 2);
  const scriptListOff = u16(v, off + 4);
  const scriptCount  = u16(v, off + scriptListOff);
  const featureCount = u16(v, off + u16(v, off + 6));
  const isGSUB       = tag === 'GSUB';

  return {
    tag, major, minor, scriptCount, featureCount,
    scriptMap: parseScriptList(v, off + scriptListOff),
    lookups: parseLookups(
      v,
      off + u16(v, off + 8),
      isGSUB ? GSUB_LNAMES : GPOS_LNAMES,
      isGSUB ? CTX_GSUB    : CTX_GPOS,
    ),
  };
}

// ── complexity score ─────────────────────────────────────────────────────────

/**
 * Heuristic 0–100 complexity score for GSUB+GPOS together.
 *
 * Weighting rationale:
 *  - Total lookup count drives base difficulty (capped at 40).
 *  - Contextual lookups add disproportionate weight (capped at 35) because
 *    rule ordering is semantically load-bearing — you cannot reorder or merge
 *    them without re-verifying correctness against the spec and every target
 *    shaper (HarfBuzz, Core Text, DirectWrite).
 *  - Extension lookups (type 7/9) indicate the font has already hit 16-bit
 *    offset limits internally; any rewrite must handle the extra indirection.
 *
 * @returns {{ score: number, reasons: string[] }}
 */
export function complexity(gsub, gpos) {
  const all   = [...(gsub ? gsub.lookups : []), ...(gpos ? gpos.lookups : [])];
  const ctx   = all.filter(l => l.isContextual).length;
  const total = all.length;

  let score = 0;
  score += Math.min(40, total * 0.8);
  score += Math.min(35, ctx   * 3.5);
  if (gsub) score += Math.min(15, gsub.lookups.filter(l => l.isExt).length * 2);
  if (gpos) score += Math.min(10, gpos.lookups.filter(l => l.isExt).length * 2);
  score = Math.min(100, Math.round(score));

  const reasons = [];
  if (total > 50)
    reasons.push(`Large lookup count (${total}) — deduplication may help`);
  if (ctx > 10)
    reasons.push(`Many contextual lookups (${ctx}) — rule ordering is load-bearing, hard to compress`);
  if (ctx === 0 && total > 0)
    reasons.push('No contextual lookups — subsetting and lookup merging would be straightforward');
  if (gsub && gsub.lookups.some(l => l.isExt))
    reasons.push('GSUB extension lookups — offsets must be recalculated after any reorder');
  if (gpos && gpos.lookups.some(l => l.isExt))
    reasons.push('GPOS extension lookups — same offset constraint applies');
  if (score < 25)
    reasons.push('Low overall complexity — good candidate for aggressive subsetting');

  return { score, reasons };
}
