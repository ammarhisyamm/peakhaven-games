// Sequence rules version 4: the eased early curve and the two helper tools.
//
// Two promises are load-bearing here. The first is that nothing before v4 moved: a v1, v2 or v3 run is
// still laid out, played and verified by exactly the rules it was played on, or every score on the board
// becomes a different score. The second is that the tools are rules, not decoration — they go in the
// replay, and the server refuses a log that spends one it could not have spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
globalThis.window = {devicePixelRatio: 1};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = class {complete = false; naturalWidth = 0;};
const {SequenceEngine} = await import('../dist/tryout-games.js');
const {replaySequence} = await import('../tools/replay.mjs');
const {verifySegment, RejectedRun} = await import('../arcade/server/verify.mjs');
const {SIM_STEP} = await import('../dist/rng.js');
const {
  SEQUENCE_V3_VERSION, SEQUENCE_V4_VERSION, SEQUENCE_LATEST_VERSION, SEQUENCE_TOOLS, SEQ_LOG,
  V3_TUNING, v3Level, v3Target, v3PerMove, v3QuotaShare, v3Brief, v3Goals, v3Move, createV3Progress,
} = await import('../dist/sequence-v3.js');
const objective = await import('../arcade/ui/game/sequence-objective.js');

const noop = () => {};
function canvas() {
  const ctx = new Proxy({}, {get: (t, k) => k in t ? t[k] : () => ctx, set: (t, k, v) => (t[k] = v, true)});
  return {getContext: () => ctx, getBoundingClientRect: () => ({width: 480, height: 720, left: 0, top: 0}), addEventListener: noop, removeEventListener: noop, setPointerCapture: noop};
}
function engine(options = {}) {
  let result = null;
  const messages = [], effects = [], tools = [];
  const cb = {
    hud: noop, goals: noop, ready: noop, haptic: noop, sound: noop,
    message: m => messages.push(m),
    effect: l => effects.push(l),
    tools: s => tools.push({...s}),
    end(r) {result ??= r;},
  };
  const e = new SequenceEngine(canvas(), cb, {seed: 1, level: 1, motion: false, ...options});
  return {e, messages, effects, tools, result: () => result};
}
function settle(e, seconds = 30) {
  for (let i = 0; i < seconds / SIM_STEP; i++) {
    if (e.ended || !e.pending) return;
    e.step(SIM_STEP);
  }
}

// ---------------------------------------------------------------- the early curve

test('v4 is the latest ruleset, and an unknown one still lands on it', () => {
  assert.equal(SEQUENCE_V4_VERSION, 4);
  assert.equal(SEQUENCE_LATEST_VERSION, 4);
  assert.equal(engine().e.rulesVersion, 4, 'free play gets the newest rules');
  assert.equal(engine({rulesVersion: 9}).e.rulesVersion, 4);
  for (const v of [1, 2, 3]) assert.equal(engine({rulesVersion: v}).e.rulesVersion, v, `v${v} is honoured`);
});

test('v3 is exactly where it was: the numbers the leaderboard was built on do not move', () => {
  // Pinned from the committed v3 curve. If a change to v4 ever moves one of these, every v3 score on the
  // board was earned against a different goal than the one it would be verified against.
  const pinned = {1: 6050, 2: 6150, 3: 5750, 4: 6550, 5: 7350, 6: 8600, 7: 10250, 8: 11550, 9: 12500,
    10: 13750, 11: 13850, 12: 14200, 13: 14200, 14: 13850, 15: 15200, 20: 16600, 25: 17150, 30: 17250,
    40: 17200, 55: 16750, 80: 15650, 100: 14700, 250: 14700};
  for (const [level, target] of Object.entries(pinned)) {
    assert.equal(v3Target(Number(level), 3), target, `v3 level ${level} goal`);
  }
  // And v3's ice still doubles at level 5, which is the cliff v4 moves.
  assert.equal(v3Level(4, 3).ice.includes(2), false);
  assert.equal(v3Level(5, 3).ice.includes(2), true, 'v3 keeps two-layer ice from level 5');
  // The default argument is v3, so every existing caller that has not been told about v4 is unaffected.
  assert.deepEqual(v3Level(7), v3Level(7, SEQUENCE_V3_VERSION));
  assert.equal(v3Target(7), v3Target(7, 3));
  assert.equal(v3Brief(7), v3Brief(7, 3));
  // And the whole curve at once: every v3 level from 1 to 200, config and brief. This fingerprint was taken
  // from the committed v3 code and checked against it level by level. Any change that moves a v3 level,
  // however indirectly, lands here — which is the point, because every v3 score on the board was earned
  // against these exact numbers and will be re-verified against them.
  const parts = [];
  for (let n = 1; n <= 200; n++) {
    const {version, ...config} = v3Level(n, 3);
    parts.push(JSON.stringify(config), v3Brief(n, 3));
  }
  assert.equal(createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32), '3b7da80c1db0db2fdbbb04052bb6911c',
    'the v3 curve moved: see the comment above before changing this hash');
});

test('v4 eases levels 1 to 14 and rejoins the solved curve at 15', () => {
  const {until} = V3_TUNING.early;
  assert.equal(until, 15);
  for (let n = 1; n < until; n++) {
    assert.ok(v3Target(n, 4) < v3Target(n, 3), `level ${n}: v4 ${v3Target(n, 4)} should be under v3 ${v3Target(n, 3)}`);
  }
  // From the meeting point up there is one curve, and the two must agree exactly.
  for (const n of [15, 16, 17, 20, 25, 30, 40, 55, 80, 100, 250]) {
    assert.equal(v3Target(n, 4), v3Target(n, 3), `level ${n} goal is shared`);
    assert.equal(v3PerMove(n, 4), v3PerMove(n, 3), `level ${n} points-per-move is shared`);
    const {version: a, ...v4} = v3Level(n, 4);
    const {version: b, ...v3} = v3Level(n, 3);
    assert.deepEqual(v4, v3, `level ${n} is identical in both`);
    assert.equal(a, 4);
    assert.equal(b, 3);
  }
  // The early knots have to land on the v3 curve at the meeting point, or the join is a step.
  const last = V3_TUNING.early.perMove.at(-1);
  assert.equal(last[0], until);
  assert.equal(last[1], v3PerMove(until, 3), 'the early curve ends on the v3 value');
  // Monotonic on the way up: no level asks for fewer points per move than the one before it.
  for (let n = 2; n <= 30; n++) assert.ok(v3PerMove(n, 4) >= v3PerMove(n - 1, 4), `level ${n} does not dip`);
});

test('v4 asks for less of each objective early, and waits to double the ice', () => {
  const iceHits = c => c.ice.reduce((sum, v) => sum + v, 0);
  for (let n = 1; n < V3_TUNING.early.until; n++) {
    const v4 = v3Level(n, 4), v3 = v3Level(n, 3);
    assert.ok(iceHits(v4) <= iceHits(v3), `level ${n} ice`);
    assert.ok((v4.collect?.count ?? 0) <= (v3.collect?.count ?? 0), `level ${n} collect`);
    assert.ok(v3QuotaShare(n, 4) <= 1 && v3QuotaShare(n, 4) >= V3_TUNING.early.quotaShare);
  }
  assert.equal(v3QuotaShare(1, 4), V3_TUNING.early.quotaShare, 'level 1 asks the least');
  assert.equal(v3QuotaShare(V3_TUNING.early.until, 4), 1, 'and the full quota is back at the meeting point');
  assert.equal(v3QuotaShare(8, 3), 1, 'v3 never eases');
  // Ice stays a single layer until the player has had a dozen levels of it.
  for (let n = 1; n < V3_TUNING.early.iceLayersFrom; n++) assert.equal(v3Level(n, 4).ice.includes(2), false, `level ${n}`);
  const doubled = [...Array(14)].map((_, i) => i + V3_TUNING.early.iceLayersFrom).find(n => v3Level(n, 4).ice.some(Boolean));
  assert.ok(v3Level(doubled, 4).ice.includes(2), `level ${doubled} has two-layer ice`);
  // Still every objective it is meant to have: easing must never remove one.
  for (let n = 1; n <= 30; n++) {
    const v4 = v3Level(n, 4), v3 = v3Level(n, 3);
    assert.equal(v4.plan, v3.plan, `level ${n} plan`);
    assert.equal(v4.moves, v3.moves, `level ${n} move allowance`);
    assert.equal(v4.ice.some(Boolean), v3.ice.some(Boolean), `level ${n} has ice or not`);
    assert.equal(v4.locks.some(Boolean), v3.locks.some(Boolean), `level ${n} has traps or not`);
    assert.equal(v4.collect !== null, v3.collect !== null, `level ${n} has a collection or not`);
  }
});

test('the brief, the move count and the goal all read the run own ruleset', () => {
  const LEVELS = {v2Level: () => ({target: 0}), v3Level};
  assert.equal(objective.SEQUENCE_LATEST, 4);
  assert.equal(objective.sequenceRulesVersion(null), 4, 'free play gets the newest');
  assert.equal(objective.sequenceRulesVersion({rulesVersion: 3}), 3, 'and a v3 run keeps v3');
  assert.equal(objective.sequenceRulesVersion({rulesVersion: 2}), 2);
  assert.equal(objective.sequenceTargetFor(4, 5, LEVELS), v3Target(5, 4));
  assert.equal(objective.sequenceTargetFor(3, 5, LEVELS), v3Target(5, 3));
  assert.notEqual(objective.sequenceTargetFor(4, 5, LEVELS), objective.sequenceTargetFor(3, 5, LEVELS));
  assert.equal(objective.sequenceMoves(4, 5, LEVELS), v3Level(5, 4).moves);
  assert.equal(objective.sequenceObjective(4, 5, {v2: () => 'v2', v3: v3Brief}), v3Brief(5, 4));
  assert.match(objective.sequenceObjective(4, 5, {v2: () => 'v2', v3: v3Brief}), new RegExp(String(v3Target(5, 4)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
  assert.equal(objective.sequenceHasTools(4), true);
  for (const v of [1, 2, 3]) assert.equal(objective.sequenceHasTools(v), false, `v${v} has no tools`);
});

// ---------------------------------------------------------------- the tools

test('only a v4 run has tools, and it gets two of each', () => {
  const {e} = engine({rulesVersion: 4});
  assert.deepEqual(e.tools, {shuffle: 2, hammer: 2});
  assert.deepEqual({...SEQUENCE_TOOLS}, {shuffle: 2, hammer: 2});
  for (const v of [1, 2, 3]) {
    const old = engine({rulesVersion: v}).e;
    assert.equal(old.tools, null, `v${v} has no tools`);
    assert.equal(old.useShuffle(), false, `v${v} cannot shuffle`);
    assert.equal(old.useHammer(0), false, `v${v} cannot hammer`);
    assert.equal(old.armHammer(), false);
    assert.equal(old.toolsUsed(), null);
  }
});

test('Shuffle re-mixes the board, always leaves a move, and costs no move', () => {
  const {e, tools} = engine({rulesVersion: 4, level: 6, seed: 404});
  const before = e.board.join(), moves = e.moves;
  assert.equal(e.useShuffle(), true);
  assert.notEqual(e.board.join(), before, 'the board really is re-mixed');
  assert.ok(v3Move(e.board, e.progress), 'and it always leaves a move');
  assert.equal(e.moves, moves, 'a tool is not a move');
  assert.equal(e.tools.shuffle, 1);
  assert.equal(e.useShuffle(), true);
  assert.equal(e.tools.shuffle, 0);
  assert.equal(e.useShuffle(), false, 'and that is the last of them');
  assert.equal(e.moves, moves);
  assert.deepEqual(e.toolsUsed(), {shuffle: 2, hammer: 0});
  assert.deepEqual(tools.at(-1), {shuffle: 0, hammer: 2, stuck: false, armed: false});
  // Every use is in the log, as the documented triple, and nothing else is.
  assert.deepEqual(e.inputs.map(m => m.slice(1)), [[SEQ_LOG.shuffle, -1], [SEQ_LOG.shuffle, -1]]);
});

test('Hammer breaks the crystal it is pointed at, scores it, and costs no move', () => {
  const {e} = engine({rulesVersion: 4, level: 6, seed: 77});
  const moves = e.moves, cell = e.board.findIndex((v, i) => v >= 0 && !e.progress.locks[i]);
  assert.equal(e.useHammer(cell), true);
  settle(e);
  assert.ok(e.score > 0, 'a broken crystal scores like a cleared one');
  assert.equal(e.score % 50, 0, 'and in the same units');
  assert.equal(e.moves, moves, 'a tool is not a move');
  assert.equal(e.tools.hammer, 1);
  assert.deepEqual(e.inputs[0].slice(1), [SEQ_LOG.hammer, cell]);
  assert.ok(v3Move(e.board, e.progress), 'the board is playable afterwards');
});

test('Hammer counts toward the goals, the way a cleared crystal does', () => {
  // A collection level, hammering the colour it is asking for.
  const level = [...Array(30)].map((_, i) => i + 1).find(n => v3Level(n, 4).collect);
  const {e} = engine({rulesVersion: 4, level, seed: 5});
  const wanted = e.config.collect.type;
  const before = v3Goals(e.config, e.progress).find(g => g.kind === 'collect').left;
  const cell = e.board.findIndex((v, i) => v === wanted && !e.progress.locks[i]);
  assert.ok(cell >= 0, 'the board has one of the wanted colour');
  assert.equal(e.useHammer(cell), true);
  settle(e);
  const after = v3Goals(e.config, e.progress).find(g => g.kind === 'collect').left;
  assert.ok(after < before, `collection should have moved, ${before} -> ${after}`);
});

test('Hammer refuses an empty cell, a trapped crystal, and a use it does not have', () => {
  const {e, messages} = engine({rulesVersion: 4, level: 7, seed: 12});
  assert.equal(e.useHammer(-1), false, 'off the board');
  assert.equal(e.useHammer(49), false);
  assert.equal(e.useHammer(1.5), false);
  assert.equal(e.tools.hammer, 2, 'a refusal spends nothing');
  // An empty cell: the board is never left with a hole at rest, so this guard is checked directly.
  const cell = e.board.findIndex((v, i) => v >= 0 && !e.progress.locks[i]);
  const was = e.board[cell];
  e.board[cell] = -1;
  assert.equal(e.useHammer(cell), false, 'nothing to break');
  assert.equal(e.tools.hammer, 2);
  e.board[cell] = was;
  // A trapped crystal is freed by a match beside its padlock, not by the hammer.
  const trapped = e.progress.locks.findIndex(Boolean);
  assert.ok(trapped >= 0, 'this level has traps');
  assert.equal(e.useHammer(trapped), false);
  assert.equal(e.tools.hammer, 2);
  // And when the uses are gone they are gone.
  e.tools.hammer = 0;
  assert.equal(e.useHammer(cell), false);
  assert.equal(e.inputs.length, 0, 'not one refusal reached the log');
  assert.equal(e.tools.hammer, 0, 'and the count is what the test set, not what a refusal spent');
});

test('an armed Hammer takes the next tap, and a tap it cannot break puts it away unspent', () => {
  const {e, messages, tools} = engine({rulesVersion: 4, level: 7, seed: 21});
  assert.equal(e.armHammer(), true);
  assert.equal(e.hammerArmed, true);
  assert.equal(tools.at(-1).armed, true);
  // Tapping a trapped crystal cannot break it, so the hammer goes away with nothing spent.
  const trapped = e.progress.locks.findIndex(Boolean);
  e.choose(trapped);
  assert.equal(e.hammerArmed, false);
  assert.equal(e.tools.hammer, 2, 'still two');
  assert.match(messages.at(-1), /trapped/i);
  // Armed again, on a crystal it can break.
  const cell = e.board.findIndex((v, i) => v >= 0 && !e.progress.locks[i]);
  assert.equal(e.armHammer(), true);
  e.choose(cell);
  assert.equal(e.tools.hammer, 1, 'that one was spent');
  assert.equal(e.hammerArmed, false);
  settle(e);
  // Arming can be cancelled, which spends nothing either.
  assert.equal(e.armHammer(), true);
  assert.equal(e.armHammer(false), true);
  assert.equal(e.hammerArmed, false);
  assert.equal(e.tools.hammer, 1);
});

test('a tool is refused mid-animation, when paused, and once the level is over', () => {
  const {e} = engine({rulesVersion: 4, level: 2, seed: 8});
  e.pending = 0.2;
  assert.equal(e.useShuffle(), false, 'not while the board is still moving');
  assert.equal(e.useHammer(0), false);
  assert.equal(e.armHammer(), false);
  e.pending = 0;
  e.paused = true;
  assert.equal(e.useShuffle(), false, 'not while paused');
  e.paused = false;
  e.finish();
  assert.equal(e.useShuffle(), false, 'not once it is over');
  assert.equal(e.useHammer(0), false);
  assert.equal(e.inputs.length, 0);
});

test('a board with no move waits for a tool, and re-mixes itself for free once there is none', () => {
  // finishMove is where the engine decides what to do about a board with no move. Hand-building a board
  // that truly has none is fiddly and beside the point, so the condition itself is what is stubbed.
  const dead = e => {e.findMove = () => null; return e;};
  const held = dead(engine({rulesVersion: 4, level: 2, seed: 3}).e);
  const before = held.board.join();
  held.finishMove();
  assert.equal(held.stuck, true, 'it waits');
  assert.equal(held.board.join(), before, 'and the board is left alone');
  assert.equal(held.useShuffle(), true, 'the tool is the way out');
  assert.equal(held.stuck, false);
  // With no tools left, the free re-mix still fires, so nobody is ever stranded.
  const free = dead(engine({rulesVersion: 4, level: 2, seed: 3}).e);
  free.tools.shuffle = 0;
  free.tools.hammer = 0;
  const was = free.board.join();
  free.finishMove();
  assert.equal(free.stuck, false);
  assert.notEqual(free.board.join(), was, 'the board was re-mixed');
  assert.ok(v3Move(free.board, free.progress));
  // v3 never waits: it has no tools to wait for.
  const old = dead(engine({rulesVersion: 3, level: 2, seed: 3}).e);
  const oldBoard = old.board.join();
  old.finishMove();
  assert.equal(old.stuck, false);
  assert.notEqual(old.board.join(), oldBoard, 'v3 re-mixes for free, exactly as it did');
});

// ---------------------------------------------------------------- replay and the server

// Plays a real v4 run that uses both tools, and hands back what the engine finished with.
async function toolRun({level = 6, seed = 909} = {}) {
  const {e, result} = engine({rulesVersion: 4, level, seed});
  const {greedyMove} = await import('../tools/sequence-bot.mjs');
  let used = 0;
  for (let guard = 0; guard < 400000 && !e.ended; guard++) {
    if (!e.pending) {
      // Spend the tools early, so the rest of the run is played out behind them.
      if (used === 0) {used++; e.useShuffle();}
      else if (used === 1) {used++; e.useHammer(e.board.findIndex((v, i) => v >= 0 && !e.progress.locks[i]));}
      else {
        const pair = greedyMove(e.board, e);
        if (!pair) {if (!e.useShuffle() && !e.useHammer(48)) break;} else e.choose(pair[0], pair[1]);
      }
    }
    e.step(SIM_STEP);
  }
  if (!e.ended) e.finish();
  const live = result();
  e.destroy();
  return {live, replay: live.replay, toolsUsed: used};
}

test('a v4 run that used its tools replays to the same score, from the seed and the log alone', async () => {
  const {live, replay} = await toolRun();
  assert.equal(replay.v, 4);
  assert.ok(replay.moves.some(m => m[1] === SEQ_LOG.shuffle), 'the log carries the shuffle');
  assert.ok(replay.moves.some(m => m[1] === SEQ_LOG.hammer), 'and the hammer');
  const out = await replaySequence(replay);
  assert.equal(out.score, live.score, 'the server reaches the same score');
  assert.equal(out.won, live.won);
  assert.equal(out.unusedInputs, 0, 'and every entry in the log was accepted');
});

test('the server rejects a log that spends a tool it never had', async () => {
  const {replay} = await toolRun();
  const extra = (from, to) => {
    const last = replay.moves.at(-1)[0];
    return {...replay, moves: [...replay.moves, [last, from, to]]};
  };
  // A third shuffle, and a third hammer: the run only ever had two of each.
  for (const forged of [extra(SEQ_LOG.shuffle, -1), extra(SEQ_LOG.hammer, 10)]) {
    const out = await replaySequence(forged);
    assert.ok(out.unusedInputs > 0, 'the replayer refuses the entry');
    await assert.rejects(
      () => verifySegment({game: 'sequence', replay: forged, seed: forged.seed, level: forged.level, rulesVersion: 4}),
      e => e instanceof RejectedRun && /unused or invalid inputs/.test(e.message));
  }
});

test('a malformed or mislabelled tool entry is refused outright', async () => {
  const {replay} = await toolRun();
  const tick = replay.moves.at(-1)[0];
  const bad = [
    [tick, SEQ_LOG.hammer, 49],      // a cell that is not on the board
    [tick, SEQ_LOG.hammer, -3],
    [tick, SEQ_LOG.shuffle, 4],      // a shuffle does not carry a cell
    [tick, -7, 0],                   // not a tool this build knows
    [tick, 0.5, 1],
  ];
  for (const entry of bad) {
    await assert.rejects(() => replaySequence({...replay, moves: [...replay.moves, entry]}), /Bad Sequence move log/,
      `${JSON.stringify(entry)} should be refused`);
  }
  // A v3 log cannot carry tools at all, however well formed the entry is.
  await assert.rejects(
    () => replaySequence({...replay, v: 3, moves: [[0, SEQ_LOG.shuffle, -1]]}), /Bad Sequence move log/);
});

test('v1, v2 and v3 replays still verify, and a v4 replay is refused for a v3 run', async () => {
  const {greedyMove, driveSequence} = await import('../tools/sequence-bot.mjs');
  for (const version of [1, 2, 3, 4]) {
    const {e, result} = engine({rulesVersion: version, level: 3, seed: 4242});
    driveSequence(e, greedyMove);
    e.destroy();
    const live = result();
    const out = await replaySequence(live.replay);
    assert.equal(out.score, live.score, `v${version} score`);
    assert.equal(out.unusedInputs, 0, `v${version} inputs`);
    // The server will only accept a replay on the rules the run was started with.
    const ok = await verifySegment({game: 'sequence', replay: live.replay, seed: live.replay.seed, level: 3, rulesVersion: version});
    assert.equal(ok.score, live.score);
    await assert.rejects(
      () => verifySegment({game: 'sequence', replay: live.replay, seed: live.replay.seed, level: 3, rulesVersion: version === 4 ? 3 : 4}),
      e => e instanceof RejectedRun && /different level rules/.test(e.message));
  }
});
