// Achievements: the counting, the tiers, and the one rule the whole feature rests on — only a run the
// server verified for itself ever counts, and a run that stops counting takes its achievements with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS, TIERS, BLOCKS_LINES_PER_LEVEL, GAMES_WITH_ACHIEVEMENTS, achievementsFor, achievementById,
  statsFromRun, cleanStats, addRun, totalsFrom, totalsFromShelf, tierFor, achievementState, newlyEarned, wouldEarn,
} from '../arcade/ui/achievements.js';
import {achievementShelf, achievementSummary, createAchievementPopup} from '../arcade/ui/achievement-ui.js';
import {createMemoryStore, createMemoryAuth} from '../arcade/server/memory-store.mjs';
import {createHandlers} from '../arcade/server/handlers.mjs';
import {verifySegment} from '../arcade/server/verify.mjs';
import {seedFor, dayKey} from '../arcade/server/competition.mjs';
import {SIM_STEP} from '../dist/rng.js';
import {installStubs, stubCanvas, stubCallbacks} from './ridge-planner.mjs';
installStubs();
const {RidgeEngine, SequenceEngine} = await import('../dist/tryout-games.js');
const {createBlocks, blocksPlace, blocksResult} = await import('../dist/blocks-core.js');
const {placements, placeBlock} = await import('../dist/puzzle-rules.js');

const SECRET = 'achievement-test-secret';

// ---------------------------------------------------------------- the list itself

test('every achievement is one of the three games, with three rising tiers', () => {
  assert.deepEqual([...GAMES_WITH_ACHIEVEMENTS].sort(), ['blocks', 'ridge', 'sequence']);
  assert.equal(ACHIEVEMENTS.length, 8);
  assert.deepEqual(achievementsFor('blocks').map(a => a.metric), ['score', 'combo', 'levels']);
  assert.deepEqual(achievementsFor('sequence').map(a => a.metric), ['cascade', 'powerups']);
  assert.deepEqual(achievementsFor('ridge').map(a => a.metric), ['zones', 'close', 'vials']);
  for (const a of ACHIEVEMENTS) {
    assert.ok(['best', 'total'].includes(a.kind), `${a.id} kind`);
    assert.ok(a.tiers.bronze > 0, `${a.id} bronze is above nothing`);
    assert.ok(a.tiers.bronze < a.tiers.silver, `${a.id} silver is above bronze`);
    assert.ok(a.tiers.silver < a.tiers.gold, `${a.id} gold is above silver`);
    assert.equal(typeof a.describe(a.tiers.gold), 'string');
    assert.ok(a.describe(a.tiers.gold).includes(a.tiers.gold.toLocaleString('en-AU')), `${a.id} says its number`);
  }
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, ACHIEVEMENTS.length, 'the ids are unique');
  // Billy's own example of the wording, so the thresholds behind it cannot drift away from it.
  assert.equal(achievementById('ridge-vials').tiers.gold, 250);
  assert.equal(achievementById('blocks-score').tiers.bronze, 1000);
});

test('a tier is reached at its threshold and not before', () => {
  const a = achievementById('ridge-vials');
  assert.deepEqual(tierFor(a, 0), {tier: null, next: {tier: 'bronze', at: 25}});
  assert.deepEqual(tierFor(a, 24), {tier: null, next: {tier: 'bronze', at: 25}});
  assert.deepEqual(tierFor(a, 25), {tier: 'bronze', next: {tier: 'silver', at: 100}});
  assert.deepEqual(tierFor(a, 249), {tier: 'silver', next: {tier: 'gold', at: 250}});
  assert.deepEqual(tierFor(a, 250), {tier: 'gold', next: null});
  assert.deepEqual(tierFor(a, 9999), {tier: 'gold', next: null});
  // Nonsense is nothing, never a tier.
  for (const bad of [null, undefined, NaN, -5, 'lots', {}]) assert.equal(tierFor(a, bad).tier, null, String(bad));
});

test('the shelf says where the player is and what is next, in one wording', () => {
  const totals = {ridge: {zones: 2, close: 12, vials: 140}};
  const shelf = achievementState(totals, {game: 'ridge'});
  const vials = shelf.find(e => e.id === 'ridge-vials');
  assert.equal(vials.progress, '140 / 250', 'the example from the task, word for word');
  assert.equal(vials.tier, 'silver');
  assert.deepEqual(vials.next, {tier: 'gold', at: 250});
  assert.equal(shelf.find(e => e.id === 'ridge-close').progress, '12 / 100');
  assert.equal(shelf.find(e => e.id === 'ridge-zones').tier, 'silver');
  // A gold is finished: no next tier, and the goal stays the gold number so the bar stays full.
  const done = achievementState({ridge: {vials: 400}}, {game: 'ridge'}).find(e => e.id === 'ridge-vials');
  assert.equal(done.tier, 'gold');
  assert.equal(done.next, null);
  assert.equal(done.done, true);
  assert.equal(done.progress, '400 / 250');
  // Nothing played yet still lists all eight, so a new player can see what there is.
  assert.equal(achievementState({}).length, 8);
  assert.ok(achievementState({}).every(e => e.tier === null && e.value === 0));
  // And the totals come back out of the shelf, which is how the browser avoids being told them twice.
  assert.deepEqual(totalsFromShelf(achievementState(totals)).ridge, totals.ridge);
});

// ---------------------------------------------------------------- counting

test('a best keeps the highest run; a lifetime total adds every run up', () => {
  const totals = totalsFrom([
    {game: 'ridge', stats: {zones: 1, close: 7, vials: 40}},
    {game: 'ridge', stats: {zones: 3, close: 5, vials: 60}},
    {game: 'ridge', stats: {zones: 2, close: 1, vials: 2}},
  ]);
  assert.equal(totals.ridge.zones, 3, 'zones is a best');
  assert.equal(totals.ridge.close, 13, 'CLOSE! moments add up');
  assert.equal(totals.ridge.vials, 102, 'and so do vials');
  // Each game keeps its own numbers.
  const mixed = totalsFrom([
    {game: 'blocks', stats: {score: 9000, combo: 4, levels: 2}},
    {game: 'blocks', stats: {score: 2000, combo: 11, levels: 3}},
    {game: 'sequence', stats: {cascade: 5, powerups: 30}},
    {game: 'sequence', stats: {cascade: 8, powerups: 25}},
  ]);
  assert.deepEqual(mixed.blocks, {score: 9000, combo: 11, levels: 5});
  assert.deepEqual(mixed.sequence, {cascade: 8, powerups: 55});
  assert.deepEqual(totalsFrom([]), {});
});

test('only the numbers a game has an achievement for are kept', () => {
  assert.deepEqual(cleanStats('ridge', {zones: 1, close: 2, vials: 3, cheated: 999}), {zones: 1, close: 2, vials: 3});
  assert.deepEqual(cleanStats('blocks', {}), {score: 0, combo: 0, levels: 0});
  assert.equal(cleanStats('tower', {score: 5}), null, 'a game with no achievements stores nothing');
  assert.equal(cleanStats('ridge', null), null);
  // A stray key cannot sneak into a total either.
  const totals = addRun({}, 'ridge', {zones: 1, nonsense: 50});
  assert.deepEqual(totals.ridge, {zones: 1, close: 0, vials: 0});
  // Nor can a negative or a fraction.
  assert.deepEqual(addRun({}, 'ridge', {zones: -4, close: 2.7, vials: '12'}).ridge, {zones: 0, close: 2, vials: 12});
});

test('Peak Blocks levels are counted in lines, the way the game shows them', () => {
  assert.equal(BLOCKS_LINES_PER_LEVEL, 25);
  assert.equal(statsFromRun('blocks', {score: 1, bestCombo: 1, lines: 24}).levels, 0);
  assert.equal(statsFromRun('blocks', {score: 1, bestCombo: 1, lines: 25}).levels, 1);
  assert.equal(statsFromRun('blocks', {score: 1, bestCombo: 1, lines: 74}).levels, 2);
  assert.deepEqual(statsFromRun('blocks', {score: 1200, bestCombo: 6, lines: 50}), {score: 1200, combo: 6, levels: 2});
  assert.deepEqual(statsFromRun('sequence', {cascade: 4, powerups: 9}), {cascade: 4, powerups: 9});
  assert.deepEqual(statsFromRun('ridge', {zones: 1, close: 3, vials: 7, gates: 60}), {zones: 1, close: 3, vials: 7});
  assert.equal(statsFromRun('tower', {score: 10}), null);
});

test('newlyEarned names only the tiers that were crossed', () => {
  const before = {ridge: {vials: 24, close: 0, zones: 0}};
  const after = {ridge: {vials: 26, close: 0, zones: 0}};
  assert.deepEqual(newlyEarned(before, after).map(e => [e.id, e.tier]), [['ridge-vials', 'bronze']]);
  assert.deepEqual(newlyEarned(after, after), [], 'standing still earns nothing');
  // Two tiers in one jump reports the one it landed on, not both.
  assert.deepEqual(newlyEarned({}, {ridge: {vials: 300}}).map(e => e.tier), ['gold']);
  // And a run in progress can be asked what it would earn if it stopped now.
  const live = wouldEarn({ridge: {vials: 240, close: 95, zones: 1}}, 'ridge', {zones: 2, close: 6, vials: 11});
  assert.deepEqual(live.map(e => [e.id, e.tier]).sort(), [['ridge-close', 'silver'], ['ridge-vials', 'gold'], ['ridge-zones', 'silver']]);
  assert.equal(wouldEarn({}, 'tower', {score: 5}).length, 0);
});

// ---------------------------------------------------------------- the numbers come from the replay

test('the verifier works the stats out from the replay, for all three games', async () => {
  // Ridge Run: fly a real run, then check the server reaches the same numbers from the log alone.
  const e = new RidgeEngine(stubCanvas(), stubCallbacks().cb, {seed: 5, motion: false, version: 6});
  const aim = () => {const next = e.gates.find(g => g.x + e.C.PW > e.px - e.C.R); return next ? next.cy : 300;};
  let last = -99;
  e.action();
  for (let t = 0; t < 120 * 60 * 3 && !e.ended; t++) {
    if (!e.dead && e.py > aim() && e.vy > -e.C.FLAP * .35 && e.ticks - last >= 9) {e.action(); last = e.ticks;}
    e.step(SIM_STEP);
  }
  if (!e.ended) e.finish();
  const live = e.stats(), replay = e.replay();
  e.destroy();
  assert.ok(live.close > 0 && live.vials > 0, `the run should have done something: ${JSON.stringify(live)}`);
  const checked = await verifySegment({game: 'ridge', replay, seed: replay.seed, elapsedSeconds: 99999, rulesVersion: 6});
  assert.deepEqual(checked.stats, {zones: live.zones, close: live.close, vials: live.vials},
    'the server reaches the same numbers the run made');

  // Peak Blocks: the stats come out of the same replay the score does.
  const g = createBlocks(31337);
  for (let turn = 0; turn < 200 && !g.ended; turn++) {
    let best = null;
    g.state.tray.forEach((p, i) => {
      if (!p) return;
      for (const [r, c] of placements(g.state.grid, p.shape)) {
        const out = placeBlock(g.state.grid, p.shape, r, c, p.color);
        const score = out.lines * 1000 + out.grid.flat().filter(v => !v).length;
        if (!best || score > best.score) best = {score, i, r, c};
      }
    });
    if (!best) break;
    blocksPlace(g, best.i, best.r, best.c);
  }
  const blocks = blocksResult(g);
  const blocksChecked = await verifySegment({game: 'blocks', replay: blocks.replay, seed: blocks.replay.seed, elapsedSeconds: 99999});
  assert.deepEqual(blocksChecked.stats,
    {score: blocks.score, combo: blocks.bestCombo, levels: Math.floor(blocks.lines / BLOCKS_LINES_PER_LEVEL)});
  assert.ok(blocks.lines > 0, `the bot should have cleared something: ${blocks.lines} lines`);

  // Sequence: one level, with its cascade and the specials it minted.
  const {greedyMove, driveSequence} = await import('../tools/sequence-bot.mjs');
  let seqResult = null;
  const seqCb = stubCallbacks().cb;
  seqCb.end = r => {seqResult ??= r;};
  seqCb.goals = () => {};
  const s = new SequenceEngine(stubCanvas(), seqCb, {seed: 909, level: 4, motion: false});
  driveSequence(s, greedyMove);
  const seqStats = s.stats();
  s.destroy();
  assert.ok(seqStats.cascade > 0, 'the run cascaded at least once');
  const seqChecked = await verifySegment({game: 'sequence', replay: seqResult.replay, seed: seqResult.replay.seed,
    level: 4, elapsedSeconds: 99999, rulesVersion: 3});
  assert.deepEqual(seqChecked.stats, seqStats);
});

// ---------------------------------------------------------------- end to end, through the server

function world(start = '2026-10-14T01:00:00Z') {
  let t = Date.parse(start);
  const now = () => new Date(t);
  const store = createMemoryStore({invites: {TEAM: 9}, now}), auth = createMemoryAuth();
  const api = createHandlers({store, auth, secret: SECRET, now});
  return {
    store, auth, api, now, advance: s => {t += s * 1000;},
    async join(email, name) {
      const r = await api.join({body: {email, name, code: 'TEAM'}, origin: 'https://example.test'});
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return auth.tokenFor(email);
    },
  };
}
// A real Ridge Run replay for a given seed, and what it earned.
function ridgeReplay(seed) {
  const e = new RidgeEngine(stubCanvas(), stubCallbacks().cb, {seed, motion: false, version: 6});
  const aim = () => {const next = e.gates.find(g => g.x + e.C.PW > e.px - e.C.R); return next ? next.cy : 300;};
  let last = -99;
  e.action();
  for (let t = 0; t < 120 * 60 * 3 && !e.ended; t++) {
    if (!e.dead && e.py > aim() && e.vy > -e.C.FLAP * .35 && e.ticks - last >= 9) {e.action(); last = e.ticks;}
    e.step(SIM_STEP);
  }
  if (!e.ended) e.finish();
  const out = {replay: e.replay(), stats: e.stats(), seconds: e.ticks * SIM_STEP, score: e.score};
  e.destroy();
  return out;
}

test('a verified run is counted, and /api/me reports it', async () => {
  const w = world(), token = await w.join('ach@x.test', 'Ash');
  const before = await w.api.me({token});
  assert.equal(before.body.achievements.length, 8);
  assert.ok(before.body.achievements.every(a => a.value === 0 && a.tier === null), 'nothing earned yet');
  assert.deepEqual(before.body.achievementTotals, {});

  const start = await w.api.start({token, body: {game: 'ridge'}});
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const run = ridgeReplay(start.body.seed);
  w.advance(run.seconds + 1);
  const finish = await w.api.finish({token, body: {runId: start.body.runId, replay: run.replay, claimed: run.score}});
  assert.equal(finish.status, 200, JSON.stringify(finish.body));

  const me = await w.api.me({token});
  assert.deepEqual(me.body.achievementTotals.ridge,
    {zones: run.stats.zones, close: run.stats.close, vials: run.stats.vials},
    'the totals are exactly what the replay produced');
  const vials = me.body.achievements.find(a => a.id === 'ridge-vials');
  assert.equal(vials.value, run.stats.vials);
  assert.equal(vials.progress, `${run.stats.vials} / 25`);
  // The finish response carries the shelf too, so the page does not have to ask again.
  assert.deepEqual(finish.body.achievements.find(a => a.id === 'ridge-vials').value, run.stats.vials);
  assert.ok(Array.isArray(finish.body.earned));
});

test('two runs add up, and a best keeps the better of them', async () => {
  const w = world(), token = await w.join('two@x.test', 'Bo');
  let totals = null;
  for (const n of [0, 1]) {
    const start = await w.api.start({token, body: {game: 'ridge'}});
    const run = ridgeReplay(start.body.seed + n);
    w.advance(run.seconds + 1);
    // The second run is played on the same seed the server handed out, so it verifies either way.
    const real = ridgeReplay(start.body.seed);
    const finish = await w.api.finish({token, body: {runId: start.body.runId, replay: real.replay}});
    assert.equal(finish.status, 200, JSON.stringify(finish.body));
    totals = (await w.api.me({token})).body.achievementTotals;
  }
  const one = ridgeReplay((await w.api.start({token, body: {game: 'ridge'}})).body.seed).stats;
  assert.ok(totals.ridge.close >= one.close, 'the lifetime count grew past one run');
  assert.ok(totals.ridge.vials >= one.vials);
});

test('a run the server rejects earns nothing at all', async () => {
  const w = world(), token = await w.join('bad@x.test', 'Cy');
  const start = await w.api.start({token, body: {game: 'ridge'}});
  // A replay of a different course: the seed will not match the one the server handed out.
  const forged = ridgeReplay(start.body.seed + 777);
  w.advance(forged.seconds + 1);
  const finish = await w.api.finish({token, body: {runId: start.body.runId, replay: forged.replay}});
  assert.equal(finish.status, 422, JSON.stringify(finish.body));
  const me = await w.api.me({token});
  assert.deepEqual(me.body.achievementTotals, {}, 'a rejected run contributes nothing');
  assert.ok(me.body.achievements.every(a => a.value === 0));
  assert.equal((await w.store.playerRunStats((await w.auth.userFromToken(token)).id)).length, 0,
    'and it leaves no row behind to be counted later');
});

test('a claimed score the replay disagrees with counts as the replay, not as the claim', async () => {
  const w = world(), token = await w.join('liar@x.test', 'Di');
  const start = await w.api.start({token, body: {game: 'ridge'}});
  const run = ridgeReplay(start.body.seed);
  w.advance(run.seconds + 1);
  // The browser claims a far better run than the log it sends.
  const finish = await w.api.finish({token, body: {runId: start.body.runId, replay: run.replay, claimed: 999999}});
  assert.equal(finish.status, 200);
  const totals = (await w.api.me({token})).body.achievementTotals;
  assert.deepEqual(totals.ridge, {zones: run.stats.zones, close: run.stats.close, vials: run.stats.vials},
    'the claim changed nothing: every number came from the replay');
});

test('a refunded run stops counting, the moment it is refunded', async () => {
  const w = world(), token = await w.join('refund@x.test', 'Eve');
  const player = await w.auth.userFromToken(token);
  // Three free tries, then a paid one, so there is something to refund.
  const purchase = await w.store.createPurchase({playerId: player.id, pack: 5, coins: 5, amountCents: 999,
    currency: 'AUD', reference: 'PHA-ACH1', provider: 'manual'});
  await w.store.grantPurchase(purchase.id, 'boss@peak.test');
  let paidRunId = null, paidStats = null;
  for (let i = 0; i < 4; i++) {
    const start = await w.api.start({token, body: {game: 'ridge'}});
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const run = ridgeReplay(start.body.seed);
    w.advance(run.seconds + 1);
    const finish = await w.api.finish({token, body: {runId: start.body.runId, replay: run.replay}});
    assert.equal(finish.status, 200, JSON.stringify(finish.body));
    if (i === 3) {paidRunId = start.body.runId; paidStats = run.stats;}
  }
  const beforeRefund = (await w.api.me({token})).body.achievementTotals;
  assert.ok(beforeRefund.ridge.vials > 0);
  assert.equal((await w.store.getRun(paidRunId)).paid, true, 'the fourth try was the paid one');

  const refund = await w.store.refundPurchase(purchase.id, 'boss@peak.test');
  assert.equal(refund.refunded, true, JSON.stringify(refund));
  const afterRefund = (await w.api.me({token})).body.achievementTotals;
  assert.equal(afterRefund.ridge.close, beforeRefund.ridge.close - paidStats.close,
    'the refunded run no longer counts toward the lifetime tally');
  assert.equal(afterRefund.ridge.vials, beforeRefund.ridge.vials - paidStats.vials);
  assert.equal((await w.store.runStatsFor(paidRunId)), null, 'and its row is gone');
});

test('a Sequence run folds every verified level into one row', async () => {
  const w = world(), token = await w.join('seq@x.test', 'Fi');
  const {greedyMove, driveSequence} = await import('../tools/sequence-bot.mjs');
  const start = await w.api.start({token, body: {game: 'sequence'}});
  const level = (seed, n) => {
    let result = null;
    const cb = stubCallbacks().cb;
    cb.end = r => {result ??= r;};
    cb.goals = () => {};
    const e = new SequenceEngine(stubCanvas(), cb, {seed, level: n, motion: false, rulesVersion: start.body.rulesVersion});
    driveSequence(e, greedyMove);
    const stats = e.stats(), ticks = e.ticks;
    e.destroy();
    return {result, stats, seconds: ticks * SIM_STEP};
  };
  let seed = start.body.seed, n = 1, played = [];
  for (let i = 0; i < 2; i++) {
    const out = level(seed, n);
    w.advance(out.seconds + 1);
    const finish = await w.api.finish({token, body: {runId: start.body.runId, replay: out.result.replay}});
    assert.equal(finish.status, 200, JSON.stringify(finish.body));
    played.push(out.stats);
    if (finish.body.done) break;
    seed = finish.body.nextSeed; n = finish.body.nextLevel;
  }
  const totals = (await w.api.me({token})).body.achievementTotals;
  assert.equal(totals.sequence.cascade, Math.max(...played.map(s => s.cascade)), 'the best cascade of the run');
  assert.equal(totals.sequence.powerups, played.reduce((sum, s) => sum + s.powerups, 0), 'and every power-up it made');
  const rows = await w.store.playerRunStats((await w.auth.userFromToken(token)).id);
  assert.equal(rows.length, 1, 'one row for the run, however many levels it played');
});

test('nothing is counted at all until the migration has run', async () => {
  const w = world(), token = await w.join('nomig@x.test', 'Gus');
  // What the store looks like before achievements.sql: the table is not there yet.
  w.store.achievementsReady = async () => false;
  const start = await w.api.start({token, body: {game: 'ridge'}});
  const run = ridgeReplay(start.body.seed);
  w.advance(run.seconds + 1);
  const finish = await w.api.finish({token, body: {runId: start.body.runId, replay: run.replay}});
  assert.equal(finish.status, 200, 'the run itself still counts for the leaderboard');
  assert.deepEqual(finish.body.earned, []);
  const me = await w.api.me({token});
  assert.equal(me.status, 200, 'and the page still loads');
  assert.deepEqual(me.body.achievementTotals, {});
  assert.ok(me.body.achievements.every(a => a.value === 0), 'the shelf shows as unearned, rather than failing');
});

// ---------------------------------------------------------------- what the player sees

test('the shelf markup says the progress and tells a guest how to earn', () => {
  const shelf = achievementState({ridge: {vials: 140, close: 12, zones: 2}});
  const html = achievementShelf(shelf, {game: 'ridge', signedIn: true, heading: 'Achievements'});
  assert.match(html, /140 \/ 250/);
  assert.match(html, /Gold vials/);
  assert.match(html, /3 of 3 earned/, 'close, zones and vials all have a tier at these numbers');
  assert.doesNotMatch(html, /Sign in/);
  assert.doesNotMatch(html, /Biggest combo/, 'one game at a time');
  const guest = achievementShelf([], {signedIn: false, heading: 'Achievements'});
  assert.match(guest, /Sign in to earn achievements/);
  assert.match(guest, /8 to earn/, 'a guest still sees the whole list');
  assert.match(guest, /0 \/ 1,000/, 'with what each one takes');
  assert.deepEqual(achievementSummary(shelf, 'ridge'), {earned: 3, total: 3});
  assert.deepEqual(achievementSummary(shelf, 'blocks'), {earned: 0, total: 3}, 'a game not played yet');
  assert.deepEqual(achievementSummary([], 'sequence'), {earned: 0, total: 2}, 'and one with no shelf at all');
  // The shelf is markup, so anything that reaches it is escaped.
  const nasty = achievementShelf([{id: 'ridge-vials', game: 'ridge', label: '<img src=x onerror=alert(1)>',
    describe: 'x', progress: 'x', value: 0, goal: 1, tier: null, next: null}], {game: 'ridge'});
  assert.doesNotMatch(nasty, /<img/);
  assert.match(nasty, /&lt;img/);
});

test('the popup announces each achievement once a run, in turn', () => {
  const shown = [];
  const host = {append: el => shown.push(el)};
  const popup = createAchievementPopup({host, motion: false, onShow: e => shown.push(e.id),
    create: () => ({className: '', setAttribute() {}, innerHTML: '', remove() {}, animate: () => ({})})});
  const earned = [{id: 'ridge-vials', game: 'ridge', name: 'Vial Collector', tier: 'bronze', at: 25}];
  popup.offer(earned);
  popup.offer(earned);
  assert.equal(shown.filter(x => x === 'ridge-vials').length, 1, 'the same tier is announced once');
  popup.offer([{id: 'ridge-vials', game: 'ridge', name: 'Vial Collector', tier: 'silver', at: 100}]);
  assert.equal(popup.pending, 1, 'a second one queues behind the first rather than landing on top of it');
  popup.reset();
  assert.equal(popup.pending, 0);
});
