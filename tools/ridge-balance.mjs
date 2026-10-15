#!/usr/bin/env node
// Practice bots for Ridge Run, used to measure the difficulty curve instead of guessing at it.
//
//   node tools/ridge-balance.mjs [--seeds 300] [--version 5] [--bot weak,average,strong] [--json]
//
// Each bot plays real runs through RidgeEngine with real taps, so the numbers are what the shipped course
// does. They differ only in how late they react and how shaky their timing is, which is the part of Flappy
// Bird that separates players: the course is the same, the hands are not.
import {SIM_STEP, createRandom} from '../dist/rng.js';

const noop = () => {};
function installStubs() {
  globalThis.window ??= {devicePixelRatio: 1};
  globalThis.requestAnimationFrame ??= () => 0;
  globalThis.cancelAnimationFrame ??= () => {};
  globalThis.Image ??= class { complete = false; naturalWidth = 0; };
}
function stubCanvas(view) {
  const ctx = new Proxy({}, {get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true)});
  return {view, getContext: () => ctx, getBoundingClientRect() { return {width: this.view[0], height: this.view[1], left: 0, top: 0}; }, addEventListener: noop, removeEventListener: noop, setPointerCapture: noop};
}
const quietCb = {hud: noop, message: noop, sound: noop, effect: noop, progress: noop, ready: noop, topTier: noop, place: noop, haptic: noop, end: noop};

// Reaction lag in ticks, and how shaky the aim is in world units.
// How late the hand is, how much that lateness wobbles, and how precisely the eye picks the line. The spec for
// these bots is a reaction time with timing noise, so the wobble lives in the delay, not in the aim.
const PROFILES = {
  weak: {lagMs: 180, jitterMs: 60, aim: 12, lookAhead: false},
  average: {lagMs: 120, jitterMs: 40, aim: 7, lookAhead: false},
  strong: {lagMs: 60, jitterMs: 20, aim: 3, lookAhead: true},
};

// Box-Muller, so the timing noise is normal rather than a flat band.
function gaussian(rand) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Where the bot wants to be: the centre of the gate it is about to thread, nudged toward the one after it for a
// player who reads ahead. The aim wanders by `noise`, which is what being bad at the game actually looks like.
function aimFor(e, RIDGE, profile, rand) {
  const ahead = e.gates.filter(g => g.x + RIDGE.PW > e.px - RIDGE.R);
  const next = ahead[0];
  if (!next) return RIDGE.GROUND / 2;
  let target = next.cy;
  if (profile.lookAhead && ahead[1]) {
    // Start drifting toward the following gate once this one is close, so the strong bot sets up its approach.
    const closeness = Math.max(0, Math.min(1, (RIDGE.SPACE - (next.x - e.px)) / RIDGE.SPACE));
    target = next.cy * (1 - closeness * .35) + ahead[1].cy * (closeness * .35);
  }
  return target + gaussian(rand) * profile.aim;
}

async function playRun(RidgeEngine, RIDGE, seed, profileName, version) {
  const profile = PROFILES[profileName];
  const rand = createRandom((seed ^ 0x5bf03635) >>> 0);
  const e = new RidgeEngine(stubCanvas([480, 720]), quietCb, {seed, motion: false, version});
  const baseLag = Math.max(1, (profile.lagMs / 1000) / SIM_STEP);
  const jitter = (profile.jitterMs / 1000) / SIM_STEP;
  // A hand can only tap so fast; without this the bot taps every tick the vial is low and rockets into the ceiling.
  const TAP_GAP = 9, RISING = .35;
  let pendingAt = -1, lastTap = -99, guard = 0;
  // The first tap starts the run; after that the bot flies.
  e.action();
  while (!e.ended && guard++ < 120 * 60 * 10) {
    const target = aimFor(e, RIDGE, profile, rand);
    const want = e.py > target && e.vy > -RIDGE.FLAP * RISING;
    // A player notices once and then taps a beat late, and how late varies. Re-rolling the delay every tick is
    // not timing noise, it is a randomised hand, and it makes every bot look equally hopeless.
    if (want && pendingAt < 0 && e.ticks - lastTap >= TAP_GAP) {
      pendingAt = e.ticks + Math.max(1, Math.round(baseLag + gaussian(rand) * jitter));
    }
    if (pendingAt >= 0 && e.ticks >= pendingAt) {
      if (!e.dead) { e.action(); lastTap = e.ticks; }
      pendingAt = -1;
    }
    e.step(SIM_STEP);
  }
  const gates = e.gatesPassed;
  e.destroy();
  return {gates, score: e.score};
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

function summarise(runs) {
  const gates = runs.map(r => r.gates);
  return {
    runs: runs.length,
    medGates: quantile(gates, .5),
    p90Gates: quantile(gates, .9),
    shortPct: Math.round((runs.filter(r => r.gates < 5).length / runs.length) * 1000) / 10,
  };
}

async function main() {
  installStubs();
  const args = process.argv.slice(2);
  const flag = (name, fallback) => { const at = args.indexOf(`--${name}`); return at === -1 ? fallback : args[at + 1]; };
  const seeds = Number(flag('seeds', 300));
  const version = Number(flag('version', 5));
  const names = String(flag('bot', 'weak,average,strong')).split(',');
  const asJson = args.includes('--json');

  const {RidgeEngine, RIDGE} = await import('../dist/tryout-games.js');
  const table = {};
  for (const name of names) {
    const runs = [];
    for (let i = 0; i < seeds; i++) runs.push(await playRun(RidgeEngine, RIDGE, (i * 2654435761) >>> 0, name, version));
    table[name] = summarise(runs);
  }
  if (asJson) { console.log(JSON.stringify({version, seeds, table}, null, 1)); return; }

  console.log(`Ridge Run balance — ${seeds} seeds per bot, course v${version}`);
  console.log('bot      | med gates | p90 gates | runs ending before gate 5');
  console.log('---------|-----------|-----------|--------------------------');
  for (const [name, s] of Object.entries(table)) {
    console.log(`${name.padEnd(8)} | ${String(s.medGates).padStart(9)} | ${String(s.p90Gates).padStart(9)} | ${String(s.shortPct + '%').padStart(25)}`);
  }
  const st = table.strong;
  if (st) console.log(`\nstrong p90/med ${(st.p90Gates / Math.max(1, st.medGates)).toFixed(2)}x`);
}

main();
