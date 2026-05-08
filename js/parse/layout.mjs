import { u16 } from './binary.mjs';
import { GSUB_LNAMES, GPOS_LNAMES, CTX_GSUB, CTX_GPOS } from '../ui/constants.mjs';

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
 * Parse a GSUB or GPOS table header plus its LookupList.
 * Returns null if `off` is falsy (table absent).
 */
export function parseLayoutTable(v, off, tag) {
  if (!off) return null;
  const major        = u16(v, off);
  const minor        = u16(v, off + 2);
  const scriptCount  = u16(v, off + u16(v, off + 4));
  const featureCount = u16(v, off + u16(v, off + 6));
  const isGSUB       = tag === 'GSUB';

  return {
    tag, major, minor, scriptCount, featureCount,
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
