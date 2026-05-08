/**
 * main.mjs — application entry point.
 *
 * Responsibilities:
 *  - File drop / file-input handling
 *  - Top-level render() that wires all sections together
 *  - Mutable per-font state (lastResult, nameEdits, editMode)
 *
 * All parsing is delegated to js/parse/*.mjs.
 * All HTML generation is delegated to js/ui/*.mjs.
 */

import { analyzeFont }      from './parse/font.mjs';
import {
  renderIdentity,
  renderTableSizes,
  renderLayoutSummary,
  renderLookupDist,
  renderCtxLookups,
  renderComplexity,
  attachSizeSort,
}                           from './ui/sections.mjs';
import {
  namesAccordionShell,
  wireNamesBody,
}                           from './ui/namesUI.mjs';

// ── per-font mutable state ───────────────────────────────────────────────────

let lastResult = null;

/**
 * State object passed by reference into namesUI so that edit-mode changes
 * made inside the accordion are visible to the outer render context.
 */
let namesState = { editMode: false, nameEdits: {} };

// ── render ───────────────────────────────────────────────────────────────────

function render(result) {
  lastResult = result;
  namesState = { editMode: false, nameEdits: {} };

  const { names, nameRecs, headVer, tablesRaw, gsub, gpos, fileSize, fileName, origBuf } = result;
  const uniqs = [...new Set(nameRecs.map(r => r.nid))].length;

  // Build page HTML — section order:
  //  1. Font identity
  //  2. Name table  (expanded by default)
  //  3. Table sizes
  //  4. Layout summary  (if GSUB or GPOS present)
  //  5. GSUB distribution + contextual detail
  //  6. GPOS distribution + contextual detail
  //  7. Optimization complexity
  let html = '';
  html += renderIdentity(names, headVer, tablesRaw, fileSize);
  html += namesAccordionShell(nameRecs.length, uniqs);
  html += renderTableSizes(tablesRaw, fileSize);
  html += renderLayoutSummary(gsub, gpos);

  if (gsub && gsub.lookups.length) {
    html += renderLookupDist(gsub.lookups, true);
    html += renderCtxLookups(gsub.lookups, true);
  }
  if (gpos && gpos.lookups.length) {
    html += renderLookupDist(gpos.lookups, false);
    html += renderCtxLookups(gpos.lookups, false);
  }

  html += renderComplexity(gsub, gpos);

  const resultsEl = document.getElementById('results');
  resultsEl.innerHTML  = html;
  resultsEl.style.display = 'block';

  // ── wire names accordion (expanded by default) ───────────────────────────
  wireNamesBody(nameRecs, namesState, tablesRaw, origBuf, fileName);

  const hdr  = document.getElementById('names-hdr');
  const body = document.getElementById('names-body');
  let opened = true; // default expanded

  hdr.addEventListener('click', () => {
    opened = !opened;
    hdr.classList.toggle('open', opened);
    hdr.querySelector('.chevron').style.transform = opened ? 'rotate(90deg)' : '';
    body.style.display = opened ? 'block' : 'none';
    // Re-wire when re-opening in case state has drifted.
    if (opened) wireNamesBody(nameRecs, namesState, tablesRaw, origBuf, fileName);
  });

  // ── wire size-table sort ─────────────────────────────────────────────────
  attachSizeSort(tablesRaw, fileSize);
}

// ── file handling ─────────────────────────────────────────────────────────────

function handleFile(file) {
  if (!file) return;
  document.getElementById('err').textContent = '';

  const reader = new FileReader();
  reader.onload = e => {
    try {
      render(analyzeFont(e.target.result, file.name));
    } catch (ex) {
      document.getElementById('err').textContent = ex.message;
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── DOM bootstrap ─────────────────────────────────────────────────────────────

const drop = document.getElementById('drop');
const fi   = document.getElementById('fileinput');

drop.addEventListener('click',     () => fi.click());
fi.addEventListener('change',      () => handleFile(fi.files[0]));
drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop',      e => {
  e.preventDefault();
  drop.classList.remove('over');
  handleFile(e.dataTransfer.files[0]);
});
