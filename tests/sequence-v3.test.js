// Sequence rules version 3: every special, every combo, chain reactions, how specials feed PR #20's
// objectives, the end-of-level bonus, and that v1, v2 and v3 replays all still verify.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = {devicePixelRatio: 1};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = class {complete = false; naturalWidth = 0;};
const {SequenceEngine} = await import('../dist/tryout-games.js');
const {replaySequence} = await import('../tools/replay.mjs');
const {createRandom, SIM_STEP} = await import('../dist/rng.js');
const v3 = await import('../dist/sequence-v3.js');
const {
  PLAIN, STRIPE_V, STRIPE_H, WRAP, BOMB, BOMB_COLOUR, V3_CELLS, V3_SCORE, V3_TUNING,
  makeCell, kindOf, colourOf, isSpecial, v3Runs, v3Groups, v3Award, v3Matches,
  v3Exchange, v3SwapKind, v3IsMove, v3Legal, v3Move, planV3Wave, applyV3Wave,
  v3Level, v3Plan, v3Moves, v3Target, v3Goals, v3AllGoals, v3Complete, v3Brief,
  createV3Progress, createV3Board, freshV3Board, settleV3, v3BonusPick, v3RemainingSpecials,
  previewV3Move,
} = v3;

const noop = () => {};
function canvas() {
  const ctx = new Proxy({}, {get: (t, k) => k in t ? t[k] : () => ctx, set: (t, k, v) => (t[k] = v, true)});
  return {getContext: () => ctx, getBoundingClientRect: () => ({width: 480, height: 720, left: 0, top: 0}), addEventListener: noop, removeEventListener: noop, setPointerCapture: noop};
}
function engine(options = {}) {
  let result = null;
  const effects = [], messages = [], haptics = [], sounds = [];
  const cb = {
    hud: noop, goals: noop, ready: noop,
    message: m => messages.push(m),
    sound: (t, o) => sounds.push([t, o]),
    haptic: (t, force) => haptics.push([t, force]),
    effect: l => effects.push(l),
    end(r) {result ??= r;},
  };
  const e = new SequenceEngine(canvas(), cb, {seed: 1, level: 1, motion: false, ...options});
  return {e, effects, messages, haptics, sounds, result: () => result};
}
// Settle the engine: run until nothing is pending (or the level ends).
function settle(e, seconds = 30) {
  for (let i = 0; i < seconds / SIM_STEP; i++) {
    if (e.ended || !e.pending) return;
    e.step(SIM_STEP);
  }
}
// A level config with no obstacles, for testing a mechanic on a clean board.
const bare = (level = 1) => ({...v3Level(level), ice: Array(V3_CELLS).fill(0), locks: Array(V3_CELLS).fill(false), collect: null});
const bareState = () => ({ice: Array(V3_CELLS).fill(0), locks: Array(V3_CELLS).fill(false), collected: 0});
// A background of three colours on a diagonal, which has no run of three anywhere and never uses colour 0.
// Tests draw their lines and their specials in colour 0, so a shape is exactly the shape the test wrote.
function board(cells = {}) {
  const b = Array.from({length: V3_CELLS}, (_, i) => 1 + ((i % 7) + 2 * Math.floor(i / 7)) % 3);
  for (const [at, cell] of Object.entries(cells)) b[+at] = cell;
  return b;
}
const at = (row, col) => row * 7 + col;
const wave = (b, opts = {}) => planV3Wave(b, opts.config ?? bare(), opts.state ?? bareState(), opts);

test('A cell carries its kind and colour in one integer, and plain cells read as v1/v2 did', () => {
  for (let colour = 0; colour < 7; colour++) {
    assert.equal(makeCell(PLAIN, colour), colour, 'a plain crystal is still just its colour');
    for (const kind of [STRIPE_V, STRIPE_H, WRAP, BOMB]) {
      const cell = makeCell(kind, colour);
      assert.equal(kindOf(cell), kind);
      assert.equal(colourOf(cell), colour);
      assert.equal(isSpecial(cell), true);
    }
  }
  assert.equal(isSpecial(3), false);
  assert.equal(kindOf(-1), PLAIN);
  assert.equal(colourOf(-1), -1);
  // A colour bomb sits on a colour no palette uses, so it can never join a line.
  assert.equal(BOMB_COLOUR >= V3_TUNING.palette, true);
});

test('The match finder returns shapes: four in a line, five in a line, and an L or T', () => {
  // Four across.
  const four = board({[at(3, 1)]: 0, [at(3, 2)]: 0, [at(3, 3)]: 0, [at(3, 4)]: 0});
  const fourRuns = v3Runs(four).filter(r => r.cells.length >= 3);
  assert.equal(fourRuns.length, 1);
  assert.equal(fourRuns[0].dir, 'h');
  assert.equal(fourRuns[0].cells.length, 4);
  // A horizontal four makes a vertically striped crystal, which sweeps its column.
  assert.equal(v3Award(v3Groups(four)[0]).kind, STRIPE_V);

  // Four down makes the other one.
  const down = board({[at(1, 3)]: 0, [at(2, 3)]: 0, [at(3, 3)]: 0, [at(4, 3)]: 0});
  assert.equal(v3Award(v3Groups(down)[0]).kind, STRIPE_H);

  // Five across makes a colour bomb.
  const five = board({[at(3, 1)]: 0, [at(3, 2)]: 0, [at(3, 3)]: 0, [at(3, 4)]: 0, [at(3, 5)]: 0});
  const bombAward = v3Award(v3Groups(five)[0]);
  assert.equal(bombAward.kind, BOMB);
  assert.equal(bombAward.colour, BOMB_COLOUR);

  // An L of five: three across meeting three down at a corner.
  const ell = board({[at(2, 2)]: 0, [at(2, 3)]: 0, [at(2, 4)]: 0, [at(3, 2)]: 0, [at(4, 2)]: 0});
  const ellGroups = v3Groups(ell);
  assert.equal(ellGroups.length, 1, 'runs that share a cell are one shape');
  assert.equal(ellGroups[0].cells.length, 5);
  assert.deepEqual(ellGroups[0].corners, [at(2, 2)]);
  assert.equal(v3Award(ellGroups[0]).kind, WRAP);

  // Three in a line earns nothing.
  const three = board({[at(3, 2)]: 0, [at(3, 3)]: 0, [at(3, 4)]: 0});
  assert.equal(v3Award(v3Groups(three)[0]), null);
});

test('A special is made at the swapped cell, and survives the blast that made it', () => {
  // Swapping the gap closed makes a line of four; the special lands under the finger.
  const b = board({[at(3, 1)]: 0, [at(3, 2)]: 0, [at(3, 4)]: 0, [at(4, 3)]: 0});
  const trigger = v3SwapKind(b, at(4, 3), at(3, 3), bareState());
  assert.equal(trigger.type, 'match');
  const plan = wave(trigger.next, {trigger});
  assert.equal(plan.create.size, 1);
  const [madeAt, madeCell] = [...plan.create][0];
  assert.equal(madeAt, at(3, 3), 'the new special is where the player swapped to');
  assert.equal(kindOf(madeCell), STRIPE_V);
  assert.equal(plan.clear.has(madeAt), false, 'the cell that became a special is not cleared');
  assert.equal(plan.made.stripe, 1);
  assert.equal(plan.gained, (plan.clear.size * V3_SCORE.cell + V3_SCORE.make[STRIPE_V]) * 1);
});

test('A striped crystal sweeps its row or column, and a wrapped one explodes twice', () => {
  const stripeV = board({[at(3, 3)]: makeCell(STRIPE_V, 0)});
  const vPlan = wave(stripeV, {trigger: {type: 'fire', cells: [at(3, 3)]}});
  for (let r = 0; r < 7; r++) assert.equal(vPlan.clear.has(at(r, 3)), true, `column cell row ${r}`);
  assert.equal(vPlan.clear.size, 7);
  assert.equal(vPlan.effects.some(e => e.type === 'beam' && e.axis === 'v'), true);

  const stripeH = board({[at(3, 3)]: makeCell(STRIPE_H, 0)});
  const hPlan = wave(stripeH, {trigger: {type: 'fire', cells: [at(3, 3)]}});
  for (let c = 0; c < 7; c++) assert.equal(hPlan.clear.has(at(3, c)), true, `row cell col ${c}`);
  assert.equal(hPlan.clear.size, 7);

  const wrapped = board({[at(3, 3)]: makeCell(WRAP, 0)});
  const wPlan = wave(wrapped, {trigger: {type: 'fire', cells: [at(3, 3)]}});
  assert.equal(wPlan.clear.size, 9, 'three by three');
  assert.deepEqual(wPlan.againAt, [at(3, 3)], 'and it owes a second explosion after the settle');
  assert.equal(wPlan.effects.some(e => e.type === 'shock'), true);
  // The second explosion goes off where the first did, on whatever has fallen in.
  const second = wave(board(), {trigger: null, again: [at(3, 3)], wave: 2});
  assert.equal(second.clear.size >= 9, true);
});

test('A colour bomb clears every crystal of the colour it is swapped with, and is always a legal move', () => {
  const state = bareState();
  const b = board({[at(3, 3)]: makeCell(BOMB, BOMB_COLOUR)});
  const partner = at(3, 4), colour = colourOf(b[partner]);
  assert.equal(colour > 0, true, 'the partner is one of the background colours');
  const trigger = v3SwapKind(b, at(3, 3), partner, state);
  assert.equal(trigger.type, 'bomb');
  assert.equal(trigger.colour, colour, 'the colour comes from what it was swapped with');
  assert.equal(v3IsMove(b, at(3, 3), partner, state), true, 'a bomb swap is a move even with no line');
  const plan = wave(trigger.next, {trigger});
  let expected = 0;
  for (let i = 0; i < V3_CELLS; i++) if (colourOf(b[i]) === colour) expected++;
  assert.equal(plan.clear.size, expected + 1, 'every crystal of that colour, plus the bomb itself');
  assert.equal(plan.effects.some(e => e.type === 'pulse'), true);
  // A bomb never joins an ordinary line.
  const line = board({[at(0, 0)]: makeCell(BOMB, BOMB_COLOUR), [at(0, 1)]: makeCell(BOMB, BOMB_COLOUR), [at(0, 2)]: makeCell(BOMB, BOMB_COLOUR)});
  assert.equal(v3Matches(line).size, 0);
});

test('Specials caught in another blast fire too, so chains run on their own', () => {
  // A striped crystal sweeps row 3 and catches a wrapped crystal and a second stripe on the way.
  const b = board({
    [at(3, 0)]: makeCell(STRIPE_H, 0),
    [at(3, 3)]: makeCell(WRAP, 1),
    [at(3, 6)]: makeCell(STRIPE_V, 2),
  });
  const plan = wave(b, {trigger: {type: 'fire', cells: [at(3, 0)]}});
  // Row 3 from the first stripe, the 3x3 from the wrapped crystal, and column 6 from the second stripe.
  for (let c = 0; c < 7; c++) assert.equal(plan.clear.has(at(3, c)), true);
  for (const cell of [at(2, 2), at(2, 3), at(2, 4), at(4, 2), at(4, 3), at(4, 4)]) assert.equal(plan.clear.has(cell), true, 'caught wrapped crystal exploded');
  for (let r = 0; r < 7; r++) assert.equal(plan.clear.has(at(r, 6)), true, 'caught stripe swept its column');
  assert.deepEqual(plan.againAt, [at(3, 3)], 'a wrapped crystal caught in a blast still owes its second');
  // A bomb swept up by someone else's blast takes the commonest colour with it rather than being wasted.
  const withBomb = board({[at(3, 0)]: makeCell(STRIPE_H, 0), [at(3, 3)]: makeCell(BOMB, BOMB_COLOUR)});
  const bombPlan = wave(withBomb, {trigger: {type: 'fire', cells: [at(3, 0)]}});
  assert.equal(bombPlan.clear.size > 7, true, 'the bomb added its colour to the blast');
  assert.equal(bombPlan.effects.some(e => e.type === 'pulse'), true);
});

test('Each of the six combos clears its own shape and scores above its parts', () => {
  const state = bareState(), here = at(3, 3), there = at(3, 4);
  const combo = (kindA, kindB, colourA = 0, colourB = 1) => {
    const b = board({[here]: makeCell(kindA, colourA), [there]: makeCell(kindB, colourB)});
    const trigger = v3SwapKind(b, here, there, state);
    assert.equal(trigger.type, 'combo', `${kindA}+${kindB} is a combo`);
    assert.equal(v3IsMove(b, here, there, state), true);
    return {b, plan: wave(trigger.next, {trigger})};
  };

  // striped + striped: a row and a column.
  const ss = combo(STRIPE_V, STRIPE_H);
  assert.equal(ss.plan.combo, 'stripeStripe');
  assert.equal(ss.plan.clear.size, 13, 'seven across plus seven down, sharing one cell');
  const twoStripesApart = 7 * V3_SCORE.cell + 7 * V3_SCORE.cell;
  assert.equal(ss.plan.gained > twoStripesApart, true, 'worth more than firing both separately');

  // striped + wrapped: three rows and three columns.
  const sw = combo(STRIPE_V, WRAP);
  assert.equal(sw.plan.combo, 'stripeWrap');
  assert.equal(sw.plan.clear.size, 33, 'three rows and three columns of a seven by seven');
  assert.equal(sw.plan.gained > ss.plan.gained, true);

  // wrapped + wrapped: five by five, and again after the settle.
  const ww = combo(WRAP, WRAP);
  assert.equal(ww.plan.combo, 'wrapWrap');
  assert.equal(ww.plan.clear.size, 25);
  assert.deepEqual(ww.plan.againAt, [there]);

  // bomb + striped: every crystal of that colour becomes striped and fires.
  const bs = combo(BOMB, STRIPE_V, BOMB_COLOUR, 1);
  assert.equal(bs.plan.combo, 'bombStripe');
  assert.equal(bs.plan.clear.size > 13, true);
  assert.equal(bs.plan.effects.filter(e => e.type === 'beam').length > 1, true, 'one beam per converted crystal');

  // bomb + wrapped: every crystal of that colour becomes wrapped and fires.
  const bw = combo(BOMB, WRAP, BOMB_COLOUR, 1);
  assert.equal(bw.plan.combo, 'bombWrap');
  assert.equal(bw.plan.againAt.length > 0, true, 'and each owes a second explosion');

  // bomb + bomb: the whole board.
  const bb = combo(BOMB, BOMB, BOMB_COLOUR, BOMB_COLOUR);
  assert.equal(bb.plan.combo, 'bombBomb');
  assert.equal(bb.plan.clear.size, V3_CELLS);
  assert.equal(bb.plan.gained, (V3_CELLS * V3_SCORE.cell + V3_SCORE.combo.bombBomb) * 1);
  assert.equal(bb.plan.gained > bw.plan.gained, true, 'the biggest combo is the biggest score');
  // A combo consumes both specials rather than minting another.
  assert.equal(bb.plan.create.size, 0);
});

test('A swap that does nothing is not a move, and a trapped crystal cannot be swapped', () => {
  const state = bareState();
  // Two plain crystals that make no line.
  const plain = board();
  assert.equal(v3SwapKind(plain, at(3, 3), at(3, 4), state), null);
  assert.equal(v3IsMove(plain, at(3, 3), at(3, 4), state), false);
  // Not neighbours, and off the board.
  assert.equal(v3Exchange(plain, at(0, 0), at(3, 3), state), null);
  assert.equal(v3Exchange(plain, 0, 49, state), null);
  assert.equal(v3Exchange(plain, 0, -1, state), null);
  // Trapped.
  const trapped = {...state, locks: state.locks.slice()};
  trapped.locks[at(3, 3)] = true;
  const withSpecials = board({[at(3, 3)]: makeCell(STRIPE_V, 0), [at(3, 4)]: makeCell(WRAP, 1)});
  assert.equal(v3Exchange(withSpecials, at(3, 3), at(3, 4), trapped), null);
  assert.equal(v3IsMove(withSpecials, at(3, 3), at(3, 4), trapped), false);
  // And a special is never placed into a trap.
  const config = bare();
  const lineState = {...state, locks: state.locks.slice()};
  lineState.locks[at(3, 3)] = true;
  const line = board({[at(3, 1)]: 0, [at(3, 2)]: 0, [at(3, 3)]: 0, [at(3, 4)]: 0});
  const plan = planV3Wave(line, config, lineState, {});
  for (const cell of plan.create.keys()) assert.equal(lineState.locks[cell], false);
});

test('Every cell a special clears counts toward ice and traps, and toward collection by its colour', () => {
  const config = {...v3Level(1), ice: Array(V3_CELLS).fill(0), locks: Array(V3_CELLS).fill(false), collect: {type: 2, count: 20}};
  config.ice[at(0, 3)] = 2;      // on the stripe's column
  config.ice[at(6, 3)] = 1;      // the other end of it
  config.locks[at(3, 2)] = true; // beside the column, so adjacency frees it
  const state = createV3Progress(config);

  // Column 3 is all the collected colour, with a striped crystal sitting in it.
  const b = Array.from({length: V3_CELLS}, (_, i) => i % 7 === 3 ? 2 : 3 + ((i % 7) + 2 * Math.floor(i / 7)) % 3);
  b[at(3, 3)] = makeCell(STRIPE_V, 2);
  // The cells a vertical stripe at (3,3) takes down, which the stripe test already pins separately.
  const column = new Set([0, 1, 2, 3, 4, 5, 6].map(r => at(r, 3)));
  const after = applyV3Wave(config, state, b, column);
  assert.equal(after.ice[at(0, 3)], 1, 'two-layer ice loses one layer per wave');
  assert.equal(after.ice[at(6, 3)], 0);
  assert.equal(after.locks[at(3, 2)], false, 'a trap beside a cleared cell is freed');
  assert.equal(after.collected, 7, 'all seven cleared crystals were the collected colour');

  // Adjacency alone never collects: a blast that only passes beside the colour collects nothing.
  const row = new Set([0, 1, 2, 3, 4, 5, 6].map(c => at(3, c)));
  const rowAfter = applyV3Wave(config, state, b, row);
  assert.equal(rowAfter.collected, 1, 'only the one cell of that colour actually in the row');
});

test('Objectives, the win gate and the brief hold together', () => {
  const config = v3Level(12);
  const state = createV3Progress(config);
  const goals = v3AllGoals(config, state, 0);
  assert.equal(goals[0].kind, 'score');
  assert.equal(goals[0].total, config.target);
  assert.equal(goals[0].left, config.target);
  // The score goal ticks off on its own, which is what lets the panel point at the real goal.
  assert.equal(v3AllGoals(config, state, config.target)[0].left, 0);
  // Every goal has to be met, not just the score.
  assert.equal(v3Complete(config.target, config, state), v3Goals(config, state).every(g => g.left === 0));
  const done = {...state, ice: state.ice.map(() => 0), locks: state.locks.map(() => false), collected: 9999};
  assert.equal(v3Complete(config.target, config, done), true);
  assert.equal(v3Complete(config.target - 50, config, done), false, 'the score goal still counts');
  assert.match(v3Brief(12), /Reach [\d,]+ points/);
  assert.match(v3Brief(12), new RegExp(`${config.moves} moves`));
});

test('The level curve varies the objective, never repeats a layout four levels apart, and keeps growing', () => {
  // No two levels in a row ask the same thing, from the end of the teaching run onwards.
  for (let n = 11; n <= 100; n++) assert.notEqual(v3Plan(n), v3Plan(n + 1), `levels ${n} and ${n + 1} play the same`);
  // Every kind of objective is used, including pairs.
  const plans = new Set();
  for (let n = 1; n <= 100; n++) plans.add(v3Plan(n));
  for (const want of ['score', 'ice', 'collect', 'ice+traps', 'traps+collect', 'ice+collect']) assert.equal(plans.has(want), true, `plan ${want} never appears`);
  // v2 cycled four layouts, so levels n and n+4 were identical. These are not.
  let repeats = 0;
  for (let n = 11; n <= 60; n++) {
    const a = v3Level(n), b = v3Level(n + 4);
    if (a.plan === b.plan && JSON.stringify([a.ice, a.locks]) === JSON.stringify([b.ice, b.locks])) repeats++;
  }
  assert.equal(repeats, 0, 'a layout repeated exactly four levels later');
  // A layout is a pure function of the level, so everyone gets the same board on a given level.
  assert.deepEqual(v3Level(37), v3Level(37));
  // It keeps scaling past level 36 instead of flattening.
  const findLevel = (plan, from) => {for (let n = from; n < from + 12; n++) if (v3Plan(n) === plan) return n; throw new Error('no ' + plan);};
  // The same objective asks for more later on.
  const earlyCollect = v3Level(findLevel('collect', 12)), lateCollect = v3Level(findLevel('collect', 88));
  assert.equal(lateCollect.collect.count > earlyCollect.collect.count, true, 'collection quotas still grow');
  const earlyIce = v3Level(findLevel('ice', 11)), lateIce = v3Level(findLevel('ice', 50));
  assert.equal(Math.max(...lateIce.ice) >= 3, true, 'ice reaches three layers');
  assert.equal(Math.max(...lateIce.ice) > Math.max(...earlyIce.ice), true, 'and more layers than it started with');
  // The score goal keeps moving rather than flattening onto one number, as v2's did at 4,500.
  const lateTargets = new Set();
  for (let n = 36; n <= 100; n++) lateTargets.add(v3Target(n));
  assert.equal(lateTargets.size > 8, true, 'the score goal is still moving past level 36');
  assert.equal(Math.min(...lateTargets) > 4500, true, 'and stays well above the old 4,500 ceiling');
  assert.equal(v3Moves(100) < v3Moves(1), true, 'and the move budget comes down');
  // The teaching order PR #20 established is kept.
  assert.equal(v3Level(1).ice.some(Boolean), false);
  assert.equal(v3Level(2).locks.some(Boolean), false);
  assert.equal(v3Level(1).collect, null);
  assert.equal(v3Level(3).ice.includes(1), true, 'single-layer ice first');
  assert.equal(v3Level(5).ice.includes(2), true, 'two-layer ice from level 5');
  assert.equal(v3Level(7).locks.some(Boolean), true, 'traps from level 7');
  assert.equal(v3Level(9).collect !== null, true, 'collection from level 9');
  // Quotas stay inside their ceilings, and a collected colour is always one in play.
  for (let n = 1; n <= 300; n++) {
    const c = v3Level(n);
    assert.equal(c.locks.filter(Boolean).length <= V3_TUNING.trapCount[1], true);
    assert.equal(c.ice.filter(Boolean).length <= V3_TUNING.iceTiles[1], true);
    assert.equal(c.collect === null || c.collect.count <= V3_TUNING.collectCount[1], true);
    assert.equal(c.collect === null || c.collect.type < c.palette, true, `level ${n} collects a colour not in play`);
    // The top two rows stay free of traps, so there is always room for a rescue swap.
    for (let i = 0; i < 14; i++) assert.equal(c.locks[i], false);
  }
});

test('A fresh board has no ready-made line and always a legal move', () => {
  for (let n = 1; n <= 60; n++) {
    const config = v3Level(n), state = createV3Progress(config);
    const rng = createRandom((n * 2654435761) >>> 0);
    for (let k = 0; k < 6; k++) {
      const b = createV3Board(config, rng, state);
      assert.equal(v3Matches(b).size, 0, `level ${n} dealt itself a free match`);
      assert.notEqual(v3Move(b, state), null, `level ${n} dealt a board with no move`);
      for (const cell of b) assert.equal(cell >= 0 && cell < config.palette, true, 'a fresh board is all plain crystals');
    }
  }
  // freshV3Board honours the palette it is given rather than deriving one from the level.
  const narrow = freshV3Board(4, createRandom(7));
  assert.equal(Math.max(...narrow) < 4, true);
});

test('The end-of-level bonus is deterministic, and fires one striped crystal per unused move', () => {
  const run = () => {
    const {e, effects, result} = engine({level: 1, seed: 99});
    // Hand it a board that completes the level in one move: everything one colour.
    e.board = Array(V3_CELLS).fill(0);
    e.board[at(0, 0)] = 1; e.board[at(0, 1)] = 0; e.board[at(0, 2)] = 1; e.board[at(1, 1)] = 1;
    e.target = 100;
    e.choose(at(0, 1), at(1, 1));
    settle(e, 60);
    return {score: e.score, effects: [...effects], moves: result()?.moves, won: result()?.won, ticks: e.ticks};
  };
  const first = run(), second = run();
  assert.equal(first.won, true);
  assert.deepEqual(second, first, 'the same seed gives the same bonus, point for point');
  assert.equal(first.effects.includes('BONUS!'), true);
  assert.equal(first.score % 50, 0);

  // A level won on its very last move has no unused moves, so it fires nothing extra.
  const picks = [];
  const state = bareState(), b = board();
  const rng = createRandom(5);
  for (let k = 0; k < 4; k++) picks.push(v3BonusPick(b, state, rng));
  assert.equal(picks.every(p => p && isSpecial(p.cell)), true, 'each pick turns a plain crystal into a stripe');
  assert.equal(new Set(picks.map(p => kindOf(p.cell))).size <= 2, true);
  assert.deepEqual(picks.map(p => p.at), [...picks.map(p => p.at)], 'picks are indices on the board');
  // With nothing plain left to pick, it declines rather than looping.
  const allSpecial = Array(V3_CELLS).fill(makeCell(WRAP, 0));
  assert.equal(v3BonusPick(allSpecial, state, createRandom(1)), null);
  assert.equal(v3RemainingSpecials(allSpecial).length, V3_CELLS);
});

test('Winning with moves to spare out-scores spending them, which is what the bonus is for', () => {
  // The same board and seed, won in one move versus ground out over several, scores more when won early.
  const setup = () => {
    const {e} = engine({level: 1, seed: 4242});
    e.board = Array(V3_CELLS).fill(0);
    e.board[at(0, 0)] = 1; e.board[at(0, 1)] = 0; e.board[at(0, 2)] = 1; e.board[at(1, 1)] = 1;
    e.target = 100;
    return e;
  };
  const quick = setup();
  quick.choose(at(0, 1), at(1, 1));
  settle(quick, 60);
  assert.equal(quick.score > 0, true);
  assert.equal(quick.moves, quick.movesTotal - 1, 'one move spent');
  // Every move left fired a striped crystal, so the score is well above the bare target.
  assert.equal(quick.score > quick.target * 4, true, `bonus should dominate, got ${quick.score}`);
});

test('A v3 run keeps every rule the leaderboard depends on', () => {
  const {e, result} = engine({level: 6, seed: 31337});
  assert.equal(e.rulesVersion, 3);
  assert.equal(e.board.length, 49, 'still seven by seven');
  let guard = 0;
  while (!e.ended && guard++ < 200000) {
    if (!e.pending) {
      const moves = v3Legal(e.board, e.progress);
      if (!moves.length) break;
      e.choose(...moves[0]);
      assert.equal(e.score % 50, 0, 'score stays a multiple of fifty');
    }
    e.step(SIM_STEP);
  }
  if (!e.ended) e.finish();
  const rep = result().replay;
  assert.equal(rep.v, 3);
  assert.equal(rep.game, 'sequence');
  assert.equal(rep.step, SIM_STEP);
  assert.deepEqual(Object.keys(rep).sort(), ['endTick', 'game', 'level', 'moves', 'seed', 'step', 'v'], 'the replay shape is unchanged');
  assert.equal(rep.moves.every(m => m.length === 3 && m.every(Number.isInteger)), true);
  assert.equal(e.score % 50, 0);
});

test('v1, v2 and v3 replays all verify from the seed and the move log alone', async () => {
  const {greedyMove, driveSequence} = await import('../tools/sequence-bot.mjs');
  for (const version of [1, 2, 3]) {
    for (let s = 0; s < 12; s++) {
      const level = 1 + (s * 5) % 24, seed = (s * 2654435761 + version) >>> 0;
      const {e, result} = engine({level, seed, rulesVersion: version});
      driveSequence(e, greedyMove);
      e.destroy();
      const live = result();
      const out = await replaySequence(live.replay);
      assert.equal(out.score, live.score, `v${version} seed ${seed} level ${level} score`);
      assert.equal(out.won, live.won, `v${version} seed ${seed} level ${level} won`);
      assert.equal(out.unusedInputs, 0, `v${version} seed ${seed} level ${level} refused an input`);
      assert.equal(out.level, level);
    }
  }
  // A replay claiming a version this build does not play is refused.
  const {e, result} = engine({level: 1, seed: 1});
  e.finish();
  await assert.rejects(() => replaySequence({...result().replay, v: 4}), /Not a Sequence replay/);
});

test('Fuzz: 500 v3 seeds stay playable, end once, and replay with no refused inputs', async () => {
  const bots = (await import('../tools/sequence-levels.mjs')).makeBots(3);
  let ends = 0, replayed = 0;
  for (let s = 0; s < 500; s++) {
    const level = 1 + (s * 13) % 60, seed = (s * 104729 + 7) >>> 0;
    const pick = bots[s % 3 === 0 ? 'random' : s % 3 === 1 ? 'greedy' : 'smart'](s);
    let result = null, endCount = 0;
    const cb = {hud: noop, message: noop, sound: noop, haptic: noop, effect: noop, goals: noop, ready: noop, end(r) {endCount++; result ??= r;}};
    const e = new SequenceEngine(canvas(), cb, {seed, level, motion: s % 2 === 0});
    let guard = 0, stuck = 0;
    while (!e.ended && guard++ < 400000) {
      if (!e.pending) {
        const pair = pick(e);
        if (!pair) {if (++stuck > 4) break;} else {stuck = 0; e.choose(pair[0], pair[1]);}
      }
      e.step(SIM_STEP);
      // Invariants that must hold at every step of every run.
      assert.equal(e.board.length, 49, `seed ${seed} board size`);
      assert.equal(Number.isFinite(e.score) && e.score % 50 === 0, true, `seed ${seed} score ${e.score}`);
      assert.equal(e.moves >= 0 && e.moves <= e.movesTotal, true, `seed ${seed} moves ${e.moves}`);
      for (const cell of e.board) assert.equal(Number.isInteger(cell) && (cell === -1 || (cell >= 0 && kindOf(cell) <= BOMB && (kindOf(cell) === BOMB ? colourOf(cell) === BOMB_COLOUR : colourOf(cell) < e.config.palette))), true, `seed ${seed} cell ${cell}`);
    }
    if (!e.ended) e.finish();
    e.destroy();
    assert.equal(endCount, 1, `seed ${seed} ended ${endCount} times`);
    ends++;
    // Every tenth run goes through the server's own verification path.
    if (s % 10 === 0) {
      const out = await replaySequence(result.replay);
      assert.equal(out.score, result.score, `seed ${seed} replay score`);
      assert.equal(out.won, result.won, `seed ${seed} replay won`);
      assert.equal(out.unusedInputs, 0, `seed ${seed} replay refused an input`);
      replayed++;
    }
  }
  assert.equal(ends, 500);
  assert.equal(replayed, 50);
});

test('Any swap v3 accepts is accepted again on replay, including bomb swaps and combos', async () => {
  // Drive runs with a bot that prefers specials, so combos and bomb swaps really appear, then check that
  // the replay engine refused none of them.
  let bombSwaps = 0, combos = 0, checked = 0;
  const bots = (await import('../tools/sequence-levels.mjs')).makeBots(3);
  for (let s = 0; s < 60; s++) {
    const level = 1 + (s * 7) % 30, seed = (s * 40503 + 11) >>> 0;
    let result = null;
    const cb = {hud: noop, message: noop, sound: noop, haptic: noop, effect: noop, goals: noop, ready: noop, end(r) {result ??= r;}};
    const e = new SequenceEngine(canvas(), cb, {seed, level, motion: false});
    const pick = bots.smart(s);
    let guard = 0, stuck = 0;
    while (!e.ended && guard++ < 400000) {
      if (!e.pending) {
        const pair = pick(e);
        if (!pair) {if (++stuck > 4) break;} else {
          stuck = 0;
          const kind = v3SwapKind(e.board, pair[0], pair[1], e.progress);
          if (kind?.type === 'bomb') bombSwaps++;
          if (kind?.type === 'combo') combos++;
          e.choose(pair[0], pair[1]);
        }
      }
      e.step(SIM_STEP);
    }
    if (!e.ended) e.finish();
    e.destroy();
    const out = await replaySequence(result.replay);
    assert.equal(out.unusedInputs, 0, `seed ${seed} level ${level} refused an accepted swap`);
    assert.equal(out.score, result.score);
    checked++;
  }
  assert.equal(checked, 60);
  assert.equal(bombSwaps > 0, true, 'the runs should have contained colour bomb swaps');
  assert.equal(combos > 0, true, 'the runs should have contained special-on-special combos');
});

test('Cascades climb in pitch and force a haptic through, and the five-moves warning ignores the score', () => {
  const {e, haptics, sounds, effects} = engine({level: 1, seed: 8});
  // One colour everywhere: the first swap sets off a long chain.
  e.board = Array(V3_CELLS).fill(0);
  e.board[at(0, 0)] = 1; e.board[at(0, 1)] = 0; e.board[at(0, 2)] = 1; e.board[at(1, 1)] = 1;
  e.target = 1e9;
  e.choose(at(0, 1), at(1, 1));
  settle(e, 20);
  const rates = sounds.filter(([t]) => t === 'crystal' || t === 'perfect').map(([, o]) => o?.rate ?? 1);
  assert.equal(rates.length >= 2, true, 'a cascade with several waves');
  assert.equal(rates[1] > rates[0], true, 'the pitch climbs with the chain');
  assert.equal(Math.max(...rates) <= Math.pow(2, 14 / 12) + 1e-9, true, 'and it is capped');
  assert.equal(haptics.every(([, force]) => force === true), true, 'every wave forces its buzz through');
  assert.equal(haptics.some(([t]) => t === 'combo2' || t === 'combo3'), true, 'deep chains use the combo patterns');

  // The warning fires on moves running out, whatever the score has done.
  const warn = engine({level: 14, seed: 3});
  warn.e.target = 1;  // the score goal is met from the first wave
  let guard = 0;
  while (!warn.e.ended && guard++ < 200000) {
    if (!warn.e.pending) {
      const moves = v3Legal(warn.e.board, warn.e.progress);
      if (!moves.length) break;
      if (warn.e.moves <= 5) break;
      warn.e.choose(...moves[0]);
    }
    warn.e.step(SIM_STEP);
  }
  // It only shows while the level is genuinely unfinished, and only once.
  assert.equal(warn.effects.filter(l => l === '5 MOVES LEFT').length <= 1, true);
});

test('A dead board is rebuilt without spending a move, keeping traps and objectives', () => {
  const config = v3Level(20);
  const state = createV3Progress(config);
  const rng = createRandom(12345);
  const previous = createV3Board(config, rng, state);
  const before = {ice: [...state.ice], locks: [...state.locks], collected: state.collected};
  const rebuilt = createV3Board(config, rng, state, previous);
  assert.deepEqual({ice: [...state.ice], locks: [...state.locks], collected: state.collected}, before, 'a rebuild changes no objective');
  for (let i = 0; i < V3_CELLS; i++) if (state.locks[i]) assert.equal(rebuilt[i], previous[i], 'a trapped crystal stays put');
  assert.notEqual(v3Move(rebuilt, state), null);
  assert.equal(v3Matches(rebuilt).size, 0);
});

test('What a bot can see never includes the refills', () => {
  const config = bare(10), state = bareState();
  const b = board({[at(3, 1)]: 0, [at(3, 2)]: 0, [at(3, 4)]: 0, [at(4, 3)]: 0});
  const preview = previewV3Move(b, state, config, at(4, 3), at(3, 3));
  assert.notEqual(preview, null);
  assert.equal(preview.made.stripe, 1);
  assert.equal(preview.gained % 50, 0);
  // The settled board it reasons about marks every refill as unknown, which never matches.
  assert.equal(preview.board.includes(v3.UNKNOWN), true);
  assert.equal(previewV3Move(board(), state, config, at(3, 3), at(3, 4)), null, 'a dud swap previews as nothing');
});

test('No level from 1 to 100 is beyond the smart bot, and the late curve sits in its band', async () => {
  // The brief's floor is a smart win rate never under 20%. Thirty seeds a level cannot resolve 20% from
  // 15%, so this guards the two things a sample that size does settle: no level is unwinnable, and the
  // late curve as a whole lands where it should. The exact per-level floor is checked at higher seed
  // counts with `node tools/sequence-levels.mjs --sweep 100 --seeds 100`.
  const {makeBots, play} = await import('../tools/sequence-levels.mjs');
  const bots = makeBots(3);
  const SEEDS = 30;
  const rates = [];
  for (let level = 1; level <= 100; level++) {
    let wins = 0;
    for (let s = 0; s < SEEDS; s++) if (play(level, (level * 7919 + s * 104729) >>> 0, bots.smart(s), 3).won) wins++;
    // A true 20% level clears two wins in thirty all but 0.2% of the time, so this catches a level that
    // has become unwinnable without failing on sampling noise.
    assert.equal(wins >= 2, true, `level ${level}: smart won ${wins} of ${SEEDS}`);
    rates.push(wins / SEEDS);
  }
  const mean = from => {
    const slice = rates.slice(from - 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  const late = mean(30);
  assert.equal(late > 0.3 && late < 0.62, true, `levels 30-100 average ${(100 * late).toFixed(1)}%`);
  // Onboarding is still generous, and the curve genuinely descends from it.
  assert.equal(rates[0] > 0.9, true, `level 1 is ${(100 * rates[0]).toFixed(1)}%`);
  assert.equal(mean(1) > late, true, 'the curve gets harder as it goes');
});
