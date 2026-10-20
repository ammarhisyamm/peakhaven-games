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

// Every rule inside a max-width block, with the block it came from, so a height can be checked where
// it actually applies. A plain brace walk, with the comments taken out first because a comment sits
// between a brace and the selector that follows it: @media pushes a scope, a selector pushes one and
// keeps its body, and a closing brace pops.
const uncommented=css=>{
 let out='',at=0;
 for(;;){
  const start=css.indexOf('/*',at);
  if(start<0)return out+css.slice(at);
  const end=css.indexOf('*/',start);
  out+=css.slice(at,start);
  if(end<0)return out;
  at=end+2;
 }
};
const phoneRules=sheet=>{
 const css=uncommented(sheet),rules=[],scopes=[];let at=0;
 while(at<css.length){
  const open=css.indexOf('{',at),close=css.indexOf('}',at);
  if(open<0&&close<0)break;
  if(open>=0&&(close<0||open<close)){
   const head=css.slice(at,open).trim(),phone=scopes.find(s=>s.phone);
   if(head.startsWith('@'))scopes.push({phone:head.includes('max-width')?head:null});
   else{scopes.push({phone:null});
    if(phone)rules.push({where:`${phone.phone} ${head}`,selector:head,body:css.slice(open+1,close)});}
   at=open+1;
  }else{scopes.pop();at=close+1;}
 }
 return rules;
};
// clamp(floor,…) is only ever as tall as its floor, so that is the number a thumb gets.
const minHeight=body=>{
 const at=body.indexOf('min-height:');
 if(at<0)return null;
 const value=body.slice(at+'min-height:'.length).split(';')[0].trim();
 return parseFloat(value.startsWith('clamp(')?value.slice('clamp('.length):value);
};

// The play page's two full-width controls, at the widths a phone actually uses. Both came up short
// once main's card layout landed on this branch -- the Play button because a later and more specific
// rule set 40px, the achievements summary because it did not exist when this pass was written -- and
// both are easy to shorten again by trimming padding, so every phone-width rule that gives either one
// a height is checked. The unmediated rules above them are left out: that is the desktop card, where
// there is room for the button to be tall on its own.
test('Nothing on the play page is a target a thumb misses',()=>{
 const rules=phoneRules(play);
 for(const selector of ['.daily-play-button','.achievement-collapse>summary']){
  const found=rules.filter(r=>r.selector.includes(selector)).map(r=>({...r,px:minHeight(r.body)}));
  assert.ok(found.length,`${selector} has no phone-width rule left in play.css: this test is reading the wrong file`);
  assert.ok(found.some(r=>r.px!==null),
   `${selector} sets no min-height at any phone width, so its height is whatever its padding happens to be`);
  for(const {where,px} of found)if(px!==null)assert.ok(px>=44,`${where} is ${px}px: a thumb needs 44`);
 }
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
