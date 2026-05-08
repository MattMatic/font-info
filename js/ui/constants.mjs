// ── GSUB / GPOS lookup type names ──────────────────────────────────────────

export const GSUB_LNAMES = {
  1: 'Single', 2: 'Multiple', 3: 'Alternate', 4: 'Ligature',
  5: 'Context', 6: 'Chained context', 7: 'Ext. subst.', 8: 'Rev. chain single',
};
export const GPOS_LNAMES = {
  1: 'Single adjust', 2: 'Pair adjust', 3: 'Cursive attach',
  4: 'Mark-to-base', 5: 'Mark-to-ligature', 6: 'Mark-to-mark',
  7: 'Context pos.', 8: 'Chained context pos.', 9: 'Ext. pos.',
};

/** Lookup types that are contextual (rule-order-sensitive). */
export const CTX_GSUB = [5, 6];
export const CTX_GPOS = [7, 8];

// ── name table ──────────────────────────────────────────────────────────────

/** Human-readable labels for OpenType nameIDs (spec table 75). */
export const NAME_LABELS = {
  0:  'Copyright',
  1:  'Family name',
  2:  'Subfamily',
  3:  'Unique ID',
  4:  'Full name',
  5:  'Version',
  6:  'PostScript name',
  7:  'Trademark',
  8:  'Manufacturer',
  9:  'Designer',
  10: 'Description',
  11: 'Vendor URL',
  12: 'Designer URL',
  13: 'License',
  14: 'License URL',
  // 15 reserved
  16: 'Typographic family',
  17: 'Typographic subfamily',
  18: 'Compatible full (Mac)',
  19: 'Sample text',
  20: 'PostScript CID',
  21: 'WWS family',
  22: 'WWS subfamily',
  23: 'Light bg palette name',
  24: 'Dark bg palette name',
  25: 'Variations PS prefix',
};

/** Platform IDs used in the name table. */
export const PLAT = { 0: 'Unicode', 1: 'Mac', 2: 'ISO', 3: 'Windows' };

/** Common Windows language IDs → BCP-47 tag. */
export const WIN_LANG = {
  0x0409: 'en-US', 0x0809: 'en-GB', 0x0C09: 'en-AU',
  0x0407: 'de',    0x040C: 'fr',    0x0C0A: 'es',
  0x0411: 'ja',    0x0804: 'zh-Hans', 0x0404: 'zh-Hant', 0x0412: 'ko',
};

/** Common Mac language IDs → short tag. */
export const MAC_LANG = { 0: 'en', 1: 'fr', 2: 'de', 3: 'it', 33: 'ja' };

/**
 * NameIDs where editing makes sense across all fonts.
 * Excludes reserved ID 15 and platform-specific IDs above 25.
 */
export const EDITABLE_NIDS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 22,
]);

// ── table directory groupings ───────────────────────────────────────────────

export const TBL_GROUPS = {
  outline:   ['glyf', 'loca', 'CFF ', 'CFF2', 'cvt ', 'fpgm', 'prep', 'gasp'],
  layout:    ['GSUB', 'GPOS', 'GDEF', 'BASE', 'JSTF', 'MATH'],
  metrics:   ['hmtx', 'vmtx', 'hhea', 'vhea', 'OS/2', 'kern', 'HVAR', 'VVAR', 'MVAR'],
  names:     ['name', 'cmap', 'post', 'head'],
  color:     ['COLR', 'CPAL', 'CBDT', 'CBLC', 'sbix', 'SVG '],
  variation: ['fvar', 'gvar', 'avar', 'cvar', 'STAT'],
};

export const GRP_BADGE = {
  outline:   'b-blue',
  layout:    'b-amber',
  metrics:   'b-teal',
  names:     'b-gray',
  color:     'b-coral',
  variation: 'b-purple',
  other:     'b-gray',
};
