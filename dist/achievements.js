// Achievements, as one list both sides read.
//
// The server works every number out from the replay it has just verified and stores it against that run;
// nothing a browser sends is ever counted. The browser reads the same list to draw the shelf and to decide
// when to show the "Achievement unlocked!" popup, so the thresholds in the popup and the thresholds the
// score is saved against cannot drift apart.
//
// A metric is either a `best` (the highest any single run reached) or a `total` (a lifetime tally). A run
// contributes once, when it verifies; a rejected or refunded run never contributes, because its row is
// never written or is taken away with it.
//
// The thresholds were measured, not guessed: tools/achievement-spread.mjs plays real runs with the same
// bots the balance tools use and reports the spread of every number counted here. Bronze is what an
// ordinary player meets in their first runs, silver is what practice brings, gold needs real skill or real
// persistence. The measured medians are in the comment on each tier.

import {BLOCK_MILESTONE,levelsPassed} from './blocks-core.js';

export const TIERS = Object.freeze(['bronze', 'silver', 'gold']);

// Peak Blocks has no levels of its own: it is endless, and its HUD counts cleared lines. A "level" is a
// milestone's worth of them, read straight from the rules so that the HUD, the milestone banner and this
// achievement can never drift apart: there is one number and blocks-core.js owns it.
export const BLOCKS_LINES_PER_LEVEL = BLOCK_MILESTONE.every;

export const ACHIEVEMENTS = Object.freeze([
  // --- Peak Blocks -------------------------------------------------------------------------------------
  {
    id: 'blocks-score', game: 'blocks', metric: 'score', kind: 'best',
    name: 'High Scorer', unit: 'points', label: 'Best score',
    // Measured: a flailing run lands around 2,400, an ordinary one 12,100, an ordinary player's best 45,700.
    tiers: {bronze: 1000, silver: 10000, gold: 30000},
    describe: n => `Score ${n.toLocaleString('en-AU')} in a single run`,
  },
  {
    id: 'blocks-combo', game: 'blocks', metric: 'combo', kind: 'best',
    name: 'Chain Reaction', unit: 'combo', label: 'Biggest combo',
    // Measured: flailing runs peak at 3, ordinary ones at 12, the best seen 36.
    tiers: {bronze: 3, silver: 8, gold: 15},
    describe: n => `Reach a combo of ${n} in a single run`,
  },
  {
    id: 'blocks-levels', game: 'blocks', metric: 'levels', kind: 'total',
    name: 'Climbing the Peak', unit: 'levels', label: 'Levels passed',
    // Measured: an ordinary run clears about 49 lines, so just under two levels a run.
    tiers: {bronze: 1, silver: 10, gold: 30},
    // "Passed", not "reached": clearing 25 lines passes level 1 and puts the HUD on level 2.
    describe: n => `Pass ${n} ${n === 1 ? 'level' : 'levels'} (${BLOCKS_LINES_PER_LEVEL} cleared lines each)`,
  },
  // --- Sequence ----------------------------------------------------------------------------------------
  {
    id: 'sequence-cascade', game: 'sequence', metric: 'cascade', kind: 'best',
    name: 'Cascade', unit: 'chain', label: 'Biggest cascade',
    // Measured: a session's best cascade is usually 6, occasionally 11.
    tiers: {bronze: 3, silver: 6, gold: 9},
    describe: n => `Set off a cascade of ${n} in a row`,
  },
  {
    id: 'sequence-powerups', game: 'sequence', metric: 'powerups', kind: 'total',
    name: 'Crystal Lab', unit: 'power-ups', label: 'Power-ups made',
    // Measured: about 45 in a session that runs out of levels, 80 in a good one.
    tiers: {bronze: 10, silver: 100, gold: 500},
    describe: n => `Make ${n} striped crystals and colour bombs`,
  },
  // --- Ridge Run ---------------------------------------------------------------------------------------
  {
    id: 'ridge-zones', game: 'ridge', metric: 'zones', kind: 'best',
    name: 'Zone Runner', unit: 'zones', label: 'Zones cleared',
    // Measured: a steady flyer passes about 56 gates, so one zone; the best runs reach two.
    // Gold is deliberately past what the bots manage — 200 gates is a run worth a gold medal.
    tiers: {bronze: 1, silver: 2, gold: 4},
    describe: n => `Clear ${n} ${n === 1 ? 'zone' : 'zones'} in a single run`,
  },
  {
    id: 'ridge-close', game: 'ridge', metric: 'close', kind: 'total',
    name: 'Close Shave', unit: 'near misses', label: 'CLOSE! moments',
    // Measured: six to nine a run for a steady flyer.
    tiers: {bronze: 10, silver: 100, gold: 400},
    describe: n => `Thread ${n} gates by a whisker`,
  },
  {
    id: 'ridge-vials', game: 'ridge', metric: 'vials', kind: 'total',
    name: 'Vial Collector', unit: 'gold vials', label: 'Gold vials',
    // Measured: four to six a run, so gold is about forty-five good runs.
    tiers: {bronze: 25, silver: 100, gold: 250},
    describe: n => `Collect ${n} gold vials`,
  },
]);

export const GAMES_WITH_ACHIEVEMENTS = Object.freeze([...new Set(ACHIEVEMENTS.map(a => a.game))]);
export const achievementsFor = game => ACHIEVEMENTS.filter(a => a.game === game);
export const achievementById = id => ACHIEVEMENTS.find(a => a.id === id) ?? null;

// Which numbers each game keeps, and how two runs combine. `best` keeps the higher, `total` adds up.
export const METRICS = Object.freeze(Object.fromEntries(
  GAMES_WITH_ACHIEVEMENTS.map(game => [game, Object.freeze(achievementsFor(game).map(a => a.metric))])));
const KIND = Object.freeze(Object.fromEntries(ACHIEVEMENTS.map(a => [`${a.game}.${a.metric}`, a.kind])));

const whole = value => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// The stats one verified run contributes, from whatever the game's own replay reported. Anything missing is
// zero rather than a guess: a number the replay did not produce is not a number we are willing to count.
export function statsFromRun(game, run = {}) {
  if (game === 'blocks') {
    return {
      score: whole(run.score),
      combo: whole(run.bestCombo ?? run.combo),
      // Levels *passed*, which is one less than the level the HUD shows: see blocksLevel in blocks-core.js.
      levels: levelsPassed(whole(run.lines)),
    };
  }
  if (game === 'sequence') return {cascade: whole(run.cascade), powerups: whole(run.powerups)};
  if (game === 'ridge') return {zones: whole(run.zones), close: whole(run.close), vials: whole(run.vials)};
  return null;
}

// Keeps only the numbers the game actually has an achievement for, so a stray key cannot be stored.
export function cleanStats(game, stats) {
  const metrics = METRICS[game];
  if (!metrics || !stats) return null;
  const out = {};
  for (const metric of metrics) out[metric] = whole(stats[metric]);
  return out;
}

// Adds one run's stats into a running total, each metric the way its own achievement counts.
export function addRun(totals, game, stats) {
  const clean = cleanStats(game, stats);
  if (!clean) return totals;
  const game_ = totals[game] ?? {};
  for (const [metric, value] of Object.entries(clean)) {
    const soFar = whole(game_[metric]);
    game_[metric] = KIND[`${game}.${metric}`] === 'total' ? soFar + value : Math.max(soFar, value);
  }
  totals[game] = game_;
  return totals;
}

// Every run a player has had counted, folded into one set of totals.
export function totalsFrom(rows = []) {
  const totals = {};
  for (const row of rows) addRun(totals, row.game, row.stats);
  return totals;
}

// The tier a value has reached, and the one it is working toward.
export function tierFor(achievement, value) {
  const have = whole(value);
  let earned = null, next = null;
  for (const tier of TIERS) {
    if (have >= achievement.tiers[tier]) earned = tier;
    else {next ??= {tier, at: achievement.tiers[tier]};}
  }
  return {tier: earned, next};
}

// The whole shelf for a player: what each achievement is, where they are, and how far to the next tier.
// `Gold vials 140 / 250` comes from here, so the page and the profile cannot word it differently.
export function achievementState(totals = {}, {game = null} = {}) {
  return (game ? achievementsFor(game) : ACHIEVEMENTS).map(a => {
    const value = whole(totals?.[a.game]?.[a.metric]);
    const {tier, next} = tierFor(a, value);
    return {
      id: a.id, game: a.game, name: a.name, label: a.label, unit: a.unit, kind: a.kind,
      tiers: a.tiers, value, tier, next,
      goal: next ? next.at : a.tiers.gold,
      progress: `${value.toLocaleString('en-AU')} / ${(next ? next.at : a.tiers.gold).toLocaleString('en-AU')}`,
      describe: a.describe(next ? next.at : a.tiers.gold),
      done: tier === 'gold',
    };
  });
}

// Which tiers were crossed going from one set of totals to another: what the popup announces, and what the
// server reports back as newly earned once a run has verified.
export function newlyEarned(before = {}, after = {}) {
  const out = [];
  for (const a of ACHIEVEMENTS) {
    const was = tierFor(a, before?.[a.game]?.[a.metric]).tier;
    const now = tierFor(a, after?.[a.game]?.[a.metric]).tier;
    if (now && now !== was) out.push({id: a.id, game: a.game, name: a.name, tier: now, at: a.tiers[now]});
  }
  return out;
}

// The raw totals back out of a shelf the server sent, so the browser does not have to be told the same
// numbers twice. Only the metric each entry counts is needed, which is why the shelf carries it.
export function totalsFromShelf(shelf = []) {
  const totals = {};
  for (const entry of shelf) {
    const a = achievementById(entry.id);
    if (!a) continue;
    totals[a.game] ??= {};
    totals[a.game][a.metric] = whole(entry.value);
  }
  return totals;
}

// What a run in progress would unlock if it stopped right now: the saved totals plus this run's live
// numbers. The popup uses this, and the server decides the truth later from the replay it verifies.
export function wouldEarn(totals, game, liveStats) {
  const after = addRun(structuredClone(totals ?? {}), game, liveStats);
  return newlyEarned(totals ?? {}, after);
}
