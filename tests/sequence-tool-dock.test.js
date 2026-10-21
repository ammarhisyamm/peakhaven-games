// Where the Sequence helper dock (Shuffle and Hammer, rules v4) ends up, and the one place it must
// never end up: the top-left corner of the screen.
//
// The shape of the bug this guards. `.in-game .play-panel` is `position:absolute;inset:0;display:block`
// and `.in-game .canvas-wrap` is absolute on top of it, so on a canvas scene the dock is the only child
// of the panel still in its flow. An element in the flow of a block box starts at that box's origin, and
// the panel's origin is the screen's top-left, so a dock with no placement of its own lands under the
// back button and the HUD. The three DOM-board scenes never showed it because gameplay.css gives their
// panel a centred flex column with padding; Sequence is the one canvas scene with a dock.
//
// So the invariant is not "the dock has a nice bottom offset". It is: as long as the Sequence play panel
// is a block box whose other children are all out of the flow, anything the shell puts in it has to place
// itself. The test establishes that premise from the stylesheets first, and only then requires the
// placement -- so if someone later gives the Sequence panel a flex column of its own, this fails pointing
// at the premise rather than silently passing or silently failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Both hosts: dist/ is the gameplay source and the original shell, arcade/ui/game/ is the V2 interface
// that production serves. The dock ships in both, so both stylesheet stacks are checked.
const SHEETS = {
  v2: ['dist/styles.css', 'dist/world-ui.css', 'dist/gameplay.css', 'arcade/ui/game/arcade-overrides.css',
    'arcade/ui/game/reference-results.css'],
  dist: ['dist/styles.css', 'dist/world-ui.css', 'dist/gameplay.css'],
};

// ---------------------------------------------------------------- just enough of a cascade

const uncommented = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Every rule in a sheet, flattened, carrying the @media condition it sits under and its source order.
// @keyframes bodies come through too; their `0%`/`to` selectors match nothing here, so they fall out.
function flatten(css, sheet, from = 0) {
  const text = uncommented(css), out = [];
  const scopes = [];
  let at = 0, order = from;
  while (at < text.length) {
    const open = text.indexOf('{', at), close = text.indexOf('}', at);
    if (open < 0 && close < 0) break;
    if (open >= 0 && (close < 0 || open < close)) {
      const head = text.slice(at, open).trim();
      if (head.startsWith('@')) scopes.push({media: head});
      else {
        scopes.push({media: null});
        out.push({sheet, selector: head, body: text.slice(open + 1, close),
          media: scopes.map(s => s.media).filter(Boolean).join(' '), order: order++});
      }
      at = open + 1;
    } else {scopes.pop(); at = close + 1;}
  }
  return out;
}

const SIMPLE = /^(?:[a-z]+)?(?:\.[A-Za-z0-9_-]+)*$/;   // tag and classes only: what these sheets use

// An element as the shell builds it, innermost last.
const ancestry = scene => [
  {tag: 'html', classes: []},
  {tag: 'body', classes: ['game-open']},
  {tag: 'div', classes: []},                                                     // #app
  {tag: 'div', classes: ['phone-app', 'world-interface', 'view-game', 'in-game']},
  {tag: 'main', classes: []},
  {tag: 'section', classes: ['game-world', `scene-${scene}`]},
  {tag: 'section', classes: ['play-panel']},
];
const dockOn = scene => [...ancestry(scene),
  {tag: 'div', classes: ['game-tools', 'control-dock', 'lab-console', 'slim-console']}];

const compoundFits = (compound, node) => {
  const tag = compound.match(/^[a-z]+/);
  if (tag && tag[0] !== node.tag) return false;
  return (compound.match(/\.[A-Za-z0-9_-]+/g) || []).every(c => node.classes.includes(c.slice(1)));
};

// Descendant combinators only, which is all these selectors use for this element.
function selectorFits(selector, path) {
  const parts = selector.trim().split(/\s+/);
  if (!parts.every(p => SIMPLE.test(p))) return null;                 // unsupported: caller decides
  if (!compoundFits(parts[parts.length - 1], path[path.length - 1])) return false;
  let i = path.length - 2;
  for (let p = parts.length - 2; p >= 0; p--) {
    while (i >= 0 && !compoundFits(parts[p], path[i])) i--;
    if (i < 0) return false;
    i--;
  }
  return true;
}

const specificity = selector => {
  const ids = (selector.match(/#[A-Za-z0-9_-]+/g) || []).length;
  const classes = (selector.match(/\.[A-Za-z0-9_-]+|\[[^\]]*\]|:[a-z-]+/g) || []).length;
  const tags = (selector.match(/(?:^|[\s>+~])[a-z]+/g) || []).length;
  return ids * 10000 + classes * 100 + tags;
};

// max-width / max-height / min-width / min-height, which is every query these sheets use on this element.
function mediaFits(media, {width, height}) {
  if (!media) return true;
  const terms = media.replace(/@media/g, '').split(/\s+and\s+|,/).map(t => t.trim()).filter(Boolean);
  const got = [];
  for (const term of terms) {
    const m = /^\(\s*(max|min)-(width|height)\s*:\s*(\d+)px\s*\)$/.exec(term);
    if (!m) return null;                                              // unsupported: caller decides
    const value = m[2] === 'width' ? width : height;
    got.push(m[1] === 'max' ? value <= Number(m[3]) : value >= Number(m[3]));
  }
  return got.every(Boolean);
}

const declarations = body => {
  const out = new Map();
  for (const piece of body.split(';')) {
    const at = piece.indexOf(':');
    if (at < 0) continue;
    out.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
  }
  return out;
};

const POSITIONING = ['position', 'top', 'right', 'bottom', 'left', 'inset'];

// A selector this reader cannot resolve still matters if its subject -- the rightmost compound, the
// element the rule actually styles -- could be the one being asked about. `.tool-button>b` styles the
// badge inside the dock's buttons and can never move the dock, so it is not reported.
function couldTarget(selector, node) {
  const subject = selector.trim().split(/[\s>+~]+/).filter(Boolean).pop() || '';
  if (/::|:(?:before|after)\b/.test(subject)) return false;     // a pseudo-element is a box of its own
  if (subject.includes('#')) return false;                      // the dock carries no id
  const bare = subject.replace(/:[a-z-]+(\([^)]*\))?|\[[^\]]*\]/g, '');
  const tag = bare.match(/^[a-z]+/);
  if (tag && tag[0] !== node.tag) return false;
  const classes = (bare.match(/\.[A-Za-z0-9_-]+/g) || []).map(c => c.slice(1));
  // A rule that places this element names at least one of its classes: nothing in these sheets positions
  // a game surface by tag or ancestry alone.
  return classes.length > 0 && classes.every(c => node.classes.includes(c));
}

// The winning value of each positioning property for `path` at `viewport`, plus every rule that could
// have had a say but used a selector or a query this reader does not understand.
function placement(sheets, path, viewport) {
  const all = [];
  let order = 0;
  for (const sheet of sheets) {const flat = flatten(read(sheet), sheet, order); order += flat.length; all.push(...flat);}
  const won = new Map(), unread = [];
  const candidates = [];
  for (const rule of all) {
    for (const selector of rule.selector.split(',')) {
      const touches = POSITIONING.some(p => declarations(rule.body).has(p));
      const fits = selectorFits(selector, path);
      const media = mediaFits(rule.media, viewport);
      if ((fits === null || media === null)) {
        // Only worth reporting if it could have moved this element: a rule whose subject is some other
        // element cannot, and one that sets no positioning property cannot either.
        if (touches && couldTarget(selector, path[path.length - 1])) unread.push({...rule, selector});
        continue;
      }
      if (fits && media) candidates.push({...rule, selector, weight: specificity(selector)});
    }
  }
  candidates.sort((a, b) => a.weight - b.weight || a.order - b.order);
  for (const rule of candidates)
    for (const [property, value] of declarations(rule.body))
      if (POSITIONING.includes(property)) won.set(property, {value, from: `${rule.sheet} :: ${rule.selector}`});
  return {won, unread, candidates};
}

// ---------------------------------------------------------------- the premise

test('The Sequence play panel is still a block box whose other children are out of the flow', () => {
  const gameplay = uncommented(read('dist/gameplay.css'));
  const rule = name => {
    const m = new RegExp(`(?:^|\\})\\s*([^{}]*\\${name}[^{}]*)\\{([^}]*)\\}`).exec(gameplay);
    return m ? {selector: m[1].trim(), body: m[2]} : null;
  };
  const panel = rule('.play-panel'), wrap = rule('.canvas-wrap');
  assert.ok(panel && wrap, 'gameplay.css no longer has .play-panel / .canvas-wrap rules: read it again');
  assert.match(panel.body, /position:absolute/, 'the panel is the containing block the dock would start from');
  assert.match(panel.body, /display:block/, 'if the panel became a flex column the dock would be laid out by it');
  assert.match(wrap.body, /position:absolute/, 'the canvas being out of the flow is why the dock is first in it');
  // The scenes whose panel IS given a flex column, which is what places their docks. Sequence is not one
  // of them, and that is the whole reason it needs a placement of its own.
  const flex = /([^{}]*)\{[^}]*display:flex;flex-direction:column[^}]*\}/g;
  const scened = [...gameplay.matchAll(flex)].map(m => m[1]).filter(s => s.includes('.play-panel')).join(' ');
  assert.ok(scened, 'no scene gives .play-panel a flex column any more: this premise needs rewriting');
  assert.ok(!scened.includes('.scene-sequence'),
    'the Sequence panel now lays its children out itself, so the placement rule below may be redundant');
});

// ---------------------------------------------------------------- the bug

// Every viewport the dock has to be right at: the two the bug was reported and reproduced at, the
// shortest phone the sheets have a rule for, and a small Android.
const VIEWPORTS = [
  {width: 390, height: 844, label: 'iPhone 14'},
  {width: 1440, height: 900, label: 'desktop'},
  {width: 360, height: 640, label: 'small Android'},
  {width: 390, height: 667, label: 'short phone'},
  {width: 844, height: 390, label: 'landscape phone'},
  {width: 412, height: 915, label: 'Pixel'},
];

for (const [host, sheets] of Object.entries(SHEETS)) {
  test(`The Sequence tool dock is placed, and placed at the bottom (${host})`, () => {
    for (const {width, height, label} of VIEWPORTS) {
      const {won, unread} = placement(sheets, dockOn('sequence'), {width, height});
      const where = `${host} @ ${label} ${width}x${height}`;
      assert.deepEqual(unread.map(r => `${r.sheet} :: ${r.selector}`), [],
        `${where}: a rule that could move the dock uses a selector or query this test cannot read`);

      const position = won.get('position');
      assert.ok(position, `${where}: nothing sets the dock's position, so it sits in the play panel's ` +
        'flow and lands on its origin -- the top-left corner, under the back button and the HUD');
      assert.ok(['absolute', 'fixed'].includes(position.value),
        `${where}: the dock is position:${position.value} (${position.from}), which still leaves it in the flow`);

      assert.ok(won.get('bottom'), `${where}: the dock is positioned but not anchored to the bottom, so it ` +
        'keeps whatever static position it had -- the top of the panel');
      assert.ok(!won.get('top'), `${where}: the dock is anchored to the top by ${won.get('top')?.from}`);
    }
  });
}

// The other canvas scenes have no dock at all, so nothing should be claiming to place one for them --
// a rule that matched every scene would be a sign the placement was written too broadly.
test('The placement is the Sequence scene\'s own, not every canvas scene\'s', () => {
  for (const scene of ['tower', 'merge', 'orbit', 'ridge', 'bond']) {
    const {won} = placement(SHEETS.v2, dockOn(scene), {width: 390, height: 844});
    const anchored = won.get('bottom');
    assert.ok(!anchored,
      `a dock in the ${scene} scene would be placed by ${anchored?.from}, but that scene has no dock`);
  }
});

// ---------------------------------------------------------------- the other reading, kept ruled out

// The bug was reported as "the power ups are glitched at the top left", which could also have been the
// engine painting a special crystal at the canvas origin for a frame -- a sprite drawn before its x and y
// are set, when one is created, detonated, hammered, shuffled or falls in on the refill. It was not: this
// drives real runs on all four rulesets through a 2D context that records where every paint lands, and
// nothing reaches the corner. Kept as a test because it is the cheap way to keep it that way, and because
// a stray paint there would look exactly like the dock bug it was confused with.
globalThis.window = {devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.Image = class {complete = false; naturalWidth = 0;};
globalThis.document = {querySelector: () => null};
const {SequenceEngine} = await import('../dist/tryout-games.js');
const {SIM_STEP} = await import('../dist/rng.js');

// Records the canvas-space point of every paint, honouring translate() and the one rectangular clip the
// board draws under -- a paint the clip swallows is not on screen and does not count.
function recorder() {
  const points = [];
  let tx = 0, ty = 0, clip = null;
  const stack = [], path = [];
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const px = x + tx, py = y + ty;
    if (clip && (px < clip[0] || px > clip[2] || py < clip[1] || py > clip[3])) return;
    points.push({x: px, y: py});
  };
  const ctx = {
    save() {stack.push([tx, ty, clip]);},
    restore() {const s = stack.pop(); if (s) [tx, ty, clip] = s;},
    translate(x, y) {tx += x; ty += y;},
    rotate() {}, scale() {}, setTransform() {}, closePath() {}, clearRect() {},
    beginPath() {path.length = 0;},
    moveTo(x, y) {path.push([x, y]);},
    lineTo(x, y) {path.push([x, y]);},
    rect(x, y, w, h) {path.push([x, y], [x + w, y + h]);},
    roundRect(x, y, w, h) {path.push([x, y], [x + w, y + h]);},
    arc(x, y, r) {path.push([x - r, y - r], [x + r, y + r]);},
    ellipse(x, y, rx, ry) {path.push([x - rx, y - ry], [x + rx, y + ry]);},
    fill() {for (const [x, y] of path) add(x, y);},
    stroke() {for (const [x, y] of path) add(x, y);},
    clip() {
      if (!path.length) return;
      const xs = path.map(p => p[0] + tx), ys = path.map(p => p[1] + ty);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      clip = clip ? [Math.max(clip[0], box[0]), Math.max(clip[1], box[1]),
        Math.min(clip[2], box[2]), Math.min(clip[3], box[3])] : box;
    },
    fillRect(x, y, w, h) {add(x, y); add(x + w, y + h);},
    strokeRect(x, y, w, h) {add(x, y); add(x + w, y + h);},
    drawImage(image, x, y, w, h) {add(x, y); add(x + (w ?? 0), y + (h ?? 0));},
    fillText(text, x, y) {add(x, y);},
    strokeText(text, x, y) {add(x, y);},
    measureText: () => ({width: 10}),
    createLinearGradient: () => ({addColorStop() {}}),
  };
  for (const key of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'textAlign',
    'textBaseline', 'shadowColor', 'shadowBlur', 'lineJoin', 'lineCap']) ctx[key] = '';
  return {ctx, points, reset() {points.length = 0; tx = 0; ty = 0; clip = null; stack.length = 0;}};
}

const CORNER = 160;   // the corner the back button and the HUD occupy, in the canvas's own units

function cornerPaints({seed, level, rulesVersion}) {
  const rec = recorder(), noop = () => {};
  const canvas = {
    getContext: () => rec.ctx,
    getBoundingClientRect: () => ({width: 390, height: 844, left: 0, top: 0}),
    addEventListener: noop, removeEventListener: noop, setPointerCapture: noop,
  };
  const cb = {hud: noop, goals: noop, ready: noop, haptic: noop, sound: noop, message: noop,
    effect: noop, tools: noop, end: noop};
  const engine = new SequenceEngine(canvas, cb, {seed, level, motion: true, rulesVersion});
  const hits = [];
  const draw = () => {
    rec.reset();
    engine.draw();
    engine.drawEffects();
    const g = engine.geometry();
    for (const p of rec.points)
      if (p.x < CORNER && p.y < CORNER && p.y < g.y) hits.push({...p, phase: engine.phase});
  };
  const settle = (max = 2000) => {
    for (let i = 0; i < max; i++) {
      draw();
      if (engine.ended || (!engine.pending && !engine.phase)) return;
      engine.step(SIM_STEP);
    }
  };
  draw();                               // the opening board, before anything has been touched
  settle();
  let played = 0;
  while (!engine.ended && played < 60) {
    if (played === 2 && engine.tools?.shuffle > 0) {engine.useShuffle(); settle();}
    if (played === 4 && engine.tools?.hammer > 0) {engine.armHammer(true); draw(); engine.choose(24); settle();}
    const pair = engine.findMove();
    if (!pair) break;
    engine.choose(pair[0], pair[1]);
    played++;
    settle();
  }
  for (let i = 0; i < 400; i++) {draw(); engine.step(SIM_STEP);}   // the end-of-level specials fire here
  return {hits, specials: engine.specialsMade};
}

test('Nothing the Sequence engine draws lands in the canvas top-left corner', () => {
  let specials = 0;
  for (const rulesVersion of [1, 2, 3, 4])
    for (const level of [1, 4, 7, 11])
      for (const seed of [7919, 15838, 23757]) {
        const {hits, specials: made} = cornerPaints({seed, level, rulesVersion});
        specials += made;
        assert.deepEqual(hits.slice(0, 3), [], `v${rulesVersion} level ${level} seed ${seed}: ` +
          'the engine painted above the board in the top-left corner');
      }
  // The runs have to have actually made and fired specials, or the test proved nothing about them.
  assert.ok(specials > 0, 'no striped, wrapped or colour-bomb crystal was made in any run: the driver ' +
    'is not reaching the code this test is about');
});
