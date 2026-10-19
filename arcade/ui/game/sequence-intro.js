// What Sequence tells a player before and during a level: the opening goal card, the one-time
// explanation of ice and traps, and how much room the board gets between the two.
//
// Nothing is imported here on purpose. The goals come from the caller, so these stay pure functions
// the tests can run without the gameplay bundle and without a browser.

// Bumped only if the wording changes enough that players who have seen the old cards should see them
// again. The seen-list is stored per device, so this is the only way to re-show them.
export const INTRO_VERSION = 1;
export const INTRO_KEY = 'ph-sequence-intro-v1';

export const OBSTACLES = {
  ice: {
    kind: 'ice',
    title: 'Ice',
    line: 'Match next to it to crack it. The number is how many hits it needs.',
  },
  lock: {
    kind: 'lock',
    title: 'Trapped',
    line: 'Match next to it to free it.',
  },
};

// Which explanations this level needs, in a fixed order, minus the ones this device has already been
// shown. `seen` is whatever came out of storage, which on a fresh device is nothing at all.
export function obstacleIntros(goals, seen) {
  const already = new Set(Array.isArray(seen) ? seen : []);
  return ['ice', 'lock']
    .filter(kind => (goals || []).some(goal => goal.kind === kind))
    .filter(kind => !already.has(kind))
    .map(kind => OBSTACLES[kind]);
}

// Everything this level has ever explained, whether or not it was new this time. Re-opening the cards
// from the goal panel shows all of them, so a player who forgets can always look again.
export function obstacleCards(goals) {
  return ['ice', 'lock'].filter(kind => (goals || []).some(goal => goal.kind === kind)).map(kind => OBSTACLES[kind]);
}

export function rememberIntros(seen, shown) {
  return [...new Set([...(Array.isArray(seen) ? seen : []), ...shown.map(card => card.kind)])].sort();
}

// The card shown for a couple of seconds at the start of a level: "Level 7 · Break 8 ice ·
// Free 3 crystals · 25 moves". The score goal is left off unless it is the only thing to do, because
// every level has one and it is already the big number in the top bar.
const SHORT = {
  score: goal => `Reach ${compact(goal.total)}`,
  ice: goal => `Break ${goal.total} ice`,
  lock: goal => `Free ${goal.total} ${goal.total === 1 ? 'crystal' : 'crystals'}`,
  collect: goal => `Collect ${goal.total} ${goal.label.replace(/ crystals?$/i, '')}`,
};
function compact(n) {
  return n >= 10000
    ? new Intl.NumberFormat('en-AU', {notation: 'compact', maximumFractionDigits: 1}).format(n)
    : n.toLocaleString('en-AU');
}
export function levelGoalCard(level, goals, moves) {
  const list = (goals || []).filter(goal => goal.kind !== 'score');
  const shown = list.length ? list : (goals || []).filter(goal => goal.kind === 'score');
  const parts = shown.map(goal => ({kind: goal.kind, type: goal.type, text: SHORT[goal.kind]?.(goal) ?? goal.label}));
  if (Number.isFinite(moves) && moves > 0) parts.push({kind: 'moves', text: `${moves} moves`});
  return {title: `Level ${level}`, parts, text: [`Level ${level}`, ...parts.map(p => p.text)].join(' · ')};
}
