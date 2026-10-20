// The arcade shell's own art, as invariants. The shell images were WebP already, so the WebP pass in
// #41 never looked at them, and they were still encoded at the size they were drawn rather than the
// size they are shown: a 1280x720 cover on a 410px card. These are the properties that keeps true.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {ASSET_DIMS} from '../arcade/ui/asset-dims.js';

const here=p=>new URL(`../${p}`,import.meta.url);
const read=p=>readFileSync(here(p),'utf8');
const SERVED='arcade/ui/assets',SOURCE='arcade/assets-source';
const app=read('arcade/ui/app.js'),shell=read('arcade/ui/index.html');

// A WebP header carries the canvas size; reading it here keeps the test free of an image library,
// which matters because CI has no Pillow.
const webpSize=buffer=>{
  assert.equal(buffer.toString('ascii',0,4),'RIFF');
  assert.equal(buffer.toString('ascii',8,12),'WEBP');
  const kind=buffer.toString('ascii',12,16);
  if(kind==='VP8X')return [1+buffer.readUIntLE(24,3),1+buffer.readUIntLE(27,3)];
  if(kind==='VP8L'){const b=buffer.readUInt32LE(21);return [1+(b&0x3fff),1+((b>>14)&0x3fff)];}
  if(kind==='VP8 ')return [buffer.readUInt16LE(26)&0x3fff,buffer.readUInt16LE(28)&0x3fff];
  throw new Error(`unknown WebP chunk ${kind}`);
};
const images=()=>readdirSync(here(SERVED)).filter(n=>n.endsWith('.webp'));

test('Every served image declares the size it is really encoded at',()=>{
 // The markup puts these on the <img>. If they drift from the file, the browser reserves the wrong box
 // and the page jumps when the image lands -- which is the whole reason they are written down.
 for(const name of images()){
  const dims=ASSET_DIMS[name];
  assert.ok(dims,`${name} has no entry in asset-dims.js: re-run tools/encode-webp.mjs --write`);
  const real=webpSize(readFileSync(new URL(`${SERVED}/${name}`,here(''))));
  assert.deepEqual(dims,real,`${name} is ${real.join('x')} but asset-dims.js says ${dims.join('x')}`);
 }
 for(const name of Object.keys(ASSET_DIMS))
  if(name.endsWith('.webp'))
   assert.ok(existsSync(new URL(`${SERVED}/${name}`,here(''))),`asset-dims.js lists ${name}, which is gone`);
});

test('Nothing is served at more than twice the size it is drawn',()=>{
 // The measured display sizes live in the encoder, so the check reads them from there rather than
 // keeping a second copy that can disagree with the one the re-encode actually used.
 const tool=read('tools/encode-webp.mjs');
 const block=tool.slice(tool.indexOf('const SHELL={'),tool.indexOf('};',tool.indexOf('const SHELL={')));
 const entries=[...block.matchAll(/'([^']+)':\{shown:\[(\d+),(\d+)\],fit:'(\w+)'(?:,out:'([^']+)')?\}/g)];
 assert.ok(entries.length>=10,'the SHELL table in encode-webp.mjs is not where this test expects it');
 for(const [,source,w,h,fit,out] of entries){
  const name=out||source;
  const [fw,fh]=ASSET_DIMS[name];
  const [bw,bh]=[Number(w),Number(h)];
  // What the browser actually paints inside the box, which is the box when the image is cropped to
  // fill it and the contained rectangle when it is not.
  const scale=fit==='cover'?Math.max(bw/fw,bh/fh):Math.min(bw/fw,bh/fh);
  assert.ok(scale>=0.5-1e-9,
   `${name} is ${fw}x${fh} for a ${bw}x${bh} box: ${(1/scale).toFixed(1)}x the pixels anyone sees`);
 }
});

test('The first screen loads eagerly and everything below it waits',()=>{
 // Measured at 390x844 and 1440x900 on the Play page: the brand, the nav icons, the hero and the two
 // prize cards are on screen; the game covers and the bottle badges beside them are not.
 const at=app.indexOf('alt="${name} game artwork"');
 assert.ok(at>0,'the game cover image is gone from app.js');
 const tag=app.slice(app.lastIndexOf('<img',at),app.indexOf('>',at)+1);
 assert.ok(tag.includes('loading="lazy"'),'a game cover is the heaviest thing on the page and starts off screen');
 assert.ok(tag.includes('dimsOf('),'the cover must reserve its box or the cards below it jump');
 // The hero and the prize cards are the first screen, so none of them may ask to wait. The helper marks
 // an image lazy with a trailing true, so the call is read back to check none of these has one.
 for(const name of ['logo-ph-arcade','decoration-snowy-mountain-range','prize-gold-trophy','prize-gift-box']){
  const open=app.indexOf(`img('${name}'`);
  if(open<0)continue;
  const call=app.slice(open,app.indexOf(')',open)+1);
  assert.ok(!call.includes('true'),`${name} is on the first screen and must not be lazy: ${call}`);
 }
 const brand=shell.slice(shell.indexOf('<img src="assets/brand'),shell.indexOf('>',shell.indexOf('<img src="assets/brand'))+1);
 assert.ok(brand.includes('brand.webp'),'the brand mark is still a PNG');
 assert.ok(brand.includes('width="')&&brand.includes('height="'),'the brand mark needs its size');
 assert.ok(!brand.includes('loading="lazy"'),'the brand mark is the first thing drawn');
});

test('The full-size art is kept, and out of the deploy',()=>{
 // Every served file has its source beside it, so a re-encode is repeatable and a bad one is revertible.
 const sources=readdirSync(here(SOURCE)).filter(n=>/\.(webp|png|jpe?g)$/i.test(n));
 assert.ok(sources.length>=17,`only ${sources.length} sources kept`);
 const tool=read('tools/encode-webp.mjs');
 for(const name of sources){
  const served=name.replace(/\.png$/,'.webp');
  assert.ok(existsSync(new URL(`${SERVED}/${served}`,here(''))),`${name} has no served copy`);
  assert.ok(statSync(here(`${SOURCE}/${name}`)).size>=statSync(here(`${SERVED}/${served}`)).size,
   `${served} is larger than the source it came from`);
 }
 // arcade/build.mjs copies arcade/ui wholesale, so the sources only stay out of the deploy by living
 // outside it. This is the line that keeps them there.
 assert.ok(!SOURCE.startsWith('arcade/ui/'),'the sources moved inside ui/ and are now being deployed');
 assert.match(tool,/SHELL_SOURCE='arcade\/assets-source'/,'the tool no longer reads the sources this test guards');
});
