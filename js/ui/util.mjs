import {
  NAME_LABELS, PLAT, WIN_LANG, MAC_LANG, TBL_GROUPS, GRP_BADGE,
} from './constants.mjs';

// ── formatting ──────────────────────────────────────────────────────────────

export function fmtBytes(n) {
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(2) + ' MB';
  if (n >= 1_024)     return (n / 1_024).toFixed(1) + ' KB';
  return n + ' B';
}

export function fmtNum(n) { return n.toLocaleString(); }

/** HTML-escape a string so it is safe to inject into innerHTML. */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── label helpers ───────────────────────────────────────────────────────────

export function nameLabel(id) {
  return NAME_LABELS[id] ?? (id >= 256 ? `User (${id})` : `Name ${id}`);
}

export function langLabel(pid, lid) {
  if (pid === 3) return WIN_LANG[lid] ?? `0x${lid.toString(16)}`;
  if (pid === 1) return MAC_LANG[lid] ?? String(lid);
  return String(lid);
}

export function platLabel(pid) { return PLAT[pid] ?? `Plat${pid}`; }

export function tblGroup(tag) {
  for (const [g, tags] of Object.entries(TBL_GROUPS)) {
    if (tags.includes(tag)) return g;
  }
  return 'other';
}

export function tblGroupBadge(tag) { return GRP_BADGE[tblGroup(tag)]; }

// ── lookup badge class ──────────────────────────────────────────────────────

export function badgeCls(type, isGSUB) {
  const ctx = isGSUB ? [5, 6] : [7, 8];
  if (ctx.includes(type))        return 'b-amber';
  if (type === 4 || type === 6)  return 'b-teal';
  if (type === 1 || type === 2)  return 'b-blue';
  if (type >= 7)                 return 'b-purple';
  return 'b-gray';
}
