// Exact reachability for Ridge Run: what can a player still do, rather than what one bot managed.
//
// A planning bot failing a course proves only that the bot failed. This carries the whole set of states the vial
// could be in — height and vertical speed — forward through the real physics at the real step, branching on tap or
// no tap every tick and dropping anything that hits glass or the ground. If the set is still non-empty past a gate,
// a line through it exists. If it empties, nobody could have got through, however well they played.
//
// States are bucketed so the set stays small: two states close in height and speed reach the same places, so only
// one per bucket is carried. The buckets are coarse, which makes this slightly optimistic at the margins, so the
// generator asks for a minimum set size rather than merely a non-empty one.
//
// The hot loop runs on reused flat arrays with a stamped bucket table. Allocating a Map per tick made a gate cost
// about 18ms, which is far too slow to run while gates are being dealt during play.
import {SIM_STEP} from './rng.js';

export const REACH = Object.freeze({Y: 4, VY: 40, MAX: 6144});

const YB = 160, VB = 64, VOFF = 16;            // bucket counts for height and speed, and the speed bucket offset
const BUCKETS = YB * VB;
let curY = new Float64Array(REACH.MAX), curV = new Float64Array(REACH.MAX);
let nxtY = new Float64Array(REACH.MAX), nxtV = new Float64Array(REACH.MAX);
const stamp = new Int32Array(BUCKETS);
let era = 0;

// The run begins on the first tap, which is also when the course starts scrolling.
export const reachStart = C => [{y: 300, vy: -C.FLAP}];

const load = states => {
  const n = Math.min(states.length, REACH.MAX);
  for (let i = 0; i < n; i++) { curY[i] = states[i].y; curV[i] = states[i].vy; }
  return n;
};
const dump = n => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = {y: curY[i], vy: curV[i]}; return out; };

// One tick of the real physics, both branches. A tap replaces the vertical speed and then gravity applies, exactly
// as the engine orders it: action() sets vy, the next step() adds gravity before moving.
// One tick of the real physics, both branches. A tap replaces the vertical speed and then gravity applies,
// exactly as the engine orders it: action() sets vy, the next step() adds gravity before moving.
// The column geometry depends only on the moment, not on where the vial is, so it is worked out once a tick
// rather than once per state. Doing it per state cost about 23ms a gate, nearly all of it in sin().
// The glass only forbids a band of heights, and the test is monotonic: the further the vial is from a column the
// safer it is. So each tick the free band is found once by bisection and every state is then two comparisons.
// Asking hitsVial per state cost about 22ms a gate, almost all of it in those calls.
function freeBand(col, C, cx, top, bottom) {
  const R = C.R, px = col.px, hits = col.hits;
  // Highest safe point: bisect between the ceiling (likely blocked by the upper column) and the opening centre.
  const mid = (top + bottom) / 2;
  let lo = R, hi = mid;
  if (!hits(px, lo, R, cx, top, -1)) hi = lo;
  else { for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (hits(px, m, R, cx, top, -1)) lo = m; else hi = m; } }
  const yLo = hi;
  // Lowest safe point, the same way against the lower column.
  let lo2 = mid, hi2 = C.GROUND - R;
  if (!hits(px, hi2, R, cx, bottom, 1)) lo2 = hi2;
  else { for (let k = 0; k < 14; k++) { const m = (lo2 + hi2) / 2; if (hits(px, m, R, cx, bottom, 1)) hi2 = m; else lo2 = m; } }
  return {yLo, yHi: lo2};
}

// One tick of the real physics, both branches. A tap replaces the vertical speed and then gravity applies,
// exactly as the engine orders it: action() sets vy, the next step() adds gravity before moving.
function stepAll(n, C, t, col) {
  era++;
  let m = 0;
  const dt = SIM_STEP, g = C.GRAVITY * dt, flap = -C.FLAP, R = C.R, ground = C.GROUND, tNext = t + dt;
  let inCol = false, yLo = 0, yHi = 0;
  if (col !== null) {
    const x = col.px + (col.gate.t - tNext) * col.speed;
    inCol = col.px + R > x && col.px - R < x + C.PW;
    if (inCol) {
      const cy = col.gate.gy + col.gate.amp * Math.sin(col.gate.phase + col.gate.rate * tNext);
      const band = freeBand(col, C, x + C.PW / 2, cy - col.half, cy + col.half);
      yLo = band.yLo; yHi = band.yHi;
    }
  }
  for (let i = 0; i < n; i++) {
    const y0 = curY[i], v0 = curV[i];
    for (let tap = 0; tap < 2; tap++) {
      let vy = (tap ? flap : v0) + g;
      let y = y0 + vy * dt;
      if (y < R) { y = R; vy = 0; }
      if (y + R > ground) continue;
      if (inCol && (y < yLo || y > yHi)) continue;
      let yb = (y / REACH.Y) | 0; if (yb < 0) yb = 0; else if (yb >= YB) yb = YB - 1;
      let vb = ((vy / REACH.VY) | 0) + VOFF; if (vb < 0) vb = 0; else if (vb >= VB) vb = VB - 1;
      const b = yb * VB + vb;
      if (stamp[b] === era) continue;
      stamp[b] = era;
      if (m < REACH.MAX) { nxtY[m] = y; nxtV[m] = vy; m++; }
    }
  }
  const ty = curY, tv = curV; curY = nxtY; curV = nxtV; nxtY = ty; nxtV = tv;
  return m;
}

export function reachAdvance(states, C, from, to, col) {
  let n = load(states);
  for (let t = from; t < to - 1e-9 && n > 0; t += SIM_STEP) n = stepAll(n, C, t, col ?? null);
  return dump(n);
}

export const gateWindow = (gate, C, speed) => ({from: gate.t - (C.R + 2) / speed, to: gate.t + (C.R + C.PW + 2) / speed});

// Carry the set from wherever it is to the far side of `gate`.
export function reachThroughGate(states, gate, C, speed, px, hitsVial, fromT) {
  const w = gateWindow(gate, C, speed);
  const air = fromT < w.from ? reachAdvance(states, C, fromT, w.from, null) : states;
  if (!air.length) return {states: air, t: w.from};
  const col = {gate, speed, px, hits: hitsVial, half: gate.gap / 2};
  return {states: reachAdvance(air, C, w.from, w.to, col), t: w.to};
}