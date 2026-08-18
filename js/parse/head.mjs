import { u16, u32 } from './binary.mjs';

// ── Fixed 16.16 ──────────────────────────────────────────────────────────────

/**
 * Convert an OpenType Fixed 16.16 uint32 to a display string with 3 decimal
 * places. The integer part is the top 16 bits; fractional is bottom 16 bits.
 * e.g. 0x00020042 → "2.001"
 */
export function fixedToString(raw) {
  const integer  = raw >>> 16;
  const fraction = (raw & 0xFFFF) / 65536;
  return (integer + fraction).toFixed(3);
}

/**
 * Parse a decimal string (e.g. "2.001") into a Fixed 16.16 uint32.
 * Returns null if the input is not a valid version number.
 */
export function stringToFixed(s) {
  const f = parseFloat(s);
  if (!isFinite(f) || f < 0) return null;
  const integer  = Math.floor(f);
  const fraction = Math.round((f - integer) * 65536);
  return ((integer & 0xFFFF) << 16) | (fraction & 0xFFFF);
}

// ── macStyle bitmask ──────────────────────────────────────────────────────────

const MACSTYLE_FLAGS = [
  [0, 'Bold'], [1, 'Italic'], [2, 'Underline'], [3, 'Outline'],
  [4, 'Shadow'], [5, 'Condensed'], [6, 'Extended'],
];

export function macStyleFlags(bits) {
  const active = MACSTYLE_FLAGS.filter(([bit]) => bits & (1 << bit)).map(([, name]) => name);
  return active.length ? active : ['(none)'];
}

// ── LONGDATETIME ─────────────────────────────────────────────────────────────

// OpenType LONGDATETIME: seconds since 1904-01-01 00:00:00 UTC.
// JS Date uses milliseconds since 1970-01-01; offset = 2082844800 seconds.
const MAC_EPOCH_DELTA_S = 2_082_844_800n;

export function longDateTimeToISO(v, off) {
  // Stored as a signed 64-bit big-endian integer. We read as two uint32s.
  const hi = BigInt(v.getUint32(off,     false));
  const lo = BigInt(v.getUint32(off + 4, false));
  const secs = (hi << 32n) | lo;
  const ms = Number(secs - MAC_EPOCH_DELTA_S) * 1000;
  const d = new Date(ms);
  if (isNaN(d)) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ── main parser ───────────────────────────────────────────────────────────────

/**
 * Parse all meaningful fields from the `head` table.
 * Returns null if the table is absent.
 *
 * head table layout (OpenType spec §5.2.8):
 *   +0   uint16  majorVersion  (always 1)
 *   +2   uint16  minorVersion  (always 0)
 *   +4   Fixed   fontRevision            (4 bytes)
 *   +8   uint32  checkSumAdjustment      (4 bytes)
 *   +12  uint32  magicNumber  0x5F0F3CF5 (4 bytes)
 *   +16  uint16  flags                   (2 bytes)
 *   +18  uint16  unitsPerEm              (2 bytes)
 *   +20  LONGDATETIME  created           (8 bytes)
 *   +28  LONGDATETIME  modified          (8 bytes)
 *   +36  int16   xMin
 *   +38  int16   yMin
 *   +40  int16   xMax
 *   +42  int16   yMax
 *   +44  uint16  macStyle
 *   +46  uint16  lowestRecPPEM
 *   +48  int16   fontDirectionHint  (deprecated)
 *   +50  int16   indexToLocFormat   (0=short, 1=long)
 *   +52  int16   glyphDataFormat
 */
export function parseHead(v, off) {
  if (!off) return null;

  const revRaw      = u32(v, off + 4);
  const macStyleRaw = u16(v, off + 44);

  return {
    fontRevisionRaw: revRaw,
    fontRevision:    fixedToString(revRaw),
    unitsPerEm:      u16(v, off + 18),
    created:         longDateTimeToISO(v, off + 20),
    modified:        longDateTimeToISO(v, off + 28),
    xMin:            v.getInt16(off + 36, false),
    yMin:            v.getInt16(off + 38, false),
    xMax:            v.getInt16(off + 40, false),
    yMax:            v.getInt16(off + 42, false),
    macStyleRaw,
    macStyleFlags:   macStyleFlags(macStyleRaw),
    lowestRecPPEM:   u16(v, off + 46),
    indexToLocFormat: u16(v, off + 50) === 0 ? 'short (16-bit)' : 'long (32-bit)',
  };
}

// ── version sync ──────────────────────────────────────────────────────────────

/**
 * Given the current fontRevision display string and the resolved name table
 * {nid → value} map, find which name records contain the version number as a
 * substring and return an object describing the sync state.
 *
 * We search nameIDs 5 (Version string) and 3 (Unique ID) only, matching
 * the exact decimal string produced by fixedToString().
 *
 * @returns {{
 *   currentStr: string,   // e.g. "2.001"
 *   matches: Array<{nid, label, originalValue, matchStart, matchEnd}>
 * }}
 */
export function detectVersionSync(headInfo, names) {
  if (!headInfo) return { currentStr: '', matches: [] };

  const needle = headInfo.fontRevision;
  const targets = [
    { nid: 5, label: 'name ID 5 (Version)' },
    { nid: 3, label: 'name ID 3 (Unique ID)' },
  ];

  const matches = [];
  for (const { nid, label } of targets) {
    const val = names[nid];
    if (!val) continue;
    const idx = val.indexOf(needle);
    if (idx === -1) continue;
    matches.push({ nid, label, originalValue: val, matchStart: idx, matchEnd: idx + needle.length });
  }

  return { currentStr: needle, matches };
}

/**
 * Apply a new version string to the pending name edits and return the new
 * fixed value. Does not write any bytes — that happens at download time.
 *
 * @param {Object}   syncInfo    - result of detectVersionSync()
 * @param {string}   newVerStr   - user-entered version string, e.g. "2.002"
 * @param {Object}   nameEdits   - mutable {nid: string} edits object (mutated in-place)
 * @returns {number|null}        - new Fixed 16.16 uint32, or null if invalid input
 */
export function applyVersionSync(syncInfo, newVerStr, nameEdits) {
  const newFixed = stringToFixed(newVerStr.trim());
  if (newFixed === null) return null;

  const newStr = fixedToString(newFixed); // canonical display form

  for (const m of syncInfo.matches) {
    const updated = m.originalValue.slice(0, m.matchStart)
                  + newStr
                  + m.originalValue.slice(m.matchEnd);
    nameEdits[m.nid] = updated;
  }

  return newFixed;
}
