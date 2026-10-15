#!/usr/bin/env node
// Checks Ridge Run courses for dead ends with the exact reachability set rather than a bot's opinion.
//
//   node tools/ridge-reachable.mjs [seeds=200] [gates=150] [firstSeed=0]
//
// Prints the seeds whose reachable set empties, and the gate it emptied at. A seed that clears here has a line
// through it; a seed that fails here is impossible for anyone.
import {reachStart, reachThroughGate} from '../dist/ridge-reach.js';

const noop = () => {};
function installStubs() {
  globalThis.window ??= {devicePixelRatio: 1};
  globalThis.requestAnimationFrame ??= () => 0;
  globalThis.cancelAnimationFrame ??= () => {};
  globalThis.Image ??= class { complete = false; naturalWidth = 0; };
}
function stubCanvas() {
  const ctx = new Proxy({}, {get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true)});
  return {getContext: () => ctx, getBoundingClientRect: () => ({width: 480, height: 720, left: 0, top: 0}), addEventListener: noop, removeEventListener: noop, setPointerCapture: noop};
}
const quietCb = {hud: noop, message: noop, sound: noop, effect: noop, progress: noop, ready: noop, topTier: noop, place: noop, haptic: noop, end: noop};

installStubs();
const {RidgeEngine, RIDGE, hitsVial} = await import('../dist/tryout-games.js');

// Walks a built course with the reachability set and reports where, if anywhere, it empties.
export function deadEndFor(seed, gates, version = 5) {
  const e = new RidgeEngine(stubCanvas(), quietCb, {seed, motion: false, version});
  while (e.index < gates + 2) e.addGate();
  const C = e.C, course = e.gates.slice();
  e.destroy();
  let states = reachStart(C), t = 0, smallest = Infinity;
  for (let i = 0; i < Math.min(gates, course.length); i++) {
    const g = course[i];
    const out = reachThroughGate(states, g, C, e.speedFor(i), 100, hitsVial, t);
    states = out.states; t = out.t;
    smallest = Math.min(smallest, states.length);
    if (!states.length) return {seed, dead: true, gate: i, smallest: 0};
  }
  return {seed, dead: false, gate: null, smallest};
}

if (process.argv[1] && process.argv[1].endsWith('ridge-reachable.mjs')) {
  const [seeds = 200, gates = 150, firstSeed = 0] = process.argv.slice(2).map(Number);
  const started = Date.now();
  const bad = [];
  let minSet = Infinity;
  for (let s = firstSeed; s < firstSeed + seeds; s++) {
    const r = deadEndFor(s, gates);
    if (r.dead) bad.push(r);
    else minSet = Math.min(minSet, r.smallest);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`reachable: ${seeds - bad.length}/${seeds} seeds have a line through to gate ${gates} in ${secs}s`);
  console.log(`tightest reachable set on a clearing seed: ${minSet === Infinity ? 'n/a' : minSet} states`);
  for (const b of bad) console.log(`  seed ${b.seed}: no line past gate ${b.gate}`);
}
