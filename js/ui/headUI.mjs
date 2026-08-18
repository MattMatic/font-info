import { esc, fmtNum }              from './util.mjs';
import { detectVersionSync,
         applyVersionSync,
         fixedToString,
         stringToFixed }            from '../parse/head.mjs';

// ── head field table HTML ─────────────────────────────────────────────────────

function row(label, value, mono = false) {
  return `<tr>
    <td style="font-size:12px;color:#666;width:180px;padding:5px 12px">${label}</td>
    <td style="padding:5px 12px;font-size:13px${mono ? ';font-family:ui-monospace,monospace' : ''}">${value}</td>
  </tr>`;
}

function flagBadges(flags) {
  return flags.map(f =>
    f === '(none)'
      ? `<span style="color:#bbb;font-size:12px">(none)</span>`
      : `<span class="badge b-gray" style="margin-right:4px">${f}</span>`
  ).join('');
}

// ── version sync panel ────────────────────────────────────────────────────────

/**
 * Build the version sync panel HTML.
 * @param {Object}  syncInfo   - result of detectVersionSync()
 * @param {Object}  headState  - { pendingRevision: number|null }
 */
function syncPanelHTML(syncInfo, headState) {
  if (!syncInfo.matches.length) {
    return `<div class="head-sync-empty">
      <span style="font-size:12px;color:#999">
        Version number <span style="font-family:ui-monospace,monospace">${esc(syncInfo.currentStr)}</span>
        not found in name ID 3 or ID 5 — fields cannot be synced automatically.
      </span>
    </div>`;
  }

  const fieldList = syncInfo.matches.map(m => `<span class="badge b-teal">${m.label}</span>`).join(' ');
  const pending = headState.pendingRevision !== null
    ? fixedToString(headState.pendingRevision)
    : null;

  return `<div class="head-sync-panel">
    <div class="head-sync-header">
      <span style="font-size:12px;font-weight:500">Version sync</span>
      <span style="font-size:12px;color:#666">
        Will update <span style="font-family:ui-monospace,monospace">head.fontRevision</span>
        and ${fieldList}
      </span>
    </div>
    <div class="head-sync-body">
      <label style="font-size:12px;color:#666">New version number</label>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
        <input type="text" id="ver-input" class="ver-input"
               value="${esc(pending ?? syncInfo.currentStr)}"
               placeholder="e.g. 2.002"
               spellcheck="false">
        <button id="btn-ver-apply" class="btn-ver-apply">Apply</button>
        ${pending !== null ? `<button id="btn-ver-clear" class="btn-ver-clear">Clear</button>` : ''}
      </div>
      ${pending !== null ? `
      <div class="ver-preview">
        <span style="font-size:12px;color:#1a7a52">✓ Pending: <strong>${esc(pending)}</strong></span>
        <span style="font-size:12px;color:#666"> — download the font from the Name table section to save</span>
      </div>` : ''}
    </div>
  </div>`;
}

// ── full accordion body ───────────────────────────────────────────────────────

export function headBodyHTML(headInfo, syncInfo, headState) {
  if (!headInfo) {
    return `<div style="padding:1rem;font-size:13px;color:#666">No <code>head</code> table found.</div>`;
  }

  const bbox = `xMin ${headInfo.xMin}, yMin ${headInfo.yMin}, xMax ${headInfo.xMax}, yMax ${headInfo.yMax}`;

  const fieldRows = [
    row('fontRevision',     `<span style="font-family:ui-monospace,monospace;font-weight:500">${esc(headInfo.fontRevision)}</span> <span style="font-size:11px;color:#999">(raw 0x${headInfo.fontRevisionRaw.toString(16).padStart(8,'0')})</span>`),
    row('unitsPerEm',       fmtNum(headInfo.unitsPerEm), true),
    row('created',          esc(headInfo.created)),
    row('modified',         esc(headInfo.modified)),
    row('macStyle',         flagBadges(headInfo.macStyleFlags) + `<span style="font-size:11px;color:#aaa;margin-left:6px">0x${headInfo.macStyleRaw.toString(16).padStart(4,'0')}</span>`),
    row('lowestRecPPEM',    String(headInfo.lowestRecPPEM), true),
    row('indexToLocFormat', esc(headInfo.indexToLocFormat)),
    row('Bounding box',     esc(bbox), true),
  ].join('');

  return `
  <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tbody>${fieldRows}</tbody>
    </table>
  </div>
  ${syncPanelHTML(syncInfo, headState)}`;
}

// ── accordion shell ───────────────────────────────────────────────────────────

export function headAccordionShell() {
  return `
  <div class="section">
    <div class="section-title">head table</div>
    <div class="acc-hdr open" id="head-hdr">
      <span>Font metrics &amp; revision</span>
      <span class="chevron" style="transform:rotate(90deg)">&#9658;</span>
    </div>
    <div class="acc-body" id="head-body"></div>
  </div>`;
}

// ── wire interactivity ────────────────────────────────────────────────────────

/**
 * Render the head body and attach version-sync events.
 *
 * When the user clicks "Apply":
 *  - validates and stores the new Fixed value in headState.pendingRevision
 *  - injects the name edits into namesState.nameEdits (so the name table
 *    highlights them as pending edits)
 *  - fires a custom 'font-namesedits-changed' event so main.mjs can
 *    re-render the name table body
 *  - re-renders this head body to show the preview
 *
 * @param {Object}   headInfo
 * @param {Object}   syncInfo    - from detectVersionSync()
 * @param {Object}   headState   - { pendingRevision: number|null }
 * @param {Object}   namesState  - { editMode, nameEdits } — shared reference
 */
export function wireHeadBody(headInfo, syncInfo, headState, namesState) {
  const body = document.getElementById('head-body');
  if (!body) return;

  body.innerHTML = headBodyHTML(headInfo, syncInfo, headState);

  body.querySelector('#btn-ver-apply')?.addEventListener('click', () => {
    const inp = body.querySelector('#ver-input');
    if (!inp) return;
    const newStr = inp.value.trim();

    // Validate: must parse to a valid Fixed 16.16
    if (!/^\d+(\.\d+)?$/.test(newStr)) {
      inp.style.borderColor = '#c0392b';
      inp.title = 'Enter a positive decimal number, e.g. 2.002';
      return;
    }
    inp.style.borderColor = '';

    const newFixed = applyVersionSync(syncInfo, newStr, namesState.nameEdits);
    if (newFixed === null) {
      inp.style.borderColor = '#c0392b';
      return;
    }

    headState.pendingRevision = newFixed;

    // Notify main.mjs that nameEdits changed so name table re-renders.
    document.dispatchEvent(new CustomEvent('font-namesedits-changed'));

    // Re-render this panel to show the pending preview.
    wireHeadBody(headInfo, syncInfo, headState, namesState);
  });

  body.querySelector('#btn-ver-clear')?.addEventListener('click', () => {
    headState.pendingRevision = null;

    // Remove the version-sync injected edits from namesState.
    for (const m of syncInfo.matches) {
      delete namesState.nameEdits[m.nid];
    }
    document.dispatchEvent(new CustomEvent('font-namesedits-changed'));

    wireHeadBody(headInfo, syncInfo, headState, namesState);
  });
}
