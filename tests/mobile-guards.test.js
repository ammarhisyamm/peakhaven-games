// The mobile fixes from the 20 Oct 2026 audit, as invariants rather than as a memory of a bug.
// None of this needs a DOM: every one is a property of the stylesheets and the markup we ship, and
// each has a failure that is invisible on a desktop browser and obvious on a phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const shell=read('arcade/ui/styles.css'),play=read('arcade/ui/play.css');
const gameplay=read('dist/gameplay.css'),gameStyles=read('dist/styles.css');
const shellHtml=read('arcade/ui/index.html'),gameHtml=read('arcade/ui/game/index.html');
const allCss=[shell,play,gameplay,gameStyles,read('dist/world-ui.css')];

// One rule carries all three touch guards, so one test reads it and checks every surface is listed.
// The tray always had touch-action; the board did not, which is where most of a drag happens.
const touchGuard=()=>{
  const m=/([^{}]*)\{([^}]*-webkit-touch-callout:none[^}]*)\}/.exec(gameplay);
  return m?{surfaces:m[1].trim(),body:m[2]}:null;
};

test('Every game surface claims the touch, and cannot be selected or long-pressed',()=>{
  const guard=touchGuard();
  assert.ok(guard,'no -webkit-touch-callout:none rule: iOS will show the callout on a held piece');
  for(const prop of ['touch-action:none','user-select:none','-webkit-user-select:none'])
    assert.ok(guard.body.includes(prop),`the guard rule is missing ${prop}`);
  for(const surface of ['.block-board','.block-tray','canvas'])
    assert.ok(guard.surfaces.includes(surface),
      `${surface} is not in the guard rule, so a drag there can still scroll the page`);
});

test('The pull-to-refresh guard is on the document element, where the scroll chain starts',()=>{
  assert.match(gameplay,/html\{[^}]*overscroll-behavior:none/,
    'overscroll-behavior on body alone does not reliably stop the rubber band');
});

test('Every gutter clears the side safe-area insets, because viewport-fit=cover is set',()=>{
  // Without this the notch covers the burger button and the nav in landscape.
  for(const html of [shellHtml,gameHtml])
    assert.match(html,/viewport-fit=cover/,'the premise of the whole safe-area dance');
  assert.match(shell,/\.brand-header\{[^}]*env\(safe-area-inset-left\)/,'header must clear the left inset');
  assert.match(shell,/main,\.page-footer\{[^}]*env\(safe-area-inset-left\)/,'page gutters must clear it');
  for(const css of [shell,play])
    assert.match(css,/\.main-nav\{[^}]*env\(safe-area-inset-left\)/,'the fixed bottom nav must clear it');
});

test('A home-screen shortcut gets the mark, not a screenshot of the page',()=>{
  for(const [name,html] of [['arcade',shellHtml],['game',gameHtml]]){
    assert.match(html,/rel="apple-touch-icon"/,`${name}/index.html needs an apple-touch-icon`);
    assert.match(html,/name="theme-color"/,`${name}/index.html should set a theme colour`);
  }
});

test('No stylesheet uses 100vh, which the Safari address bar makes wrong',()=>{
  for(const css of allCss){
    const bad=css.match(/[^dsa-z]100vh/g)||[];
    assert.equal(bad.length,0,'use dvh or svh so the address bar cannot push content off screen');
  }
});

test('Canvas backing stores stay capped at 2x, however dense the screen claims to be',()=>{
  for(const p of ['dist/engines.js','dist/tryout-games.js'])
    assert.match(read(p),/Math\.min\(2,\s*window\.devicePixelRatio/,
      `${p} must cap devicePixelRatio: a 3x phone would otherwise paint 2.25x the pixels for nothing`);
});

test('A rotation under a held finger re-measures the board instead of using stale geometry',()=>{
  const src=read('dist/puzzle-games.js');
  assert.match(src,/const dragResize=\(\)=>\{if\(drag\)drag\.metrics=boardMetrics\(\);\}/,
    'the per-drag metrics cache needs an invalidation path');
  assert.match(src,/addEventListener\('resize',dragResize\)/,'and it has to be wired up');
  assert.match(src,/removeEventListener\('resize',dragResize\)/,'and torn down with the game');
});
