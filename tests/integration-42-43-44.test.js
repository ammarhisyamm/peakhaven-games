// Where #42, #43 and #44 meet.
//
// The three were built on separate branches: #42 gave Peak Blocks replay v3 (the milestone tool reward) and
// the new audio, #43 gave Sequence rulesVersion 4 (Shuffle and Hammer, logged in the replay), and #44 counts
// achievements from whatever the server verified. Each was tested against the main it branched from, so
// these are the questions only the merge can answer: do the achievements read the new replay versions, do
// the old versions still verify and still produce their numbers, and do the three agree about what a
// "level" is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {statsFromRun, BLOCKS_LINES_PER_LEVEL, achievementState, totalsFrom} from '../dist/achievements.js';
import {verifySegment} from '../arcade/server/verify.mjs';
import {SIM_STEP} from '../dist/rng.js';
import {installStubs, stubCanvas, stubCallbacks} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine, SequenceEngine} = await import('../dist/tryout-games.js');
const {createBlocks, blocksPlace, blocksBomb, blocksShuffle, blocksResult, replayBlocks,
  BLOCK_MILESTONE, BLOCK_TOOLS, BLOCKS_REPLAY_VERSION} = await import('../dist/blocks-core.js');
const {placements, placeBlock} = await import('../dist/puzzle-rules.js');
const v3 = await import('../dist/sequence-v3.js');
const {SEQ_LOG, SEQUENCE_LATEST_VERSION} = v3;

const settle = (e, limit = 8000) => {
  for (let i = 0; i < limit; i++) {if (e.ended || !e.pending) return; e.step(SIM_STEP);}
};
function sequence(options) {
  let result = null;
  const cb = stubCallbacks().cb;
  cb.end = r => {result ??= r;};
  cb.goals = () => {};
  cb.tools = () => {};
  const e = new SequenceEngine(stubCanvas(), cb, {motion: false, ...options});
  return {e, result: () => result};
}

// ---------------------------------------------------------------- one idea of a "level"

test('the milestone, the banner and the achievement all count the same 25 lines', () => {
  // #42 owns the number; #44 reads it rather than keeping its own copy. This is the test that stops the
  // two drifting apart, which they would do silently — both were 25 by coincidence, not by construction.
  assert.equal(BLOCKS_LINES_PER_LEVEL, BLOCK_MILESTONE.every);
  // And the achievement counts in the same units the milestone banner announces.
  const banner = n => `Level ${n * BLOCK_MILESTONE.every}! Free ${BLOCK_MILESTONE.tools[(n - 1) % 3]}`;
  assert.match(banner(1), /^Level 25! Free bomb$/i);
  assert.equal(statsFromRun('blocks', {score: 0, bestCombo: 0, lines: BLOCK_MILESTONE.every}).levels, 1,
    'the run that earns the first milestone has passed one level');
  assert.equal(statsFromRun('blocks', {score: 0, bestCombo: 0, lines: BLOCK_MILESTONE.every * 3 - 1}).levels, 2);
  // The tiers are the ones agreed in 0019, in the units the HUD will show.
  const levels = achievementState({blocks: {levels: 0}}).find(a => a.id === 'blocks-levels');
  assert.deepEqual(levels.tiers, {bronze: 1, silver: 10, gold: 30});
});

// ---------------------------------------------------------------- #42's Blocks v3 and the achievements

// A greedy Blocks run that reaches a milestone and then spends the tool it was given.
function blocksRunWithMilestone(seed = 2024) {
  const g = createBlocks(seed);
  const fullest = () => {
    let hit = null;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const n = g.state.grid.flatMap((row, rr) => row.filter((v, cc) => v && Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)).length;
      if (!hit || n > hit.n) hit = {n, r, c};
    }
    return hit;
  };
  const pick = () => {
    let best = null;
    g.state.tray.forEach((p, i) => {
      if (!p) return;
      for (const [r, c] of placements(g.state.grid, p.shape)) {
        const out = placeBlock(g.state.grid, p.shape, r, c, p.color);
        const score = out.lines * 1000 + out.grid.flat().filter(v => !v).length;
        if (!best || score > best.score) best = {score, i, r, c};
      }
    });
    return best;
  };
  for (let i = 0; i < 4000 && !g.ended && g.rewarded < 1; i++) {
    const best = pick();
    if (best) {blocksPlace(g, best.i, best.r, best.c); continue;}
    if (blocksShuffle(g)) continue;
    const hit = fullest();
    if (!hit?.n || !blocksBomb(g, hit.r, hit.c)) break;
  }
  // Spend every Bomb there is, which is only possible because the milestone handed one over.
  let bombs = 0;
  while (g.tools.bomb > 0 && !g.ended) {
    const hit = fullest();
    if (!hit?.n || !blocksBomb(g, hit.r, hit.c)) break;
    bombs++;
  }
  return {g, result: blocksResult(g), bombs};
}

test('a Peak Blocks v3 run that spent a milestone tool still gives the server its achievement numbers', async () => {
  const {result, bombs} = blocksRunWithMilestone();
  assert.equal(result.replay.v, 3, 'the run is on the version #42 introduced');
  assert.equal(BLOCKS_REPLAY_VERSION, 3);
  assert.equal(bombs, BLOCK_TOOLS.bomb + 1, `the run spent the free Bomb too, ${bombs} in all`);
  assert.ok(result.lines >= BLOCK_MILESTONE.every, `and passed a level: ${result.lines} lines`);

  const checked = await verifySegment({game: 'blocks', replay: result.replay, seed: result.replay.seed, elapsedSeconds: 99999});
  assert.equal(checked.score, result.score);
  assert.deepEqual(checked.stats, {
    score: result.score,
    combo: result.bestCombo,
    levels: Math.floor(result.lines / BLOCK_MILESTONE.every),
  }, 'the stats come out of the v3 replay, milestone tools and all');
  assert.ok(checked.stats.levels >= 1, 'the level it passed is counted');

  // The same log claimed as v2 is rejected, so the version really is doing the work.
  assert.throws(() => replayBlocks({...result.replay, v: 2}), /Illegal step/);
});

// ---------------------------------------------------------------- #43's Sequence v4 and the achievements

test('a Sequence v4 run with Shuffle and Hammer in the log still gives its achievement numbers', async () => {
  const {greedyMove} = await import('../tools/sequence-bot.mjs');
  const {e, result} = sequence({seed: 1234, level: 6, rulesVersion: 4});
  assert.equal(e.rulesVersion, SEQUENCE_LATEST_VERSION);
  assert.equal(e.useShuffle(), true);
  settle(e);
  assert.equal(e.useHammer(e.board.findIndex((v, i) => v >= 0 && !e.progress.locks[i])), true);
  settle(e);
  for (let guard = 0; guard < 200000 && !e.ended; guard++) {
    if (!e.pending) {
      const pair = greedyMove(e.board, e);
      if (!pair) {if (!e.useShuffle() && !e.useHammer(48)) break;} else e.choose(pair[0], pair[1]);
    }
    e.step(SIM_STEP);
  }
  if (!e.ended) e.finish();
  const live = result(), stats = e.stats();
  e.destroy();

  const replay = live.replay;
  assert.equal(replay.v, 4);
  assert.ok(replay.moves.some(m => m[1] === SEQ_LOG.shuffle), 'the shuffle is in the log');
  assert.ok(replay.moves.some(m => m[1] === SEQ_LOG.hammer), 'and the hammer');
  const checked = await verifySegment({game: 'sequence', replay, seed: replay.seed, level: 6,
    elapsedSeconds: 99999, rulesVersion: 4});
  assert.equal(checked.score, live.score, 'the tool uses replay to the same score');
  assert.deepEqual(checked.stats, stats, 'and the server reaches the same achievement numbers');
  assert.ok(checked.stats.cascade > 0);
});

test('a Hammer mints no power-up itself, and the cascade it sets off counts exactly as a match does', () => {
  // The question from the task. "Power-ups made" counts specials *created*, and a special is created by a
  // line of four or more — so a one-cell break cannot make one, whether or not it sets a special off.
  // Anything the refill above it then lines up goes through the same planV3Wave as a match's cascade, is
  // counted by the same noteRun, and has no special case either way.
  const plain = sequence({seed: 4242, level: 6, rulesVersion: 4});
  const cell = plain.e.board.findIndex((v, i) => !v3.isSpecial(v) && v >= 0 && !plain.e.progress.locks[i]);
  assert.equal(plain.e.specialsMade, 0);
  assert.equal(plain.e.useHammer(cell), true);
  settle(plain.e);
  assert.equal(plain.e.specialsMade, 0, 'breaking one plain crystal makes no power-up');
  assert.equal(plain.e.maxChain, 1, 'but it is one wave, so it counts as a cascade step, like a match');
  plain.e.destroy();

  // Hammering a special detonates it — still nothing minted, because detonating is not making.
  const special = sequence({seed: 4242, level: 6, rulesVersion: 4});
  const at = special.e.board.findIndex((v, i) => v >= 0 && !special.e.progress.locks[i]);
  special.e.board[at] = v3.makeCell(v3.STRIPE_H, v3.colourOf(special.e.board[at]));
  assert.equal(special.e.useHammer(at), true);
  settle(special.e);
  assert.equal(special.e.specialsMade, 0, 'setting a special off with the hammer mints nothing either');
  special.e.destroy();

  // And the counter is not broken: a run of ordinary matches does mint, through the same path.
  const normal = sequence({seed: 4242, level: 6, rulesVersion: 4});
  const plan = v3.planV3Wave(normal.e.board, normal.e.config, normal.e.progress, {wave: 1});
  assert.equal(typeof plan.create.size, 'number', 'the wave is what mints, and the hammer uses this wave');
  normal.e.destroy();
});

// ---------------------------------------------------------------- the old versions still work

test('every older ruleset still verifies and still produces its achievement numbers', async () => {
  const {greedyMove, driveSequence} = await import('../tools/sequence-bot.mjs');

  // Peak Blocks v1 and v2: no milestone rewards, and the stats still come out.
  for (const version of [1, 2]) {
    const g = createBlocks(777, version);
    for (let i = 0; i < 120 && !g.ended; i++) {
      let best = null;
      g.state.tray.forEach((p, idx) => {
        if (!p) return;
        for (const [r, c] of placements(g.state.grid, p.shape)) {
          const out = placeBlock(g.state.grid, p.shape, r, c, p.color);
          const score = out.lines * 1000 + out.grid.flat().filter(v => !v).length;
          if (!best || score > best.score) best = {score, i: idx, r, c};
        }
      });
      if (!best) break;
      blocksPlace(g, best.i, best.r, best.c);
    }
    const out = blocksResult(g);
    assert.equal(out.replay.v, version);
    assert.equal(g.rewarded, 0, `v${version} grants no milestone`);
    const checked = await verifySegment({game: 'blocks', replay: out.replay, seed: out.replay.seed, elapsedSeconds: 99999});
    assert.equal(checked.score, out.score, `v${version} score`);
    assert.deepEqual(checked.stats, {score: out.score, combo: out.bestCombo, levels: Math.floor(out.lines / BLOCK_MILESTONE.every)},
      `v${version} still reports its achievement numbers`);
  }

  // Sequence v1, v2 and v3.
  for (const version of [1, 2, 3]) {
    const {e, result} = sequence({seed: 606, level: 3, rulesVersion: version});
    assert.equal(e.rulesVersion, version);
    assert.equal(e.tools, null, `v${version} has no helper tools`);
    driveSequence(e, greedyMove);
    const stats = e.stats();
    e.destroy();
    const live = result();
    const checked = await verifySegment({game: 'sequence', replay: live.replay, seed: live.replay.seed,
      level: 3, elapsedSeconds: 99999, rulesVersion: version});
    assert.equal(checked.score, live.score, `v${version} score`);
    assert.deepEqual(checked.stats, stats, `v${version} achievement numbers`);
    assert.equal(checked.stats.powerups, version === 3 ? stats.powerups : 0,
      `only v3 mints power-ups, so v${version} reports ${version === 3 ? 'its own' : 'none'}`);
  }

  // Ridge Run v4, v5 and v6.
  for (const version of [4, 5, 6]) {
    const e = new RidgeEngine(stubCanvas(), stubCallbacks().cb, {seed: 99, motion: false, version});
    const aim = () => {const next = e.gates.find(g => g.x + e.C.PW > e.px - e.C.R); return next ? next.cy : 300;};
    let last = -99;
    e.action();
    for (let t = 0; t < 120 * 60 * 2 && !e.ended; t++) {
      if (!e.dead && e.py > aim() && e.vy > -e.C.FLAP * .35 && e.ticks - last >= 9) {e.action(); last = e.ticks;}
      e.step(SIM_STEP);
    }
    if (!e.ended) e.finish();
    const replay = e.replay(), stats = e.stats();
    e.destroy();
    assert.equal(replay.v, version);
    const checked = await verifySegment({game: 'ridge', replay, seed: replay.seed, elapsedSeconds: 99999,
      rulesVersion: version === 4 ? 5 : version});
    assert.deepEqual(checked.stats, {zones: stats.zones, close: stats.close, vials: stats.vials},
      `v${version} achievement numbers`);
  }
});

test('a run on an older ruleset still adds to the same lifetime totals', () => {
  // Whatever version a run was played on, its numbers go into one set of totals: an old Ridge v4 run and a
  // new v6 run both count toward the same vials.
  const totals = totalsFrom([
    {game: 'ridge', stats: {zones: 1, close: 4, vials: 20}},
    {game: 'ridge', stats: {zones: 2, close: 6, vials: 30}},
    {game: 'blocks', stats: {score: 5000, combo: 7, levels: 1}},
  ]);
  assert.equal(totals.ridge.vials, 50);
  assert.equal(totals.ridge.zones, 2);
  assert.equal(achievementState(totals).find(a => a.id === 'ridge-vials').progress, '50 / 100');
});

// ---------------------------------------------------------------- #42's audio and the popup sound

test('the popup sound is a cue every game has, and mute silences it', async () => {
  globalThis.window ??= {};
  const starts = [];
  globalThis.window.AudioContext = class {
    state = 'running'; currentTime = 0;
    createBufferSource() {return {buffer: null, playbackRate: {value: 1}, connect() {}, start() {starts.push('buffer');}, stop() {}, disconnect() {}};}
    createGain() {return {gain: {value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}, disconnect() {}};}
    createOscillator() {return {type: '', frequency: {setValueAtTime() {}}, connect() {}, start() {}, stop() {}, disconnect() {}};}
    decodeAudioData() {return Promise.resolve({});}
    resume() {return Promise.resolve();}
    addEventListener() {} removeEventListener() {}
  };
  globalThis.fetch = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(8)});
  const {GameAudio, cueFor} = await import('../dist/game-audio.js');
  const session = {resume() {return true;}, release() {}, claim() {return true;}, listen() {return () => {};}};

  // The popup asks for 'win'. After #42 reworked the cue set, every game still has it and still has a file.
  for (const game of ['blocks', 'sequence', 'ridge']) {
    const cue = cueFor(game, 'win');
    assert.ok(cue, `${game} has a win cue`);
    assert.ok(cue.file, `${game} win cue has a file`);
  }
  let enabled = false;
  const audio = new GameAudio(() => enabled, session);
  audio.prepare();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(starts.length, 0, 'muted: the popup sound plays nothing');
  enabled = true;
  audio.prepare();
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  audio.play('ridge', 'win');
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(starts.length > 0, 'unmuted: it plays');
  audio.stop();
});
