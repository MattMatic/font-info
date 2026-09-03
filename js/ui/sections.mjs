import { fmtBytes, fmtNum, esc, tblGroup, tblGroupBadge, badgeCls } from './util.mjs';
import { GRP_BADGE } from './constants.mjs';
import { complexity, mergeScriptMaps } from '../parse/layout.mjs';

// ── identity cards ───────────────────────────────────────────────────────────

export function renderIdentity(names, headVer, tablesRaw, fileSize) {
  const fontName = names[4] || names[1] || 'Unknown';
  const version  = names[5] || headVer  || '—';
  return `
  <div class="section">
    <div class="section-title">Font identity</div>
    <div class="cards">
      <div class="card">
        <div class="card-label">Name</div>
        <div class="card-val" style="font-size:15px;line-height:1.3">${esc(fontName)}</div>
      </div>
      <div class="card">
        <div class="card-label">Version</div>
        <div class="card-val" style="font-size:15px">${esc(version)}</div>
      </div>
      <div class="card">
        <div class="card-label">File size</div>
        <div class="card-val" style="font-size:15px">${fmtBytes(fileSize)}</div>
        <div class="card-sub">${fmtNum(fileSize)} bytes</div>
      </div>
      <div class="card">
        <div class="card-label">Tables</div>
        <div class="card-val">${Object.keys(tablesRaw).length}</div>
      </div>
    </div>
  </div>`;
}

// ── table sizes ──────────────────────────────────────────────────────────────

let sortCol = 'len', sortAsc = false;

/**
 * Render the sortable table-sizes HTML.
 * Called both on initial render and on every column-header click.
 */
export function sizesHTML(tablesRaw, fileSize) {
  const entries = Object.entries(tablesRaw).map(([tag, { len }]) => ({
    tag, len,
    pct:   len / fileSize * 100,
    group: tblGroup(tag),
  }));

  const sorted = [...entries].sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol];
    if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortAsc ? av - bv : bv - av;
  });

  const maxLen   = Math.max(...entries.map(e => e.len));
  const overhead = fileSize - entries.reduce((s, e) => s + e.len, 0);
  const arrow    = s => s === sortCol ? (sortAsc ? '↑' : '↓') : '↕';
  const sc       = s => s === sortCol ? ' sorted' : '';

  let rows = '';
  for (const e of sorted) {
    const w      = Math.round(e.len / maxLen * 100);
    const big    = e.pct >= 10;
    const pctStr = e.pct < 0.1 ? '<0.1%' : e.pct.toFixed(1) + '%';
    rows += `
      <tr>
        <td><span class="mono" style="font-weight:500">${e.tag}</span></td>
        <td><span class="badge ${tblGroupBadge(e.tag)}">${e.group}</span></td>
        <td class="num">${fmtNum(e.len)}</td>
        <td><div class="bar-bg" style="min-width:80px">
              <div class="bar-fill" style="width:${w}%;background:${big ? '#BA7517' : '#378ADD'}"></div>
            </div></td>
        <td class="pct-cell${big ? ' warn' : ''}">${pctStr}</td>
      </tr>`;
  }

  return `
  <div class="table-wrap"><table>
    <thead><tr>
      <th data-col="tag"  class="${sc('tag')}">Table <span class="sa">${arrow('tag')}</span></th>
      <th data-col="group" class="${sc('group')}">Group <span class="sa">${arrow('group')}</span></th>
      <th data-col="len"  class="${sc('len')}">Size (bytes) <span class="sa">${arrow('len')}</span></th>
      <th>Proportion</th>
      <th data-col="pct"  class="${sc('pct')}">% of file <span class="sa">${arrow('pct')}</span></th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="font-size:12px;color:#888;padding:6px 12px">Header + alignment overhead</td>
        <td class="num" style="font-size:12px">${fmtNum(overhead)}</td>
        <td></td>
        <td class="pct-cell">${(overhead / fileSize * 100).toFixed(1)}%</td>
      </tr>
      <tr style="background:#eee">
        <td colspan="2" style="font-weight:500;padding:6px 12px">Total file</td>
        <td class="num" style="font-weight:500">${fmtNum(fileSize)}</td>
        <td></td>
        <td class="pct-cell" style="font-weight:500">100%</td>
      </tr>
    </tfoot>
  </table></div>`;
}

export function renderTableSizes(tablesRaw, fileSize) {
  return `
  <div class="section">
    <div class="section-title">
      Table sizes
      <span style="font-size:11px;font-weight:400;color:#999;margin-left:4px">click header to sort</span>
    </div>
    <div id="szwrap">${sizesHTML(tablesRaw, fileSize)}</div>
  </div>`;
}

/** Attach click-to-sort behaviour to the size table. Re-attaches after re-render. */
export function attachSizeSort(tablesRaw, fileSize) {
  const wrap = document.getElementById('szwrap');
  if (!wrap) return;
  wrap.querySelector('table').addEventListener('click', e => {
    const th = e.target.closest('th[data-col]');
    if (!th) return;
    const col = th.dataset.col;
    if (col === sortCol) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = (col === 'tag' || col === 'group'); }
    wrap.innerHTML = sizesHTML(tablesRaw, fileSize);
    attachSizeSort(tablesRaw, fileSize);
  });
}

// ── layout table summary ─────────────────────────────────────────────────────

export function renderLayoutSummary(gsub, gpos) {
  if (!gsub && !gpos) return '';
  const all      = [...(gsub ? gsub.lookups : []), ...(gpos ? gpos.lookups : [])];
  const ctxCount = all.filter(l => l.isContextual).length;

  return `
  <div class="section">
    <div class="section-title">Layout table summary</div>
    <div class="cards">
      <div class="card">
        <div class="card-label">GSUB lookups</div>
        <div class="card-val">${gsub ? gsub.lookups.length : '—'}</div>
        ${gsub ? `<div class="card-sub">v${gsub.major}.${gsub.minor} &middot; ${gsub.scriptCount} scripts &middot; ${gsub.featureCount} features</div>` : ''}
      </div>
      <div class="card">
        <div class="card-label">GPOS lookups</div>
        <div class="card-val">${gpos ? gpos.lookups.length : '—'}</div>
        ${gpos ? `<div class="card-sub">v${gpos.major}.${gpos.minor} &middot; ${gpos.scriptCount} scripts &middot; ${gpos.featureCount} features</div>` : ''}
      </div>
      <div class="card">
        <div class="card-label">Contextual lookups</div>
        <div class="card-val">${ctxCount}</div>
        <div class="card-sub">of ${all.length} total</div>
      </div>
    </div>
  </div>`;
}

// ── lookup distribution table ────────────────────────────────────────────────

export function renderLookupDist(lookups, isGSUB) {
  const dist   = {};
  for (const l of lookups) dist[l.name] = (dist[l.name] ?? 0) + 1;
  const barMax = Math.max(...Object.values(dist));
  const colors = ['#378ADD','#1D9E75','#BA7517','#D4537E','#7F77DD','#639922','#D85A30','#888780'];

  let ci = 0, rows = '';
  for (const [name, cnt] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(cnt / lookups.length * 100);
    const w   = Math.round(cnt / barMax * 100);
    rows += `
      <tr>
        <td><span class="mono">${name}</span></td>
        <td>
          <div class="bar-wrap">
            <div class="bar-bg">
              <div class="bar-fill" style="width:${w}%;background:${colors[ci++ % colors.length]}"></div>
            </div>
            <span style="font-size:12px;min-width:28px;text-align:right">${cnt}</span>
          </div>
        </td>
        <td class="pct-cell">${pct}%</td>
      </tr>`;
  }

  const tag = isGSUB ? 'GSUB' : 'GPOS';
  return `
  <div class="section">
    <div class="section-title">${tag} lookup distribution</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Lookup type</th><th>Distribution</th><th>Share</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

// ── contextual lookup detail ─────────────────────────────────────────────────

export function renderCtxLookups(lookups, isGSUB) {
  const ctx = lookups.filter(l => l.isContextual);
  const tag = isGSUB ? 'GSUB' : 'GPOS';

  const body = ctx.length === 0
    ? '<p style="font-size:13px;color:#666;margin-top:.5rem">No contextual lookups found.</p>'
    : `<div class="table-wrap"><table>
         <thead><tr><th>Idx</th><th>Type</th><th>Sub-tables</th><th>Sub-table detail</th></tr></thead>
         <tbody>
           ${ctx.map(l => `
             <tr>
               <td class="mono">#${l.index}</td>
               <td>
                 <span class="badge ${badgeCls(l.type, isGSUB)}">${l.name}</span>
                 ${l.isExt ? '<span class="badge b-purple" style="margin-left:4px">ext</span>' : ''}
               </td>
               <td>${l.subCount}</td>
               <td class="mono" style="color:#888;font-size:11px">
                 ${l.subs.map(s => s.detail || `fmt${s.fmt}`).join(', ')}
               </td>
             </tr>`).join('')}
         </tbody>
       </table></div>`;

  return `
  <div class="section">
    <div class="section-title">${tag} contextual lookups &amp; sub-tables</div>
    ${body}
  </div>`;
}

// ── complexity score ─────────────────────────────────────────────────────────

export function renderComplexity(gsub, gpos) {
  const { score, reasons } = complexity(gsub, gpos);
  const color = score > 65 ? '#c0392b' : score > 35 ? '#8a5c00' : '#1a7a52';
  const lbl   = score > 65 ? 'High complexity' : score > 35 ? 'Medium complexity' : 'Low complexity';
  const bg    = score > 65 ? '#FAECE7' : score > 35 ? '#FAEEDA' : '#E1F5EE';
  const fc    = score > 65 ? '#712B13' : score > 35 ? '#633806' : '#085041';

  return `
  <div class="section">
    <div class="section-title">Optimization &amp; compression difficulty</div>
    <div class="score-wrap">
      <div class="score-header">
        <div>
          <div class="card-label">Estimated complexity</div>
          <div style="font-size:26px;font-weight:500;color:${color}">
            ${score}<span style="font-size:14px;font-weight:400;color:#888">/100</span>
          </div>
        </div>
        <span class="badge" style="background:${bg};color:${fc}">${lbl}</span>
      </div>
      <div class="insight">
        <ul>${reasons.map(r => `<li>${r}</li>`).join('')}</ul>
      </div>
    </div>
  </div>`;
}

// ── script / language table ───────────────────────────────────────────────────

/**
 * Render the merged GSUB+GPOS script → language tag table.
 * Each row: script tag | comma-separated language tags.
 *
 * @param {Object|null} gsub  - parsed GSUB table (has .scriptMap)
 * @param {Object|null} gpos  - parsed GPOS table (has .scriptMap)
 */
export function renderScriptLangs(gsub, gpos) {
  if (!gsub && !gpos) return '';

  const merged = mergeScriptMaps(
    gsub ? gsub.scriptMap : null,
    gpos ? gpos.scriptMap : null,
  );

  if (!merged.size) return '';

  const rows = [...merged.entries()].map(([script, langs]) => `
    <tr>
      <td><span class="mono" style="font-weight:500">${script}</span></td>
      <td class="mono" style="color:#444">${langs.join(', ')}</td>
    </tr>`).join('');

  return `
  <div class="section">
    <div class="section-title">Scripts &amp; languages
      <span style="font-size:11px;font-weight:400;color:#999;margin-left:4px">merged GSUB + GPOS &middot; ${merged.size} script${merged.size !== 1 ? 's' : ''}</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th style="width:120px;cursor:default">Script</th>
        <th style="cursor:default">Language tags</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}
