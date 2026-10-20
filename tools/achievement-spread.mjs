#!/usr/bin/env node
// What the achievement tiers were chosen from, rather than guessed at.
//
//   node tools/achievement-spread.mjs [--runs 120]
//
// Plays real runs of all three games with the bots the balance tools already use, and reports the spread of
// every number an achievement counts. A tier is only worth having if an ordinary player reaches bronze in
// their first few runs, silver with some practice, and gold with real skill — so the numbers to aim the
// tiers at are the medians and p90s of a weak, an ordinary and a strong bot.
import {createBlocks, blocksPlace, blocksShuffle, blocksBomb, blocksResult} from '../dist/blocks-core.js';
import {placements, placeBlock} from '../dist/puzzle-rules.js';
import {SIM_STEP, createRandom} from '../dist/rng.js';
import {installStubs, stubCanvas, stubCallbacks} from '../tests/ridge-planner.mjs';

const arg = (name, fallback) => {const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : Number(process.argv[i + 1]);};
const RUNS = arg('runs', 120);
installStubs();
const {RidgeEngine, SequenceEngine} = await import('../dist/tryout-games.js');

const sorted = list => [...list].sort((a, b) => a - b);
const at = (list, q) => list.length ? sorted(list)[Math.min(list.length - 1, Math.round(q * (list.length - 1)))] : 0;
const row = (label, list) => `  ${label.padEnd(24)} med ${String(at(list, .5)).padStart(7)}   p75 ${String(at(list, .75)).padStart(7)}   p90 ${String(at(list, .9)).padStart(7)}   max ${String(at(list, 1)).padStart(7)}`;

// ---------------------------------------------------------------- Peak Blocks
// Two bots: one that takes any fit it finds first, and one that takes the placement clearing the most and
// reaches for a tool when nothing fits. The gap between them is the skill range the tiers sit in.
function blocksRun(seed, {greedy}) {
  const g = createBlocks(seed), rand = createRandom((seed * 7919) >>> 0);
  const fullest = () => {
    let hit = null;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const n = g.state.grid.flatMap((row, rr) => row.filter((v, cc) => v && Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)).length;
      if (!hit || n > hit.n) hit = {n, r, c};
    }
    return hit;
  };
  for (let turn = 0; turn < 4000 && !g.ended; turn++) {
    let best = null;
    g.state.tray.forEach((p, i) => {
      if (!p) return;
      for (const [r, c] of placements(g.state.grid, p.shape)) {
        const out = placeBlock(g.state.grid, p.shape, r, c, p.color);
        const score = greedy ? out.lines * 1000 + out.grid.flat().filter(v => !v).length : rand();
        if (!best || score > best.score) best = {score, i, r, c};
      }
    });
    if (best) {blocksPlace(g, best.i, best.r, best.c); continue;}
    if (blocksShuffle(g)) continue;
    const hit = fullest();
    if (!hit?.n || !blocksBomb(g, hit.r, hit.c)) break;
  }
  const out = blocksResult(g);
  return {score: out.score, combo: out.bestCombo, lines: out.lines};
}

// ---------------------------------------------------------------- Ridge Run
// The bot from tools/ridge-balance.mjs, in short: aim at the gate it is about to thread, tap once the
// crystal has fallen below that line and is not already climbing, and leave a gap between taps, because a
// hand can only tap so fast. Without the gap it taps every tick and rockets into the ceiling.  is how
// far the eye wanders, which is what being worse at the game actually looks like.
const TAP_GAP = 9, RISING = .35;
function ridgeRun(seed, {aim: wobble}) {
  const e = new RidgeEngine(stubCanvas(), stubCallbacks().cb, {seed, motion: false, version: 6});
  const rand = createRandom((seed ^ 0x5bf03635) >>> 0);
  const aim = () => {
    const next = e.gates.find(g => g.x + e.C.PW > e.px - e.C.R);
    return (next ? next.cy : e.C.GROUND / 2) + (rand() * 2 - 1) * wobble;
  };
  let lastTap = -99;
  e.action();
  for (let t = 0; t < 120 * 60 * 6 && !e.ended; t++) {
    if (!e.dead && e.py > aim() && e.vy > -e.C.FLAP * RISING && e.ticks - lastTap >= TAP_GAP) {e.action(); lastTap = e.ticks;}
    e.step(SIM_STEP);
  }
  if (!e.ended) e.finish();
  const stats = e.stats();
  e.destroy();
  return stats;
}

// ---------------------------------------------------------------- Sequence
// Chained levels, the way a player meets them: level 1 upward until a level is lost, since the lifetime
// counters are what a session adds up to rather than what one level gives.
async function sequenceRun(seed) {
  const {greedyMove} = await import('./sequence-bot.mjs');
  let cascade = 0, powerups = 0, levels = 0;
  for (let level = 1; level <= 40; level++) {
    let result = null;
    const cb = stubCallbacks().cb;
    cb.end = r => {result ??= r;};
    cb.goals = () => {};
    const e = new SequenceEngine(stubCanvas(), cb, {seed: (seed * 2654435761 + level) >>> 0, level, motion: false});
    for (let guard = 0; guard < 200000 && !e.ended; guard++) {
      if (!e.pending) {
        const pair = greedyMove(e.board, e);
        if (!pair) break;
        e.choose(pair[0], pair[1]);
      }
      e.step(SIM_STEP);
    }
    if (!e.ended) e.finish();
    cascade = Math.max(cascade, e.maxChain);
    powerups += e.specialsMade;
    e.destroy();
    if (!result?.won) break;
    levels++;
  }
  return {cascade, powerups, levels};
}

const out = {};
for (const [name, opts] of [['ordinary', {greedy: true}], ['flailing', {greedy: false}]]) {
  const runs = [...Array(RUNS)].map((_, s) => blocksRun(s + 1, opts));
  out[`blocks ${name}`] = runs;
}
for (const [name, aim] of [['steady', 4], ['shaky', 11]]) {
  out[`ridge ${name}`] = [...Array(RUNS)].map((_, s) => ridgeRun(s + 1, {aim}));
}
out['sequence session'] = [];
for (let s = 0; s < Math.min(RUNS, 40); s++) out['sequence session'].push(await sequenceRun(s + 1));

console.log(`Achievement spread — ${RUNS} runs per bot\n`);
console.log('Peak Blocks');
for (const name of ['ordinary', 'flailing']) {
  const runs = out[`blocks ${name}`];
  console.log(` ${name}`);
  console.log(row('best score', runs.map(r => r.score)));
  console.log(row('biggest combo', runs.map(r => r.combo)));
  console.log(row('lines cleared', runs.map(r => r.lines)));
}
console.log('\nRidge Run');
for (const name of ['steady', 'shaky']) {
  const runs = out[`ridge ${name}`];
  console.log(` ${name}`);
  console.log(row('gates passed', runs.map(r => r.gates)));
  console.log(row('zones cleared', runs.map(r => r.zones)));
  console.log(row('CLOSE! moments', runs.map(r => r.close)));
  console.log(row('gold vials', runs.map(r => r.vials)));
}
console.log('\nSequence (one session, level 1 up to the first loss)');
const seq = out['sequence session'];
console.log(row('levels cleared', seq.map(r => r.levels)));
console.log(row('biggest cascade', seq.map(r => r.cascade)));
console.log(row('power-ups made', seq.map(r => r.powerups)));
