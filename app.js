// ── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  page: 'setup',
  festivalName: '',
  numTeams: 2,
  numHeats: 3,
  teamNames: ['Team A', 'Team B', 'Team C', 'Team D'],
  startTimes: [], // [heatIdx][teamIdx] = "HH:MM"
  teams: [],      // [{name, heats:[{startTime, seats:Array(20) of paddlerId|null}]}]
  activeTeam: 0,
  showBalance: true,
};

let dragState = null; // {paddlerId, from: 'roster' | {teamIdx,heatIdx,seatIdx}}
let dragOverEl = null; // currently highlighted drop target
let modalState = null; // optimizer modal state

const PADDLER_MAP = new Map(PADDLERS.map(p => [p.id, p]));

// ── HELPERS ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

function seatSide(idx) { return idx % 2 === 0 ? 'L' : 'R'; }
function seatRow(idx)  { return Math.floor(idx / 2) + 1; }

function paddlerWeight(p) { return p.weight_kg; }

function boatBalance(seats) {
  let L = 0, R = 0;
  seats.forEach((pid, idx) => {
    if (!pid) return;
    const p = getPaddler(pid);
    if (seatSide(idx) === 'L') L += paddlerWeight(p);
    else R += paddlerWeight(p);
  });
  const total = L + R;
  if (total === 0) return { L, R, label: 'No paddlers seated', cls: 'bal-none' };
  const pct = Math.abs(L - R) / total * 100;
  if (pct < 5)  return { L, R, label: 'Well balanced', cls: 'bal-good' };
  const side = L > R ? 'Left' : 'Right';
  const sev  = pct < 10 ? 'low' : pct < 15 ? 'medium' : 'high';
  return { L, R, label: `${side} heavy — ${sev}`, cls: `bal-${sev}` };
}

function boatBalanceFrontBack(seats, drummerSeat, steererSeat) {
  let F = 0, B = 0;
  seats.forEach((pid, idx) => {
    if (!pid) return;
    const p = getPaddler(pid);
    if (idx < 10) F += paddlerWeight(p);
    else          B += paddlerWeight(p);
  });
  if (drummerSeat) F += paddlerWeight(getPaddler(drummerSeat));
  if (steererSeat) B += paddlerWeight(getPaddler(steererSeat));
  const total = F + B;
  if (total === 0) return { F, B, label: 'No paddlers seated', cls: 'bal-none' };
  const pct = Math.abs(F - B) / total * 100;
  if (pct < 5)  return { F, B, label: 'Well balanced', cls: 'bal-good' };
  const side = F > B ? 'Front' : 'Back';
  const sev  = pct < 10 ? 'low' : pct < 15 ? 'medium' : 'high';
  return { F, B, label: `${side} heavy — ${sev}`, cls: `bal-${sev}` };
}

function getPaddler(id) { return PADDLER_MAP.get(id); }

function getAssignments(paddlerId) {
  const out = [];
  state.teams.forEach((team, ti) =>
    team.heats.forEach((heat, hi) => {
      heat.seats.forEach((pid, si) => {
        if (pid === paddlerId) out.push({ teamIdx: ti, heatIdx: hi, seatIdx: si, startTime: heat.startTime });
      });
      if (heat.drummerSeat === paddlerId) out.push({ teamIdx: ti, heatIdx: hi, role: 'drummer', startTime: heat.startTime });
      if (heat.steererSeat === paddlerId) out.push({ teamIdx: ti, heatIdx: hi, role: 'steerer', startTime: heat.startTime });
    })
  );
  return out;
}

function hasTimeConflict(paddlerId, newTime, excludeSlot) {
  const newMin = timeToMin(newTime);
  return getAssignments(paddlerId).some(a => {
    if (excludeSlot &&
        a.teamIdx === excludeSlot.teamIdx &&
        a.heatIdx === excludeSlot.heatIdx &&
        a.seatIdx === excludeSlot.seatIdx) return false;
    return Math.abs(timeToMin(a.startTime) - newMin) < 20;
  });
}

function ensureStartTimes() {
  for (let h = 0; h < state.numHeats; h++) {
    if (!state.startTimes[h]) state.startTimes[h] = [];
    for (let t = 0; t < state.numTeams; t++) {
      if (state.startTimes[h][t] == null) {
        const base = 9 * 60 + h * 30;
        state.startTimes[h][t] = `${String(Math.floor(base / 60)).padStart(2, '0')}:${String(base % 60).padStart(2, '0')}`;
      }
    }
    state.startTimes[h].length = state.numTeams;
  }
  state.startTimes.length = state.numHeats;
}

function showToast(msg, type = 'err') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type === 'err' ? 'toast-err' : 'toast-ok';
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ── SETUP PAGE ────────────────────────────────────────────────────────────────
function renderSetup() {
  ensureStartTimes();

  const namesHtml = Array.from({ length: state.numTeams }, (_, i) =>
    `<input class="text-input team-name-inp" data-i="${i}"
      placeholder="Team ${String.fromCharCode(65 + i)}"
      value="${esc(state.teamNames[i] || `Team ${String.fromCharCode(65 + i)}`)}">`
  ).join('');

  const thHtml = Array.from({ length: state.numTeams }, (_, i) =>
    `<th>${esc(state.teamNames[i] || `Team ${String.fromCharCode(65 + i)}`)}</th>`
  ).join('');

  const rowsHtml = Array.from({ length: state.numHeats }, (_, h) => {
    const cells = Array.from({ length: state.numTeams }, (_, t) =>
      `<td><input class="time-inp start-time-inp" type="time"
        data-h="${h}" data-t="${t}" value="${state.startTimes[h][t]}"></td>`
    ).join('');
    return `<tr><td class="hl">Heat ${h + 1}</td>${cells}</tr>`;
  }).join('');

  const attending = PADDLERS.filter(p => p.participating).length;

  document.getElementById('app').innerHTML = `
    <div class="setup-page">
      <div class="setup-hero">
        <div class="logo">Dragon Boat Festival Planner</div>
        <div class="sub">Set up your festival, then drag &amp; drop paddlers into each boat</div>
      </div>
      <div class="setup-nav">
        <button class="back-btn" data-act="go-home">← Home</button>
      </div>
      <div class="setup-card">
        <h2>Festival Configuration</h2>

        <div class="config-row">
          <label>Festival Name</label>
          <input class="text-input festival-name-inp" placeholder="e.g. Summer Regatta 2026"
            value="${esc(state.festivalName)}" style="width:260px">
        </div>

        <div class="config-row">
          <label>Teams</label>
          <div class="counter">
            <button class="counter-btn" data-act="dec-teams">−</button>
            <span class="counter-val">${state.numTeams}</span>
            <button class="counter-btn" data-act="inc-teams">+</button>
          </div>
        </div>

        <div class="config-row">
          <label>Heats per Team</label>
          <div class="counter">
            <button class="counter-btn" data-act="dec-heats">−</button>
            <span class="counter-val">${state.numHeats}</span>
            <button class="counter-btn" data-act="inc-heats">+</button>
          </div>
        </div>

        <div class="config-row" style="align-items:flex-start">
          <label>Team Names</label>
          <div class="team-names-wrap">${namesHtml}</div>
        </div>

        <div class="config-row" style="align-items:flex-start">
          <label>Start Times</label>
          <table class="times-table">
            <thead><tr><th></th>${thHtml}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="setup-footer">
          <button class="roster-btn" data-act="roster">Manage Roster (${attending} / ${PADDLERS.length} attending)</button>
          <div class="setup-footer-row">
            <button class="save-setup-btn" data-act="save-setup">Save Configuration</button>
            <button class="launch-btn" data-act="launch">Open Planner →</button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── PADDLERS PAGE ─────────────────────────────────────────────────────────────
function renderPaddlers() {
  const attending = PADDLERS.filter(p => p.participating).length;

  const rowsHtml = PADDLERS.map(p => `
    <tr class="pr${p.participating ? '' : ' pr-off'}" data-pid="${p.id}">
      <td class="td-chk">
        <input type="checkbox" class="part-chk" data-pid="${p.id}" ${p.participating ? 'checked' : ''}>
      </td>
      <td class="td-name">${esc(p.name)}</td>
      <td class="td-side">
        <select class="cell-sel side-sel" data-pid="${p.id}">
          <option value="L"${p.side_pref === 'L' ? ' selected' : ''}>L</option>
          <option value="R"${p.side_pref === 'R' ? ' selected' : ''}>R</option>
        </select>
      </td>
      <td class="td-excl">
        <input type="checkbox" class="excl-chk" data-pid="${p.id}" ${p.side_excl ? 'checked' : ''}>
      </td>
      <td class="td-wkg">
        <input type="number" class="cell-num weight-inp" data-pid="${p.id}"
          value="${p.weight_kg}" min="40" max="200">
      </td>
      <td class="td-ppos">
        <select class="cell-sel ppos-sel" data-pid="${p.id}">
          <option value="">—</option>
          ${Array.from({length:10},(_,i)=>`<option value="R${i+1}"${p.pref_pos===`R${i+1}`?' selected':''}>R${i+1}</option><option value="L${i+1}"${p.pref_pos===`L${i+1}`?' selected':''}>L${i+1}</option>`).join('')}
        </select>
      </td>
      <td class="td-gender">
        <select class="cell-sel gender-sel" data-pid="${p.id}">
          <option value="F"${p.gender === 'F' ? ' selected' : ''}>F</option>
          <option value="M"${p.gender === 'M' ? ' selected' : ''}>M</option>
        </select>
      </td>
    </tr>`).join('');

  document.getElementById('app').innerHTML = `
    <div class="paddlers-page">
      <div class="paddlers-header">
        <div class="ph-left">
          <button class="back-btn" data-act="back-roster">← Back to Setup</button>
          <h2>Paddler Roster</h2>
        </div>
        <div class="ph-right">
          <span class="attending-count"><span id="att-num">${attending}</span> / ${PADDLERS.length} attending</span>
          <button class="sel-btn" data-act="select-all">Select All</button>
          <button class="sel-btn" data-act="deselect-all">Deselect All</button>
          <input type="search" class="search-inp" placeholder="Search by name…" id="roster-search">
        </div>
      </div>
      <div class="paddler-table-wrap">
        <table class="paddler-table">
          <thead>
            <tr>
              <th>In Festival</th>
              <th>Name</th>
              <th>Side Pref</th>
              <th>Exclusive</th>
              <th>Weight (kg)</th>
              <th>Pref. Position</th>
              <th>Gender</th>
            </tr>
          </thead>
          <tbody id="paddler-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('roster-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.pr').forEach(row => {
      const name = row.querySelector('.td-name').textContent.toLowerCase();
      row.style.display = name.includes(q) ? '' : 'none';
    });
  });
}

// ── PLANNER PAGE ──────────────────────────────────────────────────────────────
function renderPlanner() {
  const team = state.teams[state.activeTeam];
  const activePaddlers = PADDLERS.filter(p => p.participating);

  const tabsHtml = state.teams.map((t, i) =>
    `<button class="team-tab${i === state.activeTeam ? ' active' : ''}" data-act="tab" data-ti="${i}">${esc(t.name)}</button>`
  ).join('');

  const boatsHtml = team.heats.map((heat, hi) => boatHtml(state.activeTeam, hi, heat)).join('');

  const assignmentCounts = new Map(activePaddlers.map(p => [p.id, getAssignments(p.id).length]));

  const rosterHtml = activePaddlers.map(p => {
    const count = assignmentCounts.get(p.id);
    return `<div class="roster-chip" draggable="true" data-pid="${p.id}"
      title="${esc(p.name)} | ${p.weight_kg} kg | Side: ${p.side_pref}${p.side_excl ? ' (exclusive)' : ''} | ${p.gender === 'M' ? 'Male' : 'Female'}">
      <span class="chip-name">${esc(p.name)}</span>
      <div class="chip-badges">
        <span class="sb sb-${p.side_pref}">${p.side_pref}</span>
        <span class="gb gb-${p.gender}">${p.gender}</span>
        ${p.side_excl ? '<span class="excl-b" title="Side exclusive">!</span>' : ''}
        ${p.pref_pos ? `<span class="pp-b" title="Preferred position">${p.pref_pos}</span>` : ''}
        ${count > 0 ? `<span class="ac" title="${count} heat(s) assigned">${count}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    <div class="planner-page">
      <div class="sidebar">
        <div class="sidebar-header">
          <button class="back-btn" data-act="back">← Setup</button>
          ${state.festivalName ? `<div class="festival-name-display">${esc(state.festivalName)}</div>` : ''}
          <div class="sidebar-top-row">
            <h3>Paddlers <span class="roster-count">${activePaddlers.length}</span></h3>
            <button class="save-festival-btn" data-act="save">Save</button>
          </div>
        </div>
        <div class="legend">
          <span class="sb sb-L">L</span>Left&nbsp;
          <span class="sb sb-R">R</span>Right&nbsp;
          <span class="gb gb-F">F</span>Female&nbsp;
          <span class="gb gb-M">M</span>Male&nbsp;
          <span class="excl-b">!</span>Excl
        </div>
        <div class="roster-list">${rosterHtml}</div>
      </div>
      <div class="main-area">
        <div class="team-tabs">
          ${tabsHtml}
          <div class="balance-toggle">
            <button class="bal-btn${state.showBalance ? ' active' : ''}" data-act="toggle-balance">Balance</button>
          </div>
        </div>
        <div class="boats-container">${boatsHtml}</div>
      </div>
    </div>`;
}

function specialSeatHtml(teamIdx, heatIdx, role, pid) {
  const label = role === 'drummer' ? 'DRUMMER' : 'STEERER';
  if (pid) {
    const p = getPaddler(pid);
    return `<div class="special-seat special-seat-filled" draggable="true"
        data-team="${teamIdx}" data-heat="${heatIdx}" data-role="${role}" data-pid="${pid}">
      <span class="special-label">${label}</span>
      <div class="seat-chip">
        <span class="chip-name-sm">${esc(p.name)}</span>
        <div class="chip-badges-sm">
          <span class="sb sb-${p.side_pref} sm">${p.side_pref}</span>

        </div>
      </div>
      <button class="remove-btn" data-act="remove-special"
        data-team="${teamIdx}" data-heat="${heatIdx}" data-role="${role}">×</button>
    </div>`;
  }
  return `<div class="special-seat special-seat-empty"
      data-team="${teamIdx}" data-heat="${heatIdx}" data-role="${role}">
    <span class="special-label">${label}</span>
    <span class="special-hint">Drop here</span>
  </div>`;
}

function boatHtml(teamIdx, heatIdx, heat) {
  const filled = heat.seats.filter(Boolean).length;

  const rowsHtml = Array.from({ length: 10 }, (_, row) => {
    const lIdx = row * 2, rIdx = row * 2 + 1;
    return `<div class="boat-row">
      ${seatHtml(teamIdx, heatIdx, lIdx, heat)}
      ${seatHtml(teamIdx, heatIdx, rIdx, heat)}
    </div>`;
  }).join('');

  const rowLabelsHtml = Array.from({ length: 10 }, (_, row) =>
    `<div class="row-label-item">R${row + 1}</div>`
  ).join('');

  const hasNext = heatIdx + 1 < state.teams[teamIdx].heats.length;
  const bal = boatBalance(heat.seats);
  const fb  = boatBalanceFrontBack(heat.seats, heat.drummerSeat, heat.steererSeat);
  const totalBal = bal.L + bal.R;
  const leftPct  = totalBal > 0 ? Math.round(bal.L / totalBal * 100) : 50;
  const rightPct = 100 - leftPct;
  const totalFB  = fb.F + fb.B;
  const frontPct = totalFB > 0 ? Math.round(fb.F / totalFB * 100) : 50;
  const backPct  = 100 - frontPct;

  return `<div class="boat-wrap">
  <div class="boat-card">
    <div class="boat-header">
      <span class="hlabel">Heat ${heatIdx + 1}</span>
      <span class="htime">${formatTime(heat.startTime)}</span>
      <span class="hcount">${filled}/20</span>
      <div class="boat-header-actions">
        ${hasNext ? `<button class="copy-btn" data-act="copy-heat" data-team="${teamIdx}" data-heat="${heatIdx}" title="Copy this lineup to Heat ${heatIdx + 2}">Copy → Heat ${heatIdx + 2}</button>` : ''}
        <button class="autofill-btn" data-act="auto-fill" data-team="${teamIdx}" data-heat="${heatIdx}">Auto-fill</button>
      </div>
    </div>
    <div class="boat-visual">
      ${state.showBalance ? `<div class="fb-bar-wrap">
        <div class="fb-end-label fb-label-F"><span class="fb-end-letter">F</span><span class="fb-end-val">${fb.F}</span></div>
        <div class="fb-bar-track">
          <div class="fb-bar-F" style="height:${frontPct}%"></div>
          <div class="fb-bar-B" style="height:${backPct}%"></div>
        </div>
        <div class="fb-end-label fb-label-B"><span class="fb-end-letter">B</span><span class="fb-end-val">${fb.B}</span></div>
      </div>` : ''}
      <div class="boat-body">
        <div class="boat-end drummer-row">
          ${specialSeatHtml(teamIdx, heatIdx, 'drummer', heat.drummerSeat)}
          <div class="side-labels"><span class="sl-L">◀ LEFT</span><span class="sl-R">RIGHT ▶</span></div>
        </div>
        <div class="boat-seats-row">
          <div class="row-labels-col">${rowLabelsHtml}</div>
          <div class="boat-seats">${rowsHtml}</div>
        </div>
        <div class="boat-end steerer-row">
          ${specialSeatHtml(teamIdx, heatIdx, 'steerer', heat.steererSeat)}
        </div>
      </div>
    </div>
    ${state.showBalance ? `<div class="balance-footer">
      <div class="balance-bar-wrap">
        <div class="balance-bar-L" style="width:${leftPct}%"></div>
        <div class="balance-bar-R" style="width:${rightPct}%"></div>
      </div>
      <div class="balance-row">
        <span class="bal-side-L">L: ${bal.L} kg</span>
        <span class="bal-label ${bal.cls}">${bal.label}</span>
        <span class="bal-side-R">R: ${bal.R} kg</span>
      </div>
    </div>` : ''}
  </div>
</div>`;
}

function seatHtml(teamIdx, heatIdx, seatIdx, heat) {
  const side = seatSide(seatIdx);
  const pid  = heat.seats[seatIdx];

  if (pid) {
    const p = getPaddler(pid);
    const actualPos = `${seatSide(seatIdx)}${seatRow(seatIdx)}`;
    const posMismatch = p.pref_pos && p.pref_pos !== actualPos;
    return `<div class="seat seat-${side} seat-filled${posMismatch ? ' seat-pos-mismatch' : ''}"
        data-team="${teamIdx}" data-heat="${heatIdx}" data-seat="${seatIdx}"
        draggable="true" data-pid="${pid}">
      <div class="seat-chip">
        <span class="chip-name-sm">${esc(p.name)}</span>
        <div class="chip-badges-sm">
          <span class="sb sb-${p.side_pref} sm">${p.side_pref}</span>

          ${p.pref_pos ? `<span class="pp-b sm" title="Prefers ${p.pref_pos}${posMismatch ? ` — seated at ${actualPos}` : ''}">${p.pref_pos}</span>` : ''}
        </div>
      </div>
      <button class="remove-btn" data-act="remove"
        data-team="${teamIdx}" data-heat="${heatIdx}" data-seat="${seatIdx}">×</button>
    </div>`;
  }

  return `<div class="seat seat-${side} seat-empty"
      data-team="${teamIdx}" data-heat="${heatIdx}" data-seat="${seatIdx}">
    <span class="seat-hint">${side}</span>
  </div>`;
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function render() {
  if      (state.page === 'home')     renderHome();
  else if (state.page === 'setup')    renderSetup();
  else if (state.page === 'paddlers') renderPaddlers();
  else                                renderPlanner();
}

// ── HOME PAGE ─────────────────────────────────────────────────────────────────
function renderHome() {
  document.getElementById('app').innerHTML = `
    <div class="home-page">
      <div class="home-hero">
        <div class="logo">Dragon Boat Festival Planner</div>
        <div class="sub">Plan your lineups, manage your roster, race day ready</div>
      </div>
      <div class="home-cards">
        <button class="home-card primary" data-act="new-festival">
          <div class="home-card-icon">+</div>
          <div class="home-card-title">Plan New Festival</div>
          <div class="home-card-desc">Start from scratch with a fresh configuration</div>
        </button>
        <button class="home-card" data-act="load">
          <div class="home-card-icon">↑</div>
          <div class="home-card-title">Load from File</div>
          <div class="home-card-desc">Resume a saved festival configuration</div>
        </button>
      </div>
    </div>`;
}

function restoreSnapshot(snap) {
  Object.assign(state, snap.state);
  state.festivalName = snap.state.festivalName || '';
  snap.paddlers.forEach(saved => {
    const p = getPaddler(saved.id);
    if (!p) return;
    p.participating = saved.participating;
    p.side_pref     = saved.side_pref;
    p.side_excl     = saved.side_excl;
    p.weight_kg     = saved.weight_kg;
    p.pref_pos      = saved.pref_pos ?? null;
    p.gender        = saved.gender ?? p.gender;
  });
}

// ── LAUNCH ────────────────────────────────────────────────────────────────────
function launchFestival() {
  const nameInp = document.querySelector('.festival-name-inp');
  if (nameInp) state.festivalName = nameInp.value.trim();

  document.querySelectorAll('.team-name-inp').forEach(inp => {
    const i = parseInt(inp.dataset.i);
    state.teamNames[i] = inp.value.trim() || `Team ${String.fromCharCode(65 + i)}`;
  });
  document.querySelectorAll('.start-time-inp').forEach(inp => {
    const h = parseInt(inp.dataset.h), t = parseInt(inp.dataset.t);
    state.startTimes[h][t] = inp.value;
  });

  // Rebuild teams, preserving existing seat assignments where structure matches
  state.teams = Array.from({ length: state.numTeams }, (_, ti) => {
    const existing = state.teams[ti];
    return {
      name: state.teamNames[ti] || `Team ${String.fromCharCode(65 + ti)}`,
      heats: Array.from({ length: state.numHeats }, (_, hi) => ({
        startTime:   state.startTimes[hi][ti],
        seats:       existing?.heats[hi]?.seats       ?? Array(20).fill(null),
        drummerSeat: existing?.heats[hi]?.drummerSeat ?? null,
        steererSeat: existing?.heats[hi]?.steererSeat ?? null,
      })),
    };
  });
  state.activeTeam = Math.min(state.activeTeam, state.numTeams - 1);
  state.page = 'planner';
  render();
}

// ── EVENTS ────────────────────────────────────────────────────────────────────
const app = document.getElementById('app');

app.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if      (act === 'inc-teams' && state.numTeams < 4) { state.numTeams++; render(); }
  else if (act === 'dec-teams' && state.numTeams > 1) { state.numTeams--; render(); }
  else if (act === 'inc-heats' && state.numHeats < 6) { state.numHeats++; render(); }
  else if (act === 'dec-heats' && state.numHeats > 1) { state.numHeats--; render(); }
  else if (act === 'new-festival') { resetState(); render(); }
  else if (act === 'save' || act === 'save-setup') { saveConfig(); }
  else if (act === 'load')        { loadConfig(); }
  else if (act === 'go-home')     { state.page = 'home'; render(); }
  else if (act === 'toggle-balance') { state.showBalance = !state.showBalance; render(); }
  else if (act === 'launch')      { launchFestival(); }
  else if (act === 'roster')      { state.page = 'paddlers'; render(); }
  else if (act === 'back-roster') { state.page = 'setup'; render(); }
  else if (act === 'back')        { state.page = 'setup'; render(); }
  else if (act === 'select-all')   { PADDLERS.forEach(p => { p.participating = true; });  render(); }
  else if (act === 'deselect-all') { PADDLERS.forEach(p => { p.participating = false; }); render(); }
  else if (act === 'tab') {
    state.activeTeam = parseInt(btn.dataset.ti);
    render();
  }
  else if (act === 'auto-fill') {
    showOptimizerModal(parseInt(btn.dataset.team), parseInt(btn.dataset.heat));
  }
  else if (act === 'copy-heat') {
    const ti = parseInt(btn.dataset.team), hi = parseInt(btn.dataset.heat);
    const src = state.teams[ti].heats[hi];
    const dst = state.teams[ti].heats[hi + 1];
    dst.seats       = [...src.seats];
    dst.drummerSeat = src.drummerSeat;
    dst.steererSeat = src.steererSeat;
    render();
  }
  else if (act === 'remove') {
    e.stopPropagation();
    const ti = parseInt(btn.dataset.team), hi = parseInt(btn.dataset.heat), si = parseInt(btn.dataset.seat);
    state.teams[ti].heats[hi].seats[si] = null;
    render();
  }
  else if (act === 'remove-special') {
    e.stopPropagation();
    const ti = parseInt(btn.dataset.team), hi = parseInt(btn.dataset.heat);
    const role = btn.dataset.role;
    if (role === 'drummer') state.teams[ti].heats[hi].drummerSeat = null;
    else                    state.teams[ti].heats[hi].steererSeat = null;
    render();
  }
});

app.addEventListener('change', e => {
  const pid = e.target.dataset.pid ? parseInt(e.target.dataset.pid) : null;
  const p = pid ? getPaddler(pid) : null;
  if (!p) return;

  if (e.target.classList.contains('part-chk')) {
    p.participating = e.target.checked;
    const row = e.target.closest('.pr');
    if (row) row.classList.toggle('pr-off', !p.participating);
    const attEl = document.getElementById('att-num');
    if (attEl) attEl.textContent = PADDLERS.filter(x => x.participating).length;
  }
  else if (e.target.classList.contains('side-sel'))   { p.side_pref  = e.target.value; }
  else if (e.target.classList.contains('excl-chk'))   { p.side_excl  = e.target.checked ? 1 : 0; }
  else if (e.target.classList.contains('weight-inp')) { p.weight_kg  = parseInt(e.target.value) || p.weight_kg; }
  else if (e.target.classList.contains('ppos-sel'))   { p.pref_pos   = e.target.value || null; }
  else if (e.target.classList.contains('gender-sel')) { p.gender     = e.target.value; }
});

app.addEventListener('input', e => {
  if (e.target.classList.contains('festival-name-inp')) {
    state.festivalName = e.target.value;
  }
  if (e.target.classList.contains('team-name-inp')) {
    state.teamNames[parseInt(e.target.dataset.i)] = e.target.value;
    document.querySelectorAll('.times-table th:not(:first-child)').forEach((th, i) => {
      th.textContent = state.teamNames[i] || `Team ${String.fromCharCode(65 + i)}`;
    });
  }
  if (e.target.classList.contains('start-time-inp')) {
    const h = parseInt(e.target.dataset.h), t = parseInt(e.target.dataset.t);
    if (!state.startTimes[h]) state.startTimes[h] = [];
    state.startTimes[h][t] = e.target.value;
  }
});

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
app.addEventListener('dragstart', e => {
  const specialEl = e.target.closest('.special-seat-filled[data-pid]');
  if (specialEl) {
    dragState = {
      paddlerId: parseInt(specialEl.dataset.pid),
      from: {
        teamIdx: parseInt(specialEl.dataset.team),
        heatIdx: parseInt(specialEl.dataset.heat),
        role:    specialEl.dataset.role,
      },
    };
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const seatEl = e.target.closest('.seat-filled[data-pid]');
  if (seatEl) {
    dragState = {
      paddlerId: parseInt(seatEl.dataset.pid),
      from: {
        teamIdx: parseInt(seatEl.dataset.team),
        heatIdx: parseInt(seatEl.dataset.heat),
        seatIdx: parseInt(seatEl.dataset.seat),
      },
    };
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const chipEl = e.target.closest('.roster-chip[data-pid]');
  if (chipEl) {
    dragState = { paddlerId: parseInt(chipEl.dataset.pid), from: 'roster' };
    e.dataTransfer.effectAllowed = 'copy';
  }
});

app.addEventListener('dragend', () => {
  dragState = null;
  if (dragOverEl) { dragOverEl.classList.remove('seat-drop-over'); dragOverEl = null; }
});

app.addEventListener('dragover', e => {
  const target = e.target.closest('.seat, .special-seat');
  if (target && dragState) {
    e.preventDefault();
    if (target !== dragOverEl) {
      if (dragOverEl) dragOverEl.classList.remove('seat-drop-over');
      target.classList.add('seat-drop-over');
      dragOverEl = target;
    }
  }
});

app.addEventListener('dragleave', e => {
  const target = e.target.closest('.seat, .special-seat');
  if (target && target === dragOverEl && !target.contains(e.relatedTarget)) {
    target.classList.remove('seat-drop-over');
    dragOverEl = null;
  }
});

app.addEventListener('drop', e => {
  e.preventDefault();
  if (!dragState) return;
  if (dragOverEl) { dragOverEl.classList.remove('seat-drop-over'); dragOverEl = null; }
  const { paddlerId, from } = dragState;
  const paddler = getPaddler(paddlerId);

  // ── Drop on special seat (drummer / steerer) ──────────────────────────────
  const specialEl = e.target.closest('.special-seat');
  if (specialEl) {
    specialEl.classList.remove('seat-drop-over');
    const teamIdx = parseInt(specialEl.dataset.team);
    const heatIdx = parseInt(specialEl.dataset.heat);
    const role    = specialEl.dataset.role;
    const heat    = state.teams[teamIdx].heats[heatIdx];

    if (from !== 'roster' && from.role === role && from.teamIdx === teamIdx && from.heatIdx === heatIdx) return;

    const currentOccupant = role === 'drummer' ? heat.drummerSeat : heat.steererSeat;
    if (currentOccupant !== null) {
      showToast(`${role === 'drummer' ? 'Drummer' : 'Steerer'} spot is already taken — remove that paddler first.`);
      return;
    }

    const excludeSlot = from !== 'roster' ? from : null;
    if (hasTimeConflict(paddlerId, heat.startTime, excludeSlot)) {
      showToast(`${paddler.name} is already in a heat within 20 minutes of ${formatTime(heat.startTime)}.`);
      return;
    }

    clearFromSlot(from);
    if (role === 'drummer') heat.drummerSeat = paddlerId;
    else                    heat.steererSeat = paddlerId;
    dragState = null;
    render();
    return;
  }

  // ── Drop on regular seat ──────────────────────────────────────────────────
  const seatEl = e.target.closest('.seat');
  if (!seatEl) return;
  seatEl.classList.remove('seat-drop-over');

  const teamIdx = parseInt(seatEl.dataset.team);
  const heatIdx = parseInt(seatEl.dataset.heat);
  const seatIdx = parseInt(seatEl.dataset.seat);
  const side    = seatSide(seatIdx);
  const heat    = state.teams[teamIdx].heats[heatIdx];

  if (from !== 'roster' && !from.role &&
      from.teamIdx === teamIdx && from.heatIdx === heatIdx && from.seatIdx === seatIdx) return;

  if (paddler.side_excl && paddler.side_pref !== side) {
    showToast(`${paddler.name} is exclusive to the ${paddler.side_pref === 'L' ? 'LEFT' : 'RIGHT'} side and cannot be placed here.`);
    return;
  }

  if (heat.seats[seatIdx] !== null) {
    showToast(`Row ${seatRow(seatIdx)} ${side}-side is already taken — remove that paddler first.`);
    return;
  }

  const excludeSlot = from !== 'roster' ? from : null;
  if (hasTimeConflict(paddlerId, heat.startTime, excludeSlot)) {
    showToast(`${paddler.name} is already in a heat within 20 minutes of ${formatTime(heat.startTime)}.`);
    return;
  }

  clearFromSlot(from);
  heat.seats[seatIdx] = paddlerId;
  dragState = null;
  render();
});

function clearFromSlot(from) {
  if (from === 'roster') return;
  const h = state.teams[from.teamIdx].heats[from.heatIdx];
  if (from.role === 'drummer')      h.drummerSeat = null;
  else if (from.role === 'steerer') h.steererSeat = null;
  else                              h.seats[from.seatIdx] = null;
}

// ── OPTIMIZER MODAL ───────────────────────────────────────────────────────────
const DEFAULT_PRIORITIES = () => [
  { key: 'balance',  label: 'Left / Right Balance',  enabled: true  },
  { key: 'side_pref', label: 'Side Preference',       enabled: true  },
  { key: 'pref_pos',  label: 'Preferred Position',    enabled: false },
  { key: 'gender',    label: 'Gender Distribution',   enabled: false },
];
const DEFAULT_GENDER_TARGETS = () => ({ males: 4, females: 16 });

function showOptimizerModal(teamIdx, heatIdx) {
  modalState = {
    teamIdx,
    heatIdx,
    lockExisting: true,
    priorities: DEFAULT_PRIORITIES(),
    genderTargets: DEFAULT_GENDER_TARGETS(),
    result: null,
  };
  renderOptimizerModal();
}

function closeOptimizerModal() {
  const el = document.getElementById('optimizer-modal');
  if (el) el.remove();
  modalState = null;
}

function renderOptimizerModal() {
  let el = document.getElementById('optimizer-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'optimizer-modal';
    document.body.appendChild(el);
  }
  el.innerHTML = buildOptimizerModalHtml();

  // Wire up checkboxes (change events don't bubble well through data-act pattern)
  el.querySelectorAll('.opt-chk').forEach(chk => {
    chk.addEventListener('change', e => {
      modalState.priorities[parseInt(e.target.dataset.idx)].enabled = e.target.checked;
      modalState.result = null;
      renderOptimizerModal();
    });
  });
  el.querySelector('.opt-lock-chk')?.addEventListener('change', e => {
    modalState.lockExisting = e.target.checked;
    modalState.result = null;
    renderOptimizerModal();
  });
  el.querySelectorAll('.opt-gender-num').forEach(inp => {
    inp.addEventListener('change', e => {
      const val = Math.max(0, Math.min(20, parseInt(e.target.value) || 0));
      modalState.genderTargets[e.target.dataset.g] = val;
      modalState.result = null;
      // update value without full re-render to avoid losing focus
      e.target.value = val;
    });
  });
}

function buildOptimizerModalHtml() {
  const { teamIdx, heatIdx, priorities, lockExisting, result } = modalState;
  const team = state.teams[teamIdx];
  const heat = team.heats[heatIdx];
  const existingCount = heat.seats.filter(Boolean).length;

  // Compute display rank (only count enabled items)
  let rankCounter = 0;
  const rows = priorities.map((pr, i) => {
    const displayRank = pr.enabled ? ++rankCounter : '—';
    const extra = pr.key === 'gender' && pr.enabled ? `
      <div class="opt-gender-inputs">
        <label>M <input type="number" class="opt-gender-num" data-g="males"   value="${modalState.genderTargets.males}"   min="0" max="20"></label>
        <label>F <input type="number" class="opt-gender-num" data-g="females" value="${modalState.genderTargets.females}" min="0" max="20"></label>
      </div>` : '';
    return `
      <div class="opt-priority-row${pr.key === 'gender' && pr.enabled ? ' opt-priority-row-expanded' : ''}">
        <div class="opt-priority-main">
          <span class="opt-rank${pr.enabled ? '' : ' opt-rank-off'}">${displayRank}</span>
          <span class="opt-pr-label">${esc(pr.label)}</span>
          <div class="opt-pr-actions">
            <button class="opt-arr" data-act="opt-up"   data-idx="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="opt-arr" data-act="opt-down" data-idx="${i}" ${i === priorities.length - 1 ? 'disabled' : ''}>↓</button>
            <label class="opt-toggle-wrap">
              <input type="checkbox" class="opt-chk" data-idx="${i}" ${pr.enabled ? 'checked' : ''}>
              <span class="opt-toggle-label">${pr.enabled ? 'On' : 'Off'}</span>
            </label>
          </div>
        </div>
        ${extra}
      </div>`;
  }).join('');

  const resultHtml = result ? `
    <div class="opt-result-box ${result.feasible ? 'opt-res-ok' : 'opt-res-err'}">
      <div class="opt-res-msg">${esc(result.message)}</div>
      ${result.feasible ? `
        <div class="opt-res-stats">
          <span class="bal-label ${result.balanceCls}">${esc(result.balanceLabel)}</span>
          <span class="opt-res-weight">L: ${result.balL} kg &nbsp;|&nbsp; R: ${result.balR} kg</span>
        </div>
        <div class="opt-res-stats">
          <span class="opt-res-gender"><span class="gb gb-M">M</span> ${result.maleCount} &nbsp; <span class="gb gb-F">F</span> ${result.femaleCount}</span>
        </div>` : ''}
    </div>` : '';

  return `
    <div class="opt-overlay">
      <div class="opt-modal-box">
        <div class="opt-modal-header">
          <h3>Auto-fill — ${esc(team.name)} · Heat ${heatIdx + 1}</h3>
          <button class="opt-close-btn" data-act="opt-close">×</button>
        </div>
        <div class="opt-modal-body">

          <div class="opt-section">
            <div class="opt-section-title">Priorities</div>
            <div class="opt-section-desc">Rank by importance using the arrows. Toggle each on or off.</div>
            <div class="opt-priorities">${rows}</div>
          </div>

          <div class="opt-section">
            <div class="opt-section-title">Existing Paddlers</div>
            <label class="opt-lock-label">
              <input type="checkbox" class="opt-lock-chk" ${lockExisting ? 'checked' : ''}>
              Keep paddlers already seated in this heat
            </label>
            ${existingCount > 0
              ? `<div class="opt-hint">${existingCount} paddler${existingCount !== 1 ? 's' : ''} currently seated</div>`
              : '<div class="opt-hint">No paddlers seated yet</div>'}
          </div>

          ${resultHtml}
        </div>

        <div class="opt-modal-footer">
          <button class="opt-btn-secondary" data-act="opt-close">Cancel</button>
          <button class="opt-btn-primary"   data-act="opt-run">Optimise</button>
          ${result?.feasible ? `<button class="opt-btn-apply" data-act="opt-apply">Apply →</button>` : ''}
        </div>
      </div>
    </div>`;
}

// Modal click handler (document-level so it catches the overlay too)
document.addEventListener('click', e => {
  if (!modalState) return;

  // Close on overlay background click
  if (e.target.classList.contains('opt-overlay')) { closeOptimizerModal(); return; }

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === 'opt-close') { closeOptimizerModal(); return; }

  if (act === 'opt-up') {
    const i = parseInt(btn.dataset.idx);
    if (i > 0) {
      [modalState.priorities[i - 1], modalState.priorities[i]] =
      [modalState.priorities[i],     modalState.priorities[i - 1]];
      modalState.result = null;
      renderOptimizerModal();
    }
    return;
  }

  if (act === 'opt-down') {
    const i = parseInt(btn.dataset.idx);
    if (i < modalState.priorities.length - 1) {
      [modalState.priorities[i], modalState.priorities[i + 1]] =
      [modalState.priorities[i + 1], modalState.priorities[i]];
      modalState.result = null;
      renderOptimizerModal();
    }
    return;
  }

  if (act === 'opt-run') {
    modalState.result = optimizeLineup(modalState.teamIdx, modalState.heatIdx, {
      lockExisting:  modalState.lockExisting,
      priorities:    modalState.priorities,
      genderTargets: modalState.genderTargets,
    });
    renderOptimizerModal();
    return;
  }

  if (act === 'opt-apply' && modalState.result?.feasible) {
    state.teams[modalState.teamIdx].heats[modalState.heatIdx].seats = modalState.result.seats;
    closeOptimizerModal();
    render();
    return;
  }
});

// ── SAVE / LOAD ───────────────────────────────────────────────────────────────
function buildSnapshot() {
  return {
    state: {
      page:         state.page,
      festivalName: state.festivalName,
      numTeams:     state.numTeams,
      numHeats:     state.numHeats,
      teamNames:    state.teamNames,
      startTimes:   state.startTimes,
      teams: state.teams.map(t => ({
        ...t,
        heats: t.heats.map(h => ({ ...h })),
      })),
      activeTeam:   state.activeTeam,
    },
    paddlers: PADDLERS.map(p => ({
      id:            p.id,
      participating: p.participating,
      side_pref:     p.side_pref,
      side_excl:     p.side_excl,
      weight_kg:     p.weight_kg,
      pref_pos:      p.pref_pos ?? null,
      gender:        p.gender,
    })),
  };
}

async function saveConfig() {
  // Capture any unsaved setup-screen inputs before saving
  const nameInp = document.querySelector('.festival-name-inp');
  if (nameInp) state.festivalName = nameInp.value.trim();
  document.querySelectorAll('.team-name-inp').forEach(inp => {
    state.teamNames[parseInt(inp.dataset.i)] = inp.value.trim() || `Team ${String.fromCharCode(65 + parseInt(inp.dataset.i))}`;
  });
  document.querySelectorAll('.start-time-inp').forEach(inp => {
    const h = parseInt(inp.dataset.h), t = parseInt(inp.dataset.t);
    if (!state.startTimes[h]) state.startTimes[h] = [];
    state.startTimes[h][t] = inp.value;
  });

  const json = JSON.stringify(buildSnapshot(), null, 2);
  const suggestedName = (state.festivalName || 'festival').replace(/[^a-z0-9_\- ]/gi, '_') + '.json';

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Festival JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      showToast('Festival saved!', 'ok');
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Save failed — ' + e.message);
    }
  } else {
    // Fallback for Safari / Firefox
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Festival saved!', 'ok');
  }
}

function loadConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        restoreSnapshot(JSON.parse(ev.target.result));
        state.page = 'planner';
        render();
        showToast('Festival loaded!', 'ok');
      } catch {
        showToast('Invalid file — could not load configuration.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── INIT ──────────────────────────────────────────────────────────────────────
function resetState() {
  PADDLERS.forEach(p => {
    p.participating = true;
    // reset to original data.js values isn't possible once mutated,
    // so just mark all as participating and leave attributes as-is
  });
  state.page        = 'setup';
  state.festivalName = '';
  state.numTeams  = 2;
  state.numHeats  = 3;
  state.teamNames = ['Team A', 'Team B', 'Team C', 'Team D'];
  state.startTimes = [];
  state.teams     = [];
  state.activeTeam = 0;
  ensureStartTimes();
}

PADDLERS.forEach(p => { p.participating = true; });
ensureStartTimes();
state.page = 'home';
render();
