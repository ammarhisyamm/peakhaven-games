// Two follow-ups: Peak Blocks' visible level, and loading each game's sounds only when that game opens.
//
// The level is display only. The milestone it is built on already existed and already granted the tool; all
// that changes is that the player can see which level they are on and the banner names it. So the load-
// bearing test here is the negative one: the rules, the scoring, the log and the replay version are
// untouched, and a run played before this change still replays to the same score.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createBlocks, blocksPlace, blocksBomb, blocksShuffle, blocksUndo, blocksResult, replayBlocks,
  blocksLevel, levelsPassed, milestoneReward, BLOCK_MILESTONE, BLOCK_TOOLS, BLOCK_SCORE,
  BLOCKS_REPLAY_VERSION} from '../dist/blocks-core.js';
import {statsFromRun, BLOCKS_LINES_PER_LEVEL, achievementState} from '../dist/achievements.js';
import {EVENTS, SHARED_FILES, ALL_FILES, filesFor, cueFor, GameAudio} from '../dist/game-audio.js';
import {placements, placeBlock} from '../dist/puzzle-rules.js';

// ---------------------------------------------------------------- the level the player sees

test('the level starts at 1 and goes up every 25 lines', () => {
  assert.equal(BLOCK_MILESTONE.every, 25);
  assert.equal(blocksLevel(0), 1, 'a fresh board is level 1, not level 0');
  for (const [lines, level] of [[0, 1], [1, 1], [24, 1], [25, 2], [26, 2], [49, 2], [50, 3], [74, 3], [75, 4], [250, 11]]) {
    assert.equal(blocksLevel(lines), level, `${lines} lines is level ${level}`);
  }
  // Nonsense never makes it a level other than 1.
  for (const bad of [null, undefined, NaN, -5, 'lots', {}]) assert.equal(blocksLevel(bad), 1, String(bad));
});

test('the level shown and the levels passed differ by one, on purpose', () => {
  // The HUD shows the level you are ON; the achievement counts the levels you have PASSED.
  for (const lines of [0, 24, 25, 49, 50, 99, 100]) {
    assert.equal(blocksLevel(lines), levelsPassed(lines) + 1, `${lines} lines`);
  }
  assert.equal(levelsPassed(24), 0);
  assert.equal(levelsPassed(25), 1, 'clearing 25 lines passes one level');
  assert.equal(blocksLevel(25), 2, 'and puts the player on level 2');
});

test('the banner names the level the player just reached', () => {
  assert.equal(milestoneReward(1).label, 'Level 2! Free Bomb');
  assert.equal(milestoneReward(2).label, 'Level 3! Free Undo');
  assert.equal(milestoneReward(3).label, 'Level 4! Free Shuffle');
  assert.equal(milestoneReward(4).label, 'Level 5! Free Bomb', 'and the tools keep rotating');
  // The banner's level is the level the HUD is showing at the moment it fires.
  for (const n of [1, 2, 3, 4, 7]) {
    const reward = milestoneReward(n);
    assert.equal(reward.level, blocksLevel(reward.lines), `milestone ${n} agrees with the HUD`);
    assert.match(reward.label, new RegExp(`^Level ${blocksLevel(reward.lines)}! Free `));
  }
});

test('the HUD, the banner and the achievement all count the same thing', () => {
  assert.equal(BLOCKS_LINES_PER_LEVEL, BLOCK_MILESTONE.every, 'one constant behind all three');
  // The achievement counts levels passed, from the same helper the HUD uses.
  for (const lines of [0, 25, 60, 125]) {
    assert.equal(statsFromRun('blocks', {score: 0, bestCombo: 0, lines}).levels, levelsPassed(lines));
    assert.equal(statsFromRun('blocks', {score: 0, bestCombo: 0, lines}).levels, blocksLevel(lines) - 1);
  }
  // And the tiers are unchanged.
  const levels = achievementState({blocks: {levels: 3}}).find(a => a.id === 'blocks-levels');
  assert.deepEqual(levels.tiers, {bronze: 1, silver: 10, gold: 30});
  assert.equal(levels.value, 3);
  assert.equal(levels.progress, '3 / 10');
  assert.match(levels.describe, /cleared lines each/);
  assert.equal(levels.label, 'Levels passed', 'the wording says passed, so the off-by-one reads right');
});

// ---------------------------------------------------------------- and nothing else moved

test('the level changes no rule, no score, no log and no replay version', () => {
  assert.equal(BLOCKS_REPLAY_VERSION, 3, 'still v3');
  // The scoring table is untouched.
  assert.deepEqual({...BLOCK_SCORE}, {cell: 1, clearCell: 10, lineMult: [0, 1, 3, 6, 10, 15, 20],
    comboStep: .5, comboGrace: 3, perfect: 300});
  assert.deepEqual({...BLOCK_TOOLS}, {bomb: 3, undo: 3, shuffle: 3, hint: 3});
  // A run's state carries no level: it is worked out from the lines when something wants to show it.
  const g = createBlocks(5);
  assert.equal('level' in g.state, false, 'no level in the run state');
  assert.equal('level' in g, false);
  // A fingerprint of a whole scripted run: every placement's points, lines, combo and the log it wrote.
  // If the level work had touched the rules anywhere, this is where it would show.
  const DOT = [[0, 0]];
  const run = createBlocks(99);
  const trace = [];
  for (let i = 0; i < 60; i++) {
    const grid = run.state.grid.map(row => [...row]);
    for (let c = 1; c < 8; c++) grid[7][c] = 1;
    run.state.grid = grid;
    run.state.tray = [{shape: DOT, color: 1}, null, null];
    run.state.selected = 0;
    const out = blocksPlace(run, 0, 7, 0);
    trace.push([out.points, out.lines, out.combo, run.state.score, run.state.lines,
      out.rewards.map(r => r.tool).join('')]);
  }
  // Pinned from the rules as they were before the level work. Points, lines, combo, running score and the
  // reward schedule, over sixty placements: if the display work had reached into the rules anywhere, this is
  // where it would show.
  assert.equal(createHash('sha256').update(JSON.stringify(trace)).digest('hex').slice(0, 24),
    '5052b8115b8a75f70eaa8050', 'the Blocks rules moved — see the comment above before changing this hash');
  assert.equal(run.state.score, 93660, 'and the same run still scores the same');
  // The rewards still arrive at the same lines, in the same rotation.
  const paid = trace.filter(t => t[5]).map((t, i) => [t[4], t[5]]);
  assert.deepEqual(paid, [[25, 'bomb'], [50, 'undo']], 'unchanged milestone schedule');
  assert.equal(run.tools.bomb, BLOCK_TOOLS.bomb + 1);
  assert.equal(run.tools.undo, BLOCK_TOOLS.undo + 1);
});

test('a real run still replays to the same score, and the level is nowhere in the replay', () => {
  const g = createBlocks(2024);
  const fullest = () => {
    let hit = null;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const n = g.state.grid.flatMap((row, rr) => row.filter((v, cc) => v && Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)).length;
      if (!hit || n > hit.n) hit = {n, r, c};
    }
    return hit;
  };
  for (let i = 0; i < 2000 && !g.ended; i++) {
    let best = null;
    g.state.tray.forEach((p, idx) => {
      if (!p) return;
      for (const [r, c] of placements(g.state.grid, p.shape)) {
        const out = placeBlock(g.state.grid, p.shape, r, c, p.color);
        const score = out.lines * 1000 + out.grid.flat().filter(v => !v).length;
        if (!best || score > best.score) best = {score, i: idx, r, c};
      }
    });
    if (best) {blocksPlace(g, best.i, best.r, best.c); continue;}
    if (blocksShuffle(g)) continue;
    const hit = fullest();
    if (!hit?.n || !blocksBomb(g, hit.r, hit.c)) break;
  }
  const result = blocksResult(g);
  assert.ok(result.lines >= BLOCK_MILESTONE.every, `the run passed a level: ${result.lines} lines`);
  assert.equal(result.replay.v, 3);
  // The log is moves only: no level, no banner, nothing display-related.
  const kinds = new Set(result.replay.log.map(step => step[0]));
  for (const kind of kinds) assert.ok(['p', 'b', 'u', 's', 'h'].includes(kind), `unexpected log entry ${kind}`);
  assert.deepEqual(Object.keys(result.replay).sort(), ['game', 'log', 'seed', 'v']);
  // And it still replays to the same score on the server's side of the fence.
  const replayed = replayBlocks(result.replay);
  assert.equal(replayed.score, result.score);
  assert.equal(replayed.lines, result.lines);
  assert.equal(replayed.bestCombo, result.bestCombo);
  // Which means the level the HUD would show is reproducible too, without being stored.
  assert.equal(blocksLevel(replayed.lines), blocksLevel(result.lines));
});

test('Undo rewinds the level with the lines, because the level is only ever derived', () => {
  const DOT = [[0, 0]];
  const g = createBlocks(7);
  const clear = () => {
    const grid = g.state.grid.map(row => [...row]);
    for (let c = 1; c < 8; c++) grid[7][c] = 1;
    g.state.grid = grid;
    g.state.tray = [{shape: DOT, color: 1}, null, null];
    g.state.selected = 0;
    return blocksPlace(g, 0, 7, 0);
  };
  for (let i = 0; i < 25; i++) clear();
  assert.equal(g.state.lines, 25);
  assert.equal(blocksLevel(g.state.lines), 2);
  assert.equal(blocksUndo(g), true);
  assert.equal(g.state.lines, 24);
  assert.equal(blocksLevel(g.state.lines), 1, 'the level goes back with the lines');
  assert.equal(g.tools.bomb, BLOCK_TOOLS.bomb + 1, 'but the tool it already paid out stays');
});

// ---------------------------------------------------------------- loading each game's sounds

const audioPath = name => fileURLToPath(new URL(`../dist/assets/audio/${name}.wav`, import.meta.url));
const bytes = list => list.reduce((sum, f) => sum + statSync(audioPath(f)).size, 0);

test('a game loads the shared sounds plus its own, and nothing else', () => {
  // The shared set is what the menus use, so every game needs it.
  assert.deepEqual([...SHARED_FILES], ['clank', 'clear', 'fail', 'rim', 'score', 'swish', 'tap', 'thunk', 'whoosh']);
  for (const file of ALL_FILES) assert.ok(existsSync(audioPath(file)), `${file}.wav exists`);

  // Peak Blocks owns the cascades; nothing else can reach them.
  const blocks = filesFor('blocks');
  for (const cascade of ['blk-combo-1', 'blk-combo-5', 'blk-combo-big', 'blk-clear', 'blk-big']) {
    assert.ok(blocks.includes(cascade), `blocks reaches ${cascade}`);
  }
  for (const game of ['tower', 'merge', 'sort', 'mahjong', 'orbit', 'ridge', 'bond', 'sequence']) {
    const own = filesFor(game);
    assert.equal(own.filter(f => f.startsWith('blk-')).length, 0, `${game} never asks for a Blocks sound`);
  }
  // Ridge Run owns its jump, and no other game can reach that either.
  assert.ok(filesFor('ridge').includes('ridge-jump'));
  for (const game of ['tower', 'merge', 'sort', 'blocks', 'mahjong', 'orbit', 'bond', 'sequence']) {
    assert.equal(filesFor(game).includes('ridge-jump'), false, `${game} does not load the Ridge jump`);
  }
  // Every file in the set is one some game can actually ask for: nothing is downloaded for nobody.
  const reachable = new Set([...SHARED_FILES, ...['tower', 'merge', 'sort', 'blocks', 'mahjong', 'orbit',
    'ridge', 'bond', 'sequence'].flatMap(filesFor)]);
  assert.deepEqual([...ALL_FILES].filter(f => !reachable.has(f)), [], 'no orphan files in the set');
});

test('the download is a game\'s own sounds, not all of them', () => {
  const all = bytes([...ALL_FILES]);
  const shared = bytes([...SHARED_FILES]);
  assert.ok(all > 700 * 1024, `the whole set is still ${(all / 1024).toFixed(0)} KB`);
  // What each game now fetches: the shared set plus its own.
  const forGame = game => bytes([...new Set([...SHARED_FILES, ...filesFor(game)])]);
  for (const game of ['tower', 'merge', 'sort', 'mahjong', 'orbit', 'bond', 'sequence']) {
    assert.equal(forGame(game), shared, `${game} downloads the shared set and nothing more`);
    assert.ok(forGame(game) < all / 7, `${game} downloads far less than everything`);
  }
  assert.ok(forGame('ridge') < shared + 20 * 1024, 'Ridge Run adds only its jump');
  assert.ok(forGame('ridge') < all / 7, 'so a Ridge player no longer downloads the cascades');
  // Peak Blocks is the game that owns the cascades, so it is the one that still fetches them.
  assert.ok(forGame('blocks') > all * .9, 'Peak Blocks still needs its own sounds');
});

test('a cue whose file has not arrived yet uses the synth, rather than going silent', async () => {
  // The set is fetched per game, so a cue can be asked for before its download lands. That path already
  // existed for a slow network; this is the test that it still covers the lazy case.
  globalThis.window ??= {};
  const starts = [];
  let settle = null;
  globalThis.window.AudioContext = class {
    state = 'running'; currentTime = 0;
    createBufferSource() {return {buffer: null, playbackRate: {value: 1}, connect() {}, start() {starts.push('sample');}, stop() {}, disconnect() {}};}
    createGain() {return {gain: {value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}, disconnect() {}};}
    createOscillator() {return {type: '', frequency: {setValueAtTime() {}}, connect() {}, start() {starts.push('synth');}, stop() {}, disconnect() {}};}
    decodeAudioData() {return Promise.resolve({});}
    resume() {return Promise.resolve();}
    addEventListener() {} removeEventListener() {}
  };
  // A download that never finishes while the cue is asked for.
  globalThis.fetch = () => new Promise(resolve => {settle = () => resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(8)});});
  const session = {resume() {return true;}, release() {}, claim() {return true;}, listen() {return () => {};}};
  const audio = new GameAudio(() => true, session);
  audio.play('blocks', 'clear3');
  await new Promise(r => setTimeout(r, 150));
  // The synth plays one oscillator per note of the cue, so a chord is several starts; what matters is that
  // something sounded and that it was not the sample, which had not arrived.
  assert.ok(starts.length > 0, 'the synth answered the tap instead of nothing happening');
  assert.deepEqual([...new Set(starts)], ['synth'], 'and no sample was started');
  settle?.();
  audio.stop();
});

test('the events a game can ask for are the ones the cue table answers', () => {
  // The per-game sets are derived from this list, so it has to be the real vocabulary.
  for (const event of EVENTS) {
    const answered = ['tower', 'merge', 'sort', 'blocks', 'mahjong', 'orbit', 'ridge', 'bond', 'sequence', null]
      .some(game => cueFor(game, event));
    assert.ok(answered, `${event} is answered by at least one game`);
  }
  // The internal cue names are not events: a game reaches them only through its own overrides.
  for (const internal of ['blkPick', 'blkClear1', 'ridgeJump']) {
    assert.equal(EVENTS.includes(internal), false, `${internal} is a cue, not an event`);
  }
});
