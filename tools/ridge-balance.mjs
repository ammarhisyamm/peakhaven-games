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
const PROFILES = {
  weak: {lagMs: 180, noise: 26, lookAhead: false},
  average: {lagMs: 120, noise: 14, lookAhead: false},
  strong: {lagMs: 60, noise: 5, lookAhead: true},
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
  return target + gaussian(rand) * profile.noise;
}

async function playRun(RidgeEngine, RIDGE, seed, profileName, version) {
  const profile = PROFILES[profileName];
  const rand = createRandom((seed ^ 0x5bf03635) >>> 0);
  const e = new RidgeEngine(stubCanvas([480, 720]), quietCb, {seed, motion: false, version});
  const lagTicks = Math.max(1, Math.round((profile.lagMs / 1000) / SIM_STEP));
  const decisions = [];           // what the bot decided `lagTicks` ago
  // A hand can only tap so fast. Without this the bot taps every tick the vial is low and rockets into the ceiling,
  // which is not how anyone plays and makes every bot look equally hopeless.
  const TAP_GAP = 9, RISING = .35;
  let lastTap = -99;
  let guard = 0;
  // The first tap starts the run; after that the bot flies.
  e.action();
  while (!e.ended && guard++ < 120 * 60 * 10) {
    // Decide from the world as it is now, act on the decision made a reaction time ago.
    const target = aimFor(e, RIDGE, profile, rand);
    // Flap when the vial is under the line and is not already climbing hard. Reacting to height alone means
    // tapping all the way up and clipping the gate above; reacting to a long prediction parks it near the ceiling.
    decisions.push(e.py > target && e.vy > -RIDGE.FLAP * RISING);
    const due = decisions.length > lagTicks ? decisions.shift() : false;
    if (due && !e.dead && e.ticks - lastTap >= TAP_GAP) { e.action(); lastTap = e.ticks; }
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
