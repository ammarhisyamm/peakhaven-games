// Sequence rules version 3: special crystals, combos, a varied level curve and an end-of-level bonus.
// v1 and v2 are untouched — they keep their own modules, their own draw order and their own replays.
// Everything here is pure: the engine owns the animation, this file owns the rules.
import {settleProgression} from './sequence-progression.js';

export const SEQUENCE_V3_VERSION = 3;
// v4 eases levels 1-14 and adds the two helper tools. Everything from level 15 up is the v3 curve,
// unchanged, and a v1, v2 or v3 run is still played and verified by exactly the rules it was played on.
export const SEQUENCE_V4_VERSION = 4;
export const SEQUENCE_LATEST_VERSION = SEQUENCE_V4_VERSION;
// Two of each per run, like Peak Blocks' dock. Tools do not cost a move: they are the way out of a board
// that has stopped giving, and charging a move for one would make using it feel like a punishment.
export const SEQUENCE_TOOLS = Object.freeze({shuffle: 2, hammer: 2});
// How a tool is written into the move log. A swap is [tick, from, to] with both cells on the board, so a
// negative `from` is a tool and can never be mistaken for one: HAMMER carries the cell it broke, SHUFFLE
// carries -1. Keeping the log all-integer triples means the server's validation stays as strict as it was.
export const SEQ_LOG = Object.freeze({hammer: -1, shuffle: -2});
export const V3_SIZE = 7, V3_CELLS = 49;
const EMPTY = -1;        // a hole waiting to be filled
export const UNKNOWN = -2; // a refill a bot is not allowed to see; never matches, never clears

// A cell is one integer so the board stays a plain array of numbers and a replay stays {seed, moves}.
// kind * 8 + colour. Plain crystals are 0..6, exactly as in v1/v2, so the shared helpers still read them.
export const PLAIN = 0, STRIPE_V = 1, STRIPE_H = 2, WRAP = 3, BOMB = 4;
// A colour bomb matches nothing, so it is parked on colour 7, which no palette ever uses for a crystal.
export const BOMB_COLOUR = 7;
export const kindOf = cell => cell < 0 ? PLAIN : cell >> 3;
export const colourOf = cell => cell < 0 ? -1 : cell & 7;
export const makeCell = (kind, colour) => kind * 8 + colour;
export const isSpecial = cell => cell >= 0 && kindOf(cell) !== PLAIN;
export const KIND_NAMES = ['plain', 'stripe-v', 'stripe-h', 'wrapped', 'bomb'];
// Only crystals of the same colour match, and a colour bomb never joins a line.
const matchable = cell => cell >= 0 && kindOf(cell) !== BOMB;
const sameColour = (cell, colour) => matchable(cell) && colourOf(cell) === colour;

// What each piece is worth. Every number here is a multiple of 50, because a run's score must stay one.
export const V3_SCORE = Object.freeze({
  cell: 50,
  make: {[STRIPE_V]: 100, [STRIPE_H]: 100, [WRAP]: 150, [BOMB]: 250},
  // A combo is worth well more than the two specials would have been apart. That is the whole point of it.
  combo: {stripeStripe: 500, stripeWrap: 1000, wrapWrap: 1500, bombStripe: 2000, bombWrap: 2500, bombBomb: 5000},
});

const rowOf = i => Math.floor(i / V3_SIZE), colOf = i => i % V3_SIZE;
const rowCells = i => {const r = rowOf(i), out = []; for (let c = 0; c < V3_SIZE; c++) out.push(r * V3_SIZE + c); return out;};
const colCells = i => {const c = colOf(i), out = []; for (let r = 0; r < V3_SIZE; r++) out.push(r * V3_SIZE + c); return out;};
const blockCells = (i, radius) => {
  const r0 = rowOf(i), c0 = colOf(i), out = [];
  for (let r = r0 - radius; r <= r0 + radius; r++) for (let c = c0 - radius; c <= c0 + radius; c++)
    if (r >= 0 && r < V3_SIZE && c >= 0 && c < V3_SIZE) out.push(r * V3_SIZE + c);
  return out;
};
const colourCells = (board, colour) => {
  const out = [];
  for (let i = 0; i < V3_CELLS; i++) if (sameColour(board[i], colour)) out.push(i);
  return out;
};

// ---------------------------------------------------------------- finding lines, and their shape

// Every maximal run of three or more same-colour crystals, with its direction. v2's matcher returns a
// flat Set of indices, which cannot tell a line of four from a line of three; this keeps the shape so a
// special can be made from it.
export function v3Runs(board, size = V3_SIZE) {
  const runs = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size;) {
    const index = row * size + col, colour = colourOf(board[index]);
    if (!matchable(board[index])) {col++; continue;}
    let end = col + 1;
    while (end < size && sameColour(board[row * size + end], colour)) end++;
    if (end - col >= 3) {
      const cells = [];
      for (let c = col; c < end; c++) cells.push(row * size + c);
      runs.push({dir: 'h', colour, cells});
    }
    col = end;
  }
  for (let col = 0; col < size; col++) for (let row = 0; row < size;) {
    const index = row * size + col, colour = colourOf(board[index]);
    if (!matchable(board[index])) {row++; continue;}
    let end = row + 1;
    while (end < size && sameColour(board[end * size + col], colour)) end++;
    if (end - row >= 3) {
      const cells = [];
      for (let r = row; r < end; r++) cells.push(r * size + col);
      runs.push({dir: 'v', colour, cells});
    }
    row = end;
  }
  return runs;
}

// The flat set of matched cells, for the places that only need "is there a line here".
export function v3Matches(board, size = V3_SIZE) {
  const out = new Set();
  for (const run of v3Runs(board, size)) for (const i of run.cells) out.add(i);
  return out;
}

// Runs that share a cell are one shape: that is how an L or a T is told from two separate lines.
export function v3Groups(board, size = V3_SIZE) {
  const runs = v3Runs(board, size);
  const parent = runs.map((_, i) => i);
  const find = i => {while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i;};
  const owner = new Map();
  runs.forEach((run, index) => {
    for (const cell of run.cells) {
      if (owner.has(cell)) {const a = find(owner.get(cell)), b = find(index); if (a !== b) parent[a] = b;}
      else owner.set(cell, index);
    }
  });
  const groups = new Map();
  runs.forEach((run, index) => {
    const key = find(index);
    if (!groups.has(key)) groups.set(key, {colour: run.colour, runs: [], cells: new Set()});
    const group = groups.get(key);
    group.runs.push(run);
    for (const cell of run.cells) group.cells.add(cell);
  });
  return [...groups.values()].map(group => {
    const hs = group.runs.filter(r => r.dir === 'h'), vs = group.runs.filter(r => r.dir === 'v');
    const maxLen = Math.max(...group.runs.map(r => r.cells.length));
    // Where the lines cross: the natural home for a wrapped crystal.
    const corners = [];
    for (const h of hs) for (const v of vs) for (const cell of h.cells) if (v.cells.includes(cell)) corners.push(cell);
    return {...group, cells: [...group.cells].sort((a, b) => a - b), maxLen, hs, vs, corners};
  });
}

// What a shape earns, in Candy Crush's order of priority: five in a line beats an L or T, which beats four.
// A horizontal line makes a vertically striped crystal (which sweeps its column) and the other way round.
export function v3Award(group) {
  const longest = group.runs.reduce((best, run) => run.cells.length > best.cells.length ? run : best);
  if (group.maxLen >= 5) return {kind: BOMB, colour: BOMB_COLOUR, from: longest};
  if (group.hs.length && group.vs.length) return {kind: WRAP, colour: group.colour, from: longest};
  if (group.maxLen === 4) return {kind: longest.dir === 'h' ? STRIPE_V : STRIPE_H, colour: group.colour, from: longest};
  return null;
}

// Where the new special lands: under the player's finger when the swap made the shape, otherwise the
// crossing of the lines, otherwise the middle of the longest line. Trapped cells are skipped, because a
// special sitting in a trap could never be swapped. Deterministic in every case.
function awardCell(group, award, swapped, locks) {
  const free = i => !locks?.[i];
  for (const cell of swapped) if (group.cells.includes(cell) && free(cell)) return cell;
  for (const cell of group.corners) if (free(cell)) return cell;
  const line = award.from.cells;
  const middle = line[Math.floor(line.length / 2)];
  if (free(middle)) return middle;
  return group.cells.find(free) ?? middle;
}

// ---------------------------------------------------------------- legal swaps

export function v3Exchange(board, a, b, state) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (a < 0 || b < 0 || a >= V3_CELLS || b >= V3_CELLS) return null;
  if (Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)) !== 1) return null;
  if (state?.locks?.[a] || state?.locks?.[b]) return null;
  const next = board.slice();
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

// Which of the three things a swap sets off, or null when the swap does nothing and the engine must
// bounce it back. A combo or a colour bomb is a move in its own right even though it makes no line.
// Every index returned is a position on the board *after* the exchange, which is the board every wave
// is planned against.
export function v3SwapKind(board, a, b, state) {
  const next = v3Exchange(board, a, b, state);
  if (!next) return null;
  const ka = kindOf(board[a]), kb = kindOf(board[b]);
  if (ka !== PLAIN && kb !== PLAIN) return {type: 'combo', a, b, kinds: [ka, kb], next};
  if (ka === BOMB || kb === BOMB) {
    // The bomb has moved across: it now sits where its partner came from.
    const bomb = ka === BOMB ? b : a, other = ka === BOMB ? a : b;
    return {type: 'bomb', bomb, other, colour: colourOf(next[other]), a, b, next};
  }
  if (v3Matches(next).size) return {type: 'match', a, b, next};
  return null;
}

export const v3IsMove = (board, a, b, state) => v3SwapKind(board, a, b, state) !== null;

const PAIRS = [];
for (let i = 0; i < V3_CELLS; i++) {
  if (colOf(i) < V3_SIZE - 1) PAIRS.push([i, i + 1]);
  if (i + V3_SIZE < V3_CELLS) PAIRS.push([i, i + V3_SIZE]);
}
export const V3_PAIRS = PAIRS;

export function v3Legal(board, state) {
  const out = [];
  for (const [a, b] of PAIRS) if (v3IsMove(board, a, b, state)) out.push([a, b]);
  return out;
}

export function v3Move(board, state) {
  for (const [a, b] of PAIRS) if (v3IsMove(board, a, b, state)) return [a, b];
  return null;
}

// ---------------------------------------------------------------- one wave

// Everything that goes off together, with each special caught in the blast firing in turn. `seeds` are the
// cells this wave starts from; anything special among them, or reached by them, detonates once.
// Returns the cells cleared, the specials made, the points, the effects to draw, and any wrapped crystal
// owed a second explosion after the board settles.
// A trapped crystal clears like any other when a blast reaches it; that is how v2 has always freed traps.
function detonate(board, seeds, consumed = []) {
  const clear = new Set(), fired = new Set(consumed), effects = [], againAt = [];
  const queue = [];
  const add = cells => {
    for (const i of cells) {
      if (i < 0 || i >= V3_CELLS || board[i] < 0) continue;
      clear.add(i);
      if (isSpecial(board[i]) && !fired.has(i)) {fired.add(i); queue.push(i);}
    }
  };
  add(seeds);
  while (queue.length) {
    const at = queue.shift(), kind = kindOf(board[at]), colour = colourOf(board[at]);
    if (kind === STRIPE_V) {effects.push({type: 'beam', at, axis: 'v'}); add(colCells(at));}
    else if (kind === STRIPE_H) {effects.push({type: 'beam', at, axis: 'h'}); add(rowCells(at));}
    else if (kind === WRAP) {effects.push({type: 'shock', at, radius: 1}); add(blockCells(at, 1)); againAt.push(at);}
    else if (kind === BOMB) {
      // A bomb caught in someone else's blast takes the commonest colour with it, so it is never wasted.
      const pick = dominantColour(board, clear);
      effects.push({type: 'pulse', at, colour: pick});
      if (pick >= 0) add(colourCells(board, pick));
    }
  }
  return {clear, effects, againAt};
}

// The colour most of the blast is made of, so a bomb swept up by a cascade has something to clear.
function dominantColour(board, clear) {
  const tally = new Map();
  for (const i of clear) {
    const colour = colourOf(board[i]);
    if (colour >= 0 && colour !== BOMB_COLOUR) tally.set(colour, (tally.get(colour) ?? 0) + 1);
  }
  let best = -1, bestCount = 0;
  for (const [colour, count] of [...tally].sort((x, y) => x[0] - y[0])) if (count > bestCount) {bestCount = count; best = colour;}
  return best;
}

// The six two-special combos. `at` is the cell the player swapped into, which is where it all happens.
function comboSeeds(board, kinds, at, partner) {
  const [ka, kb] = kinds;
  const has = kind => ka === kind || kb === kind;
  const bombs = (ka === BOMB ? 1 : 0) + (kb === BOMB ? 1 : 0);
  const wraps = (ka === WRAP ? 1 : 0) + (kb === WRAP ? 1 : 0);
  const stripes = (ka === STRIPE_V || ka === STRIPE_H ? 1 : 0) + (kb === STRIPE_V || kb === STRIPE_H ? 1 : 0);
  if (bombs === 2) {
    const all = [];
    for (let i = 0; i < V3_CELLS; i++) all.push(i);
    return {name: 'bombBomb', bonus: V3_SCORE.combo.bombBomb, cells: all, effects: [{type: 'whiteout', at}], againAt: []};
  }
  if (bombs === 1 && stripes === 1) {
    // Every crystal of that colour becomes striped and fires.
    const stripeKind = ka === STRIPE_V || ka === STRIPE_H ? ka : kb;
    const colour = colourOf(board[kindOf(board[at]) === BOMB ? partner : at]);
    const targets = colourCells(board, colour);
    const cells = [at, partner];
    for (const i of targets) cells.push(...(stripeKind === STRIPE_V ? colCells(i) : rowCells(i)));
    return {name: 'bombStripe', bonus: V3_SCORE.combo.bombStripe, cells, effects: [{type: 'pulse', at, colour}, ...targets.map(i => ({type: 'beam', at: i, axis: stripeKind === STRIPE_V ? 'v' : 'h'}))], againAt: []};
  }
  if (bombs === 1 && wraps === 1) {
    const colour = colourOf(board[kindOf(board[at]) === BOMB ? partner : at]);
    const targets = colourCells(board, colour);
    const cells = [at, partner];
    for (const i of targets) cells.push(...blockCells(i, 1));
    return {name: 'bombWrap', bonus: V3_SCORE.combo.bombWrap, cells, effects: [{type: 'pulse', at, colour}, ...targets.map(i => ({type: 'shock', at: i, radius: 1}))], againAt: targets};
  }
  if (wraps === 2) {
    return {name: 'wrapWrap', bonus: V3_SCORE.combo.wrapWrap, cells: blockCells(at, 2), effects: [{type: 'shock', at, radius: 2}], againAt: [at]};
  }
  if (has(WRAP) && stripes === 1) {
    // Three rows and three columns, centred where they met.
    const cells = [];
    for (let d = -1; d <= 1; d++) {
      const r = rowOf(at) + d, c = colOf(at) + d;
      if (r >= 0 && r < V3_SIZE) cells.push(...rowCells(r * V3_SIZE));
      if (c >= 0 && c < V3_SIZE) cells.push(...colCells(c));
    }
    return {name: 'stripeWrap', bonus: V3_SCORE.combo.stripeWrap, cells, effects: [{type: 'cross', at, width: 3}], againAt: []};
  }
  return {name: 'stripeStripe', bonus: V3_SCORE.combo.stripeStripe, cells: [...rowCells(at), ...colCells(at)], effects: [{type: 'cross', at, width: 1}], againAt: []};
}

// One wave of a v3 cascade. `trigger` is what sets it off: the swap, a wrapped crystal's second
// explosion, or nothing at all (in which case the lines already on the board go off).
export function planV3Wave(board, config, state, {trigger = null, again = [], wave = 1, create: allowCreate = true} = {}) {
  const multiplier = Math.min(V3_TUNING.waveCap, Math.max(1, wave));
  let seeds = [], bonus = 0, comboName = null, effects = [], againAt = [];
  const swapped = [];
  if (trigger?.type === 'combo') {
    const combo = comboSeeds(board, trigger.kinds, trigger.b, trigger.a);
    seeds = combo.cells; bonus = combo.bonus; comboName = combo.name; effects = combo.effects; againAt = [...combo.againAt];
  } else if (trigger?.type === 'bomb') {
    seeds = [trigger.bomb, trigger.other, ...colourCells(board, trigger.colour)];
    effects = [{type: 'pulse', at: trigger.bomb, colour: trigger.colour}];
  } else if (trigger?.type === 'fire') {
    // The end-of-level bonus setting off named specials.
    seeds = [...trigger.cells];
  } else {
    if (trigger?.type === 'match') swapped.push(trigger.b, trigger.a);
    for (const i of again) seeds.push(...blockCells(i, 1));
    if (again.length) effects = again.map(at => ({type: 'shock', at, radius: 1}));
    for (const group of v3Groups(board)) seeds.push(...group.cells);
  }
  // A combo consumes the two specials that made it, so they do not also detonate one at a time inside it.
  // A combo consumes the two specials that made it, so neither also detonates on its own inside it.
  const blast = detonate(board, seeds, comboName ? [trigger.a, trigger.b] : []);
  effects = [...effects, ...blast.effects];
  againAt = [...againAt, ...blast.againAt];

  // Specials are made from the lines that are on the board right now, and survive the blast that made them.
  const create = new Map(), made = {stripe: 0, wrap: 0, bomb: 0};
  if (!comboName && allowCreate) for (const group of v3Groups(board)) {
    const award = v3Award(group);
    if (!award) continue;
    const at = awardCell(group, award, swapped, state?.locks);
    if (create.has(at)) continue;
    create.set(at, makeCell(award.kind, award.colour));
    made[award.kind === BOMB ? 'bomb' : award.kind === WRAP ? 'wrap' : 'stripe']++;
    bonus += V3_SCORE.make[award.kind];
  }
  // A cell that becomes a special is not cleared, and the special it just became does not detonate.
  for (const at of create.keys()) blast.clear.delete(at);
  againAt = [...new Set(againAt)].filter(at => !create.has(at));

  const gained = (blast.clear.size * V3_SCORE.cell + bonus) * multiplier;
  return {clear: blast.clear, create, gained, effects, againAt, made, combo: comboName, wave: multiplier};
}

// ---------------------------------------------------------------- objectives

export function createV3Progress(config) {
  return {ice: config.ice.slice(), locks: config.locks.slice(), collected: 0};
}

// Every cleared cell counts, and so does every cell orthogonally beside one, which is how PR #20's ice and
// traps have always come apart. Collection counts cleared crystals only, by their own colour, so a blast
// that merely passes beside the right colour never collects it.
export function applyV3Wave(config, state, board, clear) {
  const hit = new Set(clear);
  for (const i of clear) {
    if (colOf(i) > 0) hit.add(i - 1);
    if (colOf(i) < V3_SIZE - 1) hit.add(i + 1);
    if (i >= V3_SIZE) hit.add(i - V3_SIZE);
    if (i < V3_CELLS - V3_SIZE) hit.add(i + V3_SIZE);
  }
  const next = {ice: state.ice.slice(), locks: state.locks.slice(), collected: state.collected};
  for (const i of hit) {next.ice[i] = Math.max(0, next.ice[i] - 1); next.locks[i] = false;}
  if (config.collect) for (const i of clear) if (colourOf(board[i]) === config.collect.type) next.collected++;
  return next;
}

export const CRYSTAL_NAMES = ['blue diamonds', 'aqua drops', 'gold stars', 'purple crystals', 'green crystals', 'pink crystals', 'white crystals'];

export function v3Goals(config, state) {
  const goals = [];
  const iceTotal = config.ice.reduce((a, b) => a + b, 0), iceLeft = state.ice.reduce((a, b) => a + b, 0);
  const lockTotal = config.locks.filter(Boolean).length, lockLeft = state.locks.filter(Boolean).length;
  if (iceTotal) goals.push({kind: 'ice', label: 'Ice layers', done: iceTotal - iceLeft, total: iceTotal, left: iceLeft});
  if (lockTotal) goals.push({kind: 'lock', label: 'Traps', done: lockTotal - lockLeft, total: lockTotal, left: lockLeft});
  if (config.collect) goals.push({kind: 'collect', type: config.collect.type, label: CRYSTAL_NAMES[config.collect.type], done: Math.min(config.collect.count, state.collected), total: config.collect.count, left: Math.max(0, config.collect.count - state.collected)});
  return goals;
}

// The score goal is a goal like the others, so the panel can tick it off and the player can see what is
// actually left to do.
export function v3AllGoals(config, state, score) {
  return [{kind: 'score', label: 'Score', done: Math.min(config.target, score), total: config.target, left: Math.max(0, config.target - score)}, ...v3Goals(config, state)];
}

export const v3Complete = (score, config, state) => score >= config.target && v3Goals(config, state).every(g => g.left === 0);

export function v3Brief(level, version = SEQUENCE_V3_VERSION) {
  const c = v3Level(level, version), parts = [`Reach ${c.target.toLocaleString('en-AU')} points`];
  if (c.ice.some(Boolean)) parts.push(c.ice.includes(3) ? 'break the three-layer ice' : c.ice.includes(2) ? 'break the two-layer ice' : 'break the ice');
  if (c.locks.some(Boolean)) parts.push('free the trapped crystals');
  if (c.collect) parts.push(`collect ${c.collect.count} ${CRYSTAL_NAMES[c.collect.type]}`);
  return `${parts.join(' · ')}. Match four for a striped crystal, five for a colour bomb. ${c.moves} moves.`;
}

// ---------------------------------------------------------------- the level curve

// One knob set, so the curve can be tuned in one place and measured with tools/sequence-levels.mjs.
export const V3_TUNING = Object.freeze({
  // Six colours, at every level. v2 opened on four, and with specials firing four colours turn the board
  // into a self-sustaining chain reaction (measured: 7,000 points and 57 seconds for a single move).
  // Six also separates skill best: a smart bot out-scores a random one 2.0x at six colours and only 1.5x
  // at seven, so the win-rate spread the curve needs comes almost free. White is left to the colour bomb.
  palette: 6,
  waveCap: 6,  // a cascade's multiplier stops climbing here, so one lucky chain cannot be worth a whole level
  movesAt1: 24, movesFloor: 20, movesStep: 12,  // moves fall one per `movesStep` levels, down to the floor
  // The points per move the score goal assumes, as knots the curve runs straight between and then holds.
  // Solved with tools/sequence-levels.mjs by bisecting the goal that gives the wanted bot win rate at each
  // checkpoint, then smoothed: the raw solutions carry about +/-10% of layout luck level to level. The bump
  // around level 40 is real and not noise: ice has reached its three-layer ceiling there while the move
  // budget has not yet come down, so those levels need a higher goal to stay as hard as their neighbours.
  perMove: [[1, 240], [3, 248], [5, 315], [10, 585], [15, 630], [20, 745], [30, 800], [40, 880], [55, 830], [100, 790]],
  // How much of a level's difficulty its objectives already carry, as a multiplier on its score goal, so
  // that every plan lands at the same win rate and a level's character comes from what it asks rather than
  // from being quietly harder. Solved by measuring the smart bot's win rate per plan over levels 26-100 and
  // moving each weight until the plans agreed: score-only and ice+traps turn out to be the *hardest* plans
  // once their objectives are easy for a good player, which is the opposite of what it looks like.
  planWeight: {score: 1.05, ice: 0.97, collect: 0.98, 'traps+ice': 1.01, 'ice+traps': 1.01, 'traps+collect': 0.97, 'ice+collect': 0.93},
  // Quotas are a share of what a level's moves can actually clear, so they tighten without outrunning it.
  iceTiles: [4, 9], iceEvery: 7, trapCount: [2, 5], trapEvery: 14, collectCount: [8, 16], collectEvery: 5,
  // A level asking for two kinds of objective at once asks less of each.
  duoShare: 0.7,
  // v4 only. Testers cleared the first levels but said getting through them took too long, and the measured
  // curve agrees: there is a cliff at level 5, where ice goes to two layers in the same level the score goal
  // starts climbing steeply, and the collect levels at 9 and 10 ask for nine crystals on the same 24 moves.
  // This eases levels 1 to 14 and meets the solved curve again at 15, which is untouched along with
  // everything above it. Solved the same way the rest of the curve was: by measuring the bots per level with
  // tools/sequence-levels.mjs and moving these numbers until levels 1-10 landed inside the wanted band.
  early: {
    // The first level that plays exactly as v3 does. The knots below end here, at the v3 value, so the two
    // curves join without a step.
    until: 15,
    perMove: [[1, 215], [3, 225], [5, 250], [10, 400], [15, 630]],
    // The second layer of ice waits until the player has had a dozen levels of the single-layer kind.
    iceLayersFrom: 12,
    // Objective quotas ease from this share at level 1 back to the full quota at `until`.
    quotaShare: 0.6,
  },
});

export const v3Palette = () => V3_TUNING.palette;

// Moves fall slowly, which is the cleanest pressure there is: it costs a random player far more than a
// player who sets up specials. They stay near flat so the score goal can keep climbing.
export function v3Moves(level) {
  const n = Math.max(1, level);
  return Math.max(V3_TUNING.movesFloor, V3_TUNING.movesAt1 - Math.floor((n - 1) / V3_TUNING.movesStep));
}

// Straight lines between the knots, held flat past the last one.
function alongKnots(knots, n) {
  if (n <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
    if (n <= x1) return y0 + (y1 - y0) * (n - x0) / (x1 - x0);
  }
  return knots[knots.length - 1][1];
}
export function v3PerMove(level, version = SEQUENCE_V3_VERSION) {
  const n = Math.max(1, level);
  // v4's early knots run up to the level where they meet v3's curve; above that there is one curve.
  if (version >= SEQUENCE_V4_VERSION && n < V3_TUNING.early.until) return alongKnots(V3_TUNING.early.perMove, n);
  return alongKnots(V3_TUNING.perMove, n);
}
// How much of a level's objective quota it actually asks for: all of it, except in v4's early levels.
export function v3QuotaShare(level, version = SEQUENCE_V3_VERSION) {
  const n = Math.max(1, level), {until, quotaShare} = V3_TUNING.early;
  if (version < SEQUENCE_V4_VERSION || n >= until) return 1;
  return quotaShare + (1 - quotaShare) * (n - 1) / (until - 1);
}

// The score goal is the moves times the points per move a competent player earns — which climbs steeply
// as specials and combos come online — adjusted for how much the level's own objectives already ask.
// It keeps rising past level 36 instead of flattening at 4,500 the way v2's did.
export function v3Target(level, version = SEQUENCE_V3_VERSION) {
  const n = Math.max(1, level);
  const weight = V3_TUNING.planWeight[v3Plan(n)] ?? 1;
  return Math.round(v3Moves(n) * v3PerMove(n, version) * weight / 50) * 50;
}

// The objective rotation. Levels 1-10 keep PR #20's teaching order so the mechanics still arrive one at a
// time; from level 11 a six-level cycle means no two levels in a row play the same way.
const V3_CYCLE = ['ice', 'collect', 'ice+traps', 'traps+collect', 'score', 'ice+collect'];
export function v3Plan(level) {
  const n = Math.max(1, level);
  if (n <= 2) return 'score';
  if (n <= 4) return 'ice';
  if (n <= 6) return 'ice';
  if (n <= 8) return 'traps+ice';
  if (n <= 10) return 'collect';
  return V3_CYCLE[(n - 11) % V3_CYCLE.length];
}

// Eight shape families, placed with a generator seeded from the level alone, so every player sees the same
// board for a given level (as the daily competition needs) but neighbouring levels never look alike.
const FAMILIES = [
  (r, c) => r % 2 === 0 && c % 2 === 0,                    // pockets
  (r, c) => r === 3 || c === 3,                            // cross
  (r, c) => Math.abs(r - 3) + Math.abs(c - 3) === 2,       // diamond
  (r, c) => (r < 2 || r > 4) && (c < 2 || c > 4),          // corners
  (r, c) => (r === 1 || r === 5 || c === 1 || c === 5) && r > 0 && r < 6 && c > 0 && c < 6, // ring
  (r, c) => r === 2 || r === 4,                            // bars
  (r, c) => (r + c) % 2 === 0 && r > 0 && r < 6 && c > 0 && c < 6, // checker
  (r, c) => r + c >= 4 && r + c <= 8,                      // wedge
];

// mulberry32 again, keyed on the level, so a layout is a pure function of the level number.
function layoutRandom(level, salt) {
  let state = (Math.imul(level, 2654435761) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  return () => {
    let a = (state += 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickCells(level, salt, count, eligible) {
  if (count <= 0) return [];
  const rng = layoutRandom(level, salt);
  const family = FAMILIES[Math.floor(rng() * FAMILIES.length)];
  const mirror = rng() < 0.5, flip = rng() < 0.5;
  const pool = [];
  for (let i = 0; i < V3_CELLS; i++) {
    const r = flip ? V3_SIZE - 1 - rowOf(i) : rowOf(i), c = mirror ? V3_SIZE - 1 - colOf(i) : colOf(i);
    if (family(r, c) && eligible(i)) pool.push(i);
  }
  // Anything the family did not cover, so a small family can still fill a large quota.
  for (let i = 0; i < V3_CELLS; i++) if (eligible(i) && !pool.includes(i)) pool.push(i);
  // Seeded Fisher-Yates over the family's cells only, so the shape still shows through.
  const head = pool.filter(i => {
    const r = flip ? V3_SIZE - 1 - rowOf(i) : rowOf(i), c = mirror ? V3_SIZE - 1 - colOf(i) : colOf(i);
    return family(r, c);
  });
  const tail = pool.filter(i => !head.includes(i));
  for (let i = head.length - 1; i > 0; i--) {const j = Math.floor(rng() * (i + 1)); [head[i], head[j]] = [head[j], head[i]];}
  for (let i = tail.length - 1; i > 0; i--) {const j = Math.floor(rng() * (i + 1)); [tail[i], tail[j]] = [tail[j], tail[i]];}
  return [...head, ...tail].slice(0, count).sort((a, b) => a - b);
}

const ramp = (n, from, to, over) => Math.min(to, from + Math.floor(Math.max(0, n - 1) / over));

export function v3Level(level, version = SEQUENCE_V3_VERSION) {
  const n = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const plan = v3Plan(n), moves = v3Moves(n), target = v3Target(n, version);
  const ice = Array(V3_CELLS).fill(0), locks = Array(V3_CELLS).fill(false);
  const wantsIce = plan.includes('ice'), wantsTraps = plan.includes('traps'), wantsCollect = plan.includes('collect');
  // Two objectives in one level each ask less, so a mixed level is a change of shape rather than a wall.
  const share = ((wantsIce ? 1 : 0) + (wantsTraps ? 1 : 0) + (wantsCollect ? 1 : 0) > 1 ? V3_TUNING.duoShare : 1)
    * v3QuotaShare(n, version);
  const quota = ([from, to], every) => Math.max(1, Math.round(ramp(n, from, to, every) * share));

  if (wantsIce) {
    const count = quota(V3_TUNING.iceTiles, V3_TUNING.iceEvery);
    // One layer while ice is new, two once it is familiar, and a third from level 25 so it keeps growing.
    // v3 doubled it at level 5, in the same level its score goal started climbing; v4 waits.
    const second = version >= SEQUENCE_V4_VERSION ? V3_TUNING.early.iceLayersFrom : 5;
    const layers = n < second ? 1 : n < 25 ? 2 : 3;
    for (const i of pickCells(n, 1, count, () => true)) ice[i] = layers;
  }
  if (wantsTraps) {
    // The top two rows stay clear, so there is always room above for a rescue swap.
    const count = quota(V3_TUNING.trapCount, V3_TUNING.trapEvery);
    for (const i of pickCells(n, 2, count, i => i >= 2 * V3_SIZE)) locks[i] = true;
  }
  const palette = v3Palette(n);
  const collect = wantsCollect
    ? {type: (Math.floor(n / 3) + Math.floor((n - 1) / 10)) % palette, count: quota(V3_TUNING.collectCount, V3_TUNING.collectEvery)}
    : null;
  return {level: n, plan, moves, target, palette, ice, locks, collect, version};
}

// ---------------------------------------------------------------- boards

export function settleV3(board, rng, palette, state) {
  return settleProgression(board, rng, palette, state);
}

// A board of plain crystals with no run of three anywhere, drawn in row order from `rng`. Same shape as
// v1/v2's generator, but taking the palette as an argument so v3 can widen it without touching them.
export function freshV3Board(palette, rng) {
  const board = Array(V3_CELLS);
  for (let row = 0; row < V3_SIZE; row++) for (let col = 0; col < V3_SIZE; col++) {
    const choices = [];
    for (let value = 0; value < palette; value++) {
      const twoLeft = col >= 2 && board[row * V3_SIZE + col - 1] === value && board[row * V3_SIZE + col - 2] === value;
      const twoUp = row >= 2 && board[(row - 1) * V3_SIZE + col] === value && board[(row - 2) * V3_SIZE + col] === value;
      if (!twoLeft && !twoUp) choices.push(value);
    }
    board[row * V3_SIZE + col] = choices[Math.floor(rng() * choices.length)];
  }
  return board;
}

// A fresh board: no ready-made lines, and at least one legal swap. Trapped crystals keep their crystal.
export function createV3Board(config, rng, state, previous = null) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const board = freshV3Board(config.palette, rng);
    if (previous) for (let i = 0; i < V3_CELLS; i++) if (state.locks[i]) board[i] = previous[i];
    if (!v3Matches(board).size && v3Move(board, state)) return board;
  }
  // Bounded deterministic fallback, as v2 has: keep the trapped crystals, refill without pre-made lines,
  // and reserve an open corner for one guaranteed swap. It never removes an objective.
  const board = Array(V3_CELLS).fill(EMPTY);
  for (let i = 0; i < V3_CELLS; i++) if (state.locks[i]) board[i] = previous?.[i] ?? i % config.palette;
  const corner = [0, 1, 2, 7, 8, 9], values = [0, 1, 0, 2, 0, 3];
  corner.forEach((cell, k) => board[cell] = values[k]);
  const fixed = new Set(corner);
  for (let i = 0; i < V3_CELLS; i++) {
    if (fixed.has(i) || state.locks[i]) {if (board[i] < 0) board[i] = i % config.palette; continue;}
    const choices = [];
    for (let v = 0; v < config.palette; v++) {board[i] = v; if (!v3Matches(board).has(i)) choices.push(v);}
    board[i] = choices.length ? choices[Math.floor(rng() * choices.length)] : 0;
  }
  return board;
}

// ---------------------------------------------------------------- the end-of-level bonus

// When the level is won, every move the player did not need fires a striped crystal, and then anything
// still special on the board goes off. It is what makes winning with moves to spare beat farming points,
// and it is drawn from the run's own generator so a replay reproduces it exactly.
export function v3BonusPick(board, state, rng) {
  const choices = [];
  for (let i = 0; i < V3_CELLS; i++) if (board[i] >= 0 && !state.locks[i] && !isSpecial(board[i])) choices.push(i);
  if (!choices.length) return null;
  const at = choices[Math.floor(rng() * choices.length)];
  const kind = rng() < 0.5 ? STRIPE_V : STRIPE_H;
  return {at, cell: makeCell(kind, colourOf(board[at]))};
}

export function v3RemainingSpecials(board) {
  const out = [];
  for (let i = 0; i < V3_CELLS; i++) if (isSpecial(board[i])) out.push(i);
  return out;
}

// ---------------------------------------------------------------- what a bot can see

// One move judged on the visible board alone: refills are UNKNOWN, so they never match and never score.
// This is what the greedy and smart bots in tools/sequence-levels.mjs decide on.
export function previewV3Move(board, state, config, a, b) {
  const trigger = v3SwapKind(board, a, b, state);
  if (!trigger) return null;
  let cur = trigger.next, progress = state, again = [], wave = 1;
  let gained = 0, comboBonus = 0, chain = 0, cleared = 0;
  const made = {stripe: 0, wrap: 0, bomb: 0};
  let ice = 0, traps = 0, collected = 0;
  let step = trigger;
  for (let guard = 0; guard < 24; guard++) {
    const plan = planV3Wave(cur, config, progress, {trigger: step, again, wave});
    if (!plan.clear.size && !plan.create.size) break;
    gained += plan.gained;
    if (plan.combo) comboBonus += V3_SCORE.combo[plan.combo] * plan.wave;
    cleared += plan.clear.size;
    made.stripe += plan.made.stripe; made.wrap += plan.made.wrap; made.bomb += plan.made.bomb;
    const after = applyV3Wave(config, progress, cur, plan.clear);
    ice += progress.ice.reduce((n, v, i) => n + v - after.ice[i], 0);
    traps += progress.locks.filter(Boolean).length - after.locks.filter(Boolean).length;
    collected += after.collected - progress.collected;
    progress = after;
    // Settle with every refill unknown: a bot must not be able to read the generator.
    const held = cur.map((v, i) => plan.clear.has(i) ? EMPTY : v);
    for (const [at, cell] of plan.create) held[at] = cell;
    const next = held.slice();
    for (let col = 0; col < V3_SIZE; col++) {
      let bottom = V3_SIZE - 1;
      for (let boundary = V3_SIZE - 1; boundary >= -1; boundary--) {
        if (boundary >= 0 && !progress.locks[boundary * V3_SIZE + col]) continue;
        let write = bottom;
        for (let row = bottom; row > boundary; row--) if (held[row * V3_SIZE + col] >= 0) {next[write * V3_SIZE + col] = held[row * V3_SIZE + col]; write--;}
        for (let row = write; row > boundary; row--) next[row * V3_SIZE + col] = UNKNOWN;
        bottom = boundary - 1;
      }
    }
    cur = next; again = plan.againAt; step = null; wave++; chain++;
  }
  return {gained, comboBonus, chain, cleared, made, ice, traps, collected, board: cur, progress};
}
