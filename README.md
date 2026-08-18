# OpenType Font Analyzer

A browser-based tool for analysing TTF / OTF font files. Everything runs
client-side — no font data is uploaded anywhere.

**LIVE** https://mattmatic.github.io/font-info/

> Written by Claude

## Features

- Font identity: name, version, file size, table count
- **Name table viewer**: all records with platformID / languageID detail
- **Name table editor**: edit any string field and download the patched font
- Table sizes: sortable breakdown of every table in bytes and % of file
- GSUB / GPOS lookup distribution and contextual lookup detail
- Optimization complexity score with explanatory notes

## Running locally

ES modules require an HTTP origin — the `file://` protocol won't work.
Any static file server will do:

```bash
# Python (stdlib)
python3 -m http.server 8080

# Node / npx
npx serve .

# Deno
deno run --allow-net --allow-read https://deno.land/std/http/file_server.ts
```

Then open <http://localhost:8080> in your browser.

## Module structure

```
font-analyzer/
├── index.html            # Page shell — no inline JS or CSS
├── css/
│   └── main.css          # All styles
└── js/
    ├── main.mjs          # Entry point: file drop, render orchestration, state
    ├── parse/
    │   ├── binary.mjs    # DataView helpers (u16, u32, tableChecksum …)
    │   ├── font.mjs      # analyzeFont — table directory + sub-parser dispatch
    │   ├── head.mjs      # head table parser, Fixed 16.16 helpers, version sync logic
    │   ├── names.mjs     # name table read, rebuild, and font patching
    │   └── layout.mjs    # GSUB/GPOS lookup parser + complexity scorer
    └── ui/
        ├── constants.mjs # Lookup names, nameID labels, platform maps, groups
        ├── util.mjs      # fmtBytes, esc, nameLabel, langLabel, badgeCls …
        ├── sections.mjs  # HTML renderers for identity, sizes, layout sections
        ├── headUI.mjs    # head accordion: field display + version sync panel
        └── namesUI.mjs   # name accordion body HTML + all editor event wiring
```

## Notes on the name table editor

Edits are applied to **all** records for a given nameID (Windows UTF-16BE
and Mac Roman platforms). The font binary is rebuilt with:

1. A freshly encoded name table (same record count and order).
2. Updated table directory checksum and length for `name`.
3. Offset adjustments for all tables that follow `name` in the file if
   the table size changed.
4. The `head` table's `checkSumAdjustment` field is zeroed. This is the
   same behaviour as fonttools/pyftsubset. HarfBuzz, Core Text, and
   DirectWrite all accept zeroed values here at runtime.

**PostScript name (ID 6)** must be ASCII-only, no spaces, characters
restricted to `!`–`~` excluding `%()/<>[]{}`. The editor does not
validate this — invalid PS names won't crash the font but may affect
PDF embedding or PostScript workflows.
