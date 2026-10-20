// Sequence level-curve measurement. Three bots drive the real SequenceEngine on its fixed step, the same
// way tools/replay.mjs does, so wins, losses, cascades, specials, ice, traps, collection goals and
// reshuffles are the game's own rules rather than a reimplementation of them.
//
//   node tools/sequence-levels.mjs                       # per-level table + chained-run lengths
//   node tools/sequence-levels.mjs --rules 2             # measure the v2 rules instead
//   node tools/sequence-levels.mjs --seeds 200 --levels 1,5,10,20,30
//   node tools/sequence-levels.mjs --mode levels         # table only
//   node tools/sequence-levels.mjs --mode runs           # chained runs only
//   node tools/sequence-levels.mjs --sweep 100           # every level 1..100, flags only
//
// Bots, as the audit defined them:
//   random  any valid swap, uniformly.
//   greedy  the swap worth the most points right now.
//   smart   works toward whatever objective is still outstanding, and in v3 values making and combining
//           specials. Neither greedy nor smart can see the refill RNG; they judge only the visible board.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const root = process.env.SEQ_REPO ?? process.cwd();
const mod = p => import(pathToFileURL(resolve(root, p)).href);

globalThis.window = {devicePixelRatio: 1};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = class {complete = false; naturalWidth = 0;};

const {SequenceEngine} = await mod('dist/tryout-games.js');
const {sequenceMatches, SEQUENCE_MOVES} = await mod('dist/sequence-rules.js');
const {SEQUENCE_RULES_VERSION, sequenceLevel, sequenceGoals, progressionExchange, applySequenceWave} = await mod('dist/sequence-progression.js');
const {createRandom, SIM_STEP} = await mod('dist/rng.js');
const {useToolWhenStuck} = await mod('tools/sequence-bot.mjs');
// v3 lives in its own module so the v1/v2 paths stay untouched. Absent on older checkouts, which is how
// this script still measures a baseline on a build that has no v3.
const v3 = await mod('dist/sequence-v3.js').catch(() => null);

const arg = (name, fallback) => {const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1];};
const flag = name => process.argv.includes('--' + name);
const RULES = +arg('rules', v3 ? 3 : SEQUENCE_RULES_VERSION);
const SEEDS = +arg('seeds', 200);
const RUNS = +arg('runs', 200);
const SWEEP = +arg('sweep', 0);
const MODE = arg('mode', SWEEP ? 'sweep' : 'both');
const LEVELS = String(arg('levels', '1,2,5,10,15,20,30,40,60,100')).split(',').map(Number);
if (RULES >= 3 && !v3) throw new Error('This build has no dist/sequence-v3.js; pass --rules 2');

const PAIRS = [];
for (let i = 0; i < 49; i++) {if (i % 7 < 6) PAIRS.push([i, i + 1]); if (i + 7 < 49) PAIRS.push([i, i + 7]);}

// ---------------------------------------------------------------- shared bot vision

// The points a swap is certain to earn: the cascade among crystals already on the board, with every refill
// treated as unknown (-2, which never matches). A player can read this much; the refills are luck.
// Gravity stops at trapped rows, the way settleProgression does, so trapped columns are not over-valued.
function knownCascadeV2(board, state) {
  let cur = board, gained = 0, chain = 0;
  for (;;) {
    const matches = sequenceMatches(cur);
    if (!matches.size) break;
    gained += matches.size * 50 * (1 + chain);
    chain++;
    const cleared = cur.map((v, i) => matches.has(i) ? -1 : v), next = cleared.slice();
    for (let col = 0; col < 7; col++) {
      let bottom = 6;
      for (let boundary = 6; boundary >= -1; boundary--) {
        if (boundary >= 0 && !state.locks[boundary * 7 + col]) continue;
        let write = bottom;
        for (let row = bottom; row > boundary; row--) if (cleared[row * 7 + col] >= 0) {next[write * 7 + col] = cleared[row * 7 + col]; write--;}
        for (let row = write; row > boundary; row--) next[row * 7 + col] = -2;
        bottom = boundary - 1;
      }
    }
    cur = next;
  }
  return {gained, chain};
}

const legalV2 = (board, state) => {
  const out = [];
  for (const [a, b] of PAIRS) {
    const next = progressionExchange(board, a, b, state);
    if (next && sequenceMatches(next).size) out.push([a, b, next]);
  }
  return out;
};

// ---------------------------------------------------------------- bots

export function makeBots(rules) {
  if (rules >= 3) {
    const {v3Legal, previewV3Move} = v3;
    const legal = e => v3Legal(e.board, e.progress);
    return {
      random: seed => {
        const rand = createRandom((seed ^ 0xa5a5a5) >>> 0);
        return e => {const m = legal(e); return m.length ? m[Math.floor(rand() * m.length)] : null;};
      },
      // Points now, and nothing else.
      greedy: () => e => {
        let best = null, bestValue = -1;
        for (const [a, b] of legal(e)) {
          const p = previewV3Move(e.board, e.progress, e.config, a, b);
          const value = p.gained * 100 + Math.max(Math.floor(a / 7), Math.floor(b / 7));
          if (value > bestValue) {bestValue = value; best = [a, b];}
        }
        return best;
      },
      // Objectives first, specials and combos valued for what they will be worth later, points only while
      // the score goal is still short.
      smart: () => e => {
        const c = e.config, goals = v3.v3Goals(c, e.progress), left = k => goals.find(g => g.kind === k)?.left ?? 0;
        const iceLeft = left('ice'), lockLeft = left('lock'), collectLeft = left('collect');
        const needScore = Math.max(0, e.target - e.score);
        let best = null, bestValue = -Infinity;
        for (const [a, b] of legal(e)) {
          const p = previewV3Move(e.board, e.progress, e.config, a, b);
          // Only the crystals this move still needs are worth anything.
          const collected = Math.min(p.collected, collectLeft);
          // A special left on the board is worth more than the points it would score right now: it is
          // ammunition for a combo, and every move left at the end fires one for free.
          const stock = p.made.stripe * 260 + p.made.wrap * 420 + p.made.bomb * 700;
          const value = p.gained * (needScore > 0 ? 1 : 0.12)
            + p.comboBonus * 1.4
            + stock
            + p.ice * (iceLeft ? 300 : 0)
            + p.traps * (lockLeft ? 380 : 0)
            + collected * (collectLeft ? 240 : 0)
            + p.chain * 70
            + Math.max(Math.floor(a / 7), Math.floor(b / 7));
          if (value > bestValue) {bestValue = value; best = [a, b];}
        }
        return best;
      },
    };
  }
  return {
    random: seed => {
      const rand = createRandom((seed ^ 0xa5a5a5) >>> 0);
      return e => {const m = legalV2(e.board, e.progress); return m.length ? m[Math.floor(rand() * m.length)] : null;};
    },
    greedy: () => e => {
      let best = null, bestValue = -1;
      for (const [a, b, next] of legalV2(e.board, e.progress)) {
        const value = knownCascadeV2(next, e.progress).gained * 100 + Math.max(Math.floor(a / 7), Math.floor(b / 7));
        if (value > bestValue) {bestValue = value; best = [a, b];}
      }
      return best;
    },
    smart: () => e => {
      const c = e.config, p = e.progress, needScore = Math.max(0, e.target - e.score);
      const goals = sequenceGoals(c, p), left = k => goals.find(g => g.kind === k)?.left ?? 0;
      const iceLeft = left('ice'), lockLeft = left('lock'), collectLeft = left('collect');
      let best = null, bestValue = -Infinity;
      for (const [a, b, next] of legalV2(e.board, p)) {
        const matches = sequenceMatches(next);
        const after = applySequenceWave(c, p, next, matches);
        const ice = p.ice.reduce((n, v, i) => n + v - after.ice[i], 0);
        const traps = p.locks.filter(Boolean).length - after.locks.filter(Boolean).length;
        const cap = c.collect?.count ?? 0;
        const collected = Math.min(cap, after.collected) - Math.min(cap, p.collected);
        const known = knownCascadeV2(next, p);
        const shape = matches.size >= 5 ? 300 : matches.size >= 4 ? 150 : 0;
        const value = known.gained * (needScore > 0 ? 1 : 0.1) + known.chain * 60
          + ice * (iceLeft ? 260 : 0) + traps * (lockLeft ? 340 : 0) + collected * (collectLeft ? 210 : 0)
          + shape + Math.max(Math.floor(a / 7), Math.floor(b / 7));
        if (value > bestValue) {bestValue = value; best = [a, b];}
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------- playing a level

const noop = () => {};
function canvas() {
  const ctx = new Proxy({}, {get: (t, k) => k in t ? t[k] : () => ctx, set: (t, k, v) => (t[k] = v, true)});
  return {getContext: () => ctx, getBoundingClientRect: () => ({width: 480, height: 720, left: 0, top: 0}), addEventListener: noop, removeEventListener: noop, setPointerCapture: noop};
}

const MAX_TICKS = 120 * 60 * 20;

export function play(level, seed, pick, rules, targetOverride = null) {
  let result = null, reshuffles = 0;
  const cb = {hud: noop, message: m => {if (/Fresh crystals/.test(m)) reshuffles++;}, sound: noop, effect: noop, goals: noop, ready: noop, end(r) {result ??= r;}};
  const e = new SequenceEngine(canvas(), cb, {seed, level, motion: false, rulesVersion: rules});
  // The tuner uses this to ask "this level, but with that score goal", which is how the curve was solved.
  if (targetOverride !== null) e.target = targetOverride;
  const goalsNow = () => rules >= 3 ? v3.v3Goals(e.config, e.progress) : sequenceGoals(e.config, e.progress);
  let stuck = 0;
  while (!e.ended && e.ticks < MAX_TICKS) {
    if (!e.pending) {
      const pair = pick(e);
      // A v4 board with no move waits for a tool; a player would use one, so the bot does too.
      if (!pair) {if (!useToolWhenStuck(e) && ++stuck > 4) break;} else {stuck = 0; e.choose(pair[0], pair[1]);}
    }
    e.step(SIM_STEP);
  }
  if (!e.ended) e.finish();
  const ticks = e.ticks;
  e.destroy();
  const goals = goalsNow(), left = k => goals.find(g => g.kind === k)?.left ?? 0;
  const total = result?.movesTotal ?? SEQUENCE_MOVES;
  return {
    won: Boolean(result?.won),
    score: e.score,
    movesLeft: total - (result?.moves ?? total),
    seconds: ticks * SIM_STEP,
    reshuffles,
    shortScore: e.score < e.target,
    shortIce: left('ice') > 0,
    shortLock: left('lock') > 0,
    shortCollect: left('collect') > 0,
  };
}

// A ranked run: level 1 upward, stopping at the first level the bot fails, as the server chains them.
function playRun(seed, bots, name, rules, cap = 200) {
  let score = 0, seconds = 0, level = 1;
  for (; level <= cap; level++) {
    const r = play(level, (seed * 2654435761 + level * 40503) >>> 0, bots[name](seed + level), rules);
    score += r.score;
    seconds += r.seconds;
    if (!r.won) break;
  }
  return {levels: Math.min(level, cap), score, seconds};
}

// ---------------------------------------------------------------- reporting

const pad = (s, n) => String(s).padStart(n);
const pct = n => `${(100 * n).toFixed(1)}%`;
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = a => {const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0;};
const BOTS = ['random', 'greedy', 'smart'];

const bots = makeBots(RULES);
const levelOf = level => RULES >= 3 ? v3.v3Level(level, RULES) : sequenceLevel(level);

function measure(level) {
  const row = {level, config: levelOf(level)};
  for (const name of BOTS) {
    const runs = [];
    for (let s = 0; s < SEEDS; s++) runs.push(play(level, (level * 7919 + s * 104729) >>> 0, bots[name](s), RULES));
    const wins = runs.filter(r => r.won), losses = runs.filter(r => !r.won);
    row[name] = {
      winRate: wins.length / runs.length,
      movesLeft: avg(wins.map(r => r.movesLeft)),
      score: avg(runs.map(r => r.score)),
      seconds: avg(runs.map(r => r.seconds)),
      reshuffles: avg(runs.map(r => r.reshuffles)),
      blocked: Object.fromEntries(['shortScore', 'shortIce', 'shortLock', 'shortCollect']
        .map(k => [k, losses.length ? losses.filter(r => r[k]).length / losses.length : null])),
    };
  }
  return row;
}

// Imported by the tuner for its bots; only the direct `node tools/sequence-levels.mjs` run reports.
if (pathToFileURL(resolve(process.argv[1] ?? '')).href !== import.meta.url) { /* library use */ } else {
console.log(`Sequence level curve - rulesVersion ${RULES}, ${SEEDS} seeds per level per bot, real engine`);

const summary = [];
if (MODE === 'both' || MODE === 'levels') {
  console.log('');
  console.log('lvl  goal                    mv  target  pal  ice trap coll | bot      win%  movesLeft  avgScore  mins  resh | losses short on: score   ice  trap  coll');
  console.log('-'.repeat(158));
  for (const level of LEVELS) {
    const row = measure(level);
    const c = row.config;
    const ice = c.ice.reduce((a, b) => a + b, 0), trap = c.locks.filter(Boolean).length;
    const head = `${pad(level, 3)}  ${(c.plan ?? 'score+all').padEnd(22)}  ${pad(c.moves ?? SEQUENCE_MOVES, 2)}  ${pad(c.target, 6)}  ${pad(c.palette, 3)}  ${pad(ice, 3)} ${pad(trap, 4)} ${pad(c.collect ? c.collect.count : 0, 4)}`;
    let first = true;
    for (const name of BOTS) {
      const r = row[name];
      const b = k => r.blocked[k] === null ? '    -' : pad(pct(r.blocked[k]), 5);
      console.log(`${first ? head : ' '.repeat(head.length)} | ${name.padEnd(7)} ${pad(pct(r.winRate), 6)} ${pad(r.winRate ? r.movesLeft.toFixed(1) : '-', 10)}  ${pad(Math.round(r.score), 8)}  ${pad((r.seconds / 60).toFixed(1), 4)}  ${pad(r.reshuffles.toFixed(2), 4)} | ${pad(b('shortScore'), 22)} ${b('shortIce')} ${b('shortLock')} ${b('shortCollect')}`);
      first = false;
    }
    summary.push(row);
    console.log('-'.repeat(158));
  }
}

if (MODE === 'both' || MODE === 'runs') {
  console.log(`\nChained runs - level 1 upward until the first failed level, ${RUNS} runs per bot`);
  console.log('bot      levels reached (median)  mean   p10  p90   avg run score   avg minutes/run');
  console.log('-'.repeat(100));
  for (const name of BOTS) {
    const out = [];
    for (let s = 0; s < RUNS; s++) out.push(playRun(s + 1, bots, name, RULES));
    const levels = out.map(r => r.levels).sort((a, b) => a - b);
    console.log(`${name.padEnd(7)} ${pad(median(levels), 22)}  ${pad(avg(levels).toFixed(1), 5)}  ${pad(levels[Math.floor(levels.length * 0.1)], 4)}  ${pad(levels[Math.floor(levels.length * 0.9)], 3)}  ${pad(Math.round(avg(out.map(r => r.score))), 14)}   ${pad((avg(out.map(r => r.seconds)) / 60).toFixed(1), 16)}`);
  }
  console.log('-'.repeat(100));
}

if (MODE === 'sweep') {
  console.log(`\nSweep of levels 1..${SWEEP} at ${SEEDS} seeds, smart bot floor and random ceiling`);
  console.log('lvl  random  greedy   smart   | lvl  random  greedy   smart   | lvl  random  greedy   smart');
  const rows = [];
  for (let level = 1; level <= SWEEP; level++) rows.push(measure(level));
  const third = Math.ceil(SWEEP / 3);
  for (let i = 0; i < third; i++) {
    const cells = [i, i + third, i + 2 * third].filter(k => k < rows.length).map(k => {
      const r = rows[k];
      return `${pad(r.level, 3)}  ${pad(pct(r.random.winRate), 6)}  ${pad(pct(r.greedy.winRate), 6)}  ${pad(pct(r.smart.winRate), 6)}`;
    });
    console.log(cells.join('  | '));
  }
  summary.push(...rows);
}

const spec = [
  {levels: [1, 2], test: r => r.random.winRate >= 0.80 && r.random.winRate <= 0.95, what: 'random 80-95% (onboarding)'},
  {levels: [5], test: r => r.random.winRate >= 0.40 && r.random.winRate <= 0.60 && r.smart.winRate > 0.90, what: 'random ~50%, smart >90%'},
  {levels: [10], test: r => r.random.winRate < 0.25 && r.smart.winRate >= 0.70 && r.smart.winRate <= 0.90, what: 'random <25%, smart ~80%'},
  {levels: [20], test: r => r.smart.winRate >= 0.50 && r.smart.winRate <= 0.70, what: 'smart ~60%'},
  {levels: [30, 40, 60, 100], test: r => r.smart.winRate >= 0.40 && r.smart.winRate <= 0.55, what: 'smart 40-55%'},
];
console.log('\nTargets');
let bad = 0;
for (const s of spec) for (const level of s.levels) {
  const row = summary.find(r => r.level === level);
  if (!row) continue;
  const ok = s.test(row);
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'MISS'} level ${pad(level, 3)}  ${s.what.padEnd(28)} got random ${pct(row.random.winRate)}, greedy ${pct(row.greedy.winRate)}, smart ${pct(row.smart.winRate)}`);
}
const floor = summary.filter(r => r.smart.winRate < 0.20);
if (floor.length) {console.log(`  MISS smart under 20% at level(s) ${floor.map(r => r.level).join(', ')}`); bad += floor.length;}
else console.log('  ok   smart never under 20% at any level measured');
if (flag('strict') && bad) process.exitCode = 1;
}
