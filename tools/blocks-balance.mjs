#!/usr/bin/env node
// Practice bots for Peak Blocks, used to measure the difficulty curve instead of guessing at it.
//
//   node tools/blocks-balance.mjs [--seeds 300] [--version 2] [--bot random,greedy,planner] [--json]
//
// Three bots of rising skill play real runs through blocks-core.js, so whatever they report is what the
// shipped rules do. The gap between them is the skill ceiling: if a thinking bot cannot beat a flailing one,
// there is nothing in the game to get good at.
import {createBlocks, blocksPlace, blocksResult} from '../dist/blocks-core.js';
import {clearPoints, BLOCK_SCORE} from '../dist/blocks-core.js';
import {createRandom} from '../dist/rng.js';

// ---------------------------------------------------------------------------
// A bitboard copy of the board rules. The real engine owns the run; this is only for the bots' lookahead,
// where cloning 8 arrays per candidate made a 300-seed sweep take minutes.
// rows[i] is an 8-bit mask of filled cells in row i.
const FULL = 0xff;
const toRows = grid => Uint8Array.from(grid, row => row.reduce((m, v, c) => (v ? m | (1 << c) : m), 0));
const cellFilled = (rows, r, c) => (rows[r] >> c) & 1;

function bitFits(rows, shape, r, c) {
  for (const [x, y] of shape) {
    const rr = r + y, cc = c + x;
    if (rr > 7 || cc > 7 || cellFilled(rows, rr, cc)) return false;
  }
  return true;
}

// Place, then clear whole rows and columns, exactly as placeBlock does.
function bitPlace(rows, shape, r, c) {
  const next = Uint8Array.from(rows);
  for (const [x, y] of shape) next[r + y] |= 1 << (c + x);
  const fullRows = [], fullCols = [];
  for (let i = 0; i < 8; i++) if (next[i] === FULL) fullRows.push(i);
  for (let i = 0; i < 8; i++) {
    let all = true;
    for (let rr = 0; rr < 8 && all; rr++) if (!cellFilled(next, rr, i)) all = false;
    if (all) fullCols.push(i);
  }
  const lines = fullRows.length + fullCols.length;
  let cleared = 0;
  if (lines) {
    for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) {
      if (fullRows.includes(rr) || fullCols.includes(cc)) { if (cellFilled(next, rr, cc)) cleared++; next[rr] &= ~(1 << cc); }
    }
  }
  return {rows: next, lines, cleared};
}

function bitPlacements(rows, shape) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (bitFits(rows, shape, r, c)) out.push([r, c]);
  return out;
}

// An isolated empty cell: empty, with every orthogonal neighbour filled or off the board. These are what
// actually kill a run, so both the greedy tie-break and the planner's score punish them.
function holes(rows) {
  let n = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (cellFilled(rows, r, c)) continue;
    const up = r === 0 || cellFilled(rows, r - 1, c), down = r === 7 || cellFilled(rows, r + 1, c);
    const left = c === 0 || cellFilled(rows, r, c - 1), right = c === 7 || cellFilled(rows, r, c + 1);
    if (up && down && left && right) n++;
  }
  return n;
}

const filledCount = rows => { let n = 0; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (cellFilled(rows, r, c)) n++; return n; };

// Room probes: can a 3x3, a flat 1x5 and an upright 5x1 still go down anywhere?
const SQ3 = [], L5 = [], L5V = [];
for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) SQ3.push([x, y]);
for (let i = 0; i < 5; i++) { L5.push([i, 0]); L5V.push([0, i]); }
const canFit = (rows, shape) => { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (bitFits(rows, shape, r, c)) return true; return false; };

// ---------------------------------------------------------------------------
// Bots. Each returns a list of [trayIndex, row, col] to play, or [] when nothing fits.

const comboAfter = state => (state.chain > 0 && (state.sinceClear ?? 0) < BLOCK_SCORE.comboGrace ? state.chain + 1 : 1);
const movePoints = (shape, out, combo) => shape.length * BLOCK_SCORE.cell + (out.lines ? clearPoints(out.cleared, out.lines, combo) : 0);

function randomBot(g, rand) {
  const rows = toRows(g.state.grid), options = [];
  g.state.tray.forEach((p, i) => { if (p) for (const [r, c] of bitPlacements(rows, p.shape)) options.push([i, r, c]); });
  return options.length ? [options[Math.floor(rand() * options.length)]] : [];
}

function greedyBot(g) {
  const rows = toRows(g.state.grid), combo = comboAfter(g.state);
  let best = null;
  g.state.tray.forEach((p, i) => {
    if (!p) return;
    for (const [r, c] of bitPlacements(rows, p.shape)) {
      const out = bitPlace(rows, p.shape, r, c);
      const points = movePoints(p.shape, out, combo), gaps = holes(out.rows);
      if (!best || points > best.points || (points === best.points && gaps < best.gaps)) best = {points, gaps, move: [i, r, c]};
    }
  });
  return best ? [best.move] : [];
}

// How good is the board left behind, plus what the sequence cleared on the way.
function boardScore(rows, lines) {
  return lines * 120
    - holes(rows) * 9
    - filledCount(rows) * 1.5
    + (canFit(rows, SQ3) ? 30 : 0)
    + (canFit(rows, L5) ? 20 : 0)
    + (canFit(rows, L5V) ? 20 : 0);
}

// Rank candidate placements cheaply so the search can look at the promising ones first: clears beat
// non-clears, then placements that sit snugly against what is already there.
function contact(rows, shape, r, c) {
  let touch = 0;
  for (const [x, y] of shape) {
    const rr = r + y, cc = c + x;
    if (rr === 0 || cellFilled(rows, rr - 1, cc)) touch++;
    if (rr === 7 || cellFilled(rows, rr + 1, cc)) touch++;
    if (cc === 0 || cellFilled(rows, rr, cc - 1)) touch++;
    if (cc === 7 || cellFilled(rows, rr, cc + 1)) touch++;
  }
  return touch;
}

function shortlist(rows, shape, cap) {
  const all = bitPlacements(rows, shape).map(([r, c]) => {
    const out = bitPlace(rows, shape, r, c);
    return {r, c, out, rank: out.lines * 1000 + contact(rows, shape, r, c)};
  });
  if (all.length <= cap) return all;
  all.sort((a, b) => b.rank - a.rank);
  return all.slice(0, cap);
}

// Tries every order of the tray and every placement within it, keeping the branching down to the best `cap`
// placements per piece so a 300-seed sweep finishes in seconds rather than an hour.
function plannerBot(g, rand, cap) {
  const tray = g.state.tray.map((p, i) => (p ? {shape: p.shape, i} : null)).filter(Boolean);
  if (!tray.length) return [];
  const rootRows = toRows(g.state.grid);
  let best = null;
  const consider = (rows, lines, seq) => {
    const score = boardScore(rows, lines);
    if (!best || score > best.score || (score === best.score && seq.length > best.seq.length)) best = {score, seq: [...seq]};
  };
  const search = (rows, remaining, lines, seq) => {
    if (!remaining.length) return consider(rows, lines, seq);
    let placedAny = false;
    for (const piece of remaining) {
      for (const {r, c, out} of shortlist(rows, piece.shape, cap)) {
        placedAny = true;
        seq.push([piece.i, r, c]);
        search(out.rows, remaining.filter(p => p !== piece), lines + out.lines, seq);
        seq.pop();
      }
    }
    // Nothing more fits: the run is about to end, so judge the board as it stands.
    if (!placedAny) consider(rows, lines, seq);
  };
  search(rootRows, tray, 0, []);
  return best ? best.seq : [];
}

// ---------------------------------------------------------------------------

const BOTS = {
  random: {next: (g, rand) => randomBot(g, rand)},
  greedy: {next: g => greedyBot(g)},
  planner: {next: (g, rand, opts) => plannerBot(g, rand, opts.cap)},
};

function playRun(seed, botName, opts) {
  const g = createBlocks(seed, opts.version);
  // Bots play placement only: with no tools left, the engine ends the run the moment nothing fits.
  g.tools.bomb = 0; g.tools.shuffle = 0; g.tools.undo = 0; g.tools.hint = 0;
  const rand = createRandom((seed ^ 0x9e3779b9) >>> 0);
  let queue = [];
  while (!g.ended && g.state.moves < 500) {
    if (!queue.length) queue = BOTS[botName].next(g, rand, opts);
    if (!queue.length) break;
    const [i, r, c] = queue.shift();
    if (!blocksPlace(g, i, r, c)) { queue = []; if (!BOTS[botName].next(g, rand, opts).length) break; }
  }
  const result = blocksResult(g);
  return {score: result.score, moves: result.moves, lines: result.lines};
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

function summarise(runs) {
  const moves = runs.map(r => r.moves), scores = runs.map(r => r.score);
  return {
    runs: runs.length,
    medMoves: quantile(moves, .5), p90Moves: quantile(moves, .9),
    medScore: quantile(scores, .5), p90Score: quantile(scores, .9),
    shortPct: Math.round((runs.filter(r => r.moves < 15).length / runs.length) * 1000) / 10,
  };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? fallback : args[at + 1];
  };
  const seeds = Number(flag('seeds', 300));
  const opts = {version: Number(flag('version', 2)), cap: Number(flag('cap', 9))};
  const names = String(flag('bot', 'random,greedy,planner')).split(',');
  const asJson = args.includes('--json');

  const table = {};
  for (const name of names) {
    const runs = [];
    for (let i = 0; i < seeds; i++) runs.push(playRun((i * 2654435761) >>> 0, name, opts));
    table[name] = summarise(runs);
  }
  if (asJson) { console.log(JSON.stringify({version: opts.version, seeds, table}, null, 1)); return; }

  console.log(`Peak Blocks balance — ${seeds} seeds per bot, generator v${opts.version}`);
  console.log('bot      | med moves | p90 moves | med score | p90 score | runs <15 moves');
  console.log('---------|-----------|-----------|-----------|-----------|---------------');
  for (const [name, s] of Object.entries(table)) {
    console.log(
      `${name.padEnd(8)} | ${String(s.medMoves).padStart(9)} | ${String(s.p90Moves).padStart(9)} | ` +
      `${String(s.medScore).padStart(9)} | ${String(s.p90Score).padStart(9)} | ${String(s.shortPct + '%').padStart(14)}`
    );
  }
  const r = table.random, gre = table.greedy, pl = table.planner;
  if (r && gre && pl) {
    console.log('');
    console.log(`skill ceiling: planner/random ${(pl.medScore / Math.max(1, r.medScore)).toFixed(2)}x, ` +
      `planner/greedy ${(pl.medScore / Math.max(1, gre.medScore)).toFixed(2)}x, ` +
      `planner p90/med ${(pl.p90Score / Math.max(1, pl.medScore)).toFixed(2)}x`);
  }
}

main();
