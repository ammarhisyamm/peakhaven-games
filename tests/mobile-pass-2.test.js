// The second mobile pass: the landscape notice, the subset fonts, the square icons, the manifest and
// the WebP art. All of it is checkable without a browser, which matters because every one of these
// fails invisibly on a desktop and only shows up on somebody's phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';

const at=p=>new URL(`../${p}`,import.meta.url);
const read=p=>readFileSync(at(p),'utf8');
const size=p=>statSync(at(p)).size;
const {rotateWanted,ROTATE_SHORT_SIDE}=await import('../dist/rotate-notice.js');
const {cleanCode}=await import('../arcade/server/competition.mjs');
const {createMemoryStore}=await import('../arcade/server/memory-store.mjs');

test('The landscape notice asks for the phone back, and only on a phone',()=>{
  const phone={width:844,height:390,inGame:true};
  assert.equal(rotateWanted(phone),true,'a phone held sideways in a game should be asked to turn back');
  assert.equal(rotateWanted({...phone,height:844,width:390}),false,'portrait is the whole point');
  assert.equal(rotateWanted({...phone,inGame:false}),false,'the arcade pages are fine sideways');
  // A tablet or a desktop window has the height to play in and must never be interrupted.
  assert.equal(rotateWanted({width:1100,height:700,inGame:true}),false,'landscape tablet');
  assert.equal(rotateWanted({width:1440,height:900,inGame:true}),false,'desktop window');
  // The boundary is the short side, not the long one.
  assert.equal(rotateWanted({width:900,height:ROTATE_SHORT_SIDE-1,inGame:true}),true);
  assert.equal(rotateWanted({width:900,height:ROTATE_SHORT_SIDE,inGame:true}),false);
  assert.equal(rotateWanted(),false,'no arguments is not a reason to cover the screen');
});

test('An invite code is matched whatever case it is typed in',async()=>{
  // cleanCode upper-cases before the lookup, and every stored code is created through the same
  // helper, so the store only ever holds upper case. This is the belt: the braces are the test below.
  assert.equal(cleanCode('billy-test'),'BILLY-TEST');
  assert.equal(cleanCode('  peak-friends  '),'PEAK-FRIENDS');
  assert.equal(cleanCode('Peak-Friends'),'PEAK-FRIENDS');
  const store=createMemoryStore({invites:{'BILLY-TEST':1}});
  assert.equal(await store.inviteAvailable(cleanCode('billy-test')),true,'lower case must still match');
  assert.equal(await store.inviteAvailable(cleanCode('BILLY-TEST')),true);
  assert.equal(await store.inviteAvailable(cleanCode('nope')),false);
});

test('The web font ships as a subset, with the full file still there as a fallback',()=>{
  for(const [ttf,woff2] of [
    ['arcade/ui/assets/inter.ttf','arcade/ui/assets/inter-subset.woff2'],
    ['dist/assets/inter.ttf','dist/assets/inter-subset.woff2'],
    ['dist/assets/anybody.ttf','dist/assets/anybody-subset.woff2'],
  ]){
    assert.ok(existsSync(at(woff2)),`${woff2} is missing: run node tools/subset-font.mjs`);
    assert.ok(size(woff2)<size(ttf)/4,
      `${woff2} is ${(size(woff2)/1024).toFixed(0)}KB against ${(size(ttf)/1024).toFixed(0)}KB: `+
      'that is not a subset, it is a copy');
    assert.ok(existsSync(at(ttf)),'the full font stays as the fallback src');
  }
  for(const css of ['arcade/ui/styles.css','dist/styles.css']){
    const face=/@font-face\{font-family:Inter;src:([^;]+);/.exec(read(css));
    assert.ok(face,`${css} should still declare Inter`);
    assert.match(face[1],/inter-subset\.woff2.*format\('woff2'\)/,'woff2 must come first');
    assert.match(face[1],/inter\.ttf.*format\('truetype'\)/,'and the ttf must remain as a fallback');
  }
  // Preloading the file the browser will not use is the worst of both worlds.
  for(const html of ['arcade/ui/index.html','arcade/ui/game/index.html']){
    const p=read(html);
    assert.match(p,/rel="preload" href="assets\/inter-subset\.woff2"/,`${html} should preload the subset`);
    assert.doesNotMatch(p,/rel="preload"[^>]*inter\.ttf/,`${html} must not also preload the full ttf`);
  }
});

test('The subset covers every character the source can actually draw',async()=>{
  const {EXTRA_CHARS}=await import('../tools/subset-font.mjs');
  // The scan is the source of truth; this pins the result so a new symbol in the UI cannot quietly
  // start rendering as a tofu box on a phone.
  for(const ch of '·×–—’•…→✓✧')
    assert.ok(EXTRA_CHARS.includes(ch),
      `U+${ch.codePointAt(0).toString(16).toUpperCase()} is used in the UI but not in the subset`);
});

test('The app icons are square, so iOS has nothing to stretch',()=>{
  // PNG puts width and height as big-endian uint32 at byte 16 and 20.
  const dims=p=>{const b=readFileSync(at(p));return [b.readUInt32BE(16),b.readUInt32BE(20)];};
  for(const dir of ['arcade/ui/assets','dist/assets'])
    for(const n of [180,192,512]){
      const p=`${dir}/icon-${n}.png`;
      assert.ok(existsSync(at(p)),`${p} is missing: run node tools/make-icons.mjs`);
      assert.deepEqual(dims(p),[n,n],`${p} must be exactly ${n}x${n}`);
    }
  assert.match(read('arcade/ui/index.html'),/rel="apple-touch-icon" href="assets\/icon-180\.png"/,
    'the home-screen icon must be the square one, not the 512x469 mark');
});

test('The manifest is installable and points at icons that exist',()=>{
  const m=JSON.parse(read('arcade/ui/manifest-app.webmanifest'));
  assert.ok(m.name&&m.short_name,'an installed app needs a name');
  assert.equal(m.display,'standalone');
  assert.ok(m.theme_color&&m.background_color);
  for(const icon of m.icons)
    assert.ok(existsSync(at(`arcade/ui/${icon.src}`)),`manifest points at a missing ${icon.src}`);
  assert.ok(m.icons.some(i=>i.sizes==='512x512'&&/maskable/.test(i.purpose||'')),
    'Android wants a maskable icon or it draws its own badge over ours');
  assert.match(read('arcade/ui/index.html'),/rel="manifest" href="manifest\.webmanifest"/);
  // Deliberate: iOS standalone opens the emailed sign-in link in Safari, not in the installed app,
  // so an installed player could never sign in. Until there is a code-based sign-in, iOS stays in
  // Safari where the link works.
  assert.doesNotMatch(read('arcade/ui/index.html'),/apple-mobile-web-app-capable/,
    'do not switch iOS to standalone while sign-in is a magic link');
});

test('iOS is never served a standalone manifest',async()=>{
  const {isApple,wantsStandaloneManifest,STANDALONE_MANIFEST}=await import('../arcade/ui/standalone.js');
  // Safari has honoured the manifest's own display field for Home Screen installs since iOS 11.3,
  // and apple-mobile-web-app-capable has been optional since the same version. So shipping
  // display:standalone to an iPhone is enough on its own to create a Home Screen app that cannot
  // complete a magic-link sign-in. The meta tag being absent proves nothing.
  const APPLE=[
    ['iPhone 15, iOS 17',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',maxTouchPoints:5,platform:'iPhone'}],
    ['iPhone, iOS 11.3',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 11_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.1 Mobile/15E148 Safari/604.1',maxTouchPoints:5,platform:'iPhone'}],
    ['iPad, iPadOS 17 desktop mode',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',maxTouchPoints:5,platform:'MacIntel'}],
    ['iPad, classic UA',{userAgent:'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',maxTouchPoints:5,platform:'iPad'}],
    ['Chrome on iOS, which is Safari underneath',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1',maxTouchPoints:5,platform:'iPhone'}],
  ];
  for(const [name,env] of APPLE){
    assert.equal(isApple(env),true,`${name} should be recognised as Apple`);
    assert.equal(wantsStandaloneManifest(env),false,`${name} must keep the browser manifest`);
  }
  const OTHER=[
    ['Android Chrome',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',maxTouchPoints:5,platform:'Linux armv8l'}],
    ['desktop Chrome',{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',maxTouchPoints:0,platform:'Win32'}],
    ['desktop Safari on a real Mac',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',maxTouchPoints:0,platform:'MacIntel'}],
  ];
  for(const [name,env] of OTHER)
    assert.equal(wantsStandaloneManifest(env),true,`${name} may have the standalone manifest`);

  // The default served to everyone is the safe one: if the swap never runs, nobody is stranded.
  assert.equal(JSON.parse(read('arcade/ui/manifest.webmanifest')).display,'browser',
    'the manifest in the HTML must be the browser one');
  assert.equal(JSON.parse(read('arcade/ui/manifest-app.webmanifest')).display,'standalone');
  assert.match(read('arcade/ui/index.html'),/rel="manifest" href="manifest.webmanifest"/,
    'the HTML must link the browser manifest, not the standalone one');
  assert.ok(!read('arcade/ui/index.html').includes(STANDALONE_MANIFEST),
    'the standalone manifest must never be reachable without the JS gate');
});

test('An unrecognised browser keeps the safe manifest',async()=>{
  const {wantsStandaloneManifest,applyStandaloneManifest}=await import('../arcade/ui/standalone.js');
  // Unknown is not a licence, but it is also not Apple, so it may install. What must never happen is
  // the swap running with no document or navigator to read.
  assert.equal(applyStandaloneManifest(null,null),false);
  assert.equal(applyStandaloneManifest({querySelector:()=>null},{userAgent:'Android',maxTouchPoints:5}),false,
    'no manifest link means nothing to upgrade');
  let href='manifest.webmanifest';
  const link={get href(){return href;},set href(v){href=v;}};
  const doc={querySelector:()=>link};
  applyStandaloneManifest(doc,{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1',maxTouchPoints:5,platform:'iPhone'});
  assert.equal(href,'manifest.webmanifest','an iPhone must be left alone');
  applyStandaloneManifest(doc,{userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/122 Mobile Safari/537.36',maxTouchPoints:5,platform:'Linux armv8l'});
  assert.equal(href,'manifest-app.webmanifest','Android gets the upgrade');
});

test('Every heavy image has a WebP, and nothing still points at the original',()=>{
  const originals=['ui/run-over-mascot.png','ui/blue-coins-atlas.png','worlds/game-ridge.jpg',
    'worlds/game-bond.jpg','worlds/game-sequence.jpg','worlds/game-orbit.jpg',
    'game-icons/tower.png','game-icons/merge.png','game-icons/ridge.png','game-icons/mahjong.png',
    'game-icons/sort.png','game-icons/sequence.png','game-icons/blocks.png'];
  const sources=['dist/app.js','dist/styles.css','arcade/ui/app.js','arcade/ui/game/app.js',
    'arcade/ui/game/reference-results.js','arcade/ui/game/reference-results.css'].map(read).join('\n');
  for(const rel of originals){
    const webp=`dist/assets/${rel}`.replace(/\.(png|jpe?g)$/,'.webp');
    assert.ok(existsSync(at(webp)),`${webp} is missing: run node tools/encode-webp.mjs --write`);
    assert.ok(size(webp)<size(`dist/assets/${rel}`),`${webp} should be smaller than its source`);
    // the original stays in the repo on purpose, as the way back
    assert.ok(existsSync(at(`dist/assets/${rel}`)),`${rel} should still be in the repo`);
    const name=rel.split('/').pop();
    assert.ok(!sources.includes(name),`something still references ${name} instead of the WebP`);
  }
});
