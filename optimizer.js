// optimizer.js — linear programming seat assignment
// Requires window.solver (jsLPSolver) to be loaded before this file.
//
// Decision variables: x_{paddlerId}_{seatIdx} ∈ {0,1}
//
// Hard constraints:
//   1. Σᵢ x[i][j] ≤ 1  for each seat j      (one paddler per seat)
//   2. Σⱼ x[i][j] ≤ 1  for each paddler i   (one seat per paddler)
//   3. Side exclusivity — variables simply not created for forbidden sides
//   4. Time conflicts  — paddlers excluded from candidate pool
//
// Soft objective (weighted by user-ranked priorities):
//   balance   → minimize |L_weight − R_weight| via auxiliary var d
//   side_pref → maximise count of paddlers on their preferred side
//   pref_pos  → maximise count of paddlers at their preferred position
//   gender    → maximise count of male paddlers (minority in this roster)

function optimizeLineup(teamIdx, heatIdx, options) {
  if (typeof solver === 'undefined') {
    return { feasible: false, seats: null, message: 'Solver library not loaded — check your internet connection.' };
  }

  const { lockExisting, priorities, genderTargets } = options;
  const heat = state.teams[teamIdx].heats[heatIdx];

  // ── Candidate pool ────────────────────────────────────────────────────────
  // Attending paddlers with no time conflict against this heat
  const candidates = PADDLERS.filter(p => {
    if (!p.participating) return false;
    const others = getAssignments(p.id).filter(a =>
      !(a.teamIdx === teamIdx && a.heatIdx === heatIdx)
    );
    return !others.some(a =>
      Math.abs(timeToMin(a.startTime) - timeToMin(heat.startTime)) < 20
    );
  });

  // ── Locked vs free seats ──────────────────────────────────────────────────
  const lockedSeats = {}; // seatIdx → paddlerId
  const freeSeats   = [];
  for (let j = 0; j < 20; j++) {
    if (lockExisting && heat.seats[j] !== null) lockedSeats[j] = heat.seats[j];
    else freeSeats.push(j);
  }

  if (freeSeats.length === 0) {
    return { feasible: true, seats: [...heat.seats], message: 'All seats are locked — nothing to optimise.' };
  }

  const lockedPaddlerIds = new Set(Object.values(lockedSeats));
  const freeCandidates   = candidates.filter(p => !lockedPaddlerIds.has(p.id));

  if (freeCandidates.length === 0) {
    return { feasible: false, seats: null, message: 'No eligible paddlers available for the free seats.' };
  }

  // ── Priority weights ──────────────────────────────────────────────────────
  // Exponential so rank 1 always dominates rank 2 regardless of score scale
  const RANK_WEIGHTS = [100000, 10000, 1000, 100];
  const wt = {};
  let rank = 0;
  for (const pr of priorities) {
    wt[pr.key] = pr.enabled ? RANK_WEIGHTS[rank++] : 0;
  }

  // ── Locked-seat balance offsets ───────────────────────────────────────────
  let lockedL = 0, lockedR = 0;
  for (const [j, pid] of Object.entries(lockedSeats)) {
    const p = getPaddler(pid);
    if (seatSide(parseInt(j)) === 'L') lockedL += p.weight_kg;
    else                                lockedR += p.weight_kg;
  }

  // ── Build LP model ────────────────────────────────────────────────────────
  const model = {
    optimize:    'obj',
    opType:      'max',
    constraints: {},
    variables:   {},
    ints:        {},
  };

  // Constraint 1: one paddler per seat
  for (const j of freeSeats) {
    model.constraints[`seat_${j}`] = { max: 1 };
  }

  // Constraint 2: one seat per paddler
  for (const p of freeCandidates) {
    model.constraints[`paddler_${p.id}`] = { max: 1 };
  }

  // Balance auxiliary constraints (linearisation of |newL − newR|):
  //   (newL − newR) − d ≤ lockedR − lockedL   →  bal_pos
  //   (newR − newL) − d ≤ lockedL − lockedR   →  bal_neg
  if (wt.balance > 0) {
    model.constraints['bal_pos'] = { max: lockedR - lockedL };
    model.constraints['bal_neg'] = { max: lockedL - lockedR };
  }

  // Gender target constraints (linearisation of |assigned_M − target_M| and |assigned_F − target_F|):
  //   assigned_M − dm ≤ target_M   →  gm_pos
  //   target_M − assigned_M − dm ≤ 0  →  gm_neg  (i.e. -(assigned_M) - dm ≤ -target_M)
  // Same pattern for females.
  const targetM = genderTargets?.males   ?? 0;
  const targetF = genderTargets?.females ?? 0;
  if (wt.gender > 0) {
    model.constraints['gm_pos'] = { max:  targetM };
    model.constraints['gm_neg'] = { max: -targetM };
    model.constraints['gf_pos'] = { max:  targetF };
    model.constraints['gf_neg'] = { max: -targetF };
  }

  // ── Decision variables ────────────────────────────────────────────────────
  for (const p of freeCandidates) {
    for (const j of freeSeats) {
      const side = seatSide(j);

      // Constraint 3: hard side exclusivity
      if (p.side_excl && p.side_pref !== side) continue;

      const name = `x_${p.id}_${j}`;

      let objCoeff = 0;
      if (wt.side_pref && p.side_pref === side)                        objCoeff += wt.side_pref;
      if (wt.pref_pos  && p.pref_pos && p.pref_pos === seatZone(j))   objCoeff += wt.pref_pos;

      const v = { obj: objCoeff, [`seat_${j}`]: 1, [`paddler_${p.id}`]: 1 };

      if (wt.balance > 0) {
        const w = p.weight_kg;
        if (side === 'L') { v.bal_pos =  w; v.bal_neg = -w; }
        else              { v.bal_pos = -w; v.bal_neg =  w; }
      }

      if (wt.gender > 0) {
        if (p.gender === 'M') { v.gm_pos =  1; v.gm_neg = -1; }
        else                  { v.gf_pos =  1; v.gf_neg = -1; }
      }

      model.variables[name] = v;
      model.ints[name]      = 1;
    }
  }

  // Auxiliary variable d: imbalance in kg (minimised via -wt.balance penalty)
  if (wt.balance > 0) {
    model.variables['d'] = { obj: -wt.balance, bal_pos: -1, bal_neg: -1 };
  }

  // Auxiliary variables dm, df: deviation from gender targets (minimised via -wt.gender penalty)
  if (wt.gender > 0) {
    model.variables['dm'] = { obj: -wt.gender, gm_pos: -1, gm_neg: -1 };
    model.variables['df'] = { obj: -wt.gender, gf_pos: -1, gf_neg: -1 };
  }

  // ── Solve ─────────────────────────────────────────────────────────────────
  const result = solver.Solve(model);

  if (!result.feasible) {
    return {
      feasible: false,
      seats: null,
      message: 'No feasible solution found. Not enough eligible paddlers to satisfy all hard constraints.',
    };
  }

  // ── Extract assignments ───────────────────────────────────────────────────
  const newSeats = lockExisting ? [...heat.seats] : Array(20).fill(null);

  for (const [key, val] of Object.entries(result)) {
    if (!key.startsWith('x_') || val < 0.5) continue;
    const parts = key.split('_');
    const pid   = parseInt(parts[1]);
    const j     = parseInt(parts[2]);
    newSeats[j] = pid;
  }

  const placed  = newSeats.filter(Boolean).length;
  const bal     = boatBalance(newSeats);
  const maleCount   = newSeats.filter(pid => pid && getPaddler(pid)?.gender === 'M').length;
  const femaleCount = newSeats.filter(pid => pid && getPaddler(pid)?.gender === 'F').length;

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = [];

  const availableM = freeCandidates.filter(p => p.gender === 'M').length;
  const availableF = freeCandidates.filter(p => p.gender === 'F').length;
  const totalMale   = PADDLERS.filter(p => p.participating && p.gender === 'M').length;
  const totalFemale = PADDLERS.filter(p => p.participating && p.gender === 'F').length;
  const conflictedM = totalMale   - availableM - [...lockedPaddlerIds].filter(id => getPaddler(id)?.gender === 'M').length;
  const conflictedF = totalFemale - availableF - [...lockedPaddlerIds].filter(id => getPaddler(id)?.gender === 'F').length;

  if (wt.gender > 0) {
    const targetM = genderTargets?.males   ?? 0;
    const targetF = genderTargets?.females ?? 0;
    if (maleCount < targetM) {
      const reason = availableM < targetM
        ? `only ${availableM} male${availableM !== 1 ? 's' : ''} available${conflictedM > 0 ? ` (${conflictedM} excluded due to time conflicts)` : ''}`
        : 'balance or side constraints prevented placing more';
      warnings.push(`Could only place ${maleCount}/${targetM} males — ${reason}.`);
    }
    if (femaleCount < targetF) {
      const reason = availableF < targetF
        ? `only ${availableF} female${availableF !== 1 ? 's' : ''} available${conflictedF > 0 ? ` (${conflictedF} excluded due to time conflicts)` : ''}`
        : 'balance or side constraints prevented placing more';
      warnings.push(`Could only place ${femaleCount}/${targetF} females — ${reason}.`);
    }
  }

  if (wt.side_pref > 0) {
    const wrongSide = newSeats.reduce((count, pid, seat) => {
      if (!pid) return count;
      const p = getPaddler(pid);
      return p.side_pref !== seatSide(seat) ? count + 1 : count;
    }, 0);
    if (wrongSide > 0) {
      warnings.push(`${wrongSide} paddler${wrongSide !== 1 ? 's' : ''} placed on non-preferred side to achieve balance.`);
    }
  }

  if (wt.pref_pos > 0) {
    const wrongZone = newSeats.reduce((count, pid, seat) => {
      if (!pid) return count;
      const p = getPaddler(pid);
      if (!p.pref_pos) return count;
      return p.pref_pos !== seatZone(seat) ? count + 1 : count;
    }, 0);
    if (wrongZone > 0) {
      warnings.push(`${wrongZone} paddler${wrongZone !== 1 ? 's' : ''} placed outside their preferred zone.`);
    }
  }

  if (placed < freeSeats.length) {
    const shortfall = freeSeats.length - placed;
    const totalConflicted = conflictedM + conflictedF;
    warnings.push(`${shortfall} seat${shortfall !== 1 ? 's' : ''} left empty — not enough eligible paddlers${totalConflicted > 0 ? ` (${totalConflicted} excluded due to time conflicts)` : ''}.`);
  }

  return {
    feasible:     true,
    seats:        newSeats,
    balanceLabel: bal.label,
    balanceCls:   bal.cls,
    balL:         bal.L,
    balR:         bal.R,
    placed,
    maleCount,
    femaleCount,
    warnings,
    message:      `Placed ${placed} paddler${placed !== 1 ? 's' : ''} across ${freeSeats.length} free seat${freeSeats.length !== 1 ? 's' : ''}.`,
  };
}
