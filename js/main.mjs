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
import { detectVersionSync } from './parse/head.mjs';
import {
  renderIdentity,
  renderTableSizes,
  renderLayoutSummary,
  renderScriptLangs,
  renderLookupDist,
  renderCtxLookups,
  renderComplexity,
  attachSizeSort,
}                           from './ui/sections.mjs';
import {
  namesAccordionShell,
  wireNamesBody,
}                           from './ui/namesUI.mjs';
import {
  headAccordionShell,
  wireHeadBody,
}                           from './ui/headUI.mjs';

// ── per-font mutable state ───────────────────────────────────────────────────

let lastResult = null;

/**
 * State for name table edits — passed by reference into namesUI.
 */
let namesState = { editMode: false, nameEdits: {} };

/**
 * State for head table version sync — passed by reference into headUI.
 * pendingRevision: Fixed 16.16 uint32 to write at download time, or null.
 */
let headState = { pendingRevision: null };

// AbortController to clean up cross-section event listeners on next file load
let abortController = new AbortController();

// ── render ───────────────────────────────────────────────────────────────────

function render(result) {
  lastResult = result;
  namesState = { editMode: false, nameEdits: {} };
  headState  = { pendingRevision: null };

  const { names, nameRecs, headVer, headInfo, tablesRaw, gsub, gpos, fileSize, fileName, origBuf } = result;
  const uniqs    = [...new Set(nameRecs.map(r => r.nid))].length;
  const syncInfo = detectVersionSync(headInfo, names);

  // Build page HTML — section order:
  //  1. Font identity
  //  2. head table   (expanded — fontRevision + version sync)
  //  3. Name table   (expanded)
  //  4. Table sizes
  //  5. Layout summary  (if GSUB or GPOS present)
  //  6. GSUB distribution + contextual detail
  //  7. GPOS distribution + contextual detail
  //  8. Optimization complexity
  let html = '';
  html += renderIdentity(names, headVer, tablesRaw, fileSize);
  html += headAccordionShell();
  html += namesAccordionShell(nameRecs.length, uniqs);
  html += renderTableSizes(tablesRaw, fileSize);
  html += renderLayoutSummary(gsub, gpos);
  html += renderScriptLangs(gsub, gpos);

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
  resultsEl.innerHTML     = html;
  resultsEl.style.display = 'block';

  // ── wire head accordion ───────────────────────────────────────────────────
  wireHeadBody(headInfo, syncInfo, headState, namesState);

  const headHdr  = document.getElementById('head-hdr');
  const headBody = document.getElementById('head-body');
  let headOpen   = true;

  headHdr.addEventListener('click', () => {
    headOpen = !headOpen;
    headHdr.classList.toggle('open', headOpen);
    headHdr.querySelector('.chevron').style.transform = headOpen ? 'rotate(90deg)' : '';
    headBody.style.display = headOpen ? 'block' : 'none';
    if (headOpen) wireHeadBody(headInfo, syncInfo, headState, namesState);
  });

  // ── wire names accordion ──────────────────────────────────────────────────
  wireNamesBody(nameRecs, namesState, tablesRaw, origBuf, fileName, headState);

  const namesHdr  = document.getElementById('names-hdr');
  const namesBody = document.getElementById('names-body');
  let namesOpen   = true;

  namesHdr.addEventListener('click', () => {
    namesOpen = !namesOpen;
    namesHdr.classList.toggle('open', namesOpen);
    namesHdr.querySelector('.chevron').style.transform = namesOpen ? 'rotate(90deg)' : '';
    namesBody.style.display = namesOpen ? 'block' : 'none';
    if (namesOpen) wireNamesBody(nameRecs, namesState, tablesRaw, origBuf, fileName, headState);
  });

  // ── cross-section event: head sync updated nameEdits ─────────────────────
  // headUI fires this when the user applies or clears a version sync,
  // so the name table body re-renders with the updated highlights.
  document.addEventListener('font-namesedits-changed', () => {
    if (namesOpen) wireNamesBody(nameRecs, namesState, tablesRaw, origBuf, fileName, headState);
  }, { signal: abortController.signal });

  // ── wire size-table sort ─────────────────────────────────────────────────
  attachSizeSort(tablesRaw, fileSize);
}

// ── file handling ─────────────────────────────────────────────────────────────

function handleFile(file) {
  if (!file) return;
  document.getElementById('err').textContent = '';
  // Cancel cross-section event listeners from the previous font.
  abortController.abort();
  abortController = new AbortController();

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
