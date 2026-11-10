import { esc, fmtNum } from './util.mjs';

const PAGE_SIZE = 100;      // list view rows per page
const GRID_COLS = 10;       // grid view glyphs per row
const GRID_ROWS = 20;       // grid view rows per page

// ── helpers ───────────────────────────────────────────────────────────────────

const uHex = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

/** Printable representation of a code point, or '' for controls/surrogates. */
function charOf(cp) {
  if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F) || (cp >= 0xD800 && cp <= 0xDFFF) || cp > 0x10FFFF) return '';
  return String.fromCodePoint(cp);
}

/** SVG viewBox string from the head bounding box (shared by every glyph). */
function viewBoxOf(headInfo) {
  let { xMin, yMin, xMax, yMax, unitsPerEm: upm } = headInfo || {};
  if (!(xMax > xMin) || !(yMax > yMin)) { xMin = 0; xMax = upm || 1000; yMin = -(upm || 1000) * 0.25; yMax = (upm || 1000) * 0.9; }
  const pad = (yMax - yMin) * 0.04;
  return { x: xMin - pad, y: -yMax - pad, w: xMax - xMin + pad * 2, h: yMax - yMin + pad * 2 };
}

function glyphSVG(d, vb, size) {
  if (d === null) {
    return `<span class="gl-none" style="width:${size}px;height:${size}px" title="Outlines not available">?</span>`;
  }
  // Baseline (y = 0, red) and vertical origin (x = 0, dotted) + glyph outline.
  return `<svg class="gl-svg" width="${size}" height="${size}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <line x1="${vb.x}" x2="${vb.x + vb.w}" y1="0" y2="0" class="gl-base" vector-effect="non-scaling-stroke"/>
    <line x1="0" x2="0" y1="${vb.y}" y2="${vb.y + vb.h}" class="gl-origin" vector-effect="non-scaling-stroke"/>
    <path d="${d}" fill="currentColor" fill-rule="nonzero"/>
  </svg>`;
}

/** Large preview + full detail; used by the click-to-expand row and the hover popover. */
function previewHTML(g, r, vb) {
  const all = r.cps.map(cp =>
    `<span class="badge b-purple" style="margin:0 4px 4px 0">${uHex(cp)}${charOf(cp) ? ' ' + esc(charOf(cp)) : ''}</span>`
  ).join('') || '<span style="color:#999;font-size:12px">Not reachable via cmap (e.g. GSUB-only glyph)</span>';
  return `
    <div class="gl-detail-in">
      ${glyphSVG(g.pathOf(r.gid), vb, 160)}
      <div>
        <div style="font-size:12px;color:#666;margin-bottom:6px">GID <span class="mono" style="color:#1a1a1a">${r.gid}</span>
          &middot; name <span class="mono" style="color:#1a1a1a">${r.name ? esc(r.name) : '—'}</span></div>
        <div style="font-size:12px;color:#666;margin-bottom:4px">Unicode (cmap)</div>
        <div>${all}</div>
      </div>
    </div>`;
}

/** Single shared hover popover, positioned beside the pointer. */
function popover() {
  let el = document.getElementById('gl-pop');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gl-pop';
    el.className = 'gl-pop';
    document.body.appendChild(el);
  }
  return el;
}

function placePopover(el, e) {
  const m = 16, w = el.offsetWidth, h = el.offsetHeight;
  let x = e.clientX + m, y = e.clientY + m;
  if (x + w > innerWidth - 8)  x = Math.max(8, e.clientX - w - m);
  if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
}

// ── body ──────────────────────────────────────────────────────────────────────

function buildRows(g) {
  const rows = new Array(g.numGlyphs);
  for (let gid = 0; gid < g.numGlyphs; gid++) {
    rows[gid] = { gid, name: g.names?.[gid] ?? '', cps: g.byGid.get(gid) ?? [] };
  }
  return rows;
}

function matches(row, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  if (row.name.toLowerCase().includes(s)) return true;
  if (String(row.gid) === s) return true;
  const hex = s.replace(/^u\+?/, '');
  if (/^[0-9a-f]+$/.test(hex) && row.cps.some(cp => cp.toString(16).includes(hex))) return true;
  // single typed character
  const cp = [...q][0]?.codePointAt(0);
  return [...q].length === 1 && row.cps.includes(cp);
}

/**
 * Render the glyph list body and wire its controls.
 *
 * @param {Object} g        - result of readGlyphs()
 * @param {Object} headInfo
 * @param {Object} state    - { q, filter, page, open:Set<gid> } mutated in place
 */
export function wireGlyphsBody(g, headInfo, state) {
  const body = document.getElementById('glyphs-body');
  if (!body) return;
  if (!g) {
    body.innerHTML = '<div style="padding:1rem;font-size:13px;color:#666">No glyph data (missing <code>maxp</code> table).</div>';
    return;
  }

  const vb = viewBoxOf(headInfo);
  const all = state.rows ?? (state.rows = buildRows(g));

  const isMatch = r =>
    (state.filter === 'mapped'   ? r.cps.length > 0 :
     state.filter === 'unmapped' ? r.cps.length === 0 : true) && matches(r, state.q);
  const filtered = all.filter(isMatch);
  const grid = state.view === 'grid';

  // List pages over the filtered rows; grid pages over the full GID range so
  // each row keeps its GID alignment (non-matching cells are dimmed).
  const perPage = grid ? GRID_COLS * GRID_ROWS : PAGE_SIZE;
  const total   = grid ? g.numGlyphs : filtered.length;
  const pages   = Math.max(1, Math.ceil(total / perPage));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * perPage;
  const slice = filtered.slice(start, start + perPage);
  const shown = grid ? Math.min(perPage, total - start) : slice.length;

  let gridHTML = '';
  if (grid) {
    const filtering = !!state.q || state.filter !== 'all';
    let head = '<th class="gl-rh" style="cursor:default">GID</th>';
    for (let c = 0; c < GRID_COLS; c++) head += `<th class="gl-ch" style="cursor:default">+${c}</th>`;
    let trs = '';
    for (let rs = start; rs < Math.min(start + perPage, g.numGlyphs); rs += GRID_COLS) {
      let tds = `<td class="gl-rh num">${rs}</td>`;
      for (let c = 0; c < GRID_COLS; c++) {
        const gid = rs + c;
        if (gid >= g.numGlyphs) { tds += '<td class="gl-gcell gl-empty"></td>'; continue; }
        const dim = filtering && !isMatch(all[gid]);
        tds += `<td class="gl-gcell${dim ? ' dim' : ''}${state.sel === gid ? ' sel' : ''}" data-gid="${gid}">${glyphSVG(g.pathOf(gid), vb, 44)}</td>`;
      }
      trs += `<tr>${tds}</tr>`;
    }
    gridHTML = `<table class="gl-tbl gl-grid"><thead><tr>${head}</tr></thead><tbody>${trs}</tbody></table>`;
  }

  let rows = '';
  for (const r of grid ? [] : slice) {
    const open = state.open.has(r.gid);
    const uni = r.cps.length === 0
      ? '<span style="color:#bbb">—</span>'
      : r.cps.slice(0, 2).map(cp =>
          `<span class="gl-uni"><span class="mono">${uHex(cp)}</span>` +
          (charOf(cp) ? ` <span class="gl-char">${esc(charOf(cp))}</span>` : '') + '</span>'
        ).join('') +
        (r.cps.length > 2 ? ` <span class="badge b-gray" style="margin-left:4px">+${r.cps.length - 2}</span>` : '');
    rows += `
      <tr class="gl-row${open ? ' open' : ''}" data-gid="${r.gid}">
        <td class="gl-cell">${glyphSVG(g.pathOf(r.gid), vb, 40)}</td>
        <td class="num" style="width:70px">${r.gid}</td>
        <td class="mono">${r.name ? esc(r.name) : '<span style="color:#ccc">—</span>'}</td>
        <td>${uni}</td>
      </tr>`;
    if (open) {
      rows += `<tr class="gl-detail"><td colspan="4">${previewHTML(g, r, vb)}</td></tr>`;
    }
  }

  const info =
    `${fmtNum(g.numGlyphs)} glyphs &middot; ${fmtNum(g.mappedGlyphs)} mapped via cmap` +
    (g.names ? '' : ' &middot; no glyph names') +
    (g.kind === null ? ' &middot; no outlines' : '') +
    (g.notes.length ? ` &middot; <span style="color:#8a5c00">${esc(g.notes.join('; '))}</span>` : '');

  body.innerHTML = `
    <div class="names-toolbar">
      <span class="names-info">${info}</span>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="search" id="gl-q" class="gl-q" placeholder="Name, GID, U+0041 or character"
               value="${esc(state.q)}" spellcheck="false">
        <span class="gl-seg">
          <button id="gl-v-grid" class="${grid ? 'pri' : ''}">Grid</button>
          <button id="gl-v-list" class="${grid ? '' : 'pri'}">List</button>
        </span>
        <select id="gl-filter" class="gl-sel">
          <option value="all"${state.filter === 'all' ? ' selected' : ''}>All glyphs</option>
          <option value="mapped"${state.filter === 'mapped' ? ' selected' : ''}>Mapped</option>
          <option value="unmapped"${state.filter === 'unmapped' ? ' selected' : ''}>Unmapped</option>
        </select>
      </div>
    </div>
    ${grid && state.sel !== null && all[state.sel]
      ? `<div class="gl-sel-panel">${previewHTML(g, all[state.sel], vb)}</div>` : ''}
    <div style="overflow-x:auto">
      ${grid ? gridHTML : `<table class="gl-tbl">
        <thead><tr>
          <th style="width:56px;cursor:default">Glyph</th>
          <th style="cursor:default">GID</th>
          <th style="cursor:default">Name</th>
          <th style="cursor:default">Unicode</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="padding:1rem;color:#888">No matching glyphs.</td></tr>'}</tbody>
      </table>`}
    </div>
    <div class="names-toolbar" style="border-top:0.5px solid #e0e0d8;border-bottom:none">
      <span class="names-info">${total
        ? `${start}–${start + shown - 1}${grid ? ` (GID) of ${fmtNum(total)}` : ` of ${fmtNum(total)}`}${grid && (state.q || state.filter !== 'all') ? ` &middot; ${fmtNum(filtered.length)} match` : ''}`
        : '0 results'}</span>
      <div style="display:flex;gap:6px">
        <button id="gl-prev"${state.page === 0 ? ' disabled' : ''}>&lsaquo; Prev</button>
        <span class="names-info" style="align-self:center">Page ${state.page + 1} / ${pages}</span>
        <button id="gl-next"${state.page >= pages - 1 ? ' disabled' : ''}>Next &rsaquo;</button>
      </div>
    </div>`;

  const rerender = () => wireGlyphsBody(g, headInfo, state);

  const q = body.querySelector('#gl-q');
  q.addEventListener('input', () => {
    state.q = q.value.trim();
    state.page = 0;
    const pos = q.selectionStart;
    rerender();
    const nq = document.getElementById('gl-q');
    nq.focus(); nq.setSelectionRange(pos, pos);
  });
  body.querySelector('#gl-filter').addEventListener('change', e => {
    state.filter = e.target.value; state.page = 0; rerender();
  });
  body.querySelector('#gl-v-grid').addEventListener('click', () => { state.view = 'grid'; state.page = 0; rerender(); });
  body.querySelector('#gl-v-list').addEventListener('click', () => { state.view = 'list'; state.page = 0; rerender(); });
  body.querySelector('#gl-prev').addEventListener('click', () => { state.page--; rerender(); });
  body.querySelector('#gl-next').addEventListener('click', () => { state.page++; rerender(); });
  // Hover popover (large view). Rebuilt rows invalidate it, so hide first.
  const pop = popover();
  pop.style.display = 'none';
  const tbody = body.querySelector('tbody');
  let hoverGid = null;
  tbody.addEventListener('mousemove', e => {
    const tr = e.target.closest('[data-gid]');
    if (!tr || (!grid && state.open.has(Number(tr.dataset.gid)))) { pop.style.display = 'none'; hoverGid = null; return; }
    const gid = Number(tr.dataset.gid);
    if (gid !== hoverGid) {
      hoverGid = gid;
      pop.innerHTML = previewHTML(g, all[gid], vb);
    }
    pop.style.display = 'block';
    placePopover(pop, e);
  });
  tbody.addEventListener('mouseleave', () => { pop.style.display = 'none'; hoverGid = null; });

  tbody.addEventListener('click', e => {
    const tr = e.target.closest('[data-gid]');
    if (!tr) return;
    const gid = Number(tr.dataset.gid);
    if (grid) state.sel = state.sel === gid ? null : gid;   // pinned detail panel
    else state.open.has(gid) ? state.open.delete(gid) : state.open.add(gid);
    rerender();
  });
}

// ── accordion shell ───────────────────────────────────────────────────────────

export function glyphsAccordionShell(count) {
  return `
  <div class="section">
    <div class="section-title">Glyphs</div>
    <div class="acc-hdr" id="glyphs-hdr">
      <span>GID, name &amp; Unicode mapping
        <span style="font-size:11px;font-weight:400;color:#999;margin-left:6px">${fmtNum(count)} glyphs</span></span>
      <span class="chevron">&#9658;</span>
    </div>
    <div class="acc-body" id="glyphs-body" style="display:none"></div>
  </div>`;
}
