import { esc, nameLabel, langLabel, platLabel } from './util.mjs';
import { EDITABLE_NIDS, PLAT }                 from './constants.mjs';
import { patchAndDownload }                     from '../parse/names.mjs';

// ── HTML builder ─────────────────────────────────────────────────────────────

/**
 * Build the full innerHTML for the names accordion body.
 *
 * @param {Object[]} nameRecs   - all name records from the font
 * @param {boolean}  editMode   - whether input fields are shown
 * @param {Object}   nameEdits  - {nameID: newString} pending edits
 * @param {string}   fileName   - original font filename (for download default)
 */
export function namesBodyHTML(nameRecs, editMode, nameEdits, fileName) {
  const sorted  = [...nameRecs].sort((a, b) => a.nid !== b.nid ? a.nid - b.nid : a.pid - b.pid);
  const uniqs   = [...new Set(nameRecs.map(r => r.nid))].length;
  const hasEdits = Object.keys(nameEdits).length > 0;

  let rows = '', lastNid = -1;

  for (const r of sorted) {
    const first      = r.nid !== lastNid;
    lastNid          = r.nid;
    const platBadge  = r.pid === 3 ? 'b-blue' : r.pid === 1 ? 'b-teal' : r.pid === 0 ? 'b-purple' : 'b-gray';
    const canEdit    = editMode && EDITABLE_NIDS.has(r.nid) && (r.pid === 3 || r.pid === 1);
    const curVal     = (r.nid in nameEdits) ? nameEdits[r.nid] : r.value;
    const changed    = (r.nid in nameEdits) && nameEdits[r.nid] !== r.value;

    const nidCell    = first ? `<span style="color:#aaa">${r.nid}</span>` : '';
    const labelCell  = first ? `<strong style="font-size:12px">${esc(nameLabel(r.nid))}</strong>` : '';
    const platCell   = `<span class="badge ${platBadge}" style="font-size:10px">${platLabel(r.pid)}</span>
                        <span style="font-size:11px;color:#999">${langLabel(r.pid, r.lid)}</span>`;
    const valCell    = canEdit
      ? `<input type="text" value="${esc(curVal)}" data-nid="${r.nid}">`
      : `<span style="font-size:13px">${esc(curVal) || '<span style="color:#ccc">—</span>'}</span>`;
    const statusCell = changed ? '<span class="dot"></span>' : '';

    rows += `
      <tr class="${changed ? 'edited' : ''}">
        <td style="font-size:12px;width:36px">${nidCell}</td>
        <td style="width:160px">${labelCell}</td>
        <td style="width:150px">${platCell}</td>
        <td class="vc">${valCell}</td>
        <td style="width:40px;text-align:center">${statusCell}</td>
      </tr>`;
  }

  const defaultSaveAs = fileName.replace(/(\.[ot]tf)$/i, '_edited$1') || 'edited.ttf';

  return `
  <div class="names-toolbar">
    <span class="names-info" id="ntoolbar-info">
      ${nameRecs.length} records &middot; ${uniqs} unique IDs
      ${hasEdits ? ` &middot; <strong style="color:#1a7a52">${Object.keys(nameEdits).length} modified</strong>` : ''}
    </span>
    <div style="display:flex;gap:6px">
      ${hasEdits ? '<button class="dng" id="btn-reset">Reset</button>' : ''}
      <button class="${editMode ? 'pri' : ''}" id="btn-edit">${editMode ? 'Done' : 'Edit names'}</button>
    </div>
  </div>
  <div style="overflow-x:auto">
    <table class="ntbl">
      <thead><tr>
        <th>ID</th><th>Name</th><th>Platform / lang</th><th>Value</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${hasEdits ? `
  <div class="save-bar">
    <span class="save-note">Save as:</span>
    <input type="text" id="save-fn" value="${esc(defaultSaveAs)}">
    <button id="btn-dl">Download font</button>
  </div>` : ''}`;
}

// ── toolbar info updater (called on every keystroke) ─────────────────────────

function updateToolbarInfo(body, nameRecs, nameEdits) {
  const info = body.querySelector('#ntoolbar-info');
  if (!info) return;
  const uniqs    = [...new Set(nameRecs.map(r => r.nid))].length;
  const hasEdits = Object.keys(nameEdits).length > 0;
  info.innerHTML = `
    ${nameRecs.length} records &middot; ${uniqs} unique IDs
    ${hasEdits ? ` &middot; <strong style="color:#1a7a52">${Object.keys(nameEdits).length} modified</strong>` : ''}`;
}

// ── flush input values into nameEdits ────────────────────────────────────────

export function flushInputs(body, nameRecs, nameEdits) {
  body.querySelectorAll('input[data-nid]').forEach(inp => {
    const nid  = parseInt(inp.dataset.nid, 10);
    const orig = nameRecs.find(r => r.nid === nid && (r.pid === 3 || r.pid === 1));
    if (!orig) return;
    if (inp.value !== orig.value) nameEdits[nid] = inp.value;
    else delete nameEdits[nid];
  });
}

// ── wire up all interactivity ─────────────────────────────────────────────────

/**
 * Render the accordion body and attach all event handlers.
 *
 * `state` is a plain object with mutable fields:
 *   { editMode: boolean, nameEdits: Object }
 * This avoids sharing module-level globals across re-renders.
 *
 * @param {Object[]} nameRecs
 * @param {Object}   state       - { editMode, nameEdits }
 * @param {Object}   tablesRaw   - needed by patchAndDownload
 * @param {ArrayBuffer} origBuf
 * @param {string}   fileName
 */
export function wireNamesBody(nameRecs, state, tablesRaw, origBuf, fileName) {
  const body = document.getElementById('names-body');
  if (!body) return;

  body.innerHTML = namesBodyHTML(nameRecs, state.editMode, state.nameEdits, fileName);

  // ── Edit / Done toggle ───────────────────────────────────────────────────
  body.querySelector('#btn-edit').onclick = () => {
    if (state.editMode) flushInputs(body, nameRecs, state.nameEdits);
    state.editMode = !state.editMode;
    wireNamesBody(nameRecs, state, tablesRaw, origBuf, fileName);
  };

  // ── Reset ────────────────────────────────────────────────────────────────
  body.querySelector('#btn-reset')?.addEventListener('click', () => {
    state.nameEdits = {};
    state.editMode  = false;
    wireNamesBody(nameRecs, state, tablesRaw, origBuf, fileName);
  });

  // ── Live input tracking ──────────────────────────────────────────────────
  body.querySelectorAll('input[data-nid]').forEach(inp => {
    inp.addEventListener('input', () => {
      const nid  = parseInt(inp.dataset.nid, 10);
      const orig = nameRecs.find(r => r.nid === nid && (r.pid === 3 || r.pid === 1));
      if (!orig) return;

      if (inp.value !== orig.value) state.nameEdits[nid] = inp.value;
      else delete state.nameEdits[nid];

      // Update toolbar count without a full re-render.
      updateToolbarInfo(body, nameRecs, state.nameEdits);

      // Update this row's edited class and dot indicator.
      const row     = inp.closest('tr');
      const changed = nid in state.nameEdits;
      row?.classList.toggle('edited', changed);
      const dotCell = row?.querySelector('td:last-child');
      if (dotCell) dotCell.innerHTML = changed ? '<span class="dot"></span>' : '';
    });
  });

  // ── Download ─────────────────────────────────────────────────────────────
  body.querySelector('#btn-dl')?.addEventListener('click', () => {
    flushInputs(body, nameRecs, state.nameEdits);
    const fn = body.querySelector('#save-fn')?.value || 'edited.ttf';
    patchAndDownload(origBuf, tablesRaw, state.nameEdits, fn);
  });
}

// ── accordion section shell ───────────────────────────────────────────────────

/**
 * Return the static HTML shell for the names section (accordion header +
 * body container). The body is populated by wireNamesBody().
 *
 * @param {number} recCount   - total record count for the badge
 * @param {number} uniqCount  - unique nameID count for the badge
 */
export function namesAccordionShell(recCount, uniqCount) {
  return `
  <div class="section">
    <div class="section-title">Name table</div>
    <div class="acc-hdr open" id="names-hdr">
      <span>
        All name records
        <span class="badge b-gray" style="margin-left:6px">
          ${recCount} records &middot; ${uniqCount} IDs
        </span>
      </span>
      <span class="chevron" style="transform:rotate(90deg)">&#9658;</span>
    </div>
    <div class="acc-body" id="names-body"></div>
  </div>`;
}
